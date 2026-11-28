import { amountDisplay } from "../format";

/** Keep the server's canonical decimal lexemes at the E6 response boundary. Drawing may use Number; display and commands use these strings. */
export function parseE6DecimalJson(text: string): unknown {
  return JSON.parse(text.replace(/("(?:baseRateUsdt|baseRateNex|dailyUsdt|dailyNex)"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"'));
}
const microsPerUnit = BigInt(1_000_000);
function toMicros(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * microsPerUnit + BigInt(fraction.padEnd(6, "0"));
}

/** Decimal18x6 values fit safely in BigInt after scaling, including the largest supported amount. */
export function compareE6Decimal(left: string, right: string) {
  const a = toMicros(left), b = toMicros(right);
  return a === b ? 0 : a > b ? 1 : -1;
}

/** Round the positive per-task reward half up to six decimal places, as dispatch does. */
export function prorateE6DailyReward(daily: string, seconds: number) {
  const rounded = (toMicros(daily) * BigInt(seconds) + BigInt(43_200)) / BigInt(86_400);
  return `${rounded / microsPerUnit}.${String(rounded % microsPerUnit).padStart(6, "0")}`;
}

/** A display group's real precision (at least two). Old column alignment; amounts are no longer padded to it (PRD §5A). */
export function e6AmountPrecision(values: readonly string[]) {
  return Math.max(2, ...values.map(value => (value.split(".")[1] ?? "").replace(/0+$/, "").length));
}
/** 只读金额按全站写法（amountDisplay）：千分位、去掉末尾 0、整数不写小数点；precision 不再使用。比较和命令用原串，不经过这里。 */
export function formatE6Amount(value: string, _precision?: number) {
  return amountDisplay(value);
}
