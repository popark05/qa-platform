import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { newDb } from "pg-mem";
import { PostgresTestCaseRepository } from "../src/infrastructure/postgres-test-case-repository.js";
import { PostgresTestRunRepository } from "../src/infrastructure/postgres-test-run-repository.js";
import type { Pool } from "pg";

const runMigration = await readFile(new URL("../db/migrations/001_test_run.sql", import.meta.url), "utf8");
const caseMigration = await readFile(new URL("../db/migrations/002_test_case_review.sql", import.meta.url), "utf8");

async function setup() {
  const database = newDb();
  database.public.none(runMigration);
  database.public.none(caseMigration);
  const adapter = database.adapters.createPg();
  const pool = new adapter.Pool() as unknown as Pool;
  return { pool, cases: new PostgresTestCaseRepository(pool), runs: new PostgresTestRunRepository(pool) };
}

test("PostgreSQL repository preserves immutable versions and version-bound review history", async () => {
  const { pool, cases } = await setup();
  const created = await cases.create({
    title: "Account login", source: "manual",
    steps: [{ stepId: "s1", instruction: "Open login" }]
  });
  assert.equal(created.version, 1);
  assert.equal(created.status, "draft");

  const submitted = await cases.submitForReview(created.testCaseId, 1);
  assert.equal(submitted?.status, "pending_review");
  assert.equal(await cases.submitForReview(created.testCaseId, 1), undefined);

  const review = await cases.review(created.testCaseId, "reviewer-1", "approved", "Looks good", 1);
  assert.equal(review?.version, 1);
  assert.equal(review?.decision, "approved");

  const next = await cases.createVersion(created.testCaseId, {
    expectedVersion: 1, title: "Account login - revised",
    steps: [{ stepId: "s1", instruction: "Open login" }, { stepId: "s2", instruction: "Enter credentials" }]
  });
  assert.equal(next?.version, 2);
  assert.equal(next?.status, "draft");
  assert.equal(next?.steps.length, 2);

  const history = await cases.listReviews(created.testCaseId);
  assert.equal(history.length, 1);
  assert.equal(history[0]?.version, 1);
  const rows = await pool.query("SELECT version, title, steps FROM qa_test_case_version WHERE test_case_id = $1 ORDER BY version", [created.testCaseId]);
  assert.equal(rows.rows.length, 2);
  assert.equal(rows.rows[0]?.title, "Account login");
  assert.equal(rows.rows[1]?.title, "Account login - revised");

  const staleVersion = await cases.createVersion(created.testCaseId, {
    expectedVersion: 1, title: "Stale edit", steps: [{ stepId: "s1", instruction: "Stale" }]
  });
  assert.equal(staleVersion, undefined);
  await pool.end();
});

test("AI-authored case enters review queue and execution records the exact approved version", async () => {
  const { pool, cases, runs } = await setup();
  const created = await cases.create({
    title: "AI checkout", source: "ai", steps: [{ stepId: "pay", instruction: "Submit payment" }]
  });
  assert.equal(created.status, "pending_review");
  const submissions = await pool.query("SELECT version FROM qa_test_case_submission WHERE test_case_id = $1", [created.testCaseId]);
  assert.equal(submissions.rows.length, 1);
  assert.equal(submissions.rows[0]?.version, 1);

  await cases.review(created.testCaseId, "human-reviewer", "approved", undefined, 1);
  const approved = await cases.get(created.testCaseId);
  assert.equal(approved?.status, "approved");
  const now = new Date().toISOString();
  await runs.create({
    runId: "d0d0d0d0-1111-4111-8111-d0d0d0d0d0d0",
    testCaseId: created.testCaseId, testCaseVersion: approved!.version,
    target: { platform: "web", targetId: "chromium" }, startedAt: now
  });
  const persisted = await pool.query("SELECT test_case_version FROM qa_test_run WHERE test_case_id = $1", [created.testCaseId]);
  assert.equal(persisted.rows[0]?.test_case_version, 1);
  await pool.end();
});

test("review and submission use optimistic version checks", async () => {
  const { pool, cases } = await setup();
  const created = await cases.create({
    title: "Profile update", source: "manual", steps: [{ stepId: "s1", instruction: "Open profile" }]
  });
  assert.equal(await cases.submitForReview(created.testCaseId, 9), undefined);
  assert.ok(await cases.submitForReview(created.testCaseId, 1));
  assert.equal(await cases.review(created.testCaseId, "reviewer", "approved", undefined, 2), undefined);
  assert.ok(await cases.review(created.testCaseId, "reviewer", "rejected", "Needs work", 1));
  assert.equal(await cases.review(created.testCaseId, "reviewer-2", "approved", undefined, 1), undefined);
  await pool.end();
});
