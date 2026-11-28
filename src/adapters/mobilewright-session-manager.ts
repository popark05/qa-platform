import { android, ios } from "mobilewright";

export interface MobilewrightLocator {
  tap(): Promise<void>;
  fill(value: string): Promise<void>;
  isVisible(): Promise<boolean>;
  getText(): Promise<string>;
  waitFor(options: { state: "visible" | "hidden" | "enabled" | "disabled"; timeout?: number }): Promise<void>;
}

export interface MobilewrightScreen {
  getByRole(role: string, options?: { name?: string; exact?: boolean }): MobilewrightLocator;
  getByText(text: string, options?: { exact?: boolean }): MobilewrightLocator;
  getByTestId(testId: string): MobilewrightLocator;
  getByLabel(label: string): MobilewrightLocator;
  swipe(direction: "up" | "down" | "left" | "right", options?: { distance?: number; duration?: number }): Promise<void>;
  /** Platform back navigation (Android back button / iOS back gesture). */
  goBack?(): Promise<void>;
}

export interface MobilewrightDevice {
  screen: MobilewrightScreen;
  goto(url: string): Promise<void>;
  close(): Promise<void>;
}

export interface MobilewrightLaunchOptions {
  deviceId: string;
  bundleId: string;
}

export interface MobilewrightLauncher {
  launch(options: MobilewrightLaunchOptions): Promise<MobilewrightDevice>;
}

export interface MobilewrightFactory {
  ios: MobilewrightLauncher;
  android: MobilewrightLauncher;
}

const defaultFactory = {
  ios: ios as unknown as MobilewrightLauncher,
  android: android as unknown as MobilewrightLauncher
} satisfies MobilewrightFactory;

export interface MobilewrightDeviceProvider {
  getDevice(runId: string, target: { platform: string; targetId: string }): Promise<MobilewrightDevice>;
  closeRun(runId: string): Promise<void>;
  close(): Promise<void>;
}

export class MobilewrightSessionManager implements MobilewrightDeviceProvider {
  private readonly sessions = new Map<string, Promise<MobilewrightDevice>>();

  constructor(
    private readonly bundleId: string,
    private readonly factory: MobilewrightFactory = defaultFactory
  ) {
    if (!bundleId.trim()) throw new Error("MOBILE_APP_BUNDLE_ID is required");
  }

  async getDevice(runId: string, target: { platform: string; targetId: string }): Promise<MobilewrightDevice> {
    if (target.platform !== "ios" && target.platform !== "android") {
      throw new Error(`mobilewright_target_platform_unsupported:${target.platform}`);
    }
    if (!target.targetId.trim()) throw new Error("mobilewright_target_id_required");

    const existing = this.sessions.get(runId);
    if (existing) return existing;

    const launcher = target.platform === "ios" ? this.factory.ios : this.factory.android;
    const launching = launcher.launch({ deviceId: target.targetId, bundleId: this.bundleId });
    this.sessions.set(runId, launching);
    try {
      return await launching;
    } catch (error) {
      if (this.sessions.get(runId) === launching) this.sessions.delete(runId);
      throw error;
    }
  }

  async closeRun(runId: string): Promise<void> {
    const session = this.sessions.get(runId);
    if (!session) return;
    this.sessions.delete(runId);
    const device = await session;
    await device.close();
  }

  async close(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    const devices = await Promise.allSettled(sessions);
    await Promise.allSettled(devices.flatMap((result) => result.status === "fulfilled" ? [result.value.close()] : []));
  }
}
