export type AvatarGender = "MALE" | "FEMALE" | "UNSPECIFIED";
export const AVATAR_GENDER_OPTIONS = [{ value: "UNSPECIFIED", label: "未指定" }, { value: "MALE", label: "男性" }, { value: "FEMALE", label: "女性" }];
export type AvatarScope = "admin" | "self";
export interface PreparedAvatar { assetId: string; status: "READY" | "CANCELLED"; expiresAt: string; previewRef: string }
export interface SelfAvatarSnapshot { assetId: string | null; avatarVersion: number; accountVersion: string; avatarGender: AvatarGender | null }
export interface SelfAvatarSave { assetId: string; expectedVersion: string; reason: string }
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const KEY = /^[A-Za-z0-9_-]{8,128}$/;
const VERSION = /^[0-9]{1,19}$/;
export function avatarBase(scope: AvatarScope) {
  if (scope !== "self" && scope !== "admin") throw new Error("AVATAR_COMMAND_INVALID");
  return `/accounts/${scope === "self" ? "self/" : ""}avatar-assets`;
}
export function avatarGender(value: unknown): AvatarGender {
  if (value !== "MALE" && value !== "FEMALE" && value !== "UNSPECIFIED") throw new Error("AVATAR_GENDER_INVALID");
  return value;
}
export function avatarKey(value: string): string {
  if (typeof value !== "string" || !KEY.test(value)) throw new Error("AVATAR_COMMAND_INVALID");
  return value;
}
export function avatarId(value: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("A1_AVATAR_ID_INVALID");
  return value;
}
export function accountAvatarFields(input: { role?: unknown; avatarGender?: unknown; avatarAssetId?: unknown; useDefaultAvatar?: unknown }, create: boolean) {
  if (input.useDefaultAvatar !== undefined && typeof input.useDefaultAvatar !== "boolean") throw new Error("AVATAR_DEFAULT_INTENT_INVALID");
  if (input.useDefaultAvatar === true && (!create || input.role !== "support" || input.avatarAssetId)) throw new Error("AVATAR_DEFAULT_INTENT_INVALID");
  return {
    ...(input.avatarAssetId ? { avatarAssetId: avatarId(input.avatarAssetId as string) } : {}),
    ...(input.avatarGender !== undefined ? { avatarGender: avatarGender(input.avatarGender) } : {}),
    ...(create && input.useDefaultAvatar !== undefined ? { useDefaultAvatar: input.useDefaultAvatar } : {}),
  };
}
export function parsePreparedAvatar(value: unknown, scope: AvatarScope, status: PreparedAvatar["status"] = "READY"): PreparedAvatar {
  const row = value as PreparedAvatar | null;
  if (!row || typeof row.assetId !== "string" || !UUID.test(row.assetId) || row.status !== status
    || row.previewRef !== `/api/admin/platform${avatarBase(scope)}/${row.assetId}` || typeof row.expiresAt !== "string" || !Number.isFinite(Date.parse(row.expiresAt))) throw new Error("A1_AVATAR_RESPONSE_UNREADABLE");
  return { assetId: row.assetId, status, previewRef: row.previewRef, expiresAt: row.expiresAt };
}
export function parseSelfAvatarSnapshot(value: unknown): SelfAvatarSnapshot {
  const row = value as SelfAvatarSnapshot | null;
  if (!row || !(row.assetId === null || typeof row.assetId === "string" && UUID.test(row.assetId))
    || !Number.isSafeInteger(row.avatarVersion) || row.avatarVersion < 0 || typeof row.accountVersion !== "string" || !VERSION.test(row.accountVersion)
    || !(row.avatarGender === null || ["MALE", "FEMALE", "UNSPECIFIED"].includes(row.avatarGender))) throw new Error("AVATAR_SNAPSHOT_UNREADABLE");
  return { assetId: row.assetId, avatarVersion: row.avatarVersion, accountVersion: row.accountVersion, avatarGender: row.avatarGender };
}
export function selfAvatarSaveInput(input: SelfAvatarSave): SelfAvatarSave {
  if (!input || Object.keys(input).some(key => !["assetId", "expectedVersion", "reason"].includes(key))
    || typeof input.expectedVersion !== "string" || !VERSION.test(input.expectedVersion) || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 500) throw new Error("AVATAR_COMMAND_INVALID");
  return { assetId: avatarId(input.assetId), expectedVersion: input.expectedVersion, reason: input.reason };
}
export function avatarProxyRoute(parts: string[], method: string): { targetPath: string; upload: boolean; read: boolean; self: boolean } | null {
  if (parts[0] !== "accounts") return null;
  const self = parts[1] === "self";
  const tail = parts.slice(self ? 2 : 1);
  let upload = false, read = false, allowed = false;
  if (tail[0] === "avatar-assets") {
    if (tail.length === 1) allowed = upload = method === "POST";
    else if (tail.length === 2 && tail[1] === "default") allowed = method === "POST";
    else if (tail.length === 2 && UUID.test(tail[1])) { allowed = method === "GET" || method === "DELETE"; read = method === "GET"; }
  } else if (self && tail[0] === "avatar") {
    allowed = tail.length === 1 && (method === "GET" || method === "PATCH") || tail.length === 2 && tail[1] === "content" && method === "GET";
    read = tail.length === 2 && allowed;
  } else if (!self && tail.length === 2 && /^[1-9]\d*$/.test(tail[0]) && tail[1] === "avatar") allowed = read = method === "GET";
  return allowed ? { targetPath: `/api/admin/platform/${parts.join("/")}`, upload, read, self } : null;
}
