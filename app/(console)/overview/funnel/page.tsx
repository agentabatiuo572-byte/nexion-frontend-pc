"use client";

/**
 * B3 转化漏斗(只读 · 增长运营驾驶舱)。
 * UI 严格对齐设计稿 project/「B3 转化漏斗.html」:
 *   HERO  生命周期漏斗 L1→L5(真锥形 clip-path)+ 阶段转化轨 + 瓶颈提示
 *   ROW2  首购周 Cohort 留存(面积曲线)+ 首购渠道来源(环图)
 *   STRIP 每日首购转化率(面积 + 目标参照线)
 * 顶部域标 / 控制入口由共享 BPageHeader 承载(去设计稿 B1-B5 分段导航与 server-canonical pill)。
 * 数据为确定性 mock,与注册表 lib/admin/registry/b.ts 的 /overview/funnel 口径一致;
 * 真实视角:全部派生自 A4 事件流(服务端权威),用于定位漏斗瓶颈。
 * 色彩走 globals bare-token 别名(--brand/--cyan/--success/--admin-cat-N…),双主题安全,无硬编码 hex。
 */
import "../b-domain.css";
import "./funnel.css";
import { useId } from "react";
import { Filter, Users, PieChart, TrendingUp, AlertTriangle } from "lucide-react";
import { BPageHeader } from "../b-page-header";

const r1 = (n: number) => Math.round(n * 10) / 10;

// ---- 漏斗阶段(注册表 data:[1240,769,223,78,41]) ----
// 段色走 token:brand / brand 浅调 / cyan / cyan 浅调 / success(对应设计稿 lemon / lemon亮 / purple / purple亮 / green)。
type Stage = { nm: string; ct: number; lc: string; conv: string | null; bad?: boolean; color: string };
const STAGES: Stage[] = [
  { nm: "注册", ct: 1240, lc: "L1", conv: null, color: "var(--brand)" },
  { nm: "绑卡", ct: 769, lc: "L2", conv: "62.0%", color: "color-mix(in srgb, var(--brand) 78%, #fff)" },
  { nm: "首购", ct: 223, lc: "L3→L4", conv: "29.0%", bad: true, color: "var(--cyan)" },
  { nm: "复购", ct: 78, lc: "L5", conv: "35.0%", color: "color-mix(in srgb, var(--cyan) 70%, #fff)" },
  { nm: "提现", ct: 41, lc: "L5", conv: "52.6%", color: "var(--success)" },
];
const MAX_CT = STAGES[0].ct;
const wpct = (ct: number) => 16 + (ct / MAX_CT) * 84; // 16%..100% 宽度区间

// 阶段转化轨(环比上窗口)
type Trans = { nm: string; v: string; vColor?: string; flow: string; note: string; noteKind: "muted" | "up" | "dn"; bad?: boolean };
const TRANS: Trans[] = [
  { nm: "注册 → 绑卡", v: "62.0%", flow: "1,240 → 769", note: "$1 KYC express", noteKind: "muted" },
  { nm: "绑卡 → 首购", v: "29.0%", vColor: "var(--brand-2)", flow: "769 → 223", note: "↓ 环比 −2.4pt", noteKind: "dn", bad: true },
  { nm: "首购 → 复购", v: "35.0%", flow: "223 → 78", note: "↑ 环比 +3.1pt", noteKind: "up" },
  { nm: "整体转化", v: "18.0%", flow: "注册 → 首购", note: "223 / 1,240", noteKind: "muted" },
];

// 首购周 Cohort 留存(注册表 data:[100,86,74,68,61,57,54,52])
const COH = [100, 86, 74, 68, 61, 57, 54, 52];

// 首购渠道来源(注册表 segments,占比 + --admin-cat-N)
type Ch = { nm: string; pc: number; catVar: string };
const CH: Ch[] = [
  { nm: "推荐裂变(V-Rank)", pc: 42, catVar: "--admin-cat-1" },
  { nm: "自然 / 直接访问", pc: 26, catVar: "--admin-cat-2" },
  { nm: "试用转付费", pc: 18, catVar: "--admin-cat-4" },
  { nm: "投放广告", pc: 14, catVar: "--admin-cat-6" },
];

// 每日首购转化率(注册表 data:[17.2,16.8,18.1,19.0,18.4,17.6,18.2,18.0],refLine 18)
const DAILY = [17.2, 16.8, 18.1, 19.0, 18.4, 17.6, 18.2, 18.0];
const DAILY_TARGET = 18;

