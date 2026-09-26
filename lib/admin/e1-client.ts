import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import type { OpsSku } from "@/lib/admin/platform-types";
import { fromPurchaseGate, toPurchaseGate, type BackendPurchaseGate } from "@/lib/admin/e1-purchase-gate";
import { refreshAdminMediaPreviewUrl } from "@/lib/admin/media-client";
import {
  inspectE1SkuPage,
  parseE1GenerationGateData,
  parseE1SkuPage,
  type E1InvalidSku,
} from "@/lib/admin/e1-overview-contract";

export type { E1InvalidSku };

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

interface PageResult<T> {
  total: number;
  pageNum: number;
  pageSize: number;
  records: T[];
}

interface BackendSku {
  skuId: string;
  name: string;
  tier?: string | null;
  tagline?: string | null;
  badge?: string | null;
  gpu?: string | null;
  vram?: string | null;
  hashRate?: string | null;
  power?: string | null;
  datacenter?: string | null;
  uptime?: string | null;
  warranty?: string | null;
  phoneDailyEarn?: number | string | null;
  phoneDailyEarnNex?: number | string | null;
  price?: number | string | null;
  dailyEarn?: number | string | null;
  dailyEarnNex?: number | string | null;
  shareYieldMin?: number | string | null;
  shareYieldMax?: number | string | null;
  baseRate?: string | null;
  sold?: number | null;
  productType: "SERVER" | "DEVICE" | "SHARE";
  inventoryMode: "FINITE" | "UNLIMITED";
  trialEligible: boolean;
  /**
   * 发布门结论。**可选**:该字段由发布门提交引入,`DeviceSkuView` 的历史兼容构造器
   * 把它填 null,早于该提交的后端构建根本不返回它。undefined = 服务端未声明该结论,
   * 页面必须如实显示「未声明」,既不能当成 false(谎称已过门),也不能判该行无效。
   */
  publishBlocked?: boolean | null;
  publishBlockReason?: "PRODUCT_TEST_IDENTIFIER" | "PRODUCT_NO_EFFECTIVE_EARNINGS" | null;
  stock?: string | null;
  aiImageGenPerMin?: number | null;
  aiLlmTokensPerSec?: number | null;
  aiVideoMinPerHour?: number | null;
  aiFineTuneMins?: number | null;
  aiUnlocks?: string | null;
  features?: string[] | null;
  lifecycle?: string | null;
  unlockPhase?: string | null;
  purchaseGate?: BackendPurchaseGate | null;
  imageAssetId?: string | null;
  imageObjectKey?: string | null;
  imagePreviewUrl?: string | null;
  tag?: string | null;
  status?: string | null;
  updatedAt?: string | null;
}

export interface E1Phase {
  p: string;
  label?: string;
  meta: string;
  skus: string;
  sortOrder?: number;
  status?: string;
}

export interface E1GenerationRelease {
  id: string;
  name: string;
  releaseMonth: number;
  phase: string;
  eligibility: boolean;
  phaseOffset?: number;
  forceUnlock?: boolean;
  /**
   * 简报 #38:强制提前开放的溯源。forceUnlock 绕过平台月龄门,属于放大开放范围的动作,
   * 页面必须能显示批准人与审计记录号 —— 数据来自审计日志(E1_GENERATION_GATE_UPDATED),
   * 由后端投影下发。取不到时为空串,页面显示「未记录」而不是编造。
   */
  forceUnlockApprovedBy?: string;
  forceUnlockAuditId?: string;
  forceUnlockApprovedAt?: string;
  effectiveReleaseMonth?: number;
  status?: string;
}

export interface E1GenerationGateData {
  domain: "E1";
  phaseOrder: string[];
  phases: E1Phase[];
  platformMonth: number;
  phaseCurrent: string;
  releases: E1GenerationRelease[];
  configValues: Record<string, string>;
  allowedFields: string[];
  sources: string[];
}

