import assert from "node:assert/strict";
import test from "node:test";
import { MobilewrightSessionManager, type MobilewrightDevice, type MobilewrightFactory, type MobilewrightLaunchOptions } from "../src/adapters/mobilewright-session-manager.js";

function fakeDevice(): MobilewrightDevice {
  const locator = { tap: async () => {}, fill: async () => {}, isVisible: async () => true, getText: async () => "", waitFor: async () => {} };
  const screen = {
    getByRole: () => locator, getByText: () => locator, getByTestId: () => locator,
    getByLabel: () => locator, swipe: async () => {}
  };
  return { screen, goto: async () => {}, close: async () => {} };
}

test("selects the platform launcher and reuses one device per run", async () => {
  const calls: Array<{ platform: string; options: MobilewrightLaunchOptions }> = [];
  const device = fakeDevice();
  const launcher = (platform: string) => ({
    launch: async (options: MobilewrightLaunchOptions) => { calls.push({ platform, options }); return device; }
  });
  const factory: MobilewrightFactory = { ios: launcher("ios"), android: launcher("android") };
  const manager = new MobilewrightSessionManager("com.example.app", factory);
  const first = await manager.getDevice("run-1", { platform: "ios", targetId: "ios-udid" });
  const second = await manager.getDevice("run-1", { platform: "ios", targetId: "ignored-on-reuse" });
  assert.equal(first, second);
  assert.deepEqual(calls, [{ platform: "ios", options: { deviceId: "ios-udid", bundleId: "com.example.app" } }]);
  await manager.closeRun("run-1");
});

test("rejects web and hybrid targets with an explicit platform error", async () => {
  const manager = new MobilewrightSessionManager("com.example.app", {
    ios: { launch: async () => fakeDevice() },
    android: { launch: async () => fakeDevice() }
  });
  await assert.rejects(() => manager.getDevice("run-1", { platform: "web", targetId: "browser" }), /mobilewright_target_platform_unsupported:web/);
  await assert.rejects(() => manager.getDevice("run-2", { platform: "hybrid", targetId: "device" }), /mobilewright_target_platform_unsupported:hybrid/);
});

test("requires an application bundle identifier", () => {
  assert.throws(() => new MobilewrightSessionManager("  "), /MOBILE_APP_BUNDLE_ID is required/);
});
