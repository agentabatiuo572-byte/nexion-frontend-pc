import { A2OutcomeUncertainError, createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError } from "./a2-client";
import { createPendingMutationStore, type PendingMutationRecord } from "./pending-mutation-store";
import { displayAdminError } from "./error-messages";
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

export async function proposeSessionRevocation(
  session: AdminSession,
  userId: number | string,
  label: string,
  reason: string,
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
      throw new Error("浏览器无法保存本次审批命令号，请允许会话存储后重试。");
    }
  }

  let ticket;
  if (previous) {
    try {
      ticket = await fetchA2ProposalByKey(key);
    } catch (error) {
      throw new Error(`原操作结果尚未确认，暂时无法查询审批单。${displayAdminError(error)} 请稍后重试原操作。操作编号：${key}`);
    }
    if (!ticket && previous.expiresAt <= Date.now()) {
      throw new A2OutcomeUncertainError("原命令已过期，暂未查到审批单。请继续核对原操作。", key);
    }
  }
  try {
    ticket ??= await createA2OperationProposal({
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
      throw new A2OutcomeUncertainError("原审批命令仍待确认，请重试原操作。", key);
    }
    if (!isA2OutcomeUncertainError(error)
        && (!previous || !(error instanceof Error && "status" in error && [401, 403, 404].includes(Number(error.status))))) {
      attempts.forget(slot, key);
    }
    throw error;
  }
  if (!ticket.mine || ticket.obj !== original.userId
      || (ticket.operationCode && ticket.operationCode !== "c2_session_revoke_all")) {
    throw new A2OutcomeUncertainError("审批回执与原操作不符，请到操作记录核对。", key);
  }
  attempts.forget(slot, key);
  return ticket;
}
