import { fundCommandOrigin, type FundCommandOrigin } from "./fund-command-investigation";
import {
  A2OutcomeUncertainError,
  createA2CommandKey,
  createA2OperationProposal,
  fetchA2ProposalByKey,
  isA2OutcomeUncertainError,
  type A2OperationRow,
} from "./a2-client";
import { isExplicitRejection } from "./explicit-rejection";
import { isBCommandRejection } from "./b-command-rejection";
import { createPendingMutationStore, type PendingMutationRecord } from "./pending-mutation-store";
import { roleLabel } from "@/lib/nav/console-nav";
import type { AdminSession } from "@/lib/store/admin-auth";
import type { F4AmbassadorPolicyUpdate } from "./f1-client";
import type { H8Original } from "./h8-reward-mutation";
import type { FDomainAttempt } from "./f2-approval";
import type { B1CommandFacts } from "./b1-commands";
import type { B5ThresholdFacts } from "./b5-commands";

export const configApprovalAttempts = createPendingMutationStore<PendingMutationRecord & Partial<FDomainAttempt> & {
  input: string;
  commandOrigin?: FundCommandOrigin;
  withdrawalRequest?: Parameters<typeof createA2OperationProposal>[0];
  h8Original?: H8Original;
  h8Ticket?: A2OperationRow;
  h8Acknowledged?: boolean;
  g4Ticket?: A2OperationRow;
  g4Request?: Parameters<typeof createA2OperationProposal>[0];
  b1Request?: Parameters<typeof createA2OperationProposal>[0];
  b1Facts?: B1CommandFacts;
  b1Ticket?: A2OperationRow;
  b1NotFound?: true;
  b5Request?: Parameters<typeof createA2OperationProposal>[0];
  b5Facts?: B5ThresholdFacts;
  b5Ticket?: A2OperationRow;
  b5NotFound?: true;
}>({
  storageKey: "nexion-admin-withdrawal-config-proposals",
  retainExpiredRecords: true,
  isValidRecord: (record) => typeof record.input === "string",
});
const attempts = configApprovalAttempts;

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

/** 按原操作重试被明确拒绝、人核实过结果后解除本页的锁。不发请求，只删这一条原命令（OP-153）。 */
export function releaseConfigApproval(sourceDomain: keyof typeof commands, adminId: string | number, commandKey: string, scope?: ApprovalScope) {
  attempts.forget(approvalSlot(sourceDomain, adminId, scope), commandKey);
}

