"use client";

/**
 * FilterBar — 搜索框 + 自定义过滤控件(children)+ 结果计数。
 * 用于 D2 队列、C1 检索、E1 商品。过滤 chip 由调用方以 children 传入,保持灵活。
 */
import { Search } from "lucide-react";

export function FilterBar({
  search,
  onSearch,
  placeholder = "搜索…",
  resultCount,
  children,
}: {
  search: string;
  onSearch: (v: string) => void;
  placeholder?: string;
  resultCount?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
          style={{ color: "var(--v5-ink-4)" }}
        />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-[220px] rounded-[9px] py-1.5 pl-8 pr-3 text-[12.5px] outline-none transition-colors focus:border-[var(--v5-border-strong)]"
          style={{
            background: "var(--v5-surface-3)",
            border: "1px solid var(--v5-border)",
            color: "var(--v5-ink)",
          }}
        />
      </div>
      {children}
      <div className="flex-1" />
      {resultCount !== undefined && (
        <span className="font-mono-tabular text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}>
          {resultCount} 条
        </span>
      )}
    </div>
  );
}

/** FilterChip — 配合 FilterBar 的可切换过滤标签。 */
export function FilterChip({
  label,
  active,
  onClick,
  accent,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  accent?: string;
}) {
  const c = accent ?? "var(--v5-brand)";
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors"
      style={{
        background: active ? `color-mix(in srgb, ${c} 16%, transparent)` : "var(--v5-surface-2)",
        color: active ? c : "var(--v5-ink-3)",
        border: active
          ? `1px solid color-mix(in srgb, ${c} 32%, transparent)`
          : "1px solid var(--v5-border)",
      }}
    >
      {label}
    </button>
  );
}
