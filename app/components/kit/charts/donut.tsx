/**
 * Donut — 环形占比图(多段)+ 居中内容。纯 SVG,stroke-dasharray 分段,坐标四舍五入。
 * 用于总览应付负债 8 科目构成。
 */
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export function Donut({
  segments,
  size = 152,
  thickness = 14,
  children,
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  children?: React.ReactNode;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness) / 2 - 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let acc = 0;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={cx} cy={cy} r={r2(r)} fill="none" stroke="var(--v5-surface-3)" strokeWidth={thickness} />
        {segments.map((seg, i) => {
          const frac = seg.value / total;
          const dash = r2(circ * frac);
          const offset = r2(-acc * circ);
          acc += frac;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r2(r)}
              fill="none"
              stroke={seg.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${r2(circ - dash)}`}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}
