"use client";

import { useCallback, useEffect, useState } from "react";
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError } from "@/lib/admin/error-messages";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

export type B3Filters = { cohort: string; phase: string; ref: string };

export interface B3Stage {
  key: "register" | "kyc" | "purchase" | "repurchase" | "withdraw";
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

function query(filters: B3Filters, extra?: Record<string, string>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (value && value !== "ALL") params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

async function json<T>(response: Response, fallback: string): Promise<T> {
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !result || result.code !== 0 || result.data == null) {
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    throw new Error(formatAdminApiError(result?.message, fallback));
  }
  return result.data;
}

export async function fetchB3Dashboard(filters: B3Filters, stage = "purchase") {
  const suffix = query(filters);
  const [overview, aux, trend] = await Promise.all([
    fetch(`/api/admin/funnel${suffix}`, { cache: "no-store" }).then((response) =>
      json<B3Dashboard>(response, "B3_FUNNEL_LOAD_FAILED")),
    fetch(`/api/admin/funnel/aux-metrics${suffix}`, { cache: "no-store" }).then((response) =>
      json<{ auxMetrics: B3AuxMetrics }>(response, "B3_AUX_LOAD_FAILED")),
    fetch(`/api/admin/funnel/cohort-trend${query(filters, { stage, cohortRange: "13w" })}`, {
      cache: "no-store",
    }).then((response) => json<{ points: B3TrendPoint[] }>(response, "B3_TREND_LOAD_FAILED")),
  ]);
  return { ...overview, auxMetrics: aux.auxMetrics, trend: trend.points };
}

export async function saveB3View(
  name: string,
  filters: B3Filters,
  granularity = "WEEK",
  comparison = "PREVIOUS",
) {
  const response = await fetch("/api/admin/funnel/view", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `b3-view-${Date.now()}` },
    body: JSON.stringify({ name, ...filters, granularity, comparison }),
    cache: "no-store",
  });
  return json<{ saved: Record<string, unknown>; replayed: boolean }>(response, "B3_VIEW_SAVE_FAILED");
}

export async function exportB3Cohort(filters: B3Filters) {
  const response = await fetch(`/api/admin/funnel/export${query(filters)}`, { cache: "no-store" });
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
      setError(value instanceof Error ? value.message : "B3_FUNNEL_LOAD_FAILED");
    } finally {
      setLoading(false);
    }
  }, [filters.cohort, filters.phase, filters.ref, stage]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}
