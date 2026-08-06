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

  // 在途命令号**刻意不在这里清**:401 只说明会话失效,不代表换了人 —— 同一个人重新登录后
  // 那些号还得用(结果未知的重试必须同号,否则后端去重失效 = 重复打款)。清扫由 signIn 的
  // 身份认领统一负责(claimPendingCommandOwner:比对持久化的 adminId,换人才清)。
  // 早期版本在这里无条件清,会误伤同一个人的在途命令号 —— 第三轮独立验收 P0-2。

  void fetch("/api/admin/auth/logout", { method: "POST", cache: "no-store" })
    .catch(() => undefined)
    .finally(() => window.location.reload());
}
