"use client";

/**
 * B4 节奏状态(总览驾驶舱 · 只读)。
 * UI 严格对齐设计稿 project/「B4 节奏状态.html」:
 *   HERO  阶段指标条(4)+ 节奏阶段路线图(P1→P6 强度柱 + stepper + 当前进度徽标;当前态随节奏单源流转)
 *   ROW2  近 8 月月新增入金柱 + 本月运营预算分配环图
 *   STRIP 新增 / 流出比趋势(大数 + 面积折线 + 健康线 1.2 + 逐点标值)
 * 顶部域标 / 导航 / 实时态由 console 外壳 + 全局顶栏承载(BPageHeader 已省略设计稿 .b-nav / .b-live)。
 * 当前阶段、月新增入金、预算分配和新增 / 流出比均从 /api/admin/treasury/b-domain 读取。
 * B4 配置缺失时由后端写入 MySQL 种子再读出。
 * 本页为只读展示;阶段切换 / 节奏骨架调整跳 H1 Phase 调度器(controlLink → /growth/phase)。
 */
import "../b-domain.css";
import "./rhythm.css";
import { useId } from "react";
import { Activity, BarChart3, PieChart, TrendingUp } from "lucide-react";
import { BPageHeader } from "../b-page-header";
import { useBDomainDashboard } from "@/lib/admin/b-client";
import { BDomainDataState, BDomainWarnings } from "@/app/components/dashboard/b-domain-state";

const r1 = (n: number) => Math.round(n * 10) / 10;

type PhaseState = "done" | "cur" | "next";