/** H8 uses this existing store instance so other domains' in-flight approvals stay intact. */
export function storeH8ConfigApproval(adminId: number, field: string, commandKey: string, extra: {
  input: string; h8Original?: H8Original; h8Ticket?: A2OperationRow; h8Acknowledged?: boolean;
}, storageErrorCode: string) {
  const slot = approvalSlot("H8", adminId, { objectId: "current", field });
  attempts.remember(slot, commandKey, extra);
  if (!attempts.isDurablyStored(slot, commandKey)) throw new Error(storageErrorCode);
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
  if (source === "B1" && record.b1Request) {
    const request = record.b1Request;
    if (request.action !== "降低兑付覆盖率红线" || request.sourceDomain !== "B1" || request.obj !== "current"
      || request.command?.domain !== "B" || request.command.op !== "b1_coverage_thresholds"
      || request.target?.domain !== "B" || request.target.type !== "coverage_thresholds" || request.target.id !== "current"
      || request.type !== "fund" || request.amplifies !== true || request.sos !== false || request.roleGate !== "超管"
      || typeof request.operator !== "string" || typeof request.operatorRole !== "string"
      || JSON.stringify([request.command.params.values, request.reason]) !== record.input) {
      throw new Error("原审批内容不完整，请到操作记录核对。");
    }
  }
  if (source === "B1" && record.b1Facts && (typeof record.b1Facts.valuationReliable !== "boolean" || typeof record.b1Facts.redlineBreached !== "boolean"
    || ![record.b1Facts.reserveUsd, record.b1Facts.coverageRatio, record.b1Facts.redlinePct, record.b1Facts.healthyPct].every(Number.isFinite)
    || record.b1Facts.thresholdVersion !== null && !Number.isSafeInteger(record.b1Facts.thresholdVersion))) {
    throw new Error("原审批内容不完整，请到操作记录核对。");
  }
  if (source === "B5" && record.b5Request) {
    const request = record.b5Request;
    if (request.sourceDomain !== "B5" || request.obj !== "current" || request.action !== "提高提现压力红线"
      || request.command?.domain !== "B" || request.command.op !== "b5_bankrun_thresholds"
      || request.target?.domain !== "B" || request.target.type !== "bankrun_thresholds" || request.target.id !== "current"
      || typeof request.operator !== "string" || typeof request.operatorRole !== "string" || request.type !== "fund"
      || request.amplifies !== true || request.sos !== false || request.roleGate !== "超管"
      || JSON.stringify([request.command.params.values, request.reason]) !== record.input) {
      throw new Error("原审批内容不完整，请到操作记录核对。");
    }
  }
  if (source === "B5" && record.b5Facts && (!Number.isSafeInteger(record.b5Facts.version)
    || ![record.b5Facts.yellowPct, record.b5Facts.redPct].every(Number.isFinite)
    || record.b5Facts.ratio24h !== null && !Number.isFinite(record.b5Facts.ratio24h)
    || !["red", "yellow", "green", "unavailable"].includes(record.b5Facts.light))) {
    throw new Error("原审批内容不完整，请到操作记录核对。");
  }
  return { ...record, values: input[0] as ThresholdApprovalValues[T], reason: input[1] };
}

