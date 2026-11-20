"use client";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import { eCommandClosureOffer } from "@/lib/admin/e-command-investigation";
import { useReach } from "@/lib/nav/use-reach";
import { operatorCopyText } from "@/lib/admin/operator-copy";

/**
 * L1 · 关键指标（报表页样板）。查询条 → 结论 → 四张概览卡 → 七项指标 ┬ 所选指标明细 → 折叠组 → 相关页面。
 * 状态沿用 kpiState 的现有比较；可用性、样本保护和注册批次均以服务端为准。
 * 查询状态写网址（ST-23），优先于本机保存的视图；导出由操作者填理由（OP-115），文件到 L5 下载。
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { Activity, CheckCircle2, CircleHelp, Download, Flag, Gauge, ListChecks, Lock, RefreshCw, SlidersHorizontal, Target } from "lucide-react";
import { AutoGloss } from "@/app/components/kit/gloss";
import type { KpiTrendPoint } from "@/lib/admin/kpi-trend";
import { nextTabValue } from "@/app/components/kit/tab-group-keyboard";
import { KeepText, BlockState, Button, Cell, Check, Conclusion, DiffField, Explain, Fact, Facts, Figure, FilterBar, FilterField, Fold, Input, Modal, Notice, NumberInput, PageHeader, Panel, RecordList, Segments, Select, Sparkline, Stat, StatBand, StatusTag, Table, Td, Th, ThresholdMeter, Tr, TrendLines, type ChartSlot, type StateTone } from "@/app/components/rd";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isDeterministicRejection } from "@/lib/admin/outcome-classification";
import { businessClock, businessDay, businessStamp, businessZone } from "@/lib/admin/business-time";
import { findByPath } from "@/lib/nav/console-nav";
import { PaginationExemptionList } from "../design-kit";
import { kpiState, num, rec } from "./live-data";
import { DAU_NOT_COLLECTED_LABEL, readL1LiveTotals } from "./l1-l2-live-data";
import { L1LiveTotals } from "./l1-l2-live-fallback";
import type { LCtx } from "./types";
import { fetchL1Kpi, fetchL1KpiDrilldown, fetchL1KpiTrend, isLOutcomeUnknownError, type L1KpiQuery, type LReportCreateInput } from "@/lib/admin/l-client";
import { FundCheckButtons, FundClosureModal, FundRecoveryPanel, type FundSettled } from "../fund-command-check";
import { checkFundCommand, fundCommandOrigin, fundCommandSettled, fundInvestigationAccess, type FundCommandEvidence, type FundInvestigationOutcome } from "@/lib/admin/fund-command-investigation";
import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";
import { L1_KPI_IDS, validateL1Dashboard, validateL1Drilldown, validateL1Trend, type L1CohortPoint, type L1Dashboard, type L1KpiRow } from "./l1-kpi-contract";
import { L1_EXPORT_ORIGINAL_INCOMPLETE, L1_EXPORT_RECIPIENT, l1ReportInput, resolveL1ExportMode, resolveL1ExportUnavailableReason, type L1ExportMode, type L1ExportSource, type L1PendingExport } from "./l1-export-contract";
import { L1_DEFAULT_OVERLAY_IDS, loadL1LocalView, saveL1LocalView, type L1Window } from "./l1-local-view";
import { createL1ReadController } from "./l1-request-generation";
import { ATTRIBUTION_ROUTE_READ, assertL1AttributionLinks } from "./l-attribution-routes";

type Kpi = L1KpiRow;
type KpiExt = {
  fx: string;
  fxBold: string[];
  num: string | null;
  den: string | null;
  delta: string;
  note: string;
  jump: { label: string; href?: string }[];
};
const unitText = (k: Kpi) => (k.unit === "d" ? " 天" : k.unit);
const tgtLabel = (k: Kpi) => {
  const [low = 0, high = 0] = k.band ?? [];
  return k.dir === "band" ? `健康带 ${low}–${high}${unitText(k)}` : `目标 ${k.dir === "lte" ? "< " : "> "}${k.target}${unitText(k)}`;
};
const tgtValue = (k: Kpi) => (k.dir === "band" ? (k.band?.[0] ?? k.target) : k.target);

type KpiState = "g" | "y" | "r" | "none" | "uncollected" | "source" | "young" | "small" | "inapp";
type Metric = Pick<L1CohortPoint, "available" | "unavailableReason" | "value"> & { suppressed?: boolean; maturityStatus?: string; scope?: Kpi["scope"] };
const tgtShort = (k: Kpi) => tgtLabel(k).replace("目标 ", "").replace("健康带 ", "");
/** 算不出的按后端原因分类：样本过小优先于成熟度（BE-19）；一个满观察期的人都没有才是观察期未满。
 *  后端标了保护（人数不足 5，含一个都没有）的一律算样本过小，不按「分母为 0」的原因说「没人…」，否则 0 人和 1–4 人能分出来。 */
const blankState = (m: Metric): KpiState | null => {
  if (m.scope === "NOT_APPLICABLE_TO_COHORT" || m.unavailableReason === "COHORT_NOT_APPLICABLE") return "inapp";
  if (m.unavailableReason === "DAU_NOT_COLLECTED") return "uncollected";
  if (m.unavailableReason === "SOURCE_INCOMPLETE") return "source";
  if (m.unavailableReason === "BELOW_MINIMUM") return "small";
  if (m.maturityStatus === "IMMATURE") return "young";
  if (m.suppressed) return "small";
  if (m.available === false || m.value == null) return "none";
  return null;
};
const kpiStatus = (k: Kpi, offset: number): KpiState => blankState(k) ?? kpiState({ ...k, value: k.value! }, offset);
const pointStatus = (k: Kpi, point: L1CohortPoint, offset: number): KpiState => blankState(point) ?? kpiState({ ...k, value: point.value! }, offset);
/** 一部分人满了观察期：照常给值和判断，另标「暂定」。 */
const isPartial = (m: Metric) => m.available && m.maturityStatus === "PARTIAL";
const STATE_TONE: Record<KpiState, StateTone> = { g: "ok", y: "warn", r: "danger", none: "done", uncollected: "done", source: "done", young: "done", small: "done", inapp: "done" };
const BLANK_TEXT = { none: "没有数据", uncollected: DAU_NOT_COLLECTED_LABEL, source: "来源不全", young: "观察期未满", small: "样本过小", inapp: "不适用" } as const;
const stateText = (state: KpiState, k: Kpi) => state === "g" ? "达标" : state === "y" ? (k.dir === "band" ? "在健康带外" : "接近目标") : state === "r" ? "未达标" : BLANK_TEXT[state];
/** 未达标排最前，其次接近目标、各类算不出的，达标的放后面，不适用的放最后；同一档按指标编号。 */
const STATE_RANK: Record<KpiState, number> = { r: 0, y: 1, source: 2, young: 2, small: 2, none: 2, uncollected: 2, g: 3, inapp: 4 };
const BLANK_KINDS = ["source", "young", "small", "uncollected", "none"] as const;
/** 后端的不可用原因写成人话，事实来自 L1KpiAnalytics 的分母。 */
const REASON_TEXT: Record<string, string> = {
  NO_REGISTRATION_DENOMINATOR: "这个范围没有注册完成的用户，算不出，不按 0% 算。",
  NO_STORE_VIEW_DENOMINATOR: "这些注册用户里没人看过商城，算不出，不按 0% 算。",
  NO_DEVICE_HOLDER_DENOMINATOR: "这些注册用户里没有设备持有者，算不出，不按 0% 算。",
  NO_DIRECT_REFERRAL_DENOMINATOR: "这些注册用户里没有被直接邀请来的好友，算不出，不按 0% 算。",
  NO_GENESIS_PURCHASES: "这个范围没有创世节点购买记录，还没售罄，售罄天数暂无法计算。",
  GENESIS_NOT_SOLD_OUT: "创世节点还没累计售出 1,000，售罄天数暂无法计算。",
};
const YOUNG_TEXT: Record<number, string> = {
  1: "这些用户刚注册，首笔收益的计时还没走完，走完才算。",
  2: "这些用户注册后的第 7 天还没过完，过完才算留存。",
};
const SOURCE_REG_TEXT = "这批有用户缺注册记录，这项算不出；以前的记录不会补。";
const SOURCE_OLD_TEXT = "这批有用户注册超过 13 个月，早年的记录不全，算不出。选近 13 个月内的注册时间再看。";
const INAPP_TEXT = "这项是全站累计售出 1,000 个节点用的天数，不分注册批次。";
const PARTIAL_TEXT = "暂定：这批还有人没满观察期，只算了已满的人，数值之后会变。";
const GROUP_NAME = { registration_week: "注册周", registration_month: "注册月" } as const;
const instantStamp = (value: string) => businessStamp(Date.parse(value));
/** 批次的注册时间段，年份看批次编号：两头都是零点的写「05-04 至 05-10」（含结束日），否则写到分钟。 */
function regSpan(from: string, toExclusive: string) {
  const start = instantStamp(from).slice(5);
  const end = instantStamp(toExclusive).slice(5);
  return start.endsWith(" 00:00") && end.endsWith(" 00:00")
    ? `${start.slice(0, 5)} 至 ${businessStamp(Date.parse(toExclusive) - 86_400_000).slice(5, 10)}`
    : `${start} 至 ${end}`;
}
const SMALL_SAMPLE_NOTE = "每项统计样本至少 5 人才显示。首笔收益到账、注册后浏览商城按分子人数算（收到首笔收益的人、看过商城的人），其余按分母人数。少于 5 人不下结论；扩大范围仍不足时，等样本积累后再看。受保护的当前人数不显示。";
/** 「V1 实时」是 PRD 的上线批次（§1.6 后台可见性），不是刷新方式。 */
const batchText = (vis = "") => vis.replace(/^V(\d+).*$/, "第 $1 批");
const WINDOW_NAME: Record<Exclude<L1Window, "custom">, string> = { "1d": "近 24 小时", "7d": "近 7 天", "30d": "近 30 天" };
const SLICES = ["cohort", "phase", "locale", "ref"] as const;
const SLICE_NAME = { cohort: "注册周", phase: "运营阶段", locale: "语言", ref: "渠道" } as const;
const URL_KEYS = ["window", "from", "to", "granularity", "asOf", ...SLICES] as const;
const DEFAULT_QUERY: L1KpiQuery = { window: "7d", granularity: "registration_week" };
const COHORT_FORMAT = /^\d{4}-W\d{2}$/;
const RELATED = ["/analytics/funnel-cohort", "/analytics/financial", "/analytics/operations"] as const;
/** 全是 0 不是走势，不画图，写一句话（DP-62）；只有 1 批有数值时也只是一个点，不画。 */
const hasTrend = (values: readonly KpiTrendPoint[]) => values.filter((value) => value !== null).length >= 2 && values.some((value) => value !== null && value !== 0);
/** 有数值的点都是 0（空着的不算）。 */
const allZero = (values: readonly KpiTrendPoint[]) => values.length >= 2 && values.some((value) => value === 0) && values.every((value) => value === null || value === 0);
/** 画不出走势的原因：全是 0、0 和空着的都有（空着的是人数太少或算不出，不当 0）、全空着分开说。 */
const flatText = (values: readonly KpiTrendPoint[]) => values.length < 2 ? "批次不到 2 个"
  : values.every((value) => value === 0) ? "每批都是 0"
  : allZero(values) ? "有数值的批次都是 0"
  : values.every((value) => value === null) ? "各批次都算不出"
  : "有数值的批次不到 2 个";
