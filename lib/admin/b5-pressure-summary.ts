export type PressureHistoryPoint = { label: string; ratio: number | null };

export type PressureSummary = {
  latestPct: number | null;
  previousComparablePct: number | null;
};

/**
 * Treat the final history window as "current" even when its denominator is zero.
 * Falling back to an older calculable point would silently mislabel stale data as current.
 */
export function summarizePressureHistory(
  history: PressureHistoryPoint[],
  currentSnapshotRatio: number | null,
): PressureSummary {
  const latestWindowRatio = history.at(-1)?.ratio;
  const latestRatio = latestWindowRatio === undefined ? currentSnapshotRatio : latestWindowRatio;
  const previousComparableRatio = history
    .slice(0, -1)
    .map((point) => point.ratio)
    .filter((ratio): ratio is number => ratio !== null)
    .at(-1) ?? null;

  return {
    latestPct: latestRatio === null ? null : latestRatio * 100,
    previousComparablePct: previousComparableRatio === null ? null : previousComparableRatio * 100,
  };
}
