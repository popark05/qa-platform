import assert from "node:assert/strict";
import test from "node:test";
import { ReverseScreenEvidenceClient } from "../src/adapters/reverse-screen-evidence-client.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { EvidenceNotFoundError, EvidenceSourceUnavailableError, type EvidenceReference, type EvidenceResolver } from "../src/domain/evidence-reference.js";
import { buildApp } from "../src/server/app.js";

const evidenceId = "e0e0e0e0-1111-4111-8111-e0e0e0e0e0e0";
const SERVICE_TOKEN = "qa-to-reverse-screen-service-token-0123456789";
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
  let authorization: string | null = null;
  const client = new ReverseScreenEvidenceClient("http://reverse-screen:3000", { serviceToken: SERVICE_TOKEN, fetcher: async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get("authorization");
    return new Response(JSON.stringify({
      evidence_id: evidenceId, kind: "screenshot", content_type: "image/png",
      byte_size: 1024, sha256: "ab".repeat(32),
      storage_uri: "s3://reverse-screen/evidence/session/evidence",
      captured_at: "2026-11-27T00:00:00.000Z"
    }), { status: 200, headers: { "content-type": "application/json" } });
  } });
  const resolved = await client.resolve(evidenceId);
  assert.equal(requestedUrl, `http://reverse-screen:3000/v1/evidence-artifacts/${evidenceId}`);
  assert.equal(authorization, `Bearer ${SERVICE_TOKEN}`);
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

test("evidence client authenticates against a real HTTP server that enforces the service token", async () => {
  // Mirrors Reverse Screen's evidence read guard: 401 unless the exact bearer token is supplied.
  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${SERVICE_TOKEN}`) {
      response.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "service_authentication_required" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      evidence_id: evidenceId, kind: "screenshot", content_type: "image/png", byte_size: 1024,
      sha256: "ab".repeat(32), storage_uri: "s3://reverse-screen/evidence/session/evidence",
      captured_at: "2026-11-27T00:00:00.000Z"
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const client = new ReverseScreenEvidenceClient(`http://127.0.0.1:${port}`, { serviceToken: SERVICE_TOKEN });
    assert.deepEqual(await client.resolve(evidenceId), reference);

    const wrongToken = new ReverseScreenEvidenceClient(`http://127.0.0.1:${port}`, { serviceToken: "x".repeat(32) });
    await assert.rejects(wrongToken.resolve(evidenceId), (error: Error) =>
      error instanceof EvidenceSourceUnavailableError && error.message === "reverse_screen_service_auth_rejected");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("evidence client rejects service tokens shorter than 32 bytes", () => {
  assert.throws(() => new ReverseScreenEvidenceClient("http://reverse-screen:3000", { serviceToken: "short" }),
    /REVERSE_SCREEN_SERVICE_TOKEN must contain at least 32 bytes/);
});
