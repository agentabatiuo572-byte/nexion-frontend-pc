"use client";

import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import type { BDomainDashboard } from "@/lib/admin/b-client";

type BDomainWarning = BDomainDashboard["warnings"][number];

export function BDomainDataState({
  title = "B 域数据",
  loading,
  error,
  onRetry,
}: {
  title?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  const isLoading = loading && !error;
  return (
    <section
      className="rounded-[12px] p-5"
      style={{ background: "var(--v5-surface, var(--surface))", border: "1px solid var(--v5-border, var(--border))" }}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px]"
          style={{
            background: isLoading
              ? "color-mix(in srgb, var(--v5-brand, var(--brand)) 14%, transparent)"
              : "color-mix(in srgb, var(--v5-warning, var(--warning)) 16%, transparent)",
            color: isLoading ? "var(--v5-brand, var(--brand))" : "var(--v5-warning, var(--warning))",
          }}
        >
          {isLoading ? <Loader2 size={17} className="animate-spin" /> : <AlertTriangle size={17} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium" style={{ color: "var(--v5-ink, var(--ink))" }}>
            {isLoading ? `${title}加载中` : `${title}加载失败`}
          </div>
          <div className="mt-1 text-[12.5px]" style={{ color: "var(--v5-ink-3, var(--ink-3))" }}>
            {isLoading ? "正在读取服务端权威数据。" : error || "当前数据暂不可用，请重试。"}
          </div>
          {!isLoading && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12.5px] transition-colors hover:bg-[var(--v5-surface-2)]"
              style={{ border: "1px solid var(--v5-border, var(--border))", color: "var(--v5-ink, var(--ink))" }}
            >
              <RefreshCw size={14} />
              重试
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

export function BDomainWarnings({
  title = "B 域配置降级",
  warnings,
}: {
  title?: string;
  warnings?: BDomainWarning[];
}) {
  if (!warnings?.length) return null;
  return (
    <section
      className="mb-4 rounded-[12px] p-4"
      style={{
        background: "color-mix(in srgb, var(--v5-warning, var(--warning)) 10%, var(--v5-surface, var(--surface)))",
        border: "1px solid color-mix(in srgb, var(--v5-warning, var(--warning)) 38%, var(--v5-border, var(--border)))",
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]"
          style={{
            background: "color-mix(in srgb, var(--v5-warning, var(--warning)) 18%, transparent)",
            color: "var(--v5-warning, var(--warning))",
          }}
        >
          <AlertTriangle size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium" style={{ color: "var(--v5-ink, var(--ink))" }}>
            {title}
          </div>
          <div className="mt-1 space-y-1 text-[12px]" style={{ color: "var(--v5-ink-3, var(--ink-3))" }}>
            {warnings.slice(0, 4).map((warning) => (
              <div key={`${warning.key}-${warning.code}`}>
                <span className="font-mono-tabular">{warning.key}</span> · {warning.code}: {warning.message}
              </div>
            ))}
            {warnings.length > 4 && <div>另有 {warnings.length - 4} 条配置降级未展开。</div>}
          </div>
        </div>
      </div>
    </section>
  );
}
