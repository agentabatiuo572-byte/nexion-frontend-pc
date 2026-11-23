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

const AMOUNT_TEXT = /^([+-]?)(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * 金额显示（PRD §5A，用户 2026-11-23「整数就不显示小数点，后面实际有几位就显示几位」）：
 * 十进制原文进、显示文字出。整数部分千分位，去掉小数末尾的 0，小数全是 0 不写小数点，不为对齐补零；
 * 负号和显式正号照写，0 不带符号（-0.00 → 0）。认不出的原样返回。
 * 例：1234.500000 → 1,234.5，12480.00 → 12,480，-0.10 → -0.1，0.000123 → 0.000123，0.00 → 0。
 * 后端给的十进制字符串不舍入、不截断。JS 数字按这一处原来的写法：不传 maxFraction 时照数字本身的十进制写（原来按有效位数写的入口），
 * 传了就在这个上限内取整，取整方式照原来的（rounding "intl" 是 toLocaleString 的取整，"fixed" 是 toFixed 的取整），再去末尾 0，不写科学计数法。
 * 有上限时，非零的数在上限内会变成 0：正数写「小于 最小单位」，负数写「大于 -最小单位」（例：上限 8 →「小于 0.00000001」「大于 -0.00000001」，同 TX-20、TX-21）。
 * 只管显示，结果不进请求、比较和排序。
 */
export function amountDisplay(value: string | number | bigint, maxFraction?: number, rounding: "intl" | "fixed" = "intl"): string {
  if (typeof value === "number" && Number.isFinite(value) && maxFraction !== undefined) {
    const rounded = rounding === "fixed" ? value.toFixed(maxFraction) : value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: maxFraction });
    if (value !== 0 && /^[+-]?0(?:\.0*)?$/.test(rounded)) {
      const unit = maxFraction > 0 ? `0.${"0".repeat(maxFraction - 1)}1` : "1";
      return value < 0 ? `大于 -${unit}` : `小于 ${unit}`;
    }
    return decimalDisplay(rounded, value);
  }
  return decimalDisplay(typeof value === "number" ? String(value) : String(value).trim(), value);
}

function decimalDisplay(raw: string, value: string | number | bigint): string {
  const match = AMOUNT_TEXT.exec(raw);
  if (!match || (!match[2] && !match[3])) return String(value);
  const [, sign, grouped, fractionRaw = "", exponent] = match;
  let int = grouped.replace(/,/g, "") || "0";
  let fraction = fractionRaw;
  if (exponent) {
    const digits = int + fraction;
    const point = int.length + Number(exponent);
    if (point <= 0) [int, fraction] = ["0", "0".repeat(-point) + digits];
    else if (point >= digits.length) [int, fraction] = [digits + "0".repeat(point - digits.length), ""];
    else [int, fraction] = [digits.slice(0, point), digits.slice(point)];
  }
  int = int.replace(/^0+(?=\d)/, "");
  fraction = fraction.replace(/0+$/, "");
  const zero = /^0+$/.test(int) && !fraction;
  return `${zero ? "" : sign}${groupThousands(int)}${fraction ? `.${fraction}` : ""}`;
}

/** 完整金额，不带币种，按 amountDisplay 写：1,234.56、1,234.5、1,234。原来的上限两位小数和 toFixed 取整保留。 */
export function fmtAmount(n: number): string {
  return amountDisplay(n, 2, "fixed");
}

/** 概览金额，不带币种：0 / 小于 0.01 / 大于 -0.01 / 864.5 / 86.4K / 1.2M（TX-21 的紧凑写法，按 PRD §5A 去掉末尾 0）。 */
export function fmtAmountCompact(n: number): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  if (abs < 0.01) return neg ? "大于 -0.01" : "小于 0.01";
  const out = abs >= 1_000_000 ? `${amountDisplay(abs / 1_000_000, 2, "fixed")}M` : abs >= 1_000 ? `${amountDisplay(abs / 1_000, 1, "fixed")}K` : amountDisplay(abs, 2, "fixed");
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
