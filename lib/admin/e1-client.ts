import { formatAdminApiError } from "@/lib/admin/error-messages";
import type { OpsReview, OpsSku, PurchaseGate } from "@/lib/admin/platform-types";
import { refreshAdminMediaPreviewUrl } from "@/lib/admin/media-client";

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

interface BackendPurchaseGate {
  rankMin?: number | null;
  activeDirectMin?: number | null;
  teamVolumeMin?: number | null;
  mode?: "all" | "either" | null;
  quotaCap?: number | null;
  quotaSold?: number | null;
  quotaPeriod?: "month" | "lifetime" | null;
  enforce?: boolean | null;
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
  price?: number | string | null;
  dailyEarn?: number | string | null;
  dailyEarnNex?: number | string | null;
  shareYieldMin?: number | string | null;
  shareYieldMax?: number | string | null;
  baseRate?: string | null;
  sold?: number | null;
  stock?: string | null;
  rating?: number | string | null;
  reviews?: number | null;
  aiImageGenPerMin?: number | null;
  aiLlmTokensPerSec?: number | null;
  aiVideoMinPerHour?: number | null;
  aiFineTuneMins?: number | null;
  aiUnlocks?: string | null;
  features?: string[] | null;
  generation?: number | null;
  lifecycle?: string | null;
  supersededBy?: string | null;
  tradeinDiscount?: number | string | null;
  unlockPhase?: string | null;
  purchaseGate?: BackendPurchaseGate | null;
  imageAssetId?: string | null;
  imageObjectKey?: string | null;
  imagePreviewUrl?: string | null;
  tag?: string | null;
  status?: string | null;
}

interface BackendReview {
  reviewId: string;
  skuId: string;
  author: string;
  rating: number;
  content: string;
  dateText: string;
  status: string;
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
  reviews: OpsReview[];
  gates: E1GenerationGateData;
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

  const response = await fetch(`/api/admin/e1${path}`, {
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

function fromPurchaseGate(gate: BackendPurchaseGate | null | undefined): PurchaseGate | undefined {
  if (!gate) {
    return undefined;
  }
  const purchaseGate: PurchaseGate = {
    rankMin: gate.rankMin ?? undefined,
    activeDirectMin: gate.activeDirectMin ?? undefined,
    teamVolumeMin: gate.teamVolumeMin ?? undefined,
    mode: gate.mode === "either" ? "either" : "all",
    quotaCap: gate.quotaCap ?? undefined,
    quotaSold: gate.quotaSold ?? undefined,
    quotaPeriod: gate.quotaPeriod === "lifetime" ? "lifetime" : "month",
    enforce: gate.enforce !== false,
  };
  const hasValue =
    purchaseGate.rankMin != null ||
    purchaseGate.activeDirectMin != null ||
    purchaseGate.teamVolumeMin != null ||
    purchaseGate.quotaCap != null;
  return hasValue ? purchaseGate : undefined;
}

function toPurchaseGate(gate: PurchaseGate | undefined): BackendPurchaseGate | null {
  if (!gate) {
    return null;
  }
  return {
    rankMin: gate.rankMin ?? null,
    activeDirectMin: gate.activeDirectMin ?? null,
    teamVolumeMin: gate.teamVolumeMin ?? null,
    mode: gate.mode,
    quotaCap: gate.quotaCap ?? null,
    quotaSold: gate.quotaSold ?? null,
    quotaPeriod: gate.quotaPeriod ?? null,
    enforce: gate.enforce,
  };
}

function fromSku(sku: BackendSku): OpsSku {
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
    price: toNumber(sku.price),
    dailyEarn: toNumber(sku.dailyEarn),
    dailyEarnNEX: toNumber(sku.dailyEarnNex),
    shareYieldMin: toOptionalNumber(sku.shareYieldMin),
    shareYieldMax: toOptionalNumber(sku.shareYieldMax),
    baseRate: sku.baseRate ?? undefined,
    sold: sku.sold ?? undefined,
    stock: sku.stock ?? "0",
    rating: toOptionalNumber(sku.rating),
    reviews: sku.reviews ?? undefined,
    aiImageGenPerMin: sku.aiImageGenPerMin ?? undefined,
    aiLlmTokensPerSec: sku.aiLlmTokensPerSec ?? undefined,
    aiVideoMinPerHour: sku.aiVideoMinPerHour ?? undefined,
    aiFineTuneMins: sku.aiFineTuneMins ?? undefined,
    aiUnlocks: sku.aiUnlocks ?? undefined,
    features: sku.features ?? undefined,
    generation: sku.generation ?? undefined,
    lifecycle: sku.lifecycle ?? undefined,
    supersededBy: sku.supersededBy ?? undefined,
    tradeinDiscount: toOptionalNumber(sku.tradeinDiscount),
    unlock: sku.unlockPhase ?? "",
    purchaseGate: fromPurchaseGate(sku.purchaseGate),
    imageAssetId: sku.imageAssetId ?? undefined,
    imageObjectKey: sku.imageObjectKey ?? undefined,
    imagePreviewUrl: sku.imagePreviewUrl ?? undefined,
    tag: sku.tag ?? "",
    status: sku.status ?? "pending",
  };
}

function toSkuPayload(sku: OpsSku, reason: string, operator: string) {
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
    price: sku.price,
    dailyEarn: sku.dailyEarn,
    dailyEarnNex: sku.dailyEarnNEX,
    shareYieldMin: sku.shareYieldMin ?? null,
    shareYieldMax: sku.shareYieldMax ?? null,
    baseRate: sku.baseRate ?? null,
    sold: sku.sold ?? null,
    stock: String(sku.stock ?? "0"),
    rating: sku.rating ?? null,
    reviews: sku.reviews ?? null,
    aiImageGenPerMin: sku.aiImageGenPerMin ?? null,
    aiLlmTokensPerSec: sku.aiLlmTokensPerSec ?? null,
    aiVideoMinPerHour: sku.aiVideoMinPerHour ?? null,
    aiFineTuneMins: sku.aiFineTuneMins ?? null,
    aiUnlocks: sku.aiUnlocks ?? null,
    features: sku.features ?? [],
    generation: sku.generation ?? 1,
    lifecycle: sku.lifecycle ?? "active",
    supersededBy: sku.supersededBy ?? null,
    tradeinDiscount: sku.tradeinDiscount ?? null,
    unlockPhase: sku.unlock || "",
    purchaseGate: toPurchaseGate(sku.purchaseGate),
    imageAssetId: sku.imageAssetId ?? null,
    imageObjectKey: sku.imageObjectKey ?? null,
    imagePreviewUrl: sku.imagePreviewUrl ?? null,
    tag: sku.tag ?? "",
    status: sku.status ?? "pending",
    reason,
    operator,
  };
}

function fromReview(review: BackendReview): OpsReview {
  return {
    id: review.reviewId,
    productId: review.skuId,
    author: review.author,
    rating: review.rating,
    content: review.content,
    date: review.dateText,
    status: review.status,
  };
}

function toReviewPayload(review: OpsReview, reason: string, operator: string) {
  return {
    skuId: review.productId,
    author: review.author,
    rating: review.rating,
    content: review.content,
    dateText: review.date,
    status: review.status,
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
      imagePreviewUrl: asset.previewUrl || sku.imagePreviewUrl,
    };
  } catch {
    return sku;
  }
}

