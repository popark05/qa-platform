import { ManagedPlaywrightStepExecutor } from "../adapters/managed-playwright-step-executor.js";
import { PlaywrightSessionManager, type PlaywrightBrowserName } from "../adapters/playwright-session-manager.js";
import { TestRunService } from "../domain/test-run.js";
import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";
const adapter = process.env.QA_EXECUTION_ADAPTER ?? "mock";

let app;
if (adapter === "playwright") {
  const browserName = (process.env.PLAYWRIGHT_BROWSER ?? "chromium") as PlaywrightBrowserName;
  if (!["chromium", "firefox", "webkit"].includes(browserName)) {
    throw new Error("PLAYWRIGHT_BROWSER must be chromium, firefox or webkit");
  }
  const sessions = new PlaywrightSessionManager(browserName);
  app = buildApp({
    runs: new TestRunService(new ManagedPlaywrightStepExecutor(sessions)),
    onClose: () => sessions.close()
  });
} else if (adapter === "mock") {
  app = buildApp();
} else {
  throw new Error("QA_EXECUTION_ADAPTER must be mock or playwright");
}

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await app.close();
}
