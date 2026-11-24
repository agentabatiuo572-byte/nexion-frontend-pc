import { createPendingMutationStore, createPendingRecovery, PENDING_MUTATION_TTL_MS, type PendingMutationRecord, type PendingRecoveryConclusion } from "@/lib/admin/pending-mutation-store";
import { avatarGender, avatarKey, parsePreparedAvatar, selfAvatarSaveInput, type AvatarGender, type AvatarScope, type PreparedAvatar, type SelfAvatarSave } from "@/lib/admin/account-avatar-contract";
import { cancelA1Avatar } from "@/lib/admin/a1-client";
import { fetchDirectCommandReceipt } from "@/lib/admin/direct-command-receipt";
import { explicitRejectionCode } from "@/lib/admin/explicit-rejection";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { canAccessResolvedPath, resolveVisibleDomains } from "@/lib/nav/console-nav";

export interface AvatarDraft extends PendingMutationRecord {
  actorId: number; scope: AvatarScope; kind: "DEFAULT" | "UPLOAD"; clientUploadId: string;
  gender?: AvatarGender; fileHash?: string; fileName?: string; fileMime?: string; asset?: PreparedAvatar; cancelKey?: string;
  cancelCreatedAt?: number; cancelRejection?: string;
}
type AvatarCancellation = PendingMutationRecord & { actorId: number; draftKey: string; assetId: string };
export interface SelfAvatarPending extends PendingMutationRecord { actorId: number; input: SelfAvatarSave }
export const avatarDraftFingerprint = (actorId: number, scope: AvatarScope, target: string) => `${actorId}:${scope}:${target}`;
export const avatarDrafts = createPendingMutationStore<AvatarDraft>({
  storageKey: "nexion-account-avatar-drafts-v1", retainExpiredRecords: true,
  isValidRecord: row => {
    try {
      if (!Number.isSafeInteger(row.actorId) || row.actorId <= 0 || !["admin", "self"].includes(row.scope) || !["DEFAULT", "UPLOAD"].includes(row.kind)) return false;
      avatarKey(row.commandKey); avatarKey(row.clientUploadId);
      if (row.kind === "DEFAULT") avatarGender(row.gender);
      else if (!/^[a-f0-9]{64}$/.test(row.fileHash ?? "") || typeof row.fileName !== "string" || !["image/png", "image/jpeg"].includes(row.fileMime ?? "")) return false;
      if (row.asset) parsePreparedAvatar(row.asset, row.scope);
      if (row.cancelKey) avatarKey(row.cancelKey);
      if (row.cancelCreatedAt !== undefined && (!Number.isSafeInteger(row.cancelCreatedAt) || row.cancelCreatedAt < row.createdAt)) return false;
      return true;
    } catch { return false; }
  },
});
export function canWriteA1Avatar(actorId: number | undefined) {
  const { session, isAuthenticated, logoutPending, logoutUnknown } = useAdminAuth.getState();
  return !!session && isAuthenticated && !logoutPending && !logoutUnknown && !session.passwordChangeRequired
    && session.adminId === actorId && ["super", "superadmin"].includes(session.role)
    && session.authorities.includes("platform_a1_read") && session.authorities.includes("platform_a1_write")
    && canAccessResolvedPath(resolveVisibleDomains(session), "/platform/rbac");
}