export interface E1CatalogSnapshot {
  skus: OpsSku[];
  gates: E1GenerationGateData;
  bundleDiscount: E1BundleDiscount;
  /** 被逐行判定拒绝的 SKU(字段不合规)。空数组 = 整份目录都合规。 */
  invalidSkus: E1InvalidSku[];
}

export interface E1BundleDiscount {
  domain: "E1";
  version: number;
  twoItemsPct: number;
  threeItemsPct: number;
  fourPlusItemsPct: number;
  source: "nx_config_item";
}

export interface E1GenerationGateInput {
  skuId?: string;
  name?: string;
  releaseMonth?: number;
  phase?: string;
  eligibility?: boolean;
  phaseOffset?: number;
  forceUnlock?: boolean;
  status?: string;
}

export interface E1PhaseInput {
  label?: string;
  meta?: string;
  skus?: string;
  sortOrder?: number;
  status?: string;
}

let requestSeq = 0;

function toNumber(value: number | string | null | undefined, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toOptionalNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const parsed = toNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function idempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

async function e1Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.idempotencyPrefix) {
    headers.set("Idempotency-Key", idempotencyKey(init.idempotencyPrefix));
  }

  const response = await guardedFetch(`/api/admin/e1${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    throw new Error(formatAdminApiError(result?.message, `E1_REQUEST_FAILED_${response.status}`));
  }

  return result.data as T;
}

/**
 * 单行 → OpsSku。
 *
 * 行级合规性由 `inspectE1SkuPage` 在调用前逐字段判定并具名,不合规的行根本到不了这里 ——
 * 校验只有一处,不会出现「同一个条件在两处各写一遍、改一处漏一处」。
 */
function fromSku(sku: BackendSku): OpsSku {
  const inventoryMode = sku.inventoryMode;
  const stock = inventoryMode === "UNLIMITED" ? undefined : sku.stock as string;
  return {
    id: sku.skuId,
    name: sku.name,
    tier: sku.tier ?? "Entry",
    tagline: sku.tagline ?? undefined,
    badge: sku.badge ?? undefined,
    gpu: sku.gpu ?? undefined,
    vram: sku.vram ?? undefined,
    hashRate: sku.hashRate ?? undefined,
    power: sku.power ?? undefined,
    datacenter: sku.datacenter ?? undefined,
    uptime: sku.uptime ?? undefined,
    warranty: sku.warranty ?? undefined,
    phoneDailyEarn: toOptionalNumber(sku.phoneDailyEarn),
    phoneDailyEarnNEX: toOptionalNumber(sku.phoneDailyEarnNex),
    price: toNumber(sku.price),
    dailyEarn: toNumber(sku.dailyEarn),
    dailyEarnNEX: toNumber(sku.dailyEarnNex),
    shareYieldMin: toOptionalNumber(sku.shareYieldMin),
    shareYieldMax: toOptionalNumber(sku.shareYieldMax),
    baseRate: sku.baseRate ?? undefined,
    sold: sku.sold ?? undefined,
    productType: sku.productType,
    inventoryMode,
    stock,
    trialEligible: sku.trialEligible,
    publishBlocked: sku.publishBlocked ?? undefined,
    publishBlockReason: sku.publishBlocked ? sku.publishBlockReason ?? undefined : undefined,
    aiImageGenPerMin: sku.aiImageGenPerMin ?? undefined,
    aiLlmTokensPerSec: sku.aiLlmTokensPerSec ?? undefined,
    aiVideoMinPerHour: sku.aiVideoMinPerHour ?? undefined,
    aiFineTuneMins: sku.aiFineTuneMins ?? undefined,
    aiUnlocks: sku.aiUnlocks ?? undefined,
    features: sku.features ?? undefined,
    lifecycle: sku.lifecycle ?? undefined,
    unlock: sku.unlockPhase ?? "",
    purchaseGate: fromPurchaseGate(sku.purchaseGate),
    imageAssetId: sku.imageAssetId ?? undefined,
    imageObjectKey: sku.imageObjectKey ?? undefined,
    imagePreviewUrl: sku.imagePreviewUrl ?? undefined,
    tag: sku.tag ?? "",
    status: sku.status ?? "pending",
    updatedAt: sku.updatedAt ?? undefined,
  };
}

function toSkuPayload(sku: OpsSku, reason: string, operator: string) {
  const inventoryMode = sku.inventoryMode === "UNLIMITED" ? "UNLIMITED" : "FINITE";
  const productType = sku.productType ?? (sku.tier === "Share" ? "SHARE" : "DEVICE");
  if (inventoryMode === "UNLIMITED" && productType !== "SHARE") {
    throw new Error("E1_SKU_INVENTORY_CONTRACT_INVALID");
  }
  return {
    skuId: sku.id || undefined,
    name: sku.name,
    tier: sku.tier,
    tagline: sku.tagline ?? null,
    badge: sku.badge ?? null,
    gpu: sku.gpu ?? null,
    vram: sku.vram ?? null,
    hashRate: sku.hashRate ?? null,
    power: sku.power ?? null,
    datacenter: sku.datacenter ?? null,
    uptime: sku.uptime ?? null,
    warranty: sku.warranty ?? null,
    phoneDailyEarn: sku.phoneDailyEarn ?? null,
    phoneDailyEarnNex: sku.phoneDailyEarnNEX ?? null,
    price: sku.price,
    dailyEarn: sku.dailyEarn,
    dailyEarnNex: sku.dailyEarnNEX,
    shareYieldMin: sku.shareYieldMin ?? null,
    shareYieldMax: sku.shareYieldMax ?? null,
    baseRate: sku.baseRate ?? null,
    sold: sku.sold ?? null,
    inventoryMode,
    stock: inventoryMode === "UNLIMITED" ? null : String(sku.stock ?? "0"),
    trialEligible: sku.trialEligible === true,
    aiImageGenPerMin: sku.aiImageGenPerMin ?? null,
    aiLlmTokensPerSec: sku.aiLlmTokensPerSec ?? null,
    aiVideoMinPerHour: sku.aiVideoMinPerHour ?? null,
    aiFineTuneMins: sku.aiFineTuneMins ?? null,
    aiUnlocks: sku.aiUnlocks ?? null,
    features: sku.features ?? [],
    lifecycle: sku.lifecycle ?? "active",
    unlockPhase: sku.unlock || "",
    purchaseGate: toPurchaseGate(sku.purchaseGate),
    imageAssetId: sku.imageAssetId ?? null,
    imageObjectKey: sku.imageObjectKey ?? null,
    imagePreviewUrl: sku.imageAssetId ? null : sku.imagePreviewUrl ?? null,
    tag: sku.tag ?? "",
    status: sku.status ?? "pending",
    reason,
    operator,
  };
}

async function withFreshSkuMediaPreview(sku: OpsSku): Promise<OpsSku> {
  if (!sku.imageAssetId) {
    return sku;
  }
  try {
    const asset = await refreshAdminMediaPreviewUrl(sku.imageAssetId);
    return {
      ...sku,
      imageAssetId: asset.assetId || sku.imageAssetId,
      imageObjectKey: asset.objectKey || sku.imageObjectKey,
      imagePreviewUrl: asset.previewUrl || undefined,
    };
  } catch {
    // A persisted presigned URL is only historical metadata. Never mount it after
    // the authoritative refresh fails: the UI must stay closed and offer retry.
    return { ...sku, imagePreviewUrl: undefined };
  }
}

export async function fetchE1Catalog(): Promise<E1CatalogSnapshot> {
  const [rawSkuPage, rawGates, rawBundleDiscount] = await Promise.all([
    e1Request<unknown>("/skus?pageNum=1&pageSize=100"),
    e1Request<unknown>("/generation-gates"),
    e1Request<unknown>("/bundle-discount"),
  ]);
  const firstSkuPage = parseE1SkuPage<BackendSku>(rawSkuPage);
  if (firstSkuPage.pageNum !== 1) throw new Error("E1_SKU_PAGINATION_CONTRACT_INVALID");
  const gates = parseE1GenerationGateData<E1GenerationGateData>(rawGates);
  const bundleDiscount = parseE1BundleDiscount(rawBundleDiscount);
  const skuRows = [...firstSkuPage.records];
  const seenSkuIds = new Set(skuRows.map((row) => row.skuId));
  if (seenSkuIds.size !== skuRows.length) throw new Error("E1_SKU_PAGINATION_DUPLICATE");
  let pageNum = firstSkuPage.pageNum;
  while (skuRows.length < firstSkuPage.total) {
    pageNum += 1;
    const next = parseE1SkuPage<BackendSku>(
      await e1Request<unknown>(`/skus?pageNum=${pageNum}&pageSize=${firstSkuPage.pageSize}`),
    );
    if (next.pageNum !== pageNum || next.pageSize !== firstSkuPage.pageSize || next.total !== firstSkuPage.total
        || next.records.length === 0) {
      throw new Error("E1_SKU_PAGINATION_CONTRACT_INVALID");
    }
    for (const row of next.records) {
      if (seenSkuIds.has(row.skuId)) throw new Error("E1_SKU_PAGINATION_DUPLICATE");
      seenSkuIds.add(row.skuId);
      skuRows.push(row);
    }
  }
  if (skuRows.length !== firstSkuPage.total) throw new Error("E1_SKU_PAGINATION_CONTRACT_INVALID");
  // 逐行体检:不合规的行**只被挑出来并具名**,不再让整份目录失败。
  // E1 与 App 读同一张 nx_product;一行历史取值不该把运营后台的商品目录清成 0。
  const { valid, invalid } = inspectE1SkuPage<BackendSku>({ ...firstSkuPage, records: skuRows });
  const skus = await Promise.all(valid.map(fromSku).map(withFreshSkuMediaPreview));
  return { skus, gates, bundleDiscount, invalidSkus: invalid };
}

export function parseE1BundleDiscount(value: unknown): E1BundleDiscount {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("E1_BUNDLE_DISCOUNT_CONTRACT_INVALID");
  }
  const row = value as Record<string, unknown>;
  const numbers = [row.twoItemsPct, row.threeItemsPct, row.fourPlusItemsPct];
  if (row.domain !== "E1" || row.source !== "nx_config_item"
      || !Number.isSafeInteger(row.version) || (row.version as number) < 1
      || numbers.some((item) => typeof item !== "number" || !Number.isFinite(item)
        || item <= 0 || item > 50)
      || (numbers[1] as number) < (numbers[0] as number)
      || (numbers[2] as number) < (numbers[1] as number)) {
    throw new Error("E1_BUNDLE_DISCOUNT_CONTRACT_INVALID");
  }
  return {
    domain: "E1",
    version: row.version as number,
    twoItemsPct: numbers[0] as number,
    threeItemsPct: numbers[1] as number,
    fourPlusItemsPct: numbers[2] as number,
    source: "nx_config_item",
  };
}

export async function updateE1BundleDiscount(
  input: Pick<E1BundleDiscount, "twoItemsPct" | "threeItemsPct" | "fourPlusItemsPct" | "version">,
  reason: string,
  operator: string,
) {
  const raw = await e1Request<unknown>("/bundle-discount", {
    method: "PUT",
    body: JSON.stringify({
      twoItemsPct: input.twoItemsPct,
      threeItemsPct: input.threeItemsPct,
      fourPlusItemsPct: input.fourPlusItemsPct,
      expectedVersion: input.version,
      reason,
      operator,
    }),
    idempotencyPrefix: "e1-bundle-discount",
  });
  return parseE1BundleDiscount(raw);
}

export async function saveE1Sku(sku: OpsSku, previousSkuId: string | undefined, reason: string, operator: string) {
  const body = JSON.stringify(toSkuPayload(sku, reason, operator));
  const saved = previousSkuId
    ? await e1Request<BackendSku>(`/skus/${encodeURIComponent(previousSkuId)}`, {
        method: "PUT",
        body,
        headers: sku.updatedAt ? { "X-Product-Revision": sku.updatedAt } : undefined,
        idempotencyPrefix: "e1-sku-save",
      })
    : await e1Request<BackendSku>("/skus", {
        method: "POST",
        body,
        idempotencyPrefix: "e1-sku-create",
      });
  return fromSku(saved);
}

export async function updateE1SkuStatus(
  skuId: string, expectedUpdatedAt: string, status: string, reason: string, operator: string,
) {
  const saved = await e1Request<BackendSku>(`/skus/${encodeURIComponent(skuId)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, reason, operator }),
    headers: { "X-Product-Revision": expectedUpdatedAt },
    idempotencyPrefix: "e1-sku-status",
  });
  return fromSku(saved);
}

