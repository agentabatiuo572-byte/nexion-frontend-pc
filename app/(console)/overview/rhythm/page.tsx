"use client";

/**
 * B4 节奏状态(总览驾驶舱 · 只读)。
 * UI 严格对齐设计稿 project/「B4 节奏状态.html」:
 *   HERO  阶段指标条(4)+ 12 月节奏阶段路线图(P1→P6 强度柱 + stepper + 当前进度徽标)
 *   ROW2  近 8 月月新增入金柱 + 本月运营预算分配环图
 *   STRIP 新增 / 流出比趋势(大数 + 面积折线 + 健康线 1.2 + 逐点标值)
 * 顶部域标 / 导航 / 实时态由 console 外壳 + 全局顶栏承载(BPageHeader 已省略设计稿 .b-nav / .b-live)。
 * 数据 mock(确定性),与注册表 lib/admin/registry/b.ts 的 /overview/rhythm 口径一致。
 * 本页为只读展示;阶段切换 / 参数调整跳 F 域 Phase dial(controlLink → /growth/phase)。
 */
import "../b-domain.css";
import "./rhythm.css";
import { useId } from "react";
import { Activity, BarChart3, PieChart, TrendingUp } from "lucide-react";
import { BPageHeader } from "../b-page-header";
import { LEDGER } from "@/lib/mock/admin/ledger";

const r1 = (n: number) => Math.round(n * 10) / 10;

// ---- 12 月节奏阶段(强度指数 + 状态)。当前 P3 扩张期,阶段进度 58%。 ----
type PhaseState = "done" | "cur" | "next";
const PHASES: { p: string; nm: string; intensity: number; state: PhaseState }[] = [
  { p: "P1", nm: "拉新启动", intensity: 55, state: "done" },
  { p: "P2", nm: "渗透", intensity: 78, state: "done" },
  { p: "P3", nm: "扩张", intensity: 92, state: "cur" },
  { p: "P4", nm: "成熟", intensity: 70, state: "next" },
  { p: "P5", nm: "收紧", intensity: 40, state: "next" },
  { p: "P6", nm: "软退场", intensity: 18, state: "next" },
];
const CUR_IDX = 2; // P3
const CUR_PROG = 0.58; // 本阶段已进行 58%
const MAX_I = Math.max(...PHASES.map((p) => p.intensity));
// 进度填充百分比:已走完 P1→P3 节点 + P3→P4 段的 58%(节点等距分布于 0..100)。
const FILL_PCT = r1(((CUR_IDX + CUR_PROG) / (PHASES.length - 1)) * 100);

// ---- 近 8 月月新增入金(万 USDT),末月为本月(brand 强调)。 ----
const INFLOW = [62, 84, 118, 142, 168, 190, 205, 198];
const MAX_IN = Math.max(...INFLOW);

// ---- 本月运营预算分配(P3 扩张期投放结构)。颜色取注册表 category token。 ----
const BUDGET: { nm: string; pc: number; varName: string }[] = [
  { nm: "拉新激励 / 试用补贴", pc: 38, varName: "--admin-cat-1" },
  { nm: "推荐返佣", pc: 27, varName: "--admin-cat-7" },
  { nm: "Genesis 分红池注入", pc: 20, varName: "--admin-cat-4" },
  { nm: "运营储备金", pc: 15, varName: "--admin-cat-8" },
];
// conic-gradient 段:累加百分比拼接。
const conicStops = (() => {
  let acc = 0;
  return BUDGET.map((b) => {
    const seg = `var(${b.varName}) ${acc}% ${acc + b.pc}%`;
    acc += b.pc;
    return seg;
  }).join(", ");
})();

// ---- 新增 / 流出比趋势(近 8 月),扩张健康线 1.2。 ----
const RATIO = [1.62, 1.58, 1.55, 1.53, 1.51, 1.49, 1.45, 1.42];

