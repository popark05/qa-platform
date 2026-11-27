import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ReviewRecord, TestCase, TestCaseStatus, TestStep } from "../domain/test-case.js";
import type { NewTestCase, NewTestCaseVersion, TestCaseRepository } from "../domain/test-case-repository.js";

interface CaseRow {
  test_case_id: string; current_version: number; source: "manual" | "ai"; status: TestCaseStatus;
  created_at: Date | string; updated_at: Date | string;
  version: number; title: string; description: string | null; steps: TestStep[] | string;
  version_source: "manual" | "ai"; version_created_at: Date | string;
}
interface ReviewRow {
  review_id: string; test_case_id: string; version: number; reviewer_id: string;
  decision: "approved" | "rejected"; comment: string | null; reviewed_at: Date | string;
}
const iso = (value: Date | string) => new Date(value).toISOString();
const parseSteps = (value: TestStep[] | string): TestStep[] => typeof value === "string" ? JSON.parse(value) as TestStep[] : value;
const mapCase = (row: CaseRow): TestCase => ({
  testCaseId: row.test_case_id, version: row.version, title: row.title,
  ...(row.description === null ? {} : { description: row.description }),
  source: row.version_source, status: row.status, steps: parseSteps(row.steps),
  createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
});
const mapReview = (row: ReviewRow): ReviewRecord => ({
  reviewId: row.review_id, testCaseId: row.test_case_id, version: row.version,
  reviewerId: row.reviewer_id, decision: row.decision,
  ...(row.comment === null ? {} : { comment: row.comment }), reviewedAt: iso(row.reviewed_at)
});
const currentSelect = `SELECT c.test_case_id, c.current_version, c.source, c.status, c.created_at, c.updated_at,
  v.version, v.title, v.description, v.source AS version_source, v.steps, v.created_at AS version_created_at
  FROM qa_test_case c JOIN qa_test_case_version v
  ON v.test_case_id = c.test_case_id AND v.version = c.current_version`;

export class PostgresTestCaseRepository implements TestCaseRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: NewTestCase): Promise<TestCase> {
    const client = await this.pool.connect();
    const id = randomUUID();
    const now = new Date().toISOString();
    const status: TestCaseStatus = input.source === "ai" ? "pending_review" : "draft";
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO qa_test_case (test_case_id, current_version, source, status, created_at, updated_at) VALUES ($1, 1, $2, $3, $4, $4)",
        [id, input.source, status, now]
      );
      await client.query(
        "INSERT INTO qa_test_case_version (test_case_id, version, title, description, source, steps, created_at) VALUES ($1, 1, $2, $3, $4, $5::jsonb, $6)",
        [id, input.title, input.description ?? null, input.source, JSON.stringify(input.steps), now]
      );
      if (status === "pending_review") {
        await client.query(
          "INSERT INTO qa_test_case_submission (submission_id, test_case_id, version, submitted_at) VALUES ($1, $2, 1, $3)",
          [randomUUID(), id, now]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    const created = await this.get(id);
    if (!created) throw new Error("test_case_not_found_after_create");
    return created;
  }

  async get(testCaseId: string): Promise<TestCase | undefined> {
    const result = await this.pool.query<CaseRow>(`${currentSelect} WHERE c.test_case_id = $1`, [testCaseId]);
    return result.rows[0] ? mapCase(result.rows[0]) : undefined;
  }

  async list(): Promise<TestCase[]> {
    const result = await this.pool.query<CaseRow>(`${currentSelect} ORDER BY c.updated_at DESC, c.test_case_id`);
    return result.rows.map(mapCase);
  }

  async submitForReview(testCaseId: string, expectedVersion?: number): Promise<TestCase | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ current_version: number; status: TestCaseStatus }>(
        "SELECT current_version, status FROM qa_test_case WHERE test_case_id = $1 FOR UPDATE", [testCaseId]
      );
      const row = locked.rows[0];
      if (!row || row.status !== "draft" || (expectedVersion !== undefined && row.current_version !== expectedVersion)) {
        await client.query("ROLLBACK"); return undefined;
      }
      const now = new Date().toISOString();
      await client.query(
        "INSERT INTO qa_test_case_submission (submission_id, test_case_id, version, submitted_at) VALUES ($1, $2, $3, $4)",
        [randomUUID(), testCaseId, row.current_version, now]
      );
      await client.query("UPDATE qa_test_case SET status = 'pending_review', updated_at = $2 WHERE test_case_id = $1", [testCaseId, now]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
    return this.get(testCaseId);
  }

  async review(testCaseId: string, reviewerId: string, decision: "approved" | "rejected", comment?: string, expectedVersion?: number): Promise<ReviewRecord | undefined> {
    const client = await this.pool.connect();
    const reviewId = randomUUID();
    const now = new Date().toISOString();
    let reviewedVersion = 0;
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ current_version: number; status: TestCaseStatus }>(
        "SELECT current_version, status FROM qa_test_case WHERE test_case_id = $1 FOR UPDATE", [testCaseId]
      );
      const row = locked.rows[0];
      if (!row || row.status !== "pending_review" || (expectedVersion !== undefined && row.current_version !== expectedVersion)) {
        await client.query("ROLLBACK"); return undefined;
      }
      reviewedVersion = row.current_version;
      await client.query(
        "INSERT INTO qa_test_case_review (review_id, test_case_id, version, reviewer_id, decision, comment, reviewed_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [reviewId, testCaseId, reviewedVersion, reviewerId, decision, comment ?? null, now]
      );
      await client.query("UPDATE qa_test_case SET status = $2, updated_at = $3 WHERE test_case_id = $1", [testCaseId, decision, now]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
    return {
      reviewId, testCaseId, version: reviewedVersion, reviewerId, decision,
      ...(comment === undefined ? {} : { comment }), reviewedAt: now
    };
  }

  async createVersion(testCaseId: string, input: NewTestCaseVersion): Promise<TestCase | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ current_version: number; status: TestCaseStatus; source: "manual" | "ai" }>(
        "SELECT current_version, status, source FROM qa_test_case WHERE test_case_id = $1 FOR UPDATE", [testCaseId]
      );
      const row = locked.rows[0];
      if (!row || row.status === "pending_review" || row.current_version !== input.expectedVersion) {
        await client.query("ROLLBACK"); return undefined;
      }
      const nextVersion = row.current_version + 1;
      const now = new Date().toISOString();
      await client.query(
        "INSERT INTO qa_test_case_version (test_case_id, version, title, description, source, steps, created_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)",
        [testCaseId, nextVersion, input.title, input.description ?? null, row.source, JSON.stringify(input.steps), now]
      );
      await client.query(
        "UPDATE qa_test_case SET current_version = $2, status = 'draft', updated_at = $3 WHERE test_case_id = $1",
        [testCaseId, nextVersion, now]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
    return this.get(testCaseId);
  }

  async listReviews(testCaseId: string): Promise<ReviewRecord[]> {
    const result = await this.pool.query<ReviewRow>(
      "SELECT review_id, test_case_id, version, reviewer_id, decision, comment, reviewed_at FROM qa_test_case_review WHERE test_case_id = $1 ORDER BY reviewed_at, review_id",
      [testCaseId]
    );
    return result.rows.map(mapReview);
  }
}
