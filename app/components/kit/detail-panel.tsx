"use client";

/**
 * DetailPanel — master-detail 右栏容器(顶部标题 + 可关闭 + 滚动体)。
 * DetailEmpty — 未选中时的空态占位。用于 D2 队列详情、C1 画像。
 */
import { X } from "lucide-react";

export function DetailPanel({
  title,
  tag,
  onClose,
  children,
}: {
  title: React.ReactNode;
  tag?: React.ReactNode;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex max-h-full flex-col overflow-hidden rounded-[12px]"
      style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}
    >
      <div
        className="flex items-center justify-between gap-2 px-4 py-3"
        style={{ borderBottom: "1px solid var(--v5-border)" }}
      >
        <div className="flex items-center gap-2">
          <span className="font-display text-[14px]" style={{ color: "var(--v5-ink)" }}>
            {title}
          </span>
          {tag}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭详情"
            className="rounded-[6px] p-1 transition-colors hover:bg-[var(--v5-surface-2)]"
            style={{ color: "var(--v5-ink-4)" }}
          >
            <X size={15} />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
    </div>
  );
}

export function DetailEmpty({ hint }: { hint: string }) {
  return (
    <div
      className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 rounded-[12px] p-8 text-center"
      style={{
        background: "var(--v5-surface)",
        border: "1px dashed var(--v5-border-strong)",
      }}
    >
      <p className="text-[13px]" style={{ color: "var(--v5-ink-3)" }}>
        {hint}
      </p>
    </div>
  );
}
