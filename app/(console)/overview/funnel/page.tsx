"use client";

/**
 * B3 转化漏斗(只读 · 增长运营驾驶舱)。
 * UI 严格对齐设计稿 project/「B3 转化漏斗.html」:
 *   HERO  生命周期漏斗 L1→L5(真锥形 clip-path)+ 阶段转化轨 + 瓶颈提示
 *   ROW2  首购周 Cohort 留存(面积曲线)+ 首购渠道来源(环图)
 *   STRIP 每日首购转化率(面积 + 目标参照线)
 * 顶部域标 / 控制入口由共享 BPageHeader 承载(去设计稿 B1-B5 分段导航与 server-canonical pill)。
 * 数据从 /api/admin/treasury/b-domain 读取;B3 配置缺失时由后端写入 MySQL 种子再读出。
 * 色彩走 globals bare-token 别名(--brand/--cyan/--success/--admin-cat-N…),双主题安全,无硬编码 hex。
 */
import "../b-domain.css";
import "./funnel.css";
import { useId, useState, type CSSProperties } from "react";
import { Filter, Users, PieChart, TrendingUp, AlertTriangle } from "lucide-react";
import { BPageHeader } from "../b-page-header";
import { useBDomainDashboard } from "@/lib/admin/b-client";
import { BDomainDataState, BDomainWarnings } from "@/app/components/dashboard/b-domain-state";

const r1 = (n: number) => Math.round(n * 10) / 10;

type Stage = { key: string; nm: string; ct: number; lc: string; conv: string | null; bad?: boolean; color: string };

type Trans = { nm: string; from: string; to: string; v: string; vColor?: string; flow: string; note: string; noteKind: "muted" | "up" | "dn"; bad?: boolean };
type Ch = { nm: string; pc: number; catVar: string };

