import type { AuthoringSource, ReviewRecord, TestCase, TestStep } from "./test-case.js";

export interface NewTestCase {
  title: string;
  description?: string;
  source: AuthoringSource;
  steps: TestStep[];
}
export interface NewTestCaseVersion {
  expectedVersion: number;
  title: string;
  description?: string;
  steps: TestStep[];
}
export interface TestCaseRepository {
  create(input: NewTestCase): Promise<TestCase>;
  get(testCaseId: string): Promise<TestCase | undefined>;
  list(): Promise<TestCase[]>;
  submitForReview(testCaseId: string, expectedVersion?: number): Promise<TestCase | undefined>;
  review(testCaseId: string, reviewerId: string, decision: "approved" | "rejected", comment?: string, expectedVersion?: number): Promise<ReviewRecord | undefined>;
  createVersion(testCaseId: string, input: NewTestCaseVersion): Promise<TestCase | undefined>;
  listReviews(testCaseId: string): Promise<ReviewRecord[]>;
}
