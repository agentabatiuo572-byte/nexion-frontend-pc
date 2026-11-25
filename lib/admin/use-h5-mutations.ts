"use client";

import { HApprovalRequired } from "./h-approval-required";
import { isHGrowthReadConflict } from "./h-write-conflict";

import { useEffect, useReducer, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { roleLabel } from "@/lib/nav/console-nav";
import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError, type A2OperationRow } from "./a2-client";
import { growthRequest } from "./h-client";
import { H5_MAX_SORT_ORDER, h5RuleWriteRefusal, h5Amount, parseH5Model, type H5Model } from "./h5-contract";
import { isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection, isOutcomeUnknownError, OutcomeUnknownError } from "./outcome-classification";
import { createPendingMutationStore, isRetryExpired, PENDING_MUTATION_TTL_MS, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "./pending-mutation-store";
import { displayAdminReadError } from "./error-messages";

type Proposal = Parameters<typeof createA2OperationProposal>[0];
export const EARN_CREATE_TARGET = "earn-create:new";
const EARN_CREATE_OPERATION = "h5_earn_milestone_create";
type EarnCreate = { milestoneKey: string; label: string; thresholdUsd: string; rewardNex: string; sortOrder: number };
type Direct = { path: string; body: Record<string, string | number> };
export type H5Change = {
  target: string;
  action: string;
  name: string;
  before: string;
  after: string;
  success: string;
  snapshot: H5Model;
  editValue?: string;
  businessValue?: Record<string, string>;
  reason: string;
  direct?: Direct;
  earnCreate?: EarnCreate;
  proposal?: Pick<Proposal, "command" | "target" | "type" | "amplifies" | "roleGate">
    & Partial<Pick<Proposal, "beforeValue" | "afterValue">>;
  approvalRequired: boolean;
};
export interface H5PendingCommand extends PendingMutationRecord {
  adminId: number;
  change: H5Change;
  request: { kind: "direct"; path: string; body: string } | { kind: "approval"; body: Proposal } | { kind: "earn-create"; body: EarnCreate & { reason: string } };
  acknowledged?: boolean;
  ticket?: A2OperationRow;
}

export function h5PowerUpDayChange(expectedDay: number, day: number) {
  return { before: `连签 ${expectedDay} 天`, after: `连签 ${day} 天` };
}

export function h5OriginalNonMultiplierPowerUpSummary({ change, request }: H5PendingCommand) {
  if (!change.target.startsWith("power:") || request.kind === "earn-create") return;
  const powerUp = change.snapshot.powerUps.find(item => `power:${item.id}` === change.target);
  if (!powerUp || powerUp.effectType === "CHECKIN_MULTIPLIER") return;
  const values = (request.kind === "direct" ? JSON.parse(request.body) : request.body.command.params.values) as Record<string, unknown> | undefined;
  if (typeof values?.day !== "number" || typeof values.expectedDay !== "number") return;
  const dayChanged = values.day !== values.expectedDay;
  const noteChanged = typeof values.note === "string" && typeof values.expectedNote === "string" && values.note !== values.expectedNote;
  const { before, after } = h5PowerUpDayChange(values.expectedDay, values.day);
  if (!dayChanged) return noteChanged ? `只改了说明文字，${before}不变` : undefined;
  return `${before} → ${after}${noteChanged ? "，还会改旧说明文字" : ""}`;
}

const paths = (target: string) => {
  const [kind, ...idParts] = target.split(":");
  const id = idParts.join(":");
  return kind === "streak" ? `/check-in/streak-milestones/${id}` : kind === "power" ? `/check-in/power-ups/${id}/config`
    : kind === "earn" ? `/earn-milestones/${encodeURIComponent(id)}` : kind === "tick" ? "/earn-milestones/tick-interval" : undefined;
};
const operations: Record<string, string> = { rule: "h5_checkin_rule", streak: "h5_streak_milestone", power: "h5_power_up_config", earn: "h5_earn_milestone" };
const targetTypes: Record<string, string> = { rule: "checkin_rule", streak: "h5_streak_milestone", power: "h5_power_up", earn: "h5_earn_milestone" };

// One H5 instance, including retained expired records. Storage is the only unknown-input boundary.
const pending = createPendingMutationStore<H5PendingCommand>({
  storageKey: "nexion-admin-h5-mutations-v1",
  retainExpiredRecords: true,
  isValidRecord: r => {
    try {
      if (!Number.isSafeInteger(r.adminId) || r.adminId <= 0 || !r.change || !r.request) return false;
      const c = r.change;
      const [kind, ...idParts] = c.target.split(":");
      const id = idParts.join(":");
      if (!id || !["rule", "streak", "power", "earn", "earn-create", "tick"].includes(kind)
        || r.fingerprint !== `${r.adminId}|H5|${c.target}`
        || ![c.action, c.name, c.before, c.after, c.success, c.reason].every(v => typeof v === "string")
        || c.editValue !== undefined && typeof c.editValue !== "string"
        || c.businessValue !== undefined && (!c.businessValue || Object.values(c.businessValue).some(v => typeof v !== "string"))) return false;
      const snapshot = parseH5Model(c.snapshot);
      if ((kind === "streak" || kind === "power") && (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647)
        || kind === "rule" && !snapshot.rules.some(item => item.key === id)
        || kind === "streak" && !snapshot.streakMilestones.some(item => item.id === Number(id))
        || kind === "power" && !snapshot.powerUps.some(item => item.id === Number(id))
        || kind === "earn" && !snapshot.earnMilestones.some(item => item.key === id)
        || kind === "tick" && id !== "interval"
        || r.acknowledged !== undefined && typeof r.acknowledged !== "boolean") return false;
      const proposalValid = (p: H5Change["proposal"]) => p?.command?.domain === "H" && p.command.op === operations[kind]
        && p.target?.domain === "H" && p.target.type === targetTypes[kind] && p.target.id === id
        && !!p.command.params && (kind === "rule" ? p.command.params.ruleKey === id : !!p.command.params.values);
      if (r.request.kind === "earn-create") {
        const body = r.request.body;
        const values = c.businessValue;
        return c.target === EARN_CREATE_TARGET && c.approvalRequired && !!values && !!body
          && body.milestoneKey === values.milestoneKey && /^[A-Za-z0-9_-]{1,64}$/.test(body.milestoneKey)
          && body.label === values.label && body.thresholdUsd === values.threshold && body.rewardNex === values.nex
          && Number.isSafeInteger(body.sortOrder) && body.sortOrder >= 0 && body.sortOrder <= H5_MAX_SORT_ORDER && body.reason === c.reason
          && (!r.ticket || validTicket(r.ticket, body.milestoneKey, EARN_CREATE_OPERATION));
      }
      if (kind === "earn-create") return false;
      if (c.proposal && !proposalValid(c.proposal)) return false;
      if (r.request.kind === "approval") {
        const body = r.request.body;
        if (r.ticket && !validTicket(r.ticket, id, body.command.op)) return false;
        return proposalValid(body) && body.sourceDomain === "H5" && body.obj === id && body.reason === c.reason
          && typeof body.operator === "string" && typeof body.operatorRole === "string";
      }
      if (r.request.kind !== "direct" || r.request.path !== paths(c.target) || typeof r.request.body !== "string") return false;
      const body = JSON.parse(r.request.body);
      return !!body && typeof body === "object" && body.reason === c.reason && typeof body.operator === "string";
    } catch { return false; }
  },
});

function validTicket(ticket: A2OperationRow | null | undefined, obj: string, operation: string) {
  return !!ticket && typeof ticket.id === "string" && !!ticket.id && ticket.mine === true && ticket.obj === obj
    && ticket.operationCode === operation && ["pending", "approved", "rejected", "expired", "withdrawn"].includes(ticket.status);
}

function firstRejection(error: unknown) {
  if (isA2OutcomeUncertainError(error) || isOutcomeUnknownError(error)) return false;
  const e = error as { status?: number; apiCode?: number; reasonCode?: string; backendMessage?: string; unknownOutcome?: boolean; bodyUnreadable?: boolean } | null;
  return !!e && !e.unknownOutcome && !e.bodyUnreadable && !(e.apiCode !== undefined && e.apiCode >= 500) && !(e.reasonCode ?? e.backendMessage ?? "").startsWith("IDEMPOTENCY_")
    && isDeterministicRejection(e.status ?? 0, e.apiCode);
}

// Growth may return a business refusal in an HTTP 200 envelope.
function normalizeGrowthRejection(error: unknown) {
  const e = error as { status?: number; apiCode?: number };
  if (e.status !== undefined && e.status >= 200 && e.status < 300 && e.apiCode !== undefined && e.apiCode >= 400 && e.apiCode < 500) e.status = e.apiCode;
}

/** Requests and recovery only. All forms, facts, labels and status slots belong to H5's existing view. */
export function useH5Mutations(toast: (message: string) => void, settled: (commandKey?: string) => Promise<void>, isFresh: () => boolean) {
  const adminId = useAdminAuth(s => s.session?.adminId);
  const [, update] = useReducer(n => n + 1, 0);
  const [ticketReadErrors, setTicketReadErrors] = useState<Record<string, string>>({});
  useEffect(() => { update(); }, [adminId]);
  const records = () => pending.list().filter(r => r.adminId === adminId);
  const record = (target: string) => records().find(r => r.change.target === target);
  const requireActor = (target: string, write: boolean) => {
    const auth = useAdminAuth.getState();
    const session = auth.session;
    if (!auth.isAuthenticated || auth.logoutPending || !session || session.adminId !== adminId) throw new Error("ADMIN_AUTH_REQUIRED");
    if (write) {
      const kind = target.split(":")[0];
      const authority = kind === "rule" ? "growth_h5_rule_write" : kind === "tick" ? "growth_h5_tick_write" : "growth_h5_write";
      if (!session.authorities.includes(authority) || kind === "tick" && !["super", "superadmin"].includes(session.role)
        || kind === "rule" && !session.authorities.some(a => a === "platform_a2_write" || a === "platform_a2_proposal_create")) throw new Error("H5_MAKER_FORBIDDEN");
    }
    return session;
  };
  const forget = (original: H5PendingCommand) => {
    pending.forget(original.fingerprint, original.commandKey);
    update();
  };
  const retain = (original: H5PendingCommand) => {
    pending.remember(original.fingerprint, original.commandKey, original);
    update();
    if (!pending.isDurablyStored(original.fingerprint, original.commandKey)) throw new Error("浏览器存不下这次操作的完整内容，本次没有发送。请保留原记录并查询原结果。");
  };
  const checkTicket = (original: H5PendingCommand, ticket: A2OperationRow) => {
    const { request } = original;
    const matches = request.kind === "approval" ? validTicket(ticket, request.body.obj, request.body.command.op)
      : request.kind === "earn-create" && validTicket(ticket, request.body.milestoneKey, EARN_CREATE_OPERATION);
    if (!matches) {
      throw new Error("审批单与保存的原申请不符，原操作继续保留，请查询原结果。");
    }
  };
  const readTicket = async (original: H5PendingCommand) => {
    try {
      const ticket = await fetchA2ProposalByKey(original.commandKey, true, "a");
      if (ticket) checkTicket(original, ticket);
      else if (original.ticket || original.acknowledged) throw new Error("暂未读到已提交的审批单，保留上次读到的状态。");
      setTicketReadErrors(({ [original.commandKey]: _, ...rest }) => rest);
      return ticket;
    } catch (error) {
      setTicketReadErrors(current => ({ ...current, [original.commandKey]: displayAdminReadError(error) }));
      throw error;
    }
  };
  const query = async (original: H5PendingCommand, feedback: "lookup" | "refresh" | "submitted" = "lookup") => {
    requireActor(original.change.target, false);
    if (original.request.kind === "direct") {
      await settled(original.commandKey);
      if (feedback !== "refresh") toast("已重读当前配置；当前值不能证明原操作是否执行，记录继续保留，请到操作记录与审批核对。");
      return undefined;
    }
    const ticket = await readTicket(original);
    if (!ticket) {
      // 过期后不能重试，下一步是去操作记录与审批核对（OP-152、OP-153）；没过期的照旧可以按原操作重试。
      if (feedback !== "refresh") toast(isRetryExpired(original) ? "没查到原审批单。原申请已过期，记录和修改锁保留，请到操作记录与审批核对。" : "暂未查到原审批单，原操作继续保留。");
      return null;
    }
    if (ticket.status === "pending") retain({ ...original, acknowledged: true, ticket });
    else forget(original);
    if (feedback === "submitted" && ticket.status === "pending") {
      toast(`已提交，等待审批后执行 · 审批单 ${ticket.id}`);
    } else if (feedback !== "refresh" || ticket.status !== "pending") {
      const status = { pending: "待审批", approved: "已批准", rejected: "被拒", expired: "已过期", withdrawn: "已撤回" }[ticket.status];
      const summary = h5OriginalNonMultiplierPowerUpSummary(original) ?? `${ticket.before} → ${ticket.after}`;
      toast(`审批单${status}：${summary}`);
    }
    if (ticket.status !== "pending") await settled(original.commandKey);
    return ticket;
  };
  const send = async (original: H5PendingCommand, recovering: boolean) => {
    requireActor(original.change.target, true);
    if (isRetryExpired(original)) throw new Error(RETRY_EXPIRED_TEXT);
    if (original.acknowledged || original.ticket) throw new Error("申请已建单，请查询原结果。");
    try { retain(original); } catch (error) {
      if (!recovering) forget(original);
      throw error;
    }
    const { request } = original;
    if (request.kind !== "direct") {
      let receipt: A2OperationRow;
      try {
        if (request.kind === "earn-create") {
          receipt = await growthRequest<A2OperationRow>("/earn-milestones", {
            method: "POST", body: JSON.stringify(request.body), headers: { "Idempotency-Key": original.commandKey },
          }, undefined, true);
        } else {
          receipt = await createA2OperationProposal(request.body, original.commandKey, true);
        }
      } catch (error) {
        if (request.kind === "earn-create") normalizeGrowthRejection(error);
        if (recovering ? isExplicitRejection(error) : firstRejection(error)) {
          forget(original);
          if (recovering || isHGrowthReadConflict(error)) await settled(original.commandKey);
        }
        throw error;
      }
      checkTicket(original, receipt);
      // A POST replay is only historical evidence. Only the by-key GET may mark it pending.
      const acknowledged = { ...original, acknowledged: true };
      retain(acknowledged);
      const current = await query(acknowledged, recovering ? "lookup" : "submitted");
      if (!current) throw new OutcomeUnknownError("申请已建单，批没批准还没查到。请查询原结果，原操作继续保留。");
      if ((recovering || request.kind === "earn-create") && current.status === "pending") await settled(original.commandKey);
      return;
    }
    let result: Record<string, unknown>;
    try {
      result = await growthRequest(request.path, { method: "PATCH", body: request.body, headers: { "Idempotency-Key": original.commandKey } }, undefined, true);
    } catch (error) {
      normalizeGrowthRejection(error);
      if (recovering ? isExplicitRejection(error) : firstRejection(error)) {
        forget(original);
        if (recovering || isHGrowthReadConflict(error)) await settled(original.commandKey);
      }
      throw error;
    }
    // Validate the command-specific receipt, but never install a historical replay as current data.
    const updated = result?.updated as Record<string, unknown> | undefined;
    const body = JSON.parse(request.body) as Record<string, string | number>;
    const [kind, ...idParts] = original.change.target.split(":");
    const id = idParts.join(":");
    const [tickWhole, tickFraction = ""] = kind === "tick" ? String(body.value).split(".") : ["0"];
    const tickSeconds = (BigInt(tickWhole) * BigInt(1000000) + BigInt(tickFraction.slice(0, 6).padEnd(6, "0"))
      + (Number(tickFraction[6] ?? "0") >= 5 ? BigInt(1) : BigInt(0))) / BigInt(1000000);
    const valid = kind === "streak" ? updated?.source === "nx_streak_milestone" && updated.milestoneId === Number(id) && updated.reward === body.value
      : kind === "power" ? updated?.source === "nx_streak_power_up" && updated.powerUpId === Number(id) && updated.day === body.day && updated.note === body.note
        : kind === "earn" ? updated?.source === "nx_earning_milestone_rule" && updated.key === id && h5Amount(String(updated.newThresholdUsd)) === h5Amount(String(body.thresholdUsd)) && h5Amount(String(updated.newRewardNex)) === h5Amount(String(body.rewardNex))
          : updated?.configKey === "growth.earn_milestone.tick_interval_seconds" && String(updated.seconds) === String(tickSeconds);
    if (!valid) throw new OutcomeUnknownError("保存后返回的内容和原修改对不上，原操作继续保留，请查询原结果。");
    forget(original);
    await settled(original.commandKey);
    toast(original.change.success);
  };
  const run = async (change: H5Change, onCommand?: (commandKey: string) => void) => {
    const actor = requireActor(change.target, true);
    const ruleKey = change.target.startsWith("rule:") ? change.target.slice(5) : undefined;
    const refusal = ruleKey === undefined ? undefined : h5RuleWriteRefusal(ruleKey);
    if (refusal) throw new Error(refusal);
    if (!isFresh()) throw new Error("请先成功刷新签到数据，再发起新的修改。");
    if (record(change.target)) throw new Error("这一项有未结束的原操作，请先查询原结果。");
    const fingerprint = `${actor.adminId}|H5|${change.target}`;
    const proposal = change.proposal ? {
      action: change.action, obj: change.target.slice(change.target.indexOf(":") + 1), beforeValue: change.before, afterValue: change.after,
      operator: actor.operator || actor.username, operatorRole: roleLabel(actor.role), sos: false, sourceDomain: "H5", reason: change.reason,
      ...change.proposal,
    } : undefined;
    const create = (approval: boolean): H5PendingCommand => {
      const request: H5PendingCommand["request"] = change.earnCreate
        ? { kind: "earn-create", body: { ...change.earnCreate, reason: change.reason } }
        : approval && proposal ? { kind: "approval", body: proposal }
        : change.direct ? { kind: "direct", path: change.direct.path, body: JSON.stringify({ ...change.direct.body, reason: change.reason, operator: actor.operator || actor.username }) }
          : (() => { throw new Error("H5_PROPOSAL_INVALID"); })();
      const now = Date.now();
      return { fingerprint, commandKey: createA2CommandKey(request.kind === "direct" ? "h5-direct" : "h5-proposal"), createdAt: now, expiresAt: now + PENDING_MUTATION_TTL_MS, adminId: actor.adminId, change, request };
    };
    try {
      const original = create(change.approvalRequired);
      onCommand?.(original.commandKey);
      await send(original, false);
    } catch (error) {
      const e = error as { reasonCode?: string; backendMessage?: string };
      // The streak read model has no stored amount. Its direct endpoint determines direction.
      // Only an explicit first-attempt no-write verdict may switch to a new A2 command.
      if (!change.approvalRequired && proposal && firstRejection(error) && (e.reasonCode ?? e.backendMessage) === "H5_APPROVAL_REQUIRED") {
        throw new HApprovalRequired((error as Error).message, change, () => run({ ...change, approvalRequired: true }, onCommand));
      } else {
        throw error;
      }
    }
  };

  return {
    records: records(), record, query, ticketReadErrors,
    canRetry(original: H5PendingCommand) {
      if (isRetryExpired(original) || original.acknowledged || original.ticket) return false;
      try { requireActor(original.change.target, true); return true; } catch { return false; }
    },
    async refreshTickets() {
      await Promise.allSettled(records().filter(r => r.request.kind !== "direct").map(r => query(r, "refresh")));
    },
    async retry(original: H5PendingCommand) {
      const current = record(original.change.target);
      if (current?.commandKey !== original.commandKey) throw new Error("原操作已处理，请刷新后重新操作。");
      if (current.request.kind !== "direct") {
        const ticket = await query(current);
        if (ticket) {
          if (ticket.status === "pending") await settled(original.commandKey);
          return;
        }
      }
      return send(current, true);
    },
    run,
  };
}
