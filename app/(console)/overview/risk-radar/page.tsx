"use client";

/**
 * B5 风险雷达(只读 · 全域风险面板)。
 * UI 严格对齐设计稿 project/「B5 风险雷达.html」command / alert board:
 *   左栏 Kill-Switch 闸门灯 + 未处理告警 feed
 *   右栏 报警瓦片三联 + 出金压力比趋势(SVG area · 红线 70%)+ 底部三联
 *        (异常账户命中规则 bars / 告警严重度 donut / 近 7 日告警量 mini-bars)
 * 顶部域标/标题由共享 BPageHeader 承载;布局端口设计稿(risk-radar.css · .radarpage 作用域)。
 * 数据 mock(确定性),与注册表 lib/admin/registry/b.ts 的 /overview/risk-radar 口径一致。
 * 只读看板:无写动作(熔断切换在 J1 · 经 Maker-Checker 双签);CTA 深链 Kill-Switch 矩阵。
 */
import "../b-domain.css";
import "./risk-radar.css";
import Link from "next/link";
import { useId } from "react";
import {
  ShieldCheck,
  AlertTriangle,
  Radar,
  ShieldAlert,
  PieChart,
  ChevronRight,
} from "lucide-react";
import { BPageHeader } from "../b-page-header";
import { KILLSWITCH } from "@/lib/mock/admin/design-data";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { LEDGER } from "@/lib/mock/admin/ledger";

// ---- 设计数据(与 registry b.ts /overview/risk-radar 对齐)----

// Kill-Switch 闸门 — 单一源:闸集/标识取自 J1 权威 KILLSWITCH;在线态以 platform-config-store
// (J.killswitch.<key>)为准、缺省回落 KILLSWITCH.on —— 与 J1 矩阵恒一致(operator 在 J1 熔断后,
// 本只读雷达即时同步)。7 闸:资金/兑付 5 + 获客/收入 2;此处只读,熔断/恢复在 J1 双签。
const GATE_NAMES: Record<string, string> = {
  withdraw: "提现闸", exchange: "兑换闸", staking: "算力质押闸",
  nexv2: "NEX v2 Lock", genesis: "Genesis 闸", trial: "试用闸", premium: "Premium 订阅",
};

// 未处理告警 feed — 每条深链至告警来源域(点击钻取处置)。
const FEED: { sev: "p0" | "p1" | "p2"; t: string; m: string; href: string }[] = [
  { sev: "p2", t: `出金压力比 ${(LEDGER.pressureRatio * 100).toFixed(0)}% 远低 70% 红线 · 覆盖率 ${LEDGER.coverageRatio.toFixed(1)}% 绿区`, m: "B1 双账本 · 4m 前", href: "/overview/dual-ledger" },
  { sev: "p1", t: "K2 检出异常提现簇 +9 命中", m: "K2 套利检测 · 12m 前", href: "/risk/abuse" },
  { sev: "p2", t: "24h 资金净流入 +33% · 扩张健康", m: "D3 资金池 · 26m 前", href: "/finance/pool" },
  { sev: "p2", t: "提现队列积压 142 单 · $430K", m: "D2 提现队列 · 41m 前", href: "/finance/withdrawals" },
  { sev: "p2", t: "提现队列占储备 6.8% · 远低 15% 预警线", m: "B5 雷达 · 1h 前", href: "/overview/liquidity" },
  { sev: "p2", t: "风险评分均值 31 ↘ −2", m: "K4 风险评分 · 2h 前", href: "/risk/scoring" },
];

// 出金压力比 e(t) 趋势(模型 §5.3 · 近 8 窗口 · 红线 70%;m7 基准 = 32%)
const BR = [9, 12, 18, 24, 28, 30, 31, 32];
const BR_TIGHT = 70; // 出金压力比红线(>0.7 触发退出)

