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

/** A display group shares its real precision, with at least two fractional digits. */
export function e6AmountPrecision(values: readonly string[]) {
  return Math.max(2, ...values.map(value => (value.split(".")[1] ?? "").replace(/0+$/, "").length));
}
export function formatE6Amount(value: string, precision: number) {
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${fraction.replace(/0+$/, "").padEnd(precision, "0")}`;
}
