import { createPendingMutationStore, type PendingMutationRecord } from "./pending-mutation-store";
import { visibleReasonLength } from "./a2-client";
import type { LNetworkTreeExportResult } from "./l-client";

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

// A single instance owns creation and download recovery, retaining expired evidence.
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
        && result.status === "READY" && Number.isSafeInteger(result.rowCount) && result.rowCount > 0
        && result.rowCount <= 100_000 && result.containsPii === true
        && result.maskingPolicy === "PARTIAL" && result.downloadTtlHours === 24)
      && (record.grantRequested === undefined || typeof record.grantRequested === "boolean")
      && (record.downloadToken === undefined || typeof record.downloadToken === "string" && record.downloadToken.length > 0)
      && (!record.grantRequested || result !== undefined)
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
