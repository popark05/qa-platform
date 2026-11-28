import {
  EVIDENCE_REFERENCE_KINDS, EvidenceNotFoundError, EvidenceSourceUnavailableError,
  type EvidenceReference, type EvidenceResolver
} from "../domain/evidence-reference.js";

interface ReverseScreenEvidencePayload {
  evidence_id?: unknown;
  kind?: unknown;
  content_type?: unknown;
  byte_size?: unknown;
  sha256?: unknown;
  storage_uri?: unknown;
  captured_at?: unknown;
}

export interface ReverseScreenEvidenceClientOptions {
  /** Shared service token matching Reverse Screen's REVERSE_SCREEN_QA_SERVICE_TOKEN (at least 32 bytes). */
  serviceToken: string;
  fetcher?: typeof fetch;
}

export class ReverseScreenEvidenceClient implements EvidenceResolver {
  private readonly baseUrl: URL;
  private readonly serviceToken: string;
  private readonly fetcher: typeof fetch;
  constructor(baseUrl: string, options: ReverseScreenEvidenceClientOptions) {
    this.baseUrl = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    if (this.baseUrl.protocol !== "http:" && this.baseUrl.protocol !== "https:") {
      throw new Error("REVERSE_SCREEN_BASE_URL must use http or https");
    }
    if (Buffer.byteLength(options.serviceToken) < 32) {
      throw new Error("REVERSE_SCREEN_SERVICE_TOKEN must contain at least 32 bytes");
    }
    this.serviceToken = options.serviceToken;
    this.fetcher = options.fetcher ?? fetch;
  }

  async resolve(evidenceId: string): Promise<EvidenceReference> {
    let response: Response;
    try {
      response = await this.fetcher(new URL(`v1/evidence-artifacts/${encodeURIComponent(evidenceId)}`, this.baseUrl), {
        headers: { accept: "application/json", authorization: `Bearer ${this.serviceToken}` }
      });
    } catch {
      throw new EvidenceSourceUnavailableError("reverse_screen_request_failed");
    }
    if (response.status === 404) throw new EvidenceNotFoundError(evidenceId);
    if (response.status === 401 || response.status === 403) {
      throw new EvidenceSourceUnavailableError("reverse_screen_service_auth_rejected");
    }
    if (!response.ok) throw new EvidenceSourceUnavailableError(`reverse_screen_http_${response.status}`);

    let payload: ReverseScreenEvidencePayload;
    try { payload = await response.json() as ReverseScreenEvidencePayload; }
    catch { throw new EvidenceSourceUnavailableError("reverse_screen_invalid_json"); }

    if (payload.evidence_id !== evidenceId ||
        typeof payload.kind !== "string" ||
        !EVIDENCE_REFERENCE_KINDS.includes(payload.kind as EvidenceReference["kind"]) ||
        typeof payload.content_type !== "string" ||
        typeof payload.byte_size !== "number" || !Number.isSafeInteger(payload.byte_size) || payload.byte_size < 1 ||
        typeof payload.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(payload.sha256) ||
        typeof payload.storage_uri !== "string" || !/^s3:\/\/[^/]+\/.+/.test(payload.storage_uri) ||
        typeof payload.captured_at !== "string" || Number.isNaN(Date.parse(payload.captured_at))) {
      throw new EvidenceSourceUnavailableError("reverse_screen_invalid_evidence_metadata");
    }

    return {
      contractVersion: "1.0", sourceSystem: "reverse-screen", evidenceId,
      kind: payload.kind as EvidenceReference["kind"], contentType: payload.content_type,
      byteSize: payload.byte_size, sha256: payload.sha256, storageUri: payload.storage_uri,
      capturedAt: new Date(payload.captured_at).toISOString()
    };
  }
}
