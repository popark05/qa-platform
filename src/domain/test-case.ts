import { randomUUID } from "node:crypto";

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

export class TestCaseStore {
  private readonly cases = new Map<string, TestCase>();
  private readonly reviews: ReviewRecord[] = [];

  create(input: Pick<TestCase, "title" | "description" | "source" | "steps">): TestCase {
    const now = new Date().toISOString();
    const testCase: TestCase = {
      testCaseId: randomUUID(),
      version: 1,
      ...input,
      status: input.source === "ai" ? "pending_review" : "draft",
      createdAt: now,
      updatedAt: now
    };
    this.cases.set(testCase.testCaseId, testCase);
    return testCase;
  }

  get(testCaseId: string): TestCase | undefined {
    return this.cases.get(testCaseId);
  }

  list(): TestCase[] {
    return [...this.cases.values()];
  }

  review(testCaseId: string, reviewerId: string, decision: "approved" | "rejected", comment?: string): ReviewRecord | undefined {
    const current = this.cases.get(testCaseId);
    if (!current || current.status !== "pending_review") return undefined;

    const review: ReviewRecord = {
      reviewId: randomUUID(),
      testCaseId,
      version: current.version,
      reviewerId,
      decision,
      ...(comment === undefined ? {} : { comment }),
      reviewedAt: new Date().toISOString()
    };
    this.reviews.push(review);
    this.cases.set(testCaseId, { ...current, status: decision, updatedAt: review.reviewedAt });
    return review;
  }
}
