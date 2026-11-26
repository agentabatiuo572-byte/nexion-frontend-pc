import { compareDecimal } from "./f1-rank-benefit";

export type F2BootstrapRow = { layer: string; usdtPct: string; nexPerUsd: string };

const ROW = /^L([1-7]): usdtPct=(\d+(?:\.\d+)?), nexPerUsd=(\d+(?:\.\d+)?)$/;

export function parseF2BootstrapAfter(after: string | undefined): F2BootstrapRow[] | undefined {
  const parts = (after ?? "").split(";").map((part) => part.trim());
  if (parts.length !== 7) return undefined;
  const rows: F2BootstrapRow[] = [];
  for (const [index, part] of parts.entries()) {
    const match = ROW.exec(part);
    if (!match || Number(match[1]) !== index + 1) return undefined;
    rows.push({ layer: `L${match[1]}`, usdtPct: match[2], nexPerUsd: match[3] });
  }
  return rows;
}

/** The retained PC request writes zero placeholders for L1/L2. Fixed-rate requests require L1=10. */
export function f2BootstrapUsesRank(first: string | null | undefined, second: string | null | undefined) {
  return !!first && !!second && compareDecimal(first, "0") === 0 && compareDecimal(second, "0") === 0;
}

/** 七层 USDT 比例相加（最多 4 位小数，按整数单位算）。 */
export function f2PctSum(values: readonly string[]) {
  const units = values.reduce((sum, value) => {
    const [whole, fraction = ""] = value.split(".");
    return sum + Number(whole) * 10000 + Number(fraction.padEnd(4, "0").slice(0, 4));
  }, 0);
  const fraction = String(units % 10000).padStart(4, "0").replace(/0+$/, "");
  return `${Math.floor(units / 10000)}${fraction ? `.${fraction}` : ""}`;
}
