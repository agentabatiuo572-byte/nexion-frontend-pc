import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

export type B2MaturityWindow = "7d" | "30d";
export type B2ForecastWindow = "7d" | "30d" | "90d";

export interface B2WaterLevel {
  tier: "NORMAL" | "WATCH" | "WARNING" | "DANGER";
  color: string;
  reserveCoverDays: number;
  dailyAverageDueUsdt: number;
  suggestedAction: string;
  notification: string;
}

export interface B2Reserve {
  reserveTotalUsdt: number;
  usdtReserveUsdt: number;
  otherLiquidUsdt: number;
  lockedStakingPrincipalDeductedUsdt: number;
  asOf: string;
  sources: string[];
  waterLevel: B2WaterLevel;
}

export interface B2Liability {
  category: string;
  label: string;
  amountUsdt: number;
  share: number;
  source: string;
}

export interface B2Liabilities {
  totalUsdt: number;
  hardLiabilityCategoryCount: number;
  trialShadowIncluded: boolean;
  asOf: string;
  breakdown: B2Liability[];
  sources: string[];
}

export interface B2MaturityDay {
  date: string;
  withdrawDueUsdt: number;
  interestDueUsdt: number;
  genesisDividendUsdt: number;
  trialShadowStressUsdt: number;
  totalDueUsdt: number;
}

export interface B2Maturity {
  window: B2MaturityWindow;
  daily: B2MaturityDay[];
  cumulative: Array<{ date: string; amountUsdt: number }>;
  cumulativeUsdt: number;
  reserveCoverDays: number;
  farLiabilityExcluded: boolean;
  farLiabilityNote: string;
  trialStressIncluded: boolean;
  asOf: string;
}

export interface B2ForecastValues {
  reserveCategories: Record<string, boolean>;
  liabilityCategories: Record<string, boolean>;
  forecastWindow: B2ForecastWindow;
  genesisIncluded: boolean;
  includeFarLiabilities: boolean;
  stakingInterestMode: "LINEAR" | "AT_MATURITY";
  trialStressEnabled: boolean;
}

export interface B2ForecastConfig extends B2ForecastValues {
  version: number;
  effectiveVersion: number;
  effectiveRule: string;
  pendingConfig?: B2ForecastValues;
  pendingEffectiveAt?: string;
  pendingVersion?: number;
}

export interface B2Dashboard {
  reserve: B2Reserve;
  liabilities: B2Liabilities;
  maturity: B2Maturity;
  config: B2ForecastConfig;
}

export const B2_LIABILITY_KEYS = [
  "withdrawable_balance",
  "usdt_staking_principal",
  "staking_interest",
  "genesis_daily_emission",
  "nex_v2_future",
  "withdrawal_queue",
  "commission_cooling",
  "lock_other",
  "unverified_deposit",
] as const;

const B2_RESERVE_KEYS = ["usdt", "otherLiquid"] as const;
const B2_WATER_TIERS = ["NORMAL", "WATCH", "WARNING", "DANGER"] as const;

export class B2OutcomeUnknownError extends Error {
  constructor(public readonly commandKey: string) {
    super(`本次配置保存结果未知，可能已经生效。请先刷新核对；如需按原输入重试，将继续使用同一请求号：${commandKey}`);
    this.name = "B2OutcomeUnknownError";
  }
}

function idempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function invalid(field: string): never {
  throw new Error(formatAdminApiError("B2_RESPONSE_INVALID", `B2_RESPONSE_INVALID:${field}`));
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) invalid(field);
  return value;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(field);
  return value.trim();
}

function number(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) invalid(field);
  return parsed;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  return array(value, field).map((item, index) => string(item, `${field}[${index}]`));
}

function booleanRecord(value: unknown, field: string, keys: readonly string[]): Record<string, boolean> {
  const root = object(value, field);
  const actualKeys = Object.keys(root);
  if (actualKeys.length !== keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(root, key))) {
    invalid(field);
  }
  return Object.fromEntries(keys.map((key) => [key, boolean(root[key], `${field}.${key}`)]));
}

function near(left: number, right: number, tolerance = 0.011) {
  return Math.abs(left - right) <= tolerance;
}

