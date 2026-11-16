import { createPendingMutationStore, isPendingCommandOwnedBy, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { avatarGender, avatarKey, parsePreparedAvatar, selfAvatarSaveInput, type AvatarGender, type AvatarScope, type PreparedAvatar, type SelfAvatarSave } from "@/lib/admin/account-avatar-contract";
import { fetchDirectCommandReceipt } from "@/lib/admin/direct-command-receipt";

export interface AvatarDraft extends PendingMutationRecord {
  actorId: number; scope: AvatarScope; kind: "DEFAULT" | "UPLOAD"; clientUploadId: string;
  gender?: AvatarGender; fileHash?: string; fileName?: string; fileMime?: string; asset?: PreparedAvatar; cancelKey?: string;
}
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
      return true;
    } catch { return false; }
  },
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
/** Only a retained original cancellation receipt settles the cancel; image/current-account reads do not. */
export async function queryAvatarCancellation(draft: AvatarDraft) {
  if (!isPendingCommandOwnedBy(draft, "nexion-account-avatar-drafts-v1")) throw new Error("COMMAND_INVESTIGATION_FORBIDDEN");
  if (draft.scope !== "admin" || !draft.asset || !draft.cancelKey) throw new Error("A1_AVATAR_CANCEL_QUERY_ONLY");
  const state = await fetchDirectCommandReceipt(`A1:AVATAR_CANCEL:${draft.actorId}:${draft.asset.assetId}`, draft.cancelKey, draft.actorId);
  if (state === "SUCCEEDED") avatarDrafts.forget(draft.fingerprint, draft.commandKey);
  else if (state === "REJECTED" || state === "FAILED") rememberAvatarDraft({ ...draft, cancelKey: undefined }, true);
  return state;
}
export async function avatarFileHash(file: File): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}
