"use client";

import { h3QuestConfigWriteRefusal, type H3Model } from "./h3-contract";
import { HApprovalRequired } from "./h-approval-required";
import { isHGrowthReadConflict } from "./h-write-conflict";

import { useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { roleLabel } from "@/lib/nav/console-nav";
import { createA2CommandKey, createA2OperationProposal, fetchA2Overview, fetchA2ProposalByKey, isA2OutcomeUncertainError, type A2OperationRow } from "./a2-client";
import { growthRequest, h3CommandStorage, type H3CommandStore, type H3WeeklyRegionMapping } from "./h-client";
import { h3ConfigNeedsApproval } from "./h3-contract";
import { findHighOp } from "./high-ops-registry";
import { explicitRejectionCode } from "./explicit-rejection";
import { RETRY_REJECTED_TEXT } from "./retry-rejected";
import { isDeterministicRejection, isOutcomeUnknownError, OutcomeUnknownError } from "./outcome-classification";
import { useRecoveryQueryErrors } from "./use-recovery-query-errors";
import { createPendingRecovery, isRetryExpired, PENDING_MUTATION_TTL_MS, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "./pending-mutation-store";

type Proposal = Parameters<typeof createA2OperationProposal>[0];
type Direct = { kind: "direct"; path: string; method: "POST" | "PATCH" | "DELETE"; body: string };
type ApprovedFact = "found" | "task-missing" | "unreadable" | "superseded";
export type H3Change = {
  target: string; action: string; title: string; before: string; after: string; reason: string; success: string;
  editValue?: string; businessValue?: Record<string, string>; rewardCurrency?: string; regionBaseline?: H3WeeklyRegionMapping[];
};
export interface H3PendingCommand extends PendingMutationRecord {
  store: H3CommandStore;
  adminId?: number;
  operator: string;
  change: H3Change;
  request: Direct | { kind: "approval"; body: Proposal } | { kind: "legacy-region" };
  acknowledged?: boolean;
  ticket?: A2OperationRow;
  ticketStatus?: "pending" | "approved";
}
export type H3Write = {
  store: H3CommandStore; path: string; method: Direct["method"]; body: Record<string, unknown>;
  change: Omit<H3Change, "reason">; configKey?: string; regionParams?: Record<string, unknown>;
};

function firstRejection(error: unknown) {
  if (isA2OutcomeUncertainError(error) || isOutcomeUnknownError(error)) return false;
  const e = error as { status?: number; apiCode?: number; reasonCode?: string; backendMessage?: string; unknownOutcome?: boolean; bodyUnreadable?: boolean } | null;
  return !!e && !e.unknownOutcome && !e.bodyUnreadable && !(e.apiCode !== undefined && e.apiCode >= 500)
    && !(e.reasonCode ?? e.backendMessage ?? "").startsWith("IDEMPOTENCY_") && isDeterministicRejection(e.status ?? 0, e.apiCode);
}

/** Parse sessionStorage and legacy fingerprints once at the untrusted boundary. */
function savedCommands(adminId: number | undefined, operator: string): H3PendingCommand[] {
  return h3CommandStorage.list().flatMap(({ store, record }) => {
    try {
      const saved = record as H3PendingCommand;
      if (saved.change) {
        if (saved.store !== store || saved.adminId !== adminId || typeof saved.operator !== "string") return [];
        const c = saved.change;
        if (![c.target, c.action, c.title, c.before, c.after, c.reason, c.success].every(v => typeof v === "string")
          || c.editValue !== undefined && typeof c.editValue !== "string"
          || c.rewardCurrency !== undefined && (typeof c.rewardCurrency !== "string" || !/^[A-Za-z]+$/.test(c.rewardCurrency))
          || c.businessValue !== undefined && (!c.businessValue || Object.values(c.businessValue).some(v => typeof v !== "string"))) return [];
        if (c.regionBaseline !== undefined && (!Array.isArray(c.regionBaseline) || c.regionBaseline.some(row =>
          !row || typeof row.callingCode !== "string" || typeof row.zoneId !== "string"))) return [];
        const request = saved.request;
        if (request.kind === "approval") {
          const p = request.body;
          const targetType = store === "region" ? "config" : store === "mission" ? "h3_mission" : "h3_quest_config";
          const op = store === "region" ? "h3_weekly_region_policy" : store === "mission" ? "h3_mission_create" : "h3_quest_config";
          if (p.reason !== c.reason || p.operator !== saved.operator || p.sourceDomain !== (store === "region" ? "H" : "H3")
            || p.obj !== c.target || p.command?.domain !== "H" || p.command.op !== op
            || p.target?.domain !== "H" || p.target.type !== targetType || p.target.id !== c.target || !p.command.params) return [];
        } else if (request.kind === "direct") {
          if (!/^\/quest-events\/(?:config\/[^/]+|missions|tasks\/[^/]+(?:\/(?:status|archive|presentation))?|bindings\/[^/]+)$/.test(request.path)
            || !["POST", "PATCH", "DELETE"].includes(request.method) || typeof request.body !== "string") return [];
          const body = JSON.parse(request.body);
          if (!body || body.reason !== c.reason || body.operator !== saved.operator) return [];
        } else if (request.kind !== "legacy-region" || store !== "region") return [];
        return [saved];
      }
      // Pre-redesign mission/binding fingerprints contain the exact wire body. They
      // may be replayed; old region fingerprints do not contain an A2 envelope.
      if (store === "region") {
        const [maker, params, reason] = JSON.parse(record.fingerprint);
        if (maker !== operator || !params || typeof reason !== "string") return [];
        return [{ ...record, store, adminId, operator, change: { target: "growth.h3.weekly-region-policy", action: "调整每周任务地区映射", title: "提交每周任务地区规则", before: "原区号规则", after: Array.isArray(params.mappings) ? params.mappings.map((row: { callingCode: string; zoneId: string }) => `${row.callingCode} → ${row.zoneId}`).join("；") : "—", reason, success: "" }, request: { kind: "legacy-region" } } as H3PendingCommand];
      }
      const match = /^(POST|PATCH|DELETE) (\/quest-events\/(?:missions|tasks\/[^/]+(?:\/(?:status|archive|presentation))?|bindings\/[^/]+))\n([\s\S]+)$/.exec(record.fingerprint);
      if (!match) return [];
      const body = JSON.parse(match[3]);
      if (!body || body.operator !== operator || typeof body.reason !== "string") return [];
      const target = decodeURIComponent(match[2].split("/")[3] ?? String(body.missionCode ?? ""));
      return [{ ...record, store, adminId, operator, change: { target, action: "用户任务管理", title: "用户任务管理", before: String(body.expectedName ?? body.expectedStatus ?? body.expectedQuestCode ?? "—"), after: String(body.name ?? body.targetStatus ?? body.questCode ?? body.missionName ?? "—"), reason: body.reason, success: "已提交" }, request: { kind: "direct", method: match[1] as Direct["method"], path: match[2], body: match[3] } } as H3PendingCommand];
    } catch { return []; }
  });
}

function currentH3Commands() {
  const actor = useAdminAuth.getState().session;
  return actor ? savedCommands(actor.adminId, actor.operator || actor.username || "") : [];
}

const h3Recovery = createPendingRecovery({
  list: currentH3Commands,
  isDurablyStored: (fingerprint, commandKey) => currentH3Commands().some(record => record.commandKey === commandKey
    && record.fingerprint === fingerprint && h3CommandStorage.durable(record.store, record)),
  forget: (fingerprint, commandKey) => {
    const record = currentH3Commands().find(row => row.commandKey === commandKey && row.fingerprint === fingerprint);
    if (record) h3CommandStorage.forget(record.store, record);
  },
  markReplayRejected: (fingerprint, commandKey, code) => {
    const record = currentH3Commands().find(row => row.commandKey === commandKey && row.fingerprint === fingerprint);
    if (record) h3CommandStorage.markReplayRejected(record.store, fingerprint, commandKey, code);
  },
}, {
  capability: record => record.request.kind === "legacy-region" ? "readback" : record.request.kind === "approval" ? "receipt" : "replay",
  hasApproval: record => !!(record.acknowledged || record.ticketStatus),
  canReplay: record => !record.acknowledged && canWriteH3(record.request.kind === "approval" ? record.request.body.command.op : undefined),
  explicitRejectionCode,
});

function canWriteH3(op?: string) {
  const auth = useAdminAuth.getState(), session = auth.session;
  if (!auth.isAuthenticated || auth.logoutPending || auth.logoutUnknown || !session || session.passwordChangeRequired) return false;
  const grants = session.authorities;
  if (op && !["h3_mission_create", "h3_quest_config", "h3_weekly_region_policy"].includes(op)) return false;
  return grants.includes("growth_h3_read") && grants.includes("growth_h3_write") && (op !== "h3_weekly_region_policy" || grants.some(code => code === "platform_a2_write" || code === "platform_a2_proposal_create"));
}

function retryBlocked(record: H3PendingCommand) {
  const state = h3Recovery.state(record);
  if (state.replayRejection) return RETRY_REJECTED_TEXT;
  if (state.expired) return RETRY_EXPIRED_TEXT;
  return state.replayBlock ? "请查询原结果" : undefined;
}

/** H3-only transport and recovery. The page owns all existing form markup. */
export function useH3Mutations(
  toast: (message: string) => void,
  settled: (commandKey?: string, draft?: H3PendingCommand, refresh?: boolean) => Promise<void>,
  readApproved: (records: readonly H3PendingCommand[]) => Promise<(record: H3PendingCommand) => ApprovedFact>,
  finish: (commandKey: string) => void,
  isFresh: (record?: H3PendingCommand) => boolean,
  model: H3Model | null,
) {
  const session = useAdminAuth(s => s.session);
  const adminId = session?.adminId;
  const operator = session?.operator || session?.username || "";
  useSyncExternalStore(h3Recovery.subscribe, h3Recovery.getRevision, h3Recovery.getRevision);
  const [, update] = useReducer(n => n + 1, 0);
  const auditRows = useRef<A2OperationRow[] | null>(null);
  const confirmedTickets = useRef(new Map<string, A2OperationRow>());
  const approvedReads = useRef(new Map<string, symbol>());
  const queryErrors = useRecoveryQueryErrors();
  useEffect(() => { update(); auditRows.current = null; confirmedTickets.current.clear(); }, [adminId]);
  const records = () => savedCommands(adminId, operator).map(r => ({ ...r, ticket: confirmedTickets.current.get(r.commandKey) }));
  const record = (target: string) => records().find(r => r.change.target === target);
  const requireActor = (write: boolean, op?: string) => {
    const auth = useAdminAuth.getState(), actor = auth.session;
    if (!auth.isAuthenticated || auth.logoutPending || auth.logoutUnknown || !actor || actor.passwordChangeRequired || actor.adminId !== adminId) throw new Error("ADMIN_AUTH_REQUIRED");
    if (write && !canWriteH3(op)) throw new Error("H3_MAKER_FORBIDDEN");
    return actor;
  };
  const forget = (r: H3PendingCommand) => { h3CommandStorage.forget(r.store, r); confirmedTickets.current.delete(r.commandKey); update(); };
  const retain = (r: H3PendingCommand) => {
    h3CommandStorage.remember(r.store, r); update();
    if (!h3CommandStorage.durable(r.store, r)) throw new Error("浏览器存不下完整原请求，本次没有发送。请保留原记录并查询原结果。");
  };
  const checkTicket = (r: H3PendingCommand, ticket: A2OperationRow) => {
    // 111e00cd OpsAuditCenterService.ticketMetadata includes persisted command.op.
    const op = r.request.kind === "approval" ? r.request.body.command.op : "h3_weekly_region_policy";
    if (!ticket.mine || ticket.obj !== r.change.target || ticket.operationCode !== op
      || !["pending", "approved", "rejected", "expired", "withdrawn"].includes(ticket.status)) throw new OutcomeUnknownError("审批单与保存的原申请不符，原请求继续保留，请查询原结果。");
  };
  const settleApproved = async (approved: H3PendingCommand[], refresh = false) => {
    const request = Symbol();
    let found = false;
    for (const record of approved) approvedReads.current.set(record.commandKey, request);
    update();
    try {
      const factOf = await readApproved(approved);
      for (const record of approved) {
        if (approvedReads.current.get(record.commandKey) !== request) continue;
        const fact = factOf(record);
        if (fact === "superseded") continue;
        if (fact === "unreadable") {
          const error = new Error("审批单已批准，当前值没读到，请重新读取。");
          queryErrors.fail(record.commandKey, error);
          if (!refresh) throw error;
        } else if (h3Recovery.settleAcknowledged(record)) {
          queryErrors.clear(record.commandKey);
          confirmedTickets.current.delete(record.commandKey);
          finish(record.commandKey);
          if (fact === "task-missing") toast("审批单已批准；这个任务现在已不在列表里，记录已解除。");
          else found = true;
        }
      }
      return found;
    } finally {
      for (const { commandKey } of approved) {
        if (approvedReads.current.get(commandKey) === request) approvedReads.current.delete(commandKey);
      }
      update();
    }
  };
  const query = async (r: H3PendingCommand, refresh = false) => {
    requireActor(false);
    const current = currentH3Commands().find(record => record.commandKey === r.commandKey);
    if (!current) return;
    if (current.ticketStatus === "approved") {
      if (!refresh && !approvedReads.current.has(current.commandKey)) await settleApproved([current]);
      return;
    }
    if (r.request.kind === "direct") {
      await h3Recovery.query(r, async () => {
        // A readback refreshes the data without settling the original command.
        await settled();
        return { conclusion: "unknown" };
      });
      if (!refresh) toast("已重新读取；当前值不能证明原操作是否执行，原请求继续保留，请到操作记录与审批核对。");
      return undefined;
    }
    // Keep known ticket status while a fresh query is in flight.
    if (auditRows.current) auditRows.current = auditRows.current.filter(t => t.obj !== r.change.target);
    update();
    const result = await queryErrors.read(r.commandKey, () => h3Recovery.query(r, async record => {
      const ticket = await fetchA2ProposalByKey(record.commandKey, true);
      if (!ticket) return { conclusion: record.acknowledged ? "unknown" : "not-found", ticket } as const;
      checkTicket(record, ticket);
      return { conclusion: ticket.status === "pending" ? "unknown" : ticket.status === "approved" ? "succeeded" : "not-executed", ticket } as const;
    }));
    if (!result) return undefined;
    const { ticket } = result;
    if (!ticket) { if (!refresh) toast("暂未查到原审批单，原请求继续保留。"); return null; }
    if (ticket.status === "pending" || ticket.status === "approved") {
      const saved = { ...current, acknowledged: true, ticketStatus: ticket.status, ticket: undefined } as const;
      retain(saved);
      confirmedTickets.current.set(r.commandKey, ticket);
      update();
      if (ticket.status === "approved" && !refresh && await settleApproved([saved])) toast(`审批单已批准：${ticket.before} → ${ticket.after}`);
    }
    else if (h3Recovery.settleFromQuery(r, result.conclusion)) {
      confirmedTickets.current.delete(r.commandKey);
      await settled(r.commandKey, result.conclusion === "not-executed" ? { ...r, ticket } : undefined, !refresh);
    }
    if (!refresh && ticket.status !== "approved") toast(`审批单${({ pending: "待审批", rejected: "被拒", expired: "已过期", withdrawn: "已撤回" })[ticket.status]}：${ticket.before} → ${ticket.after}`);
    return ticket;
  };
  const pendingApprovals = () => [...new Map([...(auditRows.current ?? []), ...confirmedTickets.current.values()].map(t => [t.id, t])).values()];
  // GET facts supersede the A2 queue for the keys it covers. Unknown active locks
  // still block new writes, but only verified tickets are called pending approvals.
  const pendingTargets = () => [...new Set([
    ...pendingApprovals().filter(t => t.status === "pending"
      && ["h3_quest_config", "h3_mission_create"].includes(t.operationCode ?? "")
      && !(t.operationCode === "h3_quest_config" && model?.pendingApprovals !== undefined && t.obj in model.pendingApprovals)
      && !(t.operationCode === "h3_mission_create" && model?.pendingMissionCreations !== undefined)).map(t => t.obj),
    ...Object.entries(model?.pendingApprovals ?? {}).filter(([, approval]) => approval?.ticketId != null).map(([key]) => key),
    ...(model?.pendingMissionCreations ?? []).flatMap(approval => approval.ticketId != null && approval.missionCode != null ? [approval.missionCode] : []),
  ])];
  const blocked = (target: string) => !!record(target) || model?.pendingApprovals?.[target] != null
    || model?.pendingMissionCreations?.some(approval => approval.missionCode === target) === true || pendingTargets().includes(target);
  const send = async (r: H3PendingCommand, recovering: boolean) => {
    requireActor(true, r.request.kind === "approval" ? r.request.body.command.op : undefined);
    if (recovering && !isFresh(r)) throw new Error("请先成功刷新用户任务数据，再按原请求重试。");
    if (isRetryExpired(r)) throw new Error(RETRY_EXPIRED_TEXT);
    if (r.request.kind === "legacy-region" || r.acknowledged) throw new Error("申请已建单或缺少完整原申请，请查询原结果。");
    try { retain(r); } catch (error) { if (!recovering) forget(r); throw error; }
    try {
      if (r.request.kind === "approval") {
        const receipt = await createA2OperationProposal(r.request.body, r.commandKey, true);
        checkTicket(r, receipt);
      } else {
        const result = await growthRequest<Record<string, unknown>>(r.request.path, { method: r.request.method, body: r.request.body, headers: { "Idempotency-Key": r.commandKey } }, undefined, true);
        const updated = result?.updated as Record<string, unknown> | undefined;
        const body = JSON.parse(r.request.body) as Record<string, unknown>;
        const code = decodeURIComponent(r.request.path.split("/")[3] ?? String(body.missionCode ?? ""));
        const expectedAction = r.store === "binding" ? r.request.method === "POST" ? "created" : r.request.method === "DELETE" ? "deleted" : "updated"
          : r.request.path === "/quest-events/missions" ? "created" : r.request.method === "DELETE" ? "deleted" : r.request.path.endsWith("/archive") ? "archived" : r.request.path.endsWith("/status") ? "status_changed" : r.request.path.endsWith("/presentation") ? "presentation-updated" : "edited";
        if (result?.domain !== "H3" || !updated || (r.store === "config" ? updated.key !== body.key
          : r.store === "binding" ? updated.bindingCode !== code || updated.action !== expectedAction
            : (r.request.path === "/quest-events/missions" ? updated.missionCode !== body.missionCode || updated.missionType !== body.missionType : updated.taskCode !== code || updated.taskKind !== body.taskKind && !r.request.path.endsWith("/presentation")) || updated.action !== expectedAction)) {
          throw new OutcomeUnknownError("保存后返回的内容和原修改对不上，原请求继续保留，请查询原结果。");
        }
      }
    } catch (error) {
      const e = error as { status?: number; apiCode?: number };
      if (e.status !== undefined && e.status >= 200 && e.status < 300 && e.apiCode !== undefined && e.apiCode >= 400 && e.apiCode < 500) e.status = e.apiCode;
      if (recovering ? explicitRejectionCode(error) : firstRejection(error)) {
        if (!recovering) forget(r);
        if (!recovering && isHGrowthReadConflict(error)) await settled(r.commandKey);
        throw error;
      }
      // Keep the key in storage, not in the shared A2 error renderer's operator copy.
      throw new OutcomeUnknownError(isOutcomeUnknownError(error) ? error.message : "结果未知，请查询原结果。");
    }
    if (r.request.kind === "approval") {
      const acknowledged = { ...r, acknowledged: true, ticket: undefined };
      retain(acknowledged);
      if (!recovering) await readSubmitted(acknowledged);
      return;
    }
    forget(r);
    await settled(r.commandKey);
    toast(r.change.success);
  };
  const readSubmitted = async (record: H3PendingCommand) => {
    const saved = currentH3Commands().find(row => row.commandKey === record.commandKey);
    const current = saved && await query(saved);
    if (!current) throw new OutcomeUnknownError("申请已建单，批没批准还没查到。请查询原结果，原请求继续保留。");
    if (current.status === "pending") await settled(record.commandKey);
  };
  const run = async (write: H3Write, reason: string, approvalConfirmed = false, onCommand?: (commandKey: string) => void) => {
    const actor = requireActor(true, write.store === "region" ? "h3_weekly_region_policy" : undefined);
    const refusal = write.configKey === undefined ? undefined : h3QuestConfigWriteRefusal(write.configKey);
    if (refusal) throw new Error(refusal);
    if (!isFresh()) throw new Error("请先成功刷新用户任务数据，再发起新的修改。");
    if (blocked(write.change.target)) throw new Error("这一项有未结束的原操作，请先查询原结果。");
    const change = { ...write.change, reason };
    const proposal = (approval: boolean): Proposal | undefined => {
      if (!approval) return undefined;
      const op = write.regionParams ? "h3_weekly_region_policy" : write.configKey ? "h3_quest_config" : "h3_mission_create";
      const values = write.regionParams ?? (write.configKey ? { configKey: write.configKey, value: write.body.value, expectedValue: write.body.expectedValue } : write.body);
      const def = findHighOp(op)!;
      return { action: change.action, obj: change.target, beforeValue: change.before, afterValue: change.after,
        operator, operatorRole: roleLabel(actor.role), type: def.type, amplifies: true, sos: false, roleGate: def.gateLabel,
        reason, sourceDomain: write.regionParams ? "H" : "H3", command: def.buildCommand(values), target: def.buildTarget(values) };
    };
    const create = (approval: boolean): H3PendingCommand => {
      const p = proposal(approval), now = Date.now();
      return { store: write.store, fingerprint: `${actor.adminId}|H3|${change.target}`, commandKey: createA2CommandKey(p ? "h3-proposal" : "h3-direct"),
        createdAt: now, expiresAt: now + PENDING_MUTATION_TTL_MS, adminId: actor.adminId, operator, change,
        request: p ? { kind: "approval", body: p } : { kind: "direct", path: write.path, method: write.method, body: JSON.stringify({ ...write.body, reason, operator }) } };
    };
    const approval = approvalConfirmed || !!write.regionParams || (write.configKey ? h3ConfigNeedsApproval(write.configKey, String(write.body.expectedValue), String(write.body.value)) : write.path === "/quest-events/missions" && Number(write.body.rewardPoints) > 0);
    const original = create(approval);
    onCommand?.(original.commandKey);
    try { await send(original, false); } catch (error) {
      const code = (error as { reasonCode?: string }).reasonCode;
      if (!approval && firstRejection(error) && code === "H3_APPROVAL_REQUIRED" && (write.configKey || write.path === "/quest-events/missions")) throw new HApprovalRequired((error as Error).message, { write, reason }, () => run(write, reason, true, onCommand));
      else throw error;
    }
  };

  return {
    records: records(), record, blocked, query, pendingApprovals: pendingApprovals(), pendingTargets: pendingTargets(), auditKnown: auditRows.current !== null,
    recovery: h3Recovery,
    queryErrors: queryErrors.errors,
    approvedReading: (commandKey: string) => approvedReads.current.has(commandKey),
    retryBlocked: (record: H3PendingCommand) => retryBlocked(record) ?? (!isFresh(record) ? "请先成功刷新用户任务数据" : undefined),
    async refreshTickets() {
      requireActor(false);
      // No A2 read authority is fabricated. By-key reads remain available separately.
      auditRows.current = null;
      confirmedTickets.current.clear();
      update();
      const lookup = useAdminAuth.getState().session?.authorities.includes("platform_a2_read")
        ? fetchA2Overview({ domain: "H" }).then(audit => {
          auditRows.current = audit.operationQueue.filter(t => ["h3_quest_config", "h3_mission_create"].includes(t.operationCode ?? "") && t.status === "pending");
          update();
        }) : Promise.resolve();
      const originals = records().filter(record => record.request.kind !== "direct");
      const [overview] = await Promise.allSettled([lookup]);
      // A later exact-key verdict supersedes the earlier overview observation.
      const outcomes = await Promise.allSettled(originals.map(record => query(record, true)));
      const approved = records().filter(record => record.ticketStatus === "approved");
      if (approved.length) await settleApproved(approved, true);
      return [overview, ...outcomes];
    },
    async retry(r: H3PendingCommand) {
      const blocked = retryBlocked(r);
      if (blocked) throw new Error(blocked);
      await h3Recovery.replay(r, record => send(record, true));
      if (r.request.kind === "approval") await readSubmitted(r);
    },
    releaseRejected(r: H3PendingCommand) {
      if (!h3Recovery.releaseRejectedReplay(r)) throw new Error("原操作记录继续保留，请查询原结果。");
      update();
    },
    run,
  };
}
