import { create } from "zustand";
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
  signIn: (auth: { tokenType: string; session: AdminSession }) => void;
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
  signIn: ({ tokenType, session }) => {
    // 🔴 只把**可用的**身份交出去(2026-08-06 第四轮验收 P1-A):
    //   直接 String(session.adminId) 会把 undefined / null 变成 "undefined" / "null" ——
    //   两个不同的人于是共用一个归属,换人判不出来。畸形值一律当「没有身份」,
    //   由 claimPendingCommandOwner 走它的放行分支(不清也不写标记,留待下次正常会话比对)。
    claimPendingCommandOwner(Number.isFinite(session.adminId) ? String(session.adminId) : "");
    set({
      isAuthenticated: !session.passwordChangeRequired,
      operator: session.operator,
      role: session.role,
      tokenType,
      session,
    });
  },
  signOut: () =>
    set({
      isAuthenticated: false,
      operator: "",
      role: "auditor",
      tokenType: null,
      session: null,
    }),
}));
