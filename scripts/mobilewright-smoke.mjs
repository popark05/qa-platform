import assert from "node:assert/strict";
import { MobilewrightSessionManager } from "../src/adapters/mobilewright-session-manager.ts";
import { MobilewrightStepExecutor } from "../src/adapters/mobilewright-step-executor.ts";
import { TestRunService } from "../src/domain/test-run.ts";

const platform = process.env.QA_MOBILE_PLATFORM;
const deviceId = process.env.QA_MOBILE_DEVICE_ID;
const bundleId = process.env.QA_MOBILE_BUNDLE_ID ?? "com.popark05.qafixture";

if (platform !== "android" && platform !== "ios") {
  throw new Error("QA_MOBILE_PLATFORM must be android or ios");
}
if (!deviceId) throw new Error("QA_MOBILE_DEVICE_ID is required");

const watchdog = setTimeout(() => {
  console.error("QA Platform Mobilewright E2E exceeded the 180 second watchdog");
  process.exit(124);
}, 180_000);

const sessions = new MobilewrightSessionManager(bundleId);
const service = new TestRunService(new MobilewrightStepExecutor(sessions));
const action = (value) => JSON.stringify(value);
const testCase = {
  testCaseId: "native-mobilewright-e2e",
  tenantId: "00000000-0000-4000-8000-000000000001",
  version: 1,
  title: platform + " native Mobilewright adapter smoke",
  source: "manual",
  status: "approved",
  steps: [
    {
      stepId: "continue",
      instruction: "Tap the native Continue button",
      action: action({ type: "click", locator: { by: "role", value: "button", name: "Continue" } })
    },
    {
      stepId: "wait-welcome",
      instruction: "Wait for the native Welcome state",
      action: action({ type: "wait_for", locator: { by: "role", value: "button", name: "Welcome" }, state: "visible" })
    },
    {
      stepId: "assert-welcome",
      instruction: "Assert the native Welcome label",
      action: action({ type: "assert_text", locator: { by: "role", value: "button", name: "Welcome" }, expected: "Welcome" })
    },
    {
      stepId: "fill-email",
      instruction: "Fill the native Email field",
      action: action({ type: "fill", locator: { by: "label", value: "Email" }, value: "qa@example.test" })
    }
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

try {
  console.log("Executing QA Platform TestRunService through Mobilewright on", platform, deviceId);
  const run = await service.execute(testCase, { platform, targetId: deviceId });
  for (const step of run.stepResults) {
    console.log(step.status.toUpperCase(), step.stepId, step.message);
  }
  assert.equal(run.status, "passed", "QA Platform native Mobilewright Test Run must pass");
  assert.equal(run.stepResults.length, testCase.steps.length, "all native adapter steps must execute");
  console.log(platform + " QA Platform Mobilewright native E2E passed");
} finally {
  await sessions.close();
  clearTimeout(watchdog);
}
