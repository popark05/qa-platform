import {
  FlowNotApprovedError, FlowNotFoundError, FlowSourceUnavailableError,
  type FlowSource, type WireflowFlowModelV1
} from "../domain/flow-reference.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORIGINS = ["product_requirement", "ai_suggestion", "open_question", "discovered"];
const CONTRACT_VERSIONS = ["1.0", "1.1"];
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max;

/** Structural check of the fields QA Platform relies on from flow-model v1.0/v1.1. */
function isFlowModelV1(value: unknown, flowId: string): value is WireflowFlowModelV1 {
  if (!isRecord(value) || !CONTRACT_VERSIONS.includes(String(value.contractVersion)) || value.sourceSystem !== "wireflow-review") return false;
  if (value.flowId !== flowId || !Number.isInteger(value.flowVersion) || (value.flowVersion as number) < 1) return false;
  if (!isText(value.applicationId, 200) || !isText(value.title, 240)) return false;
  const approval = value.approval;
  if (!isRecord(approval) || typeof approval.reviewId !== "string" || !UUID.test(approval.reviewId) ||
      !isText(approval.reviewerId, 200) || typeof approval.approvedAt !== "string" || Number.isNaN(Date.parse(approval.approvedAt))) return false;
  if (!Array.isArray(value.nodes) || value.nodes.length === 0 || !Array.isArray(value.edges)) return false;
  const nodeIds = new Set<string>();
  for (const node of value.nodes) {
    if (!isRecord(node) || !isText(node.nodeId, 200) || !isText(node.title, 240) || !ORIGINS.includes(String(node.origin))) return false;
    nodeIds.add(node.nodeId as string);
  }
  return value.edges.every((edge) => isRecord(edge) && isText(edge.edgeId, 200) &&
    nodeIds.has(String(edge.fromNodeId)) && nodeIds.has(String(edge.toNodeId)) && ORIGINS.includes(String(edge.origin)));
}

/** Pulls approved flow snapshots from Wireflow Review, the system of record for flow approval. */
export class WireflowFlowClient implements FlowSource {
  private readonly baseUrl: URL;
  constructor(baseUrl: string, private readonly fetcher: typeof fetch = fetch) {
    this.baseUrl = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    if (this.baseUrl.protocol !== "http:" && this.baseUrl.protocol !== "https:") {
      throw new Error("WIREFLOW_BASE_URL must use http or https");
    }
  }

  async fetchApprovedFlow(flowId: string): Promise<WireflowFlowModelV1> {
    let response: Response;
    try {
      response = await this.fetcher(new URL(`v1/flows/${encodeURIComponent(flowId)}/export`, this.baseUrl), {
        headers: { accept: "application/json" }
      });
    } catch {
      throw new FlowSourceUnavailableError("wireflow_request_failed");
    }
    if (response.status === 404) throw new FlowNotFoundError(flowId);
    if (response.status === 409) throw new FlowNotApprovedError(flowId);
    if (!response.ok) throw new FlowSourceUnavailableError(`wireflow_http_${response.status}`);
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new FlowSourceUnavailableError("wireflow_invalid_json"); }
    if (!isFlowModelV1(payload, flowId)) throw new FlowSourceUnavailableError("wireflow_invalid_flow_model");
    return payload;
  }
}