const hasSlice = (query: L1KpiQuery) => SLICES.some((key) => Boolean(query[key]));
const DETAIL_ID = "l1-kpi-detail";
/** 上下排（1366 以下）时点一行看不到右边的明细，滚到明细（PG-42）；并排时不动。 */
function revealDetail() {
  if (!window.matchMedia("(max-width: 1365px)").matches) return;
  window.requestAnimationFrame(() => document.getElementById(DETAIL_ID)?.scrollIntoView({ block: "start", behavior: "smooth" }));
}

function deltaText(k: Kpi) {
  if (k.previousSuppressed) return "上期样本过小";
  if (k.momDelta == null) return "无可比数据";
  if (k.momDelta === 0) return "较上期持平";
  return `较上期 ${k.momDelta > 0 ? "+" : ""}${k.momDelta} ${k.unit === "%" ? "个百分点" : unitText(k).trim()}`;
}

/** 最新值离目标多远。好坏按这项的方向说，不用人去想高了好还是低了好。 */
function targetGap(k: Kpi) {
  if (k.value == null) return "—";
  const gap = k.dir === "lte" ? k.target - k.value : k.value - k.target;
  const size = `${Number(Math.abs(gap).toFixed(1))} ${k.unit === "%" ? "个百分点" : unitText(k).trim()}`;
  return gap === 0 ? "等于目标" : gap > 0 ? `好于目标 ${size}` : `差 ${size}`;
}

/** 按注册批次看时图上最后一个有数值的批次：表里「最近一批」和「距目标」都用它，和图上最后一个点是同一个数。 */
const lastPoint = (k: Kpi) => k.points ? [...k.points].reverse().find((point) => point.value !== null) : undefined;
/** 这一批是哪一批、是否不完整或暂定，写在数值下面。 */
const pointNote = (point: L1CohortPoint) => [point.bucketKey, point.partial ? "不完整" : "", isPartial(point) ? "暂定" : ""].filter(Boolean).join(" · ");

/** 后端才知道的范围先在这里查（ST-19）：起止差不超过 400 天，不含未来日期。 */
function customRangeProblem(from: string, to: string) {
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  return days > 400 || to > businessDay() ? "自定义时间最长 400 天，且不能包含未来日期。" : "";
}

function queryFromUrl(search: string): L1KpiQuery | null {
  const params = new URLSearchParams(search);
  if (!URL_KEYS.some((key) => params.has(key))) return null;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const raw = params.get("window");
  const custom = raw === "custom" && from && to && from <= to && !customRangeProblem(from, to);
  const phase = params.get("phase") ?? "";
  const cohort = params.get("cohort") ?? "";
  return {
    granularity: params.get("granularity") === "registration_month" ? "registration_month" : "registration_week",
    asOf: params.get("asOf") || undefined,
    ...(custom ? { window: "custom" as const, from, to } : { window: raw === "1d" || raw === "30d" ? raw : "7d" as const }),
    cohort: COHORT_FORMAT.test(cohort) ? cohort : undefined,
    phase: /^P[1-6]$/.test(phase) ? phase : undefined,
    locale: params.get("locale") || undefined,
    ref: params.get("ref") || undefined,
  };
}

function writeQueryToUrl(query: L1KpiQuery) {
  const url = new URL(window.location.href);
  URL_KEYS.forEach((key) => url.searchParams.delete(key));
  url.searchParams.set("window", query.window ?? "7d"); // 默认范围也写，否则刷新会被本机视图盖掉
  (["from", "to", "granularity", "asOf", ...SLICES] as const).forEach((key) => { if (query[key]) url.searchParams.set(key, String(query[key])); });
  window.history.replaceState(window.history.state, "", url);
}

const timeName = (query: L1KpiQuery) => query.window === "custom" ? `${query.from} 至 ${query.to}` : WINDOW_NAME[query.window ?? "7d"];
/** 「近 7 天注册」「2026-05-04 至 2026-11-17 注册」：日期后空一格。 */
const regTime = (query: L1KpiQuery) => `${timeName(query)}${query.window === "custom" ? " " : ""}注册`;
/** 分组时时间范围是注册时间：「近 7 天」是近 7 天注册的用户，不是近 7 天发生的事。 */
function queryScope(query: L1KpiQuery) {
  const time = query.granularity ? `${regTime(query)}，按${GROUP_NAME[query.granularity]}` : timeName(query);
  return [time, ...SLICES.filter((key) => query[key]).map((key) => `${SLICE_NAME[key]} ${query[key]}`)].join("，");
}

const EXPORT_SCOPE = "l1-export";
const EXPORT_PAGE = "/analytics/export";
/** 结果未知时原内容、理由和命令号都留着，刷新后还能原样重试，不铸新号（OP-93、OP-94）。 */
const pendingExports = createPendingMutationStore<L1PendingExport>({
  storageKey: "nexion-admin-l1-export-commands-v1",
  retainExpiredRecords: true, // 过期不能重试，但记录和导出锁都留着（OP-96）
  isValidRecord: (record) => typeof record.label === "string" && typeof record.reason === "string" && record.reason.length > 0
    && (record.mode === "series" || record.mode === "snapshot" || record.mode === "totals")
    && !!record.input && typeof record.input === "object"
    && (record.operator === undefined || typeof record.operator === "string"),
});

