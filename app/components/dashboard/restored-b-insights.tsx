"use client";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { formatB3RefOption } from "@/lib/admin/b3-ref-display";

import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { useId, type CSSProperties, type ReactNode } from "react";
import { SMALL_SAMPLE_LABEL, type B3Dashboard } from "@/lib/admin/b3-client";
import type { B5Radar } from "@/lib/admin/b5-client";
import { summarizePressureHistory } from "@/lib/admin/b5-pressure-summary";
import { useB4GrowthFlowHistory } from "@/lib/admin/b-restoration-client";
import { fmtConfigPct } from "@/lib/format";

const CARD: CSSProperties = {
  border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: 16, minWidth: 0,
};
const GRID: CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, marginTop: 16, marginBottom: 16,
};
const COLORS = ["var(--danger)", "var(--warning)", "var(--cyan)", "var(--success)", "var(--brand)", "var(--ink-4)"];

function Header({ title, meta }: { title: string; meta: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", marginBottom: 12 }}><b>{title}</b><span style={{ color: "var(--ink-4)", fontSize: 11.5 }}>{meta}</span></div>;
}

function Notice({ children, healthState }: { children: ReactNode; healthState?: "error" }) {
  return <p data-module-health-state={healthState} style={{ color: "var(--ink-3)", fontSize: 12.5, margin: "10px 0 0" }}>{children}</p>;
}

function TrendChart({
  values, labels, threshold, thresholdLabel, valueSuffix = "", ariaLabel,
}: {
  values: Array<number | null>;
  labels?: string[];
  threshold?: number;
  thresholdLabel?: string;
  valueSuffix?: string;
  ariaLabel: string;
}) {
  const rawId = useId().replace(/:/g, "");
  const width = 640;
  const height = 180;
  const padX = 30;
  const padTop = 22;
  const padBottom = 32;
  const available = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const scaleValues = threshold === undefined ? available : [...available, threshold];
  const min = scaleValues.length ? Math.min(...scaleValues) : 0;
  const max = scaleValues.length ? Math.max(...scaleValues) : 1;
  const spread = Math.max(max - min, Math.abs(max) * 0.1, 0.01);
  const low = min - spread * 0.18;
  const high = max + spread * 0.18;
  const y = (value: number) => padTop + ((high - value) / Math.max(high - low, 0.01)) * (height - padTop - padBottom);
  const points = values.map((value, index) => value === null ? null : ({
    x: padX + (index / Math.max(values.length - 1, 1)) * (width - padX * 2), y: y(value), value, index,
  })).filter((point): point is NonNullable<typeof point> => point !== null);
  const segments: typeof points[] = [];
  values.forEach((value, index) => {
    if (value === null) return;
    const point = points.find((candidate) => candidate.index === index)!;
    if (index === 0 || values[index - 1] === null) segments.push([]);
    segments.at(-1)!.push(point);
  });
  const thresholdY = threshold === undefined ? null : y(threshold);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel} style={{ width: "100%", height: 190, overflow: "visible" }}>
      <defs><linearGradient id={`${rawId}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--cyan)" stopOpacity="0.3" /><stop offset="1" stopColor="var(--cyan)" stopOpacity="0.02" /></linearGradient></defs>
      <line x1={padX} y1={height - padBottom} x2={width - padX} y2={height - padBottom} stroke="var(--border-strong)" />
      {thresholdY !== null && <><line x1={padX} y1={thresholdY} x2={width - padX} y2={thresholdY} stroke="var(--danger)" strokeWidth="2" strokeDasharray="7 5" /><text x={padX + 4} y={Math.max(13, thresholdY - 7)} fill="var(--danger)" fontSize="12">{thresholdLabel ?? threshold}</text></>}
      {segments.map((segment, segmentIndex) => {
        const line = segment.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
        const area = segment.length > 1
          ? `${line} L${segment.at(-1)!.x} ${height - padBottom} L${segment[0].x} ${height - padBottom} Z`
          : "";
        return <g key={segmentIndex}>{area && <path d={area} fill={`url(#${rawId}-fill)`} />}<path d={line} fill="none" stroke="var(--cyan)" strokeWidth="3" vectorEffect="non-scaling-stroke" /></g>;
      })}
      {points.map((point) => <g key={point.index}><circle cx={point.x} cy={point.y} r="4" fill="var(--surface)" stroke="var(--cyan)" strokeWidth="2" vectorEffect="non-scaling-stroke" /><text x={point.x} y={Math.max(13, point.y - 10)} textAnchor={point.index === 0 ? "start" : point.index === values.length - 1 ? "end" : "middle"} fill="var(--ink-2)" fontSize="11">{point.value.toFixed(valueSuffix ? 1 : 2)}{valueSuffix}</text></g>)}
      {values.map((_, index) => <text key={index} x={padX + (index / Math.max(values.length - 1, 1)) * (width - padX * 2)} y={height - 10} textAnchor="middle" fill="var(--ink-4)" fontSize="10">{labels?.[index] ?? (index === values.length - 1 ? "当前" : `前 ${values.length - 1 - index} 期`)}</text>)}
    </svg>
  );
}

