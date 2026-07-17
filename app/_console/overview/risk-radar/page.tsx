"use client";

/**
 * B5 风险雷达(全域风险面板)。
 * UI 严格对齐设计稿 project/「B5 风险雷达.html」command / alert board:
 *   左栏 Kill-Switch 闸门灯 + 未处理告警 feed
 *   右栏 报警瓦片三联 + 出金压力比趋势(SVG area · 动态红线)+ 底部三联
 *        (异常账户命中规则 bars / 告警严重度 donut / 近 7 日告警量 mini-bars)
 * 顶部域标/标题由共享 BPageHeader 承载;布局端口设计稿(risk-radar.css · .radarpage 作用域)。
 * 数据从 /api/admin/treasury/b-domain 读取;B5 配置缺失时由后端写入 MySQL 种子再读出。
 * B5 维护挤兑黄/红线的单一权威配置,J1 R1 直接引用同一红线;熔断切换仍在 J1。
 */
import "../b-domain.css";
import "./risk-radar.css";
import Link from "next/link";
import { useId, useState } from "react";
import {
  ShieldCheck,
  AlertTriangle,
  Radar,
  ShieldAlert,
  PieChart,
  ChevronRight,
  SlidersHorizontal,
} from "lucide-react";
import { BPageHeader } from "../b-page-header";
import { updateB5BankRunThresholds, useBDomainDashboard } from "@/lib/admin/b-client";
import { BDomainDataState, BDomainWarnings } from "@/app/components/dashboard/b-domain-state";
import { OperationConfirmModal, useToast } from "@/app/components/domain-views/design-kit";
import { useAdminAuth } from "@/lib/store/admin-auth";

