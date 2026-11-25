import { currentAdminSession } from "@/lib/admin/auth-client";
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { toast } from "@/lib/store/ui";

export const SELF_SESSION_CHANGED = "登录账号已变化或失效，这次没有提交。请核对当前账号后再操作。";
export const SELF_READ_SESSION_CHANGED = "登录账号已变化或失效，已清除原账号资料。请核对当前账号。";

export function isSupportAccessFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  const { status, backendMessage } = error as Error & { status?: number; backendMessage?: string };
  return status === 403 || isAdminAuthFailure(status ?? 0, backendMessage) || isPermissionDenied(error);
}

export function isSupportWriteBeforeAuthFailure(error: unknown) {
  return error instanceof Error && "status" in error && error.status === 401
    && "backendMessage" in error && error.backendMessage === "ADMIN_AUTH_REQUIRED";
}

export function refreshSupportAccess(error: unknown) {
  const { status, backendMessage } = error as { status?: number; backendMessage?: string };
  if (isAdminAuthFailure(status ?? 0, backendMessage)) resetAdminSession();
  else announcePermissionDenied();
}

export async function checkSupportSelfSession(actorId: number, signal?: AbortSignal, changedMessage = SELF_SESSION_CHANGED) {
  const auth = await currentAdminSession({ signal }).catch(error => {
    // The shell can finish its own identity refresh while this check is in flight.
    if (useAdminAuth.getState().session?.adminId === actorId) throw error;
    return undefined;
  });
  if (signal?.aborted) return false;
  if (auth?.session.adminId === actorId && useAdminAuth.getState().session?.adminId === actorId) return true;
  if (auth) useAdminAuth.getState().signIn(auth);
  else if (auth === null) resetAdminSession();
  toast.warn(changedMessage);
  return false;
}

export function reportSupportSelfWriteMismatch() {
  toast.warn(SELF_SESSION_CHANGED);
  announcePermissionDenied();
}