function dateSeries(rows: Array<{ date: string }>, expectedLength: number, field: string) {
  if (rows.length !== expectedLength) invalid(`${field}.length`);
  let previous = 0;
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || seen.has(row.date)) invalid(`${field}[${index}].date`);
    const current = Date.parse(`${row.date}T00:00:00Z`);
    if (!Number.isFinite(current) || (index > 0 && current - previous !== 86_400_000)) invalid(`${field}[${index}].date`);
    seen.add(row.date);
    previous = current;
  });
}

function normalizeReserve(value: unknown): B2Reserve {
  const raw = object(value, "reserve");
  const water = object(raw.waterLevel, "reserve.waterLevel");
  const tier = string(water.tier, "reserve.waterLevel.tier");
  if (!(B2_WATER_TIERS as readonly string[]).includes(tier)) invalid("reserve.waterLevel.tier");
  const usdtReserveUsdt = number(raw.usdtReserveUsdt, "reserve.usdtReserveUsdt");
  const otherLiquidUsdt = number(raw.otherLiquidUsdt, "reserve.otherLiquidUsdt");
  const reserveTotalUsdt = number(raw.reserveTotalUsdt, "reserve.reserveTotalUsdt");
  const lockedStakingPrincipalDeductedUsdt = number(
    raw.lockedStakingPrincipalDeductedUsdt,
    "reserve.lockedStakingPrincipalDeductedUsdt",
  );
  if (
    [usdtReserveUsdt, otherLiquidUsdt, reserveTotalUsdt, lockedStakingPrincipalDeductedUsdt].some((item) => item < 0)
    || !near(usdtReserveUsdt + otherLiquidUsdt, reserveTotalUsdt)
  ) {
    invalid("reserve.arithmetic");
  }
  return {
    reserveTotalUsdt,
    usdtReserveUsdt,
    otherLiquidUsdt,
    lockedStakingPrincipalDeductedUsdt,
    asOf: string(raw.asOf, "reserve.asOf"),
    sources: stringArray(raw.sources, "reserve.sources"),
    waterLevel: {
      tier: tier as B2WaterLevel["tier"],
      color: string(water.color, "reserve.waterLevel.color"),
      reserveCoverDays: number(water.reserveCoverDays, "reserve.waterLevel.reserveCoverDays"),
      dailyAverageDueUsdt: number(water.dailyAverageDueUsdt, "reserve.waterLevel.dailyAverageDueUsdt"),
      suggestedAction: string(water.suggestedAction, "reserve.waterLevel.suggestedAction"),
      notification: string(water.notification, "reserve.waterLevel.notification"),
    },
  };
}

function normalizeLiabilities(value: unknown): B2Liabilities {
  const raw = object(value, "liabilities");
  const totalUsdt = number(raw.totalUsdt, "liabilities.totalUsdt");
  const hardLiabilityCategoryCount = number(raw.hardLiabilityCategoryCount, "liabilities.hardLiabilityCategoryCount");
  const breakdown = array(raw.breakdown, "liabilities.breakdown").map((item, index) => {
    const row = object(item, `liabilities.breakdown[${index}]`);
    const normalized = {
      category: string(row.category, `liabilities.breakdown[${index}].category`),
      label: string(row.label, `liabilities.breakdown[${index}].label`),
      amountUsdt: number(row.amountUsdt, `liabilities.breakdown[${index}].amountUsdt`),
      share: number(row.share, `liabilities.breakdown[${index}].share`),
      source: string(row.source, `liabilities.breakdown[${index}].source`),
    };
    if (normalized.amountUsdt < 0 || normalized.share < 0 || normalized.share > 1) {
      invalid(`liabilities.breakdown[${index}].range`);
    }
    return normalized;
  });
  const categories = breakdown.map((row) => row.category);
  const amountTotal = breakdown.reduce((sum, row) => sum + row.amountUsdt, 0);
  const shareTotal = breakdown.reduce((sum, row) => sum + row.share, 0);
  if (
    totalUsdt < 0
    || hardLiabilityCategoryCount !== B2_LIABILITY_KEYS.length
    || breakdown.length !== B2_LIABILITY_KEYS.length
    || new Set(categories).size !== B2_LIABILITY_KEYS.length
    || B2_LIABILITY_KEYS.some((key) => !categories.includes(key))
    || !near(amountTotal, totalUsdt)
    || (totalUsdt > 0 && Math.abs(shareTotal - 1) > 0.001)
  ) {
    invalid("liabilities.invariants");
  }
  return {
    totalUsdt,
    hardLiabilityCategoryCount,
    trialShadowIncluded: boolean(raw.trialShadowIncluded, "liabilities.trialShadowIncluded"),
    asOf: string(raw.asOf, "liabilities.asOf"),
    breakdown,
    sources: stringArray(raw.sources, "liabilities.sources"),
  };
}

