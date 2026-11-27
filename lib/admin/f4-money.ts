import { compareDecimal } from "./f1-rank-benefit";

/** Preserve decimal lexemes across JSON and display; never round money via Number. */
export function f4Decimal(value: string | number): string | null {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(String(value).trim());
  if (!match || !(match[2] || match[3])) return null;
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent)) return null;
  const digits = match[2] + (match[3] ?? ""), point = match[2].length + exponent;
  const plain = point <= 0 ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length ? digits + "0".repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const [whole, fraction] = plain.split(".");
  return `${match[1] === "-" && /[1-9]/.test(digits) ? "-" : ""}${whole.replace(/^0+(?=\d)/, "")}${fraction ? `.${fraction}` : ""}`;
}

/** LeadershipPoolConfigGuard accepts ordinary percentage points, from 0 through 30. */
export function f4PoolRatio(value: string): string | null {
  const text = value.trim();
  if (!/^\d+(?:\.\d+)?%?$/.test(text)) return null;
  const amount = f4Decimal(text.replace(/%$/, ""));
  return amount !== null && compareDecimal(amount, "30") !== 1 ? amount : null;
}

export function f4PoolRatioIncreases(stored: string | undefined, value: string): boolean {
  const after = f4PoolRatio(value);
  return after !== null && compareDecimal(after, f4PoolRatio(stored ?? "") ?? "0") === 1;
}

export const F4_POOL_RATIO_INVALID = "请填 0–30 的普通百分数，例如 0.05 或 5%。";
export const F4_PAYOUT_POOL_UNCONFIGURED = "总榜奖池未配置，请先配置各榜奖池。";
export const F4_SETTLEMENT_CONSEQUENCE = "批准时算出有应发的金额才发钱";

export function f4MonthlyCap(raw: string): string | null {
  const text = raw.trim().toUpperCase().replace(/[$,]/g, "");
  const multiplier = text.endsWith("K") ? 3 : text.endsWith("M") ? 6 : 0;
  const decimal = f4Decimal(multiplier ? text.slice(0, -1).trim() : text);
  return decimal === null || decimal.startsWith("-") ? null : f4Decimal(`${decimal}e${multiplier}`);
}

/** 65ee53da: compare settlement capacity, including the weekly override's zero fallback. */
export function f4MoneyAmplifies(key: "F.pool.monthlyCap" | "F.leaderboard.poolUsd", config: Record<string, string>, value: string): boolean {
  const proposed = f4MonthlyCap(value);
  if (proposed === null) return false; // The existing write validator rejects this input.
  const stored = f4MonthlyCap(config[key] ?? "");
  let before = stored ?? "0", after = proposed;
  if (key === "F.leaderboard.poolUsd" && (stored === null || !/[1-9]/.test(stored) || !/[1-9]/.test(proposed))) {
    let fallback = "0";
    const raw = config["F.pool.periodPrize"] ?? "";
    try {
      const shape = JSON.parse(raw);
      if (typeof shape?.week === "number") {
        const exact = JSON.parse(raw.replace(/("week"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"'));
        fallback = f4Decimal(exact.week) ?? "0";
      }
    } catch { /* Settlement also uses zero when the stored period JSON cannot be read. */ }
    before = stored !== null && /[1-9]/.test(stored) ? stored : fallback;
    after = /[1-9]/.test(proposed) ? proposed : fallback;
  }
  const [beforeWhole, beforeFraction = ""] = before.split(".");
  const [afterWhole, afterFraction = ""] = after.split(".");
  const scale = Math.max(beforeFraction.length, afterFraction.length);
  return BigInt(afterWhole + afterFraction.padEnd(scale, "0"))
    > BigInt(beforeWhole + beforeFraction.padEnd(scale, "0"));
}

const F4_PRIZE_PERIODS = ["today", "week", "month", "allTime"] as const;
type PrizePeriod = (typeof F4_PRIZE_PERIODS)[number];

function f4PrizeValues(raw: string) {
  if (!raw.trim()) return {};
  try {
    const shape: unknown = JSON.parse(raw);
    if (!shape || typeof shape !== "object" || Array.isArray(shape)) return {};
    const exact = JSON.parse(raw.replace(/("(?:today|week|month|allTime)"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"'));
    const result: Partial<Record<PrizePeriod, string>> = {};
    for (const key of F4_PRIZE_PERIODS) {
      if (typeof (shape as Record<string, unknown>)[key] !== "number") continue;
      const value = exact[key];
      const amount = typeof value === "string" ? f4Decimal(value) : null;
      if (amount !== null && !amount.startsWith("-")) result[key] = amount;
    }
    return result;
  } catch { return {}; }
}

export function f4PeriodPrize(raw: string, period: PrizePeriod): string | undefined {
  return f4PrizeValues(raw)[period];
}

export function f4PeriodPrizes(raw: string): Record<string, string> | null {
  const values = f4PrizeValues(raw);
  return F4_PRIZE_PERIODS.every(key => values[key] !== undefined) ? values as Record<string, string> : null;
}
