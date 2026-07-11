import { formatAdminApiError } from "@/lib/admin/error-messages";
import type { AdminRole } from "@/lib/nav/console-nav";
import type { AdminSession } from "@/lib/store/admin-auth";
import { normalizeEffectiveMenuNodes, normalizeEffectiveMenus, normalizeSessionRole } from "@/lib/admin/session-role";

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
    roleCode?: string;
    authorities?: string[];
    effectiveMenus?: string[];
    menuCodes?: string[];
    effectiveMenuNodes?: unknown[];
    passwordChangeRequired?: boolean;
  };
}

export interface LoginResult {
  tokenType: string;
  session: AdminSession;
}

export function normalizeAdminRole(role: string | undefined): AdminRole {
  return normalizeSessionRole(role);
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

export async function changeAdminPassword(currentPassword: string, newPassword: string): Promise<LoginResult> {
  const response = await fetch("/api/admin/auth/password/change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<LoginPayload> | null;

  if (!response.ok || !result || result.code !== 0 || !result.data?.session) {
    throw new Error(formatAdminApiError(result?.message, "ADMIN_PASSWORD_CHANGE_FAILED"));
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
      role: normalizeAdminRole(payload.session.roleCode || payload.session.role),
      authorities: payload.session.authorities ?? [],
      menuCodes: normalizeEffectiveMenus(payload.session),
      menuNodes: normalizeEffectiveMenuNodes(payload.session),
      passwordChangeRequired: Boolean(payload.session.passwordChangeRequired),
    },
  };
}
