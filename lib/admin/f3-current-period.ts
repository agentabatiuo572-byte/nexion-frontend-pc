"use client";

import { useCallback, useEffect, useState } from "react";
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { f4Decimal } from "@/lib/admin/f4-money";

type RecordValue = Record<string, unknown>;

function invalid(): never {
  throw new Error("F3_CURRENT_PERIOD_INVALID_RESPONSE");
}

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): RecordValue {
  return isRecord(value) ? value : invalid();
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function string(value: unknown): string {
  return isString(value) ? value : invalid();
}

function strings(value: unknown): string[] {
  return Array.isArray(value) && value.every(isString) ? value : invalid();
}

function boolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : invalid();
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : invalid();
}

function oneOf<const T extends string>(value: unknown, choices: readonly T[]): T {
  const choice = choices.find(choice => choice === value);
  return choice ?? invalid();
}

function optional<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value == null ? null : parse(value);
}

function date(value: unknown): string {
  if (!isString(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return invalid();
  return value;
}

function utc(value: unknown): string {
  if (!isString(value) || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/.test(value)) {
    return invalid();
  }
  date(value.slice(0, 10));
  return value;
}

function zone(value: unknown): string {
  return isString(value) && value.length > 0 ? value : invalid();
}

function decimal(value: unknown): string | null {
  if (value === null) return null;
  return (isString(value) ? f4Decimal(value) : null) ?? invalid();
}

function readPeriod(period: RecordValue) {
  const availability = record(period.availability);
  const basis = record(period.basis);

  if (Object.values(basis).some(value => !isString(value))) return invalid();

  return {
    asOfUtc: utc(period.asOfUtc),
    cadence: optional(period.cadence, value => oneOf(value, ["每日", "每周", "每月"])),
    settlementDate: optional(period.settlementDate, date),
    periodStart: optional(period.periodStart, date),
    periodEnd: optional(period.periodEnd, date),
    periodDays: optional(period.periodDays, count),
    businessZone: optional(period.businessZone, zone),
    storageZone: optional(period.storageZone, zone),
    periodStartAtUtc: optional(period.periodStartAtUtc, utc),
    periodEndExclusiveAtUtc: optional(period.periodEndExclusiveAtUtc, utc),
    frozen: period.frozen === null ? null : boolean(period.frozen),
    freezeStatus: oneOf(period.freezeStatus, ["FROZEN", "NOT_FROZEN", "UNKNOWN"]),
    paidSalesUsdt: decimal(period.paidSalesUsdt),
    paidSalesAsOfUtc: optional(period.paidSalesAsOfUtc, utc),
    paidSalesComplete: boolean(period.paidSalesComplete),
    paidSalesBasis: optional(period.paidSalesBasis, value => oneOf(value, ["PAID_ORDERS_TO_DATE_NOT_FROZEN", "FROZEN_PERIOD"])),
    platformCapPct: decimal(period.platformCapPct),
    platformCapPctUnit: oneOf(period.platformCapPctUnit, ["PERCENT"]),
    platformCapPctBasis: optional(period.platformCapPctBasis, value => oneOf(value, [
      "CURRENT_CONFIG_NOT_FROZEN", "DEFAULT_CONFIG_NOT_FROZEN", "FROZEN_PERIOD",
    ])),
    platformCapUsdt: decimal(period.platformCapUsdt),
    plannedRawTotalUsdt: decimal(period.plannedRawTotalUsdt),
    platformUsedUsdt: decimal(period.platformUsedUsdt),
    settledPayoutUsdt: decimal(period.settledPayoutUsdt),
    automaticSettledUsdt: decimal(period.automaticSettledUsdt),
    manualSettledUsdt: decimal(period.manualSettledUsdt),
    settledSettlementCount: period.settledSettlementCount === null ? null : count(period.settledSettlementCount),
    platformRemainingUsdt: decimal(period.platformRemainingUsdt),
    availability: {
      dates: boolean(availability.dates),
      utc: boolean(availability.utc),
      paidSales: boolean(availability.paidSales),
      platformCap: boolean(availability.platformCap),
      platformUsed: boolean(availability.platformUsed),
    },
    available: boolean(period.available),
    unavailableReasons: strings(period.unavailableReasons),
    basis: basis as Record<string, string>,
  };
}

export type F3PeriodOverview = ReturnType<typeof readPeriod>;
export type F3CurrentPeriodView = F3PeriodOverview & {
  platformCapEstimateUsdt: string | null;
  estimateAvailable: boolean;
  estimateReason: string | null;
};
export type F3LatestFrozenPeriodView = F3PeriodOverview & {
  plannedRawExceedsCap: boolean;
};
export type F3CurrentPeriodOverview = {
  domain: "F3";
  currentPeriod: F3CurrentPeriodView;
  latestFrozenPeriod: F3LatestFrozenPeriodView;
  sources: string[];
};
export type F3CurrentPeriodState =
  | { status: "loading" }
  | { status: "error"; error: Error; httpStatus?: number; apiCode?: number }
  | { status: "forbidden" }
  | { status: "not-found" }
  | { status: "invalid-response" }
  | { status: "success"; data: F3CurrentPeriodOverview };

function exceedsCap(planned: string | null, cap: string | null): boolean {
  if (planned === null || cap === null) return false;
  const [plannedWhole, plannedFraction = ""] = planned.split(".");
  const [capWhole, capFraction = ""] = cap.split(".");
  const scale = Math.max(plannedFraction.length, capFraction.length);
  return BigInt(plannedWhole + plannedFraction.padEnd(scale, "0"))
    > BigInt(capWhole + capFraction.padEnd(scale, "0"));
}

function readOverview(value: unknown): F3CurrentPeriodOverview {
  const data = record(value);
  if (data.domain !== "F3") return invalid();
  const currentPeriod = record(data.currentPeriod);
  const platformCapEstimateUsdt = decimal(currentPeriod.platformCapEstimateUsdt ?? null);
  const latestFrozenPeriod = readPeriod(record(data.latestFrozenPeriod));

  return {
    domain: data.domain,
    currentPeriod: {
      ...readPeriod(currentPeriod),
      platformCapEstimateUsdt,
      estimateAvailable: platformCapEstimateUsdt !== null,
      estimateReason: optional(currentPeriod.platformCapEstimateReason, string),
    },
    latestFrozenPeriod: {
      ...latestFrozenPeriod,
      plannedRawExceedsCap: exceedsCap(latestFrozenPeriod.plannedRawTotalUsdt, latestFrozenPeriod.platformCapUsdt),
    },
    sources: strings(data.sources),
  };
}

function parseEnvelope(raw: string): RecordValue {
  // Quote BigDecimal tokens before JSON.parse can round them.
  return record(JSON.parse(raw.replace(
    /("(?:paidSalesUsdt|platformCapPct|platformCapEstimateUsdt|platformCapUsdt|plannedRawTotalUsdt|platformUsedUsdt|settledPayoutUsdt|automaticSettledUsdt|manualSettledUsdt|platformRemainingUsdt)"\s*:\s*)(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g,
    '$1"$2"',
  )));
}

function readFailure(httpStatus: number, message?: string, apiCode?: number): F3CurrentPeriodState {
  const fallback = `F3_CURRENT_PERIOD_READ_FAILED_${apiCode ?? httpStatus}`;
  return { status: "error", error: new Error(formatAdminApiError(message, fallback, "read")), httpStatus, apiCode };
}

async function readCurrentPeriod(signal: AbortSignal): Promise<F3CurrentPeriodState> {
  let response: Response;
  try {
    response = await guardedFetch("/api/admin/teams/binary/current-period", {
      method: "GET",
      cache: "no-store",
      signal,
    });
  } catch (cause) {
    return { status: "error", error: cause instanceof Error ? cause : new Error("NETWORK_FAILURE") };
  }

  const httpStatus = response.status;
  if (isAdminAuthFailure(httpStatus)) resetAdminSession();
  if (httpStatus === 403) return { status: "forbidden" };
  if (httpStatus === 404) return { status: "not-found" };
  let raw: string;
  try {
    raw = await response.text();
  } catch (cause) {
    if (!response.ok) return readFailure(httpStatus);
    return { status: "error", error: new Error("NETWORK_FAILURE", { cause }), httpStatus };
  }

  try {
    const result = parseEnvelope(raw);
    const message = isString(result.message) ? result.message : undefined;
    if (!response.ok) return readFailure(httpStatus, message);
    const apiCode = result.code;
    if (typeof apiCode !== "number" || !Number.isSafeInteger(apiCode)) return invalid();
    if (isAdminAuthFailure(apiCode, message)) resetAdminSession();
    if (apiCode === 403) return { status: "forbidden" };
    if (apiCode === 404) return { status: "not-found" };
    if (apiCode !== 0) return readFailure(httpStatus, message, apiCode);
    if (message === undefined) return invalid();
    return { status: "success", data: readOverview(result.data) };
  } catch {
    return response.ok ? { status: "invalid-response" } : readFailure(httpStatus);
  }
}

export function useF3CurrentPeriod(refreshKey = 0): F3CurrentPeriodState & { reload: () => void } {
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<F3CurrentPeriodState>({ status: "loading" });
  const reload = useCallback(() => setReloadKey(key => key + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void readCurrentPeriod(controller.signal).then(result => {
      if (!controller.signal.aborted) setState(result);
    });
    return () => controller.abort();
  }, [refreshKey, reloadKey]);

  return { ...state, reload };
}
