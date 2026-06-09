/**
 * RoleBadge — 运营角色徽标(中文标签 + 角色色点 + 软底)。
 * 用于 TopBar、ApprovalCard(Maker/Checker 身份)、AuditTimeline。
 */
import type { AdminRole } from "@/lib/nav/console-nav";
import { ROLE_LABEL } from "@/lib/nav/console-nav";

const ROLE_ACCENT: Record<AdminRole, string> = {
  superadmin: "--admin-domain-b", // 柠檬绿
  finance: "--admin-domain-d", // 翡翠绿
  risk: "--admin-domain-k", // 琥珀
  content: "--admin-domain-i", // 粉
  growth: "--admin-domain-h", // 橙
  support: "--admin-domain-c", // 真青
  auditor: "--admin-domain-a", // 靛蓝
};

export function RoleBadge({
  role,
  size = "md",
}: {
  role: AdminRole;
  size?: "sm" | "md";
}) {
  const accent = `var(${ROLE_ACCENT[role]})`;
  const pad = size === "sm" ? "px-1.5 py-0.5 text-[10.5px]" : "px-2 py-1 text-[11.5px]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${pad}`}
      style={{
        background: `color-mix(in srgb, ${accent} 14%, transparent)`,
        color: "var(--v5-ink)",
        border: `1px solid color-mix(in srgb, ${accent} 30%, transparent)`,
      }}
    >
      <span
        className="inline-block rounded-full"
        style={{ width: 6, height: 6, background: accent }}
      />
      {ROLE_LABEL[role]}
    </span>
  );
}
