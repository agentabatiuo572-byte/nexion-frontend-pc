import type { LoginResult } from "./auth-client";
import { renewAdminAuthLifecycle } from "./auth-lifecycle.ts";

interface InteractiveLoginOptions {
  readAuthoritativeSession: () => Promise<LoginResult | null>;
}

/**
 * Commit login state only after the HttpOnly cookie has produced a server session.
 *
 * 在途命令号的清扫**不在这里**:它由 signIn 里的身份认领统一负责
 * (`claimPendingCommandOwner`,换人才清、同一人不清)。本函数曾短暂挂过一道无条件清扫,
 * 但那会误伤「同一个人会话过期后重新登录再重试」—— 而那正是最需要保住命令号的场景。
 * (merge 2026-08-06:实现路线取 main 的权威 session 确认;清扫职责决策取幂等包。)
 */
export async function completeInteractiveLogin(
  signIn: (result: LoginResult) => void,
  hintedResult: LoginResult,
  options: InteractiveLoginOptions,
): Promise<LoginResult> {
  // A previous 401 intentionally closes the old lifecycle. MFA/password login
  // has now succeeded, so start a fresh epoch before confirming the new cookie.
  renewAdminAuthLifecycle();
  const authoritativeResult = await options.readAuthoritativeSession();
  if (!authoritativeResult) throw new Error("ADMIN_SESSION_NOT_ESTABLISHED");

  const hintedIdentity = hintedResult.session;
  const authoritativeIdentity = authoritativeResult.session;
  if (
    authoritativeIdentity.adminId !== hintedIdentity.adminId
    || authoritativeIdentity.username !== hintedIdentity.username
  ) {
    throw new Error("ADMIN_SESSION_IDENTITY_MISMATCH");
  }

  signIn(authoritativeResult);
  return authoritativeResult;
}
