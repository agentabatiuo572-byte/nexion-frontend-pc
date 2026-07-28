const REVENUE_STREAMS = new Set([
  "device_sales",
  "team_commission",
  "token_economy",
  "compute_matching",
]);

const LIABILITY_CATEGORIES = new Set([
  "withdrawable_balance",
  "usdt_staking_principal",
  "staking_interest",
  "genesis_daily_emission",
  "nex_v2_future",
  "withdrawal_queue",
  "commission_cooling",
  "lock_other",
  "unverified_deposit",
]);

export type L3FinanceRawContract = {
  overview: Record<string, unknown>;
  revenue: Record<string, unknown>;
  redemption: Record<string, unknown>;
  coverage: Record<string, unknown>;
  liabilities: Record<string, unknown>;
  maturity7: Record<string, unknown>;
  maturity30: Record<string, unknown>;
};

function fail(field: string): never {
  throw new Error(`L3_FINANCE_PROTOCOL_INVALID:${field}`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(field);
  return value as Record<string, unknown>;
}

function list(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail(field);
  return value;
}

function text(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) fail(field);
  return value.trim();
}

function number(value: unknown, field: string, minimum = 0) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) fail(field);
  return value;
}

function integer(value: unknown, field: string) {
  const parsed = number(value, field);
  if (!Number.isSafeInteger(parsed)) fail(field);
  return parsed;
}

function nullableNumber(value: unknown, field: string) {
  return value === null ? null : number(value, field);
}

function close(actual: number, expected: number, field: string, tolerance = 0.02) {
  if (Math.abs(actual - expected) > tolerance) fail(field);
}

function isoDate(value: unknown, field: string) {
  const result = text(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) fail(field);
  return result;
}

function period(value: unknown, field: string) {
  const item = record(value, field);
  const granularity = text(item.granularity, `${field}.granularity`);
  if (!["day", "week", "month", "quarter", "custom"].includes(granularity)) fail(`${field}.granularity`);
  const from = isoDate(item.from, `${field}.from`);
  const to = isoDate(item.to, `${field}.to`);
  if (from > to) fail(`${field}.range`);
  return {
    granularity,
    from,
    to,
    label: text(item.label, `${field}.label`),
    timeZone: text(item.timeZone, `${field}.timeZone`),
  };
}

function assertConsecutiveDaily(value: unknown, days: number, field: string) {
  const rows = list(value, field).map((row, index) => {
    const item = record(row, `${field}[${index}]`);
    const date = isoDate(item.date, `${field}[${index}].date`);
    const withdraw = number(item.withdrawDueUsdt, `${field}[${index}].withdrawDueUsdt`);
    const interest = number(item.interestDueUsdt, `${field}[${index}].interestDueUsdt`);
    const genesis = number(item.genesisDividendUsdt, `${field}[${index}].genesisDividendUsdt`);
    const trial = number(item.trialShadowStressUsdt, `${field}[${index}].trialShadowStressUsdt`);
    close(
      number(item.totalDueUsdt, `${field}[${index}].totalDueUsdt`),
      withdraw + interest + genesis + trial,
      `${field}[${index}].total`,
    );
    return date;
  });
  if (rows.length !== days) fail(`${field}.length`);
  rows.forEach((date, index) => {
    if (index === 0) return;
    const expected = new Date(`${rows[index - 1]}T00:00:00Z`);
    expected.setUTCDate(expected.getUTCDate() + 1);
    if (date !== expected.toISOString().slice(0, 10)) fail(`${field}.consecutive`);
  });
}

/**
 * Fail-closed boundary for L3's seven independent HTTP 200 payloads.
 *
 * The UI must never coerce a missing/malformed financial field to zero. This
 * function validates source identity, cardinality and cross-source arithmetic
 * before the view mapper is allowed to format anything.
 */
