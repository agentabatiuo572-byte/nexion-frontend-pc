"use client";

/**
 * 今日概览自己的读取。只读现有接口，字段都在这里校验一次，页面拿到的是类型化的值。
 * 其余数据用各自的 client：b-domain、reserve、flowWindows、A2、提现、客服待办、J1、转化。
 */
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { finiteDashboardNumber } from "@/lib/admin/dashboard-number";
import type { KpiTrendPoint } from "@/lib/admin/kpi-trend";
import { announcePermissionDenied } from "@/lib/admin/operation-confirm-error";

type ApiResult<T> = { code: number; message?: string; data?: T };
type Row = Record<string, unknown>;

async function read(endpoint: string, exactMoney = false): Promise<Row> {
  const response = await guardedFetch(endpoint, { cache: "no-store" });
  const result = (await (exactMoney ? response.text().then(text => JSON.parse(text.replace(/("(?:amountUsdt|previousAmountUsdt|bep20Usdt|erc20Usdt|trc20Usdt|bankUsdt|externalDirectUsdt|legacyCardUsdt|otherUsdt|usdt|vndPrincipalUsdt|feesUsdt|grossUsdt|refundsUsdt|averageOrderUsdt)"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"'))) : response.json()).catch(() => null)) as ApiResult<Row> | null;
  if (!response.ok || !result || result.code !== 0 || !result.data) {
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    if (response.status === 403) announcePermissionDenied();
    throw new Error(formatAdminApiError(result?.message, `B0_LOAD_FAILED_${response.status}`));
  }
  return result.data;
}

function invalid(field: string): never {
  throw new Error(`B0_RESPONSE_INVALID:${field}`);
}

function amount(value: unknown, field: string): number {
  return finiteDashboardNumber(value) ?? invalid(field);
}

function count(value: unknown, field = "count"): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : invalid(field);
}

export async function fetchB0ExchangeQueue() {
  const data = await read("/api/admin/market/exchange");
  const stats = data.stats as Row | undefined;
  const estimate = data.queueEstimate as Row | undefined;
  const hours = typeof estimate?.hours === "string" ? estimate.hours.trim() : "";
  return {
    depth: count(stats?.queueDepth, "stats.queueDepth"),
    estimateHours: /^[1-9][0-9]{0,2}$/.test(hours) ? Number(hours) : null,
  };
}

export async function fetchB0ReferralPending() {
  const data = await read("/api/admin/growth/referral-rewards?pageSize=1");
  return count(data.pending, "pending");
}

export async function fetchB0PromotionUnfulfilled() {
  const data = await read("/api/admin/growth/promotions?limit=1");
  const summary = data.summary as Row | undefined;
  return count(summary?.unfulfilledRewards, "summary.unfulfilledRewards");
}

export async function fetchB0RiskManualReview() {
  const data = await read("/api/admin/risk/overview");
  return count(data.manualReview, "manualReview");
}

export type B0Period = "today" | "week" | "month";
export type B0SummaryPeriod = B0Period | "all";
type MoneyBlock = {
  amountUsdt: string | null; previousAmountUsdt: string | null;
  available: boolean; reason?: string; previousUnavailableReason?: string;
  breakdown?: Record<string, string | number | null>;
  previousBreakdown?: Record<string, string | number | null>;
  inTransit?: { count: number; amountUsdt: string; asOf: string };
};
export type B0BusinessSummary = {
  period: B0SummaryPeriod; timezone: string; statisticsStart: string;
  asOf: string; generatedAt: string; rollupAsOf: string;
  range: { from: string; toExclusive: string }; comparison: { from: string; toExclusive: string } | null;
  blocks: {
    deposits?: MoneyBlock; withdrawals?: MoneyBlock; netDeposits?: MoneyBlock; sales?: MoneyBlock;
    registrations?: { count: number; previousCount: number | null; cumulativeCount: number;
      firstDepositCount: number; previousFirstDepositCount: number | null; firstPurchaseCount: number; previousFirstPurchaseCount: number | null;
      trendGranularity: "day" | "week" | "month"; trend: { from: string; count: number }[] };
    activeUsers?: { available: boolean; count: number | null; previousCount: number | null; reason?: string;
      devices?: { online: number; abnormal: number; asOf: string } };
  };
};

/** B36 is the only source of operating totals, including unavailable blocks and same-elapsed-time comparisons. */
export async function fetchB0BusinessSummary(period: B0SummaryPeriod, registrationGranularity: "day" | "week" | "month" = "day"): Promise<B0BusinessSummary> {
  const raw = await read(`/api/admin/overview/business-summary?period=${period}&registrationGranularity=${registrationGranularity}`, true);
  const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : invalid("object");
  const text = (value: unknown): string => typeof value === "string" && value.length > 0 ? value : invalid("text");
  const money = (value: unknown): string => typeof value === "string" && /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) ? value : invalid("amount");
  const stamp = (value: unknown): string => { const result = text(value); return /(?:Z|[+-]\d{2}:\d{2})$/.test(result) && Number.isFinite(Date.parse(result)) ? result : invalid("instant"); };
  const date = (value: unknown): string => { const result = text(value); return /^\d{4}-\d{2}-\d{2}$/.test(result) && new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) === result ? result : invalid("date"); };
  const range = (value: unknown) => { const r = row(value); return { from: stamp(r.from), toExclusive: stamp(r.toExclusive) }; };
  const blocks: B0BusinessSummary["blocks"] = {};
  const source = row(raw.blocks);
  for (const key of ["deposits", "withdrawals", "netDeposits", "sales"] as const) {
    if (source[key] === undefined) continue; // Permission omission is distinct from a successful zero.
    const r = row(source[key]);
    if (r.available !== undefined && typeof r.available !== "boolean") invalid("available");
    const available = r.available !== false;
    const result: MoneyBlock = { available, amountUsdt: r.amountUsdt === null && !available ? null : money(r.amountUsdt), previousAmountUsdt: r.previousAmountUsdt === null ? null : money(r.previousAmountUsdt) };
    if (!available) result.reason = text(r.reason);
    if (r.previousUnavailableReason !== undefined) result.previousUnavailableReason = text(r.previousUnavailableReason);
    for (const field of ["breakdown", "previousBreakdown"] as const) {
      if (r[field] === undefined) continue;
      const b = row(r[field]);
      const fields = key === "deposits" ? ["bep20Usdt", "erc20Usdt", "trc20Usdt", "bankUsdt", "externalDirectUsdt", "legacyCardUsdt", "otherUsdt", "count"]
        : key === "withdrawals" ? ["usdt", "vndPrincipalUsdt", "feesUsdt", "count"] : ["grossUsdt", "refundsUsdt", "orderCount", "averageOrderUsdt"];
      result[field] = Object.fromEntries(fields.map(name => [name, name === "count" || name === "orderCount" ? count(b[name]) : name === "averageOrderUsdt" && b[name] === null ? null : money(b[name])]));
    }
    if (key === "withdrawals") { const stock = row(r.inTransit); result.inTransit = { count: count(stock.count), amountUsdt: money(stock.amountUsdt), asOf: stamp(stock.asOf) }; }
    blocks[key] = result;
  }
  if (source.registrations !== undefined) {
    const r = row(source.registrations);
    if (!["day", "week", "month"].includes(String(r.trendGranularity)) || !Array.isArray(r.trend)) invalid("trend");
    const trend = (r.trend as unknown[]).map(value => { const point = row(value); return { from: date(point.from), count: count(point.count) }; });
    if (trend.some((point, index) => index > 0 && point.from <= trend[index - 1].from)) invalid("trend.order");
    blocks.registrations = { count: count(r.count), previousCount: r.previousCount === null ? null : count(r.previousCount), cumulativeCount: count(r.cumulativeCount),
      firstDepositCount: count(r.firstDepositCount), previousFirstDepositCount: r.previousFirstDepositCount === null ? null : count(r.previousFirstDepositCount),
      firstPurchaseCount: count(r.firstPurchaseCount), previousFirstPurchaseCount: r.previousFirstPurchaseCount === null ? null : count(r.previousFirstPurchaseCount),
      trendGranularity: r.trendGranularity as "day" | "week" | "month", trend };
  }
  if (source.activeUsers !== undefined) {
    const r = row(source.activeUsers);
    if (typeof r.available !== "boolean") invalid("active.available");
    const active: NonNullable<B0BusinessSummary["blocks"]["activeUsers"]> = { available: r.available as boolean, count: r.available === false && r.count === null ? null : count(r.count), previousCount: r.previousCount === null ? null : count(r.previousCount) };
    if (!active.available) active.reason = text(r.reason);
    if (r.devices !== undefined) { const d = row(r.devices); active.devices = { online: count(d.online), abnormal: count(d.abnormal), asOf: stamp(d.asOf) }; }
    blocks.activeUsers = active;
  }
  if (raw.period !== period) invalid("period");
  return { period, timezone: text(raw.timezone), statisticsStart: date(raw.statisticsStart), asOf: stamp(raw.asOf), generatedAt: stamp(raw.generatedAt), rollupAsOf: stamp(raw.rollupAsOf),
    range: range(raw.range), comparison: raw.comparison === null && period === "all" ? null : range(raw.comparison), blocks };
}

export async function fetchB0Business() {
  const [today, week, month, all] = await Promise.all((["today", "week", "month", "all"] as const).map(period => fetchB0BusinessSummary(period)));
  return { today, week, month, all };
}

/** 今天的提现提交、完成、拒绝笔数和平均到账小时数。 */
export async function fetchB0Redemption() {
  const data = await read("/api/admin/bi/finance/redemption?period=day");
  return {
    submitted: amount(data.submitted, "submitted"),
    confirmed: amount(data.confirmed, "confirmed"),
    rejected: amount(data.rejected, "rejected"),
    averageLatencyHours: finiteDashboardNumber(data.averageLatencyHours),
  };
}

export async function fetchB0Devices() {
  const data = await read("/api/admin/devices/overview");
  return {
    total: amount(data.total, "total"),
    running: amount(data.running, "running"),
    waitingActivation: amount(data.waitingActivation, "waitingActivation"),
    stopped: amount(data.stopped, "stopped"),
    errorRetry: amount(data.errorRetry, "errorRetry"),
    legacyPending: amount(data.legacyPending, "legacyPending"),
    waitingConfig: amount(data.waitingConfig, "waitingConfig"),
  };
}

export type B0Kpi = {
  n: number;
  label: string;
  value: string;
  target: string;
  pass: boolean | null;
  /** 分母不足 5，不算比例（决定 8）。 */
  smallSample: boolean;
  series: KpiTrendPoint[];
  trendLabels: string[];
  trendSuppressed: boolean;
  hint: string;
};

function kpiTarget(row: Row): string | null {
  const unit = typeof row.unit === "string" ? row.unit : "";
  if (row.dir === "band") {
    const [low, high] = Array.isArray(row.band) ? row.band.map(finiteDashboardNumber) : [];
    return low == null || high == null ? null : `${low}-${high}${unit}`;
  }
  const target = finiteDashboardNumber(row.target);
  if (target == null || (row.dir !== "lte" && row.dir !== "gte")) return null;
  return `${row.dir === "lte" ? "<" : ">"}${target}${unit}`;
}

/** 区间是闭区间，lte、gte 严格比较，等于目标不算达标；值缺失是暂无法计算，不是未达标（B0-C02）。 */
function kpiPass(row: Row): boolean | null {
  const value = finiteDashboardNumber(row.value);
  if (value == null) return null;
  if (row.dir === "band") {
    const [low, high] = Array.isArray(row.band) ? row.band.map(finiteDashboardNumber) : [];
    return low == null || high == null ? null : value >= low && value <= high;
  }
  const target = finiteDashboardNumber(row.target);
  if (target == null) return null;
  return row.dir === "lte" ? value < target : row.dir === "gte" ? value > target : null;
}

/** 关键指标。名称或目标不合法的行丢掉，数量不强凑 8 项（B0-V14）。 */
export async function fetchB0Kpis(): Promise<B0Kpi[]> {
  const data = await read("/api/admin/bi/kpi/overview");
  if (!Array.isArray(data.kpis)) invalid("kpis");
  const plain = (data.kpiPlain ?? {}) as Row;
  const ext = (data.kpiExt ?? {}) as Record<string, Row>;
  return (data.kpis as Row[]).flatMap((row, index) => {
    const n = finiteDashboardNumber(row.n) ?? index + 1;
    const label = typeof row.name === "string" ? row.name.trim() : "";
    const target = kpiTarget(row);
    if (!label || target == null) return [];
    const value = finiteDashboardNumber(row.value);
    const denominator = finiteDashboardNumber(row.denominator);
    const smallSample = row.suppressed === true || (denominator != null && denominator < 5);
    const hint = plain[String(n)] ?? ext[String(n)]?.note ?? row.vis;
    return [{
      n,
      label,
      value: smallSample ? "样本过小" : value == null ? "—" : `${value}${typeof row.unit === "string" ? row.unit : ""}`,
      target,
      pass: smallSample ? null : kpiPass(row),
      smallSample,
      series: !smallSample && Array.isArray(row.spark) ? row.spark.map(finiteDashboardNumber) : [],
      trendLabels: Array.isArray(data.weeks) ? data.weeks.map(String) : [],
      trendSuppressed: Array.isArray(row.sparkSuppressed) && row.sparkSuppressed.includes(true),
      hint: typeof hint === "string" ? hint : "",
    }];
  });
}
