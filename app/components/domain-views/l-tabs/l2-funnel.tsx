"use client";

/**
 * L2 · 漏斗 / Cohort / 留存 — 五级漏斗逐级下钻 + cohort 留存热力矩阵 + 多维交叉。
 * 漏斗各级 users/cvr/色 join 自 FUNNEL(与 B3 驾驶舱同口径单一源);复投级挂「V1 降级口径」badge。
 * 全页只读下钻;导出为聚合序列(仍需操作确认 落审计)。
 */
import { useEffect, useState } from "react";
import { AutoGloss } from "@/app/components/kit/gloss";
import { displayAdminError } from "@/lib/admin/error-messages";
import {
  fetchL2Cross,
  fetchL2FunnelDrilldown,
  fetchL2RetentionCurve,
  fetchL2RetentionMatrix,
  type L2FunnelQuery,
} from "@/lib/admin/l-client";
import { confirm } from "@/lib/store/ui";
import { PaginationExemptionList } from "../design-kit";
import { LDataState, num, rec, rows, str, strings, type KpiRow } from "./live-data";
import { readL2LiveStages } from "./l1-l2-live-data";
import { L2LiveStages } from "./l1-l2-live-fallback";
import type { LCtx } from "./types";

type FunnelRow = { stage: string; ev?: string; users: number; cvr?: number | null; lc: string; color: string; target?: string | null };
type FunnelExt = {
  plain: string;
  inflow: string;
  lost: string;
  dwell: number[];
  note: string;
  tg?: string | null;
  trial?: boolean;
  v1?: boolean;
};
type TrialStep = { e: string; n: number; arr?: string; arrLb?: string };
type CohortRow = { w: string; size: number; d1?: number | null; d7?: number | null; d14?: number | null; d30?: number | null; d60?: number | null };
type XdMetric = { columns: string[]; rows: (string | number | null)[][]; alert: number[]; unit: string; msg: { pre: string; bold: string; post: string } };

const L2_STAGE_EVENTS = [
  "auth.register_completed",
  "kyc.express_verified",
  "checkout.completed",
  "wallet.reinvest",
  "withdraw.submitted",
] as const;
const L2_WINDOWS = ["Day1", "Day7", "Day14", "Day30", "Day60"] as const;

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
  const stageEvents = strings(data.stageEvents);
  if (funnel.length !== 5 || extensions.length !== 5 || cohorts.length === 0
    || stageEvents.length !== 5 || stageEvents.some((event, index) => event !== L2_STAGE_EVENTS[index])) return false;
  let previousUsers = Number.MAX_SAFE_INTEGER;
  for (let index = 0; index < funnel.length; index += 1) {
    const item = funnel[index];
    const ext = extensions[index];
    if (!str(item.stage) || !str(item.lc) || !str(item.color) || !finiteCount(item.users)
      || !finitePercent(item.cvr) || Number(item.users) > previousUsers || !str(ext.plain)
      || !Array.isArray(ext.dwell) || ext.dwell.some((value) => !finiteCount(value))) return false;
    previousUsers = Number(item.users);
  }
  const validateCohorts = (items: Record<string, unknown>[], pattern: RegExp) => {
    const seen = new Set<string>();
    return items.every((item) => {
      const key = str(item.w || item.cohort);
      if (!pattern.test(key) || seen.has(key) || !finiteCount(item.size)) return false;
      seen.add(key);
      return ["d1", "d7", "d14", "d30", "d60"].every((field) => finitePercent(item[field]));
    });
  };
  if (!validateCohorts(cohorts, /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/)
    || (monthly.length > 0 && !validateCohorts(monthly, /^\d{4}-(?:0[1-9]|1[0-2])$/))) return false;
  const curves = rec(data.curves);
  if (cohorts.some((item) => !validCurve(curves[str(item.w || item.cohort)]))) return false;
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
    unit: str(data.unit, "%"),
    msg: {
      pre: str(msg.pre, message),
      bold: str(msg.bold),
      post: str(msg.post),
    },
  };
}