export async function fetchE1Catalog(): Promise<E1CatalogSnapshot> {
  const [skuPage, reviewPage, gates] = await Promise.all([
    e1Request<PageResult<BackendSku>>("/skus?pageNum=1&pageSize=100"),
    e1Request<PageResult<BackendReview>>("/reviews?pageNum=1&pageSize=100"),
    e1Request<E1GenerationGateData>("/generation-gates"),
  ]);
  const skus = await Promise.all((skuPage.records ?? []).map(fromSku).map(withFreshSkuMediaPreview));

  return {
    skus,
    reviews: (reviewPage.records ?? []).map(fromReview),
    gates,
  };
}

export async function saveE1Sku(sku: OpsSku, previousSkuId: string | undefined, reason: string, operator: string) {
  const body = JSON.stringify(toSkuPayload(sku, reason, operator));
  const saved = previousSkuId
    ? await e1Request<BackendSku>(`/skus/${encodeURIComponent(previousSkuId)}`, {
        method: "PUT",
        body,
        idempotencyPrefix: "e1-sku-save",
      })
    : await e1Request<BackendSku>("/skus", {
        method: "POST",
        body,
        idempotencyPrefix: "e1-sku-create",
      });
  return fromSku(saved);
}

export async function updateE1SkuStatus(skuId: string, status: string, reason: string, operator: string) {
  const saved = await e1Request<BackendSku>(`/skus/${encodeURIComponent(skuId)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, reason, operator }),
    idempotencyPrefix: "e1-sku-status",
  });
  return fromSku(saved);
}

export async function deleteE1Sku(skuId: string, reason: string, operator: string) {
  await e1Request<{ deleted: boolean }>(`/skus/${encodeURIComponent(skuId)}`, {
    method: "DELETE",
    body: JSON.stringify({ status: "off", reason, operator }),
    idempotencyPrefix: "e1-sku-delete",
  });
}

export async function saveE1Review(review: OpsReview, reason: string, operator: string) {
  const saved = await e1Request<BackendReview>("/reviews", {
    method: "POST",
    body: JSON.stringify(toReviewPayload(review, reason, operator)),
    idempotencyPrefix: "e1-review-create",
  });
  return fromReview(saved);
}

export async function updateE1Review(review: OpsReview, reason: string, operator: string) {
  const saved = await e1Request<BackendReview>(`/reviews/${encodeURIComponent(review.id)}`, {
    method: "PUT",
    body: JSON.stringify(toReviewPayload(review, reason, operator)),
    idempotencyPrefix: "e1-review-update",
  });
  return fromReview(saved);
}

export async function updateE1ReviewStatus(reviewId: string, status: string, reason: string, operator: string) {
  const saved = await e1Request<BackendReview>(`/reviews/${encodeURIComponent(reviewId)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, reason, operator }),
    idempotencyPrefix: "e1-review-status",
  });
  return fromReview(saved);
}

export async function deleteE1Review(reviewId: string, reason: string, operator: string) {
  await e1Request<{ deleted: boolean }>(`/reviews/${encodeURIComponent(reviewId)}`, {
    method: "DELETE",
    body: JSON.stringify({ status: "hidden", reason, operator }),
    idempotencyPrefix: "e1-review-delete",
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

export async function setE1CurrentPhase(phaseId: string, reason: string, operator: string) {
  return e1Request<E1GenerationGateData>(`/phases/${encodeURIComponent(phaseId)}/current`, {
    method: "PATCH",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "e1-phase-current",
  });
}
