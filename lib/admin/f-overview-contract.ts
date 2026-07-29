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
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(normalized)) invalid(module, field);
  return normalized;
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
  object(row, "summary", "F5");
  const kinds = array(row, "commissionKinds", "F5");
  uniqueCodes(
    kinds,
    "F5",
    "commissionKinds",
    ["network", "binary", "peer", "cultivation", "leadership", "genesis"],
    "key",
  );
  array(row, "commissionFilters", "F5");
  array(row, "commissionEvents", "F5");
  array(row, "statusDistribution", "F5");
  array(row, "recentAuditFeed", "F5");
  object(row, "pagination", "F5");
  array(row, "anomalies", "F5");
  array(row, "coolingPolicy", "F5");
  array(row, "operationHistory", "F5");
  array(row, "activeSuspensions", "F5");
  finite(row.total, "F5", "total");
  common(row, "F5");
}
