"use client";

/** 风险雷达 — 全局告警聚合(覆盖率红线 / 风险命中 / kill 状态),按级别色点,点击钻取。 */
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { AlertItem, AlertLevel } from "@/lib/mock/admin/command-center";
import { AutoGloss } from "@/app/components/kit/gloss";

const LEVEL_COLOR: Record<AlertLevel, string> = {
  high: "var(--v5-danger)",
  mid: "var(--v5-warning)",
  low: "var(--v5-ink-4)",
};

export function AlertCenter({ alerts }: { alerts: AlertItem[] }) {
  const highCount = alerts.filter((a) => a.level === "high").length;
  return (
    <div className="rounded-[14px] p-4" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
      <div className="flex items-center justify-between">
        <span className="font-display text-[15px]" style={{ color: "var(--v5-ink)" }}><AutoGloss>风险雷达</AutoGloss></span>
        {highCount > 0 && (
          <span
            className="font-mono-tabular rounded-full px-2 py-0.5 text-[11px]"
            style={{ background: "color-mix(in srgb, var(--v5-danger) 16%, transparent)", color: "var(--v5-danger)" }}
          >
            {highCount} 高危
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[10px]" style={{ color: "var(--v5-ink-4)" }}>
        <span className="inline-flex items-center gap-1"><span className="inline-block rounded-full" style={{ width: 6, height: 6, background: "var(--v5-danger)" }} />高危</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block rounded-full" style={{ width: 6, height: 6, background: "var(--v5-warning)" }} />关注</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block rounded-full" style={{ width: 6, height: 6, background: "var(--v5-ink-4)" }} />正常</span>
      </div>
      {alerts.length === 0 && (
        <p className="mt-3 py-3 text-center text-[12.5px]" style={{ color: "var(--v5-ink-4)" }}>无活跃告警 ✓</p>
      )}
      <ul className="mt-3 flex flex-col gap-0.5">
        {alerts.map((a) => (
          <li key={a.id}>
            <Link
              href={a.href}
              prefetch={false}
              className="flex items-start gap-2.5 rounded-[9px] p-2 transition-colors hover:bg-[var(--v5-surface-2)]"
            >
              <span
                className="mt-1 inline-block shrink-0 rounded-full"
                style={{ width: 7, height: 7, background: LEVEL_COLOR[a.level] }}
              />
              <span className="flex-1 text-[12.5px]" style={{ color: "var(--v5-ink-2)" }}><AutoGloss>{a.text}</AutoGloss></span>
              <ChevronRight size={14} style={{ color: "var(--v5-ink-4)", marginTop: 1 }} aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
