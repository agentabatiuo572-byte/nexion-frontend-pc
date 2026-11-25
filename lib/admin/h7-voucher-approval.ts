import {
  A2OutcomeUncertainError, createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey,
  isA2OutcomeUncertainError, type A2OperationRow,
} from "./a2-client";
import { createPendingMutationStore, createPendingRecovery, isRetryExpired, type PendingMutationRecord } from "./pending-mutation-store";
import { explicitRejectionCode } from "./explicit-rejection";
import { isDeterministicRejection } from "./outcome-classification";
import { requireH7Actor } from "./h7-voucher-mutation";
import { parseH7Voucher, type H7Voucher } from "./h-client";
import { roleLabel } from "@/lib/nav/console-nav";
import { useAdminAuth, type AdminSession } from "@/lib/store/admin-auth";

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
function requireProposalActor(adminId: number) {
  const actor = requireH7Actor(adminId, true);
  if (!actor.authorities.some(code => code === "platform_a2_write" || code === "platform_a2_proposal_create")) throw new Error("缺少提交审批权限");
}

export const h7ApprovalRecovery = createPendingRecovery(attempts, {
  capability: () => "receipt",
  canReplay: record => {
    const adminId = useAdminAuth.getState().session?.adminId;
    if (adminId === undefined || record.fingerprint !== `${adminId}:${record.voucherId}` || !record.proposal || record.acknowledged) return false;
    try { requireProposalActor(adminId); return true; } catch { return false; }
  },
  explicitRejectionCode,
});

export const canRetryH7VoucherApproval = (record: H7VoucherApprovalAttempt) => !h7ApprovalRecovery.state(record).replayBlock;

function checkTicket(ticket: A2OperationRow, original: H7VoucherApprovalInput, key: string) {
  if (!ticket.mine || ticket.obj !== original.voucherId || ticket.operationCode !== original.op
    || !["pending", "approved", "rejected", "expired", "withdrawn"].includes(ticket.status)) {
    throw new A2OutcomeUncertainError("审批单和原操作对不上，请到操作记录核对。", key);
  }
}

async function lookup(record: H7VoucherApprovalAttempt) {
  const result = await h7ApprovalRecovery.query(record, async original => {
    const current = await fetchA2ProposalByKey(original.commandKey, true);
    if (!current) return { conclusion: original.acknowledged ? "unknown" : "not-found", current } as const;
    checkTicket(current, original, original.commandKey);
    return { conclusion: current.status === "pending" ? "unknown" : current.status === "approved" ? "succeeded" : "not-executed", current } as const;
  });
  if (!result) return null;
  if (result.current?.status === "pending") attempts.remember(record.fingerprint, record.commandKey, { ...record, acknowledged: true, ticket: result.current });
  else if (result.current) h7ApprovalRecovery.settleFromQuery(record, result.conclusion);
  return result.current;
}

export async function submitH7VoucherApproval(session: AdminSession, input: H7VoucherApprovalInput, reason: string, mode: H7VoucherApprovalMode = "submit") {
  requireH7Actor(session.adminId, false);
  const slot = `${session.adminId}:${input.voucherId}`;
  const previous = pendingH7VoucherApprovals(session.adminId).find(record => record.fingerprint === slot);
  if (mode === "lookup") return previous ? lookup(previous) : null;
  requireProposalActor(session.adminId);
  if (previous) {
    if (mode !== "retry") throw new Error("原操作待确认，请查询原结果。");
    await h7ApprovalRecovery.replay(previous, original => send(session, original, original.commandKey, slot, original));
    return readSubmitted(slot, previous.commandKey);
  }
  if (mode === "retry") throw new Error("H7_ORIGINAL_RESOLVED");
  const key = createA2CommandKey(input.op);
  await send(session, { ...input, reason }, key, slot);
  return readSubmitted(slot, key);
}

async function send(session: AdminSession, original: H7VoucherApprovalInput & { reason: string }, key: string, slot: string, previous?: H7VoucherApprovalAttempt) {
  requireProposalActor(session.adminId);
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
    checkTicket(receipt, original, key);
  } catch (error) {
    const e = error as { status?: number; backendMessage?: string; apiCode?: number };
    const rejected = !isA2OutcomeUncertainError(error) && !(e.backendMessage ?? "").startsWith("IDEMPOTENCY_")
      && isDeterministicRejection(e.status ?? 0, e.apiCode);
    if (!previous && rejected) attempts.forget(slot, key);
    throw error;
  }
  // An idempotent POST can replay the ticket's creation state. Only an exact GET
  // establishes whether it is pending now. Keep query-only evidence if GET fails.
  attempts.remember(slot, key, { ...original, proposal, acknowledged: true });
}

async function readSubmitted(slot: string, key: string) {
  const record = attempts.list().find(row => row.fingerprint === slot && row.commandKey === key);
  if (record) {
    const current = await lookup(record).catch(() => null);
    if (current) return current;
  }
  throw new A2OutcomeUncertainError("申请已建单，批没批准还没查到。请查询原结果。", key);
}

export function releaseRejectedH7VoucherApproval(record: H7VoucherApprovalAttempt) {
  if (!h7ApprovalRecovery.releaseRejectedReplay(record)) throw new Error("原操作记录继续保留，请查询原结果。");
}
