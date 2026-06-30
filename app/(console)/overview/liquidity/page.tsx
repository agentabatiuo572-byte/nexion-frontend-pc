"use client";

/**
 * B2 资金池水位(只读 · 总览驾驶舱)。
 * UI 严格对齐设计稿 project/「B2 资金池水位.html」:
 *   HERO   兑付覆盖率 + 储备/盈余 水位条 meter + 24h 净流
 *   MAIN   未来 7 日到期兑付预测(柱图 + 累计虚线 + 峰值高亮) | 应付负债构成环图
 *   FLOW   近 8 窗口净流入 / 流出(发散柱)
 * 顶部域标 / 标题 / 控制入口复用 BPageHeader(去设计稿 B1-B5 分段导航与 server-canonical pill)。
 * 数据从 /api/admin/treasury/b-domain 读取;B2 趋势配置缺失时由后端写入 MySQL 种子再读出。
 * 设计稿的 3 段 <script>(donut conic-gradient / runway 累计虚线 / flow 发散柱)在此用 React 计算。
 */
import "../b-domain.css";
import "./liquidity.css";
import { useBDomainDashboard } from "@/lib/admin/b-client";
import { CalendarClock, PieChart, ArrowDownUp, ShieldCheck } from "lucide-react";
import { BPageHeader } from "../b-page-header";
import { BDomainDataState, BDomainWarnings } from "@/app/components/dashboard/b-domain-state";

const RW_BAR_H = 150; // 柱区最大像素高

const FLOW_BAR_H = 60; // 半轴最大像素高

