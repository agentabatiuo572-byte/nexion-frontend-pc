type VoucherMoney = {
  type?: string;
  amountUSD?: number | string | null;
  minPurchaseUSD?: number | string | null;
  maxDiscountUSD?: number | string | null;
};

/** Check the original form text before Number can discard meaningful decimal digits. */
export function validateH7VoucherMoneyPrecision(voucher: VoucherMoney) {
  for (const key of ["amountUSD", "minPurchaseUSD", "maxDiscountUSD"] as const) {
    if (key === "amountUSD" && voucher.type !== "fixed") continue;
    const value = voucher[key];
    if (value == null) continue;
    const match = /^[+-]?(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i.exec(String(value).trim());
    if (!match) continue;
    const digits = match[1].replace(".", "");
    if (/^0+$/.test(digits)) continue;
    const trailingZeros = digits.length - digits.replace(/0+$/, "").length;
    const scale = (match[1].split(".")[1]?.length ?? 0) - Number(match[2] ?? 0) - trailingZeros;
    if (scale > 6) {
      throw new Error("H7_VOUCHER_AMOUNT_PRECISION_INVALID");
    }
  }
}
