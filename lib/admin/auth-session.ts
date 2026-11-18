import { beginAdminLogout } from "./auth-lifecycle.ts";
import { requestAdminLogout } from "./logout-request.ts";

const ADMIN_AUTH_STORAGE_KEY = "nexion-admin-auth-v2";
const AUTH_REQUIRED_MESSAGES = new Set(["ADMIN_AUTH_REQUIRED", "UNAUTHORIZED"]);

let authResetScheduled = false;

export function isAdminAuthFailure(status: number, message?: string) {
  return status === 401 || AUTH_REQUIRED_MESSAGES.has(message ?? "");
}

export function resetAdminSession() {
  if (typeof window === "undefined" || authResetScheduled) return;
  authResetScheduled = true;
  beginAdminLogout();

  try {
    window.localStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
  } catch {
    // Ignore storage access failures; the reload below still returns to a clean shell.
  }

  // Session expiry is not a command verdict. Originals remain owned by their
  // submitter; signIn restores access only to that person's journal rows.

  void requestAdminLogout()
    .catch(() => undefined)
    .finally(() => window.location.reload());
}
