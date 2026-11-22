import Fastify, { type FastifyInstance } from "fastify";
import { TestCaseStore } from "../domain/test-case.js";
import { TestRunService } from "../domain/test-run.js";

const createTestCaseSchema = {
  type: "object", additionalProperties: false, required: ["title", "source", "steps"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 240 },
    description: { type: "string", maxLength: 4000 },
    source: { type: "string", enum: ["manual", "ai"] },
    steps: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["instruction"], properties: {
      stepId: { type: "string" }, instruction: { type: "string", minLength: 1, maxLength: 2000 },
      action: { type: "string", maxLength: 8000 }, expectedResult: { type: "string", maxLength: 2000 }
    } } }
  }
} as const;
const reviewSchema = {
  type: "object", additionalProperties: false, required: ["reviewerId", "decision"],
  properties: { reviewerId: { type: "string", minLength: 1, maxLength: 200 }, decision: { type: "string", enum: ["approved", "rejected"] }, comment: { type: "string", maxLength: 4000 } }
} as const;
const runSchema = {
  type: "object", additionalProperties: false, required: ["platform", "targetId"],
  properties: { platform: { type: "string", enum: ["web", "android", "ios", "hybrid"] }, targetId: { type: "string", minLength: 1, maxLength: 200 } }
} as const;

export interface AppOptions {
  store?: TestCaseStore;
  runs?: TestRunService;
  onClose?: () => Promise<void>;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const store = options.store ?? new TestCaseStore();
  const runs = options.runs ?? new TestRunService();
  const app = Fastify({ logger: true });
  app.addHook("onClose", async () => { await options.onClose?.(); });
  app.get("/health", async () => ({ status: "ok", service: "qa-platform" }));
  app.get("/v1/test-cases", async () => ({ items: store.list() }));

  app.post<{ Body: { title: string; description?: string; source: "manual" | "ai"; steps: Array<{ stepId?: string; instruction: string; action?: string; expectedResult?: string }> } }>(
    "/v1/test-cases", { schema: { body: createTestCaseSchema } },
    async (request, reply) => {
      const testCase = store.create({
        title: request.body.title, source: request.body.source,
        steps: request.body.steps.map((step) => ({
          stepId: step.stepId ?? crypto.randomUUID(), instruction: step.instruction,
          ...(step.action === undefined ? {} : { action: step.action }),
          ...(step.expectedResult === undefined ? {} : { expectedResult: step.expectedResult })
        })),
        ...(request.body.description === undefined ? {} : { description: request.body.description })
      });
      return reply.code(201).send(testCase);
    }
  );

  app.get<{ Params: { testCaseId: string } }>("/v1/test-cases/:testCaseId", async (request, reply) => {
    const testCase = store.get(request.params.testCaseId);
    if (!testCase) return reply.code(404).send({ error: "test_case_not_found" });
    return testCase;
  });

  app.post<{ Params: { testCaseId: string } }>("/v1/test-cases/:testCaseId/submissions", async (request, reply) => {
    const submitted = store.submitForReview(request.params.testCaseId);
    if (!submitted) return reply.code(409).send({ error: "test_case_cannot_be_submitted" });
    return submitted;
  });

  app.post<{ Params: { testCaseId: string }; Body: { reviewerId: string; decision: "approved" | "rejected"; comment?: string } }>(
    "/v1/test-cases/:testCaseId/reviews", { schema: { body: reviewSchema } },
    async (request, reply) => {
      const review = store.review(request.params.testCaseId, request.body.reviewerId, request.body.decision, request.body.comment);
      if (!review) return reply.code(409).send({ error: "test_case_not_pending_review" });
      return reply.code(201).send(review);
    }
  );

  app.post<{ Params: { testCaseId: string }; Body: { platform: "web" | "android" | "ios" | "hybrid"; targetId: string } }>(
    "/v1/test-cases/:testCaseId/runs", { schema: { body: runSchema } },
    async (request, reply) => {
      const testCase = store.get(request.params.testCaseId);
      if (!testCase) return reply.code(404).send({ error: "test_case_not_found" });
      try {
        const run = await runs.execute(testCase, { platform: request.body.platform, targetId: request.body.targetId });
        return reply.code(201).send(run);
      } catch (error) {
        if (error instanceof Error && error.message === "test_case_not_approved") return reply.code(409).send({ error: error.message });
        throw error;
      }
    }
  );

  return app;
}
