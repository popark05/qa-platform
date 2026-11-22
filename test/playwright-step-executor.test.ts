import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright";
import { PlaywrightStepExecutor } from "../src/adapters/playwright-step-executor.js";

function createPageStub() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const locator = {
    click: async () => { calls.push({ method: "click", args: [] }); },
    fill: async (value: string) => { calls.push({ method: "fill", args: [value] }); },
    press: async (key: string) => { calls.push({ method: "press", args: [key] }); },
    isVisible: async () => true,
    textContent: async () => "Welcome, tester",
    waitFor: async (options: unknown) => { calls.push({ method: "waitFor", args: [options] }); }
  };
  const page = {
    goto: async (url: string) => { calls.push({ method: "goto", args: [url] }); },
    getByRole: (role: string, options: unknown) => { calls.push({ method: "getByRole", args: [role, options] }); return locator; },
    getByText: (text: string, options: unknown) => { calls.push({ method: "getByText", args: [text, options] }); return locator; },
    getByTestId: (id: string) => { calls.push({ method: "getByTestId", args: [id] }); return locator; },
    locator: (selector: string) => { calls.push({ method: "locator", args: [selector] }); return locator; }
  };
  return { page: page as unknown as Page, calls };
}

test("Playwright executor maps a structured click action to a semantic locator", async () => {
  const stub = createPageStub();
  const executor = new PlaywrightStepExecutor(stub.page);
  const result = await executor.execute({
    stepId: "step-1", instruction: "Click the sign in button",
    action: JSON.stringify({ type: "click", locator: { by: "role", value: "button", name: "Sign in" } })
  }, 0);
  assert.equal(result.status, "passed");
  assert.deepEqual(stub.calls.map((call) => call.method), ["getByRole", "click"]);
});

test("Playwright executor runs navigation and fill actions", async () => {
  const stub = createPageStub();
  const executor = new PlaywrightStepExecutor(stub.page);
  const navigation = await executor.execute({
    stepId: "step-1", instruction: "Open login", action: JSON.stringify({ type: "navigate", url: "https://example.test/login" })
  }, 0);
  const fill = await executor.execute({
    stepId: "step-2", instruction: "Enter email",
    action: JSON.stringify({ type: "fill", locator: { by: "testId", value: "email" }, value: "qa@example.test" })
  }, 1);
  assert.equal(navigation.status, "passed");
  assert.equal(fill.status, "passed");
  assert.deepEqual(stub.calls.map((call) => call.method), ["goto", "getByTestId", "fill"]);
});

test("unsupported or malformed actions fail safely without evaluating arbitrary code", async () => {
  const stub = createPageStub();
  const executor = new PlaywrightStepExecutor(stub.page);
  const result = await executor.execute({
    stepId: "step-1", instruction: "Run custom script",
    action: JSON.stringify({ type: "evaluate", script: "window.localStorage.clear()" })
  }, 0);
  assert.equal(result.status, "failed");
  assert.match(result.message, /unsupported Playwright action/);
  assert.equal(stub.calls.length, 0);
});

test("Playwright executor requires a structured action", async () => {
  const stub = createPageStub();
  const result = await new PlaywrightStepExecutor(stub.page).execute({ stepId: "step-1", instruction: "Do something" }, 0);
  assert.equal(result.status, "failed");
  assert.match(result.message, /step.action is required/);
});
