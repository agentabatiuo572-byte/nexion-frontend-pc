"use client";
import { useReach } from "@/lib/nav/use-reach";
import { operatorCopyText } from "@/lib/admin/operator-copy";

/**
 * L1 · 关键指标（报表页样板）。查询条 → 结论 → 四张概览卡 → 八项指标 ┬ 所选指标明细 → 折叠组 → 相关页面。
 * 灯色只用 kpiState 的现有比较；口径与目标只读锁定，页面没有修改入口。
 * 查询状态写网址（ST-23），优先于本机保存的视图；导出由操作者填理由（OP-115），文件到 L5 下载。
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { Activity, CheckCircle2, CircleHelp, Download, Flag, Gauge, ListChecks, Lock, Target } from "lucide-react";
import { AutoGloss } from "@/app/components/kit/gloss";
import { BlockState, Button, Cell, Check, Conclusion, Explain, Fact, Facts, Field, FilterBar, FilterField, Fold, Input, Modal, Notice, PageHeader, Panel, Segments, Select, Sparkline, Stat, StatBand, StatusTag, Table, Td, Th, ThresholdMeter, Tr, TrendLines, type ChartSlot, type StateTone } from "@/app/components/rd";
import { displayAdminReadError } from "@/lib/admin/error-messages";
import { businessClock, businessDay, businessZone } from "@/lib/admin/business-time";
import { findByPath } from "@/lib/nav/console-nav";
import { PaginationExemptionList } from "../design-kit";
import { kpiState, num, rec, rows, strings, type KpiRow } from "./live-data";
import { readL1LiveTotals } from "./l1-l2-live-data";
import { L1LiveTotals } from "./l1-l2-live-fallback";
import type { LCtx } from "./types";
import { fetchL1Kpi, fetchL1KpiDrilldown, fetchL1KpiTrend, type L1KpiQuery } from "@/lib/admin/l-client";
import { validateL1Dashboard, validateL1Drilldown, validateL1Trend } from "./l1-kpi-contract";
import { resolveL1ExportMode, resolveL1ExportUnavailableReason, submitL1Export, type L1ExportSource } from "./l1-export-contract";
import { loadL1LocalView, saveL1LocalView, type L1Window } from "./l1-local-view";
import { createL1ReadController } from "./l1-request-generation";
import { ATTRIBUTION_ROUTE_READ, assertL1AttributionLinks } from "./l-attribution-routes";

type Kpi = KpiRow & {
  available?: boolean;
  unavailableReason?: string;
  status?: string;
  momDelta?: number | null;
  numerator?: number;
  denominator?: number;
};
type KpiExt = {
  fx: string;
  fxBold: string[];
  num: string;
  den: string;
  delta: string;
  note: string;
  jump: { label: string; href?: string }[];
};
const tgtLabel = (k: Kpi) => {
  const [low = 0, high = 0] = k.band ?? [];
  return k.dir === "band" ? `健康带 ${low}–${high}${k.unit === "d" ? "天" : k.unit}` : `目标 ${k.dir === "lte" ? "< " : "> "}${k.target}${k.unit === "d" ? "天" : k.unit}`;
};
const tgtValue = (k: Kpi) => (k.dir === "band" ? (k.band?.[0] ?? k.target) : k.target);

type KpiState = "g" | "y" | "r" | "na";
const unitText = (k: Kpi) => (k.unit === "d" ? "天" : k.unit);
const tgtShort = (k: Kpi) => tgtLabel(k).replace("目标 ", "").replace("健康带 ", "");
const valueText = (k: Kpi) => (k.available === false || k.value == null ? "不可计算" : `${k.value}${unitText(k)}`);
const STATE_TONE: Record<KpiState, StateTone> = { g: "ok", y: "warn", r: "danger", na: "done" };
const stateText = (state: KpiState, k: Kpi) => ({ g: "达标", y: k.dir === "band" ? "在健康带外" : "接近目标", r: "未达标", na: "不可计算" })[state];
/** 未达标排最前，其次接近目标、不可计算，达标的放最后；同一档按指标编号。 */
const STATE_RANK: Record<KpiState, number> = { r: 0, y: 1, na: 2, g: 3 };
const WINDOW_NAME: Record<Exclude<L1Window, "custom">, string> = { "1d": "近 24 小时", "7d": "近 7 天", "30d": "近 30 天" };
const SLICES = ["cohort", "phase", "locale", "ref"] as const;
const SLICE_NAME = { cohort: "注册周", phase: "运营阶段", locale: "语言", ref: "渠道" } as const;
const URL_KEYS = ["window", "from", "to", ...SLICES] as const;
const COHORT_FORMAT = /^\d{4}-W\d{2}$/;
const RELATED = ["/analytics/funnel-cohort", "/analytics/financial", "/analytics/operations"] as const;
const hasSlice = (query: L1KpiQuery) => SLICES.some((key) => Boolean(query[key]));