// ---- SVG 面积图路径(确定性四舍五入,防水合) ----
function buildArea(data: number[], W: number, H: number, pad: number, min: number, max: number) {
  const n = data.length;
  const rng = max - min || 1;
  const yTop = H - 8; // 底部基线内缩
  const span = H - 26;
  const denom = Math.max(n - 1, 1);
  const pts = data.map((v, i) => [
    r1((i / denom) * (W - 2 * pad) + pad),
    r1(yTop - ((v - min) / rng) * span),
  ] as [number, number]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ");
  const area = `${line} L${pts[n - 1][0]} ${H} L${pts[0][0]} ${H} Z`;
  return { pts, line, area };
}

export default function FunnelPage() {
  const gradId = useId().replace(/:/g, ""); // SVG gradient id 唯一化(避免提取为组件后碰撞,与 B5 一致)
  const bDomain = useBDomainDashboard();
  const [focus, setFocus] = useState<{ type: "stage" | "trans"; id: string } | null>(null);
  const { funnel } = bDomain;
  if ((bDomain.loading && !bDomain.hasData) || bDomain.error || !bDomain.hasData) {
    return (
      <div className="dkpage bpage funnelpage">
        <BPageHeader
          id="B3"
          title="转化漏斗"
          desc="读取 B 域真实漏斗阶段、转化轨迹、渠道和每日转化率。"
          ctaLabel="调 Phase dial"
          ctaHref="/growth/phase"
        />
        <BDomainDataState title="B3 转化漏斗" loading={bDomain.loading && !bDomain.error} error={bDomain.error} onRetry={bDomain.reload} />
      </div>
    );
  }
  if (!funnel.stages.length || !funnel.transitions.length || funnel.cohort.length < 2 || !funnel.channels.length || funnel.daily.length < 2) {
    return (
      <div className="dkpage bpage funnelpage">
        <BPageHeader
          id="B3"
          title="转化漏斗"
          desc="B3 需要漏斗阶段、转化轨、cohort、渠道和每日转化率序列。"
          ctaLabel="调 Phase dial"
          ctaHref="/growth/phase"
        />
        <BDomainWarnings warnings={bDomain.warnings} />
        <BDomainDataState title="B3 转化漏斗" error="B3_REQUIRED_DATA_EMPTY" onRetry={bDomain.reload} />
      </div>
    );
  }
  const STAGES: Stage[] = funnel.stages;
  const TRANS: Trans[] = funnel.transitions;
  const COH = funnel.cohort;
  const CH: Ch[] = funnel.channels;
  const DAILY = funnel.daily;
  const DAILY_TARGET = funnel.dailyTarget;
  const maxCt = Math.max(...STAGES.map((stage) => stage.ct), 1);
  const entryCt = Math.max(STAGES[0]?.ct ?? maxCt, 1);
  const firstBuyCt = STAGES.find((stage) => stage.key === "buy" || stage.nm.includes("首购"))?.ct ?? 0;
  const latestCohort = COH[COH.length - 1] ?? 0;
  const wpct = (ct: number) => 16 + (ct / maxCt) * 84; // 16%..100% 宽度区间
  const bottleneck = TRANS.find((item) => item.bad) ?? TRANS[0];

  // 漏斗段 ↔ 阶段转化卡片 双向联动焦点(hover 段亮其相关转化卡片,反之亦然)
  const isStageActive = (key: string) => {
    if (!focus) return false;
    if (focus.type === "stage") return focus.id === key;
    const t = TRANS.find((x) => x.nm === focus.id);
    return !!t && (t.from === key || t.to === key);
  };
  const isTransActive = (t: Trans) => {
    if (!focus) return false;
    if (focus.type === "trans") return focus.id === t.nm;
    return t.from === focus.id || t.to === focus.id;
  };
  // Cohort:0..100 归一(min 0 ~ max 100)
  const cohW = 600, cohH = 170;
  const coh = buildArea(COH, cohW, cohH, 6, 0, 100);

  // Daily:按接口数据和目标线动态取刻度,避免配置变更后曲线溢出。
  const dW = 1400, dH = 150;
  const dMin = Math.floor(Math.min(...DAILY, DAILY_TARGET, 14));
  const dMax = Math.ceil(Math.max(...DAILY, DAILY_TARGET, 22));
  const daily = buildArea(DAILY, dW, dH, 8, dMin, dMax);
  const dailyRange = dMax - dMin || 1;
  const dailyTargetY = r1(dH - 8 - ((DAILY_TARGET - dMin) / dailyRange) * (dH - 26));
  const todayVal = DAILY[DAILY.length - 1];

  // 渠道环图:conic-gradient 拼段
  let acc = 0;
  const conicStops = CH.map((c) => {
    const seg = `var(${c.catVar}) ${acc}% ${acc + c.pc}%`;
    acc += c.pc;
    return seg;
  }).join(", ");
  const donutBg = conicStops ? `conic-gradient(${conicStops})` : "var(--surface-3)";

  return (
    <div className="dkpage bpage funnelpage">
      <BPageHeader
        id="B3"
        title="转化漏斗"
        desc={
          <>
            用户从注册(L1)一路走到提现(L5),每一步留住多少、流失多少,再叠加首次购机那批人的逐周留存。数据都来自 <b>A4 事件流</b>(以服务端为准),帮增长团队找出漏斗卡在哪一环。
          </>
        }
        ctaLabel="调 Phase dial"
        ctaHref="/growth/phase"
      />
      <BDomainWarnings warnings={bDomain.warnings} />

      {/* HERO: 漏斗 + 阶段转化 */}
      <div className="b3-hero">
        {/* 生命周期漏斗 */}
        <section className="card">
          <div className="ttl-row">
            <span className="ic"><Filter size={15} /></span>
            <span className="h">生命周期漏斗 L1 → L5</span>
            <span className="sub">近 30 日新增用户口径</span>
            <div className="r"><span className="b-tag">整体 {funnel.overallConversionPct.toFixed(1)}%</span></div>
          </div>

          <div className="funnel-list">
            {STAGES.map((s, i) => {
              const top = wpct(s.ct);
              const bot = i < STAGES.length - 1 ? wpct(STAGES[i + 1].ct) : top * 0.82;
              const tl = r1((100 - top) / 2), tr = r1((100 + top) / 2);
              const bl = r1((100 - bot) / 2), br = r1((100 + bot) / 2);
              const prevCt = i > 0 ? STAGES[i - 1].ct : null;
              const lost = prevCt != null ? prevCt - s.ct : null;
              const shareL1 = r1((s.ct / entryCt) * 100); // 占注册(L1)渗透率,确定性派生
              const active = isStageActive(s.key);
              const showTip = focus?.type === "stage" && focus.id === s.key;
              // 详情浮层垂直锚定:首段向下展开、末段向上展开、中段居中,避免溢出卡片上下沿
              const tipPos: CSSProperties =
                i === 0 ? { top: 6, bottom: "auto", transform: "none" }
                : i === STAGES.length - 1 ? { top: "auto", bottom: 6, transform: "none" }
                : { top: "50%", transform: "translateY(-50%)" };
              return (
                <div key={s.key}>
                  {s.conv && (
                    <div className="conv-mark">
                      <span className={`conv-pill${s.bad ? " bad" : ""}`}>
                        {s.bad ? "▼ " : ""}
                        {s.conv}
                      </span>
                    </div>
                  )}
                  <div className="stage-anchor">
                    <div
                      className={`funnel-stage${active ? " is-active" : ""}`}
                      style={{
                        background: `linear-gradient(180deg, ${s.color}, color-mix(in srgb, ${s.color} 80%, #000))`,
                        clipPath: `polygon(${tl}% 0, ${tr}% 0, ${br}% 100%, ${bl}% 100%)`,
                        "--stage-color": s.color,
                      } as CSSProperties}
                      onMouseEnter={() => setFocus({ type: "stage", id: s.key })}
                      onMouseLeave={() => setFocus(null)}
                    >
                      <span className="nm">{s.nm}</span>
                      <span className="ct">{s.ct.toLocaleString()}</span>
                      <span className="lc">{s.lc}</span>
                    </div>
                    {showTip && (
                      <div className="stage-tip" role="tooltip" style={tipPos}>
                        <div className="st-h">
                          <span className="st-nm">{s.nm}</span>
                          <span className="st-lc">{s.lc}</span>
                          {s.bad && <span className="st-flag">瓶颈</span>}
                        </div>
                        <dl className="st-rows">
                          <div><dt>人数</dt><dd className="nowrap">{s.ct.toLocaleString()}</dd></div>
                          <div><dt>占注册 L1</dt><dd className="nowrap">{shareL1}%</dd></div>
                          <div><dt>自上阶段转化</dt><dd className="nowrap">{s.conv ? `${s.bad ? "▼ " : ""}${s.conv}` : "漏斗入口"}</dd></div>
                          <div><dt>较上阶段流失</dt><dd className="nowrap">{lost != null ? `−${lost.toLocaleString()} 人` : "—"}</dd></div>
                        </dl>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 阶段转化 + 瓶颈 */}
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="ttl-row" style={{ marginBottom: 4 }}>
            <span className="h">阶段转化</span>
            <span className="sub">环比上窗口</span>
          </div>
          <div className="trans">
            {TRANS.map((t) => (
              <div
                key={t.nm}
                className={`t${t.bad ? " bad" : ""}${isTransActive(t) ? " is-active" : ""}`}
                onMouseEnter={() => setFocus({ type: "trans", id: t.nm })}
                onMouseLeave={() => setFocus(null)}
              >
                <div className="tr1">
                  <span className="nm">{t.nm}</span>
                  <span className="v" style={t.vColor ? { color: t.vColor } : undefined}>{t.v}</span>
                </div>
                <div className="tr2">
                  <span className="flow">{t.flow}</span>
                  <span
                    className={t.noteKind === "up" ? "delta-up" : t.noteKind === "dn" ? "delta-dn" : "muted"}
                    style={{ marginLeft: "auto" }}
                  >
                    {t.note}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="bottleneck" style={{ marginTop: "auto" }}>
            <span className="bn-ic"><AlertTriangle size={17} /></span>
            <div>
              <b>{bottleneck?.nm ?? "暂无瓶颈"}</b> 为当前最大流失环节;建议联动 <b>H 域试用</b> / 首购促销定向干预。
            </div>
          </div>
        </section>
      </div>

      {/* ROW 2: cohort + 渠道 */}
      <div className="b3-row2">
        <section className="card">
          <div className="ttl-row">
            <span className="ic"><Users size={15} /></span>
            <span className="h">首购周 Cohort 留存</span>
            <span className="sub">首购后第 N 周仍有活跃产出</span>
            <div className="r"><span className="b-tag">W{COH.length - 1} 稳定 {latestCohort}%</span></div>
          </div>
          <svg className="chart-svg" viewBox={`0 0 ${cohW} ${cohH}`} preserveAspectRatio="none" style={{ height: 170 }} aria-hidden>
            <defs>
              <linearGradient id={`${gradId}-cohort`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--success)" stopOpacity="0.34" />
                <stop offset="1" stopColor="var(--success)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={coh.area} fill={`url(#${gradId}-cohort)`} />
            <path
              d={coh.line}
              fill="none"
              stroke="var(--success)"
              strokeWidth={2.4}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {coh.pts.map((p, i) => {
              const anchor = i === 0 ? "start" : i === coh.pts.length - 1 ? "end" : "middle";
              const tx = i === 0 ? p[0] + 1 : i === coh.pts.length - 1 ? p[0] - 1 : p[0];
              return (
                <g key={i}>
                  <circle cx={p[0]} cy={p[1]} r={3} fill="var(--surface)" stroke="var(--success)" strokeWidth={2} />
                  <text x={tx} y={r1(p[1] - 9)} fill="var(--ink-3)" fontSize={12} fontFamily="var(--font-jet-mono), monospace" textAnchor={anchor}>
                    {COH[i]}%
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="cohort-axis">
            {COH.map((_, i) => (
              <span key={i}>W{i}</span>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="ttl-row">
            <span className="ic"><PieChart size={15} /></span>
            <span className="h">首购渠道来源</span>
            <span className="sub">{firstBuyCt.toLocaleString()} 首购用户归因</span>
          </div>
          <div className="donut-wrap">
            <div className="donut" style={{ width: 140, height: 140, background: donutBg }}>
              <div className="hole">
                <div>
                  <div className="big">{firstBuyCt.toLocaleString()}</div>
                  <div className="sm">首购用户</div>
                </div>
              </div>
            </div>
            <div className="legend" style={{ flex: 1 }}>
              {CH.map((c) => (
                <div key={c.nm} className="lg">
                  <span className="d" style={{ background: `var(${c.catVar})` }} />
                  <span className="nm">{c.nm}</span>
                  <span className="pc">{c.pc}%</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* 每日首购转化率 */}
      <section className="card daily-strip">
        <div className="ttl-row">
          <span className="ic"><TrendingUp size={15} /></span>
          <span className="h">每日首购转化率</span>
          <span className="sub">近 {DAILY.length} 日 · 目标 {DAILY_TARGET}%</span>
          <div className="r"><span className="b-tag">今日 {r1(todayVal)}%</span></div>
        </div>
        <svg className="chart-svg" viewBox={`0 0 ${dW} ${dH}`} preserveAspectRatio="none" style={{ height: 150 }} aria-hidden>
          <defs>
            <linearGradient id={`${gradId}-daily`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--brand)" stopOpacity="0.30" />
              <stop offset="1" stopColor="var(--brand)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={daily.area} fill={`url(#${gradId}-daily)`} />
          <line
            x1="0"
            y1={dailyTargetY}
            x2={dW}
            y2={dailyTargetY}
            stroke="var(--brand-2)"
            strokeWidth={1.5}
            strokeDasharray="7 6"
            vectorEffect="non-scaling-stroke"
          />
          <text x="6" y={r1(dailyTargetY - 7)} fill="var(--brand-2)" fontSize={12} fontFamily="var(--font-jet-mono), monospace">
            目标 {DAILY_TARGET}%
          </text>
          <path
            d={daily.line}
            fill="none"
            stroke="var(--brand)"
            strokeWidth={2.4}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {daily.pts.map((p, i) => {
            const anchor = i === 0 ? "start" : i === daily.pts.length - 1 ? "end" : "middle";
            const tx = i === 0 ? p[0] + 1 : i === daily.pts.length - 1 ? p[0] - 1 : p[0];
            return (
              <g key={i}>
                <circle cx={p[0]} cy={p[1]} r={3.4} fill="var(--surface)" stroke="var(--brand)" strokeWidth={2} />
                <text x={tx} y={r1(p[1] - 10)} fill="var(--ink-3)" fontSize={12} fontFamily="var(--font-jet-mono), monospace" textAnchor={anchor}>
                  {DAILY[i]}%
                </text>
              </g>
            );
          })}
        </svg>
        <div className="cohort-axis">
          {DAILY.map((_, i) => (
            <span key={i}>{i === DAILY.length - 1 ? "今日" : `D-${7 - i}`}</span>
          ))}
        </div>
      </section>

      <p className="b-foot">
        <b>{bottleneck?.nm ?? "暂无瓶颈"}</b>{bottleneck ? `(${bottleneck.v})` : ""} 为当前重点环节,建议联动 H 域试用 / 首购促销定向干预。所有阶段口径来自服务端 B 域聚合接口。
      </p>
    </div>
  );
}