function normalizeMaturity(value: unknown): B2Maturity {
  const raw = object(value, "maturity");
  const window = string(raw.window, "maturity.window");
  if (!["7d", "30d"].includes(window)) invalid("maturity.window");
  const daily = array(raw.daily, "maturity.daily").map((item, index) => {
    const row = object(item, `maturity.daily[${index}]`);
    const normalized = {
      date: string(row.date, `maturity.daily[${index}].date`),
      withdrawDueUsdt: number(row.withdrawDueUsdt, `maturity.daily[${index}].withdrawDueUsdt`),
      interestDueUsdt: number(row.interestDueUsdt, `maturity.daily[${index}].interestDueUsdt`),
      genesisDividendUsdt: number(row.genesisDividendUsdt, `maturity.daily[${index}].genesisDividendUsdt`),
      trialShadowStressUsdt: number(row.trialShadowStressUsdt, `maturity.daily[${index}].trialShadowStressUsdt`),
      totalDueUsdt: number(row.totalDueUsdt, `maturity.daily[${index}].totalDueUsdt`),
    };
    const sum = normalized.withdrawDueUsdt
      + normalized.interestDueUsdt
      + normalized.genesisDividendUsdt
      + normalized.trialShadowStressUsdt;
    if (
      [
        normalized.withdrawDueUsdt,
        normalized.interestDueUsdt,
        normalized.genesisDividendUsdt,
        normalized.trialShadowStressUsdt,
      ].some((itemValue) => itemValue < 0)
      || !near(sum, normalized.totalDueUsdt)
    ) {
      invalid(`maturity.daily[${index}].arithmetic`);
    }
    return normalized;
  });
  const cumulative = array(raw.cumulative, "maturity.cumulative").map((item, index) => {
    const row = object(item, `maturity.cumulative[${index}]`);
    return {
      date: string(row.date, `maturity.cumulative[${index}].date`),
      amountUsdt: number(row.amountUsdt, `maturity.cumulative[${index}].amountUsdt`),
    };
  });
  const expectedLength = window === "7d" ? 7 : 30;
  dateSeries(daily, expectedLength, "maturity.daily");
  dateSeries(cumulative, expectedLength, "maturity.cumulative");
  let running = 0;
  daily.forEach((row, index) => {
    running += row.totalDueUsdt;
    if (cumulative[index].date !== row.date || !near(cumulative[index].amountUsdt, running)) {
      invalid(`maturity.cumulative[${index}].arithmetic`);
    }
  });
  const cumulativeUsdt = number(raw.cumulativeUsdt, "maturity.cumulativeUsdt");
  if (!near(cumulativeUsdt, running)) invalid("maturity.cumulativeUsdt");
  return {
    window: window as B2MaturityWindow,
    daily,
    cumulative,
    cumulativeUsdt,
    reserveCoverDays: number(raw.reserveCoverDays, "maturity.reserveCoverDays"),
    farLiabilityExcluded: boolean(raw.farLiabilityExcluded, "maturity.farLiabilityExcluded"),
    farLiabilityNote: string(raw.farLiabilityNote, "maturity.farLiabilityNote"),
    trialStressIncluded: boolean(raw.trialStressIncluded, "maturity.trialStressIncluded"),
    asOf: string(raw.asOf, "maturity.asOf"),
  };
}

