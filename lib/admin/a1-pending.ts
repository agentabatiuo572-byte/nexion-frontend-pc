import { createPendingMutationStore, createPendingRecovery, type PendingMutationRecord, type PendingRecoveryCapability, type PendingRecoveryConclusion } from "./pending-mutation-store";
import { explicitRejectionCode } from "./explicit-rejection";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { canAccessResolvedPath, resolveVisibleDomains } from "@/lib/nav/console-nav";
import { createA1Account, resetA1AccountPassword, revokeA1AccountSession, registerA1Permission, type A1CreateAccountInput, type A1Operator, type A1RoleDefinition, type A1UpdateAccountInput } from "./a1-client";
import { createA2OperationProposal, type A2OperationRow } from "./a2-client";
import { a1Object, a1Text, parseA1Operator, parseA1Role } from "./a1-read-contract";
import { accountAvatarFields } from "./account-avatar-contract";
import { fetchDirectCommandReceipt } from "./direct-command-receipt";

export type A1Intent =
  | { kind: "create"; form: A1CreateAccountInput; approval: boolean }
  | { kind: "profile"; account: A1Operator; form: A1UpdateAccountInput }
  | { kind: "role"; account: A1Operator; picked: string }
  | { kind: "2fa" | "password" | "disable" | "enable" | "logout"; account: A1Operator }
  | { kind: "session"; account: A1Operator; sessionId: string }
  | { kind: "permission"; draft: { code: string; name: string; path: string; type: "READ" | "WRITE"; amplifies: boolean } };
export type A1Snapshot = { roles: A1RoleDefinition[]; codes: Record<string, string[]>; permissionReady: boolean; effectiveSupers: number };
export type A1Request =
  | { kind: "proposal"; input: Parameters<typeof createA2OperationProposal>[0] }
  | { kind: "create"; input: A1CreateAccountInput; reason: string; operator: string }
  | { kind: "password"; accountId: string; expectedVersion: string; reason: string; operator: string }
  | { kind: "session"; accountId: string; sessionId: string; expectedVersion: string; reason: string; operator: string }
  | { kind: "permission"; input: Parameters<typeof registerA1Permission>[0] };
export type A1Pending = PendingMutationRecord & {
  actorId: number; intent: A1Intent; snapshot: A1Snapshot; request: A1Request;
  confirmationReason: string; businessValue?: Record<string, string>;
  ticket?: A2OperationRow; received?: boolean; verifiedNotExecuted?: boolean; permissionVerificationPending?: boolean;
};
type LegacyCreation = PendingMutationRecord & { actorId: number; form: A1CreateAccountInput & { reason: string }; reason: string; operator: string };

function formValid(value: unknown, role: boolean) {
  const form = a1Object(value);
  a1Text(form.username); a1Text(form.displayName);
  if (role) a1Text(form.role);
  if (form.email !== undefined && form.email !== null) a1Text(form.email);
  accountAvatarFields(form, role);
}
function validRecord(value: A1Pending | LegacyCreation) {
  try {
    if (!Number.isSafeInteger(value.actorId) || value.actorId <= 0) return false;
    if (!("request" in value)) { formValid(value.form, true); a1Text(value.reason); a1Text(value.operator); return true; }
    const { intent, snapshot, request } = value;
    a1Text(value.confirmationReason);
    if (value.businessValue) Object.values(a1Object(value.businessValue)).forEach(a1Text);
    if (!Array.isArray(snapshot.roles) || !Number.isSafeInteger(snapshot.effectiveSupers) || snapshot.effectiveSupers < 0 || typeof snapshot.permissionReady !== "boolean") return false;
    snapshot.roles.forEach(parseA1Role);
    for (const codes of Object.values(a1Object(snapshot.codes))) { if (!Array.isArray(codes)) return false; codes.forEach(a1Text); }
    if (intent.kind === "create") { formValid(intent.form, true); if (typeof intent.approval !== "boolean") return false; }
    else if (intent.kind === "permission") {
      a1Text(intent.draft.code); a1Text(intent.draft.name); a1Text(intent.draft.path);
      if (!["READ", "WRITE"].includes(intent.draft.type) || typeof intent.draft.amplifies !== "boolean") return false;
    } else {
      if (!["profile", "role", "2fa", "password", "disable", "enable", "logout", "session"].includes(intent.kind)) return false;
      parseA1Operator(intent.account);
      if (intent.kind === "profile") formValid(intent.form, false);
      if (intent.kind === "role") a1Text(intent.picked);
      if (intent.kind === "session") a1Text(intent.sessionId);
    }
    if (request.kind === "proposal") {
      const input = request.input;
      for (const field of [input.action, input.obj, input.beforeValue, input.afterValue, input.operator, input.operatorRole, input.reason, input.roleGate]) a1Text(field);
      if (input.sourceDomain !== "A1" || input.type !== "acct" || input.amplifies !== false || input.sos !== false || input.command.domain !== "A" || !/^a1_account_(create|update_profile|change_role|reset_2fa|status_update|force_logout)$/.test(input.command.op)) return false;
      a1Object(input.command.params);
      if (input.target?.domain !== "A" || input.target.type !== "account" || input.target.id !== input.obj || input.targets !== undefined) return false;
    } else if (request.kind === "permission") {
      const input = request.input;
      [input.permissionCode, input.permissionName, input.resourcePath, input.reason, input.operator].forEach(a1Text);
      if (!["READ", "WRITE", "HIGH"].includes(input.permType) || typeof input.amplifies !== "boolean") return false;
    } else {
      a1Text(request.reason); a1Text(request.operator);
      if (request.kind === "create") formValid(request.input, true);
      else if (request.kind === "password" || request.kind === "session") {
        if (!/^[1-9]\d*$/.test(request.accountId) || !/^\d+$/.test(request.expectedVersion)) return false;
        if (request.kind === "session") a1Text(request.sessionId);
      } else return false;
    }
    if (value.ticket && (!value.ticket.id || typeof value.ticket.mine !== "boolean" || !["pending", "approved", "rejected", "withdrawn", "expired"].includes(value.ticket.status))) return false;
    if (value.verifiedNotExecuted !== undefined && typeof value.verifiedNotExecuted !== "boolean") return false;
    if (value.permissionVerificationPending !== undefined && (request.kind !== "permission" || typeof value.permissionVerificationPending !== "boolean")) return false;
    return true;
  } catch { return false; }
}

