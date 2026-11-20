import { create } from "zustand";
import {
  beginAdminLogout,
  cancelAdminLogout,
  completeAdminLogout,
  renewAdminAuthLifecycle,
} from "@/lib/admin/auth-lifecycle";
import { claimPendingCommandOwner, clearPendingCommandRecords } from "@/lib/admin/pending-mutation-store";
import type { AdminRole, EffectiveMenuNode } from "@/lib/nav/console-nav";
import type { SupportReadMode } from "@/lib/admin/session-role";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import { useUI } from "@/lib/store/ui";

export interface AdminSession {
  adminId: number;
  username: string;
  operator: string;
  role: AdminRole;
  authorities: string[];
  supportReadModes?: SupportReadMode[];
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

/** Auth changes control access to originals, never their lifetime or ownership. */
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
      const accessChanged = adminShellSessionKey(state.session) !== adminShellSessionKey(session);
      if (identityChanged || accessChanged) renewAdminAuthLifecycle();
      if (identityChanged) useUI.getState().dismissPersistentToasts();
      claimPendingCommandOwner(session.passwordChangeRequired ? "" : String(session.adminId));
      return {
        isAuthenticated: !session.passwordChangeRequired,
        operator: session.operator,
        role: session.role,
        tokenType,
        session,
        sessionResolution: "authenticated",
        authEpoch: identityChanged || accessChanged ? state.authEpoch + 1 : state.authEpoch,
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
    clearPendingCommandRecords();
    useUI.getState().dismissPersistentToasts();
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