/** cohort 热力格:紫系浓度四档(--cyan 族),深格切暗字。 */
function heatStyle(v: number | null | undefined): React.CSSProperties {
  if (v == null) return { background: "var(--surface-2)", color: "var(--ink-4)" };
  const a = v >= 62 ? 70 : v >= 59 ? 45 : v >= 56 ? 25 : 10;
  return { background: `color-mix(in srgb, var(--cyan) ${a}%, transparent)`, color: a >= 45 ? "#0A0A0A" : "var(--ink-2)" };
}

export function L2HeaderActions({ ctx }: { ctx: LCtx }) {
  const complete = isStrictL2Dashboard(ctx.biData?.l2);
  const detailedAttempt = hasDetailedL2(ctx.biData?.l2);
  const liveStages = detailedAttempt ? [] : readL2LiveStages(ctx.biData?.l2);
  const exportable = (complete && ctx.l2SliceExportable !== false) || liveStages.length > 0;
  const exportFunnel = async () => {
    const ok = await confirm({
      title: complete ? "导出 cohort / 漏斗序列 CSV" : "导出生命周期计数 CSV",
      message: complete
        ? "内容:漏斗各级去重人数 + 转化率 + 各 cohort 留存率序列(按当前切片与留存窗)。全部是聚合计数,不含手机号、地址等明文。仍需操作确认，并生成可追溯记录。"
        : "完整同期群与逐级漏斗尚未开放。本次只导出页面已展示的生命周期独立事实计数，不包含转化率或留存推算值；不含手机号、地址等明文，并生成可追溯记录。",
      confirmLabel: "导出",
    });
    if (!ok) return;
    try {
      await ctx.biActions?.createReport({
        exportType: complete ? "漏斗序列" : "漏斗生命周期事实",
        timeRange: complete ? "当前 cohort 窗口" : "当前快照",
        fields: complete ? "漏斗去重人数/CVR/cohort 留存率" : "注册/资料/KYC/订单/钱包活动聚合计数",
        piiLevel: "NONE",
        maskPolicy: "NONE",
        recipient: "BI 管理员",
        ticket: "L2-FUNNEL",
        cohort: complete ? ctx.l2Query?.cohort : undefined,
        phase: complete ? ctx.l2Query?.phase : undefined,
        locale: complete ? ctx.l2Query?.locale : undefined,
        ref: complete ? ctx.l2Query?.ref : undefined,
      }, complete ? "导出漏斗 cohort 聚合序列用于转化分析" : "导出 L2 当前生命周期事实用于数据核对");
      await ctx.reloadBi?.();
      ctx.toast(complete ? "漏斗 cohort 导出任务已提交" : "生命周期计数任务已提交 · 仅包含页面已展示的累计事实");
    } catch (error) {
      ctx.toast(error instanceof Error ? `导出任务提交失败 · ${displayAdminError(error)}` : "导出任务提交失败 · 请稍后重试");
    }
  };
  return (
    <>
      <span className="f-ro"><span className="d" />只读下钻 · 漏斗怎么定义这里改不了</span>
      {!ctx.canExport && <span className="f-ro">当前角色仅可查看 · 导出需报表管理权限</span>}
      <button className="f-cta" onClick={exportFunnel} disabled={!ctx.canExport || !exportable || ctx.biLoading} title={!ctx.canExport ? "当前角色没有报表导出权限" : !exportable ? "尚未返回可导出的 L2 数据" : undefined}>
        {complete ? "导出 cohort / 漏斗序列" : "导出生命周期计数 CSV"}
      </button>
    </>
  );
}