// Reuse the original creation key and one store instance, including pre-redesign records.
const commands = createPendingMutationStore<A1Pending | LegacyCreation>({ storageKey: "nexion-a1-support-avatar-account-create", retainExpiredRecords: true, isValidRecord: validRecord });
export const a1PendingCommands = {
  ...commands,
  remember(fingerprint: string, commandKey: string, record: Omit<A1Pending, keyof PendingMutationRecord>) { commands.remember(fingerprint, commandKey, record); },
  list(): A1Pending[] {
    return commands.list().map(record => {
      if ("request" in record) return record;
      const { form, reason, operator, ...base } = record;
      const migrated: A1Pending = { ...base, intent: { kind: "create", form, approval: false }, snapshot: { roles: [], codes: {}, permissionReady: false, effectiveSupers: 0 }, request: { kind: "create", input: { username: form.username, displayName: form.displayName, email: form.email, avatarAssetId: form.avatarAssetId, avatarGender: form.avatarGender, useDefaultAvatar: form.useDefaultAvatar, role: form.role }, reason, operator }, confirmationReason: reason };
      commands.remember(record.fingerprint, record.commandKey, migrated);
      return migrated;
    });
  },
};

export function a1IntentSlot(intent: A1Intent) {
  // All account mutations share expectedVersion and the A2 account target lock.
  return intent.kind === "create" ? `create:${intent.form.username.trim().toLowerCase()}` : intent.kind === "permission" ? `permission:${intent.draft.code.trim().toLowerCase()}` : `account:${intent.account.id}`;
}
export function a1IntentAuthority(intent: A1Intent) {
  return intent.kind === "role" ? "platform_a1_account_role_change"
    : intent.kind === "2fa" ? "platform_a1_account_2fa_reset"
    : intent.kind === "disable" || intent.kind === "enable" ? "platform_a1_account_disable"
    : intent.kind === "password" ? "platform_a1_account_password_reset"
    : intent.kind === "session" || intent.kind === "logout" ? "platform_a1_account_sessions_revoke"
    : intent.kind === "permission" ? "platform_a1_rbac_grants_update" : "platform_a1_write";
}
export function a1RecoveryCapability(record: A1Pending): PendingRecoveryCapability {
  return record.request.kind === "session" ? "replay" : "receipt";
}

export const a1Recovery = createPendingRecovery<A1Pending>(a1PendingCommands, {
  capability: a1RecoveryCapability,
  explicitRejectionCode,
  canReplay(record) {
    const auth = useAdminAuth.getState(), session = auth.session;
    return !!session && auth.isAuthenticated && !auth.logoutPending && !auth.logoutUnknown
      && !session.passwordChangeRequired && session.adminId === record.actorId
      && session.authorities.includes("platform_a1_read") && session.authorities.includes(a1IntentAuthority(record.intent))
      && canAccessResolvedPath(resolveVisibleDomains(session), "/platform/rbac")
      && (record.request.kind !== "proposal" || session.authorities.includes("platform_a2_write"))
      && (!["create", "password", "session", "logout"].includes(record.intent.kind) || ["super", "superadmin"].includes(session.role))
      && !record.received && !record.ticket && !record.verifiedNotExecuted && !record.permissionVerificationPending;
  },
});

export async function queryA1DirectReceipt(record: A1Pending): Promise<PendingRecoveryConclusion> {
  const kind = record.request.kind;
  const scope = kind === "create" ? `A1:ACCOUNT_CREATE:${record.actorId}`
    : kind === "password" ? `A1:ACCOUNT_PASSWORD_RESET:${record.actorId}`
      : kind === "permission" ? "A1_PERMISSION_REGISTER" : undefined;
  if (!scope) return "unknown";
  const state = await fetchDirectCommandReceipt(scope, record.commandKey, record.actorId);
  if (state === "NOT_FOUND") return "not-found";
  if (state === "SUCCEEDED") return "succeeded";
  if (state === "NOT_EXECUTED") return "not-executed";
  if (state === "REJECTED") return "rejected";
  return "unknown";
}
export async function sendA1Pending(record: A1Pending) {
  const request = record.request, key = record.commandKey;
  switch (request.kind) {
    case "proposal": return { kind: "proposal" as const, ticket: await createA2OperationProposal(request.input, key, true, true) };
    case "create": return { kind: "create" as const, account: await createA1Account(request.input, request.reason, request.operator, key) };
    case "password": return { kind: "password" as const, result: await resetA1AccountPassword(request.accountId, request.reason, request.operator, request.expectedVersion, key) };
    case "session": return { kind: "session" as const, account: await revokeA1AccountSession(request.accountId, request.sessionId, request.reason, request.operator, request.expectedVersion, key) };
    case "permission": return { kind: "permission" as const, permission: await registerA1Permission(request.input, key) };
  }
}
