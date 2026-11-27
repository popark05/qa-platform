import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/server/app.js";

test("manual test case can be submitted, approved and executed", async () => {
  const app = buildApp();
  const created = await app.inject({ method: "POST", url: "/v1/test-cases", payload: {
    title: "Login flow", source: "manual", steps: [{ instruction: "Open login screen" }, { instruction: "Enter credentials" }]
  }});
  const id = created.json().testCaseId;
  assert.equal(created.json().status, "draft");
  assert.equal(created.json().version, 1);

  const prematureRun = await app.inject({ method: "POST", url: `/v1/test-cases/${id}/runs`, payload: { platform: "web", targetId: "chromium" } });
  assert.equal(prematureRun.statusCode, 409);

  const submitted = await app.inject({ method: "POST", url: `/v1/test-cases/${id}/submissions`, payload: { expectedVersion: 1 } });
  assert.equal(submitted.json().status, "pending_review");

  const reviewed = await app.inject({ method: "POST", url: `/v1/test-cases/${id}/reviews`, payload: { reviewerId: "reviewer-1", decision: "approved", expectedVersion: 1 } });
  assert.equal(reviewed.statusCode, 201);
  assert.equal(reviewed.json().version, 1);

  const run = await app.inject({ method: "POST", url: `/v1/test-cases/${id}/runs`, payload: { platform: "web", targetId: "chromium" } });
  assert.equal(run.statusCode, 201);
  assert.equal(run.json().status, "passed");
  assert.equal(run.json().testCaseVersion, 1);
  assert.equal(run.json().stepResults.length, 2);

  const nextVersion = await app.inject({ method: "POST", url: `/v1/test-cases/${id}/versions`, payload: {
    expectedVersion: 1, title: "Login flow v2", steps: [{ instruction: "Open login screen" }, { instruction: "Enter credentials", expectedResult: "Dashboard appears" }]
  }});
  assert.equal(nextVersion.statusCode, 201);
  assert.equal(nextVersion.json().version, 2);
  assert.equal(nextVersion.json().status, "draft");
  assert.equal(nextVersion.json().title, "Login flow v2");

  const oldRun = await app.inject({ method: "GET", url: `/v1/test-runs/${run.json().runId}` });
  assert.equal(oldRun.json().testCaseVersion, 1);
  const runUnreviewedVersion = await app.inject({ method: "POST", url: `/v1/test-cases/${id}/runs`, payload: { platform: "web", targetId: "chromium" } });
  assert.equal(runUnreviewedVersion.statusCode, 409);
  await app.close();
});

test("AI authored tests enter review queue immediately", async () => {
  const app = buildApp();
  const created = await app.inject({ method: "POST", url: "/v1/test-cases", payload: {
    title: "AI draft", source: "ai", steps: [{ instruction: "Tap continue" }]
  }});
  assert.equal(created.json().status, "pending_review");
  const reviews = await app.inject({ method: "GET", url: `/v1/test-cases/${created.json().testCaseId}/reviews` });
  assert.deepEqual(reviews.json().items, []);
  await app.close();
});

test("stale version submission and review requests are rejected", async () => {
  const app = buildApp();
  const created = await app.inject({ method: "POST", url: "/v1/test-cases", payload: {
    title: "Checkout", source: "manual", steps: [{ instruction: "Open checkout" }]
  }});
  const id = created.json().testCaseId;
  const staleSubmit = await app.inject({ method: "POST", url: `/v1/test-cases/${id}/submissions`, payload: { expectedVersion: 2 } });
  assert.equal(staleSubmit.statusCode, 409);
  const submitted = await app.inject({ method: "POST", url: `/v1/test-cases/${id}/submissions`, payload: { expectedVersion: 1 } });
  assert.equal(submitted.statusCode, 200);
  const staleReview = await app.inject({ method: "POST", url: `/v1/test-cases/${id}/reviews`, payload: { reviewerId: "r1", decision: "approved", expectedVersion: 2 } });
  assert.equal(staleReview.statusCode, 409);
  await app.close();
});

test("structured Playwright actions are accepted by the test case API", async () => {
  const app = buildApp();
  const created = await app.inject({ method: "POST", url: "/v1/test-cases", payload: {
    title: "Login", source: "manual", steps: [{
      instruction: "Fill email",
      action: JSON.stringify({ type: "fill", locator: { by: "testId", value: "email" }, value: "qa@example.test" })
    }]
  }});
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().steps[0].action.includes("qa@example.test"), true);
  await app.close();
});
