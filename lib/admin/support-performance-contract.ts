export const PERFORMANCE_VERSION = "NET_INFLOW_V1";
export const PERFORMANCE_EXPORT_APPROVE = "service_performance_export_approve";
export const PERFORMANCE_EXPORT_SUMMARY = "service_performance_export_summary";
export const PERFORMANCE_EXPORT_DETAIL = "service_performance_export_detail";

export function canReadPerformanceExportApprovals(authorities: readonly string[]) {
  return authorities.includes(PERFORMANCE_EXPORT_APPROVE)
    && authorities.some(code => code === "service_m1_read" || code === "service_m3_read");
}

export function performanceMalformed(field: string): never {
  throw new Error(`SUPPORT_CONTRACT_MALFORMED:performance.${field}`);
}

export function performanceObject(value: unknown, field = "object"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) performanceMalformed(field);
  return value as Record<string, unknown>;
}

export function performanceText(value: unknown): string {
  if (typeof value !== "string") performanceMalformed("string");
  return value;
}

export function performanceList<T>(value: unknown, parse: (entry: unknown) => T): T[] {
  if (!Array.isArray(value)) performanceMalformed("array");
  return value.map(parse);
}

export function performanceEnum<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) performanceMalformed("enum");
  return value as T[number];
}

export function performanceInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) performanceMalformed("integer");
  return value;
}

export function performanceDecimal(value: unknown): string {
  const decimal = performanceText(value);
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(decimal)) performanceMalformed("decimal");
  return decimal;
}

export function performanceInstant(value: unknown): string {
  const instant = performanceText(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(instant)
    || !Number.isFinite(Date.parse(instant)) || new Date(instant).toISOString().slice(0, 19) !== instant.slice(0, 19)) performanceMalformed("instant");
  return instant;
}

export function performanceGeneration(value: unknown) {
  const root = performanceObject(value);
  if (root.metricVersion === undefined && root.generation === undefined) return "LEGACY" as const;
  if (root.metricVersion !== PERFORMANCE_VERSION) performanceMalformed("metricVersion");
  return performanceEnum(root.generation, ["READY", "UPGRADING"]);
}

export function performanceMeasured<T>(value: unknown, parse: (raw: unknown) => T) {
  const row = performanceObject(value);
  const status = performanceEnum(row.status, ["COMPLETE", "PARTIAL", "UNKNOWN", "FAILED"]);
  const confirmed = row.value === null ? null : parse(row.value);
  const observed = row.observed === null ? null : parse(row.observed);
  const reasons = performanceList(row.reasons, performanceText);
  if (status === "COMPLETE" ? confirmed === null || observed !== confirmed || reasons.length !== 0
    : confirmed !== null || status !== "PARTIAL" && observed !== null || reasons.length === 0) performanceMalformed("measurement");
  return { status, value: confirmed, observed, reasons };
}

export function performanceTotals(value: unknown) {
  const row = performanceObject(value);
  if (row.currency !== "USDT") performanceMalformed("currency");
  return {
    amount: performanceMeasured(row.performanceAmount, performanceDecimal),
    inflow: performanceMeasured(row.inflowTotal, performanceDecimal),
    withdrawal: performanceMeasured(row.withdrawalTotal, performanceDecimal),
  };
}

export type PerformanceTotals = ReturnType<typeof performanceTotals>;

export function performanceWindow(value: unknown) {
  const row = performanceObject(value);
  if (row.definitionVersion !== PERFORMANCE_VERSION) performanceMalformed("definitionVersion");
  const result = {
    sourceVersion: performanceText(row.sourceVersion), sourceScopeVersion: performanceText(row.sourceScopeVersion),
    month: row.month === null ? null : performanceText(row.month),
    basis: performanceEnum(row.basis, ["PERIOD_EVENT", "CURRENT_CUSTOMER_HISTORY"]),
    from: performanceInstant(row.from), to: performanceInstant(row.to), asOf: performanceInstant(row.asOf),
    businessZone: performanceText(row.businessZone),
  };
  if (!result.sourceVersion || !result.sourceScopeVersion || Date.parse(result.from) > Date.parse(result.to)
    || Date.parse(result.to) > Date.parse(result.asOf)
    || (result.basis === "PERIOD_EVENT" ? !/^\d{4}-(0[1-9]|1[0-2])$/.test(result.month ?? "") : result.month !== null)) performanceMalformed("window");
  return result;
}

