import { parseStrictFiniteNumber } from "./strict-number.ts";

type JsonRecord = Record<string, unknown>;

function invalid(module: string, detail: string): never {
  throw new Error(`${module}_OVERVIEW_RESPONSE_INVALID:${detail}`);
}

function record(value: unknown, module: string, field = "data"): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(module, field);
  }
  return value as JsonRecord;
}

function array(row: JsonRecord, key: string, module: string): unknown[] {
  if (!Array.isArray(row[key])) invalid(module, key);
  return row[key] as unknown[];
}

function object(row: JsonRecord, key: string, module: string): JsonRecord {
  return record(row[key], module, key);
}

function text(value: unknown, module: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(module, field);
  return value.trim();
}

function finite(value: unknown, module: string, field: string): number {
  const normalized = parseStrictFiniteNumber(value);
  if (normalized === null) invalid(module, field);
  return normalized;
}

function nonNegative(value: unknown, module: string, field: string): number {
  const normalized = finite(value, module, field);
  if (normalized < 0) invalid(module, field);
  return normalized;
}

function nonNegativeInteger(value: unknown, module: string, field: string): number {
  const normalized = nonNegative(value, module, field);
  if (!Number.isInteger(normalized)) invalid(module, field);
  return normalized;
}

function positiveInteger(value: unknown, module: string, field: string): number {
  const normalized = nonNegativeInteger(value, module, field);
  if (normalized < 1) invalid(module, field);
  return normalized;
}

function cursor(value: unknown, field: string): string {
  if (typeof value !== "string") invalid("F5", field);
  const normalized = value.trim();
  if (normalized !== "" && !/^[1-9]\d*$/.test(normalized)) invalid("F5", field);
  return normalized;
}

function isValidLocalDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  const [year, month, day, hour, minute, second] = parts;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute
    && date.getUTCSeconds() === second;
}

function moneySnapshot(value: unknown, field: string) {
  const snapshot = record(value, "F5", field);
  return {
    usdt: nonNegative(snapshot.usdt, "F5", `${field}.usdt`),
    nex: nonNegative(snapshot.nex, "F5", `${field}.nex`),
    count: nonNegativeInteger(snapshot.count, "F5", `${field}.count`),
  };
}

function expectedMoneyLabel(snapshot: { usdt: number; nex: number }) {
  return `USDT ${snapshot.usdt.toFixed(2)} · NEX ${snapshot.nex.toFixed(2)}`;
}

function domain(row: JsonRecord, expected: string) {
  if (row.domain !== expected) invalid(expected, "domain");
}

function sources(row: JsonRecord, module: string) {
  const values = array(row, "sources", module);
  if (!values.length) invalid(module, "sources");
  values.forEach((value, index) => text(value, module, `sources[${index}]`));
}

function common(row: JsonRecord, module: string) {
  object(row, "configValues", module);
  object(row, "commissionPolicy", module);
  array(row, "guardrails", module);
  sources(row, module);
}

function uniqueCodes(
  values: unknown[],
  module: string,
  field: string,
  expected: string[],
  key: string,
) {
  const codes = values.map((value, index) =>
    text(record(value, module, `${field}[${index}]`)[key], module, `${field}[${index}].${key}`));
  if (codes.length !== expected.length
    || new Set(codes).size !== codes.length
    || expected.some((code) => !codes.includes(code))) {
    invalid(module, field);
  }
}

export function assertF1Overview(value: unknown): asserts value is JsonRecord {
  const row = record(value, "F1");
  domain(row, "F1");
  const ranks = array(row, "vrankRows", "F1");
  uniqueCodes(ranks, "F1", "vrankRows", Array.from({ length: 13 }, (_, index) => `V${index}`), "v");
  ranks.forEach((value, index) => {
    const rank = record(value, "F1", `vrankRows[${index}]`);
    text(rank.label, "F1", `vrankRows[${index}].label`);
    finite(rank.pop, "F1", `vrankRows[${index}].pop`);
    if (!Array.isArray(rank.rewards)) invalid("F1", `vrankRows[${index}].rewards`);
  });
  object(row, "rewards", "F1");
  array(row, "voucherOptions", "F1");
  object(row, "voucherLabels", "F1");
  array(row, "skuOptions", "F1");
  object(row, "skuLabels", "F1");
  const leadership = object(row, "leadership", "F1");
  array(leadership, "ranks", "F1");
  object(row, "configValues", "F1");
  sources(row, "F1");
}

export function assertF2Overview(value: unknown): asserts value is JsonRecord {
  const row = record(value, "F2");
  domain(row, "F2");
  array(row, "metrics", "F2");
  const rates = array(row, "unilevelRates", "F2");
  uniqueCodes(rates, "F2", "unilevelRates", Array.from({ length: 7 }, (_, index) => `L${index + 1}`), "level");
  array(row, "rateTiers", "F2");
  array(row, "policyParams", "F2");
  common(row, "F2");
}

