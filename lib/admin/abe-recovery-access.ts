import { useAdminAuth } from "@/lib/store/admin-auth";

export function currentRecoveryActor(actorId: string | number | undefined) {
  const { session, isAuthenticated, logoutPending, logoutUnknown } = useAdminAuth.getState();
  return isAuthenticated && !logoutPending && !logoutUnknown && session && !session.passwordChangeRequired
    && String(session.adminId) === String(actorId) ? session : null;
}

export function canCreateRecoveryProposal(authorities: readonly string[]) {
  return authorities.includes("platform_a2_write") || authorities.includes("platform_a2_proposal_create");
}

export function recoveryQueryConclusion(state: string) {
  if (state === "NOT_FOUND") return "not-found";
  if (state === "SUCCEEDED" || state === "CONFIRMED_SUCCEEDED") return "succeeded";
  if (state === "NOT_EXECUTED" || state === "CONFIRMED_NOT_EXECUTED") return "not-executed";
  if (state === "CONFIRMED_REJECTED") return "rejected";
  return "unknown";
}

export function nextRecoveryDeadline(records: readonly { expiresAt: number }[]) {
  const now = Date.now();
  const next = records.reduce((first, record) => record.expiresAt > now ? Math.min(first, record.expiresAt) : first, Infinity);
  return Number.isFinite(next) ? next : undefined;
}

/** Earlier pages saved the display text of an explicit replay rejection. */
export function withLegacyReplayRejection<T extends { replayRejection?: string; retryRejection?: string }>(record: T): T {
  return !record.replayRejection && record.retryRejection?.trim()
    ? { ...record, replayRejection: record.retryRejection }
    : record;
}
