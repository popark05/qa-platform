import type { AuthoringSource, ReviewRecord, TestCase, TestStep } from "./test-case.js";
import type { FlowReference } from "./flow-reference.js";

export interface NewTestCase {
  tenantId: string;
  title: string;
  description?: string;
  source: AuthoringSource;
  steps: TestStep[];
  flowRef?: FlowReference;
}
export interface NewTestCaseVersion {
  expectedVersion: number;
  title: string;
  description?: string;
  steps: TestStep[];
}
export interface TestCaseRepository {
  create(input: NewTestCase): Promise<TestCase>;
  get(testCaseId: string, tenantId: string): Promise<TestCase | undefined>;
  list(tenantId: string): Promise<TestCase[]>;
  submitForReview(testCaseId: string, tenantId: string, expectedVersion?: number): Promise<TestCase | undefined>;
  review(testCaseId: string, tenantId: string, reviewerId: string, decision: "approved" | "rejected", comment?: string, expectedVersion?: number): Promise<ReviewRecord | undefined>;
  createVersion(testCaseId: string, tenantId: string, input: NewTestCaseVersion): Promise<TestCase | undefined>;
  listReviews(testCaseId: string, tenantId: string): Promise<ReviewRecord[]>;
}
