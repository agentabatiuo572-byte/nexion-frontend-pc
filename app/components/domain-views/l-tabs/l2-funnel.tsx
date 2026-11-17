"use client";
import { useReach } from "@/lib/nav/use-reach";

/**
 * L2 · 用户转化与留存（「用户转化概览」B3 的下钻页）。
 * 一句结论 → 四个关键数字 → 四步漏斗 ┬ 所选一步的人数、耗时和试用线 → 页签：按注册时间看留存 / 渠道 × 语言 → 查原因。
 * 读取、校验、导出请求和本机视图都沿用改版前的写法（请求逐字节不变），这里只换界面。
 * 留存要用的 App 日活、试用第一步的事件还没有产生方（决定 L2-来源）：这两处显示「数据来源还没接上」，不显示成 0。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarCheck, CalendarRange, Download, Filter, Gift, Hourglass, Languages, Route, TrendingDown, TrendingUp, Users, Wallet } from "lucide-react";
import { BlockState, Button, Check, Conclusion, Explain, Fact, Facts, FilterBar, FilterField, Fold, Input, Notice, PageHeader, PageTabs, Panel, Segments, Select, Stat, StatBand, StatusTag, Table, Td, Th, Tr, Cell, TrendLines, useTabIds } from "@/app/components/rd";
import { displayAdminReadError, formatAdminApiError } from "@/lib/admin/error-messages";
import {
  fetchL2Cross,
  fetchL2FunnelDrilldown,
  fetchL2RetentionCurve,
  fetchL2RetentionMatrix,
  isLOutcomeUnknownError,
  type L2FunnelQuery,
  type L2TrialFunnel,
} from "@/lib/admin/l-client";
import { formatB3RefOption } from "@/lib/admin/b3-ref-display";
import { lowestConversionIndex } from "@/lib/admin/funnel-conversion";
import { businessZone } from "@/lib/admin/business-time";
import { findByPath } from "@/lib/nav/console-nav";
import { INTERFACE_LANGUAGES } from "@/lib/admin/platform-experience-client";
import { PaginationExemptionList } from "../design-kit";
import { rec, rows, str, strings } from "./live-data";
import { readL2LiveStages, SMALL_SAMPLE_LABEL, type L2LiveStage } from "./l1-l2-live-data";
import {
  isCanonicalL2StageEvents,
  L2_STAGE_EVENT_CONTRACT,
  L2_STAGE_QUERY_EVENTS,
  validateL2FunnelEventBindings,
  validateL2LifecycleContract,
} from "./l2-stage-events-contract";
import type { LCtx } from "./types";
import { ATTRIBUTION_ROUTE_READ, L2_ATTRIBUTION_LINKS } from "./l-attribution-routes";
import {
  CrossTable,
  DwellChart,
  leadingCount,
  pct,
  people,
  RetentionHeatmap,
  StageTable,
  STEP_RULE,
  StepFunnel,
  TrialLine,
  type CohortRow,
  type FunnelExt,
  type FunnelRow,
  type XdMetric,
} from "./l2-funnel-views";

/** 后端待办 L2-BE01：留存要用的 App 日活事件（app.dau）还没有产生方，成熟的组会被算成 0%。后端接上后改成 true。 */
const RETENTION_SOURCE_READY = false;
/** 试用这条线（L2-BE-02，后端 5cb76001）：开始试用 → 试用后购买两步。旧后端不给 trialFunnel，照旧写「来源未接上」。 */
const TRIAL_OLD_NOTE = "试用人数还没接上，先不显示，不是 0 人。";
const trialReason = (reason: string | null | undefined) => formatAdminApiError(reason ?? "TRIAL_EVENT_LINKAGE_INCOMPLETE", "试用人数暂不可用。");

const L2_STAGE_EVENTS = L2_STAGE_QUERY_EVENTS;
const L2_WINDOWS = ["Day1", "Day7", "Day14", "Day30", "Day60"] as const;
const EXPORT_PAGE = "/analytics/export";
const DETAIL_ID = "l2-step-detail";
const PHASES = ["P1", "P2", "P3", "P4", "P5", "P6"] as const;
const LANGUAGE_NAME = new Map<string, string>(INTERFACE_LANGUAGES.map((item) => [item.code, item.zhName]));
const PROTECT_NOTE = "少于 5 人的分组不显示人数和比例，0 人也算，防止从小分组推出具体用户。";
const METRIC_NAME = { cvr: "首购转化率", ret: "第 7 天仍活跃", trial: "试用后购买比例" } as const;