export type PerformanceWindow = ReturnType<typeof performanceWindow>;

export function samePerformanceWindow(left: PerformanceWindow, right: PerformanceWindow, sameScope = true) {
  return left.sourceVersion === right.sourceVersion && (!sameScope || left.sourceScopeVersion === right.sourceScopeVersion)
    && left.month === right.month && left.basis === right.basis && left.from === right.from && left.to === right.to
    && left.asOf === right.asOf && left.businessZone === right.businessZone;
}

export function sameCoveredPerformance(left: PerformanceTotals, right: PerformanceTotals) {
  const decimal = (value: string | null) => value?.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1").replace(/^-0$/, "0") ?? null;
  return (["amount", "inflow", "withdrawal"] as const).every(key => {
    const first = left[key], second = right[key];
    if (first.status !== second.status) return true;
    return decimal(first.value ?? first.observed) === decimal(second.value ?? second.observed);
  });
}

export function privatePerformance(value: unknown, expectedSource?: string) {
  const row = performanceObject(value);
  const window = performanceWindow(row.window);
  if (expectedSource !== undefined && window.sourceVersion !== expectedSource) performanceMalformed("sourceVersion");
  return { ...performanceTotals(value), window };
}

export const PERFORMANCE_INFLOW_CHANNELS = ["CHAIN_TOPUP", "VN_BANK_TOPUP", "CHAIN_DIRECT_PURCHASE", "VN_BANK_DIRECT_PURCHASE"] as const;
export const PERFORMANCE_PAYOUT_CHANNELS = ["TRC20", "BEP20", "ERC20", "VN_BANK"] as const;
export const PERFORMANCE_CHANNEL_LABELS: Record<string, string> = {
  CHAIN_TOPUP: "链上充值", VN_BANK_TOPUP: "越南银行卡充值", CHAIN_DIRECT_PURCHASE: "链上直付购机",
  VN_BANK_DIRECT_PURCHASE: "越南银行卡直付购机", TRC20: "TRC20", BEP20: "BEP20", ERC20: "ERC20",
  VN_BANK: "越南银行卡", BALANCE_PURCHASE: "余额购机",
};

export function performancePeriod(value: unknown, source: string) {
  const totals = privatePerformance(value, source);
  const row = performanceObject(value);
  if (totals.window.basis !== "PERIOD_EVENT") performanceMalformed("period");
  const inflows = performanceObject(row.inflowByChannel);
  const corrections = performanceObject(row.correctionByChannel);
  const withdrawals = performanceObject(row.withdrawalByChannel);
  return {
    totals,
    first: performanceMeasured(performanceObject(row.counts).firstPayment, performanceInteger),
    inflow: PERFORMANCE_INFLOW_CHANNELS.map(channel => ({
      channel, net: performanceMeasured(inflows[channel], performanceDecimal),
      correction: performanceMeasured(corrections[channel], performanceDecimal),
    })),
    withdrawals: PERFORMANCE_PAYOUT_CHANNELS.map(channel => {
      const item = performanceObject(withdrawals[channel]);
      return {
        channel, walletDebited: performanceMeasured(item.walletDebited, performanceDecimal),
        fee: performanceMeasured(item.fee, performanceDecimal), received: performanceMeasured(item.netReceived, performanceDecimal),
      };
    }),
  };
}

export function profilePerformance(value: unknown) {
  const generation = performanceGeneration(value);
  if (generation !== "READY") return { generation };
  const root = performanceObject(value), profile = performanceObject(root.profile);
  const statistic = performanceObject(profile.statistics), finance = performanceObject(profile.finance);
  const statistics = statistic.status === "READY" ? performanceObject(statistic.data) : undefined;
  const funds = finance.status === "READY" ? performanceObject(finance.data) : undefined;
  const statisticsPerformance = statistics ? privatePerformance(statistics.performance) : undefined;
  const financialPerformance = funds ? privatePerformance(funds.performance) : undefined;
  if (statisticsPerformance && financialPerformance && JSON.stringify(statisticsPerformance) !== JSON.stringify(financialPerformance)) performanceMalformed("profileGeneration");
  const first = statistics && performanceObject(statistics.first);
  const firstChannel = first?.channel == null ? undefined : performanceText(first.channel);
  return { generation, statistics: statisticsPerformance, finance: financialPerformance, firstChannel };
}

