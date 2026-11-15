"use client";

import { HApprovalRequired } from "./h-approval-required";
import { isHGrowthReadConflict } from "./h-write-conflict";

import { useEffect, useReducer } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { roleLabel } from "@/lib/nav/console-nav";
import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError, type A2OperationRow } from "./a2-client";
import { growthRequest } from "./h-client";
import { h5Amount, parseH5Model, type H5Model } from "./h5-contract";
import { isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection, isOutcomeUnknownError, OutcomeUnknownError } from "./outcome-classification";
import { createPendingMutationStore, isRetryExpired, PENDING_MUTATION_TTL_MS, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "./pending-mutation-store";

type Proposal = Parameters<typeof createA2OperationProposal>[0];
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
  proposal?: Pick<Proposal, "command" | "target" | "type" | "amplifies" | "roleGate">;
  approvalRequired: boolean;
};
export interface H5PendingCommand extends PendingMutationRecord {
  adminId: number;
  change: H5Change;
  request: { kind: "direct"; path: string; body: string } | { kind: "approval"; body: Proposal };
  acknowledged?: boolean;
  ticket?: A2OperationRow;
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
      if (!id || !["rule", "streak", "power", "earn", "tick"].includes(kind)
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
      if (c.proposal && !proposalValid(c.proposal)) return false;
      if (r.request.kind === "approval") {
        const body = r.request.body;
        if (r.ticket && (typeof r.ticket.id !== "string" || !r.ticket.id || !r.ticket.mine || r.ticket.obj !== id
          || r.ticket.operationCode !== body.command.op || !["pending", "approved", "rejected", "expired", "withdrawn"].includes(r.ticket.status))) return false;
        return proposalValid(body) && body.sourceDomain === "H5" && body.obj === id && body.reason === c.reason
          && typeof body.operator === "string" && typeof body.operatorRole === "string";
      }
      if (r.request.kind !== "direct" || r.request.path !== paths(c.target) || typeof r.request.body !== "string") return false;
      const body = JSON.parse(r.request.body);
      return !!body && typeof body === "object" && body.reason === c.reason && typeof body.operator === "string";
    } catch { return false; }
  },
});

function firstRejection(error: unknown) {
  if (isA2OutcomeUncertainError(error) || isOutcomeUnknownError(error)) return false;
  const e = error as { status?: number; apiCode?: number; reasonCode?: string; backendMessage?: string; unknownOutcome?: boolean; bodyUnreadable?: boolean } | null;
  return !!e && !e.unknownOutcome && !e.bodyUnreadable && !(e.apiCode !== undefined && e.apiCode >= 500) && !(e.reasonCode ?? e.backendMessage ?? "").startsWith("IDEMPOTENCY_")
    && isDeterministicRejection(e.status ?? 0, e.apiCode);
}

