import type { createA2OperationProposal } from "./a2-client";
import { createPendingMutationStore, type PendingMutationRecord } from "./pending-mutation-store";
import { riskSettingsError, type PhoneRiskUpdate } from "./phone-risk-client";

export type E6Section = "tasks" | "tiers" | "phones" | "calibration";
export type E6Proposal = Parameters<typeof createA2OperationProposal>[0];
export type E6DeviceInput = { before: string; serial: string; deviceId: number; userId: number; action: "activate" | "deactivate" | "pause" | "resume"; reason: string; operator: string };
export type E6Payload = { kind: "proposal"; input: E6Proposal; evidence?: unknown } | { kind: "device"; input: E6DeviceInput } | { kind: "risk"; revision: number; input: PhoneRiskUpdate; receiptVersion?: 1 };
export type E6Pending = PendingMutationRecord & { owner: number; epoch: number; label: string; section: E6Section; scope: string; payload: E6Payload; body: string; ticketId?: string; terminal?: string;
  proposalReceipt?: Pick<Awaited<ReturnType<typeof createA2OperationProposal>>, "type" | "amplifies"> };

/** One instance also lets E5 read the phone/user locks without a second storage mirror. */
export const e6Commands = createPendingMutationStore<E6Pending>({ storageKey: "nexion-admin-e6-commands-v2", retainExpiredRecords: true,
  isValidRecord: r => Number.isSafeInteger(r.owner) && typeof r.scope === "string" && typeof r.label === "string" && typeof r.body === "string"
    && !!r.payload && ["proposal", "device", "risk"].includes(r.payload.kind) && !!r.payload.input && typeof r.payload.input.reason === "string"
    && (r.payload.kind !== "risk" || r.payload.receiptVersion === undefined || r.payload.receiptVersion === 1
      && Number.isSafeInteger(r.payload.revision) && r.payload.revision >= 0 && riskSettingsError(r.payload.input) === null
      && r.body === JSON.stringify({ ...r.payload.input, expectedRevision: r.payload.revision, confirmed: true }))
    && (r.proposalReceipt === undefined || !!r.proposalReceipt && ["fund", "param", "acct", "sos"].includes(r.proposalReceipt.type)
      && typeof r.proposalReceipt.amplifies === "boolean") });
