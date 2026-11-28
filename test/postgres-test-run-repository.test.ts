import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { newDb } from "pg-mem";
import { PostgresTestRunRepository } from "../src/infrastructure/postgres-test-run-repository.js";
import { TestRunService, type StepExecutor } from "../src/domain/test-run.js";
import type { TestCase } from "../src/domain/test-case.js";
import type { EvidenceReference } from "../src/domain/evidence-reference.js";
import type { Pool } from "pg";

const migration = await readFile(new URL("../db/migrations/001_test_run.sql", import.meta.url), "utf8");
const testCaseMigration = await readFile(new URL("../db/migrations/002_test_case_review.sql", import.meta.url), "utf8");
const recoveryMigration = await readFile(new URL("../db/migrations/004_test_run_recovery.sql", import.meta.url), "utf8");
const tenantMigration = await readFile(new URL("../db/migrations/005_tenant_isolation.sql", import.meta.url), "utf8");
const tenantId = "00000000-0000-4000-8000-000000000001";
const evidence: EvidenceReference = {
  contractVersion: "1.0", sourceSystem: "reverse-screen",
  evidenceId: "e0e0e0e0-1111-4111-8111-e0e0e0e0e0e0",
  kind: "screenshot", contentType: "image/png", byteSize: 4096,
  sha256: "ab".repeat(32), storageUri: "s3://reverse-screen/evidence/a/b",
  capturedAt: "2026-11-27T00:00:00.000Z"
};
const testCase: TestCase = {
  tenantId, testCaseId: "c0c0c0c0-1111-4111-8111-c0c0c0c0c0c0", version: 3,
  title: "Checkout", source: "manual", status: "approved",
  steps: [
    { stepId: "step-open", instruction: "Open checkout" },
    { stepId: "step-pay", instruction: "Submit payment" }
  ],
  createdAt: "2026-11-27T00:00:00.000Z", updatedAt: "2026-11-27T00:00:00.000Z"
};

async function setup() {
  const database = newDb();
  database.public.none(migration);
  database.public.none(testCaseMigration);
  database.public.none(recoveryMigration);
  database.public.none(tenantMigration);
  database.public.none(`INSERT INTO qa_test_case (test_case_id, tenant_id, current_version, source, status, created_at, updated_at)
    VALUES ('c0c0c0c0-1111-4111-8111-c0c0c0c0c0c0', '00000000-0000-4000-8000-000000000001', 3, 'manual', 'approved', '2026-11-27T00:00:00.000Z', '2026-11-27T00:00:00.000Z')`);
  database.public.none(`INSERT INTO qa_test_case_version (test_case_id, version, title, source, steps, created_at)
    VALUES ('c0c0c0c0-1111-4111-8111-c0c0c0c0c0c0', 3, 'Checkout', 'manual',
      '[{"stepId":"step-open","instruction":"Open checkout"},{"stepId":"step-pay","instruction":"Submit payment"}]'::jsonb,
      '2026-11-27T00:00:00.000Z')`);
  const adapter = database.adapters.createPg();
  const pool = new adapter.Pool() as unknown as Pool;
  return { pool, repository: new PostgresTestRunRepository(pool) };
}

test("PostgreSQL repository persists tenant-bound runs, ordered steps and deduplicated evidence", async () => {
  const { pool, repository } = await setup();
  const executor: StepExecutor = {
    async execute(step, index) {
      return { stepId: step.stepId, status: "passed", message: `completed ${step.instruction}`, durationMs: index + 10 };
    }
  };
  const service = new TestRunService(executor, repository);
  const run = await service.execute(testCase, { platform: "web", targetId: "chromium" });
  assert.equal(run.status, "passed");
  assert.equal(run.stepResults.length, 2);
  assert.ok(run.finishedAt);
  assert.equal(await service.get(run.runId, "00000000-0000-4000-8000-000000000002"), undefined);

  const attached = await service.attachEvidence(run.runId, "step-pay", tenantId, evidence);
  assert.equal(attached?.stepResults[1]?.evidenceRefs?.length, 1);
  await service.attachEvidence(run.runId, "step-pay", tenantId, evidence);
  const reloaded = await service.get(run.runId, tenantId);
  assert.equal(reloaded?.testCaseVersion, 3);
  assert.deepEqual(reloaded?.stepResults.map((step) => step.stepId), ["step-open", "step-pay"]);
  assert.deepEqual(reloaded?.stepResults[1]?.evidenceRefs, [evidence]);

  const counts = await pool.query("SELECT (SELECT count(*) FROM qa_test_run)::int AS runs, (SELECT count(*) FROM qa_step_result)::int AS steps, (SELECT count(*) FROM qa_step_evidence_reference)::int AS evidence");
  assert.equal(Number(counts.rows[0]?.runs), 1);
  assert.equal(Number(counts.rows[0]?.steps), 2);
  assert.equal(Number(counts.rows[0]?.evidence), 1);
  await pool.end();
});

test("running state is durable before execution completes and executor errors become failed step results", async () => {
  const { pool, repository } = await setup();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const executor: StepExecutor = {
    async execute() { entered(); await gate; throw new Error("browser target disconnected"); }
  };
  const service = new TestRunService(executor, repository);
  const executing = service.execute({ ...testCase, steps: [testCase.steps[0]!] }, { platform: "web", targetId: "chromium" });
  await started;
  const running = await pool.query("SELECT status FROM qa_test_run");
  assert.equal(running.rows[0]?.status, "running");
  release();
  const completed = await executing;
  assert.equal(completed.status, "failed");
  assert.equal(completed.stepResults[0]?.status, "failed");
  assert.match(completed.stepResults[0]?.message ?? "", /disconnected/);
  await pool.end();
});
