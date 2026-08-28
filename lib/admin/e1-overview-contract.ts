type UnknownRecord = Record<string, unknown>;

export interface E1SkuPageContract<T = UnknownRecord> {
  total: number;
  pageNum: number;
  pageSize: number;
  records: T[];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumberLike(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
}

function isNonNegativeNumberLike(value: unknown) {
  return isFiniteNumberLike(value) && Number(value) >= 0;
}

function isNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isOptionalString(value: unknown) {
  return value === undefined || value === null || typeof value === "string";
}

function isOptionalBoolean(value: unknown) {
  return value === undefined || value === null || typeof value === "boolean";
}

function isOptionalNonNegativeNumberLike(value: unknown) {
  return value === undefined || value === null || isNonNegativeNumberLike(value);
}

function isCanonicalFiniteStock(value: unknown) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 2_147_483_647;
}

function isStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validPurchaseGate(value: unknown) {
  if (value === undefined || value === null) return true;
  if (!isRecord(value)) return false;
  if (!["all", "either", undefined, null].includes(value.mode as never)) return false;
  // Keep parsing legacy month rows so E1 can display them as a repair/HOLD
  // state; new writes are normalized to lifetime by the editor/client.
  if (!["month", "lifetime", undefined, null].includes(value.quotaPeriod as never)) return false;
  if (!isOptionalBoolean(value.enforce)) return false;
  if (value.activeDirectMin !== undefined && value.activeDirectMin !== null
    && isFiniteNumberLike(value.activeDirectMin) && Number(value.activeDirectMin) > 1_000_000) return false;
  if ((value.quotaCap == null) !== (value.quotaSold == null)) return false;
  if (value.quotaCap != null && value.quotaSold != null
    && isFiniteNumberLike(value.quotaCap) && isFiniteNumberLike(value.quotaSold)
    && Number(value.quotaSold) > Number(value.quotaCap)) return false;
  return ["rankMin", "activeDirectMin", "teamVolumeMin", "quotaCap", "quotaSold"]
    .every((key) => isOptionalNonNegativeNumberLike(value[key]));
}

function validSku(value: unknown) {
  if (!isRecord(value)) return false;
  if (typeof value.skuId !== "string" || value.skuId.trim() === "") return false;
  if (typeof value.name !== "string" || value.name.trim() === "") return false;
  if (!["SERVER", "DEVICE", "SHARE"].includes(value.productType as never)) return false;
  if (!["FINITE", "UNLIMITED"].includes(value.inventoryMode as never)) return false;
  if (value.inventoryMode === "UNLIMITED" && (value.productType !== "SHARE" || value.stock != null)) return false;
  if (value.inventoryMode === "FINITE" && !isCanonicalFiniteStock(value.stock)) return false;
  if (!["tier", "tagline", "badge", "gpu", "vram", "hashRate", "power", "datacenter", "uptime", "warranty",
    "baseRate", "stock", "aiUnlocks", "lifecycle", "unlockPhase", "imageAssetId",
    "imageObjectKey", "imagePreviewUrl", "tag", "status"]
    .every((key) => isOptionalString(value[key]))) return false;
  if (!["price", "dailyEarn", "dailyEarnNex", "phoneDailyEarn", "phoneDailyEarnNex", "shareYieldMin", "shareYieldMax", "sold",
    "aiImageGenPerMin", "aiLlmTokensPerSec", "aiVideoMinPerHour", "aiFineTuneMins"]
    .every((key) => isOptionalNonNegativeNumberLike(value[key]))) return false;
  if (value.features !== undefined && value.features !== null && !isStringArray(value.features)) return false;
  return validPurchaseGate(value.purchaseGate);
}

export function parseE1SkuPage<T = UnknownRecord>(value: unknown): E1SkuPageContract<T> {
  if (
    !isRecord(value)
    || !isNonNegativeInteger(value.total)
    || !isNonNegativeInteger(value.pageNum)
    || Number(value.pageNum) < 1
    || !isNonNegativeInteger(value.pageSize)
    || Number(value.pageSize) < 1
    || !Array.isArray(value.records)
    || value.records.length > Number(value.total)
    || !value.records.every(validSku)
  ) {
    throw new Error("E1_SKU_PAGE_INVALID");
  }
  return value as unknown as E1SkuPageContract<T>;
}

function validPhase(value: unknown) {
  return isRecord(value)
    && typeof value.p === "string"
    && value.p.trim() !== ""
    && typeof value.meta === "string"
    && typeof value.skus === "string"
    && isOptionalString(value.label)
    && isOptionalString(value.status)
    && (value.sortOrder === undefined || isNonNegativeInteger(value.sortOrder));
}

function validRelease(value: unknown) {
  return isRecord(value)
    && typeof value.id === "string"
    && value.id.trim() !== ""
    && typeof value.name === "string"
    && value.name.trim() !== ""
    && isNonNegativeInteger(value.releaseMonth)
    && typeof value.phase === "string"
    && value.phase.trim() !== ""
    && typeof value.eligibility === "boolean"
    && (value.phaseOffset === undefined || (typeof value.phaseOffset === "number" && Number.isSafeInteger(value.phaseOffset)))
    && isOptionalBoolean(value.forceUnlock)
    && (value.effectiveReleaseMonth === undefined || isNonNegativeInteger(value.effectiveReleaseMonth))
    && isOptionalString(value.status);
}

export function parseE1GenerationGateData<T = UnknownRecord>(value: unknown): T {
  if (
    !isRecord(value)
    || value.domain !== "E1"
    || !isStringArray(value.phaseOrder)
    || new Set(value.phaseOrder).size !== value.phaseOrder.length
    || !Array.isArray(value.phases)
    || !value.phases.every(validPhase)
    || !isNonNegativeInteger(value.platformMonth)
    || typeof value.phaseCurrent !== "string"
    || !Array.isArray(value.releases)
    || !value.releases.every(validRelease)
    || !isRecord(value.configValues)
    || !Object.values(value.configValues).every((item) => typeof item === "string")
    || !isStringArray(value.allowedFields)
    || !isStringArray(value.sources)
    || value.sources.some((source) => source.trim() === "")
  ) {
    throw new Error("E1_GENERATION_GATE_INVALID");
  }
  return value as T;
}
