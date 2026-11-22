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

  const prematureRun = await app.inject({ method: "POST", url: `/v1/test-cases/${id}/runs`, payload: { platform: "web", targetId: "chromium" } });
  assert.equal(prematureRun.statusCode, 409);

  const submitted = await app.inject({ method: "POST", url: `/v1/test-cases/${id}/submissions` });
  assert.equal(submitted.json().status, "pending_review");

  const reviewed = await app.inject({ method: "POST", url: `/v1/test-cases/${id}/reviews`, payload: { reviewerId: "reviewer-1", decision: "approved" } });
  assert.equal(reviewed.statusCode, 201);

  const run = await app.inject({ method: "POST", url: `/v1/test-cases/${id}/runs`, payload: { platform: "web", targetId: "chromium" } });
  assert.equal(run.statusCode, 201);
  assert.equal(run.json().status, "passed");
  assert.equal(run.json().stepResults.length, 2);
  await app.close();
});

test("AI authored tests enter review queue immediately", async () => {
  const app = buildApp();
  const created = await app.inject({ method: "POST", url: "/v1/test-cases", payload: {
    title: "AI draft", source: "ai", steps: [{ instruction: "Tap continue" }]
  }});
  assert.equal(created.json().status, "pending_review");
  await app.close();
});
