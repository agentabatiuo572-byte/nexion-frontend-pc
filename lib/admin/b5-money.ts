/** Keep backlog DECIMAL lexemes before JSON.parse can round them through Number. */
export function parseB5MoneyJson(value: string): unknown {
  return JSON.parse(value.replace(/("(?:amountUsdt|totalAmountUsdt|walletShortfallUsdt|feeBufferShortfallUsdt)"\s*:\s*)(-?\d+(?:\.\d+)?)(?=\s*[,}])/g, '$1"$2"'));
}

export function readB5Amount(value: unknown, field: string, signed = false): string {
  if (typeof value !== "string" || !(signed ? /^-?\d+(?:\.\d+)?$/ : /^\d+(?:\.\d+)?$/).test(value)) throw new Error(`B5_RESPONSE_INVALID:${field}`);
  return value;
}

/** Match the existing column precision policy without converting money to Number. */
export function b5AmountDigits(values: readonly string[]): number {
  return Math.max(2, ...values.map(value => (value.split(".")[1] ?? "").replace(/0+$/, "").length));
}

export function b5AmountText(value: string, digits: number): string {
  const [whole, fraction = ""] = value.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.replace(/0+$/, "").padEnd(digits, "0")}`;
}
