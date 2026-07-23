import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError } from "@/lib/admin/error-messages";
import { normalizeA8Page, normalizeA8Permission } from "@/lib/admin/rbac-contracts";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

/** A8 权限字典视图（只读）。对齐后端 PermissionDictionaryView + PageResult。 */
export type A8Permission = {
  permissionCode: string;
  permissionName: string;
  permType: string; // READ / WRITE / HIGH
  menuId: number | null;
  menuCodePath: string; // "域 / 页"，无菜单→"—"
  amplifies: number; // 0/1
  boundRoleCount: number;
  resourcePath: string;
};

export type A8PermissionPage = {
  total: number;
  pageNum: number;
  pageSize: number;
  records: A8Permission[];
};

export type A8PermissionDetail = A8Permission;

export type A8PermissionQuery = {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  domain?: string; // A-M，省略或 ALL=不过滤
  permType?: string; // READ/WRITE/HIGH，省略或 ALL=不过滤
};

async function a8Request<T>(path: string): Promise<T> {
  const response = await fetch(`/api/admin/platform${path}`, {
    cache: "no-store", signal: AbortSignal.timeout(12_000),
  });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    throw new Error(formatAdminApiError(result?.message, `A8_REQUEST_FAILED_${response.status}`));
  }
  return result.data as T;
}

/** 服务端分页查询。空值 query 不拼入 URL。 */
export async function fetchA8Permissions(query: A8PermissionQuery): Promise<A8PermissionPage> {
  const params = new URLSearchParams();
  params.set("pageNum", String(query.pageNum ?? 1));
  params.set("pageSize", String(query.pageSize ?? 20));
  if (query.keyword && query.keyword.trim()) params.set("keyword", query.keyword.trim());
  if (query.domain && query.domain !== "ALL") params.set("domain", query.domain);
  if (query.permType && query.permType !== "ALL") params.set("permType", query.permType);
  return normalizeA8Page(await a8Request<unknown>(`/permissions?${params.toString()}`)) as A8PermissionPage;
}

export async function fetchA8PermissionDetail(code: string): Promise<A8PermissionDetail | null> {
  return normalizeA8Permission(await a8Request<unknown>(`/permissions/${encodeURIComponent(code)}`)) as A8PermissionDetail;
}
