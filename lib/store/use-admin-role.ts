"use client";

/** 当前是否总管理员。挂载前保守返回 false; 权限只来自服务端恢复后的登录态。 */
import { useAdminAuth } from "./admin-auth";

export function useIsSuperadmin(): boolean {
  const role = useAdminAuth((s) => s.role);
  return role === "superadmin";
}
