import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { buildApp } from "../src/server/app.js";

const secret = "test-only-secret-with-more-than-thirty-two-bytes";
const issuer = "https://issuer.example.test";
const audience = "qa-platform";

function issueToken(input: { sub: string; tenantId: string; roles: string[]; exp?: number }): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: input.sub, tenant_id: input.tenantId, roles: input.roles,
    iss: issuer, aud: audience, iat: Math.floor(Date.now() / 1000),
    exp: input.exp ?? Math.floor(Date.now() / 1000) + 300
  })).toString("base64url");
  const signingInput = header + "." + payload;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return signingInput + "." + signature;
}
const auth = { mode: "required" as const, secret, issuer, audience };
const tenantA = "00000000-0000-4000-8000-000000000001";
const tenantB = "00000000-0000-4000-8000-000000000002";
const bearer = (token: string) => ({ authorization: "Bearer " + token });

test("protected API rejects missing, malformed, expired and tampered bearer tokens", async () => {
  const app = buildApp({ auth });
  assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/v1/test-cases" })).statusCode, 401);
  const expired = issueToken({ sub: "expired", tenantId: tenantA, roles: ["viewer"], exp: 1 });
  assert.equal((await app.inject({ method: "GET", url: "/v1/test-cases", headers: bearer(expired) })).statusCode, 401);
  const valid = issueToken({ sub: "viewer-1", tenantId: tenantA, roles: ["viewer"] });
  const tampered = valid.slice(0, -1) + (valid.endsWith("a") ? "b" : "a");
  assert.equal((await app.inject({ method: "GET", url: "/v1/test-cases", headers: bearer(tampered) })).statusCode, 401);
  await app.close();
});

test("tenant scope and role authorization are enforced on Test Case APIs", async () => {
  const app = buildApp({ auth });
  const author = issueToken({ sub: "author-a", tenantId: tenantA, roles: ["author"] });
  const viewer = issueToken({ sub: "viewer-b", tenantId: tenantB, roles: ["viewer"] });
  const reviewer = issueToken({ sub: "reviewer-a", tenantId: tenantA, roles: ["reviewer"] });

  const forbiddenCreate = await app.inject({
    method: "POST", url: "/v1/test-cases", headers: bearer(viewer),
    payload: { title: "Should be denied", source: "manual", steps: [{ instruction: "Open app" }] }
  });
  assert.equal(forbiddenCreate.statusCode, 403);

  const created = await app.inject({
    method: "POST", url: "/v1/test-cases", headers: bearer(author),
    payload: { title: "Tenant A case", source: "ai", steps: [{ instruction: "Open app" }] }
  });
  assert.equal(created.statusCode, 201);
  const testCaseId = created.json().testCaseId;

  const visibleToOwner = await app.inject({ method: "GET", url: "/v1/test-cases/" + testCaseId, headers: bearer(author) });
  assert.equal(visibleToOwner.statusCode, 200);

  const hiddenFromOtherTenant = await app.inject({ method: "GET", url: "/v1/test-cases/" + testCaseId, headers: bearer(viewer) });
  assert.equal(hiddenFromOtherTenant.statusCode, 404);
  const otherList = await app.inject({ method: "GET", url: "/v1/test-cases", headers: bearer(viewer) });
  assert.deepEqual(otherList.json().items, []);

  const review = await app.inject({
    method: "POST", url: "/v1/test-cases/" + testCaseId + "/reviews", headers: bearer(reviewer),
    payload: { reviewerId: "spoofed-reviewer", decision: "approved" }
  });
  assert.equal(review.statusCode, 201);
  assert.equal(review.json().reviewerId, "reviewer-a");
  await app.close();
});
