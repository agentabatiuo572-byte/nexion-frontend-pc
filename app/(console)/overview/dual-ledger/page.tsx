"use client";

/**
 * B1 双账本总览(旗舰 · 只读驾驶舱)。
 * UI 严格对齐设计稿 project/「B1 双账本总览.html」3 段式:
 *   BAND1 兑付覆盖率 hero + 双账本对照卡(B-01)
 *   BAND2 运营决策卡(B-02/B-03)+ 风险雷达卡(B-05)
 *   BAND3 应付负债结构(8 科目 · 下钻 B2)
 * 顶部域标保留本项目外壳风格;其下布局端口设计稿(dual-ledger.css · .dlpage 作用域)。
 * 决策动作保留真实接线:阈值/熔断/告警处置经 Maker-Checker 双签,写 platform-config-store(persist + 审计)。
 * 数据 mock(确定性,lib/mock/admin/ledger);内部真实视角:储备 vs 应付负债。
 */
import "./dual-ledger.css";
import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Gauge,
  Layers,
  Power,
  Radar,
  Scale,
  SlidersHorizontal,
  TrendingDown,
} from "lucide-react";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { fmtUsd, fmtUsdCompact, fmtPct, fmtNum } from "@/lib/format";
import { Sparkline } from "@/app/components/kit/kpi-stat-card";
import { MakerCheckerModal, useToast } from "@/app/components/domain-views/design-kit";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";

const round2 = (n: number) => Math.round(n * 100) / 100;

// B 域驾驶舱真写落点的 setParam key(与 J 域同 key 空间共享 global 熔断)。
const KEY_REDLINE = "B.coverage.redline";
const KEY_RUN_RISK = "B.runRisk.threshold";
const KEY_KILL_GLOBAL = "J.killswitch.global";
const ALERT_ID = "coverage-redline"; // 当前唯一 P0:覆盖率跌破/逼近红线
const KEY_ALERT_ACK = `B.alert.${ALERT_ID}.ack`;
const RUN_RISK_DEFAULT = 15; // 挤兑压力红线默认(%)
const SCALE_MAX = 120; // 仪表标尺上限

// 驾驶舱决策动作(高敏,均走 Maker-Checker 双签)。
type Mc = { kind: "redline" } | { kind: "runRisk" } | { kind: "kill" } | { kind: "ack" };

