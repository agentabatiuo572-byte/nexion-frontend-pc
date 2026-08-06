import { clearPendingCommandRecords } from "@/lib/admin/pending-mutation-store";

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

  // 🔴 换人必须连在途命令号一起清(2026-08-06)。只清 auth 键的话,同一个 tab 里 B 登录后
  //   会复用 A 留下的命令号 —— 后端按幂等回放 A 那条提案:B 的操作被静默吞掉,而审计轨记在
  //   A 头上。操作被吞 + 审计归属错位,两个都是高敏事故。
  //   清扫按**记录形状**认表而不按键名(键名会漂:同族里既有 nexgrid- 前缀,也有压根不含
  //   commands 的 h9 那把),详见 pending-mutation-store.ts 的 clearPendingCommandRecords。
  clearPendingCommandRecords(window.sessionStorage);

  void fetch("/api/admin/auth/logout", { method: "POST", cache: "no-store" })
    .catch(() => undefined)
    .finally(() => window.location.reload());
}