export async function deleteE1Sku(skuId: string, expectedUpdatedAt: string, reason: string, operator: string) {
  await e1Request<{ deleted: boolean }>(`/skus/${encodeURIComponent(skuId)}`, {
    method: "DELETE",
    body: JSON.stringify({ status: "off", reason, operator }),
    headers: { "X-Product-Revision": expectedUpdatedAt },
    idempotencyPrefix: "e1-sku-delete",
  });
}

export async function updateE1GenerationGate(key: string, value: string, reason: string, operator: string) {
  return e1Request<E1GenerationGateData>("/generation-gates", {
    method: "PATCH",
    body: JSON.stringify({ key, value, reason, operator }),
    idempotencyPrefix: "e1-generation-gate",
  });
}

export async function createE1GenerationGate(input: E1GenerationGateInput, reason: string, operator: string) {
  return e1Request<E1GenerationGateData>("/generation-gates", {
    method: "POST",
    body: JSON.stringify({ ...input, reason, operator }),
    idempotencyPrefix: "e1-generation-gate-create",
  });
}

export async function patchE1GenerationGate(skuId: string, input: E1GenerationGateInput, reason: string, operator: string) {
  return e1Request<E1GenerationGateData>(`/generation-gates/${encodeURIComponent(skuId)}`, {
    method: "PATCH",
    body: JSON.stringify({ ...input, reason, operator }),
    idempotencyPrefix: "e1-generation-gate-update",
  });
}

export async function archiveE1GenerationGate(skuId: string, reason: string, operator: string) {
  return e1Request<E1GenerationGateData>(`/generation-gates/${encodeURIComponent(skuId)}`, {
    method: "DELETE",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "e1-generation-gate-archive",
  });
}

export async function createE1Phase(input: E1PhaseInput, reason: string, operator: string) {
  return e1Request<E1GenerationGateData>("/phases", {
    method: "POST",
    body: JSON.stringify({ ...input, reason, operator }),
    idempotencyPrefix: "e1-phase-create",
  });
}

export async function patchE1Phase(phaseId: string, input: E1PhaseInput, reason: string, operator: string) {
  return e1Request<E1GenerationGateData>(`/phases/${encodeURIComponent(phaseId)}`, {
    method: "PATCH",
    body: JSON.stringify({ ...input, reason, operator }),
    idempotencyPrefix: "e1-phase-update",
  });
}

export async function archiveE1Phase(phaseId: string, reason: string, operator: string) {
  return e1Request<E1GenerationGateData>(`/phases/${encodeURIComponent(phaseId)}`, {
    method: "DELETE",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "e1-phase-archive",
  });
}