export default function DualLedgerPage() {
  const {
    reserveUsd,
    liabilitiesUsd,
    coverageRatio,
    redlinePct,
    healthyPct,
    accounts,
    netFlow24hUsd,
    queueBacklogCount,
    queueBacklogUsd,
    avgRiskScore,
    coverageSeries,
    prev,
  } = LEDGER;
  const netExposure = reserveUsd - liabilitiesUsd;

  // 真写落点:阈值 / 熔断 / 告警处置统一进 platform-config-store(setParam keyed 状态 + 审计),persist + 水合门。
  const setParam = usePlatformConfig((s) => s.setParam);
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const pget = (k: string): string | undefined => (hydrated ? (params?.[k] as string | undefined) : undefined);
  const [toastNode, setToast] = useToast();
  const [mc, setMc] = useState<Mc | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  // 派生:阈值以 store 为准,缺省回落 mock / 默认(刷新后仍反映 + 即时变)。
  const effRedline = Number(pget(KEY_REDLINE) ?? redlinePct);
  const effRunRisk = Number(pget(KEY_RUN_RISK) ?? RUN_RISK_DEFAULT);
  const killActive = pget(KEY_KILL_GLOBAL) === "off";
  const alertAcked = pget(KEY_ALERT_ACK) === "true";

  // 覆盖率 zone(以生效红线判定)
  const zone = coverageRatio < effRedline ? "danger" : coverageRatio < healthyPct ? "warning" : "success";
  const zoneColor = zone === "danger" ? "var(--danger)" : zone === "warning" ? "var(--warning)" : "var(--success)";
  const zoneCls = zone === "danger" ? "err" : zone === "warning" ? "warn" : "ok";
  const zoneDot = zone === "danger" ? "red" : zone === "warning" ? "amber" : "green";
  const zoneLabel = zone === "danger" ? "跌破红线" : zone === "warning" ? "警戒 · 低于健康线" : "健康";

  // 仪表位置
  const fillPos = round2((Math.min(coverageRatio, SCALE_MAX) / SCALE_MAX) * 100);
  const redlinePos = round2((effRedline / SCALE_MAX) * 100);
  const healthyPos = round2((healthyPct / SCALE_MAX) * 100);

  const refTail =
    zone === "danger"
      ? `已跌破红线 ${(effRedline - coverageRatio).toFixed(1)}pct`
      : zone === "warning"
        ? `当前高于红线 +${(coverageRatio - effRedline).toFixed(1)}pct,但已跌破健康线`
        : `高于健康线 +${(coverageRatio - healthyPct).toFixed(1)}pct`;

  // 触红线预测:由近 8 窗口斜率外推(真实趋势,非装饰)
  const slope = (coverageSeries[coverageSeries.length - 1] - coverageSeries[0]) / (coverageSeries.length - 1);
  const windowsToRedline =
    slope < -0.01 && coverageRatio > effRedline
      ? Math.max(1, Math.round((coverageRatio - effRedline) / -slope))
      : null;
  const trendMsg = windowsToRedline != null ? `持续下行 · 按当前斜率约 ${windowsToRedline} 窗口触红线` : "趋势平稳";
  const trendColor = windowsToRedline != null ? "var(--warning)" : "var(--ink-3)";

  // 真实环比(对上一统计窗口),替代硬编码 delta
  const reserveChg = round2(((reserveUsd - prev.reserveUsd) / prev.reserveUsd) * 100);
  const outflowChg = Math.round(((Math.abs(netFlow24hUsd) - Math.abs(prev.netFlow24hUsd)) / Math.abs(prev.netFlow24hUsd)) * 100);
  const backlogChg = queueBacklogCount - prev.queueBacklogCount;
  const riskChg = avgRiskScore - prev.avgRiskScore;

  // 风险雷达 4 联(点击钻取至处置域)
  const radar: {
    label: string;
    value: string;
    valSmall?: string;
    valColor: string;
    href: string;
    arrow: string;
    deltaText: string;
    deltaColor: string;
    ext: string;
  }[] = [
    {
      label: "资金池水位(储备)", value: fmtUsdCompact(reserveUsd), valColor: "var(--ink)", href: "/finance/pool",
      arrow: reserveChg < 0 ? "↘" : "↗", deltaText: fmtPct(Math.abs(reserveChg)),
      deltaColor: reserveChg < 0 ? "var(--negative)" : "var(--success)", ext: "环比上窗口",
    },
    {
      label: "24h 净流入", value: `+${fmtUsdCompact(Math.abs(netFlow24hUsd))}`, valColor: "var(--success)", href: "/overview/liquidity",
      arrow: "↗", deltaText: `流入 +${outflowChg}%`, deltaColor: "var(--success)", ext: "较上窗口",
    },
    {
      label: "提现队列积压", value: fmtNum(queueBacklogCount), valSmall: "单", valColor: "var(--ink)", href: "/finance/withdrawals",
      arrow: backlogChg > 0 ? "↗" : "↘", deltaText: `${backlogChg > 0 ? "+" : ""}${backlogChg} 单`,
      deltaColor: "var(--warning)", ext: `· ${fmtUsdCompact(queueBacklogUsd)}`,
    },
    {
      label: "风险评分均值", value: `${avgRiskScore}`, valColor: "var(--ink)", href: "/risk/scoring",
      arrow: riskChg > 0 ? "↗" : "↘", deltaText: `${riskChg > 0 ? "+" : ""}${riskChg}`,
      deltaColor: "var(--warning)", ext: "/ 100",
    },
  ];

  // 应付负债 8 科目(占比派生)
  const liabRows = accounts.map((a) => ({ ...a, pct: round2((a.amount / liabilitiesUsd) * 100) }));

  const onMcConfirm = (reason: string, newValue?: string) => {
    if (!mc) return;
    if (mc.kind === "redline") {
      const v = round2(Number(newValue));
      if (Number.isFinite(v)) {
        setParam(KEY_REDLINE, v, { action: "调整兑付覆盖率红线阈值", reason });
        setToast(`兑付覆盖率红线已调整为 ${fmtPct(v, 0)}(A2 留痕)`);
      }
    } else if (mc.kind === "runRisk") {
      const v = round2(Number(newValue));
      if (Number.isFinite(v)) {
        setParam(KEY_RUN_RISK, v, { action: "调整挤兑压力红线阈值", reason });
        setToast(`挤兑压力红线已调整为 ${fmtPct(v, 0)}(A2 留痕)`);
      }
    } else if (mc.kind === "kill") {
      setParam(KEY_KILL_GLOBAL, "off", { action: "驾驶舱触发全局熔断", reason });
      setToast("已触发全局熔断 · 全平台放大流出停摆(A2 留痕)");
    } else {
      setParam(KEY_ALERT_ACK, "true", { action: "标记兑付红线告警已处置", reason });
      setToast("告警已标记处置(A2 留痕)");
    }
    setMc(null);
  };

  return (
    <div className="dkpage dlpage">
      {/* 顶部域标(保留本项目外壳风格)。服务端权威/实时状态由全局顶栏 SyncChip 承载,此处不再重复。 */}
      <header className="mb-5">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{ background: "color-mix(in srgb, var(--admin-domain-b) 14%, transparent)", color: "var(--admin-domain-b)", border: "1px solid color-mix(in srgb, var(--admin-domain-b) 30%, transparent)" }}
          >
            <span className="inline-block rounded-full" style={{ width: 5, height: 5, background: "var(--admin-domain-b)" }} />
            域 B · 总览驾驶舱
          </span>
          <span className="font-mono-tabular text-[11px]" style={{ color: "var(--v5-ink-4)" }}>B1</span>
        </div>
        <h1 className="font-display mt-2 text-[24px]" style={{ color: "var(--v5-ink)" }}>双账本总览</h1>
      </header>

      {/* BAND 1: 覆盖率 hero + 双账本对照 */}
      <div className="band hero-row">
        {/* 兑付覆盖率 hero */}
        <section className="card hero">
          <div className="aurora" />
          <div className="cov-head">
            <div style={{ flex: 1 }}>
              <span className="cov-label">
                <Gauge size={15} className="ttl-glyph" />
                <span>兑付覆盖率 · 储备 ÷ 应付负债</span>
                <span className="help" data-tip="兑付覆盖率 = 平台真实储备 ÷ 应付负债总额。运营内部资金安全水位,数据以服务端为准。">?</span>
              </span>
            </div>
            <span className={`status-pill ${zoneCls}`}>
              <span className={`dot ${zoneDot}`} /> {zoneLabel}
            </span>
          </div>

          <div className="cov-num" style={{ color: zoneColor }}>
            {coverageRatio.toFixed(1)}<span>%</span>
          </div>
          <div className="cov-ref">
            红线 <b>{fmtPct(effRedline, 0)}</b> · 健康 <b>{fmtPct(healthyPct, 0)}</b> · {refTail}
          </div>

          {/* zone 仪表条 */}
          <div className="track">
            <div className="green-zone" style={{ left: `${healthyPos}%`, right: 0 }} />
            <div
              className="fill"
              style={{
                width: `${fillPos}%`,
                background: `linear-gradient(90deg, ${zoneColor} 0%, color-mix(in srgb, ${zoneColor} 62%, #fff) 100%)`,
              }}
            />
            <div className="redline" style={{ left: `${redlinePos}%` }} />
            <div className="healthline" style={{ left: `${healthyPos}%` }} />
            <div className="marker" style={{ left: `${fillPos}%` }} />
          </div>
          <div className="scale">
            <span>0%</span>
            <span>红线 {fmtPct(effRedline, 0)}</span>
            <span>健康 {fmtPct(healthyPct, 0)}</span>
            <span>{fmtPct(SCALE_MAX, 0)}</span>
          </div>

          {/* 趋势 + 触红线预测 */}
          <div className="trend">
            <div className="tx">
              <div className="k">覆盖率趋势 · 近 8 窗口</div>
              <div className="v" style={{ color: trendColor }}>{trendMsg}</div>
            </div>
            <div className="spark-wrap">
              <Sparkline data={coverageSeries} color={zoneColor} />
            </div>
          </div>

          {/* 警戒/破线 → P0 告警:建议动作 + 深链 + 标记已处置 */}
          {zone !== "success" && (
            <div className={`advis${alertAcked ? " done" : ""}`}>
              <div className="row1">
                <span className="advis-ic">
                  {alertAcked ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                </span>
                <div className="msg">
                  {alertAcked ? (
                    <>
                      <b>已处置 ·</b> 已标记本轮警戒为已处置(写入 A2 审计)。覆盖率仍在监控中,跌破红线将再次置顶告警。
                    </>
                  ) : zone === "danger" ? (
                    <>
                      <b>已跌破红线:</b>立即冻结放大流出、暂停分红派发。放大资金流出动作须先核验本约束(§1.8 原则一)。
                    </>
                  ) : (
                    <>
                      <b>警戒区:</b>建议收紧大额提现、暂缓 Genesis 分红与高 APY 放大。覆盖率跌破健康线后,放大资金流出动作须先核验本约束(§1.8 原则一)。
                    </>
                  )}
                </div>
              </div>
              <div className="acts">
                {alertAcked ? (
                  <span className="muted tiny done-stamp">
                    <CheckCircle2 size={14} /> 已于本驾驶舱标记处置 · A2 留痕
                  </span>
                ) : (
                  <>
                    <Link href="/finance/withdrawals" prefetch={false} className="btn primary">
                      去复核提现 <ArrowRight size={15} />
                    </Link>
                    <button type="button" className="btn" onClick={() => setMc({ kind: "ack" })}>
                      <CheckCircle2 size={15} /> 标记已处置
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </section>

        {/* 双账本对照(B-01) */}
        <section className="card ledger-card">
          <div className="ttl-row">
            <span className="ttl-ic"><Scale size={17} /></span>
            <span className="h">双账本对照</span>
            <span className="sub">储备 vs 应付</span>
            <div className="r"><span className="b1-tag">B-01</span></div>
          </div>

          <div className="ledger-row">
            <div className="lr-head">
              <span className="lr-name">用户账本 · 应付 <small>承诺兑付</small></span>
              <span className="lr-val" style={{ color: "var(--cyan)" }}>{fmtUsdCompact(liabilitiesUsd)}</span>
            </div>
            <div className="lr-bar"><div className="f" style={{ width: "100%", background: "var(--cyan)" }} /></div>
          </div>

          <div className="ledger-row">
            <div className="lr-head">
              <span className="lr-name">平台账本 · 储备 <small>真实可用</small></span>
              <span className="lr-val" style={{ color: "var(--success)" }}>{fmtUsdCompact(reserveUsd)}</span>
            </div>
            <div className="lr-bar"><div className="f" style={{ width: `${round2(Math.min(coverageRatio, 100))}%`, background: "var(--success)" }} /></div>
            <div className="muted tiny" style={{ marginTop: 7 }}>
              储备覆盖应付的 <b style={{ color: "var(--warning)", fontWeight: 600 }}>{fmtPct(coverageRatio)}</b>(超 100% 已现盈余)→ 即当前兑付覆盖率
            </div>
          </div>

          <div className="net-box">
            <div className="nb-k">
              净敞口(储备 − 负债){" "}
              <span className="help" data-tip="净敞口 = 平台真实储备 − 应付负债总额。为负表示储备无法完全覆盖对用户的应付,即覆盖缺口。">?</span>
            </div>
            <div className="net-num" style={{ color: netExposure < 0 ? "var(--danger)" : "var(--success)" }}>
              {netExposure < 0 ? "−" : ""}{fmtUsd(Math.abs(netExposure))}
            </div>
            <div className="net-tags">
              <span className="gap-tag" style={{ color: netExposure < 0 ? "var(--danger)" : "var(--success)" }}>
                <TrendingDown size={13} /> {netExposure < 0 ? "缺口" : "盈余"}
              </span>
              <span className="muted">覆盖差额 · {fmtUsdCompact(liabilitiesUsd)} − {fmtUsdCompact(reserveUsd)}</span>
            </div>
          </div>
        </section>
      </div>

      {/* BAND 2: 运营决策 + 风险雷达 */}
      <div className="band ops-row">
        {/* 运营决策(B-02 / B-03) */}
        <section className="card">
          <div className="ttl-row">
            <span className="ttl-ic"><SlidersHorizontal size={17} /></span>
            <span className="h">运营决策 · 双签生效</span>
            <div className="r"><span className="b1-tag">B-02 / B-03</span></div>
          </div>

          <div className="dec-block">
            <div className="dec-lbl">红线阈值</div>
            <div className="thresh">
              <button
                type="button"
                className="thr"
                onClick={() => setMc({ kind: "redline" })}
                title="兑付覆盖率红线:储备覆盖率跌破此线即收紧 / 停止放大流出。点击调整(双签生效)"
              >
                <span className="ic"><SlidersHorizontal size={14} /></span>
                <span className="nm">兑付覆盖率红线</span><span className="vl">{fmtPct(effRedline, 0)}</span>
              </button>
              <button
                type="button"
                className="thr"
                onClick={() => setMc({ kind: "runRisk" })}
                title="挤兑压力红线:24h 净流出 / 储备比率超此线即触发挤兑预警。点击调整(双签生效)"
              >
                <span className="ic"><SlidersHorizontal size={14} /></span>
                <span className="nm">挤兑压力红线</span><span className="vl">{fmtPct(effRunRisk, 0)}</span>
              </button>
            </div>
          </div>

          <div className="dec-block">
            <div className="dec-lbl">紧急熔断</div>
            <div className="fuse-row">
              {killActive ? (
                <span className="fuse-active" title="全局熔断已生效:全平台放大流出(提现放行 / 分红派发 / 高 APY)已停摆。解除请前往 J1。">
                  <span className="dot red" /> 全局熔断已生效 · 放大流出停摆
                </span>
              ) : (
                <button type="button" className="btn danger" onClick={() => setMc({ kind: "kill" })}>
                  <Power size={15} /> 触发全局熔断
                </button>
              )}
              <Link href="/emergency/kill-switch" prefetch={false} className="btn ghost">
                {killActive ? "前往 J1 解除" : "管理全套业务闸"} <ArrowRight size={14} />
              </Link>
            </div>
            <div className="muted tiny" style={{ marginTop: 11 }}>
              熔断与阈值调整均为放大资金安全级动作,经 <b style={{ color: "var(--ink-2)", fontWeight: 600 }}>Maker-Checker 双人复核</b> 后生效。
            </div>
          </div>

          <div className="dec-foot">
            <div>
              <div className="muted tiny">平台真实储备</div>
              <div className="mono dec-foot-v">{fmtUsd(reserveUsd)}</div>
            </div>
            <div>
              <div className="muted tiny">应付负债总额</div>
              <div className="mono dec-foot-v">{fmtUsd(liabilitiesUsd)}</div>
            </div>
          </div>
        </section>

        {/* 风险雷达(B-05) */}
        <section className="card radar-card">
          <div className="ttl-row">
            <span className="ttl-ic"><Radar size={17} /></span>
            <span className="h">风险雷达</span>
            <span className="sub">点击钻取</span>
            <div className="r"><span className="b1-tag">B-05</span></div>
          </div>

          <div className="radar-grid">
            {radar.map((c) => (
              <Link key={c.label} href={c.href} prefetch={false} className="rt">
                <div className="rk">{c.label}</div>
                <div className="rt-foot">
                  <div className="rv" style={{ color: c.valColor }}>
                    {c.value}{c.valSmall && <small>{c.valSmall}</small>}
                  </div>
                  <div className="rd" style={{ color: c.deltaColor }}>
                    <span className="rd-main">{c.arrow} {c.deltaText}</span>{" "}
                    <span className="ext">{c.ext}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <div className="alertbar" style={{ marginTop: 14 }}>
            <span className="ico" style={{ color: "var(--warning)" }}><AlertTriangle size={16} /></span>
            <div style={{ fontSize: "12.5px" }}>
              净流出放大 + 覆盖率下行 → 雷达多维同步偏紧,建议联动复核大额提现与分红节奏。
            </div>
          </div>
        </section>
      </div>

      {/* BAND 3: 应付负债结构(下钻 B2) */}
      <section className="card">
        <div className="ttl-row">
          <span className="ttl-ic"><Layers size={17} /></span>
          <span className="h">应付负债结构</span>
          <span className="sub">用户应付项分账</span>
          <div className="r">
            <span className="liab-total">{fmtUsd(liabilitiesUsd)}</span>
            <span className="b1-tag">8 科目 · 下钻 B2</span>
          </div>
        </div>

        <div className="liab-stack">
          {liabRows.map((a, i) => {
            const isLast = i === liabRows.length - 1; // 末段 flex 吸收舍入残差,堆叠条恒满 100%
            return (
              <span
                key={a.key}
                style={{
                  width: isLast ? undefined : `${a.pct}%`,
                  flex: isLast ? "1 1 0%" : undefined,
                  background: `var(${a.catVar})`,
                  opacity: hovered != null && hovered !== i ? 0.3 : 1,
                  filter: hovered === i ? "brightness(1.15)" : "none",
                }}
                title={`${a.label} · ${fmtUsdCompact(a.amount)}`}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}
        </div>

        <div className="liab-grid">
          {liabRows.map((a, i) => (
            <div
              key={a.key}
              className="liab-item"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <span className="dot" style={{ background: `var(${a.catVar})` }} />
              <span className="nm">{a.label}</span>
              <span className="am">{fmtUsdCompact(a.amount)}</span>
              <span className="pc">{fmtPct(a.pct)}</span>
            </div>
          ))}
        </div>
      </section>

      {mc && (
        <MakerCheckerModal
          action={
            mc.kind === "redline"
              ? "调整兑付覆盖率红线阈值"
              : mc.kind === "runRisk"
                ? "调整挤兑压力红线阈值"
                : mc.kind === "kill"
                  ? "驾驶舱触发全局熔断"
                  : "标记兑付红线告警已处置"
          }
          detail={
            mc.kind === "redline"
              ? "覆盖率低于该红线即冻结放大流出、暂停分红派发。调低将放宽放大流出约束。"
              : mc.kind === "runRisk"
                ? "24h 净流出 / 储备超过该红线即判定挤兑压力,触发收紧措施。"
                : mc.kind === "kill"
                  ? "立即停摆全平台放大流出(提现放行 / 分红派发 / 高 APY 放大),与 J1 全局闸同源。可在 J1 解除。"
                  : "确认该兑付红线告警已在本驾驶舱跟进处置 · 列表将置灰收起。"
          }
          amplifies={mc.kind === "redline" || mc.kind === "kill"}
          edit={
            mc.kind === "redline"
              ? { kind: "number", current: fmtPct(effRedline, 0), unit: "%" }
              : mc.kind === "runRisk"
                ? { kind: "number", current: fmtPct(effRunRisk, 0), unit: "%" }
                : undefined
          }
          onClose={() => setMc(null)}
          onConfirm={onMcConfirm}
        />
      )}
      {toastNode}
    </div>
  );
}
