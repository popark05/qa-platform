import { FlowSourceUnavailableError, type DiscoveredTransition, type DiscoverySource } from "../domain/flow-reference.js";

interface DiscoveryEventPayload {
  event_type?: unknown; screen_id?: unknown; state_id?: unknown; transition_id?: unknown;
  payload?: Record<string, unknown>;
}

const MAX_TARGET_TEXT = 60;

/**
 * Resolves Reverse Screen transitions (by session) into executable facts. Reads the session's
 * Discovery Events once per session and keeps engine-specific details inside this adapter.
 */
export class ReverseScreenDiscoveryClient implements DiscoverySource {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;
  constructor(baseUrl: string, private readonly options: { serviceToken: string; fetcher?: typeof fetch }) {
    this.baseUrl = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    if (this.baseUrl.protocol !== "http:" && this.baseUrl.protocol !== "https:") {
      throw new Error("REVERSE_SCREEN_BASE_URL must use http or https");
    }
    this.fetcher = options.fetcher ?? fetch;
  }

  async resolveTransitions(refs: Array<{ sessionId: string; transitionId: string }>): Promise<Map<string, DiscoveredTransition>> {
    const bySession = new Map<string, Set<string>>();
    for (const ref of refs) bySession.set(ref.sessionId, (bySession.get(ref.sessionId) ?? new Set()).add(ref.transitionId));
    const resolved = new Map<string, DiscoveredTransition>();
    for (const [sessionId, transitionIds] of bySession) {
      const events = await this.fetchEvents(sessionId);
      for (const transitionId of transitionIds) {
        const transition = resolveTransition(events, transitionId);
        if (transition) resolved.set(transitionId, transition);
      }
    }
    return resolved;
  }

  private async fetchEvents(sessionId: string): Promise<DiscoveryEventPayload[]> {
    let response: Response;
    try {
      response = await this.fetcher(new URL(`v1/discovery-sessions/${encodeURIComponent(sessionId)}/events`, this.baseUrl), {
        headers: { accept: "application/json", authorization: `Bearer ${this.options.serviceToken}` }
      });
    } catch {
      throw new FlowSourceUnavailableError("reverse_screen_request_failed");
    }
    if (!response.ok) throw new FlowSourceUnavailableError(`reverse_screen_http_${response.status}`);
    const body = await response.json().catch(() => undefined) as { events?: unknown } | undefined;
    if (!body || !Array.isArray(body.events)) throw new FlowSourceUnavailableError("reverse_screen_invalid_events");
    return body.events as DiscoveryEventPayload[];
  }
}

function resolveTransition(events: DiscoveryEventPayload[], transitionId: string): DiscoveredTransition | undefined {
  const event = events.find((item) => item.event_type === "transition_observed" && item.transition_id === transitionId);
  const payload = event?.payload;
  if (!payload) return undefined;
  const action = payload.action === "back" ? "back" : payload.action === "tap" ? "tap" : undefined;
  if (!action) return undefined;
  const strategy = payload.locator_strategy;
  const locator = strategy === "label" || strategy === "test_id" || strategy === "role_name"
    ? {
        strategy,
        ...(typeof payload.locator_value === "string" ? { value: payload.locator_value } : {}),
        ...(typeof payload.locator_role === "string" ? { role: payload.locator_role } : {}),
        ...(typeof payload.locator_name === "string" ? { name: payload.locator_name } : {})
      } as DiscoveredTransition["locator"]
    : undefined;
  const targetText = distinguishingText(events, String(payload.source_state_id ?? ""), String(payload.target_state_id ?? ""))
    ?? (typeof payload.target_screen_name === "string" ? payload.target_screen_name : undefined);
  return { action, ...(locator ? { locator } : {}), ...(targetText ? { targetText } : {}) };
}

/** Topmost short visible text present in the target state but absent from the source state. */
function distinguishingText(events: DiscoveryEventPayload[], sourceStateId: string, targetStateId: string): string | undefined {
  const texts = (stateId: string) => events
    .filter((item) => item.event_type === "element_observed" && item.state_id === stateId &&
      item.payload?.context_type === "native" && item.payload.visible !== false && typeof item.payload.text === "string")
    .map((item) => ({ text: String(item.payload!.text).trim(), y: Number((item.payload!.bounds as { y?: number } | undefined)?.y ?? 0) }))
    .filter((item) => item.text && item.text.length <= MAX_TARGET_TEXT && !item.text.includes("\n"));
  const source = new Set(texts(sourceStateId).map((item) => item.text));
  return texts(targetStateId).filter((item) => !source.has(item.text)).sort((a, b) => a.y - b.y)[0]?.text;
}
