import { formatAdminApiError } from "@/lib/admin/error-messages";
import type { AdminRole } from "@/lib/nav/console-nav";
import type { AdminSession } from "@/lib/store/admin-auth";

const ADMIN_ROLES = new Set<AdminRole>([
  "superadmin",
  "config",
  "finance",
  "risk",
  "growth",
  "content",
  "support",
  "support_manager",
  "support_dedicated",
  "support_general",
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
    throw new Error(formatAdminApiError(result?.message, "ADMIN_CREDENTIAL_INVALID"));
  }

  return normalizeLoginPayload(result.data);
}

export async function currentAdminSession(): Promise<LoginResult | null> {
  const response = await fetch("/api/admin/auth/session", { cache: "no-store" });
  const result = (await response.json().catch(() => null)) as ApiResult<LoginPayload> | null;

  if (response.status === 401 || !result?.data?.session) {
    return null;
  }
  if (!response.ok || result.code !== 0) {
    throw new Error(formatAdminApiError(result?.message, "ADMIN_SESSION_INVALID"));
  }

  return normalizeLoginPayload(result.data);
}

function normalizeLoginPayload(payload: LoginPayload): LoginResult {
  return {
    tokenType: payload.tokenType || "Bearer",
    session: {
      adminId: payload.session.adminId,
      username: payload.session.username,
      operator: payload.session.operator || payload.session.username,
      role: normalizeAdminRole(payload.session.role),
      authorities: payload.session.authorities ?? [],
    },
  };
}
