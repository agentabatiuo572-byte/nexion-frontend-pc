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
import type { F4AmbassadorPolicyUpdate } from "./f1-client";

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
  E2: { domain: "E", op: "e2_task_pricing_change", type: "e2_task_pricing", action: "放宽任务定价配置" },
  F3: { domain: "F", op: "f3_binary_settle", type: "binary_settlement", action: "手动结算团队平衡奖励" },
  F4: { domain: "F", op: "f4_ambassador_policy_change", type: "ambassador_policy", action: "提高区域大使申请预算" },
  G4: { domain: "G", op: "g4_genesis_param", type: "genesis_param", action: "首次配置每日收益比例" },
  H8: { domain: "H", op: "h8_reward_param_change", type: "h8_reward_policy", action: "放宽新人礼与邀请奖励" },
} as const;

export const teamFundApprovalAuthority = { F3: "network_f3_write", F4: "network_f4_pool_fund" } as const;
export type TeamFundApprovalValues = {
  F3: { ownerUserId: number; settlementDate: string };
  F4: F4AmbassadorPolicyUpdate;
};
type ApprovalSource = keyof typeof commands;
type ApprovalValues = TeamFundApprovalValues[keyof TeamFundApprovalValues]
  | (Record<string, unknown> & ({ expectedVersion: number } | { expectedRevision: string }));
type ApprovalScope = { objectId: string; field: string };
export type H8ConfigApprovalInput = [{ key: string; value: string; expectedVersion: number }, string];
export type G4ConfigApprovalInput = [{ paramKey: "dividend"; value: string; decisionRef: string; expectedRevision: string }, string];

function approvalSlot(sourceDomain: keyof typeof commands, adminId: string | number, scope?: ApprovalScope) {
  return scope ? `${adminId}:${sourceDomain}:${scope.objectId}:${scope.field}` : `${adminId}:${sourceDomain}`;
}

export function withdrawalApprovalDisabledReason(authorities: readonly string[]) {
  if (!authorities.includes("platform_a2_proposal_create") && !authorities.includes("platform_a2_write")) {
    return "当前账号缺少发起审批的权限。";
  }
}

export function pendingConfigApproval(sourceDomain: keyof typeof commands, adminId: string | number, scope?: ApprovalScope) {
  const slot = approvalSlot(sourceDomain, adminId, scope);
  return attempts.list().find((record) => record.fingerprint === slot);
}

type ThresholdApprovalValues = {
  B1: { expectedVersion: number; redlinePct: number; healthyPct: number };
  B5: { expectedVersion: number; yellowPct: number; redPct: number };
};

export function pendingThresholdConfigApproval<T extends keyof ThresholdApprovalValues>(source: T, adminId: string | number) {
  const record = pendingConfigApproval(source, adminId);
  if (!record) return undefined;
  const input: unknown = JSON.parse(record.input);
  const fields = source === "B1" ? ["expectedVersion", "redlinePct", "healthyPct"] : ["expectedVersion", "yellowPct", "redPct"];
  if (!Array.isArray(input) || typeof input[1] !== "string" || !input[0] || typeof input[0] !== "object"
    || !fields.every((key) => typeof input[0][key] === "number" && Number.isFinite(input[0][key]))) {
    throw new Error("原审批内容不完整，请到操作记录核对。");
  }
  return { ...record, values: input[0] as ThresholdApprovalValues[T], reason: input[1] };
}

export function configApprovalOriginalInput(sourceDomain: "H8", input: string): H8ConfigApprovalInput;
export function configApprovalOriginalInput(sourceDomain: "G4", input: string): G4ConfigApprovalInput;
export function configApprovalOriginalInput(sourceDomain: ApprovalSource, input: string): [ApprovalValues, string];
export function configApprovalOriginalInput(sourceDomain: ApprovalSource, input: string): [ApprovalValues, string] {
  const original: unknown = JSON.parse(input);
  if (!Array.isArray(original) || typeof original[1] !== "string"
    || (sourceDomain === "F3" ? !Number.isSafeInteger(original[0]?.ownerUserId) || typeof original[0]?.settlementDate !== "string"
      : sourceDomain === "F4" ? !Number.isSafeInteger(original[0]?.expectedRevision)
      : sourceDomain === "H8" ? !Number.isSafeInteger(original[0]?.expectedVersion)
        || typeof original[0]?.key !== "string" || typeof original[0]?.value !== "string"
      : sourceDomain === "G4" ? original[0]?.paramKey !== "dividend" || typeof original[0]?.value !== "string"
        || typeof original[0]?.decisionRef !== "string" || !/^[0-9a-f]{64}$/.test(original[0]?.expectedRevision)
      : typeof original[0]?.expectedRevision !== "string")) {
    throw new Error("原审批命令不完整，请到操作记录核对。");
  }
  return original as [ApprovalValues, string];
}

export async function submitConfigApproval<T>(
  sourceDomain: ApprovalSource,
  session: AdminSession,
  values: ApprovalValues | null,
  reason: string,
  readActive: () => Promise<T>,
  mode: boolean | "retry-original" = false,
  scope?: ApprovalScope,
) {
  const { domain, action, op, type } = commands[sourceDomain];
  const slot = approvalSlot(sourceDomain, session.adminId, scope);
  const lookupOnly = mode === true;
  const previous = pendingConfigApproval(sourceDomain, session.adminId, scope);
  if (lookupOnly && !previous) return null;
  if (mode === "retry-original") {
    if (!previous) throw new Error("原审批命令已处理，请刷新页面后重新操作。");
    [values, reason] = configApprovalOriginalInput(sourceDomain, previous.input);
  }
  const input = JSON.stringify([values, reason]);
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
    if (previous && (domain === "B" || domain === "F" || sourceDomain === "E2" || sourceDomain === "G4" || sourceDomain === "H8" || session.authorities.includes("platform_a2_read"))) {
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
    if (!ticket) {
      if (!values) throw new Error("请填写完整后提交。");
      const objectId = sourceDomain === "F3" && "ownerUserId" in values && "settlementDate" in values
        ? `${values.ownerUserId}:${values.settlementDate}`
        : sourceDomain === "F4" ? "default" : sourceDomain === "G4" ? "dividend" : scope?.objectId ?? "current";
      ticket = await createA2OperationProposal({
        action,
        obj: objectId,
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
        command: { domain, op, params: sourceDomain === "G4" ? { ...values } : { values } },
        target: { domain, type, id: objectId },
      }, key, true);
    }
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
  if (sourceDomain !== "G4" || ticket.status !== "pending") attempts.forget(slot, key);
  return {
    active,
    ticket,
    acknowledgement: previous && lookupOnly && domain === "F"
      ? `已找到原审批单 ${ticket.id}${ticket.status === "pending" ? " · 等待另一位超管批准" : " · 请在操作记录查看处理结果"}`
      : previous && previous.input !== input
      ? `已找到原审批单 ${ticket.id}，本次输入未提交。请核对当前配置后重新操作。`
      : ticket.status === "pending"
        ? `已提交审批 · 审批单 ${ticket.id} · 等待另一位超管批准`
        : `审批单 ${ticket.id} 已登记，请在操作记录查看处理结果`,
  };
}

export const submitWithdrawalConfigApproval = submitConfigApproval;
