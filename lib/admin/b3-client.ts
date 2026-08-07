"use client";

import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { useCallback, useEffect, useState } from "react";
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { displayAdminError, formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { assertB3Dashboard } from "@/lib/admin/b34-overview-contract";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

export type B3Filters = { cohort: string; phase: string; ref: string };

export interface B3Stage {
  key: "register" | "purchase" | "repurchase" | "withdraw";
  stage: string;
  event: string;
  distinctUsers: number;
  previousUsers: number;
  cvrFromPrev: number | null;
  momDelta: number | null;
  lifecycleLabel: string;
  kpiTarget: string | null;
  color: string;
  source: string;
}

export interface B3AuxMetrics {
  storeViewRate: number | null;
  storeViewNumerator: number;
  storeViewDenominator: number;
  purchaseFromStoreRate: number | null;
  purchaseFromStoreNumerator: number;
  purchaseFromStoreDenominator: number;
  day0AccessRate: number | null;
  day0Numerator: number;
  day0Denominator: number;
  day0Target: number;
  day7Retention: number | null;
  day7Numerator: number;
  day7Denominator: number;
  day7Target: number;
  day7Mature: boolean;
}

export interface B3TrendPoint {
  cohort: string;
  distinctUsers: number;
  cvrFromPrev: number | null;
}

export interface B3Dashboard {
  available: boolean;
  reason?: string;
  message?: string;
  generatedAt: string;
  filters: B3Filters;
  filterOptions: { cohorts: string[]; phases: string[]; refs: string[] };
  stages: B3Stage[];
  auxMetrics: B3AuxMetrics;
  trend: B3TrendPoint[];
  savedViews: Array<Record<string, unknown>>;
  crossDomainLinks: Array<{ label: string; href: string }>;
  sources: string[];
  sourceStatement: string;
}

export class B3OutcomeUnknownError extends Error {
  constructor(public readonly commandKey: string) {
    super(`本次视图保存结果未知，可能已经生效。请先刷新核对；如需按原输入重试，将继续使用同一请求号：${commandKey}`);
    this.name = "B3OutcomeUnknownError";
  }
}

function idempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function query(filters: B3Filters, extra?: Record<string, string>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (value && value !== "ALL") params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

async function json<T>(response: Response, fallback: string, commandKey?: string): Promise<T> {
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !result || result.code !== 0 || result.data == null) {
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    // unknown 头只是增强信号,不再是唯一保险丝:5xx / 响应不可读同样归结果未知
    // (统一口径见 outcome-classification.ts)。
    if (commandKey && (response.headers.get("X-Nexion-Upstream-Outcome")?.toLowerCase() === "unknown"
      || outcomeStaysUnknown(response.status, result?.code))) {
      throw new B3OutcomeUnknownError(commandKey);
    }
    throw new Error(formatAdminApiError(result?.message, fallback));
  }
  return result.data;
}

/** 带命令号的写请求:传输层失败必须归「结果未知」,不能让裸 TypeError 冒到页面被当确定失败。 */
async function writeFetch(url: string, init: RequestInit, commandKey: string) {
  try {
    return await guardedFetch(url, init);
  } catch {
    throw new B3OutcomeUnknownError(commandKey);
  }
}

export async function fetchB3Dashboard(filters: B3Filters, stage = "purchase"): Promise<B3Dashboard> {
  const data = await guardedFetch(`/api/admin/funnel${query(filters, { stage })}`, { cache: "no-store" })
    .then((response) => json<unknown>(response, "B3_FUNNEL_LOAD_FAILED"));
  assertB3Dashboard(data);
  return data as unknown as B3Dashboard;
}

export async function saveB3View(
  name: string,
  filters: B3Filters,
  granularity = "WEEK",
  comparison = "PREVIOUS",
  commandKey = idempotencyKey("b3-view"),
) {
  const response = await writeFetch("/api/admin/funnel/view", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": commandKey },
    body: JSON.stringify({ name, ...filters, granularity, comparison }),
    cache: "no-store",
  }, commandKey);
  return json<{ saved: Record<string, unknown>; replayed: boolean }>(
    response,
    "B3_VIEW_SAVE_FAILED",
    commandKey,
  );
}

export async function exportB3Cohort(filters: B3Filters) {
  const response = await guardedFetch(`/api/admin/funnel/export${query(filters)}`, { cache: "no-store" });
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as ApiResult<unknown> | null;
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    throw new Error(formatAdminApiError(result?.message, "B3_EXPORT_FAILED"));
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const matched = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  return { blob, fileName: matched ? decodeURIComponent(matched[1]) : "b3-funnel.csv" };
}

export function useB3Funnel(filters: B3Filters, stage: string) {
  const [data, setData] = useState<B3Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchB3Dashboard(filters, stage));
    } catch (value) {
      setData(null);
      setError(displayAdminError(value));
    } finally {
      setLoading(false);
    }
  }, [filters.cohort, filters.phase, filters.ref, stage]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}
