import { guardedFetch, formatAdminApiError } from "./error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { isRetryExpired, type PendingMutationRecord } from "./pending-mutation-store";

export type ECommandLocator = {
  commandKey: string; originalMethod: "POST" | "PUT"; originalPath: string; originalAdminId: string;
};
export type ECommandInvestigation = {
  originalRecordId: number;
  scope: string;
  commandKey: string;
  requestHash: string;
  originalMethod: string;
  originalPath: string;
  originalTarget: string | null;
  originalTargets: string | null;
  originalAdminId: number;
  originalStatus: "PROCESSING" | "UNKNOWN" | "SUCCEEDED" | "FAILED" | "CONFIRMED_SUCCEEDED" | "CONFIRMED_NOT_EXECUTED";
  locked: boolean;
  newOperationAllowed: boolean;
  investigation: {
    id: number; conclusion: "SUCCEEDED" | "NOT_EXECUTED" | "STILL_UNKNOWN";
    requestedConclusion: string; evidenceReference: string; evidenceType: string;
    investigatorId: number; investigatedAt: string;
  } | null;
};
export type ECommandEvidence = {
  conclusion: "SUCCEEDED" | "NOT_EXECUTED" | "STILL_UNKNOWN";
  evidenceReference: string;
  evidenceAuditId?: number;
};

/** A retained completed response settles the command; only confirmed nonexecution authorizes replacement. */
export function eCommandSettled(receipt: ECommandInvestigation | null) {
  return !!receipt && !receipt.locked && (["SUCCEEDED", "CONFIRMED_SUCCEEDED"].includes(receipt.originalStatus)
    || receipt.originalStatus === "CONFIRMED_NOT_EXECUTED" && receipt.newOperationAllowed);
}

/** UI eligibility only; the endpoint also enforces active employment, original read scope and evidence. */
export function canInvestigateECommand(authority: "device_e2_read" | "device_e5_read" | "device_e6_read") {
  const session = useAdminAuth.getState().session;
  return session?.role === "superadmin" && session.authorities.includes("platform_a2_unknown_investigate")
    && session.authorities.includes(authority);
}

function parseReceipt(value: unknown, locator: ECommandLocator): ECommandInvestigation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.originalRecordId) || Number(row.originalRecordId) < 1
    || typeof row.scope !== "string" || !(/^(E2_POOL_|E5_DEVICE_)/.test(row.scope) || row.scope === "E6_PHONE_RISK_SETTINGS")
    || row.commandKey !== locator.commandKey || row.originalMethod !== locator.originalMethod || row.originalPath !== locator.originalPath
    || !Number.isSafeInteger(row.originalAdminId) || Number(row.originalAdminId) < 1
    || String(row.originalAdminId) !== locator.originalAdminId
    || typeof row.requestHash !== "string" || !/^[a-fA-F0-9]{64}$/.test(row.requestHash)
    || row.originalTarget !== null && typeof row.originalTarget !== "string"
    || row.originalTargets !== null && typeof row.originalTargets !== "string"
    || !["PROCESSING", "UNKNOWN", "SUCCEEDED", "FAILED", "CONFIRMED_SUCCEEDED", "CONFIRMED_NOT_EXECUTED"].includes(String(row.originalStatus))
    || row.locked !== ["PROCESSING", "UNKNOWN"].includes(String(row.originalStatus))
    || row.newOperationAllowed !== (row.originalStatus === "CONFIRMED_NOT_EXECUTED")) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  if (row.investigation !== null) {
    if (!row.investigation || typeof row.investigation !== "object" || Array.isArray(row.investigation)) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
    const entry = row.investigation as Record<string, unknown>;
    if (!Number.isSafeInteger(entry.id) || !["SUCCEEDED", "NOT_EXECUTED", "STILL_UNKNOWN"].includes(String(entry.conclusion))
      || typeof entry.evidenceReference !== "string" || typeof entry.evidenceType !== "string"
      || !Number.isSafeInteger(entry.investigatorId) || typeof entry.investigatedAt !== "string") throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  }
  return row as ECommandInvestigation;
}

async function request(path: string, body?: object): Promise<unknown> {
  const response = await guardedFetch(`/api/admin/commands/investigations${path}`, {
    method: body ? "POST" : "GET", cache: "no-store",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  if (response.headers.get("X-Nexion-Upstream-Outcome")?.toLowerCase() === "unknown") throw new Error("IDEMPOTENCY_RESULT_UNKNOWN");
  const raw: unknown = await response.json();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  const envelope = raw as { code?: unknown; message?: unknown; data?: unknown };
  if (!response.ok || envelope.code !== 0) {
    const code = typeof envelope.message === "string" ? envelope.message : "";
    throw Object.assign(new Error(formatAdminApiError(code, "INVESTIGATION_RECEIPT_UNREADABLE")), {
      status: response.ok && typeof envelope.code === "number" ? envelope.code : response.status, backendMessage: code,
    });
  }
  return envelope.data;
}

/** The backend discovers scope/hash/targets. No client reproduction of a business hash is used. */
export async function discoverECommand(locator: ECommandLocator): Promise<ECommandInvestigation | null> {
  const params = new URLSearchParams({ commandKey: locator.commandKey, originalMethod: locator.originalMethod, originalPath: locator.originalPath });
  const result = await request(`/by-command-key?${params}`);
  if (!Array.isArray(result) || result.length > 1) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  return result.length ? parseReceipt(result[0], locator) : null;
}

/** Missing receipts, forbidden reads, processing writers and insufficient evidence never release a local record. */
export async function investigateECommand(record: PendingMutationRecord, locator: ECommandLocator, evidence: ECommandEvidence) {
  const authority = locator.originalPath === "/api/admin/config/phone-calibration/risk" ? "device_e6_read"
    : locator.originalPath.includes("/task-pools/") ? "device_e2_read" : "device_e5_read";
  if (!canInvestigateECommand(authority)) throw Object.assign(new Error("COMMAND_INVESTIGATION_FORBIDDEN"), { status: 403, backendMessage: "COMMAND_INVESTIGATION_FORBIDDEN" });
  const original = await discoverECommand(locator);
  if (!original) throw new Error("INVESTIGATION_ORIGINAL_NOT_FOUND_REMAINS_LOCKED");
  if (!isRetryExpired(record) && !original.locked) throw new Error("INVESTIGATION_KNOWN_RESULT_CONFLICT");
  // All conclusion fields are requests for server verification, never a client-supplied result.
  return parseReceipt(await request("", {
    scope: original.scope, commandKey: original.commandKey, requestHash: original.requestHash,
    conclusion: evidence.conclusion, evidenceReference: evidence.evidenceReference,
    ...(evidence.evidenceAuditId === undefined ? {} : { evidenceAuditId: evidence.evidenceAuditId }),
  }), locator);
}
