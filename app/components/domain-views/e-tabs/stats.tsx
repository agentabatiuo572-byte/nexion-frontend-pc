import type { ReactNode } from "react";
import { AutoGloss } from "@/app/components/kit/gloss";

/** E 域 per-tab 4 卡 stat strip(值按 tone 着色;复用 globals 的 .card / grid g-4)。 */
export type StatTone = "" | "ok" | "cyan" | "warn" | "danger";
const TONE_COLOR: Record<StatTone, string> = {
  "": "var(--ink)", ok: "var(--success)", cyan: "var(--cyan)", warn: "var(--warning)", danger: "var(--danger)",
};

export interface EStatItem { k: ReactNode; v: ReactNode; sub?: ReactNode; tone?: StatTone }

export function EStats({ items }: { items: EStatItem[] }) {
  return (
    <div className="grid g-4" style={{ gap: 14, marginBottom: 18 }}>
      {items.map((it, i) => (
        <div className="card" key={i} style={{ padding: "15px 16px" }}>
          <div className="muted tiny">{typeof it.k === "string" ? <AutoGloss>{it.k}</AutoGloss> : it.k}</div>
          <div className="tnum" style={{ fontSize: 22, fontWeight: 600, marginTop: 4, color: TONE_COLOR[it.tone ?? ""] }}>{it.v}</div>
          {it.sub != null && <div className="muted tiny" style={{ marginTop: 3 }}>{typeof it.sub === "string" ? <AutoGloss>{it.sub}</AutoGloss> : it.sub}</div>}
        </div>
      ))}
    </div>
  );
}
