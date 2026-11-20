import {
  A2OutcomeUncertainError, createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey,
  isA2OutcomeUncertainError, type A2OperationRow,
} from "./a2-client";
import { createPendingMutationStore, isRetryExpired, type PendingMutationRecord } from "./pending-mutation-store";
import { isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection } from "./outcome-classification";
import { requireH7Actor } from "./h7-voucher-mutation";
import { parseH7Voucher, type H7Voucher } from "./h-client";
import { roleLabel } from "@/lib/nav/console-nav";
import type { AdminSession } from "@/lib/store/admin-auth";

export const H7_VOUCHER_ACTIONS = {
  h7_voucher_delete: "删除代金券",
  h7_voucher_revoke_available: "作废未使用的代金券",
} as const;

export type H7VoucherApprovalInput = {
  op: keyof typeof H7_VOUCHER_ACTIONS;
  voucherId: string;
  voucherName: string;
  expectedVersion: number;
  /** Original confirmation facts, never replaced by today's voucher. */
  voucher?: H7Voucher;
};
export type H7VoucherApprovalMode = "submit" | "lookup" | "retry";
type Proposal = Parameters<typeof createA2OperationProposal>[0];
export type H7VoucherApprovalAttempt = PendingMutationRecord & H7VoucherApprovalInput & {
  reason: string; proposal?: Proposal; acknowledged?: boolean; ticket?: A2OperationRow;
};

export function isH7VoucherApproval(op: string | undefined): op is H7VoucherApprovalInput["op"] {
  return op !== undefined && Object.hasOwn(H7_VOUCHER_ACTIONS, op);
}

const attempts = createPendingMutationStore<H7VoucherApprovalAttempt>({
  storageKey: "nexion-admin-h7-voucher-proposals", retainExpiredRecords: true,
  isValidRecord: record => {
    if (!isH7VoucherApproval(record.op) || typeof record.voucherId !== "string" || typeof record.voucherName !== "string"
      || !Number.isSafeInteger(record.expectedVersion) || record.expectedVersion <= 0 || typeof record.reason !== "string") return false;
    try {
      if (record.voucher && parseH7Voucher(record.voucher).id !== record.voucherId) return false;
      if (record.ticket && (!record.ticket.mine || record.ticket.obj !== record.voucherId
        || record.ticket.operationCode !== record.op || record.ticket.status !== "pending" || typeof record.ticket.id !== "string" || !record.ticket.id)) return false;
      // Older records can still be queried, but lack a complete original envelope for replay.
      if (!record.proposal) return true;
      const p = record.proposal;
      return p.sourceDomain === "H7" && p.obj === record.voucherId && p.reason === record.reason
        && typeof p.operator === "string" && typeof p.operatorRole === "string"
        && p.command.domain === "H" && p.command.op === record.op
        && p.command.params.voucherId === record.voucherId && p.command.params.expectedVersion === record.expectedVersion
        && p.target?.domain === "H" && p.target.type === "voucher" && p.target.id === record.voucherId;
    } catch { return false; }
  },
});

export function pendingH7VoucherApprovals(adminId: number) {
  return attempts.list().filter(record => record.fingerprint === `${adminId}:${record.voucherId}`);
}
export const canRetryH7VoucherApproval = (record: H7VoucherApprovalAttempt) => !isRetryExpired(record) && !!record.proposal && !record.acknowledged;

