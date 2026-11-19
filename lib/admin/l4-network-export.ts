import { createPendingMutationStore, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "./pending-mutation-store";
import { visibleReasonLength } from "./a2-client";
import { downloadL4NetworkFile, lBiActions, LOutcomeUnknownError, type LNetworkTreeExportResult } from "./l-client";
import { formatAdminApiError } from "./error-messages";
import { isExplicitRejection } from "./explicit-rejection";

export type L4NetworkRequest = { period: "day" | "week" | "month"; depth: number; reason: string };
export type PendingL4NetworkExport = PendingMutationRecord & {
  owner: string;
  request: L4NetworkRequest;
  scope: string;
  relationships: number;
  result?: LNetworkTreeExportResult;
  grantRequested?: boolean;
  downloadToken?: string;
};

const STORAGE_KEY = "nexion-admin-l4-network-commands-v1";

/** The header advice counts the encoded header before the controller decodes it (111e00cd). */
export const networkReasonLength = (reason: string) => visibleReasonLength(encodeURIComponent(reason.trim()));

// The original creation and any legacy download stages retain their existing storage key.
export const l4NetworkCommands = createPendingMutationStore<PendingL4NetworkExport>({
  storageKey: STORAGE_KEY,
  retainExpiredRecords: true,
  isValidRecord(record) {
    const request = record.request;
    const result = record.result;
    return typeof record.owner === "string" && record.owner.length > 0
      && !!request && typeof request === "object" && !Array.isArray(request)
      && ["day", "week", "month"].includes(request.period)
      && Number.isInteger(request.depth) && request.depth >= 1 && request.depth <= 10
      && typeof request.reason === "string" && request.reason.trim().length > 0
      && record.fingerprint === JSON.stringify(request)
      && typeof record.scope === "string" && record.scope.length > 0
      && Number.isSafeInteger(record.relationships) && record.relationships >= 0
      && (result === undefined || !!result && typeof result === "object" && !Array.isArray(result)
        && typeof result.reportId === "string" && /^L4TREE-[A-Z0-9]{8}$/.test(result.reportId)
        && (result.status === "READY" || result.status === "PENDING_CONFIRM")
        && Number.isSafeInteger(result.rowCount) && result.rowCount > 0
        && result.rowCount <= 100_000 && result.containsPii === true
        && result.maskingPolicy === "PARTIAL" && result.downloadTtlHours === 24)
      && (record.grantRequested === undefined || typeof record.grantRequested === "boolean")
      && (record.downloadToken === undefined || typeof record.downloadToken === "string" && record.downloadToken.length > 0)
      && (!record.grantRequested || result?.status === "READY")
      && (record.downloadToken === undefined || record.grantRequested === true);
  },
});

/** Check the entire persisted stage, including a received report/token, before proceeding. */
export function isL4NetworkDurable(record: PendingL4NetworkExport): boolean {
  if (!l4NetworkCommands.isDurablyStored(record.fingerprint, record.commandKey)) return false;
  try {
    const persisted = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "{}")[record.commandKey];
    return JSON.stringify(persisted) === JSON.stringify(record);
  } catch { return false; }
}

const GRANT_STORAGE_KEY = "nexion-admin-l4-network-grants-v1";
const grants = createPendingMutationStore<PendingMutationRecord & { downloadToken?: string }>({
  storageKey: GRANT_STORAGE_KEY,
  retainExpiredRecords: true,
  isValidRecord: record => /^L4TREE-[A-Z0-9]{8}$/.test(record.fingerprint)
    && (record.downloadToken === undefined || typeof record.downloadToken === "string" && record.downloadToken.length > 0),
});

export function l4NetworkGrantRecovery(reportId: string) {
  const legacy = l4NetworkCommands.list().find(record => record.result?.reportId === reportId && record.grantRequested);
  return legacy ?? grants.list().find(record => record.fingerprint === reportId);
}

const downloadError = (code: string) => formatAdminApiError(code, code);

/** L4 and L5 share the grant attempt, including old L4 records. The endpoint has no idempotency key. */
export async function downloadL4NetworkSnapshot(reportId: string) {
  const original = l4NetworkCommands.list().find(record => record.result?.reportId === reportId);
  const priorGrant = l4NetworkGrantRecovery(reportId);
  if (priorGrant && isRetryExpired(priorGrant)) throw new Error(RETRY_EXPIRED_TEXT);
  if (priorGrant && !priorGrant.downloadToken) throw new Error(downloadError("L4_TREE_GRANT_UNKNOWN"));

  let token = priorGrant?.downloadToken;
  const key = priorGrant?.commandKey ?? `l4-network-grant-${crypto.randomUUID()}`;
  const saveGrant = (downloadToken?: string) => {
    grants.remember(reportId, key, { downloadToken });
    const stored = JSON.parse(window.sessionStorage.getItem(GRANT_STORAGE_KEY) ?? "{}")[key];
    if (!grants.isDurablyStored(reportId, key) || stored?.downloadToken !== downloadToken) {
      throw new Error(downloadError("L4_TREE_STORAGE_UNAVAILABLE"));
    }
  };
  if (!token) {
    saveGrant();
    try {
      const grant = await lBiActions.downloadToken(reportId);
      if (grant.reportId !== reportId || typeof grant.downloadToken !== "string" || !grant.downloadToken
        || grant.maskingPolicy !== "PARTIAL" || grant.containsPii !== true) {
        throw new LOutcomeUnknownError(downloadError("L4_TREE_GRANT_UNKNOWN"));
      }
      token = grant.downloadToken;
    } catch (error) {
      if (isExplicitRejection(error)) {
        grants.forget(reportId, key);
        throw error;
      }
      throw new LOutcomeUnknownError(downloadError("L4_TREE_GRANT_UNKNOWN"));
    }
    saveGrant(token);
  }
  const file = await downloadL4NetworkFile(reportId, token);
  if (!file.blob.type.toLowerCase().includes("text/csv")) throw new Error(downloadError("L4_TREE_FILE_INVALID"));
  grants.forget(reportId, key);
  if (original) l4NetworkCommands.forget(original.fingerprint, original.commandKey);
  return file;
}
