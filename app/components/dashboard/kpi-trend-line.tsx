import { kpiTrendPath, type KpiTrendPoint } from "@/lib/admin/kpi-trend";

export function KpiTrendLine({ series, color, width, height, className, responsive }: {
  series: readonly KpiTrendPoint[];
  color: string;
  width: number;
  height: number;
  className?: string;
  responsive?: boolean;
}) {
  const values = series.filter(value => value !== null);
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const x = (index: number) => 2 + (index / Math.max(1, series.length - 1)) * (width - 4);
  const y = (value: number) => height - 3 - ((value - min) / span) * (height - 6);
  return (
    <svg className={className} width={responsive ? "100%" : width} height={height}
      viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      <path d={kpiTrendPath(series, x, y)} fill="none" stroke={color} strokeWidth={1.5} />
      {series.map((value, index) => value !== null && series[index - 1] == null && series[index + 1] == null
        ? <circle key={index} cx={x(index)} cy={y(value)} r={1.6} fill={color} /> : null)}
    </svg>
  );
}
