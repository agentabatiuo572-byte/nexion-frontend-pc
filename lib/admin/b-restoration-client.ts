"use client";

import { useCallback, useEffect, useState } from "react";
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { displayAdminError, formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import {
  normalizeB2LiquidityHistory as normalizeB2LiquidityHistoryContract,
  normalizeB4GrowthFlowHistory as normalizeB4GrowthFlowHistoryContract,
} from "@/lib/admin/b-restoration-contract";

type ApiResult<T> = { code: number; message?: string; data?: T };
type Row = Record<string, unknown>;

export type B2LiquidityHistory = {
  generatedAt: string;
  flowWindows: Array<{ label: string; inflowWan: number; outflowWan: number; netWan: number }>;
  monthlyNewDeposits: Array<{ label: string; amountWan: number }>;
  sources: string[];
};

export type B4GrowthFlowHistory = {
  generatedAt: string;
  healthyRatio: number;
  currentRatio: number | null;
  suggestion: string;
  ratioSeries: Array<{ label: string; newInflowWan: number; outflowWan: number; ratio: number | null }>;
  budget: {
    available: boolean;
    totalUsdt?: number;
    reason?: string;
    missingKeys: string[];
    rows: Array<{ key: "acquisition" | "commission" | "genesis" | "reserve"; label: string; amountUsdt: number; sharePct: number; source: string }>;
  };
  sources: string[];
};

function invalid(field: string): never {
  throw new Error(`B_RESTORATION_RESPONSE_INVALID:${field}`);
}

function row(value: unknown, field: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  return value as Row;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) invalid(field);
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(field);
  return value.trim();
}

function number(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) invalid(field);
  return parsed;
}

function nonNegative(value: unknown, field: string): number {
  const parsed = number(value, field);
  if (parsed < 0) invalid(field);
  return parsed;
}

