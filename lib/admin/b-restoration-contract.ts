import { parseStrictFiniteNumber } from "./strict-number.ts";
import { isConsecutiveDayLabels, isConsecutiveMonthLabels } from "./time-series-contract.ts";

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
  ratioSeries: Array<{
    label: string;
    newInflowWan: number;
    outflowWan: number;
    newInflowUsdt: number;
    outflowUsdt: number;
    ratio: number | null;
  }>;
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
  const parsed = parseStrictFiniteNumber(value);
  if (parsed === null) invalid(field);
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

function close(actual: number, expected: number, tolerance: number, field: string) {
  if (Math.abs(actual - expected) > tolerance) invalid(field);
}

export function normalizeB2LiquidityHistory(value: unknown): B2LiquidityHistory {
  const source = row(value, "B2.root");
  const flowWindows = array(source.flowWindows, "B2.flowWindows").map((value, index) => {
    const item = row(value, `B2.flowWindows.${index}`);
    const inflowWan = nonNegative(item.inflowWan, `B2.flowWindows.${index}.inflowWan`);
    const outflowWan = nonNegative(item.outflowWan, `B2.flowWindows.${index}.outflowWan`);
    const netWan = number(item.netWan, `B2.flowWindows.${index}.netWan`);
    close(netWan, inflowWan - outflowWan, 0.011, `B2.flowWindows.${index}.netWan`);
    return { label: text(item.label, `B2.flowWindows.${index}.label`), inflowWan, outflowWan, netWan };
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
  if (!isConsecutiveDayLabels(flowWindows.map((item) => item.label))) invalid("B2.flowWindows");
  if (!isConsecutiveMonthLabels(monthlyNewDeposits.map((item) => item.label))) invalid("B2.monthlyNewDeposits");
  return {
    generatedAt: text(source.generatedAt, "B2.generatedAt"),
    flowWindows,
    monthlyNewDeposits,
    sources: strings(source.sources, "B2.sources"),
  };
}

export function normalizeB4GrowthFlowHistory(value: unknown): B4GrowthFlowHistory {
  const source = row(value, "B4.root");
  const ratioSeries = array(source.ratioSeries, "B4.ratioSeries").map((value, index) => {
    const item = row(value, `B4.ratioSeries.${index}`);
    const newInflowUsdt = nonNegative(item.newInflowUsdt, `B4.ratioSeries.${index}.newInflowUsdt`);
    const outflowUsdt = nonNegative(item.outflowUsdt, `B4.ratioSeries.${index}.outflowUsdt`);
    const ratioValue = nullableNumber(item.ratio, `B4.ratioSeries.${index}.ratio`);
    if (outflowUsdt === 0) {
      if (ratioValue !== null) invalid(`B4.ratioSeries.${index}.ratio`);
    } else {
      if (ratioValue === null) invalid(`B4.ratioSeries.${index}.ratio`);
      const expected = Math.round((newInflowUsdt / outflowUsdt) * 10_000) / 10_000;
      close(ratioValue, expected, 0.00005, `B4.ratioSeries.${index}.ratio`);
    }
    const newInflowWan = nonNegative(item.newInflowWan, `B4.ratioSeries.${index}.newInflowWan`);
    const outflowWan = nonNegative(item.outflowWan, `B4.ratioSeries.${index}.outflowWan`);
    close(newInflowWan, newInflowUsdt / 10_000, 0.0051, `B4.ratioSeries.${index}.newInflowWan`);
    close(outflowWan, outflowUsdt / 10_000, 0.0051, `B4.ratioSeries.${index}.outflowWan`);
    return {
      label: text(item.label, `B4.ratioSeries.${index}.label`),
      newInflowWan,
      outflowWan,
      newInflowUsdt,
      outflowUsdt,
      ratio: ratioValue,
    };
  });
  exactLabels(ratioSeries, 8, "B4.ratioSeries");
  if (!isConsecutiveMonthLabels(ratioSeries.map((item) => item.label))) invalid("B4.ratioSeries");
  const healthyRatio = nonNegative(source.healthyRatio, "B4.healthyRatio");
  if (healthyRatio !== 1.2) invalid("B4.healthyRatio");
  const currentRatio = nullableNumber(source.currentRatio, "B4.currentRatio");
  const latestRatio = ratioSeries.at(-1)?.ratio ?? null;
  if (currentRatio !== latestRatio) invalid("B4.currentRatio");
  const suggestion = text(source.suggestion, "B4.suggestion");
  const expectedSuggestion = currentRatio === null
    ? "数据不足，保持现状"
    : currentRatio >= healthyRatio ? "维持扩张" : "切入收紧";
  if (suggestion !== expectedSuggestion) invalid("B4.suggestion");

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
  const missingKeys = strings(budgetSource.missingKeys, "B4.budget.missingKeys");
  let totalUsdt: number | undefined;
  let reason: string | undefined;
  if (available) {
    if (budgetRows.length !== 4 || new Set(budgetRows.map((item) => item.key)).size !== 4 || missingKeys.length) invalid("B4.budget.rows");
    totalUsdt = nonNegative(budgetSource.totalUsdt, "B4.budget.totalUsdt");
    if (totalUsdt <= 0) invalid("B4.budget.totalUsdt");
    close(budgetRows.reduce((sum, item) => sum + item.amountUsdt, 0), totalUsdt, 0.011, "B4.budget.totalUsdt");
    for (const [index, item] of budgetRows.entries()) {
      const expectedShare = Math.round((item.amountUsdt * 10000) / totalUsdt) / 100;
      close(item.sharePct, expectedShare, 0.0051, `B4.budget.rows.${index}.sharePct`);
    }
  } else {
    if (budgetRows.length) invalid("B4.budget.failClosedRows");
    reason = text(budgetSource.reason, "B4.budget.reason");
  }
  return {
    generatedAt: text(source.generatedAt, "B4.generatedAt"),
    healthyRatio,
    currentRatio,
    suggestion,
    ratioSeries,
    budget: { available, totalUsdt, reason, missingKeys, rows: budgetRows },
    sources: strings(source.sources, "B4.sources"),
  };
}
