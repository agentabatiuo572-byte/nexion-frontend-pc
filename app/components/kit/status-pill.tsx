/**
 * StatusPill — 通用状态徽标(标签 + 语义色调 + 软底)。
 * 用于脚手架状态、D2 提现状态机、E1 审批态等。tone 决定取色 token。
 */
export type PillTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "purple";

const TONE_VAR: Record<PillTone, string> = {
  neutral: "--v5-ink-4",
  brand: "--v5-brand",
  success: "--v5-success",
  warning: "--v5-warning",
  danger: "--v5-danger",
  info: "--admin-blue",
  purple: "--v5-tech-cyan",
};

export function StatusPill({
  label,
  tone = "neutral",
  size = "md",
  dot = true,
}: {
  label: string;
  tone?: PillTone;
  size?: "sm" | "md";
  dot?: boolean;
}) {
  const c = `var(${TONE_VAR[tone]})`;
  const pad = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${pad}`}
      style={{
        background: `color-mix(in srgb, ${c} 15%, transparent)`,
        color: c,
        border: `1px solid color-mix(in srgb, ${c} 30%, transparent)`,
      }}
    >
      {dot && (
        <span className="inline-block rounded-full" style={{ width: 5, height: 5, background: c }} />
      )}
      {label}
    </span>
  );
}
