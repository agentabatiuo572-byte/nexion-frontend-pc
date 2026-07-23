import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError } from "@/lib/admin/error-messages";
import { buildRoleStatusPayload, normalizeProposalTicket, type A2ProposalTicket } from "@/lib/admin/platform-contracts";
import { normalizeA6Detail as strictA6Detail, normalizeA6Overview as strictA6Overview } from "@/lib/admin/rbac-contracts";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

/** A6 角色管理。对齐后端 PlatformRoleOverview / PlatformRoleDetail / grants payload。 */
export type A6RoleSummary = {
  id: number;
  roleCode: string;
  roleName: string;
  remark: string;
  status: number;
  builtin: boolean;
  adminCount: number;
};

export type A6RoleOverview = { roles: A6RoleSummary[]; total: number };

export type A6RoleDetail = {
  id: number;
  roleCode: string;
  roleName: string;
  remark: string;
  status: number;
  builtin: boolean;
  permissionCodes: string[];
  menuIds: number[];
};

export type A6RoleCreateInput = { roleCode: string; roleName: string; remark?: string; status?: number };
export type A6RoleUpdateInput = { roleName?: string; remark?: string };
export type A6GrantsPayload = { permissionCodes: string[]; menuIds: number[] };

function normalizeOverview(raw: unknown): A6RoleOverview {
  return strictA6Overview(raw) as A6RoleOverview;
}

let requestSeq = 0;
function idempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

export function newA6IdempotencyKey(prefix: string) {
  return idempotencyKey(prefix);
}

async function a6Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string; idempotencyKey?: string }): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init?.idempotencyKey) headers.set("Idempotency-Key", init.idempotencyKey);
  else if (init?.idempotencyPrefix) headers.set("Idempotency-Key", idempotencyKey(init.idempotencyPrefix));

  const response = await fetch(`/api/admin/platform${path}`, {
    ...init, headers, cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(12_000),
  });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    if (response.headers.get("X-Nexion-Upstream-Outcome") === "unknown") {
      throw new Error("请求结果尚未确认，当前输入已保留；请直接重试，系统会沿用同一幂等键核对结果。");
    }
    throw new Error(formatAdminApiError(result?.message, `A6_REQUEST_FAILED_${response.status}`));
  }
  return result.data as T;
}

export async function fetchA6RolesOverview(): Promise<A6RoleOverview> {
  return normalizeOverview(await a6Request<unknown>("/roles/overview"));
}

export async function fetchA6RoleDetail(roleId: number): Promise<A6RoleDetail> {
  return strictA6Detail(await a6Request<unknown>(`/roles/${encodeURIComponent(roleId)}`)) as A6RoleDetail;
}

export async function createA6Role(input: A6RoleCreateInput, reason: string, operator: string, stableKey?: string): Promise<A6RoleDetail> {
  return strictA6Detail(await a6Request<unknown>("/roles", {
    method: "POST",
    body: JSON.stringify({ ...input, reason, operator }),
    idempotencyPrefix: "a6-role-create",
    idempotencyKey: stableKey,
  })) as A6RoleDetail;
}

export async function updateA6Role(roleId: number, input: A6RoleUpdateInput, reason: string, operator: string, stableKey?: string): Promise<A6RoleDetail> {
  const raw = await a6Request<unknown>(`/roles/${encodeURIComponent(roleId)}`, {
    method: "PATCH",
    body: JSON.stringify({ ...input, reason, operator }),
    idempotencyPrefix: "a6-role-update",
    idempotencyKey: stableKey,
  });
  return strictA6Detail(raw) as A6RoleDetail;
}

export async function proposeA6RoleStatus(roleId: number, status: 0 | 1, reason: string, operator: string, stableKey?: string): Promise<A2ProposalTicket> {
  const raw = await a6Request<unknown>(`/roles/${encodeURIComponent(roleId)}`, {
    method: "PATCH",
    body: JSON.stringify({ ...buildRoleStatusPayload(status), reason, operator }),
    idempotencyPrefix: "a6-role-status",
    idempotencyKey: stableKey,
  });
  const ticket = normalizeProposalTicket(raw);
  if (!ticket) throw new Error("A6_STATUS_PROPOSAL_CONTRACT_INVALID");
  return ticket;
}

export async function deleteA6Role(roleId: number, reason: string, operator: string, stableKey?: string): Promise<A2ProposalTicket> {
  const raw = await a6Request<unknown>(`/roles/${encodeURIComponent(roleId)}`, {
    method: "DELETE",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "a6-role-delete",
    idempotencyKey: stableKey,
  });
  const ticket = normalizeProposalTicket(raw);
  if (!ticket) throw new Error("A6_DELETE_PROPOSAL_CONTRACT_INVALID");
  return ticket;
}

export async function proposeA6RoleGrants(roleId: number, payload: A6GrantsPayload, reason: string, operator: string, stableKey?: string): Promise<A2ProposalTicket> {
  const raw = await a6Request<unknown>(`/roles/${encodeURIComponent(roleId)}/grants`, {
    method: "PUT",
    body: JSON.stringify({ ...payload, reason, operator }),
    idempotencyPrefix: "a6-role-grants",
    idempotencyKey: stableKey,
  });
  const ticket = normalizeProposalTicket(raw);
  if (!ticket) throw new Error("A6_GRANTS_PROPOSAL_CONTRACT_INVALID");
  return ticket;
}
