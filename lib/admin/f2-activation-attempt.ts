import type { A2OperationRow, createA2OperationProposal } from "./a2-client";
import { createPendingMutationStore, type PendingMutationRecord } from "./pending-mutation-store";
import type { ProposeSpec } from "./propose-or-execute";

export interface F2ActivationAttempt extends PendingMutationRecord {
  spec: ProposeSpec;
  request?: Parameters<typeof createA2OperationProposal>[0];
  adminId?: number;
  ticket?: A2OperationRow;
  received?: boolean;
  absent?: boolean;
  retryRejection?: string;
}

// Keep existing evidence. Old records without a complete request are query-only.
export const f2ActivationAttempts = createPendingMutationStore<F2ActivationAttempt>({
  storageKey: "nexion-admin-f2-activation-v1", retainExpiredRecords: true,
  isValidRecord: row => row.spec?.command?.op === "f_seven_layer_activation" && typeof row.spec.reason === "string",
});
