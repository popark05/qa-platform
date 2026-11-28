import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { InMemoryTestCaseRepository, type TestCase } from "../domain/test-case.js";
import type { TestCaseRepository } from "../domain/test-case-repository.js";
import { TestRunService } from "../domain/test-run.js";
import { EvidenceNotFoundError, EvidenceSourceUnavailableError, type EvidenceResolver } from "../domain/evidence-reference.js";
import {
  FlowNotApprovedError, FlowNotFoundError, FlowSourceUnavailableError, generateTestCaseFromFlow,
  type DiscoveredTransition, type DiscoverySource, type FlowSource, type StepFlowReference, type WireflowFlowModelV1
} from "../domain/flow-reference.js";
import { AuthenticationError, DEFAULT_TENANT_ID, hasAnyRole, verifyBearerToken, type AuthConfig, type AuthRole } from "../security/auth.js";

const stepFlowRefSchema = {
  type: "object", additionalProperties: false, required: ["edgeId"],
  properties: { edgeId: { type: "string", minLength: 1, maxLength: 200 }, transitionId: { type: "string", format: "uuid" } }
} as const;
const fromFlowSchema = {
  type: "object", additionalProperties: false, required: ["flowId"],
  properties: { flowId: { type: "string", format: "uuid" } }
} as const;
const createTestCaseSchema = {
  type: "object", additionalProperties: false, required: ["title", "source", "steps"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 240 }, description: { type: "string", maxLength: 4000 },
    source: { type: "string", enum: ["manual", "ai"] },
    steps: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["instruction"], properties: {
      stepId: { type: "string" }, instruction: { type: "string", minLength: 1, maxLength: 2000 },
      action: { type: "string", maxLength: 8000 }, expectedResult: { type: "string", maxLength: 2000 },
      flowRef: stepFlowRefSchema
    } } }
  }
} as const;
const createVersionSchema = {
  type: "object", additionalProperties: false, required: ["expectedVersion", "title", "steps"],
  properties: {
    expectedVersion: { type: "integer", minimum: 1 }, title: { type: "string", minLength: 1, maxLength: 240 },
    description: { type: "string", maxLength: 4000 },
    steps: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["instruction"], properties: {
      stepId: { type: "string" }, instruction: { type: "string", minLength: 1, maxLength: 2000 },
      action: { type: "string", maxLength: 8000 }, expectedResult: { type: "string", maxLength: 2000 },
      flowRef: stepFlowRefSchema
    } } }
  }
} as const;
const reviewSchema = {
  type: "object", additionalProperties: false, required: ["reviewerId", "decision"],
  properties: {
    reviewerId: { type: "string", minLength: 1, maxLength: 200 },
    decision: { type: "string", enum: ["approved", "rejected"] },
    comment: { type: "string", maxLength: 4000 }, expectedVersion: { type: "integer", minimum: 1 }
  }
} as const;
const runSchema = {
  type: "object", additionalProperties: false, required: ["platform", "targetId"],
  properties: { platform: { type: "string", enum: ["web", "android", "ios", "hybrid"] }, targetId: { type: "string", minLength: 1, maxLength: 200 } }
} as const;
const attachEvidenceSchema = {
  type: "object", additionalProperties: false, required: ["evidenceId"],
  properties: { evidenceId: { type: "string", format: "uuid" } }
} as const;

