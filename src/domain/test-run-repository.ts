import type { EvidenceReference } from "./evidence-reference.js";
import type { StepExecutionResult, TestRun, TestRunStatus } from "./test-run.js";

export interface NewTestRun {
  runId: string;
  testCaseId: string;
  testCaseVersion: number;
  target: TestRun["target"];
  startedAt: string;
}
export interface TestRunRepository {
  create(input: NewTestRun): Promise<TestRun>;
  heartbeat(runId: string, at: string): Promise<void>;
  recoverStaleRuns(staleBefore: string, finishedAt: string): Promise<string[]>;
  appendStepResult(runId: string, result: StepExecutionResult, position: number): Promise<void>;
  complete(runId: string, status: "passed" | "failed", finishedAt: string): Promise<TestRun>;
  get(runId: string): Promise<TestRun | undefined>;
  attachEvidence(runId: string, stepId: string, reference: EvidenceReference): Promise<TestRun | undefined>;
}

export class InMemoryTestRunRepository implements TestRunRepository {
  private readonly runs = new Map<string, TestRun>();
  private readonly positions = new Map<string, Map<string, number>>();

  async create(input: NewTestRun): Promise<TestRun> {
    if (this.runs.has(input.runId)) throw new Error("test_run_already_exists");
    const run: TestRun = { ...input, target: { ...input.target }, status: "running", stepResults: [] };
    this.runs.set(run.runId, run);
    this.positions.set(run.runId, new Map());
    return structuredClone(run);
  }

  async heartbeat(runId: string, _at: string): Promise<void> {
    if (!this.runs.has(runId)) throw new Error("test_run_not_found");
  }

  async recoverStaleRuns(_staleBefore: string, _finishedAt: string): Promise<string[]> {
    return [];
  }

  async appendStepResult(runId: string, result: StepExecutionResult, position: number): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.status !== "running") throw new Error("test_run_not_running");
    if (run.stepResults.some((item) => item.stepId === result.stepId)) throw new Error("step_result_already_exists");
    run.stepResults.push(structuredClone(result));
    this.positions.get(runId)?.set(result.stepId, position);
    run.stepResults.sort((a, b) =>
      (this.positions.get(runId)?.get(a.stepId) ?? 0) - (this.positions.get(runId)?.get(b.stepId) ?? 0)
    );
  }

  async complete(runId: string, status: "passed" | "failed", finishedAt: string): Promise<TestRun> {
    const run = this.runs.get(runId);
    if (!run || run.status !== "running") throw new Error("test_run_not_running");
    run.status = status;
    run.finishedAt = finishedAt;
    return structuredClone(run);
  }

  async get(runId: string): Promise<TestRun | undefined> {
    const run = this.runs.get(runId);
    return run ? structuredClone(run) : undefined;
  }

  async attachEvidence(runId: string, stepId: string, reference: EvidenceReference): Promise<TestRun | undefined> {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    const step = run.stepResults.find((item) => item.stepId === stepId);
    if (!step) return undefined;
    const refs = step.evidenceRefs ?? [];
    if (!refs.some((item) => item.sourceSystem === reference.sourceSystem && item.evidenceId === reference.evidenceId)) {
      step.evidenceRefs = [...refs, structuredClone(reference)];
    }
    return structuredClone(run);
  }
}
