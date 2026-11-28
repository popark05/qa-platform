import assert from "node:assert/strict";
import { android, ios } from "mobilewright";

const platform = process.env.QA_MOBILE_PLATFORM;
const deviceId = process.env.QA_MOBILE_DEVICE_ID;
const bundleId = process.env.QA_MOBILE_BUNDLE_ID ?? "com.popark05.qafixture";

if (platform !== "android" && platform !== "ios") {
  throw new Error("QA_MOBILE_PLATFORM must be android or ios");
}
if (!deviceId) throw new Error("QA_MOBILE_DEVICE_ID is required");

const watchdog = setTimeout(() => {
  console.error("Mobilewright smoke test exceeded the 180 second watchdog");
  process.exit(124);
}, 180_000);
const launcher = platform === "android" ? android : ios;
console.log("Connecting Mobilewright to", platform, deviceId);
const device = await launcher.launch({ deviceId, bundleId });

try {
  const continueButton = device.screen.getByRole("button", { name: "Continue" });
  await continueButton.waitFor({ state: "visible", timeout: 10_000 });
  console.log("Continue button is visible; tapping");
  await continueButton.tap();

  const completedButton = device.screen.getByRole("button", { name: "Welcome" });
  await completedButton.waitFor({ state: "visible", timeout: 10_000 });
  assert.match(await completedButton.getText(), /Welcome/);
  console.log("Native action state changed to Welcome");

  const email = device.screen.getByLabel("Email");
  await email.waitFor({ state: "visible", timeout: 10_000 });
  await email.fill("qa@example.test");
  console.log(platform + " Mobilewright native smoke test passed");
} finally {
  await device.close();
  clearTimeout(watchdog);
}
