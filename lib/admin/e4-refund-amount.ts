import { compareE6Decimal } from "./e6-decimal";

/** Preserve the decimal lexeme before JSON.parse can round a USDT micro-unit. */
export function parseE4MoneyJson(text: string): unknown {
  return JSON.parse(text.replace(/("(?:amount|originalAmountUsdt|refundAmountUsdt)"\s*:\s*)(-?\d+(?:\.\d+)?)(?=\s*[,}])/g, '$1"$2"'));
}

export function readE4Money(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error("E4_ORDER_AMOUNT_CONTRACT_INVALID");
  return value;
}

/** Validate the operator's original text; commands retain it without Number or rounding. */
export function e4RefundAmountError(value: string, original: string | null): string | undefined {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value) || !/[1-9]/.test(value)) return "退款金额须大于 0 USDT，最多 6 位小数";
  if (original === null) return "订单本金未提供，不能申请退款";
  if (compareE6Decimal(value, original) > 0) return "退款金额不能超过订单本金（USDT）";
}
