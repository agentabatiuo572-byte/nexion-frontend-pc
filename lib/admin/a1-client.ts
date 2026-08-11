import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";

export type GrantCell = "-" | "R" | "M" | "C";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

export interface A1Stats {
  totalAccounts: number;
  activeAccounts: number;
  disabledAccounts: number;
  activeSessions: number;
  effectiveSupers: number;
  pendingAcctTickets: number;
}

export interface A1RoleDefinition {
  key: string;
  name: string;
  av: string;
  color: string;
  desc: string;
  scope: string;
}

export interface A1Operator {
  id: string;
  name: string;
  username: string;
  email: string;
  role: string;
  tfa: boolean;
  status: "enabled" | "disabled";
  lastLogin: string;
  sessions: number;
  tfaResetAt?: string | null;
  credentialDeliveryStatus?: string | null;
  sessionDetails?: A1SessionDetail[];
  roleHistory?: A1RoleHistory[];
  version: string;
  temporaryPassword?: string | null;
}

export interface A1SessionDetail {
  sessionId: string;
  ipAddress: string;
  device: string;
  issuedAt: string;
  lastSeenAt: string;
}

export interface A1RoleHistory {
  fromRole: string;
  toRole: string;
  changedAt: string;
  operator: string;
  source: "AUDIT" | "CURRENT_ASSIGNMENT";
}

export interface A1RbacAction {
  id: string;
  action: string;
  domainGroup: string;
  grants: string[];
}

export interface A1SecurityBaseline {
  key: string;
  name: string;
  sub: string;
  value: string;
  locked: boolean;
}

export interface A1Overview {
  stats: A1Stats;
  roles: A1RoleDefinition[];
  operators: A1Operator[];
  rbacMatrix: A1RbacAction[];
  securityBaselines: A1SecurityBaseline[];
}

export interface A1CreateAccountInput {
  username: string;
  displayName: string;
  role: string;
  email?: string;
}

export interface A1UpdateAccountInput {
  username: string;
  displayName: string;
  email?: string;
}

export interface A1PasswordResetResult {
  account: A1Operator;
  temporaryPassword: string;
}

export interface A1PermissionRegistration {
  permissionCode: string;
  permissionName: string;
  resourcePath: string;
  permType: string;
  amplifies: boolean;
  boundRoleCount: number;
}

let requestSeq = 0;

function idempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

export class A1OutcomeUncertainError extends Error {
  constructor(message: string, public readonly commandKey: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "A1OutcomeUncertainError";
  }
}

export function isA1OutcomeUncertainError(error: unknown): error is A1OutcomeUncertainError {
  return error instanceof A1OutcomeUncertainError;
}

async function a1Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }) {
  const headers = new Headers(init?.headers);
  let commandKey = "";
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.idempotencyPrefix) {
    commandKey = idempotencyKey(init.idempotencyPrefix);
    headers.set("Idempotency-Key", commandKey);
  }

  const request = () => guardedFetch(`/api/admin/platform${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
  let response: Response;
  try {
    response = await request();
  } catch (error) {
    if (!init?.idempotencyPrefix) throw error;
    try {
      response = await request();
    } catch (retryError) {
      throw new A1OutcomeUncertainError("A1_MUTATION_OUTCOME_UNCERTAIN", commandKey, { cause: retryError });
    }
  }
  if (init?.idempotencyPrefix
    && response.headers.get("X-Nexion-Upstream-Outcome")?.trim().toLowerCase() === "unknown") {
    throw new A1OutcomeUncertainError("A1_MUTATION_OUTCOME_UNCERTAIN", commandKey);
  }
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    if (init?.idempotencyPrefix && response.ok && !result) {
      throw new A1OutcomeUncertainError("A1_MUTATION_RESPONSE_UNREADABLE", commandKey);
    }
    // 5xx 不是确定失败:后端可能已经落库,弃号重试 = 第二条命令(统一口径见 outcome-classification.ts)。
    if (init?.idempotencyPrefix && outcomeStaysUnknown(response.status, result?.code)) {
      throw new A1OutcomeUncertainError(`A1_MUTATION_OUTCOME_UNCERTAIN_${response.status}`, commandKey);
    }
    throw new Error(formatAdminApiError(result?.message, `A1_REQUEST_FAILED_${response.status}`));
  }

  return result.data as T;
}

export function fetchA1Overview() {
  return a1Request<A1Overview>("/accounts/overview");
}

export function createA1Account(input: A1CreateAccountInput, reason: string, operator: string) {
  return a1Request<A1Operator>("/accounts", {
    method: "POST",
    body: JSON.stringify({ ...input, reason, operator }),
    idempotencyPrefix: "a1-account-create",
  });
}

export function changeA1AccountRole(
  accountId: string,
  role: string,
  reason: string,
  operator: string,
  expectedVersion: string,
) {
  return a1Request<A1Operator>(`/accounts/${encodeURIComponent(accountId)}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role, reason, operator, expectedVersion }),
    idempotencyPrefix: "a1-account-role",
  });
}

