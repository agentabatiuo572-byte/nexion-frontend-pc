import { A2OutcomeUncertainError, createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, type A2OperationRow } from "./a2-client";
import { createPendingMutationStore, createPendingRecovery, type PendingMutationRecord } from "./pending-mutation-store";
import { canCreateRecoveryProposal, canReadOwnRecoveryProposal, currentRecoveryActor } from "./abe-recovery-access";
import { explicitRejectionCode, isExplicitRejection } from "./explicit-rejection";
import { roleLabel } from "@/lib/nav/console-nav";
import type { AdminSession } from "@/lib/store/admin-auth";

type Attempt = PendingMutationRecord & {
  userId: string;
  reason: string;
  operator: string;
  operatorRole: string;
  label: string;
  ticketId?: string;
};

const attempts = createPendingMutationStore<Attempt>({
  storageKey: "nexion-admin-session-revocation-proposals",
  retainExpiredRecords: true,
  isValidRecord: (record) => [record.userId, record.reason, record.operator, record.operatorRole, record.label].every((value) => typeof value === "string")
    && (record.ticketId === undefined || typeof record.ticketId === "string" && !!record.ticketId),
});

export function pendingSessionRevocationApproval(adminId: number, userId: number | string) {
  return attempts.list().find((record) => record.fingerprint === `${adminId}:${userId}`);
}

/** 这个操作人还没确认结果的全部退出全部设备审批（账户操作页的待确认条用）。 */
export function listSessionRevocationApprovals(adminId: number) {
  return attempts.list().filter((record) => record.fingerprint.startsWith(`${adminId}:`));
}

export function canProposeSessionRevocation(rights: readonly string[]) {
  return rights.some(code => code === "user_c2_session_revoke_all" || code === "user_c5_session_revoke_all")
    && canCreateRecoveryProposal(rights);
}

const recovery = createPendingRecovery(attempts, {
  capability: () => "receipt",
  canReplay: record => !record.ticketId && canProposeSessionRevocation(currentRecoveryActor(record.commandOwnerId)?.authorities ?? []),
  hasApproval: record => !!record.ticketId,
  explicitRejectionCode,
});

function verifyTicket(original: Pick<Attempt, "userId">, key: string, ticket: A2OperationRow) {
  if (!ticket.mine || ticket.obj !== original.userId
      || (ticket.operationCode && ticket.operationCode !== "c2_session_revoke_all")) {
    throw new A2OutcomeUncertainError("审批单和原操作对不上，请到操作记录核对。", key);
  }
}

async function readOriginal(original: Attempt) {
  const ticket = await fetchA2ProposalByKey(original.commandKey, true, "a");
  if (ticket) verifyTicket(original, original.commandKey, ticket);
  return ticket;
}

export const sessionRevocationStatus = { pending: "待审批，批准后生效", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" };

function recordTicket(original: Attempt, ticket: A2OperationRow) {
  if (ticket.status === "pending") attempts.remember(original.fingerprint, original.commandKey, { ...original, ticketId: ticket.id });
  else recovery.settleAcknowledged(original);
}

export const sessionRevocationRecovery = {
  release: (record: Attempt) => !!currentRecoveryActor(record.commandOwnerId) && recovery.releaseRejectedReplay(record),
  releaseSnapshot: recovery.releaseSnapshot,
  state: recovery.state,
  async query(session: AdminSession, record: Attempt) {
    const result = await recovery.query(record, async original => {
      const actor = currentRecoveryActor(session.adminId);
      if (!actor || !canReadOwnRecoveryProposal(actor.authorities)) throw new Error("当前账号无法查询原审批单");
      const ticket = await readOriginal(original);
      if (!ticket && original.ticketId) throw new Error("暂未读到已提交的审批单，保留上次读到的状态。");
      const conclusion = !ticket ? "not-found" : ticket.status === "pending" ? "unknown" : ticket.status === "approved" ? "succeeded" : "not-executed";
      return { ticket, conclusion } as const;
    });
    if (result?.ticket?.status === "pending") recordTicket(record, result.ticket);
    else if (result?.ticket) recovery.settleFromQuery(record, result.conclusion);
    return result;
  },
  retry(record: Attempt) {
    return recovery.replay(record, original => submit(original, true));
  },
};

export async function proposeSessionRevocation(
  session: AdminSession,
  userId: number | string,
  label: string,
  reason: string,
) {
  const previous = pendingSessionRevocationApproval(session.adminId, userId);
  if (previous) throw new A2OutcomeUncertainError("请先查询原操作。", previous.commandKey);
  const slot = `${session.adminId}:${userId}`;
  const key = createA2CommandKey("c2_session_revoke_all");
  attempts.remember(slot, key, {
    userId: String(userId), label, reason,
    operator: session.operator || session.username,
    operatorRole: roleLabel(session.role),
  });
  const original = pendingSessionRevocationApproval(session.adminId, userId);
  if (!original || !attempts.isDurablyStored(slot, key)) {
    attempts.forget(slot, key);
    throw new Error("浏览器没能记下这次操作，这次没有发出；请关闭无痕模式或允许本站保存数据后再试。");
  }
  return submit(original, false);
}

async function submit(original: Attempt, retry: boolean) {
  const { fingerprint: slot, commandKey: key } = original;
  let ticket;
  try {
    ticket = await createA2OperationProposal({
      action: `强制登出 · ${original.label}`,
      obj: original.userId,
      beforeValue: "以执行时在线设备为准",
      afterValue: "全部设备退出登录",
      operator: original.operator,
      operatorRole: original.operatorRole,
      type: "acct", amplifies: false, sos: false, roleGate: "另一位超级管理员",
      reason: original.reason,
      sourceDomain: "C2",
      command: { domain: "C", op: "c2_session_revoke_all", params: { userId: Number(original.userId) } },
      target: { domain: "C", type: "user", id: original.userId },
    }, key, true);
  } catch (error) {
    if (error instanceof Error && "backendMessage" in error
        && ["IDEMPOTENCY_REQUEST_IN_PROGRESS", "IDEMPOTENCY_RESULT_UNKNOWN", "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH"].includes(String(error.backendMessage))) {
      throw new A2OutcomeUncertainError("原审批申请还没有结果，请按原操作重试。", key);
    }
    if (!retry && isExplicitRejection(error)) attempts.forget(slot, key);
    throw error;
  }
  verifyTicket(original, key, ticket);
  recordTicket(original, ticket);
  return ticket;
}
