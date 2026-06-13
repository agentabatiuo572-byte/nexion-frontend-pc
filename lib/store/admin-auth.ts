// 运营账号 store(原型 stub)— 无真鉴权,仅承载 operator + role 供 RBAC 侧栏演示。
// 默认以总管理员登录,主人打开即见全 12 域;TopBar 可切角色现场演示权限过滤。
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AdminRole } from "@/lib/nav/console-nav";

interface AdminAuthState {
  isAuthenticated: boolean;
  operator: string;
  role: AdminRole;
  signIn: (operator: string, role: AdminRole) => void;
  signOut: () => void;
  setRole: (role: AdminRole) => void;
}

export const useAdminAuth = create<AdminAuthState>()(
  persist(
    (set) => ({
      isAuthenticated: true,
      operator: "总管理员",
      role: "superadmin",
      signIn: (operator, role) => set({ isAuthenticated: true, operator, role }),
      signOut: () => set({ isAuthenticated: false }),
      setRole: (role) => set({ role }),
    }),
    {
      name: "nexion-admin-auth-v1",
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);