export async function submitH7VoucherApproval(session: AdminSession, input: H7VoucherApprovalInput, reason: string, mode: H7VoucherApprovalMode = "submit") {
  requireH7Actor(session.adminId, false);
  const slot = `${session.adminId}:${input.voucherId}`;
  const previous = pendingH7VoucherApprovals(session.adminId).find(record => record.fingerprint === slot);
  if (mode === "lookup" && !previous) return null;
  if (mode === "retry" && !previous) throw new Error("H7_ORIGINAL_RESOLVED");
  const original = previous ?? { ...input, reason };
  const key = previous?.commandKey ?? createA2CommandKey(original.op);
  const checkTicket = (ticket: A2OperationRow) => {
    // 111e00cd OpsAuditCenterService.ticketMetadata explicitly supplies H7 operationCode.
    if (!ticket.mine || ticket.obj !== original.voucherId || ticket.operationCode !== original.op
      || !["pending", "approved", "rejected", "expired", "withdrawn"].includes(ticket.status)) {
      throw new A2OutcomeUncertainError("审批单和原操作对不上，请到操作记录核对。", key);
    }
  };
  if (previous) {
    let current;
    if (previous.ticket) attempts.remember(slot, key, { ...previous, ticket: undefined });
    try { current = await fetchA2ProposalByKey(key, true); }
    catch { throw new A2OutcomeUncertainError("暂时无法查询原审批单，请稍后再查。", key); }
    if (current) {
      checkTicket(current);
      if (current.status === "pending") attempts.remember(slot, key, { ...previous, acknowledged: true, ticket: current });
      else attempts.forget(slot, key);
      return current;
    }
    if (mode === "lookup") return null;
    if (!canRetryH7VoucherApproval(previous)) throw new A2OutcomeUncertainError("原请求不能再重发，请继续查询原审批单。", key);
  }
  requireH7Actor(session.adminId, true);
  const proposal: Proposal = previous?.proposal ?? {
    action: H7_VOUCHER_ACTIONS[original.op], obj: original.voucherId, beforeValue: "—", afterValue: "—",
    operator: session.operator || session.username, operatorRole: roleLabel(session.role), type: "param",
    amplifies: false, sos: false, roleGate: "门槛者", reason: original.reason, sourceDomain: "H7",
    command: { domain: "H", op: original.op, params: { voucherId: original.voucherId, expectedVersion: original.expectedVersion } },
    target: { domain: "H", type: "voucher", id: original.voucherId },
  };
  attempts.remember(slot, key, { ...original, proposal });
  if (!attempts.isDurablyStored(slot, key)) {
    if (!previous) attempts.forget(slot, key);
    throw new Error(previous ? "H7_REQUEST_RETRY_STORAGE_UNAVAILABLE" : "H7_REQUEST_STORAGE_UNAVAILABLE");
  }
  try {
    const receipt = await createA2OperationProposal(proposal, key, true);
    checkTicket(receipt);
  } catch (error) {
    const e = error as { status?: number; backendMessage?: string; apiCode?: number };
    const rejected = !isA2OutcomeUncertainError(error) && !(e.backendMessage ?? "").startsWith("IDEMPOTENCY_")
      && (previous ? isExplicitRejection(error) : isDeterministicRejection(e.status ?? 0, e.apiCode));
    if (rejected) attempts.forget(slot, key);
    throw error;
  }
  // An idempotent POST can replay the ticket's creation state. Only an exact GET
  // establishes whether it is pending now. Keep query-only evidence if GET fails.
  attempts.remember(slot, key, { ...original, proposal, acknowledged: true });
  let current;
  try { current = await fetchA2ProposalByKey(key, true); }
  catch { throw new A2OutcomeUncertainError("申请已建单，批没批准还没查到。请查询原结果。", key); }
  if (!current) throw new A2OutcomeUncertainError("申请已建单，批没批准还没查到。请查询原结果。", key);
  checkTicket(current);
  if (current.status === "pending") attempts.remember(slot, key, { ...original, proposal, acknowledged: true, ticket: current });
  else attempts.forget(slot, key);
  return current;
}

/** UI must obtain an explicit confirmation before calling this for an expired proposal. */
export async function releaseExpiredH7VoucherApproval(session: AdminSession, record: H7VoucherApprovalAttempt) {
  requireH7Actor(session.adminId, false);
  const current = pendingH7VoucherApprovals(session.adminId).find(r => r.commandKey === record.commandKey);
  if (!current || current.acknowledged || current.ticket || !isRetryExpired(current) || await fetchA2ProposalByKey(current.commandKey, true) !== null) throw new Error("H7_PROPOSAL_RELEASE_FORBIDDEN");
  attempts.forget(current.fingerprint, current.commandKey);
}