// 趋势 SVG 几何(端口自设计稿 <script>,确定性计算 → 内联,免水合差异)。
const ratioChart = (() => {
  const W = 1100;
  const H = 130;
  const n = RATIO.length;
  const pad = 8;
  const health = 1.2;
  const min = 1.1;
  const max = 1.7;
  const rng = max - min;
  const y = (v: number) => r1(H - 12 - ((v - min) / rng) * (H - 28));
  const pts = RATIO.map((v, i) => [r1((i / (n - 1)) * (W - 2 * pad) + pad), y(v)] as const);
  const line = pts.map((pt, i) => `${i ? "L" : "M"}${pt[0]} ${pt[1]}`).join(" ");
  const area = `${line} L${pts[n - 1][0]} ${H} L${pts[0][0]} ${H} Z`;
  const hy = y(health);
  return { W, H, n, pts, line, area, hy };
})();

export default function RhythmPage() {
  const gradId = useId().replace(/:/g, ""); // SVG gradient id 唯一化(与 B5 一致,防组件化后碰撞)
  return (
    <div className="dkpage bpage rhythmpage">
      <BPageHeader
        id="B4"
        title="节奏状态"
        desc={
          <>
            12 月运营节奏 <b>P1 拉新 → P6 软退场</b> 的当前阶段、阶段进度与关键节奏仪表。供决策层判断扩张 / 收紧时机,与 <b>F 域参数中枢</b>联动(只读展示)。
          </>
        }
        ctaLabel="调 Phase dial"
        ctaHref="/growth/phase"
      />

      {/* ===== HERO:阶段指标 + 节奏路线图 ===== */}
      <section className="card" style={{ padding: "22px 24px 26px" }}>
        <div className="phase-metrics">
          <div className="pm">
            <div className="k">
              当前阶段
              <span className="help" data-tip="12 月运营节奏共 6 个 Phase,当前处于 P3 扩张期(第 7 个月)。">?</span>
            </div>
            <div className="v" style={{ color: "var(--brand)" }}>P3 扩张期</div>
            <div className="d">第 7 / 12 月</div>
          </div>
          <div className="pm">
            <div className="k">阶段进度</div>
            <div className="v">58<small>%</small></div>
            <div className="d">P3 已进行</div>
          </div>
          <div className="pm">
            <div className="k">
              新增 / 流出比
              <span className="help" data-tip="新增入金 ÷ 资金流出。≥ 1.2 视为扩张健康。">?</span>
            </div>
            <div className="v">1.42</div>
            <div className="d" style={{ color: "var(--negative)" }}>↘ 上窗 1.51 · 健康 ≥ 1.2</div>
          </div>
          <div className="pm">
            <div className="k">节奏引擎建议</div>
            <div className="v" style={{ color: "var(--success)" }}>维持扩张</div>
            <div className="d">暂不收紧</div>
          </div>
        </div>

        <div className="roadmap">
          <div className="rm-line">
            <div className="rm-fill" style={{ width: `${FILL_PCT}%` }} />
          </div>
          <div className="cur-badge" style={{ left: `calc(10px + (100% - 20px) * ${FILL_PCT / 100})` }}>
            进行 58%
          </div>
          <div className="rm-cols">
            {PHASES.map((ph) => (
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
            <span className="h">近 8 月月新增入金</span>
            <span className="sub">万 USDT · M1–M7 + 本月</span>
            <div className="r"><span className="b-tag">本月 198 万 · 环比 −3.4%</span></div>
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
            <span className="sub">P3 扩张期投放结构</span>
          </div>
          <div className="donut-wrap">
            <div className="donut" style={{ width: 140, height: 140, background: `conic-gradient(${conicStops})` }}>
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
            <span className="help" data-tip="近 8 窗口新增 / 流出比走势,扩张健康线 1.2。跌破即触发收紧建议。">?</span>
          </div>
          <div className="v">1.42</div>
          <div className="d">↘ 较上窗 1.51 回落</div>
          <div className="hl">扩张健康线 1.2 · 仍在健康区</div>
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
              健康线 1.2
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
        当前处于 <b>P3 扩张期</b>(第 7/12 月,阶段进度 58%),新增 / 流出比 1.42 仍高于扩张健康线 1.2 但较上窗 1.51 回落。节奏引擎建议维持放量,并在比率跌破 1.2 或覆盖率触红线 {LEDGER.redlinePct}% 时切入 <b>P5 收紧</b>。阶段切换需 F1 参数中枢 + 决策层确认。
      </p>
    </div>
  );
}