/** B5 uses the shared proposal store but never treats a creation replay as live pending status. */
export async function submitB5ThresholdApproval<T>(
  session: AdminSession,
  values: ThresholdApprovalValues["B5"],
  reason: string,
  readActive: () => Promise<T>,
  mode: "new" | "query" | "retry",
  facts?: B5ThresholdFacts,
) {
  const slot = approvalSlot("B5", session.adminId);
  const previous = pendingThresholdConfigApproval("B5", session.adminId);
  if (mode !== "new" && !previous) return null;
  if (mode === "new" && previous) throw new A2OutcomeUncertainError("请先查询原审批单。", previous.commandKey);
  const key = previous?.commandKey ?? createA2CommandKey("b5_bankrun_thresholds");
  const input = previous?.input ?? JSON.stringify([values, reason]);
  const request = previous ? previous.b5Request : {
    action: "提高提现压力红线", obj: "current", beforeValue: "—", afterValue: "—",
    operator: session.operator || session.username, operatorRole: roleLabel(session.role),
    type: "fund" as const, amplifies: true, sos: false, roleGate: "超管", reason, sourceDomain: "B5",
    command: { domain: "B", op: "b5_bankrun_thresholds", params: { values } },
    target: { domain: "B", type: "bankrun_thresholds", id: "current" },
  };
  const extra = { ...previous, input, b5Request: request, b5Facts: previous?.b5Facts ?? facts, b5NotFound: undefined };
  attempts.remember(slot, key, extra);
  if (!attempts.isDurablyStored(slot, key)) {
    if (!previous) attempts.forget(slot, key);
    throw new Error("浏览器没能记下这次操作，这次没有发出；请关闭无痕模式或允许本站保存数据后再试。");
  }
  const queryOriginal = async () => {
    try {
      const ticket = await fetchA2ProposalByKey(key, true, "metadata");
      // 111e00cd OpsAuditCenterService.ticketMetadata emits command.op for B5 too.
      if (ticket && (ticket.mine !== true || ticket.obj !== "current" || ticket.action !== "提高提现压力红线"
        || ticket.operationCode !== "b5_bankrun_thresholds")) {
        throw new A2OutcomeUncertainError("回执与原审批不匹配，请继续核对。", key);
      }
      if (!ticket && (extra.received || extra.b5Ticket)) throw new A2OutcomeUncertainError("批没批准还没查到，请继续查询原审批单。", key);
      attempts.remember(slot, key, { ...extra, ...(ticket ? { b5Ticket: ticket, received: true }
        : previous && previous.expiresAt <= Date.now() ? { b5NotFound: true as const } : {}) });
      return ticket;
    } catch {
      attempts.remember(slot, key, extra);
      throw new A2OutcomeUncertainError("批没批准还没查到，请继续查询原审批单。", key);
    }
  };
  let ticket = previous ? await queryOriginal() : null;
  if (!ticket) {
    if (mode === "query") return null;
    if (previous && (previous.expiresAt <= Date.now() || previous.received || previous.b5Ticket || !request)) {
      throw new A2OutcomeUncertainError("原审批暂未查到，请继续查询，不能重新提交。", key);
    }
    if (!session.authorities.includes("overview_b5_threshold_write")) throw new Error("当前账号缺少调整黄线红线的权限。");
    try {
      await createA2OperationProposal(request!, key, true);
    } catch (error) {
      if (isBCommandRejection(error, !!previous)) attempts.forget(slot, key);
      throw error;
    }
    extra.received = true;
    attempts.remember(slot, key, extra);
    ticket = await queryOriginal();
    if (!ticket) throw new A2OutcomeUncertainError("批没批准还没查到，请继续查询原审批单。", key);
  }
  let active: T | null = null;
  let activeReadFailed = false;
  try { active = await readActive(); }
  catch { activeReadFailed = true; }
  if (ticket.status !== "pending") attempts.forget(slot, key);
  // 读取失败时页面上已有待审批条和读取失败块，这里只补一句短的，不重复「等批准」。
  return { active, activeReadFailed, ticket, acknowledgement: ticket.status === "pending"
    ? `已提交审批 · 审批单 ${ticket.id}${activeReadFailed ? "；数据没读到，暂不能再改" : " · 等待另一位超级管理员批准"}`
    : `审批单 ${ticket.id} 已登记，请在操作记录查看处理结果${activeReadFailed ? "；数据没读到，暂不能再改" : ""}` };
}

/** Call only after the existing confirmation UI confirms R1-提案过期 release. */
async function releaseExpiredThresholdApproval(source: "B1" | "B5", adminId: string | number, commandKey: string) {
  const record = pendingThresholdConfigApproval(source, adminId);
  const ticketField = source === "B1" ? "b1Ticket" : "b5Ticket";
  const missingField = source === "B1" ? "b1NotFound" : "b5NotFound";
  if (!record || record.commandKey !== commandKey || record.expiresAt > Date.now() || !record[missingField] || record.received || record[ticketField]) return false;
  const slot = approvalSlot(source, adminId);
  attempts.remember(slot, commandKey, { ...record, [missingField]: undefined });
  const ticket = await fetchA2ProposalByKey(commandKey, true, "metadata");
  if (ticket) {
    const action = source === "B1" ? "降低兑付覆盖率红线" : "提高提现压力红线";
    if (ticket.mine !== true || ticket.obj !== "current" || ticket.action !== action || ticket.operationCode !== commands[source].op) {
      throw new A2OutcomeUncertainError("回执与原审批不匹配，请继续核对。", commandKey);
    }
    attempts.remember(slot, commandKey, { ...record, received: true, [ticketField]: ticket, [missingField]: undefined });
    return false;
  }
  attempts.forget(slot, commandKey);
  return true;
}

export const releaseExpiredB5ThresholdApproval = (adminId: string | number, commandKey: string) => releaseExpiredThresholdApproval("B5", adminId, commandKey);
export const releaseExpiredB1ThresholdApproval = (adminId: string | number, commandKey: string) => releaseExpiredThresholdApproval("B1", adminId, commandKey);