export type ProfilePerformance = ReturnType<typeof profilePerformance>;

export function legacyPerformanceSelectorError(error: unknown, ...messages: string[]) {
  // Old controllers reject the additional query parameter before parsing any data.
  return error instanceof Error && ("status" in error && error.status === 422
      || "status" in error && typeof error.status === "number" && error.status >= 200 && error.status < 300
        && "apiCode" in error && error.apiCode === 422)
    && "backendMessage" in error && typeof error.backendMessage === "string" && messages.includes(error.backendMessage);
}

export function performanceEvents(value: unknown, expected: { pageNum: number; pageSize: number; expectedVersion?: string }) {
  const root = performanceObject(value);
  if (performanceGeneration(root) !== "READY" || root.view !== "PERFORMANCE_EVENTS") performanceMalformed("eventsGeneration");
  const source = performanceText(root.sourceVersion);
  const window = performanceWindow(root.performanceWindow);
  if (window.sourceVersion !== source || window.basis !== "PERIOD_EVENT") performanceMalformed("eventsWindow");
  const pageNum = performanceInteger(root.pageNum), pageSize = performanceInteger(root.pageSize);
  const version = root.queryVersion === null ? null : performanceText(root.queryVersion);
  if (pageNum !== expected.pageNum || pageSize !== expected.pageSize
    || (version !== null && !/^saq-v1:[a-f0-9]{64}$/.test(version))
    || (expected.expectedVersion !== undefined && version !== expected.expectedVersion)
    || typeof root.canContinue !== "boolean") performanceMalformed("eventsPage");
  const summary = performanceObject(root.detailSummary);
  const part = (amount: string, events: string, customers: string) => {
    const totals = privatePerformance(summary[amount], source);
    return {
      ...totals,
      count: performanceMeasured(summary[events], performanceInteger),
      customers: performanceMeasured(summary[customers], performanceInteger),
    };
  };
  const rows = performanceList(root.records, value => {
    const row = performanceObject(value);
    return {
      id: performanceText(row.eventId), at: performanceInstant(row.effectiveAt),
      customer: row.maskedNickname === null ? null : performanceText(row.maskedNickname),
      customerNo: row.customerNo === null ? null : performanceText(row.customerNo),
      kind: performanceEnum(row.kind, ["INFLOW", "WITHDRAWAL", "CORRECTION", "DEVICE_PURCHASE", "REFUND", "MANUAL_CREDIT", "REWARD"]),
      channel: row.channel === null ? null : performanceText(row.channel),
      status: performanceEnum(row.status, ["EFFECTIVE", "PENDING_REVIEW", "EXCLUDED"]),
      business: row.businessAmount === null ? null : performanceDecimal(row.businessAmount),
      currency: row.businessCurrency === null ? null : performanceEnum(row.businessCurrency, ["USDT"]),
      delta: row.performanceDeltaUsdt === null ? null : performanceDecimal(row.performanceDeltaUsdt),
    };
  });
  const total = root.total === null ? null : performanceInteger(root.total);
  const observedTotal = performanceInteger(root.observedTotal);
  if (rows.length !== Math.min(pageSize, Math.max(0, observedTotal - (pageNum - 1) * pageSize))
    || (total !== null && total !== observedTotal) || new Set(rows.map(row => row.id)).size !== rows.length) performanceMalformed("eventsRows");
  return {
    window, total, observedTotal, pageNum, pageSize, version, canContinue: root.canContinue, rows,
    totals: part("performance", "totalCount", "customerCount"),
    visible: part("visiblePerformance", "visibleCount", "visibleCustomerCount"),
    restricted: part("restrictedPerformance", "restrictedCount", "restrictedCustomerCount"),
  };
}
