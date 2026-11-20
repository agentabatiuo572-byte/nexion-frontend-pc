import { createPendingMutationStore, type PendingMutationRecord } from "./pending-mutation-store";

// One owner for each existing storage key. Legacy records remain readable until
// their original command has a verdict; new direct writes share one H4 journal.
export type H4StoredCommand = PendingMutationRecord & Record<string, any>;
export const h4CommandStores = {
  direct: createPendingMutationStore<H4StoredCommand>({
    storageKey: "nexion-admin-h4-commands-v1", retainExpiredRecords: true,
    isValidRecord: r => Number.isSafeInteger(r.owner) && typeof r.scope === "string"
      && typeof r.action === "string" && typeof r.reason === "string" && !!r.request
      && typeof r.request.path === "string" && ["POST", "PATCH", "DELETE"].includes(r.request.method)
      && typeof r.request.body === "string",
  }),
  hi: createPendingMutationStore<H4StoredCommand>({
    storageKey: "nexion-admin-hi-reward-commands-v1", retainExpiredRecords: true,
    isValidRecord: r => Number.isSafeInteger(r.owner) && typeof r.scope === "string" && typeof r.body === "string"
      && !!r.payload && ["proposal", "retire"].includes(r.payload.kind) && !!r.payload.input
      && typeof r.payload.input.reason === "string" && r.body === JSON.stringify(r.payload.input),
  }),
  rule: createPendingMutationStore<H4StoredCommand>({
    storageKey: "uvel-admin-event-rule-attempts-v1", retainExpiredRecords: true,
    isValidRecord: r => typeof r.inputFingerprint === "string",
  }),
  raffle: createPendingMutationStore<H4StoredCommand>({
    storageKey: "uvel-admin-genesis-raffle-attempts-v1", retainExpiredRecords: true,
    isValidRecord: r => typeof r.inputFingerprint === "string",
  }),
  delete: createPendingMutationStore<H4StoredCommand>({
    storageKey: "nexion-admin-h4-event-deletes-v1", retainExpiredRecords: true,
    isValidRecord: r => typeof r.eventId === "string" && typeof r.expectedVersion === "string" && typeof r.reason === "string",
  }),
};