/** B1 keeps the complete request and queries the live ticket after any replay. */
export async function submitB1ThresholdApproval<T>(
  session: AdminSession,
  values: ThresholdApprovalValues["B1"],
  reason: string,
  readActive: () => Promise<T>,
  mode: "new" | "query" | "retry",
  facts?: B1CommandFacts,
) {
  const slot = approvalSlot("B1", session.adminId);
  const previous = pendingThresholdConfigApproval("B1", session.adminId);
  if (mode !== "new" && !previous) return null;
  if (mode === "new" && previous) throw new A2OutcomeUncertainError("请先查询原审批单。", previous.commandKey);
  const input = previous?.input ?? JSON.stringify([values, reason]);
  const key = previous?.commandKey ?? createA2CommandKey("b1_coverage_thresholds");
  const request = previous ? previous.b1Request : {
    action: "降低兑付覆盖率红线", obj: "current", beforeValue: "—", afterValue: "—",
    operator: session.operator || session.username, operatorRole: roleLabel(session.role),
    type: "fund" as const, amplifies: true, sos: false, roleGate: "超管", reason, sourceDomain: "B1",
    command: { domain: "B", op: "b1_coverage_thresholds", params: { values } },
    target: { domain: "B", type: "coverage_thresholds", id: "current" },
  };
  const extra = { ...previous, input, b1Request: request, b1Facts: previous?.b1Facts ?? facts, b1NotFound: undefined };
  attempts.remember(slot, key, extra);
  if (!attempts.isDurablyStored(slot, key)) {
    if (!previous) attempts.forget(slot, key);
    throw new Error("浏览器没能记下这次操作，这次没有发出；请关闭无痕模式或允许本站保存数据后再试。");
  }
  const queryOriginal = async () => {
    try {
      const ticket = await fetchA2ProposalByKey(key, true);
      // 111e00cd ticketMetadata now returns command.op for B1, including history.
      if (ticket && (ticket.mine !== true || ticket.obj !== "current" || ticket.action !== "降低兑付覆盖率红线"
        || ticket.operationCode !== "b1_coverage_thresholds")) {
        throw new A2OutcomeUncertainError("回执与原审批不匹配，请继续核对。", key);
      }
      if (!ticket && (extra.received || extra.b1Ticket)) throw new A2OutcomeUncertainError("批没批准还没查到，请继续查询原审批单。", key);
      attempts.remember(slot, key, { ...extra, ...(ticket ? { b1Ticket: ticket, received: true } : { b1NotFound: true as const }) });
      return ticket;
    } catch {
      // A saved creation receipt is not the current approval status.
      attempts.remember(slot, key, extra);
      throw new A2OutcomeUncertainError("批没批准还没查到，请继续查询原审批单。", key);
    }
  };
  let ticket = previous ? await queryOriginal() : null;
  if (!ticket) {
    if (mode === "query") return null;
    if (previous && (previous.expiresAt <= Date.now() || previous.received || previous.b1Ticket || !request)) {
      throw new A2OutcomeUncertainError("原审批暂未查到，请继续查询，不能重新提交。", key);
    }
    if (!session.authorities.includes("overview_b1_redline_write")) throw new Error("当前账号缺少设置兑付覆盖率阈值的权限。");
    attempts.remember(slot, key, extra);
    if (!attempts.isDurablyStored(slot, key)) throw new Error("浏览器没能记下这次操作，这次没有发出；请关闭无痕模式或允许本站保存数据后再试。");
    try {
      await createA2OperationProposal(request!, key, true);
    } catch (error) {
      if (isBCommandRejection(error, !!previous)) attempts.forget(slot, key);
      throw error;
    }
    extra.received = true;
    attempts.remember(slot, key, extra);
    ticket = await queryOriginal();
    if (!ticket) throw new A2OutcomeUncertainError("批没批准还没查到，请继续查询原审批单。", key);
  }
  // Re-read current data. A successful replay must never publish its old snapshot.
  let active: T | null = null;
  let activeReadFailed = false;
  try { active = await readActive(); }
  catch { activeReadFailed = true; }
  if (ticket.status !== "pending") attempts.forget(slot, key);
  // 读取失败时页面上已有待审批条和读取失败块，这里只补一句短的，不重复「等批准」。
  return { active, activeReadFailed, ticket, acknowledgement: ticket.status === "pending"
    ? `已提交审批 · 审批单 ${ticket.id}${activeReadFailed ? "；数据没读到，暂不能再改" : " · 等待另一位超级管理员批准"}`
    : `审批单 ${ticket.id} 已登记，请在操作记录查看处理结果${activeReadFailed ? "；数据没读到，暂不能再改" : ""}` };
}

