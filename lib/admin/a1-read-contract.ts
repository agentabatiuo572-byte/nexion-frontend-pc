import type { A1Operator, A1Overview, A1PasswordResetResult, A1PermissionRegistration, A1RoleDefinition } from "./a1-client";
import { avatarGender } from "./account-avatar-contract";

export function a1Object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A1_RESPONSE_INVALID");
  return value as Record<string, unknown>;
}
export function a1Text(value: unknown): string {
  if (typeof value !== "string") throw new Error("A1_RESPONSE_INVALID");
  return value;
}
function nullableText(value: unknown) { return value === null ? null : a1Text(value); }
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("A1_RESPONSE_INVALID");
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("A1_RESPONSE_INVALID");
  return value;
}
function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error("A1_RESPONSE_INVALID");
  return value.map(parse);
}
export function parseA1Role(value: unknown): A1RoleDefinition {
  const row = a1Object(value);
  return { key: a1Text(row.key), name: a1Text(row.name), av: a1Text(row.av), color: a1Text(row.color), desc: a1Text(row.desc), scope: a1Text(row.scope) };
}
export function parseA1Operator(value: unknown): A1Operator {
  const row = a1Object(value), id = a1Text(row.id), version = a1Text(row.version);
  if (!/^[1-9]\d*$/.test(id) || !/^\d+$/.test(version) || !["enabled", "disabled"].includes(a1Text(row.status))) throw new Error("A1_RESPONSE_INVALID");
  return {
    id, version, name: a1Text(row.name), username: a1Text(row.username), email: a1Text(row.email), role: a1Text(row.role),
    tfa: bool(row.tfa), status: row.status as A1Operator["status"], lastLogin: a1Text(row.lastLogin), sessions: count(row.sessions),
    tfaResetAt: nullableText(row.tfaResetAt), credentialDeliveryStatus: a1Text(row.credentialDeliveryStatus),
    sessionDetails: list(row.sessionDetails, value => {
      const session = a1Object(value);
      return { sessionId: a1Text(session.sessionId), ipAddress: nullableText(session.ipAddress), device: nullableText(session.device), issuedAt: nullableText(session.issuedAt), lastSeenAt: nullableText(session.lastSeenAt) };
    }),
    roleHistory: list(row.roleHistory, value => {
      const history = a1Object(value), source = a1Text(history.source);
      if (source !== "AUDIT" && source !== "CURRENT_ASSIGNMENT") throw new Error("A1_RESPONSE_INVALID");
      return { fromRole: nullableText(history.fromRole), toRole: a1Text(history.toRole), changedAt: nullableText(history.changedAt), operator: a1Text(history.operator), source };
    }),
    temporaryPassword: nullableText(row.temporaryPassword), avatarAssetId: nullableText(row.avatarAssetId),
    avatarVersion: row.avatarVersion === null ? null : count(row.avatarVersion), avatarGender: row.avatarGender === null ? null : avatarGender(row.avatarGender),
  };
}
export function parseA1Created(value: unknown) {
  const account = parseA1Operator(value);
  if (!account.temporaryPassword) throw new Error("A1_CREATE_TEMPORARY_PASSWORD_MISSING");
  return account;
}
export function parseA1PasswordReset(value: unknown): A1PasswordResetResult {
  const row = a1Object(value), temporaryPassword = a1Text(row.temporaryPassword);
  if (!temporaryPassword) throw new Error("A1_CREATE_TEMPORARY_PASSWORD_MISSING");
  return { account: parseA1Operator(row.account), temporaryPassword };
}
export function parseA1Permission(value: unknown): A1PermissionRegistration {
  const row = a1Object(value), permType = a1Text(row.permType);
  if (!["READ", "WRITE", "HIGH"].includes(permType)) throw new Error("A1_RESPONSE_INVALID");
  if (row.amplifies !== 0 && row.amplifies !== 1) throw new Error("A1_RESPONSE_INVALID");
  return { permissionCode: a1Text(row.permissionCode), permissionName: a1Text(row.permissionName), resourcePath: a1Text(row.resourcePath), permType, amplifies: row.amplifies === 1, boundRoleCount: count(row.boundRoleCount) };
}
export function parseA1Overview(value: unknown): A1Overview {
  const row = a1Object(value), stats = a1Object(row.stats);
  return {
    stats: { totalAccounts: count(stats.totalAccounts), activeAccounts: count(stats.activeAccounts), disabledAccounts: count(stats.disabledAccounts), activeSessions: count(stats.activeSessions), effectiveSupers: count(stats.effectiveSupers), pendingAcctTickets: count(stats.pendingAcctTickets) },
    roles: list(row.roles, parseA1Role), operators: list(row.operators, parseA1Operator),
    rbacMatrix: list(row.rbacMatrix, value => { const action = a1Object(value); return { id: a1Text(action.id), action: a1Text(action.action), domainGroup: a1Text(action.domainGroup), grants: list(action.grants, a1Text) }; }),
    securityBaselines: list(row.securityBaselines, value => { const baseline = a1Object(value); return { key: a1Text(baseline.key), name: a1Text(baseline.name), sub: a1Text(baseline.sub), value: a1Text(baseline.value), locked: bool(baseline.locked) }; }),
  };
}
