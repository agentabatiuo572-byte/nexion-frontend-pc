"use client";

/**
 * DashboardArchetype — 仪表盘/BI 型模块通用页(水位/漏斗/节奏/行情/KPI看板/报表…)。
 * KPI 网格 + 图表块(面积 / 柱 / 环图),复用 AreaChart / Donut / KpiStatCard。
 */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { KpiStatCard } from "@/app/components/kit/kpi-stat-card";
import { AreaChart } from "@/app/components/kit/charts/area-chart";
import { Donut } from "@/app/components/kit/charts/donut";
import { AutoGloss } from "@/app/components/kit/gloss";
import type { DashboardSpec, ChartSpec } from "@/lib/admin/module-content";

function Bars({ chart }: { chart: ChartSpec }) {
  const data = chart.data ?? [];
  const labels = chart.labels ?? [];
  if (data.length === 0) return <p className="mt-3 text-[12px]" style={{ color: "var(--v5-ink-4)" }}>无数据</p>;
  const max = Math.max(...data, 1);
  const color = chart.color ?? "var(--v5-brand)";
  return (
    <div className="mt-3 flex items-end gap-2" style={{ height: 132 }}>
      {data.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
          <span className="font-mono-tabular text-[10px]" style={{ color: "var(--v5-ink-4)" }}>{v}{chart.unit ?? ""}</span>
          <div className="flex w-full max-w-[40px] items-end justify-center" style={{ height: 96 }}>
            <div className="w-full rounded-t-[5px]" style={{ height: `${Math.max((v / max) * 96, 3)}px`, background: color, opacity: 0.85 }} />
          </div>
          <span className="text-[10px]" style={{ color: "var(--v5-ink-4)" }}>{labels[i] ?? ""}</span>
        </div>
      ))}
    </div>
  );
}

function ChartCard({ chart, accent }: { chart: ChartSpec; accent: string }) {
  const total = chart.segments?.reduce((s, x) => s + x.value, 0) ?? 0;
  return (
    <div className="rounded-[16px] p-5" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
      <div className="flex items-baseline gap-2.5">
        <span className="font-display text-[14px]" style={{ color: "var(--v5-ink)" }}><AutoGloss>{chart.title}</AutoGloss></span>
        {chart.sub && <span className="text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}><AutoGloss>{chart.sub}</AutoGloss></span>}
      </div>

      {chart.type === "area" && (
        <div className="mt-3">
          <AreaChart data={chart.data ?? []} color={chart.color ?? accent} height={120} refLine={chart.refLine != null ? { value: chart.refLine, color: "var(--v5-danger)" } : undefined} />
        </div>
      )}

      {chart.type === "bars" && <Bars chart={chart} />}

      {chart.type === "donut" && chart.segments && (
        <div className="mt-3 flex items-center gap-4">
          <Donut segments={chart.segments} size={128} thickness={13}>
            <span className="font-mono-tabular text-[15px]" style={{ color: "var(--v5-ink)" }}>{total}{chart.unit ?? ""}</span>
          </Donut>
          <ul className="flex flex-1 flex-col justify-center gap-1">
            {chart.segments.map((s) => (
              <li key={s.label} className="flex items-center gap-2 text-[11.5px]">
                <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="flex-1 truncate" style={{ color: "var(--v5-ink-3)" }}><AutoGloss>{s.label}</AutoGloss></span>
                <span className="font-mono-tabular" style={{ color: "var(--v5-ink-4)" }}>{Math.round((s.value / (total || 1)) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function DashboardArchetype({ spec, accent }: { spec: DashboardSpec; accent: string }) {
  const charts = spec.charts ?? [];
  return (
    <div className="mt-5">
      {spec.controlLink && (
        <div className="mb-3 flex justify-end">
          <Link
            href={spec.controlLink.href}
            prefetch={false}
            className="inline-flex items-center gap-1.5 rounded-[9px] px-3.5 py-2 text-[12.5px] font-medium transition-opacity hover:opacity-90"
            style={{ background: "var(--v5-brand-soft)", color: "var(--v5-brand)", border: "1px solid var(--v5-brand-border)" }}
          >
            {spec.controlLink.label} <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      )}
      {spec.metrics && spec.metrics.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {spec.metrics.map((m) => (
            <KpiStatCard key={m.label} label={m.label} value={m.value} accent={m.accent ?? accent} sublabel={m.sub} hint={m.hint} delta={m.delta} />
          ))}
        </div>
      )}

      {charts.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {charts.map((c) => (
            <ChartCard key={c.title} chart={c} accent={accent} />
          ))}
        </div>
      )}

      {spec.note && <p className="mt-3 text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}><AutoGloss>{spec.note}</AutoGloss></p>}
    </div>
  );
}
