export const purchasePaymentMethods = ["HDPAY_BANK", "CREGIS_USDT_BSC"] as const;
export type PurchasePaymentMethod = typeof purchasePaymentMethods[number];
export const purchasePaymentStates = ["CREATING", "SUBMIT_UNKNOWN", "AWAITING_PAYMENT", "FUNDS_CONFIRMED", "DELIVERED", "MANUAL_REVIEW", "EXPIRED"] as const;
export type PurchasePaymentState = typeof purchasePaymentStates[number];
export type PurchasePaymentChannelInput = { paymentMethod: PurchasePaymentMethod; channelFeeRatePct: string; channelFeeFixed: string; networkConfirmFeeUsdt: string; minTopupPrincipal: string };
export type PurchasePaymentChannel = { paymentMethod: PurchasePaymentMethod; configured: boolean; channelFeeRatePct: string | null; channelFeeFixed: string | null; networkConfirmFeeUsdt: string | null; minTopupPrincipal: string };
export type PurchasePaymentConstraints = { ratePct: { min: string; max: string; scale: 2 }; feeUsdt: { min: string; max: string; scale: 2 }; minTopupPrincipal: { min: string; max: string; integer: true } };
export type PurchasePaymentPolicy = { version: number; channels: PurchasePaymentChannel[]; constraints?: PurchasePaymentConstraints };
export type PurchasePaymentArrival = { txid: string; log_index: number; amount: string; block_number: number; block_hash: string; confirmations: number; status: string };
export type PurchasePaymentRecord = {
  intentNo: string; userId: string; kind: string; paymentMethod: PurchasePaymentMethod; status: PurchasePaymentState;
  subtotalUsdt: string; channelFeeUsdt: string; networkConfirmFeeUsdt: string; totalUsdt: string;
  feePolicyVersion: number; version: number; reason: string | null; createdAt: string; updatedAt: string;
  providerReference?: string | null; providerActualFeeUsdt?: string | null; receipt?: Record<string, unknown> | null;
  businessAmountUsdt?: string; roundingAdjustmentUsdt?: string; amountVnd?: string | null; fxRateVndPerUsdt?: string | null;
  fulfilmentStatus?: "NOT_DELIVERED" | "DELIVERED"; arrivals?: PurchasePaymentArrival[];
};
export type PurchasePaymentPage = { items: PurchasePaymentRecord[]; total: number; pageNum: number; pageSize: number };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const optionalText = (value: unknown) => value === null || typeof value === "string";
export const purchasePaymentDecimal = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value);
export const purchaseTopupMinimum = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d*$/.test(value);
const exactAmount = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value);
export const purchaseWasDelivered = (record: PurchasePaymentRecord) => record.fulfilmentStatus === "DELIVERED" || record.status === "DELIVERED";
export function purchaseMoney(value: string) { const [whole, fraction = ""] = value.split("."); return `${whole}.${fraction.padEnd(2, "0")}`; }
const cents = (value: string) => { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0")); };
const within = (value: string, range: { min: string; max: string }) => cents(value) >= cents(range.min) && cents(value) <= cents(range.max);
export function validPurchaseChannel(row: PurchasePaymentChannel | PurchasePaymentChannelInput, constraints?: PurchasePaymentConstraints): row is PurchasePaymentChannelInput {
  if (!purchasePaymentMethods.includes(row.paymentMethod) || !purchasePaymentDecimal(row.channelFeeRatePct)
    || Number(row.channelFeeRatePct) > 100 || !purchasePaymentDecimal(row.channelFeeFixed)
    || !purchasePaymentDecimal(row.networkConfirmFeeUsdt) || !purchaseTopupMinimum(row.minTopupPrincipal)
    || row.paymentMethod === "HDPAY_BANK" && Number(row.networkConfirmFeeUsdt) !== 0) return false;
  return !constraints || within(row.channelFeeRatePct, constraints.ratePct) && within(row.channelFeeFixed, constraints.feeUsdt)
    && within(row.networkConfirmFeeUsdt, constraints.feeUsdt) && within(row.minTopupPrincipal, constraints.minTopupPrincipal);
}
export function parsePurchasePaymentPolicy(raw: unknown): PurchasePaymentPolicy {
  if (!object(raw) || !integer(raw.version) || !Array.isArray(raw.channels)) throw new Error("订单付款规则不完整，请重新读取，当前不能调整。");
  const channels = raw.channels;
  if (raw.constraints !== undefined) {
    const c = raw.constraints;
    if (!object(c) || !object(c.ratePct) || !object(c.feeUsdt) || !object(c.minTopupPrincipal)
      || ![c.ratePct, c.feeUsdt].every(range => purchasePaymentDecimal(range.min) && purchasePaymentDecimal(range.max) && range.scale === 2 && cents(range.min) <= cents(range.max))
      || !purchaseTopupMinimum(c.minTopupPrincipal.min) || !purchaseTopupMinimum(c.minTopupPrincipal.max) || c.minTopupPrincipal.integer !== true
      || cents(c.minTopupPrincipal.min) > cents(c.minTopupPrincipal.max)) throw new Error("订单付款约束不完整，请重新读取，当前不能调整。");
  }
  if (channels.length !== 2 || !purchasePaymentMethods.every(method => channels.filter(row => object(row) && row.paymentMethod === method).length === 1)
    || channels.some(row => !object(row) || typeof row.configured !== "boolean" || !purchaseTopupMinimum(row.minTopupPrincipal)
      || (row.configured ? !validPurchaseChannel(row as PurchasePaymentChannel, raw.constraints as PurchasePaymentConstraints | undefined)
        : row.channelFeeRatePct !== null || row.channelFeeFixed !== null || row.networkConfirmFeeUsdt !== null))) throw new Error("订单付款规则不完整，请重新读取，当前不能调整。");
  return raw as PurchasePaymentPolicy;
}
export function parsePurchasePaymentRecord(raw: unknown, intentNo?: string): PurchasePaymentRecord {
  if (!object(raw) || !text(raw.intentNo) || !/^[A-Za-z0-9_-]{1,100}$/.test(raw.intentNo) || intentNo !== undefined && raw.intentNo !== intentNo
    || !text(raw.userId) || !text(raw.kind) || !purchasePaymentMethods.includes(raw.paymentMethod as PurchasePaymentMethod)
    || !purchasePaymentStates.includes(raw.status as PurchasePaymentState) || !integer(raw.version) || !integer(raw.feePolicyVersion)
    || ![raw.subtotalUsdt, raw.channelFeeUsdt, raw.networkConfirmFeeUsdt, raw.totalUsdt].every(purchasePaymentDecimal)
    || !optionalText(raw.reason) || !text(raw.createdAt) || !text(raw.updatedAt)
    || raw.providerReference !== undefined && !optionalText(raw.providerReference)
    || raw.providerActualFeeUsdt !== undefined && raw.providerActualFeeUsdt !== null && !exactAmount(raw.providerActualFeeUsdt)
    || raw.businessAmountUsdt !== undefined && (typeof raw.businessAmountUsdt !== "string" || !/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(raw.businessAmountUsdt))
    || raw.roundingAdjustmentUsdt !== undefined && (typeof raw.roundingAdjustmentUsdt !== "string" || !/^-?(0|[1-9]\d*)(\.\d{1,6})?$/.test(raw.roundingAdjustmentUsdt))
    || raw.amountVnd !== undefined && raw.amountVnd !== null && !purchaseTopupMinimum(raw.amountVnd)
    || raw.fxRateVndPerUsdt !== undefined && raw.fxRateVndPerUsdt !== null && (!exactAmount(raw.fxRateVndPerUsdt) || Number(raw.fxRateVndPerUsdt) <= 0)
    || raw.receipt !== undefined && raw.receipt !== null && !object(raw.receipt)
    || raw.fulfilmentStatus !== undefined && !["NOT_DELIVERED", "DELIVERED"].includes(String(raw.fulfilmentStatus))
    || raw.arrivals !== undefined && (!Array.isArray(raw.arrivals) || raw.arrivals.some(row => !object(row) || !text(row.txid) || !integer(row.log_index)
      || !exactAmount(row.amount) || !integer(row.block_number) || !text(row.block_hash) || !integer(row.confirmations) || !text(row.status)))) throw new Error("订单付款记录不完整，请重新查询，当前不能处置。");
  return raw as PurchasePaymentRecord;
}
export function parsePurchasePaymentPage(raw: unknown): PurchasePaymentPage {
  if (!object(raw) || !Array.isArray(raw.items) || !integer(raw.total) || !integer(raw.pageNum) || raw.pageNum < 1
    || !integer(raw.pageSize) || raw.pageSize < 1 || raw.items.length > raw.pageSize || raw.items.length > raw.total) throw new Error("订单付款列表不完整，请重新查询。");
  return { items: raw.items.map(row => parsePurchasePaymentRecord(row)), total: raw.total, pageNum: raw.pageNum, pageSize: raw.pageSize };
}
