import type { LeaderboardPage } from "@/lib/admin/support-leaderboard-client";
import type { SupportAnalyticsResponse } from "@/lib/admin/support-analytics-client";
import { PERFORMANCE_CHANNEL_LABELS, type PerformanceTotals, type ProfilePerformance, type performanceEvents, type performanceMeasured } from "@/lib/admin/support-performance-contract";
import { PERF_UNAVAILABLE, PERF_UNAVAILABLE_VALUE, type AnalyticsPerf, type PerfCount, type PerfEvents, type PerfTotals, type PerfValue } from "./perf-view";

const UPGRADING = "数据正在升级";
const NO_PROJECTION: Extract<PerfValue, { state: "unavailable" }> = { state: "unavailable", reason: "暂时无法确认" };

function measurement<T extends string | number>(value: ReturnType<typeof performanceMeasured<T>>) {
  const reason = value.reasons.includes("GENERATION_UPGRADING") ? UPGRADING : "暂时无法确认";
  if (value.status === "COMPLETE" && value.value !== null) return { state: "complete" as const, value: value.value };
  if (value.status === "PARTIAL") return { state: "partial" as const, observed: value.observed, missing: "部分数据还在核对" };
  return { state: "unavailable" as const, reason };
}

export function boardTotals(value: PerformanceTotals): PerfTotals {
  return { amount: measurement(value.amount), inflow: measurement(value.inflow), withdrawal: measurement(value.withdrawal) };
}

export type BoardPerf = { kind: "ready"; byAgent: Record<string, PerfTotals> } | { kind: "unavailable"; reason: string };
export function leaderboardPerf(page: LeaderboardPage): BoardPerf {
  if (page.generation !== "READY") return { kind: "unavailable", reason: PERF_UNAVAILABLE };
  const rows = [...page.rows, ...(page.podium?.rows ?? []), ...(page.self.row ? [page.self.row] : [])];
  return { kind: "ready", byAgent: Object.fromEntries(rows.flatMap(row => row.performance ? [[row.id, boardTotals(row.performance)]] : [])) };
}

export function analyticsPerf(data: SupportAnalyticsResponse | null, personalPeriod: SupportAnalyticsResponse | null): AnalyticsPerf {
  const none = data?.generation === "READY" ? NO_PROJECTION
    : data?.generation === "UPGRADING" ? { state: "unavailable" as const, reason: UPGRADING } : PERF_UNAVAILABLE_VALUE;
  const amount = (record?: PerformanceTotals) => record ? measurement(record.amount) : none;
  const projection = data?.performance, period = personalPeriod?.performance?.period;
  const customers = data?.view === "OVERVIEW" || data?.view === "CUSTOMERS" || data?.view === "ACTIVITY" ? data.records : [];
  return {
    period: period ? {
      totals: boardTotals(period.totals), first: measurement(period.first),
      inflow: period.inflow.flatMap(row => {
        const label = PERFORMANCE_CHANNEL_LABELS[row.channel];
        const main = { label, value: measurement(row.net) };
        const correction = row.correction.value ?? row.correction.observed;
        return correction !== null && Number(correction) !== 0
          ? [main, { label: `${label} · 其中本期更正`, value: measurement(row.correction), sub: true }] : [main];
      }),
      withdrawals: period.withdrawals.map(row => ({
        label: PERFORMANCE_CHANNEL_LABELS[row.channel], walletDebited: measurement(row.walletDebited), fee: measurement(row.fee), received: measurement(row.received),
      })),
    } : { unavailable: personalPeriod?.generation === "UPGRADING" ? UPGRADING : none.reason },
    customers: Object.fromEntries(customers.map(row => [row.customerId, amount(row.performance)])),
    agents: Object.fromEntries(data?.view === "AGENTS" ? data.records.map(row => [row.accountId, amount(row.performance)]) : []),
    groups: Object.fromEntries(Object.entries(projection?.groups ?? {}).map(([id, row]) => [id, { period: amount(row.period), current: amount(row.current) }])),
    scope: { period: projection?.period ? boardTotals(projection.period.totals) : { amount: none, inflow: none, withdrawal: none }, current: amount(projection?.current) },
    attribution: projection?.attribution && { unassigned: amount(projection.attribution.unassigned), unknown: amount(projection.attribution.unknown) },
  };
}

const EVENT_LABELS = { INFLOW: "入金", WITHDRAWAL: "提现", CORRECTION: "更正", DEVICE_PURCHASE: "购机", REFUND: "退款", MANUAL_CREDIT: "钱包加款", REWARD: "奖励" };
export function eventsPerf(events: Awaited<ReturnType<typeof performanceEvents>>): PerfEvents {
  const summary = (part: typeof events.totals): { amount: PerfValue; count: PerfCount; customers: PerfCount } => ({
    amount: measurement(part.amount), count: measurement(part.count), customers: measurement(part.customers),
  });
  return {
    from: events.window.from, to: events.window.to, total: summary(events.totals),
    visible: summary(events.visible), restricted: summary(events.restricted),
    rows: events.rows.map(row => ({
      id: row.id, at: row.at, customer: row.customer ?? "—", customerNo: row.customerNo ?? "—", kind: EVENT_LABELS[row.kind],
      detail: row.status === "PENDING_REVIEW" ? "待核对" : PERFORMANCE_CHANNEL_LABELS[row.channel] ?? "—",
      business: row.business === null ? null : `${row.business} ${row.currency ?? ""}`.trim(), delta: row.delta,
    })),
  };
}

export function profilePerf(profile?: ProfilePerformance) {
  const value = profile?.finance ?? profile?.statistics;
  return {
    cumulative: value ? measurement(value.amount) : profile?.generation === "UPGRADING" ? { state: "unavailable" as const, reason: UPGRADING } : PERF_UNAVAILABLE_VALUE,
    both: Boolean(profile?.finance && profile.statistics),
    firstSource: profile?.firstChannel ? PERFORMANCE_CHANNEL_LABELS[profile.firstChannel] : undefined,
  };
}
