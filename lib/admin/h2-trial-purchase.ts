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
    || !(stockCount(stock) || inventoryMode === "UNLIMITED" && stock === null)
    || typeof appVisible !== "boolean" || (appVisible ? status !== "on" : !nonBlank(hiddenReason))) return;
  return {
    productNo, name, productType, inventoryMode, priceUsdt, stock,
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

export function readH2TrialPurchase(raw: Record<string, unknown>) {
  const extra = raw.extraPurchase;
  const list = object(extra);
  const items = readRows(list?.items, readDevice);
  const candidates = readRows(list?.candidates, readCandidate);
  const buyList: BuyList | "invalid" | undefined = extra === undefined ? undefined
    : isBuyListVersion(list?.version) && items && candidates ? { version: list.version, items, candidates }
    : "invalid";

  const target = object(raw.trialTargetProduct);
  const trialTarget: TrialTarget | undefined = target && nonBlank(target.productNo)
    && nonBlank(target.name) && isStoreStatus(target.status) && stockCount(target.stock)
    ? { productNo: target.productNo, name: target.name, status: target.status, stock: target.stock }
    : undefined;
  return { buyList, trialTarget };
}

export function readH2SessionProducts(value: unknown) {
  const raw = object(value) ?? {};
  return {
    trialProductName: nonBlank(raw.trialProductName) ? raw.trialProductName : undefined,
    purchasedProductName: raw.purchasedProductName === null || nonBlank(raw.purchasedProductName)
      ? raw.purchasedProductName : undefined,
  };
}

export const H2_BUY_LIST_PATH = "/trials/purchase-options";
export const H2_BUY_LIST_OBJECT = "buyList";

export type BuyListWrite = {
  productNos: string[];
  expectedVersion: BuyListVersion;
  reason: string;
  operator: string;
};
