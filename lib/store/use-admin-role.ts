"use client";

/** 当前是否总管理员。挂载前保守返回 true; ConsoleShell 会在登录态水合后再渲染后台内容。 */
import { useEffect, useState } from "react";
import { useAdminAuth } from "./admin-auth";

export function useIsSuperadmin(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const role = useAdminAuth((s) => s.role);
  return mounted ? role === "superadmin" : true;
}
