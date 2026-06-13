/**
 * ScaffoldPage — 未建 L2 的统一规格页(server 组件,纯渲染,SSR 内容供 verify)。
 * 反模板:每域取专属强调色 → 12 域 12 种身份;8 段规格卡用 spec-hints 域定制文案;
 * faux KPI + ghost 表让骨架看起来"有意为之",不空洞。
 */
import type { NavDomain, NavL2 } from "@/lib/nav/console-nav";
import { SECTION_LABELS, DOMAIN_HINTS, DOMAIN_GHOST_COLUMNS } from "@/lib/nav/spec-hints";
import { StatusPill } from "@/app/components/kit/status-pill";

function statusMeta(status: NavL2["status"]): { label: string; tone: "info" | "neutral" | "brand" } {
  if (status === "flagship") return { label: "已上线", tone: "brand" };
  if (status === "planned") return { label: "待开发", tone: "neutral" };
  return { label: "规格就绪", tone: "info" };
}

export function ScaffoldPage({ domain, l2 }: { domain: NavDomain; l2: NavL2 }) {
  const accent = `var(${domain.accentVar})`;
  const hints = DOMAIN_HINTS[domain.code] ?? [];
  const ghostCols = DOMAIN_GHOST_COLUMNS[domain.code] ?? ["字段", "字段", "字段", "字段"];
  const st = statusMeta(l2.status);

  return (
    <div className="w-full">
      {/* 页头 */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{
                background: `color-mix(in srgb, ${accent} 14%, transparent)`,
                color: accent,
                border: `1px solid color-mix(in srgb, ${accent} 30%, transparent)`,
              }}
            >
              <span className="inline-block rounded-full" style={{ width: 5, height: 5, background: accent }} />
              域 {domain.code} · {domain.name}
            </span>
            <span className="font-mono-tabular text-[11px]" style={{ color: "var(--v5-ink-4)" }}>
              {l2.id}
            </span>
          </div>
          <h1 className="font-display mt-2 text-[24px]" style={{ color: "var(--v5-ink)" }}>
            {l2.name}
          </h1>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <StatusPill label={st.label} tone={st.tone} />
          <span
            className="font-mono-tabular rounded-[7px] px-2 py-1 text-[11px]"
            style={{ background: "var(--v5-surface-2)", color: "var(--v5-ink-3)" }}
          >
            {l2.batch} · PRD §3.3 [{l2.id}]
          </span>
        </div>
      </header>

      {/* 规格就绪 banner */}
      <div
        className="mt-5 flex items-start gap-3 rounded-[12px] p-4"
        style={{
          background: `color-mix(in srgb, ${accent} 7%, var(--v5-surface))`,
          border: "1px solid var(--v5-border)",
          borderLeft: `3px solid ${accent}`,
        }}
      >
        <div>
          <p className="text-[13px]" style={{ color: "var(--v5-ink)" }}>
            <span style={{ fontWeight: 600 }}>运营者视角</span> · 本模块管:{hints[0]}
          </p>
          {hints[3] && (
            <p className="mt-1 text-[12px]" style={{ color: "var(--v5-ink-2)" }}>
              你通常来这里:{hints[3]}
            </p>
          )}
          <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}>
            规格就绪 · PRD §3.3 [{l2.id}] 已定稿;下方 8 段为实装参考。
          </p>
        </div>
      </div>

      {/* 8 段规格卡 */}
      <div className="mt-5 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
        {SECTION_LABELS.map((label, i) => (
          <div
            key={i}
            className="rounded-[12px] p-3.5"
            style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}
          >
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-[2px] rounded-full" style={{ background: accent }} />
              <span className="text-[12.5px] font-medium" style={{ color: "var(--v5-ink-2)" }}>
                {label}
              </span>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed" style={{ color: "var(--v5-ink-3)" }}>
              {hints[i] ?? "—"}
            </p>
          </div>
        ))}
      </div>

      {/* 代表性占位:faux KPI + ghost 表 */}
      <section className="mt-6">
        <p className="mb-2.5 text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--v5-ink-4)" }}>
          界面预览(数据待接入)
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {["核心指标 A", "核心指标 B", "核心指标 C", "核心指标 D"].map((lbl, i) => (
            <div
              key={i}
              className="rounded-[12px] p-3.5"
              style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}
            >
              <p className="text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}>
                {lbl}
              </p>
              <p className="font-mono-tabular mt-2 text-[22px]" style={{ color: "var(--v5-ink-4)" }}>
                —
              </p>
              <p className="mt-1 text-[10.5px]" style={{ color: accent }}>
                待接入
              </p>
            </div>
          ))}
        </div>

        {/* ghost 表 */}
        <div
          className="mt-3 overflow-hidden rounded-[12px]"
          style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}
        >
          <div
            className="grid items-center gap-3 px-4 py-2.5"
            style={{
              gridTemplateColumns: `repeat(${ghostCols.length}, 1fr)`,
              borderBottom: "1px solid var(--v5-border)",
            }}
          >
            {ghostCols.map((c, i) => (
              <span key={i} className="text-[11.5px] font-medium" style={{ color: "var(--v5-ink-3)" }}>
                {c}
              </span>
            ))}
          </div>
          {[0, 1, 2].map((r) => (
            <div
              key={r}
              className="grid items-center gap-3 px-4 py-3"
              style={{
                gridTemplateColumns: `repeat(${ghostCols.length}, 1fr)`,
                borderBottom: r < 2 ? "1px solid var(--v5-border)" : "none",
              }}
            >
              {ghostCols.map((_, i) => (
                <span
                  key={i}
                  className="h-3 rounded-full motion-safe:animate-pulse"
                  style={{
                    background: "var(--v5-surface-3)",
                    width: `${[70, 52, 64, 44][i % 4]}%`,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
