import assert from "node:assert/strict";
import { android, ios } from "mobilewright";

const platform = process.env.QA_MOBILE_PLATFORM;
const deviceId = process.env.QA_MOBILE_DEVICE_ID;
const bundleId = process.env.QA_MOBILE_BUNDLE_ID ?? "com.popark05.qafixture";

if (platform !== "android" && platform !== "ios") {
  throw new Error("QA_MOBILE_PLATFORM must be android or ios");
}
if (!deviceId) throw new Error("QA_MOBILE_DEVICE_ID is required");

const launcher = platform === "android" ? android : ios;
const device = await launcher.launch({ deviceId, bundleId });

try {
  const email = device.screen.getByLabel("Email");
  await email.waitFor({ state: "visible", timeout: 15_000 });
  await email.fill("qa@example.test");

  const continueButton = device.screen.getByRole("button", { name: "Continue" });
  await continueButton.waitFor({ state: "visible", timeout: 10_000 });
  await continueButton.tap();

  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const tree = await device.screen.viewTree();
  process.stdout.write("ACCESSIBILITY_TREE_AFTER_CONTINUE " + JSON.stringify(tree) + "\n");

  const welcome = device.screen.getByText("Welcome");
  await welcome.waitFor({ state: "visible", timeout: 10_000 });
  assert.match(await welcome.getText(), /Welcome/);
  process.stdout.write(platform + " Mobilewright native smoke test passed\n");
} finally {
  await device.close();
}
