import { amountDisplay } from "../format";

/** Keep the server's canonical decimal lexemes at the E6 response boundary. Drawing may use Number; display and commands use these strings. */
export function parseE6DecimalJson(text: string): unknown {
  return JSON.parse(text.replace(/("(?:baseRateUsdt|baseRateNex|dailyUsdt|dailyNex)"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"'));
}
/** Decimal18x6 values fit safely in BigInt after scaling, including the largest supported amount. */
export function compareE6Decimal(left: string, right: string) {
  const scaled = (value: string) => { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * BigInt(1000000) + BigInt(fraction.padEnd(6, "0")); };
  const a = scaled(left), b = scaled(right);
  return a === b ? 0 : a > b ? 1 : -1;
}

/** A display group's real precision (at least two). Old column alignment; amounts are no longer padded to it (PRD §5A). */
export function e6AmountPrecision(values: readonly string[]) {
  return Math.max(2, ...values.map(value => (value.split(".")[1] ?? "").replace(/0+$/, "").length));
}
/** 只读金额按全站写法（amountDisplay）：千分位、去掉末尾 0、整数不写小数点；precision 不再使用。比较和命令用原串，不经过这里。 */
export function formatE6Amount(value: string, _precision?: number) {
  return amountDisplay(value);
}
