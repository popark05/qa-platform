import type { Locator as PlaywrightLocator, Page } from "playwright";
import type { TestStep } from "../domain/test-case.js";
import type { StepExecutionResult, StepExecutor } from "../domain/test-run.js";

type LocatorSpec =
  | { by: "role"; value: string; name?: string; exact?: boolean }
  | { by: "text"; value: string; exact?: boolean }
  | { by: "testId"; value: string }
  | { by: "css"; value: string };

type PlaywrightAction =
  | { type: "navigate"; url: string }
  | { type: "click"; locator: LocatorSpec }
  | { type: "fill"; locator: LocatorSpec; value: string }
  | { type: "press"; locator: LocatorSpec; key: string }
  | { type: "assert_visible"; locator: LocatorSpec }
  | { type: "assert_text"; locator: LocatorSpec; expected: string }
  | { type: "wait_for"; locator: LocatorSpec; state?: "attached" | "detached" | "visible" | "hidden" };

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
    case "testId": return { by: "testId", value: value.value };
    case "css": return { by: "css", value: value.value };
    default: throw new Error(`unsupported locator strategy: ${value.by}`);
  }
}

function parseAction(serialized: string): PlaywrightAction {
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
    case "press":
      if (typeof value.key !== "string" || !value.key) throw new Error("press action requires key");
      return { type: "press", locator: parseLocator(value.locator), key: value.key };
    case "assert_text":
      if (typeof value.expected !== "string") throw new Error("assert_text action requires expected text");
      return { type: "assert_text", locator: parseLocator(value.locator), expected: value.expected };
    case "wait_for": {
      const state = value.state ?? "visible";
      if (!["attached", "detached", "visible", "hidden"].includes(String(state))) throw new Error("wait_for state is invalid");
      return { type: "wait_for", locator: parseLocator(value.locator), state: state as "attached" | "detached" | "visible" | "hidden" };
    }
    default: throw new Error(`unsupported Playwright action: ${value.type}`);
  }
}

export class PlaywrightStepExecutor implements StepExecutor {
  constructor(private readonly page: Page) {}

  async execute(step: TestStep, index: number): Promise<StepExecutionResult> {
    const started = Date.now();
    try {
      if (!step.action) throw new Error("step.action is required for Playwright execution");
      const action = parseAction(step.action);
      if (action.type === "navigate") {
        await this.page.goto(action.url);
      } else {
        const locator = this.resolveLocator(action.locator);
        switch (action.type) {
          case "click": await locator.click(); break;
          case "fill": await locator.fill(action.value); break;
          case "press": await locator.press(action.key); break;
          case "assert_visible":
            if (!(await locator.isVisible())) throw new Error("expected element to be visible");
            break;
          case "assert_text": {
            const actual = await locator.textContent();
            if (actual === null || !actual.includes(action.expected)) {
              throw new Error(`expected text to include "${action.expected}", received ${JSON.stringify(actual)}`);
            }
            break;
          }
          case "wait_for": await locator.waitFor({ ...(action.state === undefined ? {} : { state: action.state }), timeout: 5_000 }); break;
        }
      }
      return { stepId: step.stepId, status: "passed", message: `Playwright action completed: ${action.type}`, durationMs: Date.now() - started };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { stepId: step.stepId, status: "failed", message, durationMs: Date.now() - started };
    }
  }

  private resolveLocator(spec: LocatorSpec): PlaywrightLocator {
    switch (spec.by) {
      case "role":
        return this.page.getByRole(spec.value as Parameters<Page["getByRole"]>[0], {
          ...(spec.name === undefined ? {} : { name: spec.name }),
          ...(spec.exact === undefined ? {} : { exact: spec.exact })
        });
      case "text": return this.page.getByText(spec.value, spec.exact === undefined ? {} : { exact: spec.exact });
      case "testId": return this.page.getByTestId(spec.value);
      case "css": return this.page.locator(spec.value);
    }
  }
}
