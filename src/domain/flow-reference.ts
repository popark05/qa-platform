import type { TestStep } from "./test-case.js";

type Origin = "product_requirement" | "ai_suggestion" | "open_question";

/** Wireflow Review flow-model v1 (wireflow-review/contracts/flow-model.v1.schema.json). Only approved flows are published. */
export interface WireflowFlowModelV1 {
  contractVersion: "1.0";
  sourceSystem: "wireflow-review";
  flowId: string;
  flowVersion: number;
  applicationId: string;
  title: string;
  description?: string;
  approval: { reviewId: string; reviewerId: string; approvedAt: string };
  nodes: Array<{ nodeId: string; type: "screen" | "decision" | "external"; title: string; origin: Origin }>;
  edges: Array<{
    edgeId: string; fromNodeId: string; toNodeId: string;
    kind: "primary" | "back" | "cancel" | "retry" | "empty" | "failure";
    label?: string; trigger?: string; origin: Origin;
    discoveryRef?: { sourceSystem: "reverse-screen"; transitionId?: string };
  }>;
  exportedAt: string;
}

/** Case-level provenance: the exact approved flow snapshot a Test Case was generated from. */
export interface FlowReference {
  sourceSystem: "wireflow-review";
  contractVersion: "1.0";
  flowId: string;
  flowVersion: number;
  applicationId: string;
  approvalReviewId: string;
}

/** Step-level provenance: the flow edge (and Reverse Screen transition, when known) a step verifies. */
export interface StepFlowReference {
  edgeId: string;
  transitionId?: string;
}

export interface FlowSource {
  fetchApprovedFlow(flowId: string): Promise<WireflowFlowModelV1>;
}

export class FlowNotFoundError extends Error {
  constructor(flowId: string) { super(`flow_not_found:${flowId}`); this.name = "FlowNotFoundError"; }
}
export class FlowNotApprovedError extends Error {
  constructor(flowId: string) { super(`flow_not_approved:${flowId}`); this.name = "FlowNotApprovedError"; }
}
export class FlowSourceUnavailableError extends Error {
  constructor(message = "flow_source_unavailable") { super(message); this.name = "FlowSourceUnavailableError"; }
}

export interface GeneratedFlowTestCase {
  title: string;
  description: string;
  steps: TestStep[];
  flowRef: FlowReference;
  skippedEdges: Array<{ edgeId: string; reason: "open_question" }>;
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/**
 * Turns an approved flow into one Test Case whose steps cover every eligible edge once.
 * Steps follow a greedy walk from the first node (continue from the current screen when
 * possible, otherwise jump to the next uncovered edge), and every instruction names its
 * starting screen so a jump is explicit. Elements marked open_question are unresolved
 * product decisions and are never turned into test steps.
 */
export function generateTestCaseFromFlow(flow: WireflowFlowModelV1): GeneratedFlowTestCase {
  const nodes = new Map(flow.nodes.map((node) => [node.nodeId, node]));
  const skippedEdges: GeneratedFlowTestCase["skippedEdges"] = [];
  const eligible = flow.edges.filter((edge) => {
    const open = edge.origin === "open_question" ||
      nodes.get(edge.fromNodeId)?.origin === "open_question" || nodes.get(edge.toNodeId)?.origin === "open_question";
    if (open) skippedEdges.push({ edgeId: edge.edgeId, reason: "open_question" });
    return !open;
  });

  const ordered: typeof eligible = [];
  const remaining = [...eligible];
  let current = flow.nodes[0]?.nodeId;
  while (remaining.length > 0) {
    const index = Math.max(0, remaining.findIndex((edge) => edge.fromNodeId === current));
    const [edge] = remaining.splice(index, 1);
    ordered.push(edge!);
    current = edge!.toNodeId;
  }

  const steps: TestStep[] = ordered.map((edge) => {
    const from = nodes.get(edge.fromNodeId)?.title ?? edge.fromNodeId;
    const to = nodes.get(edge.toNodeId)?.title ?? edge.toNodeId;
    const trigger = edge.trigger ?? "tap";
    const doWhat = trigger === "back" || edge.kind === "back"
      ? "go back"
      : `${trigger} "${edge.label ?? edge.edgeId}"`;
    return {
      stepId: `edge-${edge.edgeId}`,
      instruction: clip(`On "${from}", ${doWhat}`, 2000),
      expectedResult: clip(`"${to}" is shown`, 2000),
      flowRef: {
        edgeId: edge.edgeId,
        ...(edge.discoveryRef?.transitionId ? { transitionId: edge.discoveryRef.transitionId } : {})
      }
    };
  });

  return {
    title: clip(`Verify flow: ${flow.title}`, 240),
    description: clip(
      `Generated from Wireflow Review flow ${flow.flowId} v${flow.flowVersion}, approved by ` +
      `${flow.approval.reviewerId} at ${flow.approval.approvedAt}. Covers ${steps.length} of ${flow.edges.length} edges` +
      (skippedEdges.length ? `; ${skippedEdges.length} open-question edge(s) skipped.` : "."), 4000),
    steps,
    flowRef: {
      sourceSystem: "wireflow-review", contractVersion: "1.0", flowId: flow.flowId,
      flowVersion: flow.flowVersion, applicationId: flow.applicationId, approvalReviewId: flow.approval.reviewId
    },
    skippedEdges
  };
}
