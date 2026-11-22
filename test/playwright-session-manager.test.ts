import assert from "node:assert/strict";
import test from "node:test";
import type { Browser, BrowserContext, Page } from "playwright";
import { PlaywrightSessionManager, type BrowserLauncher } from "../src/adapters/playwright-session-manager.js";

function createLauncher() {
  const calls: string[] = [];
  const page = {} as Page;
  const context = {
    newPage: async () => { calls.push("newPage"); return page; },
    close: async () => { calls.push("closeContext"); }
  } as unknown as BrowserContext;
  const browser = {
    newContext: async () => { calls.push("newContext"); return context; },
    close: async () => { calls.push("closeBrowser"); }
  } as unknown as Browser;
  const launcher: BrowserLauncher = { launch: async (name) => { calls.push(`launch:${name}`); return browser; } };
  return { launcher, calls, page };
}

test("Playwright sessions are isolated by run and reuse one browser process", async () => {
  const stub = createLauncher();
  const manager = new PlaywrightSessionManager("chromium", stub.launcher);
  const target = { platform: "web", targetId: "browser-local" };
  const first = await manager.getPage("run-1", target);
  const sameRun = await manager.getPage("run-1", target);
  const second = await manager.getPage("run-2", target);
  assert.equal(first, stub.page);
  assert.equal(sameRun, first);
  assert.equal(second, stub.page);
  assert.deepEqual(stub.calls, ["launch:chromium", "newContext", "newPage", "newContext", "newPage"]);
  await manager.closeRun("run-1");
  assert.equal(stub.calls.at(-1), "closeContext");
  await manager.close();
  assert.equal(stub.calls.at(-1), "closeBrowser");
});

test("Playwright session manager rejects native mobile targets", async () => {
  const stub = createLauncher();
  const manager = new PlaywrightSessionManager("chromium", stub.launcher);
  await assert.rejects(() => manager.getPage("run-mobile", { platform: "android", targetId: "pixel" }), /unsupported/);
  assert.deepEqual(stub.calls, []);
});

test("Playwright session manager cleans up a failed browser context creation", async () => {
  const calls: string[] = [];
  const browser = {
    newContext: async () => { calls.push("newContext"); throw new Error("context failed"); },
    close: async () => { calls.push("closeBrowser"); }
  } as unknown as Browser;
  const manager = new PlaywrightSessionManager("chromium", { launch: async () => browser });
  await assert.rejects(() => manager.getPage("run-1", { platform: "web", targetId: "chromium" }), /context failed/);
  await manager.close();
  assert.deepEqual(calls, ["newContext", "closeBrowser"]);
});
