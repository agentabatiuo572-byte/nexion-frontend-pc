"use client";

/**
 * B2 资金池水位 · 应付负债科目(设计稿 FundPool 模式)。
 * 堆叠条(按金额占比)+ 图例 + 最大科目 + 储备覆盖缺口。数据来自 B 域聚合接口。
 */
import Link from "next/link";
import { useBDomainDashboard } from "@/lib/admin/b-client";
import { fmtUsdCompact, fmtPct } from "@/lib/format";
import { AutoGloss } from "@/app/components/kit/gloss";
import { BDomainDataState } from "@/app/components/dashboard/b-domain-state";

const r2 = (n: number) => Math.round(n * 100) / 100;

export function FundPool() {
  const bDomain = useBDomainDashboard();
  const { ledger: LEDGER, liquidity } = bDomain;
  if ((bDomain.loading && !bDomain.hasData) || bDomain.error || !bDomain.hasData) {
    return <BDomainDataState title="B2 资金池水位" loading={bDomain.loading && !bDomain.error} error={bDomain.error} onRetry={bDomain.reload} />;
  }
  const total = LEDGER.liabilitiesUsd;
  const accounts = [...LEDGER.accounts].sort((a, b) => b.amount - a.amount);
  if (!accounts.length || !liquidity.runway.length) {
    return <BDomainDataState title="B2 资金池水位" error="B2_REQUIRED_DATA_EMPTY" onRetry={bDomain.reload} />;
  }
  const top = accounts[0];
  const net = LEDGER.reserveUsd - total;
  const runway = liquidity.runway;
  const maxDay = Math.max(...runway.map((m) => m.valueWan), 1);

  return (
    <div className="flex h-full flex-col rounded-[16px] p-5" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
      <div className="flex items-center gap-2.5">
        <span className="font-display text-[14.5px]" style={{ color: "var(--v5-ink)" }}><AutoGloss>资金池水位 · {accounts.length} 类应付负债科目</AutoGloss></span>
        <span className="ml-auto font-mono-tabular rounded-[7px] px-2 py-0.5 text-[11px]" style={{ background: "var(--v5-surface-3)", color: "var(--v5-ink-3)", border: "1px solid var(--v5-border)" }}><AutoGloss>B2 · 口径同 D3</AutoGloss></span>
      </div>
      <p className="mt-1 text-[12px]" style={{ color: "var(--v5-ink-4)" }}><AutoGloss>应付负债合计 </AutoGloss>{fmtUsdCompact(total)}<AutoGloss> · 须由储备覆盖</AutoGloss></p>

      {/* 堆叠条 */}
      <div className="mt-3.5 flex overflow-hidden rounded-[7px]" style={{ height: 16, border: "1px solid var(--v5-border)" }}>
        {accounts.map((a) => (
          <span key={a.key} title={`${a.label} ${fmtUsdCompact(a.amount)}`} style={{ width: `${total > 0 ? (a.amount / total) * 100 : 0}%`, background: `var(${a.cat})` }} />
        ))}
      </div>

      {/* 图例 */}
      <div className="mt-3.5 grid gap-x-4 gap-y-2 [grid-template-columns:repeat(2,1fr)] sm:[grid-template-columns:repeat(4,1fr)]">
        {accounts.map((a) => (
          <div key={a.key} className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: `var(${a.cat})` }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11.5px]" style={{ color: "var(--v5-ink-2)" }}><AutoGloss>{a.label}</AutoGloss></p>
              <p className="font-mono-tabular text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>{fmtUsdCompact(a.amount)} · {fmtPct(total > 0 ? r2((a.amount / total) * 100) : 0, 0)}</p>
            </div>
          </div>
        ))}
      </div>

      <hr className="my-4 border-0" style={{ height: 1, background: "var(--v5-border)" }} />
      <div className="flex items-center justify-between gap-3 text-[12.5px]">
        <span style={{ color: "var(--v5-ink-3)" }}>最大科目</span>
        <span style={{ color: "var(--v5-ink-2)" }}>
          <AutoGloss>{top.label}</AutoGloss> <span className="font-mono-tabular" style={{ color: "var(--v5-ink)" }}>{fmtUsdCompact(top.amount)}</span> · {fmtPct(total > 0 ? r2((top.amount / total) * 100) : 0, 0)}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[12.5px]">
        <span style={{ color: "var(--v5-ink-3)" }}>储备覆盖缺口</span>
        <span className="font-mono-tabular" style={{ color: net < 0 ? "var(--v5-danger)" : "var(--v5-success)", fontWeight: 600 }}>{fmtUsdCompact(net)}</span>
      </div>
      {/* 到期预测(未来 7d)*/}
      <hr className="my-4 border-0" style={{ height: 1, background: "var(--v5-border)" }} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-[13px]" style={{ color: "var(--v5-ink)", fontWeight: 600 }}>到期预测(未来 7d)</span>
        <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: "var(--v5-ink-3)" }}><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--v5-success)" }} />到期兑付</span>
        <span className="ml-auto text-[11px]" style={{ color: "var(--v5-ink-4)" }}><AutoGloss>后端 B2 runway 配置口径</AutoGloss></span>
      </div>
      <div className="mt-3 flex items-end gap-2" style={{ height: 96 }}>
        {runway.map((m) => {
          const tot = m.valueWan * 10000;
          const h = `${(m.valueWan / maxDay) * 72}px`;
          return (
            <div key={m.day} className="flex flex-1 flex-col items-center gap-1.5">
              <span className="font-mono-tabular text-[9.5px]" style={{ color: "var(--v5-ink-4)" }}>{fmtUsdCompact(tot)}</span>
              <div className="flex w-full max-w-[34px] flex-col justify-end overflow-hidden rounded-[6px]" style={{ height: 72 }}>
                <div style={{ background: "var(--v5-success)", height: h }} />
              </div>
              <span className="font-mono-tabular text-[10px]" style={{ color: "var(--v5-ink-4)" }}>{m.day.replace("D+", "+")}</span>
            </div>
          );
        })}
      </div>
      <Link href="/overview/dual-ledger" prefetch={false} className="mt-auto inline-flex pt-3 text-[12.5px]" style={{ color: "var(--v5-brand)" }}>下钻 B2 负债结构 →</Link>
    </div>
  );
}
