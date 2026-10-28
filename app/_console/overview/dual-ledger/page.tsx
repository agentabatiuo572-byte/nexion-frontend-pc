"use client";
import { operatorCopyText } from "@/lib/admin/operator-copy";

/**
 * B1 资金与应付款总览(旗舰驾驶舱)。
 * UI 严格对齐设计稿 project/「B1 资金与应付款总览.html」3 段式:
 *   BAND1 兑付覆盖率 hero + 双账本对照卡(B-01)
 *   BAND2 运营决策卡(B-02/B-03)+ 风险提醒卡(B-05)
 *   BAND3 应付负债结构(查看明细 B2)
 * 顶部域标保留本项目外壳风格;其下布局端口设计稿(dual-ledger.css · .dlpage 作用域)。
 * 决策动作保留真实接线:阈值写 B1、储备注入写 D3、告警确认写 B1 告警接口并进入 A2 审计。
 * 数据从 /api/admin/treasury/b-domain 读取;后端无 B 域配置时先写入 MySQL 种子再读出。
 */
import "./dual-ledger.css";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Gauge,
  Layers,
  Radar,
  Scale,
  SlidersHorizontal,
  TrendingDown,
} from "lucide-react";
import { acknowledgeBDomainAlert, useBDomainDashboard } from "@/lib/admin/b-client";
import { createD3Injection, downloadD3Csv, updateD3Thresholds } from "@/lib/admin/d-client";
import { displayAdminError, guardedFetch } from "@/lib/admin/error-messages";
import { fmtUsd, fmtUsdCompact, fmtPct, fmtNum } from "@/lib/format";
import { Sparkline as MiniSparkline } from "@/app/components/kit/kpi-stat-card";
import { TabGroup } from "@/app/components/kit/tab-group";
import {
  OperationConfirmModal,
  Sparkline as TrendSparkline,
  useToast,
  type BusinessFormValue,
} from "@/app/components/domain-views/design-kit";
import { BDomainDataState, BDomainWarnings } from "@/app/components/dashboard/b-domain-state";
import { useAdminAuth } from "@/lib/store/admin-auth";

const round2 = (n: number) => Math.round(n * 100) / 100;

const ALERT_ID = "coverage-redline"; // 当前唯一 P0:覆盖率跌破/逼近红线
const SCALE_MAX = 120; // 仪表标尺上限

// 驾驶舱决策动作(高敏,均走操作确认)。
type Mc = { kind: "threshold" | "injection" | "ack" | "export"; idempotencyKey: string };

type ExposurePoint = { date: string; netExposureUsdt: number };

function command(kind: Mc["kind"]): Mc {
  return { kind, idempotencyKey: `b1-${kind}-${crypto.randomUUID()}` };
}

