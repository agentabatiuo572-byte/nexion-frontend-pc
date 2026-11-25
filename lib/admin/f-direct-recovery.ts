import { fetchDirectCommandReceipt } from "./direct-command-receipt";
import { explicitRejectionCode } from "./explicit-rejection";
import { createPendingRecovery, type PendingMutationRecord, type PendingMutationStore } from "./pending-mutation-store";

export function createFDirectRecovery<T extends PendingMutationRecord>(
  store: PendingMutationStore<T>,
  scope: (record: T) => string | undefined,
  canReplay: (record: T) => boolean,
) {
  return createPendingRecovery(store, {
    capability: record => scope(record) ? "receipt" : "replay",
    canReplay,
    explicitRejectionCode,
  });
}

export async function fDirectReceiptConclusion(scope: string, commandKey: string, adminId: number) {
  const state = await fetchDirectCommandReceipt(scope, commandKey, adminId);
  switch (state) {
    case "NOT_FOUND": return "not-found";
    case "SUCCEEDED": return "succeeded";
    case "REJECTED": return "rejected";
    case "NOT_EXECUTED": return "not-executed";
    default: return "unknown";
  }
}
