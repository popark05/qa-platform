export const EVIDENCE_REFERENCE_KINDS = [
  "screenshot", "video", "dom_snapshot", "accessibility_tree", "log", "network_trace"
] as const;
export type EvidenceReferenceKind = (typeof EVIDENCE_REFERENCE_KINDS)[number];

export interface EvidenceReference {
  contractVersion: "1.0";
  sourceSystem: "reverse-screen";
  evidenceId: string;
  kind: EvidenceReferenceKind;
  contentType: string;
  byteSize: number;
  sha256: string;
  storageUri: string;
  capturedAt: string;
}

export class EvidenceNotFoundError extends Error {
  constructor(evidenceId: string) {
    super(`evidence_not_found:${evidenceId}`);
    this.name = "EvidenceNotFoundError";
  }
}
export class EvidenceSourceUnavailableError extends Error {
  constructor(message = "evidence_source_unavailable") {
    super(message);
    this.name = "EvidenceSourceUnavailableError";
  }
}
export interface EvidenceResolver {
  resolve(evidenceId: string): Promise<EvidenceReference>;
}
