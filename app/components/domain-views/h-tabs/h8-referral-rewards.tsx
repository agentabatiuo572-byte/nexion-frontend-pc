"use client";

/**
 * 新人礼与邀请奖励（H8）。首屏回答：奖励开着没有、新人和邀请人每位实际拿多少（基础额 × 运营阶段设置的当月加成）、
 * 有多少注册在等结算、改哪一项会让平台多付钱。
 * 调高金额、启用、改成「符合资格就直接发」提交审批，另一位超级管理员批准后生效；反方向确认后立即保存。
 * 两种结算都只提交审批，另一位超级管理员批准后才发。结果未知保存完整原请求和确认事实，恢复不依赖概览。
 */
import { useFReconfirmations } from "@/lib/admin/f-reconfirmation";
import { fetchA2Overview } from "@/lib/admin/a2-client";
import { fApprovalPermissionText, H8_SETTLEMENT_APPROVAL_PERMISSION } from "@/lib/admin/f-approval-names";
import { fProposalEndText } from "@/app/components/domain-views/f-tabs/f-release";
import { useHConflictDraft } from "@/lib/admin/use-h-conflict-draft";
import { HApprovalRequired } from "@/lib/admin/h-approval-required";
import { isHGrowthReadConflict } from "@/lib/admin/h-write-conflict";
import { useReach } from "@/lib/nav/use-reach";
import { businessZone, formatBusinessTimeCompact, formatBusinessTimeFull } from "@/lib/admin/business-time";

import { Fragment, useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftRight, Check, Clock3, Gift, Hourglass, ListChecks, Power, Route, ShieldAlert, SlidersHorizontal, UserPlus, Users } from "lucide-react";
import {
  BlockState, Button, Change, Conclusion, ConfigList, ConfigRow, DiffField, Explain, Fact, Facts, Field, Input,
  IrreversibleTag, KeepText, Notice, NumberInput, PageHeader, Panel, ReleaseModal, Segments, Stat, StatBand, StatusTag, Table, TableMessage, Td, Th, Tr,
  type StateTone,
} from "@/app/components/rd";
import {
  fetchH8ReferralRewards,
  fetchH8SettlementEligibility,
  h8EffectiveRewardReference,
  h8RewardParamAmplifies,
  h8RewardParamValid,
  parseH8SettlementEligibility,
  type H8ReferralRewardOverview,
  type H8SettlementEligibility,
} from "@/lib/admin/h-client";
import type { ActionConfirmReq, HCtx } from "./types";
import { hApprovalReconfirm } from "./h-approval-reconfirm";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { roleLabel } from "@/lib/nav/console-nav";
import { hasPendingH8Policy, canRetryH8RewardCommand, createH8RewardCommand, h8Recovery, unresolvedH8Policy, pendingH8RewardCommands, queryH8RewardCommand, releaseRejectedH8RewardCommand, requireH8Actor, sendH8RewardCommand, type H8RewardCommand } from "@/lib/admin/h8-reward-mutation";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { withdrawalApprovalDisabledReason } from "@/lib/admin/withdrawal-config-approval";
import { OperationConfirmModal, type BusinessFormValue } from "../design-kit";
import { fConfirmRecovery } from "../f-tabs/f-recovery-state";
import { Amount, amountParts, amountText, countText, decimalsOf, expiredTag, H8RecoveryNotice, H8SavedUnreadNotice, multiplierText, pendingTag, RewardFlow, unknownTag, type H8RecoveryRow } from "./h8-reward-parts";

const PARAMS = [
  { key: "newcomer.usdt", label: "新人 USDT", unit: "USDT", kind: "number", max: 50, step: 0.000001 },
  { key: "newcomer.nex", label: "新人 UVT", unit: "UVT", kind: "number", max: 500, step: 0.000001 },
  { key: "newcomer.lockMode", label: "新人礼发放模式", unit: "", kind: "select", options: ["risk_bucket", "direct"] },
  { key: "inviter.nex", label: "邀请人 UVT", unit: "UVT", kind: "number", max: 249_999_999.75, step: 0.000001 },
] as const;

const LOCK_MODE_LABELS: Record<string, string> = {
  risk_bucket: "先过风险检查再发",
  direct: "符合资格就直接发",
};
const ENABLED_PARAM = { key: "enabled", label: "邀请奖励", unit: "", kind: "select", options: ["已停用", "已启用"] } as const;
const ENABLED_LABELS: Record<string, string> = { false: "已停用", true: "已启用" };
type H8Param = (typeof PARAMS)[number] | typeof ENABLED_PARAM;
type AmountParam = Extract<H8Param, { kind: "number" }>;

const AMOUNT_PARAMS = PARAMS.filter((param): param is AmountParam => param.kind === "number");
const MODE_PARAM = PARAMS[2];
/** 卡头：谁拿、拿哪种币。 */
const WHO: Record<string, { who: string; per: string; icon: typeof Gift }> = {
  "newcomer.usdt": { who: "新人", per: "每位新人", icon: Gift },
  "newcomer.nex": { who: "新人", per: "每位新人", icon: Gift },
  "inviter.nex": { who: "邀请人", per: "每位邀请人", icon: Users },
};
const APPROVER = "另一位超级管理员";
const MODE_HELP: Record<string, string> = {
  risk_bucket: "命中待复核风险的新人先不发；账户或账户组被标记或冻结的、在「异常套利与刷量排查」被拦截新人礼的也不发。",
  direct: "只跳过待复核风险这一层；账户或账户组被标记或冻结的、在「异常套利与刷量排查」被拦截新人礼的照样不发。",
};
/** 带菜单名的这一段整段换行，不在名字中间断开，也不把「的。」甩到下一行。 */
const K2_NAME = ["账户或账户组被标记、冻结的，", "账户或账户组被标记或冻结的、", "在「异常套利与刷量排查」被拦截新人礼的。", "在「异常套利与刷量排查」被拦截新人礼的"];
const modeHelp = (mode: string | undefined) => mode && MODE_HELP[mode] ? <KeepText text={MODE_HELP[mode]} phrases={K2_NAME} /> : undefined;

/** 指定新人的结算条件（e6d5bdca 资格读取）：一句结论 + 批准后会怎样。读到的空值写未知，不推断。 */
type EligibilityRead = { id: number; state: "loading" } | { id: number; state: "ready"; data: H8SettlementEligibility } | { id: number; state: "error"; message: string };
type H8ConfirmReq = ActionConfirmReq & {
  commandKey?: string;
  getSettlementBlockReason?: () => string | undefined;
  getSettlementCoverage?: () => { lead: string; check: string };
};
type SettlementOriginal = Extract<NonNullable<H8RewardCommand["original"]>, { kind: "settlement" }>;
const SETTLEMENT_INTERVAL_AMOUNT = "按各人生效区间的金额";
const PREVIOUS_GIFT_RELEASE_SUMMARY = "仅解冻原礼包，不发新奖励";
const GIFT_RELEASE_AMOUNT = "按原礼包冻结记录里的金额解冻";

function readSettlementEligibility(id: number | undefined, read: EligibilityRead | null, draft?: H8SettlementEligibility) {
  if (draft && draft.invitedUserId === id) return draft;
  if (read?.state === "ready" && read.id === id && read.data.invitedUserId === id) return read.data;
}

const ELIGIBILITY_REASON: Record<string, { tone: StateTone; tag: string; text: string }> = {
  ELIGIBLE: { tone: "ok", tag: "现在能结", text: "符合结算条件" },
  ALREADY_SETTLED_GIFT_RELEASABLE: { tone: "done", tag: "已结算", text: "礼包还冻结，已有首笔实付订单" },
  ALREADY_SETTLED: { tone: "done", tag: "已结算", text: "已结算过，不会再发一份" },
  DISABLED: { tone: "warn", tag: "不能结", text: "奖励已停用" },
  NOT_CONFIGURED: { tone: "warn", tag: "不能结", text: "三项奖励金额都是 0" },
  USER_NOT_FOUND: { tone: "warn", tag: "不能结", text: "查不到这个用户编号" },
  USER_NOT_ACTIVE: { tone: "warn", tag: "不能结", text: "账户不在正常状态" },
  REGISTERED_BEFORE_EFFECTIVE_AT: { tone: "warn", tag: "不能结", text: "注册早于生效时间" },
  WALLET_MISSING: { tone: "warn", tag: "不能结", text: "还没有钱包" },
  RISK_BLOCKED: { tone: "warn", tag: "不能结", text: "被风控拦下" },
  NOT_ELIGIBLE: { tone: "warn", tag: "不能结", text: "现在不符合结算条件" },
};
function settlementSettingsBlock(snapshot: H8ReferralRewardOverview, value?: H8SettlementEligibility) {
  if (!value) return;
  if (value.reason === "DISABLED") return "奖励已停用，请刷新页面读取最新设置后再确认。";
  if (Date.parse(value.effectiveAt) !== Date.parse(snapshot.effectiveAt)) return "奖励设置已变化，请刷新页面读取最新设置后再确认。";
}

function eligibilityView(snapshot: H8ReferralRewardOverview, value: H8SettlementEligibility) {
  const settingsBlock = settlementSettingsBlock(snapshot, value);
  if (settingsBlock) return { tone: "warn" as const, tag: "不能结", text: settingsBlock, outcome: "重新读取设置后再确认" };
  const reason = value.releasePossible ? "ALREADY_SETTLED_GIFT_RELEASABLE" : value.reason;
  const known = ELIGIBILITY_REASON[reason] ?? { tone: "neutral" as const, tag: "没认出", text: "系统给的原因这页认不出" };
  const text = reason === "REGISTERED_BEFORE_EFFECTIVE_AT" && value.registeredAt === null ? "注册时间没有记录" : known.text;
  const outcome = reason === "ELIGIBLE" ? value.willFreeze ? "批准后发奖励，新人礼先冻结到首笔实付订单" : "批准后给新人和邀请人发奖励"
    : reason === "ALREADY_SETTLED_GIFT_RELEASABLE" ? "不再发新的，批准后可能解冻原礼包"
      : reason === "ALREADY_SETTLED" ? "不发" : "批准执行时仍不符合就不发";
  return { ...known, text, outcome };
}

