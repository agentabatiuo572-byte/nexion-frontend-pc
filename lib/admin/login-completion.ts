import type { LoginResult } from "./auth-client";
import { renewAdminAuthLifecycle } from "./auth-lifecycle.ts";

interface InteractiveLoginOptions {
  readAuthoritativeSession: () => Promise<LoginResult | null>;
}

/** Commit login state only after the HttpOnly cookie has produced a server session. */
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
