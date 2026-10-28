"use client";

/**
 * B1 净敞口曲线 · 30d · USDT(设计稿 ExposureCard 模式)。
 * 净敞口 = 储备 − 应付负债。数据来自 B 域真实聚合接口。
 */
import Link from "next/link";
import { useBDomainDashboard } from "@/lib/admin/b-client";
import { AreaChart } from "@/app/components/kit/charts/area-chart";
import { fmtUsdCompact, fmtPct } from "@/lib/format";
import { AutoGloss } from "@/app/components/kit/gloss";
import { BDomainDataState } from "@/app/components/dashboard/b-domain-state";

export function ExposureCard() {
  const bDomain = useBDomainDashboard();
  const { ledger: LEDGER } = bDomain;
  if ((bDomain.loading && !bDomain.hasData) || bDomain.error || !bDomain.hasData) {
    return <BDomainDataState title="储备与应付款差额" loading={bDomain.loading && !bDomain.error} error={bDomain.error} onRetry={bDomain.reload} />;
  }
  const { reserveUsd, liabilitiesUsd, coverageSeries: cs, redlinePct: red } = LEDGER;
  const net = reserveUsd - liabilitiesUsd; // 精确净敞口(与 hero 子卡一致)
  const deficit = net < 0;
  const tone = deficit ? "var(--v5-danger)" : "var(--v5-success)";
  if (cs.length < 2) {
    return <BDomainDataState title="储备与应付款差额" error="走势数据不足，暂时无法显示" onRetry={bDomain.reload} />;
  }
  // 由覆盖率序列推导净敞口走势(储备 = 负债 × cov%,净敞口 = 储备 − 负债)
  const series = cs;
  const netSeries = series.map((c) => Math.round(liabilitiesUsd * (c / 100 - 1)));
  const cov = LEDGER.coverageRatio;
  const slope = series.length > 1 ? (series[series.length - 1] - series[0]) / (series.length - 1) : 0;
  const windowsToRedline = slope < -0.01 && cov > red ? Math.max(1, Math.round((cov - red) / -slope)) : null;

  return (
    <div className="flex h-full flex-col rounded-[16px] p-5" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
      <div className="flex items-center gap-2.5">
        <span className="font-display text-[14.5px]" style={{ color: "var(--v5-ink)" }}>储备与应付款差额</span>
        <span className="text-[12px]" style={{ color: "var(--v5-ink-4)" }}>30 天 · USDT</span>
        <span className="ml-auto font-mono-tabular rounded-[7px] px-2 py-0.5 text-[11px]" style={{ background: "var(--v5-surface-2)", color: "var(--v5-ink-4)", border: "1px solid var(--v5-border)" }}>B1</span>
      </div>
      <div className="font-mono-tabular mt-1.5" style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em", color: tone }}>{fmtUsdCompact(net)}</div>
      <p className="mb-2.5 mt-0.5 text-[12px]" style={{ color: deficit ? "var(--v5-warning)" : "var(--v5-success)" }}>
        <AutoGloss>{deficit ? "储备少于应付款，不够付" : "储备多于应付款，运行正常"}</AutoGloss>
      </p>
      <AreaChart data={netSeries} color={tone} height={96} />
      <div className="mt-2 flex items-center justify-between font-mono-tabular text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>
        <span>30 天前 {fmtUsdCompact(netSeries[0])}</span>
        <span style={{ color: tone }}>今日 {fmtUsdCompact(net)}</span>
      </div>
      {windowsToRedline != null && (
        <p className="mt-2 text-[11.5px]" style={{ color: "var(--v5-warning)" }}><AutoGloss>覆盖率在下降，照这个速度约 </AutoGloss>{windowsToRedline}<AutoGloss> 个时段后跌破红线 </AutoGloss>{fmtPct(red, 0)}</p>
      )}
      <hr className="mb-3 mt-auto border-0" style={{ height: 1, background: "var(--v5-border)" }} />
      <div className="flex items-center justify-between gap-3 py-1 text-[12.5px]">
        <span style={{ color: "var(--v5-ink-3)" }}>数据范围</span>
        <span style={{ color: "var(--v5-ink-2)" }}>仅后台可见</span>
      </div>
      <div className="flex items-center justify-between gap-3 py-1 text-[12.5px]">
        <span style={{ color: "var(--v5-ink-3)" }}>告警渠道</span>
        <span style={{ color: "var(--v5-ink-2)" }}>站内 + 邮件</span>
      </div>
      <Link href="/overview/dual-ledger" prefetch={false} className="mt-3 inline-flex text-[12.5px]" style={{ color: "var(--v5-brand)" }}><AutoGloss>查看资金总览 →</AutoGloss></Link>
    </div>
  );
}
