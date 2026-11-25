import { useAdminAuth } from "@/lib/store/admin-auth";

export function currentRecoveryActor(actorId: string | number | undefined) {
  const { session, isAuthenticated, logoutPending, logoutUnknown } = useAdminAuth.getState();
  return isAuthenticated && !logoutPending && !logoutUnknown && session && !session.passwordChangeRequired
    && String(session.adminId) === String(actorId) ? session : null;
}

export function canCreateRecoveryProposal(authorities: readonly string[]) {
  return authorities.includes("platform_a2_write") || authorities.includes("platform_a2_proposal_create");
}

/** For a saved original only. Queue access still requires A2 read authority. */
export function canReadOwnRecoveryProposal(authorities: readonly string[]) {
  return authorities.includes("platform_a2_read") || canCreateRecoveryProposal(authorities);
}

export const APPROVAL_REPLAY_RELEASE = "先到操作记录与审批核实有没有建单；「解除原操作记录」只清本页这条记录，已经建的审批单不受影响。";
/** 看不了操作记录与审批的账号：让人找能看的同事核实，不指向进不去的页面（OP-126、ST-58）。 */
export const APPROVAL_REPLAY_RELEASE_NO_AUDIT = "先请能看操作记录与审批的同事核实有没有建单；「解除原操作记录」只清本页这条记录，已经建的审批单不受影响。";

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

/** Apply only the original operator's edits to the latest authoritative values (OP-97). */
export function rebaseRecoveryFields<T extends object>(before: T, desired: Partial<T>, latest: T): T {
  const merged = { ...latest };
  for (const key of Object.keys(desired) as (keyof T)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(desired[key])) Object.assign(merged, { [key]: desired[key] });
  }
  return merged;
}

export function rebaseRecoverySet<T>(before: readonly T[], desired: readonly T[], latest: readonly T[]): T[] {
  const original = new Set(before), proposed = new Set(desired);
  return [...new Set([...latest.filter(item => !original.has(item) || proposed.has(item)), ...desired.filter(item => !original.has(item))])];
}

/** The old draft remains until this confirmation succeeds or has a retained replacement. */
export async function sendRecoveredDraft<T>(send: () => Promise<T>, hasReplacement: () => boolean, discard?: () => void): Promise<T> {
  let sent = false;
  try {
    const result = await send();
    sent = true;
    return result;
  } finally {
    if (discard && (sent || hasReplacement())) discard();
  }
}
