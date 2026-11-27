import type { PurchaseGate } from "./platform-types";
import { amountDisplay } from "@/lib/format";

/** Keep every received decimal digit; grouping never rounds a catalogue amount. */
export function e1Number(value: number | string | null | undefined): string {
  if (value == null || value === "") return "—";
  const [coefficient, exp] = String(value).toLowerCase().split("e");
  const negative = coefficient.startsWith("-");
  const [whole, fraction = ""] = coefficient.replace(/^-/, "").split(".");
  const digits = whole + fraction;
  const point = whole.length + Number(exp ?? 0);
  const expanded = point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length ? digits.padEnd(point, "0") : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const [integer, decimal] = expanded.split(".");
  return `${negative ? "-" : ""}${integer.replace(/\B(?=(\d{3})+$)/g, ",")}${decimal === undefined ? "" : `.${decimal}`}`;
}

const E1_NUMERIC_REVIEW_FIELDS = new Set([
  "price", "computePoints", "storeSortOrder", "displaySoldBase", "monthlyTargetUsdt", "monthlyTargetBandPct", "stock",
  "dailyEarn", "dailyEarnNEX", "dailyEarnNex", "phoneDailyEarn", "phoneDailyEarnNEX", "phoneDailyEarnNex", "shareYieldMin", "shareYieldMax",
  "aiImageGenPerMin", "aiLlmTokensPerSec", "aiVideoMinPerHour", "aiFineTuneMins",
  "rating", "reviews", "generation", "tradeinDiscount", "derivedDaily",
]);

/** E1 and A2 compare numeric fields as decimals without rounding 64-bit input strings. */
export function e1NumericReviewValue(key: string, value: unknown): string | undefined {
  if (!E1_NUMERIC_REVIEW_FIELDS.has(key)) return;
  const text = typeof value === "number" && Number.isFinite(value) ? e1Number(value).replaceAll(",", "")
    : typeof value === "string" ? value.trim() : "";
  const parts = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!parts || !(parts[2] || parts[3])) return;
  const integer = parts[2].replace(/^0+/, "") || "0";
  const fraction = parts[3]?.replace(/0+$/, "");
  const sign = integer === "0" && !fraction ? "" : parts[1];
  return `${sign}${integer}${fraction ? `.${fraction}` : ""}`;
}

/** 空值、空串和缺键等价。只在数值字段里忽略数字的书写差异。 */
export function e1ReviewValue(key: string, value: unknown): unknown {
  if (value == null || value === "") return null;
  // A2 的展示值给售价加了币种后缀。
  const numeric = e1NumericReviewValue(key, key === "price" && typeof value === "string" ? value.replace(/ USD$/, "") : value);
  if (numeric !== undefined) return numeric;
  if (Array.isArray(value)) return value.map(item => e1ReviewValue(key, item));
  if (value && typeof value === "object") {
    const fields = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(fields).sort().map(field => [field, e1ReviewValue(field, fields[field])]));
  }
  return value;
}

/** 只读金额按全站写法（amountDisplay，PRD §5A）：去掉末尾 0、整数不写小数点、不补零。e1Decimal 的写法留给审批前后值和「有没有改动」的判断，不动。 */
export function e1Amount(value: number | string | null | undefined): string {
  const raw = e1Number(value);
  return raw === "—" ? raw : amountDisplay(raw);
}

/** Display precision follows the real digits in one amount/configuration group. */
export function e1Precision(values: readonly (number | string | null | undefined)[], minimum = 2): number {
  return Math.max(minimum, ...values.map(value => (e1Number(value).split(".")[1] ?? "").replace(/0+$/, "").length));
}

export function e1Decimal(value: number | string | null | undefined, precision = e1Precision([value])): string {
  const raw = e1Number(value);
  if (raw === "—") return raw;
  const [integer, fraction = ""] = raw.split(".");
  const decimal = fraction.replace(/0+$/, "").padEnd(precision, "0");
  return decimal ? `${integer}.${decimal}` : integer;
}
const E1_VALUE_NAMES: Record<string, string> = { on: "在售", off: "已下架", pending: "草稿", active: "现行", legacy: "已停产", FINITE: "有限库存", UNLIMITED: "不限（非实物）", Entry: "入门档", Pro: "专业档", Flagship: "旗舰档", Share: "共享份额" };
/** shown：只用于页面显示的前后值，金额按 e1Amount 写；不传时和提交审批的原文一样。 */
export function e1Value(value: unknown, unit?: string, shown = false): string {
  const text = value == null || value === "" ? "未设置" : typeof value === "boolean" ? value ? "开" : "关"
    : typeof value === "number" ? unit && unit !== "%" ? shown ? e1Amount(value) : e1Decimal(value) : e1Number(value) : Array.isArray(value) ? value.join("、") || "未配置"
    : typeof value === "object" ? JSON.stringify(value, null, 2) : E1_VALUE_NAMES[String(value)] ?? String(value);
  return `${text}${unit && value != null && value !== "" ? ` ${unit}` : ""}`;
}
/** 购买条件写成一句人话（只用于显示；提交给审批的前后值仍是 e1SkuDiff 的原文）。后端字段同 DevicePurchaseGateView。 */
export function e1GateText(gate: Partial<Record<keyof PurchaseGate, unknown>> | null | undefined): string {
  if (!gate) return "无购买条件，不限量";
  const count = (value: unknown) => value == null || value === "" ? 0 : Number(value);
  const shown = (value: unknown) => e1Number(value as number | string);
  const rules = [
    count(gate.rankMin) > 0 && `会员 V${shown(gate.rankMin)} 及以上`,
    count(gate.activeDirectMin) > 0 && `活跃直接邀请至少 ${shown(gate.activeDirectMin)} 人`,
    count(gate.teamComputePointsMin) > 0 && `团队算力点至少 ${shown(gate.teamComputePointsMin)}`,
  ].filter((rule): rule is string => !!rule);
  const who = !rules.length ? "无用户条件" : rules.length === 1 ? rules[0] : `${rules.join("、")}（${String(gate.mode).toLowerCase() === "either" ? "满足任一" : "全部满足"}）`;
  const hasQuota = gate.quotaCap != null && gate.quotaCap !== "";
  if (gate.quotaPeriod === "month") {
    const legacyQuota = hasQuota ? `原配额 ${shown(gate.quotaCap)} 件、已售 ${shown(gate.quotaSold ?? 0)} 件；` : "";
    return `按月统计（已停用），现在不能购买；${legacyQuota}原用户条件：${who}`;
  }
  const quota = hasQuota ? `销售配额 ${shown(gate.quotaCap)} 件（累计）、已售 ${shown(gate.quotaSold ?? 0)} 件` : "不限量";
  if (gate.enforce === false) {
    const filled = [rules.length ? who : "", hasQuota ? quota : ""].filter(Boolean);
    return `不生效，不检查用户条件和配额${filled.length ? `；已填：${filled.join("；")}` : ""}`;
  }
  return `${who}；${quota}${hasQuota ? "，卖完后不能再买" : ""}`;
}