function settlementEligibilityBlock(snapshot: H8ReferralRewardOverview, value?: H8SettlementEligibility) {
  return settlementSettingsBlock(snapshot, value)
    ?? (value && !value.eligible && !value.releasePossible ? eligibilityView(snapshot, value).text : undefined);
}

function storedSettlementEligibility(original: SettlementOriginal) {
  if (original.confirmedEligibility == null) return original.confirmedEligibility;
  try {
    const eligibility = parseH8SettlementEligibility(original.confirmedEligibility);
    if (eligibility.invitedUserId === original.invitedUserId) return eligibility;
  } catch { /* A missing display snapshot does not invalidate the replay body. */ }
}

function settlementAmounts(snapshot: H8ReferralRewardOverview, eligibility: H8SettlementEligibility | null | undefined, originalSummary?: string) {
  const settingsBlock = settlementSettingsBlock(snapshot, eligibility ?? undefined);
  const releaseOnly = !settingsBlock && (eligibility?.releasePossible === true
    || originalSummary?.split(" · ").includes(PREVIOUS_GIFT_RELEASE_SUMMARY) === true);
  if (releaseOnly) {
    return { releaseOnly, newcomer: GIFT_RELEASE_AMOUNT, inviter: "不发新奖励", summary: `${GIFT_RELEASE_AMOUNT}，不发新奖励` };
  }
  if (!settingsBlock && eligibility?.eligible && eligibility.registeredAt
      && Date.parse(eligibility.registeredAt) >= Date.parse(snapshot.effectiveAt)) {
    const rewards = snapshot.effectiveRewards;
    const uvtDecimals = decimalsOf(rewards["newcomer.nex"], rewards["inviter.nex"]);
    const newcomer = `${amountText(rewards["newcomer.usdt"], decimalsOf(rewards["newcomer.usdt"]))} USDT + ${amountText(rewards["newcomer.nex"], uvtDecimals)} UVT`;
    const inviter = `${amountText(rewards["inviter.nex"], uvtDecimals)} UVT`;
    return { releaseOnly, newcomer, inviter: `${inviter}，没有邀请人的不发`, summary: `新人 ${newcomer} · 邀请人 ${inviter}` };
  }
  return { releaseOnly, newcomer: SETTLEMENT_INTERVAL_AMOUNT, inviter: `${SETTLEMENT_INTERVAL_AMOUNT}，没有邀请人的不发`, summary: SETTLEMENT_INTERVAL_AMOUNT };
}
const yesNo = (value: boolean | null, yes: string, no: string, unknown = "未知") => value === null ? unknown : value ? yes : no;
function EligibilityDetail({ value, original }: { value: H8SettlementEligibility; original?: boolean }) {
  return <>
    <p>注册 {value.registeredAt ? formatBusinessTimeCompact(value.registeredAt, "—") : "时间未知"}（{businessZone().label}）</p>
    <p>生效时间 {formatBusinessTimeCompact(value.effectiveAt, "—")}</p>
    <p>钱包{yesNo(value.walletPresent, "已开", "没有")} · 风控{yesNo(value.riskBlocked, "拦下了", "没拦")} · {yesNo(value.settled, "已结算", "没结算", "结算未知")}</p>
    <p>新人礼{yesNo(value.freezeGift, "会先冻结", "不冻结")} · 冻结中 {value.frozenGiftCount === null ? "未知" : `${value.frozenGiftCount} 份`} · 首笔实付{yesNo(value.firstPaidOrder, "有", "没有")}</p>
    <p>{original ? "这是提交时核对的情况，批准执行时再核对。" : "这是现在的情况，批准执行时再核对。"}</p>
  </>;
}

/** 参数的显示名（标题、提醒里用）。 */
const paramTitle = (param: H8Param) => param.key === "enabled" ? "奖励开关" : param.key === "newcomer.lockMode" ? "新人礼发放方式" : `${param.label} 基础额`;
const QUEUE_UNREAD = "审批队列没有完整读到，请重试读取后再调整。";