export function assertF3Overview(value: unknown): asserts value is JsonRecord {
  const row = record(value, "F3");
  domain(row, "F3");
  array(row, "metrics", "F3");
  object(row, "formula", "F3");
  array(row, "settlements", "F3");
  object(row, "dailyCap", "F3");
  object(row, "config", "F3");
  for (const field of [
    "maxTrackGmv",
    "participantCount",
    "blockedCount",
    "monthlyMatchedUsd",
    "autoPlacement7dCount",
    "dailyMatchUsd",
  ]) {
    finite(row[field], "F3", field);
  }
  common(row, "F3");
}

export function assertF4Overview(value: unknown): asserts value is JsonRecord {
  const row = record(value, "F4");
  domain(row, "F4");
  array(row, "metrics", "F4");
  array(row, "quotaRows", "F4");
  array(row, "ambassadorBands", "F4");
  array(row, "podium", "F4");
  const votes = array(row, "voteWeights", "F4");
  if (!votes.length) invalid("F4", "voteWeights");
  votes.forEach((value, index) => {
    const vote = record(value, "F4", `voteWeights[${index}]`);
    text(vote.v, "F4", `voteWeights[${index}].v`);
    finite(vote.votes, "F4", `voteWeights[${index}].votes`);
  });
  object(row, "config", "F4");
  common(row, "F4");
}