// 异常账户命中规则(近 7 日 · 命中账户数)
const RULES: { nm: string; ct: number }[] = [
  { nm: "多开", ct: 14 },
  { nm: "自循环刷返", ct: 9 },
  { nm: "异常提现", ct: 7 },
  { nm: "设备指纹", ct: 5 },
  { nm: "IP 聚集", ct: 2 },
];

// 告警严重度分布(全域 · 含已处置);count→占比,环图与图例按占比从大到小(设计稿视觉序)。
const SEV: { nm: string; count: number; c: string }[] = [
  { nm: "P3 低 · 信息提示", count: 8, c: "var(--admin-cat-2)" },
  { nm: "P2 中 · 参数 / 队列", count: 3, c: "var(--admin-cat-4)" },
  { nm: "P1 高 · 异常 / 风控", count: 2, c: "var(--warning)" },
  { nm: "P0 严重 · 覆盖率 / 储备", count: 1, c: "var(--danger)" },
];
const SEV_TOTAL = SEV.reduce((s, x) => s + x.count, 0); // 14

// 近 7 日告警量(每日新增 · 全域)
const VOL = [3, 5, 4, 6, 8, 7, 9];
const VOL_LABELS = ["D-6", "D-5", "D-4", "D-3", "D-2", "D-1", "今日"];

