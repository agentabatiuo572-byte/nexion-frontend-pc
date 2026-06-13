"use client";

/** 360 HUB 区块共享原语:卡壳 + 指标格 + 动作按钮(行级 CRUD)。 */
import type { ReactNode } from "react";
import { AutoGloss } from "@/app/components/kit/gloss";

export function HubCard({ icon, title, tag, children }: { icon?: ReactNode; title: string; tag?: string; children: ReactNode }) {
  return (
    <div className="rounded-[12px] p-4" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {icon}
        <span className="font-display text-[14px]" style={{ color: "var(--v5-ink)" }}><AutoGloss>{title}</AutoGloss></span>
        {tag && <span className="font-mono-tabular text-[10px]" style={{ color: "var(--v5-ink-4)" }}><AutoGloss>{tag}</AutoGloss></span>}
      </div>
      {children}
    </div>
  );
}

export function HubMetric({ label, sub, value, accent }: { label: string; sub?: string; value: string; accent?: string }) {
  return (
    <div className="rounded-[9px] p-2.5" style={{ background: "var(--v5-surface-2)" }}>
      <p className="text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}><AutoGloss>{label}</AutoGloss></p>
      <p className="font-mono-tabular mt-0.5 text-[16px] leading-none" style={{ color: accent ?? "var(--v5-ink)" }}>{value}</p>
      {sub && <p className="mt-1 text-[9.5px]" style={{ color: "var(--v5-ink-4)" }}><AutoGloss>{sub}</AutoGloss></p>}
    </div>
  );
}

export function HubActBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className="rounded-[6px] px-2 py-1 text-[10.5px] transition-colors hover:bg-[var(--v5-surface-2)]"
      style={{ border: "1px solid var(--v5-border)", color: danger ? "var(--v5-danger)" : "var(--v5-ink-2)" }}>
      <AutoGloss>{label}</AutoGloss>
    </button>
  );
}
