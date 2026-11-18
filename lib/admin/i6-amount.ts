export const I6_COURSE_REWARD_DECIMALS = 6;

/** Decimal strings stay exact through the course form, confirmation and request. */
export function i6Amount(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const match = /^\+?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(String(value).trim());
  if (!match || !`${match[1]}${match[2] ?? ""}` || !Number.isFinite(Number(value))) return undefined;
  const digits = match[1] + (match[2] ?? ""), point = match[1].length + Number(match[3] ?? 0);
  const plain = point <= 0 ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length ? digits + "0".repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return plain.replace(/^0+(?=\d)/, "");
}

/** Both values are plain nonnegative decimals from the course request and receipt parsers. */
export function i6CourseRewardMatches(saved: unknown, submitted: unknown): boolean {
  if (saved == null || submitted == null) return false;
  const [actualWhole, actualFraction = ""] = String(saved).split(".");
  const [expectedWhole, expectedFraction = ""] = String(submitted).split(".");
  const places = I6_COURSE_REWARD_DECIMALS;
  const scaled = (whole: string, fraction: string) => BigInt(whole + fraction.slice(0, places).padEnd(places, "0"));
  // Older pending requests can still carry more than six decimals. Java rounds the submitted value HALF_UP.
  const roundUp = (expectedFraction[places] ?? "0") >= "5";
  return !/[1-9]/.test(actualFraction.slice(places))
    && scaled(actualWhole, actualFraction) === scaled(expectedWhole, expectedFraction) + BigInt(roundUp ? 1 : 0);
}

export function i6RewardChange(next: string, current: string | null) {
  // An authoritative null means no configured reward; only direction uses the zero baseline.
  const a = i6Amount(next), b = i6Amount(current === null ? "0" : current);
  if (!a || !b) return undefined;
  const scale = Math.max((a.split(".")[1] ?? "").length, (b.split(".")[1] ?? "").length);
  const scaled = (value: string) => { const [whole, fraction = ""] = value.split("."); return BigInt(whole + fraction.padEnd(scale, "0")); };
  const delta = scaled(a) - scaled(b), digits = (delta < 0 ? -delta : delta).toString().padStart(scale + 1, "0");
  return { direction: delta === BigInt(0) ? 0 : delta > BigInt(0) ? 1 : -1,
    amount: scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits };
}
