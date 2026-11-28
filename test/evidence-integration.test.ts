import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ReverseScreenEvidenceClient } from "../src/adapters/reverse-screen-evidence-client.js";
import { EvidenceNotFoundError, type EvidenceReference, type EvidenceResolver } from "../src/domain/evidence-reference.js";
import { buildApp } from "../src/server/app.js";

const evidenceId = "e0e0e0e0-1111-4111-8111-e0e0e0e0e0e0";
const binary = Buffer.from("verified reverse screen evidence");
const binarySha256 = createHash("sha256").update(binary).digest("hex");
const reference: EvidenceReference = {
  contractVersion: "1.0", sourceSystem: "reverse-screen", evidenceId,
  kind: "screenshot", contentType: "image/png", byteSize: binary.byteLength,
  sha256: binarySha256, storageUri: "s3://reverse-screen/evidence/session/evidence",
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
  const requestedUrls: string[] = [];
  const requestedAuthorizations: Array<string | null> = [];
  const client = new ReverseScreenEvidenceClient("http://reverse-screen:3000", "service-secret-012345678901234567890123", async (input, init) => {
    const url = String(input);
    requestedUrls.push(url);
    requestedAuthorizations.push(new Headers(init?.headers).get("authorization"));
    if (url.endsWith("/download-url")) {
      return new Response(JSON.stringify({ evidence_id: evidenceId, download_url: "https://storage.example.test/signed" }), { status: 200 });
    }
    if (url === "https://storage.example.test/signed") {
      return new Response(binary, { status: 200, headers: { "content-type": "image/png", "content-length": String(binary.byteLength) } });
    }
    return new Response(JSON.stringify({
      evidence_id: evidenceId, kind: "screenshot", content_type: "image/png",
      byte_size: binary.byteLength, sha256: binarySha256,
      storage_uri: "s3://reverse-screen/evidence/session/evidence",
      captured_at: "2026-11-27T00:00:00.000Z"
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const resolved = await client.resolve(evidenceId);
  assert.deepEqual(requestedUrls, [
    `http://reverse-screen:3000/v1/evidence-artifacts/${evidenceId}`,
    `http://reverse-screen:3000/v1/evidence-artifacts/${evidenceId}/download-url`,
    "https://storage.example.test/signed"
  ]);
  assert.deepEqual(requestedAuthorizations, [
    "Bearer service-secret-012345678901234567890123",
    "Bearer service-secret-012345678901234567890123",
    null
  ]);
  assert.deepEqual(resolved, reference);
});

test("Reverse Screen evidence client verifies downloaded binary size and checksum", async () => {
  const client = new ReverseScreenEvidenceClient("http://reverse-screen:3000", "service-secret-012345678901234567890123", async (input) => {
    const url = String(input);
    if (url.endsWith("/download-url")) return new Response(JSON.stringify({ evidence_id: evidenceId, download_url: "https://storage.example.test/signed" }), { status: 200 });
    if (url === "https://storage.example.test/signed") {
      const tampered = Buffer.from(binary); tampered[0] = tampered[0]! ^ 0xff;
      return new Response(tampered, { status: 200, headers: { "content-type": "image/png", "content-length": String(tampered.byteLength) } });
    }
    return new Response(JSON.stringify({
      evidence_id: evidenceId, kind: "screenshot", content_type: "image/png",
      byte_size: binary.byteLength, sha256: binarySha256,
      storage_uri: "s3://reverse-screen/evidence/session/evidence", captured_at: reference.capturedAt
    }), { status: 200 });
  });
  await assert.rejects(() => client.resolve(evidenceId), /reverse_screen_binary_checksum_mismatch/);
});

test("Reverse Screen evidence client requires a high-entropy service token", () => {
  assert.throws(
    () => new ReverseScreenEvidenceClient("http://reverse-screen:3000", "short"),
    /REVERSE_SCREEN_SERVICE_TOKEN/
  );
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
