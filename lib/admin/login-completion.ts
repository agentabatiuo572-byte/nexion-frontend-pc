import type { LoginResult } from "./auth-client";

/**
 * Finish an interactive login with a document reload.
 *
 * The session cookie remains server-owned; reloading only replaces a possibly
 * stale SPA bundle so newly deployed navigation and permission rules take effect.
 *
 * 在途命令号的清扫**不在这里**:它由 signIn 里的身份认领统一负责
 * (`claimPendingCommandOwner`,换人才清、同一人不清)。本函数曾短暂挂过一道无条件清扫,
 * 但那会误伤「同一个人会话过期后重新登录再重试」—— 而那正是最需要保住命令号的场景。
 */
export function completeInteractiveLogin(
  signIn: (result: LoginResult) => void,
  result: LoginResult,
  reload: () => void = () => window.location.reload(),
) {
  signIn(result);
  reload();
}