export default function DualLedgerPage() {
  const bDomain = useBDomainDashboard();
  const { ledger: LEDGER, riskRadar, alerts } = bDomain;
  const operator = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "");
  const authorities = useAdminAuth((s) => s.session?.authorities ?? []);
  const canConfigureThresholds = authorities.includes("overview_b1_redline_write");
  const canInjectReserve = authorities.includes("finance_d3_injection_create");
  const canExport = authorities.includes("finance_d3_export");
  const canAcknowledge = authorities.includes("overview_b1_write");
  const [toastNode, setToast] = useToast();
  const [mc, setActionConfirm] = useState<Mc | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [exposureWindow, setExposureWindow] = useState<"7d" | "30d" | "90d">("30d");
  const [exposureSeries, setExposureSeries] = useState<ExposurePoint[]>([]);
  const [exposureError, setExposureError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        setExposureError("");
        const response = await guardedFetch(`/api/admin/treasury/net-exposure?window=${exposureWindow}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json() as {
          code?: number;
          message?: string;
          data?: { series?: ExposurePoint[] };
        };
        if (!response.ok || payload.code !== 0 || !Array.isArray(payload.data?.series)) {
          throw new Error(payload.message || `B1_NET_EXPOSURE_FAILED_${response.status}`);
        }
        setExposureSeries(payload.data.series);
      } catch (err) {
        if (controller.signal.aborted) return;
        setExposureSeries([]);
        setExposureError(displayAdminError(err));
      }
    })();
    return () => controller.abort();
  }, [exposureWindow]);

  if ((bDomain.loading && !bDomain.hasData) || bDomain.error || !bDomain.hasData) {
    return (
      <div className="dkpage dlpage">
        <header className="mb-5">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{ background: "color-mix(in srgb, var(--admin-domain-b) 14%, transparent)", color: "var(--admin-domain-b)" }}
            >
              <span className="inline-block rounded-full" style={{ width: 5, height: 5, background: "var(--admin-domain-b)" }} />
              运营总览
            </span>
            <span className="font-mono-tabular text-[11px]" style={{ color: "var(--v5-ink-4)" }}>B1</span>
          </div>
          <h1 className="font-display mt-2 text-[24px]" style={{ color: "var(--v5-ink)" }}>资金与应付款总览</h1>
        </header>
        <BDomainDataState title="资金与应付款" loading={bDomain.loading && !bDomain.error} error={bDomain.error} onRetry={bDomain.reload} />
        {toastNode}
      </div>
    );
  }

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
  const b1DataError =
    coverageSeries.length < 2
      ? "覆盖率走势数据不足，暂时无法显示"
      : accounts.length === 0
        ? "B1_LEDGER_ACCOUNTS_EMPTY"
        : "";
  if (b1DataError) {
    return (
      <div className="dkpage dlpage">
        <header className="mb-5">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{ background: "color-mix(in srgb, var(--admin-domain-b) 14%, transparent)", color: "var(--admin-domain-b)" }}
            >
              <span className="inline-block rounded-full" style={{ width: 5, height: 5, background: "var(--admin-domain-b)" }} />
              运营总览
            </span>
            <span className="font-mono-tabular text-[11px]" style={{ color: "var(--v5-ink-4)" }}>B1</span>
          </div>
          <h1 className="font-display mt-2 text-[24px]" style={{ color: "var(--v5-ink)" }}>资金与应付款总览</h1>
        </header>
        <BDomainWarnings warnings={bDomain.warnings} />
        <BDomainDataState title="资金与应付款" error={b1DataError} onRetry={bDomain.reload} />
        {toastNode}
      </div>
    );
  }
  const netExposure = reserveUsd - liabilitiesUsd;

  // 派生:阈值和熔断态均以后端接口为准。
  const effRedline = Number(redlinePct);
  const alertAcked = alerts.coverageRedlineAcked;

  // 覆盖率 zone(以生效红线判定)
  const zone = coverageRatio < effRedline ? "danger" : coverageRatio < healthyPct ? "warning" : "success";
  const zoneColor = zone === "danger" ? "var(--danger)" : zone === "warning" ? "var(--warning)" : "var(--success)";
  const zoneCls = zone === "danger" ? "err" : zone === "warning" ? "warn" : "ok";
  const zoneDot = zone === "danger" ? "red" : zone === "warning" ? "amber" : "green";
  const zoneLabel = zone === "danger" ? "跌破红线" : zone === "warning" ? "警戒（低于健康线）" : "健康";

  // 仪表位置
  const fillPos = round2((Math.min(coverageRatio, SCALE_MAX) / SCALE_MAX) * 100);
  const redlinePos = round2((effRedline / SCALE_MAX) * 100);
  const healthyPos = round2((healthyPct / SCALE_MAX) * 100);

  // 覆盖率与红线/健康线的关系必须三分(zentao #169):数值**等于**红线时既不是「高于」也没有缓冲,
  // 与 #68 在 J1 修过的是同一类缺陷 —— 二分写法把「等于」归进「高于」,于是 100% 对 100% 会报
  // 「高于红线 +0.0 个百分点」。等于时明说「触及红线 / 缓冲 0.0 个百分点」。
  const bufferPct = round2(coverageRatio - effRedline);
  const refTail =
    zone === "danger"
      ? `已跌破红线 ${(effRedline - coverageRatio).toFixed(1)} 个百分点`
      : bufferPct === 0
        ? "正好在红线上"
        : zone === "warning"
          ? `高于红线 ${bufferPct.toFixed(1)} 个百分点，但已低于健康线`
          : `高于健康线 ${round2(coverageRatio - healthyPct).toFixed(1)} 个百分点`;

  // 触红线预测:由近 8 窗口斜率外推(真实趋势,非装饰)
  const slope =
    coverageSeries.length > 1
      ? (coverageSeries[coverageSeries.length - 1] - coverageSeries[0]) / (coverageSeries.length - 1)
      : 0;
  const windowsToRedline =
    slope < -0.01 && coverageRatio > effRedline
      ? Math.max(1, Math.round((coverageRatio - effRedline) / -slope))
      : null;
  const trendMsg = windowsToRedline != null ? `持续下降，照这个速度约 ${windowsToRedline} 个时段后跌破红线` : "趋势平稳";
  const trendColor = windowsToRedline != null ? "var(--warning)" : "var(--ink-3)";

  // 真实环比(对上一统计窗口),替代硬编码 delta
  const prevReserve = Math.abs(prev.reserveUsd) > 0 ? prev.reserveUsd : reserveUsd || 1;
  const prevFlowAbs = Math.abs(prev.netFlow24hUsd) > 0 ? Math.abs(prev.netFlow24hUsd) : 1;
  const reserveChg = round2(((reserveUsd - prevReserve) / prevReserve) * 100);
  const outflowChg = Math.round(((Math.abs(netFlow24hUsd) - prevFlowAbs) / prevFlowAbs) * 100);
  const backlogChg = queueBacklogCount - prev.queueBacklogCount;
  const riskChg = avgRiskScore - prev.avgRiskScore;

  // 风险提醒 4 联(点击钻取至处置域)
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
      label: "可用储备", value: fmtUsdCompact(reserveUsd), valColor: "var(--ink)", href: "/finance/pool",
      arrow: reserveChg < 0 ? "↘" : "↗", deltaText: fmtPct(Math.abs(reserveChg)),
      deltaColor: reserveChg < 0 ? "var(--negative)" : "var(--success)", ext: "较上一时段",
    },
    {
      label: "24 小时资金净流入", value: `${netFlow24hUsd >= 0 ? "+" : "−"}${fmtUsdCompact(Math.abs(netFlow24hUsd))}`, valColor: netFlow24hUsd >= 0 ? "var(--success)" : "var(--negative)", href: "/overview/liquidity",
      arrow: netFlow24hUsd >= 0 ? "↗" : "↘", deltaText: `${netFlow24hUsd >= 0 ? "流入" : "流出"} ${outflowChg >= 0 ? "+" : ""}${outflowChg}%`, deltaColor: netFlow24hUsd >= 0 ? "var(--success)" : "var(--warning)", ext: "较上一时段",
    },
    {
      label: "待审核提现", value: fmtNum(queueBacklogCount), valSmall: "单", valColor: "var(--ink)", href: "/finance/withdrawals",
      arrow: backlogChg > 0 ? "↗" : "↘", deltaText: `${backlogChg > 0 ? "+" : ""}${backlogChg} 单`,
      deltaColor: "var(--warning)", ext: `· ${fmtUsdCompact(queueBacklogUsd)}`,
    },
    {
      label: "风险评分均值", value: `${avgRiskScore}`, valColor: "var(--ink)", href: "/risk/scoring",
      arrow: riskChg > 0 ? "↗" : "↘", deltaText: `${riskChg > 0 ? "+" : ""}${riskChg}`,
      deltaColor: "var(--warning)", ext: "/ 100",
    },
  ];

  // 应付负债科目(占比派生)
  const liabRows = accounts.map((a) => ({ ...a, pct: liabilitiesUsd > 0 ? round2((a.amount / liabilitiesUsd) * 100) : 0 }));

  const onMcConfirm = async (reason: string, _newValue?: string, businessValue?: BusinessFormValue) => {
    if (!mc) return;
    const current = mc;
    try {
      if (current.kind === "threshold") {
        const redline = round2(Number(businessValue?.redlinePct));
        const healthy = round2(Number(businessValue?.healthyPct));
        if (!Number.isFinite(redline) || redline < 80 || redline > 150) throw new Error("红线必须在 80%–150%");
        if (!Number.isFinite(healthy) || healthy < 100 || healthy > 200) throw new Error("健康线必须在 100%–200%");
        if (healthy <= redline) throw new Error("健康线必须高于红线");
        await updateD3Thresholds(
          { redlinePct: String(redline), healthyPct: String(healthy) },
          reason,
          operator,
          current.idempotencyKey,
        );
        await bDomain.reload();
        setToast(`已更新 · 红线 ${fmtPct(redline, 0)} / 健康线 ${fmtPct(healthy, 0)}`);
      } else if (current.kind === "injection") {
        const amount = Number(businessValue?.amount);
        const voucherType = businessValue?.voucherType;
        const voucher = businessValue?.voucher?.trim();
        if (!Number.isFinite(amount) || amount <= 0) throw new Error("请输入有效的注入金额");
        if (!["CHAIN", "BANK"].includes(voucherType || "")) throw new Error("请选择凭证类型");
        if (!voucher) throw new Error("请输入凭证编号或哈希");
        await createD3Injection(
          String(amount),
          `${voucherType}:${voucher}`,
          reason,
          operator,
          current.idempotencyKey,
        );
        await bDomain.reload();
        setToast("储备注入已登记，覆盖率已更新");
      } else if (current.kind === "export") {
        await downloadD3Csv("reconciliation", reason, operator, current.idempotencyKey);
        setToast("对账 CSV 已下载");
      } else {
        await acknowledgeBDomainAlert(ALERT_ID, reason, operator, current.idempotencyKey);
        await bDomain.reload();
        setToast("已标记为已处理");
      }
      setActionConfirm(null);
    } catch (err) {
      setToast(displayAdminError(err));
      throw err;
    }
  };

  return (
    <div className="dkpage dlpage">
      {/* 顶部域标(保留本项目外壳风格)。服务端权威/实时状态由全局顶栏 SyncChip 承载,此处不再重复。 */}
      <header className="mb-5">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{ background: "color-mix(in srgb, var(--admin-domain-b) 14%, transparent)", color: "var(--admin-domain-b)" }}
          >
            <span className="inline-block rounded-full" style={{ width: 5, height: 5, background: "var(--admin-domain-b)" }} />
            运营总览
          </span>
          <span className="font-mono-tabular text-[11px]" style={{ color: "var(--v5-ink-4)" }}>B1</span>
        </div>
        <h1 className="font-display mt-2 text-[24px]" style={{ color: "var(--v5-ink)" }}>资金与应付款总览</h1>
      </header>
      <BDomainWarnings warnings={bDomain.warnings} />

      {/* BAND 1: 覆盖率 hero + 双账本对照 */}
      <div className="band hero-row">
        {/* 兑付覆盖率 hero */}
        <section className="card hero">
          <div className="aurora" />
          <div className="cov-head">
            <div style={{ flex: 1 }}>
              <span className="cov-label">
                <Gauge size={15} className="ttl-glyph" />
                <span>兑付覆盖率 · 可用储备 ÷ 应付款</span>
                <span className="help" data-tip="平台手上能动用的钱，够付用户应得款项的多少。只在后台显示。">?</span>
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
              <div className="k">覆盖率趋势 · 近 8 个时段</div>
              <div className="v" style={{ color: trendColor }}>{trendMsg}</div>
            </div>
            <div className="spark-wrap">
              <MiniSparkline data={coverageSeries} color={zoneColor} />
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
                      <b>已处理</b> · 覆盖率仍在监控，再次跌破红线会重新提醒。
                    </>
                  ) : zone === "danger" ? (
                    <>
                      <b>已跌破红线：</b>请立即暂停会多付钱的操作和收益发放。
                    </>
                  ) : (
                    <>
                      <b>警戒区：</b>建议收紧大额提现，暂缓创世节点分红和调高年化收益。
                    </>
                  )}
                </div>
              </div>
              <div className="acts">
                {alertAcked ? (
                  <span className="muted tiny done-stamp">
                    <CheckCircle2 size={14} /> 已标记为已处理
                  </span>
                ) : (
                  <>
                    <Link href="/finance/withdrawals" prefetch={false} className="btn primary">
                      去确认提现 <ArrowRight size={15} />
                    </Link>
                    {canAcknowledge && (
                      <button type="button" className="btn" onClick={() => setActionConfirm(command("ack"))}>
                        <CheckCircle2 size={15} /> 标记已处理
                      </button>
                    )}
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
            <span className="h">两本账对照</span>
            <span className="sub">储备与应付款</span>
            <div className="r"><span className="b1-tag">B-01</span></div>
          </div>

          <div className="ledger-row">
            <div className="lr-head">
              <span className="lr-name">应付款 <small>欠用户的钱</small></span>
              <span className="lr-val" style={{ color: "var(--cyan)" }}>{fmtUsdCompact(liabilitiesUsd)}</span>
            </div>
            <div className="lr-bar"><div className="f" style={{ width: "100%", background: "var(--cyan)" }} /></div>
          </div>

          <div className="ledger-row">
            <div className="lr-head">
              <span className="lr-name">可用储备 <small>手上能动用的钱</small></span>
              <span className="lr-val" style={{ color: "var(--success)" }}>{fmtUsdCompact(reserveUsd)}</span>
            </div>
            <div className="lr-bar"><div className="f" style={{ width: `${round2(Math.min(coverageRatio, 100))}%`, background: "var(--success)" }} /></div>
            <div className="muted tiny" style={{ marginTop: 7 }}>
              储备够付应付款的 <b style={{ color: "var(--warning)", fontWeight: 600 }}>{fmtPct(coverageRatio)}</b>
              {/* 「超 100% 已现盈余」只在严格大于 100% 时成立;等于 100% 是刚好覆盖、无盈余(zentao #169)。 */}
              {round2(coverageRatio - 100) > 0 ? "（有富余）" : round2(coverageRatio - 100) === 0 ? "（刚好够）" : "（不够付）"}，也就是当前兑付覆盖率
            </div>
          </div>

          <div className="net-box">
            <div className="nb-k">
              储备 − 应付款{" "}
              <span className="help" data-tip="为负数表示储备不够付用户的应得款项。">?</span>
            </div>
            <div className="net-num" style={{ color: netExposure < 0 ? "var(--danger)" : "var(--success)" }}>
              {netExposure < 0 ? "−" : ""}{fmtUsd(Math.abs(netExposure))}
            </div>
            <div className="net-tags">
              {/* 敞口为 0 时既不是缺口也不是盈余,是持平(zentao #169):旧写法把 0 归进「盈余」。 */}
              <span className="gap-tag" style={{ color: netExposure < 0 ? "var(--danger)" : netExposure > 0 ? "var(--success)" : "var(--v5-ink-3)" }}>
                <TrendingDown size={13} /> {netExposure < 0 ? "不够付" : netExposure > 0 ? "有富余" : "刚好够"}
              </span>
              <span className="muted">{fmtUsdCompact(reserveUsd)} − {fmtUsdCompact(liabilitiesUsd)}</span>
            </div>
          </div>
        </section>
      </div>

      {/* BAND 2: 运营决策 + 风险提醒 */}
      <div className="band ops-row">
        {/* 运营决策(B-02 / B-03) */}
        <section className="card">
          <div className="ttl-row">
            <span className="ttl-ic"><SlidersHorizontal size={17} /></span>
            <span className="h">可执行的操作</span>
            <div className="r"><span className="b1-tag">B-02 / B-03</span></div>
          </div>

          <div className="dec-block">
            <div className="dec-lbl">资金安全操作</div>
            <div className="thresh">
              {canConfigureThresholds && (
                <button
                  type="button"
                  className="thr"
                  onClick={() => setActionConfirm(command("threshold"))}
                  title="调整兑付覆盖率的红线和健康线，健康线须高于红线"
                >
                  <span className="ic"><SlidersHorizontal size={14} /></span>
                  <span className="nm">红线 / 健康线</span><span className="vl">{fmtPct(effRedline, 0)} / {fmtPct(healthyPct, 0)}</span>
                </button>
              )}
              {canInjectReserve && (
                <button type="button" className="thr" onClick={() => setActionConfirm(command("injection"))}>
                  <span className="ic"><Layers size={14} /></span>
                  <span className="nm">登记储备注入</span><span className="vl">新增到账资金</span>
                </button>
              )}
            </div>
            {!canConfigureThresholds && !canInjectReserve && (
              <div className="muted tiny">你只能查看；调整红线和登记注入需财务负责人或超级管理员。</div>
            )}
          </div>

          <div className="dec-block">
            <div className="dec-lbl">紧急处理</div>
            <div className="fuse-row">
              <Link href="/emergency/kill-switch" prefetch={false} className="btn ghost">
                前往紧急停用开关 <ArrowRight size={14} />
              </Link>
            </div>
            <div className="muted tiny" style={{ marginTop: 11 }}>
              这页只给出提醒和建议，不会自动收紧提现或暂停业务。
            </div>
          </div>

          <div className="dec-foot">
            <div>
              <div className="muted tiny">可用储备</div>
              <div className="mono dec-foot-v">{fmtUsd(reserveUsd)}</div>
            </div>
            <div>
              <div className="muted tiny">应付款总额</div>
              <div className="mono dec-foot-v">{fmtUsd(liabilitiesUsd)}</div>
            </div>
          </div>
        </section>

        {/* 风险提醒(B-05) */}
        <section className="card radar-card">
          <div className="ttl-row">
            <span className="ttl-ic"><Radar size={17} /></span>
            <span className="h">风险提醒</span>
            <span className="sub">点击查看详情</span>
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
              {netFlow24hUsd >= 0 ? "资金在净流入" : "资金在净流出"}，结合覆盖率走势，建议持续关注大额提现和奖励发放节奏。
            </div>
          </div>
        </section>
      </div>

      {/* BAND 3: 净敞口趋势与对账导出 */}
      <section className="card">
        <div className="ttl-row">
          <span className="ttl-ic"><TrendingDown size={17} /></span>
          <span className="h">储备与应付款差额趋势</span>
          <span className="sub">储备 − 应付款</span>
          <div className="r" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* 互斥时间范围必须暴露「当前选中项」(zentao #159)。此前三个按钮只有
                aria-pressed:浏览器把 aria-pressed 按钮当 toggle button,读屏按复选框朗读
                (「30 天,已按下」),运营无法判断这是一组单选。TabGroup 给 role=tablist +
                role=tab + aria-selected + roving tabindex,方向键即可切换。 */}
            <TabGroup<"7d" | "30d" | "90d">
              className="r"
              label="储备与应付款差额趋势时间范围"
              value={exposureWindow}
              items={["7d", "30d", "90d"] as const}
              onSelect={setExposureWindow}
              itemClassName={(_v, selected) => (selected ? "btn primary" : "btn ghost")}
            >{(window) => `${window.slice(0, -1)} 天`}</TabGroup>
            {canExport && (
              <button
                type="button"
                className="btn"
                onClick={() => setActionConfirm(command("export"))}
              >
                导出对账 CSV
              </button>
            )}
          </div>
        </div>
        {exposureError ? (
          <BDomainDataState
            title="储备与应付款差额趋势暂不可用"
            error={`${exposureError}，已暂停显示。`}
          />
        ) : exposureSeries.length === 0 ? (
          <div className="alertbar">
            <AlertTriangle size={16} />
            这段时间暂无数据。
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 24, alignItems: "end" }}>
            <div aria-label={`${exposureWindow} 储备与应付款差额趋势图`}>
              <TrendSparkline
                data={exposureSeries.map((point) => point.netExposureUsdt)}
                color={exposureSeries.at(-1)!.netExposureUsdt < 0 ? "var(--danger)" : "var(--success)"}
                fill
                h={92}
              />
            </div>
            <div style={{ minWidth: 210 }}>
              <div className="muted tiny">截至 {exposureSeries.at(-1)!.date}</div>
              <div
                className="mono dec-foot-v"
                style={{ color: exposureSeries.at(-1)!.netExposureUsdt < 0 ? "var(--danger)" : "var(--success)" }}
              >
                {fmtUsd(exposureSeries.at(-1)!.netExposureUsdt)}
              </div>
              <div className="muted tiny">共 {exposureSeries.length} 天</div>
            </div>
          </div>
        )}
      </section>

      {/* BAND 4: 应付负债结构(查看明细 B2) */}
      <section className="card">
        <div className="ttl-row">
          <span className="ttl-ic"><Layers size={17} /></span>
          <span className="h">应付款构成</span>
          <span className="sub">按类型</span>
          <div className="r">
            <span className="liab-total">{fmtUsd(liabilitiesUsd)}</span>
            <span className="b1-tag">{liabRows.length} 类应付款 · 明细见「可用资金与应付款」</span>
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
                  background: `var(${a.cat})`,
                  opacity: hovered != null && hovered !== i ? 0.3 : 1,
                  filter: hovered === i ? "brightness(1.15)" : "none",
                }}
                title={`${operatorCopyText(a.label)} · ${fmtUsdCompact(a.amount)}`}
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
              <span className="dot" style={{ background: `var(${a.cat})` }} />
              <span className="nm">{operatorCopyText(a.label)}</span>
              <span className="am">{fmtUsdCompact(a.amount)}</span>
              <span className="pc">{fmtPct(a.pct)}</span>
            </div>
          ))}
        </div>
      </section>

      {mc && (
        <OperationConfirmModal
          action={
            mc.kind === "threshold"
              ? "设置兑付覆盖率红线和健康线"
              : mc.kind === "injection"
                ? "登记储备注入"
                : mc.kind === "export" ? "导出对账 CSV" : "标记覆盖率告警已处理"
          }
          detail={
            mc.kind === "threshold"
              ? "低于红线会触发高风险告警；高于健康线表示资金恢复健康。健康线须高于红线。这里只发提醒，不会自动处理资金。"
              : mc.kind === "injection"
                ? "填写实际到账金额和链上交易哈希或银行流水号，提交后储备和覆盖率会随之更新。"
                : mc.kind === "export" ? "导出当前的对账明细。" : "确认已跟进当前的覆盖率告警。覆盖率已恢复健康时无需标记。"
          }
          amplifies={mc.kind === "threshold"}
          businessForm={
            mc.kind === "threshold"
              ? {
                  kind: "multi-field",
                  title: "覆盖率阈值",
                  hint: "红线可设 80%–150%，健康线可设 100%–200%，健康线须高于红线。",
                  requireAnyChange: true,
                  fields: [
                    { key: "redlinePct", label: "红线 (%)", current: String(effRedline), inputKind: "number", min: 80, max: 150, step: 0.1, required: true, showDiff: true },
                    { key: "healthyPct", label: "健康线 (%)", current: String(healthyPct), inputKind: "number", min: 100, max: 200, step: 0.1, required: true, showDiff: true },
                  ],
                }
              : mc.kind === "injection"
                ? {
                    kind: "multi-field",
                    title: "到账凭证",
                    hint: "凭证必须能查到。如果提交结果没确认，可以放心重试，不会重复登记。",
                    fields: [
                      { key: "amount", label: "注入金额 (USDT)", inputKind: "number", min: 0.01, step: 0.01, required: true },
                      {
                        key: "voucherType",
                        label: "凭证类型",
                        inputKind: "select",
                        options: ["CHAIN", "BANK"],
                        optionLabels: { CHAIN: "链上交易哈希", BANK: "银行流水号" },
                        required: true,
                      },
                      { key: "voucher", label: "凭证编号 / 哈希", inputKind: "text", required: true, placeholder: "至少 6 位，须能查到" },
                    ],
                  }
                : undefined
          }
          reasonMin={8}
          reasonMax={200}
          onClose={() => setActionConfirm(null)}
          onConfirm={onMcConfirm}
        />
      )}
      {toastNode}
    </div>
  );
}
