"use client";

/**
 * B4 节奏状态 · Phase dial(设计稿 PhaseCard 模式)— 6 阶段 dotline 时间轴 + 当前焦点 + 8 控制 dial(双列)。
 * dial 只读,权威归 H1。flex 填充高度,CTA 底部对齐。数据取 PHASES/CURRENT_PHASE/PHASE_DIALS。
 */
import Link from "next/link";
import { PHASES, CURRENT_PHASE, PHASE_DIALS } from "@/lib/mock/admin/command-center";
import { AutoGloss } from "@/app/components/kit/gloss";

export function PhaseCard() {
  const curIdx = CURRENT_PHASE.index;
  return (
    <div className="flex h-full flex-col rounded-[16px] p-5" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
      <div className="flex items-center gap-2.5">
        <span className="font-display text-[14.5px]" style={{ color: "var(--v5-ink)" }}>节奏状态 · Phase dial</span>
        <span className="ml-auto font-mono-tabular rounded-[7px] px-2 py-0.5 text-[11px]" style={{ background: "var(--v5-surface-3)", color: "var(--v5-ink-3)", border: "1px solid var(--v5-border)" }}>B4</span>
      </div>
      <p className="mt-1 text-[12px]" style={{ color: "var(--v5-ink-4)" }}><AutoGloss>{CURRENT_PHASE.focus}</AutoGloss></p>

      {/* dotline 时间轴 */}
      <div className="mt-3.5 flex gap-1.5">
        {PHASES.map((p, i) => {
          const isCur = i === curIdx;
          const past = i < curIdx;
          return (
            <div key={p.code} className="flex-1 text-center">
              <div style={{ height: 6, borderRadius: 3, background: isCur ? "var(--v5-brand)" : past ? "var(--v5-brand-soft)" : "var(--v5-surface-3)" }} />
              <p className="font-mono-tabular mt-1 text-[10px]" style={{ color: isCur ? "var(--v5-brand)" : "var(--v5-ink-4)", fontWeight: isCur ? 600 : 400 }}>{p.code}</p>
            </div>
          );
        })}
      </div>

      {/* 当前阶段 */}
      <div className="mt-3 rounded-[10px] p-3" style={{ background: "var(--v5-brand-soft)", border: "1px solid var(--v5-brand-border)" }}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px]" style={{ color: "var(--v5-ink)", fontWeight: 600 }}>当前 {CURRENT_PHASE.code} · {CURRENT_PHASE.name}</span>
          <span className="ml-auto font-mono-tabular text-[11px]" style={{ color: "var(--v5-ink-3)" }}>第 {CURRENT_PHASE.month}/{CURRENT_PHASE.total} 月 · {PHASE_DIALS.length} dial 权威归 H1</span>
        </div>
      </div>

      {/* dial 列表(双列,紧凑)*/}
      <div className="mt-3 grid grid-cols-2 gap-x-5">
        {PHASE_DIALS.map((d) => (
          <div key={d.key} className="flex items-center justify-between gap-2 py-2" style={{ borderBottom: "1px solid var(--v5-border)" }}>
            <span className="truncate text-[12px]" style={{ color: "var(--v5-ink-2)" }}><AutoGloss>{d.label}</AutoGloss></span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="font-mono-tabular text-[12px]" style={{ color: "var(--v5-ink)" }}>{d.value}</span>
              {d.trend !== "flat" && (
                <span
                  className="font-mono-tabular rounded-[5px] px-1 text-[10px]"
                  style={{ background: d.trend === "up" ? "var(--v5-brand-2-soft)" : "var(--v5-surface-3)", color: d.trend === "up" ? "var(--v5-brand-2)" : "var(--v5-ink-3)" }}
                >
                  {d.trend === "up" ? "↑" : "↓"}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      <Link href="/growth/phase" prefetch={false} className="mt-auto inline-flex pt-3 text-[12.5px]" style={{ color: "var(--v5-brand)" }}>调整 H1 节奏 dial →</Link>
    </div>
  );
}
