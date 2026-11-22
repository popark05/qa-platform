# Automation Adapter Contract v1.0

## Purpose
Provide one platform-neutral execution interface for Web (Playwright) and Mobile (Mobilewright). Product/domain code must not depend on Playwright or Mobilewright classes.

## Core TypeScript contract

```ts
export type Platform = "web" | "android" | "ios" | "hybrid";

export interface ExecutionTarget {
  id: string;
  platform: Platform;
  kind: "browser" | "emulator" | "simulator" | "device" | "cloud_device";
  capabilities: Record<string, unknown>;
}

export interface Locator {
  strategy: "accessibility_id" | "role_name" | "text" | "test_id" | "css" | "xpath" | "ios_predicate" | "android_uiautomator" | "coordinate" | "custom";
  value: string;
  options?: Record<string, unknown>;
}

export interface ScreenSnapshot {
  platform: Platform; url?: string; routeOrNativeIdentifier?: string; title?: string;
  elements: ElementSnapshot[]; observedAt: string; rawEvidenceIds: string[];
  metadata: Record<string, unknown>;
}

export interface ElementSnapshot {
  semanticKey?: string; name?: string; role?: string; text?: string;
  visible: boolean; enabled?: boolean; locatorCandidates: Locator[];
  attributes: Record<string, unknown>;
}

export type Action =
  | { type: "tap" | "click" | "long_press"; locator: Locator; durationMs?: number }
  | { type: "enter_text"; locator: Locator; value: string; clearFirst?: boolean }
  | { type: "clear_text"; locator: Locator }
  | { type: "swipe"; direction: "up" | "down" | "left" | "right"; distance?: number }
  | { type: "scroll"; direction: "up" | "down"; amount?: number }
  | { type: "key_press"; key: string }
  | { type: "back" }
  | { type: "navigate"; destination: string }
  | { type: "wait"; timeoutMs: number; condition?: Record<string, unknown> }
  | { type: "custom"; name: string; parameters: Record<string, unknown> };

export interface ActionResult {
  status: "passed" | "failed" | "error"; startedAt: string; finishedAt: string;
  durationMs: number; before?: ScreenSnapshot; after?: ScreenSnapshot;
  error?: { code: string; message: string; details?: unknown };
  evidenceIds: string[]; metadata: Record<string, unknown>;
}

export interface Assertion {
  type: "screen" | "element_visible" | "element_text" | "element_attribute" | "url" | "value" | "not_present" | "custom";
  target?: Locator; expected: unknown; operator?: string;
}

export interface AssertionResult {
  status: "passed" | "failed" | "error"; expected: unknown; actual?: unknown;
  message?: string; evidenceIds: string[];
}

export interface EvidenceArtifact {
  id: string;
  type: "screenshot" | "video" | "dom_snapshot" | "accessibility_tree" | "ui_hierarchy" | "console_log" | "device_log" | "network_trace" | "trace" | "other";
  storageUri?: string; contentHash?: string; mimeType?: string;
  capturedAt: string; metadata: Record<string, unknown>;
}

export interface AutomationAdapter {
  readonly platform: Platform;
  connect(target: ExecutionTarget): Promise<void>;
  getCurrentScreen(): Promise<ScreenSnapshot>;
  findElement(locator: Locator): Promise<ElementSnapshot | null>;
  executeAction(action: Action): Promise<ActionResult>;
  evaluateAssertion(assertion: Assertion): Promise<AssertionResult>;
  captureEvidence(types: EvidenceArtifact["type"][]): Promise<EvidenceArtifact[]>;
  disconnect(): Promise<void>;
}
```

## Initial Playwright StepExecutor

The QA Platform includes an opt-in `PlaywrightStepExecutor`. It accepts a Playwright `Page` from the execution/session manager and maps a constrained JSON action grammar to Playwright locators and operations. It does not launch browsers or own browser lifecycle.

Each `TestStep.action` is a JSON string. Supported forms:

```json
{ "type": "navigate", "url": "https://example.test/login" }
{ "type": "click", "locator": { "by": "role", "value": "button", "name": "Sign in" } }
{ "type": "fill", "locator": { "by": "testId", "value": "email" }, "value": "qa@example.test" }
{ "type": "press", "locator": { "by": "css", "value": "input[name=email]" }, "key": "Enter" }
{ "type": "assert_visible", "locator": { "by": "text", "value": "Dashboard" } }
{ "type": "assert_text", "locator": { "by": "role", "value": "heading" }, "expected": "Welcome" }
{ "type": "wait_for", "locator": { "by": "testId", "value": "loading" }, "state": "hidden" }
```

Locator strategies are `role`, `text`, `testId` and `css`. The executor intentionally rejects arbitrary JavaScript/evaluate actions. A step without an action fails explicitly when this executor is selected; human-readable `instruction` remains documentation, not an executable command.

## Contract rules
1. `connect` must fail clearly when target capabilities are unsupported.
2. `getCurrentScreen` returns normalized semantic data; raw DOM/UI hierarchy is attached as evidence, not embedded without limits.
3. `executeAction` returns before/after snapshots when available and never silently converts a failed action into success.
4. Locator resolution order is supplied by the domain model. Adapter-specific fallback is recorded in result metadata.
5. Timeouts and retries are controlled by the execution engine, not hidden inside adapter methods, except for bounded low-level polling.
6. `captureEvidence` returns metadata and object-storage references; large binary payloads are not returned in API responses.
7. Adapter implementations may expose optional capability interfaces for network interception, WebView DOM inspection, deep links, permissions, biometrics and device logs.
8. A hybrid app may require coordinated WebView and native contexts. Context switches must be explicit in action/result metadata.
9. All timestamps are ISO 8601 UTC.
10. Do not persist vendor SDK objects. Normalize errors into stable `code`, `message`, and optional `details`.

## Initial capability interface

```ts
export interface AdapterCapabilities {
  screenshots: boolean; accessibilityTree: boolean; domInspection: boolean;
  networkCapture: boolean; deepLinks: boolean; permissions: boolean;
  deviceLogs: boolean; webViewInspection: boolean;
}
```

## Ownership
- Execution Engine owns orchestration, timeout, retry, test data, run status and persistence.
- Adapter owns translating normalized actions/locators to Playwright or Mobilewright operations.
- Evidence Engine owns uploading bytes and persisting evidence metadata.
