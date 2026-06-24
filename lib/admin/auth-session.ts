const ADMIN_AUTH_STORAGE_KEY = "nexion-admin-auth-v2";
const AUTH_REQUIRED_MESSAGES = new Set(["ADMIN_AUTH_REQUIRED", "UNAUTHORIZED"]);

let authResetScheduled = false;

export function isAdminAuthFailure(status: number, message?: string) {
  return status === 401 || AUTH_REQUIRED_MESSAGES.has(message ?? "");
}

export function resetAdminSession() {
  if (typeof window === "undefined" || authResetScheduled) return;
  authResetScheduled = true;

  try {
    window.localStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
  } catch {
    // Ignore storage access failures; the reload below still returns to a clean shell.
  }

  void fetch("/api/admin/auth/logout", { method: "POST", cache: "no-store" })
    .catch(() => undefined)
    .finally(() => window.location.reload());
}
