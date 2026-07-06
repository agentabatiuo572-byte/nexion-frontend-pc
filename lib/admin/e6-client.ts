import { formatAdminApiError } from "@/lib/admin/error-messages";

/**
 * E6 算力与设备配置 —— 对接后端 OpsDeviceController。
 * 后端为 server-canonical:GET /api/admin/devices/compute-config 聚合视图;
 * PATCH /api/admin/devices/compute-config/params/{paramKey} 单参数写入(白名单 + 值规则校验 + A2 审计)。
 * 所有写入带 reason + operator + Idempotency-Key,与 e5-client 同款契约。
 *
 * paramKey 命名与后端 ComputeConfigRegistry 1:1 对齐(前缀 E.compute.*),前端只生成、不解析。
 */

// ── paramKey 命名(与后端 ComputeConfigRegistry 1:1)──────────────────────
export const E6_PARAM_PREFIX = "E.compute.";
export const e6FlagKey = (flag: string): string => `${E6_PARAM_PREFIX}${flag}`;
export const e6CoeffKey = (key: string): string => `${E6_PARAM_PREFIX}${key}`;
export const e6YieldKey = (key: string): string => `${E6_PARAM_PREFIX}yieldEstimate.${key}`;
export const e6GpuTierKey = (id: string, field: string): string => `${E6_PARAM_PREFIX}gpuTier.${id}.${field}`;
export const e6DownloadKey = (field: string): string => `${E6_PARAM_PREFIX}download.${field}`;

/** PATCH 白名单判断(防越权改其他域 config);与后端 ComputeConfigRegistry.isComputeParamKey 同口径。 */
export function isE6ParamKey(key: string | null | undefined): boolean {
  return !!key && key.startsWith(E6_PARAM_PREFIX);
}

// ── 视图类型(镜像后端 ComputeConfigView)─────────────────────────────────
export interface E6FlagView {
  key: string;
  label: string;
  desc: string;
  enabled: boolean;
  frontendEffect: string;
}
export interface E6CoeffView {
  key: string;
  label: string;
  value: string;
  unit: string;
  desc: string;
  frontendEffect: string;
}
export interface E6YieldView {
  key: string;
  label: string;
  value: string;
  unit: string;
}
export interface E6GpuTierView {
  id: string;
  label: string;
  desc: string;
  defaultModel: string;
  tops: string;
  keywords: string[];
}
export interface E6DownloadView {
  url: string;
  zhTitle: string;
  zhGuide: string;
  enTitle: string;
  enGuide: string;
}
export interface E6ComputeConfigView {
  domain: string;
  flags: E6FlagView[];
  coefficients: E6CoeffView[];
  yieldEstimate: E6YieldView[];
  gpuTiers: E6GpuTierView[];
  download: E6DownloadView;
  sources: string[];
}

// ── HTTP 骨架(照搬 e5-client 的 ApiResult / idempotency 模式)─────────────
interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

let requestSeq = 0;
function idempotencyKey(prefix: string): string {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

async function e6Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.idempotencyPrefix) {
    headers.set("Idempotency-Key", idempotencyKey(init.idempotencyPrefix));
  }
  const response = await fetch(`/api/admin/devices${path}`, { ...init, headers, cache: "no-store" });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !result || result.code !== 0) {
    throw new Error(formatAdminApiError(result?.message, `E6_REQUEST_FAILED_${response.status}`));
  }
  return result.data as T;
}

// ── 读:GET 聚合视图 ─────────────────────────────────────────────────────
export async function fetchE6ComputeConfig(): Promise<E6ComputeConfigView> {
  return e6Request<E6ComputeConfigView>("/compute-config");
}

// ── 写:PATCH 单参数 ─────────────────────────────────────────────────────
export async function updateE6Param(
  paramKey: string,
  value: string,
  reason: string,
  operator: string,
): Promise<{ paramKey: string; value: string }> {
  return e6Request<{ paramKey: string; value: string }>(
    `/compute-config/params/${encodeURIComponent(paramKey)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ value, reason, operator }),
      idempotencyPrefix: "e6-param",
    },
  );
}

/**
 * 多字段批量写入:后端只支持单 key PATCH,这里顺序逐个写。
 * 任一字段失败即抛错(已写入的保留,调用方刷新视图后可见真实剩余态)。
 */
export async function updateE6Params(
  values: Record<string, string>,
  reason: string,
  operator: string,
): Promise<void> {
  for (const [paramKey, value] of Object.entries(values)) {
    await updateE6Param(paramKey, value, reason, operator);
  }
}