export function configApprovalOriginalInput(sourceDomain: "H8", input: string): H8ConfigApprovalInput;
export function configApprovalOriginalInput(sourceDomain: "G4", input: string): G4ConfigApprovalInput;
export function configApprovalOriginalInput(sourceDomain: ApprovalSource, input: string): [ApprovalValues, string];
export function configApprovalOriginalInput(sourceDomain: ApprovalSource, input: string): [ApprovalValues, string] {
  const original: unknown = JSON.parse(input);
  if (!Array.isArray(original) || typeof original[1] !== "string"
    || (sourceDomain === "F3" ? !Number.isSafeInteger(original[0]?.ownerUserId) || typeof original[0]?.settlementDate !== "string"
      : sourceDomain === "F4" ? !Number.isSafeInteger(original[0]?.expectedRevision)
      : sourceDomain === "D5" ? !Number.isSafeInteger(original[0]?.expectedVersion)
      : sourceDomain === "H8" ? !Number.isSafeInteger(original[0]?.expectedVersion)
        || typeof original[0]?.key !== "string" || typeof original[0]?.value !== "string"
      : sourceDomain === "G4" ? original[0]?.paramKey !== "dividend" || typeof original[0]?.value !== "string"
        || typeof original[0]?.decisionRef !== "string" || !/^[0-9a-f]{64}$/.test(original[0]?.expectedRevision)
      : sourceDomain === "D7" ? !Number.isSafeInteger(original[0]?.expectedVersion)
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
  if (sourceDomain === "G4" && previous?.g4Request) {
    const saved = previous.g4Request;
    if (saved.sourceDomain !== "G4" || saved.obj !== "dividend" || saved.command?.domain !== "G" || saved.command.op !== op
      || saved.target?.domain !== "G" || saved.target.type !== "genesis_param" || saved.target.id !== "dividend"
      || typeof saved.operator !== "string" || typeof saved.operatorRole !== "string"
      || JSON.stringify([saved.command.params, saved.reason]) !== previous.input) {
      throw new A2OutcomeUncertainError("原日分红请求不完整，请保留命令号并核对原审批单。", key);
    }
  }
  const objectId = values && sourceDomain === "F3" && "ownerUserId" in values && "settlementDate" in values
    ? `${values.ownerUserId}:${values.settlementDate}`
    : sourceDomain === "F4" ? "default" : sourceDomain === "G4" ? "dividend" : scope?.objectId ?? "current";
  const proposal = (sourceDomain === "D5" || sourceDomain === "D7") && previous?.withdrawalRequest ? previous.withdrawalRequest : sourceDomain === "G4" && previous?.g4Request ? previous.g4Request : values ? {
    action, obj: objectId, beforeValue: "—", afterValue: "—",
    operator: session.operator || session.username, operatorRole: roleLabel(session.role),
    type: "fund" as const, amplifies: true, sos: false, roleGate: "超管", reason, sourceDomain,
    command: { domain, op, params: sourceDomain === "G4" ? { ...values } : { values } },
    target: { domain, type, id: objectId },
  } : undefined;
  if (!previous) {
    attempts.remember(slot, key, { input, ...(sourceDomain === "G4" ? { g4Request: proposal } : {}),
      ...((sourceDomain === "D5" || sourceDomain === "D7") ? { withdrawalRequest: proposal,
        commandOrigin: fundCommandOrigin("POST", "/api/admin/platform/audit/operations", sourceDomain === "D5" ? "finance_d5_read" : "finance_d7_read") } : {}) });
    if (!attempts.isDurablyStored(slot, key)) {
      attempts.forget(slot, key);
      throw new Error("浏览器没能记下这次操作，这次没有发出；请关闭无痕模式或允许本站保存数据后再试。");
    }
  }

  let ticket;
  let canClearOnRejection = !previous;
  try {
    // 发起人也能按命令号查自己发起的单（后端 A2AccessPolicy.requireProposalReader、WithdrawalConfigApproval.canReadOwnProposal）。
    if (previous && (domain === "B" || domain === "F" || sourceDomain === "E2" || sourceDomain === "G4" || sourceDomain === "H8"
      || session.authorities.includes("platform_a2_read") || session.authorities.includes("platform_a2_proposal_create"))) {
      try {
        // 只有 A2_PROPOSAL_NOT_FOUND 才算没有原单；OPERATION_RESULT_UNKNOWN 这类 404 说明不了，按查询失败保留原命令。
        ticket = await fetchA2ProposalByKey(key, true);
      } catch {
        throw new A2OutcomeUncertainError("暂时无法查询原审批单。", key);
      }
      canClearOnRejection = ticket === null;
    }
    if (sourceDomain === "G4" && previous?.g4Ticket && !ticket) throw new A2OutcomeUncertainError("暂未查到已收录的原审批单，请继续核对，不能重新提交。", key);
    if (previous && !ticket && (previous.expiresAt <= Date.now() || sourceDomain === "G4" && Date.now() < previous.createdAt)) {
      throw new A2OutcomeUncertainError("原审批命令已过期，暂未查到结果。请到操作记录核对，勿重复提交。", key);
    }
    if (lookupOnly && !ticket) return null;
    if (previous && previous.input !== input && !ticket) {
      throw new A2OutcomeUncertainError("请用原配置和原理由核对该命令，或在操作记录中查询。", key);
    }
    if (!ticket) {
      if (!proposal) throw new Error("请填写完整后提交。");
      ticket = await createA2OperationProposal(proposal, key, true);
    }
  } catch (error) {
    if (error instanceof Error && "backendMessage" in error
        && ["IDEMPOTENCY_REQUEST_IN_PROGRESS", "IDEMPOTENCY_RESULT_UNKNOWN", "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH"].includes(String(error.backendMessage))) {
      throw new A2OutcomeUncertainError("原命令仍待确认，请稍后查询。", key);
    }
    // 查无原单后的恢复，只能由带原因码的明确拒绝解除；权限、限流等仍保留原记录。
    // 首次新命令沿用原来的拒绝清理规则。
    if (canClearOnRejection && (previous || sourceDomain === "G4" ? isExplicitRejection(error) : !isA2OutcomeUncertainError(error))) attempts.forget(slot, key);
    throw error;
  }

  if (sourceDomain === "G4") {
    // AuditReplayBusinessPermissionGuard.validateProposalContext canonicalizes
    // all dividend tickets; OpsAuditCenterService.ticketMetadata adds no G4 code.
    if (ticket.mine !== true || ticket.obj !== "dividend" || ticket.action !== "批准创世分红操作"
      || ticket.operationCode && ticket.operationCode !== op) {
      throw new A2OutcomeUncertainError("回执与原日分红审批不匹配，请继续核对。", key);
    }
    attempts.remember(slot, key, { input: previous?.input ?? input, g4Ticket: ticket, g4Request: proposal });
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
