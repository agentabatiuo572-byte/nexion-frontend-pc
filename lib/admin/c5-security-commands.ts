/** C5 login commands: the object, body and command number survive refresh together. */
import { isExplicitRejection } from "./explicit-rejection";
import { createA2CommandKey } from "./a2-client";
import { createPendingMutationStore, hasPersistedPendingCommandOwner, type PendingMutationRecord } from "./pending-mutation-store";
import { disableUserTwoFactor, requestUserPasswordReset, revokeUserSession, unlockUserSecurity, updateUserCredentialParam, UsersOutcomeUnknownError, type UserSecurityActionEvidence } from "./user360-client";

export type C5CommandKind = "revoke-one" | "password-reset" | "disable-2fa" | "unlock" | "credential";
export type C5Original = {
  owner: number; kind: C5CommandKind; userId: string; userNo: string; label: string; target: string;
  path: string; method: "POST" | "PATCH"; body: string; reason: string; operator: string;
  value?: string; version?: number; lockKind?: "SHORT" | "LONG"; operatorConfirmed?: boolean;
};
export type C5Pending = PendingMutationRecord & Partial<C5Original> & { returned?: boolean; rejection?: string };
const commands = createPendingMutationStore<C5Pending>({ storageKey: "nexion-admin-c5-security-commands-v1", retainExpiredRecords: true });
export function pendingC5Commands(owner: number) {
  return commands.list().filter(row => row.owner === owner || row.owner === undefined && hasPersistedPendingCommandOwner(String(owner)));
}
export function isCompleteC5Command(row: C5Pending): row is C5Pending & C5Original {
  return Number.isSafeInteger(row.owner) && ["revoke-one", "password-reset", "disable-2fa", "unlock", "credential"].includes(row.kind ?? "") && typeof row.userId === "string"
    && typeof row.userNo === "string" && typeof row.label === "string" && typeof row.target === "string"
    && typeof row.path === "string" && typeof row.body === "string" && typeof row.reason === "string" && typeof row.operator === "string"
    && ["POST", "PATCH"].includes(row.method ?? "")
    && (row.kind !== "credential" || typeof row.value === "string" && Number.isSafeInteger(row.version))
    && (row.kind !== "unlock" || row.lockKind === "SHORT" || row.lockKind === "LONG");
}
export function prepareC5Command(original: C5Original) {
  const scope = original.kind === "credential" ? `credential|${original.target}` : `user|${original.userId}`;
  if (pendingC5Commands(original.owner).some(row => !isCompleteC5Command(row) || row.fingerprint === scope)) throw new Error("此对象有待确认的原操作，请先到页面上方核对。");
  const key = createA2CommandKey("c5-command");
  commands.remember(scope, key, original);
  if (!commands.isDurablyStored(scope, key)) {
    commands.forget(scope, key);
    throw new Error("浏览器无法保存原操作，尚未提交。请允许会话存储后再试。");
  }
  return commands.list().find(row => row.commandKey === key)!;
}
export function forgetC5Command(row: C5Pending) { commands.forget(row.fingerprint, row.commandKey); }
export async function submitC5Command(row: C5Pending) {
  if (!isCompleteC5Command(row) || row.expiresAt <= Date.now() || row.returned) throw new Error("此原操作只能读回核对，不能重发。");
  const evidence: UserSecurityActionEvidence = { operatorConfirmed: row.operatorConfirmed === true, lockKind: row.lockKind ?? null };
  try {
    const result = row.kind === "revoke-one" ? await revokeUserSession(row.target, row.reason, row.operator, row.commandKey)
      : row.kind === "password-reset" ? await requestUserPasswordReset(row.userId, row.reason, row.operator, evidence, row.commandKey)
      : row.kind === "disable-2fa" ? await disableUserTwoFactor(row.userId, row.reason, row.operator, evidence, row.commandKey)
      : row.kind === "unlock" ? await unlockUserSecurity(row.userId, row.reason, row.operator, evidence, row.commandKey)
      : await updateUserCredentialParam(row.target, row.value!, row.reason, row.operator, row.version!, row.commandKey);
    // This is a write-response boundary. A 200 without the original object/result is still uncertain.
    if (!result || (row.kind === "credential"
      ? result.key !== row.target || Number(result.version) !== row.version! + 1 || Number(String(result.value).match(/\d+/)?.[0]) !== Number(row.value)
      : String(result.userId) !== row.userId || (row.kind === "revoke-one" ? result.refreshTokenId !== row.target || result.status !== "REVOKED"
        : row.kind === "password-reset" ? result.passwordResetRequired !== true
          : row.kind === "disable-2fa" ? result.twoFactorEnabled !== false : result.locked !== false))) throw new UsersOutcomeUnknownError(row.commandKey);
    commands.remember(row.fingerprint, row.commandKey, { ...row, returned: true });
  } catch (failure) {
    if (isExplicitRejection(failure)) commands.remember(row.fingerprint, row.commandKey, { ...row, rejection: failure instanceof Error ? failure.message : "原操作已被明确拒绝" });
    throw failure;
  }
}