function deltaText(k: Kpi) {
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

export function L1HeaderActions({ ctx, source }: { ctx: LCtx; source?: L1ExportSource | null }) {
  const sourceUnavailable = Boolean(ctx.biError || ctx.biLoading || (source && source.status !== "ready"));
  const exportData = source ? source.data : ctx.biData?.l1;
  const exportMode = resolveL1ExportMode(exportData, sourceUnavailable);
  const exportUnavailableReason = resolveL1ExportUnavailableReason(
    exportData, ctx.biLoading ? "loading" : ctx.biError ? "error" : source?.status ?? "ready",
  );
  const query = source?.query ?? { window: "7d" as const };
  const fileText = exportMode === "series" ? "8 项指标的当前值、目标和六段趋势" : exportMode === "snapshot" ? "8 项指标的当前值、目标和可用性" : "当前累计数";
  const exportKpi = () => ctx.openActionConfirm({
    action: "导出关键指标",
    detail: `导出 ${fileText}，范围：${queryScope(query)}。聚合数据，不含用户隐私。提交后生成任务，文件到「数据导出与监管报告」下载。`,
    statedBrief: { impact: "生成一个导出任务，不改任何数据，操作记录里留痕。", check: "看时间范围对不对，理由写这份数据给谁、做什么用。" },
    confirmLabel: "确认导出",
    reasonMin: 8,
    reasonMax: 200,
    run: async (reason) => {
      const submittedMode = await submitL1Export(exportData, sourceUnavailable, ctx.biActions?.createReport, query, reason);
      if (!submittedMode) throw new Error("关键指标暂时不能导出，请刷新后再试");
      await ctx.reloadBi?.();
      ctx.toast(`${submittedMode === "series" ? "关键指标趋势已导出" : "关键指标当前汇总已导出"}，到「数据导出与监管报告」下载`);
    },
  });
  if (!ctx.canExport) return null;
  return (
    <Button variant="primary" icon={<Download size={14} aria-hidden />} disabledReason={exportMode === null || ctx.biLoading ? exportUnavailableReason : undefined} onClick={exportKpi}>
      {exportMode === "series" ? "导出关键指标序列 CSV" : "导出关键指标当前汇总 CSV"}
    </Button>
  );
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

/** 黄灯偏移只改本机显示，不写后端，所以是本地小窗，不走确认（L1-A02）。 */
function OffsetModal({ current, onApply, onClose }: { current: number; onApply: (next: number) => void; onClose: () => void }) {
  const [draft, setDraft] = useState("");
  const next = Number(draft);
  const valid = draft.trim() !== "" && Number.isInteger(next) && next >= 5 && next <= 20;
  return (
    <Modal title="黄灯预警偏移" onClose={onClose} footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!valid} onClick={() => { onApply(next); onClose(); }}>应用 · 实时生效</Button></>}>
      <div className="rd-stack">
        <Field label={`新值（当前 ${current}% · 范围 5–20%，仅限整数）`} required help="只改你看到的灯色和黄线，不改业务规则或统计方式。刷新会恢复最后保存的设置，没有保存视图时回到默认值。要保留请点「保存为视图」。">
          {(control) => <Input {...control} type="number" min={5} max={20} step={1} value={draft} placeholder={String(current)} onChange={(event) => setDraft(event.target.value)} />}
        </Field>
        <Fold inset title="查看业务规则详情" summary="灯色怎么判定">
          <p className="rd-note">单侧指标须严格高于或低于目标值才达标；等于目标时为黄灯。数值越高越好的指标，黄线为目标值 × (1 − N%)；数值越低越好的指标，黄线为目标值 × (1 + N%)。未达标且在黄线以内（含黄线）为黄灯，超出为红灯。购买转化健康带包含两端，带外仍为黄灯。只影响显示，不改指标值。</p>
        </Fold>
      </div>
    </Modal>
  );
}

