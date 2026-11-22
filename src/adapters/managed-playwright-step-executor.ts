import type { TestStep } from "../domain/test-case.js";
import type { StepExecutionContext, StepExecutionResult, StepExecutor } from "../domain/test-run.js";
import type { PlaywrightPageProvider } from "./playwright-session-manager.js";
import { PlaywrightStepExecutor } from "./playwright-step-executor.js";

export class ManagedPlaywrightStepExecutor implements StepExecutor {
  constructor(private readonly sessions: PlaywrightPageProvider) {}

  async execute(step: TestStep, index: number, context?: StepExecutionContext): Promise<StepExecutionResult> {
    const started = Date.now();
    if (!context) {
      return { stepId: step.stepId, status: "failed", message: "run_context_required", durationMs: 0 };
    }
    try {
      const page = await this.sessions.getPage(context.runId, context.target);
      return await new PlaywrightStepExecutor(page).execute(step, index);
    } catch (error) {
      return {
        stepId: step.stepId, status: "failed",
        message: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started
      };
    }
  }

  async closeRun(runId: string): Promise<void> {
    await this.sessions.closeRun(runId);
  }
}
