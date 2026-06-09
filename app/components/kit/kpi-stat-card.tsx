/**
 * KpiStatCard — 指标卡(标签 + 大号值 + 可选环比 delta + 强调色 + 口径 tooltip + mini sparkline)。
 * 用于 B1 驾驶舱、C1 画像、D2 队列头、脚手架 faux KPI。
 * hint:指标口径说明(运营者悬停可读,消黑话);spark:趋势序列(给 PM 颗粒度)。
 */
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { AutoGloss } from "@/app/components/kit/gloss";

export interface KpiDelta {
  dir: "up" | "down" | "flat";
  text: string;
  good?: boolean; // 覆盖默认配色:true=吉(绿)false=凶(红)
}

/** 内联 mini 折线图。坐标四舍五入到 2 位,避免 SSR/client 浮点分歧致水合错误。 */
export function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const w = 56;
  const h = 18;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const pts = data
    .map((v, i) => {
      const x = r2((i / (data.length - 1)) * w);
      const y = r2(h - ((v - min) / span) * h);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ display: "block" }}>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function KpiStatCard({
  label,
  value,
  delta,
  accent,
  mono = true,
  sublabel,
  hint,
  spark,
  loading = false,
}: {
  label: string;
  value: React.ReactNode;
  delta?: KpiDelta;
  accent?: string; // css 颜色,如 "var(--admin-domain-d)";省略=中性
  mono?: boolean;
  sublabel?: string;
  hint?: string; // 指标口径说明(? 悬停)
  spark?: number[]; // 趋势序列
  loading?: boolean;
}) {
  const deltaColor = (() => {
    if (!delta) return "var(--v5-ink-3)";
    const good = delta.good ?? (delta.dir === "up");
    if (delta.dir === "flat") return "var(--v5-ink-3)";
    return good ? "var(--v5-success)" : "var(--v5-danger)";
  })();
  const DeltaIcon = delta?.dir === "up" ? ArrowUpRight : delta?.dir === "down" ? ArrowDownRight : Minus;

  return (
    <div
      className="rounded-[12px] p-3.5"
      style={{
        background: "var(--v5-surface)",
        border: "1px solid var(--v5-border)",
        borderTop: accent ? `2px solid ${accent}` : "1px solid var(--v5-border)",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <span className="text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}>
            <AutoGloss>{label}</AutoGloss>
          </span>
          {hint && (
            <span
              title={hint}
              aria-label={hint}
              className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full text-[9px]"
              style={{ background: "var(--v5-surface-3)", color: "var(--v5-ink-4)" }}
            >
              ?
            </span>
          )}
        </div>
        {spark && <Sparkline data={spark} color={accent ?? "var(--v5-ink-3)"} />}
      </div>

      {loading ? (
        <span
          className="mt-2 block h-6 w-2/3 rounded-full motion-safe:animate-pulse"
          style={{ background: "var(--v5-surface-3)" }}
        />
      ) : (
        <p
          className={`mt-1.5 text-[22px] leading-none ${mono ? "font-mono-tabular" : "font-display"}`}
          style={{ color: "var(--v5-ink)" }}
        >
          {value}
        </p>
      )}
      <div className="mt-1.5 flex items-center gap-2">
        {delta && (
          <span className="inline-flex items-center gap-0.5 text-[11px]" style={{ color: deltaColor }}>
            <DeltaIcon size={12} />
            {delta.text}
          </span>
        )}
        {sublabel && (
          <span className="text-[11px]" style={{ color: "var(--v5-ink-4)" }}>
            <AutoGloss>{sublabel}</AutoGloss>
          </span>
        )}
      </div>
    </div>
  );
}
