import { TREASURY_VALUATION_UNAVAILABLE } from "./treasury-valuation";
import { amountDisplay } from "../format";

/** 同一组/列实际最多几位小数（至少两位）。旧的对齐位数，金额不再按它补零（PRD §5A），调用方还在传。 */
export const amountDigits = (values: readonly (number | null)[]) => Math.max(2, ...values.map((value) => {
  const [base, exponent = "0"] = String(value ?? 0).split("e");
  return Math.max(0, (base.split(".")[1]?.length ?? 0) - Number(exponent));
}));
/** 金额按全站写法（amountDisplay）：千分位、去掉末尾 0、整数不写小数点，不为对齐补零；第二个参数是旧的对齐位数，不再使用。 */
export const amountText = (value: number | null, _digits?: number) => value === null ? TREASURY_VALUATION_UNAVAILABLE : amountDisplay(value);
