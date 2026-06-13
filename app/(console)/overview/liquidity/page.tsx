"use client";

/**
 * B2 资金池水位(只读 · 总览驾驶舱)。
 * UI 严格对齐设计稿 project/「B2 资金池水位.html」:
 *   HERO   兑付覆盖率 + 储备/盈余 水位条 meter + 24h 净流
 *   MAIN   未来 7 日到期兑付预测(柱图 + 累计虚线 + 峰值高亮) | 应付负债构成(8 科目环图)
 *   FLOW   近 8 窗口净流入 / 流出(发散柱)
 * 顶部域标 / 标题 / 控制入口复用 BPageHeader(去设计稿 B1-B5 分段导航与 server-canonical pill)。
 * 数据 mock(确定性):数值与 registry lib/admin/registry/b.ts 的 /overview/liquidity 对齐
 * (储备 $6.34M / 应付 $5.37M / 覆盖率 118.1% 绿区 / 红线 100% / 健康 110% / 24h 净流入 +$0.12M · 派生自 LEDGER 单源)。
 * 设计稿的 3 段 <script>(donut conic-gradient / runway 累计虚线 / flow 发散柱)在此用 React 计算。
 */
import "../b-domain.css";
import "./liquidity.css";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { CalendarClock, PieChart, ArrowDownUp, ShieldCheck } from "lucide-react";
import { BPageHeader } from "../b-page-header";

// ---- 应付负债 8 科目(合计 537 万 · 与 registry b.ts donut segments 同序同占比)----
// 颜色按 registry 位置映射到 --admin-cat-N(同一组 8 科目色板,双主题安全)。
const LIAB: { nm: string; pc: number; cat: string }[] = [
  { nm: "USDT 质押本金", pc: 30.5, cat: "--admin-cat-2" },
  { nm: "可提余额", pc: 22.0, cat: "--admin-cat-1" },
  { nm: "NEX v2 未来兑付", pc: 16.4, cat: "--admin-cat-5" },
  { nm: "待提现队列", pc: 8.0, cat: "--admin-cat-6" },
  { nm: "佣金冷却未解锁", pc: 7.6, cat: "--admin-cat-7" },
  { nm: "质押应付利息", pc: 5.8, cat: "--admin-cat-3" },
  { nm: "Genesis 日分红承诺", pc: 5.0, cat: "--admin-cat-4" },
  { nm: "锁仓本息 / 其他", pc: 4.7, cat: "--admin-cat-8" },
];

// ---- 未来 7 日到期兑付(万 USDT)----
const RW = [38, 52, 47, 61, 55, 73, 49];
const RW_TOTAL = 375; // 7 日累计到期(设计稿口径)
const RW_BAR_H = 150; // 柱区最大像素高

// ---- 近 8 窗口净流入 / 流出(万 USDT)----
const FLOW = [4, 6, 8, 9, 10, 11, 11, 12];
const FLOW_BAR_H = 60; // 半轴最大像素高