export function L2Funnel({ ctx }: { ctx: LCtx }) {
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
  const [queryError, setQueryError] = useState<string | null>(null);
  const [crossOverride, setCrossOverride] = useState<Record<string, unknown> | null>(null);

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
      ctx.toast("当前切片、cohort 粒度与留存窗已保存 · 不改统计口径");
    } catch {
      ctx.toast("视图保存失败 · 浏览器存储不可用，请稍后重试");
    }
  };

  const applySlice = async (stage?: L2FunnelQuery["stage"]) => {
    const cohort = draftCohort.trim();
    const locale = draftLocale.trim();
    const ref = draftRef.trim();
    if (cohort && !/^\d{4}-(?:W(?:0[1-9]|[1-4]\d|5[0-3])|(?:0[1-9]|1[0-2]))$/.test(cohort)) {
      setQueryError("cohort 格式无效：请使用 YYYY-Www 或 YYYY-MM");
      ctx.setL2SliceExportable?.(false);
      return;
    }
    if (locale && !/^[a-z]{2,8}(?:-[a-z0-9]{2,8})?$/i.test(locale)) {
      setQueryError("locale 格式无效");
      ctx.setL2SliceExportable?.(false);
      return;
    }
    if (ref && (!/^[\p{L}\p{N}._:-]+$/u.test(ref) || ref.length > 96)) {
      setQueryError("渠道 ref 只能包含字母、数字、点、下划线、冒号或连字符");
      ctx.setL2SliceExportable?.(false);
      return;
    }
    const query: L2FunnelQuery = { stage, cohort, phase: draftPhase, locale, ref };
    setQueryLoading(true);
    setQueryError(null);
    setQueryData({});
    ctx.setL2SliceExportable?.(false);
    try {
      const response = await fetchL2FunnelDrilldown(query);
      if (response.available === false) {
        setQueryData(response);
        ctx.setL2Query?.({ cohort, phase: draftPhase, locale, ref });
        setQueryError(str(response.message, "当前切片没有可计算的注册 cohort"));
        return;
      }
      if (!isStrictL2Dashboard(response)) {
        throw new Error("L2_RESPONSE_PROTOCOL_ERROR");
      }
      setQueryData(response);
      ctx.setL2Query?.({ cohort, phase: draftPhase, locale, ref });
      ctx.setL2SliceExportable?.(true);
      ctx.toast(stage ? "已按当前切片完成真实漏斗下钻" : "切片已从服务端重新计算");
    } catch (error) {
      setQueryError(error instanceof Error ? displayAdminError(error) : "L2 查询失败");
    } finally {
      setQueryLoading(false);
    }
  };

  const data = queryData ?? ctx.biData?.l2;
  const detailedAttempt = hasDetailedL2(data);
  const strictDetailed = isStrictL2Dashboard(data);
  const FUNNEL = rows<FunnelRow>(data?.funnel);
  const FUNNEL_EXT = rows<FunnelExt>(data?.funnelExt);
  const TRIAL_STEPS = rows<TrialStep>(data?.trialSteps);
  const WEEKLY_COHORTS = rows<CohortRow>(data?.cohorts);
  const MONTHLY_COHORTS = rows<CohortRow>(data?.monthlyCohorts);
  const COHORTS = gran === 1 && MONTHLY_COHORTS.length ? MONTHLY_COHORTS : WEEKLY_COHORTS;
  const CURVES = rec<[number, number][]>(gran === 1 && MONTHLY_COHORTS.length ? data?.monthlyCurves : data?.curves);
  const XD = crossOverride ?? rec(data?.crossAnalysis);
  const STAGE_EV = strings(data?.stageEvents);
  const day7 = (data?.day7Kpi ?? {}) as Partial<KpiRow>;
  const liveStages = detailedAttempt ? [] : readL2LiveStages(data);
  if (queryError) return (
    <section className="l-card">
      <div className="l-b">
        <div className="ltint warn" role="alert"><b>L2 查询未采用</b> · {queryError}。页面已关闭旧切片导出，不会用部分或脏响应拼接分析结论。</div>
        <button className="l-btn sm" style={{ marginTop: 12 }} onClick={() => {
          setQueryData(null);
          setQueryError(null);
          setCrossOverride(null);
          ctx.setL2Query?.({});
          ctx.setL2SliceExportable?.(true);
        }}>返回全部数据</button>
      </div>
    </section>
  );
  if (!detailedAttempt && liveStages.length) return <L2LiveStages stages={liveStages} />;
  if (detailedAttempt && !strictDetailed) return (
    <section className="l-card"><div className="l-b"><div className="ltint warn" role="alert">
      <b>L2 响应协议错误</b> · 漏斗、cohort 或交叉矩阵不完整/越界，已 fail-closed；不展示部分数字，也不允许导出。
    </div></div></section>
  );
  if (!FUNNEL.length || !FUNNEL_EXT.length || !COHORTS.length) return <LDataState ctx={ctx} label="L2" />;
  const safeStage = Math.min(selStage, FUNNEL.length - 1);
  const safeCohort = Math.min(selCohort, COHORTS.length - 1);
  const fullCvr = FUNNEL[0]?.users ? ((FUNNEL[FUNNEL.length - 1].users / FUNNEL[0].users) * 100).toFixed(1) : "0.0";
  const trialBuy = TRIAL_STEPS[1]?.n ? ((num(TRIAL_STEPS[2]?.n) / TRIAL_STEPS[1].n) * 100).toFixed(1) : null;
  const maxUsers = FUNNEL[0].users;
  const s = FUNNEL[safeStage];
  const ext = FUNNEL_EXT[safeStage] ?? { plain: s.stage, inflow: "—", lost: "—", dwell: [], note: "" };
  const dwellMax = Math.max(...(ext.dwell.length ? ext.dwell : [1]));
  const xd = normalizeXdMetric(XD[metric]);
  const retentionColumns = ([1, 7, 14, 30, 60] as const)
    .filter((day) => wins.includes(`Day${day}`))
    .map((day) => ({ day, key: `d${day}` as keyof CohortRow }));

  const cohortCurveKeys = COHORTS.map((cohort) => cohort.w).filter((key) => Array.isArray(CURVES[key]));
  const activeQuery: L2FunnelQuery = {
    cohort: draftCohort.trim(),
    phase: draftPhase,
    locale: draftLocale.trim(),
    ref: draftRef.trim(),
  };

  const loadRetentionWindows = async (nextWins: string[]) => {
    setQueryLoading(true);
    try {
      const response = await fetchL2RetentionMatrix(activeQuery, nextWins);
      const merged = { ...rec(data), cohorts: response.cohorts };
      if (!isStrictL2Dashboard(merged)) throw new Error("L2_RETENTION_PROTOCOL_ERROR");
      setQueryData(merged);
      setWins(nextWins);
      ctx.setL2Query?.(activeQuery);
      ctx.setL2SliceExportable?.(true);
    } catch (error) {
      ctx.setL2SliceExportable?.(false);
      setQueryError(error instanceof Error ? displayAdminError(error) : "留存矩阵查询失败");
    } finally {
      setQueryLoading(false);
    }
  };

  const loadCrossMetric = async (nextMetric: "cvr" | "ret" | "trial") => {
    setQueryLoading(true);
    try {
      const response = await fetchL2Cross(nextMetric === "ret" ? "retention" : nextMetric, activeQuery);
      const nextCross = rec(response.crossAnalysis);
      const merged = { ...rec(data), crossAnalysis: nextCross };
      if (!isStrictL2Dashboard(merged)) throw new Error("L2_CROSS_PROTOCOL_ERROR");
      setCrossOverride(nextCross);
      setMetric(nextMetric);
      ctx.setL2Query?.(activeQuery);
      ctx.setL2SliceExportable?.(true);
    } catch (error) {
      ctx.setL2SliceExportable?.(false);
      setQueryError(error instanceof Error ? displayAdminError(error) : "交叉分析查询失败");
    } finally {
      setQueryLoading(false);
    }
  };

  const loadCurve = async (cohortIndex: number) => {
    const cohort = COHORTS[cohortIndex]?.w;
    if (!cohort) return;
    setQueryLoading(true);
    try {
      const response = await fetchL2RetentionCurve(cohort, activeQuery);
      if (!validCurve(response.curve)) throw new Error("L2_RETENTION_CURVE_PROTOCOL_ERROR");
      const curveKey = gran === 1 ? "monthlyCurves" : "curves";
      const merged = {
        ...rec(data),
        [curveKey]: { ...rec(data?.[curveKey]), [cohort]: response.curve },
      };
      if (!isStrictL2Dashboard(merged)) throw new Error("L2_RETENTION_CURVE_PROTOCOL_ERROR");
      setQueryData(merged);
      setSelCohort(cohortIndex);
      ctx.setL2Query?.(activeQuery);
      ctx.setL2SliceExportable?.(true);
    } catch (error) {
      ctx.setL2SliceExportable?.(false);
      setQueryError(error instanceof Error ? displayAdminError(error) : "留存曲线查询失败");
    } finally {
      setQueryLoading(false);
    }
  };

  /* ---- 留存衰减曲线：后端按所选 cohort 的 app.dau 同用户窗口返回；虚线为对比 cohort。 ---- */
  const curveChart = () => {
    const W = 560, H = 200, P = 30;
    const selectedKey = COHORTS[safeCohort].w;
    const scaled = CURVES[selectedKey] ?? [];
    const maxCurveDay = Math.max(30, ...scaled.map(([day]) => day));
    const X = (d: number) => P + (d / maxCurveDay) * (W - P - 14);
    const Y = (v: number) => H - 24 - ((v - 30) / 70) * (H - 44);
    const mp = scaled.map(([d, v], i) => `${i ? "L" : "M"}${X(d).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
    const cp = cmp !== "none" ? (CURVES[cmp] ?? []).map(([d, v], i) => `${i ? "L" : "M"}${X(d).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ") : null;
    return (
      <svg className="curve-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`留存衰减曲线 ${COHORTS[safeCohort].w}`}>
        {[1, 7, 14, 30, 60].filter((day) => day <= maxCurveDay).map((d) => (
          <g key={d}>
            <line x1={X(d)} y1={14} x2={X(d)} y2={H - 24} stroke="var(--border)" />
            <text x={X(d)} y={H - 8} fontSize={11} fill="var(--ink-4)" textAnchor="middle">D{d}</text>
          </g>
        ))}
        <line x1={P} y1={Y(60)} x2={W - 14} y2={Y(60)} stroke="var(--success)" strokeWidth={1.2} strokeDasharray="4 4" />
        <text x={W - 14} y={Y(60) - 5} fontSize={11} fill="var(--success)" textAnchor="end">Day7 目标 60%</text>
        {cp && <path d={cp} fill="none" stroke="var(--ink-4)" strokeWidth={1.6} strokeDasharray="5 4" />}
        <path d={`${mp} L${X(maxCurveDay)} ${H - 24} L${X(0)} ${H - 24} Z`} fill="var(--cyan)" opacity={0.08} />
        <path d={mp} fill="none" stroke="var(--cyan)" strokeWidth={2.2} />
        {scaled.filter(([d]) => [1, 7, 30].includes(d)).map(([d, v]) => (
          <g key={d}>
            <circle cx={X(d)} cy={Y(v)} r={3.2} fill="#0A0A0A" stroke="var(--cyan)" strokeWidth={2} />
            <text x={X(d)} y={Y(v) - 8} fontSize={11} fill="var(--ink-2)" textAnchor="middle">{v}%</text>
          </g>
        ))}
      </svg>
    );
  };

  return (
    <div>
      {/* stat strip */}
      <div className="f-stats">
        <div className="f-stat cyan"><div className="k">本周注册 cohort</div><div className="v">{COHORTS[COHORTS.length - 1].w}</div><div className="sub">{COHORTS[COHORTS.length - 1].size.toLocaleString("en-US")} 新注册 · 按注册周分组</div></div>
        <div className="f-stat"><div className="k">全漏斗转化(注册→提现)</div><div className="v">{fullCvr}%</div><div className="sub">注册 cohort 中最终发起提现的比例</div></div>
        <div className="f-stat warn"><div className="k">最近成熟 cohort · Day7 留存</div><div className="v">{day7.value == null ? "—" : `${day7.value}%`}</div><div className="sub">目标 &gt; {day7.target ?? 60}% · 未成熟窗口不推算</div></div>
        <div className="f-stat ok"><div className="k">trial→购买率</div><div className="v">{trialBuy == null ? "—" : `${trialBuy}%`}</div><div className="sub">L3→L4 子路径 · 并列独立计量</div></div>
      </div>

      {/* view slice bar */}
      <div className="view-bar">
        <div className="chips" aria-label="服务端切片条件"><span className="lb">服务端切片</span>
          <input aria-label="cohort 条件" value={draftCohort} placeholder="YYYY-Www / YYYY-MM" onChange={(event) => setDraftCohort(event.target.value)} style={{ width: 150 }} />
          <select aria-label="Phase 条件" value={draftPhase} onChange={(event) => setDraftPhase(event.target.value as L2FunnelQuery["phase"])}>
            <option value="">全部 Phase</option>
            {["P1", "P2", "P3", "P4", "P5", "P6"].map((phase) => <option key={phase} value={phase}>{phase}</option>)}
          </select>
          <input aria-label="locale 条件" value={draftLocale} placeholder="locale，如 vi" onChange={(event) => setDraftLocale(event.target.value)} style={{ width: 110 }} />
          <input aria-label="渠道 ref 条件" value={draftRef} placeholder="渠道 ref" onChange={(event) => setDraftRef(event.target.value)} style={{ width: 130 }} />
          <button className="l-btn sm" disabled={queryLoading} onClick={() => void applySlice()}>
            {queryLoading ? "查询中…" : "应用切片"}
          </button>
          <button className="l-btn sm" disabled={queryLoading} onClick={() => {
            setDraftCohort("");
            setDraftPhase("");
            setDraftLocale("");
            setDraftRef("");
            setQueryData(null);
            setCrossOverride(null);
            ctx.setL2Query?.({});
            ctx.setL2SliceExportable?.(true);
            ctx.toast("已恢复全部数据");
          }}>清空</button>
        </div>
        <div className="sep" />
        <div className="chips"><span className="lb">cohort 粒度</span>
          {["注册周 YYYY-Www", "注册月"].map((c, i) => (
            <button key={c} className={"chip" + (i === gran ? " sel" : "")} onClick={() => { setGran(i); ctx.toast(`切片已切换:${c} · 仅视图,实时生效`); }}>{c}</button>
          ))}
        </div>
        <div className="sep" />
        <div className="chips"><span className="lb">留存窗</span>
          {["Day1", "Day7", "Day14", "Day30", "Day60"].map((w) => (
            <button key={w} disabled={queryLoading} className={"chip" + (wins.includes(w) ? " sel" : "")} onClick={() => {
              const nextWins = wins.includes(w) ? wins.filter((x) => x !== w) : [...wins, w];
              if (!nextWins.length) {
                ctx.toast("至少保留一个留存窗");
                return;
              }
              void loadRetentionWindows(nextWins);
            }}>{w}</button>
          ))}
        </div>
        <button className="l-btn sm" style={{ marginLeft: "auto" }} onClick={saveView}>保存为视图</button>
      </div>

      {/* (a) 完整漏斗下钻 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">完整漏斗下钻 · 五级</span>
          <span className="sub">· <AutoGloss>点击任意一级展开「流入 / 转化 / 流失去向 / 停留时长」 · L1–L5 编号是内部生命周期标注,不对用户展示</AutoGloss></span>
          <div className="r"><span className="lcode lock" title="漏斗口径由服务端统一维护">🔒 漏斗定义锁定</span><span className="lcode electric">和驾驶舱漏斗是同一份数字</span></div>
        </div>
        <div className="l-b">
          <div className="fn-wrap">
            {FUNNEL.map((f, i) => {
              const w = Math.max((f.users / maxUsers) * 100, 4);
              const ex = FUNNEL_EXT[i];
              return (
                <button key={f.stage} disabled={queryLoading} className={"fn-row" + (i === safeStage ? " sel" : "")} onClick={() => {
                  setSelStage(i);
                  void applySlice(L2_STAGE_EVENTS[i]);
                }}>
                  <div className="lbl">
                    <span className="nm"><AutoGloss>{f.stage}</AutoGloss><span className="lc">{f.lc}</span>{ex.v1 && <span className="bdg dim" style={{ fontSize: 10.5 }}>暂用二次下单口径</span>}</span>
                    <span className="ev" title={STAGE_EV[i] ?? f.ev ?? ""}><AutoGloss>{ex.plain}</AutoGloss></span>
                  </div>
                  <div className="barzone"><div className="bar" style={{ width: `${w}%`, background: f.color }}><span>{f.users.toLocaleString("en-US")}</span></div></div>
                  <div className="cvr">{f.cvr != null ? <><span className="pc">{f.cvr}%</span><span className="tg">{ex.tg ? `目标 ${ex.tg}` : "上级转化"}</span></> : <span className="tg">漏斗顶</span>}</div>
                </button>
              );
            })}
          </div>
          <div className="stage-x">
            <div className="hd">
              <span className="t"><AutoGloss>{s.stage}</AutoGloss> 级展开</span>
              <span className="lcode">{STAGE_EV[safeStage] ?? s.ev}</span>
              {ext.tg && <span className="bdg ok">目标 {ext.tg}</span>}
              <span style={{ marginLeft: "auto" }} />
              <button className="l-btn sm" disabled={queryLoading} onClick={() => void applySlice(L2_STAGE_EVENTS[safeStage])}>刷新本级路径事实</button>
            </div>
            <div className="stage-x-grid">
              <div className="cell"><div className="k">上级流入</div><div className="v">{ext.inflow}</div></div>
              <div className="cell"><div className="k">本级转化</div><div className="v" style={{ color: "var(--cyan)" }}>{s.cvr != null ? `${s.cvr}%` : "—"}</div><div className="s">{s.users.toLocaleString("en-US")} 人到达本级</div></div>
              <div className="cell"><div className="k">流失去向</div><div className="s" style={{ marginTop: 6 }}><AutoGloss>{ext.lost}</AutoGloss></div></div>
              <div className="cell"><div className="k">本级停留时长分布</div><div className="dwell">{ext.dwell.map((d, i) => <i key={i} style={{ height: `${(d / dwellMax) * 100}%` }} />)}</div><div className="s">0h → 7d+ 八档</div></div>
            </div>
            <div className="ltint" style={{ marginTop: 12, fontSize: 12 }}><b>解读</b> · <AutoGloss>{ext.note}</AutoGloss></div>
            {ext.trial && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)", marginTop: 14 }}>
                  trial 子漏斗 · 首购前的试用路径 <span className="lcode" style={{ marginLeft: 6 }} title="口径权威 H2">试用规则归 H2,这里只看</span> <span className="bdg dim" style={{ marginLeft: 4 }}>单独计算 · 不算进首购转化率</span>
                </div>
                <div className="trial-strip">
                  {TRIAL_STEPS.map((t, i) => (
                    <div key={t.e} className="trial-step">
                      <div className="bx"><div className="e">{t.e}</div><div className="n">{t.n.toLocaleString("en-US")}</div></div>
                      {i < TRIAL_STEPS.length - 1
                        ? <div className="arr"><b>{TRIAL_STEPS[i + 1].arr}</b>{TRIAL_STEPS[i + 1].arrLb}</div>
                        : <div className="arr" style={{ color: "var(--ink-4)" }}>终态产 bonus<br />账单归 D4</div>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* (b) cohort 留存矩阵 + 曲线 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">Cohort 留存矩阵</span>
          <span className="sub">· <AutoGloss>注册周分组 × 留存窗 · 每格 = 该批用户到那天还有多少在用 app · 点格子换右侧曲线</AutoGloss></span>
          <div className="r"><div className="ret-legend">
            <span>低</span>
            {[10, 25, 45, 70].map((a) => <i key={a} style={{ background: `color-mix(in srgb, var(--cyan) ${a}%, transparent)` }} />)}
            <span>高</span>
          </div></div>
        </div>
        <div className="ret-grid">
          <div>
            <table className="l-tbl ret-tbl">
              <thead><tr><th>注册 cohort</th><th className="num">规模</th>{retentionColumns.map(({ day }) => <th key={day} style={{ textAlign: "center" }}>Day{day}</th>)}<th style={{ textAlign: "center" }}>对比</th></tr></thead>
              <tbody>
                {COHORTS.map((c, i) => (
                  <tr key={c.w}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{c.w}{i === safeCohort && <span className="bdg cyan" style={{ fontSize: 10.5, marginLeft: 4 }}>曲线</span>}</td>
                    <td className="num mono">{c.size.toLocaleString("en-US")}</td>
                    {retentionColumns.map(({ day, key }) => (
                      <td key={day} className="cellv" style={heatStyle(c[key] as number | null | undefined)} onClick={() => void loadCurve(i)} title={`${c.w} · Day${day}`}>{c[key] == null ? "—" : `${c[key]}%`}</td>
                    ))}
                    <td style={{ textAlign: "center" }}><button className="l-btn sm" disabled={queryLoading} onClick={() => void loadCurve(i)}>查询曲线</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ltint" style={{ marginTop: 12, fontSize: 12 }}><b>读法</b> · <AutoGloss>横向看单个 cohort 的衰减;纵向比较产品迭代 / Phase 切换对同一留存窗的影响。没有成熟数据的窗口显示“—”,不据此生成归因结论。</AutoGloss></div>
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>留存衰减曲线 · {COHORTS[safeCohort].w}</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginBottom: 10 }}>该 cohort 留存率随天数衰减 · 虚线为对比 cohort</div>
            {curveChart()}
            <div className="chips" style={{ marginTop: 10 }}><span className="lb">对比</span>
              {[...cohortCurveKeys.filter((key) => key !== COHORTS[safeCohort].w).slice(-2).map((key) => [key, `vs ${key}`]), ["none", "关闭对比"]].map(([v, lb]) => (
                <button key={v} className={"chip" + (cmp === v ? " sel" : "")} onClick={() => setCmp(v)}>{lb}</button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* (c) 多维交叉 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">多维交叉分析</span>
          <span className="sub">· <AutoGloss>phase × locale × 渠道任意交叉 · 定位「P3 某渠道首购转化骤降」类信号</AutoGloss></span>
          <div className="r"><div className="chips"><span className="lb">指标</span>
            {([["cvr", "首购 CVR(L3→L4)"], ["ret", "Day7 留存"], ["trial", "trial→购买率"]] as const).map(([v, lb]) => (
              <button key={v} disabled={queryLoading} className={"chip" + (metric === v ? " sel" : "")} onClick={() => void loadCrossMetric(v)}>{lb}</button>
            ))}
          </div></div>
        </div>
        <div className="l-b">
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl xd-tbl" style={{ minWidth: 760 }}>
              <thead><tr><th>渠道 ref · Phase \ locale</th>{xd.columns.map((column) => <th key={column} style={{ textAlign: "center" }}>{column}</th>)}<th style={{ textAlign: "center" }}>行均值</th></tr></thead>
              <tbody>
                {xd.rows.map((r, ri) => (
                  <tr key={String(r[0])}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{r[0]}</td>
                    {r.slice(1, xd.columns.length + 1).map((v, ci) => (
                      <td key={ci} className={"xv" + (ri === xd.alert[0] && ci === xd.alert[1] - 1 ? " alert" : "")}>{v == null ? "—" : `${v}${xd.unit}`}</td>
                    ))}
                    <td className="xv" style={{ color: "var(--ink-3)" }}>{r[xd.columns.length + 1] == null ? "—" : `${r[xd.columns.length + 1]}${xd.unit}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="xd-foot">
            <span className="ltint warn" style={{ flex: 1, minWidth: 260 }}><b>{xd.msg.pre.split("·")[0].trim()}</b> · <AutoGloss>{xd.msg.pre.split("·").slice(1).join("·")}</AutoGloss><b>{xd.msg.bold}</b><AutoGloss>{xd.msg.post}</AutoGloss></span>
            {[["B4 节奏", "跳 B4 节奏状态(Phase 效果归因)"], ["H1 Phase", "跳 H1 Phase 调度(节奏参数在那里调)"], ["I 域文案", "跳 I 域转化文案(locale 文案 A/B)"], ["F 域渠道", "跳 F 域渠道(ref 质量)"]].map(([lb, msg]) => (
              <button key={lb} className="l-btn sm" onClick={() => ctx.toast(`${msg} · 原型占位`)}>{lb}</button>
            ))}
          </div>
        </div>
      </section>

      <p className="f-foot"><b>L2 没有任何「写数据」动作</b>:<AutoGloss>漏斗与留存怎么算由统一统计规则治理,这里只做下钻查询、视图配置与聚合导出。</AutoGloss><b>关于复投这一级</b>:<AutoGloss>优先采用 wallet.reinvest,并兼容首购后的第二笔 checkout.completed 降级口径。导出只含聚合计数,</AutoGloss><b>不含手机号、地址等明文</b>,<AutoGloss>每次导出都会生成可追溯记录。</AutoGloss></p>
      <PaginationExemptionList
        items={[
          {
            label: "Cohort 留存矩阵",
            kind: "fixed-matrix",
            maxRows: 6,
            reason: "留存 cohort 固定六行,需同屏比较 Day1/7/30",
          },
        ]}
      />
    </div>
  );
}