function nullableNumber(value: unknown, field: string): number | null {
  return value === null ? null : nonNegative(value, field);
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function strings(value: unknown, field: string): string[] {
  return array(value, field).map((item, index) => text(item, `${field}.${index}`));
}

function exactLabels(rows: Array<{ label: string }>, size: number, field: string) {
  if (rows.length !== size || new Set(rows.map((item) => item.label)).size !== size) invalid(field);
}

export function normalizeB2LiquidityHistory(value: unknown): B2LiquidityHistory {
  return normalizeB2LiquidityHistoryContract(value);
  /* c8 ignore start -- legacy parser retained temporarily for a low-conflict dirty-worktree migration */
  const source = row(value, "B2.root");
  const flowWindows = array(source.flowWindows, "B2.flowWindows").map((value, index) => {
    const item = row(value, `B2.flowWindows.${index}`);
    return {
      label: text(item.label, `B2.flowWindows.${index}.label`),
      inflowWan: nonNegative(item.inflowWan, `B2.flowWindows.${index}.inflowWan`),
      outflowWan: nonNegative(item.outflowWan, `B2.flowWindows.${index}.outflowWan`),
      netWan: number(item.netWan, `B2.flowWindows.${index}.netWan`),
    };
  });
  const monthlyNewDeposits = array(source.monthlyNewDeposits, "B2.monthlyNewDeposits").map((value, index) => {
    const item = row(value, `B2.monthlyNewDeposits.${index}`);
    return {
      label: text(item.label, `B2.monthlyNewDeposits.${index}.label`),
      amountWan: nonNegative(item.amountWan, `B2.monthlyNewDeposits.${index}.amountWan`),
    };
  });
  exactLabels(flowWindows, 8, "B2.flowWindows");
  exactLabels(monthlyNewDeposits, 8, "B2.monthlyNewDeposits");
  return {
    generatedAt: text(source.generatedAt, "B2.generatedAt"),
    flowWindows,
    monthlyNewDeposits,
    sources: strings(source.sources, "B2.sources"),
  };
  /* c8 ignore stop */
}

export function normalizeB4GrowthFlowHistory(value: unknown): B4GrowthFlowHistory {
  return normalizeB4GrowthFlowHistoryContract(value);
  /* c8 ignore start -- legacy parser retained temporarily for a low-conflict dirty-worktree migration */
  const source = row(value, "B4.root");
  const ratioSeries = array(source.ratioSeries, "B4.ratioSeries").map((value, index) => {
    const item = row(value, `B4.ratioSeries.${index}`);
    return {
      label: text(item.label, `B4.ratioSeries.${index}.label`),
      newInflowWan: nonNegative(item.newInflowWan, `B4.ratioSeries.${index}.newInflowWan`),
      outflowWan: nonNegative(item.outflowWan, `B4.ratioSeries.${index}.outflowWan`),
      ratio: nullableNumber(item.ratio, `B4.ratioSeries.${index}.ratio`),
    };
  });
  exactLabels(ratioSeries, 8, "B4.ratioSeries");
  const budgetSource = row(source.budget, "B4.budget");
  const available = boolean(budgetSource.available, "B4.budget.available");
  const budgetRows = array(budgetSource.rows, "B4.budget.rows").map((value, index) => {
    const item = row(value, `B4.budget.rows.${index}`);
    const key = text(item.key, `B4.budget.rows.${index}.key`);
    if (!["acquisition", "commission", "genesis", "reserve"].includes(key)) invalid(`B4.budget.rows.${index}.key`);
    return {
      key: key as "acquisition" | "commission" | "genesis" | "reserve",
      label: text(item.label, `B4.budget.rows.${index}.label`),
      amountUsdt: nonNegative(item.amountUsdt, `B4.budget.rows.${index}.amountUsdt`),
      sharePct: nonNegative(item.sharePct, `B4.budget.rows.${index}.sharePct`),
      source: text(item.source, `B4.budget.rows.${index}.source`),
    };
  });
  if (available) {
    if (budgetRows.length !== 4 || new Set(budgetRows.map((item) => item.key)).size !== 4) invalid("B4.budget.rows");
    const totalShare = budgetRows.reduce((sum, item) => sum + item.sharePct, 0);
    if (Math.abs(totalShare - 100) > 0.1) invalid("B4.budget.sharePct");
  } else if (budgetRows.length) {
    invalid("B4.budget.failClosedRows");
  }
  const healthyRatio = nonNegative(source.healthyRatio, "B4.healthyRatio");
  if (healthyRatio !== 1.2) invalid("B4.healthyRatio");
  return {
    generatedAt: text(source.generatedAt, "B4.generatedAt"),
    healthyRatio,
    currentRatio: nullableNumber(source.currentRatio, "B4.currentRatio"),
    suggestion: text(source.suggestion, "B4.suggestion"),
    ratioSeries,
    budget: {
      available,
      totalUsdt: budgetSource.totalUsdt === undefined ? undefined : nonNegative(budgetSource.totalUsdt, "B4.budget.totalUsdt"),
      reason: budgetSource.reason === undefined ? undefined : text(budgetSource.reason, "B4.budget.reason"),
      missingKeys: strings(budgetSource.missingKeys, "B4.budget.missingKeys"),
      rows: budgetRows,
    },
    sources: strings(source.sources, "B4.sources"),
  };
  /* c8 ignore stop */
}

async function request(endpoint: string) {
  const response = await guardedFetch(endpoint, { cache: "no-store" });
  const result = (await response.json().catch(() => null)) as ApiResult<unknown> | null;
  if (!response.ok || !result || result.code !== 0 || result.data === undefined) {
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    throw new Error(formatAdminApiError(result?.message, `B_RESTORATION_LOAD_FAILED_${response.status}`));
  }
  return result.data;
}

export async function fetchB2LiquidityHistory() {
  return normalizeB2LiquidityHistory(await request("/api/admin/treasury/liquidity-history"));
}

export async function fetchB4GrowthFlowHistory() {
  return normalizeB4GrowthFlowHistory(await request("/api/admin/treasury/growth-flow-history"));
}

function useHistory<T>(loader: () => Promise<T>, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      setData(await loader());
    } catch (cause) {
      setData(null);
      setError(displayAdminError(cause));
    } finally {
      setLoading(false);
    }
  }, [enabled, loader]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, loading, error, reload };
}

export function useB2LiquidityHistory(enabled = true) {
  return useHistory(fetchB2LiquidityHistory, enabled);
}

export function useB4GrowthFlowHistory(enabled = true) {
  return useHistory(fetchB4GrowthFlowHistory, enabled);
}
