import { createA2CommandKey, createA2OperationProposal, isA2OutcomeUncertainError } from "./a2-client";
import { createPendingMutationStore, type PendingMutationRecord } from "./pending-mutation-store";
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
  attempts.remember(slot, key, original);
  try {
    await createA2OperationProposal({
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
    if (isA2OutcomeUncertainError(error)) {
      throw new Error(`审批提交结果尚未确认，请重试原操作。将使用原理由和操作编号，批准后才会退出设备。操作编号：${key}`);
    }
    if (!previous || !(error instanceof Error && "status" in error && [401, 403].includes(Number(error.status)))) {
      attempts.forget(slot, key);
    }
    throw error;
  }
  attempts.forget(slot, key);
}
