import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { Pool } from "pg";
import { newDb } from "pg-mem";
import { WireflowFlowClient } from "../src/adapters/wireflow-flow-client.js";
import {
  FlowNotApprovedError, FlowSourceUnavailableError, generateTestCaseFromFlow,
  type FlowSource, type WireflowFlowModelV1
} from "../src/domain/flow-reference.js";
import { PostgresTestCaseRepository } from "../src/infrastructure/postgres-test-case-repository.js";
import { buildApp } from "../src/server/app.js";

const flowId = "7a60a266-029f-4b4d-9460-7eccde6486a8";
const TRANSITION = "3e6ca0a2-0000-8000-8000-000000000001";
// Shape of a real flow exported by Wireflow Review after importing a Reverse Screen draft.
const flow: WireflowFlowModelV1 = {
  contractVersion: "1.1", sourceSystem: "wireflow-review", flowId, flowVersion: 1,
  applicationId: "now-in-android", title: "Now in Android — discovered",
  approval: { reviewId: "bd749c3c-bb17-4fbf-8326-226162a17e4f", reviewerId: "pm", approvedAt: "2026-11-28T06:30:00.000Z" },
  nodes: [
    { nodeId: "home", type: "screen", title: "Now in Android", origin: "product_requirement" },
    { nodeId: "search", type: "screen", title: "Recent searches", origin: "discovered" },
    { nodeId: "settings", type: "screen", title: "Settings", origin: "product_requirement" },
    { nodeId: "empty", type: "screen", title: "Empty saved list?", origin: "open_question" }
  ],
  edges: [
    { edgeId: "e-settings", fromNodeId: "home", toNodeId: "settings", kind: "primary", label: "Settings", trigger: "tap", origin: "product_requirement" },
    { edgeId: "e-search", fromNodeId: "home", toNodeId: "search", kind: "primary", label: "Search", trigger: "tap", origin: "discovered",
      discoveryRef: { sourceSystem: "reverse-screen", transitionId: TRANSITION } },
    { edgeId: "e-back", fromNodeId: "search", toNodeId: "home", kind: "back", label: "Back", trigger: "back", origin: "product_requirement" },
    { edgeId: "e-ok", fromNodeId: "settings", toNodeId: "home", kind: "primary", label: "OK", trigger: "tap", origin: "ai_suggestion" },
    { edgeId: "e-empty", fromNodeId: "home", toNodeId: "empty", kind: "empty", label: "Saved", trigger: "tap", origin: "product_requirement" }
  ],
  exportedAt: "2026-11-28T06:31:00.000Z"
};

test("generates one step per testable edge, walking the flow and skipping open questions", () => {
  const generated = generateTestCaseFromFlow(flow);
  assert.deepEqual(generated.steps.map((step) => step.stepId), ["edge-e-settings", "edge-e-ok", "edge-e-search", "edge-e-back"],
    "greedy walk continues from the current screen before jumping");
  assert.equal(generated.steps[0]?.instruction, 'On "Now in Android", tap "Settings"');
  assert.equal(generated.steps[0]?.expectedResult, '"Settings" is shown');
  assert.equal(generated.steps[3]?.instruction, 'On "Recent searches", go back');
  assert.deepEqual(generated.steps[2]?.flowRef, { edgeId: "e-search", transitionId: TRANSITION });
  assert.deepEqual(generated.skippedEdges, [{ edgeId: "e-empty", reason: "open_question" }]);
  assert.deepEqual(generated.flowRef, {
    sourceSystem: "wireflow-review", contractVersion: "1.1", flowId, flowVersion: 1,
    applicationId: "now-in-android", approvalReviewId: flow.approval.reviewId
  });
});

test("from-flow creates a draft case with provenance, is idempotent and still requires review before runs", async () => {
  const source: FlowSource = { fetchApprovedFlow: async () => structuredClone(flow) };
  const app = buildApp({ flowSource: source });
  const created = await app.inject({ method: "POST", url: "/v1/test-cases/from-flow", payload: { flowId } });
  assert.equal(created.statusCode, 201);
  const testCase = created.json().testCase;
  assert.equal(testCase.status, "draft");
  assert.equal(testCase.source, "flow");
  assert.equal(testCase.flowRef.flowId, flowId);
  assert.equal(testCase.steps.length, 4);
  assert.deepEqual(created.json().skippedEdges, [{ edgeId: "e-empty", reason: "open_question" }]);

  const again = await app.inject({ method: "POST", url: "/v1/test-cases/from-flow", payload: { flowId } });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().created, false);
  assert.equal(again.json().testCase.testCaseId, testCase.testCaseId);

  const run = await app.inject({ method: "POST", url: `/v1/test-cases/${testCase.testCaseId}/runs`, payload: { platform: "android", targetId: "device" } });
  assert.equal(run.statusCode, 409, "a generated case is not executable until a human approves it");

  // Editing the generated case keeps case and step provenance.
  const edited = await app.inject({
    method: "POST", url: `/v1/test-cases/${testCase.testCaseId}/versions`,
    payload: { expectedVersion: 1, title: testCase.title, steps: testCase.steps.slice(0, 2) }
  });
  assert.equal(edited.statusCode, 201, edited.body);
  assert.equal(edited.json().flowRef.flowId, flowId);
  assert.deepEqual(edited.json().steps[0].flowRef, { edgeId: "e-settings" });
  await app.close();
});

