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

/** Pool ratios are percentage points. Missing or invalid configuration cannot settle. */
export function f4PoolRatioIncreases(stored: string | undefined, value: string): boolean {
  const read = (text: string) => {
    const parsed = f4Decimal(text.trim().replace(/%$/, ""));
    return parsed !== null && Number(parsed) >= 0 && Number(parsed) <= 30 ? parsed : null;
  };
  const after = read(value);
  return after !== null && compareDecimal(after, read(stored ?? "") ?? "0") === 1;
}

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

export function f4PeriodPrizes(raw: string): Record<string, string> | null {
  if (!raw.trim()) return null;
  let parsed: unknown;
  try {
    const shape: unknown = JSON.parse(raw);
    if (!shape || typeof shape !== "object" || Array.isArray(shape)
      || !["today", "week", "month", "allTime"].every(key => typeof (shape as Record<string, unknown>)[key] === "number")) return null;
    parsed = JSON.parse(raw.replace(/("(?:today|week|month|allTime)"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"'));
  } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const result: Record<string, string> = {};
  for (const key of ["today", "week", "month", "allTime"]) {
    const value = (parsed as Record<string, unknown>)[key];
    const amount = typeof value === "string" ? f4Decimal(value) : null;
    if (amount === null || amount.startsWith("-")) return null;
    result[key] = amount;
  }
  return result;
}
