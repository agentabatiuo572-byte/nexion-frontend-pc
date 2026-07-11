import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError } from "@/lib/admin/error-messages";
import { mutateThenReloadOverview } from "@/lib/admin/platform-contracts";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

/** A7 菜单节点（扁平字段）+ 嵌套子节点。对齐后端 PlatformMenuTreeOverview.MenuTreeNode。 */
export type A7MenuNode = {
  id: number;
  menuCode: string;
  menuName: string;
  menuNameZh: string;
  parentId: number | null;
  routePath: string;
  icon: string;
  sortOrder: number;
  status: number;
};

export type A7MenuTreeNode = A7MenuNode & { children: A7MenuTreeNode[] };

export type A7MenuOverview = {
  tree: A7MenuTreeNode[];
  domainCount: number;
  pageCount: number;
  activeCount: number;
};

export type A7MenuCreateInput = {
  menuCode: string;
  menuName: string;
  menuNameZh?: string;
  parentCode?: string; // 空 = 顶级域
  routePath?: string;
  icon?: string;
  sortOrder?: number;
};

export type A7MenuUpdateInput = {
  menuName?: string;
  menuNameZh?: string;
  routePath?: string;
  icon?: string;
  sortOrder?: number;
  status?: number;
};

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

function normalizeNode(raw: Record<string, unknown>): A7MenuTreeNode {
  const node = rec(raw.node);
  return {
    id: num(node.id),
    menuCode: str(node.menuCode),
    menuName: str(node.menuName),
    menuNameZh: str(node.menuNameZh),
    parentId: node.parentId == null ? null : num(node.parentId),
    routePath: str(node.routePath),
    icon: str(node.icon),
    sortOrder: num(node.sortOrder),
    status: num(node.status, 1),
    children: Array.isArray(raw.children)
      ? raw.children.filter((c) => c && typeof c === "object").map((c) => normalizeNode(c as Record<string, unknown>))
      : [],
  };
}

function normalizeOverview(raw: unknown): A7MenuOverview {
  const data = rec(raw);
  return {
    tree: Array.isArray(data.tree) ? data.tree.filter((t) => t && typeof t === "object").map((t) => normalizeNode(t as Record<string, unknown>)) : [],
    domainCount: num(data.domainCount),
    pageCount: num(data.pageCount),
    activeCount: num(data.activeCount),
  };
}

let requestSeq = 0;
function idempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

async function a7Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init?.idempotencyPrefix) headers.set("Idempotency-Key", idempotencyKey(init.idempotencyPrefix));

  const response = await fetch(`/api/admin/platform${path}`, { ...init, headers, cache: "no-store" });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    throw new Error(formatAdminApiError(result?.message, `A7_REQUEST_FAILED_${response.status}`));
  }
  return result.data as T;
}

export async function fetchA7MenusOverview(): Promise<A7MenuOverview> {
  return normalizeOverview(await a7Request<unknown>("/menus/overview"));
}

export async function createA7Menu(input: A7MenuCreateInput, reason: string, operator: string): Promise<A7MenuOverview> {
  return mutateThenReloadOverview(
    () => a7Request<A7MenuNode>("/menus", {
      method: "POST",
      body: JSON.stringify({ ...input, reason, operator }),
      idempotencyPrefix: "a7-menu-create",
    }),
    fetchA7MenusOverview,
  );
}

export async function updateA7Menu(menuId: number, input: A7MenuUpdateInput, reason: string, operator: string): Promise<A7MenuOverview> {
  return mutateThenReloadOverview(
    () => a7Request<A7MenuNode>(`/menus/${encodeURIComponent(menuId)}`, {
      method: "PATCH",
      body: JSON.stringify({ ...input, reason, operator }),
      idempotencyPrefix: "a7-menu-update",
    }),
    fetchA7MenusOverview,
  );
}

export async function deleteA7Menu(menuId: number, reason: string, operator: string): Promise<A7MenuOverview> {
  return mutateThenReloadOverview(
    () => a7Request<void>(`/menus/${encodeURIComponent(menuId)}`, {
      method: "DELETE",
      body: JSON.stringify({ reason, operator }),
      idempotencyPrefix: "a7-menu-delete",
    }),
    fetchA7MenusOverview,
  );
}
