const BUILTIN_ROLE_ALIASES: Record<string, string> = {
  SUPER_ADMIN: "superadmin",
  SUPERADMIN: "superadmin",
  CONFIG_ADMIN: "config",
  CONFIG: "config",
  FINANCE: "finance",
  RISK: "risk",
  CONTENT: "content",
  GROWTH: "growth",
  SUPPORT: "support",
  AUDITOR: "auditor",
  AUDIT: "auditor",
};

/** Keep custom database role codes intact; only collapse known built-in aliases. */
export function normalizeSessionRole(role: string | undefined): string {
  const value = role?.trim();
  if (!value) return "auditor";
  return BUILTIN_ROLE_ALIASES[value.toUpperCase()] ?? value;
}

export function normalizeEffectiveMenus(session: {
  effectiveMenus?: unknown;
  menuCodes?: unknown;
}): string[] | undefined {
  const raw = Array.isArray(session.effectiveMenus)
    ? session.effectiveMenus
    : Array.isArray(session.menuCodes)
      ? session.menuCodes
      : undefined;
  return raw?.map((code) => String(code).trim()).filter(Boolean);
}
