import { formatAdminApiError } from "@/lib/admin/error-messages";
import { parseE6ComputeConfig } from "@/lib/admin/e456-overview-contract";

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

export const E6_GPU_TIER_IDS = ["G1", "G2", "G3", "G4", "G5", "G6"] as const;
const E6_KEYWORD_FIELDS = ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5", "keyword6"] as const;
const exactKeys = [
  e6FlagKey("computeShareEnabled"),
  e6CoeffKey("h5BaseFactor"),
  e6CoeffKey("continuityFullHours"),
  e6YieldKey("topsBaseline"),
  e6YieldKey("dailyUsdtPerBaseline"),
  e6YieldKey("nexPerUsdt"),
  ...E6_GPU_TIER_IDS.flatMap((id) => [
    e6GpuTierKey(id, "label"),
    e6GpuTierKey(id, "tops"),
    ...E6_KEYWORD_FIELDS.map((field) => e6GpuTierKey(id, field)),
  ]),
  ...["url", "zhTitle", "zhGuide", "enTitle", "enGuide"].map(e6DownloadKey),
];
export const E6_EXACT_PARAM_KEYS = new Set<string>(exactKeys);

/** PATCH 白名单判断(防越权改其他域 config);与后端 ComputeConfigRegistry.isComputeParamKey 同口径。 */
export function isE6ParamKey(key: string | null | undefined): boolean {
  return !!key && E6_EXACT_PARAM_KEYS.has(key);
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
  keywords: E6KeywordView[];
}
export interface E6KeywordView {
  slot: string;
  value: string;
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
  return parseE6ComputeConfig<E6ComputeConfigView>(
    await e6Request<unknown>("/compute-config"),
  );
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

/** 多字段批量写入由后端单事务处理，任一字段非法时不会产生部分提交。 */
export async function updateE6Params(
  values: Record<string, string>,
  reason: string,
  operator: string,
): Promise<{ values: Record<string, string>; updatedAt: string }> {
  return e6Request<{ values: Record<string, string>; updatedAt: string }>(
    "/compute-config/params",
    {
      method: "PATCH",
      body: JSON.stringify({ values, reason, operator }),
      idempotencyPrefix: "e6-param-batch",
    },
  );
}
