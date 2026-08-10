"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import type { B2Dashboard } from "@/lib/admin/b2-client";
import type { B3Dashboard } from "@/lib/admin/b3-client";
import type { B5Radar } from "@/lib/admin/b5-client";
import { summarizePressureHistory } from "@/lib/admin/b5-pressure-summary";
import { useB2LiquidityHistory, useB4GrowthFlowHistory } from "@/lib/admin/b-restoration-client";

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
      {values.map((_, index) => <text key={index} x={padX + (index / Math.max(values.length - 1, 1)) * (width - padX * 2)} y={height - 10} textAnchor="middle" fill="var(--ink-4)" fontSize="10">{labels?.[index] ?? (index === values.length - 1 ? "当前" : `W-${values.length - 1 - index}`)}</text>)}
    </svg>
  );
}

function MaturityChart({ daily, cumulative }: { daily: Array<{ date: string; totalDueUsdt: number }>; cumulative: Array<{ date: string; amountUsdt: number }> }) {
  const width = 640;
  const height = 190;
  const padX = 36;
  const padTop = 22;
  const padBottom = 36;
  const chartHeight = height - padTop - padBottom;
  const maxDaily = Math.max(...daily.map((row) => row.totalDueUsdt), 1);
  const maxCumulative = Math.max(...cumulative.map((row) => row.amountUsdt), 1);
  const slot = (width - padX * 2) / Math.max(daily.length, 1);
  const cumulativePoints = cumulative.map((row, index) => ({
    x: padX + slot * index + slot / 2,
    y: padTop + chartHeight - row.amountUsdt / maxCumulative * chartHeight,
  }));
  const cumulativePath = cumulativePoints.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  return <div>
    <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--ink-3)", marginBottom: 4 }}><span><i style={{ display: "inline-block", width: 9, height: 9, marginRight: 5, background: "var(--admin-domain-b)" }} />每日到期（左轴）</span><span><i style={{ display: "inline-block", width: 14, borderTop: "3px solid var(--danger)", marginRight: 5, verticalAlign: "middle" }} />累计到期（右轴）</span></div>
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="每日预计兑付额柱状图与累计到期负债曲线" style={{ width: "100%", height: 205, overflow: "visible" }}>
      <line x1={padX} y1={height - padBottom} x2={width - padX} y2={height - padBottom} stroke="var(--border-strong)" />
      {daily.map((row, index) => {
        const barHeight = row.totalDueUsdt / maxDaily * chartHeight;
        const x = padX + slot * index + slot * 0.18;
        return <g key={row.date}><rect x={x} y={height - padBottom - barHeight} width={slot * 0.64} height={barHeight} rx="4" fill="var(--admin-domain-b)" /><text x={x + slot * 0.32} y={height - 12} textAnchor="middle" fill="var(--ink-4)" fontSize="10">{row.date.slice(5)}</text></g>;
      })}
      <path d={cumulativePath} fill="none" stroke="var(--danger)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      {cumulativePoints.map((point, index) => <circle key={cumulative[index].date} cx={point.x} cy={point.y} r="3.5" fill="var(--surface)" stroke="var(--danger)" strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
      <text x={padX} y={13} fill="var(--ink-4)" fontSize="10">每日峰值 {maxDaily.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDT</text>
      <text x={width - padX} y={13} textAnchor="end" fill="var(--danger)" fontSize="10">累计 {maxCumulative.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDT</text>
    </svg>
  </div>;
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

function FlowBars({ rows }: { rows: Array<{ label: string; inflowWan: number; outflowWan: number }> }) {
  const max = Math.max(...rows.flatMap((row) => [row.inflowWan, row.outflowWan]), 1);
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(${rows.length}, minmax(42px, 1fr))`, gap: 8, minHeight: 190 }}>{rows.map((row) => <div key={row.label} style={{ display: "grid", gridTemplateRows: "22px 132px 22px", textAlign: "center", fontSize: 10 }}><b style={{ whiteSpace: "nowrap" }}>+{row.inflowWan.toFixed(1)} / -{row.outflowWan.toFixed(1)}</b><div style={{ position: "relative" }}><i style={{ position: "absolute", left: 0, right: 0, top: "50%", borderTop: "1px solid var(--border-strong)" }} /><i data-zero={row.inflowWan === 0 ? "true" : "false"} style={{ position: "absolute", left: "12%", width: "34%", height: row.inflowWan === 0 ? 0 : Math.max(3, row.inflowWan / max * 60), bottom: "50%", background: "var(--success)", borderRadius: "4px 4px 0 0" }} /><i data-zero={row.outflowWan === 0 ? "true" : "false"} style={{ position: "absolute", right: "12%", width: "34%", height: row.outflowWan === 0 ? 0 : Math.max(3, row.outflowWan / max * 60), top: "50%", background: "var(--danger)", borderRadius: "0 0 4px 4px" }} /></div><span>{row.label}</span></div>)}</div>;
}

export function B2RestoredInsights({ data }: { data: B2Dashboard }) {
  const history = useB2LiquidityHistory();
  const liabilityRows = data.liabilities.breakdown.filter((row) => row.amountUsdt > 0);
  return <>
    <div style={GRID}>
      <section data-testid="b2-maturity-chart" style={CARD}><Header title={`未来 ${data.maturity.window === "7d" ? 7 : 30} 日到期负债图`} meta="每日到期柱 + 累计曲线 · USDT" /><MaturityChart daily={data.maturity.daily} cumulative={data.maturity.cumulative} /></section>
      <section data-testid="b2-liability-distribution" style={CARD}><Header title="应付负债构成" meta={`${data.liabilities.hardLiabilityCategoryCount} 类权威科目`} />{liabilityRows.length ? <Donut center="应付负债" rows={liabilityRows.map((row, index) => ({ label: row.label, value: row.share * 100, suffix: "%", color: COLORS[index % COLORS.length] }))} /> : <Notice>服务端当前没有非零负债科目；不绘制伪环图。</Notice>}</section>
    </div>
    <div style={GRID}>
      <section data-testid="b2-fund-flow-history" style={CARD}><Header title="近 8 个窗口资金流入 / 流出" meta="储备账本 · 万 USDT" />{history.data ? <FlowBars rows={history.data.flowWindows} /> : history.loading ? <Notice>正在读取服务端资金流窗口。</Notice> : <Notice healthState="error">{`资金流历史暂不可用：${history.error ?? "响应为空"}`}</Notice>}</section>
      <section data-testid="b2-monthly-inflow-history" style={CARD}><Header title="近 8 个月新增入金" meta="成功用户入金 · 万 USDT" />{history.data ? <Bars values={history.data.monthlyNewDeposits.map((row) => row.amountWan)} labels={history.data.monthlyNewDeposits.map((row) => row.label.slice(5))} /> : history.loading ? <Notice>正在读取服务端月新增入金。</Notice> : <Notice healthState="error">{`月新增入金暂不可用：${history.error ?? "响应为空"}`}</Notice>}</section>
    </div>
  </>;
}

export function B3RestoredInsights({ data }: { data: B3Dashboard }) {
  const daily = data.dailyFirstPurchase;
  return <div style={GRID}>
    <section data-testid="b5-daily-first-purchase-conversion" style={CARD}><Header title="每日首购转化率（当日注册→当日首购）" meta={`近 8 日 · 目标 ${data.dailyFirstPurchaseTargetPct}%`} /><TrendChart values={daily.map((row) => row.conversionPct)} labels={daily.map((row) => row.date.slice(5))} threshold={data.dailyFirstPurchaseTargetPct} thresholdLabel={`目标 ${data.dailyFirstPurchaseTargetPct}%`} valueSuffix="%" ariaLabel={`当日注册用户的每日首购转化率曲线与 ${data.dailyFirstPurchaseTargetPct}% 目标线`} />{daily.every((row) => row.conversionPct === null) && <Notice>近 8 日没有可计算的当日注册分母；保留每日坐标与 {data.dailyFirstPurchaseTargetPct}% 目标线，不用 0% 冒充转化率。</Notice>}</section>
    <section data-testid="b7-first-purchase-channel-share" style={CARD}><Header title="首购渠道来源占比" meta="按注册归因 ref · 同用户首购" />{data.purchaseChannels.length ? <Donut center="首购渠道" rows={data.purchaseChannels.map((row, index) => ({ label: row.channel, value: row.sharePct, suffix: "%", color: COLORS[index % COLORS.length] }))} /> : <Notice>当前筛选没有同用户首购事实，渠道占比不可计算。</Notice>}</section>
    <section data-testid="b3-cohort-trend-chart" style={{ ...CARD, gridColumn: "1 / -1" }}><Header title="周 cohort 转化趋势" meta="当前漏斗阶段" />{data.trend.length ? <TrendChart values={data.trend.map((row) => row.cvrFromPrev)} labels={data.trend.map((row) => row.cohort.replace(/^\d{4}-/, ""))} valueSuffix="%" ariaLabel="周 cohort 转化率趋势" /> : <div data-testid="b3-cohort-trend-empty"><Notice>当前筛选没有可比较的注册周 cohort，不绘制空曲线。</Notice></div>}</section>
  </div>;
}

export function B4RestoredInsights() {
  const history = useB4GrowthFlowHistory();
  if (!history.data) return <div style={GRID}><section data-testid="b3-growth-outflow-ratio" style={CARD}><Header title="新增 / 流出比趋势" meta="健康线 1.2" />{history.loading ? <Notice>正在读取服务端月度新增与流出事实。</Notice> : <Notice healthState="error">{`趋势暂不可用：${history.error ?? "响应为空"}`}</Notice>}</section><section data-testid="b6-monthly-budget-allocation" style={CARD}><Header title="本月运营预算分配" meta="拉新 / 返佣 / 创世 / 储备" /><Notice>预算权威源未加载，不展示伪环图。</Notice></section></div>;
  const data = history.data;
  const latest = data.currentRatio;
  return <div style={GRID}>
    <section data-testid="b3-growth-outflow-ratio" style={CARD}><Header title="新增 / 流出比趋势" meta={`当前 ${latest === null ? "不可计算" : latest.toFixed(2)} · 健康线 ${data.healthyRatio}`} /><TrendChart values={data.ratioSeries.map((row) => row.ratio)} labels={data.ratioSeries.map((row) => row.label.slice(5))} threshold={data.healthyRatio} thresholdLabel={`健康线 ${data.healthyRatio}`} ariaLabel={`新增流出比趋势与 ${data.healthyRatio} 健康线`} /><div data-testid="b7-rhythm-engine-decision" style={{ borderLeft: `3px solid ${latest !== null && latest >= data.healthyRatio ? "var(--success)" : "var(--warning)"}`, paddingLeft: 10, fontSize: 13 }}><b>节奏引擎判定：{data.suggestion}</b><div style={{ color: "var(--ink-3)", marginTop: 3 }}>{latest === null ? "本月流出分母为 0，不能用 0 或无限大替代真实比值。" : latest >= data.healthyRatio ? "高于健康线，可保持当前扩张节奏。" : "低于健康线，应进入收紧观察；这里只给建议，不自动执行。"}</div></div></section>
    <section data-testid="b6-monthly-budget-allocation" style={CARD}><Header title="本月运营预算分配" meta="拉新 / 返佣 / 创世 / 储备" />{data.budget.available ? <Donut center="本月预算" rows={data.budget.rows.map((row, index) => ({ label: row.label, value: row.sharePct, suffix: "%", color: COLORS[index % COLORS.length] }))} /> : <Notice>四类本月运营预算尚未配置完整，已保留渲染位并停止把其他财务科目冒充预算。</Notice>}</section>
  </div>;
}

export function B5RestoredInsights({ data, canAccessPath }: { data: B5Radar; canAccessPath: (path: string) => boolean }) {
  const pressure = data.pressureHistory.map((row) => row.ratio === null ? null : row.ratio * 100);
  const { latestPct: latest, previousComparablePct: previous } = summarizePressureHistory(
    data.pressureHistory,
    data.bankrun.pressureRatio,
  );
  return <div style={GRID}>
    <section data-testid="b1-withdraw-pressure-trend" style={CARD}><Header title="出金压力走势图" meta={`近 8 窗口 · 当前 ${latest === null ? "不可计算" : `${latest.toFixed(1)}% · ${previous === null ? "无可比窗口" : latest > previous ? "恶化" : latest < previous ? "好转" : "持平"}`}`} /><TrendChart values={pressure} labels={data.pressureHistory.map((row) => row.label)} threshold={data.bankrun.pressureRedLine * 100} thresholdLabel={`${data.bankrun.pressureRedLine * 100}% 红线`} valueSuffix="%" ariaLabel="出金压力近 8 窗口曲线与 70% 红线" />{pressure.some((value) => value === null) && <Notice>入金分母为 0 的窗口显示为断点，分母为 0，不可计算；不会用 0% 或 100% 冒充真实压力。</Notice>}</section>
    <section data-testid="b4-alert-severity-distribution" style={CARD}><Header title="告警分布" meta="服务端风险信号 · P0–P3" /><Donut center="告警" rows={data.alertSeverity.map((row, index) => ({ label: row.level, value: row.count, color: COLORS[index] }))} /></section>
    <section data-testid="b4-alert-volume-history" style={{ ...CARD, gridColumn: "1 / -1" }}><Header title="近 7 天告警量" meta="服务端日期标签 · 不做本地补零" /><Bars values={data.alertVolume.map((row) => row.count)} labels={data.alertVolume.map((row) => row.label)} /></section>
    <section data-testid="b5-recent-alert-feed" style={{ ...CARD, gridColumn: "1 / -1" }}><Header title="最近告警队列" meta="最多 20 条 · 服务端风险信号" />{data.recentAlerts.length ? <div style={{ display: "grid", gap: 8 }}>{data.recentAlerts.map((alert) => <div key={alert.signalNo} style={{ display: "grid", gridTemplateColumns: "42px minmax(160px, 1fr) auto auto", gap: 10, alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: 8, fontSize: 12.5 }}><b style={{ color: alert.level === "P0" ? "var(--danger)" : alert.level === "P1" ? "var(--warning)" : "var(--ink-3)" }}>{alert.level}</b><span>{alert.message} · 用户 #{alert.userId}</span><time style={{ color: "var(--ink-4)", fontSize: 11.5 }}>{alert.createdAt.replace("T", " ")}</time>{canAccessPath(alert.target) ? <a href={alert.target} style={{ color: "var(--cyan)", fontWeight: 650 }}>前往分诊</a> : <span aria-disabled="true">目标域无权限</span>}</div>)}</div> : <Notice>近 7 天没有风险信号。</Notice>}<Notice>当前风险信号表尚未提供“已处理 / 未处理”状态，页面保留队列与分诊入口，但不会把全部历史信号冒充未处理。</Notice></section>
  </div>;
}