/** 导出的全部状态：按钮、确认框、待确认条、成功条。写法同提现审核的 sendCommand、retryPending、releasePending。 */
function useL1Export(ctx: LCtx, source: L1ExportSource | null | undefined, reread: () => void) {
  const reach = useReach();
  const [pending, setPending] = useState<L1PendingExport | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryRejected, setRetryRejected] = useState(false);
  const [retryNote, setRetryNote] = useState("");
  const [closing, setClosing] = useState(false);
  const [settled, setSettled] = useState<FundSettled[]>([]);
  const [finished, setFinished] = useState<L1ExportMode | null>(null);
  const syncPending = () => setPending(pendingExports.list()[0] ?? null);
  useEffect(syncPending, []);

  const sourceUnavailable = Boolean(ctx.biError || ctx.biLoading || !source || source.status !== "ready");
  const exportData = source ? source.data : ctx.biData?.l1;
  const exportMode = resolveL1ExportMode(exportData, sourceUnavailable);
  const exportUnavailableReason = resolveL1ExportUnavailableReason(
    exportData, ctx.biLoading || !source ? "loading" : ctx.biError ? "error" : source.status,
  );
  const query = source?.query ?? { window: "7d" as const };
  const pageName = findByPath(EXPORT_PAGE)?.l2.name ?? "数据导出与监管报告";
  const exportPage = (text: string) => (reach(EXPORT_PAGE, "bi_l5_read")
    ? <Link className="rd-link" href={EXPORT_PAGE}>{text}</Link>
    : `你没有「${pageName}」的权限，请找有权限的同事处理。`);

  const send = async (mode: L1ExportMode, input: LReportCreateInput, reason: string, label: string, retryKey?: string) => {
    const createReport = ctx.biActions?.createReport;
    if (!createReport) throw new Error("关键指标暂时不能导出，请刷新后再试");
    const retained = pendingExports.get(EXPORT_SCOPE);
    if (retained !== retryKey) throw new Error(L1_EXPORT_ORIGINAL_INCOMPLETE);
    const key = retained ?? `l1-export-${crypto.randomUUID()}`;
    const original = pendingExports.list().find(record => record.commandKey === key);
    const operator = retained ? original?.operator : currentAdminOperator();
    if (!operator) throw new Error(L1_EXPORT_ORIGINAL_INCOMPLETE);
    if (!retained) pendingExports.remember(EXPORT_SCOPE, key, { label, mode, input, reason, operator, commandOrigin: fundCommandOrigin("POST", "/api/admin/bi/reports", "bi_l1_read") });
    if (!pendingExports.isDurablyStored(EXPORT_SCOPE, key)) {
      if (retained) throw new Error(L1_EXPORT_ORIGINAL_INCOMPLETE);
      pendingExports.forget(EXPORT_SCOPE, key);
      throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
    }
    try {
      await createReport(original?.input ?? input, original?.reason ?? reason, key, operator);
    } catch (cause) {
      const failure = cause as { status?: number; reasonCode?: string; hadUncertainAttempt?: boolean };
      const rejected = retained || failure.hadUncertainAttempt ? isExplicitRejection(cause)
        : !isLOutcomeUnknownError(cause) && !failure.reasonCode?.startsWith("IDEMPOTENCY_")
          && isDeterministicRejection(failure.status ?? 0);
      const unknown = !rejected;
      if (rejected) pendingExports.forget(EXPORT_SCOPE, key);
      syncPending();
      if (!unknown) throw cause;
      ctx.toast("结果未知，不要重新导出。到页面上方按原请求重试。", "warn");
      return;
    }
    pendingExports.forget(EXPORT_SCOPE);
    syncPending();
    setRetryRejected(false);
    setRetryNote("");
    setFinished(mode);
    await ctx.reloadBi?.();
    ctx.toast(reach(EXPORT_PAGE, "bi_l5_read") ? `已提交导出，生成后到「${pageName}」下载` : "已提交导出，文件生成后才能下载", "success");
  };

  const openConfirm = (mode: L1ExportMode) => {
    // 分组导出是长表：每项指标每个批次一行（后端 prepareRegistrationCohortSnapshot），批次数取本页这份数据。
    const buckets = query.granularity ? (exportData as L1Dashboard).weeks.length : 0;
    const unit = query.granularity === "registration_month" ? "月" : "周";
    const rows = query.granularity ? `${L1_KPI_IDS.length * buckets} 行，每项指标每个注册${unit}一行` : mode === "totals" ? `${readL1LiveTotals(exportData).length} 行，一个累计数一行` : `${L1_KPI_IDS.length} 行，一项指标一行`;
    ctx.openActionConfirm({ briefKind: "export",
      action: "导出关键指标",
      detail: `聚合数据，不含用户隐私。提交后生成任务，文件到「${pageName}」下载。`,
      statedBrief: { impact: "生成一个导出任务，不改任何数据，操作记录里留痕。", check: query.granularity ? "看注册时间和分组对不对。" : "看时间范围对不对。" },
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      reasonPlaceholder: "写这份数据给谁、做什么用，例如：给增长组做周会复盘",
      facts: (
        <Facts>
          <Fact k="范围">{mode === "totals" ? "当前累计" : queryScope(query)}</Fact>
          {query.asOf && <Fact k="数据截至">{instantStamp(query.asOf)}（{businessZone().label}）</Fact>}
          <Fact k="接收人">{L1_EXPORT_RECIPIENT}</Fact>
          <Fact k="文件格式">CSV</Fact>
          <Fact k="文件行数">{rows}，另有表头</Fact>
          <Fact k="文件内容">{query.granularity ? `各注册${unit}的数值、人数和状态，不含汇总值` : mode === "series" ? `${L1_KPI_IDS.length} 项指标的可用数值、目标和六段趋势` : mode === "snapshot" ? `${L1_KPI_IDS.length} 项指标的可用数值、目标和可用性` : "当前累计数"}{mode !== "totals" && (query.granularity
            ? <Explain label="算不出的批次怎么导出" content="算不出或样本过小的批次，数值和人数留空，另一列写原因。" />
            : <Explain label="样本过小的项怎么导出" content="受保护项标为样本过小，相关数值留空。" />)}</Fact>
        </Facts>
      ),
      confirmLabel: "确认导出",
      reasonMin: 8,
      reasonMax: 200,
      getPendingReason: () => undefined,
      run: (reason) => send(mode, l1ReportInput(mode, query), reason, mode === "series" ? "导出关键指标序列" : "导出关键指标当前汇总"),
    });
  };

  /** 按原操作重试：同命令号、同内容、同理由，不接受新输入。后端明确拒绝才给解除。 */
  const retry = async (record: L1PendingExport) => {
    // 到期和读不到记录都不是结果，不解除，也不重发（OP-96）。解除只在重试被后端明确拒绝之后。
    if (record.expiresAt <= Date.now()) {
      syncPending();
      return;
    }
    if (!ctx.canExport) {
      setRetryNote("这个账号已没有导出权限，请有权限的同事处理。");
      return;
    }
    if (!pendingExports.isDurablyStored(record.fingerprint, record.commandKey)) {
      setRetryNote("浏览器里读不到这条记录，这次没有重发。请到操作记录与审批核对。");
      return;
    }
    if (!record.operator) {
      setRetryNote(L1_EXPORT_ORIGINAL_INCOMPLETE);
      return;
    }
    setRetrying(true);
    setRetryRejected(false);
    setRetryNote("");
    try {
      await send(record.mode, record.input, record.reason, record.label, record.commandKey);
    } catch (cause) {
      if (isExplicitRejection(cause)) { ctx.toast(`原操作被拒绝，记录已解除：${displayAdminError(cause)}`, "warn"); return; }
      setRetryNote(`重试被拒绝：${cause instanceof Error ? displayAdminError(cause) : "原因未知"} 这说明不了原操作的结果，记录继续保留。`);
      setRetryRejected(isExplicitRejection(cause));
    } finally {
      setRetrying(false);
    }
  };

  const [investigationResults, setInvestigationResults] = useState<Record<string, FundInvestigationOutcome>>({});
  const checkInvestigation = async (record: L1PendingExport, evidence?: FundCommandEvidence) => {
    setRetrying(true);
    try {
      const receipt = await checkFundCommand(record, evidence);
      setInvestigationResults(current => ({ ...current, [record.commandKey]: { receipt } }));
      if (fundCommandSettled(receipt)) {
        pendingExports.forget(record.fingerprint, record.commandKey);
        setSettled(current => [...current.filter(item => item.key !== record.commandKey), { key: record.commandKey, label: record.label, status: receipt!.originalStatus }]);
        syncPending();
        setRetryRejected(false); setRetryNote("");
        reread();
      }
      return receipt;
    } catch (cause) {
      const error = displayAdminError(cause);
      // 结案失败由结案框自己说，不覆盖这一行上次查询的结果。
      if (!evidence) setInvestigationResults(current => ({ ...current, [record.commandKey]: { error } }));
      throw cause;
    } finally { setRetrying(false); }
  };

  const expired = pending ? pending.expiresAt <= Date.now() : false;

  return {
    investigation: { check: checkInvestigation, results: investigationResults, access: pending ? fundInvestigationAccess(pending) : null },
    button: ctx.canExport ? (<>
      <Button
        icon={<Download size={14} aria-hidden />}
        disabledReason={pending ? "上一次导出结果未知，先到页面上方查询原结果" : exportMode === null || ctx.biLoading ? exportUnavailableReason : undefined}
        onClick={() => { if (exportMode) { setFinished(null); openConfirm(exportMode); } }}
      >
        {exportMode === "series" || (!exportMode && query.granularity) ? "导出关键指标序列 CSV" : "导出关键指标当前汇总 CSV"}
      </Button>
      <Explain label="导出的说明" content="要填理由，生成下载任务，留操作记录。" />
    </>) : null,
    notices: <>
      <FundRecoveryPanel settled={settled} onDismissSettled={key => setSettled(current => current.filter(item => item.key !== key))}
        link={reach("/platform/audit", "platform_a2_read") ? <Link className="rd-link" href="/platform/audit?domain=L">到操作记录与审批核对</Link> : undefined}
        rows={pending ? [{ key: pending.commandKey, title: pending.label, record: pending, outcome: investigationResults[pending.commandKey], createdAt: pending.createdAt, expired, canRetry: !expired && !!ctx.canExport && !!pending.operator,
          copy: { where: `「${pageName}」` },
          actions: <>
            <FundCheckButtons record={pending} outcome={investigationResults[pending.commandKey]} expired={expired} busy={retrying} onCheck={() => void checkInvestigation(pending).catch(() => undefined)} onClose={() => setClosing(true)} />
            {!expired && <Button size="sm" loading={retrying} disabledReason={!ctx.canExport ? "这个账号已没有导出权限，请有权限的同事处理" : undefined} onClick={() => void retry(pending)}>按原请求重试</Button>}
          </>,
          detail: <>
            <p>任务可能已经生成，不要重新导出。{!expired && !ctx.canExport ? "这个账号已没有导出权限，不能重试，请有权限的同事处理。" : ""}{exportPage(`到「${pageName}」核对`)}</p>
            {!expired && retryNote && <p><KeepText text={retryNote} /></p>}
          </>,
          tech: `理由 ${pending.reason}` }] : []} />
      {finished && !pending && (
        <Notice tone="ok" title={finished === "series" ? "关键指标趋势已提交导出" : "关键指标当前汇总已提交导出"} action={<Button size="sm" onClick={() => setFinished(null)}>知道了</Button>}>
          任务生成后才能下载。{exportPage(`到「${pageName}」下载`)}
        </Notice>
      )}
      {closing && pending && <FundClosureModal label={pending.label} createdAt={pending.createdAt} offer={eCommandClosureOffer(investigationResults[pending.commandKey], isRetryExpired(pending))}
        onClose={() => setClosing(false)} onSubmit={async evidence => { await checkInvestigation(pending, evidence); setClosing(false); }} />}
    </>,
  };
}

