export type KpiTrendPoint = number | null;

export function kpiTrendPath(
  series: readonly KpiTrendPoint[],
  x: (index: number) => number,
  y: (value: number) => number,
): string {
  return series.map((value, index) => value === null ? ""
    : `${series[index - 1] == null ? "M" : "L"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
}
