"use client";

/** 当前是否总管理员。挂载前/SSR 默认 true(与默认登录一致),避免 hydration 抖动。 */
import { useEffect, useState } from "react";
import { useAdminAuth } from "./admin-auth";

export function useIsSuperadmin(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const role = useAdminAuth((s) => s.role);
  return mounted ? role === "superadmin" : true;
}
