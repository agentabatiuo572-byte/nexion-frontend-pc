export interface LegacyUnknownResolution {
  resolutionId: string;
  caseId: string;
  taskNo: string;
  deviceId: number;
  outcome: "ZERO_CREDIT_CANCELLED";
  taskStatus: "CANCELLED";
  credited: false;
  a2OperationId: string;
  resolvedAt: string;
}

export interface LegacyUnknownCandidate {
  eligible: boolean;
  reason: string;
  deviceId: number;
  caseId?: string;
  taskNo?: string;
  ownerId?: string;
  instanceNo?: string;
  requestGeneration?: 1;
  requestKeyHash?: string;
  requestBodyHash?: string;
  caseSetSha256?: string;
  backendInstanceId?: string;
  proofSha?: string | null;
  status?: "ELIGIBLE" | "QUIESCENCE_REQUIRED" | "BLOCKED" | "RESOLVED";
  resolution?: LegacyUnknownResolution | null;
}

function invalid(): never { throw new Error("LEGACY_UNKNOWN_RESPONSE_INVALID"); }
function text(value: unknown): string { return typeof value === "string" && value.trim() ? value : invalid(); }
function hash(value: unknown): string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : invalid(); }
function owner(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return typeof value === "string" && /^[1-9]\d*$/.test(value) ? value : invalid();
}

/** Eligibility is a backend fact. Device IDs and UNKNOWN status never grant it locally. */
export function parseLegacyUnknownCandidate(value: unknown, deviceId: number): LegacyUnknownCandidate {
  if (!value || typeof value !== "object") return invalid();
  const row = value as Record<string, unknown>;
  if (typeof row.eligible !== "boolean" || row.deviceId !== deviceId) return invalid();
  const result: LegacyUnknownCandidate = { eligible: row.eligible,
    reason: row.reason == null ? "" : typeof row.reason === "string" ? row.reason : invalid(), deviceId };
  if (!row.eligible && row.caseId == null) return result;
  if (!["ELIGIBLE", "QUIESCENCE_REQUIRED", "BLOCKED", "RESOLVED"].includes(String(row.status)) || row.requestGeneration !== 1) return invalid();
  Object.assign(result, {
    caseId: text(row.caseId), taskNo: text(row.taskNo), ownerId: owner(row.ownerId), instanceNo: text(row.instanceNo),
    requestGeneration: 1, requestKeyHash: hash(row.requestKeyHash), requestBodyHash: hash(row.requestBodyHash),
    caseSetSha256: hash(row.caseSetSha256), backendInstanceId: text(row.backendInstanceId),
    proofSha: row.proofSha == null ? null : hash(row.proofSha), status: row.status, resolution: null,
  });
  if (result.eligible && (result.status !== "ELIGIBLE" || !result.proofSha)) return invalid();
  if (row.resolution != null) {
    const saved = row.resolution as Record<string, unknown>;
    if (result.eligible || result.status !== "RESOLVED" || saved.caseId !== result.caseId || saved.taskNo !== result.taskNo
      || saved.deviceId !== deviceId || saved.outcome !== "ZERO_CREDIT_CANCELLED" || saved.taskStatus !== "CANCELLED" || saved.credited !== false) return invalid();
    result.resolution = { resolutionId: typeof saved.resolutionId === "number" ? owner(saved.resolutionId) : text(saved.resolutionId), caseId: result.caseId!, taskNo: result.taskNo!, deviceId,
      outcome: "ZERO_CREDIT_CANCELLED", taskStatus: "CANCELLED", credited: false,
      a2OperationId: text(saved.a2OperationId), resolvedAt: text(saved.resolvedAt) };
  }
  if (result.status === "RESOLVED" && !result.resolution) return invalid();
  return result;
}

export function sameLegacyUnknownProof(before: LegacyUnknownCandidate, after: LegacyUnknownCandidate): boolean {
  return before.eligible && after.eligible && before.deviceId === after.deviceId && before.caseId === after.caseId
    && before.taskNo === after.taskNo && before.ownerId === after.ownerId && before.instanceNo === after.instanceNo
    && before.requestGeneration === after.requestGeneration && before.requestKeyHash === after.requestKeyHash
    && before.requestBodyHash === after.requestBodyHash && before.caseSetSha256 === after.caseSetSha256
    && before.backendInstanceId === after.backendInstanceId && before.proofSha === after.proofSha;
}
