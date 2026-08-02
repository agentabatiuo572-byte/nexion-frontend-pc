import { create } from "zustand";
import {
  beginAdminLogout,
  cancelAdminLogout,
  completeAdminLogout,
  renewAdminAuthLifecycle,
} from "@/lib/admin/auth-lifecycle";
import type { AdminRole, EffectiveMenuNode } from "@/lib/nav/console-nav";

export interface AdminSession {
  adminId: number;
  username: string;
  operator: string;
  role: AdminRole;
  authorities: string[];
  /** Effective nx_admin_role_menu codes from the authenticated session. */
  menuCodes?: string[];
  menuNodes?: EffectiveMenuNode[];
  passwordChangeRequired?: boolean;
}

interface AdminAuthState {
  isAuthenticated: boolean;
  operator: string;
  role: AdminRole;
  tokenType: string | null;
  session: AdminSession | null;
  sessionResolution: "unknown" | "authenticated" | "anonymous";
  /** Monotonic browser-auth lifecycle version; prevents cache reuse after logout/relogin. */
  authEpoch: number;
  logoutPending: boolean;
  logoutUnknown: boolean;
  logoutError: string | null;
  signIn: (auth: { tokenType: string; session: AdminSession }) => void;
  beginLogout: () => void;
  cancelLogout: (message: string) => void;
  beginLogoutVerification: () => void;
  failLogoutUnknown: (message: string) => void;
  signOut: () => void;
}

export const useAdminAuth = create<AdminAuthState>()((set) => ({
  isAuthenticated: false,
  operator: "",
  role: "auditor",
  tokenType: null,
  session: null,
  sessionResolution: "unknown",
  authEpoch: 0,
  logoutPending: false,
  logoutUnknown: false,
  logoutError: null,
  signIn: ({ tokenType, session }) =>
    set((state) => {
      // A session response that started before logout must not reopen the
      // shell while the revocation response is still being confirmed.
      if (state.logoutPending) return state;
      const identityChanged =
        state.session == null
        || state.session.adminId !== session.adminId
        || state.session.username !== session.username;
      if (identityChanged) renewAdminAuthLifecycle();
      return {
        isAuthenticated: !session.passwordChangeRequired,
        operator: session.operator,
        role: session.role,
        tokenType,
        session,
        sessionResolution: "authenticated",
        authEpoch: identityChanged ? state.authEpoch + 1 : state.authEpoch,
        logoutPending: false,
        logoutUnknown: false,
        logoutError: null,
      };
    }),
  beginLogout: () => {
    beginAdminLogout();
    set((state) => state.logoutPending ? state : ({
      logoutPending: true,
      logoutUnknown: false,
      logoutError: null,
    }));
  },
  cancelLogout: (message) => {
    cancelAdminLogout();
    set((state) => ({
      logoutPending: false,
      logoutUnknown: false,
      logoutError: message,
    }));
  },
  beginLogoutVerification: () => {
    // Keep the visual gate closed while allowing one authoritative session GET.
    cancelAdminLogout();
  },
  failLogoutUnknown: (message) => {
    set({
      logoutPending: false,
      logoutUnknown: true,
      logoutError: message,
      sessionResolution: "unknown",
    });
  },
  signOut: () => {
    completeAdminLogout();
    set((state) => ({
      isAuthenticated: false,
      operator: "",
      role: "auditor",
      tokenType: null,
      session: null,
      sessionResolution: "anonymous",
      authEpoch: state.authEpoch + 1,
      logoutPending: false,
      logoutUnknown: false,
      logoutError: null,
    }));
  },
}));
