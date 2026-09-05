/** Missing analytics are not numeric zero, especially for lower-is-better KPIs. */
export function finiteDashboardNumber(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
