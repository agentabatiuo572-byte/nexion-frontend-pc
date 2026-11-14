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

export function i6RewardChange(next: string, current: string | null) {
  const a = i6Amount(next), b = i6Amount(current);
  if (!a || !b) return undefined;
  const scale = Math.max((a.split(".")[1] ?? "").length, (b.split(".")[1] ?? "").length);
  const scaled = (value: string) => { const [whole, fraction = ""] = value.split("."); return BigInt(whole + fraction.padEnd(scale, "0")); };
  const delta = scaled(a) - scaled(b), digits = (delta < 0 ? -delta : delta).toString().padStart(scale + 1, "0");
  return { direction: delta === BigInt(0) ? 0 : delta > BigInt(0) ? 1 : -1,
    amount: scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits };
}
