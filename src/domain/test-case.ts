import { randomUUID } from "node:crypto";
import type { NewTestCase, NewTestCaseVersion, TestCaseRepository } from "./test-case-repository.js";

export type AuthoringSource = "manual" | "ai";
export type TestCaseStatus = "draft" | "pending_review" | "approved" | "rejected";

export interface TestStep {
  stepId: string;
  instruction: string;
  action?: string;
  expectedResult?: string;
}

export interface TestCase {
  testCaseId: string;
  version: number;
  title: string;
  description?: string;
  source: AuthoringSource;
  status: TestCaseStatus;
  steps: TestStep[];
  createdAt: string;
  updatedAt: string;
}

export interface ReviewRecord {
  reviewId: string;
  testCaseId: string;
  version: number;
  reviewerId: string;
  decision: "approved" | "rejected";
  comment?: string;
  reviewedAt: string;
}

export class InMemoryTestCaseRepository implements TestCaseRepository {
  private readonly current = new Map<string, TestCase>();
  private readonly versions = new Map<string, Map<number, TestCase>>();
  private readonly reviews = new Map<string, ReviewRecord[]>();

  async create(input: NewTestCase): Promise<TestCase> {
    const now = new Date().toISOString();
    const testCase: TestCase = {
      testCaseId: randomUUID(), version: 1, ...structuredClone(input),
      status: input.source === "ai" ? "pending_review" : "draft",
      createdAt: now, updatedAt: now
    };
    this.current.set(testCase.testCaseId, testCase);
    this.versions.set(testCase.testCaseId, new Map([[1, structuredClone(testCase)]]));
    this.reviews.set(testCase.testCaseId, []);
    return structuredClone(testCase);
  }

  async get(testCaseId: string): Promise<TestCase | undefined> {
    const item = this.current.get(testCaseId);
    return item ? structuredClone(item) : undefined;
  }
  async list(): Promise<TestCase[]> { return [...this.current.values()].map((item) => structuredClone(item)); }

  async submitForReview(testCaseId: string, expectedVersion?: number): Promise<TestCase | undefined> {
    const item = this.current.get(testCaseId);
    if (!item || item.status !== "draft" || (expectedVersion !== undefined && item.version !== expectedVersion)) return undefined;
    const updated = { ...item, status: "pending_review" as const, updatedAt: new Date().toISOString() };
    this.current.set(testCaseId, updated);
    return structuredClone(updated);
  }

  async review(testCaseId: string, reviewerId: string, decision: "approved" | "rejected", comment?: string, expectedVersion?: number): Promise<ReviewRecord | undefined> {
    const item = this.current.get(testCaseId);
    if (!item || item.status !== "pending_review" || (expectedVersion !== undefined && item.version !== expectedVersion)) return undefined;
    const review: ReviewRecord = {
      reviewId: randomUUID(), testCaseId, version: item.version, reviewerId, decision,
      ...(comment === undefined ? {} : { comment }), reviewedAt: new Date().toISOString()
    };
    this.reviews.get(testCaseId)?.push(review);
    this.current.set(testCaseId, { ...item, status: decision, updatedAt: review.reviewedAt });
    return structuredClone(review);
  }

  async createVersion(testCaseId: string, input: NewTestCaseVersion): Promise<TestCase | undefined> {
    const item = this.current.get(testCaseId);
    if (!item || item.status === "pending_review" || item.version !== input.expectedVersion) return undefined;
    const next: TestCase = {
      testCaseId, version: item.version + 1, title: input.title,
      ...(input.description === undefined ? {} : { description: input.description }),
      source: item.source, status: "draft", steps: structuredClone(input.steps),
      createdAt: item.createdAt, updatedAt: new Date().toISOString()
    };
    this.versions.get(testCaseId)?.set(next.version, structuredClone(next));
    this.current.set(testCaseId, next);
    return structuredClone(next);
  }

  async listReviews(testCaseId: string): Promise<ReviewRecord[]> {
    return structuredClone(this.reviews.get(testCaseId) ?? []);
  }
}
