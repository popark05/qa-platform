import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { PostgresTestCaseRepository } from "../src/infrastructure/postgres-test-case-repository.js";
import { PostgresTestRunRepository } from "../src/infrastructure/postgres-test-run-repository.js";

const connectionString = process.env.PG_INTEGRATION_URL;

test("real PostgreSQL persists immutable versions, review decisions and exact Test Run provenance", {
  skip: !connectionString
}, async () => {
  const pool = new Pool({ connectionString });
  try {
    const cases = new PostgresTestCaseRepository(pool);
    const runs = new PostgresTestRunRepository(pool);
    const created = await cases.create({
      title: "PostgreSQL integration checkout",
      source: "manual",
      steps: [{ stepId: "checkout-open", instruction: "Open checkout" }]
    });

    assert.equal(created.version, 1);
    assert.equal((await cases.submitForReview(created.testCaseId, 1))?.status, "pending_review");
    const review = await cases.review(created.testCaseId, "integration-reviewer", "approved", "Approved in PostgreSQL", 1);
    assert.equal(review?.version, 1);

    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    await runs.create({
      runId, testCaseId: created.testCaseId, testCaseVersion: 1,
      target: { platform: "web", targetId: "postgres-ci-chromium" }, startedAt
    });
    await runs.appendStepResult(runId, {
      stepId: "checkout-open", status: "passed", message: "Checkout screen opened", durationMs: 27
    }, 0);
    const completed = await runs.complete(runId, "passed", new Date().toISOString());
    assert.equal(completed.status, "passed");
    assert.equal(completed.testCaseVersion, 1);
    assert.equal(completed.stepResults[0]?.stepId, "checkout-open");

    const next = await cases.createVersion(created.testCaseId, {
      expectedVersion: 1, title: "PostgreSQL integration checkout revised",
      steps: [
        { stepId: "checkout-open", instruction: "Open checkout" },
        { stepId: "checkout-pay", instruction: "Submit payment" }
      ]
    });
    assert.equal(next?.version, 2);
    const historical = await pool.query(
      "SELECT title FROM qa_test_case_version WHERE test_case_id = $1 AND version = 1",
      [created.testCaseId]
    );
    assert.equal(historical.rows[0]?.title, "PostgreSQL integration checkout");
    await assert.rejects(
      pool.query("UPDATE qa_test_case_version SET title = 'tampered' WHERE test_case_id = $1 AND version = 1", [created.testCaseId]),
      /qa_test_case_version_is_immutable/
    );
    await assert.rejects(
      pool.query("DELETE FROM qa_test_case_version WHERE test_case_id = $1 AND version = 1", [created.testCaseId]),
      /qa_test_case_version_is_immutable/
    );
    assert.equal((await runs.get(runId))?.testCaseVersion, 1);

    const staleRunId = randomUUID();
    await runs.create({
      runId: staleRunId, testCaseId: created.testCaseId, testCaseVersion: 2,
      target: { platform: "web", targetId: "stale-worker" }, startedAt
    });
    await pool.query("UPDATE qa_test_run SET last_heartbeat_at = now() - interval '10 minutes' WHERE run_id = $1", [staleRunId]);
    const activeRunId = randomUUID();
    await runs.create({
      runId: activeRunId, testCaseId: created.testCaseId, testCaseVersion: 2,
      target: { platform: "web", targetId: "active-worker" }, startedAt
    });
    await runs.heartbeat(activeRunId, new Date().toISOString());
    const abandoned = await runs.recoverStaleRuns(
      new Date(Date.now() - 60_000).toISOString(), new Date().toISOString()
    );
    assert.deepEqual(abandoned, [staleRunId]);
    assert.equal((await runs.get(staleRunId))?.status, "abandoned");
    assert.equal((await runs.get(activeRunId))?.status, "running");

    const concurrent = await cases.create({
      title: "Concurrent review integration case",
      source: "manual",
      steps: [{ stepId: "s1", instruction: "Open settings" }]
    });
    await cases.submitForReview(concurrent.testCaseId, 1);
    const decisions = await Promise.all([
      cases.review(concurrent.testCaseId, "reviewer-a", "approved", undefined, 1),
      cases.review(concurrent.testCaseId, "reviewer-b", "rejected", undefined, 1)
    ]);
    assert.equal(decisions.filter(Boolean).length, 1);
    assert.equal((await cases.listReviews(concurrent.testCaseId)).length, 1);
  } finally {
    await pool.end();
  }
});
