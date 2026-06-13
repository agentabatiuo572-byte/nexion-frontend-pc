"use client";

/**
 * B1 双账本总览 · 兑付覆盖率 hero(设计稿 CoverageHero 模式)。
 * 大数 + 状态灯 + 横向分区条(红/黄/绿)+ 当前标记 + 阈值图例 + 三账本子卡 + 溯源脚注。
 * 数字全部取自 canonical LEDGER(储备 ÷ 应付负债);server-canonical,前端只读展示。
 */
import Link from "next/link";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { fmtUsdCompact } from "@/lib/format";
import { AutoGloss } from "@/app/components/kit/gloss";

const r2 = (n: number) => Math.round(n * 100) / 100;

export function CoverageHero() {
  const cov = LEDGER.coverageRatio;
  const { redlinePct: red, healthyPct: healthy, reserveUsd, liabilitiesUsd, coverageSeries: cs } = LEDGER;
  const net = reserveUsd - liabilitiesUsd; // 净敞口(负 = 缺口)

  const zone = cov < red ? "danger" : cov < healthy ? "warning" : "success";
  const zoneVar = zone === "danger" ? "var(--v5-danger)" : zone === "warning" ? "var(--v5-warning)" : "var(--v5-success)";
  const zoneLabel = zone === "danger" ? "跌破红线" : zone === "warning" ? "警戒" : "健康";
  const deltaPp = r2(cs[cs.length - 1] - cs[cs.length - 2]); // 较上窗口
  const trendPp = r2(cs[cs.length - 1] - cs[0]); // 近 8 窗口

  // 横向分区条量程(90%–130%):红 < 红线、黄 红线→健康线、绿 ≥ 健康线(容纳 m7 绿区 118 + 头寸)
  const lo = 90;
  const hi = 130;
  const rng = hi - lo;
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - lo) / rng) * 100));
  const track = `linear-gradient(90deg,
    var(--v5-danger) 0%, var(--v5-danger) ${pos(red)}%,
    var(--v5-warning) ${pos(red)}%, var(--v5-warning) ${pos(healthy)}%,
    var(--v5-success) ${pos(healthy)}%, var(--v5-success) 100%)`;

  const legend = [
    { dot: "var(--v5-danger)", nm: "红线", vl: `${red}%` },
    { dot: "var(--v5-success)", nm: "健康线", vl: `${healthy}%` },
    { dot: zoneVar, nm: "当前", vl: `${cov.toFixed(1)}%`, strong: true },
  ];
  const tiles = [
    { k: "真实储备账本", v: fmtUsdCompact(reserveUsd), cap: "口径同 D3 · 实时聚合" },
    { k: "应付负债账本", v: fmtUsdCompact(liabilitiesUsd), cap: "8 类科目汇总 → B2" },
    { k: "净敞口(储备 − 负债)", v: fmtUsdCompact(net), cap: net < 0 ? "覆盖率 <100% · 兑付缺口" : "30d 趋势 →", tone: net < 0 ? "var(--v5-danger)" : "var(--v5-success)" },
  ];

  return (
    <div className="relative h-full overflow-hidden rounded-[16px] p-6" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
      {/* 状态色微辉光 — 克制,不喧宾夺主 */}
      <span
        className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full"
        style={{ background: `radial-gradient(circle, color-mix(in srgb, ${zoneVar} 13%, transparent), transparent 65%)` }}
        aria-hidden
      />

      {/* 顶栏:B1 + 标题 + server-canonical */}
      <div className="relative flex flex-wrap items-center gap-2.5">
        <span className="font-mono-tabular rounded-[7px] px-2 py-0.5 text-[11px]" style={{ background: "var(--v5-surface-2)", color: "var(--v5-ink-4)", border: "1px solid var(--v5-border)" }}>B1</span>
        <span className="font-display text-[14.5px]" style={{ color: "var(--v5-ink)" }}>双账本总览 · <AutoGloss>兑付覆盖率</AutoGloss></span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-[7px] px-2 py-0.5 font-mono-tabular text-[11px]" style={{ background: "var(--v5-tech-cyan-soft)", color: "var(--v5-tech-cyan)", border: "1px solid var(--v5-tech-cyan-border)" }}>
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--v5-tech-cyan)" }} />
          server-canonical
        </span>
      </div>

      {/* 主区:大数 + 阈值图例 */}
      <div className="relative mt-4 flex flex-wrap items-end gap-7">
        <div className="min-w-[230px] flex-1">
          <div className="font-mono-tabular leading-[0.92]" style={{ fontSize: 60, fontWeight: 600, letterSpacing: "-0.035em", color: zoneVar }}>
            {cov.toFixed(1)}
            <span style={{ fontSize: 28, color: "var(--v5-ink-3)", marginLeft: 3 }}>%</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-medium" style={{ background: `color-mix(in srgb, ${zoneVar} 14%, transparent)`, color: zoneVar, border: `1px solid color-mix(in srgb, ${zoneVar} 40%, transparent)` }}>
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: zoneVar }} />
              {zoneLabel}
            </span>
            <span className="font-mono-tabular text-[12px]" style={{ color: "var(--v5-ink-4)", fontWeight: 500 }}>
              {deltaPp <= 0 ? "↓" : "↑"} {Math.abs(deltaPp)}pp 较上窗口 · 近8窗口 {trendPp <= 0 ? "↓" : "↑"}{Math.abs(trendPp)}pp
            </span>
          </div>
          <p className="mt-2 text-[12px]" style={{ color: "var(--v5-ink-4)" }}><AutoGloss>储备 ÷ 应付负债 · 运营内部真实口径(独立于用户侧叙事)</AutoGloss></p>
        </div>

        <div className="min-w-[224px] overflow-hidden rounded-[12px]" style={{ border: "1px solid var(--v5-border)", background: "rgba(255,255,255,0.02)" }}>
          {legend.map((r) => (
            <div key={r.nm} className="flex items-center gap-2.5 px-3 py-2 text-[12.5px]" style={{ borderBottom: "1px solid var(--v5-border)" }}>
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: r.dot }} />
              <span style={{ color: "var(--v5-ink-3)" }}><AutoGloss>{r.nm}</AutoGloss></span>
              <span className="font-mono-tabular ml-auto" style={{ color: r.strong ? zoneVar : "var(--v5-ink-2)", fontWeight: 600 }}>{r.vl}</span>
            </div>
          ))}
          <div className="flex items-center gap-2.5 px-3 py-2 text-[12.5px]" style={{ background: "rgba(255,255,255,0.02)" }}>
            <span style={{ color: "var(--v5-ink-3)" }}><AutoGloss>距红线</AutoGloss></span>
            <span className="font-mono-tabular ml-auto" style={{ color: zoneVar, fontWeight: 600 }}>{cov - red >= 0 ? "+" : ""}{r2(cov - red)}pp</span>
          </div>
        </div>
      </div>

      {/* 横向分区条 + 当前标记(标记上显示当前覆盖率)*/}
      <div className="relative mt-8">
        <div className="relative" style={{ height: 9, borderRadius: 999, background: track, opacity: 0.9 }}>
          <span
            className="font-mono-tabular absolute"
            style={{ left: `${pos(cov)}%`, top: -22, transform: "translateX(-50%)", fontSize: 11, fontWeight: 600, color: zoneVar, whiteSpace: "nowrap" }}
            aria-hidden
          >
            {cov.toFixed(1)}%
          </span>
          <span
            className="absolute"
            style={{ left: `${pos(cov)}%`, top: -5, width: 3, height: 19, borderRadius: 2, background: "var(--v5-ink)", boxShadow: "0 0 0 3px var(--v5-bg)" }}
            aria-hidden
          />
        </div>
        <div className="mt-2 flex justify-between font-mono-tabular text-[10px]" style={{ color: "var(--v5-ink-4)" }}>
          <span>{lo}%</span>
          <span>红线 {red}%</span>
          <span>健康 {healthy}%</span>
          <span>{hi}%</span>
        </div>
      </div>

      {/* 三账本子卡 */}
      <div className="relative mt-4 flex flex-wrap gap-3">
        {tiles.map((t) => (
          <Link
            key={t.k}
            href="/overview/dual-ledger"
            prefetch={false}
            className="min-w-[168px] flex-1 rounded-[10px] border border-[var(--v5-border)] p-3.5 transition-colors hover:border-[var(--v5-border-strong)]"
            style={{ background: "var(--v5-surface-2)" }}
          >
            <p className="text-[11.5px]" style={{ color: "var(--v5-ink-3)" }}><AutoGloss>{t.k}</AutoGloss></p>
            <p className="font-mono-tabular mt-0.5" style={{ fontSize: 21, fontWeight: 600, color: t.tone ?? "var(--v5-ink)" }}>{t.v}</p>
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--v5-ink-4)" }}><AutoGloss>{t.cap}</AutoGloss></p>
          </Link>
        ))}
      </div>
    </div>
  );
}
