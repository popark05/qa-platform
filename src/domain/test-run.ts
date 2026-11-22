import { randomUUID } from "node:crypto";
import type { TestCase, TestStep } from "./test-case.js";

export type TestRunStatus = "passed" | "failed";
export interface StepExecutionResult {
  stepId: string;
  status: "passed" | "failed";
  message: string;
  durationMs: number;
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
export interface StepExecutor {
  execute(step: TestStep, index: number): Promise<StepExecutionResult>;
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
  constructor(private readonly executor: StepExecutor = new MockStepExecutor()) {}

  async execute(testCase: TestCase, target: TestRun["target"]): Promise<TestRun> {
    if (testCase.status !== "approved") throw new Error("test_case_not_approved");
    const startedAt = new Date().toISOString();
    const stepResults: StepExecutionResult[] = [];
    for (const [index, step] of testCase.steps.entries()) {
      const result = await this.executor.execute(step, index);
      stepResults.push(result);
      if (result.status === "failed") break;
    }
    return {
      runId: randomUUID(),
      testCaseId: testCase.testCaseId,
      testCaseVersion: testCase.version,
      target,
      status: stepResults.every((result) => result.status === "passed") && stepResults.length === testCase.steps.length ? "passed" : "failed",
      stepResults,
      startedAt,
      finishedAt: new Date().toISOString()
    };
  }
}
