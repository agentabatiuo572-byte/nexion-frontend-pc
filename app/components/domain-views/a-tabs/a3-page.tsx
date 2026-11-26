"use client";
import { eCommandClosureOffer } from "@/lib/admin/e-command-investigation";

/**
 * A3 系统配置（改版）。五块各读各的、各存各的，没有「一次保存全页」：
 * 开关与门槛（W01 维护公告、W02 两项平台参数）、业务日历（W03/W04）、App 分享与下载（W05）、
 * 说明内容（W06 开发者文档、W07 六类业务说明）、应急与运行（只读，处置去 J1/J2）。
 * 页签藏起来的块照样挂着：首次进页五块都读，切页签不丢没保存的修改。
 * 七个写入口共用完整原请求存储；未知记录独立于读取状态，恢复只使用原请求。
 * 全部写操作不走审批：确认按钮写动作本身，影响全平台的几项用危险样式。
 */
import { useCallback, useEffect, useState, useRef, type ReactNode } from "react";
import Link from "next/link";
import { Activity, Ban, CalendarClock, CircleHelp, CircleOff, Copy, Gauge, Hourglass, Megaphone, RefreshCw, ShieldAlert, ShieldCheck, Siren, SlidersHorizontal, ToggleLeft, TriangleAlert, type LucideIcon } from "lucide-react";
import { BlockState, Button, ConfigList, ConfigRow, Conclusion, Explain, Fact, Facts, IconButton, Notice, PageHeader, PageTabs, Panel, Stat, StatBand, StatusTag, TodoItem, TodoList, useTabIds, type StateTone } from "@/app/components/rd";
import { useVerifiedRelease, VerifiedReleaseButton } from "../verified-release";
import { useReach } from "@/lib/nav/use-reach";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import { a3ContentVersionConflict, a3Deduplicates, a3HasOriginalReceipt, isA3ContentCommand, useA3Commands, type A3Command, type A3ContentComparison } from "@/lib/admin/a3-mutations";
import { fetchBusinessCalendar } from "@/lib/admin/business-calendar-client";
import { fetchPlatformExperienceConfig } from "@/lib/admin/platform-experience-client";
import { businessClock, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { toast as notify } from "@/lib/store/ui";
import {
  fetchA3Overview,
  type A3FeatureFlag,
  type A3KillSwitch,
  type A3Overview,
  type A3PlatformParam,
  type A3SystemHealth,
} from "@/lib/admin/a3-client";
import { GRecoveryNotice, expiredTag, unknownTag, type GRecoveryRow } from "../g-tabs/g-recovery";
import { FundClosureModal, fundRecoveryStatus } from "../fund-command-check";
import { SETTLED_REJECTED, foundReceiptNext, pendingReplayReason, receiptCodeTech, receiptFact, receiptOf, receiptRejected } from "../recovery-panel";
import { canInvestigateECommand } from "@/lib/admin/e-command-investigation";
import type { FundCommandEvidence, FundInvestigationOutcome } from "@/lib/admin/fund-command-investigation";
import type { ACtx } from "./types";
import { A3Calendar, type A3CalendarSummary } from "./a3-calendar";
import { A3Experience } from "./a3-experience";
import { AppVersionManager } from "./app-version-manager";
import { A3Content, type A3ContentSummary } from "./a3-content";
import type { A3ContentRead, A3ContentReads, ContentCommand } from "./a3-content-editor";

type TabKey = "switches" | "calendar" | "experience" | "content" | "status";
type OriginalOutcome = FundInvestigationOutcome & { rejectionReason?: string; readError?: string; conclusion?: string };

function contentFailure(reason?: string) {
  if (a3ContentVersionConflict(reason)) return "原操作没有保存：内容版本已变。";
  return reason ? `原操作没有保存。${displayAdminError(reason)}` : "原操作没有保存。";
}

function contentReadFailure(outcome: OriginalOutcome) {
  const receipt = receiptOf(outcome);
  if (outcome.conclusion === "not-executed" || receipt?.originalStatus === "CONFIRMED_NOT_EXECUTED") return "核查确认原操作未执行。";
  if (receipt?.originalStatus === "CONFIRMED_REJECTED" || receiptRejected(receipt)) return contentFailure(outcome.rejectionReason);
  return "原操作已执行。";
}

const RATE_KEY = "platform.global_rate_limit_per_minute";
const THRESHOLD_KEY = "withdrawal.strong_review_threshold_usdt";
/** 页面上的叫法：限流和 D5 的「强审门槛」统一；后端登记名进技术信息。 */
const PARAM_LABEL: Record<string, string> = { [RATE_KEY]: "全局限流", [THRESHOLD_KEY]: "提现强审门槛" };
const FLAG_LABEL: Record<string, string> = { "ops.maintenanceBanner": "维护公告横幅" };
const STATE_NAME: Record<string, string> = { on: "开启", off: "关闭" };
/** 说明内容的解除框：保存为哪种状态；后端撤下公开版后读到的是 UNPUBLISHED。 */
const SAVE_AS: Record<string, string> = { DRAFT: "草稿", PUBLISHED: "已发布", UNPUBLISHED: "已撤下公开版本" };
/** 后端 PlatformGlobalRateLimitFilter / AuthenticatedPrincipalRateLimitFilter 的分桶：长整数除法向下取整。 */
function rateBudget(limit: number) {
  return {
    perAccount: Math.max(20, Math.floor(limit / 10)),
    adminAuth: Math.max(100, Math.floor(limit / 10)),
    callback: Math.max(500, Math.floor(limit / 2)),
    health: Math.max(120, Math.floor(limit / 20)),
  };
}

function wholeNumber(value: string) {
  const parsed = /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** 整数按千分位写（数量、金额），编号不走这里。 */
function grouped(value: number) {
  return value.toLocaleString("en-US");
}

const timeText = (value: string) => formatBusinessTimeCompact(value, value && value.trim() ? value : "—");
/** 探针读数里后端写的「N 秒」换成天、小时、分钟，只改显示（和用户行为事件页「最久已等」同一写法）。 */
const metricText = (metric: string) => metric.replace(/(\d+) 秒/g, (_, raw: string) => {
  const seconds = Number(raw);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} 小时 ${minutes % 60} 分` : `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
});

function healthLabel(row: A3SystemHealth): { text: string; tone: StateTone; icon?: LucideIcon } {
  if (row.stale) return { text: "状态未知", tone: "warn", icon: CircleHelp };
  if (row.tone === "ok") return { text: "正常", tone: "ok" };
  if (row.tone === "warn") return { text: "警告", tone: "warn", icon: TriangleAlert };
  return { text: "严重异常", tone: "danger" };
}

/** J1 的开关使用业务状态，地区限制优先使用结构化计数。 */
function gateLabel(gate: A3KillSwitch): { text: string; tone: StateTone; icon?: LucideIcon } {
  if (gate.status === "enabled") return { text: "开放", tone: "ok" };
  if (gate.status === "disabled") return { text: "已关停", tone: "warn", icon: Ban };
  if (gate.status === "加载失败") return { text: "读取失败", tone: "danger" };
  const legacyCounts = gate.blockedRegionCount === undefined || gate.limitedRegionCount === undefined
    ? /^(\d+) 个地区禁止访问 · (\d+) 个地区限流$/.exec(gate.status)
    : null;
  const blocked = legacyCounts?.[1] ?? gate.blockedRegionCount;
  const limited = legacyCounts?.[2] ?? gate.limitedRegionCount;
  if (blocked !== undefined && limited !== undefined && (blocked || limited)) {
    return { text: `封锁 ${blocked} 个 · 受限 ${limited} 个`, tone: "warn", icon: Ban };
  }
  return { text: gate.status || "—", tone: gate.up ? "ok" : "warn", icon: gate.up ? undefined : Ban };
}

const HEALTH_HELP: Record<string, string> = {
  "事件待投递": "待投递和投递失败的事件条数，以及最早一条等了多久。超过 100 条或 5 分钟是警告，超过 1000 条或 1 小时是严重异常；有「查看用户资料」事件对不上操作记录时，直接算严重异常。",
  "资金账本可读性": "最近 24 小时账本记录能不能读、查一次用了多久。超过 200 毫秒是警告，超过 1 秒是严重异常。只说明能读，不代表对账一致。",
  "数据库时钟偏差": "数据库时间和后台服务时间差多少。超过 1 秒是警告，超过 5 秒是严重异常。",
  "后台服务 JVM": "当前这台后台服务已运行多久、内存用了多少。超过 85% 是警告，超过 95% 是严重异常。只代表这一台，不是整个集群。",
};

/** 查不到原结果、已过 24 小时：不能再说「24 小时内可以重试」。 */
const CURRENT_ONLY_EXPIRED = "已重新读取。现在的值证明不了原操作的结果，原记录继续保留；已超过 24 小时，不能再重试，请到操作记录与审批核对。";

export function A3Page({ ctx }: { ctx: ACtx }) {
  const reach = useReach();
  const { toast, openActionConfirm } = ctx;
  const session = useAdminAuth((s) => s.session);
  const operator = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "");
  const [overview, setOverview] = useState<A3Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutating, setMutating] = useState<string | null>(null);
  const [readAt, setReadAt] = useState("");
  const [calendar, setCalendar] = useState<A3CalendarSummary | null>(null);
  const [content, setContent] = useState<A3ContentSummary | null>(null);
  const [calendarNonce, setCalendarNonce] = useState(0);
  const [tab, setTab] = useState<TabKey>("switches");
  const [versionManager, setVersionManager] = useState(false);
  useEffect(() => {
    const syncLocation = () => {
      const hash = window.location.hash;
      setVersionManager(hash === "#app-versions");
      if (hash === "#app-versions" || hash === "#a3-installer") setTab("experience");
      if (hash === "#app-versions" || hash === "#a3-installer") requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView());
    };
    syncLocation();
    window.addEventListener("hashchange", syncLocation);
    return () => window.removeEventListener("hashchange", syncLocation);
  }, []);
  const ids = useTabIds();
  const commands = useA3Commands();
  const [recovery, setRecovery] = useState<A3Command | null>(null);
  const [experienceNonce, setExperienceNonce] = useState(0);
  const [querying, setQuerying] = useState<string | null>(null);
  /** 最近一次原回执查询结果，也用于过期后的核查结案。 */
  const [originalOutcomes, setOriginalOutcomes] = useState<Record<string, OriginalOutcome>>({});
  const [originalClosing, setOriginalClosing] = useState<A3Command | null>(null);
  const [checks, setChecks] = useState<Record<string, A3ContentComparison>>({});
  const [contentReads, setContentReads] = useState<A3ContentReads>({});
  const [handoffErrors, setHandoffErrors] = useState<Record<string, string | undefined>>({});
  const [releaseReadErrors, setReleaseReadErrors] = useState<Record<string, string | undefined>>({});
  const verifiedRelease = useVerifiedRelease(toast);
  const dropCheck = (key: string) => setChecks(({ [key]: _, ...rest }) => rest);
  const onRecovered = useCallback(() => setRecovery(null), []);
  const showCurrentContent = (kind: "docs" | "how", value: A3ContentRead["value"], failed?: A3ContentRead["failed"], afterApply?: () => void) => {
    const key = failed?.record.commandKey;
    const clearHandoff = () => {
      setContentReads(current => current[kind]?.onExpired === clearHandoff ? { ...current, [kind]: undefined } : current);
      if (key) setHandoffErrors(current => ({ ...current, [key]: undefined }));
    };
    const applied = () => {
      clearHandoff();
      afterApply?.();
    };
    const read: A3ContentRead = { value, failed, onApplied: applied, onExpired: clearHandoff,
      onFailed: key ? reason => setHandoffErrors(current => ({ ...current, [key]: reason })) : undefined };
    setContentReads(current => ({ ...current, [kind]: read, selected: kind }));
  };
  const retryHandoff = (record: ContentCommand) => {
    const kind = record.original.kind;
    setHandoffErrors(value => ({ ...value, [record.commandKey]: undefined }));
    setContentReads(value => value[kind] ? { ...value, [kind]: { ...value[kind]! }, selected: kind } : value);
  };
  const overviewReady = useRef(false);
  const current = useRef({ overview, session });
  current.current = { overview, session };


  const refreshOverview = useCallback(async (quiet = false) => {
    overviewReady.current = false;
    if (!quiet) setLoading(true);
    setLoadError(null);
    try {
      const next = await fetchA3Overview();
      current.current = { ...current.current, overview: next };
      setOverview(next);
      overviewReady.current = true;
      setReadAt(businessClock(Date.now()));
      return true;
    } catch (error) {
      if (!quiet) setOverview(null);
      setLoadError(displayAdminError(error));
      return false;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshOverview();
  }, [refreshOverview]);

  const gates = overview?.killSwitches ?? [];
  const featureFlags = overview?.featureFlags ?? [];
  const systemHealth = overview?.systemHealth ?? [];
  const platformParams = overview?.platformParams ?? [];
  const canWriteExperience = session?.role === "superadmin" || session?.authorities?.includes("platform_a3_write") === true;
  const anyWrite = canWriteExperience || session?.role === "superadmin" || featureFlags.some((flag) => flag.writable) || platformParams.some((param) => param.writable);

  /* ────────────────── W01 切换功能开关 ────────────────── */

  const consumerLabel = (value: string) => ({
    "ops-console-shell": "后台全局维护公告", "PlatformGlobalRateLimitFilter": "全平台请求频率限制",
    "D2 AppWithdrawalService + B1/B5 withdrawal projection": "提现加强审核及资金风险统计", "SupportLeaderboardService": "客服业绩榜刷新",
  } as Record<string, string>)[value] ?? value;
  const flagChg = (f: A3FeatureFlag, original?: A3Command) => {
    if (!original && (!overviewReady.current || commands.find(`flag:${f.key}`))) return;
    const cur = f.status;
    const name = FLAG_LABEL[f.key] ?? f.name;
    openActionConfirm({ briefKind: "config",
      action: `切换功能开关 · ${f.name}`,
      title: `切换${name}`,
      detail: <>{name}：后台顶部的维护提示条，只影响后台，不影响 App 用户。</>,
      amplifies: false,
      reasonMax: 200,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: "确认修改",
      statedBrief: { impact: f.key === "ops.maintenanceBanner" ? "保存后后台顶部的维护提示随之显示或收起；有本页查看权限的账号在打开页面或重新读取时看到。" : `影响 ${consumerLabel(f.consumer)}。`, check: "核对要切成开启还是关闭，理由写清维护时段或依据。" },
      facts: <Facts>
        <Fact k="影响谁">{f.key === "ops.maintenanceBanner" ? "有「系统配置」查看权限的后台账号" : f.scope}</Fact>
        <Fact k="最近变更">{timeText(f.lastChange)}</Fact>
      </Facts>,
      initialReason: original?.reason,
      getPendingReason: () => commands.find(`flag:${f.key}`)?.reason,
      edit: { kind: "select", current: cur, initialValue: original?.original.kind === "flag" ? original.original.value : undefined, options: f.allowedValues, optionLabels: STATE_NAME, disallowCurrent: true },
      run: async (reason, v) => {
        const val = (v || "").trim();
        if (!f.allowedValues.includes(val)) {
          const copy = "所选状态不可用，请刷新页面后重试。";
          toast(copy);
          throw new Error(copy);
        }
        const retained = commands.find(`flag:${f.key}`);
        const latest = current.current.overview?.featureFlags.find(row => row.key === f.key);
        if (!retained && (!overviewReady.current || !current.current.overview?.featureFlags.find(row => row.key === f.key)?.writable
          || !(current.current.session?.role === "superadmin" || current.current.session?.authorities?.includes("platform_a3_write")))) throw new Error("A3_ORIGINAL_READ_REQUIRED");
        if (!retained && latest && latest.status !== cur) { flagChg(latest); throw new Error("A3_CONFLICT_RECHECK_REQUIRED"); }
        if (current.current.session?.role !== "superadmin") throw new Error("A3_FLAG_ROLE_FORBIDDEN");
        const record = retained ?? commands.capture({ original: { kind: "flag", row: f, value: val },
          path: "/api/admin/platform/config", method: "PUT", body: JSON.stringify({ kind: "flag", flagKey: f.key, value: val, expectedValue: cur, reason, operator }),
          reason, name, change: `${STATE_NAME[cur] ?? cur} → ${STATE_NAME[val] ?? val}` });
        setMutating(f.key);
        try {
          await commands.send(record, Boolean(retained));
          ctx.closeActionConfirm?.();
          window.dispatchEvent(new CustomEvent("a3:runtime-flags-changed"));
          toast(`「${name}」已切换为${STATE_NAME[record.original.kind === "flag" ? record.original.value : val] ?? val}`, "success");
          if (!await refreshOverview(true)) toast(`已保存，但页面刷新失败，正在重新加载。请不要重复提交。`, "warn");
        } catch (error) {
          if (commands.find(record.fingerprint)) { toast("原操作已保留，请在页面上方查询原操作。", "warn"); return; }
          if (!retained && (error as { reasonCode?: string }).reasonCode === "A3_FLAG_STALE") {
            overviewReady.current = false;
            if (await refreshOverview(true)) {
              const latest = current.current.overview?.featureFlags.find(row => row.key === f.key);
              if (latest) flagChg(latest);
            }
          } else if (retained) { toast(displayAdminError(error), "error"); ctx.closeActionConfirm?.(); await refreshOverview(true); }
          throw error;
        } finally { setMutating(null); }
      },
    });
  };

  /* ────────────────── W02 调整平台参数 ────────────────── */

  const paramMeaning = (param: A3PlatformParam, raw: string): ReactNode => {
    const value = wholeNumber(raw);
    if (value === null) return "填一个整数";
    if (param.key === RATE_KEY) return `改成 ${grouped(value)}：全平台普通接口每分钟合计最多 ${grouped(value)} 次，同一账号、同一类接口每分钟最多 ${grouped(rateBudget(value).perAccount)} 次，超出的请求被拒绝。`;
    if (param.key === THRESHOLD_KEY) return `改成 ${grouped(value)}：之后单笔达到 ${grouped(value)} USDT 的提现进入人工强审，不能自动过审。`;
    return `改成 ${raw}`;
  };

  const paramChg = (param: A3PlatformParam, original?: A3Command) => {
    if (!original && (!overviewReady.current || commands.find(`param:${param.key}`))) return;
    const name = PARAM_LABEL[param.key] ?? param.name;
    openActionConfirm({ briefKind: "config",
      action: `调整平台参数 · ${param.name}`,
      title: `调整${name}`,
      detail: <>{name}影响 {consumerLabel(param.consumer)}，确认后直接生效，不走审批。</>,
      amplifies: false, reasonMin: 8, reasonMax: 200,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmTone: "danger",
      confirmLabel: "确认修改",
      statedBrief: param.key === RATE_KEY
        ? { impact: "App 和后台的普通接口按新上限计数，调得太低会让正常用户被拒绝；后台登录、支付回调、健康检查的额度跟着按比例变。", check: "核对新值和单位（次/分钟），理由写清依据或工单号。" }
        : param.key === THRESHOLD_KEY
          ? { impact: "之后提交的提现按新门槛判断要不要强审，批量放行时也按当前门槛检查；已提交的提现金额不变。", check: "核对新值和单位（USDT），理由写清依据或工单号。" }
          : { impact: `影响 ${consumerLabel(param.consumer)}。`, check: "核对新值和单位，理由写清依据。" },
      facts: <Facts>
        <Fact k="影响范围">{param.key === RATE_KEY ? "App 和后台接口（登录、回调、健康检查单独计）" : param.key === THRESHOLD_KEY ? "之后提交的 USDT 提现" : consumerLabel(param.consumer)}</Fact>
        <Fact k="最近变更">{timeText(param.lastChange)}</Fact>
      </Facts>,
      initialReason: original?.reason,
      getPendingReason: () => commands.find(`param:${param.key}`)?.reason,
      edit: { kind: "number", current: param.value, initialValue: original?.original.kind === "param" ? original.original.value : undefined, min: param.min, max: param.max, unit: param.unit,
        hint: `${grouped(param.min)}–${grouped(param.max)} 的整数`, preview: (value) => paramMeaning(param, value) },
      run: async (reason, value) => {
        const normalizedValue = (value || "").trim();
        if (!/^[+-]?\d+$/.test(normalizedValue)) throw new Error("A3_PARAM_INTEGER_REQUIRED");
        const slot = `param:${param.key}`;
        const retained = commands.find(slot);
        const latest = current.current.overview?.platformParams.find(row => row.key === param.key);
        if (!retained && (!overviewReady.current || !current.current.overview?.platformParams.find(row => row.key === param.key)?.writable
          || !(current.current.session?.role === "superadmin" || current.current.session?.authorities?.includes("platform_a3_write")))) throw new Error("A3_ORIGINAL_READ_REQUIRED");
        if (!retained && latest && latest.value !== param.value) { paramChg(latest); throw new Error("A3_CONFLICT_RECHECK_REQUIRED"); }
        if (current.current.session?.role !== "superadmin") throw new Error("A3_PARAM_ROLE_FORBIDDEN");
        const record = retained ?? commands.capture({ original: { kind: "param", row: param, value: normalizedValue },
          path: "/api/admin/platform/config", method: "PUT", body: JSON.stringify({ kind: "param", flagKey: param.key, value: normalizedValue, expectedValue: param.value, reason, operator }),
          reason, name, change: `${param.value} → ${normalizedValue} ${param.unit}` });
        setMutating(param.key);
        try {
          await commands.send(record, Boolean(retained));
          ctx.closeActionConfirm?.();
          toast(`${name}已更新`, "success");
          if (!await refreshOverview(true)) toast(`已保存，但页面刷新失败，正在重新加载。请不要重复提交。`, "warn");
        } catch (error) {
          if (commands.find(slot)) { toast("原操作已保留，请在页面上方查询原操作。", "warn"); return; }
          if (!retained && (error as { reasonCode?: string }).reasonCode === "A3_PARAM_STALE") {
            overviewReady.current = false;
            if (await refreshOverview(true)) {
              const latest = current.current.overview?.platformParams.find(row => row.key === param.key);
              if (latest) paramChg(latest);
            }
          } else if (retained) { toast(displayAdminError(error), "error"); ctx.closeActionConfirm?.(); await refreshOverview(true); }
          throw error;
        } finally { setMutating(null); }
      },
    });
  };

  /** 按原号查到的结论：和资金页同一组标签和句子。 */
  const canCloseOriginal = (record: A3Command, outcome?: FundInvestigationOutcome) =>
    (isA3ContentCommand(record) ? a3HasOriginalReceipt(record) && isRetryExpired(record) : !!record.commandOrigin)
    && canInvestigateECommand("platform_a3_read") && eCommandClosureOffer(outcome, isRetryExpired(record)).conclusions.length > 0;
  const replayFeedback = (record: A3Command, outcome?: OriginalOutcome) => {
    if (!isA3ContentCommand(record)) return;
    const expired = isRetryExpired(record);
    const receipt = receiptOf(outcome);
    if (outcome?.readError) return {
      tone: "danger" as const, label: "最新内容加载失败",
      detail: `${outcome.conclusion === "succeeded" ? "原操作已执行，最新内容暂时读不到。" : contentReadFailure(outcome)}${outcome.readError}`,
      next: outcome.conclusion === "succeeded" ? "记录和修改锁保留，请重新读取。" : "记录和修改锁保留，请再次查询原操作。",
    };
    if (record.replayRejection && (!outcome || !receipt || receiptRejected(receipt))) return {
      tone: "warn" as const, label: "重试被拒", detail: a3ContentVersionConflict(record.replayRejection) ? "内容版本已变。" : displayAdminError(record.replayRejection),
      next: expired ? "已超过 24 小时，请查询原操作，由有调查权限的超级管理员核查结案。"
        : "记录和修改锁保留。请核实原操作结果，再用「核实后解除」。",
    };
    const retryFeedback = record.contentRetryFeedback;
    const queryError = outcome && "error" in outcome ? outcome.error : undefined;
    if (retryFeedback?.kind === "readback-failed" && (!outcome || queryError !== undefined)) return {
      tone: "danger" as const, label: "最新内容加载失败",
      detail: queryError === undefined ? `原操作已执行，最新内容暂时读不到。${retryFeedback.detail}` : `原操作已执行。本次查询原操作失败。${queryError}`,
      next: "记录和修改锁保留，请重新读取。",
    };
    if (!outcome && retryFeedback?.kind === "unknown") return {
      tone: "warn" as const, label: "重试结果未知", detail: displayAdminError(retryFeedback.detail),
      next: "记录和修改锁保留，请再次查询原操作。",
    };
  };
  const originalShown = (record: A3Command, outcome: OriginalOutcome) => {
    const shown = fundRecoveryStatus({ record: record.commandOrigin ? record : undefined, outcome, expired: isRetryExpired(record), canQuery: true,
      canRetry: !commands.recoveryState(record).replayBlock, canClose: canCloseOriginal(record, outcome) });
    const receipt = receiptOf(outcome);
    if (isA3ContentCommand(record)) {
      if ("error" in outcome) return { ...shown, more: outcome.error };
      if (receipt?.originalStatus === "PROCESSING" && !isRetryExpired(record)) return { ...shown, label: "还在处理" };
      if (!isRetryExpired(record) && receipt?.originalStatus === "FAILED" && receipt.locked) return { ...shown,
        line: receipt.localTransactionRollbackConfirmed
          ? "后台已确认回滚，写入仍锁定。请有调查权限的超级管理员核查。"
          : "后台尚未确认原操作是否执行，写入仍锁定。请有调查权限的超级管理员核查。" };
      if (receiptRejected(receipt) && outcome.rejectionReason) return { ...shown, more: displayAdminError(outcome.rejectionReason) };
      return shown;
    }
    const next = foundReceiptNext(receipt, canCloseOriginal(record, outcome));
    return next ? { ...shown, line: next } : shown;
  };
  const originalLine = (record: A3Command, outcome: FundInvestigationOutcome) => {
    const shown = originalShown(record, outcome);
    return `${shown.label}：${shown.line}`;
  };
  const applyContentResult = (record: A3Command, result: Awaited<ReturnType<typeof commands.queryOriginal>>) => {
    if (!isA3ContentCommand(record) || !result.current) return;
    const status = result.receipt?.originalStatus;
    const failure = result.restoreDraft ? { record, reason: contentReadFailure(result),
      closed: status === "CONFIRMED_NOT_EXECUTED" || status === "CONFIRMED_REJECTED" } : undefined;
    if (failure && !failure.closed && isRetryExpired(record)) return;
    showCurrentContent(record.original.kind, result.current, failure, () => {
      if (commands.settleContent(record) && !failure) notify.success(record.name, "原操作已执行，记录已解除。");
    });
    setRecovery(null);
    if (failure) pickTab("content");
  };
  const readExecutedContent = async (record: ContentCommand) => {
    setQuerying(record.commandKey);
    try {
      const current = await commands.readPendingContent(record);
      showCurrentContent(record.original.kind, current, undefined, () => {
        if (commands.settleContent(record)) notify.success(record.name, "原操作已执行，记录已解除。");
      });
    } catch (error) {
      setOriginalOutcomes(value => ({ ...value, [record.commandKey]: {
        receipt: receiptOf(value[record.commandKey]), conclusion: "succeeded", readError: displayAdminReadError(error),
      } }));
    } finally { setQuerying(null); }
  };
  const readRejectedReplay = async (record: ContentCommand) => {
    if (isRetryExpired(record) || !commands.releaseSnapshot(record)()) return;
    setQuerying(record.commandKey);
    setReleaseReadErrors(value => ({ ...value, [record.commandKey]: undefined }));
    try {
      const current = await commands.readPendingContent(record);
      if (isRetryExpired(record)) return;
      showCurrentContent(record.original.kind, current, { record, reason: "上次的重试被拒，已核实原操作结果。" }, () => {
        if (!isRetryExpired(record) && commands.releaseRejected(record)) {
          dropCheck(record.commandKey); commands.sync();
          toast("已解除这条记录。", "success");
        }
      });
      pickTab("content");
    } catch (error) {
      setReleaseReadErrors(value => ({ ...value, [record.commandKey]: displayAdminReadError(error) }));
    } finally { setQuerying(null); }
  };
  const queryOriginal = async (record: A3Command) => {
    setQuerying(record.commandKey);
    try {
      switch (record.original.kind) {
        case "param": case "flag": case "experience": {
          const outcome = await commands.queryOriginal(record).catch(error => ({ error: displayAdminReadError(error) } as const));
          setOriginalOutcomes(value => ({ ...value, [record.commandKey]: "error" in outcome ? outcome : { receipt: outcome.receipt } }));
          const settled = "settled" in outcome && outcome.settled;
          if (settled) {
            const status = outcome.receipt?.originalStatus;
            notify.success(record.name, status === "CONFIRMED_NOT_EXECUTED" ? "核查确认没有执行，记录已解除，可以重新发起。"
              : status === "CONFIRMED_SUCCEEDED" ? "核查确认已执行，记录已解除，不要再做一次。" : status === "CONFIRMED_REJECTED" ? SETTLED_REJECTED : "原操作已执行，记录已解除，不要再做一次。");
            ctx.closeActionConfirm?.();
          }
          if (record.original.kind === "experience") {
            await fetchPlatformExperienceConfig();
            setExperienceNonce(value => value + 1);
          } else await refreshOverview(settled);
          if (!settled && "receipt" in outcome) toast(originalLine(record, outcome), "warn");
          return;
        }
        case "schedule": case "cancel": await fetchBusinessCalendar(); setCalendarNonce(value => value + 1); break;
        case "docs": case "how": {
          if (a3HasOriginalReceipt(record)) {
            const result = await commands.queryOriginal(record).catch(error => ({ error: displayAdminReadError(error) } as const));
            setOriginalOutcomes(value => ({ ...value, [record.commandKey]: result }));
            if (!("error" in result)) applyContentResult(record, result);
            return;
          }
          dropCheck(record.commandKey);
          const result = await commands.queryContent(record);
          showCurrentContent(record.original.kind, result.current);
          setChecks(value => ({ ...value, [record.commandKey]: result.comparison }));
          pickTab("content");
          toast("已读取当前内容，原操作记录和修改锁保留。", "warn");
          return;
        }
      }
      toast(isRetryExpired(record) ? CURRENT_ONLY_EXPIRED : displayAdminError(new Error("A3_ORIGINAL_CURRENT_ONLY")), "warn");
    } catch (error) { toast(displayAdminError(error), "error"); }
    finally { setQuerying(null); }
  };
  /** Content retry publishes to the App: it runs only from the original-submission dialog's confirm button. */
  const retryContent = async (record: A3Command) => {
    if (record.original.kind !== "docs" && record.original.kind !== "how") return;
    const original = record.original;
    setMutating(record.commandKey);
    try {
      const current = await commands.send(record, true);
      setRecovery(null); dropCheck(record.commandKey);
      if (!current) return;
      // A retry of a save that already landed replays its success; a later save by someone else is then what the page shows.
      // The original save made revision + 1, so a higher current revision means the content was changed after it.
      showCurrentContent(original.kind, current, undefined, () => {
        if (!commands.settleContent(record)) return;
        toast(current.revision > original.document.revision + 1
          ? `原提交当时已经${original.mode === "PUBLISHED" ? "发布" : "保存"}；之后内容又被改过，页面显示的是现在的最新内容。`
          : original.mode === "PUBLISHED" ? original.kind === "docs" ? "开发者接口文档已发布" : "业务说明已发布" : "草稿已保存，App 读到的不变", "success");
      });
    } catch (error) {
      const saved = commands.find(record.fingerprint);
      if (saved && replayFeedback(saved)) {
        setOriginalOutcomes(({ [record.commandKey]: _, ...rest }) => rest);
      } else {
        setOriginalOutcomes(value => ({ ...value, [record.commandKey]: { error: displayAdminError(error) } }));
      }
    } finally { setMutating(null); }
  };
  const contentRetry = (record: A3Command) => !record.directContentConflict && a3HasOriginalReceipt(record) && !isRetryExpired(record)
    ? { disabledReason: mutating ? "正在提交" : pendingReplayReason(commands.recoveryState(record), "当前不能重试原操作。"),
      busy: mutating === record.commandKey, run: () => void retryContent(record) }
    : undefined;
  const recoverOriginal = async (record: A3Command) => {
    if (record.original.kind === "flag") flagChg(record.original.row, record);
    else if (record.original.kind === "param") paramChg(record.original.row, record);
    else setRecovery(record);
  };
  const legacyContentTag = (record: A3Command) => isRetryExpired(record)
    ? <StatusTag tone="neutral" icon={Hourglass} explain="原提交已超过 24 小时，不能再重试。可用「读取当前内容」核对现值，原操作记录和修改锁保留。">已过期</StatusTag>
    : <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果，可能已经保存。可用「读取当前内容」核对现值。原操作记录和修改锁保留，请到操作记录与审批核对。">结果未知</StatusTag>;
  const recoveryRows: GRecoveryRow[] = commands.pending.filter(record => !record.directContentConflict).map(record => {
    const outcome = originalOutcomes[record.commandKey];
    const feedback = replayFeedback(record, outcome);
    const contentCommand = isA3ContentCommand(record);
    const applying = contentCommand && Boolean(contentReads[record.original.kind]);
    const handoffError = handoffErrors[record.commandKey];
    const releaseReadError = releaseReadErrors[record.commandKey];
    const shown = handoffError || releaseReadError ? { tone: "warn" as const, label: "上次的内容尚未交接",
      line: "记录和修改锁保留。", more: handoffError ?? releaseReadError }
      : applying ? { tone: "progress" as const, label: "等待内容读取", line: "正在把读回结果交给编辑器，记录暂时保留。", more: undefined }
      : feedback ? { ...feedback, line: feedback.next, more: feedback.detail } : outcome && originalShown(record, outcome);
    const hasReceiptLookup = a3HasOriginalReceipt(record);
    const isCalendar = record.original.kind === "schedule" || record.original.kind === "cancel";
    const state = commands.recoveryState(record);
    const receipt = receiptOf(outcome);
    const expired = isRetryExpired(record);
    const closable = canCloseOriginal(record, outcome);
    const releaseReplayRejection = state.replayRejection && (contentCommand ? !expired : !receipt);
    const retryTransfer = contentCommand && handoffError && (!expired || contentReads[record.original.kind]?.failed?.closed);
    const knownExecuted = contentCommand && (record.contentRetryFeedback?.kind === "readback-failed" || outcome?.conclusion === "succeeded" && outcome.readError);
    const retryReason = applying ? shown?.line : mutating ? "正在提交" : querying === record.commandKey ? "正在查询原操作"
      : state.replayBlock === "replay-rejected" ? `重试被拒：${displayAdminError(new Error(state.replayRejection!))}`
      : state.replayBlock === "needs-not-found" ? receipt ? shown?.line ?? "已查到原回执，请到操作记录与审批核对。"
        : outcome && "error" in outcome ? `原操作回执加载失败。${outcome.error}` : "先查询原操作，明确查无后才能重试。"
      : pendingReplayReason(state, "当前不能重试原操作。");
    return {
    // 说明内容的版本号带种子前缀 default-，写给人看时去掉（和编辑区同一规则）。
    key: record.commandKey, name: record.name, change: contentCommand ? record.change.replace(" · default-", " · ") : record.change, submittedAt: record.createdAt,
    tag: shown ? <StatusTag tone={shown.tone} explain={[shown.line, shown.more].filter(Boolean).join(" ")}>{shown.label}</StatusTag>
      : contentCommand && !hasReceiptLookup ? legacyContentTag(record) : expired ? isCalendar ? expiredTag("direct")
        : <StatusTag tone="neutral" icon={Hourglass} explain="已超过 24 小时，不能再重试。先查询原操作；查到的，按证据核查结案。">已过期</StatusTag>
        : hasReceiptLookup ? <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果。先查询原操作，明确查无后才能重试。">结果未知</StatusTag> : unknownTag("direct"),
    actions: <>
      <Button size="sm" loading={querying === record.commandKey} disabled={applying && !handoffError || !!mutating}
        onClick={() => {
          if (retryTransfer) retryHandoff(record);
          else if (contentCommand && releaseReadError && !expired) void readRejectedReplay(record);
          else if (knownExecuted) void readExecutedContent(record);
          else void queryOriginal(record);
        }}>{retryTransfer || releaseReadError && !expired ? "重试" : knownExecuted ? "重新读取" : contentCommand && !hasReceiptLookup ? "读取当前内容" : isCalendar ? "读取当前日历" : "查询原操作"}</Button>
      {closable && <Button size="sm" variant="danger-outline" disabled={applying && !handoffError || !!querying} onClick={() => setOriginalClosing(record)}>核查结案</Button>}
      {releaseReplayRejection && !releaseReadError && <VerifiedReleaseButton disabled={applying || !!querying || !!mutating} onClick={() => verifiedRelease.ask({
        operation: record.name, target: record.change, createdAt: record.createdAt, getSnapshot: commands.releaseSnapshot(record),
        release: () => {
          if (contentCommand) {
            if (isRetryExpired(record)) return false;
            void readRejectedReplay(record);
            return "pending";
          }
          const released = commands.releaseRejected(record);
          if (released) dropCheck(record.commandKey);
          commands.sync();
          return released;
        },
      })} />}
      {a3Deduplicates(record) && !expired && <Button size="sm" disabledReason={retryReason}
        onClick={() => void recoverOriginal(record)}>按原操作重试</Button>}
      {contentCommand && hasReceiptLookup && (expired || shown)
        ? <span className="rd-note">{shown?.line ?? "已超过 24 小时，不能再重试。请查询原操作。"} {shown?.more}
          {expired && !canInvestigateECommand("platform_a3_read") && " 请联系有调查权限的超级管理员核查结案。"}</span>
        : (hasReceiptLookup && !expired || state.replayRejection) && retryReason && <span className="rd-note">{retryReason}</span>}
    </>,
  }; });

  /* ────────────────── 首屏：有没有不正常的 ────────────────── */

  const rate = platformParams.find((param) => param.key === RATE_KEY);
  const banner = featureFlags.find((flag) => flag.key === "ops.maintenanceBanner");
  const badHealth = systemHealth.filter((row) => !row.stale && row.tone === "bad");
  const warnHealth = systemHealth.filter((row) => !row.stale && row.tone === "warn");
  const staleHealth = systemHealth.filter((row) => row.stale);
  const downGates = gates.filter((gate) => !gate.up);
  const healthAbnormal = badHealth.length + warnHealth.length + staleHealth.length;

  type Issue = { key: string; tone: StateTone; title: ReactNode; sub?: ReactNode; href?: string; open?: TabKey };
  const issues: Issue[] = [];
  if (overview) {
    if (badHealth.length) issues.push({ key: "health-bad", tone: "danger", title: `系统运行状况：${badHealth.map((row) => row.name).join("、")}严重异常`, sub: "联系技术值班处理，看「应急与运行」", open: "status" });
    if (warnHealth.length) issues.push({ key: "health-warn", tone: "warn", title: `系统运行状况：${warnHealth.map((row) => row.name).join("、")}警告`, sub: "看「应急与运行」", open: "status" });
    if (staleHealth.length) issues.push({ key: "health-stale", tone: "warn", title: `${staleHealth.map((row) => row.name).join("、")}读不到，状态未知`, sub: "不按正常算，看「应急与运行」", open: "status" });
    if (banner?.status === "on") issues.push({ key: "banner", tone: "warn", title: "维护公告横幅开着", sub: "后台顶部正在显示维护提示", open: "switches" });
    if (downGates.length) issues.push({ key: "gates", tone: "warn", title: `${downGates.length} 项被紧急停用或限制：${downGates.map((gate) => gate.name).join("、")}`, sub: "在紧急停用开关、地区访问限制处理", href: reach("/emergency/kill-switch") ? "/emergency/kill-switch" : undefined });
  }
  if (recoveryRows.length) issues.push({ key: "recovery", tone: "warn", title: `${recoveryRows.length} 条原操作结果未知`, sub: "在页面上方逐条核对" });
  if (calendar?.pending) issues.push({ key: "calendar", tone: "progress", title: `业务时区已安排：${calendar.pending}`, sub: "生效前可以撤销，看「业务日历」", open: "calendar" });

  const worst: "ok" | "warn" | "danger" | "unknown" | "neutral" = !overview ? "unknown"
    : issues.some((issue) => issue.tone === "danger") ? "danger"
      : issues.some((issue) => issue.tone === "warn") ? "warn"
        : issues.length ? "neutral" : "ok";
  const conclusionText = !overview
    ? (loading ? "正在加载开关、门槛和运行状况…" : "开关、门槛和运行状况读取失败，这部分没有判断")
    : issues.length === 0 ? "系统配置：一切正常，没有要处理的事"
      : issues.length === 1 ? issues[0].title
        : <>系统配置：有 {issues.length} 件事要留意</>;

  const rateValue = rate ? wholeNumber(rate.value) : null;
  const tabLabel = (key: TabKey) => ({ switches: "开关与门槛", calendar: "业务日历", experience: "App 分享与下载", content: "说明内容", status: "应急与运行" } as const)[key];
  const pickTab = (key: TabKey) => {
    setTab(key);
    requestAnimationFrame(() => document.getElementById(ids.tab(key))?.focus());
  };

  /* ────────────────── 页签：开关与门槛 ────────────────── */

  const switchesPanel = !overview ? (
    loading ? <BlockState state="loading" title="正在加载开关和门槛…" />
      : <BlockState state="error" title="开关和门槛加载失败" detail={loadError ?? undefined} onRetry={() => void refreshOverview()} />
  ) : (
    <div className="rd-tab-stack">
      <Panel title="全平台开关" icon={ToggleLeft} tone="role-other" sub={`${featureFlags.length} 个 · 时间按${businessZone().label}`}
        explain="这里只放全平台通用的开关，各业务自己的设置在对应页面修改。只有超级管理员能切换，其他角色只能查看。">
        {featureFlags.length === 0 ? <p className="rd-note">还没有全平台开关</p> : <ConfigList label="全平台开关">
          {featureFlags.map((flag) => {
            const name = FLAG_LABEL[flag.key] ?? flag.name;
            const on = flag.status === "on";
            return <ConfigRow key={flag.key} name={name}
              what={flag.key === "ops.maintenanceBanner" ? "后台每页顶部的维护提示条" : flag.desc}
              where={flag.key === "ops.maintenanceBanner" ? "后台页面顶部，有「系统配置」查看权限的账号看得到；不影响 App" : flag.scope}
              when="保存后立即生效；其他已打开的后台页面在重新读取时显示"
              effect={flag.key === "ops.maintenanceBanner" ? "开启：后台顶部出现维护提示；关闭：提示收起" : `影响 ${consumerLabel(flag.consumer)}`}
              note={<>开关代码 {flag.key} · 谁能改：{flag.resourceOwner}</>}
              value={<StatusTag tone={on ? "warn" : flag.status === "off" ? "neutral" : "progress"} icon={on ? Megaphone : flag.status === "off" ? CircleOff : undefined}>{on ? "已开启" : flag.status === "off" ? "已关闭" : "部分开放"}</StatusTag>}
              sub={`最近变更 ${timeText(flag.lastChange)}`}
              action={flag.writable
                ? <Button size="sm" loading={mutating === flag.key} disabledReason={commands.find(`flag:${flag.key}`) ? "结果未知" : !overviewReady.current ? "正在加载" : mutating && mutating !== flag.key ? "另一项正在提交" : undefined} onClick={() => flagChg(flag)}>{on ? "关闭" : "开启"}</Button>
                : <span className="rd-note">只读</span>} />;
          })}
        </ConfigList>}
      </Panel>

      <div className="a3-params" aria-label="全平台参数">
        {[...platformParams].sort((a, b) => Number(b.key === RATE_KEY) - Number(a.key === RATE_KEY)).map((param) => {
          const name = PARAM_LABEL[param.key] ?? param.name;
          const value = wholeNumber(param.value);
          const isRate = param.key === RATE_KEY;
          const isThreshold = param.key === THRESHOLD_KEY;
          const budget = isRate && value !== null ? rateBudget(value) : null;
          return (
            <Panel key={param.key} className="a3-param" title={name} icon={isRate ? Gauge : ShieldCheck} tone={isRate ? "role-2" : "role-1"}
              explain={<>
                <p>{isRate ? "App 和后台的普通接口每分钟合计能处理多少个请求。按接口分组计数，每分钟重新计；后台登录、支付回调、健康检查各有单独的额度。" : "单笔提现达到这个金额就进人工强审。和「提现参数」里的小额免审线是两回事。"}</p>
                <p>只有超级管理员能改，不走审批。</p>
              </>}
              actions={param.writable ? <Button size="sm" loading={mutating === param.key} disabledReason={commands.find(`param:${param.key}`) ? "结果未知" : !overviewReady.current ? "正在加载" : mutating && mutating !== param.key ? "另一项正在提交" : undefined} onClick={() => paramChg(param)}>调整</Button> : <span className="rd-note">只读</span>}>
              <div className="a3-param-value" data-empty={value === null ? "" : undefined}>
                <strong>{value === null ? (param.value || "—") : grouped(value)}</strong>
                <span>{param.unit}</span>
              </div>
              <dl className="a3-meaning">
                {isRate && <>
                  <div><dt>同一账号、同一类接口</dt><dd>{budget ? `每分钟最多 ${grouped(budget.perAccount)} 次` : "—"}</dd></div>
                  <div><dt>同一 IP、同一类接口</dt><dd>{budget ? `每分钟最多 ${grouped(budget.perAccount)} 次` : "—"}
                    {budget && <Explain label="其他接口的上限" content={<>
                      <p>后台登录合计每分钟 {grouped(budget.adminAuth)} 次，支付回调 {grouped(budget.callback)} 次，健康检查 {grouped(budget.health)} 次，其余接口合计 {grouped(value ?? 0)} 次。</p>
                      <p>超出的请求被拒绝，提示请求太频繁；这个值读不到或格式不对时，全部请求暂时被拒绝。</p>
                    </>} />}</dd></div>
                </>}
                {isThreshold && <>
                  <div><dt>单笔提现达到</dt><dd>{value === null ? "—" : `${grouped(value)} USDT 进人工强审`}</dd></div>
                  <div><dt>对已提交的提现</dt><dd>金额不变，批量放行时按当前门槛再查</dd></div>
                </>}
                {!isRate && !isThreshold && <div><dt>说明</dt><dd>{param.desc || "—"}</dd></div>}
              </dl>
              <p className="a3-param-foot"><span className="rd-keep">可设 {grouped(param.min)}–{grouped(param.max)} {param.unit}</span> · <span className="rd-keep">最近变更 {timeText(param.lastChange)}（{businessZone().label}）</span></p>
            </Panel>
          );
        })}
        {platformParams.length === 0 && <Panel title="全平台参数" icon={SlidersHorizontal}><p className="rd-note">全局限流和提现强审门槛没有读到，暂时不能查看和调整</p></Panel>}
      </div>
    </div>
  );

  /* ────────────────── 页签：应急与运行（只读） ────────────────── */

  const statusPanel = !overview ? (
    loading ? <BlockState state="loading" title="正在加载应急状态和运行状况…" />
      : <BlockState state="error" title="应急状态和运行状况加载失败" detail={<>{loadError} 读不到时不能当作正常。</>} onRetry={() => void refreshOverview()} />
  ) : (
    <div className="rd-tab-stack">
      <Panel title="紧急停用和地区限制" icon={Siren} tone="role-other" sub={`${gates.length} 项 · 只读`}
        explain={<>
          <p>这里只显示「紧急停用开关」和「地区访问限制」的当前状态，要关停、恢复或改名单请到右上角的页面。</p>
          <p>地区限制：封锁和受限名单都空着才算「没有限制」。风险披露的重新确认不在这里，请到「风险披露」查看。</p>
        </>}
        actions={<span className="rd-row-actions">
          {reach("/emergency/kill-switch") && <Link className="rd-link" href="/emergency/kill-switch" prefetch={false}>去紧急停用开关 →</Link>}
          {reach("/emergency/geo-block", "emergency_j2_read") && <Link className="rd-link" href="/emergency/geo-block" prefetch={false}>去地区访问限制 →</Link>}
        </span>}>
        {gates.length === 0 ? <p className="rd-note">没有读到应急开关</p> : <ul className="a3-gates" aria-label="应急开关状态">
          {gates.map((gate) => {
            const state = gateLabel(gate);
            return <li key={gate.key} data-down={gate.up ? undefined : ""}>
              <span className="a3-gate-name">{gate.name}</span>
              <StatusTag tone={state.tone} icon={state.icon}>{state.text}</StatusTag>
              <span className="a3-gate-meta">{/^\d{4}-\d{2}-\d{2}T/.test(gate.lastChange) ? timeText(gate.lastChange) : gate.lastChange ? gate.lastChange.split(" · ").map((part, index) => <span key={index} className="rd-keep">{index > 0 && " · "}{part}</span>) : "—"}</span>
            </li>;
          })}
        </ul>}
      </Panel>

      <Panel title="系统运行状况" icon={Activity} tone="role-other" sub={`${systemHealth.length} 项 · 时间按${businessZone().label}`}
        explain="每次读取本页时现查。出现异常请联系技术值班；资金异常请到「资金储备与应付款」查看。这里不会自动通知或建工单。">
        {systemHealth.length === 0 ? <p className="rd-note">没有读到运行状况，不能当作正常</p> : <ul className="a3-health" aria-label="系统运行状况">
          {systemHealth.map((row) => {
            const state = healthLabel(row);
            return <li key={row.name} data-tone={state.tone}>
              <span className="a3-health-head">
                <span className="a3-health-name">{row.name}<Explain label={`${row.name}怎么算`} content={<><p>{HEALTH_HELP[row.name] ?? "系统自动检测的读数。"}</p><p>来源：{row.source || "—"}</p></>} /></span>
                <StatusTag tone={state.tone} icon={state.icon}>{state.text}</StatusTag>
              </span>
              <span className="a3-health-metric">{row.metric ? metricText(row.metric).split(" · ").map((part, index, parts) => index < parts.length - 1 ? <span key={index}><span className="rd-keep">{part} ·</span> </span> : <span key={index} className="rd-keep">{part}</span>) : "—"}</span>
              <span className="a3-health-time">{row.stale ? "这次没测到，不能算正常" : `检测于 ${timeText(row.observedAt)}`}</span>
            </li>;
          })}
        </ul>}
      </Panel>
    </div>
  );

  const calendarValue = calendar?.zone ?? (calendar?.failed ? "—" : "…");
  const contentLead = commands.pending.filter(isA3ContentCommand).filter(record => !record.directContentConflict).map(record => {
    const check = checks[record.commandKey];
    const docs = record.original.kind === "docs";
    const code = receiptCodeTech(receiptOf(originalOutcomes[record.commandKey]));
    const audit = new URLSearchParams({ tab: "records", object: docs ? "developer.docs.published" : "how-it-works.published",
      action: docs ? "DEVELOPER_DOCS_PUBLISHED_CONTENT_CHANGED" : "HOW_CONTENT_PUBLISHED_CHANGED" });
    return <span key={record.commandKey} className="a3-check-line">{record.name}：{check
      ? `当前版本 ${check.version.current}，${SAVE_AS[check.status.current]}，修订号 ${check.revision.current}，${check.contentMatches ? "内容与原提交一致" : "内容与原提交不同"}。`
      : a3HasOriginalReceipt(record) ? "可查询原操作。" : "可读取当前内容核对。"}
      {reach("/platform/audit", "platform_a2_read") ? <Link className="rd-link" href={`/platform/audit?${audit}`} prefetch={false}>去操作记录与审批 →</Link> : "请有权限的管理员到操作记录与审批核对。"}
      <Explain label="技术信息" content={a3Deduplicates(record) ? <>操作编号 <span data-mono>{record.commandKey}</span>
        {code && ` ｜ ${code}`}
        <IconButton aria-label="复制操作编号" onClick={() => void navigator.clipboard.writeText(record.commandKey).then(() => toast("已复制操作编号"), () => toast("复制失败，请手动复制", "warn"))}><Copy size={14} /></IconButton></>
        : <>原操作没有可查询的操作编号。按发起时间、操作人和对应内容核对。</>} />
    </span>;
  });

  return (
    <>
    {versionManager && <AppVersionManager key={session?.adminId} />}
    <div className="a3-page" hidden={versionManager}>
      <PageHeader pageId="A3" title="系统配置" summary="平台时区、App 分享下载、公开说明和全局开关。"
        meta={readAt ? `${readAt} 读取（${businessZone().label}）` : undefined}
        readOnly={!anyWrite && overview ? "你只能查看" : undefined}
        actions={<Button icon={<RefreshCw size={14} aria-hidden />} loading={loading} onClick={() => { void refreshOverview(); setCalendarNonce((value) => value + 1); }}>刷新</Button>} />

      <GRecoveryNotice title="有原操作结果未知" rows={recoveryRows}
        explain={<><p>平台参数、功能开关、体验配置和有编号的说明内容先点「查询原操作」，明确查无、仍有修改权限且未超过 24 小时，才可「按原操作重试」。营业日历点「读取当前日历」看现在的排期，有效期内也可按原操作重试。</p><p>说明内容的旧无编号记录可读取当前内容核对，修改锁继续保留。有编号的记录过期后不能再重试，由有调查权限的超级管理员按回执和证据核查结案。</p></>}
        lead={contentLead.length ? contentLead : undefined} />

      {verifiedRelease.dialog}
      {originalClosing && <FundClosureModal label={originalClosing.name} createdAt={originalClosing.createdAt} offer={eCommandClosureOffer(originalOutcomes[originalClosing.commandKey], isRetryExpired(originalClosing))}
        facts={<><Fact k="改动">{originalClosing.change}</Fact>
          <Fact k="系统记录">{receiptFact(((outcome) => outcome && "receipt" in outcome ? outcome.receipt : null)(originalOutcomes[originalClosing.commandKey]), "记录保留")}</Fact></>}
        onClose={() => setOriginalClosing(null)}
        onSubmit={async (evidence: FundCommandEvidence) => {
          const record = originalClosing;
          const result = await commands.queryOriginal(record, evidence);
          setOriginalOutcomes(value => ({ ...value, [record.commandKey]: result }));
          setOriginalClosing(null);
          if (!result.settled) return;
          if (isA3ContentCommand(record)) { applyContentResult(record, result); return; }
          const status = result.receipt?.originalStatus;
          notify.success(record.name, status === "CONFIRMED_NOT_EXECUTED" ? "核查确认没有执行，记录已解除，可以重新发起。"
            : status === "CONFIRMED_REJECTED" ? SETTLED_REJECTED : "核查确认已执行，记录已解除，不要再做一次。");
          ctx.closeActionConfirm?.();
          if (record.original.kind === "experience") setExperienceNonce(value => value + 1);
          else await refreshOverview(true);
        }} />}

      {loadError && overview && <Notice tone="warn" title="刚才刷新没成功" action={<Button size="sm" onClick={() => void refreshOverview()}>重试</Button>}>{loadError} 下面是上次读到的值。</Notice>}

      <Conclusion state={worst} icon={worst === "ok" ? ShieldCheck : worst === "danger" ? ShieldAlert : undefined}
        explain="看系统运行状况、维护公告、紧急停用和地区限制、业务时区安排四件事。全局限流和提现强审门槛是设定值，没有对错，看下面的数字。">
        {conclusionText}
      </Conclusion>
      {issues.length > 1 && <TodoList label="要留意的事">
        {issues.map((issue) => <TodoItem key={issue.key} tone={issue.tone === "progress" ? undefined : issue.tone} href={issue.href} title={issue.title} sub={issue.sub} />)}
      </TodoList>}

      <StatBand label="系统配置摘要">
        <Stat icon={Activity} tone={healthAbnormal ? (badHealth.length ? "danger" : "warn") : "role-other"} label="运行状况"
          value={!overview ? "—" : systemHealth.length === 0 ? "—" : healthAbnormal ? String(healthAbnormal) : "正常"} unit={overview && healthAbnormal ? "项异常" : undefined}
          sub={overview ? `共 ${systemHealth.length} 项` : undefined} surface={badHealth.length ? "danger" : healthAbnormal ? "warn" : undefined}
          onOpen={() => pickTab("status")} openLabel="看系统运行状况" />
        <Stat icon={Megaphone} tone="role-other" label="维护公告横幅" value={!banner ? "—" : banner.status === "on" ? "开着" : "关着"}
          sub={banner ? `最近变更 ${timeText(banner.lastChange)}` : undefined} surface={banner?.status === "on" ? "warn" : undefined}
          onOpen={() => pickTab("switches")} openLabel="看维护公告横幅" />
        <Stat icon={Gauge} tone="role-2" label="全局限流" value={rateValue === null ? "—" : grouped(rateValue)} unit={rateValue === null ? undefined : "次/分钟"}
          sub={rateValue === null ? undefined : `每账号每类接口 ${grouped(rateBudget(rateValue).perAccount)} 次/分钟`}
          onOpen={() => pickTab("switches")} openLabel="看全局限流" />
        <Stat icon={CalendarClock} tone="role-3" label="业务时区" value={calendarValue}
          sub={calendar?.sub} onOpen={() => pickTab("calendar")} openLabel="看业务日历" />
      </StatBand>

      <PageTabs ids={ids} label="系统配置分区" value={tab} onChange={(value) => setTab(value)} items={[
        { value: "switches", label: tabLabel("switches") },
        { value: "calendar", label: tabLabel("calendar"), count: calendar?.pending ? 1 : undefined },
        { value: "experience", label: tabLabel("experience") },
        { value: "content", label: tabLabel("content"), count: content ? (content.unsaved || undefined) : undefined },
        { value: "status", label: tabLabel("status"), count: overview ? (healthAbnormal || undefined) : "—" },
      ]} />

      <div {...ids.panel("switches")} hidden={tab !== "switches"}>{switchesPanel}</div>
      <div {...ids.panel("calendar")} hidden={tab !== "calendar"}><A3Calendar commands={commands} recovery={recovery} onRecovered={onRecovered} nonce={calendarNonce} onSummary={setCalendar} toast={toast} /></div>
      <div {...ids.panel("experience")} hidden={tab !== "experience"}><A3Experience commands={commands} recovery={recovery} onRecovered={onRecovered} nonce={experienceNonce} toast={toast} /></div>
      <div {...ids.panel("content")} hidden={tab !== "content"}><A3Content key={session?.adminId} commands={commands} recovery={recovery} onRecovered={onRecovered} toast={toast} onSummary={setContent}
        contentReads={contentReads} retry={contentRetry} feedback={record => {
          const state = replayFeedback(record, originalOutcomes[record.commandKey]);
          return state && { detail: `${state.label}：${state.detail}`, next: state.next };
        }} /></div>
      <div {...ids.panel("status")} hidden={tab !== "status"}>{statusPanel}</div>
    </div>
    </>
  );
}
