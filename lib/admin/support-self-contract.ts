export const EXPECTED_ADMIN_ID_HEADER = "X-Expected-Admin-Id";
export const SELF_ACCOUNT_MISMATCH = "SELF_ACCOUNT_MISMATCH";

export function isSupportSelfAccountMismatch(error: unknown) {
  return error instanceof Error && "backendMessage" in error && error.backendMessage === SELF_ACCOUNT_MISMATCH;
}

export function verifySupportSelfReadOwner(value: unknown, expectedAdminId: number) {
  if (!value || typeof value !== "object" || !Object.hasOwn(value, "ownerAdminId")) return;
  const owner = (value as { ownerAdminId: unknown }).ownerAdminId;
  if (owner !== expectedAdminId && owner !== String(expectedAdminId)) {
    throw Object.assign(new Error(SELF_ACCOUNT_MISMATCH), { backendMessage: SELF_ACCOUNT_MISMATCH });
  }
}
