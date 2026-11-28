import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { newDb } from "pg-mem";
import { PostgresTestCaseRepository } from "../src/infrastructure/postgres-test-case-repository.js";
import type { Pool } from "pg";

const runMigration = await readFile(new URL("../db/migrations/001_test_run.sql", import.meta.url), "utf8");
const caseMigration = await readFile(new URL("../db/migrations/002_test_case_review.sql", import.meta.url), "utf8");
const tenantMigration = await readFile(new URL("../db/migrations/005_tenant_isolation.sql", import.meta.url), "utf8");
const flowProvenanceMigration = await readFile(new URL("../db/migrations/006_test_case_flow_provenance.sql", import.meta.url), "utf8");
const tenantId = "00000000-0000-4000-8000-000000000001";
const otherTenantId = "00000000-0000-4000-8000-000000000002";

async function setup() {
  const database = newDb();
  database.public.none(runMigration);
  database.public.none(caseMigration);
  database.public.none(tenantMigration);
  database.public.none(flowProvenanceMigration);
  database.public.none("INSERT INTO qa_tenant (tenant_id, name) VALUES ('" + otherTenantId + "', 'Other tenant')");
  const adapter = database.adapters.createPg();
  const pool = new adapter.Pool() as unknown as Pool;
  return { pool, cases: new PostgresTestCaseRepository(pool) };
}

test("PostgreSQL repository preserves immutable versions and version-bound review history", async () => {
  const { pool, cases } = await setup();
  const created = await cases.create({
    tenantId, title: "Account login", source: "manual",
    steps: [{ stepId: "s1", instruction: "Open login" }]
  });
  assert.equal(created.version, 1);
  assert.equal(created.status, "draft");
  assert.equal((await cases.get(created.testCaseId, otherTenantId)), undefined);
  assert.deepEqual(await cases.list(otherTenantId), []);

  const submitted = await cases.submitForReview(created.testCaseId, tenantId, 1);
  assert.equal(submitted?.status, "pending_review");
  assert.equal(await cases.submitForReview(created.testCaseId, tenantId, 1), undefined);
  assert.equal(await cases.submitForReview(created.testCaseId, otherTenantId, 1), undefined);

  const review = await cases.review(created.testCaseId, tenantId, "reviewer-1", "approved", "Looks good", 1);
  assert.equal(review?.version, 1);
  assert.equal(review?.decision, "approved");

  const next = await cases.createVersion(created.testCaseId, tenantId, {
    expectedVersion: 1, title: "Account login - revised",
    steps: [{ stepId: "s1", instruction: "Open login" }, { stepId: "s2", instruction: "Enter credentials" }]
  });
  assert.equal(next?.version, 2);
  assert.equal(next?.status, "draft");
  assert.equal(next?.steps.length, 2);

  const history = await cases.listReviews(created.testCaseId, tenantId);
  assert.equal(history.length, 1);
  assert.equal(history[0]?.version, 1);
  assert.deepEqual(await cases.listReviews(created.testCaseId, otherTenantId), []);
  const rows = await pool.query("SELECT version, title, steps FROM qa_test_case_version WHERE test_case_id = $1 ORDER BY version", [created.testCaseId]);
  assert.equal(rows.rows.length, 2);
  assert.equal(rows.rows[0]?.title, "Account login");
  assert.equal(rows.rows[1]?.title, "Account login - revised");

  const staleVersion = await cases.createVersion(created.testCaseId, tenantId, {
    expectedVersion: 1, title: "Stale edit", steps: [{ stepId: "s1", instruction: "Stale" }]
  });
  assert.equal(staleVersion, undefined);
  await pool.end();
});

test("AI-authored case enters review queue and execution records the exact approved version", async () => {
  const { pool, cases } = await setup();
  const created = await cases.create({
    tenantId, title: "AI checkout", source: "ai", steps: [{ stepId: "pay", instruction: "Submit payment" }]
  });
  assert.equal(created.status, "pending_review");
  const submissions = await pool.query("SELECT version FROM qa_test_case_submission WHERE test_case_id = $1", [created.testCaseId]);
  assert.equal(submissions.rows.length, 1);
  assert.equal(submissions.rows[0]?.version, 1);
  await cases.review(created.testCaseId, tenantId, "human-reviewer", "approved", undefined, 1);
  const approved = await cases.get(created.testCaseId, tenantId);
  assert.equal(approved?.status, "approved");
  await pool.end();
});

test("review and submission use optimistic version checks", async () => {
  const { pool, cases } = await setup();
  const created = await cases.create({
    tenantId, title: "Profile update", source: "manual", steps: [{ stepId: "s1", instruction: "Open profile" }]
  });
  assert.equal(await cases.submitForReview(created.testCaseId, tenantId, 9), undefined);
  assert.ok(await cases.submitForReview(created.testCaseId, tenantId, 1));
  assert.equal(await cases.review(created.testCaseId, tenantId, "reviewer", "approved", undefined, 2), undefined);
  assert.ok(await cases.review(created.testCaseId, tenantId, "reviewer", "rejected", "Needs work", 1));
  assert.equal(await cases.review(created.testCaseId, tenantId, "reviewer-2", "approved", undefined, 1), undefined);
  await pool.end();
});
