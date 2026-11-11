import { TREASURY_VALUATION_UNAVAILABLE } from "./treasury-valuation";

/** 去掉接口金额补的末尾零，同一组/列按实际最多位数对齐，至少两位。 */
export const amountDigits = (values: readonly (number | null)[]) => Math.max(2, ...values.map((value) => {
  const [base, exponent = "0"] = String(value ?? 0).split("e");
  return Math.max(0, (base.split(".")[1]?.length ?? 0) - Number(exponent));
}));
export const amountText = (value: number | null, digits = amountDigits([value])) => value === null ? TREASURY_VALUATION_UNAVAILABLE : value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
