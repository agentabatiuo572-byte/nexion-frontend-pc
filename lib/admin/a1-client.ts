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
  email: string;
  role: string;
  tier: "lead" | "member" | null;
  tfa: boolean;
  status: "enabled" | "disabled";
  lastLogin: string;
  sessions: number;
  tfaResetAt?: string | null;
  credentialDeliveryStatus?: string | null;
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
  displayName: string;
  email: string;
  role: string;
  tier: "lead" | "member";
  deliver: "mail" | "handoff";
}

let requestSeq = 0;

function idempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

async function a1Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.idempotencyPrefix) {
    headers.set("Idempotency-Key", idempotencyKey(init.idempotencyPrefix));
  }

  const response = await fetch(`/api/admin/platform${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    throw new Error(result?.message || `A1_REQUEST_FAILED_${response.status}`);
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
  tier: "lead" | "member",
  reason: string,
  operator: string,
) {
  return a1Request<A1Operator>(`/accounts/${encodeURIComponent(accountId)}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role, tier, reason, operator }),
    idempotencyPrefix: "a1-account-role",
  });
}

export function updateA1AccountStatus(
  accountId: string,
  status: "enabled" | "disabled",
  reason: string,
  operator: string,
) {
  return a1Request<A1Operator>(`/accounts/${encodeURIComponent(accountId)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, reason, operator }),
    idempotencyPrefix: "a1-account-status",
  });
}

export function resetA1Account2fa(accountId: string, reason: string, operator: string) {
  return a1Request<A1Operator>(`/accounts/${encodeURIComponent(accountId)}/reset-2fa`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "a1-reset-2fa",
  });
}

export function revokeA1AccountSessions(accountId: string, reason: string, operator: string) {
  return a1Request<A1Operator>(`/accounts/${encodeURIComponent(accountId)}/sessions/revoke`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "a1-session-revoke",
  });
}

export function updateA1SecurityBaseline(baselineKey: string, value: string, reason: string, operator: string) {
  return a1Request<A1SecurityBaseline>(`/accounts/security-baselines/${encodeURIComponent(baselineKey)}`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator }),
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
