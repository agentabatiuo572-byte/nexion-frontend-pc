"use client";
import { useReach } from "@/lib/nav/use-reach";
import { operatorCopyText } from "@/lib/admin/operator-copy";

/**
 * L1 · 关键指标（报表页样板）。查询条 → 结论 → 四张概览卡 → 八项指标 ┬ 所选指标明细 → 折叠组 → 相关页面。
 * 状态只用 kpiState 的现有比较，分母少于 5 算样本过小（T10、今日概览决定 8）；口径与目标只读锁定，页面没有修改入口。
 * 查询状态写网址（ST-23），优先于本机保存的视图；导出由操作者填理由（OP-115），文件到 L5 下载。
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { Activity, CheckCircle2, CircleHelp, Download, Flag, Gauge, ListChecks, Lock, SlidersHorizontal, Target } from "lucide-react";
import { AutoGloss } from "@/app/components/kit/gloss";
import type { KpiTrendPoint } from "@/lib/admin/kpi-trend";
import { nextTabValue } from "@/app/components/kit/tab-group-keyboard";
import { BlockState, Button, Cell, Check, Conclusion, DiffField, Explain, Fact, Facts, FilterBar, FilterField, Fold, Input, Modal, Notice, NumberInput, PageHeader, Panel, ReleaseModal, Segments, Select, Sparkline, Stat, StatBand, StatusTag, Table, Td, Th, ThresholdMeter, Tr, TrendLines, type ChartSlot, type StateTone } from "@/app/components/rd";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { businessClock, businessDay, businessZone, formatBusinessTimeFull } from "@/lib/admin/business-time";
import { findByPath } from "@/lib/nav/console-nav";
import { PaginationExemptionList } from "../design-kit";
import { kpiState, num, rec, rows, strings, type KpiRow } from "./live-data";
import { readL1LiveTotals } from "./l1-l2-live-data";
import { L1LiveTotals } from "./l1-l2-live-fallback";
import type { LCtx } from "./types";
import { fetchL1Kpi, fetchL1KpiDrilldown, fetchL1KpiTrend, isLOutcomeUnknownError, type L1KpiQuery, type LReportCreateInput } from "@/lib/admin/l-client";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { validateL1Dashboard, validateL1Drilldown, validateL1Trend } from "./l1-kpi-contract";
import { L1_EXPORT_RECIPIENT, l1ReportInput, resolveL1ExportMode, resolveL1ExportUnavailableReason, type L1ExportMode, type L1ExportSource } from "./l1-export-contract";
import { loadL1LocalView, saveL1LocalView, type L1Window } from "./l1-local-view";
import { createL1ReadController } from "./l1-request-generation";
import { ATTRIBUTION_ROUTE_READ, assertL1AttributionLinks } from "./l-attribution-routes";

type Kpi = Omit<KpiRow, "value" | "spark"> & {
  value: number | null;
  spark: KpiTrendPoint[];
  sparkSuppressed?: boolean[];
  suppressed?: boolean;
  previousSuppressed?: boolean;
  available?: boolean;
  unavailableReason?: string;
  status?: string;
  momDelta?: number | null;
  numerator?: number | null;
  denominator?: number | null;
};
type KpiExt = {
  fx: string;
  fxBold: string[];
  num: string | null;
  den: string | null;
  delta: string;
  note: string;
  jump: { label: string; href?: string }[];
};
const tgtLabel = (k: Kpi) => {
  const [low = 0, high = 0] = k.band ?? [];
  return k.dir === "band" ? `健康带 ${low}–${high}${k.unit === "d" ? "天" : k.unit}` : `目标 ${k.dir === "lte" ? "< " : "> "}${k.target}${k.unit === "d" ? "天" : k.unit}`;
};
const tgtValue = (k: Kpi) => (k.dir === "band" ? (k.band?.[0] ?? k.target) : k.target);

type KpiState = "g" | "y" | "r" | "na" | "small";
const SMALL_SAMPLE = 5;
const unitText = (k: Kpi) => (k.unit === "d" ? "天" : k.unit);
const tgtShort = (k: Kpi) => tgtLabel(k).replace("目标 ", "").replace("健康带 ", "");
const kpiStatus = (k: Kpi, offset: number): KpiState => {
  if (k.suppressed) return "small";
  if (k.available === false || k.value == null) return "na";
  return k.denominator != null && k.denominator < SMALL_SAMPLE ? "small" : kpiState({ ...k, value: k.value }, offset);
};
const STATE_TONE: Record<KpiState, StateTone> = { g: "ok", y: "warn", r: "danger", na: "done", small: "done" };
const stateText = (state: KpiState, k: Kpi) => ({ g: "达标", y: k.dir === "band" ? "在健康带外" : "接近目标", r: "未达标", na: "暂无法计算", small: "样本过小" })[state];
/** 未达标排最前，其次接近目标、暂无法计算和样本过小，达标的放最后；同一档按指标编号。 */
const STATE_RANK: Record<KpiState, number> = { r: 0, y: 1, na: 2, small: 2, g: 3 };
/** 后端的不可用原因写成人话，事实来自 L1KpiAnalytics 的分母。 */
const REASON_TEXT: Record<string, string> = {
  NO_REGISTRATION_DENOMINATOR: "这个范围没有注册完成的用户，所以暂无法计算，不按 0% 算。",
  NO_STORE_VIEW_DENOMINATOR: "这个范围没有看过商城的用户，所以暂无法计算，不按 0% 算。",
  NO_DEVICE_HOLDER_DENOMINATOR: "这个范围没有设备持有者，所以暂无法计算，不按 0% 算。",
  NO_PUSH_SENT_DENOMINATOR: "这个范围没有收到推送的用户，所以暂无法计算，不按 0% 算。",
  NO_DIRECT_REFERRAL_DENOMINATOR: "这个范围没有直接邀请的好友，所以暂无法计算，不按 0% 算。",
  NO_MATURE_DAY7_COHORT: "这个范围还没有注册满 7 天的用户，所以暂无法计算，不按 0% 算。",
  NO_GENESIS_PURCHASES: "这个范围没有创世节点购买记录，还没售罄，售罄天数暂无法计算。",
  GENESIS_NOT_SOLD_OUT: "创世节点还没累计售出 1,000，售罄天数暂无法计算。",
};
const SMALL_SAMPLE_NOTE = "这个范围人数不到 5，比例没有参考意义，不算达标也不算未达标。换个更长的时间范围再看。";
/** 「V1 实时」是 PRD 的上线批次（§1.6 后台可见性），不是刷新方式。 */
const batchText = (vis = "") => vis.replace(/^V(\d+).*$/, "第 $1 批");
const WINDOW_NAME: Record<Exclude<L1Window, "custom">, string> = { "1d": "近 24 小时", "7d": "近 7 天", "30d": "近 30 天" };
const SLICES = ["cohort", "phase", "locale", "ref"] as const;
const SLICE_NAME = { cohort: "注册周", phase: "运营阶段", locale: "语言", ref: "渠道" } as const;
const URL_KEYS = ["window", "from", "to", ...SLICES] as const;
const COHORT_FORMAT = /^\d{4}-W\d{2}$/;
const RELATED = ["/analytics/funnel-cohort", "/analytics/financial", "/analytics/operations"] as const;
/** 全是 0 不是走势，不画图，写一句话（DP-62）。 */
const hasTrend = (values: readonly KpiTrendPoint[]) => values.length >= 2 && values.some((value) => value !== null && value !== 0);
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
  return `较上期 ${k.momDelta > 0 ? "+" : ""}${k.momDelta} ${k.unit === "%" ? "个百分点" : unitText(k)}`;
}

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
  (["from", "to", ...SLICES] as const).forEach((key) => { if (query[key]) url.searchParams.set(key, String(query[key])); });
  window.history.replaceState(window.history.state, "", url);
}

