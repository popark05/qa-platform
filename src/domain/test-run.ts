import { randomUUID } from "node:crypto";
import type { TestCase, TestStep } from "./test-case.js";
import type { EvidenceReference } from "./evidence-reference.js";
import { InMemoryTestRunRepository, type TestRunRepository } from "./test-run-repository.js";

export type TestRunStatus = "running" | "passed" | "failed";
export interface StepExecutionResult {
  stepId: string;
  status: "passed" | "failed";
  message: string;
  durationMs: number;
  evidenceRefs?: EvidenceReference[];
}
export interface TestRun {
  runId: string;
  testCaseId: string;
  testCaseVersion: number;
  target: { platform: "web" | "android" | "ios" | "hybrid"; targetId: string };
  status: TestRunStatus;
  stepResults: StepExecutionResult[];
  startedAt: string;
  finishedAt?: string;
}
export interface StepExecutionContext {
  runId: string;
  target: TestRun["target"];
}
export interface StepExecutor {
  execute(step: TestStep, index: number, context?: StepExecutionContext): Promise<StepExecutionResult>;
  closeRun?(runId: string): Promise<void>;
}

export class MockStepExecutor implements StepExecutor {
  async execute(step: TestStep, index: number): Promise<StepExecutionResult> {
    return { stepId: step.stepId, status: "passed", message: `Mock execution completed: ${step.instruction}`, durationMs: index + 1 };
  }
}

export class TestRunService {
  constructor(
    private readonly executor: StepExecutor = new MockStepExecutor(),
    private readonly repository: TestRunRepository = new InMemoryTestRunRepository()
  ) {}

  async execute(testCase: TestCase, target: TestRun["target"]): Promise<TestRun> {
    if (testCase.status !== "approved") throw new Error("test_case_not_approved");
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    await this.repository.create({
      runId, testCaseId: testCase.testCaseId, testCaseVersion: testCase.version,
      target, startedAt
    });

    let status: Exclude<TestRunStatus, "running"> = "passed";
    try {
      for (const [index, step] of testCase.steps.entries()) {
        let result: StepExecutionResult;
        const stepStartedAt = Date.now();
        try {
          result = await this.executor.execute(step, index, { runId, target });
          if (result.stepId !== step.stepId) throw new Error("executor_step_id_mismatch");
        } catch (error) {
          result = {
            stepId: step.stepId, status: "failed",
            message: error instanceof Error ? error.message.slice(0, 2000) : "step_execution_failed",
            durationMs: Date.now() - stepStartedAt
          };
        }
        await this.repository.appendStepResult(runId, result, index);
        if (result.status === "failed") {
          status = "failed";
          break;
        }
      }
    } catch (error) {
      status = "failed";
      throw error;
    } finally {
      try {
        await this.executor.closeRun?.(runId);
      } catch {
        status = "failed";
      }
    }

    if (status === "passed" && testCase.steps.length === 0) status = "failed";
    if (status === "passed") {
      const persisted = await this.repository.get(runId);
      if ((persisted?.stepResults.length ?? 0) !== testCase.steps.length) status = "failed";
    }
    return this.repository.complete(runId, status, new Date().toISOString());
  }

  get(runId: string): Promise<TestRun | undefined> { return this.repository.get(runId); }

  attachEvidence(runId: string, stepId: string, reference: EvidenceReference): Promise<TestRun | undefined> {
    return this.repository.attachEvidence(runId, stepId, reference);
  }
}