export function updateA1AccountProfile(
  accountId: string,
  input: A1UpdateAccountInput,
  reason: string,
  operator: string,
  expectedVersion: string,
) {
  return a1Request<A1Operator>(`/accounts/${encodeURIComponent(accountId)}/profile`, {
    method: "PATCH",
    body: JSON.stringify({ ...input, reason, operator, expectedVersion }),
    idempotencyPrefix: "a1-account-profile",
  });
}

export function updateA1AccountStatus(
  accountId: string,
  status: "enabled" | "disabled",
  reason: string,
  operator: string,
  expectedVersion: string,
) {
  return a1Request<A1Operator>(`/accounts/${encodeURIComponent(accountId)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, reason, operator, expectedVersion }),
    idempotencyPrefix: "a1-account-status",
  });
}

export function resetA1Account2fa(accountId: string, reason: string, operator: string, expectedVersion: string) {
  return a1Request<A1Operator>(`/accounts/${encodeURIComponent(accountId)}/reset-2fa`, {
    method: "POST",
    body: JSON.stringify({ reason, operator, expectedVersion }),
    idempotencyPrefix: "a1-reset-2fa",
  });
}

export function resetA1AccountPassword(accountId: string, reason: string, operator: string, expectedVersion: string) {
  return a1Request<A1PasswordResetResult>(`/accounts/${encodeURIComponent(accountId)}/password/reset`, {
    method: "POST",
    body: JSON.stringify({ reason, operator, expectedVersion }),
    idempotencyPrefix: "a1-reset-password",
  });
}

export function revokeA1AccountSessions(accountId: string, reason: string, operator: string, expectedVersion: string) {
  return a1Request<A1Operator>(`/accounts/${encodeURIComponent(accountId)}/sessions/revoke`, {
    method: "POST",
    body: JSON.stringify({ reason, operator, expectedVersion }),
    idempotencyPrefix: "a1-session-revoke",
  });
}

export function revokeA1AccountSession(
  accountId: string,
  sessionId: string,
  reason: string,
  operator: string,
  expectedVersion: string,
) {
  return a1Request<A1Operator>(`/accounts/${encodeURIComponent(accountId)}/sessions/${encodeURIComponent(sessionId)}/revoke`, {
    method: "POST",
    body: JSON.stringify({ reason, operator, expectedVersion }),
    idempotencyPrefix: "a1-session-revoke-one",
  });
}

export function updateA1SecurityBaseline(
  baselineKey: string,
  value: string,
  expectedValue: string,
  reason: string,
  operator: string,
) {
  return a1Request<A1SecurityBaseline>(`/accounts/security-baselines/${encodeURIComponent(baselineKey)}`, {
    method: "PATCH",
    body: JSON.stringify({ value, expectedValue, reason, operator }),
    idempotencyPrefix: "a1-security-baseline",
  });
}

export function updateA1RbacGrants(actionId: string, grants: string[], reason: string, operator: string) {
  return a1Request<A1RbacAction>(`/rbac/actions/${encodeURIComponent(actionId)}/grants`, {
    method: "PATCH",
    body: JSON.stringify({ grants, reason, operator }),
    idempotencyPrefix: "a1-rbac-grants",
  });
}

export function createA1RbacAction(action: string, domainGroup: string, reason: string, operator: string) {
  return a1Request<A1RbacAction>("/rbac/actions", {
    method: "POST",
    body: JSON.stringify({ action, domainGroup, reason, operator }),
    idempotencyPrefix: "a1-rbac-action",
  });
}

export function registerA1Permission(input: {
  permissionCode: string;
  permissionName: string;
  resourcePath: string;
  permType: "READ" | "WRITE";
  amplifies: boolean;
  reason: string;
  operator: string;
}) {
  return a1Request<A1PermissionRegistration>("/accounts/permissions", {
    method: "POST",
    body: JSON.stringify({ ...input, expectedAbsent: true }),
    idempotencyPrefix: "a1-permission-register",
  });
}
