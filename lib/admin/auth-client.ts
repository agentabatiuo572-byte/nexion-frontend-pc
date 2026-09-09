import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import type { AdminRole } from "@/lib/nav/console-nav";
import type { AdminSession } from "@/lib/store/admin-auth";
import { normalizeEffectiveMenuNodes, normalizeEffectiveMenus, normalizeSessionRole } from "@/lib/admin/session-role";
import { authoritativeAdminSessionPayload } from "@/lib/admin/session-response";
import { AdminAuthEpochChangedError, adminAuthLifecycleEpoch } from "@/lib/admin/auth-lifecycle";
import { withAdminAuthDeadline } from "@/lib/admin/auth-deadline";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

interface LoginPayload {
  tokenType: string;
  session?: {
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
  mfa?: AdminMfaChallenge;
}

export interface AdminMfaChallenge {
  challengeId: string;
  mode: "ENROLL" | "VERIFY";
  expiresInSeconds: number;
  provisioningUri?: string | null;
  manualKey?: string | null;
}

export interface LoginStartResult {
  mfaChallenge?: AdminMfaChallenge;
  loginResult?: LoginResult;
}

export interface LoginResult {
  tokenType: string;
  session: AdminSession;
}

export function normalizeAdminRole(role: string | undefined): AdminRole {
  return normalizeSessionRole(role);
}

async function requestAdminAuthJson(
  input: RequestInfo | URL,
  init: RequestInit,
  options: { signal?: AbortSignal } = {},
): Promise<{ response: Response; result: ApiResult<LoginPayload> | null }> {
  try {
    return await withAdminAuthDeadline(async (signal) => {
      const response = await guardedFetch(input, { ...init, signal });
      try {
        return { response, result: await response.json() as ApiResult<LoginPayload> };
      } catch (error) {
        // A deadline can interrupt body consumption after headers arrived. It is
        // a recoverable transport error, never an invalid-credentials result.
        if (signal.aborted) throw error;
        return { response, result: null };
      }
    }, options);
  } catch (error) {
    // Session bootstrap owns cancellation during navigation/logout. Preserve
    // its AbortError identity so callers can distinguish it from recovery UI.
    if (options.signal?.aborted) throw options.signal.reason;
    const original = error instanceof Error ? error.message : String(error);
    const translated = formatAdminApiError(original, "NETWORK_FAILURE");
    throw new Error(translated);
  }
}

export async function loginAdmin(username: string, password: string): Promise<LoginStartResult> {
  const { response, result } = await requestAdminAuthJson("/api/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: username.trim(), password }),
    cache: "no-store",
  });

  if (!response.ok || !result || result.code !== 0 || !result.data) {
    throw new Error(formatAdminApiError(result?.message, "ADMIN_CREDENTIAL_INVALID"));
  }

  if (result.data.session) {
    return { loginResult: normalizeLoginPayload(result.data) };
  }
  if (result.data.mfa?.challengeId) {
    return { mfaChallenge: result.data.mfa };
  }
  throw new Error(formatAdminApiError(result.message, "ADMIN_SESSION_INVALID"));
}

export async function verifyAdminMfa(challengeId: string, code: string): Promise<LoginResult> {
  const { response, result } = await requestAdminAuthJson("/api/admin/auth/mfa/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeId, code: code.trim() }),
    cache: "no-store",
  });
  if (!response.ok || !result || result.code !== 0 || !result.data?.session) {
    throw Object.assign(new Error(formatAdminApiError(result?.message, "ADMIN_MFA_CODE_INVALID")), {
      code: result?.message || "ADMIN_MFA_CODE_INVALID",
    });
  }
  return normalizeLoginPayload(result.data);
}

// merge 2026-08-06:结构取 main(signal + lifecycle epoch 防过期响应),网络出口取错误文案
// 专项的 guardedFetch 咽喉(英文网络异常在此转中文,全 client 单一出口)。
export async function currentAdminSession(options: { signal?: AbortSignal } = {}): Promise<LoginResult | null> {
  const requestEpoch = adminAuthLifecycleEpoch();
  const { response, result } = await requestAdminAuthJson("/api/admin/auth/session", { cache: "no-store" }, options);
  if (requestEpoch !== adminAuthLifecycleEpoch()) throw new AdminAuthEpochChangedError();
  const payload = authoritativeAdminSessionPayload(response.status, response.ok, result);
  return payload ? normalizeLoginPayload(payload) : null;
}

export async function changeAdminPassword(currentPassword: string, newPassword: string): Promise<LoginResult> {
  const { response, result } = await requestAdminAuthJson("/api/admin/auth/password/change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
    cache: "no-store",
  });

  if (!response.ok || !result || result.code !== 0 || !result.data?.session) {
    throw new Error(formatAdminApiError(result?.message, "ADMIN_PASSWORD_CHANGE_FAILED"));
  }

  return normalizeLoginPayload(result.data);
}

function normalizeLoginPayload(payload: LoginPayload): LoginResult {
  if (!payload.session) throw new Error("ADMIN_SESSION_INVALID");
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
