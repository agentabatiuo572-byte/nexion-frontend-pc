/**
 * AreaChart — 迷你面积趋势图(填充 + 折线 + 可选参照线)。
 * 纯 SVG,响应式宽度(viewBox + preserveAspectRatio none),坐标四舍五入防水合。
 * 用于总览覆盖率趋势(refLine=红线)。
 */
const r2 = (n: number) => Math.round(n * 100) / 100;

export function AreaChart({
  data,
  color,
  height = 60,
  refLine,
}: {
  data: number[];
  color: string;
  height?: number;
  refLine?: { value: number; color: string };
}) {
  if (data.length < 2) return null;
  const w = 240;
  const pad = 5;
  const vals = refLine ? [...data, refLine.value] : data;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => r2(pad + (i / (data.length - 1)) * (w - 2 * pad));
  const y = (v: number) => r2(pad + (1 - (v - min) / span) * (height - 2 * pad));
  const line = data.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const area = `${x(0)},${r2(height - pad)} ${line} ${x(data.length - 1)},${r2(height - pad)}`;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden>
      <polygon points={area} fill={color} opacity={0.14} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {refLine && (
        <line
          x1={pad}
          y1={y(refLine.value)}
          x2={w - pad}
          y2={y(refLine.value)}
          stroke={refLine.color}
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      )}
    </svg>
  );
}