function normalizeForecastValues(value: unknown, field: string): B2ForecastValues {
  const raw = object(value, field);
  const forecastWindow = string(raw.forecastWindow, `${field}.forecastWindow`);
  const stakingInterestMode = string(raw.stakingInterestMode, `${field}.stakingInterestMode`);
  if (!["7d", "30d", "90d"].includes(forecastWindow)) invalid(`${field}.forecastWindow`);
  if (!["LINEAR", "AT_MATURITY"].includes(stakingInterestMode)) invalid(`${field}.stakingInterestMode`);
  return {
    reserveCategories: booleanRecord(raw.reserveCategories, `${field}.reserveCategories`, B2_RESERVE_KEYS),
    liabilityCategories: booleanRecord(raw.liabilityCategories, `${field}.liabilityCategories`, B2_LIABILITY_KEYS),
    forecastWindow: forecastWindow as B2ForecastWindow,
    genesisIncluded: boolean(raw.genesisIncluded, `${field}.genesisIncluded`),
    includeFarLiabilities: boolean(raw.includeFarLiabilities, `${field}.includeFarLiabilities`),
    stakingInterestMode: stakingInterestMode as B2ForecastValues["stakingInterestMode"],
    trialStressEnabled: boolean(raw.trialStressEnabled, `${field}.trialStressEnabled`),
  };
}

function normalizeConfig(value: unknown): B2ForecastConfig {
  const raw = object(value, "config");
  const values = normalizeForecastValues(raw, "config");
  const version = number(raw.version, "config.version");
  const effectiveVersion = number(raw.effectiveVersion, "config.effectiveVersion");
  const pendingVersion = raw.pendingVersion === undefined ? undefined : number(raw.pendingVersion, "config.pendingVersion");
  const pendingConfig = raw.pendingConfig === undefined
    ? undefined
    : normalizeForecastValues(raw.pendingConfig, "config.pendingConfig");
  if (
    !Number.isInteger(version)
    || !Number.isInteger(effectiveVersion)
    || version < 0
    || effectiveVersion < 0
    || effectiveVersion > version
    || (pendingConfig && (pendingVersion === undefined || pendingVersion !== version))
    || (!pendingConfig && pendingVersion !== undefined)
  ) {
    invalid("config.versionInvariant");
  }
  return {
    ...values,
    version,
    effectiveVersion,
    effectiveRule: string(raw.effectiveRule, "config.effectiveRule"),
    pendingConfig,
    pendingEffectiveAt: pendingConfig ? string(raw.pendingEffectiveAt, "config.pendingEffectiveAt") : undefined,
    pendingVersion,
  };
}

async function request<T>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  const response = await guardedFetch(`/api/admin/treasury${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !result || result.code !== 0 || result.data === undefined) {
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    const commandKey = headers.get("Idempotency-Key");
    if (commandKey && response.headers.get("X-Nexion-Upstream-Outcome")?.toLowerCase() === "unknown") {
      throw new B2OutcomeUnknownError(commandKey);
    }
    throw new Error(formatAdminApiError(result?.message, `B2_REQUEST_FAILED_${response.status}`));
  }
  return result.data;
}

export async function fetchB2Dashboard(window: B2MaturityWindow): Promise<B2Dashboard> {
  const [reserve, liabilities, maturity, config] = await Promise.all([
    request<unknown>("/reserve"),
    request<unknown>("/liabilities?breakdown=true"),
    request<unknown>(`/maturity-forecast?window=${window}`),
    request<unknown>("/forecast-config"),
  ]);
  return {
    reserve: normalizeReserve(reserve),
    liabilities: normalizeLiabilities(liabilities),
    maturity: normalizeMaturity(maturity),
    config: normalizeConfig(config),
  };
}

export async function updateB2ForecastConfig(
  values: B2ForecastValues,
  expectedVersion: number,
  reason: string,
  operator: string,
  commandKey = idempotencyKey("b2-forecast-config"),
) {
  return request<unknown>("/forecast-config", {
    method: "PUT",
    headers: {
      "Idempotency-Key": commandKey,
    },
    body: JSON.stringify({ ...values, expectedVersion, reason, operator }),
  });
}

export async function downloadB2LiabilitiesCsv() {
  const response = await guardedFetch("/api/admin/treasury/liabilities/export", { cache: "no-store" });
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as ApiResult<unknown> | null;
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    throw new Error(formatAdminApiError(result?.message, `B2_EXPORT_FAILED_${response.status}`));
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const fileName = disposition.match(/filename="?([^";]+)"?/i)?.[1] || "b2-liabilities.csv";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
