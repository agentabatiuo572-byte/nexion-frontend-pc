import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

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

export interface B2ForecastValues {
  reserveCategories: Record<string, boolean>;
  liabilityCategories: Record<string, boolean>;
  forecastWindow: B2ForecastWindow;
  genesisIncluded: boolean;
  includeFarLiabilities: boolean;
  stakingInterestMode: "LINEAR" | "AT_MATURITY";
  trialStressEnabled: boolean;
}

const B2_WATER_TIERS = ["NORMAL", "WATCH", "WARNING", "DANGER"] as const;

export class B2RequestError extends Error {
  constructor(message: string, public readonly status: number, public readonly reasonCode?: string) {
    super(message);
    this.name = "B2RequestError";
  }
}

export interface ForecastConfigPreview {
  version: number;
  effectiveAt: string;
  forecastDeltaPreview: Record<
    "before7dUsdt" | "after7dUsdt" | "delta7dUsdt" | "before30dUsdt" | "after30dUsdt" | "delta30dUsdt"
    | "beforeReserveUsdt" | "afterReserveUsdt" | "reserveDeltaUsdt"
    | "beforeLiabilitiesUsdt" | "afterLiabilitiesUsdt" | "liabilitiesDeltaUsdt"
    | "beforeNetExposureUsdt" | "afterNetExposureUsdt" | "netExposureDeltaUsdt"
    | "beforeDailyGenesisUsdt" | "afterDailyGenesisUsdt" | "dailyDeltaUsdt", number> & {
      beforeCoveragePct: number | null;
      afterCoveragePct: number | null;
      coverageDeltaPct: number | null;
      beforeCoverageStatus: "AVAILABLE" | "NO_LIABILITIES" | "VALUATION_UNAVAILABLE";
      afterCoverageStatus: "AVAILABLE" | "NO_LIABILITIES" | "VALUATION_UNAVAILABLE";
      removedLiabilityCategories: string[];
    };
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

function stringArray(value: unknown, field: string): string[] {
  return array(value, field).map((item, index) => string(item, `${field}[${index}]`));
}

function near(left: number, right: number, tolerance = 0.011) {
  return Math.abs(left - right) <= tolerance;
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

async function request<T>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  const response = await guardedFetch(`/api/admin/treasury${path}`, { ...init, headers, cache: "no-store" });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !result || result.code !== 0 || result.data === undefined) {
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    throw new B2RequestError(formatAdminApiError(result?.message, `B2_REQUEST_FAILED_${response.status}`), response.status, result?.message);
  }
  return result.data;
}

export async function fetchB2Reserve(): Promise<B2Reserve> {
  return normalizeReserve(await request<unknown>("/reserve"));
}

export async function previewB2ForecastConfig(values: B2ForecastValues, expectedVersion: number): Promise<ForecastConfigPreview> {
  const raw = object(await request<unknown>("/forecast-config/preview", {
    method: "POST",
    body: JSON.stringify({ ...values, expectedVersion }),
  }), "preview");
  const delta = object(raw.forecastDeltaPreview, "forecastDeltaPreview");
  const amounts = Object.fromEntries([
    "before7dUsdt", "after7dUsdt", "delta7dUsdt", "before30dUsdt", "after30dUsdt", "delta30dUsdt",
    "beforeReserveUsdt", "afterReserveUsdt", "reserveDeltaUsdt", "beforeLiabilitiesUsdt", "afterLiabilitiesUsdt", "liabilitiesDeltaUsdt",
    "beforeNetExposureUsdt", "afterNetExposureUsdt", "netExposureDeltaUsdt", "beforeDailyGenesisUsdt", "afterDailyGenesisUsdt", "dailyDeltaUsdt",
  ].map((key) => [key, number(delta[key], `preview.${key}`)])) as Pick<ForecastConfigPreview["forecastDeltaPreview"],
    "before7dUsdt" | "after7dUsdt" | "delta7dUsdt" | "before30dUsdt" | "after30dUsdt" | "delta30dUsdt"
    | "beforeReserveUsdt" | "afterReserveUsdt" | "reserveDeltaUsdt" | "beforeLiabilitiesUsdt" | "afterLiabilitiesUsdt" | "liabilitiesDeltaUsdt"
    | "beforeNetExposureUsdt" | "afterNetExposureUsdt" | "netExposureDeltaUsdt" | "beforeDailyGenesisUsdt" | "afterDailyGenesisUsdt" | "dailyDeltaUsdt">;
  const statuses = ["AVAILABLE", "NO_LIABILITIES", "VALUATION_UNAVAILABLE"];
  if (!statuses.includes(String(delta.beforeCoverageStatus)) || !statuses.includes(String(delta.afterCoverageStatus))) invalid("preview.coverageStatus");
  const beforeCoverageStatus = delta.beforeCoverageStatus as ForecastConfigPreview["forecastDeltaPreview"]["beforeCoverageStatus"];
  const afterCoverageStatus = delta.afterCoverageStatus as ForecastConfigPreview["forecastDeltaPreview"]["afterCoverageStatus"];
  const beforeCoveragePct = delta.beforeCoveragePct === null ? null : number(delta.beforeCoveragePct, "preview.beforeCoveragePct");
  const afterCoveragePct = delta.afterCoveragePct === null ? null : number(delta.afterCoveragePct, "preview.afterCoveragePct");
  const coverageDeltaPct = delta.coverageDeltaPct === null ? null : number(delta.coverageDeltaPct, "preview.coverageDeltaPct");
  if ((beforeCoverageStatus === "AVAILABLE") !== (beforeCoveragePct !== null)
    || (afterCoverageStatus === "AVAILABLE") !== (afterCoveragePct !== null)
    || (beforeCoveragePct === null || afterCoveragePct === null) && coverageDeltaPct !== null) invalid("preview.coverage");
  const version = number(raw.version, "preview.version");
  if (version !== expectedVersion) invalid("preview.version");
  return { version, effectiveAt: string(raw.effectiveAt, "preview.effectiveAt"), forecastDeltaPreview: {
    ...amounts, beforeCoverageStatus, afterCoverageStatus, beforeCoveragePct, afterCoveragePct, coverageDeltaPct,
    removedLiabilityCategories: stringArray(delta.removedLiabilityCategories, "preview.removedLiabilityCategories"),
  } };
}
