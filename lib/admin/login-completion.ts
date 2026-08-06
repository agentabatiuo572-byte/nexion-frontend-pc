import type { LoginResult } from "./auth-client";
import { clearPendingCommandRecords } from "./pending-mutation-store.ts";

/**
 * Finish an interactive login with a document reload.
 *
 * The session cookie remains server-owned; reloading only replaces a possibly
 * stale SPA bundle so newly deployed navigation and permission rules take effect.
 *
 * 🔴 交互式登录 = 一位操作员在这个 tab 上**重新开始**,此前留下的在途命令号一律不属于他。
 *   这是登录侧的兜底闸:signOut / resetAdminSession 覆盖的是「正常退出」与「会话失效自动重置」,
 *   而本函数覆盖「无论前面发生过什么,新的人从登录页进来」这条兜底路径。
 *   命令号存在 sessionStorage(逐 tab),同 tab 换人正是它唯一会串号的场景。
 *
 *   放这里而不是放 signIn:signIn 每次页面加载(会话恢复)与定时续期都会调用,
 *   在那里无条件清会毁掉「命令号跨刷新存活」—— 那是整套设计的根本。
 *   本函数只在**真的走完一次登录表单**时执行,没有这个副作用。
 *   出处:2026-08-06 结构性反思自查项①「这条链的入口有几个」——逐个 grep 时发现的第三条路径。
 */
export function completeInteractiveLogin(
  signIn: (result: LoginResult) => void,
  result: LoginResult,
  reload: () => void = () => window.location.reload(),
) {
  clearPendingCommandRecords();
  signIn(result);
  reload();
}