export default function LiquidityPage() {
  // 环图:由占比累计算 conic-gradient 色标(每段 起% 止%)。
  let acc = 0;
  const donutStops = LIAB.map((l) => {
    const seg = `var(${l.cat}) ${acc.toFixed(2)}% ${(acc + l.pc).toFixed(2)}%`;
    acc += l.pc;
    return seg;
  }).join(", ");
  const donutBg = `conic-gradient(${donutStops})`;

  // runway:柱高按峰值归一;累计虚线点位(x 居中、y 自累计占 RW_TOTAL 的比例反推)。
  const maxR = Math.max(...RW);
  let cum = 0;
  const cumPts = RW.map((v, i) => {
    cum += v;
    const x = ((i + 0.5) / RW.length) * 100;
    const y = 100 - (cum / RW_TOTAL) * 70 - 8;
    return [x, y] as const;
  });
  const cumPath = cumPts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  // 峰值(D+6 = 73 万)以柱身 brand-2 高亮 + 发光标识(对齐设计稿,无额外浮标)。

  // flow:发散柱(正=净流入向上、负=流出向下),半轴按 |最大| 归一。
  const maxF = Math.max(...FLOW.map(Math.abs));

  // 覆盖率水位:派生自 LEDGER 单源(与 D3 / B 驾驶舱一致)。0–120% 标尺,红线/健康线按阈值定位。
  const cov = LEDGER.coverageRatio; // 118.1
  const reserveM = (LEDGER.reserveUsd / 1e6).toFixed(2); // 5.64
  const liabM = (LEDGER.liabilitiesUsd / 1e6).toFixed(2); // 5.37
  const netRaw = LEDGER.reserveUsd - LEDGER.liabilitiesUsd; // +270000
  const netM = (Math.abs(netRaw) / 1e6).toFixed(2); // 0.27
  const isSurplus = netRaw >= 0;
  const COV_SCALE = 120; // 水位条满标 = 1.2× 应付,给健康线 110% 留头寸
  const resW = ((Math.min(cov, COV_SCALE) / COV_SCALE) * 100).toFixed(1); // 87.5
  const redL = ((LEDGER.redlinePct / COV_SCALE) * 100).toFixed(1); // 83.3
  const healthL = ((LEDGER.healthyPct / COV_SCALE) * 100).toFixed(1); // 91.7

  return (
    <div className="dkpage bpage liqpage">
      <BPageHeader
        id="B2"
        title="资金池水位"
        desc={
          <>
            真实储备 vs 8 科目应付负债的实时水位与到期分布。覆盖率为 <b>B5 风险雷达</b>与 <b>J 域 Kill-Switch</b> 的核心入参。
          </>
        }
        ctaLabel="调资金 / 提现参数"
        ctaHref="/finance/params"
      />

      {/* HERO: 覆盖率 + 水位条 + 24h 净流出 */}
      <section className="card liq-hero">
        <div className="liq-cov">
          <div className="k">
            兑付覆盖率{" "}
            <span className="help" data-tip={`兑付覆盖率 = 可用储备 ÷ 应付负债。跌破健康线 ${LEDGER.healthyPct}% 进入黄区警戒、跌破红线 ${LEDGER.redlinePct}% 触发流出收紧。`}>?</span>
          </div>
          <div className="v">
            {cov.toFixed(1)}<small>%</small>
          </div>
          <div className="d">↘ 1.1pt / 窗口</div>
        </div>

        <div className="liq-meter">
          <div className="mhead">
            <div className="l">
              可用储备 <b>${reserveM}M</b>
            </div>
            <div className="r">
              应付负债 <b>${liabM}M</b>
            </div>
          </div>
          <div className="liq-bar">
            <div className="res" style={{ width: `${resW}%` }}>
              <span>储备 {cov.toFixed(1)}%</span>
            </div>
            <div
              className="gap"
              style={isSurplus ? { background: "var(--surface-3)", borderLeft: "2px solid var(--success)" } : undefined}
            >
              <span style={isSurplus ? { color: "var(--success)" } : undefined}>
                {isSurplus ? `盈余 $${netM}M` : `缺口 $${netM}M`}
              </span>
            </div>
            <div className="redline" style={{ left: `${redL}%` }} title={`红线 ${LEDGER.redlinePct}%`} />
            <div className="redline" style={{ left: `${healthL}%`, opacity: 0.3 }} title={`健康 ${LEDGER.healthyPct}%`} />
          </div>
          <div className="liq-scale">
            <span>0</span>
            <span>红线 {LEDGER.redlinePct}%</span>
            <span>健康 {LEDGER.healthyPct}% · 满 120%</span>
          </div>
        </div>

        <div className="liq-out">
          <div className="k">
            24h 净流入{" "}
            <span className="help" data-tip="近 24 小时资金净流(流入 − 流出)。正值=扩张期储备累积,m7 毛流入 ≫ payout。">?</span>
          </div>
          <div className="v">+$0.12M</div>
          <div className="d">↗ 流入扩张</div>
        </div>
      </section>

      {/* MAIN: runway + donut */}
      <div className="b2-main">
        {/* runway */}
        <section className="card runway">
          <div className="ttl-row">
            <span className="ic">
              <CalendarClock size={16} />
            </span>
            <span className="h">未来 7 日到期兑付预测</span>
            <span className="sub">需准备的可兑付头寸 · 万 USDT</span>
            <div className="r">
              <span className="b-tag">到期 = 提现冷却 + 利息 + 分红</span>
            </div>
          </div>
          <div className="rwrap">
            <svg className="cum" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              <path
                d={cumPath}
                fill="none"
                stroke="var(--cyan)"
                strokeWidth={1.4}
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
              />
            </svg>
            <div className="rbars">
              {RW.map((v, i) => (
                <div key={i} className={`rc${v === maxR ? " peak" : ""}`}>
                  <div className="v">{v}万</div>
                  <div className="bk" style={{ height: `${(v / maxR) * RW_BAR_H}px` }} />
                  <div className="lbl">D+{i + 1}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="cover-note">
            <span className="ic">
              <ShieldCheck size={17} />
            </span>
            <div>
              7 日累计到期 <b>{RW_TOTAL} 万</b>,储备 {Math.round(LEDGER.reserveUsd / 1e4)} 万 ≈ 可覆盖 <b>{Math.round(LEDGER.reserveUsd / 1e4 / (RW_TOTAL / 7))} 个日均到期</b>;<b>D+6</b> 单日 73 万需提前调度储备。
            </div>
          </div>
        </section>

        {/* donut */}
        <section className="card donut-card">
          <div className="ttl-row">
            <span className="ic">
              <PieChart size={16} />
            </span>
            <span className="h">应付负债构成</span>
            <span className="sub">8 科目 · 合计 $5.37M</span>
          </div>
          <div className="donut-wrap">
            <div className="donut" style={{ width: 152, height: 152, background: donutBg }}>
              <div className="hole">
                <div>
                  <div className="big">
                    537<small style={{ fontSize: 12 }}>万</small>
                  </div>
                  <div className="sm">USDT 应付</div>
                </div>
              </div>
            </div>
            <div className="legend" style={{ flex: 1 }}>
              {LIAB.map((l) => (
                <div key={l.nm} className="lg">
                  <span className="d" style={{ background: `var(${l.cat})` }} />
                  <span className="nm">{l.nm}</span>
                  <span className="pc">{l.pc.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* flow strip */}
      <section className="card flow-strip">
        <div className="ttl-row">
          <span className="ic">
            <ArrowDownUp size={16} />
          </span>
          <span className="h">近 8 窗口净流入 / 流出</span>
          <span className="sub">正 = 净流入 · 万 USDT</span>
          <div className="r">
            <span className="b-tag">连续 6 窗口净流入</span>
          </div>
        </div>
        <div className="flow-row">
          {FLOW.map((v, i) => {
            const pos = v >= 0;
            const h = Math.round((Math.abs(v) / maxF) * FLOW_BAR_H);
            const clr = pos ? "var(--success)" : "var(--negative)";
            const barStyle = pos
              ? { bottom: "50%", height: h, borderRadius: "5px 5px 0 0", background: clr }
              : { top: "50%", height: h, borderRadius: "0 0 5px 5px", background: clr };
            return (
              <div key={i} className="flow-col">
                <div className="v" style={{ color: clr }}>
                  {pos ? "+" : ""}
                  {v}万
                </div>
                <div className="flow-plot">
                  <div className="flow-zero" />
                  <div className="flow-bar" style={barStyle} />
                </div>
                <div className="lbl">W{i + 1}</div>
              </div>
            );
          })}
        </div>
      </section>

      <p className="b-foot">
        覆盖率连续 8 窗口缓升,当前 <b>{cov.toFixed(1)}%</b> 高于健康线 {LEDGER.healthyPct}%(绿区),扩张期储备累积;<b>D+6</b> 到期峰值 73 万常规调度即可。储备 / 负债口径与 <b>B1 双账本</b>一致,数据源为 server 端结算账本。
      </p>
    </div>
  );
}
