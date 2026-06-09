"use client";

/**
 * 八项 KPI 验收墙(§17.2)— 设计稿 KpiCard 模式:
 * 模块码 KPI #n + 达标/未达标 徽标 + 大数(达标色)+ sparkline + 目标;点击下钻 modal(口径/数据源/可见性)。
 */
import { useEffect, useRef, useState } from "react";
import { Sparkline } from "@/app/components/kit/kpi-stat-card";
import { AreaChart } from "@/app/components/kit/charts/area-chart";
import type { Kpi } from "@/lib/mock/admin/command-center";
import { AutoGloss } from "@/app/components/kit/gloss";

export function KpiWall({ kpis }: { kpis: Kpi[] }) {
  const passed = kpis.filter((k) => k.pass).length;
  const [sel, setSel] = useState<{ kpi: Kpi; n: number } | null>(null);

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--v5-ink-4)" }}>
          八项 KPI 验收墙 · 可下钻
        </p>
        <span className="text-[11.5px]" style={{ color: "var(--v5-ink-3)" }}>
          达标 <span style={{ color: "var(--v5-success)" }}>{passed}</span> / 未达{" "}
          <span style={{ color: "var(--v5-danger)" }}>{kpis.length - passed}</span>
        </span>
      </div>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
        {kpis.map((k, i) => {
          const color = k.pass ? "var(--v5-success)" : "var(--v5-danger)";
          return (
            <button
              key={k.key}
              type="button"
              onClick={() => setSel({ kpi: k, n: i + 1 })}
              className="rounded-[12px] border border-[var(--v5-border)] p-3.5 text-left transition-colors hover:border-[var(--v5-border-strong)]"
              style={{ background: "var(--v5-surface)" }}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono-tabular rounded-[6px] px-1.5 py-0.5 text-[10.5px]" style={{ background: "var(--v5-brand-soft)", color: "var(--v5-brand)", border: "1px solid var(--v5-brand-border)" }}>KPI #{i + 1}</span>
                <span className="ml-auto inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[10.5px] font-medium" style={{ background: k.pass ? "var(--v5-brand-soft)" : "var(--v5-danger-soft)", color }}>
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                  {k.pass ? "达标" : "未达标"}
                </span>
              </div>
              <p className="mt-2 text-[11.5px]" style={{ color: "var(--v5-ink-3)", minHeight: 30 }}><AutoGloss>{k.label}</AutoGloss></p>
              <div className="mt-1 flex items-end justify-between gap-2">
                <span className="font-mono-tabular text-[22px] leading-none" style={{ color }}>{k.value}</span>
                <Sparkline data={k.series} color={color} />
              </div>
              <p className="mt-1.5 text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}><AutoGloss>目标 </AutoGloss>{k.target}<AutoGloss> · 点击看口径</AutoGloss></p>
            </button>
          );
        })}
      </div>
      {sel && <KpiModal kpi={sel.kpi} n={sel.n} onClose={() => setSel(null)} />}
    </div>
  );
}

function KpiModal({ kpi, n, onClose }: { kpi: Kpi; n: number; onClose: () => void }) {
  const color = kpi.pass ? "var(--v5-success)" : "var(--v5-danger)";
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const rows = [
    { k: "测量口径", v: kpi.hint },
    { k: "数据源", v: "A4 事件流(server-authoritative)" },
    { k: "后台可见性", v: "L1 KPI 看板 · 可下钻 cohort / Phase 切片" },
  ];
  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center p-6"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(3px)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={ref}
        tabIndex={-1}
        className="w-full max-w-[460px] overflow-hidden rounded-[16px]"
        style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)", boxShadow: "var(--v5-card-shadow-lift-strong)", outline: "none" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 p-4" style={{ borderBottom: "1px solid var(--v5-border)" }}>
          <span className="font-mono-tabular rounded-[6px] px-1.5 py-0.5 text-[10.5px]" style={{ background: "var(--v5-brand-soft)", color: "var(--v5-brand)", border: "1px solid var(--v5-brand-border)" }}>KPI #{n}</span>
          <span className="font-display text-[15px]" style={{ color: "var(--v5-ink)" }}><AutoGloss>{kpi.label}</AutoGloss></span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-[11px] font-medium" style={{ background: kpi.pass ? "var(--v5-brand-soft)" : "var(--v5-danger-soft)", color }}>
            {kpi.pass ? "达标" : "未达标"}
          </span>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[10px] p-3" style={{ background: "var(--v5-surface-2)", border: "1px solid var(--v5-border)" }}>
              <p className="text-[11px]" style={{ color: "var(--v5-ink-3)" }}>当前值</p>
              <p className="font-mono-tabular mt-0.5 text-[22px]" style={{ color }}>{kpi.value}</p>
            </div>
            <div className="rounded-[10px] p-3" style={{ background: "var(--v5-surface-2)", border: "1px solid var(--v5-border)" }}>
              <p className="text-[11px]" style={{ color: "var(--v5-ink-3)" }}>目标</p>
              <p className="font-mono-tabular mt-0.5 text-[22px]" style={{ color: "var(--v5-ink)" }}>{kpi.target}</p>
            </div>
          </div>
          <div className="mt-3">
            <AreaChart data={kpi.series} color={color} height={70} />
          </div>
          <hr className="my-3 border-0" style={{ height: 1, background: "var(--v5-border)" }} />
          {rows.map((r) => (
            <div key={r.k} className="flex justify-between gap-4 py-2" style={{ borderBottom: "1px solid var(--v5-border)" }}>
              <span className="text-[12.5px]" style={{ color: "var(--v5-ink-3)" }}><AutoGloss>{r.k}</AutoGloss></span>
              <span className="text-right text-[12.5px]" style={{ color: "var(--v5-ink-2)" }}><AutoGloss>{r.v}</AutoGloss></span>
            </div>
          ))}
        </div>
        <div className="flex justify-end p-3" style={{ borderTop: "1px solid var(--v5-border)", background: "var(--v5-surface-2)" }}>
          <button type="button" onClick={onClose} className="rounded-[8px] px-3.5 py-2 text-[13px]" style={{ border: "1px solid var(--v5-border-strong)", color: "var(--v5-ink)" }}>关闭</button>
        </div>
      </div>
    </div>
  );
}
