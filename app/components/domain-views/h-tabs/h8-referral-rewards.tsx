"use client";

/**
 * 新人礼与邀请奖励（H8）。首屏回答：奖励开着没有、新人和邀请人每位实际拿多少（基础额 × 运营阶段设置的当月加成）、
 * 有多少注册在等结算、改哪一项会让平台多付钱。
 * 调高金额、启用、改成「符合资格就直接发」提交审批，另一位超级管理员批准后生效；反方向确认后立即保存。
 * 两种结算都只提交审批，另一位管理员批准后才发。结果未知保存完整原请求和确认事实，恢复不依赖概览。
 */
import { useHConflictDraft } from "@/lib/admin/use-h-conflict-draft";
import { HApprovalRequired } from "@/lib/admin/h-approval-required";
import { isHGrowthReadConflict } from "@/lib/admin/h-write-conflict";
import { useReach } from "@/lib/nav/use-reach";
import { businessZone, formatBusinessTimeCompact, formatBusinessTimeFull } from "@/lib/admin/business-time";

import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftRight, Check, Gift, Hourglass, ListChecks, Power, Route, ShieldAlert, SlidersHorizontal, UserPlus, Users } from "lucide-react";
import {
  BlockState, Button, Change, Conclusion, ConfigList, ConfigRow, DiffField, Explain, Fact, Facts, Field, Input,
  IrreversibleTag, Notice, NumberInput, PageHeader, Panel, ReleaseModal, Segments, Stat, StatBand, StatusTag, Table, TableMessage, Td, Th, Tr,
} from "@/app/components/rd";
import {
  fetchH8ReferralRewards,
  h8EffectiveRewardReference,
  h8RewardParamAmplifies,
  h8RewardParamValid,
  type H8ReferralRewardOverview,
} from "@/lib/admin/h-client";
import type { ActionConfirmReq, HCtx } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import { roleLabel } from "@/lib/nav/console-nav";
import { canRetryH8RewardCommand, createH8RewardCommand, pendingH8RewardCommands, queryH8RewardCommand, releaseExpiredH8RewardProposal, requireH8Actor, sendH8RewardCommand, type H8RewardCommand } from "@/lib/admin/h8-reward-mutation";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { withdrawalApprovalDisabledReason } from "@/lib/admin/withdrawal-config-approval";
import { OperationConfirmModal, type BusinessFormValue } from "../design-kit";
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
const SETTLE_APPROVER = "另一位管理员";
const MODE_HELP: Record<string, string> = {
  risk_bucket: "命中待复核风险的新人先不发；K2「拦截新人礼」、账户或账户组被标记、冻结的也不发。",
  direct: "只跳过待复核风险这一层；K2「拦截新人礼」、账户或账户组被标记、冻结的照样不发。",
};

/** 参数的显示名（标题、提醒里用）。 */
const paramTitle = (param: H8Param) => param.key === "enabled" ? "奖励开关" : param.key === "newcomer.lockMode" ? "新人礼发放方式" : `${param.label} 基础额`;

