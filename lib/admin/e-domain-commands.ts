import type { PendingMutationRecord } from "./pending-mutation-store";

/** Every reader must retain redesigned E-page legacy evidence; E3/E4 keep their expiry policy. */
export const isRedesignedELegacyCommand = (record: Pick<PendingMutationRecord, "fingerprint">) => /^(e[156]_[^|]+|e2_phone_tier|e2_task_(create|update|status)|device-(activate|deactivate|batch))\|/.test(record.fingerprint);
