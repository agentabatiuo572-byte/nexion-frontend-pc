// B90-BE-01 / BE-08: provisional wire fields until the backend contract lands.
export type BuyListVersion = string | number;
type StoreStatus = "on" | "off" | "pending";

export type BuyDevice = {
  productNo: string;
  name: string;
  productType: "DEVICE" | "SERVER" | "SHARE";
  inventoryMode: "FINITE" | "UNLIMITED";
  priceUsdt: number | string;
  stock: number | string | null;
  status: StoreStatus;
  appState: "shown" | "hidden" | "soldOut";
  hiddenReason?: string;
};

export type BuyCandidate = BuyDevice & { selectable: boolean; unavailableReason?: string };
export type BuyList = { version: BuyListVersion; items: BuyDevice[]; candidates: BuyCandidate[] };

export type TrialTarget = {
  productNo: string;
  name: string;
  status: StoreStatus;
  stock: number | string;
  appVisible: boolean;
  hiddenReason?: string;
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function isBuyListVersion(value: unknown): value is BuyListVersion {
  return nonBlank(value) || typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function decimal(value: unknown): value is number | string {
  return (typeof value === "number" || typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value))
    && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function stockCount(value: unknown): value is number | string {
  return decimal(value) && Number.isSafeInteger(Number(value));
}

function isStoreStatus(value: unknown): value is StoreStatus {
  return value === "on" || value === "off" || value === "pending";
}

function readDevice(raw: unknown): BuyDevice | undefined {
  const row = object(raw);
  if (!row) return;
  const { productNo, name, productType, inventoryMode, priceUsdt, stock, status, appVisible, hiddenReason } = row;
  if (!nonBlank(productNo) || !nonBlank(name) || !isStoreStatus(status)
    || (productType !== "DEVICE" && productType !== "SERVER" && productType !== "SHARE")
    || (inventoryMode !== "FINITE" && inventoryMode !== "UNLIMITED") || !decimal(priceUsdt)
    || (productType === "SHARE" ? inventoryMode !== "UNLIMITED" : inventoryMode !== "FINITE")
    || !(stockCount(stock) || inventoryMode === "UNLIMITED" && stock === null)
    || (hiddenReason != null && typeof hiddenReason !== "string")
    || typeof appVisible !== "boolean" || (appVisible ? status !== "on" : !nonBlank(hiddenReason))) return;
  return {
    productNo, name, productType, inventoryMode, priceUsdt, stock, status,
    appState: !appVisible ? "hidden" : inventoryMode === "FINITE" && Number(stock) === 0 ? "soldOut" : "shown",
    hiddenReason: nonBlank(hiddenReason) ? hiddenReason : undefined,
  };
}

function readCandidate(raw: unknown): BuyCandidate | undefined {
  const row = object(raw);
  const device = readDevice(row);
  if (!device || !row || typeof row.selectable !== "boolean") return;
  const { selectable, unavailableReason } = row;
  if (!selectable && !nonBlank(unavailableReason)) return;
  if (selectable && (device.appState === "hidden" || Number(device.priceUsdt) <= 0)) return;
  return { ...device, selectable, unavailableReason: nonBlank(unavailableReason) ? unavailableReason : undefined };
}

function readRows<T extends BuyDevice>(raw: unknown, parse: (row: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(raw)) return;
  const rows: T[] = [];
  const ids = new Set<string>();
  for (const value of raw) {
    const row = parse(value);
    if (!row || ids.has(row.productNo)) return;
    ids.add(row.productNo);
    rows.push(row);
  }
  return rows;
}

function sameDevice(left: BuyDevice, right: BuyDevice) {
  return left.name === right.name && left.productType === right.productType
    && left.inventoryMode === right.inventoryMode && left.status === right.status
    && Number(left.priceUsdt) === Number(right.priceUsdt)
    && (left.stock === null || right.stock === null ? left.stock === right.stock : Number(left.stock) === Number(right.stock))
    && left.appState === right.appState && left.hiddenReason === right.hiddenReason;
}

function readTrialTarget(raw: unknown): TrialTarget | "invalid" {
  const target = object(raw);
  if (!target) return "invalid";
  const { productNo, name, status, stock, appVisible, hiddenReason } = target;
  if (!nonBlank(productNo) || !nonBlank(name) || !isStoreStatus(status) || !stockCount(stock)) return "invalid";
  if (typeof appVisible !== "boolean" || (hiddenReason != null && typeof hiddenReason !== "string")
    || (appVisible ? status !== "on" : !nonBlank(hiddenReason))) return "invalid";
  return { productNo, name, status, stock, appVisible, hiddenReason: nonBlank(hiddenReason) ? hiddenReason : undefined };
}

export function readH2TrialPurchase(raw: Record<string, unknown>) {
  const extra = raw.extraPurchase;
  const list = object(extra);
  const items = readRows(list?.items, readDevice);
  const candidates = readRows(list?.candidates, readCandidate);
  const byProductNo = new Map(candidates?.map((candidate) => [candidate.productNo, candidate]));
  const consistent = items?.every((item) => {
    const candidate = byProductNo.get(item.productNo);
    return !candidate || sameDevice(item, candidate);
  });
  const buyList: BuyList | "invalid" | undefined = extra === undefined ? undefined
    : isBuyListVersion(list?.version) && items && candidates && consistent ? { version: list.version, items, candidates }
    : "invalid";

  return {
    buyList,
    trialTarget: buyList === undefined ? undefined : readTrialTarget(raw.trialTargetProduct),
    writePermissionName: nonBlank(raw.writePermissionName) ? raw.writePermissionName : undefined,
  };
}

export function readH2SessionProducts(value: unknown) {
  const raw = object(value) ?? {};
  const { state, trialProductName, purchasedProductName, convertible } = raw;
  if ((trialProductName !== undefined && trialProductName !== null && !nonBlank(trialProductName))
    || (purchasedProductName !== undefined && purchasedProductName !== null && !nonBlank(purchasedProductName))
    || (convertible !== undefined && typeof convertible !== "boolean")
    || (state === "redeemed" && purchasedProductName === null)
    || (convertible === true && (state === "redeemed" || nonBlank(purchasedProductName)))) return "invalid";
  return {
    trialProductName: nonBlank(trialProductName) ? trialProductName : undefined,
    purchasedProductName: purchasedProductName === null
      ? (typeof convertible === "boolean" ? (convertible ? "尚未购买" : "没有购买") : undefined)
      : purchasedProductName,
  };
}

export const H2_BUY_LIST_PATH = "/trials/purchase-options";
export const H2_BUY_LIST_OBJECT = "buyList";

export type BuyListWrite = {
  productNos: string[];
  expectedVersion: BuyListVersion;
  reason: string;
  operator: string;
  confirmedByAdminId: number;
};