export function assertF5Overview(value: unknown): asserts value is JsonRecord {
  const row = record(value, "F5");
  domain(row, "F5");
  const summary = object(row, "summary", "F5");
  const spend = moneySnapshot(summary.monthlyCommissionSpend, "summary.monthlyCommissionSpend");
  const cooling = moneySnapshot(summary.coolingBalance, "summary.coolingBalance");
  const withdrawable = moneySnapshot(summary.withdrawableThisMonth, "summary.withdrawableThisMonth");
  if (text(summary.monthlyCommissionSpendLabel, "F5", "summary.monthlyCommissionSpendLabel") !== expectedMoneyLabel(spend)
      || text(summary.coolingBalanceLabel, "F5", "summary.coolingBalanceLabel") !== expectedMoneyLabel(cooling)
      || text(summary.withdrawableThisMonthLabel, "F5", "summary.withdrawableThisMonthLabel") !== expectedMoneyLabel(withdrawable)) {
    invalid("F5", "summary.labels");
  }
  const frozenCount = nonNegativeInteger(summary.frozenCount, "F5", "summary.frozenCount");
  const kinds = array(row, "commissionKinds", "F5");
  uniqueCodes(
    kinds,
    "F5",
    "commissionKinds",
    ["network", "binary", "peer", "cultivation", "leadership", "genesis"],
    "key",
  );
  const kindCounts: number[] = [];
  kinds.forEach((value, index) => {
    const kind = record(value, "F5", `commissionKinds[${index}]`);
    for (const field of ["code", "label", "amountLabel", "countLabel", "className"]) {
      text(kind[field], "F5", `commissionKinds[${index}].${field}`);
    }
    const amounts = moneySnapshot(kind.amounts, `commissionKinds[${index}].amounts`);
    const count = nonNegativeInteger(kind.count, "F5", `commissionKinds[${index}].count`);
    kindCounts.push(count);
    if (amounts.count !== count
        || text(kind.amountLabel, "F5", `commissionKinds[${index}].amountLabel`) !== expectedMoneyLabel(amounts)
        || text(kind.countLabel, "F5", `commissionKinds[${index}].countLabel`) !== `${count} 笔`) {
      invalid("F5", `commissionKinds[${index}].labels`);
    }
  });
  const filters = array(row, "commissionFilters", "F5");
  uniqueCodes(filters, "F5", "commissionFilters", ["all", "cooling", "unlocked", "withdrawn", "reversed", "frozen"], "key");
  filters.forEach((value, index) => text(
    record(value, "F5", `commissionFilters[${index}]`).label,
    "F5",
    `commissionFilters[${index}].label`,
  ));
  const events = array(row, "commissionEvents", "F5");
  const eventIds: number[] = [];
  events.forEach((value, index) => {
    const event = record(value, "F5", `commissionEvents[${index}]`);
    for (const field of ["commissionId", "kind", "user", "currency", "settledAt", "status", "cooldownLabel", "state", "auditKey"]) {
      text(event[field], "F5", `commissionEvents[${index}].${field}`);
    }
    const eventId = positiveInteger(event.eventId, "F5", `commissionEvents[${index}].eventId`);
    eventIds.push(eventId);
    const userId = positiveInteger(event.userId, "F5", `commissionEvents[${index}].userId`);
    nonNegative(event.amount, "F5", `commissionEvents[${index}].amount`);
    nonNegativeInteger(event.coolingDaysLeft, "F5", `commissionEvents[${index}].coolingDaysLeft`);
    const cooldownPercent = nonNegativeInteger(event.cooldownPercent, "F5", `commissionEvents[${index}].cooldownPercent`);
    nonNegativeInteger(event.version, "F5", `commissionEvents[${index}].version`);
    const kind = text(event.kind, "F5", `commissionEvents[${index}].kind`);
    const currency = text(event.currency, "F5", `commissionEvents[${index}].currency`);
    const status = text(event.status, "F5", `commissionEvents[${index}].status`);
    if (!["network", "binary", "peer", "cultivation", "leadership", "genesis"].includes(kind)
        || !["USDT", "NEX"].includes(currency)
        || !["cooling", "unlocked", "withdrawn", "reversed", "frozen"].includes(status)) {
      invalid("F5", `commissionEvents[${index}].enum`);
    }
    if (text(event.commissionId, "F5", `commissionEvents[${index}].commissionId`) !== `CM-${eventId}`
        || text(event.user, "F5", `commissionEvents[${index}].user`) !== `U${String(userId).padStart(8, "0")}`
        || text(event.auditKey, "F5", `commissionEvents[${index}].auditKey`) !== `F.commission.CM-${eventId}.status`
        || !isValidLocalDateTime(text(event.settledAt, "F5", `commissionEvents[${index}].settledAt`))
        || cooldownPercent !== (status === "cooling" ? 0 : 100)) {
      invalid("F5", `commissionEvents[${index}].relation`);
    }
  });
  if (eventIds.some((eventId, index) => index > 0 && eventIds[index - 1] <= eventId)) invalid("F5", "commissionEvents.order");
  const statuses = array(row, "statusDistribution", "F5");
  uniqueCodes(statuses, "F5", "statusDistribution", ["已解锁可提", "冷却计提中", "已提现", "已撤销", "已冻结"], "name");
  const statusCounts = new Map<string, number>();
  statuses.forEach((value, index) => {
    const status = record(value, "F5", `statusDistribution[${index}]`);
    text(status.color, "F5", `statusDistribution[${index}].color`);
    statusCounts.set(
      text(status.name, "F5", `statusDistribution[${index}].name`),
      nonNegativeInteger(status.count, "F5", `statusDistribution[${index}].count`),
    );
  });
  const aggregateCount = kindCounts.reduce((sum, count) => sum + count, 0);
  const statusCount = [...statusCounts.values()].reduce((sum, count) => sum + count, 0);
  if (aggregateCount !== statusCount
      || spend.count !== aggregateCount
      || cooling.count !== statusCounts.get("冷却计提中")
      || withdrawable.count !== statusCounts.get("已解锁可提")
      || frozenCount !== statusCounts.get("已冻结")) invalid("F5", "aggregateTotals");
  const feed = array(row, "recentAuditFeed", "F5");
  feed.forEach((value, index) => {
    const item = record(value, "F5", `recentAuditFeed[${index}]`);
    for (const field of ["when", "text", "level"]) text(item[field], "F5", `recentAuditFeed[${index}].${field}`);
  });
  const pagination = object(row, "pagination", "F5");
  text(pagination.mode, "F5", "pagination.mode");
  text(pagination.defaultWindow, "F5", "pagination.defaultWindow");
  const defaultPageSize = positiveInteger(pagination.defaultPageSize, "F5", "pagination.defaultPageSize");
  const pageSize = positiveInteger(pagination.pageSize, "F5", "pagination.pageSize");
  const maxPageSize = positiveInteger(pagination.maxPageSize, "F5", "pagination.maxPageSize");
  const paginationTotal = nonNegativeInteger(pagination.total, "F5", "pagination.total");
  const requestCursor = cursor(pagination.requestCursor, "pagination.requestCursor");
  const topCursor = cursor(row.nextCursor, "nextCursor");
  const nestedCursor = cursor(pagination.nextCursor, "pagination.nextCursor");
  array(row, "anomalies", "F5");
  array(row, "coolingPolicy", "F5");
  array(row, "operationHistory", "F5");
  array(row, "activeSuspensions", "F5");
  const total = nonNegativeInteger(row.total, "F5", "total");
  if (text(pagination.mode, "F5", "pagination.mode") !== "server-cursor"
      || defaultPageSize > maxPageSize
      || maxPageSize !== 100
      || pageSize > maxPageSize
      || total !== paginationTotal
      || events.length > pageSize
      || events.length > total
      || topCursor !== nestedCursor
      || (requestCursor === "" && total > events.length && topCursor === "")
      || (topCursor !== "" && (events.length !== pageSize || topCursor !== String(eventIds.at(-1))))) {
    invalid("F5", "pagination");
  }
  common(row, "F5");
}
