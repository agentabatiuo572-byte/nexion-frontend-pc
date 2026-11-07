import { parseStrictFiniteNumber } from "./strict-number.ts";

/** 8 项的名字、单位和范围，和后端 PayoutVndConfigService.validOperationalValues 一致。金额单位是 USDT，接口键名里的 Usd 不改。 */
export const PAYOUT_VND_FIELDS = {
  sellSpreadPct: { label: "卖出点差", unit: "%", min: 0, max: 3, step: 0.01 },
  quoteTtlMinWithdraw: { label: "提现报价有效期", unit: "分钟", min: 1, max: 60, step: 1, integer: true },
  requoteTolerancePct: { label: "重报价偏差阈值", unit: "%", min: 0, max: 10, step: 0.1 },
  feeRatePct: { label: "提现费率", unit: "%", min: 0, max: 5, step: 0.1 },
  feeMinUsd: { label: "最低手续费", unit: "USDT", min: 0, max: 1000, step: 0.5 },
  feeMaxUsd: { label: "手续费封顶", unit: "USDT", min: 0, max: 1000, step: 0.5 },
  minAmountUsd: { label: "单笔最低金额", unit: "USDT", min: 0, max: 10000, step: 1 },
  maxAmountUsd: { label: "单笔最高金额", unit: "USDT", min: 1, max: 100000, step: 1 },
} as const;

export type PayoutVndWritableField = keyof typeof PAYOUT_VND_FIELDS;
export type PayoutVndValues = Record<PayoutVndWritableField, number>;

export type PayoutVndConfig = PayoutVndValues & {
  version: number;
  baseRateVndPerUsdt: number;
  buySpreadPct: number;
  channelEnabled: boolean;
  providerReady: boolean;
  providerStatusAvailable: boolean;
  sandboxAvailable: boolean;
  defaults: PayoutVndValues;
  effectiveAt: string;
  lastUpdatedBy: string;
  sources: {
    baseRateVndPerUsdt: "D6";
    buySpreadPct: "D6";
    d7: "platform-config";
  };
};

