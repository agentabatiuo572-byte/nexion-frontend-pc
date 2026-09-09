export interface E5DeviceDailyRate {
  dailyUsdt: number | null;
  dailyNex: number | null;
}

function nonNegativeFinite(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

// `daily_*` is the per-device settlement snapshot from E5, unlike the SKU's
// optional catalog `base_rate` display copy.
export function parseE5DeviceDailyRate(dailyUsdt: unknown, dailyNex: unknown): E5DeviceDailyRate {
  return {
    dailyUsdt: nonNegativeFinite(dailyUsdt),
    dailyNex: nonNegativeFinite(dailyNex),
  };
}
