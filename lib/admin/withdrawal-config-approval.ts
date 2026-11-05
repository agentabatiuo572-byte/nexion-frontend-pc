import {
  A2OutcomeUncertainError,
  createA2CommandKey,
  createA2OperationProposal,
  fetchA2ProposalByKey,
  isA2OutcomeUncertainError,
} from "./a2-client";
import { createPendingMutationStore, type PendingMutationRecord } from "./pending-mutation-store";
import { roleLabel } from "@/lib/nav/console-nav";
import type { AdminSession } from "@/lib/store/admin-auth";

const attempts = createPendingMutationStore<PendingMutationRecord & { input: string }>({
  storageKey: "nexion-admin-withdrawal-config-proposals",
  retainExpiredRecords: true,
  isValidRecord: (record) => typeof record.input === "string",
});

const commands = {
  D5: { domain: "D", op: "d5_withdrawal_limits", type: "withdrawal_limits", action: "放宽提现参数" },
  D7: { domain: "D", op: "d7_payout_vnd_config", type: "payout_vnd_config", action: "放宽越南盾提现参数" },
  B1: { domain: "B", op: "b1_coverage_thresholds", type: "coverage_thresholds", action: "降低兑付覆盖率红线" },
  B5: { domain: "B", op: "b5_bankrun_thresholds", type: "bankrun_thresholds", action: "提高提现压力红线" },
} as const;

export function withdrawalApprovalDisabledReason(authorities: readonly string[]) {
  if (!authorities.includes("platform_a2_proposal_create") && !authorities.includes("platform_a2_write")) {
    return "当前账号缺少发起审批的权限。";
  }
}

export function pendingConfigApproval(sourceDomain: keyof typeof commands, adminId: string | number) {
  return attempts.list().find((record) => record.fingerprint === `${adminId}:${sourceDomain}`);
}

export async function submitConfigApproval<T>(
  sourceDomain: keyof typeof commands,
  session: AdminSession,
  values: Record<string, unknown> & { expectedVersion: number },
  reason: string,
  readActive: () => Promise<T>,
  lookupOnly = false,
) {
  const { domain, action, op, type } = commands[sourceDomain];
  const slot = `${session.adminId}:${sourceDomain}`;
  const input = JSON.stringify([values, reason]);
  const previous = pendingConfigApproval(sourceDomain, session.adminId);
  if (lookupOnly && !previous) return null;
  const key = previous?.commandKey ?? createA2CommandKey(op);
  if (!previous) {
    attempts.remember(slot, key, { input });
    if (!attempts.isDurablyStored(slot, key)) {
      attempts.forget(slot, key);
      throw new Error("浏览器无法保存本次审批命令号，请允许会话存储后重试。");
    }
  }

  let ticket;
  let canClearOnRejection = !previous;
  try {
    if (previous && (domain === "B" || session.authorities.includes("platform_a2_read"))) {
      try {
        ticket = await fetchA2ProposalByKey(key);
      } catch {
        throw new A2OutcomeUncertainError("暂时无法查询原审批单。", key);
      }
      canClearOnRejection = ticket === null;
    }
    if (previous && !ticket && previous.expiresAt <= Date.now()) {
      throw new A2OutcomeUncertainError("原审批命令已过期，暂未查到结果。请到操作记录核对，勿重复提交。", key);
    }
    if (lookupOnly && !ticket) return null;
    if (previous && previous.input !== input && !ticket) {
      throw new A2OutcomeUncertainError("请用原配置和原理由核对该命令，或在操作记录中查询。", key);
    }
    ticket ??= await createA2OperationProposal({
      action,
      obj: "current",
      beforeValue: "—",
      afterValue: "—",
      operator: session.operator || session.username,
      operatorRole: roleLabel(session.role),
      type: "fund",
      amplifies: true,
      sos: false,
      roleGate: "超管",
      reason,
      sourceDomain,
      command: { domain, op, params: { values } },
      target: { domain, type, id: "current" },
    }, key, true);
  } catch (error) {
    if (error instanceof Error && "backendMessage" in error
        && ["IDEMPOTENCY_REQUEST_IN_PROGRESS", "IDEMPOTENCY_RESULT_UNKNOWN", "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH"].includes(String(error.backendMessage))) {
      throw new A2OutcomeUncertainError("原命令仍待确认，请稍后查询。", key);
    }
    if (canClearOnRejection && !isA2OutcomeUncertainError(error)) attempts.forget(slot, key);
    throw error;
  }

  let active;
  try {
    active = await readActive();
  } catch {
    throw new A2OutcomeUncertainError(`审批单 ${ticket.id} 已登记，当前配置回读失败。请保持当前输入并重试核对。`, key);
  }
  attempts.forget(slot, key);
  return {
    active,
    acknowledgement: previous && previous.input !== input
      ? `已找到原审批单 ${ticket.id}，本次输入未提交。请核对当前配置后重新操作。`
      : ticket.status === "pending"
        ? `已提交审批 · 审批单 ${ticket.id} · 等待另一位超管批准`
        : `审批单 ${ticket.id} 已登记，请在操作记录查看处理结果`,
  };
}

export const submitWithdrawalConfigApproval = submitConfigApproval;