export default function RiskRadarPage() {
  const gradId = useId().replace(/:/g, "");

  // 闸门在线态:store(J.killswitch.<key>)为准、缺省回落 KILLSWITCH.on(与 J1 矩阵单源同步)。
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const GATES = KILLSWITCH.map((k) => {
    const ov = hydrated ? (params?.[`J.killswitch.${k.key}`] as string | undefined) : undefined;
    return { nm: GATE_NAMES[k.key] ?? k.name, dom: k.key, on: ov ? ov === "on" : k.on };
  });
  const GATES_TRIPPED = GATES.filter((g) => !g.on).length;

  // ---- 趋势 SVG 几何(端口自设计稿 <script>)----
  const W = 1180;
  const H = 150;
  const n = BR.length;
  const pad = 8;
  const vmin = 2;
  const vmax = 16;
  const rng = vmax - vmin;
  const yOf = (v: number) => H - 12 - ((v - vmin) / rng) * (H - 28);
  const pts = BR.map((v, i) => [(i / (n - 1)) * (W - 2 * pad) + pad, yOf(v)] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${pts[n - 1][0].toFixed(1)} ${H} L${pts[0][0].toFixed(1)} ${H} Z`;
  const ty = yOf(BR_TIGHT);

  // ---- donut conic 段(占比累计)----
  let acc = 0;
  const stops = SEV.map((l) => {
    const pc = (l.count / SEV_TOTAL) * 100;
    const seg = `${l.c} ${acc.toFixed(2)}% ${(acc + pc).toFixed(2)}%`;
    acc += pc;
    return seg;
  });
  const sevPct = (count: number) => Math.round((count / SEV_TOTAL) * 100);

  const maxRule = Math.max(...RULES.map((r) => r.ct));
  const maxVol = Math.max(...VOL);

  return (
    <div className="dkpage bpage radarpage">
      <BPageHeader
        id="B5"
        title="风险雷达"
        desc={
          <>
            挤兑压力、异常账户、Kill-Switch 状态与全域告警分布的统一风险面板。红色信号联动{" "}
            <b>J 域熔断</b>与 <b>D 域提现收紧</b>,数据来自 G/D/J 域实时聚合。
          </>
        }
        ctaLabel="Kill-Switch 矩阵"
        ctaHref="/emergency/kill-switch"
      />

      <div className="b5-main">
        {/* ===== 左栏:闸门 + 告警 feed ===== */}
        <div className="left-rail">
          <section className="card">
            <div className="ttl-row" style={{ marginBottom: 13 }}>
              <span className="ic"><ShieldCheck size={16} aria-hidden /></span>
              <span className="h">Kill-Switch 闸门</span>
              <div className="r">
                <span className={`badge-s ${GATES_TRIPPED === 0 ? "ok" : "err"}`}>
                  {GATES_TRIPPED} / {GATES.length}
                </span>
              </div>
            </div>
            <div>
              {GATES.map((g) => (
                <div key={g.dom} className={`gate ${g.on ? "on" : "off"}`}>
                  <span className="light" />
                  <span className="nm">{g.nm}</span>
                  <span className="dom">{g.dom}</span>
                  <span className="st">{g.on ? "待命" : "已熔断"}</span>
                </div>
              ))}
            </div>
            <div className="muted tiny" style={{ marginTop: 9 }}>
              {GATES_TRIPPED === 0
                ? `${GATES.length} 闸全绿待命`
                : `${GATES.length} 闸 · ${GATES_TRIPPED} 已熔断(详见 J1)`}
              {" "}· 熔断 / 恢复需 J 域 风控主管 + 总管理员 双签
            </div>
          </section>

          <section className="card">
            <div className="ttl-row" style={{ marginBottom: 8 }}>
              <span className="ic"><AlertTriangle size={16} aria-hidden /></span>
              <span className="h">未处理告警</span>
              <div className="r"><span className="badge-s orange">6 待处理</span></div>
            </div>
            <div className="feed">
              {FEED.map((f, i) => (
                <Link key={i} href={f.href} prefetch={false} className="feed-item">
                  <span className={`sev ${f.sev}`}>{f.sev.toUpperCase()}</span>
                  <div className="ft">
                    <div className="t">{f.t}</div>
                    <div className="m">{f.m}</div>
                  </div>
                  <ChevronRight size={15} className="feed-chev" aria-hidden />
                </Link>
              ))}
            </div>
          </section>
        </div>

        {/* ===== 右栏:瓦片 + 趋势 + 底部三联 ===== */}
        <div className="right-stack">
          {/* 报警瓦片三联 */}
          <div className="alarm-row">
            <div className="alarm">
              <div className="k">
                出金压力比{" "}
                <span className="help" data-tip="(payout + 佣金) ÷ 毛流入(模型 §5.3 庞氏度量)。逼近红线 70% 时联动 D 域收紧 / 退出。">?</span>
              </div>
              <div className="v" style={{ color: "var(--success)" }}>32%</div>
              <div className="d" style={{ color: "var(--success)" }}>↗ 上窗 31% · 远低 70% 红线(扩张健康)</div>
            </div>
            <div className="alarm warn">
              <div className="k">
                异常账户{" "}
                <span className="help" data-tip="命中风控规则(多开 / 套利 / 异常提现等)的账户数,来自 K 域。">?</span>
              </div>
              <div className="v" style={{ color: "var(--warning)" }}>37</div>
              <div className="d" style={{ color: "var(--warning)" }}>↗ +9 · 命中风控规则</div>
            </div>
            <div className="alarm warn">
              <div className="k">未处理告警</div>
              <div className="v">6</div>
              <div className="d muted">↗ +2 · P0:1 · P1:2 · P2:3</div>
            </div>
          </div>

          {/* 挤兑压力比趋势 */}
          <section className="card">
            <div className="ttl-row">
              <span className="ic"><Radar size={16} aria-hidden /></span>
              <span className="h">出金压力比趋势</span>
              <span className="sub">近 8 窗口 · 红线 70%</span>
              <div className="r"><span className="b-tag">连升 8 窗口 · 斜率走高</span></div>
            </div>
            <svg
              className="chart-svg"
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              style={{ height: 150 }}
              role="img"
              aria-label="出金压力比近 8 窗口趋势,当前 32%,红线 70%"
            >
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--danger)" stopOpacity="0.3" />
                  <stop offset="1" stopColor="var(--danger)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={area} fill={`url(#${gradId})`} />
              <line
                x1="0"
                y1={ty.toFixed(1)}
                x2={W}
                y2={ty.toFixed(1)}
                stroke="var(--danger)"
                strokeWidth="1.5"
                strokeDasharray="7 6"
                vectorEffect="non-scaling-stroke"
              />
              <text x="6" y={(ty + 15).toFixed(1)} fill="var(--danger)" fontSize="12" fontFamily="var(--font-jet-mono), monospace">
                红线 70%
              </text>
              <path
                d={line}
                fill="none"
                stroke="var(--danger)"
                strokeWidth="2.4"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {pts.map((p, i) => {
                const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
                const tx = i === 0 ? p[0] + 1 : i === n - 1 ? p[0] - 1 : p[0];
                return (
                  <g key={i}>
                    <circle
                      cx={p[0].toFixed(1)}
                      cy={p[1].toFixed(1)}
                      r="3.2"
                      fill="var(--surface)"
                      stroke="var(--danger)"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                    <text
                      x={tx.toFixed(1)}
                      y={(p[1] - 9).toFixed(1)}
                      fill="var(--ink-3)"
                      fontSize="11.5"
                      fontFamily="var(--font-jet-mono), monospace"
                      textAnchor={anchor}
                    >
                      {BR[i].toFixed(1)}%
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="cohort-axis">
              {BR.map((_, i) => (
                <span key={i}>W{i + 1}</span>
              ))}
            </div>
          </section>

          {/* 底部三联 */}
          <div className="b5-bottom">
            {/* 异常账户命中规则 */}
            <section className="card">
              <div className="ttl-row">
                <span className="ic"><ShieldAlert size={16} aria-hidden /></span>
                <span className="h">异常账户命中规则</span>
                <span className="sub">近 7 日</span>
              </div>
              <div className="rule-row">
                {RULES.map((r) => (
                  <div key={r.nm} className="rule">
                    <span className="nm">{r.nm}</span>
                    <span className="bar-wrap">
                      <span className="bar-f" style={{ width: `${(r.ct / maxRule) * 100}%` }} />
                    </span>
                    <span className="ct">{r.ct}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* 告警严重度分布 */}
            <section className="card">
              <div className="ttl-row">
                <span className="ic"><PieChart size={16} aria-hidden /></span>
                <span className="h">告警严重度分布</span>
                <span className="sub">含已处置</span>
              </div>
              <div className="donut-wrap">
                <div
                  className="donut"
                  style={{ width: 120, height: 120, background: `conic-gradient(${stops.join(",")})` }}
                >
                  <div className="hole">
                    <div>
                      <div className="big">{SEV_TOTAL}</div>
                      <div className="sm">告警</div>
                    </div>
                  </div>
                </div>
                <div className="legend" style={{ flex: 1 }}>
                  {SEV.map((l) => (
                    <div key={l.nm} className="lg">
                      <span className="d" style={{ background: l.c }} />
                      <span className="nm">{l.nm}</span>
                      <span className="pc">{sevPct(l.count)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* 近 7 日告警量 */}
            <section className="card">
              <div className="ttl-row">
                <span className="ic"><AlertTriangle size={16} aria-hidden /></span>
                <span className="h">近 7 日告警量</span>
                <span className="sub">全域</span>
              </div>
              <div className="mini-bars">
                {VOL.map((v, i) => {
                  const recent = i >= VOL.length - 2;
                  return (
                    <div key={i} className="mini-col">
                      <div className="v">{v}</div>
                      <div
                        className="bk"
                        style={{
                          height: `${(v / maxVol) * 82}px`,
                          background: recent
                            ? "var(--brand)"
                            : "color-mix(in srgb, var(--brand) 72%, #000)",
                        }}
                      />
                      <div className="lbl">{VOL_LABELS[i]}</div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </div>

      <p className="b-foot">
        出金压力比 <b>32%</b>,远低 70% 红线、扩张健康;异常账户 +9 主要来自多开与自循环刷返。
        <b>{GATES_TRIPPED === 0 ? `Kill-Switch ${GATES.length} 闸全绿(0 / ${GATES.length} 熔断)` : `Kill-Switch ${GATES_TRIPPED} / ${GATES.length} 闸已熔断`}</b>,P0 告警为覆盖率逼近健康线下方预警。熔断触发需 J 域 Maker-Checker 双签 + 全站广播。
      </p>
    </div>
  );
}