function Donut({ rows, center }: { rows: Array<{ label: string; value: number; color: string; suffix?: string }>; center: string }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  let cursor = 0;
  const stops = rows.map((row) => {
    const start = cursor;
    cursor += total > 0 ? row.value / total * 100 : 0;
    return `${row.color} ${start}% ${cursor}%`;
  }).join(", ");
  return <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
    <div aria-label={`${center}环图`} style={{ width: 142, height: 142, borderRadius: "50%", background: total > 0 ? `conic-gradient(${stops})` : "var(--surface-3)", position: "relative", flex: "0 0 auto" }}><div style={{ position: "absolute", inset: 28, borderRadius: "50%", background: "var(--surface)", display: "grid", placeItems: "center", color: "var(--ink-2)", textAlign: "center", fontSize: 12 }}>{center}</div></div>
    <div style={{ flex: "1 1 180px", display: "grid", gap: 8 }}>{rows.map((row) => <div key={row.label} style={{ display: "grid", gridTemplateColumns: "10px 1fr auto", gap: 7, alignItems: "center", fontSize: 12.5 }}><i style={{ width: 9, height: 9, borderRadius: 99, background: row.color }} /><span>{row.label}</span><b>{row.value.toFixed(1)}{row.suffix ?? ""}</b></div>)}</div>
  </div>;
}

