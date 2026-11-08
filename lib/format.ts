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

/** 完整金额，不带币种：1,234.56（TX-20）。 */
export function fmtAmount(n: number): string {
  const neg = n < 0;
  const [int, dec] = Math.abs(n).toFixed(2).split(".");
  return `${neg ? "-" : ""}${groupThousands(int)}.${dec}`;
}

/** 概览金额，不带币种：0 / 小于 0.01 / 864.50 / 86.4K / 1.23M（TX-21）。 */
export function fmtAmountCompact(n: number): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  if (abs < 0.01) return "小于 0.01";
  const out = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(2)}M` : abs >= 1_000 ? `${(abs / 1_000).toFixed(1)}K` : abs.toFixed(2);
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

/** 配置值（红线、健康线这类阈值）按原值写，不补零也不取整（TX-23）：100 → 100%，100.5 → 100.5%。比例先乘 100。 */
export function fmtConfigPct(n: number): string {
  return `${Number(n.toFixed(6))}%`;
}