export default function RhythmPage() {
  const gradId = useId().replace(/:/g, ""); // SVG gradient id 唯一化(与 B5 一致,防组件化后碰撞)
  const bDomain = useBDomainDashboard();
  const { ledger: LEDGER, rhythm } = bDomain;
  if ((bDomain.loading && !bDomain.hasData) || bDomain.error || !bDomain.hasData) {
    return (
      <div className="dkpage bpage rhythmpage">
        <BPageHeader
          id="B4"
          title="节奏状态"
          desc="读取 B 域真实节奏状态、H1 阶段、入金、预算和新增 / 流出比。"
          ctaLabel="调 Phase dial"
          ctaHref="/growth/phase"
        />
        <BDomainDataState title="B4 节奏状态" loading={bDomain.loading && !bDomain.error} error={bDomain.error} onRetry={bDomain.reload} />
      </div>
    );
  }
  const rs = rhythm.h1;
  if (!rs.currentPhase || !rhythm.phaseNodes.length || !rhythm.inflowWan.length || !rhythm.budget.length || rhythm.ratio.length < 2) {
    return (
      <div className="dkpage bpage rhythmpage">
        <BPageHeader
          id="B4"
          title="节奏状态"
          desc="B4 需要 H1 当前阶段、阶段节点、入金、预算和新增 / 流出比序列。"
          ctaLabel="调 Phase dial"
          ctaHref="/growth/phase"
        />
        <BDomainWarnings warnings={bDomain.warnings} />
        <BDomainDataState title="B4 节奏状态" error="B4_REQUIRED_DATA_EMPTY" onRetry={bDomain.reload} />
      </div>
    );
  }
  const PHASE_NODES = rhythm.phaseNodes;
  const PHASE_INTENSITY = PHASE_NODES.map((phase) => phase.intensity);
  const MAX_I = Math.max(...PHASE_INTENSITY, 1);
  const INFLOW = rhythm.inflowWan;
  const MAX_IN = Math.max(...INFLOW, 1);
  const currentInflow = INFLOW[INFLOW.length - 1] ?? 0;
  const prevInflow = INFLOW[INFLOW.length - 2] ?? currentInflow;
  const inflowDeltaPct = prevInflow ? r1(((currentInflow - prevInflow) / prevInflow) * 100) : 0;
  const BUDGET = rhythm.budget;
  let budgetAcc = 0;
  const conicStops = BUDGET.map((b) => {
    const seg = `var(${b.varName}) ${budgetAcc}% ${budgetAcc + b.pc}%`;
    budgetAcc += b.pc;
    return seg;
  }).join(", ");
  const budgetBg = conicStops ? `conic-gradient(${conicStops})` : "var(--surface-3)";
  const RATIO = rhythm.ratio;
  const latestRatio = RATIO[RATIO.length - 1] ?? 0;
  const prevRatio = RATIO[RATIO.length - 2] ?? latestRatio;
  const ratioChart = (() => {
    const W = 1100;
    const H = 130;
    const n = RATIO.length;
    const pad = 8;
    const health = rhythm.healthyRatio;
    const min = Math.min(1.1, health, ...RATIO) - 0.05;
    const max = Math.max(1.7, health, ...RATIO) + 0.05;
    const rng = max - min || 1;
    const y = (v: number) => r1(H - 12 - ((v - min) / rng) * (H - 28));
    const denom = Math.max(n - 1, 1);
    const pts = RATIO.map((v, i) => [r1((i / denom) * (W - 2 * pad) + pad), y(v)] as const);
    const line = pts.map((pt, i) => `${i ? "L" : "M"}${pt[0]} ${pt[1]}`).join(" ");
    const area = `${line} L${pts[n - 1][0]} ${H} L${pts[0][0]} ${H} Z`;
    const hy = y(health);
    return { W, H, n, pts, line, area, hy };
  })();
  const phaseLabel = `${rs.currentPhase} ${rs.currentPhaseName}期`;
  const curIdx = Math.max(0, PHASE_NODES.findIndex((n) => n.code === rs.currentPhase));
  const curProg = rs.phaseProgressPct / 100;
  // 进度填充百分比:已走完节点 + 当前段内进度(节点等距分布于 0..100)。
  const fillPct = Math.min(100, r1(((curIdx + curProg) / Math.max(PHASE_NODES.length - 1, 1)) * 100)); // 末阶段(P6)进度>0 时封顶 100%,防进度条/徽标越界
  const phases = PHASE_NODES.map((n, i) => ({
    p: n.code,
    nm: n.name,
    intensity: n.intensity,
    state: (i < curIdx ? "done" : i === curIdx ? "cur" : "next") as PhaseState,
  }));
  return (
    <div className="dkpage bpage rhythmpage">
      <BPageHeader
        id="B4"
        title="节奏状态"
        desc={
          <>
            {rs.totalMonths} 个月运营节奏(<b>P1 拉新 → P6 软收场</b>)现在走到哪个阶段、进度多少,以及几个关键节奏指标。给决策层判断该扩张还是该收紧用,和 <b>F 域参数中枢</b>联动(本页只读)。
          </>
        }
        ctaLabel="调 Phase dial"
        ctaHref="/growth/phase"
      />
      <BDomainWarnings warnings={bDomain.warnings} />

      {/* ===== HERO:阶段指标 + 节奏路线图 ===== */}
      <section className="card" style={{ padding: "22px 24px 26px" }}>
        <div className="phase-metrics">
          <div className="pm">
            <div className="k">
              当前阶段
              <span className="help" data-tip={`${rs.totalMonths} 月运营节奏共 6 个 Phase,当前处于 ${phaseLabel}(第 ${rs.currentMonth} 个月)。`}>?</span>
            </div>
            <div className="v" style={{ color: "var(--brand)" }}>{phaseLabel}</div>
            <div className="d">第 {rs.currentMonth} / {rs.totalMonths} 月</div>
          </div>
          <div className="pm">
            <div className="k">阶段进度</div>
            <div className="v">{rs.phaseProgressPct}<small>%</small></div>
            <div className="d">{rs.currentPhase} 已进行</div>
          </div>
          <div className="pm">
            <div className="k">
              新增 / 流出比
              <span className="help" data-tip="新增入金 ÷ 资金流出。≥ 1.2 视为扩张健康。">?</span>
            </div>
            <div className="v">{latestRatio.toFixed(2)}</div>
            <div className="d" style={{ color: latestRatio >= prevRatio ? "var(--success)" : "var(--negative)" }}>
              {latestRatio >= prevRatio ? "↗" : "↘"} 上窗 {prevRatio.toFixed(2)} · 健康 ≥ {rhythm.healthyRatio}
            </div>
          </div>
          <div className="pm">
            <div className="k">节奏引擎建议</div>
            <div className="v" style={{ color: latestRatio >= rhythm.healthyRatio ? "var(--success)" : "var(--warning)" }}>{rhythm.suggestion}</div>
            <div className="d">{latestRatio >= rhythm.healthyRatio ? "暂不收紧" : "进入收紧观察"}</div>
          </div>
        </div>

        <div className="roadmap">
          <div className="rm-line">
            <div className="rm-fill" style={{ width: `${fillPct}%` }} />
          </div>
          <div className="cur-badge" style={{ left: `calc(10px + (100% - 20px) * ${fillPct / 100})` }}>
            进行 {rs.phaseProgressPct}%
          </div>
          <div className="rm-cols">
            {phases.map((ph) => (
              <div key={ph.p} className={`rm-col${ph.state === "done" ? " done" : ph.state === "cur" ? " cur" : ""}`}>
                <div className="rm-int">
                  <div className="ib" style={{ height: `${r1((ph.intensity / MAX_I) * 88)}px` }}>
                    <span className="iv">{ph.intensity}</span>
                  </div>
                </div>
                <div className="rm-node" />
                <div className="rm-lbl">
                  <div className="p">{ph.p}</div>
                  <div className="nm">{ph.nm}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== ROW2:月新增入金柱 + 预算环图 ===== */}
      <div className="b4-row2">
        <section className="card">
          <div className="ttl-row">
            <span className="ic"><BarChart3 size={16} /></span>
            <span className="h">近 {INFLOW.length} 月月新增入金</span>
            <span className="sub">万 USDT · M1–M{Math.max(INFLOW.length - 1, 1)} + 本月</span>
            <div className="r"><span className="b-tag">本月 {currentInflow} 万 · 环比 {inflowDeltaPct >= 0 ? "+" : ""}{inflowDeltaPct}%</span></div>
          </div>
          <div className="inflow-row">
            {INFLOW.map((v, i) => (
              <div key={`m${i + 1}`} className={`inflow-col${i === INFLOW.length - 1 ? " last" : ""}`}>
                <div className="v">{v}万</div>
                <div className="bk" style={{ height: `${r1((v / MAX_IN) * 130)}px` }} />
                <div className="lbl">M{i + 1}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="ttl-row">
            <span className="ic"><PieChart size={16} /></span>
            <span className="h">本月运营预算分配</span>
            <span className="sub">{phaseLabel}投放结构</span>
          </div>
          <div className="donut-wrap">
            <div className="donut" style={{ width: 140, height: 140, background: budgetBg }}>
              <div className="hole">
                <div>
                  <div className="big">100<small style={{ fontSize: 11 }}>%</small></div>
                  <div className="sm">本月预算</div>
                </div>
              </div>
            </div>
            <div className="legend" style={{ flex: 1 }}>
              {BUDGET.map((b) => (
                <div key={b.nm} className="lg">
                  <span className="d" style={{ background: `var(${b.varName})` }} />
                  <span className="nm">{b.nm}</span>
                  <span className="pc">{b.pc}%</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* ===== STRIP:新增 / 流出比趋势 ===== */}
      <section className="card ratio-strip">
        <div className="ratio-big">
          <div className="k">
            <Activity size={14} style={{ color: "var(--ink-3)" }} />
            新增 / 流出比趋势
            <span className="help" data-tip={`近 8 窗口新增 / 流出比走势,扩张健康线 ${rhythm.healthyRatio}。跌破即触发收紧建议。`}>?</span>
          </div>
          <div className="v">{latestRatio.toFixed(2)}</div>
          <div className="d">{latestRatio >= prevRatio ? "↗" : "↘"} 较上窗 {prevRatio.toFixed(2)}</div>
          <div className="hl">扩张健康线 {rhythm.healthyRatio} · {latestRatio >= rhythm.healthyRatio ? "仍在健康区" : "低于健康线"}</div>
        </div>
        <div>
          <svg className="ratio-svg" viewBox={`0 0 ${ratioChart.W} ${ratioChart.H}`} preserveAspectRatio="none" aria-hidden>
            <defs>
              <linearGradient id={`${gradId}-ratio`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--brand)" stopOpacity="0.30" />
                <stop offset="1" stopColor="var(--brand)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={ratioChart.area} fill={`url(#${gradId}-ratio)`} />
            <line
              x1="0"
              y1={ratioChart.hy}
              x2={ratioChart.W}
              y2={ratioChart.hy}
              stroke="var(--brand-2)"
              strokeWidth="1.5"
              strokeDasharray="7 6"
              vectorEffect="non-scaling-stroke"
            />
            <text x="6" y={r1(ratioChart.hy - 7)} fill="var(--brand-2)" fontSize="12" fontFamily="var(--font-jet-mono), monospace">
              健康线 {rhythm.healthyRatio}
            </text>
            <path
              d={ratioChart.line}
              fill="none"
              stroke="var(--brand)"
              strokeWidth="2.4"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {ratioChart.pts.map((pt, i) => {
              const anchor = i === 0 ? "start" : i === ratioChart.n - 1 ? "end" : "middle";
              const tx = i === 0 ? pt[0] + 1 : i === ratioChart.n - 1 ? pt[0] - 1 : pt[0];
              return (
                <g key={`pt${i}`}>
                  <circle cx={pt[0]} cy={pt[1]} r="3.2" fill="var(--bg)" stroke="var(--brand)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                  <text
                    x={tx}
                    y={r1(pt[1] - 9)}
                    fill="var(--ink-2)"
                    fontSize="11.5"
                    fontFamily="var(--font-jet-mono), monospace"
                    textAnchor={anchor}
                  >
                    {RATIO[i].toFixed(2)}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="cohort-axis">
            {RATIO.map((_, i) => (
              <span key={`w${i + 1}`}>W{i + 1}</span>
            ))}
          </div>
        </div>
      </section>

      <p className="b-foot">
        当前处于 <b>{phaseLabel}</b>(第 {rs.currentMonth}/{rs.totalMonths} 月,阶段进度 {rs.phaseProgressPct}%),新增 / 流出比 {latestRatio.toFixed(2)}{latestRatio >= rhythm.healthyRatio ? " 高于" : " 低于"}扩张健康线 {rhythm.healthyRatio}。节奏引擎建议 {rhythm.suggestion},并在覆盖率触红线 {LEDGER.redlinePct}% 时切入收紧。阶段切换需 F1 参数中枢 + 决策层确认。
      </p>
    </div>
  );
}
