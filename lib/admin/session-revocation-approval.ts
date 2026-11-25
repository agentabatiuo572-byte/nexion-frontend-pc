import { A2OutcomeUncertainError, createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, type A2OperationRow } from "./a2-client";
import { createPendingMutationStore, createPendingRecovery, isRetryExpired, type PendingMutationRecord } from "./pending-mutation-store";
import { displayAdminReadError } from "./error-messages";
import { canCreateRecoveryProposal, canReadOwnRecoveryProposal, currentRecoveryActor } from "./abe-recovery-access";
import { isExplicitRejection } from "./explicit-rejection";
import { roleLabel } from "@/lib/nav/console-nav";
import type { AdminSession } from "@/lib/store/admin-auth";

type Attempt = PendingMutationRecord & {
  userId: string;
  reason: string;
  operator: string;
  operatorRole: string;
  label: string;
};

const attempts = createPendingMutationStore<Attempt>({
  storageKey: "nexion-admin-session-revocation-proposals",
  retainExpiredRecords: true,
  isValidRecord: (record) => [record.userId, record.reason, record.operator, record.operatorRole, record.label].every((value) => typeof value === "string"),
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
  canReplay: record => canProposeSessionRevocation(currentRecoveryActor(record.commandOwnerId)?.authorities ?? []),
  explicitRejectionCode: () => undefined,
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

export const sessionRevocationRecovery = {
  state: recovery.state,
  async query(session: AdminSession, record: Attempt) {
    const result = await recovery.query(record, async original => {
      const actor = currentRecoveryActor(session.adminId);
      if (!actor || !canReadOwnRecoveryProposal(actor.authorities)) throw new Error("当前账号无法查询原审批单");
      const ticket = await readOriginal(original);
      return { ticket, conclusion: ticket ? "unknown" : "not-found" } as const;
    });
    if (result?.ticket) recovery.settleAcknowledged(record);
    return result;
  },
  retry(record: Attempt) {
    return recovery.replay(record, original => submit(original.fingerprint, original.commandKey, original, true));
  },
};

export async function proposeSessionRevocation(
  session: AdminSession,
  userId: number | string,
  label: string,
  reason: string,
  newOnly = false,
) {
  const previous = pendingSessionRevocationApproval(session.adminId, userId);
  const original = previous ?? {
    userId: String(userId), label, reason,
    operator: session.operator || session.username,
    operatorRole: roleLabel(session.role),
  };
  const slot = `${session.adminId}:${userId}`;
  const key = previous?.commandKey ?? createA2CommandKey("c2_session_revoke_all");
  if (!previous) {
    attempts.remember(slot, key, original);
    if (!attempts.isDurablyStored(slot, key)) {
      attempts.forget(slot, key);
      throw new Error("浏览器没能记下这次操作，这次没有发出；请关闭无痕模式或允许本站保存数据后再试。");
    }
  }

  if (previous) {
    if (newOnly) throw new A2OutcomeUncertainError("请先查询原操作。", key);
    let ticket;
    try {
      ticket = await readOriginal(previous);
    } catch (error) {
      throw new Error(`原审批单加载失败。${displayAdminReadError(error)}`);
    }
    if (ticket) {
      recovery.settleAcknowledged(previous);
      return ticket;
    }
    if (isRetryExpired(previous)) {
      throw new A2OutcomeUncertainError("原请求已过期，还没查到审批单。请继续核对原操作。", key);
    }
  }
  return submit(slot, key, original, Boolean(previous));
}

async function submit(slot: string, key: string, original: Pick<Attempt, "userId" | "label" | "reason" | "operator" | "operatorRole">, retry: boolean) {
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
    // 新提交被确定拒绝时丢号；重试的是保留下来的原命令时，只有后端明确拒绝（isExplicitRejection，且不是 404）才清，
    // 限流、超时、幂等层要求核查这些都说明不了原命令的结果，记录和对象锁留着（R3）。安全与登录设备也用这里，只会更严。
    const forget = retry
      ? isExplicitRejection(error) && !(error instanceof Error && "status" in error && Number(error.status) === 404)
      : isExplicitRejection(error);
    if (forget) attempts.forget(slot, key);
    throw error;
  }
  verifyTicket(original, key, ticket);
  attempts.forget(slot, key);
  return ticket;
}
