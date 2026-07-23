"use client";

/**
 * K6 操作员身份 → K6 角色映射(PRD §15)。
 * 单源 = 已登录后台会话；最终权限仍由后端 @PreAuthorize 与状态机重验。
 */
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { Role } from "@/lib/admin/janus-c2/types";

export function mapRole(role: string, authorities: string[]): Role {
  if (role === "superadmin" || authorities.includes("risk_k6_admin")) return "admin";
  if (authorities.includes("risk_k6_senior")) return "senior_operator";
  if (authorities.includes("risk_k6_write")) return "operator";
  return "viewer";
}

export function useK6Operator(): { id: string; role: Role } {
  const role = useAdminAuth((state) => state.role);
  const session = useAdminAuth((state) => state.session);
  const operator = useAdminAuth((state) => state.operator);
  return { id: operator || session?.username || "unknown-admin", role: mapRole(role, session?.authorities ?? []) };
}
