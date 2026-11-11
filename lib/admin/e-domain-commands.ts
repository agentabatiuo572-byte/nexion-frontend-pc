import { createPendingMutationStore, createSlotAttemptStore, type PendingMutationRecord, type SlotAttemptRecord } from "./pending-mutation-store.ts";

/** Every reader must retain redesigned E-page legacy evidence; E3/E4 keep their expiry policy. */
export const isRedesignedELegacyCommand = (record: Pick<PendingMutationRecord, "fingerprint">) => /^(e[156]_[^|]+|e2_phone_tier|e2_task_(create|update|status)|device-(activate|deactivate|batch))\|/.test(record.fingerprint);

// Each key has one backing store. Legacy readers keep their evidence range;
// writable slot facades retain their original nonempty fingerprint / expiry policy.
const domainOptions = { storageKey: "nexion-admin-e-domain-commands-v1", retainExpiredRecords: isRedesignedELegacyCommand };
export const eDomainLegacyCommands = createPendingMutationStore<SlotAttemptRecord>({ ...domainOptions,
  isValidRecord: record => typeof record.inputFingerprint === "string" });
export const eDomainCommandAttempts = createSlotAttemptStore(domainOptions, eDomainLegacyCommands);
const phoneOptions = { storageKey: "nexion-admin-e5-device-commands-v1" };
export const e5LegacyCommands = createPendingMutationStore<SlotAttemptRecord>({ ...phoneOptions, retainExpiredRecords: true,
  isValidRecord: record => typeof record.inputFingerprint === "string" });
export const e5LegacyCommandAttempts = createSlotAttemptStore(phoneOptions, e5LegacyCommands);