/** Requests and recovery only. All forms, facts, labels and status slots belong to H5's existing view. */
export function useH5Mutations(toast: (message: string) => void, settled: (commandKey?: string) => Promise<void>, isFresh: () => boolean) {
  const adminId = useAdminAuth(s => s.session?.adminId);
  const [, update] = useReducer(n => n + 1, 0);
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
    if (!pending.isDurablyStored(original.fingerprint, original.commandKey)) throw new Error("浏览器存不下完整原请求，本次没有发送。请保留原记录并查询原结果。");
  };
  const checkTicket = (original: H5PendingCommand, ticket: A2OperationRow) => {
    const proposal = original.request.kind === "approval" ? original.request.body : undefined;
    // 111e00cd ticketMetadata returns operationCode for every persisted command, including H5.
    if (!proposal || !ticket.mine || ticket.obj !== proposal.obj || ticket.operationCode !== proposal.command.op
      || !["pending", "approved", "rejected", "expired", "withdrawn"].includes(ticket.status)) {
      throw new Error("审批单与保存的原申请不符，原请求继续保留，请查询原结果。");
    }
  };
  const query = async (original: H5PendingCommand, quiet = false) => {
    requireActor(original.change.target, false);
    if (original.request.kind === "direct") {
      await settled();
      if (!quiet) toast("已重读当前配置；当前值不能证明原操作是否执行，原请求继续保留，请到操作记录与审批核对。");
      return undefined;
    }
    if (original.ticket) retain({ ...original, acknowledged: true, ticket: undefined });
    const ticket = await fetchA2ProposalByKey(original.commandKey, true);
    if (!ticket) {
      if (!quiet) toast("暂未查到原审批单，原请求继续保留。");
      return null;
    }
    checkTicket(original, ticket);
    if (ticket.status === "pending") retain({ ...original, acknowledged: true, ticket });
    else forget(original);
    if (!quiet || ticket.status !== "pending") {
      const status = { pending: "待审批", approved: "已批准", rejected: "被拒", expired: "已过期", withdrawn: "已撤回" }[ticket.status];
      toast(`审批单${status}：${ticket.before} → ${ticket.after}`);
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
    if (original.request.kind === "approval") {
      let receipt: A2OperationRow;
      try {
        receipt = await createA2OperationProposal(original.request.body, original.commandKey, true);
      } catch (error) {
        if (recovering ? isExplicitRejection(error) : firstRejection(error)) {
          forget(original);
          if (recovering || isHGrowthReadConflict(error)) await settled(recovering ? original.commandKey : undefined);
        }
        throw error;
      }
      checkTicket(original, receipt);
      // A POST replay is only historical evidence. Only the by-key GET may mark it pending.
      const acknowledged = { ...original, acknowledged: true };
      retain(acknowledged);
      const current = await query(acknowledged);
      if (!current) throw new OutcomeUnknownError("申请已建单，批没批准还没查到。请查询原结果，原请求继续保留。");
      if (recovering && current.status === "pending") await settled(original.commandKey);
      return;
    }
    let result: Record<string, unknown>;
    try {
      result = await growthRequest(original.request.path, { method: "PATCH", body: original.request.body, headers: { "Idempotency-Key": original.commandKey } }, undefined, true);
    } catch (error) {
      const e = error as { status?: number; apiCode?: number };
      // Growth's ApiResult.fail is also returned under HTTP 200. Preserve the business
      // verdict so the shared retry classifier can recognize an actual 4xx refusal.
      if (e.status !== undefined && e.status >= 200 && e.status < 300 && e.apiCode !== undefined && e.apiCode >= 400 && e.apiCode < 500) e.status = e.apiCode;
      if (recovering ? isExplicitRejection(error) : firstRejection(error)) {
        forget(original);
        if (recovering || isHGrowthReadConflict(error)) await settled(recovering ? original.commandKey : undefined);
      }
      throw error;
    }
    // Validate the command-specific receipt, but never install a historical replay as current data.
    const updated = result?.updated as Record<string, unknown> | undefined;
    const body = JSON.parse(original.request.body) as Record<string, string | number>;
    const [kind, ...idParts] = original.change.target.split(":");
    const id = idParts.join(":");
    const [tickWhole, tickFraction = ""] = kind === "tick" ? String(body.value).split(".") : ["0"];
    const tickSeconds = (BigInt(tickWhole) * BigInt(1000000) + BigInt(tickFraction.slice(0, 6).padEnd(6, "0"))
      + (Number(tickFraction[6] ?? "0") >= 5 ? BigInt(1) : BigInt(0))) / BigInt(1000000);
    const valid = kind === "streak" ? updated?.source === "nx_streak_milestone" && updated.milestoneId === Number(id) && updated.reward === body.value
      : kind === "power" ? updated?.source === "nx_streak_power_up" && updated.powerUpId === Number(id) && updated.day === body.day && updated.note === body.note
        : kind === "earn" ? updated?.source === "nx_earning_milestone_rule" && updated.key === id && h5Amount(String(updated.newThresholdUsd)) === h5Amount(String(body.thresholdUsd)) && h5Amount(String(updated.newRewardNex)) === h5Amount(String(body.rewardNex))
          : updated?.configKey === "growth.earn_milestone.tick_interval_seconds" && String(updated.seconds) === String(tickSeconds);
    if (!valid) throw new OutcomeUnknownError("保存回执与原修改不符，原请求继续保留，请查询原结果。");
    forget(original);
    await settled(original.commandKey);
    toast(original.change.success);
  };
  const run = async (change: H5Change, onCommand?: (commandKey: string) => void) => {
    const actor = requireActor(change.target, true);
    if (!isFresh()) throw new Error("请先成功刷新签到数据，再发起新的修改。");
    if (record(change.target)) throw new Error("这一项有未结束的原操作，请先查询原结果。");
    const fingerprint = `${actor.adminId}|H5|${change.target}`;
    const proposal = change.proposal ? {
      action: change.action, obj: change.target.slice(change.target.indexOf(":") + 1), beforeValue: change.before, afterValue: change.after,
      operator: actor.operator || actor.username, operatorRole: roleLabel(actor.role), sos: false, sourceDomain: "H5", reason: change.reason,
      ...change.proposal,
    } : undefined;
    const create = (approval: boolean): H5PendingCommand => {
      const request: H5PendingCommand["request"] = approval && proposal ? { kind: "approval", body: proposal }
        : change.direct ? { kind: "direct", path: change.direct.path, body: JSON.stringify({ ...change.direct.body, reason: change.reason, operator: actor.operator || actor.username }) }
          : (() => { throw new Error("H5_PROPOSAL_INVALID"); })();
      const now = Date.now();
      return { fingerprint, commandKey: createA2CommandKey(request.kind === "approval" ? "h5-proposal" : "h5-direct"), createdAt: now, expiresAt: now + PENDING_MUTATION_TTL_MS, adminId: actor.adminId, change, request };
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
    records: records(), record, query,
    canRetry(original: H5PendingCommand) {
      if (isRetryExpired(original) || original.acknowledged || original.ticket) return false;
      try { requireActor(original.change.target, true); return true; } catch { return false; }
    },
    async refreshTickets() {
      const results = await Promise.allSettled(records().filter(r => r.request.kind === "approval").map(r => query(r, true)));
      // A failed lookup must not promote a historical POST receipt to a current pending status.
      update();
      return results;
    },
    async retry(original: H5PendingCommand) {
      const current = record(original.change.target);
      if (current?.commandKey !== original.commandKey) throw new Error("原操作已处理，请刷新后重新操作。");
      if (current.request.kind === "approval") {
        const ticket = await query(current);
        if (ticket) {
          if (ticket.status === "pending") await settled(original.commandKey);
          return;
        }
      }
      return send(current, true);
    },
    async releaseExpired(original: H5PendingCommand) {
      if (original.request.kind !== "approval" || !isRetryExpired(original) || original.acknowledged || original.ticket
        || await query(original, true) !== null) throw new Error("原申请不能解除，请查询原结果。");
      forget(original);
      await settled(original.commandKey);
    },
    run,
  };
}
