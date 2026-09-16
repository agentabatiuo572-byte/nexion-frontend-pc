import { parseStrictFiniteNumber } from "./strict-number.ts";

export interface BankCapabilitySummary {
  status: "ready" | "unavailable";
  provider: string | null;
  country: "VN";
  currency: "VND";
  recipientIdentifier: "bank_account";
  accountVerificationAvailable: boolean;
  ownershipVerificationAvailable: boolean;
  reasonCode: string | null;
  capabilityVersion: string | null;
  checkedAt: string | null;
}
export interface BankVerificationEvidence {
  verificationStatus: "pending" | "verified" | "rejected" | "unavailable";
  payoutCapability: "supported" | "unsupported" | "unknown";
  ownershipStatus: "matched" | "mismatched" | "unknown";
  accountType: "payment_account" | "credit_card" | "prepaid" | "unknown";
  reasonCode: string | null;
  checkedAt: string | null;
  expiresAt: string | null;
  evidenceRef: string | null;
  capabilityVersion: string | null;
  canWithdraw: boolean;
}
export interface BankSettlementEvidence {
  status: "unconfirmed" | "paid" | "refunded" | "review_required";
  evidenceRef: string | null;
  providerOrderId: string | null;
  providerStatus: number | null;
  checkedAt: string | null;
  amountUsdt: number | null;
}

function invalid(): never { throw new Error("BANK_PAYOUT_EVIDENCE_INVALID"); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function option<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) invalid();
  return value as T;
}
function nullableText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) invalid();
  return value;
}
function date(value: unknown): string | null {
  const text = nullableText(value);
  if (text === null) return null;
  const parts = /^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(\.\d{1,9})?(Z|[+-]\d\d:\d\d)?$/.exec(text);
  if (!parts) invalid();
  const calendarDay = new Date(`${parts[1]}T00:00:00Z`);
  if (!Number.isFinite(calendarDay.getTime()) || calendarDay.toISOString().slice(0, 10) !== parts[1]) invalid();
  // DateTimeFormatConfig serializes unzoned LocalDateTime in Asia/Shanghai (+08:00).
  const normalized = `${parts[1]}T${parts[2]}${parts[3] ?? ""}${parts[4] ?? "+08:00"}`;
  if (!Number.isFinite(Date.parse(normalized)) || Number(parts[2].slice(0, 2)) > 23) invalid();
  return normalized;
}
function bool(value: unknown): boolean { if (typeof value !== "boolean") invalid(); return value; }

// Bad auxiliary evidence must block new payouts without hiding existing-order recovery or channel closure.
export function readBankEvidence<T>(parser: (value: unknown) => T | null, value: unknown): T | null {
  try { return parser(value); } catch (error) {
    if (error instanceof Error && error.message === "BANK_PAYOUT_EVIDENCE_INVALID") return null;
    throw error;
  }
}

// Older servers can omit evidence; omission keeps reads/recovery available but never authorizes a new payout.
export function parseBankCapability(value: unknown): BankCapabilitySummary | null {
  if (value == null) return null;
  const r = object(value);
  const result: BankCapabilitySummary = {
    status: option(r.status, ["ready", "unavailable"]), provider: nullableText(r.provider),
    country: option(r.country, ["VN"]), currency: option(r.currency, ["VND"]),
    recipientIdentifier: option(r.recipientIdentifier, ["bank_account"]),
    accountVerificationAvailable: bool(r.accountVerificationAvailable), ownershipVerificationAvailable: bool(r.ownershipVerificationAvailable),
    reasonCode: nullableText(r.reasonCode), capabilityVersion: nullableText(r.capabilityVersion), checkedAt: date(r.checkedAt),
  };
  if (result.status === "ready" && (!result.provider || !result.capabilityVersion || !result.checkedAt
      || !result.accountVerificationAvailable || !result.ownershipVerificationAvailable)) invalid();
  return result;
}
export function parseBankVerification(value: unknown): BankVerificationEvidence | null {
  if (value == null) return null;
  const r = object(value);
  const result: BankVerificationEvidence = {
    verificationStatus: option(r.verificationStatus, ["pending", "verified", "rejected", "unavailable"]),
    payoutCapability: option(r.payoutCapability, ["supported", "unsupported", "unknown"]),
    ownershipStatus: option(r.ownershipStatus, ["matched", "mismatched", "unknown"]),
    accountType: option(r.accountType, ["payment_account", "credit_card", "prepaid", "unknown"]),
    reasonCode: nullableText(r.reasonCode), checkedAt: date(r.checkedAt), expiresAt: date(r.expiresAt),
    evidenceRef: nullableText(r.evidenceRef), capabilityVersion: nullableText(r.capabilityVersion), canWithdraw: bool(r.canWithdraw),
  };
  if (result.canWithdraw && (result.verificationStatus !== "verified" || result.payoutCapability !== "supported"
      || result.ownershipStatus !== "matched" || result.accountType !== "payment_account"
      || !result.evidenceRef || !result.capabilityVersion || !result.checkedAt || !result.expiresAt)) invalid();
  return result;
}
export function parseBankSettlement(value: unknown): BankSettlementEvidence | null {
  if (value == null) return null;
  const r = object(value);
  const amount = r.amountUsdt === null ? null : parseStrictFiniteNumber(r.amountUsdt);
  if (r.amountUsdt !== null && (amount === null || amount <= 0 || amount > Number.MAX_SAFE_INTEGER / 1e6
      || Number(amount.toFixed(6)) !== amount || (typeof r.amountUsdt === "string" && !/^\d+(?:\.\d{1,6})?$/.test(r.amountUsdt.trim())))) invalid();
  if (r.providerStatus !== null && (typeof r.providerStatus !== "number" || !Number.isInteger(r.providerStatus))) invalid();
  const result: BankSettlementEvidence = {
    status: option(r.status, ["unconfirmed", "paid", "refunded", "review_required"]), evidenceRef: nullableText(r.evidenceRef),
    providerOrderId: nullableText(r.providerOrderId), providerStatus: r.providerStatus as number | null,
    checkedAt: date(r.checkedAt), amountUsdt: amount,
  };
  if (["paid", "refunded"].includes(result.status) && (!result.evidenceRef || !result.checkedAt || !result.amountUsdt)) invalid();
  if (result.status === "paid" && (!result.providerOrderId || result.providerStatus !== 3)) invalid();
  return result;
}
export const bankEvidenceLabels = {
  pending: "待核验", verified: "已核验", rejected: "核验未通过", unavailable: "暂无法核验",
  supported: "支持提现", unsupported: "不支持提现", unknown: "尚未确认",
  matched: "本人账户已核实", mismatched: "账户归属不符", payment_account: "银行支付账户",
  credit_card: "信用卡", prepaid: "预付卡", unconfirmed: "尚无结算证据", paid: "已到账",
  refunded: "已退回余额", review_required: "结果待核实",
} as const;
export function bankEvidenceTime(value: string | null): string {
  if (!value) return "尚无记录";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "medium" })
    .format(new Date(date(value)!)) + "（越南时间）";
}
