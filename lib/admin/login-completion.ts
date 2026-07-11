import type { LoginResult } from "./auth-client";

/**
 * Finish an interactive login with a document reload.
 *
 * The session cookie remains server-owned; reloading only replaces a possibly
 * stale SPA bundle so newly deployed navigation and permission rules take effect.
 */
export function completeInteractiveLogin(
  signIn: (result: LoginResult) => void,
  result: LoginResult,
  reload: () => void = () => window.location.reload(),
) {
  signIn(result);
  reload();
}
