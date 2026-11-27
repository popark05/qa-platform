import assert from "node:assert/strict";
import test from "node:test";
import { ReverseScreenEvidenceClient } from "../src/adapters/reverse-screen-evidence-client.js";
import { EvidenceNotFoundError, type EvidenceReference, type EvidenceResolver } from "../src/domain/evidence-reference.js";
import { buildApp } from "../src/server/app.js";

const evidenceId = "e0e0e0e0-1111-4111-8111-e0e0e0e0e0e0";
const reference: EvidenceReference = {
  contractVersion: "1.0", sourceSystem: "reverse-screen", evidenceId,
  kind: "screenshot", contentType: "image/png", byteSize: 1024,
  sha256: "ab".repeat(32), storageUri: "s3://reverse-screen/evidence/session/evidence",
  capturedAt: "2026-11-27T00:00:00.000Z"
};

async function createApprovedRun(app: ReturnType<typeof buildApp>): Promise<{ runId: string; stepId: string }> {
  const created = await app.inject({
    method: "POST", url: "/v1/test-cases",
    payload: { title: "Checkout", source: "manual", steps: [{ stepId: "step-checkout", instruction: "Open checkout" }] }
  });
  const testCaseId = created.json().testCaseId;
  await app.inject({ method: "POST", url: `/v1/test-cases/${testCaseId}/submissions` });
  await app.inject({
    method: "POST", url: `/v1/test-cases/${testCaseId}/reviews`,
    payload: { reviewerId: "qa-reviewer", decision: "approved" }
  });
  const run = await app.inject({
    method: "POST", url: `/v1/test-cases/${testCaseId}/runs`,
    payload: { platform: "web", targetId: "chromium" }
  });
  return { runId: run.json().runId, stepId: "step-checkout" };
}

test("Reverse Screen evidence metadata is mapped to versioned QA evidence reference", async () => {
  let requestedUrl = "";
  const client = new ReverseScreenEvidenceClient("http://reverse-screen:3000", async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      evidence_id: evidenceId, kind: "screenshot", content_type: "image/png",
      byte_size: 1024, sha256: "ab".repeat(32),
      storage_uri: "s3://reverse-screen/evidence/session/evidence",
      captured_at: "2026-11-27T00:00:00.000Z"
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const resolved = await client.resolve(evidenceId);
  assert.equal(requestedUrl, `http://reverse-screen:3000/v1/evidence-artifacts/${evidenceId}`);
  assert.deepEqual(resolved, reference);
});

test("test run step can attach a Reverse Screen evidence reference and deduplicate it", async () => {
  const resolver: EvidenceResolver = { resolve: async () => reference };
  const app = buildApp({ evidenceResolver: resolver });
  const { runId, stepId } = await createApprovedRun(app);

  const attached = await app.inject({
    method: "POST", url: `/v1/test-runs/${runId}/steps/${stepId}/evidence`,
    payload: { evidenceId }
  });
  assert.equal(attached.statusCode, 200);
  assert.deepEqual(attached.json().stepResults[0].evidenceRefs, [reference]);

  await app.inject({
    method: "POST", url: `/v1/test-runs/${runId}/steps/${stepId}/evidence`,
    payload: { evidenceId }
  });
  const fetched = await app.inject({ method: "GET", url: `/v1/test-runs/${runId}` });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json().stepResults[0].evidenceRefs.length, 1);

  const wrongStep = await app.inject({
    method: "POST", url: `/v1/test-runs/${runId}/steps/unknown-step/evidence`,
    payload: { evidenceId }
  });
  assert.equal(wrongStep.statusCode, 404);
  await app.close();
});

test("evidence attachment returns source not-found and disabled integration responses", async () => {
  const missingResolver: EvidenceResolver = { resolve: async () => { throw new EvidenceNotFoundError(evidenceId); } };
  const app = buildApp({ evidenceResolver: missingResolver });
  const { runId, stepId } = await createApprovedRun(app);
  const missing = await app.inject({
    method: "POST", url: `/v1/test-runs/${runId}/steps/${stepId}/evidence`,
    payload: { evidenceId }
  });
  assert.equal(missing.statusCode, 404);
  await app.close();

  const disabled = buildApp();
  const disabledResponse = await disabled.inject({
    method: "POST", url: "/v1/test-runs/00000000-0000-4000-8000-000000000000/steps/step/evidence",
    payload: { evidenceId }
  });
  assert.equal(disabledResponse.statusCode, 501);
  await disabled.close();
});