// ---- SVG 面积图路径(确定性四舍五入,防水合) ----
function buildArea(data: number[], W: number, H: number, pad: number, min: number, max: number) {
  const n = data.length;
  const rng = max - min || 1;
  const yTop = H - 8; // 底部基线内缩
  const span = H - 26;
  const pts = data.map((v, i) => [
    r1((i / (n - 1)) * (W - 2 * pad) + pad),
    r1(yTop - ((v - min) / rng) * span),
  ] as [number, number]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ");
  const area = `${line} L${pts[n - 1][0]} ${H} L${pts[0][0]} ${H} Z`;
  return { pts, line, area };
}

export default function FunnelPage() {
  const gradId = useId().replace(/:/g, ""); // SVG gradient id 唯一化(避免提取为组件后碰撞,与 B5 一致)
  // Cohort:0..100 归一(min 0 ~ max 100)
  const cohW = 600, cohH = 170;
  const coh = buildArea(COH, cohW, cohH, 6, 0, 100);

  // Daily:固定刻度 14..22 + 目标线 y(注册表区间 17.2..19.0,沿设计稿 min14/max22)
  const dW = 1400, dH = 150, dMin = 14, dMax = 22;
  const daily = buildArea(DAILY, dW, dH, 8, dMin, dMax);
  const dailyTargetY = r1(dH - 8 - ((DAILY_TARGET - dMin) / (dMax - dMin)) * (dH - 26));
  const todayVal = DAILY[DAILY.length - 1];

  // 渠道环图:conic-gradient 拼段
  let acc = 0;
  const conicStops = CH.map((c) => {
    const seg = `var(${c.catVar}) ${acc}% ${acc + c.pc}%`;
    acc += c.pc;
    return seg;
  }).join(", ");

  return (
    <div className="dkpage bpage funnelpage">
      <BPageHeader
        id="B3"
        title="转化漏斗"
        desc={
          <>
            用户生命周期 L1 注册 → L5 提现各阶段转化与流失,叠加首购周 cohort 留存。指标派生自 <b>A4 事件流</b>(服务端权威),用于增长运营定位漏斗瓶颈。
          </>
        }
        ctaLabel="调 Phase dial"
        ctaHref="/growth/phase"
      />

      {/* HERO: 漏斗 + 阶段转化 */}
      <div className="b3-hero">
        {/* 生命周期漏斗 */}
        <section className="card">
          <div className="ttl-row">
            <span className="ic"><Filter size={15} /></span>
            <span className="h">生命周期漏斗 L1 → L5</span>
            <span className="sub">近 30 日新增用户口径</span>
            <div className="r"><span className="b-tag">注册 → 提现 整体 3.3%</span></div>
          </div>

          <div>
            {STAGES.map((s, i) => {
              const top = wpct(s.ct);
              const bot = i < STAGES.length - 1 ? wpct(STAGES[i + 1].ct) : top * 0.82;
              const tl = r1((100 - top) / 2), tr = r1((100 + top) / 2);
              const bl = r1((100 - bot) / 2), br = r1((100 + bot) / 2);
              return (
                <div key={s.nm}>
                  {s.conv && (
                    <div className="conv-mark">
                      <span className={`conv-pill${s.bad ? " bad" : ""}`}>
                        {s.bad ? "▼ " : ""}
                        {s.conv}
                      </span>
                    </div>
                  )}
                  <div
                    className="funnel-stage"
                    style={{
                      background: `linear-gradient(180deg, ${s.color}, color-mix(in srgb, ${s.color} 80%, #000))`,
                      clipPath: `polygon(${tl}% 0, ${tr}% 0, ${br}% 100%, ${bl}% 100%)`,
                    }}
                  >
                    <span className="nm">{s.nm}</span>
                    <span className="ct">{s.ct.toLocaleString()}</span>
                    <span className="lc">{s.lc}</span>
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
              <div key={t.nm} className={`t${t.bad ? " bad" : ""}`}>
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
              <b>绑卡 → 首购</b> 为最大流失环节,环比再降 2.4pt;建议联动 <b>H 域试用</b> / 首购促销定向干预。
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
            <div className="r"><span className="b-tag">W7 稳定 52%</span></div>
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
            <span className="sub">223 首购用户归因</span>
          </div>
          <div className="donut-wrap">
            <div className="donut" style={{ width: 140, height: 140, background: `conic-gradient(${conicStops})` }}>
              <div className="hole">
                <div>
                  <div className="big">223</div>
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
          <span className="sub">近 8 日 · 目标 18%</span>
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
            目标 18%
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
        <b>绑卡 → 首购</b>(29.0%)为最大流失环节,环比下滑 2.4pt,建议联动 H 域试用 / 首购促销定向干预。复购率回升 +3.1pt,留存曲线第 7 周稳定在 52%。所有阶段口径来自 <b>A4 事件流</b>。
      </p>
    </div>
  );
}