export default function H8ReferralRewards({ ctx }: { ctx: HCtx }) {
  const reach = useReach();
  const session = useAdminAuth((state) => state.session);
  const isSuperadmin = session?.role === "superadmin";
  const canWrite = isSuperadmin || !!session?.authorities.includes("growth_h8_write");
  const canSettle = isSuperadmin || !!session?.authorities.includes("growth_h8_settle");
  const [data, setData] = useState<H8ReferralRewardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invitedUserIdInput, setInvitedUserIdInput] = useState("");
  const [mc, setMc] = useState<ActionConfirmReq | null>(null);
  const loadGeneration = useRef(0);
  const [, changed] = useReducer((value: number) => value + 1, 0);
  const [readReady, setReadReady] = useState(false);
  const [savedUnread, setSavedUnread] = useState<{ param: H8Param; value: string } | null>(null);
  /** 被「别人先改过」拒绝后已重读：留一条提醒写清现在的值和这次要改的值。只决定显示。 */
  const [stale, setStale] = useState<{ param?: H8Param; value?: string } | null>(null);
  const [releasing, setReleasing] = useState<H8RewardCommand | null>(null);
  const conflictDraft = useHConflictDraft(readReady && !loading && !error);
  const openConfirm = (req: ActionConfirmReq | null) => setMc(req ? conflictDraft.action(req) : null);
  const currentRead = useRef({ data, ready: readReady });
  currentRead.current = { data, ready: readReady && !loading };

  const load = useCallback(async (cursor = "", append = false, keepSaved = false) => {
    const request = ++loadGeneration.current;
    if (append) setLoadingMore(true);
    else { currentRead.current.ready = false; setLoading(true); setReadReady(false); }
    try {
      const next = await fetchH8ReferralRewards(cursor);
      if (request !== loadGeneration.current) return false;
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
  const commandForParam = (param: H8Param) => session
    ? pendingH8RewardCommands(session.adminId).find(r => r.paramKey === param.key) : undefined;
  const pendingPolicy = commands.some(r => r.kind === "param-approval" && r.ticket?.status === "pending");
  const freshBlocked = !readReady || loading ? displayAdminError(new Error("H8_OVERVIEW_REQUIRED")) : undefined;

  const finishCommand = async (record: H8RewardCommand, ticket: Awaited<ReturnType<typeof sendH8RewardCommand>>) => {
    openConfirm(null);
    currentRead.current.ready = false;
    setReadReady(false);
    changed();
    const original = record.original;
    if (original?.kind === "direct") {
      const param = [ENABLED_PARAM, ...PARAMS].find(p => p.key === original.paramKey)!;
      setSavedUnread({ param, value: original.value });
      if (await load("", false, true)) ctx.toast(param.key === "enabled" ? "邀请奖励已停用" : `${param.label} 已更新为 ${valueText(param, original.value)}`);
    } else {
      await load();
      if (ticket) ctx.toast(ticket.status === "pending" ? "已提交，等待审批后执行" : `审批单 ${ticket.id} 已登记，请在操作记录查看处理结果`);
    }
  };
  const sendCommand = async (record: H8RewardCommand, recovering: boolean) => {
    try {
      const ticket = await sendH8RewardCommand(record, recovering);
      await finishCommand(record, ticket);
    } catch (error) {
      changed();
      // A resolved recovery must not retain a closure that can dispatch the old request.
      if (isHGrowthReadConflict(error)) setStale({ param: [ENABLED_PARAM, ...PARAMS].find(p => p.key === record.paramKey), value: record.value });
      if (isHGrowthReadConflict(error) || recovering && !pendingH8RewardCommands(record.adminId).some(r => r.commandKey === record.commandKey)) {
        openConfirm(null);
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
        await load();
        throw new Error("H8_DIRECT_RESULT_REQUIRES_AUDIT");
      }
      const ticket = await queryH8RewardCommand(record);
      if (!ticket) return false;
      await finishCommand(record, ticket);
      return true;
    } finally { changed(); }
  };
  const editParam = (param: H8Param, fixedValue?: string, recovered?: H8RewardCommand, lookupOnly = false) => {
    if (!session) return;
    if (fixedValue !== undefined) fixedValue = conflictDraft.intent ?? fixedValue;
    setStale(null);
    const pending = recovered ?? commandForParam(param);
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
    if (fixedValue !== undefined && fixedValue === rawCurrent) { ctx.toast("和现在一样"); return; }
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
        overview: snapshot, request, body: JSON.stringify(request) });
    };
    const currentCommand = () => commandForParam(param);
    const unit = numeric ? param.unit : "";
    const multiplierName = param.key === "inviter.nex" ? "邀请加成" : "新用户加成";
    const pendingCount = countText(snapshot.pending);
    const gateNow = gateText(snapshot.effectiveAt);
    const resetFact = (when = "保存或批准") => `${when}后，现在等结算的 ${pendingCount} 位不再进入结算`;
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
    const directionTag = (value: string) => {
      const dir = direction(value);
      if (dir === "loosen") return <StatusTag tone="warn" icon={ArrowLeftRight}>{loosenName} · 要批准</StatusTag>;
      if (dir === "tighten") return <StatusTag tone="neutral" icon={ArrowLeftRight}>{tightenName} · 立即保存</StatusTag>;
      if (dir === "same") return <StatusTag tone="neutral">和现在一样</StatusTag>;
      return undefined;
    };
    openConfirm({ rebaseValue: fixedValue, briefKind: "config",
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
      facts: numeric || isEnabled ? <Facts>
        {isEnabled
          ? <Fact k="奖励开关"><Change from={current} to={enabling ? "已启用" : "已停用"} /></Fact>
          : <Fact k="改的是">{numeric ? `${WHO[param.key].per}的${param.label} 基础额` : "新人礼发放方式"}</Fact>}
        {numeric && <Fact k="当月加成">第 {snapshot.rhythmMonth} 月{multiplierName} {multiplierText(multiplier)}，在运营阶段设置改</Fact>}
        {numeric && <Fact k="生效时间"><Change from={gateNow} to="保存或批准那一刻" /></Fact>}
        {numeric && <Fact k="等结算的注册">{resetFact()}</Fact>}
        {numeric && <Fact k="已结算和已冻结">金额不变</Fact>}
        {isEnabled && enabling && <Fact k="谁能批准">{APPROVER}（需有审批批准权限）</Fact>}
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
      getPendingBusinessValue: () => { const o = currentCommand()?.original; return o && o.kind !== "settlement" ? { value: o.value } : undefined; },
      completionCopy: directCopy,
      businessForm: { kind: "multi-field", fields: fixedValue !== undefined ? [] : [{
        key: "value", label: numeric ? `${param.label}基础额` : "发放模式", required: true,
        current: originalValue ?? (numeric ? "" : rawCurrent), inputKind: numeric ? "text" : "select",
        ...(numeric ? { pattern: "^(?:0|[1-9]\\d{0,11})(?:\\.\\d{1,6})?$", patternMessage: "请输入非负金额，最多六位小数。" }
          : { options: ["risk_bucket", "direct"], optionLabels: LOCK_MODE_LABELS }),
      }] },
      inlineApproval: {
        dialogClassName: "h8-param-confirm",
        pending: !!pending,
        initialRecovery: pending && lookupOnly ? "lookup" : "retry",
        expired: !!pending && !canRetryH8RewardCommand(pending),
        disabledReason: pending && canRetryH8RewardCommand(pending) && !canWrite ? displayAdminError(new Error("ACCESS_DENIED")) : undefined,
        resolve: (form) => {
          const value = storedValue(form);
          if (!value) return undefined;
          if (!h8RewardParamValid(param.key, value)) return {
            heading: "请核对改后的值", disabledReason: numeric ? `基础额要在 0–${param.max.toLocaleString("zh-CN")} ${param.unit} 之间，最多 6 位小数。` : "请选择一种发放方式。",
            completionCopy: "还没有提交，改成允许范围内的值再继续。",
          };
          if (pending?.kind === "direct" || !pending && !h8RewardParamAmplifies(param.key, rawCurrent, value)) return undefined;
          return {
            heading: `会让平台多付钱，要${APPROVER}批准`,
            completionCopy: approvalCopy,
            disabledReason: !pending && pendingPolicy ? displayAdminError(new Error("OBJECT_ALREADY_PENDING")) : numeric && h8EffectiveRewardReference(value, multiplier) === null
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
                <Fact k="改后">{directionTag(value) ?? "—"}</Fact>
                <Fact k="改后怎么筛">{MODE_HELP[value] ?? MODE_HELP[rawCurrent]}</Fact>
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
                  ? "这是提交时按现在的加成算的参考值；批准时后端按那时的当月加成重算，6 位小数四舍五入。"
                  : "按现在的当月加成算，6 位小数四舍五入；加成在运营阶段设置改。"} /></span>
                {dir === "same" && <span>和现在一样也会保存一次，生效时间同样改成保存那一刻。</span>}
              </span> : undefined}>
              {(control) => <NumberInput {...control} unit={unit} min={0} max={param.max} step={param.step} disabled={locked}
                aria-label={`${param.label}基础额`} value={form.value ?? ""}
                onChange={(event) => onChange({ ...form, value: event.target.value })} />}
            </DiffField>
          );
        },
        recover: async () => { const record = currentCommand(); return record ? queryCommand(record) : false; },
        retry: async () => { const record = currentCommand(); if (!record) throw new Error("H8_ORIGINAL_RESOLVED"); await sendCommand(record, true); },
      },
      run: async (reason, _, form) => {
        ensureSession();
        const previous = currentCommand();
        if (previous) { await sendCommand(previous, true); return; }
        if (!currentRead.current.ready || currentRead.current.data !== snapshot) throw new Error("H8_OVERVIEW_REQUIRED");
        const value = storedValue(form ?? {});
        if (!h8RewardParamValid(param.key, value)) throw new Error("请填写允许范围内的基础额或选择有效模式。");
        if (h8RewardParamAmplifies(param.key, rawCurrent, value)) {
          await sendCommand(approvalCommand(value, reason), false);
          return;
        }
        const actor = requireH8Actor(session.adminId, "param");
        const operator = actor.operator || actor.username;
        const record = createH8RewardCommand(session.adminId, { kind: "direct", paramKey: param.key, value, reason, operator,
          overview: snapshot, body: JSON.stringify({ key: param.key, value, expectedVersion, reason, operator }) });
        try { await sendCommand(record, false); }
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

  const settle = (invitedUserId?: number, recovered?: H8RewardCommand, lookupOnly = false) => {
    setStale(null);
    if (!session) return;
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
    const currentCommand = () => pendingH8RewardCommands(session.adminId).find(r => r.kind === "settlement");
    const rewards = snapshot?.effectiveRewards;
    const usdtDecimals = decimalsOf(rewards?.["newcomer.usdt"]);
    const uvtDecimals = decimalsOf(rewards?.["newcomer.nex"], rewards?.["inviter.nex"]);
    const loaded = targeted ? snapshot?.recentSettlements.find((row) => row.invitedUserId === invitedUserId) : undefined;
    const proposeBlock = withdrawalApprovalDisabledReason(session?.authorities ?? []);
    const settleFacts = (value?: string) => {
      const limit = targeted ? 1 : Math.max(1, Math.min(100, Number(value) || 20));
      const pendingNow = Number(snapshot?.pending ?? 0);
      return <Facts>
        {targeted
          ? <Fact k="新人用户编号" lead>{invitedUserId}</Fact>
          : <Fact k="这一批最多" lead unit={value ? "位新人" : undefined}>{value ? countText(limit) : "—"}</Fact>}
        {targeted
          ? <Fact k="这位新人">{loaded
            ? "已结算过，不会再发一份"
            : `已读到的 ${countText(snapshot?.recentSettlements.length)} 条结算记录里没有他`}</Fact>
          : null}
        {targeted && loaded && <Fact k="原结算号"><span data-mono>{loaded.settlementNo}</span></Fact>}
        {targeted && <Fact k="这次会怎样">{loaded
          ? "他的礼包还冻结、又已经有首笔实付订单的，只解冻原礼包；否则不发"
          : "注册时间、钱包和风控状态这页查不到，批准执行时后端逐项核对；不符合就不发"}</Fact>}
        {targeted ? null
          : <Fact k="现在待结算">{countText(pendingNow)} 位，从最早注册的开始发；实际结算时还要核对钱包，可能更少</Fact>}
        <Fact k="每位新人">{amountText(rewards?.["newcomer.usdt"], usdtDecimals)} USDT + {amountText(rewards?.["newcomer.nex"], uvtDecimals)} UVT</Fact>
        <Fact k="每位邀请人">{amountText(rewards?.["inviter.nex"], uvtDecimals)} UVT，没有邀请人的不发</Fact>
        {!targeted && value && <Fact k="这一批最多发出">{timesText(rewards?.["newcomer.usdt"], limit, usdtDecimals)} USDT + {timesText(rewards?.["newcomer.nex"], limit, uvtDecimals, rewards?.["inviter.nex"])} UVT</Fact>}
        <Fact k="会冻结的">注册时标了首购冻结的，新人礼冻结到首笔实付订单；有几位页面算不出</Fact>
        <Fact k="钱从哪出">平台出钱，进新人和邀请人的钱包，记进资金账本</Fact>
        <Fact k="谁来批准">{SETTLE_APPROVER}（需有审批批准权限和邀请奖励结算权限）</Fact>
        {proposeBlock && <Fact k="你的权限" tone="warn">这个账号没有发起审批的权限，提交会被拒绝；请有权限的同事发起</Fact>}
      </Facts>;
    };
    openConfirm({ briefKind: "funds",
    action: targeted ? "给指定新人结算邀请奖励" : "结算邀请奖励",
    title: targeted ? "给指定新人结算" : "批量结算邀请奖励",
    detail: targeted
      ? `只结算新人 ${invitedUserId}；不符合条件就不发，也不会改发给别人。已结算、礼包还冻结又已有首笔实付订单的，这次只解冻原礼包。`
      : "按注册先后找出生效时间起注册、还没结算、没被风控拦下的新人，有没有邀请人都算。",
    effect: <><StatusTag tone="progress" filled explain={`${SETTLE_APPROVER}在「操作记录与审批」批准后才发，批准前什么都不发。批准时按那时的名单发；奖励配置在这期间变了，要重新提交。`}>批准后执行</StatusTag><IrreversibleTag /></>,
    statedBrief: {
      impact: targeted ? "批准后给这位新人和他的邀请人发奖励，发出去不能撤回。" : "批准后按注册先后给这一批新人和他们的邀请人发奖励，发出去不能撤回。",
      check: "核对人数和每位金额；理由写清结算依据或工单号。",
    },
    facts: settleFacts,
    coverageLead: "结算会真的给用户发钱",
    coverageCheck: "提交审批时不检查兑付覆盖率；批准后、真正入账前后后端各检查一次，低于红线整批不发。",
    confirmLabel: "提交结算审批",
    confirmTone: "danger",
    getPendingReason: () => { const o = currentCommand()?.original; return o && o.kind !== "direct" ? o.request.reason : undefined; },
    inlineApproval: {
      pending: !!pending, initialRecovery: pending && lookupOnly ? "lookup" : "retry", expired: !!pending && !canRetryH8RewardCommand(pending),
      disabledReason: pending && canRetryH8RewardCommand(pending) && !canSettle ? displayAdminError(new Error("ACCESS_DENIED")) : undefined,
      resolve: () => undefined,
      recover: async () => { const record = currentCommand(); return record ? queryCommand(record) : false; },
      retry: async () => { const record = currentCommand(); if (!record) throw new Error("H8_ORIGINAL_RESOLVED"); await sendCommand(record, true); },
    },
    reasonPlaceholder: "例如：本周新人礼例行结算、工单号",
    amplifies: true,
    edit: targeted ? undefined : { kind: "number", label: "这一批最多结算", current: "20", currentLabel: "默认", ...(original ? { initialValue: String(original.limit) } : {}), unit: "位", min: 1, max: 100, step: 1, hint: "1–100 位，填了才能提交；按注册先后从最早的开始" },
    run: async (reason, value) => {
      const previous = currentCommand();
      if (previous) { await sendCommand(previous, true); return; }
      if (!currentRead.current.ready || currentRead.current.data !== snapshot || !snapshot.enabled) throw new Error("H8_OVERVIEW_REQUIRED");
      // The legacy empty field was never submittable. Keep its fallback and exact limit body.
      const limit = targeted ? 1 : Math.max(1, Math.min(100, Number(value) || 20));
      const def = targeted ? findHighOp("h8_referral_settlement_user")! : findHighOp("h8_referral_settlement")!;
      const actor = requireH8Actor(session.adminId, "settlement");
      const request = {
        action: targeted ? "给指定新人结算邀请奖励" : "结算邀请奖励",
        obj: targeted ? `新人 ${invitedUserId}` : "待结算邀请批次",
        beforeValue: `待结算 ${Number(snapshot.pending ?? 0)} 条 · 设置版本 v${snapshot.version ?? "—"} · 第 ${snapshot.rhythmMonth ?? "—"} 个月`,
        afterValue: `${targeted ? `仅结算新人 ${invitedUserId} 的邀请奖励` : `最多结算 ${limit} 条`} · 新人 ${snapshot.effectiveRewards["newcomer.usdt"] ?? "—"} USDT + ${snapshot.effectiveRewards["newcomer.nex"] ?? "—"} UVT · 邀请人 ${snapshot.effectiveRewards["inviter.nex"] ?? "—"} UVT · 快照 ${snapshot.rewardSnapshotHash.slice(0, 12) ?? "—"}…`,
        operator: actor.operator || actor.username, operatorRole: roleLabel(actor.role),
        type: "fund" as const, amplifies: true, sos: false, roleGate: def.gateLabel, reason, sourceDomain: "H8",
        command: def.buildCommand({ limit, invitedUserId, expectedH8Version: snapshot.version,
          expectedRhythmMonth: snapshot.rhythmMonth, rewardSnapshotHash: snapshot.rewardSnapshotHash }),
        target: def.buildTarget({ limit, invitedUserId }),
      };
      await sendCommand(createH8RewardCommand(session.adminId, { kind: "settlement", overview: snapshot,
        ...(targeted ? { invitedUserId } : {}), limit, request, body: JSON.stringify(request) }), false);
    },
    });
  };

  // Recovery stays outside the overview-success branches and uses only persisted facts.
  const recoveryRows: H8RecoveryRow[] = [];
  const recoveryByKey: Record<string, ReactNode> = {};
  if (session && !mc) {
    for (const record of commands) {
      const param = [ENABLED_PARAM, ...PARAMS].find(p => p.key === record.paramKey);
      const tag = record.ticket?.status === "pending"
        ? record.kind === "param-approval" ? pendingTag() : <StatusTag tone="warn">待审批</StatusTag>
        : isRetryExpired(record) ? expiredTag(record.kind === "direct" ? "direct" : "approval") : unknownTag(record.kind === "direct" ? "direct" : "approval");
      if (param) recoveryByKey[param.key] = tag;
      const recover = (lookupOnly = false) => param ? editParam(param, param.key === "enabled" ? record.value : undefined, record, lookupOnly) : settle(undefined, record, lookupOnly);
      recoveryRows.push({
        key: record.commandKey, name: param ? paramTitle(param) : record.invitedUserId !== undefined ? "给指定新人结算" : "批量结算",
        submittedAt: record.createdAt, tag,
        change: param ? record.original
            ? <>{record.kind !== "direct" && <span className="h8-rec-kind">申请</span>}<Change from={valueText(param, String(record.original.overview.params[param.key]))} to={valueText(param, record.value)} /></>
            : <span>{record.kind === "direct" ? "改成" : "申请改成"} {valueText(param, record.value)}</span>
          : <span>{record.invitedUserId !== undefined ? `新人 ${record.invitedUserId}` : `最多 ${record.limit ?? "—"} 位`}{record.original && `（提交时 ${countText(record.original.overview.pending)} 位待结算）`}</span>,
        actions: <>
          <Button size="sm" aria-label={`查询${param ? paramTitle(param) : "结算"}的原结果`}
            onClick={() => { recover(true); }}>查询原结果</Button>
          {canRetryH8RewardCommand(record) && (record.kind === "settlement" ? canSettle : canWrite)
            && <Button size="sm" onClick={() => recover()}>按原请求重试</Button>}
          {record.kind !== "direct" && isRetryExpired(record) && !record.acknowledged
            && <Button size="sm" variant="ghost" onClick={() => setReleasing(record)}>查无此单时解除</Button>}
          {record.kind !== "param-approval" && reach("/platform/audit", "platform_a2_read")
            && <Link className="rd-link" href="/platform/audit" prefetch={false}>到操作记录与审批核对</Link>}
        </>,
      });
    }
  }
  const releasingRow = releasing && recoveryRows.find(row => row.key === releasing.commandKey);
  const recoveryNotice = <>
    <H8RecoveryNotice rows={recoveryRows} />
    {releasing && <ReleaseModal label={<>{releasingRow?.name ?? "原申请"}{releasingRow && <> · {releasingRow.change}</>}</>}
      explain={<><p>原申请已超过 24 小时，不会再重发。</p><p>确认时先按原申请再查一次：明确查不到这张审批单才解除，说明申请没建成；查到了就按它现在的状态显示，不解除。</p></>}
      onCancel={() => setReleasing(null)} onConfirm={() => {
        const record = releasing;
        setReleasing(null);
        void releaseExpiredH8RewardProposal(record)
          .then(() => { ctx.toast("已解除这条记录，可以重新提交。"); return load(); })
          .catch(cause => { ctx.toast(displayAdminError(cause)); changed(); });
      }} />}
  </>;
  const savedUnreadNotice = savedUnread && <H8SavedUnreadNotice name={paramTitle(savedUnread.param)}
    value={valueText(savedUnread.param, savedUnread.value)} reloading={loading} hasData={!!data} onReload={() => void load("", false, true)} />;
  const staleNotice = stale && data && <Notice tone="warn" title={`没有保存：${stale.param ? paramTitle(stale.param) : "结算申请"}已被别人改过`}
    action={<Button size="sm" variant="ghost" onClick={() => setStale(null)}>知道了</Button>}>
    {stale.param
      ? <>现在是 {valueText(stale.param, String(data.params[stale.param.key]))}，你这次要改成 {valueText(stale.param, stale.value)}。核对后重新调整。</>
      : "奖励配置或当月加成已变化，页面已读到最新值；核对后重新提交结算。"}
  </Notice>;

  const confirmModal = mc && (
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
      statedBrief={mc.statedBrief}
      coverageLead={mc.coverageLead}
      coverageCheck={mc.coverageCheck}
      reasonPlaceholder={mc.reasonPlaceholder}
      inlineApproval={mc.inlineApproval}
      reasonMin={mc.inlineApproval ? mc.reasonMin : undefined}
      reasonMax={mc.inlineApproval ? mc.reasonMax : undefined}
      getPendingReason={mc.inlineApproval ? mc.getPendingReason : undefined}
      getPendingBusinessValue={mc.getPendingBusinessValue}
      completionCopy={mc.inlineApproval ? mc.completionCopy : undefined}
      onClose={() => setMc(null)}
      onConfirm={async (reason, newValue, businessValue) => {
        try {
          await mc.run(reason, newValue, businessValue);
          setMc(null);
        } catch (failure) {
          ctx.toast(failure instanceof Error ? displayAdminError(failure) : "操作失败");
          throw failure;
        }
      }}
    />
  );

  const header = <PageHeader pageId="H8" title="新人礼与邀请奖励"
    summary="新人礼和邀请奖励发多少、怎么发、结算到哪一步。"
    readOnly={!canWrite && !canSettle ? "只读：可以查看奖励和结算记录，不能改奖励、不能结算" : undefined} />;

  if (loading && !data) return <>
    {header}
    <Conclusion state="unknown">正在读取奖励设置和结算情况…</Conclusion>
    {recoveryNotice}
    {savedUnreadNotice}
    <BlockState state="loading" title="正在读取新人礼与邀请奖励…" />
    {confirmModal}
  </>;
  if (!data) return <>
    {header}
    <Conclusion state="unknown">读不到奖励设置，现在判断不了奖励开没开、有多少在等结算</Conclusion>
    {recoveryNotice}
    {savedUnreadNotice}
    <BlockState state="error" title="新人礼与邀请奖励读取失败"
      detail={<>页面不显示任何旧数据。<Explain label="失败原因" content={error ?? "没有收到数据。"} /></>}
      retryLabel="重新加载" onRetry={() => void load()} />
    {confirmModal}
  </>;

  const targetUserId = Number(invitedUserIdInput.trim());
  const targetUserValid = /^[1-9]\d*$/.test(invitedUserIdInput.trim()) && Number.isSafeInteger(targetUserId);
  const submitTarget = conflictDraft.register("settle:target", () => settle(targetUserId));
  const zone = businessZone().label;
  const effectiveAtText = formatBusinessTimeFull(data.effectiveAt, "—");
  const gateUnset = Date.parse(data.effectiveAt) === 0;
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

  const originalCount = recoveryRows.length;
  const conclusion = originalCount > 0
    ? <Conclusion state="warn" icon={Hourglass} hint="在下面逐条核对，有结论后再改这一项。">有 {originalCount} 项修改或结算申请还没有结论</Conclusion>
    : !data.enabled
      ? <Conclusion state="neutral" icon={Power}
          hint={canWrite ? "要开启，点「开关和发放方式」里的「启用」提交审批。" : undefined}
          explain="停用期间 App 不显示奖励金额，新的结算不发；已冻结的新人礼首笔实付后照常解冻。待结算照常统计。">
          奖励已停用：新注册的不发新人礼，邀请人也不发奖励</Conclusion>
      : allZero
        ? <Conclusion state="warn" hint={canWrite ? "在「每位发多少」里调整基础额。" : undefined}
            explain="三项实际发放都是 0 时，后端拒绝结算。">奖励开着，但三项金额都是 0，现在结算会被拒绝</Conclusion>
        : pending > 0
          ? <Conclusion state="warn" icon={ListChecks}
              hint={canSettle ? "点「结算」里的「批量结算」提交审批，另一位管理员批准后才发。" : "结算要由有邀请奖励结算权限的同事发起。"}
              explain="待结算是按注册资格统计的，实际结算时还要核对钱包，可能少于这个数。不会自动结算。">
              奖励开着，有 {countText(pending)} 位新人等待结算</Conclusion>
          : <Conclusion state="ok" explain="待结算是按注册资格统计的，实际结算时还要核对钱包。">奖励开着，没有等待结算的注册</Conclusion>;

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
        explain={`实际发放 = 基础额 × 第 ${data.rhythmMonth} 月${multiplierName}，6 位小数四舍五入。这是一份奖励的配置额，不是某个用户已经到账的钱。${param.key === "inviter.nex" ? "新人没有有效邀请人时，这一份不发。" : ""}`}>
        <div className="h8-formula" aria-label={`基础额 ${amountText(base, decimals)} ${param.unit} 乘 ${multiplierName} ${multiplierText(multiplier)}`}>
          <span className="h8-formula-term"><small>基础额</small><Amount value={base} unit={param.unit} decimals={decimals} /></span>
          <span className="h8-formula-term"><small>第 {data.rhythmMonth} 月{multiplierName}</small><b>{multiplierText(multiplier)}</b></span>
        </div>
        <div className="h8-card-foot">
          <span className="h8-dir">{recoveryByKey[param.key] ?? "调高要批准 · 调低立即生效"}</span>
          {canWrite && <Button size="sm" aria-label={`调整${param.label}基础额`} disabledReason={freshBlocked} onClick={conflictDraft.register(`param:${param.key}`, () => editParam(param))}>调整</Button>}
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

      <StatBand fit label="结算情况">
        <Stat lead icon={UserPlus} tone="role-3" label="等待结算" value={countText(pending)} unit="位"
          explain="生效时间起注册、还没结算、也没被风控拦下的新人，有没有邀请人都算。待结算是按注册资格统计的，实际结算时还要核对钱包，可能少于这个数。奖励停用时照样统计，但不能结算。" />
        <Stat icon={ShieldAlert} tone="role-3" label="被风控拦下" value={countText(data.blockedByK2)} unit="位"
          explain={<>
            <p>生效时间起注册、还没结算的新人里，被风控拦下、不会给他们结算的：K2「拦截新人礼」、账户或账户组被标记、冻结的。</p>
            <p>发放方式是「先过风险检查再发」时，命中待复核风险的也算在这里。改发放方式会把生效时间改成那一刻，这些人注册在前，不会因此转到等待结算。</p>
          </>} />
        <Stat icon={Check} tone="role-3" label="已结算" value={countText(data.settled)} unit="位"
          explain="历史上全部已结算的新人，不分时间。已结算不等于新人已经拿到可以提现的钱：新人礼可能还冻结到首笔实付订单，进钱包后也按收益规则分到可提现、待审核或锁定。" />
      </StatBand>

      <Panel title="每位发多少" icon={Gift} tone="role-4" sub={`第 ${data.rhythmMonth} 月加成`}
          explain="新人两项乘运营阶段设置里当月的新用户加成，邀请人一项乘当月的邀请加成。加成换月或在运营阶段设置被改后，实际发放跟着变。"
          actions={phaseHref ? <Link className="rd-link" href="/growth/phase" prefetch={false}>去运营阶段设置看加成</Link> : undefined}>
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
                disabledReason={freshBlocked} onClick={conflictDraft.register("param:enabled", () => editParam(ENABLED_PARAM, String(!data.enabled)))}>{data.enabled ? "停用" : "启用"}</Button> : undefined} />
            <ConfigRow name="发放方式"
              what="结算时怎么过风控"
              when={`改成「符合资格就直接发」要${APPROVER}批准；改回确认后立即保存`}
              effect={MODE_HELP[String(data.params["newcomer.lockMode"])]}
              note="两种方式都保留首购冻结；已冻结的礼包按当初的方式解冻。"
              value={<span className="h8-row-value">{modeLabel}{recoveryByKey["newcomer.lockMode"]}</span>}
              action={canWrite ? (describedBy) => <Button size="sm" aria-describedby={describedBy} disabledReason={freshBlocked} onClick={conflictDraft.register("param:mode", () => editParam(MODE_PARAM))}>调整</Button> : undefined} />
            <ConfigRow name="生效时间"
              what="这个时间起（含这一刻）注册的新人才进入结算"
              effect="改金额、改发放方式（含和现在一样的保存）和启用批准后，都改成那一刻；之前注册、还没结算的不再自动结算。停用不改它"
              value={gateUnset
                ? <span className="h8-time" title={`后端原值 ${data.effectiveAt}`}>未设置<small>所有注册都算</small></span>
                : <span className="h8-time" title={`${effectiveAtText}（${zone}）`}>{formatBusinessTimeCompact(data.effectiveAt, "—")}<small>{zone}</small></span>} />
          </ConfigList>
        </Panel>

      <Panel title="结算" icon={Route} tone="role-3" sub={`待结算 ${countText(pending)} 位`}
        explain="不会自动结算。批量和指定新人两种结算都只提交审批，另一位管理员批准后才发；同一时间只能有一张结算审批单。"
        actions={canSettle ? <Button variant="primary" disabledReason={freshBlocked ?? settleBlock} onClick={conflictDraft.register("settle:batch", () => settle())}>批量结算</Button> : undefined}>
        <RewardFlow gateUnset={gateUnset} pending={`${countText(pending)} 位`} blocked={`${countText(data.blockedByK2)} 位`} settled={`${countText(data.settled)} 位`} mode={modeLabel} />
        <div className="h8-settle-foot">
          {canSettle ? (
            <form className="h8-target" onSubmit={(event) => { event.preventDefault(); if (readReady && data.enabled && targetUserValid) submitTarget(); }}>
              <Field label="给指定新人结算" explain="只结算这一位：不符合条件就不发，也不会改发给别人。已结算、礼包还冻结又已有首笔实付订单的，这次只解冻原礼包。">
                {(control) => <Input {...control} inputMode="numeric" placeholder="新人用户编号" aria-label="指定结算的新人用户编号"
                  value={invitedUserIdInput} onChange={(event) => setInvitedUserIdInput(event.target.value)} />}
              </Field>
              <Button type="submit" disabledReason={freshBlocked ?? (!data.enabled ? "奖励已停用，不能结算" : !targetUserValid ? "先填一个正确的新人用户编号" : undefined)}>给这位新人结算</Button>
            </form>
          ) : <p className="h8-muted">结算要由有邀请奖励结算权限的同事发起。</p>}
          {latest && <p className="h8-latest">{<>最近一次结算：新人 {latest.invitedUserId}，{amountText(latest.newcomerUsdt, rowUsdtDecimals)} USDT + {amountText(latest.newcomerNex, rowUvtDecimals)} UVT{latest.inviterUserId === undefined ? "，没有邀请人" : `，邀请人 ${latest.inviterUserId} 得 ${amountText(latest.inviterNex, rowInviterDecimals)} UVT`}</>}</p>}
        </div>
      </Panel>

      <Panel title="结算记录" icon={ListChecks} tone="role-3" sub={`已读 ${countText(data.recentSettlements.length)} 条`} flush
        explain="每位新人一条，最新在上。这里看不到礼包冻结没有、是哪一批、谁批的：审批单到「操作记录与审批」，钱包和账本到「账本与账单核对」。">
        <Table label="结算记录" className="h8-records">
          <colgroup><col className="h8-col-no" /><col className="h8-col-user" /><col className="h8-col-user" /><col className="h8-col-gift" /><col className="h8-col-invite" /><col className="h8-col-state" /></colgroup>
          <thead><tr><Th>结算号</Th><Th>新人</Th><Th>邀请人</Th><Th align="right">新人奖励</Th><Th align="right">邀请人奖励</Th><Th>状态</Th></tr></thead>
          <tbody>
            {data.recentSettlements.map((row, index) => (
              <Tr key={row.settlementNo ?? index}>
                <Td><span className="h8-no" title={row.settlementNo}><span className="h8-no-head">{row.settlementNo?.slice(0, -8) ?? "—"}</span><span className="h8-no-tail">{row.settlementNo?.slice(-8)}</span></span></Td>
                <Td>{row.invitedUserId ?? "—"}</Td>
                <Td>{row.inviterUserId ?? <span className="h8-muted">没有邀请人</span>}</Td>
                <Td align="right"><span className="h8-pair"><Amount value={row.newcomerUsdt} unit="USDT" decimals={rowUsdtDecimals} /><Amount value={row.newcomerNex} unit="UVT" decimals={rowUvtDecimals} /></span></Td>
                <Td align="right"><Amount value={row.inviterNex} unit="UVT" decimals={rowInviterDecimals} /></Td>
                <Td><StatusTag tone="done" icon={Check}>{row.status === "SETTLED" ? "已结算" : "—"}</StatusTag></Td>
              </Tr>
            ))}
            {!data.recentSettlements.length && <TableMessage columns={6}>{pending > 0
              ? !data.enabled ? `还没有结算记录。有 ${countText(pending)} 位等待结算，奖励停用期间不能结算。`
                : canSettle ? `还没有结算记录。有 ${countText(pending)} 位等待结算，可以在上面「结算」里提交批量结算审批。`
                  : `还没有结算记录。有 ${countText(pending)} 位等待结算，要由有结算权限的同事发起。`
              : "还没有结算记录，也没有等待结算的注册。"}</TableMessage>}
          </tbody>
        </Table>
        {error && <div className="h8-more-error"><Notice tone="danger" title="更早的记录没读到">已读到的记录还在，列表还不完整。<Explain label="失败原因" content={error} /></Notice></div>}
        {(data.settlementHasMore || auditHref || eventsHref || ledgerHref) && (
          <div className="h8-records-foot">
            {data.settlementHasMore && <Button size="sm" loading={loadingMore} loadingText="读取中…" onClick={() => void load(data.settlementNextCursor, true)}>{error ? "重试读取更早记录" : "读取更早记录"}</Button>}
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

/** 每位金额 × 人数（可再加一项每位金额），按微单位整数算，不经过浮点。 */
function timesText(per: string | number | undefined, count: number, decimals: number, extra?: string | number) {
  const units = (raw: string | number | undefined) => {
    const parts = amountParts(raw);
    return parts ? BigInt(parts.int) * BigInt(1000000) + BigInt((parts.frac + "000000").slice(0, 6)) : null;
  };
  const a = units(per), b = extra === undefined ? BigInt(0) : units(extra);
  if (a === null || b === null) return "—";
  const total = (a + b) * BigInt(count);
  return amountText(`${total / BigInt(1000000)}.${String(total % BigInt(1000000)).padStart(6, "0")}`, decimals);
}

/** 生效时间的写法：后端的初始值 1970-01-01T00:00:00Z 表示从没设过，所有注册都算（迁移种子；SQL 按 created_at ≥ 生效时间）。 */
function gateText(effectiveAt: string) {
  return Date.parse(effectiveAt) === 0 ? "未设置（所有注册都算）" : `${formatBusinessTimeCompact(effectiveAt, "—")}（${businessZone().label}）`;
}

function valueText(param: H8Param, value: string | undefined) {
  if (value === undefined) return "—";
  if (param.key === "enabled") return ENABLED_LABELS[value] ?? "—";
  if (param.key === "newcomer.lockMode") return LOCK_MODE_LABELS[value] ?? "—";
  return `${amountText(value)} ${param.unit}`;
}
