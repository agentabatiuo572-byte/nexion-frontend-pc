import { parseStrictFiniteNumber } from "./strict-number.ts";

export const PAYOUT_VND_FIELDS = {
  sellSpreadPct: { label: "卖出点差", unit: "%", min: 0, max: 3, step: 0.01 },
  quoteTtlMinWithdraw: { label: "出金报价有效期", unit: "分钟", min: 1, max: 60, step: 1, integer: true },
  requoteTolerancePct: { label: "重报价偏差阈值", unit: "%", min: 0, max: 10, step: 0.1 },
  feeRatePct: { label: "提现费率", unit: "%", min: 0, max: 5, step: 0.1 },
  feeMinUsd: { label: "最低收费", unit: "USD", min: 0, max: 1000, step: 0.5 },
  feeMaxUsd: { label: "单笔封顶", unit: "USD", min: 0, max: 1000, step: 0.5 },
  minAmountUsd: { label: "单笔下限", unit: "USD", min: 0, max: 10000, step: 1 },
  maxAmountUsd: { label: "单笔上限", unit: "USD", min: 1, max: 100000, step: 1 },
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

export function derivePayoutVndRates(config: Pick<PayoutVndConfig, "baseRateVndPerUsdt" | "buySpreadPct" | "sellSpreadPct">) {
  return {
    buy: Math.round(config.baseRateVndPerUsdt * (1 + config.buySpreadPct / 100) / 10) * 10,
    sell: Math.round(config.baseRateVndPerUsdt * (1 - config.sellSpreadPct / 100) / 10) * 10,
  };
}
