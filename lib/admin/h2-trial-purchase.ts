export type BuyListVersion = number;

/**
 * 按设备优惠（B125）：清单里每款两组单独设置，null 表示这一组跟随默认。
 * 试用期折扣的比例和上限同有同空；比例是百分数字符串，"0.5" 即 0.5%。0 原样保存，表示这一项不减。
 */
export type BuyPricing = { discountRate: string | null; discountCapUSD: string | null; earlyPurchaseDiscountUSD: string | null };

export type BuyDevice = {
  productNo: string;
  name: string | null;
  productType: string | null;
  inventoryMode: string | null;
  priceUsdt: string | null;
  stock: number | null;
  status: string | null;
  listingAllowed: boolean;
  visibleToUser: boolean;
  selectable: boolean;
  unavailableReason: string | null;
  appState: "shown" | "hidden" | "soldOut";
  /** 只在读取带「支持按设备优惠」标识时有：清单里的款才带，候选不带。 */
  pricing?: BuyPricing;
};

export type BuyList = { version: BuyListVersion; items: BuyDevice[]; candidates: BuyDevice[] };
export type TrialTarget = Pick<BuyDevice, "productNo" | "name" | "status" | "stock" | "listingAllowed" | "unavailableReason">;

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function isBuyListVersion(value: unknown): value is BuyListVersion {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export const LISTING_BLOCKED = "没通过上架条件";

export function buyProductReason(reason: unknown, status?: string | null): string {
  switch (reason) {
    case "PRODUCT_NOT_AVAILABLE":
      if (status === "PENDING") return "尚未上架";
      if (status === "OFF_SALE") return "商城已下架";
      return "商城当前不可用";
    case "PRODUCT_PRICE_INVALID": return "没有售价";
    case "PRODUCT_TYPE_UNSUPPORTED": return "这个类型不能用试用抵扣金购买";
    case "PRODUCT_CODE_MISMATCH": return "商品编号对不上";
    default: return LISTING_BLOCKED;
  }
}

function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

const decimalText = (value: unknown): value is string | null => value === null || typeof value === "string" && /^\d+(\.\d+)?$/.test(value);

/** 三项都在才算读到；比例和上限要同有同空（ST-37：缺字段、自相矛盾按读取失败）。 */
function readPricing(row: Record<string, unknown>): BuyPricing | "invalid" | undefined {
  // 读取回包里三项平铺在每款上；本地存的待确认记录（review.before）里是读过一次的 pricing 对象。
  const { discountRate, discountCapUSD, earlyPurchaseDiscountUSD } = object(row.pricing) ?? row;
  if ([discountRate, discountCapUSD, earlyPurchaseDiscountUSD].every((value) => value === undefined)) return;
  if (!decimalText(discountRate) || !decimalText(discountCapUSD) || !decimalText(earlyPurchaseDiscountUSD)
    || (discountRate === null) !== (discountCapUSD === null)) return "invalid";
  return { discountRate, discountCapUSD, earlyPurchaseDiscountUSD };
}

function readDevice(raw: unknown): BuyDevice | undefined {
  const row = object(raw);
  if (!row) return;
  const pricing = readPricing(row);
  if (pricing === "invalid") return;
  const { productNo, name, productType, inventoryMode, priceUsdt, stock, status, listingAllowed,
    visibleToUser, selectable, unavailableReason } = row;
  if (typeof productNo !== "string" || !nullableText(name) || !nullableText(productType) || !nullableText(inventoryMode)
    || !(priceUsdt === null || typeof priceUsdt === "string" && /^-?\d+\.\d{6}$/.test(priceUsdt))
    || !(stock === null || typeof stock === "number" && Number.isInteger(stock))
    || !nullableText(status)
    || typeof listingAllowed !== "boolean" || typeof visibleToUser !== "boolean" || typeof selectable !== "boolean"
    || !nullableText(unavailableReason)) return;
  return {
    productNo, name, productType, inventoryMode, priceUsdt, stock, status, listingAllowed, visibleToUser, selectable, unavailableReason,
    appState: !visibleToUser ? "hidden" : inventoryMode === "FINITE" && stock === 0 ? "soldOut" : "shown",
    ...(pricing ? { pricing } : {}),
  };
}

export function readH2BuyDevices(raw: unknown): BuyDevice[] | undefined {
  if (!Array.isArray(raw)) return;
  const rows: BuyDevice[] = [];
  const ids = new Set<string>();
  for (const value of raw) {
    const row = readDevice(value);
    if (!row || !nonBlank(row.productNo) || ids.has(row.productNo)) return;
    ids.add(row.productNo);
    rows.push(row);
  }
  return rows;
}

function sameDevice(left: BuyDevice, right: BuyDevice) {
  return left.name === right.name && left.productType === right.productType
    && left.inventoryMode === right.inventoryMode && left.status === right.status
    && left.priceUsdt === right.priceUsdt && left.stock === right.stock
    && left.listingAllowed === right.listingAllowed && left.visibleToUser === right.visibleToUser
    && left.selectable === right.selectable && left.unavailableReason === right.unavailableReason;
}

function isBuyType(type: string | null) {
  return type === "DEVICE" || type === "SERVER" || type === "SHARE";
}

export function readH2TrialPurchase(raw: Record<string, unknown>) {
  const { currentTrialProduct, writePermissionName, purchaseOptionsVersion, otherPurchaseProducts, purchaseCandidates, purchaseOptionsPricing } = raw;
  if ([currentTrialProduct, writePermissionName, purchaseOptionsVersion, otherPurchaseProducts, purchaseCandidates]
    .every((value) => value === undefined)) return {};
  // 「支持按设备优惠」标识和清单分开读：清单读不到时，改默认值的确认框仍要按新叫法写（画板 ⑥d）。
  const pricing = purchaseOptionsPricing === true;

  const target = readDevice(currentTrialProduct);
  const items = readH2BuyDevices(otherPurchaseProducts);
  const candidates = readH2BuyDevices(purchaseCandidates);
  const byProductNo = new Map(candidates?.map((candidate) => [candidate.productNo, candidate]));
  const consistent = items?.every((item) => {
    const candidate = byProductNo.get(item.productNo);
    return !candidate || sameDevice(item, candidate);
  });
  // 有标识时清单每款都要带两组设置（跟随默认为 null）；没有标识时不认这几个字段。
  const pricedRight = pricing ? items?.every((item) => item.pricing) : true;
  const buyList: BuyList | "invalid" = isBuyListVersion(purchaseOptionsVersion) && nonBlank(writePermissionName)
    && (target || currentTrialProduct === null) && items && candidates && consistent && pricedRight
    ? { version: purchaseOptionsVersion, items: pricing ? items : items.map(({ pricing: _ignored, ...item }) => item), candidates: candidates.filter((candidate) => isBuyType(candidate.productType)) }
    : "invalid";

  return {
    buyList,
    pricing,
    trialTarget: target && nonBlank(target.productNo) ? target : "invalid" as const,
    writePermissionName: nonBlank(writePermissionName) ? writePermissionName : undefined,
  };
}

export function readH2SessionProducts(value: unknown) {
  const raw = object(value) ?? {};
  const { state, trialProductNo, trialProductName, purchasedProductNo, purchasedProductName, canConvert } = raw;
  if ([trialProductNo, trialProductName, purchasedProductNo, purchasedProductName].some((field) => field != null && !nonBlank(field))
    || (canConvert !== undefined && canConvert !== 0 && canConvert !== 1 && typeof canConvert !== "boolean")) return "invalid";
  const trial = [trialProductName, trialProductNo].find(nonBlank);
  const purchased = [purchasedProductName, purchasedProductNo].find(nonBlank);
  const convertible = canConvert === true || canConvert === 1;
  if (convertible && (purchased || state === "redeemed")) return "invalid";
  return {
    trialProductName: trial,
    purchasedProductName: purchased ?? (state === "redeemed" || canConvert === undefined
      ? undefined : convertible ? "尚未购买" : "没有购买"),
  };
}

export const H2_BUY_LIST_PATH = "/trials/purchase-options";
export const H2_BUY_LIST_OBJECT = "purchase-options";
export const H2_BUY_LIST_ACTION = "H2_TRIAL_PURCHASE_OPTIONS_CHANGED";

export type BuyListWrite = {
  productNos: string[];
  version: BuyListVersion;
  reason: string;
  requestNo: string;
  confirmedActorId: number;
};

export function isBuyListReceipt(value: unknown, input: BuyListWrite): value is { productNos: string[]; version: BuyListVersion } {
  const { version, productNos } = object(value) ?? {};
  return isBuyListVersion(version) && version === input.version + 1
    && Array.isArray(productNos) && productNos.length === input.productNos.length
    && input.productNos.every((no, index) => no === productNos[index]);
}
