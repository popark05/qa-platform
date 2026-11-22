import type { TestStep } from "../domain/test-case.js";
import type { StepExecutionContext, StepExecutionResult, StepExecutor } from "../domain/test-run.js";
import type { MobilewrightDeviceProvider, MobilewrightLocator } from "./mobilewright-session-manager.js";

type LocatorSpec =
  | { by: "role"; value: string; name?: string; exact?: boolean }
  | { by: "text"; value: string; exact?: boolean }
  | { by: "testId" | "label"; value: string };

type MobileAction =
  | { type: "navigate"; url: string }
  | { type: "click" | "assert_visible"; locator: LocatorSpec }
  | { type: "fill"; locator: LocatorSpec; value: string }
  | { type: "assert_text"; locator: LocatorSpec; expected: string }
  | { type: "wait_for"; locator: LocatorSpec; state: "visible" | "hidden" | "enabled" | "disabled" }
  | { type: "swipe"; direction: "up" | "down" | "left" | "right"; distance?: number; duration?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLocator(value: unknown): LocatorSpec {
  if (!isRecord(value) || typeof value.by !== "string" || typeof value.value !== "string" || !value.value) {
    throw new Error("locator must contain a supported 'by' strategy and non-empty value");
  }
  switch (value.by) {
    case "role":
      if (value.name !== undefined && typeof value.name !== "string") throw new Error("locator.name must be a string");
      if (value.exact !== undefined && typeof value.exact !== "boolean") throw new Error("locator.exact must be a boolean");
      return { by: "role", value: value.value, ...(typeof value.name === "string" ? { name: value.name } : {}), ...(typeof value.exact === "boolean" ? { exact: value.exact } : {}) };
    case "text":
      if (value.exact !== undefined && typeof value.exact !== "boolean") throw new Error("locator.exact must be a boolean");
      return { by: "text", value: value.value, ...(typeof value.exact === "boolean" ? { exact: value.exact } : {}) };
    case "testId":
    case "label":
      return { by: value.by, value: value.value };
    default:
      throw new Error(`unsupported Mobilewright locator strategy: ${value.by}`);
  }
}

function parseAction(serialized: string): MobileAction {
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { throw new Error("action must be a JSON object"); }
  if (!isRecord(value) || typeof value.type !== "string") throw new Error("action.type is required");

  switch (value.type) {
    case "navigate":
      if (typeof value.url !== "string" || !value.url) throw new Error("navigate action requires url");
      return { type: "navigate", url: value.url };
    case "click":
    case "assert_visible":
      return { type: value.type, locator: parseLocator(value.locator) };
    case "fill":
      if (typeof value.value !== "string") throw new Error("fill action requires a string value");
      return { type: "fill", locator: parseLocator(value.locator), value: value.value };
    case "assert_text":
      if (typeof value.expected !== "string") throw new Error("assert_text action requires expected text");
      return { type: "assert_text", locator: parseLocator(value.locator), expected: value.expected };
    case "wait_for": {
      const state = value.state ?? "visible";
      if (!["visible", "hidden", "enabled", "disabled"].includes(String(state))) throw new Error("wait_for state is invalid");
      return { type: "wait_for", locator: parseLocator(value.locator), state: state as "visible" | "hidden" | "enabled" | "disabled" };
    }
    case "swipe":
      if (!["up", "down", "left", "right"].includes(String(value.direction))) throw new Error("swipe direction is invalid");
      if (value.distance !== undefined && (typeof value.distance !== "number" || value.distance <= 0)) throw new Error("swipe distance must be positive");
      if (value.duration !== undefined && (typeof value.duration !== "number" || value.duration <= 0)) throw new Error("swipe duration must be positive");
      return {
        type: "swipe", direction: value.direction as "up" | "down" | "left" | "right",
        ...(typeof value.distance === "number" ? { distance: value.distance } : {}),
        ...(typeof value.duration === "number" ? { duration: value.duration } : {})
      };
    default:
      throw new Error(`unsupported Mobilewright action: ${value.type}`);
  }
}

export class MobilewrightStepExecutor implements StepExecutor {
  constructor(private readonly sessions: MobilewrightDeviceProvider) {}

  async execute(step: TestStep, _index: number, context?: StepExecutionContext): Promise<StepExecutionResult> {
    const started = Date.now();
    if (!context) return { stepId: step.stepId, status: "failed", message: "run_context_required", durationMs: 0 };

    try {
      if (!step.action) throw new Error("step.action is required for Mobilewright execution");
      const action = parseAction(step.action);
      const device = await this.sessions.getDevice(context.runId, context.target);

      if (action.type === "navigate") {
        await device.goto(action.url);
      } else if (action.type === "swipe") {
        await device.screen.swipe(action.direction, {
          ...(action.distance === undefined ? {} : { distance: action.distance }),
          ...(action.duration === undefined ? {} : { duration: action.duration })
        });
      } else {
        const locator = this.resolveLocator(device.screen, action.locator);
        switch (action.type) {
          case "click": await locator.tap(); break;
          case "fill": await locator.fill(action.value); break;
          case "assert_visible":
            if (!(await locator.isVisible())) throw new Error("expected element to be visible");
            break;
          case "assert_text": {
            const actual = await locator.getText();
            if (!actual.includes(action.expected)) throw new Error(`expected text to include "${action.expected}", received ${JSON.stringify(actual)}`);
            break;
          }
          case "wait_for": await locator.waitFor({ state: action.state, timeout: 5_000 }); break;
        }
      }

      return { stepId: step.stepId, status: "passed", message: `Mobilewright action completed: ${action.type}`, durationMs: Date.now() - started };
    } catch (error) {
      return {
        stepId: step.stepId, status: "failed",
        message: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started
      };
    }
  }

  async closeRun(runId: string): Promise<void> {
    await this.sessions.closeRun(runId);
  }

  private resolveLocator(screen: Awaited<ReturnType<MobilewrightDeviceProvider["getDevice"]>>["screen"], spec: LocatorSpec): MobilewrightLocator {
    switch (spec.by) {
      case "role": return screen.getByRole(spec.value, {
        ...(spec.name === undefined ? {} : { name: spec.name }),
        ...(spec.exact === undefined ? {} : { exact: spec.exact })
      });
      case "text": return screen.getByText(spec.value, spec.exact === undefined ? {} : { exact: spec.exact });
      case "testId": return screen.getByTestId(spec.value);
      case "label": return screen.getByLabel(spec.value);
    }
  }
}