export interface AppOptions {
  testCases?: TestCaseRepository; runs?: TestRunService; evidenceResolver?: EvidenceResolver; flowSource?: FlowSource;
  discoverySource?: DiscoverySource;
  auth?: AuthConfig; onClose?: () => Promise<void>;
}
type StepInput = { stepId?: string; instruction: string; action?: string; expectedResult?: string; flowRef?: StepFlowReference };
const normalizeSteps = (steps: StepInput[]) => steps.map((step) => ({
  stepId: step.stepId ?? randomUUID(), instruction: step.instruction,
  ...(step.action === undefined ? {} : { action: step.action }),
  ...(step.expectedResult === undefined ? {} : { expectedResult: step.expectedResult }),
  ...(step.flowRef === undefined ? {} : { flowRef: step.flowRef })
}));
const isApproved = (testCase: TestCase) => testCase.status === "approved";
const authorize = (request: FastifyRequest, reply: FastifyReply, roles: AuthRole[]): boolean => {
  if (!request.auth || !hasAnyRole(request.auth, roles)) { void reply.code(403).send({ error: "forbidden" }); return false; }
  return true;
};
const readableRoles: AuthRole[] = ["viewer", "author", "reviewer", "executor"];

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const testCases = options.testCases ?? new InMemoryTestCaseRepository();
  const runs = options.runs ?? new TestRunService();
  const authConfig: AuthConfig = options.auth ?? { mode: "disabled" };
  if (authConfig.mode === "required" && (!authConfig.secret || Buffer.byteLength(authConfig.secret) < 32)) {
    throw new Error("QA_AUTH_JWT_SECRET must be at least 32 bytes when authentication is required");
  }
  const app = Fastify({
    logger: true,
    // Fastify strips properties not allowed by `additionalProperties: false` by default; reject them instead
    // so typos and unsupported fields surface as 400 rather than being silently dropped.
    ajv: { customOptions: { removeAdditional: false } }
  });
  app.decorateRequest("auth", null);
  app.addHook("preHandler", async (request, reply) => {
    if (request.url === "/health") return;
    if (authConfig.mode === "disabled") {
      request.auth = { sub: "local-development", tenantId: DEFAULT_TENANT_ID, roles: ["admin", "author", "reviewer", "executor", "viewer"] };
      return;
    }
    try { request.auth = verifyBearerToken(request.headers.authorization, authConfig); }
    catch (error) {
      const message = error instanceof AuthenticationError ? error.message : "invalid_bearer_token";
      return reply.code(401).send({ error: message });
    }
  });
  app.addHook("onClose", async () => { await options.onClose?.(); });
  app.get("/health", async () => ({ status: "ok", service: "qa-platform" }));

  app.get("/v1/test-cases", async (request, reply) => {
    if (!authorize(request, reply, readableRoles)) return;
    return { items: await testCases.list(request.auth!.tenantId) };
  });

  app.post<{ Body: { title: string; description?: string; source: "manual" | "ai"; steps: StepInput[] } }>(
    "/v1/test-cases", { schema: { body: createTestCaseSchema } },
    async (request, reply) => {
      if (!authorize(request, reply, ["author"])) return;
      const item = await testCases.create({
        tenantId: request.auth!.tenantId, title: request.body.title, source: request.body.source,
        steps: normalizeSteps(request.body.steps),
        ...(request.body.description === undefined ? {} : { description: request.body.description })
      });
      return reply.code(201).send(item);
    }
  );

  // Generates a draft Test Case from an approved Wireflow Review flow, pulled from the source system.
  // The same flow version imported again returns the existing case instead of a duplicate.
  app.post<{ Body: { flowId: string } }>("/v1/test-cases/from-flow", { schema: { body: fromFlowSchema } }, async (request, reply) => {
    if (!authorize(request, reply, ["author"])) return;
    if (!options.flowSource) return reply.code(501).send({ error: "flow_source_not_configured" });
    let flow: WireflowFlowModelV1;
    try {
      flow = await options.flowSource.fetchApprovedFlow(request.body.flowId);
    } catch (error) {
      if (error instanceof FlowNotFoundError) return reply.code(404).send({ error: "source_flow_not_found" });
      if (error instanceof FlowNotApprovedError) return reply.code(409).send({ error: "source_flow_not_approved" });
      if (error instanceof FlowSourceUnavailableError) {
        request.log.error(error);
        return reply.code(502).send({ error: "flow_source_unavailable" });
      }
      throw error;
    }
    const tenantId = request.auth!.tenantId;
    const existing = (await testCases.list(tenantId)).find((item) =>
      item.flowRef?.flowId === flow.flowId && item.flowRef.flowVersion === flow.flowVersion);
    if (existing) return reply.code(200).send({ testCase: existing, created: false, skippedEdges: [] });
    // Executable actions come from Reverse Screen runtime facts; without them steps stay descriptive.
    const refs = flow.edges.flatMap((edge) => edge.discoveryRef?.transitionId && edge.discoveryRef.sessionId
      ? [{ sessionId: edge.discoveryRef.sessionId, transitionId: edge.discoveryRef.transitionId }] : []);
    let transitions = new Map<string, DiscoveredTransition>();
    let warning: string | undefined;
    if (options.discoverySource && refs.length > 0) {
      try {
        transitions = await options.discoverySource.resolveTransitions(refs);
      } catch (error) {
        request.log.warn(error, "Reverse Screen transition resolution failed");
        warning = "reverse_screen_unavailable_steps_not_executable";
      }
    }
    const generated = generateTestCaseFromFlow(flow, transitions);
    if (generated.steps.length === 0) {
      return reply.code(422).send({ error: "flow_has_no_testable_edges", skippedEdges: generated.skippedEdges });
    }
    const testCase = await testCases.create({
      tenantId, title: generated.title, description: generated.description,
      source: "flow", steps: generated.steps, flowRef: generated.flowRef
    });
    return reply.code(201).send({
      testCase, created: true, skippedEdges: generated.skippedEdges,
      executableStepCount: generated.steps.filter((step) => step.action).length,
      ...(warning ? { warning } : {})
    });
  });

  app.get<{ Params: { testCaseId: string } }>("/v1/test-cases/:testCaseId", async (request, reply) => {
    if (!authorize(request, reply, readableRoles)) return;
    const item = await testCases.get(request.params.testCaseId, request.auth!.tenantId);
    if (!item) return reply.code(404).send({ error: "test_case_not_found" });
    return item;
  });

  app.post<{ Params: { testCaseId: string }; Body: { expectedVersion?: number } | undefined }>(
    "/v1/test-cases/:testCaseId/submissions", async (request, reply) => {
      if (!authorize(request, reply, ["author"])) return;
      const expectedVersion = request.body?.expectedVersion;
      if (expectedVersion !== undefined && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
        return reply.code(400).send({ error: "invalid_expected_version" });
      }
      const item = await testCases.submitForReview(request.params.testCaseId, request.auth!.tenantId, expectedVersion);
      if (!item) return reply.code(409).send({ error: "test_case_cannot_be_submitted_or_version_conflict" });
      return item;
    }
  );

  app.post<{ Params: { testCaseId: string }; Body: { expectedVersion: number; title: string; description?: string; steps: StepInput[] } }>(
    "/v1/test-cases/:testCaseId/versions", { schema: { body: createVersionSchema } },
    async (request, reply) => {
      if (!authorize(request, reply, ["author"])) return;
      const item = await testCases.createVersion(request.params.testCaseId, request.auth!.tenantId, {
        expectedVersion: request.body.expectedVersion, title: request.body.title,
        steps: normalizeSteps(request.body.steps),
        ...(request.body.description === undefined ? {} : { description: request.body.description })
      });
      if (!item) return reply.code(409).send({ error: "test_case_version_conflict_or_review_pending" });
      return reply.code(201).send(item);
    }
  );

  app.get<{ Params: { testCaseId: string } }>("/v1/test-cases/:testCaseId/reviews", async (request, reply) => {
    if (!authorize(request, reply, readableRoles)) return;
    const item = await testCases.get(request.params.testCaseId, request.auth!.tenantId);
    if (!item) return reply.code(404).send({ error: "test_case_not_found" });
    return { items: await testCases.listReviews(request.params.testCaseId, request.auth!.tenantId) };
  });

  app.post<{ Params: { testCaseId: string }; Body: { reviewerId: string; decision: "approved" | "rejected"; comment?: string; expectedVersion?: number } }>(
    "/v1/test-cases/:testCaseId/reviews", { schema: { body: reviewSchema } },
    async (request, reply) => {
      if (!authorize(request, reply, ["reviewer"])) return;
      const review = await testCases.review(
        request.params.testCaseId, request.auth!.tenantId, request.auth!.sub, request.body.decision,
        request.body.comment, request.body.expectedVersion
      );
      if (!review) return reply.code(409).send({ error: "test_case_not_pending_review_or_version_conflict" });
      return reply.code(201).send(review);
    }
  );

  app.post<{ Params: { testCaseId: string }; Body: { platform: "web" | "android" | "ios" | "hybrid"; targetId: string } }>(
    "/v1/test-cases/:testCaseId/runs", { schema: { body: runSchema } },
    async (request, reply) => {
      if (!authorize(request, reply, ["executor"])) return;
      const item = await testCases.get(request.params.testCaseId, request.auth!.tenantId);
      if (!item) return reply.code(404).send({ error: "test_case_not_found" });
      if (!isApproved(item)) return reply.code(409).send({ error: "test_case_not_approved" });
      try {
        const run = await runs.execute(item, { platform: request.body.platform, targetId: request.body.targetId });
        return reply.code(201).send(run);
      } catch (error) {
        if (error instanceof Error && error.message === "test_case_not_approved") return reply.code(409).send({ error: error.message });
        throw error;
      }
    }
  );

  app.get<{ Params: { runId: string } }>("/v1/test-runs/:runId", async (request, reply) => {
    if (!authorize(request, reply, readableRoles)) return;
    const run = await runs.get(request.params.runId, request.auth!.tenantId);
    if (!run) return reply.code(404).send({ error: "test_run_not_found" });
    return run;
  });

  app.post<{ Params: { runId: string; stepId: string }; Body: { evidenceId: string } }>(
    "/v1/test-runs/:runId/steps/:stepId/evidence", { schema: { body: attachEvidenceSchema } },
    async (request, reply) => {
      if (!authorize(request, reply, ["executor"])) return;
      if (!options.evidenceResolver) return reply.code(501).send({ error: "evidence_resolver_not_configured" });
      const run = await runs.get(request.params.runId, request.auth!.tenantId);
      if (!run) return reply.code(404).send({ error: "test_run_not_found" });
      if (!run.stepResults.some((step) => step.stepId === request.params.stepId)) {
        return reply.code(404).send({ error: "test_step_result_not_found" });
      }
      try {
        const reference = await options.evidenceResolver.resolve(request.body.evidenceId);
        const updated = await runs.attachEvidence(request.params.runId, request.params.stepId, request.auth!.tenantId, reference);
        return reply.code(200).send(updated);
      } catch (error) {
        if (error instanceof EvidenceNotFoundError) return reply.code(404).send({ error: "source_evidence_not_found" });
        if (error instanceof EvidenceSourceUnavailableError) {
          request.log.error(error);
          return reply.code(502).send({ error: "evidence_source_unavailable" });
        }
        throw error;
      }
    }
  );
  return app;
}