export function assertL3FinanceContract(input: L3FinanceRawContract): L3FinanceRawContract {
  const revenuePeriod = period(input.revenue.period, "revenue.period");
  if (input.revenue.serverAuthoritative !== true) fail("revenue.serverAuthoritative");
  const revenueRows = list(input.revenue.streams, "revenue.streams");
  if (revenueRows.length !== REVENUE_STREAMS.size) fail("revenue.streams.length");
  const seenStreams = new Set<string>();
  const revenueSum = revenueRows.reduce<number>((sum, row, index) => {
    const item = record(row, `revenue.streams[${index}]`);
    const stream = text(item.stream, `revenue.streams[${index}].stream`);
    if (!REVENUE_STREAMS.has(stream) || seenStreams.has(stream)) fail("revenue.streams.identity");
    seenStreams.add(stream);
    text(item.label, `revenue.streams[${index}].label`);
    text(item.source, `revenue.streams[${index}].source`);
    const amount = number(item.amountUsdt, `revenue.streams[${index}].amountUsdt`);
    number(item.previousAmountUsdt, `revenue.streams[${index}].previousAmountUsdt`);
    nullableNumber(item.share, `revenue.streams[${index}].share`);
    nullableNumber(item.momDelta, `revenue.streams[${index}].momDelta`);
    return sum + amount;
  }, 0);
  close(number(input.revenue.totalUsdt, "revenue.totalUsdt"), revenueSum, "revenue.totalUsdt");

  const redemptionPeriod = period(input.redemption.period, "redemption.period");
  if (input.redemption.serverAuthoritative !== true) fail("redemption.serverAuthoritative");
  if (!text(input.redemption.source, "redemption.source").includes("A4")) fail("redemption.source");
  ["submitted", "confirmed", "rejected", "delayed", "frozen"].forEach((key) => {
    integer(input.redemption[key], `redemption.${key}`);
  });
  nullableNumber(input.redemption.averageLatencyHours, "redemption.averageLatencyHours");
  nullableNumber(input.redemption.redemptionRate, "redemption.redemptionRate");
  nullableNumber(input.redemption.previousRate, "redemption.previousRate");
  text(input.redemption.previousLabel, "redemption.previousLabel");
  if (JSON.stringify(revenuePeriod) !== JSON.stringify(redemptionPeriod)) fail("period.crossSource");

  const reserve = number(input.coverage.reserveTotalUsdt, "coverage.reserveTotalUsdt");
  const liability = number(input.coverage.liabilityTotalUsdt, "coverage.liabilityTotalUsdt");
  number(input.coverage.coverageRatio, "coverage.coverageRatio");
  const redLine = number(input.coverage.redLine, "coverage.redLine");
  const yellowLine = number(input.coverage.yellowLine, "coverage.yellowLine");
  if (yellowLine < redLine) fail("coverage.thresholdOrder");
  close(number(input.coverage.netExposureUsdt, "coverage.netExposureUsdt", -Number.MAX_VALUE), reserve - liability, "coverage.netExposureUsdt");
  if (!text(input.coverage.source, "coverage.source").includes("B1")) fail("coverage.source");
  const coverageSeries = list(input.coverage.series, "coverage.series");
  if (coverageSeries.length < 2) fail("coverage.series.length");
  coverageSeries.forEach((row, index) => {
    const item = record(row, `coverage.series[${index}]`);
    text(item.period, `coverage.series[${index}].period`);
    number(item.coverageRatio, `coverage.series[${index}].coverageRatio`);
  });
  list(input.coverage.breaches, "coverage.breaches");

  if (integer(input.liabilities.hardLiabilityCategoryCount, "liabilities.hardLiabilityCategoryCount") !== 9) {
    fail("liabilities.hardLiabilityCategoryCount");
  }
  if (input.liabilities.trialShadowIncluded !== false) fail("liabilities.trialShadowIncluded");
  const liabilityRows = list(input.liabilities.breakdown, "liabilities.breakdown");
  if (liabilityRows.length !== LIABILITY_CATEGORIES.size) fail("liabilities.breakdown.length");
  const seenLiabilities = new Set<string>();
  const liabilitySum = liabilityRows.reduce<number>((sum, row, index) => {
    const item = record(row, `liabilities.breakdown[${index}]`);
    const category = text(item.category, `liabilities.breakdown[${index}].category`);
    if (!LIABILITY_CATEGORIES.has(category) || seenLiabilities.has(category)) fail("liabilities.breakdown.identity");
    seenLiabilities.add(category);
    text(item.label, `liabilities.breakdown[${index}].label`);
    text(item.source, `liabilities.breakdown[${index}].source`);
    const share = number(item.share, `liabilities.breakdown[${index}].share`);
    if (share > 1) fail(`liabilities.breakdown[${index}].share`);
    return sum + number(item.amountUsdt, `liabilities.breakdown[${index}].amountUsdt`);
  }, 0);
  close(number(input.liabilities.totalUsdt, "liabilities.totalUsdt"), liabilitySum, "liabilities.totalUsdt");
  close(liability, liabilitySum, "coverage.liabilityCrossSource");

  if (text(input.maturity7.window, "maturity7.window") !== "7d") fail("maturity7.window");
  if (text(input.maturity30.window, "maturity30.window") !== "30d") fail("maturity30.window");
  assertConsecutiveDaily(input.maturity7.daily, 7, "maturity7.daily");
  assertConsecutiveDaily(input.maturity30.daily, 30, "maturity30.daily");
  number(input.maturity7.reserveCoverDays, "maturity7.reserveCoverDays");
  number(input.maturity30.reserveCoverDays, "maturity30.reserveCoverDays");

  record(input.overview, "overview");
  return input;
}