export default function RiskRadarPage() {
  const gradId = useId().replace(/:/g, "");
  const bDomain = useBDomainDashboard();
  const operator = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "");
  const authorities = useAdminAuth((s) => s.session?.authorities ?? []);
  const canWriteBankRunThresholds = authorities.some((authority) =>
    authority === "overview_b1_write" || authority === "overview_b1_runrisk_write");
  const [editingBankRunThresholds, setEditingBankRunThresholds] = useState(false);
  const [toastNode, setToast] = useToast();
  const { riskRadar } = bDomain;
  if ((bDomain.loading && !bDomain.hasData) || bDomain.error || !bDomain.hasData) {
    return (
      <div className="dkpage bpage radarpage">
        <BPageHeader
          id="B5"
          title="风险雷达"
          desc="读取 B 域真实挤兑压力、异常账户、熔断闸门和告警面板。"
          ctaLabel="Kill-Switch 矩阵"
          ctaHref="/emergency/kill-switch"
        />
        <BDomainDataState title="B5 风险雷达" loading={bDomain.loading && !bDomain.error} error={bDomain.error} onRetry={bDomain.reload} />
      </div>
    );
  }
  const GATES = riskRadar.gates;
  const GATES_TRIPPED = riskRadar.trippedGateCount || GATES.filter((g) => (g.state ? g.state === "off" : !g.on)).length;
  const GATES_MISSING = GATES.filter((g) => g.state === "missing").length;
  const FEED = riskRadar.feed;
  const BR = riskRadar.pressureSeries;
  const BR_TIGHT = riskRadar.pressureTightPct;
  const currentPressure = riskRadar.currentPressurePct || BR[BR.length - 1] || 0;
  const prevPressure = BR[BR.length - 2] ?? currentPressure;
  const RULES = riskRadar.rules;
  const flaggedAccounts = riskRadar.flaggedAccounts || RULES.reduce((sum, item) => sum + item.ct, 0);
  const SEV = riskRadar.severity;
  const sevTotalRaw = SEV.reduce((s, x) => s + x.count, 0);
  const SEV_TOTAL = Math.max(sevTotalRaw, 1);
  const VOL_ROWS = riskRadar.volume;
  const VOL = VOL_ROWS.map((row) => row.count);
  const p0Count = FEED.filter((item) => item.sev === "p0").length;
  const p1Count = FEED.filter((item) => item.sev === "p1").length;
  const p2Count = FEED.filter((item) => item.sev === "p2").length;
  const bankRunRatio = riskRadar.bankRunRatio || 0;
  const bankRunYellowPct = riskRadar.bankRunYellowPct;
  const bankRunRedlinePct = riskRadar.bankRunRedlinePct;
  const bankRunColor = bankRunRatio >= bankRunRedlinePct
    ? "var(--danger)"
    : bankRunRatio >= bankRunYellowPct
      ? "var(--warning)"
      : "var(--success)";

  // ---- 趋势 SVG 几何(端口自设计稿 <script>)----
  const W = 1180;
  const H = 150;
  const hasPressureSeries = BR.length > 0;
  const n = BR.length;
  const pad = 8;
  const vmin = 0;
  const vmax = Math.max(BR_TIGHT, ...BR, 1);
  const rng = vmax - vmin;
  const yOf = (v: number) => H - 12 - ((v - vmin) / rng) * (H - 28);
  const denom = Math.max(n - 1, 1);
  const pts = BR.map((v, i) => [(i / denom) * (W - 2 * pad) + pad, yOf(v)] as const);
  const line = hasPressureSeries ? pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ") : "";
  const area = hasPressureSeries ? `${line} L${pts[n - 1][0].toFixed(1)} ${H} L${pts[0][0].toFixed(1)} ${H} Z` : "";
  const ty = yOf(BR_TIGHT);

  // ---- donut conic 段(占比累计)----
  let acc = 0;
  const stops = SEV.map((l) => {
    const pc = (l.count / SEV_TOTAL) * 100;
    const seg = `${l.c} ${acc.toFixed(2)}% ${(acc + pc).toFixed(2)}%`;
    acc += pc;
    return seg;
  });
  const severityBg = stops.length ? `conic-gradient(${stops.join(",")})` : "var(--surface-3)";
  const sevPct = (count: number) => Math.round((count / SEV_TOTAL) * 100);

  const maxRule = Math.max(...RULES.map((r) => r.ct), 1);
  const maxVol = Math.max(...VOL, 1);
  const risingWindows = BR.reduce((count, value, index) => (index > 0 && value >= BR[index - 1] ? count + 1 : count), 0);

  return (
    <div className="dkpage bpage radarpage">
      <BPageHeader
        id="B5"
        title="风险雷达"
        desc={
          <>
            把挤兑压力、异常账户、熔断开关状态和全平台告警集中成一块风险面板。出现红色信号会联动{" "}
            <b>J 域熔断</b>和 <b>D 域提现收紧</b>,数据从 G/D/J 各域实时汇总而来。
          </>
        }
        ctaLabel="Kill-Switch 矩阵"
        ctaHref="/emergency/kill-switch"
      />
      <BDomainWarnings warnings={bDomain.warnings} />

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
              {GATES.map((g) => {
                const state = g.state ?? (g.on ? "on" : "off");
                return (
                  <div key={g.dom} className={`gate ${state === "missing" ? "missing" : state === "on" ? "on" : "off"}`}>
                    <span className="light" />
                    <span className="nm">{g.nm}</span>
                    <span className="dom">{g.dom}</span>
                    <span className="st">{state === "missing" ? "未配置" : state === "on" ? "待命" : "已熔断"}</span>
                  </div>
                );
              })}
            </div>
            <div className="muted tiny" style={{ marginTop: 9 }}>
              {GATES_TRIPPED === 0
                ? `${GATES.length - GATES_MISSING} 闸待命${GATES_MISSING ? ` · ${GATES_MISSING} 未配置` : ""}`
                : `${GATES.length} 闸 · ${GATES_TRIPPED} 已熔断(详见 J1)`}
              {" "}· 手动熔断 / 恢复按方向权限确认；R1 自动关停后须补录处置结论
            </div>
          </section>

          <section className="card">
            <div className="ttl-row" style={{ marginBottom: 8 }}>
              <span className="ic"><AlertTriangle size={16} aria-hidden /></span>
              <span className="h">未处理告警</span>
              <div className="r"><span className="badge-s orange">{FEED.length} 待处理</span></div>
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
                <span className="help" data-tip={`(payout + 佣金) ÷ 毛流入(模型 §5.3 庞氏度量)。逼近红线 ${BR_TIGHT}% 时联动 D 域收紧 / 退出。`}>?</span>
              </div>
              <div className="v" style={{ color: currentPressure < BR_TIGHT ? "var(--success)" : "var(--danger)" }}>{currentPressure}%</div>
              <div className="d" style={{ color: currentPressure < BR_TIGHT ? "var(--success)" : "var(--danger)" }}>
                {currentPressure >= prevPressure ? "↗" : "↘"} 上窗 {prevPressure}% · 红线 {BR_TIGHT}%
              </div>
            </div>
            <div className="alarm warn">
              <div className="k">
                异常账户{" "}
                <span className="help" data-tip="命中风控规则(多开 / 套利 / 异常提现等)的账户数,来自 K 域。">?</span>
              </div>
              <div className="v" style={{ color: "var(--warning)" }}>{flaggedAccounts}</div>
              <div className="d" style={{ color: "var(--warning)" }}>{RULES.length} 类规则命中</div>
            </div>
            <div className="alarm warn">
              <div className="k">未处理告警</div>
              <div className="v">{FEED.length}</div>
              <div className="d muted">P0:{p0Count} · P1:{p1Count} · P2:{p2Count}</div>
            </div>
          </div>

          {/* 挤兑压力比趋势 */}
          <section className="card">
            <div className="ttl-row">
              <span className="ic"><Radar size={16} aria-hidden /></span>
              <span className="h">出金压力比趋势</span>
              <span className="sub">近 {BR.length} 窗口 · 红线 {BR_TIGHT}%</span>
              <div className="r"><span className="b-tag">{risingWindows} 个窗口未降 · 当前 {currentPressure}%</span></div>
            </div>
            {hasPressureSeries ? (
              <>
                <svg
                  className="chart-svg"
                  viewBox={`0 0 ${W} ${H}`}
                  preserveAspectRatio="none"
                  style={{ height: 150 }}
                  role="img"
                  aria-label={`出金压力比近 ${BR.length} 窗口趋势,当前 ${currentPressure}%,红线 ${BR_TIGHT}%`}
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
                    红线 {BR_TIGHT}%
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
              </>
            ) : (
              <div className="empty-state" style={{ minHeight: 150, display: "grid", placeItems: "center", color: "var(--ink-3)", fontSize: 13 }}>
                暂无出金压力趋势样本
              </div>
            )}
            {/* 挤兑比率副灯 — B5 持有黄/红线,J1 R1 直接引用同一 redline 配置。 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--border)", fontSize: 11.5, flexWrap: "wrap" }}>
              <span style={{ color: "var(--ink-3)" }}>
                挤兑比率(24h 提现申请 ÷ 储备){" "}
                <span className="help" data-tip={`储备生存度量,与出金压力比(流量健康,早期警戒)互补分层。黄 ${bankRunYellowPct}% 预警 · 红 ${bankRunRedlinePct}% 为 J1 提现闸自动熔断引用线(R1,J1 引用不另持)。`}>?</span>
              </span>
              <span style={{ marginLeft: "auto", fontFamily: "var(--font-jet-mono), monospace", fontWeight: 600, color: bankRunColor }}>{bankRunRatio}%</span>
              <span style={{ color: "var(--ink-4)" }}>黄 {bankRunYellowPct}% · 红 {bankRunRedlinePct}%(J1 R1 引用)</span>
              {canWriteBankRunThresholds && (
                <button type="button" className="btn ghost" onClick={() => setEditingBankRunThresholds(true)}>
                  <SlidersHorizontal size={14} aria-hidden /> 调整阈值
                </button>
              )}
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
                  style={{ width: 120, height: 120, background: severityBg }}
                >
                  <div className="hole">
                    <div>
                      <div className="big">{sevTotalRaw}</div>
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
                {VOL_ROWS.map((row, i) => {
                  const v = row.count;
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
                      <div className="lbl">{row.label}</div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </div>

      <p className="b-foot">
        出金压力比 <b>{currentPressure}%</b>,红线 {BR_TIGHT}%;异常账户 {flaggedAccounts} 个,来自 {RULES.length} 类命中规则。
        <b>{GATES_TRIPPED === 0 ? `Kill-Switch ${GATES.length - GATES_MISSING} 闸待命${GATES_MISSING ? `,${GATES_MISSING} 闸未配置` : ""}` : `Kill-Switch ${GATES_TRIPPED} / ${GATES.length} 闸已熔断`}</b>,P0 告警表示挤兑比率达到当前动态红线。手动触发需操作确认；R1 自动关停后补录 + 全站广播。
      </p>
      {editingBankRunThresholds && (
        <OperationConfirmModal
          action="调整 B5 挤兑分层阈值"
          detail={`B5 是挤兑黄线和红线的唯一配置入口。保存后风险灯、告警分级与 J1 R1 提现闸自动熔断立即读取同一红线;红线必须严格高于黄线。`}
          businessForm={{
            kind: "multi-field",
            title: "目标新值",
            hint: "黄线范围 5%–50%,红线范围 10%–80%,且红线必须高于黄线。",
            fields: [
              { key: "yellowPct", label: "预警黄线(%)", current: String(bankRunYellowPct), inputKind: "number", min: 5, max: 50, step: 0.1 },
              { key: "redlinePct", label: "自动熔断红线(%)", current: String(bankRunRedlinePct), inputKind: "number", min: 10, max: 80, step: 0.1 },
            ],
          }}
          onClose={() => setEditingBankRunThresholds(false)}
          onConfirm={async (reason, _newValue, businessValue) => {
            const yellowPct = businessValue?.yellowPct ?? "";
            const redlinePct = businessValue?.redlinePct ?? "";
            if (Number(redlinePct) <= Number(yellowPct)) {
              setToast("红线必须严格高于黄线");
              return;
            }
            try {
              await updateB5BankRunThresholds({ yellowPct, redlinePct }, reason, operator);
              await bDomain.reload();
              setEditingBankRunThresholds(false);
              setToast(`B5 挤兑阈值已更新:黄线 ${yellowPct}% · 红线 ${redlinePct}%;J1 R1 已同步引用`);
            } catch (error) {
              setToast(error instanceof Error ? error.message : "B5_BANKRUN_THRESHOLD_UPDATE_FAILED");
            }
          }}
        />
      )}
      {toastNode}
    </div>
  );
}
