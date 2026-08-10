const DECIMAL = /^-?(?:\d+|\d*\.\d+)$/;

/**
 * Parse only JSON numbers or explicit, non-empty decimal strings.
 * Returning null means the upstream value is not a number; unlike Number(),
 * this never turns null, booleans, empty strings or arrays into plausible data.
 */
export function parseStrictFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || !DECIMAL.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
