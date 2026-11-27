import { randomUUID } from "node:crypto";
import type { TestCase, TestStep } from "./test-case.js";
import type { EvidenceReference } from "./evidence-reference.js";

export type TestRunStatus = "passed" | "failed";
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
  finishedAt: string;
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
    return {
      stepId: step.stepId,
      status: "passed",
      message: `Mock execution completed: ${step.instruction}`,
      durationMs: index + 1
    };
  }
}

export class TestRunService {
  private readonly runs = new Map<string, TestRun>();
  constructor(private readonly executor: StepExecutor = new MockStepExecutor()) {}

  async execute(testCase: TestCase, target: TestRun["target"]): Promise<TestRun> {
    if (testCase.status !== "approved") throw new Error("test_case_not_approved");
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const stepResults: StepExecutionResult[] = [];
    try {
      for (const [index, step] of testCase.steps.entries()) {
        const result = await this.executor.execute(step, index, { runId, target });
        stepResults.push(result);
        if (result.status === "failed") break;
      }
    } finally {
      await this.executor.closeRun?.(runId);
    }
    const run: TestRun = {
      runId,
      testCaseId: testCase.testCaseId,
      testCaseVersion: testCase.version,
      target,
      status: stepResults.every((result) => result.status === "passed") && stepResults.length === testCase.steps.length ? "passed" : "failed",
      stepResults,
      startedAt,
      finishedAt: new Date().toISOString()
    };
    this.runs.set(runId, run);
    return run;
  }

  get(runId: string): TestRun | undefined { return this.runs.get(runId); }

  attachEvidence(runId: string, stepId: string, reference: EvidenceReference): TestRun | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    const step = run.stepResults.find((item) => item.stepId === stepId);
    if (!step) return undefined;
    const references = step.evidenceRefs ?? [];
    if (!references.some((item) => item.sourceSystem === reference.sourceSystem && item.evidenceId === reference.evidenceId)) {
      step.evidenceRefs = [...references, reference];
    }
    return run;
  }
}
