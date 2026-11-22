import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from "playwright";

export type PlaywrightBrowserName = "chromium" | "firefox" | "webkit";

export interface BrowserLauncher {
  launch(name: PlaywrightBrowserName): Promise<Browser>;
}

const defaultLauncher: BrowserLauncher = {
  launch: (name) => ({ chromium, firefox, webkit })[name].launch({ headless: true })
};

interface RunSession {
  browserName: PlaywrightBrowserName;
  context: BrowserContext;
  page: Page;
}

export interface PlaywrightPageProvider {
  getPage(runId: string, target: { platform: string; targetId: string }): Promise<Page>;
  closeRun(runId: string): Promise<void>;
  close(): Promise<void>;
}

export class PlaywrightSessionManager implements PlaywrightPageProvider {
  private readonly browsers = new Map<PlaywrightBrowserName, Promise<Browser>>();
  private readonly sessions = new Map<string, RunSession>();

  constructor(
    private readonly browserName: PlaywrightBrowserName = "chromium",
    private readonly launcher: BrowserLauncher = defaultLauncher
  ) {}

  async getPage(runId: string, target: { platform: string; targetId: string }): Promise<Page> {
    if (target.platform !== "web" && target.platform !== "hybrid") {
      throw new Error(`playwright_target_platform_unsupported:${target.platform}`);
    }
    const existing = this.sessions.get(runId);
    if (existing) return existing.page;

    const browser = await this.getBrowser(this.browserName);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      this.sessions.set(runId, { browserName: this.browserName, context, page });
      return page;
    } catch (error) {
      await context.close();
      throw error;
    }
  }

  async closeRun(runId: string): Promise<void> {
    const session = this.sessions.get(runId);
    if (!session) return;
    this.sessions.delete(runId);
    await session.context.close();
  }

  async close(): Promise<void> {
    const contexts = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(contexts.map((session) => session.context.close()));
    const browsers = await Promise.allSettled([...this.browsers.values()]);
    this.browsers.clear();
    await Promise.allSettled(browsers.flatMap((result) => result.status === "fulfilled" ? [result.value.close()] : []));
  }

  private getBrowser(name: PlaywrightBrowserName): Promise<Browser> {
    const existing = this.browsers.get(name);
    if (existing) return existing;
    const launched = this.launcher.launch(name);
    this.browsers.set(name, launched);
    launched.catch(() => {
      if (this.browsers.get(name) === launched) this.browsers.delete(name);
    });
    return launched;
  }
}