function queryScope(query: L1KpiQuery) {
  const time = query.window === "custom" ? `${query.from} 至 ${query.to}` : WINDOW_NAME[query.window ?? "7d"];
  return [time, ...SLICES.filter((key) => query[key]).map((key) => `${SLICE_NAME[key]} ${query[key]}`)].join("，");
}

type L1PendingExport = PendingMutationRecord & { label: string; mode: L1ExportMode; input: LReportCreateInput; reason: string };

const EXPORT_SCOPE = "l1-export";
const EXPORT_PAGE = "/analytics/export";
/** 结果未知时原内容、理由和命令号都留着，刷新后还能原样重试，不铸新号（OP-93、OP-94）。 */
const pendingExports = createPendingMutationStore<L1PendingExport>({
  storageKey: "nexion-admin-l1-export-commands-v1",
  retainExpiredRecords: true, // 过期不能重试，但记录和导出锁都留着（OP-96）
  isValidRecord: (record) => typeof record.label === "string" && typeof record.reason === "string" && record.reason.length > 0
    && (record.mode === "series" || record.mode === "snapshot" || record.mode === "totals")
    && !!record.input && typeof record.input === "object",
});

/** 导出的全部状态：按钮、确认框、待确认条、成功条。写法同提现审核的 sendCommand、retryPending、releasePending。 */
function useL1Export(ctx: LCtx, source?: L1ExportSource | null) {
  const reach = useReach();
  const [pending, setPending] = useState<L1PendingExport | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryRejected, setRetryRejected] = useState(false);
  const [retryNote, setRetryNote] = useState("");
  const [releasing, setReleasing] = useState(false);
  const [finished, setFinished] = useState<L1ExportMode | null>(null);
  const syncPending = () => setPending(pendingExports.list()[0] ?? null);
  useEffect(syncPending, []);

  const sourceUnavailable = Boolean(ctx.biError || ctx.biLoading || (source && source.status !== "ready"));
  const exportData = source ? source.data : ctx.biData?.l1;
  const exportMode = resolveL1ExportMode(exportData, sourceUnavailable);
  const exportUnavailableReason = resolveL1ExportUnavailableReason(
    exportData, ctx.biLoading ? "loading" : ctx.biError ? "error" : source?.status ?? "ready",
  );
  const query = source?.query ?? { window: "7d" as const };
  const pageName = findByPath(EXPORT_PAGE)?.l2.name ?? "数据导出与监管报告";
  const exportPage = (text: string) => (reach(EXPORT_PAGE, "bi_l5_read")
    ? <Link className="rd-link" href={EXPORT_PAGE}>{text}</Link>
    : `你没有「${pageName}」的权限，请找有权限的同事处理。`);

  const send = async (mode: L1ExportMode, input: LReportCreateInput, reason: string, label: string) => {
    const createReport = ctx.biActions?.createReport;
    if (!createReport) throw new Error("关键指标暂时不能导出，请刷新后再试");
    const retained = pendingExports.get(EXPORT_SCOPE);
    const key = retained ?? `l1-export-${crypto.randomUUID()}`;
    pendingExports.remember(EXPORT_SCOPE, key, { label, mode, input, reason });
    if (!pendingExports.isDurablyStored(EXPORT_SCOPE, key)) {
      pendingExports.forget(EXPORT_SCOPE, key);
      throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
    }
    try {
      await createReport(input, reason, key);
    } catch (cause) {
      const unknown = isLOutcomeUnknownError(cause);
      if (!unknown && !retained) pendingExports.forget(EXPORT_SCOPE);
      syncPending();
      if (!unknown) throw cause;
      ctx.toast("结果未确认，不要重复导出。到页面上方按原操作重试。");
      return;
    }
    pendingExports.forget(EXPORT_SCOPE);
    syncPending();
    setRetryRejected(false);
    setRetryNote("");
    setFinished(mode);
    await ctx.reloadBi?.();
    ctx.toast(reach(EXPORT_PAGE, "bi_l5_read") ? `已提交导出，生成后到「${pageName}」下载` : "已提交导出，文件生成后才能下载");
  };

  const openConfirm = (mode: L1ExportMode) => {
    const rows = mode === "totals" ? `${readL1LiveTotals(exportData).length} 行，一个累计数一行` : "8 行，一项指标一行";
    ctx.openActionConfirm({ briefKind: "export",
      action: "导出关键指标",
      detail: `聚合数据，不含用户隐私。提交后生成任务，文件到「${pageName}」下载。`,
      statedBrief: { impact: "生成一个导出任务，不改任何数据，操作记录里留痕。", check: "看时间范围对不对，理由写这份数据给谁、做什么用。" },
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      reasonPlaceholder: "写这份数据给谁、做什么用，例如：给增长组做周会复盘",
      facts: (
        <Facts>
          <Fact k="文件内容">{mode === "series" ? "8 项指标的可用数值、目标和六段趋势；受保护项标为样本过小，相关数值留空" : mode === "snapshot" ? "8 项指标的可用数值、目标和可用性；受保护项标为样本过小，相关数值留空" : "当前累计数"}</Fact>
          <Fact k="范围">{mode === "totals" ? "当前累计" : queryScope(query)}</Fact>
          <Fact k="接收人">{L1_EXPORT_RECIPIENT}</Fact>
          <Fact k="文件行数">{rows}，另有表头</Fact>
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
    setRetrying(true);
    setRetryRejected(false);
    setRetryNote("");
    try {
      await send(record.mode, record.input, record.reason, record.label);
    } catch (cause) {
      setRetryNote(`重试被拒绝：${cause instanceof Error ? displayAdminError(cause) : "原因未知"} 这说明不了原操作的结果，原操作继续保留。`);
      setRetryRejected(true);
    } finally {
      setRetrying(false);
    }
  };

  /** 只放开这页的锁，不发请求，不写操作记录。 */
  const release = (record: L1PendingExport) => {
    pendingExports.forget(record.fingerprint, record.commandKey);
    syncPending();
    setRetryRejected(false);
    setRetryNote("");
    setReleasing(false);
    ctx.toast("已解除待确认，可以重新导出");
  };

  const expired = pending ? pending.expiresAt <= Date.now() : false;

  return {
    button: ctx.canExport ? (<>
      <Explain label="导出的说明" content="要填理由，生成下载任务，留操作记录。" />
      <Button
        icon={<Download size={14} aria-hidden />}
        disabledReason={pending ? "上一次导出结果未确认，先处理页面上方的待确认" : exportMode === null || ctx.biLoading ? exportUnavailableReason : undefined}
        onClick={() => { if (exportMode) { setFinished(null); openConfirm(exportMode); } }}
      >
        {exportMode === "series" ? "导出关键指标序列 CSV" : "导出关键指标当前汇总 CSV"}
      </Button>
    </>) : null,
    notices: <>
      {pending && (
        <Notice tone="warn" title={`${pending.label} · 结果未确认`} action={<>
          {!expired && <Button size="sm" loading={retrying} disabledReason={!ctx.canExport ? "这个账号已没有导出权限，请有权限的同事处理" : undefined} onClick={() => void retry(pending)}>按原操作重试</Button>}
          {!expired && retryRejected && <Button size="sm" disabled={retrying} onClick={() => setReleasing(true)}>解除待确认</Button>}
        </>}>
          {formatBusinessTimeFull(new Date(pending.createdAt).toISOString(), "—")}（{businessZone().label}）发出，任务可能已经生成，不要重新导出。{expired ? "已超过 24 小时，不能再重试，请到操作记录与审批核对。" : !ctx.canExport ? "这个账号已没有导出权限，不能重试，请有权限的同事处理。" : "重发原内容，已成功的不会重复执行。"}{exportPage(`到「${pageName}」核对`)}
          <Explain label="技术信息" content={`命令号 ${pending.commandKey} ｜ 理由 ${pending.reason}`} />
          {!expired && retryNote && <div>{retryNote}</div>}
        </Notice>
      )}
      {finished && !pending && (
        <Notice tone="ok" title={finished === "series" ? "关键指标趋势已提交导出" : "关键指标当前汇总已提交导出"} action={<Button size="sm" onClick={() => setFinished(null)}>知道了</Button>}>
          任务生成后才能下载。{exportPage(`到「${pageName}」下载`)}
        </Notice>
      )}
      {releasing && pending && <ReleaseModal label={pending.label} onCancel={() => setReleasing(false)} onConfirm={() => release(pending)} explain={`重试被拒说明不了原操作的结果，先到「${pageName}」确认任务有没有生成。解除后原操作不再重试。`} />}
    </>,
  };
}

/** fx 公式渲染:fxBold 词高亮(cyan b),其余纯文本。 */
function renderFx(fx: string, bold: string[]) {
  const firstYield = /^device\.first_yield_received\.latency_sec ≤ ([0-9.]+) ÷ auth\.register_completed$/.exec(fx);
  fx = firstYield ? `${firstYield[1]} 秒内收到首笔收益的人数 ÷ 注册完成人数` : ({
    "day7 app.dau ÷ register cohort": "注册满 7 天当日的活跃人数 ÷ 同批注册人数",
    "store.viewed distinct user ÷ auth.register_completed": "浏览商城的去重用户数 ÷ 注册完成人数",
    "checkout.completed ÷ store.viewed": "支付完成的去重用户数 ÷ 浏览商城的去重用户数",
    "device holder referral.invite_sent ÷ device holders": "发出邀请的设备持有者人数 ÷ 设备持有者人数",
    "nova.push_clicked ÷ nova.push_sent": "点击推送的去重用户数 ÷ 收到推送的去重用户数",
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
      footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabledReason={problem} onBlockedClick={() => setAttempted(true)} onClick={() => { onApply(next); onClose(); }}>应用 · 实时生效</Button></>}>
      <div className="rd-stack">
        {/* 现在值、新值输入合成一块（VS-103）。刚打开不报错，失焦且填过或点过提交才用警告色（OP-15）。 */}
        <DiffField before={String(current)} unit="%" hint="5–20 的整数" error={attempted || (left && typed) ? problem : undefined}>
          {(control) => <NumberInput {...control} unit="%" min={5} max={20} step={1} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => setLeft(true)} />}
        </DiffField>
        <Fold inset title="查看业务规则详情" summary="状态怎么判定">
          <p className="rd-note">单侧指标须严格高于或低于目标值才达标；等于目标时算接近目标。数值越高越好的指标，接近线为目标值 × (1 − N%)；数值越低越好的指标，接近线为目标值 × (1 + N%)。没达标但在接近线以内（含接近线）算接近目标，超出算未达标。购买转化健康带包含两端，带外也归接近目标。只影响显示，不改指标值。</p>
        </Fold>
      </div>
    </Modal>
  );
}

export function L1Kpi({ ctx, onExportSource, source, title, summary }: { ctx: LCtx; onExportSource?: (source: L1ExportSource) => void; source?: L1ExportSource | null; title: ReactNode; summary: string }) {
  const reach = useReach();
  const exporting = useL1Export(ctx, source);
  const [picked, setPicked] = useState<number | null>(null); // 没点过时跟着排在最前的那一项
  const [ylOffset, setYlOffset] = useState(10);
  const [phaseOn, setPhaseOn] = useState(true);
  const [ovlSel, setOvlSel] = useState<number[]>([1, 2, 3]);
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
  const [applied, setApplied] = useState<L1KpiQuery>({ window: "7d" }); // 屏幕上这份数据的条件（ST-18）
  const [queryNotice, setQueryNotice] = useState("");
  const [localData, setLocalData] = useState<Record<string, unknown> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [readAt, setReadAt] = useState("");
  const [drillKpi, setDrillKpi] = useState<Kpi | null>(null);
  const [drillTrend, setDrillTrend] = useState<{ values: KpiTrendPoint[]; suppressedPoints?: boolean[] } | null>(null);
  const [drillError, setDrillError] = useState("");
  const l1Requests = useRef(createL1ReadController());
  const selectedQuery = useRef<L1KpiQuery>({ window: "7d" });
  const urlToWrite = useRef<L1KpiQuery | null>(null); // 用户发起、结果还没写进网址的那次查询
  const drillRead = useRef(0);

  useEffect(() => {
    l1Requests.current.invalidate();
    drillRead.current += 1;
    setDrillKpi(null);
    setDrillTrend(null);
    setDrillError("");
    setRefreshError("");
    const parentData = ctx.biData?.l1;
    const query = selectedQuery.current;
    const hasSelection = query.window !== "7d" || Boolean(query.from || query.to || query.cohort || query.phase || query.locale || query.ref);
    if (!hasSelection) setLocalData(null);
    if (parentData && hasSelection) {
      setRefreshing(true);
      onExportSource?.({ parentData, data: parentData, query, status: "loading" });
      l1Requests.current.run(
        () => fetchL1Kpi(query),
        next => {
          validateL1Dashboard(next);
          setLocalData(next);
          setWin(query.window ?? "7d");
          setApplied(query);
          if (urlToWrite.current === query) writeQueryToUrl(query); // 父级读取抢掉了原请求时由这里补写
          onExportSource?.({ parentData, data: next, query, status: "ready" });
        },
        error => {
          setRefreshError(displayAdminReadError(error));
          onExportSource?.({ parentData, data: parentData, query, status: "error" });
        },
        () => setRefreshing(false),
      );
    } else {
      setRefreshing(false);
      onExportSource?.({ parentData, data: parentData, query, status: parentData ? "ready" : "loading" });
    }
  }, [ctx.biData?.l1]);

  useEffect(() => () => {
    l1Requests.current.invalidate();
  }, []);

  useEffect(() => {
    let saved: ReturnType<typeof loadL1LocalView> = null;
    try {
      saved = loadL1LocalView(window.localStorage);
    } catch {
      saved = null;
    }
    const fromUrl = queryFromUrl(window.location.search);
    if (!saved && !fromUrl) return;
    if (saved) {
      setGran(saved.gran);
      setPhaseOn(saved.phaseOn);
      setYlOffset(saved.ylOffset);
      setOvlSel(saved.ovlSel);
    }
    const restored: L1KpiQuery = fromUrl ?? {
      ...(saved?.window === "custom" ? { window: "custom", from: saved.customFrom, to: saved.customTo } : { window: saved?.window }),
      cohort: saved?.cohortFilter || undefined, phase: saved?.phaseFilter || undefined,
      locale: saved?.localeFilter || undefined, ref: saved?.refFilter || undefined,
    };
    setWin(restored.window ?? "7d");
    setCustomFrom(restored.from ?? saved?.customFrom ?? "");
    setCustomTo(restored.to ?? saved?.customTo ?? "");
    setCohortFilter(restored.cohort ?? "");
    setPhaseFilter(restored.phase ?? "");
    setLocaleFilter(restored.locale ?? "");
    setRefFilter(restored.ref ?? "");
    selectedQuery.current = restored;
    setRefreshing(true);
    onExportSource?.({ parentData: ctx.biData?.l1, data: ctx.biData?.l1, query: restored, status: "loading" });
    l1Requests.current.run(
      () => fetchL1Kpi(restored),
      (next) => {
        validateL1Dashboard(next);
        setLocalData(next);
        setApplied(restored);
        setRefreshError("");
        onExportSource?.({ parentData: ctx.biData?.l1, data: next, query: restored, status: "ready" });
      },
      (error) => {
        setRefreshError(displayAdminReadError(error));
        onExportSource?.({ parentData: ctx.biData?.l1, data: ctx.biData?.l1, query: restored, status: "error" });
      },
      () => setRefreshing(false),
    );
    return () => l1Requests.current.invalidate();
  }, []);

  const query = selectedQuery.current;
  const selectedReadRequired = query.window !== "7d" || Boolean(query.from || query.to || query.cohort || query.phase || query.locale || query.ref);
  const data = localData ?? (selectedReadRequired ? undefined : ctx.biData?.l1);
  useEffect(() => { if (data) setReadAt(businessClock(Date.now())); }, [data]);
  const rawKpis = rows<Kpi>(data?.kpis);
  const liveTotals = readL1LiveTotals(data);
  let protocolBroken = false;
  if (rawKpis.length) {
    try {
      validateL1Dashboard(data);
    } catch {
      protocolBroken = true;
    }
  }

  const draftSlices = { cohort: cohortFilter || undefined, phase: phaseFilter || undefined, locale: localeFilter || undefined, ref: refFilter || undefined };
  const appliedSlices = { cohort: applied.cohort, phase: applied.phase, locale: applied.locale, ref: applied.ref };
  const appliedTime = { window: applied.window, from: applied.from, to: applied.to };

  /** 读取入口只收完整的查询对象。草稿只有显式应用时才拼进来，刷新、移除条件、重试都不碰（ST-18）。 */
  const reloadKpi = (next: L1KpiQuery) => {
    setQueryNotice("");
    setRefreshing(true);
    setLocalData(data ?? null);
    selectedQuery.current = next;
    urlToWrite.current = next;
    onExportSource?.({ parentData: ctx.biData?.l1, data, query: next, status: "loading" });
    l1Requests.current.run(
      () => fetchL1Kpi(next),
      (result) => {
        validateL1Dashboard(result);
        setLocalData(result);
        onExportSource?.({ parentData: ctx.biData?.l1, data: result, query: next, status: "ready" });
        drillRead.current += 1;
        setDrillKpi(null);
        setDrillTrend(null);
        setDrillError("");
        setRefreshError("");
        setWin(next.window ?? "7d");
        setApplied(next);
        writeQueryToUrl(next);
        ctx.toast(`关键指标 已按${next.window === "custom" ? `${next.from} 至 ${next.to}` : WINDOW_NAME[next.window ?? "7d"]}重新加载`);
      },
      (error) => {
        const message = displayAdminReadError(error);
        setRefreshError(message);
        onExportSource?.({ parentData: ctx.biData?.l1, data, query: next, status: "error" });
        ctx.toast(`关键指标 刷新失败 · ${message}`);
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
    reloadKpi({ ...applied, [key]: undefined });
  };
  const saveView = () => {
    let saved: ReturnType<typeof saveL1LocalView> = null;
    try {
      // 存屏幕上这份，不存没应用的输入：它和网址一致，刷新才真的还是这个视图。
      saved = saveL1LocalView(window.localStorage, {
        window: applied.window ?? "7d", customFrom: applied.from ?? "", customTo: applied.to ?? "", gran, phaseOn, ylOffset, ovlSel,
        cohortFilter: applied.cohort ?? "", phaseFilter: applied.phase ?? "", localeFilter: applied.locale ?? "", refFilter: applied.ref ?? "",
      });
    } catch {
      saved = null;
    }
    ctx.toast(saved ? "视图已保存在这台电脑的浏览器里，刷新后仍按这个视图显示" : "视图设置有误或浏览器不能保存，没有保存");
  };
  const draftChanged = SLICES.some((key) => (draftSlices[key] ?? "") !== (applied[key] ?? ""));

  const queryBar = (
    <FilterBar
      scope={<Segments<L1Window>
        label="时间范围"
        value={customPicking ? "custom" : win}
        items={[{ value: "1d", label: "近 24 小时" }, { value: "7d", label: "近 7 天" }, { value: "30d", label: "近 30 天" }, { value: "custom", label: "自定义" }]}
        onChange={(next) => {
          if (next === "custom") {
            setCustomOpen(true);
            return;
          }
          setCustomOpen(false);
          reloadKpi({ window: next, ...appliedSlices });
        }}
      />}
      more={<>
        <FilterField label="注册周"><Input aria-label="注册周筛选" placeholder="年份与周数，如 2026-W42" value={cohortFilter} onChange={(event) => { setCohortFilter(event.target.value); setQueryNotice(""); }} /></FilterField>
        <FilterField label="运营阶段"><Select aria-label="运营阶段筛选" value={phaseFilter} onChange={setPhaseFilter} options={[{ value: "", label: "全部阶段" }, ...["P1", "P2", "P3", "P4", "P5", "P6"].map((value) => ({ value, label: value }))]} /></FilterField>
        <FilterField label="语言"><Input aria-label="语言筛选" placeholder="语言" value={localeFilter} onChange={(event) => setLocaleFilter(event.target.value)} /></FilterField>
        <FilterField label="渠道"><Input aria-label="渠道筛选" placeholder="推荐来源" value={refFilter} onChange={(event) => setRefFilter(event.target.value)} /></FilterField>
        <div className="rd-filter-more-row"><Button type="submit" disabled={refreshing}>应用筛选</Button></div>
        <div className="rd-filter-more-row">
          <span className="rd-note">显示设置</span>
          <Segments
            label="按注册周或月分组"
            value={gran}
            items={[{ value: "week", label: "注册周（如2026-W42）" }, { value: "month", label: "注册月" }]}
            onChange={(next) => { setGran(next); ctx.toast(`已选${next === "week" ? "注册周" : "注册月"} · 只影响保存视图，不改数据`); }}
          />
          <Explain label="分组方式的说明" content="只影响保存视图，不改数据。" />
          <Check label="显示运营阶段切换" checked={phaseOn} onChange={() => { setPhaseOn(!phaseOn); ctx.toast(`运营阶段切换标记已${!phaseOn ? "开启" : "关闭"}`); }} />
        </div>
      </>}
      moreCount={SLICES.filter((key) => applied[key]).length}
      onSubmit={applySlices}
      querying={refreshing}
      action={<Button disabled={refreshing} onClick={() => reloadKpi(applied)}>{refreshing ? "刷新中…" : "刷新指标"}</Button>}
      onClear={() => { clearDrafts(); reloadKpi(appliedTime); }}
      canClear={!refreshing && (hasSlice(applied) || draftChanged)}
      sort={<div className="rd-filter-end">
        <Button onClick={saveView}>保存为视图</Button>
        <Explain label="保存为视图存什么" content="只存在这台电脑的浏览器里。统计规则与目标值只读，这里只把时间范围、切片和显示方式存下来，不保存数据、权限或业务状态，也不用确认。" />
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
          <Button disabled={refreshing} disabledReason={customBlocked} onClick={() => reloadKpi({ window: "custom", from: customFrom, to: customTo, ...appliedSlices })}>应用自定义</Button>
          <Explain label="自定义范围的说明" content={`${businessZone().label}，含结束日，最长 400 天。`} />
        </div>
      )}
    </FilterBar>
  );

  const retryLast = () => reloadKpi(selectedQuery.current);
  const retryFirstRead = () => { if (selectedReadRequired) retryLast(); else void ctx.reloadBi?.(); };

  const report = () => {
    const KPIS = rawKpis;
    const WEEKS = strings(data?.weeks);
    const PHASE_SWITCH_IDX = num(data?.phaseSwitchIndex, -1);
    const KPI_PLAIN = rec<string>(data?.kpiPlain);
    const KPI_EXT = rec<KpiExt>(data?.kpiExt);
    const states = KPIS.map((item) => kpiStatus(item, ylOffset));
    const count = (state: KpiState) => states.filter((item) => item === state).length;
    const green = count("g");
    const yellow = count("y");
    const red = count("r");
    const unavailable = count("na") + count("small");
    const order = KPIS.map((_, index) => index).sort((a, b) => STATE_RANK[states[a]] - STATE_RANK[states[b]] || KPIS[a].n - KPIS[b].n);
    const safeSelKpi = Math.min(picked ?? order[0], KPIS.length - 1);
    const baseKpi = KPIS[safeSelKpi];
    const k = drillKpi?.n === baseKpi.n
      ? { ...baseKpi, ...drillKpi, spark: drillTrend?.values ?? drillKpi.spark ?? baseKpi.spark, sparkSuppressed: drillTrend?.suppressedPoints ?? drillKpi.sparkSuppressed }
      : baseKpi;
    const baseExt = KPI_EXT[String(k.n)] ?? { fx: k.name, fxBold: [], num: "—", den: "—", delta: "0", note: "暂未返回该关键指标解释", jump: [] };
    const ext = {
      ...baseExt,
      num: k.numerator == null ? baseExt.num : String(k.numerator),
      den: k.denominator == null ? baseExt.den : String(k.denominator),
      note: REASON_TEXT[k.unavailableReason ?? ""] ?? (k.available === false ? "这个范围缺数据，暂无法计算，不按 0% 算。" : baseExt.note),
    };
    const kState = kpiStatus(k, ylOffset);
    const phase = rec(data?.currentPhase);
    const phaseKnown = typeof phase.code === "string" && phase.code.length > 0;
    const attributionLinks = assertL1AttributionLinks(ext.jump);

    const selectKpi = async (index: number) => {
      setPicked(index);
      const kpiId = KPIS[index]?.n;
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
        const checkedDrilldown = validateL1Drilldown(drilldown, kpiId);
        const checkedTrend = validateL1Trend(trend, kpiId);
        if (read !== drillRead.current) return;
        setDrillKpi(checkedDrilldown.selected as Kpi);
        setDrillTrend({ values: checkedTrend.values as KpiTrendPoint[], suppressedPoints: checkedTrend.suppressedPoints as boolean[] | undefined });
      } catch (error) {
        if (read !== drillRead.current) return;
        const message = displayAdminReadError(error);
        setDrillError(message);
        ctx.toast(`明细加载失败 · ${message}`);
      }
    };
    /** 八项是一组单选：方向键、Home、End 移动并立即选中，Tab 只停在当前行（ST-56）。 */
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
    const trendOf = (index: number) => (states[index] === "small" ? [] : KPIS[index].spark); // 样本过小的比例不画
    const showTrendColumn = KPIS.some((_, index) => hasTrend(trendOf(index)));
    const phaseEvent = phaseOn && PHASE_SWITCH_IDX >= 0 ? { index: PHASE_SWITCH_IDX, text: "运营阶段切换" } : undefined;

    // 指数只对单侧目标成立：越高越好算实际 ÷ 目标，越低越好算目标 ÷ 实际，高于 100 都是好于目标。
    // 健康带没有单一目标，不换算，按真实值和上下限单独画（DP-63）。
    const picks = ovlSel.map((index) => ({ ...KPIS[index], spark: trendOf(index) }));
    const bandPicks = picks.filter((item) => item.dir === "band");
    const compared = picks.filter((item) => item.dir !== "band").map((item, position) => ({
      item,
      slot: (position < 4 ? position + 1 : "other") as ChartSlot,
      values: item.spark.map((value) => value === null ? null : (item.dir === "lte" ? (item.target / value) * 100 : (value / item.target) * 100)),
    }));
    const drawable = compared.filter(({ item, values }) => item.available !== false && hasTrend(values) && values.every((value) => value === null || Number.isFinite(value)));
    const bandDrawable = bandPicks.filter((item) => item.available !== false && hasTrend(item.spark));
    const skipped = [...compared.filter((entry) => !drawable.includes(entry)).map(({ item }) => item), ...bandPicks.filter((item) => !bandDrawable.includes(item))];
    const drawnCount = drawable.length + bandDrawable.length;

    return (
      <>
        {red > 0
          ? <Conclusion state="danger" lead hint="点一行看原因。" explain="未达标的排在下面最前面。">关键指标：<b>{red}</b> 项未达标</Conclusion>
          : unavailable === KPIS.length
            ? <Conclusion state="unknown" hint="这个范围人数太少或缺数据，换个更长的时间范围再看。">关键指标：暂时无法判断</Conclusion>
            : green === KPIS.length
              ? <Conclusion state="ok" hint="这页无需处理。">关键指标：全部达标</Conclusion>
              : <Conclusion state="neutral" explain={unavailable > 0 ? "有的项人数太少或缺数据，不算达标。" : "接近目标的排在下面最前面。"}>关键指标：没有未达标的项</Conclusion>}

        <StatBand label="指标概览">
          <Stat label="已达标指标" value={green} unit={`/ ${KPIS.length}`} tone={green > 0 ? "ok" : undefined} icon={CheckCircle2} iconTone="ok" explain="满足对应指标的目标。" />
          <Stat label="接近目标的指标" value={yellow} tone={yellow > 0 ? "warn" : undefined} icon={Gauge} iconTone="warn"
            sub={<>距目标 {ylOffset}% 以内 · <button type="button" className="rd-link" onClick={() => setEditingOffset(true)}>调整接近范围</button></>}
            explain={`没达标，但离目标不超过 ${ylOffset}%；购买转化在健康带外也算这里。调整只改你看到的状态，不改业务规则。`} />
          <Stat label="暂无法判断" value={unavailable} tone={unavailable > 0 ? "done" : undefined} icon={CircleHelp} iconTone="done" sub={`缺数据 ${count("na")} 项 · 样本过小 ${count("small")} 项`} explain="缺数据算不出来；样本过小的数值受保护。两类都不按 0% 算，也不算未达标。" />
          <Stat label="当前运营阶段" value={phaseKnown ? String(phase.code) : "未返回"} unit={phaseKnown ? `· ${String(phase.name ?? "")} · 第 ${num(phase.month, 0)} 月` : undefined} tone="role-2" icon={Flag}
            explain={PHASE_SWITCH_IDX >= 0 ? "趋势图已标出运营阶段切换时间。" : "当前时间范围内没有阶段切换记录。"} />
        </StatBand>

        <div className="rd-split" data-detail="">
          <Panel title="八项指标" explain="未达标的排在前面，点一行看明细。" icon={ListChecks} tone="role-2" flush>
            <Table label="选择要查看的关键指标" rowFocus data-tight={showTrendColumn ? "" : undefined}>
              <thead><tr>
                <Th>指标</Th>
                <Th align="right">当前值</Th>
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
                      <Td align="right"><Cell num main={state === "small" ? "样本过小" : state === "na" ? "—" : `${item.value}${unitText(item)}`} sub={state === "na" || state === "small" || (item.momDelta == null && !item.previousSuppressed) ? undefined : deltaText(item)} /></Td>
                      <Td align="right"><Cell num main={tgtShort(item)} /></Td>
                      {showTrendColumn && <Td>{state === "small"
                        ? <span className="rd-note">—</span>
                        : item.sparkSuppressed?.includes(true)
                          ? <><Sparkline label={`${operatorCopyText(item.name)}的走势，样本过小时段留空`} values={item.spark} /><span className="rd-note">部分时段样本过小</span></>
                        : hasTrend(item.spark)
                        ? <Sparkline label={`${operatorCopyText(item.name)}的走势`} values={item.spark} />
                        : item.spark.length >= 2
                          ? <span className="rd-note">每段都是 0</span>
                          : <span className="rd-note" data-proof="l1-kpi-trend-unavailable">趋势数据不足</span>}</Td>}
                      <Td><StatusTag tone={STATE_TONE[state]}>{stateText(state, item)}</StatusTag></Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            {!showTrendColumn && (KPIS.some((item) => item.sparkSuppressed?.includes(true))
              ? <p className="rd-note rd-panel-foot">部分时段样本过小，趋势留空。</p>
              : KPIS.some((_, index) => trendOf(index).length >= 2)
              ? <p className="rd-note rd-panel-foot">这个范围有趋势的指标每段都是 0，没有走势可画。</p>
              : <p className="rd-note rd-panel-foot" data-proof="l1-kpi-trend-unavailable">这个范围的数据不够，画不出走势。</p>)}
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
              {kState !== "na" && kState !== "small" && (
                <ThresholdMeter
                  label="当前值和目标"
                  rows={[{ key: "now", label: "当前", value: k.value!, text: `${k.value}${unitText(k)}`, tone: STATE_TONE[kState] }]}
                  marks={goalMarks}
                />
              )}
              <Facts>
                {(kState === "na" || kState === "small") && <Fact k="当前值">{stateText(kState, k)}</Fact>}
                {(kState === "na" || kState === "small") && <Fact k="目标值">{tgtShort(k)}</Fact>}
                <Fact k="怎么算"><AutoGloss>{operatorCopyText(KPI_PLAIN[k.n] ?? "")}</AutoGloss></Fact>
                {kState !== "small" && <Fact k="分子">{ext.num}</Fact>}
                {kState !== "small" && <Fact k="分母">{ext.den}</Fact>}
                {kState !== "small" && <Fact k="较上期">{deltaText(k).replace(/^较上期 ?/, "")}</Fact>}
                <Fact k="统计范围">{queryScope(applied)}</Fact>
                <Fact k="解读">{kState === "small" ? <>样本过小，不下结论<Explain label="样本过小的说明" content={SMALL_SAMPLE_NOTE} /></> : <AutoGloss>{operatorCopyText(ext.note)}</AutoGloss>}</Fact>
              </Facts>
              {drillError
                ? <BlockState state="error" title="明细和趋势暂时加载不出来" detail={`其他内容不受影响。${drillError}`} onRetry={() => void selectKpi(safeSelKpi)} />
                : kState === "small"
                  ? null
                  : hasTrend(k.spark)
                  ? <Panel plain headingLevel={3} title="最近在变好还是变坏" explain="所选时间范围等分六段。">
                      <TrendLines
                        label={`${operatorCopyText(k.name)}的走势`}
                        ticks={WEEKS}
                        format={pct}
                        series={[{ key: "kpi", label: operatorCopyText(k.name), slot: 2, values: k.spark }]}
                        marks={goalMarks}
                        event={phaseEvent}
                      />
                    </Panel>
                  : <p className="rd-note">{k.sparkSuppressed?.includes(true) ? "样本过小，趋势时段留空。" : k.spark.length >= 2 ? "这段时间每段都是 0，没有走势可画。" : "这个范围的数据不够，画不出走势。"}</p>}
              {kState !== "small" && hasTrend(k.spark) && k.sparkSuppressed?.includes(true) && <p className="rd-note">部分时段样本过小，曲线在这些时段留空。</p>}
              <Fold inset title="这项指标怎么算" summary={`统计规则编号 #${k.n}`} explain={<AutoGloss>这项指标怎么算 · 统计规则统一管理,这里只能看不能改</AutoGloss>}>
                <div className="rd-stack">
                  <div>{renderFx(ext.fx, ext.fxBold)}</div>
                  <p className="rd-note">统计规则编号 #{k.n} · 上线批次：{batchText(k.vis)}</p>
                </div>
              </Fold>
            </div>
          </Panel>
        </div>

        {showTrendColumn && <Fold title="这几项相对目标在变好还是变坏" icon={Activity} tone="role-2" summary={drawnCount ? `已选 ${ovlSel.length} 项，画出 ${drawnCount} 项` : `已选 ${ovlSel.length} 项，没有走势可画`}
          explain={<>
            <p>至少留一项。对比多个指标的趋势，观察运营阶段切换后的变化；原因可到「运营阶段状态」或「运营阶段设置」查看。按行为记录中的运营阶段统计。</p>
            <p>高于 100 是好于目标。越高越好的指标算实际值 ÷ 目标值，越低越好的算目标值 ÷ 实际值，只看各自的走向，不比谁离目标远。</p>
          </>}>
          <div className="rd-stack">
            <div role="group" aria-label="要比的指标" className="rd-filter-more-row">
              {KPIS.map((item, index) => {
                const on = ovlSel.includes(index);
                return <Check key={item.n} label={`#${item.n} ${operatorCopyText(item.name)}`} checked={on} disabled={on && ovlSel.length === 1} onChange={() => setOvlSel((current) => (on ? current.filter((value) => value !== index) : [...current, index]))} />;
              })}
            </div>
            {drawable.length > 0 && (
              <>
                <TrendLines
                  label="多个关键指标的对比趋势"
                  ticks={WEEKS}
                  format={(value) => value.toFixed(0)}
                  series={drawable.map(({ item, slot, values }) => ({ key: String(item.n), label: `#${item.n} ${operatorCopyText(item.name)}`, slot, values }))}
                  marks={[{ key: "target", text: "各自目标 = 100", value: 100, tone: "ok" }]}
                  event={phaseEvent}
                />
              </>
            )}
            {bandDrawable.map((item) => (
              <Panel key={item.n} plain headingLevel={3} title={`${operatorCopyText(item.name)}有没有在健康带里`} sub={`健康带 ${tgtShort(item)}`} explain="没有单一目标，按真实值画。">
                <TrendLines
                  label={`${operatorCopyText(item.name)}和健康带`}
                  ticks={WEEKS}
                  format={(value) => `${Number(value.toFixed(1))}${unitText(item)}`}
                  series={[{ key: String(item.n), label: operatorCopyText(item.name), slot: 2, values: item.spark }]}
                  marks={[{ key: "low", text: `下限 ${item.band?.[0]}${unitText(item)}`, value: item.band?.[0] ?? 0, tone: "ok" }, { key: "high", text: `上限 ${item.band?.[1]}${unitText(item)}`, value: item.band?.[1] ?? 0, tone: "ok" }]}
                  event={phaseEvent}
                />
              </Panel>
            ))}
            {drawnCount === 0 && <p className="rd-note">当前所选指标没有可绘制的对比曲线。</p>}
            {skipped.length > 0 && <p className="rd-note">没有画：{skipped.map((item) => `#${item.n}（${states[KPIS.findIndex((kpi) => kpi.n === item.n)] === "small" ? "样本过小" : item.sparkSuppressed?.includes(true) ? "部分时段样本过小，其余趋势不足" : item.spark.length >= 2 && item.spark.every((value) => value === 0) ? "每段都是 0" : "趋势数据不足"}）`).join("、")}。</p>}
          </div>
        </Fold>}

        <Fold title="指标规则表" icon={Lock} summary={`${KPIS.length} 项 · 算法和目标已锁定`}
          explain={<>
            <p><AutoGloss>每项关键指标怎么算一目了然 · 要改算法须走事件统计规则管理 + 操作确认,本页改不了</AutoGloss></p>
            <p><AutoGloss>推广率表示发出过邀请的设备持有者占比；各项指标的可用性和统计范围以当前返回数据为准。</AutoGloss></p>
          </>}>
          <div className="rd-stack">
            <Table label="关键指标的计算方式">
              <thead><tr><Th>#</Th><Th>指标</Th><Th>计算方式</Th><Th align="right">目标</Th><Th>上线批次</Th><Th>状态</Th></tr></thead>
              <tbody>
                {KPIS.map((item, index) => (
                  <Tr key={item.n}>
                    <Td><Cell num main={item.n} /></Td>
                    <Td><Cell main={<AutoGloss>{operatorCopyText(item.name)}</AutoGloss>} /></Td>
                    <Td><Cell title={`${operatorCopyText(KPI_PLAIN[item.n] ?? "")}：${KPI_EXT[item.n].fx}`} main={<AutoGloss>{operatorCopyText(KPI_PLAIN[item.n] ?? "")}</AutoGloss>} sub={renderFx(KPI_EXT[item.n].fx, KPI_EXT[item.n].fxBold)} /></Td>
                    <Td align="right"><Cell num main={tgtShort(item)} /></Td>
                    <Td><Cell main={batchText(item.vis)} /></Td>
                    <Td><StatusTag tone={STATE_TONE[states[index]]}>{stateText(states[index], item)}</StatusTag></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <PaginationExemptionList items={[{ label: "关键指标 统计规则锁定表", kind: "reference-catalog", maxRows: 8, reason: "八项关键指标 为固定验收统计规则,需要同屏锁定算式和状态" }]} />
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
  const body = rawKpis.length
    ? protocolBroken
      ? <BlockState state="error" title="关键指标加载失败" detail="收到的数据不完整，已停止显示。" onRetry={retryFirstRead} retryLabel="重新加载" />
      : report()
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
        meta={readAt ? `${readAt} 读取（${businessZone().label}）· 打开时读取，不自动刷新` : "打开时读取，不自动刷新"}
        readOnly={ctx.canExport ? "这页只能查看，不会改任何数据" : "这页只能查看，不会改任何数据 · 导出需报表管理权限"}
      />
      {exporting.notices}
      {queryBar}
      {refreshError && rawKpis.length > 0 && (
        <Notice tone="warn" title="关键指标刷新失败" action={<Button size="sm" onClick={retryLast}>重试</Button>}>
          以下是 {readAt} 的数据，时间范围未切换。{refreshError}
        </Notice>
      )}
      {body}
      {editingOffset && <OffsetModal current={ylOffset} onClose={() => setEditingOffset(false)} onApply={(next) => { setYlOffset(next); ctx.toast(`接近目标的范围 → 距目标 ${next}% · 只改显示`); }} />}
    </>
  );
}
