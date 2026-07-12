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

const CLASSIC_MENU_ALIASES: Record<string, string> = {
  MENU_CONTENT_I4: "I4",
  MENU_CONTENT_I5: "I5",
};

function normalizeMenuCode(code: unknown): string {
  const value = String(code ?? "").trim().toUpperCase();
  return CLASSIC_MENU_ALIASES[value] ?? value;
}

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
  return raw?.map(normalizeMenuCode).filter(Boolean);
}

export interface EffectiveMenuNodeWire {
  menuCode?: unknown;
  menuName?: unknown;
  routePath?: unknown;
  parentCode?: unknown;
  sortOrder?: unknown;
}

export function normalizeEffectiveMenuNodes(session: { effectiveMenuNodes?: unknown }): Array<{
  menuCode: string;
  menuName: string;
  routePath: string | null;
  parentCode: string | null;
  sortOrder: number | null;
}> | undefined {
  if (!Array.isArray(session.effectiveMenuNodes)) return undefined;
  return session.effectiveMenuNodes.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const node = raw as EffectiveMenuNodeWire;
    const menuCode = normalizeMenuCode(node.menuCode);
    if (!menuCode) return [];
    const hasOrder = (typeof node.sortOrder === "number")
      || (typeof node.sortOrder === "string" && node.sortOrder.trim() !== "");
    const parsedOrder = hasOrder ? Number(node.sortOrder) : Number.NaN;
    return [{
      menuCode,
      menuName: String(node.menuName ?? menuCode).trim() || menuCode,
      routePath: typeof node.routePath === "string" ? node.routePath.trim() || null : null,
      parentCode: typeof node.parentCode === "string" ? node.parentCode.trim().toUpperCase() || null : null,
      sortOrder: Number.isFinite(parsedOrder) ? parsedOrder : null,
    }];
  });
}