test("from-flow maps source errors and reports when nothing is testable", async () => {
  const notApproved = buildApp({ flowSource: { fetchApprovedFlow: async () => { throw new FlowNotApprovedError(flowId); } } });
  assert.equal((await notApproved.inject({ method: "POST", url: "/v1/test-cases/from-flow", payload: { flowId } })).statusCode, 409);
  await notApproved.close();

  const down = buildApp({ flowSource: { fetchApprovedFlow: async () => { throw new FlowSourceUnavailableError(); } } });
  assert.equal((await down.inject({ method: "POST", url: "/v1/test-cases/from-flow", payload: { flowId } })).statusCode, 502);
  await down.close();

  const onlyQuestions = buildApp({ flowSource: { fetchApprovedFlow: async () => ({ ...flow, edges: flow.edges.slice(4) }) } });
  const response = await onlyQuestions.inject({ method: "POST", url: "/v1/test-cases/from-flow", payload: { flowId } });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error, "flow_has_no_testable_edges");
  await onlyQuestions.close();

  const unconfigured = buildApp();
  assert.equal((await unconfigured.inject({ method: "POST", url: "/v1/test-cases/from-flow", payload: { flowId } })).statusCode, 501);
  await unconfigured.close();
});

test("Wireflow client pulls the export over HTTP and maps 404/409/invalid payloads", async () => {
  const responses: Record<string, [number, unknown]> = {
    [flowId]: [200, flow],
    "00000000-0000-4000-8000-000000000404": [404, { error: "flow_not_found" }],
    "00000000-0000-4000-8000-000000000409": [409, { error: "flow_not_approved" }],
    "00000000-0000-4000-8000-000000000422": [200, { ...flow, flowId: "00000000-0000-4000-8000-000000000422", contractVersion: "2.0" }],
    "00000000-0000-4000-8000-000000000010": [200, { ...flow, flowId: "00000000-0000-4000-8000-000000000010", contractVersion: "1.0" }]
  };
  const server = createServer((request, response) => {
    const id = request.url?.match(/^\/v1\/flows\/([^/]+)\/export$/)?.[1] ?? "";
    const [status, body] = responses[id] ?? [500, {}];
    response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const client = new WireflowFlowClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  try {
    assert.equal((await client.fetchApprovedFlow(flowId)).approval.reviewerId, "pm");
    assert.equal((await client.fetchApprovedFlow("00000000-0000-4000-8000-000000000010")).contractVersion, "1.0", "1.0 exports stay accepted");
    await assert.rejects(client.fetchApprovedFlow("00000000-0000-4000-8000-000000000404"), { name: "FlowNotFoundError" });
    await assert.rejects(client.fetchApprovedFlow("00000000-0000-4000-8000-000000000409"), { name: "FlowNotApprovedError" });
    await assert.rejects(client.fetchApprovedFlow("00000000-0000-4000-8000-000000000422"), { message: "wireflow_invalid_flow_model" });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("PostgreSQL repository persists case-level flow provenance", async () => {
  const database = newDb();
  for (const file of ["001_test_run.sql", "002_test_case_review.sql", "005_tenant_isolation.sql", "006_test_case_flow_provenance.sql"]) {
    const sql = await readFile(new URL(`../db/migrations/${file}`, import.meta.url), "utf8");
    // pg-mem names inline CHECK constraints differently from PostgreSQL, so 007 cannot replace them here;
    // load 002 with the post-007 source constraint instead. 007 itself runs against PostgreSQL in CI.
    database.public.none(sql.replaceAll("CHECK (source IN ('manual', 'ai'))", "CHECK (source IN ('manual', 'ai', 'flow'))"));
  }
  const pool = new (database.adapters.createPg().Pool)() as unknown as Pool;
  const cases = new PostgresTestCaseRepository(pool);
  const generated = generateTestCaseFromFlow(flow);
  const tenantId = "00000000-0000-4000-8000-000000000001";
  const created = await cases.create({ tenantId, title: generated.title, source: "flow", steps: generated.steps, flowRef: generated.flowRef });
  assert.equal(created.status, "draft");
  const loaded = await cases.get(created.testCaseId, tenantId);
  assert.equal(loaded?.source, "flow");
  assert.deepEqual(loaded?.flowRef, generated.flowRef);
  assert.deepEqual(loaded?.steps[2]?.flowRef, { edgeId: "e-search", transitionId: TRANSITION });
  const plain = await cases.create({ tenantId, title: "Manual", source: "manual", steps: [{ stepId: "s1", instruction: "Open" }] });
  assert.equal((await cases.get(plain.testCaseId, tenantId))?.flowRef, undefined);
  await pool.end();
});
