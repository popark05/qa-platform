import { createHash } from "node:crypto";
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
interface ReverseScreenDownloadPayload { evidence_id?: unknown; download_url?: unknown; expires_in_seconds?: unknown }

export class ReverseScreenEvidenceClient implements EvidenceResolver {
  private readonly baseUrl: URL;
  constructor(
    baseUrl: string,
    private readonly serviceToken: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly maxEvidenceBytes = 20 * 1024 * 1024
  ) {
    this.baseUrl = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    if (this.baseUrl.protocol !== "http:" && this.baseUrl.protocol !== "https:") {
      throw new Error("REVERSE_SCREEN_BASE_URL must use http or https");
    }
    if (Buffer.byteLength(serviceToken) < 32) {
      throw new Error("REVERSE_SCREEN_SERVICE_TOKEN must contain at least 32 bytes");
    }
    if (!Number.isSafeInteger(maxEvidenceBytes) || maxEvidenceBytes < 1) {
      throw new Error("maxEvidenceBytes must be a positive safe integer");
    }
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

    if (payload.byte_size > this.maxEvidenceBytes) {
      throw new EvidenceSourceUnavailableError("reverse_screen_evidence_too_large");
    }

    let downloadResponse: Response;
    try {
      downloadResponse = await this.fetcher(new URL(`v1/evidence-artifacts/${encodeURIComponent(evidenceId)}/download-url`, this.baseUrl), {
        headers: { accept: "application/json", authorization: `Bearer ${this.serviceToken}` }
      });
    } catch {
      throw new EvidenceSourceUnavailableError("reverse_screen_download_url_request_failed");
    }
    if (downloadResponse.status === 404) throw new EvidenceNotFoundError(evidenceId);
    if (!downloadResponse.ok) throw new EvidenceSourceUnavailableError(`reverse_screen_download_url_http_${downloadResponse.status}`);
    let downloadPayload: ReverseScreenDownloadPayload;
    try { downloadPayload = await downloadResponse.json() as ReverseScreenDownloadPayload; }
    catch { throw new EvidenceSourceUnavailableError("reverse_screen_invalid_download_url_response"); }
    if (downloadPayload.evidence_id !== evidenceId || typeof downloadPayload.download_url !== "string") {
      throw new EvidenceSourceUnavailableError("reverse_screen_invalid_download_url_response");
    }
    let binaryUrl: URL;
    try { binaryUrl = new URL(downloadPayload.download_url); }
    catch { throw new EvidenceSourceUnavailableError("reverse_screen_invalid_download_url"); }
    if (binaryUrl.protocol !== "http:" && binaryUrl.protocol !== "https:") {
      throw new EvidenceSourceUnavailableError("reverse_screen_invalid_download_url");
    }
    let binaryResponse: Response;
    try { binaryResponse = await this.fetcher(binaryUrl, { headers: { accept: payload.content_type } }); }
    catch { throw new EvidenceSourceUnavailableError("reverse_screen_binary_request_failed"); }
    if (!binaryResponse.ok || !binaryResponse.body) {
      throw new EvidenceSourceUnavailableError(`reverse_screen_binary_http_${binaryResponse.status}`);
    }
    const contentType = binaryResponse.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== payload.content_type.toLowerCase()) {
      await binaryResponse.body.cancel();
      throw new EvidenceSourceUnavailableError("reverse_screen_binary_content_type_mismatch");
    }
    const declaredLength = binaryResponse.headers.get("content-length");
    if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) !== payload.byte_size)) {
      await binaryResponse.body.cancel();
      throw new EvidenceSourceUnavailableError("reverse_screen_binary_size_mismatch");
    }
    const digest = createHash("sha256");
    const reader = binaryResponse.body.getReader();
    let actualSize = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        actualSize += part.value.byteLength;
        if (actualSize > this.maxEvidenceBytes || actualSize > payload.byte_size) {
          await reader.cancel();
          throw new EvidenceSourceUnavailableError("reverse_screen_binary_size_mismatch");
        }
        digest.update(part.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      if (error instanceof EvidenceSourceUnavailableError) throw error;
      throw new EvidenceSourceUnavailableError("reverse_screen_binary_read_failed");
    }
    if (actualSize !== payload.byte_size) throw new EvidenceSourceUnavailableError("reverse_screen_binary_size_mismatch");
    if (digest.digest("hex") !== payload.sha256) throw new EvidenceSourceUnavailableError("reverse_screen_binary_checksum_mismatch");

    return {
      contractVersion: "1.0", sourceSystem: "reverse-screen", evidenceId,
      kind: payload.kind as EvidenceReference["kind"], contentType: payload.content_type,
      byteSize: payload.byte_size, sha256: payload.sha256, storageUri: payload.storage_uri,
      capturedAt: new Date(payload.captured_at).toISOString()
    };
  }
}
