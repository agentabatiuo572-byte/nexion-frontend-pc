import type { AdminRole } from "@/lib/nav/console-nav";
import type { AdminSession } from "@/lib/store/admin-auth";

const ADMIN_ROLES = new Set<AdminRole>([
  "superadmin",
  "finance",
  "risk",
  "growth",
  "content",
  "support",
  "auditor",
]);

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

interface LoginPayload {
  tokenType: string;
  session: {
    adminId: number;
    username: string;
    operator: string;
    role: string;
    authorities?: string[];
  };
}

export interface LoginResult {
  tokenType: string;
  session: AdminSession;
}

export function normalizeAdminRole(role: string | undefined): AdminRole {
  return role && ADMIN_ROLES.has(role as AdminRole) ? (role as AdminRole) : "auditor";
}

export async function loginAdmin(username: string, password: string): Promise<LoginResult> {
  const response = await fetch("/api/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: username.trim(), password }),
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<LoginPayload> | null;

  if (!response.ok || !result || result.code !== 0 || !result.data?.session) {
    throw new Error(result?.message || "ADMIN_CREDENTIAL_INVALID");
  }

  return {
    tokenType: result.data.tokenType || "Bearer",
    session: {
      adminId: result.data.session.adminId,
      username: result.data.session.username,
      operator: result.data.session.operator || result.data.session.username,
      role: normalizeAdminRole(result.data.session.role),
      authorities: result.data.session.authorities ?? [],
    },
  };
}
