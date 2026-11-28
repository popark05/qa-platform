import type { Pool, PoolClient } from "pg";
import type { EvidenceReference } from "../domain/evidence-reference.js";
import type { StepExecutionResult, TestRun, TestRunStatus } from "../domain/test-run.js";
import type { NewTestRun, TestRunRepository } from "../domain/test-run-repository.js";

interface RunRow {
  run_id: string; tenant_id: string; test_case_id: string; test_case_version: number;
  platform: TestRun["target"]["platform"]; target_id: string; status: TestRunStatus;
  started_at: Date | string; finished_at: Date | string | null;
}
interface StepRow { step_id: string; status: "passed" | "failed"; message: string; duration_ms: number }
interface EvidenceRow {
  step_id: string; source_system: "reverse-screen"; evidence_id: string; contract_version: "1.0";
  kind: EvidenceReference["kind"]; content_type: string; byte_size: string | number;
  sha256: string; storage_uri: string; captured_at: Date | string;
}
const iso = (value: Date | string): string => new Date(value).toISOString();
const mapEvidence = (row: EvidenceRow): EvidenceReference => ({
  contractVersion: row.contract_version, sourceSystem: row.source_system, evidenceId: row.evidence_id,
  kind: row.kind, contentType: row.content_type, byteSize: Number(row.byte_size),
  sha256: row.sha256, storageUri: row.storage_uri, capturedAt: iso(row.captured_at)
});

export class PostgresTestRunRepository implements TestRunRepository {
  constructor(private readonly pool: Pool) {}

  async heartbeat(runId: string, at: string): Promise<void> {
    const result = await this.pool.query(
      "UPDATE qa_test_run SET last_heartbeat_at = $2 WHERE run_id = $1 AND status = 'running'",
      [runId, at]
    );
    if (result.rowCount !== 1) throw new Error("test_run_not_running");
  }

  async recoverStaleRuns(staleBefore: string, finishedAt: string): Promise<string[]> {
    const result = await this.pool.query<{ run_id: string }>(
      `WITH stale AS (
         SELECT run_id FROM qa_test_run
         WHERE status = 'running' AND last_heartbeat_at < $1
         ORDER BY last_heartbeat_at
         FOR UPDATE SKIP LOCKED
         LIMIT 100
       )
       UPDATE qa_test_run AS run
       SET status = 'abandoned', finished_at = $2
       FROM stale
       WHERE run.run_id = stale.run_id AND run.status = 'running'
       RETURNING run.run_id`,
      [staleBefore, finishedAt]
    );
    return result.rows.map((row) => row.run_id);
  }

  async create(input: NewTestRun): Promise<TestRun> {
    await this.pool.query(
      `INSERT INTO qa_test_run
       (run_id, tenant_id, test_case_id, test_case_version, platform, target_id, status, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'running', $7)`,
      [input.runId, input.tenantId, input.testCaseId, input.testCaseVersion,
        input.target.platform, input.target.targetId, input.startedAt]
    );
    return { ...input, target: { ...input.target }, status: "running", stepResults: [] };
  }

  async appendStepResult(runId: string, tenantId: string, result: StepExecutionResult, position: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const owner = await client.query(
        "SELECT 1 FROM qa_test_run WHERE run_id = $1 AND tenant_id = $2 AND status = 'running' FOR UPDATE",
        [runId, tenantId]
      );
      if (owner.rowCount !== 1) throw new Error("test_run_not_running_or_tenant_mismatch");
      await client.query(
        `INSERT INTO qa_step_result (run_id, step_id, position, status, message, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [runId, result.stepId, position, result.status, result.message, result.durationMs]
      );
      for (const reference of result.evidenceRefs ?? []) {
        await this.insertEvidence(client, runId, result.stepId, reference);
      }
      await client.query(
        "UPDATE qa_test_run SET last_heartbeat_at = now() WHERE run_id = $1 AND tenant_id = $2 AND status = 'running'",
        [runId, tenantId]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async complete(runId: string, tenantId: string, status: "passed" | "failed", finishedAt: string): Promise<TestRun> {
    const result = await this.pool.query(
      `UPDATE qa_test_run SET status = $3, finished_at = $4
       WHERE run_id = $1 AND tenant_id = $2 AND status = 'running' RETURNING run_id`,
      [runId, tenantId, status, finishedAt]
    );
    if (result.rowCount !== 1) throw new Error("test_run_not_running");
    const run = await this.get(runId, tenantId);
    if (!run) throw new Error("test_run_not_found_after_completion");
    return run;
  }

  async get(runId: string, tenantId: string): Promise<TestRun | undefined> {
    const runResult = await this.pool.query<RunRow>(
      "SELECT * FROM qa_test_run WHERE run_id = $1 AND tenant_id = $2", [runId, tenantId]
    );
    const row = runResult.rows[0];
    if (!row) return undefined;
    const stepResult = await this.pool.query<StepRow>(
      "SELECT step_id, status, message, duration_ms FROM qa_step_result WHERE run_id = $1 ORDER BY position", [runId]
    );
    const evidenceResult = await this.pool.query<EvidenceRow>(
      "SELECT * FROM qa_step_evidence_reference WHERE run_id = $1 ORDER BY created_at, evidence_id", [runId]
    );
    const refsByStep = new Map<string, EvidenceReference[]>();
    for (const evidence of evidenceResult.rows) {
      const refs = refsByStep.get(evidence.step_id) ?? [];
      refs.push(mapEvidence(evidence));
      refsByStep.set(evidence.step_id, refs);
    }
    return {
      runId: row.run_id, tenantId: row.tenant_id, testCaseId: row.test_case_id,
      testCaseVersion: row.test_case_version,
      target: { platform: row.platform, targetId: row.target_id }, status: row.status,
      startedAt: iso(row.started_at),
      ...(row.finished_at ? { finishedAt: iso(row.finished_at) } : {}),
      stepResults: stepResult.rows.map((step) => ({
        stepId: step.step_id, status: step.status, message: step.message, durationMs: step.duration_ms,
        ...(refsByStep.has(step.step_id) ? { evidenceRefs: refsByStep.get(step.step_id)! } : {})
      }))
    };
  }

  async attachEvidence(runId: string, stepId: string, tenantId: string, reference: EvidenceReference): Promise<TestRun | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const exists = await client.query(
        `SELECT 1 FROM qa_step_result AS step
         JOIN qa_test_run AS run ON run.run_id = step.run_id
         WHERE step.run_id = $1 AND step.step_id = $2 AND run.tenant_id = $3`,
        [runId, stepId, tenantId]
      );
      if (exists.rowCount !== 1) {
        await client.query("ROLLBACK");
        return undefined;
      }
      await this.insertEvidence(client, runId, stepId, reference);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    return this.get(runId, tenantId);
  }

  private async insertEvidence(client: PoolClient, runId: string, stepId: string, reference: EvidenceReference): Promise<void> {
    await client.query(
      `INSERT INTO qa_step_evidence_reference
       (run_id, step_id, source_system, evidence_id, contract_version, kind, content_type, byte_size, sha256, storage_uri, captured_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (run_id, step_id, source_system, evidence_id) DO NOTHING`,
      [runId, stepId, reference.sourceSystem, reference.evidenceId, reference.contractVersion,
        reference.kind, reference.contentType, reference.byteSize, reference.sha256, reference.storageUri, reference.capturedAt]
    );
  }
}