function finitePercent(value: unknown, allowNull = true) {
  if (allowNull && value == null) return true;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function finiteCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validCurve(raw: unknown) {
  if (!Array.isArray(raw) || raw.length === 0) return false;
  let previousDay = -1;
  return raw.every((point) => {
    if (!Array.isArray(point) || point.length !== 2) return false;
    const [day, value] = point;
    if (!finiteCount(day) || day <= previousDay || !finitePercent(value, false)) return false;
    previousDay = day;
    return true;
  });
}

function hasDetailedL2(raw: unknown) {
  const data = rec(raw);
  return ["funnel", "funnelExt", "cohorts", "curves", "crossAnalysis"]
    .some((key) => Object.prototype.hasOwnProperty.call(data, key));
}

export function isStrictL2Dashboard(raw: unknown): boolean {
  const data = rec(raw);
  const funnel = rows<Record<string, unknown>>(data.funnel);
  const extensions = rows<Record<string, unknown>>(data.funnelExt);
  const cohorts = rows<Record<string, unknown>>(data.cohorts);
  const monthly = rows<Record<string, unknown>>(data.monthlyCohorts);
  const lifecycleStagesPresent = Object.prototype.hasOwnProperty.call(data, "stages");
  const canonicalStageCount: number = L2_STAGE_EVENT_CONTRACT.length;
  if (canonicalStageCount === 0 || funnel.length !== canonicalStageCount || extensions.length !== canonicalStageCount || cohorts.length === 0
    || !isCanonicalL2StageEvents(data.stageEvents)
    || !validateL2FunnelEventBindings(data.funnel, data.stageEvents)
    || (lifecycleStagesPresent && !validateL2LifecycleContract(data))) return false;
  let previousUsers = Number.MAX_SAFE_INTEGER;
  for (let index = 0; index < funnel.length; index += 1) {
    const item = funnel[index];
    const ext = extensions[index];
    if (!str(item.stage) || !str(item.lc) || !str(item.color) || !str(ext.plain)
      || !Array.isArray(ext.dwell) || ext.dwell.some((value) => !finiteCount(value))) return false;
    if (item.suppressed === true) {
      if (item.users != null || item.cvr != null || ext.suppressed !== true
        || ext.inflow != null || ext.lost != null || ext.dwell.length) return false;
      continue;
    }
    if (!finiteCount(item.users) || !finitePercent(item.cvr) || Number(item.users) > previousUsers) return false;
    previousUsers = Number(item.users);
  }
  const validateCohorts = (items: Record<string, unknown>[], pattern: RegExp) => {
    const seen = new Set<string>();
    return items.every((item) => {
      const key = str(item.w || item.cohort);
      if (!pattern.test(key) || seen.has(key)) return false;
      seen.add(key);
      const rates = [item.d1, item.d7, item.d14, item.d30, item.d60];
      return item.suppressed === true
        ? item.size == null && rates.every((rate) => rate == null)
        : finiteCount(item.size) && rates.every((rate) => finitePercent(rate));
    });
  };
  if (!validateCohorts(cohorts, /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/)
    || (monthly.length > 0 && !validateCohorts(monthly, /^\d{4}-(?:0[1-9]|1[0-2])$/))) return false;
  const validateCurves = (items: Record<string, unknown>[], curves: Record<string, unknown>) => items.every((item) => {
    const curve = curves[str(item.w || item.cohort)];
    return item.suppressed === true ? Array.isArray(curve) && curve.length === 0 : validCurve(curve);
  });
  if (!validateCurves(cohorts, rec(data.curves)) || !validateCurves(monthly, rec(data.monthlyCurves))) return false;
  const cross = rec(data.crossAnalysis);
  for (const key of ["cvr", "ret", "trial"]) {
    const metric = rec(cross[key]);
    const columns = strings(metric.columns);
    const metricRows = rows<unknown[]>(metric.rows);
    if (columns.length === 0 || new Set(columns).size !== columns.length || metricRows.length === 0
      || metricRows.some((row) => row.length !== columns.length + 2
        || !str(row[0])
        || row.slice(1).some((value) => !finitePercent(value)))) return false;
  }
  const quality = rec(data.quality);
  return quality.sameUserJoin === true
    && quality.stageOrderEnforced === true
    && quality.incompleteRatesAreNull === true;
}

function normalizeXdMetric(raw: unknown): XdMetric {
  const data = rec(raw);
  const msg = rec(data.msg);
  const message = str(data.message);
  return {
    columns: strings(data.columns),
    rows: rows<(string | number | null)[]>(data.rows),
    alert: rows<number>(data.alert),
    suppressedCells: new Set(rows<[number, number]>(data.suppressedCells).map(([row, column]) => `${row}:${column}`)),
    unit: str(data.unit, "%"),
    msg: {
      pre: str(msg.pre, message),
      bold: str(msg.bold),
      post: str(msg.post),
    },
  };
}

/** 现在看的是哪一批人：已应用的条件，不是输入框里还没提交的。 */
function scopeText(query: L2FunnelQuery) {
  const parts = [
    query.cohort ? `注册批次 ${query.cohort}` : null,
    query.phase ? `阶段 ${query.phase}` : null,
    query.locale ? `语言 ${LANGUAGE_NAME.get(query.locale.toLowerCase().split("-")[0]) ?? query.locale}（${query.locale}）` : null,
    query.ref ? `渠道 ${formatB3RefOption(query.ref)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "全部注册用户";
}

const caliberNote = () => (
  <>
    <p>同一批注册用户按时间先后走四步：注册 → 首购 → 锁定计划 → 提现，后一步必须晚于前一步，同一时刻不算。同一人只算一次，转化率 = 这一步人数 ÷ 上一步人数。</p>
    <p>锁定计划：首购之后，锁定计划和第二笔购买里先发生的那一个。提现：提交了提现申请，不代表已经到账。</p>
    <p>只算最近 400 天服务器记下的事件，App 自己记的不算。按注册时的阶段、语言、渠道选人，不是用户现在的设置。日期按平台业务日（{businessZone().label}）算。晚到的事件下次查询时算进去。</p>
    <p>和「用户转化概览」是同一套四步规则：那边看全貌，这页按注册批次、阶段、语言、渠道细看，条件不同时两页的数可能不同。统计方式是固定的，这页改不了。</p>
    <p>{PROTECT_NOTE}</p>
  </>
);

/** 降级时的四个累计数各是什么。照后端现行统计写（D06），不沿用旧页面的「账户数、订单行、钱包记录」。 */
const LIVE_STAGE_TEXT: Record<string, { label: string; what: string; icon: typeof Users }> = {
  registered: { label: "注册完成", what: "完成注册的人数", icon: Users },
  profileCompleted: { label: "完善资料", what: "完成资料填写的人数", icon: Users },
  ordered: { label: "发起下单", what: "发起过结账的人数，不等于付款成功", icon: Route },
  walletActivity: { label: "充值到账", what: "有充值到账记录的人数", icon: Wallet },
};

function LiveStagesView({ stages, reason }: { stages: L2LiveStage[]; reason: string }) {
  const coverage = reason === "ACTOR_COVERAGE_INCOMPLETE";
  return (
    <>
      <Conclusion state="unknown" hint={coverage ? "有的事件缺少用户编号，算不出同一批人的转化；补齐前只能看四项各自的人数。" : "详细数据准备好之前，只能看四项各自的人数。"}
        explain="四个数各自统计，不是同一批人，相除得出的不是转化率，所以页面不画漏斗、不算比例。">
        用户转化：详细数据暂不可用
      </Conclusion>
      <StatBand label="四项各自的累计人数">
        {stages.map((stage) => {
          const text = LIVE_STAGE_TEXT[stage.key];
          return <Stat key={stage.key} label={text?.label ?? stage.label} value={stage.suppressed || stage.count == null ? SMALL_SAMPLE_LABEL : people(stage.count)} unit={stage.suppressed || stage.count == null ? undefined : "人"}
            sub={stage.suppressed ? "少于 5 人，不显示" : "各自累计 · 不能相除"} tone="role-3" icon={text?.icon ?? Users} />;
        })}
      </StatBand>
      <Panel title="这四个数从哪来" icon={Filter} tone="role-other" flush
        explain={<><p>每项按人数算，同一个人只算一次；没有用户编号的按匿名编号或单条事件算。</p><p>不限时间范围，和详细漏斗的「最近 400 天」不是同一个范围。{PROTECT_NOTE}</p></>}>
        <Table label="四项累计人数的来源">
          <thead><tr><Th>项目</Th><Th align="right">人数</Th><Th>统计的是</Th><Th>对应事件</Th></tr></thead>
          <tbody>
            {stages.map((stage) => (
              <Tr key={stage.key}>
                <Td><Cell main={LIVE_STAGE_TEXT[stage.key]?.label ?? stage.label} /></Td>
                <Td align="right"><Cell num main={stage.suppressed || stage.count == null ? SMALL_SAMPLE_LABEL : people(stage.count)} /></Td>
                <Td><Cell main={LIVE_STAGE_TEXT[stage.key]?.what ?? stage.description} /></Td>
                <Td grow><Cell mono main={stage.source.replace(/^nx_event_outbox:/, "")} title={stage.source} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}

export function L2Funnel({ ctx, title, summary }: { ctx: LCtx; title: ReactNode; summary: string }) {
  const reach = useReach();
  const ids = useTabIds();
  const [selStage, setSelStage] = useState(2);
  const [selCohort, setSelCohort] = useState(4);
  const [cmp, setCmp] = useState<string>("none");
  const [metric, setMetric] = useState<"cvr" | "ret" | "trial">("cvr");
  const [wins, setWins] = useState<string[]>(["Day1", "Day7", "Day30"]);
  const [gran, setGran] = useState(0);
  const [draftCohort, setDraftCohort] = useState(ctx.l2Query?.cohort ?? "");
  const [draftPhase, setDraftPhase] = useState<L2FunnelQuery["phase"]>(ctx.l2Query?.phase ?? "");
  const [draftLocale, setDraftLocale] = useState(ctx.l2Query?.locale ?? "");
  const [draftRef, setDraftRef] = useState(ctx.l2Query?.ref ?? "");
  const [queryData, setQueryData] = useState<Record<string, unknown> | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [sliceLoading, setSliceLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [crossOverride, setCrossOverride] = useState<Record<string, unknown> | null>(null);
  const queryGeneration = useRef(0);
  // 以下只管显示：哪个输入框填错了、下面看哪个页签、导出后的结果条。不参与请求。
  const [invalidField, setInvalidField] = useState<"cohort" | "locale" | "ref" | null>(null);
  const [tab, setTab] = useState<"retention" | "cross">("retention");
  const [exportOutcome, setExportOutcome] = useState<"full" | "stages" | "unknown" | null>(null);

  useEffect(() => () => { queryGeneration.current += 1; }, []);

  const cancelQuery = () => {
    queryGeneration.current += 1;
    setQueryLoading(false);
    setSliceLoading(false);
  };

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("nexion:l2:view") || "null") as {
        wins?: string[];
        gran?: number;
        metric?: "cvr" | "ret" | "trial";
        cohort?: string;
        phase?: L2FunnelQuery["phase"];
        locale?: string;
        ref?: string;
      } | null;
      if (!saved) return;
      if (Array.isArray(saved.wins)) setWins(saved.wins.filter((item) => L2_WINDOWS.includes(item as typeof L2_WINDOWS[number])));
      if (saved.gran === 0 || saved.gran === 1) setGran(saved.gran);
      if (saved.metric && ["cvr", "ret", "trial"].includes(saved.metric)) setMetric(saved.metric);
      if (typeof saved.cohort === "string") setDraftCohort(saved.cohort);
      if (saved.phase && ["P1", "P2", "P3", "P4", "P5", "P6"].includes(saved.phase)) setDraftPhase(saved.phase);
      if (typeof saved.locale === "string") setDraftLocale(saved.locale);
      if (typeof saved.ref === "string") setDraftRef(saved.ref);
    } catch {
      // An invalid local view is ignored; analytics data and canonical formulas are never affected.
    }
  }, []);

  const saveView = () => {
    try {
      localStorage.setItem("nexion:l2:view", JSON.stringify({
        wins,
        gran,
        metric,
        cohort: draftCohort.trim(),
        phase: draftPhase,
        locale: draftLocale.trim(),
        ref: draftRef.trim(),
      }));
      ctx.toast("已保存在这台电脑的浏览器里：筛选条件、分组方式、留存天数和对比指标；统计方式未改变", "success");
    } catch {
      ctx.toast("视图保存失败 · 浏览器存储不可用，请稍后重试", "error");
    }
  };

  const applySlice = async (stage?: L2FunnelQuery["stage"]) => {
    const cohort = draftCohort.trim();
    const locale = draftLocale.trim();
    const ref = draftRef.trim();
    if (cohort && !/^\d{4}-(?:W(?:0[1-9]|[1-4]\d|5[0-3])|(?:0[1-9]|1[0-2]))$/.test(cohort)) {
      setQueryError("注册批次格式无效：写成年份和周数（如 2026-W45）或年月（如 2026-11）");
      setInvalidField("cohort");
      ctx.setL2SliceExportable?.(false);
      return;
    }
    if (locale && !/^[a-z]{2,8}(?:-[a-z0-9]{2,8})?$/i.test(locale)) {
      setQueryError("语言代码格式无效：写语言代码，如 vi、zh 或 zh-CN");
      setInvalidField("locale");
      ctx.setL2SliceExportable?.(false);
      return;
    }
    if (ref && (!/^[\p{L}\p{N}._:-]+$/u.test(ref) || ref.length > 96)) {
      setQueryError("推荐码 / 渠道只能包含字母、数字、点、下划线、冒号或连字符，最多 96 个字符");
      setInvalidField("ref");
      ctx.setL2SliceExportable?.(false);
      return;
    }
    setInvalidField(null);
    const query: L2FunnelQuery = { stage, cohort, phase: draftPhase, locale, ref };
    const generation = ++queryGeneration.current;
    setQueryLoading(true);
    setSliceLoading(true);
    setQueryError(null);
    setQueryData({});
    setCrossOverride(null);
    ctx.setL2SliceExportable?.(false);
    try {
      const response = await fetchL2FunnelDrilldown(query);
      if (generation !== queryGeneration.current) return;
      if (response.available === false) {
        setQueryData(response);
        ctx.setL2Query?.({ cohort, phase: draftPhase, locale, ref });
        if (response.reason !== "NO_REGISTRATION_COHORT") {
          setQueryError(str(response.message, "当前筛选条件下没有可计算的注册用户分组"));
        }
        return;
      }
      if (!isStrictL2Dashboard(response)) {
        throw new Error("L2_RESPONSE_PROTOCOL_ERROR");
      }
      setQueryData(response);
      ctx.setL2Query?.({ cohort, phase: draftPhase, locale, ref });
      ctx.setL2SliceExportable?.(true);
      ctx.toast(stage ? "已按当前筛选加载明细" : "已按当前筛选重新计算", "success");
    } catch (error) {
      if (generation === queryGeneration.current) setQueryError(error instanceof Error ? displayAdminReadError(error) : "查询失败");
    } finally {
      if (generation === queryGeneration.current) {
        setQueryLoading(false);
        setSliceLoading(false);
      }
    }
  };

  const clearAll = () => {
    cancelQuery();
    setDraftCohort("");
    setDraftPhase("");
    setDraftLocale("");
    setDraftRef("");
    setQueryData(null);
    setQueryError(null);
    setInvalidField(null);
    setCrossOverride(null);
    ctx.setL2Query?.({});
    ctx.setL2SliceExportable?.(true);
    ctx.toast("已恢复全部数据");
  };
  const backToAll = () => {
    cancelQuery();
    setQueryData(null);
    setQueryError(null);
    setInvalidField(null);
    setCrossOverride(null);
    ctx.setL2Query?.({});
    ctx.setL2SliceExportable?.(true);
  };

  const data = queryData ?? ctx.biData?.l2;
  const detailedAttempt = hasDetailedL2(data);
  const strictDetailed = isStrictL2Dashboard(data);
  const FUNNEL = rows<FunnelRow>(data?.funnel);
  const FUNNEL_EXT = rows<FunnelExt>(data?.funnelExt);
  // trialFunnel 在读取边界已按新口径校验过（l-client normalizeL2Trial），这里只是把 Record 里的类型取回来。
  const TRIAL = data?.trialFunnel as L2TrialFunnel | undefined;
  const [TRIAL_START, TRIAL_BUY] = TRIAL?.steps ?? [];
  const WEEKLY_COHORTS = rows<CohortRow>(data?.cohorts);
  const MONTHLY_COHORTS = rows<CohortRow>(data?.monthlyCohorts);
  const cohortKind = gran === 1 && MONTHLY_COHORTS.length ? "月" : "周";
  const COHORTS = cohortKind === "月" ? MONTHLY_COHORTS : WEEKLY_COHORTS;
  const CURVES = rec<[number, number][]>(cohortKind === "月" ? data?.monthlyCurves : data?.curves);
  const XD = crossOverride ?? rec(data?.crossAnalysis);
  const STAGE_EV = strings(data?.stageEvents);
  const day7 = rec(data?.day7Kpi);
  const liveStages = detailedAttempt ? [] : readL2LiveStages(data);
  const applied: L2FunnelQuery = ctx.l2Query ?? {};
  const scope = scopeText(applied);

  /* ---- 页头导出：条件和请求体沿用改版前（L2-A03），按钮按 rd 的写法放进页头。 ---- */
  const parentComplete = isStrictL2Dashboard(ctx.biData?.l2);
  const parentLiveStages = hasDetailedL2(ctx.biData?.l2) ? [] : readL2LiveStages(ctx.biData?.l2);
  const exportable = ctx.l2SliceExportable !== false && (parentComplete || parentLiveStages.length > 0);
  const exportLabel = parentComplete ? "导出用户转化与留存数据" : "导出用户各阶段人数";
  const exportPageName = findByPath(EXPORT_PAGE)?.l2.name ?? "数据导出与监管报告";
  const canOpenExportPage = reach(EXPORT_PAGE, "bi_l5_read");
  const exportFunnel = () => {
    const complete = parentComplete;
    setExportOutcome(null);
    ctx.openActionConfirm({ briefKind: "export",
      title: complete ? "导出用户转化与留存数据" : "导出用户各阶段人数",
      action: complete ? "导出用户转化与留存数据" : "导出用户各阶段人数",
      detail: complete
        ? "导出这批用户的四步人数、转化率和按注册周的留存。只有汇总数，不含手机号、地址等个人信息；操作会留记录。"
        : "详细转化与留存数据暂不可用，只导出四项各自的累计人数，不算转化率或留存率；不含手机号、地址等个人信息，操作会留记录。",
      statedBrief: { impact: "生成一个导出任务，不改业务数据，留操作记录。", check: complete ? "看范围是不是你要的这批人。" : "这四个数各自统计，不能相除当转化率。" },
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      reasonPlaceholder: "写这份数据给谁、做什么用，例如：给增长组复盘 W45 越南语渠道",
      confirmLabel: "确认导出",
      facts: (
        <Facts>
          <Fact k="范围">{complete ? scopeText(ctx.l2Query ?? {}) : "全部数据，不带筛选"}</Fact>
          <Fact k="文件内容">{complete
            ? <>四步的人数和转化率，加最近 6 个注册周的第 1、7、14、30、60 天留存<Explain label="导出哪些不导出哪些" content={<><p>不导出：按注册月分组、试用、渠道 × 语言、留存曲线；和页面上选的哪一步、看第几天无关。</p><p>样本过小的格子留空并标「样本过小」，还没到的天数留空。</p><p>导出时按当时的最新事件重新计算，可能和页面上的数稍有不同。</p></>} /></>
            : <>四项各自的累计人数，一项一行<Explain label="导出的说明" content="导出时按当时的数据重新读取；如果那时详细数据已经可用，会导出完整的转化与留存。" /></>}</Fact>
          {complete && !RETENTION_SOURCE_READY && <Fact k="留存列" tone="warn">日活事件还没接上，导出的留存率不可信，先别用</Fact>}
          <Fact k="文件格式">CSV</Fact>
          <Fact k="去哪下载">「{exportPageName}」</Fact>
        </Facts>
      ),
      reasonMax: 200,
      run: async (reason) => {
        try {
          await ctx.biActions?.createReport({
            exportType: complete ? "漏斗序列" : "漏斗生命周期事实",
            timeRange: complete ? "当前同批用户时段" : "当前数据",
            fields: complete ? "四步人数和转化率、注册周留存率" : "注册、资料、订单、钱包四项累计人数",
            piiLevel: "NONE",
            maskPolicy: "NONE",
            recipient: "数据分析管理员",
            ticket: "L2-FUNNEL",
            cohort: complete ? ctx.l2Query?.cohort : undefined,
            phase: complete ? ctx.l2Query?.phase : undefined,
            locale: complete ? ctx.l2Query?.locale : undefined,
            ref: complete ? ctx.l2Query?.ref : undefined,
          }, reason);
        } catch (error) {
          // 结果未知仍交给外壳关框、重读、提示（l-view）；这里只记下来，在页面上留一条核对提示（决定 B4-PD02）。
          if (isLOutcomeUnknownError(error)) setExportOutcome("unknown");
          throw error;
        }
        await ctx.reloadBi?.();
        ctx.toast(complete ? "用户转化与留存数据已生成导出" : "用户各阶段人数已生成导出", "success");
        setExportOutcome(complete ? "full" : "stages");
      },
    });
  };
  const exportBlocked = ctx.biLoading ? "正在读取，读完再导出"
    : ctx.l2SliceExportable === false ? "这次筛选的结果不能导出：正在查询、查询失败或没有注册用户。点「清空」或重新查询后再导出"
      : !exportable ? "暂无可导出的数据" : undefined;
  const exportPageLink = (text: string) => (canOpenExportPage
    ? <Link className="rd-link" href={EXPORT_PAGE}>{text}</Link>
    : `你没有「${exportPageName}」的权限，请找有权限的同事下载。`);

  const header = (
    <PageHeader
      pageId="L2"
      title={title}
      summary={summary}
      actions={ctx.canExport ? (
        <span className="l2-pair" data-pair="">
          <Explain label="导出的说明" content={<><p>填理由后生成一个 CSV 导出任务，到「{exportPageName}」下载。</p><p>只有汇总数，不含个人信息，不改业务数据，每次导出都留操作记录。</p></>} />
          <Button icon={<Download size={14} aria-hidden />} disabledReason={exportBlocked} onClick={exportFunnel}>{exportLabel}</Button>
        </span>
      ) : undefined}
      readOnly={ctx.canExport ? undefined : "你可以调整筛选、保存本机视图；导出需要报表管理权限。"}
    />
  );

  const exportNotice = exportOutcome === "unknown" ? (
    <Notice tone="warn" title="导出结果未知" action={<Button size="sm" onClick={() => setExportOutcome(null)}>知道了</Button>}>
      任务可能已经生成。{canOpenExportPage
        ? <>先{exportPageLink(`到「${exportPageName}」看有没有这条任务`)}，没有再重新导出。</>
        : <>你没有「{exportPageName}」的权限，请找有权限的同事核对，没有再重新导出。</>}
    </Notice>
  ) : exportOutcome ? (
    <Notice tone="ok" title={exportOutcome === "full" ? "已生成导出：用户转化与留存数据" : "已生成导出：用户各阶段人数"} action={<Button size="sm" onClick={() => setExportOutcome(null)}>知道了</Button>}>
      {exportPageLink(`到「${exportPageName}」下载`)}
    </Notice>
  ) : null;

  const draftChanged = draftCohort.trim() !== (applied.cohort ?? "") || draftPhase !== (applied.phase ?? "")
    || draftLocale.trim() !== (applied.locale ?? "") || draftRef.trim() !== (applied.ref ?? "");
  const anyCondition = Boolean(draftCohort || draftPhase || draftLocale || draftRef || applied.cohort || applied.phase || applied.locale || applied.ref);
  const filterBar = (
    <FilterBar
      onSubmit={() => void applySlice()}
      querying={queryLoading}
      action={<Button type="submit" loading={queryLoading}>查看筛选结果</Button>}
      onClear={clearAll}
      canClear={!queryLoading && (anyCondition || queryData !== null)}
      clearLabel="清空"
      sort={<span className="l2-pair" data-pair="">
        <Button onClick={saveView}>保存为视图</Button>
        <Explain label="保存为视图存什么" content={<><p>只存在这台电脑的浏览器里，换电脑、换浏览器或清浏览器数据就没了。</p><p>存输入框里的筛选条件、按周或月分组、看第几天的留存和渠道 × 语言看哪项指标；不存数字，不改统计方式，也不用确认。</p><p>下次打开只把条件填回输入框，不会自动查询，要点「查看筛选结果」。</p></>} />
      </span>}
      result={<>现在看：{scope}{draftChanged ? " · 输入框里的条件还没应用" : ""}</>}
      notice={invalidField && queryError ? queryError : undefined}
    >
      <FilterField label="注册批次">
        <Input aria-label="注册批次" aria-invalid={invalidField === "cohort" || undefined} placeholder="如 2026-W45" value={draftCohort} onChange={(event) => setDraftCohort(event.target.value)} />
      </FilterField>
      <FilterField label="运营阶段">
        <Select aria-label="运营阶段" value={draftPhase ?? ""} onChange={(value) => setDraftPhase(value as L2FunnelQuery["phase"])}
          options={[{ value: "", label: "全部阶段" }, ...PHASES.map((phase) => ({ value: phase, label: phase }))]} />
      </FilterField>
      <FilterField label="语言">
        <Input aria-label="语言" aria-invalid={invalidField === "locale" || undefined} placeholder="如 vi" value={draftLocale} onChange={(event) => setDraftLocale(event.target.value)} />
      </FilterField>
      <FilterField label="推荐码 / 渠道">
        <Input aria-label="推荐码 / 渠道" aria-invalid={invalidField === "ref" || undefined} placeholder="推荐码或渠道" value={draftRef} onChange={(event) => setDraftRef(event.target.value)} />
      </FilterField>
    </FilterBar>
  );

  const page = (body: ReactNode) => (
    <>
      {header}
      {exportNotice}
      {filterBar}
      {body}
    </>
  );

  const emptyCohort = queryData?.available === false && queryData.reason === "NO_REGISTRATION_COHORT";
  if (sliceLoading) return page(<>
    <Conclusion state="unknown">用户转化：正在按新条件查询</Conclusion>
    <BlockState state="loading" title="正在查询这批用户的转化和留存…" detail="查询完成后自动显示；这次筛选的结果出来之前不能导出。" />
  </>);
  if (queryError) return page(<>
    <Conclusion state="unknown">{invalidField ? "用户转化：条件有误，这次没有查询" : "用户转化：这次查询没有成功，暂时无法判断"}</Conclusion>
    <BlockState state="error" title={invalidField ? "改好上面标出的条件再查" : "这次筛选的结果没有读到，不显示旧数据"}
      detail={invalidField ? "也可以回到全部数据。这次筛选的结果暂时不能导出。" : `${queryError} 暂时不能导出这次筛选的结果。可以改条件重新查询，或回到全部数据。`}
      onRetry={backToAll} retryLabel="返回全部数据" />
  </>);
  if (emptyCohort) return page(<>
    <Conclusion state="unknown" hint="换一个注册批次、阶段、语言或渠道再查，或点「清空」看全部。">用户转化：当前条件下没有注册用户</Conclusion>
    <BlockState state="empty" title="当前筛选条件下没有注册用户" detail="算不出同一批人的转化率和留存，也不能导出。" />
  </>);
  if (!detailedAttempt && liveStages.length) return page(<LiveStagesView stages={liveStages} reason={str(rec(data).reason)} />);
  if (detailedAttempt && !strictDetailed) return page(<>
    <Conclusion state="unknown">用户转化：统计数据暂不可用</Conclusion>
    <BlockState state="error" title="收到的转化、留存或对比数据不完整，已停止显示" detail="页面不显示不可靠的数字，也不能导出。请把这页的情况告诉技术同事。" />
  </>);
  if (!FUNNEL.length || !FUNNEL_EXT.length || !COHORTS.length) return page(<>
    <Conclusion state="unknown">{ctx.biLoading ? "用户转化：正在读取" : ctx.biError ? "用户转化：读取失败，暂时无法判断" : "用户转化：没有读到数据"}</Conclusion>
    {ctx.biLoading
      ? <BlockState state="loading" title="正在读取这批用户的转化…" />
      : ctx.biError
        ? <BlockState state="error" title="转化数据读取失败，不显示旧数据" detail={`${ctx.biError} 请先重新加载；还是失败的话，请把错误信息发给技术同事。`} onRetry={() => void ctx.reloadBi?.()} retryLabel="重新加载" />
        : <BlockState state="empty" title="这次没有读到转化数据" detail="请重新加载；仍然没有，请把情况告诉技术同事。" onRetry={() => void ctx.reloadBi?.()} retryLabel="重新加载" />}
  </>);

  const safeStage = Math.min(selStage, FUNNEL.length - 1);
  const safeCohort = Math.min(selCohort, COHORTS.length - 1);
  const latestCohort = COHORTS[COHORTS.length - 1];
  const registrations = FUNNEL[0].users;
  const withdrawals = FUNNEL[FUNNEL.length - 1].users;
  const fullCvr = registrations && withdrawals != null ? ((withdrawals / registrations) * 100).toFixed(1) : null;
  const trialSmall = !!(TRIAL_START?.suppressed || TRIAL_BUY?.suppressed);
  const s = FUNNEL[safeStage];
  const ext = FUNNEL_EXT[safeStage] ?? { plain: s.stage, inflow: "—", lost: "—", dwell: [], note: "" };
  const xd = normalizeXdMetric(XD[metric]);
  const retentionColumns = ([1, 7, 14, 30, 60] as const)
    .filter((day) => wins.includes(`Day${day}`))
    .map((day) => ({ day, key: `d${day}` as keyof CohortRow }));

  const cohortCurveKeys = COHORTS.filter((cohort) => !cohort.suppressed).map((cohort) => cohort.w);
  const activeQuery: L2FunnelQuery = ctx.l2Query ?? {};

  const loadRetentionWindows = async (nextWins: string[]) => {
    const generation = ++queryGeneration.current;
    setQueryLoading(true);
    try {
      const response = await fetchL2RetentionMatrix(activeQuery, nextWins);
      if (generation !== queryGeneration.current) return;
      const cohorts = rows<CohortRow>(response.cohorts);
      const curves = { ...rec(data?.curves) };
      for (const cohort of cohorts) {
        if (cohort.suppressed) curves[cohort.w] = [];
      }
      const merged = { ...rec(data), cohorts, curves };
      if (!isStrictL2Dashboard(merged)) throw new Error("L2_RETENTION_PROTOCOL_ERROR");
      setQueryData(merged);
      setWins(nextWins);
      ctx.setL2Query?.(activeQuery);
      ctx.setL2SliceExportable?.(true);
    } catch (error) {
      if (generation !== queryGeneration.current) return;
      ctx.setL2SliceExportable?.(false);
      setQueryError(error instanceof Error ? displayAdminReadError(error) : "留存矩阵查询失败");
    } finally {
      if (generation === queryGeneration.current) setQueryLoading(false);
    }
  };

  const loadCrossMetric = async (nextMetric: "cvr" | "ret" | "trial") => {
    const generation = ++queryGeneration.current;
    setQueryLoading(true);
    try {
      const response = await fetchL2Cross(nextMetric === "ret" ? "retention" : nextMetric, activeQuery);
      if (generation !== queryGeneration.current) return;
      const nextCross = rec(response.crossAnalysis);
      const merged = { ...rec(data), crossAnalysis: nextCross };
      if (!isStrictL2Dashboard(merged)) throw new Error("L2_CROSS_PROTOCOL_ERROR");
      setCrossOverride(nextCross);
      setMetric(nextMetric);
      ctx.setL2Query?.(activeQuery);
      ctx.setL2SliceExportable?.(true);
    } catch (error) {
      if (generation !== queryGeneration.current) return;
      ctx.setL2SliceExportable?.(false);
      setQueryError(error instanceof Error ? displayAdminReadError(error) : "交叉分析查询失败");
    } finally {
      if (generation === queryGeneration.current) setQueryLoading(false);
    }
  };

  const loadCurve = async (cohortIndex: number) => {
    const selected = COHORTS[cohortIndex];
    if (!selected) return;
    if (selected.suppressed) {
      setSelCohort(cohortIndex);
      return;
    }
    const cohort = selected.w;
    const generation = ++queryGeneration.current;
    setQueryLoading(true);
    try {
      const response = await fetchL2RetentionCurve(cohort, activeQuery);
      if (generation !== queryGeneration.current) return;
      const suppressed = response.suppressed === true;
      if (suppressed ? !Array.isArray(response.curve) || response.curve.length > 0 : !validCurve(response.curve)) {
        throw new Error("L2_RETENTION_CURVE_PROTOCOL_ERROR");
      }
      const curveKey = cohortKind === "月" ? "monthlyCurves" : "curves";
      const rowKey = cohortKind === "月" ? "monthlyCohorts" : "cohorts";
      const merged = {
        ...rec(data),
        [curveKey]: { ...rec(data?.[curveKey]), [cohort]: response.curve },
        [rowKey]: suppressed ? COHORTS.map((row) => row.w === cohort
          ? { w: row.w, size: null, suppressed: true }
          : row) : COHORTS,
      };
      if (!isStrictL2Dashboard(merged)) throw new Error("L2_RETENTION_CURVE_PROTOCOL_ERROR");
      setQueryData(merged);
      setSelCohort(cohortIndex);
      ctx.setL2Query?.(activeQuery);
      ctx.setL2SliceExportable?.(true);
    } catch (error) {
      if (generation !== queryGeneration.current) return;
      ctx.setL2SliceExportable?.(false);
      setQueryError(error instanceof Error ? displayAdminReadError(error) : "留存曲线查询失败");
    } finally {
      if (generation === queryGeneration.current) setQueryLoading(false);
    }
  };

  /* ---- 结论：后三步里「从上一步转化」最低的一步，和「用户转化概览」同一个算法，不是掉人最多的一步。 ---- */
  const lowest = lowestConversionIndex(FUNNEL.map((row) => row.suppressed ? null : row.cvr));
  const conclusionExplain = <><p>「转化率最低的一步」是首购、锁定计划、提现三步里「从上一步转化」最低的一步，不一定是掉人最多的一步，和「用户转化概览」同一个算法。</p>{caliberNote()}</>;
  const conclusion = registrations == null
    ? <Conclusion state="neutral" icon={Users} explain={PROTECT_NOTE} hint="换一个更大的范围再看，比如去掉语言或渠道。">用户转化：这批注册用户少于 5 人，人数不显示</Conclusion>
    : lowest === null
      ? <Conclusion state="neutral" icon={Users} explain={conclusionExplain} hint="后面几步人数太少，看不出卡在哪一步；换一个更大的范围再看。">用户转化：注册 {people(registrations)} 人，首购人数少于 5 人</Conclusion>
      : <Conclusion state="neutral" lead icon={TrendingDown} explain={conclusionExplain}
        hint="点漏斗里的一步，看掉了多少人、走到这一步用了多久；想找原因看页面底部「查原因」。">
        用户转化：卡在「{FUNNEL[lowest].stage}」，只有 <b>{pct(FUNNEL[lowest].cvr!)}</b> 走到这一步
      </Conclusion>;

  const day7Value = !RETENTION_SOURCE_READY ? "来源未接上" : day7.suppressed === true ? SMALL_SAMPLE_LABEL : typeof day7.value === "number" ? pct(day7.value) : "—";
  const trialValue = !TRIAL ? "来源未接上" : !TRIAL.available ? "不可用" : trialSmall ? SMALL_SAMPLE_LABEL : TRIAL_BUY?.arr ?? "—";
  const stats = (
    <StatBand label="这批用户的关键数字">
      <Stat label={`最近一个注册${cohortKind}`} value={latestCohort.suppressed ? SMALL_SAMPLE_LABEL : latestCohort.size == null ? "—" : people(latestCohort.size)} unit={latestCohort.suppressed || latestCohort.size == null ? undefined : "人"}
        sub={latestCohort.suppressed ? `${latestCohort.w} · 少于 5 人，不显示` : `${latestCohort.w} 注册`} tone={latestCohort.suppressed ? "role-other" : "role-3"} icon={Users}
        explain={`按注册${cohortKind}分组后最新的一组，可能是还没过完的这一${cohortKind}，也可能是更早的一${cohortKind}。`} />
      <Stat label="注册到提现" value={FUNNEL[0].suppressed || FUNNEL[FUNNEL.length - 1].suppressed ? SMALL_SAMPLE_LABEL : fullCvr == null ? "—" : `${fullCvr}%`}
        sub={FUNNEL[0].suppressed || FUNNEL[FUNNEL.length - 1].suppressed ? "少于 5 人，不显示" : registrations && withdrawals != null ? `${people(withdrawals)} ÷ ${people(registrations)} 人` : "注册 0 人，算不出"} tone={fullCvr == null || FUNNEL[0].suppressed || FUNNEL[FUNNEL.length - 1].suppressed ? "role-other" : "role-3"} icon={Route}
        explain="同一批注册用户里最后提交了提现申请的比例，不是到账率。" />
      <Stat label="第 7 天仍活跃" value={day7Value} tone={RETENTION_SOURCE_READY ? "role-3" : "role-other"} icon={CalendarCheck}
        sub={!RETENTION_SOURCE_READY ? `日活事件还没接上 · 目标 ${String(day7.target ?? 60)}%` : day7.value == null && day7.suppressed !== true ? "还没有注册满 7 天的周" : `最近满 7 天的注册周 · 目标 ${String(day7.target ?? 60)}%`}
        explain={<><p>只看最近一个注册满 7 天的注册周（按月分组时也按周）：注册后第 7 天当天有日活记录的人 ÷ 这批注册人数，不是 7 天里任意一天。目标只用来对照，不触发任何操作。</p>{!RETENTION_SOURCE_READY && <p>日活事件还没接上，现在算出来会是 0%，所以先不显示；接上后再显示。</p>}</>} />
      <Stat label="试用后购买比例" value={trialValue} tone={TRIAL?.available && !trialSmall && TRIAL_BUY?.arr ? "role-3" : TRIAL && !TRIAL.available ? "warn" : "role-other"} icon={Gift}
        sub={!TRIAL ? "试用人数还没接上" : !TRIAL.available ? "试用记录不全" : trialSmall ? "少于 5 人，不显示" : TRIAL_START?.n != null && TRIAL_BUY?.n != null ? `${people(TRIAL_BUY.n)} ÷ ${people(TRIAL_START.n)} 人` : "—"}
        explain={<><p>开始试用的人里，用同一笔试用确认购买的比例。试用是另一条线，不算进首购转化率。</p>{!TRIAL ? <p>{TRIAL_OLD_NOTE}</p> : !TRIAL.available && <p>{trialReason(TRIAL.reason)}</p>}</>} />
    </StatBand>
  );

  /* ---- 所选一步：人数、耗时、怎么算；首购这一步下面挂试用线。 ---- */
  const previous = safeStage > 0 ? FUNNEL[safeStage - 1] : null;
  const inflow = leadingCount(ext.inflow) ?? previous?.users ?? null;
  const lost = leadingCount(ext.lost);
  const stepFigures = (
    <div className="l2-figures">
      <div>
        <span>上一步人数</span>
        <b data-empty={safeStage === 0 || ext.suppressed || inflow == null ? "" : undefined}>{safeStage === 0 ? "—" : ext.suppressed ? SMALL_SAMPLE_LABEL : inflow == null ? "—" : people(inflow)}</b>
        <small>{safeStage === 0 ? "第一步，没有上一步" : `走到「${previous?.stage}」的人`}</small>
      </div>
      <div>
        <span>到这一步</span>
        <b data-empty={s.suppressed || s.users == null ? "" : undefined}>{s.suppressed ? SMALL_SAMPLE_LABEL : s.users == null ? "—" : people(s.users)}</b>
        <small>{s.suppressed ? "少于 5 人，不显示" : safeStage === 0 ? "这批注册用户" : s.cvr == null ? "转化率算不出" : `转化 ${pct(s.cvr)}`}</small>
      </div>
      <div>
        <span>掉了<Explain label="掉了的说明" content="上一步人数减这一步人数，只是差额，不是流失原因，也不代表这些人去了哪里。" /></span>
        <b data-empty={safeStage === 0 || ext.suppressed || ext.lostSuppressed || lost == null ? "" : undefined}>{safeStage === 0 ? "—" : ext.suppressed || ext.lostSuppressed ? SMALL_SAMPLE_LABEL : lost == null ? "—" : people(lost)}</b>
        <small>{safeStage === 0 ? "—" : ext.lostSuppressed ? "少于 5 人，不显示" : "上一步减这一步"}</small>
      </div>
    </div>
  );
  const dwellBlock = safeStage === 0
    ? <p className="rd-note">注册是第一步，没有从上一步过来的耗时。</p>
    : ext.suppressed || s.suppressed
      ? <p className="rd-note">这一步少于 5 人，耗时不显示。</p>
      : ext.dwellSuppressed
        ? <p className="rd-note">有的耗时档少于 5 人，整张分布不显示，防止从小分组推出具体用户。</p>
        : <DwellChart stage={s.stage} dwell={ext.dwell} />;
  const trialBlock = ext.trial && (
    <Panel plain headingLevel={3} title="首购之前的试用（另一条线）" explainSide="top"
      explain={<><p>试用单独统计两步：开始试用 → 试用后购买，购买要晚于同一笔试用的开始。看到领取弹窗这一步没有记录，不统计。不算进上面的首购转化率；同一笔试用购买两边都可能算到。</p><p>试用到期没有购买的会取消，不发奖励；只有用户确认购买才结算。试用规则在「免费试用设置」改。</p></>}>
      {!TRIAL
        ? <Notice tone="neutral" title="数据来源还没接上">{TRIAL_OLD_NOTE}</Notice>
        : !TRIAL.available
          ? <Notice tone="warn" title="试用人数暂不可用">{trialReason(TRIAL.reason)}</Notice>
          : <TrialLine steps={TRIAL.steps} />}
    </Panel>
  );
  const stepPanel = (
    <Panel id={DETAIL_ID} role="tabpanel" aria-labelledby={`l2-step-${safeStage}`}
      title={`第 ${safeStage + 1} 步 · ${s.stage}`} icon={Hourglass} tone="role-3"
      explain={<><p>这一步怎么算：{STEP_RULE[safeStage]}</p><p>对应事件：{STAGE_EV[safeStage] ?? s.ev}；用户阶段：{s.lc}。</p></>}
      sub={s.suppressed ? SMALL_SAMPLE_LABEL : s.users == null ? undefined : `${people(s.users)} 人`}
      actions={<Button size="sm" variant="ghost" loading={queryLoading} onClick={() => void applySlice(L2_STAGE_EVENTS[safeStage])}>刷新这一步</Button>}>
      <div className="rd-stack">
        {stepFigures}
        <Panel plain headingLevel={3} title="走到这一步用了多久" explainSide="top"
          explain="只算走到这一步的人：从上一步发生到这一步发生隔了多久，按小时分 8 档。没走到这一步的人等了多久不在这里。">
          {dwellBlock}
        </Panel>
        {trialBlock}
      </div>
    </Panel>
  );

  /* ---- 页签一：按注册时间看留存（热力格 + 曲线对比）。 ---- */
  const selectedCohort = COHORTS[safeCohort];
  const curveTicks = [...new Set([...(CURVES[selectedCohort.w] ?? []), ...(cmp !== "none" ? CURVES[cmp] ?? [] : [])].map(([day]) => day))].filter((day) => day > 0).sort((a, b) => a - b);
  const curveSeries = [
    { key: selectedCohort.w, label: selectedCohort.w, slot: 3 as const, points: CURVES[selectedCohort.w] ?? [] },
    ...(cmp !== "none" && cmp !== selectedCohort.w ? [{ key: cmp, label: cmp, slot: "other" as const, points: CURVES[cmp] ?? [] }] : []),
  ].map(({ points, ...item }) => ({ ...item, values: curveTicks.map((day) => points.find(([pointDay]) => pointDay === day)?.[1] ?? null) }));
  const compareKeys = cohortCurveKeys.filter((key) => key !== selectedCohort.w).slice(-2);
  const retentionPane = (
    <div className="rd-stack">
      <div className="rd-toolbar l2-toolbar">
        <Segments label="按注册周或月分组" value={cohortKind === "月" ? 1 : 0}
          items={[{ value: 0, label: "按注册周" }, { value: 1, label: "按注册月", disabled: !MONTHLY_COHORTS.length }]}
          onChange={(next) => { cancelQuery(); setGran(next); ctx.toast(`已切换为按${next === 0 ? "注册周" : "注册月"}查看`, "info"); }} />
        <div role="group" aria-label="看注册后第几天" className="l2-days">
          <span className="rd-note">看第几天</span>
          {L2_WINDOWS.map((w) => (
            <Check key={w} label={`第 ${w.replace("Day", "")} 天`} checked={wins.includes(w)} disabled={queryLoading} onChange={() => {
              const nextWins = wins.includes(w) ? wins.filter((x) => x !== w) : [...wins, w];
              if (!nextWins.length) {
                ctx.toast("请至少选择一天查看留存情况", "warn");
                return;
              }
              void loadRetentionWindows(nextWins);
            }} />
          ))}
        </div>
        <span className="rd-toolbar-note l2-toolbar-end" role="status">{queryLoading ? "读取中…" : "改分组只换显示，改天数会重新读取"}</span>
      </div>
      {!RETENTION_SOURCE_READY && (
        <Notice tone="warn" title="留存的数据来源还没接上">
          日活事件还没接上，算出来会是 0%。满了天数的格子写「未接上」，曲线不画，人数照常。
        </Notice>
      )}
      <div className="rd-split" data-detail="">
        <Panel title={`按注册${cohortKind}的留存`} icon={CalendarRange} tone="role-3" sub={`最近 ${COHORTS.length} 个注册${cohortKind} · ${scope}`}
          explain={<><p>每一行是同一{cohortKind}注册的人，每一格是这批人注册后第 N 天当天有日活记录的比例，不是 N 天里任意一天。</p><p>这批人里还有人注册不满 N 天时不算，写「未到」。只列最近 6 个注册{cohortKind}。点一行在右边看它的曲线。</p><p>{PROTECT_NOTE}</p></>}>
          <RetentionHeatmap kind={cohortKind} cohorts={COHORTS} columns={retentionColumns} selected={safeCohort} curveFor={(index) => void loadCurve(index)} disabled={queryLoading} sourceReady={RETENTION_SOURCE_READY} />
        </Panel>
        <Panel title={`${selectedCohort.w} 的留存曲线`} icon={TrendingUp} tone="role-3"
          explain={<><p>这批人注册后第 0、1、3、7、14、21、30、60 天当天有日活记录的比例，只画已经满了天数的点。第 0 天（注册当天）固定是 100%，不是实测，所以不画。</p><p>灰线是用来对比的另一批，可以选最近两批。</p></>}>
          {!RETENTION_SOURCE_READY
            ? <BlockState state="empty" title="数据来源还没接上，曲线先不画" detail="接上前画出来会是一条掉到 0 的线，不代表没人用。" />
            : selectedCohort.suppressed
              ? <BlockState state="empty" title="这批少于 5 人，曲线不显示" />
              : curveTicks.length === 0
                ? <BlockState state="empty" title="这批还有人注册不满 1 天，还没有曲线" />
                : (
                  <div className="rd-stack">
                    <TrendLines label={`${selectedCohort.w} 注册后每天有日活记录的比例`} ticks={curveTicks.map((day) => `第 ${day} 天`)} format={pct}
                      axisFormat={(value) => `${Number(value.toFixed(0))}%`} height={160} series={curveSeries}
                      marks={typeof day7.target === "number" ? [{ key: "target", text: `第 7 天目标 ${day7.target}%`, value: day7.target, tone: "ok" }] : []} />
                    {compareKeys.length > 0 && (
                      <Segments label="和哪一批对比" value={compareKeys.includes(cmp) ? cmp : "none"} onChange={setCmp}
                        items={[{ value: "none", label: "不对比" }, ...compareKeys.map((key) => ({ value: key, label: `对比 ${key}` }))]} />
                    )}
                  </div>
                )}
        </Panel>
      </div>
    </div>
  );

  /* ---- 页签二：渠道 × 语言的三项指标。 ---- */
  // 交叉分析的试用格另有自己的可不可用（后端 crossAnalysis.trial.available），和漏斗那两步分开看。
  const crossTrial = rec(XD.trial);
  const crossTrialUnavailable = metric === "trial" && !!TRIAL && crossTrial.available === false;
  const metricBlocked = (metric === "ret" && !RETENTION_SOURCE_READY) || (metric === "trial" && (!TRIAL || crossTrialUnavailable));
  const crossPane = (
    <div className="rd-stack">
      <div className="rd-toolbar l2-toolbar">
        <Segments<"cvr" | "ret" | "trial"> label="看哪项指标" value={metric}
          items={(["cvr", "ret", "trial"] as const).map((value) => ({ value, label: METRIC_NAME[value] }))}
          onChange={(value) => { if (!queryLoading) void loadCrossMetric(value); }} />
        <span className="rd-toolbar-note l2-toolbar-end" role="status">{queryLoading ? "读取中…" : "换指标会重新读取 · 行列固定，不能排序"}</span>
      </div>
      <Panel title={`各渠道、语言的${METRIC_NAME[metric]}`} icon={Languages} tone="role-3" sub={`按注册时的渠道、阶段和语言 · ${scope}`}
        explain={<>
          <p>{metric === "cvr" ? "注册后完成首购的人 ÷ 注册人数。" : metric === "ret" ? "注册后第 7 天当天有日活记录的人 ÷ 注册人数；还有人不满 7 天的组合不算。" : "开始试用的人里用同一笔试用确认购买的比例，试用是另一条线。"}</p>
          <p>行是注册时带的渠道和当时的运营阶段，列是注册时的语言。颜色越深越高，最高、最低的格子标了字，方便找最好和最差的组合。行列固定，不能排序和分页。</p>
          <p>{PROTECT_NOTE}</p>
        </>}>
        {metricBlocked
          ? crossTrialUnavailable
            ? <BlockState state="empty" title="试用人数暂不可用" detail={trialReason(typeof crossTrial.reason === "string" ? crossTrial.reason : null)} />
            : <BlockState state="empty" title="数据来源还没接上" detail={metric === "ret" ? "日活事件还没接上，算出来会是 0%，先不显示。" : TRIAL_OLD_NOTE} />
          : xd.rows.length && xd.columns.length
            ? <CrossTable metric={xd} name={METRIC_NAME[metric]} />
            : <BlockState state="empty" title="当前条件下没有可比较的渠道和语言" />}
      </Panel>
    </div>
  );

  const links = L2_ATTRIBUTION_LINKS.filter(({ href }) => reach(href, ATTRIBUTION_ROUTE_READ[href]));

  return page(<>
    {conclusion}
    {stats}
    <div className="rd-split" data-detail="">
      <Panel title="同一批用户的四步转化" icon={Filter} tone="role-3" sub={scope}
        explain={<><p>条的长度和人数成比例，第一步注册是 100%。两步之间写这一步的转化率和掉了多少人。点一步，右边看这一步的详情；会按输入框里的条件重新查一次。</p>{caliberNote()}</>}>
        <div className="rd-stack">
          {registrations == null
            ? <BlockState state="empty" title="这批注册用户少于 5 人，四步的人数和转化率都不显示" />
            : <StepFunnel funnel={FUNNEL} selected={safeStage} lowest={lowest} disabled={queryLoading} panelId={DETAIL_ID}
              onSelect={(i) => { setSelStage(i); void applySlice(L2_STAGE_EVENTS[i]); }} />}
          <Fold inset title="各步骤明细" summary={`${FUNNEL.length} 步 · 人数、转化率、用户阶段和对应事件`}>
            <StageTable funnel={FUNNEL} events={STAGE_EV} />
          </Fold>
        </div>
      </Panel>
      {stepPanel}
    </div>

    <PageTabs ids={ids} label="更多分析" value={tab} onChange={setTab}
      items={[{ value: "retention", label: "按注册时间看留存" }, { value: "cross", label: "渠道 × 语言" }]} />
    <div {...ids.panel(tab)} className="rd-tab-pane">
      {tab === "retention" ? retentionPane : crossPane}
    </div>

    <nav className="rd-links" aria-label="查原因">
      <span>查原因</span>
      {links.length
        ? links.map(({ label, href }) => <Link key={href} className="rd-link" href={href}>{findByPath(href)?.l2.name ?? label}</Link>)
        : <span>你没有可去的原因分析页面的权限</span>}
    </nav>
    <PaginationExemptionList
      items={[
        {
          label: "同批用户留存表",
          kind: "fixed-matrix",
          maxRows: 6,
          reason: "留存 同批用户 固定六行,需同屏比较 Day1/7/30",
        },
      ]}
    />
  </>);
}