export function L1Kpi({ ctx, onExportSource, title, summary, actions }: { ctx: LCtx; onExportSource?: (source: L1ExportSource) => void; title: ReactNode; summary: string; actions: ReactNode }) {
  const reach = useReach();
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
  const [drillTrend, setDrillTrend] = useState<number[] | null>(null);
  const [drillError, setDrillError] = useState("");
  const l1Requests = useRef(createL1ReadController());
  const selectedQuery = useRef<L1KpiQuery>({ window: "7d" });
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

  useEffect(() => () => l1Requests.current.invalidate(), []);

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
  const customRangeNotice = customPicking && customFrom && customTo && customFrom <= customTo ? customRangeProblem(customFrom, customTo) : "";
  const customReady = Boolean(customFrom && customTo && customFrom <= customTo && !customRangeNotice);
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
        <div className="rd-filter-more-row"><Button type="submit" disabled={refreshing}>应用切片</Button></div>
        <div className="rd-filter-more-row">
          <span className="rd-note">显示设置</span>
          <Segments
            label="按注册周或月分组"
            value={gran}
            items={[{ value: "week", label: "注册周（如2026-W42）" }, { value: "month", label: "注册月" }]}
            onChange={(next) => { setGran(next); ctx.toast(`已选${next === "week" ? "注册周" : "注册月"} · 只影响保存视图，不改数据`); }}
          />
          <span className="rd-note">只影响保存视图</span>
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
        <Explain label="保存为视图存什么" content="统计规则与目标值只读。这里只把时间范围、切片和显示方式存在这台电脑的浏览器里，不保存数据、权限或业务状态，也不用确认。" />
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
          <Button disabled={!customReady || refreshing} onClick={() => reloadKpi({ window: "custom", from: customFrom, to: customTo, ...appliedSlices })}>应用自定义</Button>
          <span className="rd-note">{businessZone().label}，含结束日，最长 400 天</span>
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
    const states: KpiState[] = KPIS.map((item) => item.available === false || item.value == null ? "na" : kpiState(item, ylOffset));
    const count = (state: KpiState) => states.filter((item) => item === state).length;
    const green = count("g");
    const yellow = count("y");
    const red = count("r");
    const unavailable = count("na");
    const order = KPIS.map((_, index) => index).sort((a, b) => STATE_RANK[states[a]] - STATE_RANK[states[b]] || KPIS[a].n - KPIS[b].n);
    const safeSelKpi = Math.min(picked ?? order[0], KPIS.length - 1);
    const baseKpi = KPIS[safeSelKpi];
    const k = drillKpi?.n === baseKpi.n
      ? { ...baseKpi, ...drillKpi, spark: drillTrend ?? drillKpi.spark ?? baseKpi.spark }
      : baseKpi;
    const baseExt = KPI_EXT[String(k.n)] ?? { fx: k.name, fxBold: [], num: "—", den: "—", delta: "0", note: "暂未返回该关键指标解释", jump: [] };
    const ext = {
      ...baseExt,
      num: k.numerator == null ? baseExt.num : String(k.numerator),
      den: k.denominator == null ? baseExt.den : String(k.denominator),
      note: k.unavailableReason === "NO_GENESIS_PURCHASES"
        ? "当前筛选范围没有创世节点购买记录，尚未售罄，售罄天数不可计算。"
        : k.unavailableReason === "GENESIS_NOT_SOLD_OUT"
          ? "创世节点尚未累计售出 1,000，售罄天数不可计算。"
          : baseExt.note,
    };
    const kState: KpiState = k.available === false || k.value == null ? "na" : kpiState(k, ylOffset);
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
        setDrillTrend(checkedTrend.values as number[]);
      } catch (error) {
        if (read !== drillRead.current) return;
        const message = displayAdminReadError(error);
        setDrillError(message);
        ctx.toast(`明细加载失败 · ${message}`);
      }
    };
    const moveRow = (event: KeyboardEvent<HTMLTableRowElement>, at: number) => {
      const next = event.key === "ArrowDown" ? order[at + 1] : event.key === "ArrowUp" ? order[at - 1] : undefined;
      if (next === undefined) return;
      event.preventDefault();
      const row = event.currentTarget;
      ((event.key === "ArrowDown" ? row.nextElementSibling : row.previousElementSibling) as HTMLElement | null)?.focus();
      void selectKpi(next);
    };

    const pct = (value: number) => `${Number(value.toFixed(1))}${unitText(k)}`;
    const target = tgtValue(k);
    const yellowLine = k.dir === "lte" ? k.target * (1 + ylOffset / 100) : target * (1 - ylOffset / 100);
    const goalMarks: { key: string; text: string; value: number; tone: StateTone }[] = k.dir === "band"
      ? [{ key: "low", text: `下限 ${k.band?.[0]}${unitText(k)}`, value: k.band?.[0] ?? 0, tone: "ok" }, { key: "high", text: `上限 ${k.band?.[1]}${unitText(k)}`, value: k.band?.[1] ?? 0, tone: "ok" }]
      : [{ key: "target", text: `目标 ${target}${unitText(k)}`, value: target, tone: "ok" }, { key: "yellow", text: `黄线 ${pct(yellowLine)}`, value: yellowLine, tone: "warn" }];
    const trendReady = k.spark.length >= 2;
    const showTrendColumn = KPIS.some((item) => item.spark.length >= 2);
    const phaseEvent = phaseOn && PHASE_SWITCH_IDX >= 0 ? { index: PHASE_SWITCH_IDX, text: "运营阶段切换" } : undefined;

    const compared = ovlSel.map((index, position) => {
      const item = KPIS[index];
      const goal = tgtValue(item);
      const values = item.spark.map((value) => (item.dir === "lte" ? (goal / value) * 100 : (value / goal) * 100));
      return { index, item, values, slot: (position < 4 ? position + 1 : "other") as ChartSlot };
    });
    const drawable = compared.filter(({ item, values }) => item.available !== false && values.length >= 2 && values.every(Number.isFinite));
    const skipped = compared.filter((entry) => !drawable.includes(entry));

    return (
      <>
        {red > 0
          ? <Conclusion state="warn" lead hint="未达标的排在下面最前面，点一行看原因。">关键指标：<b>{red}</b> 项未达标</Conclusion>
          : unavailable === KPIS.length
            ? <Conclusion state="unknown" hint="这个范围里每一项都缺数据，换个时间范围再看。">关键指标：暂时无法判断</Conclusion>
            : green === KPIS.length
              ? <Conclusion state="ok" hint="这页无需处理。">关键指标：全部达标</Conclusion>
              : <Conclusion state="neutral" hint={unavailable > 0 ? "有的项缺数据算不出来，不算达标。" : "接近目标的排在下面最前面。"}>关键指标：没有未达标的项</Conclusion>}

        <StatBand label="指标概览">
          <Stat label="已达标指标" value={green} unit={`/ ${KPIS.length}`} tone={green > 0 ? "ok" : undefined} icon={CheckCircle2} iconTone="ok" sub="绿灯 · 满足对应指标的目标" />
          <Stat label="接近目标的指标" value={yellow} tone={yellow > 0 ? "warn" : undefined} icon={Gauge} iconTone="warn"
            sub={<>黄灯 · 距目标 {ylOffset}% 以内 · <button type="button" className="rd-link" onClick={() => setEditingOffset(true)}>调整</button></>}
            explain={`单侧指标距目标不超过 ${ylOffset}%；购买转化在健康带外也算这里。调整只改你看到的灯色，不改业务规则。`} />
          <Stat label="暂无法计算" value={unavailable} tone={unavailable > 0 ? "done" : undefined} icon={CircleHelp} iconTone="done" sub="缺数据，不按 0% 算" />
          <Stat label="当前运营阶段" value={phaseKnown ? String(phase.code) : "未返回"} unit={phaseKnown ? `· 月 ${num(phase.month, 0)}` : undefined} tone="role-2" icon={Flag}
            sub={PHASE_SWITCH_IDX >= 0 ? "趋势图已标出运营阶段切换时间" : "当前时间范围内没有阶段切换记录"} />
        </StatBand>

        <div className="rd-split">
          <Panel title="八项指标" sub="未达标的排在前面 · 点一行看明细" icon={ListChecks} tone="role-2" flush>
            <Table label="选择要查看的关键指标" data-tight={showTrendColumn ? "" : undefined}>
              <thead><tr>
                <Th>指标</Th>
                <Th align="right">当前值</Th>
                <Th align="right">目标</Th>
                {showTrendColumn && <Th>趋势</Th>}
                <Th>状态</Th>
              </tr></thead>
              <tbody>
                {order.map((index, at) => {
                  const item = KPIS[index];
                  const state = states[index];
                  const plain = operatorCopyText(KPI_PLAIN[item.n] ?? "");
                  return (
                    <Tr key={item.n} selected={index === safeSelKpi} onOpen={() => void selectKpi(index)} onKeyDown={(event) => moveRow(event, at)} title="点击查看明细">
                      <Td><Cell main={<AutoGloss>{operatorCopyText(item.name)}</AutoGloss>} sub={plain} title={plain} /></Td>
                      <Td align="right"><Cell num main={valueText(item)} sub={item.momDelta == null ? undefined : deltaText(item)} /></Td>
                      <Td align="right"><Cell num main={tgtShort(item)} /></Td>
                      {showTrendColumn && <Td>{item.spark.length >= 2
                        ? <Sparkline label={`${operatorCopyText(item.name)}的走势`} values={item.spark} />
                        : <span className="rd-note" data-proof="l1-kpi-trend-unavailable">趋势数据不足</span>}</Td>}
                      <Td><StatusTag tone={STATE_TONE[state]}>{stateText(state, item)}</StatusTag></Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            {!showTrendColumn && <p className="rd-note rd-panel-foot" data-proof="l1-kpi-trend-unavailable">这个范围的趋势数据不足，走势暂时画不出来，不会用 0 补齐。</p>}
          </Panel>

          <Panel
            title={<AutoGloss>{operatorCopyText(k.name)}</AutoGloss>}
            sub={<StatusTag tone={STATE_TONE[kState]}>{stateText(kState, k)}</StatusTag>}
            icon={Target}
            tone={STATE_TONE[kState]}
            actions={attributionLinks.filter((j) => reach(j.href, ATTRIBUTION_ROUTE_READ[j.href])).map((j) => (
              <Link key={j.label} className="rd-link" href={j.href}>去「{findByPath(j.href)?.l2.name ?? j.label}」查原因</Link>
            ))}
          >
            <div className="rd-stack">
              {kState !== "na" && (
                <ThresholdMeter
                  label="当前值和目标"
                  rows={[{ key: "now", label: "当前", value: k.value, text: valueText(k), tone: STATE_TONE[kState] }]}
                  marks={goalMarks}
                />
              )}
              <Facts>
                {kState === "na" && <Fact k="当前值">不可计算</Fact>}
                {kState === "na" && <Fact k="目标值">{tgtShort(k)}</Fact>}
                <Fact k="分子">{ext.num}</Fact>
                <Fact k="分母">{ext.den}</Fact>
                <Fact k="较上期">{deltaText(k)}</Fact>
                <Fact k="统计范围">{queryScope(applied)}</Fact>
                <Fact k="解读"><AutoGloss>{operatorCopyText(ext.note)}</AutoGloss></Fact>
              </Facts>
              {drillError
                ? <BlockState state="error" title="明细和趋势暂时加载不出来" detail={`其他内容不受影响。${drillError}`} onRetry={() => void selectKpi(safeSelKpi)} />
                : trendReady
                  ? <Panel plain headingLevel={3} title="最近在变好还是变坏" sub="所选时间范围等分六段">
                      <TrendLines
                        label={`${operatorCopyText(k.name)}的走势`}
                        ticks={WEEKS}
                        format={pct}
                        series={[{ key: "kpi", label: operatorCopyText(k.name), slot: 2, values: k.spark }]}
                        marks={goalMarks}
                        event={phaseEvent}
                      />
                    </Panel>
                  : <p className="rd-note">当前筛选范围没有可绘制的趋势点；不会用 0 补齐缺失周。</p>}
              <Fold inset title="这项指标怎么算" summary={`统计规则编号 #${k.n}`}>
                <div className="rd-stack">
                  <p className="rd-note"><AutoGloss>这项指标怎么算 · 统计规则统一管理,这里只能看不能改</AutoGloss></p>
                  <div><AutoGloss>{operatorCopyText(KPI_PLAIN[k.n] ?? "")}</AutoGloss></div>
                  <div>{renderFx(ext.fx, ext.fxBold)}</div>
                  <p className="rd-note">统计规则编号 #{k.n} · 数据批次 {k.vis}</p>
                </div>
              </Fold>
            </div>
          </Panel>
        </div>

        <Fold title="几项指标一起看，谁离目标远" icon={Activity} tone="role-2" summary={drawable.length ? `已选 ${ovlSel.length} 项，画出 ${drawable.length} 项` : `已选 ${ovlSel.length} 项，趋势数据不足`}>
          <div className="rd-stack">
            <div role="group" aria-label="要比的指标" className="rd-filter-more-row">
              {KPIS.map((item, index) => {
                const on = ovlSel.includes(index);
                return <Check key={item.n} label={`#${item.n} ${operatorCopyText(item.name)}`} checked={on} disabled={on && ovlSel.length === 1} onChange={() => setOvlSel((current) => (on ? current.filter((value) => value !== index) : [...current, index]))} />;
              })}
            </div>
            <p className="rd-note">至少留一项。对比多个指标的趋势，观察运营阶段切换后的变化；原因可到「运营阶段状态」或「运营阶段设置」查看。按行为记录中的运营阶段统计。</p>
            {drawable.length
              ? <TrendLines
                  label="多个关键指标的对比趋势"
                  ticks={WEEKS}
                  format={(value) => value.toFixed(0)}
                  series={drawable.map(({ item, slot, values }) => ({ key: String(item.n), label: `#${item.n} ${operatorCopyText(item.name)}`, slot, values }))}
                  marks={[{ key: "target", text: "目标线 = 各自目标值(指数 100)", value: 100, tone: "ok" }]}
                  event={phaseEvent}
                />
              : <p className="rd-note">当前所选指标没有足够的趋势数据，暂时无法画出对比曲线。</p>}
            {drawable.length > 0 && <p className="rd-note">纵轴 = 实际值 ÷ 目标值(目标线 100)</p>}
            {drawable.length > 0 && skipped.length > 0 && <p className="rd-note">没有画：{skipped.map(({ item }) => `#${item.n}`).join(" ")}，趋势数据不足。</p>}
          </div>
        </Fold>

        <Fold title="指标规则表" icon={Lock} summary={`${KPIS.length} 项 · 算法和目标已锁定`}>
          <div className="rd-stack">
            <p className="rd-note"><AutoGloss>每项关键指标怎么算一目了然 · 要改算法须走事件统计规则管理 + 操作确认,本页改不了</AutoGloss></p>
            <Table label="关键指标的计算方式">
              <thead><tr><Th>#</Th><Th>指标</Th><Th>计算方式</Th><Th align="right">目标</Th><Th>启用批次</Th><Th>状态</Th></tr></thead>
              <tbody>
                {KPIS.map((item, index) => (
                  <Tr key={item.n}>
                    <Td><Cell num main={item.n} /></Td>
                    <Td><Cell main={<AutoGloss>{operatorCopyText(item.name)}</AutoGloss>} /></Td>
                    <Td><Cell main={<AutoGloss>{operatorCopyText(KPI_PLAIN[item.n] ?? "")}</AutoGloss>} sub={renderFx(KPI_EXT[item.n].fx, KPI_EXT[item.n].fxBold)} /></Td>
                    <Td align="right"><Cell num main={tgtShort(item)} /></Td>
                    <Td><Cell main={item.vis} /></Td>
                    <Td><StatusTag tone={STATE_TONE[states[index]]}>{stateText(states[index], item)}</StatusTag></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <p className="rd-note"><AutoGloss>推广率表示发出过邀请的设备持有者占比；各项指标的可用性和统计范围以当前返回数据为准。</AutoGloss></p>
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
        actions={actions}
        meta={readAt ? `${readAt} 读取（${businessZone().label}）· 打开时读取，不自动刷新` : "打开时读取，不自动刷新"}
        readOnly={ctx.canExport ? undefined : "当前角色仅可查看 · 导出需报表管理权限"}
      />
      {queryBar}
      {refreshError && rawKpis.length > 0 && (
        <Notice tone="warn" title="关键指标刷新失败" action={<Button size="sm" onClick={retryLast}>重试</Button>}>
          以下是 {readAt} 的数据，时间范围未切换。{refreshError}
        </Notice>
      )}
      {body}
      {editingOffset && <OffsetModal current={ylOffset} onClose={() => setEditingOffset(false)} onApply={(next) => { setYlOffset(next); ctx.toast(`黄灯预警偏移 → 距目标 ${next}% · 仅视图参数`); }} />}
    </>
  );
}
