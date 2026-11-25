import { adminAuthActivityAllowed, adminAuthLifecycleEpoch, beginAdminLogout } from "./auth-lifecycle.ts";
import { requestAdminLogoutIfExpired } from "./logout-request.ts";

const ADMIN_AUTH_STORAGE_KEY = "nexion-admin-auth-v2";
const AUTH_REQUIRED_MESSAGES = new Set(["ADMIN_AUTH_REQUIRED", "UNAUTHORIZED"]);
export const ADMIN_SESSION_EXPIRED_EVENT = "nexion-admin-session-expired";

let authResetScheduled = false;
let expiryCheck: Promise<void> | null = null;

export function isAdminAuthFailure(status: number, message?: string) {
  return status === 401 || AUTH_REQUIRED_MESSAGES.has(message ?? "");
}

export function adminSessionExpiryPending() {
  return expiryCheck !== null || authResetScheduled;
}

export function resetAdminSession(epoch = adminAuthLifecycleEpoch()) {
  if (typeof window === "undefined" || adminSessionExpiryPending()
    || epoch !== adminAuthLifecycleEpoch() || !adminAuthActivityAllowed()) return;
  expiryCheck = requestAdminLogoutIfExpired(epoch, () => {
    authResetScheduled = true;
    beginAdminLogout();
    window.dispatchEvent(new Event(ADMIN_SESSION_EXPIRED_EVENT));
    try {
      window.localStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
    } catch {
      // The reload below still returns to a clean shell.
    }
  });
  void expiryCheck
    .catch(() => undefined)
    .finally(() => {
      expiryCheck = null;
      if (authResetScheduled) window.location.reload();
    });
}