export default function H8ReferralRewards({ ctx }: { ctx: HCtx }) {
  const reach = useReach();
  const session = useAdminAuth((state) => state.session);
  const isSuperadmin = session?.role === "superadmin";
  const canWrite = isSuperadmin || !!session?.authorities.includes("growth_h8_write");
  const canSettle = isSuperadmin || !!session?.authorities.includes("growth_h8_settle");
  const drafts = useFReconfirmations("H8");
  const approvalQueue = useRef<{ owner?: number; pending: boolean; error?: string }>({ pending: false });
  const [data, setData] = useState<H8ReferralRewardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invitedUserIdInput, setInvitedUserIdInput] = useState("");
  const [mc, setMc] = useState<H8ConfirmReq | null>(null);
  const loadGeneration = useRef(0);
  const [, changed] = useReducer((value: number) => value + 1, 0);
  const [readReady, setReadReady] = useState(false);
  const [savedUnread, setSavedUnread] = useState<{ param: H8Param; value: string } | null>(null);
  /** 被「别人先改过」拒绝后已重读：留一条提醒写清现在的值和这次要改的值。只决定显示。 */
  const [stale, setStale] = useState<{ param?: H8Param; value?: string } | null>(null);
  const [releasing, setReleasing] = useState<H8RewardCommand | null>(null);
  const [eligibility, setEligibility] = useState<EligibilityRead | null>(null);
  const eligibilityRef = useRef(eligibility);
  eligibilityRef.current = eligibility;
  useEffect(() => {
    const raw = invitedUserIdInput.trim();
    const id = Number(raw);
    if (!canSettle || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(id)) { setEligibility(null); return; }
    let live = true;
    const timer = window.setTimeout(() => {
      setEligibility({ id, state: "loading" });
      fetchH8SettlementEligibility(id).then((value) => { if (live) setEligibility({ id, state: "ready", data: value }); })
        .catch((cause) => { if (live) setEligibility({ id, state: "error", message: displayAdminReadError(cause) }); });
    }, 400);
    return () => { live = false; window.clearTimeout(timer); };
  }, [invitedUserIdInput, canSettle]);
  const conflictDraft = useHConflictDraft(readReady && !loading && !error);
  const openConfirm = (req: H8ConfirmReq | null) => setMc(req ? conflictDraft.action(req) : null);
  useEffect(() => {
    setMc(current => current?.commandKey && drafts.some(row => row.commandKey === current.commandKey) ? null : current);
  }, [drafts.length]);
  const confirmation = useRef(mc);
  confirmation.current = mc;
  const currentRead = useRef({ data, ready: readReady });
  currentRead.current = { data, ready: readReady && !loading };

  const load = useCallback(async (cursor = "", append = false, keepSaved = false) => {
    const request = ++loadGeneration.current;
    if (append) setLoadingMore(true);
    else { currentRead.current.ready = false; setLoading(true); setReadReady(false); }
    try {
      const actor = useAdminAuth.getState().session;
      const [next, queue] = await Promise.all([
        fetchH8ReferralRewards(cursor),
        !append && actor?.authorities.includes("platform_a2_read")
          ? fetchA2Overview({}, true).then(value => ({ value }), error => ({ error: displayAdminReadError(error) })) : null,
      ]);
      if (request !== loadGeneration.current || actor?.adminId !== useAdminAuth.getState().session?.adminId) return false;
      if (!append) {
        const observed = queue && "value" in queue ? queue.value : undefined;
        const error = queue && "error" in queue ? queue.error : !observed ? "当前账号读不到审批队列。"
          : observed.operationQueueInvalidCount ? "审批队列返回不完整。" : undefined;
        const prior = approvalQueue.current;
        const pending = !!observed?.operationQueue.some(row => row.status === "pending" && row.operationCode === "h8_reward_param_change")
          || (!!error && prior.owner === actor?.adminId && prior.pending);
        approvalQueue.current = { owner: actor?.adminId, error, pending };
      }
      setData((current) => append && current ? {
        ...next,
        recentSettlements: [...current.recentSettlements, ...next.recentSettlements],
      } : next);
      setError(null);
      setReadReady(true);
      setSavedUnread(null);
      const adminId = useAdminAuth.getState().session?.adminId;
      if (adminId) {
        await Promise.allSettled(pendingH8RewardCommands(adminId).filter(r => r.kind !== "direct").map(queryH8RewardCommand));
        if (request === loadGeneration.current) changed();
      }
      return true;
    } catch (cause) {
      if (request !== loadGeneration.current) return false;
      if (!append) { setReadReady(false); if (!keepSaved) setData(null); }
      if (!keepSaved) setError(displayAdminReadError(cause));
      return false;
    } finally {
      if (request === loadGeneration.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => { loadGeneration.current += 1; };
  }, [load]);

  const commands = session ? pendingH8RewardCommands(session.adminId) : [];
  const policyUnknown = session ? unresolvedH8Policy(session.adminId) : undefined;
  const policyBlocked = policyUnknown ? isRetryExpired(policyUnknown) ? RETRY_EXPIRED_TEXT : "奖励配置有原操作结果未知，请先查询原操作。" : undefined;
  const queue = approvalQueue.current;
  const queueError = queue.owner === session?.adminId ? queue.error : undefined;
  const pendingPolicy = queue.owner === session?.adminId && queue.pending || hasPendingH8Policy(commands);
  const tightenWarning = pendingPolicy ? "这次收紧会让待批的放宽单失效。"
    : queueError ? "可能存在待批单，读不到审批队列。" : undefined;
  const settlementBlocked = commands.find(record => record.kind === "settlement");
  const settlementPermission = !!session?.authorities.some(code => code === "platform_a2_proposal_create" || code === "platform_a2_write");
  const settleWriteBlock = settlementBlocked ? isRetryExpired(settlementBlocked) ? RETRY_EXPIRED_TEXT : "有一笔结算原操作结果未知，请先查询原操作。"
    : !settlementPermission ? "当前账号没有提交审批的权限。" : undefined;
  const freshBlocked = !readReady || loading ? displayAdminError(new Error("H8_OVERVIEW_REQUIRED")) : undefined;

  const finishCommand = async (record: H8RewardCommand, { ticket, unchanged }: Awaited<ReturnType<typeof sendH8RewardCommand>>) => {
    setMc(current => current?.commandKey === record.commandKey ? null : current);
    currentRead.current.ready = false;
    setReadReady(false);
    changed();
    const original = record.original;
    if (unchanged) {
      await load();
      ctx.toast("和现在一样，没有改动");
    } else if (original?.kind === "direct") {
      const param = [ENABLED_PARAM, ...PARAMS].find(p => p.key === original.paramKey)!;
      setSavedUnread({ param, value: original.value });
      if (await load("", false, true)) ctx.toast(param.key === "enabled" ? "邀请奖励已停用" : `${param.label} 已更新为 ${valueText(param, original.value)}`);
    } else {
      await load();
      if (ticket) ctx.toast(ticket.status === "pending" ? "已提交，等待审批后执行" : fProposalEndText(ticket.status));
    }
  };
  const sendCommand = async (record: H8RewardCommand, recovering: boolean) => {
    const request = confirmation.current;
    if (request && !recovering) request.commandKey = record.commandKey;
    try {
      const latestQueue = approvalQueue.current;
      const knownPending = latestQueue.owner === record.adminId
        && (latestQueue.pending || hasPendingH8Policy(pendingH8RewardCommands(record.adminId)));
      if (!recovering && record.kind === "param-approval" && (latestQueue.owner !== record.adminId || latestQueue.error)) throw new Error(QUEUE_UNREAD);
      const result = await sendH8RewardCommand(record, recovering, knownPending);
      // 重建后提交成功，「没有保存」的提示随之清掉（同 H3、H5）。
      setStale(null);
      await finishCommand(record, result);
    } catch (error) {
      changed();
      // A resolved recovery must not retain a closure that can dispatch the old request.
      if (!recovering && isHGrowthReadConflict(error)) setStale({ param: [ENABLED_PARAM, ...PARAMS].find(p => p.key === record.paramKey), value: record.value });
      if (!recovering && isHGrowthReadConflict(error) || recovering && !pendingH8RewardCommands(record.adminId).some(r => r.commandKey === record.commandKey)) {
        // 框要关了：冲突有页面上的「已被别人改过」提示；原操作已有结论的，这里提示一次。
        if (!isHGrowthReadConflict(error)) ctx.toast(displayAdminError(error));
        setMc(current => current?.commandKey === record.commandKey ? null : current);
        currentRead.current.ready = false;
        setReadReady(false);
        await load();
      }
      throw error;
    }
  };
  const queryCommand = async (record: H8RewardCommand) => {
    try {
      if (record.kind === "direct") {
        requireH8Actor(record.adminId);
        await h8Recovery.query(record, async () => { await load(); return { conclusion: "unknown" }; });
        return false;
      }
      const ticket = await queryH8RewardCommand(record);
      if (!ticket) return false;
      await finishCommand(record, { ticket, unchanged: false });
      return true;
    } finally { changed(); }
  };
  const editParam = (param: H8Param, fixedValue?: string, recovered?: H8RewardCommand, draft?: H8RewardCommand) => {
    if (!session || !recovered && policyBlocked) return;
    if (fixedValue !== undefined) fixedValue = conflictDraft.intent ?? fixedValue;
    // 冲突后重建打开时留着「已被别人改过」的提示，普通打开才清掉。
    if (conflictDraft.business === undefined && conflictDraft.intent === undefined) setStale(null);
    const pending = recovered;
    if (pending && !pending.original) {
      void queryCommand(pending).catch(cause => ctx.toast(displayAdminError(cause)));
      return;
    }
    const snapshot = pending?.original?.overview ?? data;
    if (!snapshot || !pending && (!readReady || !canWrite)) return;
    const original = pending?.original;
    const isEnabled = param.key === "enabled";
    const numeric = param.kind === "number";
    const rawCurrent = String(snapshot.params[param.key]);
    if (fixedValue !== undefined && fixedValue === rawCurrent) { setStale(null); ctx.toast(conflictDraft.intent !== undefined ? "别人已经改成这个状态，不用再提交" : "和现在一样"); return; }
    const current = isEnabled
      ? ENABLED_LABELS[rawCurrent] ?? ENABLED_LABELS.false
      : param.kind === "select" ? LOCK_MODE_LABELS[rawCurrent] ?? LOCK_MODE_LABELS.risk_bucket : rawCurrent;
    const expectedVersion = snapshot.version;
    const originalValue = original && original.kind !== "settlement" ? original.value : undefined;
    const enabling = isEnabled && (originalValue ?? fixedValue ?? rawCurrent) === "true";
    const multiplier = param.key === "inviter.nex" ? snapshot.inviterMultiplier : snapshot.newcomerMultiplier;
    const storedValue = (value: BusinessFormValue) => (originalValue ?? fixedValue ?? value.value ?? "").trim();
    const ensureSession = () => { requireH8Actor(session.adminId); };
    const approvalCommand = (value: string, reason: string) => {
      const actor = requireH8Actor(session.adminId, "param");
      const request = {
        action: "放宽新人礼与邀请奖励", obj: "current", beforeValue: "—", afterValue: "—",
        operator: actor.operator || actor.username, operatorRole: roleLabel(actor.role),
        type: "fund" as const, amplifies: true, sos: false, roleGate: "超管", reason, sourceDomain: "H8",
        command: { domain: "H", op: "h8_reward_param_change", params: { values: { key: param.key, value, expectedVersion } } },
        target: { domain: "H", type: "h8_reward_policy", id: "current" },
      };
      return createH8RewardCommand(session.adminId, { kind: "param-approval", paramKey: param.key, value,
        overview: snapshot, request, body: JSON.stringify(request), continuedFrom: draft?.commandKey });
    };
    const currentCommand = () => {
      const key = pending?.commandKey ?? confirmation.current?.commandKey;
      return pendingH8RewardCommands(session.adminId).find(command => command.paramKey === param.key && command.commandKey === key);
    };
    const unit = numeric ? param.unit : "";
    const multiplierName = param.key === "inviter.nex" ? "邀请加成" : "新用户加成";
    const pendingCount = countText(snapshot.pending);
    const gateNow = effectiveTimeText(snapshot.effectiveAt);
    const before = draft?.original?.overview.params;
    const otherChanges = before ? [ENABLED_PARAM, ...PARAMS].flatMap(field => {
      const from = valueText(field, String(before[field.key])), to = valueText(field, String(snapshot.params[field.key]));
      return from === to ? [] : [<Fact key={field.key} k={`他人修改 · ${paramTitle(field)}`}><Change from={from} to={to} /></Fact>];
    }) : [];
    const resetFact = (when = "保存或批准") => `${when}后，现在等结算的 ${pendingCount} 位仍按各人生效区间的金额结`;
    const approvalCopy = numeric
      ? "批准前仍按原金额发；批准时按那时的当月加成重算，并检查兑付覆盖率。"
      : isEnabled
        ? "批准前奖励保持关闭；批准时检查兑付覆盖率。"
        : "批准前沿用「先过风险检查再发」；批准时检查兑付覆盖率。";
    const directCopy = isEnabled
      ? "生效时间不变；以后再启用，批准时改成那一刻。"
      : numeric ? "调低或不变：确认后立即保存。"
        : "改回「先过风险检查再发」：确认后立即保存。";
    const loosenName = isEnabled ? "启用" : numeric ? "调高" : "放宽";
    const tightenName = isEnabled ? "停用" : numeric ? "调低" : "改回";
    const direction = (value: string) => {
      if (!value || !h8RewardParamValid(param.key as Parameters<typeof h8RewardParamValid>[0], value)) return undefined;
      if (value === rawCurrent || (numeric && Number(value) === Number(rawCurrent))) return "same" as const;
      return h8RewardParamAmplifies(param.key as Parameters<typeof h8RewardParamAmplifies>[0], rawCurrent, value) ? "loosen" as const : "tighten" as const;
    };
    if (!pending && queueError && isEnabled && enabling) return;
    const directionTag = (value: string) => {
      const dir = direction(value);
      if (dir === "loosen") return <StatusTag tone="warn" icon={ArrowLeftRight}>{loosenName} · 要批准</StatusTag>;
      if (dir === "tighten") return <StatusTag tone="neutral" icon={ArrowLeftRight}>{tightenName} · 立即保存</StatusTag>;
      if (dir === "same") return <StatusTag tone="neutral">和现在一样</StatusTag>;
      return undefined;
    };
    openConfirm({ commandKey: pending?.commandKey, rebaseValue: fixedValue, briefKind: "config",
      action: isEnabled ? enabling ? "启用新人礼与邀请奖励" : "停用新人礼与邀请奖励" : `调整邀请奖励 · ${param.label}`,
      title: isEnabled ? enabling ? "启用新人礼与邀请奖励" : "停用新人礼与邀请奖励" : `调整${paramTitle(param)}`,
      detail: isEnabled
        ? enabling
          ? "启用要提交审批；批准前奖励保持关闭，App 不显示奖励金额，也不发新的奖励。"
          : "停用后 App 仍能分享邀请码，但不再显示奖励金额，也不再发新的奖励；已冻结的新人礼首笔实付后照常解冻。"
        : numeric ? `${param.label} 现在的基础额是 ${current} ${param.unit}。调高要提交审批，调低或不变直接保存。`
          : "改成「符合资格就直接发」要提交审批；改回「先过风险检查再发」直接保存。两种方式都保留首购冻结。",
      effect: isEnabled
        ? enabling
          ? <StatusTag tone="progress" filled explain={`${APPROVER}在「操作记录与审批」批准后生效，你自己不能批。`}>批准后生效</StatusTag>
          : <StatusTag tone="progress" filled>立即生效</StatusTag>
        : <StatusTag tone="neutral" icon={ArrowLeftRight} explain={<>
          <p>{loosenName}会让平台多付钱：先提交审批，{APPROVER}在「操作记录与审批」批准后才生效，你自己不能批。</p>
          <p>{tightenName}或不变：确认后立即保存。</p>
        </>}>{numeric ? "调高要批准 · 调低立即生效" : "放宽要批准 · 改回立即生效"}</StatusTag>,
      facts: numeric || isEnabled || otherChanges.length ? <Facts>
        {otherChanges}
        {isEnabled && <Fact k="奖励开关"><Change from={current} to={enabling ? "已启用" : "已停用"} /></Fact>}
        {numeric && <Fact k="改的是">{WHO[param.key].per}的{param.label} 基础额</Fact>}
        {numeric && <Fact k="当月加成">第 {snapshot.rhythmMonth} 月{multiplierName} {multiplierText(multiplier)}，在运营阶段设置改</Fact>}
        {numeric && <Fact k="生效时间"><Change from={gateNow} to="保存或批准那一刻" /></Fact>}
        {numeric && <Fact k="等结算的注册">{resetFact()}</Fact>}
        {numeric && <Fact k="已结算和已冻结">金额不变</Fact>}
        {isEnabled && enabling && <Fact k="谁能批准">{APPROVER}（需有审批批准权限）</Fact>}
        {isEnabled && !enabling && !pending && tightenWarning && <Fact k={pendingPolicy ? "已有待批" : "审批队列"} tone="warn">{tightenWarning}</Fact>}
        {isEnabled && !enabling && <Fact k="App 和结算">App 不再显示奖励金额；新的结算不再发</Fact>}
        {isEnabled && !enabling && <Fact k="已冻结的新人礼">首笔实付订单后照常解冻</Fact>}
        {isEnabled && <Fact k="生效时间">{enabling ? <Change from={gateNow} to="批准那一刻" /> : `不变：${gateNow}`}</Fact>}
        {isEnabled && <Fact k="等结算的注册">{enabling
          ? `批准后，现在等结算的 ${pendingCount} 位不再进入结算`
          : `${pendingCount} 位照常统计，停用期间不能结算`}</Fact>}
      </Facts> : undefined,
      statedBrief: isEnabled
        ? { impact: enabling ? "启用后按当月加成给之后注册的新人和他们的邀请人发奖励，App 显示奖励金额。" : "停用后不再发新的奖励，App 不再显示奖励金额。", check: "核对开关方向；理由写清依据或工单号。" }
        : { impact: numeric ? "改的是之后结算用的基础额。" : "改的是之后结算时的风控筛选，首购冻结不受影响。", check: "核对新值和方向；理由写清依据或工单号。" },
      confirmLabel: isEnabled ? "确认停用" : "确认修改",
      amplifies: false,
      reasonMin: 8,
      reasonMax: 200,
      getPendingReason: () => { const o = currentCommand()?.original; return o?.kind === "direct" ? o.reason : o?.request.reason; },
      getPendingRecovery: () => { const record = currentCommand(); return record && fConfirmRecovery(h8Recovery, record, () => queryCommand(record)); },
      getPendingBusinessValue: () => { const o = currentCommand()?.original; return o && o.kind !== "settlement" ? { value: o.value } : draft?.value === undefined ? undefined : { value: draft.value }; },
      completionCopy: directCopy,
      businessForm: { kind: "multi-field", fields: fixedValue !== undefined ? [] : [{
        key: "value", label: numeric ? `${param.label}基础额` : "发放模式", required: true,
        current: originalValue ?? (numeric ? "" : rawCurrent), inputKind: numeric ? "text" : "select",
        ...(numeric ? { pattern: "^(?:0|[1-9]\\d{0,11})(?:\\.\\d{1,6})?$", patternMessage: "请输入非负金额，最多六位小数。" }
          : { options: ["risk_bucket", "direct"], optionLabels: LOCK_MODE_LABELS }),
      }] },
      inlineApproval: {
        dialogClassName: "h8-param-confirm",
        resolve: (form) => {
          const value = storedValue(form);
          if (!value) return undefined;
          if (!h8RewardParamValid(param.key, value)) return {
            heading: "请核对改后的值", disabledReason: numeric ? `基础额要在 0–${param.max.toLocaleString("zh-CN")} ${param.unit} 之间，最多 6 位小数。` : "请选择一种发放方式。",
            completionCopy: "还没有提交，改成允许范围内的值再继续。",
          };
          if (!pending && direction(value) === "same") return { disabledReason: "改后的值和现行设置相同，无需提交。" };
          if (pending?.kind === "direct" || !pending && !h8RewardParamAmplifies(param.key, rawCurrent, value)) return undefined;
          return {
            heading: `会让平台多付钱，要${APPROVER}批准`,
            completionCopy: approvalCopy,
            disabledReason: !pending && queueError ? QUEUE_UNREAD
              : !pending && pendingPolicy ? displayAdminError(new Error("OBJECT_ALREADY_PENDING")) : numeric && h8EffectiveRewardReference(value, multiplier) === null
              ? "改后的实际发放超出允许范围，请核对基础额和当月加成。" : undefined,
          };
        },
        renderForm: (form, onChange, locked) => {
          const value = storedValue(form);
          const valid = !!value && h8RewardParamValid(param.key, value);
          const reference = numeric && valid ? h8EffectiveRewardReference(value, multiplier) : null;
          const dir = direction(value);
          if (fixedValue !== undefined) return null;
          if (!numeric) return (
            <div className="h8-mode-form">
              <Field label="发放方式" required>
                <Segments label="新人礼发放方式" value={value || rawCurrent}
                  items={Object.entries(LOCK_MODE_LABELS).map(([key, label]) => ({ value: key, label, disabled: locked }))}
                  onChange={(next) => onChange({ ...form, value: next })} />
              </Field>
              <Facts>
                {!pending && tightenWarning && dir === "tighten" && <Fact k={pendingPolicy ? "已有待批" : "审批队列"} tone="warn">{tightenWarning}</Fact>}
                <Fact k="改后">{directionTag(value) ?? "—"}</Fact>
                <Fact k="改后怎么筛">{modeHelp(value) ?? modeHelp(rawCurrent)}</Fact>
                <Fact k="生效时间"><Change from={gateNow} to={dir === "loosen" ? "批准那一刻" : "保存那一刻"} /></Fact>
                <Fact k="等结算的注册">{resetFact(dir === "loosen" ? "批准" : "保存")}</Fact>
              </Facts>
            </div>
          );
          const decimals = decimalsOf(rawCurrent, value, reference);
          return (
            <DiffField before={amountText(rawCurrent, decimals)} unit={unit} label="改后基础额"
              hint={`0–${param.max.toLocaleString("zh-CN")} ${unit}，最多 6 位小数`}
              state={directionTag(value)}
              note={valid ? <span className="h8-preview">
                <span>改后实际发放 <b>{reference === null ? "—" : `${amountText(reference, decimals)} ${unit}`}</b> = {amountText(value, decimals)} × {multiplierName} {multiplierText(multiplier)}<Explain label="实际发放怎么算" content={dir === "loosen"
                  ? "这是提交时按现在的加成算的参考值；批准时按那时的当月加成重算，6 位小数四舍五入。"
                  : "按现在的当月加成算，6 位小数四舍五入；加成在运营阶段设置改。"} /></span>
                {!pending && tightenWarning && dir === "tighten" && <span>{tightenWarning}</span>}
                {dir === "same" && <span>和现在一样：保存后不会改动，生效时间不变。</span>}
              </span> : undefined}>
              {(control) => <NumberInput {...control} unit={unit} min={0} max={param.max} step={param.step} disabled={locked}
                aria-label={`${param.label}基础额`} value={form.value ?? ""}
                onChange={(event) => onChange({ ...form, value: event.target.value })} />}
            </DiffField>
          );
        },
        recover: async () => { const record = currentCommand(); return record ? queryCommand(record) : false; },
      },
      run: async (reason, _, form) => {
        ensureSession();
        const previous = currentCommand();
        if (previous) { await sendCommand(previous, true); return; }
        if (unresolvedH8Policy(session.adminId)) throw new Error("H8_ORIGINAL_UNRESOLVED");
        if (!currentRead.current.ready || currentRead.current.data !== snapshot) throw new Error("H8_OVERVIEW_REQUIRED");
        const value = storedValue(form ?? {});
        if (!h8RewardParamValid(param.key, value)) throw new Error("请填写允许范围内的基础额或选择有效模式。");
        if (direction(value) === "same") throw new Error("改后的值和现行设置相同，无需提交。");
        if (h8RewardParamAmplifies(param.key, rawCurrent, value)) {
          await sendCommand(approvalCommand(value, reason), false);
          return;
        }
        const actor = requireH8Actor(session.adminId, "param");
        const operator = actor.operator || actor.username;
        const record = createH8RewardCommand(session.adminId, { kind: "direct", paramKey: param.key, value, reason, operator,
          overview: snapshot, body: JSON.stringify({ key: param.key, value, expectedVersion, reason, operator }), continuedFrom: draft?.commandKey });
        try {
          await sendCommand(record, false);
        }
        catch (error) {
          // The server's direction is authoritative if its live state requires A2.
          if ((error as { reasonCode?: string }).reasonCode !== "A2_CONFIRMATION_REQUIRED") throw error;
          throw new HApprovalRequired((error as Error).message, { param, value, reason, snapshot }, async () => {
            ensureSession();
            if (!currentRead.current.ready || currentRead.current.data !== snapshot) throw new Error("H8_OVERVIEW_REQUIRED");
            await sendCommand(approvalCommand(value, reason), false);
          });
        }
      },
    });
  };

  const settle = (invitedUserId?: number, recovered?: H8RewardCommand, draft?: H8RewardCommand, draftEligibility?: H8SettlementEligibility) => {
    setStale(null);
    if (!session || !recovered && settleWriteBlock) return;
    const pending = recovered ?? pendingH8RewardCommands(session.adminId).find(r => r.kind === "settlement");
    if (pending && !pending.original) {
      void queryCommand(pending).catch(cause => ctx.toast(displayAdminError(cause)));
      return;
    }
    const original = pending?.original?.kind === "settlement" ? pending.original : undefined;
    const snapshot = original?.overview ?? data;
    if (!snapshot || !pending && (!readReady || !canSettle || !snapshot.enabled || invitedUserId === undefined && snapshot.pending <= 0)) return;
    invitedUserId = original?.invitedUserId ?? invitedUserId;
    const targeted = original ? original.invitedUserId !== undefined : invitedUserId != null;
    const currentCommand = () => pendingH8RewardCommands(session.adminId).find(r => r.commandKey === (pending?.commandKey ?? confirmation.current?.commandKey));
    const readEligibility = () => targeted ? readSettlementEligibility(invitedUserId, eligibilityRef.current, draftEligibility) : undefined;
    const getSettlementBlockReason = () => pending || currentCommand() ? undefined : settlementEligibilityBlock(snapshot, readEligibility());
    const settlementReview = () => {
      const saved = original ?? currentCommand()?.original;
      const recovering = saved?.kind === "settlement";
      const eligibility = recovering ? storedSettlementEligibility(saved) : readEligibility();
      const originalSummary = recovering && eligibility === undefined
        ? (typeof saved.request.afterValue === "string" && saved.request.afterValue || "原申请未保存结算说明") : undefined;
      return { eligibility, recovering, originalSummary, amounts: settlementAmounts(snapshot, eligibility, originalSummary) };
    };
    const loaded = targeted ? snapshot?.recentSettlements.find((row) => row.invitedUserId === invitedUserId) : undefined;
    const proposeBlock = withdrawalApprovalDisabledReason(session?.authorities ?? []);
    const settleFacts = (value?: string) => {
      const limit = targeted ? 1 : Math.max(1, Math.min(100, Number(value) || 20));
      const pendingNow = snapshot.pending;
      const { eligibility: readData, recovering, originalSummary, amounts } = settlementReview();
      const checked = readData ? eligibilityView(snapshot, readData) : null;
      return <Facts>
        {targeted
          ? <Fact k="新人用户编号" lead>{invitedUserId}</Fact>
          : <Fact k="这一批最多" lead unit={value ? "位新人" : undefined}>{value ? countText(limit) : "—"}</Fact>}
        {targeted
          ? <Fact k="这位新人">{checked
            ? <><StatusTag tone={checked.tone}>{checked.tag}</StatusTag> {checked.text}<Explain label="这位新人的情况" content={<EligibilityDetail value={readData!} original={recovering} />} /></>
            : loaded ? "已结算过，不会再发一份" : recovering ? "原申请没有资格详情" : "没读到他现在能不能结"}</Fact>
          : null}
        {targeted && loaded && <Fact k="原结算号"><span data-mono>{loaded.settlementNo}</span></Fact>}
        {targeted && <Fact k="这次会怎样">{amounts.releaseOnly ? "批准时复核解冻条件，通过后按原冻结金额解冻" : checked ? checked.outcome : loaded
          ? "他的礼包还冻结、又已经有首笔实付订单的，只解冻原礼包；否则不发"
          : "批准执行时逐项核对；不符合就不发"}</Fact>}
        {targeted ? null
          : <>
            <Fact k="提交时待结算">{countText(pendingNow)} 位</Fact>
            <Fact k="批准时结谁">按那时的名单，批准前新符合条件的也算；先结现行生效区间，再结之前各生效区间，三项都是 0 的区间不结；同一区间按注册先后</Fact>
          </>}
        {originalSummary ? <Fact k="原结算说明">{originalSummary}</Fact> : <>
          <Fact k="每位新人">{amounts.newcomer}</Fact>
          <Fact k="每位邀请人">{amounts.inviter}</Fact>
          {!targeted && value && <Fact k="这一批最多发出">金额无法预估，{SETTLEMENT_INTERVAL_AMOUNT}</Fact>}
        </>}
        {!checked && <Fact k="会冻结的">注册时标了首购冻结的，新人礼冻结到首笔实付订单；有几位页面算不出</Fact>}
        <Fact k="钱从哪出">{amounts.releaseOnly ? "来自原礼包的冻结记录，解冻后记进新人的钱包和资金账本" : "平台出钱，进新人和邀请人的钱包，记进资金账本"}</Fact>
        <Fact k="谁来批">{APPROVER}</Fact>
        <Fact k="需有权限">{fApprovalPermissionText(H8_SETTLEMENT_APPROVAL_PERMISSION)}</Fact>
        {proposeBlock && <Fact k="你的权限" tone="warn">这个账号没有发起审批的权限，提交会被拒绝；请有权限的同事发起</Fact>}
      </Facts>;
    };
    openConfirm({ commandKey: pending?.commandKey, briefKind: "funds", getSettlementBlockReason,
    action: targeted ? "给指定新人结算邀请奖励" : "结算邀请奖励",
    title: targeted ? "给指定新人结算" : "批量结算邀请奖励",
    detail: targeted
      ? `只结算新人 ${invitedUserId}；不符合条件就不发，也不会改发给别人。已结算、礼包还冻结又已有首笔实付订单的，这次只解冻原礼包。`
      : "找出已开钱包、还没结算、没被风控拦下的新人，有没有邀请人都算。",
    effect: () => <><StatusTag tone="progress" filled explain={settlementReview().amounts.releaseOnly
      ? `${APPROVER}在「操作记录与审批」批准时复核，符合条件才解冻原礼包；奖励配置在这期间变了，要重新提交。`
      : `${APPROVER}在「操作记录与审批」批准后才发，批准前什么都不发。批准时按那时的名单发；奖励配置在这期间变了，要重新提交。`}>批准后生效</StatusTag><IrreversibleTag /></>,
    statedBrief: () => {
      const { amounts, originalSummary } = settlementReview();
      if (amounts.releaseOnly) return {
        impact: "批准时复核解冻资格和兑付覆盖率。通过后只按原礼包冻结记录里的金额解冻，不发新奖励。",
        check: "核对新人编号和原礼包冻结记录；理由写清结算依据或工单号。",
      };
      if (originalSummary) return { impact: "批准时按原申请复核结算资格。", check: "核对原结算说明和操作理由。" };
      return {
        impact: targeted ? "批准后给这位新人和他的邀请人发奖励，发出去不能撤回。" : "批准后按那时的名单给这一批新人和他们的邀请人发奖励，发出去不能撤回。",
        check: "核对人数和每位金额；理由写清结算依据或工单号。",
      };
    },
    facts: settleFacts,
    getSettlementCoverage: () => settlementReview().amounts.releaseOnly ? {
      lead: "解冻会把原礼包金额记入新人的钱包",
      check: "提交审批时不检查兑付覆盖率；批准执行时复核，低于红线不能解冻。",
    } : {
      lead: "结算会真的给用户发钱",
      check: "提交审批时不检查兑付覆盖率；批准后、真正入账前各检查一次，低于红线整批不发。",
    },
    confirmLabel: "提交审批",
    confirmTone: "danger",
    getPendingReason: () => { const o = currentCommand()?.original; return o && o.kind !== "direct" ? o.request.reason : undefined; },
    getPendingRecovery: () => { const record = currentCommand(); return record && fConfirmRecovery(h8Recovery, record, () => queryCommand(record)); },
    reasonPlaceholder: "例如：本周新人礼例行结算、工单号",
    amplifies: true,
    edit: targeted ? undefined : { kind: "number", label: "这一批最多结算", current: "20", currentLabel: "默认", ...(original || draft?.limit !== undefined ? { initialValue: String(original?.limit ?? draft?.limit) } : {}), unit: "位", min: 1, max: 100, step: 1, hint: "1–100 位，填了才能提交" },
    run: async (reason, value) => {
      const previous = currentCommand();
      if (previous) { await sendCommand(previous, true); return; }
      if (pending) throw new Error("H8_ORIGINAL_RESOLVED");
      const eligibility = readEligibility();
      const blocked = settlementEligibilityBlock(snapshot, eligibility);
      if (blocked) throw new Error(blocked);
      if (!currentRead.current.ready || currentRead.current.data !== snapshot || !snapshot.enabled) throw new Error("H8_OVERVIEW_REQUIRED");
      // The legacy empty field was never submittable. Keep its fallback and exact limit body.
      const limit = targeted ? 1 : Math.max(1, Math.min(100, Number(value) || 20));
      const def = targeted ? findHighOp("h8_referral_settlement_user")! : findHighOp("h8_referral_settlement")!;
      const actor = requireH8Actor(session.adminId, "settlement");
      const request = {
        action: targeted ? "给指定新人结算邀请奖励" : "结算邀请奖励",
        obj: targeted ? `新人 ${invitedUserId}` : "待结算邀请批次",
        beforeValue: `待结算 ${snapshot.pending} 条 · 设置版本 v${snapshot.version} · 第 ${snapshot.rhythmMonth} 个月`,
        afterValue: `${targeted ? `仅结算新人 ${invitedUserId} 的邀请奖励` : `最多结算 ${limit} 条`} · ${settlementAmounts(snapshot, eligibility).summary} · 快照 ${snapshot.rewardSnapshotHash.slice(0, 12)}…`,
        operator: actor.operator || actor.username, operatorRole: roleLabel(actor.role),
        type: "fund" as const, amplifies: true, sos: false, roleGate: def.gateLabel, reason, sourceDomain: "H8",
        command: def.buildCommand({ limit, invitedUserId, expectedH8Version: snapshot.version,
          expectedRhythmMonth: snapshot.rhythmMonth, rewardSnapshotHash: snapshot.rewardSnapshotHash }),
        target: def.buildTarget({ limit, invitedUserId }),
      };
      await sendCommand(createH8RewardCommand(session.adminId, { kind: "settlement", overview: snapshot,
        ...(targeted ? { invitedUserId } : {}), limit, request, body: JSON.stringify(request),
        confirmedEligibility: eligibility ?? null, continuedFrom: draft?.commandKey }), false);
    },
    });
  };

  // Recovery stays outside the overview-success branches and uses only persisted facts.
  const recoveryRows: H8RecoveryRow[] = [];
  const recoveryByKey: Record<string, ReactNode> = {};
  if (session && !mc) {
    for (const record of commands) {
      const param = [ENABLED_PARAM, ...PARAMS].find(p => p.key === record.paramKey);
      // 结算的待审批气泡沿用结算确认框的执行规则：批准时再核对资格、名单和兑付覆盖率；提交后奖励设置变了要重新提交；指定新人可能只解冻原礼包。
      const tag = record.ticket?.status === "pending"
        ? record.kind === "param-approval" ? pendingTag() : <StatusTag tone="warn" icon={Clock3} explain={<>
          <p>等{APPROVER}在「操作记录与审批」批准，批准前什么都不发。</p>
          <p>{record.invitedUserId !== undefined ? "批准时按那时的资格核对，不符合就不发；兑付覆盖率低于红线时也不发。" : "批准时按那时的资格和名单核对，符合的才发；兑付覆盖率低于红线时整批不发。"}</p>
          <p>奖励设置、阶段月份或加成在提交后变了，这张申请就批不下来，这条记录也会一直挡着新的结算：请到「操作记录与审批」撤回，或请审批人驳回；再点「查询原操作」清掉这条记录，按现在的设置重新提交。</p>
          {record.invitedUserId !== undefined && <p>这位新人已结算过、礼包还冻结的，批准后不会再发一份；已有首笔实付订单、账户状态和风控核验也都通过时，只解冻原礼包。</p>}
        </>}>待审批</StatusTag>
        : isRetryExpired(record) ? expiredTag(record.kind === "direct" ? "direct" : "approval") : unknownTag(record.kind === "direct" ? "direct" : "approval");
      if (param) recoveryByKey[param.key] = tag;
      const recover = () => param ? editParam(param, param.key === "enabled" ? record.value : undefined, record) : settle(undefined, record);
      recoveryRows.push({
        key: record.commandKey, name: param ? paramTitle(param) : record.invitedUserId !== undefined ? "给指定新人结算" : "批量结算",
        submittedAt: record.createdAt, tag, waiting: record.ticket?.status === "pending",
        change: param ? record.original
            ? <>{record.kind !== "direct" && <span className="h8-rec-kind">申请</span>}<Change from={valueText(param, String(record.original.overview.params[param.key]))} to={valueText(param, record.value)} /></>
            : <span>{record.kind === "direct" ? "改成" : "申请改成"} {valueText(param, record.value)}</span>
          : <span>{record.invitedUserId !== undefined ? `新人 ${record.invitedUserId}` : `最多 ${record.limit ?? "—"} 位`}{record.original && `（提交时 ${countText(record.original.overview.pending)} 位待结算）`}</span>,
        actions: <>
          {isRetryExpired(record) && <span>{RETRY_EXPIRED_TEXT}</span>}
          <Button size="sm" aria-label={`查询${param ? paramTitle(param) : "结算"}的原操作`}
            onClick={() => { recover(); }}>查询原操作</Button>
          {canRetryH8RewardCommand(record) && (record.kind === "settlement" ? canSettle : canWrite)
            && <Button size="sm" onClick={() => recover()}>按原操作重试</Button>}
          {record.replayRejection && <Button size="sm" variant="ghost" onClick={() => setReleasing(record)}>核实后解除</Button>}
          {/* 已提交审批的不加去审批页的链接（OP-152）：参数申请和在等批的结算都不显示。 */}
          {record.kind !== "param-approval" && record.ticket?.status !== "pending" && reach("/platform/audit", "platform_a2_read")
            && <Link className="rd-link" href="/platform/audit" prefetch={false}>到操作记录与审批核对</Link>}
        </>,
      });
    }
  }
  if (session && !mc) for (const { original: record } of drafts) {
    const original = record.original;
    if (!original) continue;
    const param = [ENABLED_PARAM, ...PARAMS].find(p => p.key === record.paramKey);
    const writable = !freshBlocked && !!data && !error && (param ? canWrite && !policyBlocked && !(queueError && param.key === "enabled" && record.value === "true")
      : canSettle && !settleWriteBlock && data.enabled && (record.invitedUserId !== undefined || data.pending > 0));
    recoveryRows.push({
      key: record.commandKey, name: param ? paramTitle(param) : record.invitedUserId !== undefined ? "给指定新人结算" : "批量结算",
      submittedAt: record.createdAt, settled: true,
      tag: <StatusTag tone="neutral">未执行</StatusTag>,
      change: param ? <Change from={valueText(param, String(original.overview.params[param.key]))} to={valueText(param, record.value)} />
        : <span>{record.invitedUserId !== undefined ? `新人 ${record.invitedUserId}` : `最多 ${record.limit} 位`}</span>,
      actions: writable ? <Button size="sm" onClick={async () => {
        if (param) { editParam(param, param.key === "enabled" ? record.value : undefined, undefined, record); return; }
        const target = record.invitedUserId;
        const now = currentRead.current.data;
        try {
          const eligibility = target === undefined ? undefined : await fetchH8SettlementEligibility(target);
          if (!confirmation.current && currentRead.current.data === now && currentRead.current.ready) settle(target, undefined, record, eligibility);
        } catch (cause) { ctx.toast(displayAdminReadError(cause)); }
      }}>继续修改</Button> : <span>请核对当前奖励状态和操作权限</span>,
    });
  }
  const releasingRow = releasing && recoveryRows.find(row => row.key === releasing.commandKey);
  const recoveryNotice = <>
    <H8RecoveryNotice rows={recoveryRows} />
    {releasing && <ReleaseModal label={<>{releasingRow?.name ?? "原申请"}{releasingRow && <> · <span className="h8-rel-change">{releasingRow.change}</span></>}</>}
      explain="先核实原操作结果。解除只清除本标签页的原记录，不发送请求，也不进入操作记录。"
      onCancel={() => setReleasing(null)} onConfirm={() => {
        const record = releasing;
        setReleasing(null);
        try { releaseRejectedH8RewardCommand(record); changed(); ctx.toast("已解除这条记录，可以重新提交。"); }
        catch (cause) { ctx.toast(displayAdminError(cause)); }
      }} />}
  </>;
  const savedUnreadNotice = savedUnread && <H8SavedUnreadNotice name={paramTitle(savedUnread.param)}
    value={valueText(savedUnread.param, savedUnread.value)} reloading={loading} hasData={!!data} onReload={() => void load("", false, true)} />;
  const staleNotice = stale && <Notice tone="warn" title={`没有保存：${stale.param ? paramTitle(stale.param) : "结算申请"}已被别人改过`}
    action={<Button size="sm" variant="ghost" onClick={() => setStale(null)}>知道了</Button>}>
    {!data ? "最新值没读到；重新加载成功后，会带着你填的内容重新打开。"
      : stale.param
      ? <>现在是 {valueText(stale.param, String(data.params[stale.param.key]))}，你要改成 {valueText(stale.param, stale.value)}。已读到最新值，核对后再提交。</>
      : "奖励配置或当月加成已变化。已读到最新值，你填的还在，核对后再提交。"}
  </Notice>;

  // 固定 key，三种状态用同一个根元素：重读失败换成整页失败状态时，开着的确认框不重挂，填的值和理由留着。
  const settlementCoverage = mc?.getSettlementCoverage?.();
  const confirmModal = mc && (<Fragment key="h8-confirm">
    <OperationConfirmModal initialReason={mc.initialReason} briefKind={mc.briefKind}
      key={mc.formKey}
      action={mc.action}
      title={mc.title}
      detail={mc.detail}
      amplifies={mc.amplifies}
      edit={mc.edit}
      businessForm={mc.businessForm}
      facts={mc.facts}
      effect={mc.effect}
      confirmLabel={mc.confirmLabel}
      confirmTone={mc.confirmTone}
      blockedReason={mc.getSettlementBlockReason?.() ?? mc.blockedReason}
      statedBrief={mc.statedBrief}
      coverageLead={settlementCoverage?.lead ?? mc.coverageLead}
      coverageCheck={settlementCoverage?.check ?? mc.coverageCheck}
      reasonPlaceholder={mc.reasonPlaceholder}
      inlineApproval={mc.inlineApproval}
      reasonMin={mc.inlineApproval ? mc.reasonMin : undefined}
      reasonMax={mc.inlineApproval ? mc.reasonMax : undefined}
      getPendingReason={mc.getPendingReason}
      getPendingRecovery={mc.getPendingRecovery}
      getPendingBusinessValue={mc.getPendingBusinessValue}
      completionCopy={mc.inlineApproval ? mc.completionCopy : undefined}
      onClose={() => setMc(current => current === mc ? null : current)}
      onConfirm={async (reason, newValue, businessValue) => {
        try {
          await mc.run(reason, newValue, businessValue);
          setMc(current => current === mc ? null : current);
        } catch (failure) {
          // 直接保存被判定要走审批：换成审批确认，值和理由沿用（H-改走审批）。
          if (failure instanceof HApprovalRequired) {
            const { param, value, reason, snapshot } = failure.input as { param: H8Param; value: string; reason: string; snapshot: H8ReferralRewardOverview };
            setMc(null);
            ctx.openConfirm(hApprovalReconfirm(failure, { hasPending: () => !!session && pendingH8RewardCommands(session.adminId).some(record => record.kind !== "settlement" && !record.ticket), onUnknown: () => ctx.closeConfirm?.(), action: mc.action, title: mc.title, reason, approver: APPROVER, holds: "奖励配置",
              change: <Change from={valueText(param, String(snapshot.params[param.key]))} to={valueText(param, value)} /> }));
            return;
          }
          // 框还开着时错误写在框里，不再弹一遍；框被关掉的那几种在 sendCommand 里提示。
          throw failure;
        }
      }}
    />
  </Fragment>);

  const header = <PageHeader pageId="H8" title="新人礼与邀请奖励"
    summary="新人礼和邀请奖励发多少、怎么发、结算到哪一步。"
    readOnly={!canWrite && !canSettle ? "只读：可以查看奖励和结算记录，不能改奖励、不能结算" : undefined} />;

  if (loading && !data) return <div className="h8-page">
    {header}
    <Conclusion state="unknown">正在加载奖励设置和结算情况…</Conclusion>
    {recoveryNotice}
    {savedUnreadNotice}
    <BlockState state="loading" title="正在加载新人礼与邀请奖励…" />
    {confirmModal}
  </div>;
  if (!data) return <div className="h8-page">
    {header}
    <Conclusion state="unknown">读不到奖励设置，现在判断不了奖励开没开、有多少在等结算</Conclusion>
    {recoveryNotice}
    {savedUnreadNotice}
    {staleNotice}
    <BlockState state="error" title="新人礼与邀请奖励加载失败" detail={error ?? "没有收到数据。"} onRetry={() => void load()} />
    {confirmModal}
  </div>;

  const targetUserId = Number(invitedUserIdInput.trim());
  const targetUserValid = /^[1-9]\d*$/.test(invitedUserIdInput.trim()) && Number.isSafeInteger(targetUserId);
  const targetBlock = settleWriteBlock ?? freshBlocked ?? (!data.enabled ? "奖励已停用，不能结算"
    : !targetUserValid ? "先填一个正确的新人用户编号" : settlementEligibilityBlock(data, readSettlementEligibility(targetUserId, eligibility)));
  const submitTarget = conflictDraft.register("settle:target", () => settle(targetUserId));
  const zone = businessZone().label;
  const effectiveAtText = formatBusinessTimeFull(data.effectiveAt, "—");
  const modeLabel = LOCK_MODE_LABELS[String(data.params["newcomer.lockMode"])] ?? "—";
  const pending = Number(data.pending ?? 0);
  const allZero = AMOUNT_PARAMS.every((param) => Number(data.effectiveRewards[param.key]) === 0);
  const settleBlock = !data.enabled ? "奖励已停用，不能结算" : pending <= 0 ? "现在没有等待结算的注册" : undefined;
  const latest = data.recentSettlements[0];
  const auditHref = reach("/platform/audit", "platform_a2_read");
  const eventsHref = reach("/platform/events");
  const ledgerHref = reach("/finance/ledger", "finance_d4_read");
  const phaseHref = reach("/growth/phase");
  const rowUsdtDecimals = decimalsOf(...data.recentSettlements.map((row) => row.newcomerUsdt));
  const rowUvtDecimals = decimalsOf(...data.recentSettlements.map((row) => row.newcomerNex));
  const rowInviterDecimals = decimalsOf(...data.recentSettlements.map((row) => row.inviterNex));
  const longAmounts = AMOUNT_PARAMS.some((param) => (amountParts(data.effectiveRewards[param.key])?.int.length ?? 0) > 7 || (amountParts(String(data.params[param.key]))?.int.length ?? 0) > 7);

  // 和原操作提醒的标题同一个分法：在等审批的单独算，其余没结论的是结果未知。已有结论的审批单查到时就清掉或留作「未执行」草稿，草稿不挡修改，不进这句。
  const originalWaiting = recoveryRows.filter(row => row.waiting).length;
  const originalUnknown = recoveryRows.filter(row => !row.settled && !row.waiting).length;
  const conclusion = originalWaiting + originalUnknown > 0
    ? <Conclusion state="warn" icon={Hourglass}
        hint={!originalUnknown ? `等${APPROVER}在「操作记录与审批」批准，批准前不生效。`
          : !originalWaiting ? "在下面逐条查询原操作，有结论后再改这一项。"
            : `结果未知的先查询原操作；在等审批的等${APPROVER}批准。`}>
        {!originalUnknown ? "有修改或结算申请在等审批"
          : !originalWaiting ? "有修改或结算申请结果未知"
            : "修改或结算申请还没处理完"}</Conclusion>
    : !data.enabled
      ? <Conclusion state="neutral" icon={Power}
          hint={canWrite ? "要开启，点「开关和发放方式」里的「启用」提交审批。" : undefined}
          explain="停用期间 App 不显示奖励金额，新的结算不发；已冻结的新人礼首笔实付后照常解冻。待结算照常统计。">
          奖励已停用：新注册的不发新人礼，邀请人也不发奖励</Conclusion>
      : allZero
        ? pending > 0
          ? <Conclusion state="warn" icon={ListChecks}
              hint={canSettle ? "点「结算」里的「批量结算」提交审批，另一位超级管理员批准后才发。" : "结算要由有邀请奖励结算权限的同事发起。"}
              explain="生效时间起注册的新人不发奖励；等待结算的是之前生效区间里注册的，按各人生效区间的金额发。">
              奖励开着，现行三项都是 0；有 {countText(pending)} 位按之前生效区间的金额等待结算</Conclusion>
          : <Conclusion state="warn" hint={canWrite ? "在「每位发多少」里调整基础额。" : undefined}
              explain="生效时间起注册的新人不发奖励。之前生效区间里注册、还没结算的，仍按各人生效区间的金额结。">奖励开着，但现行三项金额都是 0，新注册的不发</Conclusion>
        : pending > 0
          ? <Conclusion state="warn" icon={ListChecks}
              hint={canSettle ? "点「结算」里的「批量结算」提交审批，另一位超级管理员批准后才发。" : "结算要由有邀请奖励结算权限的同事发起。"}
              explain="不会自动结算。批准时按那一刻的名单发，人数可能和现在不同。">
              奖励开着，有 {countText(pending)} 位新人等待结算</Conclusion>
          : <Conclusion state="ok" explain="待结算是已开钱包、还没结算、没被风控拦下的新人，含之前生效区间里注册的；都按各人生效区间的金额结。">奖励开着，没有等待结算的注册</Conclusion>;

  const amountCard = (param: AmountParam) => {
    const base = String(data.params[param.key]);
    const effective = data.effectiveRewards[param.key];
    const decimals = decimalsOf(base, effective);
    const multiplier = param.key === "inviter.nex" ? data.inviterMultiplier : data.newcomerMultiplier;
    const multiplierName = param.key === "inviter.nex" ? "邀请加成" : "新用户加成";
    const who = WHO[param.key];
    return (
      <Stat key={param.key} tone="role-4"
        head={<span className="h8-card-head"><who.icon size={14} aria-hidden />{param.label}<small>{who.per}</small></span>}
        label="实际发放" value={amountText(effective, decimals)} unit={param.unit}
        explain={`每份奖励按这个数发，不是某位用户已经到账的钱；由下面两项相乘，按 6 位小数四舍五入。调高要批准，调低之后结算的按新额发。${param.key === "inviter.nex" ? "新人没有有效邀请人时，这一份不发。" : ""}`}>
        <div className="h8-formula" aria-label={`基础额 ${amountText(base, decimals)} ${param.unit} 乘 ${multiplierName} ${multiplierText(multiplier)}`}>
          <span className="h8-formula-term"><small>基础额</small><Amount value={base} unit={param.unit} decimals={decimals} /></span>
          <span className="h8-formula-term"><small>第 {data.rhythmMonth} 月{multiplierName}</small><b>{multiplierText(multiplier)}</b></span>
        </div>
        <div className="h8-card-foot">
          <span className="h8-dir">{recoveryByKey[param.key] ?? "调高要批准 · 调低立即生效"}</span>
          {canWrite && <Button size="sm" aria-label={`调整${param.label}基础额`} disabledReason={policyBlocked ?? freshBlocked} onClick={conflictDraft.register(`param:${param.key}`, () => editParam(param))}>调整</Button>}
        </div>
      </Stat>
    );
  };

  return (
    <div className="h8-page">
      {header}
      {conclusion}
      {recoveryNotice}
      {savedUnreadNotice}
      {staleNotice}
      {queueError && <Notice tone="warn" title="审批队列读取失败"
        action={<Button size="sm" disabled={loading} onClick={() => void load()}>重试读取</Button>}>{queueError}</Notice>}

      <StatBand fit label="结算情况">
        <Stat lead icon={UserPlus} tone="role-3" label="等待结算" value={countText(pending)} unit="位"
          explain="已开钱包、还没结算、也没被风控拦下的新人，有没有邀请人都算：现行生效时间起注册的，加上之前各生效区间里注册的；三项都是 0 时注册的不算。奖励停用时照样统计，但不能结算。" />
        <Stat icon={ShieldAlert} tone="role-3" label="被风控拦下" value={countText(data.blockedByK2)} unit="位"
          explain={<>
            <p><KeepText text="还没结算的新人里（含之前生效区间里注册的），被风控拦下、不会给他们结算的：账户或账户组被标记、冻结的，在「异常套利与刷量排查」被拦截新人礼的。" phrases={K2_NAME} /></p>
            <p>按各人生效区间的发放方式：是「先过风险检查再发」的，命中待复核风险的也算在这里。改发放方式会把生效时间改成那一刻，这些人注册在前，不会因此转到等待结算。</p>
          </>} />
        <Stat icon={Check} tone="role-3" label="已结算" value={countText(data.settled)} unit="位"
          explain="历史上全部已结算的新人，不分时间。已结算不等于新人已经拿到可以提现的钱：新人礼可能还冻结到首笔实付订单，进钱包后也按收益规则分到可提现、待审核或锁定。" />
      </StatBand>

      <Panel title="每位发多少" icon={Gift} tone="role-4" sub={`第 ${data.rhythmMonth} 月加成`}
          explain="新人两项乘运营阶段设置里当月的新用户加成，邀请人一项乘当月的邀请加成。加成换月或在运营阶段设置被改后，实际发放跟着变。"
          actions={phaseHref ? <Link className="rd-link" href="/growth/phase" prefetch={false}>去运营阶段设置看加成 →</Link> : undefined}>
          <div className="h8-cards" data-long={longAmounts ? "" : undefined}><StatBand cards label="三项奖励">{AMOUNT_PARAMS.map(amountCard)}</StatBand></div>
        </Panel>
        <Panel title="开关和发放方式" icon={SlidersHorizontal} tone="role-4">
          <ConfigList label="开关和发放方式">
            <ConfigRow name="奖励开关"
              what="同时管新的结算和 App 上显示的奖励金额"
              when={`启用要${APPROVER}批准；停用确认后立即生效`}
              effect="停用后 App 不再显示奖励金额，新的结算不再发；已冻结的新人礼首笔实付后照常解冻"
              value={<span className="h8-row-value">{data.enabled
                ? <StatusTag tone="ok" icon={Check}>已启用</StatusTag>
                : <StatusTag tone="neutral" icon={Power}>已停用</StatusTag>}{recoveryByKey.enabled}</span>}
              action={canWrite ? (describedBy) => <Button size="sm" variant={data.enabled ? "danger-outline" : "secondary"} aria-describedby={describedBy}
                disabledReason={policyBlocked ?? freshBlocked ?? (queueError && !data.enabled ? QUEUE_UNREAD : undefined)} onClick={conflictDraft.register("param:enabled", () => editParam(ENABLED_PARAM, String(!data.enabled)))}>{data.enabled ? "停用" : "启用"}</Button> : undefined} />
            <ConfigRow name="发放方式"
              what="结算时怎么过风控"
              when={`改成「符合资格就直接发」要${APPROVER}批准；改回确认后立即保存`}
              effect={modeHelp(String(data.params["newcomer.lockMode"]))}
              note="两种方式都保留首购冻结；已冻结的礼包按当初的方式解冻。"
              value={<span className="h8-row-value">{modeLabel}{recoveryByKey["newcomer.lockMode"]}</span>}
              action={canWrite ? (describedBy) => <Button size="sm" aria-describedby={describedBy} disabledReason={policyBlocked ?? freshBlocked} onClick={conflictDraft.register("param:mode", () => editParam(MODE_PARAM))}>调整</Button> : undefined} />
            <ConfigRow name="生效时间"
              what="这个时间起（含这一刻）注册的新人按现行金额结算"
              effect={<><p>下面几种保存会把它改成保存那一刻（保存的值和现在一样时不改）：</p><ul className="h8-list"><li>改金额</li><li>改发放方式</li><li>启用获批准</li></ul><p>停用不改。那一刻之前注册、还没结算的新人，仍按各人生效区间的金额和发放方式结；奖励停用或三项都是 0 时注册的不结。</p></>}
              value={<span className="h8-time" title={`${effectiveAtText}（${zone}）`}>{formatBusinessTimeCompact(data.effectiveAt, "—")}<small>{zone}</small></span>} />
          </ConfigList>
        </Panel>

      <Panel title="结算" icon={Route} tone="role-3" sub={`待结算 ${countText(pending)} 位`}
        explain="不会自动结算。批量和指定新人两种结算都只提交审批，另一位超级管理员批准后才发；同一时间只能有一张结算审批单。"
        actions={canSettle ? <Button variant="primary" disabledReason={settleWriteBlock ?? freshBlocked ?? settleBlock} onClick={conflictDraft.register("settle:batch", () => settle())}>批量结算</Button> : undefined}>
        <RewardFlow pending={`${countText(pending)} 位`} blocked={`${countText(data.blockedByK2)} 位`} settled={`${countText(data.settled)} 位`} mode={modeLabel} />
        <div className="h8-settle-foot">
          {canSettle ? (
            <form className="h8-target" onSubmit={(event) => { event.preventDefault(); if (!targetBlock) submitTarget(); }}>
              <Field label="给指定新人结算" explain="只结算这一位：不符合条件就不发，也不会改发给别人。已结算、礼包还冻结又已有首笔实付订单的，这次只解冻原礼包。">
                {(control) => <Input {...control} inputMode="numeric" placeholder="新人用户编号" aria-label="指定结算的新人用户编号"
                  value={invitedUserIdInput} onChange={(event) => setInvitedUserIdInput(event.target.value)} />}
              </Field>
              <Button type="submit" disabledReason={targetBlock}>给这位新人结算</Button>
              {targetUserValid && eligibility?.id === targetUserId && <p className="h8-target-check" aria-live="polite">{eligibility.state === "loading" ? "正在查这位新人能不能结…"
                : eligibility.state === "error" ? <>读不到他现在能不能结<Explain label="失败原因" content={eligibility.message} /></>
                  : (() => { const view = eligibilityView(data, eligibility.data); return <><StatusTag tone={view.tone}>{view.tag}</StatusTag><span>{view.text}</span><Explain label="这位新人的情况" content={<EligibilityDetail value={eligibility.data} />} /></>; })()}</p>}
            </form>
          ) : <p className="h8-muted">结算要由有邀请奖励结算权限的同事发起。</p>}
          {latest && <p className="h8-latest">{<>最近一次结算：新人 {latest.invitedUserId}，{amountText(latest.newcomerUsdt, rowUsdtDecimals)} USDT + {amountText(latest.newcomerNex, rowUvtDecimals)} UVT{latest.inviterUserId === undefined ? "，没有邀请人" : `，邀请人 ${latest.inviterUserId} 得 ${amountText(latest.inviterNex, rowInviterDecimals)} UVT`}</>}</p>}
        </div>
      </Panel>

      <Panel title="结算记录" icon={ListChecks} tone="role-3" sub={`已读 ${countText(data.recentSettlements.length)} 条 · ${zone}`} flush
        explain="每位新人一条，最新在上。「这一批」是同一张结算审批发出的整批：冻结份数算整批，不是这一位。这里看不到这一位的礼包冻结没有，也没有批次编号：审批单到「操作记录与审批」，钱包和账本到「账本与账单核对」。">
        <Table label="结算记录" className="h8-records">
          <colgroup><col className="h8-col-no" /><col className="h8-col-user" /><col className="h8-col-user" /><col className="h8-col-gift" /><col className="h8-col-invite" /><col className="h8-col-time" /><col className="h8-col-batch" /><col className="h8-col-state" /></colgroup>
          <thead><tr><Th>结算号</Th><Th>新人</Th><Th>邀请人</Th><Th align="right">新人奖励</Th><Th align="right">邀请人奖励</Th><Th>结算时间</Th><Th>这一批</Th><Th>状态</Th></tr></thead>
          <tbody>
            {data.recentSettlements.map((row, index) => (
              <Tr key={row.settlementNo ?? index}>
                <Td><span className="h8-no" title={row.settlementNo}><span className="h8-no-head">{row.settlementNo?.slice(0, -8) ?? "—"}</span><span className="h8-no-tail">{row.settlementNo?.slice(-8)}</span></span></Td>
                <Td>{row.invitedUserId ?? "—"}</Td>
                <Td>{row.inviterUserId ?? <span className="h8-muted">没有邀请人</span>}</Td>
                <Td align="right"><span className="h8-pair"><Amount value={row.newcomerUsdt} unit="USDT" decimals={rowUsdtDecimals} /><Amount value={row.newcomerNex} unit="UVT" decimals={rowUvtDecimals} /></span></Td>
                <Td align="right"><Amount value={row.inviterNex} unit="UVT" decimals={rowInviterDecimals} /></Td>
                <Td><span className="h8-time">{formatBusinessTimeCompact(row.createdAt, "—")}</span></Td>
                <Td>{row.frozenCount === undefined && row.proposerName === undefined && row.approverName === undefined ? "—"
                  : row.frozenCount == null && row.proposerName == null && row.approverName == null ? <span className="h8-muted">批次信息未记录</span>
                    : <span className="h8-batch" title={`${row.approverName ?? "未记录"} 批准 · ${row.proposerName ?? "未记录"} 发起`}>
                      <span>{row.frozenCount == null ? "冻结份数未记录" : row.frozenCount === 0 ? "没有冻结" : `冻结 ${countText(row.frozenCount)} 份`}</span>
                      <small>{row.approverName ?? "未记录"} 批准 · {row.proposerName ?? "未记录"} 发起</small>
                    </span>}</Td>
                <Td><StatusTag tone="done" icon={Check}>{row.status === "SETTLED" ? "已结算" : "—"}</StatusTag></Td>
              </Tr>
            ))}
            {!data.recentSettlements.length && <TableMessage columns={8}>{pending > 0
              ? !data.enabled ? `还没有结算记录。有 ${countText(pending)} 位等待结算，奖励停用期间不能结算。`
                : canSettle ? `还没有结算记录。有 ${countText(pending)} 位等待结算，可以在上面「结算」里提交批量结算审批。`
                  : `还没有结算记录。有 ${countText(pending)} 位等待结算，要由有结算权限的同事发起。`
              : "还没有结算记录，也没有等待结算的注册。"}</TableMessage>}
          </tbody>
        </Table>
        {error && <div className="h8-more-error"><Notice tone="danger" title="更早的记录没读到">已读到的记录还在，列表还不完整。<Explain label="失败原因" content={error} /></Notice></div>}
        {(data.settlementHasMore || auditHref || eventsHref || ledgerHref) && (
          <div className="h8-records-foot">
            {data.settlementHasMore && <Button size="sm" loading={loadingMore} loadingText="正在加载…" onClick={() => void load(data.settlementNextCursor, true)}>{error ? "重试读取更早记录" : "读取更早记录"}</Button>}
            {(auditHref || eventsHref || ledgerHref) && <div className="rd-links" aria-label="相关页面">
              <span>相关页面</span>
              {auditHref && <Link className="rd-link" href="/platform/audit" prefetch={false}>操作记录与审批</Link>}
              {eventsHref && <Link className="rd-link" href="/platform/events" prefetch={false}>用户行为事件</Link>}
              {ledgerHref && <Link className="rd-link" href="/finance/ledger" prefetch={false}>账本与账单核对</Link>}
            </div>}
          </div>
        )}
      </Panel>
      {confirmModal}
    </div>
  );
}

function effectiveTimeText(value: string) {
  return Date.parse(value) === 0 ? "无效的旧时间" : `${formatBusinessTimeCompact(value, "—")}（${businessZone().label}）`;
}

function valueText(param: H8Param, value: string | undefined) {
  if (value === undefined) return "—";
  if (param.key === "enabled") return ENABLED_LABELS[value] ?? "—";
  if (param.key === "newcomer.lockMode") return LOCK_MODE_LABELS[value] ?? "—";
  return `${amountText(value)} ${param.unit}`;
}
