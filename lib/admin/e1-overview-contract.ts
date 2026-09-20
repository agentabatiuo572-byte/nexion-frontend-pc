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

/**
 * 单行 SKU 的不合规字段名。
 *
 * 返回空数组 = 该行合规。**逐字段具名**是刻意的:页面要能直接告诉运营「这一行的哪个字段
 * 不合规」,而不是把整份目录判成不可用 —— 此前任一行的取值落在白名单之外就让整页读取失败,
 * 调用方随即清空 skus/gates/bundleDiscount,于是同一份 nx_product 在 App 正常展示、
 * 在 E1 变成「在售 SKU=0、阶段规则=0」。
 */
export function e1SkuInvalidFields(value: unknown): string[] {
  if (!isRecord(value)) return ["sku"];
  const invalid: string[] = [];
  if (typeof value.skuId !== "string" || value.skuId.trim() === "") invalid.push("skuId");
  if (typeof value.name !== "string" || value.name.trim() === "") invalid.push("name");
  if (!["SERVER", "DEVICE", "SHARE"].includes(value.productType as never)) invalid.push("productType");
  if (!["FINITE", "UNLIMITED"].includes(value.inventoryMode as never)) invalid.push("inventoryMode");
  if (value.inventoryMode === "UNLIMITED" && (value.productType !== "SHARE" || value.stock != null)) {
    invalid.push("inventoryMode.stock");
  }
  if (value.inventoryMode === "FINITE" && !isCanonicalFiniteStock(value.stock)) invalid.push("stock");
  for (const key of ["tier", "tagline", "badge", "gpu", "vram", "hashRate", "power", "datacenter", "uptime", "warranty",
    "baseRate", "stock", "aiUnlocks", "lifecycle", "unlockPhase", "imageAssetId",
    "imageObjectKey", "imagePreviewUrl", "tag", "status"]) {
    if (!isOptionalString(value[key])) invalid.push(key);
  }
  for (const key of ["price", "dailyEarn", "dailyEarnNex", "phoneDailyEarn", "phoneDailyEarnNex", "shareYieldMin", "shareYieldMax", "sold",
    "aiImageGenPerMin", "aiLlmTokensPerSec", "aiVideoMinPerHour", "aiFineTuneMins"]) {
    if (!isOptionalNonNegativeNumberLike(value[key])) invalid.push(key);
  }
  if (value.features !== undefined && value.features !== null && !isStringArray(value.features)) invalid.push("features");
  if (!validPurchaseGate(value.purchaseGate)) invalid.push("purchaseGate");
  if (typeof value.trialEligible !== "boolean") invalid.push("trialEligible");
  // 发布门结论是**后加的服务端字段**:`DeviceSkuView` 的历史兼容构造器把它填 null,
  // 且测试环境曾运行早于发布门提交的后端构建。因此「未声明」是合法状态,不是行级错误 ——
  // 把它判成错误会让整份目录在旧后端上再次变空,那正是本缺陷。
  // 一旦声明了就必须自洽:布尔态 + 结论与原因成对,否则页面无法判断该行是否真被挡。
  if (value.publishBlocked !== undefined && value.publishBlocked !== null) {
    if (typeof value.publishBlocked !== "boolean") {
      invalid.push("publishBlocked");
    } else if (value.publishBlocked
        && value.publishBlockReason !== "PRODUCT_TEST_IDENTIFIER"
        && value.publishBlockReason !== "PRODUCT_NO_EFFECTIVE_EARNINGS") {
      invalid.push("publishBlockReason");
    } else if (!value.publishBlocked && value.publishBlockReason != null) {
      invalid.push("publishBlockReason");
    }
  }
  return invalid;
}

/** 被逐行判定拒绝的 SKU:保留可识别信息 + 具体不合规字段名,供页面具名展示。 */
export interface E1InvalidSku {
  skuId: string;
  name: string;
  invalidFields: string[];
}

export interface E1SkuPageInspection<T> {
  /** 通过逐行校验的行(顺序保持服务端分页顺序)。 */
  valid: T[];
  invalid: E1InvalidSku[];
}

/**
 * 分页契约的**页级**形状校验。行级合规性不在这里判 —— 那是 {@link inspectE1SkuPage} 的事,
 * 否则单行问题会升级成整页不可用。
 */
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
  ) {
    throw new Error("E1_SKU_PAGE_INVALID");
  }
  return value as unknown as E1SkuPageContract<T>;
}

/**
 * 页级校验 + 逐行体检。
 *
 * 页级形状坏了才是整页失败(调用方清空);行级不合规只把**那一行**挑出来并具名,其余行照常
 * 展示。E1 与 App 读同一张 nx_product,不能让一行历史取值把整份目录判死。
 */
export function inspectE1SkuPage<T = UnknownRecord>(value: unknown): E1SkuPageInspection<T> {
  const page = parseE1SkuPage<T>(value);
  const valid: T[] = [];
  const invalid: E1InvalidSku[] = [];
  for (const record of page.records as unknown[]) {
    const fields = e1SkuInvalidFields(record);
    if (fields.length === 0) {
      valid.push(record as T);
      continue;
    }
    const row = record as UnknownRecord;
    invalid.push({
      skuId: typeof row.skuId === "string" && row.skuId.trim() ? row.skuId : "(缺少 skuId)",
      name: typeof row.name === "string" && row.name.trim() ? row.name : "(缺少名称)",
      invalidFields: fields,
    });
  }
  return { valid, invalid };
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
