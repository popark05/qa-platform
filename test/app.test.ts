import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/server/app.js";

test("AI-authored test cases require human review", async () => {
  const app = buildApp();
  const created = await app.inject({
    method: "POST",
    url: "/v1/test-cases",
    payload: {
      title: "Login succeeds",
      source: "ai",
      steps: [{ instruction: "Enter valid credentials", action: "fill" }]
    }
  });
  assert.equal(created.statusCode, 201);
  const testCase = created.json();
  assert.equal(testCase.status, "pending_review");
  assert.equal(testCase.version, 1);

  const approved = await app.inject({
    method: "POST",
    url: `/v1/test-cases/${testCase.testCaseId}/reviews`,
    payload: { reviewerId: "qa-user-1", decision: "approved" }
  });
  assert.equal(approved.statusCode, 201);

  const fetched = await app.inject({ method: "GET", url: `/v1/test-cases/${testCase.testCaseId}` });
  assert.equal(fetched.json().status, "approved");
  await app.close();
});

test("manual test cases start as drafts and cannot bypass review workflow", async () => {
  const app = buildApp();
  const created = await app.inject({
    method: "POST",
    url: "/v1/test-cases",
    payload: { title: "Manual smoke test", source: "manual", steps: [{ instruction: "Open app" }] }
  });
  assert.equal(created.statusCode, 201);
  const testCase = created.json();
  assert.equal(testCase.status, "draft");

  const review = await app.inject({
    method: "POST",
    url: `/v1/test-cases/${testCase.testCaseId}/reviews`,
    payload: { reviewerId: "qa-user-1", decision: "approved" }
  });
  assert.equal(review.statusCode, 409);
  await app.close();
});

test("invalid test case payload is rejected", async () => {
  const app = buildApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/test-cases",
    payload: { title: "", source: "ai", steps: [] }
  });
  assert.equal(response.statusCode, 400);
  await app.close();
});