export const a1AvatarPreparationRecovery = createPendingRecovery(avatarDrafts, {
  capability: () => "replay",
  canReplay: row => row.scope === "admin" && !row.asset && !row.cancelKey && canWriteA1Avatar(row.actorId),
  explicitRejectionCode,
});
export function a1AvatarCancellation(draft: AvatarDraft): AvatarCancellation | undefined {
  if (draft.scope !== "admin" || !draft.asset || !draft.cancelKey) return;
  // Legacy cancellations have the original asset and key, but no cancellation timestamp.
  // Their guaranteed replay window starts no earlier than avatar preparation.
  const createdAt = draft.cancelCreatedAt ?? draft.createdAt;
  return {
    fingerprint: draft.fingerprint, commandOwnerId: draft.commandOwnerId, actorId: draft.actorId,
    draftKey: draft.commandKey, commandKey: draft.cancelKey, assetId: draft.asset.assetId,
    createdAt, expiresAt: createdAt + PENDING_MUTATION_TTL_MS, replayRejection: draft.cancelRejection,
  };
}
function findCancellationDraft(fingerprint: string, key?: string) {
  return avatarDrafts.list().find(draft => draft.fingerprint === fingerprint && draft.cancelKey === key && a1AvatarCancellation(draft));
}
export const a1AvatarCancellationRecovery = createPendingRecovery<AvatarCancellation>({
  list: () => avatarDrafts.list().flatMap(draft => {
    const original = a1AvatarCancellation(draft);
    return original ? [original] : [];
  }),
  isDurablyStored(fingerprint, key) {
    const draft = findCancellationDraft(fingerprint, key);
    return !!draft && avatarDrafts.isDurablyStored(fingerprint, draft.commandKey);
  },
  forget(fingerprint, key) {
    const draft = findCancellationDraft(fingerprint, key);
    if (draft) rememberAvatarDraft({ ...draft, cancelKey: undefined, cancelCreatedAt: undefined, cancelRejection: undefined }, true);
  },
  markReplayRejected(fingerprint, key, code) {
    const draft = findCancellationDraft(fingerprint, key);
    if (draft) rememberAvatarDraft({ ...draft, cancelRejection: code }, true);
  },
}, {
  capability: () => "receipt",
  canReplay: record => canWriteA1Avatar(record.actorId),
  explicitRejectionCode,
});
export const selfAvatarCommands = createPendingMutationStore<SelfAvatarPending>({
  storageKey: "nexion-self-avatar-save-v1", retainExpiredRecords: true,
  isValidRecord: row => {
    try { avatarKey(row.commandKey); selfAvatarSaveInput(row.input); return Number.isSafeInteger(row.actorId) && row.actorId > 0; } catch { return false; }
  },
});
export function rememberAvatarDraft(draft: AvatarDraft, recovering = false): AvatarDraft {
  const { fingerprint, commandKey, createdAt: _createdAt, expiresAt: _expiresAt, ...extra } = draft;
  avatarDrafts.remember(fingerprint, commandKey, extra);
  if (!avatarDrafts.isDurablyStored(fingerprint, commandKey)) throw new Error(recovering ? "AVATAR_COMMAND_RETRY_STORAGE_UNAVAILABLE" : "AVATAR_COMMAND_STORAGE_UNAVAILABLE");
  return avatarDrafts.list().find(row => row.fingerprint === fingerprint && row.commandKey === commandKey)!;
}
/** Only a retained original cancellation receipt settles the cancel. */
export async function queryAvatarCancellation(original: AvatarCancellation) {
  const result = await a1AvatarCancellationRecovery.query(original, async record => {
    const state = await fetchDirectCommandReceipt(`A1:AVATAR_CANCEL:${record.actorId}:${record.assetId}`, record.commandKey, record.actorId);
    const conclusion: PendingRecoveryConclusion = state === "SUCCEEDED" ? "succeeded" : state === "REJECTED" ? "rejected"
      : state === "NOT_EXECUTED" ? "not-executed" : state === "NOT_FOUND" ? "not-found" : "unknown";
    return { conclusion, state };
  });
  if (!result || !a1AvatarCancellationRecovery.settleFromQuery(original, result.conclusion)) return result?.state;
  if (result.conclusion === "succeeded") avatarDrafts.forget(original.fingerprint, original.draftKey);
  return result.state;
}

export async function replayAvatarCancellation(original: AvatarCancellation) {
  await a1AvatarCancellationRecovery.replay(original, async record => {
    const result = await cancelA1Avatar(record.assetId, record.commandKey);
    if (result.assetId !== record.assetId) throw new Error("A1_AVATAR_RESPONSE_UNREADABLE");
  });
  a1AvatarCancellationRecovery.settleAcknowledged(original);
  avatarDrafts.forget(original.fingerprint, original.draftKey);
}
export async function avatarFileHash(file: File): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}
