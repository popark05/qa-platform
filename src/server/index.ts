import { ManagedPlaywrightStepExecutor } from "../adapters/managed-playwright-step-executor.js";
import { MobilewrightSessionManager } from "../adapters/mobilewright-session-manager.js";
import { MobilewrightStepExecutor } from "../adapters/mobilewright-step-executor.js";
import { PlaywrightSessionManager, type PlaywrightBrowserName } from "../adapters/playwright-session-manager.js";
import { ReverseScreenEvidenceClient } from "../adapters/reverse-screen-evidence-client.js";
import { TestRunService } from "../domain/test-run.js";
import { PostgresTestRunRepository } from "../infrastructure/postgres-test-run-repository.js";
import { PostgresTestCaseRepository } from "../infrastructure/postgres-test-case-repository.js";
import { InMemoryTestCaseRepository } from "../domain/test-case.js";
import { Pool } from "pg";
import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";
const adapter = process.env.QA_EXECUTION_ADAPTER ?? "mock";
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : undefined;
const runRepository = pool ? new PostgresTestRunRepository(pool) : undefined;
const staleAfterSeconds = Number(process.env.QA_RUN_STALE_AFTER_SECONDS ?? 120);
const recoveryIntervalMs = Number(process.env.QA_RUN_RECOVERY_INTERVAL_MS ?? 30_000);
if (!Number.isFinite(staleAfterSeconds) || staleAfterSeconds < 30) throw new Error("QA_RUN_STALE_AFTER_SECONDS must be at least 30");
if (!Number.isFinite(recoveryIntervalMs) || recoveryIntervalMs < 5_000) throw new Error("QA_RUN_RECOVERY_INTERVAL_MS must be at least 5000");
let recoveryTimer: ReturnType<typeof setInterval> | undefined;
const testCaseRepository = pool ? new PostgresTestCaseRepository(pool) : new InMemoryTestCaseRepository();
const createRunService = (executor?: ConstructorParameters<typeof TestRunService>[0]) =>
  new TestRunService(executor, runRepository);
const evidenceResolver = process.env.REVERSE_SCREEN_BASE_URL
  ? new ReverseScreenEvidenceClient(process.env.REVERSE_SCREEN_BASE_URL)
  : undefined;
const evidenceOptions = evidenceResolver ? { evidenceResolver } : {};
const closeResources = async (closeAdapter?: () => Promise<void>) => {
  if (recoveryTimer) clearInterval(recoveryTimer);
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
    testCases: testCaseRepository, runs: createRunService(new ManagedPlaywrightStepExecutor(sessions)),
    ...evidenceOptions, onClose: () => closeResources(() => sessions.close())
  });
} else if (adapter === "mobilewright") {
  const bundleId = process.env.MOBILE_APP_BUNDLE_ID;
  if (!bundleId) throw new Error("MOBILE_APP_BUNDLE_ID is required when QA_EXECUTION_ADAPTER=mobilewright");
  const sessions = new MobilewrightSessionManager(bundleId);
  app = buildApp({
    testCases: testCaseRepository, runs: createRunService(new MobilewrightStepExecutor(sessions)),
    ...evidenceOptions, onClose: () => closeResources(() => sessions.close())
  });
} else if (adapter === "mock") {
  app = buildApp({ testCases: testCaseRepository, runs: createRunService(), ...evidenceOptions, onClose: () => closeResources() });
} else {
  await pool?.end();
  throw new Error("QA_EXECUTION_ADAPTER must be mock, playwright or mobilewright");
}

try {
  await app.listen({ port, host });
  if (runRepository) {
    const recoverStaleRuns = async () => {
      const now = Date.now();
      const staleBefore = new Date(now - staleAfterSeconds * 1000).toISOString();
      const abandoned = await runRepository.recoverStaleRuns(staleBefore, new Date(now).toISOString());
      if (abandoned.length > 0) app.log.warn({ runIds: abandoned }, "Marked stale Test Runs as abandoned");
    };
    await recoverStaleRuns();
    recoveryTimer = setInterval(() => {
      void recoverStaleRuns().catch((error) => app.log.error(error, "Test Run recovery failed"));
    }, recoveryIntervalMs);
    recoveryTimer.unref?.();
  }
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await app.close();
}
