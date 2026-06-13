/**
 * RingGauge — 环形仪表(进度环 + 区间标记 + 居中内容)。
 * 纯 SVG,坐标四舍五入防 SSR/client 浮点分歧。中心内容用 HTML 叠加(免 SVG 文字渲染差异)。
 * 用于总览兑付覆盖率(frac=值/上限,markers=红线/健康线刻度)。
 */
const r2 = (n: number) => Math.round(n * 100) / 100;

function pointOnRing(cx: number, cy: number, r: number, frac: number): [number, number] {
  const ang = (-90 + frac * 360) * (Math.PI / 180); // 从正上方顺时针
  return [r2(cx + r * Math.cos(ang)), r2(cy + r * Math.sin(ang))];
}

export function RingGauge({
  frac,
  color,
  markers = [],
  size = 152,
  stroke = 12,
  children,
}: {
  frac: number; // 0..1
  color: string;
  markers?: { frac: number; color: string }[];
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - stroke) / 2 - 2;
  const circ = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, frac));
  const dash = r2(circ * f);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={cx} cy={cy} r={r2(r)} fill="none" stroke="var(--v5-surface-3)" strokeWidth={stroke} />
        <circle
          cx={cx}
          cy={cy}
          r={r2(r)}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${r2(circ - dash)}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        {markers.map((m, i) => {
          const [mx, my] = pointOnRing(cx, cy, r, Math.max(0, Math.min(1, m.frac)));
          return <circle key={i} cx={mx} cy={my} r={3.5} fill={m.color} stroke="var(--v5-surface)" strokeWidth={1.5} />;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}
