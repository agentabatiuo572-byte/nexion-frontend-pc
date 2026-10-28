"use client";
import { operatorCopyText } from "@/lib/admin/operator-copy";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
/**
 * G3 NEX 价格管理 — 数据来自后端 /api/admin/market/nex/curve 与 /curve/history。
 * 页面只展示后端返回的 NEX 行情与控制状态。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchG3MarketHistory,
  fetchG3MarketOverview,
  updateG3Control,
  updateG3CurveFrame,
  updateG3Override,
  type G3CurveField,
  type G3HistoryPoint,
  type G3Overview,
  type G3OverrideKey,
} from "@/lib/admin/g3-client";
import type { GCtx } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";

const OPERATOR = currentAdminOperator;
const CURVE_FIELDS: G3CurveField[] = ["targetPrice", "pumpProbability", "volatilityPct"];
const CURVE_LABELS: Record<G3CurveField, { name: string; unit: string }> = {
  targetPrice: { name: "目标价", unit: "$" },
  pumpProbability: { name: "上涨概率", unit: "0-1" },
  volatilityPct: { name: "波动幅度", unit: "+/-%" },
};
const CURVE_LOOSEN_DIR: Partial<Record<G3CurveField, "increase">> = {
  targetPrice: "increase",
  pumpProbability: "increase",
};

function messageOf(error: unknown) {
  return displayAdminError(error);
}

function fmtCompact(value: number, max = 6) {
  return value.toLocaleString("en-US", { maximumFractionDigits: max });
}

function fmtPrice(value: number) {
  return `$${fmtCompact(value, 8)}`;
}

function fmtPct(value: number) {
  return `${fmtCompact(value, 4)}%`;
}

function fmtOptionalPrice(value: number | null) {
  return value == null ? "未配置" : fmtPrice(value);
}

function fmtOptionalPct(value: number | null) {
  return value == null ? "未配置" : fmtPct(value);
}

function rawValue(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function frameValue(frame: G3Overview["frames"][number], field: G3CurveField) {
  if (field === "targetPrice") return frame.targetPrice;
  if (field === "pumpProbability") return frame.pumpProbability;
  return frame.volatilityPct;
}

function fmtCurveVal(field: G3CurveField, value: number) {
  if (field === "targetPrice") return fmtPrice(value);
  if (field === "volatilityPct") return `+/-${fmtCompact(value, 4)}%`;
  return fmtCompact(value, 6);
}

function controlValue(overview: G3Overview, key: string) {
  return overview.controls.find((control) => control.key === key)?.value || "—";
}

function changePct(points: number[]) {
  const first = points[0] || 0;
  const last = points[points.length - 1] || 0;
  if (first <= 0) return 0;
  return ((last - first) / first) * 100;
}

export function deriveG3RuntimeStatus(paused: boolean, pinValue: string) {
  const pin = pinValue.trim().toUpperCase();
  if (paused) {
    return {
      label: "已暂停",
      detail: "价格停在当前值，不再自动变化。",
      tone: "bad",
    };
  }
  if (/^D[1-7]$/.test(pin)) {
    return {
      label: `已固定在 ${pin}`,
      detail: "价格固定用这一天的设置，不再自动切换到下一天。",
      tone: "warn",
    };
  }
  return {
    label: "按计划自动运行",
    detail: "每天按设定时间自动切换到下一天的价格。",
    tone: "",
  };
}

export function G3Market({ ctx }: { ctx: GCtx }) {
  const { toast, openActionConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const isSuper = session?.role === "super" || session?.role === "superadmin";
  const allowed = (authority: string) => isSuper || authorities.includes(authority);
  const curveAuthority = (field: G3CurveField) => field === "targetPrice"
    ? "finprod_g3_curve_target_price_write"
    : field === "pumpProbability"
      ? "finprod_g3_curve_pump_prob_write"
      : "finprod_g3_write";
  const [overview, setOverview] = useState<G3Overview | null>(null);
  const [history, setHistory] = useState<G3HistoryPoint[]>([]);
  // 概览与历史是两个独立服务面:历史读取失败必须有自己的原因与重试入口,
  // 不能只留一句「未返回」让运营无从定位(简报 #66)。
  const [historyError, setHistoryError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    setHistoryError("");
    const [overviewResult, historyResult] = await Promise.allSettled([
      fetchG3MarketOverview(),
      fetchG3MarketHistory(),
    ]);
    if (overviewResult.status === "fulfilled") {
      setOverview(overviewResult.value);
    } else {
      setError(messageOf(overviewResult.reason));
    }
    if (historyResult.status === "fulfilled") {
      setHistory(historyResult.value.points);
    } else {
      setHistory([]);
      setHistoryError(messageOf(historyResult.reason));
    }
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      setHistoryError("");
      const [overviewResult, historyResult] = await Promise.allSettled([
        fetchG3MarketOverview(),
        fetchG3MarketHistory(),
      ]);
      if (cancelled) return;
      if (overviewResult.status === "fulfilled") {
        setOverview(overviewResult.value);
      } else {
        setError(messageOf(overviewResult.reason));
      }
      if (historyResult.status === "fulfilled") {
        setHistory(historyResult.value.points);
      } else {
        setHistory([]);
        setHistoryError(messageOf(historyResult.reason));
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const mutate = useCallback(async (key: string, action: () => Promise<G3Overview>, success: string) => {
    setBusyKey(key);
    setError("");
    try {
      const next = await action();
      setOverview(next);
      // 写入成功后回读历史属于附加刷新:历史面失败不能把已成功的写入报成失败。
      const [historyResult] = await Promise.allSettled([fetchG3MarketHistory()]);
      if (historyResult.status === "fulfilled") {
        setHistory(historyResult.value.points);
        setHistoryError("");
      } else {
        setHistory([]);
        setHistoryError(messageOf(historyResult.reason));
      }
      toast(success);
    } catch (err) {
      const message = messageOf(err);
      setError(message);
      toast(`操作失败 · ${message}`);
      throw err;
    } finally {
      setBusyKey(null);
    }
  }, [toast]);

  const chartPrices = useMemo(() => {
    const values = history.map((point) => point.price).filter((value) => value > 0);
    return values.length >= 2 ? values : [];
  }, [history]);

  if (loading && !overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">UVT 价格管理</span><span className="sub">· 加载中</span></div>
        <div className="l-b"><div className="gtint">价格数据加载中…</div></div>
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">UVT 价格管理</span></div>
        <div className="l-b">
          <div className="gtint">价格数据加载失败 · {error || "没有收到数据，请重试；一直失败请联系值班同事。"}</div>
          <button className="l-btn mc" style={{ marginTop: 12 }} onClick={() => void reload()}>重新加载</button>
        </div>
      </section>
    );
  }

  const busy = !!busyKey;
  const paused = overview.overrides.paused;
  const curDay = overview.activeDayIndex + 1;
  const peak = overview.weekPeakPrice;
  const cov = overview.coverage.coverageRatio.toFixed(1);
  const redline = overview.coverage.redlinePct.toFixed(1);
  const price = fmtPrice(overview.currentPrice);
  const volatility = `+/-${fmtCompact(overview.overrides.volatilityPct, 4)}%`;
  const oracle = overview.overrides.oracle;
  const deviation = fmtOptionalPct(overview.overrides.deviationPct);
  const costBasis = fmtOptionalPrice(overview.overrides.costBasis);
  const scheduleControl = overview.controls.find((control) => control.key === "schedule");
  const schedV = controlValue(overview, "schedule");
  const scheduleMeta = scheduleControl?.cronExpression
    ? `${scheduleControl.cronExpression} · ${scheduleControl.zone || "—"}`
    : "—";
  const pinV = controlValue(overview, "pin");
  const loopV = controlValue(overview, "loop");
  const runtimeStatus = deriveG3RuntimeStatus(paused, pinV);
  const coverageSnapshot = {
    coverageRatio: overview.coverage.coverageRatio,
    redlinePct: overview.coverage.redlinePct,
  };
  const ctlVals: Record<string, string> = { schedule: schedV, pin: pinV, loop: loopV };
  const ctlOptions: Record<string, string[]> = {
    pin: ["未钉住", ...overview.frames.map((_, index) => `D${index + 1}`)],
    loop: ["循环", "停在末值"],
  };

  const openCurveCellMc = (dayIndex: number, field: G3CurveField) => {
    const frame = overview.frames[dayIndex];
    if (!frame) return;
    const label = CURVE_LABELS[field];
    const current = frameValue(frame, field);
    const amp = !!CURVE_LOOSEN_DIR[field];
    openActionConfirm({
      action: `修改一周价格计划 · D${dayIndex + 1} · ${label.name}`,
      detail: <>
        <b>D{dayIndex + 1} {label.name}</b> · 当前 {fmtCurveVal(field, current)}({label.unit})。
        {amp
          ? <><b>会让平台多付钱</b>：系统会按本周最高价 {fmtPrice(peak)} 重新计算 UVT 应付款，覆盖率低于红线时无法保存（当前 {cov}%，红线 {redline}%）。</>
          : "波动幅度不会直接让平台多付钱。"}
        这里只改计划，不改当前价格；到了那一天才会生效。
        需要财务主管或超级管理员操作。
      </>,
      amplifies: amp,
      coverage: amp ? coverageSnapshot : undefined,
      edit: field === "pumpProbability"
        ? { kind: "number", current: rawValue(current), min: 0, max: 1, step: 0.01, disallowCurrent: true, amplifiesWhen: "increase" }
        : field === "volatilityPct"
          ? { kind: "number", current: rawValue(current), min: 0, max: 20, step: 0.01, disallowCurrent: true }
          : { kind: "number", current: rawValue(current), min: 0.00000001, max: 1000000, step: 0.00000001, disallowCurrent: true, amplifiesWhen: "increase" },
      run: async (reason, value) => {
        if (!value) return;
        await mutate(`curve:${dayIndex}:${field}`, () => updateG3CurveFrame(
          overview, dayIndex, field, value, reason, OPERATOR(),
        ), `D${dayIndex + 1} ${label.name}已保存，到那一天生效`);
      },
    });
  };

  const openCurveCtlMc = (key: string, name: string, current: string) => {
    const isSchedule = key === "schedule";
    const editCurrent = isSchedule ? (scheduleControl?.rawValue || current) : current;
    openActionConfirm({
      action: `调整价格计划运行方式 · ${name}`,
      detail: <><b>{name}</b> · 当前:{current}。{isSchedule ? <>填写每天几点切换，例如 <span className="mono">每天北京时间 08:30 自动推进</span>。当前设置：{scheduleMeta}。</> : <>固定某一天或暂停切换，都不会改动已设好的计划。</>} 需要财务主管或超级管理员操作。</>,
      amplifies: false,
      edit: ctlOptions[key]
        ? { kind: "select", current, options: ctlOptions[key], optionLabels: { "未钉住": "不固定" }, disallowCurrent: true }
        : { kind: "text", current: editCurrent, disallowCurrent: true },
      run: async (reason, value) => {
        if (value == null) return;
        await mutate(`control:${key}`, () => updateG3Control(key, value, editCurrent, reason, OPERATOR()), `${name}已立即生效`);
      },
    });
  };

  const adj = (overrideKey: G3OverrideKey, label: string, current: string, note: string, amp?: boolean) => {
    openActionConfirm({
      action: `手动设置 · ${label}`,
      detail: <><b>{label}</b> · 当前 {current} · {note}。{amp && <><b>会让平台多付钱</b>：系统会按本周最高价 {fmtPrice(peak)} 重新计算 UVT 应付款，覆盖率低于红线时无法保存（当前 {cov}%，红线 {redline}%）。</>}手动设置只是临时的，下次自动切换时会被计划里的值替换。</>,
      amplifies: !!amp,
      coverage: amp ? coverageSnapshot : undefined,
      edit: overrideKey === "volatilityPct"
        ? { kind: "number", current, min: 0, max: 20, step: 0.01, disallowCurrent: true }
        : overrideKey === "deviationPct"
          ? { kind: "number", current, min: 0, max: 50, step: 0.01, disallowCurrent: true }
          : { kind: "number", current, min: 0.00000001, max: 1000000, step: 0.00000001, disallowCurrent: true, amplifiesWhen: amp ? "increase" : undefined },
      run: async (reason, value) => {
        if (!value) return;
        await mutate(`override:${overrideKey}`, () => updateG3Override(overrideKey, value, current, reason, OPERATOR()), `${label}已立即生效`);
      },
    });
  };

  const pauseEngine = () => openActionConfirm({
    action: paused ? "恢复价格自动变化" : "暂停价格自动变化",
    detail: paused
      ? <>恢复后价格继续按计划变化。价格上涨会让平台多付钱，覆盖率低于红线时无法恢复（当前 {cov}%，红线 {redline}%）。</>
      : <>暂停后全站 UVT 价格停在当前值，不再变化。需要风控主管或超级管理员操作。</>,
    amplifies: paused,
    coverage: paused ? coverageSnapshot : undefined,
    run: async (reason) => {
      await mutate("override:paused", () => updateG3Override("paused", String(!paused), String(paused), reason, OPERATOR()), paused ? "价格已恢复自动变化" : "价格已暂停变化");
    },
  });

  const W = 760;
  const H = 180;
  const P = 30;
  const chart = chartPrices;
  const hasChart = chart.length >= 2;
  const latestSampledAt = history.at(-1)?.sampledAt.replace("T", " ") ?? "暂无";
  const minPrice = (hasChart ? Math.min(...chart, overview.currentPrice) : overview.currentPrice) * 0.98;
  const maxPrice = (hasChart ? Math.max(...chart, peak, overview.currentPrice) : Math.max(peak, overview.currentPrice)) * 1.02;
  const spread = Math.max(0.000001, maxPrice - minPrice);
  const X = (index: number) => P + (index / Math.max(1, chart.length - 1)) * (W - 2 * P);
  const Y = (value: number) => H - 22 - ((value - minPrice) / spread) * (H - 40);
  const path = hasChart ? chart.map((value, index) => `${index ? "L" : "M"}${X(index).toFixed(1)} ${Y(value).toFixed(1)}`).join(" ") : "";
  const peakY = Y(peak);
  const change = hasChart ? changePct(chart) : null;

  return (
    <>
      {error && <div className="gtint" style={{ marginBottom: 12 }}>操作提示 · {error}</div>}
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">UVT 现价</div><div className="v">{price}</div><div className="sub">{change == null ? "24 小时涨跌暂无" : `24 小时 ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`} · 今天用 D{curDay}</div></div>
        <div className="f-stat cyan"><div className="k">计划进度</div><div className="v">D{curDay} / 7</div><div className="sub">{schedV} · 本周最高 {fmtPrice(peak)}</div></div>
        <div className="f-stat"><div className="k">价格来源</div><div className="v">{oracle}</div><div className="sub">偏离告警 {deviation}</div></div>
        <div className="f-stat"><div className="k">运行状态</div><div className="v" style={{ color: runtimeStatus.tone === "bad" ? "var(--danger)" : runtimeStatus.tone === "warn" ? "var(--warning)" : "var(--ink-3)" }}>{runtimeStatus.label}</div><div className="sub">{runtimeStatus.detail}</div></div>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">一周价格计划（7 天）</span>
          <span className="sub">· 点格子修改 · 高亮 = 今天 · 黄色 = 和前一天不同 · ★ = 本周最高价</span>
          <div className="r">
            <span className={`bdg ${runtimeStatus.tone}`}>{runtimeStatus.label}</span>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="dial-tbl" style={{ minWidth: 680 }}>
            <thead>
              <tr>
                <th>日期</th>
                {CURVE_FIELDS.map((field) => (
                  <th key={field}>{CURVE_LABELS[field].name}<br /><span style={{ fontWeight: 400, fontSize: 10 }}>({CURVE_LABELS[field].unit})</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {overview.frames.map((frame, dayIndex) => {
                const isCur = dayIndex === overview.activeDayIndex;
                return (
                  <tr key={frame.dayIndex} className={isCur ? "cur" : undefined}>
                    <td>D{dayIndex + 1}{isCur && " · 今天"}</td>
                    {CURVE_FIELDS.map((field) => {
                      const current = frameValue(frame, field);
                      const previous = dayIndex > 0 ? frameValue(overview.frames[dayIndex - 1], field) : current;
                      const changed = dayIndex > 0 && previous !== current;
                      const isPeak = field === "targetPrice" && Math.abs(current - peak) < 0.0000001;
                      return (
                        <td key={field} className={isPeak ? "peak" : changed ? "chg" : undefined}
                          onClick={allowed(curveAuthority(field)) ? () => openCurveCellMc(dayIndex, field) : undefined}
                          title={allowed(curveAuthority(field)) ? "点击修改" : "你没有修改这一项的权限"}>
                          {fmtCurveVal(field, current)}{isPeak && " ★"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="ttl" style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>运行方式</div>
          {overview.controls.map((control) => (
            <div className="p-row" key={control.key}>
              <div className="txt"><div className="k">{operatorCopyText(control.name)}</div><div className="s">{operatorCopyText(control.description)}</div></div>
              <span className="v">{operatorCopyText(ctlVals[control.key] || control.value)}</span>
              {allowed("finprod_g3_write") && <button className="l-btn sm mc" disabled={busy} onClick={() => openCurveCtlMc(control.key, operatorCopyText(control.name), ctlVals[control.key] || control.value)}>调整(立即执行)</button>}
            </div>
          ))}
          <div className="gtint" style={{ marginTop: 10 }}><b>怎么生效</b> · 每天在 <span className="mono">{schedV}</span> 自动把当天的 <b>目标价</b> 设为全站 UVT 价格，兑换和复投马上跟着变。当前设置：<span className="mono">{scheduleMeta}</span>。「固定某天」用于演示或应急，固定后不再自动切换。调高 <b>目标价 / 上涨概率</b> 会让平台多付钱，覆盖率低于红线时无法保存。</div>
        </div>
      </section>

      <div className="two-col r13" style={{ marginBottom: 16 }}>
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">价格走势</span>
            <span className="sub">· 近 24 小时 · 最近更新 {latestSampledAt} · 本周最高 {fmtPrice(peak)}</span>
            <div className="r">{allowed("finprod_g3_engine_pause_toggle") && (!paused || isSuper) && <button className="l-btn mc" disabled={busy} onClick={pauseEngine}>{paused ? "恢复价格变化" : "暂停价格变化"}</button>}</div>
          </div>
          <div className="l-b">
            <div className="price-hero"><span className="big">{price}</span><span className="chg">{change == null ? "涨跌暂无" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}</span>{paused && <span className="bdg bad">已冻结</span>}</div>
            {hasChart ? (
              <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 180, display: "block" }}>
                <line x1={P} y1={peakY} x2={W - P} y2={peakY} stroke="var(--ink-4)" strokeWidth={1} strokeDasharray="4 4" />
                <text x={W - P} y={peakY - 5} fontSize={10.5} fill="var(--ink-4)" textAnchor="end" fontFamily="var(--mono)">{`峰值 ${fmtPrice(peak)}`}</text>
                <path d={`${path} L${X(chart.length - 1)} ${H - 22} L${X(0)} ${H - 22} Z`} fill="var(--admin-domain-g)" opacity={0.08} />
                <path d={path} fill="none" stroke="var(--admin-domain-g)" strokeWidth={2} />
                <circle cx={X(chart.length - 1)} cy={Y(chart[chart.length - 1])} r={3.5} fill="var(--bg)" stroke="var(--admin-domain-g)" strokeWidth={2} />
              </svg>
            ) : (
              <div className="gtint" style={{ marginTop: 16 }} data-proof="g3-history-empty">
                {historyError
                  ? `近 24 小时价格加载失败 · ${historyError}`
                  : "暂无近 24 小时价格数据。"}
                <div className="row" style={{ marginTop: 10, gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button className="l-btn sm mc" disabled={busy} onClick={() => void reload(true)}>重新加载</button>
                  <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
                    最近 24 小时价格记录
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">手动设置</span>
            <span className="sub">· 应急用 · 下次自动切换时会被计划值替换</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="p-row"><div className="txt"><div className="k">直接改当前价格（应急）</div><div className="s">临时改价，要求覆盖率不低于红线</div></div><span className="v">{price}</span>{allowed("finprod_g3_override_price_write") && <button className="l-btn sm mc" disabled={busy} onClick={() => adj("currentPrice", "当前价格", rawValue(overview.currentPrice), "临时改价，下次自动切换时恢复计划值", true)}>调整</button>}</div>
            <div className="p-row"><div className="txt"><div className="k">波动幅度</div><div className="s">每次更新价格最多波动多少（计划里没设时使用）</div></div><span className="v">{volatility}</span>{allowed("finprod_g3_write") && <button className="l-btn sm mc" disabled={busy} onClick={() => adj("volatilityPct", "波动幅度", rawValue(overview.overrides.volatilityPct), "可设 0–20%")}>调整</button>}</div>
            <div className="p-row"><div className="txt"><div className="k">价格来源</div><div className="s">内部定价或外部价格来源</div></div><span className="v">{oracle === "内部做市" ? "内部定价" : oracle === "外部喂价" ? "外部价格来源" : "价格来源未知"}</span>{isSuper && <button className="l-btn sm mc" disabled={busy} onClick={() => openActionConfirm({
              action: "切换价格来源",
              detail: <>在内部定价和外部价格来源之间切换。只有超级管理员可以操作。</>,
              edit: { kind: "select", current: oracle, options: ["内部做市", "外部喂价"], optionLabels: { "内部做市": "内部定价", "外部喂价": "外部价格来源" }, disallowCurrent: true },
              run: async (reason, value) => {
                if (!value) return;
                await mutate("override:oracle", () => updateG3Override("oracle", value, oracle, reason, OPERATOR()), "价格来源已立即切换");
              },
            })}>切换</button>}</div>
            <div className="p-row"><div className="txt"><div className="k">偏离告警阈值</div><div className="s">当前价格和外部价格相差超过这个比例就告警</div></div><span className="v">{deviation}</span>{allowed("finprod_g3_write") && <button className="l-btn sm mc" disabled={busy} onClick={() => adj("deviationPct", "偏离告警阈值", rawValue(overview.overrides.deviationPct), "可设 0–50%")}>调整</button>}</div>
            <div className="p-row"><div className="txt"><div className="k">初始成本价</div><div className="s">App 盈亏卡片的计算基准（<span className="mono">盈亏 = 持有数量 ×（现价 − 初始成本价）</span>），不影响价格</div></div><span className="v">{costBasis}</span>{allowed("finprod_g3_write") && <button className="l-btn sm mc" disabled={busy} onClick={() => adj("costBasis", "初始成本价", rawValue(overview.overrides.costBasis), "只用于 App 显示盈亏，不影响价格和兑换")}>调整</button>}</div>
          </div>
        </section>
      </div>

      <p className="f-foot">运营设置的是一周价格计划，系统每天按时切换到当天的目标价。UVT 价格是<b>兑换和复投的唯一价格</b>，价格一变，平台的 UVT 应付款也跟着变。调高<b>目标价 / 上涨概率</b>会让平台多付钱，系统按<b>本周最高价</b>检查覆盖率。暂停价格变化 = 价格停在当前值，「紧急停用开关」也能触发。</p>
    </>
  );
}
