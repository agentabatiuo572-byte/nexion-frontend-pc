"use client";

import { useCallback, useEffect, useState } from "react";
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError } from "@/lib/admin/error-messages";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

export type B4Granularity = "PHASE" | "MONTH";
export type B4Filters = { granularity: B4Granularity; month: string; phase: string };

export interface B4DistributionRow {
  phase: string;
  month?: number;
  userCount: number;
  inScope: boolean;
}

export interface B4Dial {
  key: string;
  label: string;
  currentValue: string | number | boolean;
  unit: string;
  source: string;
  v1Status: string;
  v1Active: boolean;
  adjustHref: string;
}

export interface B4PhaseOverview {
  available: boolean;
  reason?: string;
  filters: {
    granularity: B4Granularity;
    month: number;
    phase: string;
    monthOptions: number[];
    phaseOptions: string[];
  };
  rhythm: {
    currentPhase: string;
    currentMonth: number;
    totalMonths: number;
    phaseProgressPct: number;
  };
  phaseDistribution: B4DistributionRow[];
  monthDistribution: B4DistributionRow[];
  distribution: B4DistributionRow[];
  dials: B4Dial[];
  nextPivot: {
    atMonth: number | null;
    daysLeft: number | null;
    changes: string[];
    basis: string;
    message: string;
  };
  monthLeverCombo: Array<{ key: string; label: string; purpose: string }>;
  attributionLinks: Array<{ key: "H1" | "B3" | "B1" | "B2"; label: string; href: string }>;
  sourceStatement: string;
  sources: string[];
  asOf: string;
}

function query(filters: B4Filters) {
  const params = new URLSearchParams({ granularity: filters.granularity });
  if (filters.month) params.set("month", filters.month);
  if (filters.phase && filters.phase !== "ALL") params.set("phase", filters.phase);
  return `?${params.toString()}`;
}

async function json<T>(response: Response, fallback: string): Promise<T> {
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !result || result.code !== 0 || result.data == null) {
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    throw new Error(formatAdminApiError(result?.message, fallback));
  }
  return result.data;
}

export async function fetchB4PhaseOverview(filters: B4Filters) {
  return fetch(`/api/admin/phase/overview${query(filters)}`, { cache: "no-store" })
    .then((response) => json<B4PhaseOverview>(response, "B4_PHASE_LOAD_FAILED"));
}

export async function recordB4H1Jump(dial: string, phase: string) {
  const params = new URLSearchParams();
  if (dial) params.set("dial", dial);
  if (phase && phase !== "ALL") params.set("phase", phase);
  return fetch(`/api/admin/phase/jump?${params.toString()}`, { cache: "no-store" })
    .then((response) => json<{ href: string }>(response, "B4_JUMP_AUDIT_FAILED"));
}

export async function exportB4Distribution(filters: B4Filters) {
  const response = await fetch(`/api/admin/phase/distribution/export${query(filters)}`, { cache: "no-store" });
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as ApiResult<unknown> | null;
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    throw new Error(formatAdminApiError(result?.message, "B4_EXPORT_FAILED"));
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const matched = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  return { blob, fileName: matched ? decodeURIComponent(matched[1]) : "b4-phase-distribution.csv" };
}

export function useB4PhaseOverview(filters: B4Filters) {
  const [data, setData] = useState<B4PhaseOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchB4PhaseOverview(filters));
    } catch (value) {
      setData(null);
      setError(value instanceof Error ? value.message : "B4_BACKEND_UNAVAILABLE");
    } finally {
      setLoading(false);
    }
  }, [filters.granularity, filters.month, filters.phase]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}
