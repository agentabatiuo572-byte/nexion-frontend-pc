import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AdminRole } from "@/lib/nav/console-nav";

export interface AdminSession {
  adminId: number;
  username: string;
  operator: string;
  role: AdminRole;
  authorities: string[];
}

interface AdminAuthState {
  isAuthenticated: boolean;
  operator: string;
  role: AdminRole;
  tokenType: string | null;
  session: AdminSession | null;
  signIn: (auth: { tokenType: string; session: AdminSession }) => void;
  signOut: () => void;
}

export const useAdminAuth = create<AdminAuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      operator: "",
      role: "auditor",
      tokenType: null,
      session: null,
      signIn: ({ tokenType, session }) =>
        set({
          isAuthenticated: true,
          operator: session.operator,
          role: session.role,
          tokenType,
          session,
        }),
      signOut: () =>
        set({
          isAuthenticated: false,
          operator: "",
          role: "auditor",
          tokenType: null,
          session: null,
        }),
    }),
    {
      name: "nexion-admin-auth-v2",
      storage: createJSONStorage(() => localStorage),
      version: 2,
    },
  ),
);
