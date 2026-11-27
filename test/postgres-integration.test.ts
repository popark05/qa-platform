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
    assert.equal((await runs.get(runId))?.testCaseVersion, 1);

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
