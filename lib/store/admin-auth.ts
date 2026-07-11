import { create } from "zustand";
import type { AdminRole } from "@/lib/nav/console-nav";

export interface AdminSession {
  adminId: number;
  username: string;
  operator: string;
  role: AdminRole;
  authorities: string[];
  /** Effective nx_admin_role_menu codes from the authenticated session. */
  menuCodes?: string[];
  passwordChangeRequired?: boolean;
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

export const useAdminAuth = create<AdminAuthState>()((set) => ({
  isAuthenticated: false,
  operator: "",
  role: "auditor",
  tokenType: null,
  session: null,
  signIn: ({ tokenType, session }) =>
    set({
      isAuthenticated: !session.passwordChangeRequired,
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
}));