function Bars({ values, labels, suffix = "" }: { values: number[]; labels: string[]; suffix?: string }) {
  const max = Math.max(...values.map(Math.abs), 1);
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(values.length, 1)}, minmax(34px, 1fr))`, gap: 8, minHeight: 170 }}>{values.map((value, index) => <div key={`${labels[index]}-${index}`} style={{ display: "grid", gridTemplateRows: "20px 126px 20px", textAlign: "center", fontSize: 10.5, color: "var(--ink-4)" }}><b style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>{value}{suffix}</b><div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center" }}><i data-zero={value === 0 ? "true" : "false"} style={{ width: "58%", height: value === 0 ? 0 : Math.max(4, Math.abs(value) / max * 112), background: index === values.length - 1 ? "var(--cyan)" : "var(--admin-domain-b)", borderRadius: "5px 5px 0 0" }} /></div><span>{labels[index]}</span></div>)}</div>;
}

export function B3RestoredInsights({ data }: { data: B3Dashboard }) {
  const daily = data.dailyFirstPurchase;
  const suppressedDaily = daily.filter((row) => row.suppressed);
  const partialChannels = data.purchaseChannels.some((row) => row.suppressed);
  return <div style={GRID}>
    <section data-testid="b5-daily-first-purchase-conversion" style={CARD}>
      <Header title="每日首购转化率（当日注册→当日首购）" meta={`近 8 日 · 目标 ${data.dailyFirstPurchaseTargetPct}%`} />
      <TrendChart values={daily.map((row) => row.conversionPct)} labels={daily.map((row) => row.date.slice(5))} threshold={data.dailyFirstPurchaseTargetPct} thresholdLabel={`目标 ${data.dailyFirstPurchaseTargetPct}%`} valueSuffix="%" ariaLabel={`当日注册用户的每日首购转化率曲线与 ${data.dailyFirstPurchaseTargetPct}% 目标线`} />
      {suppressedDaily.length > 0 ? <Notice>{suppressedDaily.map((row) => row.date.slice(5)).join("、")} · {SMALL_SAMPLE_LABEL}</Notice>
        : daily.every((row) => row.conversionPct === null) && <Notice>近 8 天没有新注册用户，暂无法计算转化率（目标 {data.dailyFirstPurchaseTargetPct}%）。</Notice>}
    </section>
    <section data-testid="b7-first-purchase-channel-share" style={CARD}>
      <Header title="首购渠道来源占比" meta="按用户注册来源统计" />
      {partialChannels ? <ul>{data.purchaseChannels.map((row) => <li key={row.channel}>
        {formatB3RefOption(row.channel)} · {row.suppressed ? SMALL_SAMPLE_LABEL : `${row.sharePct?.toFixed(1)}%`}
      </li>)}</ul> : data.purchaseChannels.length ? <Donut center="首购渠道" rows={data.purchaseChannels.flatMap((row, index) => row.sharePct == null ? [] : [{ label: formatB3RefOption(row.channel), value: row.sharePct, suffix: "%", color: COLORS[index % COLORS.length] }])} />
        : <Notice>当前筛选下没有首购用户，暂无法计算。</Notice>}
    </section>
    <section data-testid="b3-cohort-trend-chart" style={{ ...CARD, gridColumn: "1 / -1" }}><Header title="按注册周查看转化趋势" meta="当前转化步骤" />{data.trend.length ? <TrendChart values={data.trend.map((row) => row.cvrFromPrev)} labels={data.trend.map((row) => row.cohort.replace(/^\d{4}-/, ""))} valueSuffix="%" ariaLabel="按注册周查看转化率趋势" /> : <div data-testid="b3-cohort-trend-empty"><Notice>当前筛选下没有可比较的数据，暂无法显示趋势。</Notice></div>}</section>
  </div>;
}

export function B4RestoredInsights() {
  const history = useB4GrowthFlowHistory();
  if (!history.data) return <div style={GRID}><section data-testid="b3-growth-outflow-ratio" style={CARD}><Header title="新增 / 流出比趋势" meta="健康线 1.2" />{history.loading ? <Notice>正在加载…</Notice> : <Notice healthState="error">{`趋势暂不可用：${history.error ?? "响应为空"}`}</Notice>}</section><section data-testid="b6-monthly-budget-allocation" style={CARD}><Header title="本月运营预算分配" meta="拉新 / 团队奖励 / 创世节点 / 储备" /><Notice>预算数据未加载，暂不显示图表。</Notice></section></div>;
  const data = history.data;
  const latest = data.currentRatio;
  return <div style={GRID}>
    <section data-testid="b3-growth-outflow-ratio" style={CARD}><Header title="新增 / 流出比趋势" meta={`当前 ${latest === null ? "暂无法计算" : latest.toFixed(2)} · 健康线 ${data.healthyRatio}`} /><TrendChart values={data.ratioSeries.map((row) => row.ratio)} labels={data.ratioSeries.map((row) => row.label.slice(5))} threshold={data.healthyRatio} thresholdLabel={`健康线 ${data.healthyRatio}`} ariaLabel={`新增流出比趋势与 ${data.healthyRatio} 健康线`} /><div data-testid="b7-rhythm-engine-decision" style={{ borderLeft: `3px solid ${latest !== null && latest >= data.healthyRatio ? "var(--success)" : "var(--warning)"}`, paddingLeft: 10, fontSize: 13 }}><b>运营阶段建议：{data.suggestion}</b><div style={{ color: "var(--ink-3)", marginTop: 3 }}>{latest === null ? "本月流出分母为 0，不能用 0 或无限大替代真实比值。" : latest >= data.healthyRatio ? "高于健康线，可保持当前扩张节奏。" : "低于健康线，应进入收紧观察；这里只给建议，不自动执行。"}</div></div></section>
    <section data-testid="b6-monthly-budget-allocation" style={CARD}><Header title="本月运营预算分配" meta="拉新 / 团队奖励 / 创世节点 / 储备" />{data.budget.available ? <Donut center="本月预算" rows={data.budget.rows.map((row, index) => ({ label: operatorCopyText(row.label), value: row.sharePct, suffix: "%", color: COLORS[index % COLORS.length] }))} /> : <Notice>本月四类预算还没设置完整，暂不显示。</Notice>}</section>
  </div>;
}

export function B5RestoredInsights({ data, canAccessPath }: { data: B5Radar; canAccessPath: (path: string) => boolean }) {
  const pressure = data.pressureHistory.map((row) => row.ratio === null ? null : row.ratio * 100);
  const { latestPct: latest, previousComparablePct: previous } = summarizePressureHistory(
    data.pressureHistory,
    data.bankrun.pressureRatio,
  );
  return <div style={GRID}>
    <section data-testid="b1-withdraw-pressure-trend" style={CARD}><Header title="提现压力走势" meta={`近 8 个时段 · 当前 ${latest === null ? "暂无法计算" : `${latest.toFixed(1)}% · ${previous === null ? "无可比数据" : latest > previous ? "变差" : latest < previous ? "好转" : "持平"}`}`} /><TrendChart values={pressure} labels={data.pressureHistory.map((row) => row.label)} threshold={data.bankrun.pressureRedLine * 100} thresholdLabel={`${fmtConfigPct(data.bankrun.pressureRedLine * 100)} 红线`} valueSuffix="%" ariaLabel="出金压力近 8 窗口曲线与 70% 红线" />{pressure.some((value) => value === null) && <Notice>没有充值的时段无法计算，图中显示为断开。</Notice>}</section>
    <section data-testid="b4-alert-severity-distribution" style={CARD}><Header title="告警分布" meta="紧急 / 严重 / 警告 / 提示" /><Donut center="告警" rows={data.alertSeverity.map((row, index) => ({ label: ({ P0: "紧急", P1: "严重", P2: "警告", P3: "提示" } as Record<string,string>)[row.level] ?? "其他", value: row.count, color: COLORS[index] }))} /></section>
    <section data-testid="b4-alert-volume-history" style={{ ...CARD, gridColumn: "1 / -1" }}><Header title="近 7 天告警量" meta="按实际日期统计" /><Bars values={data.alertVolume.map((row) => row.count)} labels={data.alertVolume.map((row) => row.label)} /></section>
    <section data-testid="b5-recent-alert-feed" style={{ ...CARD, gridColumn: "1 / -1" }}><Header title="最近告警队列" meta="最近 20 条" />{data.recentAlerts.length ? <div style={{ display: "grid", gap: 8 }}>{data.recentAlerts.map((alert) => <div key={alert.signalNo} style={{ display: "grid", gridTemplateColumns: "42px minmax(160px, 1fr) auto auto", gap: 10, alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: 8, fontSize: 12.5 }}><b style={{ color: alert.level === "P0" ? "var(--danger)" : alert.level === "P1" ? "var(--warning)" : "var(--ink-3)" }}>{({ P0: "紧急", P1: "严重", P2: "警告", P3: "提示" } as Record<string,string>)[alert.level] ?? "其他"}</b><span>{alert.message} · 用户 #{alert.userId}</span><time style={{ color: "var(--ink-4)", fontSize: 11.5 }}>{alert.createdAt.replace("T", " ")}</time>{canAccessPath(alert.target) ? <a href={alert.target} style={{ color: "var(--cyan)", fontWeight: 650 }}>前往分类处理</a> : <span aria-disabled="true">目标域无权限</span>}</div>)}</div> : <Notice>近 7 天没有风险信号。</Notice>}<Notice>处理进度见本页「近期风险信号」。</Notice></section>
  </div>;
}
