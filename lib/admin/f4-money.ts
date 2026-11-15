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

/** top1/top5 use percentage points, matching OpsTeamService.parseDecimal. */
export function f4HeadCapAmplifies(current: string, value: string): boolean {
  const before = f4Decimal(current.replace(/[%,]/g, "")) ?? "0";
  const after = f4Decimal(value.replace(/[%,]/g, "")) ?? "0";
  const [beforeWhole, beforeFraction = ""] = before.split(".");
  const [afterWhole, afterFraction = ""] = after.split(".");
  const scale = Math.max(beforeFraction.length, afterFraction.length);
  return BigInt(afterWhole + afterFraction.padEnd(scale, "0"))
    > BigInt(beforeWhole + beforeFraction.padEnd(scale, "0"));
}

export function f4MonthlyCap(raw: string): string | null {
  const text = raw.trim().toUpperCase().replace(/[$,]/g, "");
  const multiplier = text.endsWith("K") ? 3 : text.endsWith("M") ? 6 : 0;
  const decimal = f4Decimal(multiplier ? text.slice(0, -1).trim() : text);
  return decimal === null || decimal.startsWith("-") ? null : f4Decimal(`${decimal}e${multiplier}`);
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
