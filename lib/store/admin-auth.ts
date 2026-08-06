import { create } from "zustand";
import { clearPendingCommandRecords } from "@/lib/admin/pending-mutation-store";
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
 * 🔴 会话结束 / 换人时必须清掉在途命令号(2026-08-06 独立验收 P0)。
 *
 * 命令号是「谁在什么时候提交了哪条命令」的凭据。不清的后果:同一个 tab 里 A 退出、B 登录后
 * 复用 A 留下的号 → 后端按幂等回放 A 那条提案 → B 的操作被静默吞掉,而审计轨记在 A 头上。
 *
 * 接在 **signOut** 上而不是别处:退出按钮(topbar)、会话恢复失败与定时续期失活
 * (console-shell 三处)、j 域撞 401 —— 所有登出路径都汇到这一个函数。
 * 先前只接了 `resetAdminSession`,那是**撞 401 的自动重置**路径,真正的退出按钮根本不走它。
 *
 * 🔴 **绝不在 signIn 上无条件清**:signIn 每次页面加载(会话恢复)和定时续期都会调用,
 * 无条件清会把「命令号跨刷新存活」这个根本机制毁掉 —— 那正是整套设计要解决的问题。
 * 只有**操作员真的换了人**才清。
 */
export const useAdminAuth = create<AdminAuthState>()((set) => ({
  isAuthenticated: false,
  operator: "",
  role: "auditor",
  tokenType: null,
  session: null,
  signIn: ({ tokenType, session }) =>
    set((state) => {
      // 同一人刷新 / 续期:state.operator 相同(或首次加载时为空)→ 不清,命令号照常跨刷新存活。
      if (state.operator && state.operator !== session.operator) clearPendingCommandRecords();
      return {
        isAuthenticated: !session.passwordChangeRequired,
        operator: session.operator,
        role: session.role,
        tokenType,
        session,
      };
    }),
  signOut: () => {
    clearPendingCommandRecords();
    set({
      isAuthenticated: false,
      operator: "",
      role: "auditor",
      tokenType: null,
      session: null,
    });
  },
}));
