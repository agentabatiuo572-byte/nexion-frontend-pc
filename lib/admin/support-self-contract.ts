export const EXPECTED_ADMIN_ID_HEADER = "X-Expected-Admin-Id";
export const SELF_ACCOUNT_MISMATCH = "SELF_ACCOUNT_MISMATCH";

export function isSupportSelfAccountMismatch(error: unknown) {
  return error instanceof Error && "backendMessage" in error && error.backendMessage === SELF_ACCOUNT_MISMATCH;
}
