import { f4Decimal } from "./f4-money";
import { amountDisplay } from "../format";

/** Keep backlog DECIMAL lexemes before JSON.parse can round them through Number. */
export function parseB5MoneyJson(value: string): unknown {
  return JSON.parse(value.replace(/("(?:ratioReserveUsdt|ratioLiabilitiesUsdt)"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g,
    (_match, key: string, amount: string) => `${key}${JSON.stringify(f4Decimal(amount) ?? amount)}`).replace(/("(?:amountUsdt|totalAmountUsdt|walletShortfallUsdt|feeBufferShortfallUsdt)"\s*:\s*)(-?\d+(?:\.\d+)?)(?=\s*[,}])/g, '$1"$2"'));
}

export function readB5Amount(value: unknown, field: string, signed = false): string {
  if (typeof value !== "string" || !(signed ? /^-?\d+(?:\.\d+)?$/ : /^\d+(?:\.\d+)?$/).test(value)) throw new Error(`B5_RESPONSE_INVALID:${field}`);
  return value;
}

/** Match the existing column precision policy without converting money to Number. */
export function b5AmountDigits(values: readonly string[]): number {
  return Math.max(2, ...values.map(value => (value.split(".")[1] ?? "").replace(/0+$/, "").length));
}

/** 金额按全站写法（amountDisplay），不为对齐补零；digits 是旧的整列对齐位数，不再使用。 */
export function b5AmountText(value: string, _digits?: number): string {
  return amountDisplay(value);
}