function invalid(field: string): never {
  throw new Error(`D7_RESPONSE_INVALID:${field}`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}

function number(value: unknown, field: string, min: number, max: number, integer = false): number {
  const parsed = parseStrictFiniteNumber(value);
  if (parsed === null || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) invalid(field);
  return parsed;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(field);
  return value.trim();
}

function isoInstant(value: unknown, field: string): string {
  const parsed = text(value, field);
  const date = new Date(parsed);
  if (!Number.isFinite(date.valueOf())) invalid(field);
  const canonical = date.toISOString().replace(".000Z", "Z");
  if (canonical !== parsed.replace(".000Z", "Z")) invalid(field);
  return parsed;
}

function values(value: unknown, field: string): PayoutVndValues {
  const source = record(value, field);
  const result = {} as PayoutVndValues;
  for (const [key, spec] of Object.entries(PAYOUT_VND_FIELDS) as Array<[PayoutVndWritableField, (typeof PAYOUT_VND_FIELDS)[PayoutVndWritableField]]>) {
    result[key] = number(source[key], `${field}.${key}`, spec.min, spec.max, "integer" in spec && spec.integer);
  }
  if ((result.feeMinUsd > 0 && result.feeMinUsd >= result.minAmountUsd)
      || result.feeMinUsd > result.feeMaxUsd
      || result.minAmountUsd > result.maxAmountUsd) invalid(`${field}.relationships`);
  return result;
}

export function normalizePayoutVndConfig(value: unknown): PayoutVndConfig {
  const source = record(value, "root");
  const operational = values(source, "root");
  const defaults = values(source.defaults, "defaults");
  const version = number(source.version, "version", 0, Number.MAX_SAFE_INTEGER, true);
  const baseRateVndPerUsdt = number(source.baseRateVndPerUsdt, "baseRateVndPerUsdt", 20000, 35000);
  const buySpreadPct = number(source.buySpreadPct, "buySpreadPct", 0, 3);
  const channelEnabled = boolean(source.channelEnabled, "channelEnabled");
  const providerReady = boolean(source.providerReady, "providerReady");
  const providerStatusAvailable = boolean(source.providerStatusAvailable, "providerStatusAvailable");
  const sandboxAvailable = boolean(source.sandboxAvailable, "sandboxAvailable");
  if (providerReady && !providerStatusAvailable) invalid("providerStatusAvailable");
  const rawSources = record(source.sources, "sources");
  if (rawSources.baseRateVndPerUsdt !== "D6" || rawSources.buySpreadPct !== "D6"
      || rawSources.d7 !== "platform-config") invalid("sources");
  return {
    ...operational,
    version,
    baseRateVndPerUsdt,
    buySpreadPct,
    channelEnabled,
    providerReady,
    providerStatusAvailable,
    sandboxAvailable,
    defaults,
    effectiveAt: isoInstant(source.effectiveAt, "effectiveAt"),
    lastUpdatedBy: text(source.lastUpdatedBy, "lastUpdatedBy"),
    sources: {
      baseRateVndPerUsdt: "D6",
      buySpreadPct: "D6",
      d7: "platform-config",
    },
  };
}

/** 十进制数按 10^scale 放大成整数，不经过浮点乘法。 */
function scaledDecimal(value: number): { units: bigint; scale: number } {
  const text = String(value).includes("e") ? value.toFixed(12) : String(value);
  const [whole, fraction = ""] = text.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return { units: BigInt(`${whole}${trimmed}`), scale: trimmed.length };
}

// 编译目标是 ES2017，不能写 BigInt 字面量，常数用 BigInt() 造。
const pow10 = (exponent: number) => BigInt(`1${"0".repeat(exponent)}`);
const TWO = BigInt(2);
const TEN = BigInt(10);
const HUNDRED = BigInt(100);
const BASIS = BigInt(10_000);
const MICRO = BigInt(1_000_000);
/** 正数 n / d 四舍五入（HALF_UP）。 */
const halfUp = (n: bigint, d: bigint) => (TWO * n + d) / (TWO * d);

/**
 * 价格都用百万分之一越南盾（micro）表示，全程整数运算。
 * 买入价同后端 VietnamPaymentPolicy.quoteRate：点差换成基点四舍五入，算到 8 位小数后取整到十位。
 * 卖出价同后端 BankWithdrawalPricing.calculate：基准价 ×（1 − 卖出点差），保留 6 位小数向下截断，不取整（闸门 2 第 10 条）。
 */
export function derivePayoutVndRates(config: Pick<PayoutVndConfig, "baseRateVndPerUsdt" | "buySpreadPct" | "sellSpreadPct">) {
  const base = scaledDecimal(config.baseRateVndPerUsdt);
  const buySpread = scaledDecimal(config.buySpreadPct);
  const sellSpread = scaledDecimal(config.sellSpreadPct);
  const basisPoints = halfUp(buySpread.units * HUNDRED, pow10(buySpread.scale));
  const raw8 = halfUp(base.units * (BASIS + basisPoints) * pow10(8), pow10(base.scale) * BASIS);
  const buy = halfUp(raw8, TEN * pow10(8)) * TEN * MICRO;
  const sell = (base.units * (HUNDRED * pow10(sellSpread.scale) - sellSpread.units) * MICRO)
    / (pow10(base.scale) * HUNDRED * pow10(sellSpread.scale));
  return { buy, sell, spread: buy - sell };
}

/** 后端 PayoutVndConfigService.isInverted 用未取整的价格：卖出价 ≥ 买入价，等于两个点差加起来不大于 0。 */
export function isPayoutVndInverted(buySpreadPct: number, sellSpreadPct: number) {
  return buySpreadPct + sellSpreadPct <= 0;
}

/** micro 越南盾写成「25,643.8」：千分位，小数按实际精度，不补零不舍入。 */
export function vndText(micro: bigint) {
  const negative = micro < BigInt(0);
  const abs = negative ? -micro : micro;
  const fraction = (abs % MICRO).toString().padStart(6, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${(abs / MICRO).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}