/** fx 公式渲染:fxBold 词高亮(cyan b),其余纯文本。 */
/** 后端各项的说明句写的是统计口径的内部说法，这页换成运营的话；后端改了原句就照原句显示。 */
const NOTE_TEXT: Record<string, string> = {
  "衡量注册后能否快速感知收益": "看新用户注册后能不能很快收到第一笔收益。",
  "未满 7 天的 cohort 不进入分母": "注册不满 7 天的用户还不算进来。",
  "客户端浏览事件按锁定 KPI 口径统计": "以商城浏览记录为准，同一人只算一次。",
  "健康带为 5%–10%": "健康带是 5%–10%，两端都算。",
  "推广率不是提现或收入指标": "只看有没有发出邀请，和提现、收入无关。",
  "只计算能与邀请关系匹配的奖励事件": "只算能对上邀请关系的奖励。",
  "未售罄时显示不可计算并保留进度": "还没售罄时算不出天数。",
};

function renderFx(fx: string, bold: string[]) {
  const firstYield = /^device\.first_yield_received\.latency_sec ≤ ([0-9.]+) ÷ auth\.register_completed$/.exec(fx);
  fx = firstYield ? `${firstYield[1]} 秒内收到首笔收益的人数 ÷ 注册完成人数` : ({
    "day7 app.dau ÷ register cohort": "注册满 7 天当日的活跃人数 ÷ 同批注册人数",
    "store.viewed distinct user ÷ auth.register_completed": "浏览商城的用户数 ÷ 注册完成人数",
    "checkout.completed ÷ store.viewed": "支付完成的用户数 ÷ 浏览商城的用户数",
    "device holder referral.invite_sent ÷ device holders": "发出邀请的设备持有者人数 ÷ 设备持有者人数",
    "L1 referred first commission.paid ÷ referral.bound": "直接邀请的好友中带来首笔团队奖励的人数 ÷ 直接邀请的好友人数",
    "genesis.purchased cumulative 1,000 days": "累计售出 1,000 个节点所用的自然日数",
  } as Record<string,string>)[fx] ?? fx;
  if (!bold.length) return fx;
  const re = new RegExp(`(${bold.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return fx.split(re).map((part, i) => (bold.includes(part) ? <b key={i}>{part}</b> : <span key={i}>{part}</span>));
}

/** 接近目标的范围（黄灯偏移）只改本机显示，不写后端，所以是本地小窗，不走确认（L1-A02）。 */
function OffsetModal({ current, onApply, onClose }: { current: number; onApply: (next: number) => void; onClose: () => void }) {
  const [draft, setDraft] = useState("");
  const [left, setLeft] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const next = Number(draft);
  const typed = draft.trim() !== "";
  const problem = !typed ? "填写新值" : !(Number.isInteger(next) && next >= 5 && next <= 20) ? "要填 5–20 的整数" : next === current ? "和当前值一样，没有改动" : undefined;
  return (
    <Modal title={<>调整接近目标的范围<Explain label="接近目标的范围的说明" content="只改你看到的状态和接近线，不改业务规则或统计方式。刷新会恢复最后保存的设置，没有保存视图时回到默认值。要保留请点「保存为视图」。" /></>} icon={SlidersHorizontal}
      sub={<StatusTag tone="neutral" filled>只改你看到的显示</StatusTag>} onClose={onClose}
      footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabledReason={problem} onBlockedClick={() => setAttempted(true)} onClick={() => { onApply(next); onClose(); }}>应用</Button></>}>
      <div className="rd-stack">
        {/* 现在值、新值输入合成一块（VS-103）。刚打开不报错，失焦且填过或点过提交才用警告色（OP-15）。 */}
        <DiffField before={String(current)} unit="%" hint="5–20 的整数" error={attempted || (left && typed) ? problem : undefined}>
          {(control) => <NumberInput {...control} unit="%" min={5} max={20} step={1} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => setLeft(true)} />}
        </DiffField>
        <Fold inset title="状态怎么判定" summary="4 条规则">
          <div className="rd-stack">
            <p className="rd-note"><b>单侧目标：</b>严格高于或低于目标值才达标；等于目标时算接近目标。</p>
            <p className="rd-note"><b>接近线：</b>越高越好取<b>目标 × (1 − N%)</b>，越低越好取<b>目标 × (1 + N%)</b>。</p>
            <p className="rd-note"><b>接近目标：</b>没达标但在接近线以内（含接近线），超出算未达标。</p>
            <p className="rd-note"><b>购买转化：</b>健康带包含两端，带外归接近目标。</p>
          </div>
        </Fold>
      </div>
    </Modal>
  );
}

export function L1Kpi({ ctx, onExportSource, source, title, summary }: { ctx: LCtx; onExportSource?: (source: L1ExportSource) => void; source?: L1ExportSource | null; title: ReactNode; summary: string }) {
  const reach = useReach();
  const exporting = useL1Export(ctx, source, () => retryFirstRead());
  const [picked, setPicked] = useState<number | null>(null); // 没点过时跟着排在最前的那一项
  const [ylOffset, setYlOffset] = useState(10);
  const [phaseOn, setPhaseOn] = useState(true);
  const [ovlKpiIds, setOvlKpiIds] = useState<number[]>(L1_DEFAULT_OVERLAY_IDS);
  const [editingOffset, setEditingOffset] = useState(false);
  const [win, setWin] = useState<L1Window>("7d");
  const [customOpen, setCustomOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [gran, setGran] = useState("week");
  const [cohortFilter, setCohortFilter] = useState("");
  const [phaseFilter, setPhaseFilter] = useState("");
  const [localeFilter, setLocaleFilter] = useState("");
  const [refFilter, setRefFilter] = useState("");
  const [applied, setApplied] = useState<L1KpiQuery>(DEFAULT_QUERY); // 屏幕上这份数据的条件（ST-18）
  const [queryNotice, setQueryNotice] = useState("");
  const [localData, setLocalData] = useState<L1Dashboard | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [readAt, setReadAt] = useState("");
  const [drillKpi, setDrillKpi] = useState<Kpi | null>(null);
  const [drillTrend, setDrillTrend] = useState<{ values: KpiTrendPoint[]; suppressedPoints?: boolean[]; unavailableReasons?: (string | null)[] } | null>(null);
  const [drillError, setDrillError] = useState("");
  const l1Requests = useRef(createL1ReadController());
  const selectedQuery = useRef<L1KpiQuery>(DEFAULT_QUERY);
  const initialized = useRef(false);
  const drillRead = useRef(0);

  useEffect(() => {
    let next = selectedQuery.current;
    if (!initialized.current) {
      let saved: ReturnType<typeof loadL1LocalView> = null;
      try {
        saved = loadL1LocalView(window.localStorage);
      } catch {
        // Storage may be disabled; the URL and default query still work.
      }
      if (saved) {
        setPhaseOn(saved.phaseOn);
        setYlOffset(saved.ylOffset);
        setOvlKpiIds(saved.ovlKpiIds);
      }
      next = queryFromUrl(window.location.search) ?? (saved ? {
        ...(saved.window === "custom" ? { window: "custom", from: saved.customFrom, to: saved.customTo } : { window: saved.window }),
        granularity: saved.granularity,
        cohort: saved.cohortFilter || undefined, phase: saved.phaseFilter || undefined,
        locale: saved.localeFilter || undefined, ref: saved.refFilter || undefined,
      } : DEFAULT_QUERY);
      setWin(next.window ?? "7d");
      setCustomFrom(next.from ?? "");
      setCustomTo(next.to ?? "");
      setCohortFilter(next.cohort ?? "");
      setPhaseFilter(next.phase ?? "");
      setLocaleFilter(next.locale ?? "");
      setRefFilter(next.ref ?? "");
      initialized.current = true;
    }
    // Even the default week view requires the versioned cohort endpoint, never the parent's legacy six points.
    reloadKpi(next, false);
  }, [ctx.biData?.l1]);

  useEffect(() => () => {
    l1Requests.current.invalidate();
    drillRead.current += 1;
  }, []);

  const data = localData;
  useEffect(() => { if (data) setReadAt(businessClock(Date.now())); }, [data]);
  const rawKpis = data?.kpis ?? [];
  const liveTotals = readL1LiveTotals(data);

  const draftSlices = { cohort: cohortFilter || undefined, phase: phaseFilter || undefined, locale: localeFilter || undefined, ref: refFilter || undefined };
  const appliedSlices = { cohort: applied.cohort, phase: applied.phase, locale: applied.locale, ref: applied.ref };
  const appliedTime = { window: applied.window, from: applied.from, to: applied.to, granularity: applied.granularity };

  /** 读取入口只收完整的查询对象。草稿只有显式应用时才拼进来，刷新、移除条件、重试都不碰（ST-18）。 */
  const reloadKpi = (next: L1KpiQuery, notify = true) => {
    setQueryNotice("");
    setRefreshing(true);
    setLocalData(data ?? null);
    selectedQuery.current = next;
    drillRead.current += 1;
    setDrillKpi(null);
    setDrillTrend(null);
    setDrillError("");
    onExportSource?.({ parentData: ctx.biData?.l1, data, query: next, status: "loading" });
    l1Requests.current.run(
      () => fetchL1Kpi(next).then(result => validateL1Dashboard(result, next)),
      (result) => {
        const boundQuery = result.query ?? next;
        setLocalData(result);
        onExportSource?.({ parentData: ctx.biData?.l1, data: result, query: boundQuery, status: "ready" });
        drillRead.current += 1;
        setDrillKpi(null);
        setDrillTrend(null);
        setDrillError("");
        setRefreshError("");
        setWin(next.window ?? "7d");
        setApplied(boundQuery);
        setGran(boundQuery.granularity === "registration_month" ? "month" : "week");
        writeQueryToUrl(boundQuery);
        if (notify) ctx.toast(`关键指标已按${next.granularity ? `${GROUP_NAME[next.granularity]}、` : ""}${timeName(next)}重新加载`, "success");
      },
      (error) => {
        const message = displayAdminReadError(error);
        setRefreshError(message);
        onExportSource?.({ parentData: ctx.biData?.l1, data, query: next, status: "error" });
        if (notify) ctx.toast(`关键指标 刷新失败 · ${message}`, "error");
      },
      () => setRefreshing(false),
    );
  };

  const customPicking = customOpen || win === "custom";
  const customRangeNotice = !customPicking || !customFrom || !customTo ? ""
    : customFrom > customTo ? "开始日期不能晚于结束日期。" : customRangeProblem(customFrom, customTo);
  const customBlocked = !customFrom || !customTo ? "先选开始和结束日期" : customRangeNotice || undefined;
  const applySlices = () => {
    if (cohortFilter && !COHORT_FORMAT.test(cohortFilter)) {
      setQueryNotice("注册周要写成年份和周数，比如 2026-W42。这次没有查询。");
      return;
    }
    reloadKpi({ ...appliedTime, ...draftSlices });
  };
  const clearDrafts = () => {
    setCohortFilter("");
    setPhaseFilter("");
    setLocaleFilter("");
    setRefFilter("");
  };
  const removeSlice = (key: typeof SLICES[number]) => {
    ({ cohort: setCohortFilter, phase: setPhaseFilter, locale: setLocaleFilter, ref: setRefFilter })[key]("");
    reloadKpi({ ...applied, asOf: undefined, [key]: undefined });
  };
  const saveView = () => {
    if (!data) {
      ctx.toast(refreshError ? "关键指标加载失败，请重试" : "关键指标加载中，请稍候", "warn");
      return;
    }
    let saved: ReturnType<typeof saveL1LocalView> = null;
    try {
      // 存屏幕上这份，不存没应用的输入：它和网址一致，刷新才真的还是这个视图。
      saved = saveL1LocalView(window.localStorage, {
        window: applied.window ?? "7d", customFrom: applied.from ?? "", customTo: applied.to ?? "", granularity: applied.granularity, phaseOn, ylOffset, ovlKpiIds,
        cohortFilter: applied.cohort ?? "", phaseFilter: applied.phase ?? "", localeFilter: applied.locale ?? "", refFilter: applied.ref ?? "",
      });
    } catch {
      saved = null;
    }
    ctx.toast(saved ? "视图已保存在这台电脑的浏览器里，刷新后仍按这个视图显示" : "视图设置有误或浏览器不能保存，没有保存", saved ? "success" : "error");
  };
  const draftChanged = SLICES.some((key) => (draftSlices[key] ?? "") !== (applied[key] ?? ""));

  // 切分组时屏幕上还是旧数据，分段先不跳，旁边写正在切；成功后才换成新分组，失败保持原样，旧图不会配上新名字。
  const switchingTo = refreshing && selectedQuery.current.granularity !== applied.granularity ? selectedQuery.current.granularity : undefined;
  const queryBar = (
    <FilterBar
      scope={<>
        <Segments
          label="分组"
          value={gran}
          items={[{ value: "week", label: "按注册周" }, { value: "month", label: "按注册月" }]}
          onChange={(next) => reloadKpi({ ...applied, asOf: undefined, granularity: next === "month" ? "registration_month" : "registration_week" })}
        />
        <span className="l1-scope-label">注册时间</span>
        <Segments<L1Window>
          label="注册时间"
          value={customPicking ? "custom" : win}
          items={[{ value: "1d", label: "近 24 小时" }, { value: "7d", label: "近 7 天" }, { value: "30d", label: "近 30 天" }, { value: "custom", label: "自定义" }]}
          onChange={(next) => {
            if (next === "custom") {
              setCustomOpen(true);
              return;
            }
            setCustomOpen(false);
            reloadKpi({ window: next, granularity: applied.granularity, ...appliedSlices });
          }}
        />
        <Explain label="注册时间的说明" content="选的是用户的注册时间：「近 7 天」看的是近 7 天注册的用户，每个批次是同一周或同一月注册的人。" />
        {switchingTo && <span className="rd-note" role="status">正在按{GROUP_NAME[switchingTo]}重算…</span>}
      </>}
      more={<>
        <FilterField label="注册周"><Input aria-label="注册周筛选" placeholder="年份与周数，如 2026-W42" value={cohortFilter} onChange={(event) => { setCohortFilter(event.target.value); setQueryNotice(""); }} /></FilterField>
        <FilterField label="运营阶段"><Select aria-label="运营阶段筛选" value={phaseFilter} onChange={setPhaseFilter} options={[{ value: "", label: "全部阶段" }, ...["P1", "P2", "P3", "P4", "P5", "P6"].map((value) => ({ value, label: value }))]} /></FilterField>
        <FilterField label="语言"><Input aria-label="语言筛选" placeholder="语言" value={localeFilter} onChange={(event) => setLocaleFilter(event.target.value)} /></FilterField>
        <FilterField label="渠道"><Input aria-label="渠道筛选" placeholder="推荐来源" value={refFilter} onChange={(event) => setRefFilter(event.target.value)} /></FilterField>
        <div className="rd-filter-more-row"><Button type="submit" disabled={refreshing}>应用筛选</Button></div>
        <div className="rd-filter-more-row">
          <span className="rd-note">显示设置</span>
          {/* 分组数据不带阶段切换点（后端 phaseMarkers=false），开关留着、随视图保存，现在没有可画的标记。 */}
          <Check label="显示运营阶段切换" checked={phaseOn} disabled={Boolean(applied.granularity)} explain={applied.granularity ? "按注册批次看时图上不标阶段切换，切换时间到「运营阶段状态」看。" : undefined} onChange={() => { setPhaseOn(!phaseOn); ctx.toast(`运营阶段切换标记已${!phaseOn ? "开启" : "关闭"}`, "info"); }} />
        </div>
      </>}
      moreCount={SLICES.filter((key) => applied[key]).length}
      onSubmit={applySlices}
      querying={refreshing}
      action={<></>}
      onClear={() => { clearDrafts(); reloadKpi(appliedTime); }}
      canClear={!refreshing && (hasSlice(applied) || draftChanged)}
      sort={<div className="rd-filter-end">
        <Button onClick={saveView}>保存为视图</Button>
        <Explain label="保存为视图存什么" content="只存在这台电脑的浏览器里。统计规则与目标值只读，这里只把分组、注册时间、切片和显示方式存下来，不保存数据、权限或业务状态，也不用确认。" />
      </div>}
      result={draftChanged ? "条件未应用" : undefined}
      applied={SLICES.filter((key) => applied[key]).map((key) => ({ key, label: `${SLICE_NAME[key]} ${applied[key]}`, onRemove: () => removeSlice(key) }))}
      notice={customRangeNotice ? `${customRangeNotice}这次没有查询。` : queryNotice || undefined}
    >
      {customPicking && (
        <div className="rd-filter-line">
          <label className="rd-note" htmlFor="l1-custom-from">起</label>
          <Input id="l1-custom-from" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
          <label className="rd-note" htmlFor="l1-custom-to">止</label>
          <Input id="l1-custom-to" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
          <Button disabled={refreshing} disabledReason={customBlocked} onClick={() => reloadKpi({ window: "custom", from: customFrom, to: customTo, granularity: applied.granularity, ...appliedSlices })}>应用自定义</Button>
          <Explain label="自定义范围的说明" content={`${businessZone().label}，含结束日，最长 400 天。`} />
        </div>
      )}
    </FilterBar>
  );

  const retryLast = () => reloadKpi(selectedQuery.current);
  const retryFirstRead = retryLast;

  const report = () => {
    const KPIS = rawKpis;
    const WEEKS = data?.weeks ?? [];
    // 周批次的横轴写「W19」，跨年时写「26-W19」，长编号排不开；各批次表里写全。
    const TICKS = applied.granularity === "registration_week" ? WEEKS.map((key) => new Set(WEEKS.map((item) => item.slice(0, 4))).size > 1 ? key.slice(2) : key.slice(5)) : WEEKS;
    const PHASE_SWITCH_IDX = data?.phaseSwitchIndex == null ? -1 : num(data.phaseSwitchIndex, -1);
    const applicableCount = data?.applicableKpiCount ?? KPIS.length;
    const KPI_EXT = rec<KpiExt>(data?.kpiExt);
    const KPI_PLAIN = rec<string>(data?.kpiPlain);
    const formula = (ext: KpiExt) => renderFx(ext.fx, ext.fxBold);
    const states = KPIS.map((item) => kpiStatus(item, ylOffset));
    const count = (state: KpiState) => states.filter((item) => item === state).length;
    const green = count("g");
    const yellow = count("y");
    const red = count("r");
    const unavailable = BLANK_KINDS.reduce((sum, kind) => sum + count(kind), 0);
    const blankKinds = BLANK_KINDS.filter((kind) => count(kind) > 0);
    // 每种原因不拆行，折行只落在「·」后面。
    const blankSummary = blankKinds.map((kind, index) => <span key={kind} className="l1-nowrap">{BLANK_TEXT[kind]} {count(kind)}{index < blankKinds.length - 1 ? " · " : ""}</span>);
    const grouped = Boolean(applied.granularity);
    const unitName = applied.granularity === "registration_month" ? "月" : "周";
    const order = KPIS.map((_, index) => index).sort((a, b) => STATE_RANK[states[a]] - STATE_RANK[states[b]] || KPIS[a].n - KPIS[b].n);
    const safeSelKpi = Math.min(picked ?? order[0], KPIS.length - 1);
    const baseKpi = KPIS[safeSelKpi];
    const k = drillKpi?.n === baseKpi.n
      ? { ...baseKpi, ...drillKpi, name: baseKpi.name, spark: drillTrend?.values ?? drillKpi.spark ?? baseKpi.spark, sparkSuppressed: drillTrend?.suppressedPoints ?? drillKpi.sparkSuppressed, sparkUnavailableReasons: drillTrend?.unavailableReasons ?? drillKpi.sparkUnavailableReasons }
      : baseKpi;
    const baseExt = KPI_EXT[k.kpiId] ?? { fx: k.name, fxBold: [], num: "—", den: "—", delta: "0", note: "暂时没有这项指标的解读", jump: [] };
    const kState = kpiStatus(k, ylOffset);
    const points = k.points ?? [];
    const partialEdges = points.filter((point) => point.partial);
    // #4 也来源不全时是注册超过 13 个月（历史保留期），只有 #1–#3 来源不全时是缺注册记录（L1KpiAnalytics.cohortMetric）。
    const oldHistory = KPIS.find((item) => item.n === 4)?.unavailableReason === "SOURCE_INCOMPLETE";
    const blankNote = (state: KpiState, row: Metric & { n?: number }) => state === "inapp" ? INAPP_TEXT
      : state === "source" ? (oldHistory || (row.n ?? k.n) > 3 ? SOURCE_OLD_TEXT : SOURCE_REG_TEXT)
      : state === "young" ? YOUNG_TEXT[k.n] ?? REASON_TEXT.NO_REGISTRATION_DENOMINATOR
      : state === "uncollected" ? BLANK_TEXT.uncollected
      : state === "none" ? REASON_TEXT[row.unavailableReason ?? ""] ?? REASON_TEXT.NO_REGISTRATION_DENOMINATOR
      : undefined;
    const ext = {
      ...baseExt,
      num: k.numerator == null ? null : String(k.numerator),
      den: k.denominator == null ? null : String(k.denominator),
      note: blankNote(kState, k) ?? (NOTE_TEXT[baseExt.note] ?? baseExt.note),
    };
    const phase = rec(data?.currentPhase);
    const phaseKnown = typeof phase.code === "string" && phase.code.length > 0;
    const attributionLinks = assertL1AttributionLinks(ext.jump);

    const selectKpi = async (index: number) => {
      setPicked(index);
      const kpiId = Number(KPIS[index]?.kpiId);
      if (!kpiId) return;
      const read = ++drillRead.current;
      setDrillKpi(null);
      setDrillTrend(null);
      setDrillError("");
      try {
        const [drilldown, trend] = await Promise.all([
          fetchL1KpiDrilldown(kpiId, applied),
          fetchL1KpiTrend(kpiId, applied),
        ]);
        const checkedDrilldown = validateL1Drilldown(drilldown, kpiId, applied, WEEKS);
        const checkedTrend = validateL1Trend(trend, kpiId, applied, WEEKS);
        if (read !== drillRead.current) return;
        setDrillKpi(checkedDrilldown.selected);
        setDrillTrend({ values: checkedTrend.values, suppressedPoints: checkedTrend.suppressedPoints });
      } catch (error) {
        if (read !== drillRead.current) return;
        const message = displayAdminReadError(error);
        setDrillError(message);
        ctx.toast(`明细加载失败 · ${message}`, "error");
      }
    };
    /** 七项是一组单选：方向键、Home、End 移动并立即选中，Tab 只停在当前行（ST-56）。 */
    const moveRow = (event: KeyboardEvent<HTMLTableRowElement>) => {
      const next = nextTabValue(order, safeSelKpi, event.key);
      if (next === null) return;
      event.preventDefault();
      (event.currentTarget.parentElement?.children[order.indexOf(next)] as HTMLElement | undefined)?.focus();
      void selectKpi(next);
    };

    const pct = (value: number) => `${Number(value.toFixed(1))}${unitText(k)}`;
    const target = tgtValue(k);
    const yellowLine = k.dir === "lte" ? k.target * (1 + ylOffset / 100) : target * (1 - ylOffset / 100);
    const goalMarks: { key: string; text: string; value: number; tone: StateTone }[] = k.dir === "band"
      ? [{ key: "low", text: `下限 ${k.band?.[0]}${unitText(k)}`, value: k.band?.[0] ?? 0, tone: "ok" }, { key: "high", text: `上限 ${k.band?.[1]}${unitText(k)}`, value: k.band?.[1] ?? 0, tone: "ok" }]
      : [{ key: "target", text: `目标 ${target}${unitText(k)}`, value: target, tone: "ok" }, { key: "yellow", text: `接近线 ${pct(yellowLine)}`, value: yellowLine, tone: "warn" }];
    const trendOf = (index: number) => KPIS[index].points ? KPIS[index].spark : states[index] === "small" ? [] : KPIS[index].spark;
    // 有一项有不是 0 的数就留趋势列，画不出的行写原因；全是 0 或空着时整列收起，表下写一句。
    const showTrendColumn = KPIS.some((_, index) => trendOf(index).length >= 2 && trendOf(index).some((value) => value !== null && value !== 0));
    /** 不适用的一项各批都空着，不算进「有数值的批次」那句。 */
    const cohortValues = KPIS.flatMap((item, index) => item.scope === "NOT_APPLICABLE_TO_COHORT" ? [] : trendOf(index));
    const phaseEvent = phaseOn && PHASE_SWITCH_IDX >= 0 ? { index: PHASE_SWITCH_IDX, text: "运营阶段切换" } : undefined;

    // 指数只对单侧目标成立：越高越好算实际 ÷ 目标，越低越好算目标 ÷ 实际，高于 100 都是好于目标。
    // 健康带没有单一目标，不换算，按真实值和上下限单独画（DP-63）。
    const picks = ovlKpiIds.flatMap((id) => {
      const index = KPIS.findIndex((item) => item.n === id);
      const item = KPIS[index];
      return item && item.scope !== "NOT_APPLICABLE_TO_COHORT" ? [{ ...item, spark: trendOf(index) }] : [];
    });
    const bandPicks = picks.filter((item) => item.dir === "band");
    const compared = picks.filter((item) => item.dir !== "band").map((item, position) => ({
      item,
      slot: (position < 4 ? position + 1 : "other") as ChartSlot,
      values: item.spark.map((value) => value === null ? null : (item.dir === "lte" ? (item.target / value) * 100 : (value / item.target) * 100)),
    }));
    const drawable = compared.filter(({ item, values }) => (item.points || item.available !== false) && hasTrend(values) && values.every((value) => value === null || Number.isFinite(value)));
    const bandDrawable = bandPicks.filter((item) => (item.points || item.available !== false) && hasTrend(item.spark));
    const skipped = [...compared.filter((entry) => !drawable.includes(entry)).map(({ item }) => item), ...bandPicks.filter((item) => !bandDrawable.includes(item))];
    const drawnCount = drawable.length + bandDrawable.length;

    return (
      <>
        {red > 0
          ? <Conclusion state="danger" lead hint="点一行看原因。" explain="未达标的排在下面最前面。">关键指标：<b>{red}</b> 项未达标</Conclusion>
          : unavailable === applicableCount
            ? <Conclusion state="unknown" hint="各项都算不出或人数太少，点一行看原因。" explain={<>
                <p>来源不全：这批有用户缺注册记录或注册太早，算不出。</p>
                <p>观察期未满：用户注册时间太近，还不能算。</p>
                <p>样本过小：少于 5 人不显示，不下结论。</p>
                {count("uncollected") > 0 && <p>未采集：观察日在采集范围外。</p>}
                <p>没有数据：这个范围没有对应的用户。</p>
              </>}>关键指标：暂时无法判断</Conclusion>
            : green === applicableCount
              ? <Conclusion state="ok" hint="这页无需处理。">关键指标：全部达标</Conclusion>
              : <Conclusion state="neutral" explain={unavailable > 0 ? "有的项算不出或人数太少，不算达标。" : "接近目标的排在下面最前面。"}>关键指标：没有未达标的项</Conclusion>}

        <StatBand label="指标概览">
          <Stat lead={red === 0} label="已达标指标" value={green} unit={`/ ${applicableCount}`} tone={green > 0 ? "ok" : undefined} icon={CheckCircle2} iconTone="ok" explain={applicableCount < KPIS.length ? "满足对应指标的目标。创世节点售罄速度按注册批次看时不适用，不计入。" : "满足对应指标的目标。"} />
          <Stat label="接近目标的指标" value={yellow} tone={yellow > 0 ? "warn" : undefined} icon={Gauge} iconTone="warn"
            sub={<>距目标 {ylOffset}% 以内 · <button type="button" className="rd-link" onClick={() => setEditingOffset(true)}>调整接近范围</button></>}
            explain={`没达标，但离目标不超过 ${ylOffset}%；购买转化在健康带外也算这里。调整只改你看到的状态，不改业务规则。`} />
          <Stat label="暂无法判断" value={unavailable} tone={unavailable > 0 ? "done" : undefined} icon={CircleHelp} iconTone="done" sub={blankKinds.length ? blankSummary : "每项都算得出"} explain="来源不全、观察期未满、未采集、没有数据的算不出；样本过小的数值受保护。都不按 0% 算，也不算未达标。" />
          <Stat label="当前运营阶段" value={phaseKnown ? String(phase.code) : "未提供"} unit={phaseKnown ? `· ${String(phase.name ?? "")} · 第 ${num(phase.month, 0)} 月` : undefined} tone="role-2" icon={Flag}
            explain={PHASE_SWITCH_IDX >= 0 ? "趋势图已标出运营阶段切换时间。" : grouped ? "按注册批次看时图上不标阶段切换，切换时间到「运营阶段状态」看。" : "当前时间范围内没有阶段切换记录。"} />
        </StatBand>

        <div className="rd-split" data-detail="">
          <Panel title="七项指标" sub={applied.granularity ? `${regTime(applied)} · 按${GROUP_NAME[applied.granularity]} · ${WEEKS.length} 批` : undefined} explain="未达标的排在前面，点一行看明细。" icon={ListChecks} tone="role-2" flush>
            <Table label="选择要查看的关键指标" rowFocus data-tight={showTrendColumn ? "" : undefined}>
              <thead><tr>
                <Th>指标</Th>
                <Th align="right">{grouped ? <>汇总<Explain label="汇总怎么算" content="所选范围内注册的全部用户合起来算一个数，不是最近一批。各批次的数在明细的「各批次」里。" /></> : "当前值"}</Th>
                <Th align="right">目标</Th>
                {showTrendColumn && <Th>趋势</Th>}
                <Th>状态</Th>
              </tr></thead>
              <tbody>
                {order.map((index) => {
                  const item = KPIS[index];
                  const state = states[index];
                  return (
                    <Tr key={item.n} selected={index === safeSelKpi} tabIndex={index === safeSelKpi ? 0 : -1} onOpen={() => { void selectKpi(index); revealDetail(); }} onKeyDown={moveRow} title="点击查看明细">
                      <Td><Cell main={<AutoGloss>{operatorCopyText(item.name)}</AutoGloss>} /></Td>
                      <Td align="right"><Cell num main={item.value == null ? "—" : `${item.value}${unitText(item)}`} sub={isPartial(item) ? "暂定" : blankState(item) || (item.momDelta == null && !item.previousSuppressed) ? undefined : deltaText(item)} /></Td>
                      <Td align="right"><Cell num main={tgtShort(item)} /></Td>
                      {showTrendColumn && <Td>{state === "inapp"
                        ? <span className="rd-note">—</span>
                        : hasTrend(item.spark) && item.spark.includes(null)
                          ? <Sparkline label={`${operatorCopyText(item.name)}的走势，算不出的批次留空`} values={item.spark} />
                        : hasTrend(item.spark)
                        ? <Sparkline label={`${operatorCopyText(item.name)}的走势`} values={item.spark} />
                        : allZero(item.spark)
                          ? <span className="rd-note">{flatText(item.spark)}</span>
                          : <span className="rd-note" data-proof="l1-kpi-trend-unavailable">{item.spark.length === 1 ? "只有 1 批" : flatText(item.spark)}</span>}</Td>}
                      <Td><StatusTag tone={STATE_TONE[state]}>{stateText(state, item)}</StatusTag></Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            {!showTrendColumn && (WEEKS.length === 0
              ? <p className="rd-note rd-panel-foot" data-proof="l1-kpi-trend-unavailable">这个范围没有注册批次，没有走势。</p>
              : WEEKS.length === 1
              ? <p className="rd-note rd-panel-foot" data-proof="l1-kpi-trend-unavailable">只有 1 个注册批次（{WEEKS[0]}），没有走势可画。</p>
              : allZero(cohortValues)
              ? <p className="rd-note rd-panel-foot">{cohortValues.every((value) => value === 0) ? "每项指标每批都是 0" : "有数值的批次都是 0"}，没有走势可画。</p>
              : <p className="rd-note rd-panel-foot" data-proof="l1-kpi-trend-unavailable">各批次都算不出数值，画不出走势；点一行看原因。</p>)}
          </Panel>

          <Panel
            id={DETAIL_ID}
            title={<AutoGloss>{operatorCopyText(k.name)}</AutoGloss>}
            sub={<StatusTag tone={STATE_TONE[kState]}>{stateText(kState, k)}</StatusTag>}
            icon={Target}
            tone={STATE_TONE[kState]}
            actions={attributionLinks.filter((j) => reach(j.href, ATTRIBUTION_ROUTE_READ[j.href])).map((j) => (
              <Link key={j.label} className="rd-link" href={j.href}>去「{findByPath(j.href)?.l2.name ?? j.label}」查原因</Link>
            ))}
          >
            <div className="rd-stack">
              {k.available && (
                <ThresholdMeter
                  label={grouped ? "汇总和目标" : "当前值和目标"}
                  rows={[{ key: "now", label: grouped ? "汇总" : "当前", value: k.value!, text: `${k.value}${unitText(k)}`, tone: STATE_TONE[kState] }]}
                  marks={goalMarks}
                />
              )}
              <Facts>
                {!k.available && <Fact k={grouped ? "汇总" : "当前值"}>—</Fact>}
                {!k.available && <Fact k="目标值">{tgtShort(k)}</Fact>}
                {k.available && <Fact k="分子">{ext.num}</Fact>}
                {k.available && <Fact k="分母">{ext.den}</Fact>}
                {k.available && <Fact k="较上期">{k.scope ? "按注册批次看时不比较" : deltaText(k).replace(/^较上期 ?/, "")}</Fact>}
                <Fact k="统计范围">{queryScope(applied)}</Fact>
              </Facts>
              <p className="rd-note">解读：{kState === "small" ? <>人数太少，不下结论<Explain label="样本过小的说明" content={SMALL_SAMPLE_NOTE} /></> : <AutoGloss>{operatorCopyText(ext.note)}</AutoGloss>}</p>
              {isPartial(k) && <p className="rd-note">{PARTIAL_TEXT}</p>}
              {drillError
                ? <BlockState state="error" title="明细和趋势暂时加载不出来" detail={`其他内容不受影响。${drillError}`} onRetry={() => void selectKpi(safeSelKpi)} />
                : kState === "inapp"
                  ? null
                  : hasTrend(k.spark)
                  ? <Panel plain headingLevel={3} title={grouped ? `各注册${unitName}的走势` : "最近在变好还是变坏"} explain={grouped ? `每个点是同一${unitName}注册的用户。空着的批次算不出，原因见「各批次」。` : "所选时间范围等分六段。"}>
                      <TrendLines
                        label={`${operatorCopyText(k.name)}的走势`}
                        ticks={TICKS}
                        format={pct}
                        series={[{ key: "kpi", label: operatorCopyText(k.name), slot: 2, values: k.spark }]}
                        marks={goalMarks}
                        event={phaseEvent}
                      />
                      {partialEdges.length > 0 && <p className="rd-note">{partialEdges.map((point) => point.bucketKey).join("、")} 不完整：只含所选范围内注册的用户。</p>}
                    </Panel>
                  : <p className="rd-note">{points.length === 1 ? `只有 1 个注册批次（${points[0].bucketKey}），数值就是上面的汇总。` : points.length === 0 ? grouped ? "这个范围没有注册批次。" : k.sparkUnavailableReasons?.includes("DAU_NOT_COLLECTED") ? BLANK_TEXT.uncollected : flatText(k.spark) : allZero(k.spark) ? `${flatText(k.spark)}，没有走势可画。` : k.spark.every((point) => point === null) ? "各批次都算不出，原因见「各批次」。" : "有数值的批次不到 2 个，画不出走势。"}</p>}
              {points.length > 0 && kState !== "inapp" && (
                <Fold inset title="各批次" summary={`${points.length} 批 · ${points.filter((point) => point.value !== null).length} 批有数值`}>
                  <div className="rd-stack">
                    <Table label={`${operatorCopyText(k.name)}的各注册批次`}>
                      <thead><tr><Th>注册{unitName}</Th><Th>注册时间（{businessZone().label}）</Th><Th align="right">数值</Th><Th>状态</Th></tr></thead>
                      <tbody>
                        {points.map((point) => {
                          const state = pointStatus(k, point, ylOffset);
                          return (
                            <Tr key={point.bucketKey}>
                              <Td><Cell main={point.bucketKey} sub={point.partial ? "不完整" : undefined} /></Td>
                              <Td><Cell main={regSpan(String(point.selectedFrom), String(point.selectedToExclusive))} /></Td>
                              <Td align="right"><Cell num main={point.value == null ? "—" : `${point.value}${unitText(k)}`} sub={isPartial(point) ? "暂定" : undefined} /></Td>
                              <Td><StatusTag tone={STATE_TONE[state]}>{stateText(state, k)}</StatusTag></Td>
                            </Tr>
                          );
                        })}
                      </tbody>
                    </Table>
                    <PaginationExemptionList items={[{ label: "关键指标 注册批次表", kind: "fixed-matrix", maxRows: 60, reason: "注册批次最多 60 个，超过时后端直接拒绝" }]} />
                  </div>
                </Fold>
              )}
              <Fold inset title="这项指标怎么算" summary={`指标 ${k.n} 的公式和开放批次`} explain={<AutoGloss>这项指标怎么算 · 统计规则统一管理,这里只能看不能改</AutoGloss>}>
                <div className="rd-stack">
                  <div>{formula(ext)}</div>
                  <p className="rd-note">开放批次：{batchText(k.vis)}</p>
                </div>
              </Fold>
            </div>
          </Panel>
        </div>

        {showTrendColumn && <Fold title="这几项相对目标在变好还是变坏" icon={Activity} tone="role-2" summary={drawnCount ? `已选 ${picks.length} 项，画出 ${drawnCount} 项` : `已选 ${picks.length} 项，没有走势可画`}
          explain={<>
            <p>{grouped ? "至少留一项。对比多个指标在各注册批次的走向，看是哪一批变了。" : "至少留一项。对比多个指标的趋势，观察运营阶段切换后的变化；原因可到「运营阶段状态」或「运营阶段设置」查看。按行为记录中的运营阶段统计。"}</p>
            <p>高于 100 是好于目标。越高越好的指标算实际值 ÷ 目标值，越低越好的算目标值 ÷ 实际值，只看各自的走向，不比谁离目标远。</p>
          </>}>
          <div className="rd-stack">
            <div role="group" aria-label="要比的指标" className="rd-filter-more-row">
              {order.map((index) => {
                const item = KPIS[index];
                const on = ovlKpiIds.includes(item.n);
                // 不适用的一项不能勾，保存过的勾选留在视图里，不画（画图集合已排除它）。
                if (item.scope === "NOT_APPLICABLE_TO_COHORT") return <Check key={item.n} label={`#${item.n} ${operatorCopyText(item.name)}`} checked={false} disabled explain="按注册批次看时不适用。" onChange={() => undefined} />;
                return <Check key={item.n} label={`#${item.n} ${operatorCopyText(item.name)}`} checked={on} disabled={on && picks.length === 1} onChange={() => setOvlKpiIds((current) => (on ? current.filter((id) => id !== item.n) : [...current, item.n]))} />;
              })}
            </div>
            {drawable.length > 0 && (
              <Figure width={640} graphic={<TrendLines
                label="多个关键指标的对比趋势"
                ticks={TICKS}
                format={(value) => value.toFixed(0)}
                series={drawable.map(({ item, slot, values }) => ({ key: String(item.n), label: `#${item.n} ${operatorCopyText(item.name)}`, slot, values }))}
                marks={[{ key: "target", text: "100 = 等于目标", value: 100, tone: "ok" }]}
                event={phaseEvent}
              />}>
                <Table label={grouped ? "对比指标的最近一批" : "对比指标的最新值"}>
                  <thead><tr><Th>指标</Th><Th align="right">{grouped ? <>最近一批<Explain label="最近一批是哪一批" content="图上最后一个有数值的注册批次，和图上最后一个点是同一个数；距目标也按它算。整个范围的汇总在上面「七项指标」。" /></> : "最新"}</Th><Th align="right">距目标</Th></tr></thead>
                  <tbody>
                    {drawable.map(({ item, slot }) => {
                      const last = lastPoint(item);
                      const shown = item.points ? last ? { ...item, value: last.value } : null : item;
                      return (
                        <Tr key={item.n}>
                          <Td><span className="rd-chart-swatch" data-slot={slot} />#{item.n} {operatorCopyText(item.name)}</Td>
                          <Td align="right">{shown
                            ? <Cell num main={shown.value == null ? "—" : `${shown.value}${unitText(item)}`} sub={last ? pointNote(last) : undefined} />
                            : <StatusTag tone="done">{stateText(pointStatus(item, item.points![item.points!.length - 1], ylOffset), item)}</StatusTag>}</Td>
                          <Td align="right"><Cell num main={shown ? targetGap(shown) : "—"} /></Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              </Figure>
            )}
            {bandDrawable.map((item) => (
              <Panel key={item.n} plain headingLevel={3} title={`${operatorCopyText(item.name)}有没有在健康带里`} explain="没有单一目标，按真实值画。">
                <Figure width={640} graphic={<TrendLines
                  label={`${operatorCopyText(item.name)}和健康带`}
                  ticks={TICKS}
                  format={(value) => `${Number(value.toFixed(1))}${unitText(item)}`}
                  series={[{ key: String(item.n), label: operatorCopyText(item.name), slot: 2, values: item.spark }]}
                  marks={[{ key: "low", text: `下限 ${item.band?.[0]}${unitText(item)}`, value: item.band?.[0] ?? 0, tone: "ok" }, { key: "high", text: `上限 ${item.band?.[1]}${unitText(item)}`, value: item.band?.[1] ?? 0, tone: "ok" }]}
                  event={phaseEvent}
                />}>
                  <Facts>
                    {item.points
                      ? (() => { const last = lastPoint(item); return <Fact k="最近一批">{last ? `${last.value}${unitText(item)}（${pointNote(last)}）` : stateText(pointStatus(item, item.points[item.points.length - 1], ylOffset), item)}</Fact>; })()
                      : <Fact k="最新">{item.value == null ? "—" : `${item.value}${unitText(item)}`}</Fact>}
                    <Fact k="健康带">{tgtShort(item)}</Fact>
                  </Facts>
                </Figure>
              </Panel>
            ))}
            {drawnCount === 0 && <p className="rd-note">当前所选指标没有可绘制的对比曲线。</p>}
            {skipped.length > 0 && <Fold inset title="未绘制的指标" summary={`${skipped.length} 项`}>
              <RecordList label="未绘制的指标" records={skipped.map((item) => ({
                id: String(item.n),
                value: `#${item.n} ${operatorCopyText(item.name)}`,
                object: flatText(item.spark),
              }))} />
            </Fold>}
          </div>
        </Fold>}

        <Fold title="指标规则表" icon={Lock} summary={`${KPIS.length} 项 · 算法和目标已锁定`}
          explain={<>
            <p><AutoGloss>每项关键指标怎么算一目了然 · 要改算法须走事件统计规则管理 + 操作确认,本页改不了</AutoGloss></p>
            <p><AutoGloss>推广率表示发出过邀请的设备持有者占比；各项指标的可用性和统计范围以当前读到的数据为准。</AutoGloss></p>
          </>}>
          <div className="rd-stack">
            <Table label="关键指标的计算方式">
              <thead><tr><Th>#</Th><Th>指标</Th><Th>计算方式</Th><Th align="right">目标</Th><Th>开放批次</Th></tr></thead>
              <tbody>
                {KPIS.map((item) => (
                  <Tr key={item.n}>
                    <Td><Cell num main={item.n} /></Td>
                    <Td><Cell main={<AutoGloss>{operatorCopyText(item.name)}</AutoGloss>} /></Td>
                    <Td className="l1-rule-fx"><Cell full main={<><AutoGloss>{operatorCopyText(KPI_PLAIN[item.kpiId] ?? "")}</AutoGloss><Explain label={`${operatorCopyText(item.name)}的公式`} content={formula(KPI_EXT[item.kpiId])} /></>} /></Td>
                    <Td align="right"><Cell num main={tgtShort(item)} /></Td>
                    <Td><Cell main={batchText(item.vis)} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <PaginationExemptionList items={[{ label: "关键指标 统计规则锁定表", kind: "reference-catalog", maxRows: L1_KPI_IDS.length, reason: "七项关键指标 为固定验收统计规则,需要同屏锁定算式和状态" }]} />
          </div>
        </Fold>

        <div className="rd-links">
          <span>相关页面</span>
          {RELATED.filter((href) => reach(href, ATTRIBUTION_ROUTE_READ[href])).map((href) => <Link key={href} className="rd-link" href={href}>{findByPath(href)?.l2.name}</Link>)}
        </div>
      </>
    );
  };

  const firstError = refreshError || ctx.biError;
  const asOfText = data?.observationAsOf ? instantStamp(data.observationAsOf) : "";
  const shownScope = applied.granularity ? `${GROUP_NAME[applied.granularity]}、${timeName(applied)}` : timeName(applied);
  const body = rawKpis.length
    ? report()
    : liveTotals.length
      ? <L1LiveTotals metrics={liveTotals} />
      : refreshing || ctx.biLoading
        ? <BlockState state="loading" title="正在加载…" />
        : firstError
          ? <BlockState state="error" title="关键指标加载失败" detail={firstError} onRetry={retryFirstRead} retryLabel="重新加载" />
          : <BlockState state="empty" title="这个范围还没有指标数据" detail="请先刷新；仍然为空，说明还没有产生数据。" onRetry={retryFirstRead} retryLabel="重新加载" />;

  return (
    <>
      <PageHeader
        pageId="L1"
        title={title}
        summary={<AutoGloss>{summary}</AutoGloss>}
        actions={exporting.button}
        meta={<span className="rd-toolbar">
          {asOfText
            ? <span>数据截至 {asOfText}（{businessZone().label}）<Explain label="数据时间说明" content="只算这个时间之前发生的事。打开时读取，不自动刷新；点「刷新」算到最新。" /></span>
            : readAt && <span>{readAt} 读取（{businessZone().label}）<Explain label="数据时间说明" content="打开时读取，不自动刷新；点「刷新」重读。" /></span>}
          <Button variant="ghost" size="sm" loading={refreshing} icon={<RefreshCw size={14} aria-hidden />} onClick={() => reloadKpi({ ...applied, asOf: undefined })}>刷新</Button>
        </span>}
        readOnly={ctx.canExport ? undefined : "只能查看，导出需报表管理权限"}
      />
      {exporting.notices}
      {queryBar}
      {refreshError && rawKpis.length > 0 && (
        <Notice tone="warn" title="关键指标刷新失败" action={<Button size="sm" onClick={retryLast}>重试</Button>}>
          下面仍是{shownScope}、截至 {asOfText || readAt} 的数据，条件没有切换。{refreshError}
        </Notice>
      )}
      {body}
      {editingOffset && <OffsetModal current={ylOffset} onClose={() => setEditingOffset(false)} onApply={(next) => { setYlOffset(next); ctx.toast(`接近目标的范围 → 距目标 ${next}% · 只改显示`, "success"); }} />}
    </>
  );
}
