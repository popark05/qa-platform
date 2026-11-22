import assert from "node:assert/strict";
import test from "node:test";
import { MobilewrightStepExecutor } from "../src/adapters/mobilewright-step-executor.js";
import type { MobilewrightDevice, MobilewrightDeviceProvider, MobilewrightLocator, MobilewrightScreen } from "../src/adapters/mobilewright-session-manager.js";
import type { TestStep } from "../src/domain/test-case.js";

function createFake() {
  const calls: string[] = [];
  const locator: MobilewrightLocator = {
    tap: async () => { calls.push("tap"); },
    fill: async (value) => { calls.push(`fill:${value}`); },
    isVisible: async () => true,
    getText: async () => "Welcome back",
    waitFor: async ({ state }) => { calls.push(`wait:${state}`); }
  };
  const screen: MobilewrightScreen = {
    getByRole: (role, options) => { calls.push(`role:${role}:${options?.name ?? ""}`); return locator; },
    getByText: (value) => { calls.push(`text:${value}`); return locator; },
    getByTestId: (value) => { calls.push(`testId:${value}`); return locator; },
    getByLabel: (value) => { calls.push(`label:${value}`); return locator; },
    swipe: async (direction) => { calls.push(`swipe:${direction}`); }
  };
  const device: MobilewrightDevice = { screen, goto: async (url) => { calls.push(`goto:${url}`); }, close: async () => { calls.push("close"); } };
  const sessions: MobilewrightDeviceProvider = {
    getDevice: async () => device,
    closeRun: async () => { calls.push("closeRun"); },
    close: async () => { calls.push("closeAll"); }
  };
  return { calls, executor: new MobilewrightStepExecutor(sessions) };
}

const step = (action: unknown): TestStep => ({ stepId: "step-1", instruction: "test action", action: JSON.stringify(action) });
const context = { runId: "run-1", target: { platform: "ios" as const, targetId: "simulator-1" } };

test("maps semantic native locators and tap to Mobilewright", async () => {
  const { calls, executor } = createFake();
  const result = await executor.execute(step({ type: "click", locator: { by: "role", value: "button", name: "Continue" } }), 0, context);
  assert.equal(result.status, "passed");
  assert.deepEqual(calls, ["role:button:Continue", "tap"]);
});

test("supports label fill, text assertion and swipe actions", async () => {
  const { calls, executor } = createFake();
  const fill = await executor.execute(step({ type: "fill", locator: { by: "label", value: "Email" }, value: "qa@example.test" }), 0, context);
  const assertion = await executor.execute(step({ type: "assert_text", locator: { by: "text", value: "Welcome" }, expected: "Welcome" }), 1, context);
  const swipe = await executor.execute(step({ type: "swipe", direction: "up", distance: 250 }), 2, context);
  assert.equal(fill.status, "passed");
  assert.equal(assertion.status, "passed");
  assert.equal(swipe.status, "passed");
  assert.deepEqual(calls, ["label:Email", "fill:qa@example.test", "text:Welcome", "swipe:up"]);
});

test("rejects CSS and unsupported arbitrary actions instead of guessing", async () => {
  const { executor } = createFake();
  const css = await executor.execute(step({ type: "click", locator: { by: "css", value: "button" } }), 0, context);
  const evaluate = await executor.execute(step({ type: "evaluate", script: "alert(1)" }), 1, context);
  assert.equal(css.status, "failed");
  assert.match(css.message, /unsupported Mobilewright locator strategy/);
  assert.equal(evaluate.status, "failed");
  assert.match(evaluate.message, /unsupported Mobilewright action/);
});

test("requires run context and an executable action", async () => {
  const { executor } = createFake();
  assert.equal((await executor.execute({ stepId: "1", instruction: "no context" }, 0)).message, "run_context_required");
  assert.match((await executor.execute({ stepId: "2", instruction: "no action" }, 0, context)).message, /step.action is required/);
});
