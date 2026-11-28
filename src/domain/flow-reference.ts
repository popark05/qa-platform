import type { TestStep } from "./test-case.js";

/** discovered (contract 1.1): observed in the running app by Reverse Screen and accepted in review. */
type Origin = "product_requirement" | "ai_suggestion" | "open_question" | "discovered";
export type FlowContractVersion = "1.0" | "1.1";

/** Wireflow Review flow-model v1.x (wireflow-review/contracts/flow-model.v1.schema.json). Only approved flows are published. */
export interface WireflowFlowModelV1 {
  contractVersion: FlowContractVersion;
  sourceSystem: "wireflow-review";
  flowId: string;
  flowVersion: number;
  applicationId: string;
  title: string;
  description?: string;
  approval: { reviewId: string; reviewerId: string; approvedAt: string };
  nodes: Array<{ nodeId: string; type: "screen" | "decision" | "external"; title: string; origin: Origin }>;
  edges: Array<{
    edgeId: string; fromNodeId: string; toNodeId: string;
    kind: "primary" | "back" | "cancel" | "retry" | "empty" | "failure";
    label?: string; trigger?: string; origin: Origin;
    discoveryRef?: { sourceSystem: "reverse-screen"; transitionId?: string; sessionId?: string };
  }>;
  exportedAt: string;
}

/** Case-level provenance: the exact approved flow snapshot a Test Case was generated from. */
export interface FlowReference {
  sourceSystem: "wireflow-review";
  contractVersion: FlowContractVersion;
  flowId: string;
  flowVersion: number;
  applicationId: string;
  approvalReviewId: string;
}

/** Step-level provenance: the flow edge (and Reverse Screen transition, when known) a step verifies. */
export interface StepFlowReference {
  edgeId: string;
  transitionId?: string;
}

/**
 * Runtime facts about a discovered transition, resolved from Reverse Screen: how the user
 * triggered it and a text that is visible on the target screen but not on the source screen.
 */
export interface DiscoveredTransition {
  action: "tap" | "back";
  locator?: { strategy: "label" | "test_id" | "role_name"; value?: string; role?: string; name?: string };
  targetText?: string;
}
export interface DiscoverySource {
  resolveTransitions(refs: Array<{ sessionId: string; transitionId: string }>): Promise<Map<string, DiscoveredTransition>>;
}

export interface FlowSource {
  fetchApprovedFlow(flowId: string): Promise<WireflowFlowModelV1>;
}

export class FlowNotFoundError extends Error {
  constructor(flowId: string) { super(`flow_not_found:${flowId}`); this.name = "FlowNotFoundError"; }
}
export class FlowNotApprovedError extends Error {
  constructor(flowId: string) { super(`flow_not_approved:${flowId}`); this.name = "FlowNotApprovedError"; }
}
export class FlowSourceUnavailableError extends Error {
  constructor(message = "flow_source_unavailable") { super(message); this.name = "FlowSourceUnavailableError"; }
}

export interface GeneratedFlowTestCase {
  title: string;
  description: string;
  steps: TestStep[];
  flowRef: FlowReference;
  skippedEdges: Array<{ edgeId: string; reason: "open_question" }>;
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/**
 * Turns an approved flow into one Test Case whose steps cover every eligible edge once.
 * Steps follow a greedy walk from the first node (continue from the current screen when
 * possible, otherwise jump to the next uncovered edge), and every instruction names its
 * starting screen so a jump is explicit. Elements marked open_question are unresolved
 * product decisions and are never turned into test steps.
 */
export function generateTestCaseFromFlow(
  flow: WireflowFlowModelV1,
  transitions: ReadonlyMap<string, DiscoveredTransition> = new Map()
): GeneratedFlowTestCase {
  const nodes = new Map(flow.nodes.map((node) => [node.nodeId, node]));
  const skippedEdges: GeneratedFlowTestCase["skippedEdges"] = [];
  const eligible = flow.edges.filter((edge) => {
    const open = edge.origin === "open_question" ||
      nodes.get(edge.fromNodeId)?.origin === "open_question" || nodes.get(edge.toNodeId)?.origin === "open_question";
    if (open) skippedEdges.push({ edgeId: edge.edgeId, reason: "open_question" });
    return !open;
  });

  const ordered: typeof eligible = [];
  const remaining = [...eligible];
  let current = flow.nodes[0]?.nodeId;
  while (remaining.length > 0) {
    const index = Math.max(0, remaining.findIndex((edge) => edge.fromNodeId === current));
    const [edge] = remaining.splice(index, 1);
    ordered.push(edge!);
    current = edge!.toNodeId;
  }

  let jumps = 0;
  const steps: TestStep[] = ordered.map((edge, index) => {
    if (index > 0 && ordered[index - 1]!.toNodeId !== edge.fromNodeId) jumps++;
    const transitionId = edge.discoveryRef?.transitionId;
    const action = transitionId ? toExecutableAction(transitions.get(transitionId)) : undefined;
    const from = nodes.get(edge.fromNodeId)?.title ?? edge.fromNodeId;
    const to = nodes.get(edge.toNodeId)?.title ?? edge.toNodeId;
    const trigger = edge.trigger ?? "tap";
    const doWhat = trigger === "back" || edge.kind === "back"
      ? "go back"
      : `${trigger} "${edge.label ?? edge.edgeId}"`;
    return {
      stepId: `edge-${edge.edgeId}`,
      instruction: clip(`On "${from}", ${doWhat}`, 2000),
      expectedResult: clip(`"${to}" is shown`, 2000),
      ...(action ? { action } : {}),
      flowRef: {
        edgeId: edge.edgeId,
        ...(edge.discoveryRef?.transitionId ? { transitionId: edge.discoveryRef.transitionId } : {})
      }
    };
  });

  return {
    title: clip(`Verify flow: ${flow.title}`, 240),
    description: clip(
      `Generated from Wireflow Review flow ${flow.flowId} v${flow.flowVersion}, approved by ` +
      `${flow.approval.reviewerId} at ${flow.approval.approvedAt}. Covers ${steps.length} of ${flow.edges.length} edges` +
      (skippedEdges.length ? `; ${skippedEdges.length} open-question edge(s) skipped.` : ".") +
      ` ${steps.filter((step) => step.action).length} step(s) have executable actions from Reverse Screen.` +
      (jumps ? ` ${jumps} step(s) start on a different screen than the previous step ends on.` : ""), 4000),
    steps,
    flowRef: {
      sourceSystem: "wireflow-review", contractVersion: flow.contractVersion, flowId: flow.flowId,
      flowVersion: flow.flowVersion, applicationId: flow.applicationId, approvalReviewId: flow.approval.reviewId
    },
    skippedEdges
  };
}

/** Maps a discovered transition to the Mobilewright step action grammar (see docs/architecture/adapter-contract.md). */
function toExecutableAction(transition: DiscoveredTransition | undefined): string | undefined {
  if (!transition) return undefined;
  const waitFor = transition.targetText ? { by: "text", value: transition.targetText, exact: true } : undefined;
  if (transition.action === "back") return JSON.stringify({ type: "back", ...(waitFor ? { waitFor } : {}) });
  const locator = transition.locator;
  const spec = locator?.strategy === "label" && locator.value ? { by: "label", value: locator.value }
    : locator?.strategy === "test_id" && locator.value ? { by: "testId", value: locator.value }
      : locator?.strategy === "role_name" && locator.role && locator.name ? { by: "role", value: locator.role, name: locator.name, exact: true }
        : undefined;
  return spec ? JSON.stringify({ type: "click", locator: spec, ...(waitFor ? { waitFor } : {}) }) : undefined;
}
