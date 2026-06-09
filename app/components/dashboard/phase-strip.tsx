/** 12 月运营节奏 — P1–P6 时间线,当前阶段高亮 + 重心 + 下一阶段 ETA;标题深链到 Phase 调度器。 */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { PhaseNode } from "@/lib/mock/admin/command-center";
import { AutoGloss } from "@/app/components/kit/gloss";

interface CurrentPhase {
  code: string;
  name: string;
  index: number;
  month: number;
  total: number;
  etaDays: number;
  focus: string;
}

export function PhaseStrip({ phases, current }: { phases: PhaseNode[]; current: CurrentPhase }) {
  return (
    <div className="rounded-[14px] p-4" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border-strong)", boxShadow: "var(--v5-card-shadow-lift-strong)" }}>
      <Link href="/growth/phase" prefetch={false} className="flex items-center justify-between transition-opacity hover:opacity-90">
        <span className="font-display text-[15px]" style={{ color: "var(--v5-ink)" }}>12 月运营节奏</span>
        <span className="font-mono-tabular inline-flex items-center gap-1 text-[11px]" style={{ color: "var(--v5-ink-4)" }}>
          第 {current.month}/{current.total} 月 · 调度 <ArrowRight size={12} />
        </span>
      </Link>
      <div className="mt-4 flex items-center">
        {phases.map((p, i) => {
          const active = i === current.index;
          const done = i < current.index;
          return (
            <div key={p.code} className="flex flex-1 items-center">
              <div className="flex shrink-0 flex-col items-center">
                <span
                  className="font-mono-tabular flex items-center justify-center rounded-full text-[10px]"
                  style={{
                    width: 26,
                    height: 26,
                    background: active
                      ? "var(--v5-brand-2)"
                      : done
                        ? "color-mix(in srgb, var(--v5-brand) 22%, transparent)"
                        : "var(--v5-surface-3)",
                    color: active ? "var(--v5-on-brand-2)" : done ? "var(--v5-brand)" : "var(--v5-ink-4)",
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {p.code}
                </span>
                <span className="mt-1 text-[10.5px]" style={{ color: active ? "var(--v5-ink)" : "var(--v5-ink-4)" }}>
                  {p.name}
                </span>
              </div>
              {i < phases.length - 1 && (
                <span className="mx-1 h-px flex-1" style={{ background: done ? "var(--v5-brand)" : "var(--v5-border)" }} />
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[12px]" style={{ color: "var(--v5-ink-2)" }}><AutoGloss>{current.focus}</AutoGloss></p>
    </div>
  );
}
