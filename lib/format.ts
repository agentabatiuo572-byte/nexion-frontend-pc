/** 格式化工具 — 确定性,无 locale 依赖(SSR/client 一致,避免 hydration 抖动)。 */

function groupThousands(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** $5,640,000 */
export function fmtUsd(n: number, digits = 0): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  const fixed = abs.toFixed(digits);
  const [int, dec] = fixed.split(".");
  const s = groupThousands(int) + (dec ? "." + dec : "");
  return `${neg ? "-" : ""}$${s}`;
}

/** $5.64M / $86.4K — 紧凑 */
export function fmtUsdCompact(n: number): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  let out: string;
  if (abs >= 1_000_000) out = `$${(abs / 1_000_000).toFixed(2)}M`;
  else if (abs >= 1_000) out = `$${(abs / 1_000).toFixed(1)}K`;
  else out = `$${abs.toFixed(0)}`;
  return (neg ? "-" : "") + out;
}

/** 1,234 */
export function fmtNum(n: number): string {
  return groupThousands(Math.round(n).toString());
}

/** 89.6% */
export function fmtPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}
