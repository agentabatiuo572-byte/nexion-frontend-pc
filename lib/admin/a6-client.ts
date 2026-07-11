import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError } from "@/lib/admin/error-messages";
import { buildRoleStatusPayload, normalizeProposalTicket, type A2ProposalTicket } from "@/lib/admin/platform-contracts";

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

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function num(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function strArr(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => str(v)).filter(Boolean) : [];
}

function numArr(value: unknown): number[] {
  return Array.isArray(value) ? value.map((v) => num(v)).filter((n) => n > 0) : [];
}

function normalizeSummary(row: Record<string, unknown>): A6RoleSummary {
  return {
    id: num(row.id),
    roleCode: str(row.roleCode),
    roleName: str(row.roleName),
    remark: str(row.remark),
    status: num(row.status, 1),
    builtin: !!row.builtin,
    adminCount: num(row.adminCount),
  };
}

function normalizeDetail(row: Record<string, unknown>): A6RoleDetail {
  return {
    id: num(row.id),
    roleCode: str(row.roleCode),
    roleName: str(row.roleName),
    remark: str(row.remark),
    status: num(row.status, 1),
    builtin: !!row.builtin,
    permissionCodes: strArr(row.permissionCodes),
    menuIds: numArr(row.menuIds),
  };
}

function normalizeOverview(raw: unknown): A6RoleOverview {
  const data = rec(raw);
  return {
    roles: Array.isArray(data.roles) ? data.roles.filter((r) => r && typeof r === "object").map((r) => normalizeSummary(r as Record<string, unknown>)) : [],
    total: num(data.total),
  };
}

let requestSeq = 0;
function idempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

async function a6Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init?.idempotencyPrefix) headers.set("Idempotency-Key", idempotencyKey(init.idempotencyPrefix));

  const response = await fetch(`/api/admin/platform${path}`, { ...init, headers, cache: "no-store" });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    throw new Error(formatAdminApiError(result?.message, `A6_REQUEST_FAILED_${response.status}`));
  }
  return result.data as T;
}

export async function fetchA6RolesOverview(): Promise<A6RoleOverview> {
  return normalizeOverview(await a6Request<unknown>("/roles/overview"));
}

export async function fetchA6RoleDetail(roleId: number): Promise<A6RoleDetail> {
  return normalizeDetail(rec(await a6Request<unknown>(`/roles/${encodeURIComponent(roleId)}`)));
}

export async function createA6Role(input: A6RoleCreateInput, reason: string, operator: string): Promise<A6RoleDetail> {
  return normalizeDetail(rec(await a6Request<unknown>("/roles", {
    method: "POST",
    body: JSON.stringify({ ...input, reason, operator }),
    idempotencyPrefix: "a6-role-create",
  })));
}

export async function updateA6Role(roleId: number, input: A6RoleUpdateInput, reason: string, operator: string): Promise<A6RoleDetail> {
  const raw = await a6Request<unknown>(`/roles/${encodeURIComponent(roleId)}`, {
    method: "PATCH",
    body: JSON.stringify({ ...input, reason, operator }),
    idempotencyPrefix: "a6-role-update",
  });
  return normalizeDetail(rec(raw));
}

export async function proposeA6RoleStatus(roleId: number, status: 0 | 1, reason: string, operator: string): Promise<A2ProposalTicket> {
  const raw = await a6Request<unknown>(`/roles/${encodeURIComponent(roleId)}`, {
    method: "PATCH",
    body: JSON.stringify({ ...buildRoleStatusPayload(status), reason, operator }),
    idempotencyPrefix: "a6-role-status",
  });
  const ticket = normalizeProposalTicket(raw);
  if (!ticket) throw new Error("A6_STATUS_PROPOSAL_CONTRACT_INVALID");
  return ticket;
}

export async function deleteA6Role(roleId: number, reason: string, operator: string): Promise<A2ProposalTicket> {
  const raw = await a6Request<unknown>(`/roles/${encodeURIComponent(roleId)}`, {
    method: "DELETE",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "a6-role-delete",
  });
  const ticket = normalizeProposalTicket(raw);
  if (!ticket) throw new Error("A6_DELETE_PROPOSAL_CONTRACT_INVALID");
  return ticket;
}

export async function proposeA6RoleGrants(roleId: number, payload: A6GrantsPayload, reason: string, operator: string): Promise<A2ProposalTicket> {
  const raw = await a6Request<unknown>(`/roles/${encodeURIComponent(roleId)}/grants`, {
    method: "PUT",
    body: JSON.stringify({ ...payload, reason, operator }),
    idempotencyPrefix: "a6-role-grants",
  });
  const ticket = normalizeProposalTicket(raw);
  if (!ticket) throw new Error("A6_GRANTS_PROPOSAL_CONTRACT_INVALID");
  return ticket;
}