export default function LiquidityPage() {
  const bDomain = useBDomainDashboard();
  const { ledger: LEDGER, liquidity } = bDomain;
  if ((bDomain.loading && !bDomain.hasData) || bDomain.error || !bDomain.hasData) {
    return (
      <div className="dkpage bpage liqpage">
        <BPageHeader
          id="B2"
          title="资金池水位"
          desc="读取 B 域真实资金池水位、到期兑付预测和应付负债构成。"
          ctaLabel="调资金 / 提现参数"
          ctaHref="/finance/params"
        />
        <BDomainDataState title="B2 资金池水位" loading={bDomain.loading && !bDomain.error} error={bDomain.error} onRetry={bDomain.reload} />
      </div>
    );
  }
  if (!liquidity.liabilities.length || !liquidity.runway.length || !liquidity.flow.length || LEDGER.coverageSeries.length < 2) {
    return (
      <div className="dkpage bpage liqpage">
        <BPageHeader
          id="B2"
          title="资金池水位"
          desc="B2 需要负债构成、到期预测、净流和覆盖率趋势。"
          ctaLabel="调资金 / 提现参数"
          ctaHref="/finance/params"
        />
        <BDomainWarnings warnings={bDomain.warnings} />
        <BDomainDataState title="B2 资金池水位" error="B2_REQUIRED_DATA_EMPTY" onRetry={bDomain.reload} />
      </div>
    );
  }
  const LIAB = liquidity.liabilities;
  const RW_ROWS = liquidity.runway;
  const RW = RW_ROWS.map((row) => row.valueWan);
  const RW_TOTAL = liquidity.runwayTotalWan || RW.reduce((sum, value) => sum + value, 0);
  const peak = RW_ROWS.reduce(
    (best, row) => (row.valueWan > best.valueWan ? row : best),
    RW_ROWS[0],
  );
  const FLOW_ROWS = liquidity.flow;
  const FLOW = FLOW_ROWS.map((row) => row.valueWan);
  const coverageSeries = LEDGER.coverageSeries;
  const covDelta = coverageSeries[coverageSeries.length - 1] - coverageSeries[coverageSeries.length - 2];
  const netFlowM = LEDGER.netFlow24hUsd / 1e6;
  const netFlowLabel = `${netFlowM >= 0 ? "+" : "-"}$${Math.abs(netFlowM).toFixed(2)}M`;
  const tailInflowCount = [...FLOW].reverse().findIndex((value) => value <= 0);
  const inflowStreak = tailInflowCount === -1 ? FLOW.length : tailInflowCount;
  const flowTag = inflowStreak > 1 ? `连续 ${inflowStreak} 窗口净流入` : "按接口窗口同步";
  // 环图:由占比累计算 conic-gradient 色标(每段 起% 止%)。
  let acc = 0;
  const donutStops = LIAB.map((l) => {
    const seg = `var(${l.cat}) ${acc.toFixed(2)}% ${(acc + l.pc).toFixed(2)}%`;
    acc += l.pc;
    return seg;
  }).join(", ");
  const donutBg = donutStops ? `conic-gradient(${donutStops})` : "var(--surface-3)";

  // runway:柱高按峰值归一;累计虚线点位(x 居中、y 自累计占 RW_TOTAL 的比例反推)。
  const maxR = Math.max(...RW, 1);
  let cum = 0;
  const cumPts = RW.map((v, i) => {
    cum += v;
    const x = ((i + 0.5) / RW.length) * 100;
    const y = 100 - (cum / Math.max(RW_TOTAL, 1)) * 70 - 8;
    return [x, y] as const;
  });
  const cumPath = cumPts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");

  // flow:发散柱(正=净流入向上、负=流出向下),半轴按 |最大| 归一。
  const maxF = Math.max(...FLOW.map(Math.abs), 1);

  // 覆盖率水位:派生自后端 B 聚合账本(与 D3 / B 驾驶舱一致)。0-120% 标尺,红线/健康线按阈值定位。
  const cov = LEDGER.coverageRatio;
  const reserveM = (LEDGER.reserveUsd / 1e6).toFixed(2);
  const liabM = (LEDGER.liabilitiesUsd / 1e6).toFixed(2);
  const netRaw = LEDGER.reserveUsd - LEDGER.liabilitiesUsd;
  const netM = (Math.abs(netRaw) / 1e6).toFixed(2);
  const isSurplus = netRaw >= 0;
  const COV_SCALE = 120; // 水位条满标 = 1.2× 应付,给健康线 110% 留头寸
  const resW = ((Math.min(cov, COV_SCALE) / COV_SCALE) * 100).toFixed(1);
  const redL = ((LEDGER.redlinePct / COV_SCALE) * 100).toFixed(1);
  const healthL = ((LEDGER.healthyPct / COV_SCALE) * 100).toFixed(1);

  return (
    <div className="dkpage bpage liqpage">
      <BPageHeader
        id="B2"
        title="资金池水位"
        desc={
          <>
            真实能拿出来的钱(储备)和该还给用户的钱({LIAB.length} 类应付)之间,实时还差多少、什么时候到期。这里的覆盖率是 <b>B5 风险雷达</b>和 <b>J 域熔断开关</b>的关键依据。
          </>
        }
        ctaLabel="调资金 / 提现参数"
        ctaHref="/finance/params"
      />
      <BDomainWarnings warnings={bDomain.warnings} />

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
          <div className="d">{covDelta >= 0 ? "↗" : "↘"} {Math.abs(covDelta).toFixed(1)}pt / 窗口</div>
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
            24h 净流{" "}
            <span className="help" data-tip="近 24 小时资金净流(流入 − 流出)。正值=扩张期储备累积,m7 毛流入 ≫ payout。">?</span>
          </div>
          <div className="v" style={{ color: netFlowM >= 0 ? "var(--success)" : "var(--negative)" }}>{netFlowLabel}</div>
          <div className="d">{netFlowM >= 0 ? "↗ 净流入" : "↘ 净流出"}</div>
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
              {RW_ROWS.map((row) => (
                <div key={row.day} className={`rc${row.valueWan === maxR ? " peak" : ""}`}>
                  <div className="v">{row.valueWan}万</div>
                  <div className="bk" style={{ height: `${(row.valueWan / maxR) * RW_BAR_H}px` }} />
                  <div className="lbl">{row.day}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="cover-note">
            <span className="ic">
              <ShieldCheck size={17} />
            </span>
            <div>
              7 日累计到期 <b>{RW_TOTAL} 万</b>,储备 {Math.round(LEDGER.reserveUsd / 1e4)} 万 ≈ 可覆盖 <b>{Math.round(LEDGER.reserveUsd / 1e4 / Math.max(RW_TOTAL / 7, 1))} 个日均到期</b>;<b>{peak.day}</b> 单日 {peak.valueWan} 万需提前调度储备。
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
            <span className="sub">{LIAB.length} 科目 · 合计 ${liabM}M</span>
          </div>
          <div className="donut-wrap">
            <div className="donut" style={{ width: 152, height: 152, background: donutBg }}>
              <div className="hole">
                <div>
                  <div className="big">
                    {Math.round(LEDGER.liabilitiesUsd / 1e4)}<small style={{ fontSize: 12 }}>万</small>
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
            <span className="b-tag">{flowTag}</span>
          </div>
        </div>
        <div className="flow-row">
          {FLOW_ROWS.map((row, i) => {
            const v = row.valueWan;
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
                <div className="lbl">{row.label}</div>
              </div>
            );
          })}
        </div>
      </section>

      <p className="b-foot">
        覆盖率当前 <b>{cov.toFixed(1)}%</b>,健康线 {LEDGER.healthyPct}%,红线 {LEDGER.redlinePct}%;<b>{peak.day}</b> 到期峰值 {peak.valueWan} 万。储备 / 负债口径与 <b>B1 双账本</b>一致,数据源为 server 端结算账本。
      </p>
    </div>
  );
}
