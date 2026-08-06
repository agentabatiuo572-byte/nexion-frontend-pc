import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError } from "@/lib/admin/error-messages";
import { mutateThenReloadOverview } from "@/lib/admin/platform-contracts";
import { normalizeA7Overview as strictA7Overview } from "@/lib/admin/rbac-contracts";

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
  version: string;
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
  expectedVersion: string;
};

function normalizeOverview(raw: unknown): A7MenuOverview {
  return strictA7Overview(raw) as A7MenuOverview;
}

function idempotencyKey(prefix: string) {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${uuid}`;
}

export function newA7IdempotencyKey(prefix: string) {
  return idempotencyKey(prefix);
}

async function a7Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string; idempotencyKey?: string }): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init?.idempotencyKey) headers.set("Idempotency-Key", init.idempotencyKey);
  else if (init?.idempotencyPrefix) headers.set("Idempotency-Key", idempotencyKey(init.idempotencyPrefix));

  const uncertain = () => new Error(
    "请求结果尚未确认，当前输入已保留；请直接重试，系统会沿用同一幂等键核对结果。");
  // 传输层失败(断网 / 超时)必须归结果未知,不能抛裸错误让调用方当成确定失败。
  let response: Response;
  try {
    response = await fetch(`/api/admin/platform${path}`, {
      ...init, headers, cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(12_000),
    });
  } catch (error) {
    if (headers.has("Idempotency-Key")) throw uncertain();
    throw error;
  }
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    // unknown 头只是增强信号:5xx 同样归结果未知(统一口径见 outcome-classification.ts)。
    if (headers.has("Idempotency-Key")
      && (response.headers.get("X-Nexion-Upstream-Outcome") === "unknown"
        || outcomeStaysUnknown(response.status, result?.code))) {
      throw uncertain();
    }
    throw new Error(formatAdminApiError(result?.message, `A7_REQUEST_FAILED_${response.status}`));
  }
  return result.data as T;
}

export async function fetchA7MenusOverview(): Promise<A7MenuOverview> {
  return normalizeOverview(await a7Request<unknown>("/menus/overview"));
}

export async function createA7Menu(input: A7MenuCreateInput, reason: string, operator: string, stableKey?: string): Promise<A7MenuOverview> {
  return mutateThenReloadOverview(
    () => a7Request<A7MenuNode>("/menus", {
      method: "POST",
      body: JSON.stringify({ ...input, reason, operator }),
      idempotencyPrefix: "a7-menu-create",
      idempotencyKey: stableKey,
    }),
    fetchA7MenusOverview,
  );
}

export async function updateA7Menu(menuId: number, input: A7MenuUpdateInput, reason: string, operator: string, stableKey?: string): Promise<A7MenuOverview> {
  return mutateThenReloadOverview(
    () => a7Request<A7MenuNode>(`/menus/${encodeURIComponent(menuId)}`, {
      method: "PATCH",
      body: JSON.stringify({ ...input, reason, operator }),
      idempotencyPrefix: "a7-menu-update",
      idempotencyKey: stableKey,
    }),
    fetchA7MenusOverview,
  );
}

export async function deleteA7Menu(menuId: number, expectedVersion: string, reason: string, operator: string, stableKey?: string): Promise<A7MenuOverview> {
  return mutateThenReloadOverview(
    () => a7Request<void>(`/menus/${encodeURIComponent(menuId)}`, {
      method: "DELETE",
      body: JSON.stringify({ reason, operator, expectedVersion }),
      idempotencyPrefix: "a7-menu-delete",
      idempotencyKey: stableKey,
    }),
    fetchA7MenusOverview,
  );
}
