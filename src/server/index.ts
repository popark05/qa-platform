import { ManagedPlaywrightStepExecutor } from "../adapters/managed-playwright-step-executor.js";
import { MobilewrightSessionManager } from "../adapters/mobilewright-session-manager.js";
import { MobilewrightStepExecutor } from "../adapters/mobilewright-step-executor.js";
import { PlaywrightSessionManager, type PlaywrightBrowserName } from "../adapters/playwright-session-manager.js";
import { ReverseScreenEvidenceClient } from "../adapters/reverse-screen-evidence-client.js";
import { TestRunService } from "../domain/test-run.js";
import { PostgresTestRunRepository } from "../infrastructure/postgres-test-run-repository.js";
import { Pool } from "pg";
import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";
const adapter = process.env.QA_EXECUTION_ADAPTER ?? "mock";
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : undefined;
const runRepository = pool ? new PostgresTestRunRepository(pool) : undefined;
const createRunService = (executor?: ConstructorParameters<typeof TestRunService>[0]) =>
  new TestRunService(executor, runRepository);
const evidenceResolver = process.env.REVERSE_SCREEN_BASE_URL
  ? new ReverseScreenEvidenceClient(process.env.REVERSE_SCREEN_BASE_URL)
  : undefined;
const evidenceOptions = evidenceResolver ? { evidenceResolver } : {};
const closeResources = async (closeAdapter?: () => Promise<void>) => {
  try { await closeAdapter?.(); }
  finally { await pool?.end(); }
};

let app;
if (adapter === "playwright") {
  const browserName = (process.env.PLAYWRIGHT_BROWSER ?? "chromium") as PlaywrightBrowserName;
  if (!["chromium", "firefox", "webkit"].includes(browserName)) {
    throw new Error("PLAYWRIGHT_BROWSER must be chromium, firefox or webkit");
  }
  const sessions = new PlaywrightSessionManager(browserName);
  app = buildApp({
    runs: createRunService(new ManagedPlaywrightStepExecutor(sessions)),
    ...evidenceOptions,
    onClose: () => closeResources(() => sessions.close())
  });
} else if (adapter === "mobilewright") {
  const bundleId = process.env.MOBILE_APP_BUNDLE_ID;
  if (!bundleId) throw new Error("MOBILE_APP_BUNDLE_ID is required when QA_EXECUTION_ADAPTER=mobilewright");
  const sessions = new MobilewrightSessionManager(bundleId);
  app = buildApp({
    runs: createRunService(new MobilewrightStepExecutor(sessions)),
    ...evidenceOptions,
    onClose: () => closeResources(() => sessions.close())
  });
} else if (adapter === "mock") {
  app = buildApp({ runs: createRunService(), ...evidenceOptions, onClose: () => closeResources() });
} else {
  await pool?.end();
  throw new Error("QA_EXECUTION_ADAPTER must be mock, playwright or mobilewright");
}

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await app.close();
}
