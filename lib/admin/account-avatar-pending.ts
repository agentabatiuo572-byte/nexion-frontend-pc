import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { avatarGender, avatarKey, parsePreparedAvatar, selfAvatarSaveInput, type AvatarGender, type AvatarScope, type PreparedAvatar, type SelfAvatarSave } from "@/lib/admin/account-avatar-contract";

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
export function rememberAvatarDraft(draft: AvatarDraft): AvatarDraft {
  const { fingerprint, commandKey, createdAt: _createdAt, expiresAt: _expiresAt, ...extra } = draft;
  avatarDrafts.remember(fingerprint, commandKey, extra);
  if (!avatarDrafts.isDurablyStored(fingerprint, commandKey)) throw new Error("AVATAR_COMMAND_STORAGE_UNAVAILABLE");
  return avatarDrafts.list().find(row => row.fingerprint === fingerprint && row.commandKey === commandKey)!;
}
export async function avatarFileHash(file: File): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}
