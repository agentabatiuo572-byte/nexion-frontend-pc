import { create } from "zustand";
import {
  beginAdminLogout,
  cancelAdminLogout,
  completeAdminLogout,
  renewAdminAuthLifecycle,
} from "@/lib/admin/auth-lifecycle";
import { claimPendingCommandOwner } from "@/lib/admin/pending-mutation-store";
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

/**
 * 🔴 在途命令号的清扫挂在 **signIn 的身份认领**上,不挂在 signOut(2026-08-06 三轮验收)。
 *
 * 命令号是「谁在什么时候提交了哪条命令」的凭据,只有**换了人**才必须作废:
 * - 挂 signOut 会**误伤同一个人**:会话端点抖一下,console-shell 的 catch 里就 signOut(),
 *   把他自己的在途命令号清光 —— 而「会话过期后重新登录再重试」正是最典型的重试场景,
 *   清了就必然铸新号 = 重复打款。
 * - 挂 signOut 还**漏得掉**:A 不点退出直接按 F5、而 cookie 已换成 B,根本不经过 signOut。
 *
 * signIn 每次页面加载与定时续期都会调用,所以判据必须是「身份真的变了」——
 * 靠持久化的 adminId 比对(见 claimPendingCommandOwner),不是靠内存里的显示名:
 * 刷新后内存状态为空,拿它比对等于永远判不出换人;显示名还会重名、会改。
 */
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
      // merge 2026-08-06(幂等包):在途命令号按身份认领 —— 换人才清、同一人续用
      // (claim 内部按 owner 比对,同人重登不清,保住「会话过期重登后原样重试」的命令号)。
      claimPendingCommandOwner(String(session.adminId));
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
