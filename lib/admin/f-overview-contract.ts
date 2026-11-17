import { parseStrictFiniteNumber } from "./strict-number.ts";
import { f4Decimal } from "./f4-money";

type JsonRecord = Record<string, unknown>;

// Schema for 06d5874c metadata, never a fallback for missing server facts.
const F4_AMBASSADOR_METRIC_BASIS = {
  source: "nx_team_ambassador_application", period: "ALL_TIME", timeFilter: "NONE", excludedDeleted: true,
  metrics: {
    ambassadorPendingCount: { aggregation: "COUNT", statusFilter: "PENDING", unit: "APPLICATION" },
    ambassadorBudgetApprovedLabel: { aggregation: "SUM", field: "requested_budget_usdt", statusFilter: "APPROVED", currency: "USDT", amountBasis: "APPLICATION_REQUESTED_BUDGET", isPaidAmount: false },
    ambassadorBudgetCapLabel: { aggregation: "SUM", field: "requested_budget_usdt", statusFilter: "ALL", currency: "USDT", amountBasis: "APPLICATION_REQUESTED_BUDGET", isBudgetCap: false },
    ambassadorKolBudgetPct: { aggregation: "MAX", field: "kol_budget_pct", statusFilter: "ALL" },
    ambassadorNextQuotaReviewDate: { aggregation: "MIN", field: "event_date", statusFilter: "PENDING", isQuarterPlan: false },
  },
} as const;
export type F4AmbassadorMetricBasis = typeof F4_AMBASSADOR_METRIC_BASIS;

export const F5_KIND_LABELS: Record<string, string> = {
  direct_purchase: "好友购买奖励", direct_device_earning: "好友设备收益奖励",
  network: "团队购买奖励", binary: "团队平衡奖励", peer: "同级奖励", cultivation: "好友升级奖励", leadership: "团队激励池", genesis: "创世节点收益",
};
export const F5_KINDS = Object.keys(F5_KIND_LABELS);
export const F5_STATUSES = ["cooling", "unlocked", "withdrawn", "reversed", "frozen", "rejected", "recovery_pending"];

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
  const amounts = { usdt: "", nex: "" };
  for (const key of ["usdt", "nex"] as const) {
    const raw = snapshot[key];
    if (typeof raw !== "string" && typeof raw !== "number") invalid("F5", `${field}.${key}`);
    const amount = f4Decimal(raw);
    if (amount === null || amount.startsWith("-")) invalid("F5", `${field}.${key}`);
    amounts[key] = amount;
  }
  return {
    ...amounts,
    count: nonNegativeInteger(snapshot.count, "F5", `${field}.count`),
  };
}

function expectedMoneyLabel(snapshot: { usdt: string; nex: string }) {
  return `USDT ${snapshot.usdt} · UVT ${snapshot.nex}`;
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
  // A complete, empty server overview is the entry to first-time configuration.
  if (ranks.length > 13) invalid("F1", "vrankRows");
  uniqueCodes(ranks, "F1", "vrankRows", Array.from({ length: ranks.length }, (_, index) => `V${index}`), "v");
  ranks.forEach((value, index) => {
    const rank = record(value, "F1", `vrankRows[${index}]`);
    text(rank.label, "F1", `vrankRows[${index}].label`);
    nonNegativeInteger(rank.pop, "F1", `vrankRows[${index}].pop`);
    for (const field of ["selfBuy", "teamGv", "directRefs", "legCount", "votes"]) {
      nonNegativeInteger(rank[field], "F1", `vrankRows[${index}].${field}`);
    }
    text(rank.legRank, "F1", `vrankRows[${index}].legRank`);
    nonNegative(rank.peerBonusRate, "F1", `vrankRows[${index}].peerBonusRate`);
    if (typeof rank.visible !== "boolean" || typeof rank.unilevelDepth !== "string"
        || typeof rank.policyRevision !== "string" || !/^[0-9a-f]{64}$/.test(rank.policyRevision)) invalid("F1", `vrankRows[${index}]`);
    if (!Array.isArray(rank.rewards)) invalid("F1", `vrankRows[${index}].rewards`);
  });
  object(row, "rewards", "F1");
  if (ranks.length === 0 && Object.keys(row.rewards as JsonRecord).length !== 0) invalid("F1", "orphanRewards");
  array(row, "voucherOptions", "F1");
  object(row, "voucherLabels", "F1");
  array(row, "skuOptions", "F1");
  object(row, "skuLabels", "F1");
  const leadership = object(row, "leadership", "F1");
  array(leadership, "ranks", "F1");
  for (const field of ["unlockRank", "topN", "topConcentrationPct", "totalMembers", "qualifiers"]) nonNegativeInteger(leadership[field], "F1", `leadership.${field}`);
  const config = object(row, "configValues", "F1");
  Object.entries(config).forEach(([key, value]) => { if (typeof value !== "string") invalid("F1", `configValues.${key}`); });
  sources(row, "F1");
}

export function assertF2Overview(value: unknown): asserts value is JsonRecord {
  const row = record(value, "F2");
  domain(row, "F2");
  if (row.payoutStatistics !== undefined) {
    const currencies = new Set<string>();
    array(row, "payoutStatistics", "F2").forEach((value, index) => {
      const path = `payoutStatistics[${index}]`;
      const statistic = record(value, "F2", path);
      const currency = text(statistic.currency, "F2", `${path}.currency`);
      if (!["USDT", "UVT"].includes(currency) || currencies.has(currency)) invalid("F2", `${path}.currency`);
      currencies.add(currency);
      for (const key of ["available", "statusMarkerOnly", "cashSettlementTimeAvailable"]) if (typeof statistic[key] !== "boolean") invalid("F2", `${path}.${key}`);
      for (const key of ["window", "statusScope", "basis"]) text(statistic[key], "F2", `${path}.${key}`);
      const statuses = array(statistic, "paidOrSettledStatuses", "F2");
      if (statuses.length !== 2 || statuses[0] !== "PAID" || statuses[1] !== "SETTLED") invalid("F2", `${path}.paidOrSettledStatuses`);
      if (statistic.paidStatuses !== undefined || statistic.paidAmountRaw !== undefined || statistic.paidEventCount !== undefined) {
        const paidStatuses = array(statistic, "paidStatuses", "F2");
        if (paidStatuses.length !== 1 || paidStatuses[0] !== "PAID") invalid("F2", `${path}.paidStatuses`);
        if (statistic.paidAmountRaw !== null && (typeof statistic.paidAmountRaw !== "string" || f4Decimal(statistic.paidAmountRaw) === null || statistic.paidAmountRaw.startsWith("-"))) invalid("F2", `${path}.paidAmountRaw`);
        if (statistic.paidEventCount !== null) nonNegativeInteger(statistic.paidEventCount, "F2", `${path}.paidEventCount`);
        if (statistic.available === false && (statistic.paidAmountRaw !== null || statistic.paidEventCount !== null)) invalid("F2", `${path}.paidUnavailable`);
      }
      for (const key of ["allStatusAmountRaw", "paidOrSettledAmountRaw"]) {
        if (statistic[key] !== null && (typeof statistic[key] !== "string" || f4Decimal(statistic[key]) === null || statistic[key].startsWith("-"))) invalid("F2", `${path}.${key}`);
      }
      for (const key of ["allStatusEventCount", "paidOrSettledEventCount"]) if (statistic[key] !== null) nonNegativeInteger(statistic[key], "F2", `${path}.${key}`);
      if (statistic.available === false && ["allStatusAmountRaw", "allStatusEventCount", "paidOrSettledAmountRaw", "paidOrSettledEventCount"].some(key => statistic[key] !== null)) invalid("F2", `${path}.unavailable`);
    });
    if (currencies.size !== 2) invalid("F2", "payoutStatistics.currencies");
  }
  if (row.sevenLayerRevision !== undefined) {
    const revision = nonNegativeInteger(row.sevenLayerRevision, "F2", "sevenLayerRevision");
    if (!Number.isSafeInteger(revision)) invalid("F2", "sevenLayerRevision");
  }
  const stringFields = (item: JsonRecord, fields: string[], path: string) => {
    for (const field of fields) {
      if (item[field] !== undefined && typeof item[field] !== "string") invalid("F2", `${path}.${field}`);
    }
  };
  const booleanFields = (item: JsonRecord, fields: string[], path: string) => {
    for (const field of fields) {
      const value = item[field];
      if (value !== undefined && typeof value !== "boolean"
          && !(typeof value === "string" && ["true", "false", "1", "0", "on", "off"].includes(value.trim().toLowerCase()))) invalid("F2", `${path}.${field}`);
    }
  };
  array(row, "metrics", "F2").forEach((value, index) => {
    const path = `metrics[${index}]`;
    const metric = record(value, "F2", path);
    for (const field of ["id", "label", "value"]) text(metric[field], "F2", `${path}.${field}`);
    stringFields(metric, ["sub", "tone", "configKey"], path);
  });
  const rates = array(row, "unilevelRates", "F2");
  // The backend can return a subset of existing rows; preserve the missing rows.
  const levels = new Set<string>();
  rates.forEach((value, index) => {
    const path = `unilevelRates[${index}]`;
    const rate = record(value, "F2", path);
    const level = text(rate.level, "F2", `${path}.level`);
    if (!/^L[1-7]$/.test(level) || levels.has(level)) invalid("F2", `${path}.level`);
    levels.add(level);
    // Explicit null is missing, while an absent field is still a bad contract.
    if (rate.usdtPct !== null) nonNegative(rate.usdtPct, "F2", `${path}.usdtPct`);
    if (rate.nexReward !== null) nonNegative(rate.nexReward, "F2", `${path}.nexReward`);
    for (const field of ["usdtPctMissing", "nexRewardMissing"]) {
      if (rate[field] !== undefined && typeof rate[field] !== "boolean") invalid("F2", `${path}.${field}`);
    }
    stringFields(rate, ["label", "configKey", "nexConfigKey"], path);
    booleanFields(rate, ["direct"], path);
  });
  array(row, "rateTiers", "F2").forEach((value, index) => {
    const path = `rateTiers[${index}]`;
    const tier = record(value, "F2", path);
    for (const field of ["name", "requirement", "distribution"]) text(tier[field], "F2", `${path}.${field}`);
    if (typeof tier.rate !== "string" || !tier.rate.trim()) nonNegative(tier.ratePct, "F2", `${path}.ratePct`);
    stringFields(tier, ["rate", "className", "configKey"], path);
  });
  array(row, "policyParams", "F2").forEach((value, index) => {
    const path = `policyParams[${index}]`;
    const param = record(value, "F2", path);
    for (const field of ["id", "name", "key"]) text(param[field], "F2", `${path}.${field}`);
    if (typeof param.value !== "string") invalid("F2", `${path}.value`);
    stringFields(param, ["defaultValue", "viewClass", "sub", "unit"], path);
    booleanFields(param, ["amplifies", "visualAmplify"], path);
  });
  common(row, "F2");
  Object.entries(row.configValues as JsonRecord).forEach(([key, value]) => {
    if (typeof value !== "string") invalid("F2", `configValues.${key}`);
  });
  (row.guardrails as unknown[]).forEach((value, index) => text(value, "F2", `guardrails[${index}]`));
}

export function assertF3Overview(value: unknown): asserts value is JsonRecord {
  const row = record(value, "F3");
  domain(row, "F3");
  const rawAmounts = (item: JsonRecord, fields: string[], path: string) => {
    for (const field of fields) {
      const amount = item[field];
      if (amount !== undefined && amount !== null && (typeof amount !== "string" || f4Decimal(amount) === null || amount.startsWith("-"))) invalid("F3", `${path}.${field}`);
    }
  };
  rawAmounts(row, ["monthlyMatchedUsdRaw", "dailyMatchUsdRaw", "maxDailyCapUsdRaw", "maxTrackGmvRaw", "residualPoolUsdRaw"], "data");
  if (row.statistics !== undefined) {
    const statistics = object(row, "statistics", "F3");
    text(statistics.basis, "F3", "statistics.basis");
    for (const key of ["participantCount", "blockedCount", "monthlyMatchedUsd", "dailyMatchUsd", "autoPlacement7dCount", "maxDailyCapUsd", "maxTrackGmv", "residualPoolUsd", "settlements", "h1BinaryDailyCap"]) {
      const statistic = object(statistics, key, "F3");
      for (const field of ["source", "aggregate", "field", "filter", "window", "status"]) text(statistic[field], "F3", `statistics.${key}.${field}`);
      if (typeof statistic.distinct !== "boolean") invalid("F3", `statistics.${key}.distinct`);
    }
  }
  const strings = (value: JsonRecord, keys: string[], path: string) => {
    for (const key of keys) if (typeof value[key] !== "string") invalid("F3", `${path}.${key}`);
  };
  array(row, "metrics", "F3").forEach((value, index) => {
    strings(record(value, "F3", `metrics[${index}]`), ["id", "label", "value", "sub", "tone"], `metrics[${index}]`);
  });
  const formula = object(row, "formula", "F3");
  rawAmounts(formula, ["trackARaw", "trackBRaw", "matchAmountRaw", "todayPaidRaw"], "formula");
  strings(formula, ["user", "matchRate", "threshold", "settlePeriod"], "formula");
  for (const key of ["trackA", "trackB", "matchAmount"]) finite(formula[key], "F3", `formula.${key}`);
  array(row, "settlements", "F3").forEach((value, index) => {
    const settlement = record(value, "F3", `settlements[${index}]`);
    rawAmounts(settlement, ["trackARaw", "trackBRaw", "matchAmountRaw", "todayPaidRaw"], `settlements[${index}]`);
    strings(settlement, ["user", "settlementDate", "cohort", "state", "tone"], `settlements[${index}]`);
    for (const key of ["ownerUserId", "trackA", "trackB", "matchAmount", "todayPaid"]) finite(settlement[key], "F3", `settlements[${index}].${key}`);
  });
  const cap = object(row, "dailyCap", "F3");
  strings(cap, ["currentLabel", "windowLabel", "nextTrigger", "nextLabel", "currentPhase"], "dailyCap");
  nonNegativeInteger(cap.currentMonth, "F3", "dailyCap.currentMonth");
  if (cap.h1BinaryDailyCap !== null) nonNegative(cap.h1BinaryDailyCap, "F3", "dailyCap.h1BinaryDailyCap");
  const config = object(row, "config", "F3");
  strings(config, ["threshold", "matchRate", "spillover", "gvResetCron", "settlePeriod", "residualPolicy", "residualPool", "residualSub"], "config");
  if (typeof config.spilloverEnabled !== "boolean") invalid("F3", "config.spilloverEnabled");
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
  strings(row.configValues as JsonRecord, Object.keys(row.configValues as JsonRecord), "configValues");
  if (row.coverage != null) {
    const coverage = object(row, "coverage", "F3");
    for (const key of ["coverageRatio", "redlinePct"]) if (coverage[key] !== null) finite(coverage[key], "F3", `coverage.${key}`);
  }
}

export function assertF4Overview(value: unknown): asserts value is JsonRecord {
  const row = record(value, "F4");
  domain(row, "F4");
  array(row, "metrics", "F4");
  array(row, "quotaRows", "F4").forEach((value, index) => {
    const item = record(value, "F4", `quotaRows[${index}]`);
    positiveInteger(item.id, "F4", `quotaRows[${index}].id`);
    for (const key of ["current", "cap"]) nonNegativeInteger(item[key], "F4", `quotaRows[${index}].${key}`);
    if (item.monthlyQuota !== undefined && item.monthlyQuota !== null
      && (typeof item.monthlyQuota !== "string" || !/^\d+$/.test(item.monthlyQuota) || !Number.isSafeInteger(Number(item.monthlyQuota)))) invalid("F4", `quotaRows[${index}].monthlyQuota`);
  });
  array(row, "quotaUsages", "F4").forEach((value, index) => {
    const item = record(value, "F4", `quotaUsages[${index}]`);
    for (const key of ["id", "userId", "quantity"]) positiveInteger(item[key], "F4", `quotaUsages[${index}].${key}`);
    text(item.status, "F4", `quotaUsages[${index}].status`);
  });
  array(row, "ambassadorApplications", "F4").forEach((value, index) => {
    const item = record(value, "F4", `ambassadorApplications[${index}]`);
    positiveInteger(item.id, "F4", `ambassadorApplications[${index}].id`);
    nonNegative(item.requestedBudgetUsd, "F4", `ambassadorApplications[${index}].requestedBudgetUsd`);
    text(item.status, "F4", `ambassadorApplications[${index}].status`);
  });
  array(row, "ambassadorBands", "F4");
  if (row.ambassadorMetricBasis !== undefined) {
    const basis = object(row, "ambassadorMetricBasis", "F4");
    for (const key of ["source", "period", "timeFilter", "excludedDeleted"] as const) {
      if (basis[key] !== F4_AMBASSADOR_METRIC_BASIS[key]) invalid("F4", `ambassadorMetricBasis.${key}`);
    }
    const metrics = object(basis, "metrics", "F4");
    for (const [key, expected] of Object.entries(F4_AMBASSADOR_METRIC_BASIS.metrics)) {
      const metric = object(metrics, key, "F4");
      for (const [field, expectedValue] of Object.entries(expected)) {
        if (metric[field] !== expectedValue) invalid("F4", `ambassadorMetricBasis.metrics.${key}.${field}`);
      }
    }
  }
  array(row, "podium", "F4");
  const votes = array(row, "voteWeights", "F4");
  votes.forEach((value, index) => {
    const vote = record(value, "F4", `voteWeights[${index}]`);
    text(vote.v, "F4", `voteWeights[${index}].v`);
    nonNegativeInteger(vote.votes, "F4", `voteWeights[${index}].votes`);
  });
  object(row, "config", "F4");
  common(row, "F4");
  for (const field of ["configVersion", "settlementConfigUnavailableKey", "settlementConfigUnavailableReason", "monthlyCapLabel", "nextSettlementAt"]) {
    if (typeof row[field] !== "string") invalid("F4", field);
  }
  if (!["READY", "HOLD"].includes(String(row.settlementConfigStatus))) invalid("F4", "settlementConfigStatus");
  if (row.currentWeekPoolUsd !== null) nonNegative(row.currentWeekPoolUsd, "F4", "currentWeekPoolUsd");
  for (const field of ["weeklyInjectedUsd", "weeklyGmvUsd", "monthlyCapUsd", "participantCount", "topN", "topSharePct", "unlockRank", "quotaMonthlyStockTotal", "quotaMonthlyStockUsed", "quotaMonthlyStockRemaining", "ambassadorPendingCount", "leaderboardFraudHitCount"]) nonNegative(row[field], "F4", field);
  for (const [key, value] of Object.entries(row.configValues as JsonRecord)) {
    if (typeof value !== "string") invalid("F4", `configValues.${key}`);
  }
  if (row.coverage != null) {
    const coverage = object(row, "coverage", "F4");
    if (coverage.reliable !== undefined && typeof coverage.reliable !== "boolean") invalid("F4", "coverage.reliable");
    for (const key of ["coverageRatio", "redlinePct"]) if (coverage[key] != null) finite(coverage[key], "F4", `coverage.${key}`);
  }
}

export function assertF4MaterialPacket(value: unknown): asserts value is JsonRecord {
  const row = record(value, "F4", "materials");
  positiveInteger(row.applicationId, "F4", "materials.applicationId");
  nonNegativeInteger(row.materialRevision, "F4", "materials.materialRevision");
  nonNegative(row.budgetUsdt, "F4", "materials.budgetUsdt");
  if (row.bucket !== null && !["venue", "kol", "print", "dev"].includes(String(row.bucket))) invalid("F4", "materials.bucket");
  if (!["NOT_SUBMITTED", "PENDING", "NEEDS_MORE", "PASSED"].includes(String(row.materialState))) invalid("F4", "materials.materialState");
  if (typeof row.statement !== "string" || row.eventDate !== null && typeof row.eventDate !== "string") invalid("F4", "materials.text");
  for (const key of ["canSubmit", "canReviewBusiness", "canReviewFinance", "canProposeApproval", "canApprove", "legacyApproved"]) {
    if (typeof row[key] !== "boolean") invalid("F4", `materials.${key}`);
  }
  for (const key of ["missingKinds", "approvalBlockers", "proposalBlockers"]) array(row, key, "F4").forEach(item => text(item, "F4", `materials.${key}`));
  array(row, "requirements", "F4").forEach(value => {
    const item = record(value, "F4", "materials.requirement");
    text(item.kind, "F4", "materials.requirement.kind");
    text(item.label, "F4", "materials.requirement.label");
    if (typeof item.required !== "boolean") invalid("F4", "materials.requirement.required");
  });
  array(row, "attachments", "F4").forEach(value => {
    const item = record(value, "F4", "materials.attachment");
    for (const key of ["fileId", "kind", "name", "contentType"]) text(item[key], "F4", `materials.attachment.${key}`);
    nonNegativeInteger(item.sizeBytes, "F4", "materials.attachment.sizeBytes");
  });
  for (const [index, value] of [row.businessReview, row.financeReview, ...array(row, "reviewHistory", "F4")].entries()) {
    const review = record(value, "F4", "materials.review");
    if (!["PENDING", "PASSED", "NEEDS_MORE"].includes(String(review.status))) invalid("F4", "materials.review.status");
    for (const key of ["reviewerLabel", "reviewedAt", "reason"]) if (review[key] !== null && typeof review[key] !== "string") invalid("F4", `materials.review.${key}`);
    if (review.verifiedAttendees != null) nonNegativeInteger(review.verifiedAttendees, "F4", "materials.review.verifiedAttendees");
    if (review.recognizedBudgetUsdt != null) nonNegative(review.recognizedBudgetUsdt, "F4", "materials.review.recognizedBudgetUsdt");
    if (index >= 2) {
      positiveInteger(review.materialRevision, "F4", "materials.review.materialRevision");
      if (review.stage !== "BUSINESS" && review.stage !== "FINANCE") invalid("F4", "materials.review.stage");
      if (review.status !== "PASSED" && review.status !== "NEEDS_MORE") invalid("F4", "materials.review.status");
      if (typeof review.reason !== "string") invalid("F4", "materials.review.reason");
    }
  }
}

/** Shared by the list and exact business-id read, before either projection is consumed. */
export function assertF5ActionAvailability(event: JsonRecord) {
  for (const [available, reason] of [["canUnlock", "unlockBlockedReason"], ["canReverse", "reverseBlockedReason"]]) {
    if (event[available] === undefined) continue;
    if (typeof event[available] !== "boolean") invalid("F5", available);
    if (event[available]) {
      if (event[reason] !== null) invalid("F5", reason);
    } else text(event[reason], "F5", reason);
  }
  if (event.groupStatus !== undefined && typeof event.groupStatus !== "string") invalid("F5", "groupStatus");
}

export function assertF5Overview(value: unknown): asserts value is JsonRecord {
  const row = record(value, "F5");
  domain(row, "F5");
  const pending = array(row, "pendingCalculations", "F5");
  const pendingCount = nonNegativeInteger(row.pendingCalculationCount, "F5", "pendingCalculationCount");
  if (pendingCount !== pending.length) invalid("F5", "pendingCalculationCount");
  const ids = new Set<string>();
  pending.forEach((value, index) => {
    const item = record(value, "F5", `pendingCalculations[${index}]`);
    for (const key of ["id", "settlementNo", "sourceRef"]) text(item[key], "F5", key);
    if (typeof item.sourceUserName !== "string") invalid("F5", "sourceUserName");
    if (item.id !== item.settlementNo || ids.has(String(item.id)) || !["direct_purchase", "direct_device_earning"].includes(String(item.kind)) || item.status !== "waiting_calculation" || item.nexUsdtPrice !== null || finite(item.amountUSDT, "F5", "amountUSDT") !== 0 || finite(item.amountNEX, "F5", "amountNEX") !== 0 || positiveInteger(item.layer, "F5", "layer") !== 1) invalid("F5", `pendingCalculations[${index}].relation`);
    nonNegative(item.basisUsdt, "F5", "basisUsdt");
    for (const key of ["ts", "unlockAt"]) {
      if (item[key] !== null && (typeof item[key] !== "number" || !Number.isSafeInteger(item[key]) || item[key] < 0 || !Number.isFinite(new Date(item[key]).getTime()))) invalid("F5", key);
    }
    ids.add(String(item.id));
  });
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
    F5_KINDS,
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
  uniqueCodes(filters, "F5", "commissionFilters", ["all", ...F5_STATUSES], "key");
  filters.forEach((value, index) => text(
    record(value, "F5", `commissionFilters[${index}]`).label,
    "F5",
    `commissionFilters[${index}].label`,
  ));
  const events = array(row, "commissionEvents", "F5");
  const eventIds: number[] = [];
  events.forEach((value, index) => {
    const event = record(value, "F5", `commissionEvents[${index}]`);
    assertF5ActionAvailability(event);
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
    if (event.unlockAt != null && (typeof event.unlockAt !== "number" || !Number.isSafeInteger(event.unlockAt) || event.unlockAt < 0 || !Number.isFinite(new Date(event.unlockAt).getTime()))) invalid("F5", "unlockAt");
    for (const key of ["basisUsdt", "nexUsdtPrice", "amountUSDT", "amountNEX", "recoveryPendingUSDT", "recoveryPendingNEX"]) {
      if (event[key] != null) nonNegative(event[key], "F5", key);
    }
    const kind = text(event.kind, "F5", `commissionEvents[${index}].kind`);
    const currency = text(event.currency, "F5", `commissionEvents[${index}].currency`);
    const status = text(event.status, "F5", `commissionEvents[${index}].status`);
    if (!F5_KINDS.includes(kind)
        || !["USDT", "UVT"].includes(currency)
        || !F5_STATUSES.includes(status)) {
      invalid("F5", `commissionEvents[${index}].enum`);
    }
    if (text(event.commissionId, "F5", `commissionEvents[${index}].commissionId`) !== `CM-${eventId}`
        || text(event.user, "F5", `commissionEvents[${index}].user`) !== `U${String(userId).padStart(8, "0")}`
        || text(event.auditKey, "F5", `commissionEvents[${index}].auditKey`) !== `F.commission.CM-${eventId}.status`
        || !isValidLocalDateTime(text(event.settledAt, "F5", `commissionEvents[${index}].settledAt`))
        || cooldownPercent !== (status === "cooling" ? 0 : 100)) {
      invalid("F5", `commissionEvents[${index}].relation`);
    }
    if (kind === "direct_purchase" || kind === "direct_device_earning") {
      for (const field of ["settlementNo", "sourceRef"]) text(event[field], "F5", `commissionEvents[${index}].${field}`);
      positiveInteger(event.policyVersion, "F5", `commissionEvents[${index}].policyVersion`);
      for (const field of ["basisUsdt", "nexUsdtPrice"]) if (nonNegative(event[field], "F5", field) <= 0) invalid("F5", field);
      for (const field of ["amountUSDT", "amountNEX", "recoveryPendingUSDT", "recoveryPendingNEX"]) nonNegative(event[field], "F5", field);
      if (typeof event.reversalRecorded !== "boolean") invalid("F5", "reversalRecorded");
    }
  });
  if (eventIds.some((eventId, index) => index > 0 && eventIds[index - 1] <= eventId)) invalid("F5", "commissionEvents.order");
  const statuses = array(row, "statusDistribution", "F5");
  uniqueCodes(statuses, "F5", "statusDistribution", ["已解锁可提", "冷却计提中", "已提现", "已撤销", "已冻结", "已拒绝", "待追回"], "name");
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
  array(row, "anomalies", "F5").forEach((value, index) => {
    const anomaly = record(value, "F5", `anomalies[${index}]`);
    if (anomaly.currency !== undefined && !["USDT", "UVT"].includes(text(anomaly.currency, "F5", `anomalies[${index}].currency`))) invalid("F5", `anomalies[${index}].currency`);
  });
  if (row.layerRatioComparisons !== undefined) {
    array(row, "layerRatioComparisons", "F5").forEach((value, index) => {
      const path = `layerRatioComparisons[${index}]`;
      const comparison = record(value, "F5", path);
      const currency = text(comparison.currency, "F5", `${path}.currency`);
      if (!["USDT", "UVT"].includes(currency)) invalid("F5", `${path}.currency`);
      if (comparison.available === false) {
        if (!["F5_LAYER_RATIO_THEORY_UNAVAILABLE", "F5_LAYER_RATIO_LAYER_UNAVAILABLE", "F5_LAYER_RATIO_SAMPLE_UNAVAILABLE"].includes(text(comparison.reason, "F5", `${path}.reason`))
          || comparison.layers !== null || comparison.theoreticalPct !== null || comparison.deviation !== null) invalid("F5", path);
      } else if (comparison.available === true) {
        if (currency !== "USDT" || comparison.reason !== null) invalid("F5", path);
        array(comparison, "layers", "F5").forEach((value, layerIndex) => {
          const layerPath = `${path}.layers[${layerIndex}]`;
          const layer = record(value, "F5", layerPath);
          positiveInteger(layer.layer, "F5", `${layerPath}.layer`);
          for (const key of ["actualPct", "theoreticalPct", "deviation"]) {
            if (typeof layer[key] !== "string" || f4Decimal(layer[key]) === null) invalid("F5", `${layerPath}.${key}`);
          }
        });
      } else invalid("F5", `${path}.available`);
    });
  }
  array(row, "coolingPolicy", "F5");
  array(row, "operationHistory", "F5");
  array(row, "activeSuspensions", "F5").forEach((value, index) => {
    const suspension = record(value, "F5", `activeSuspensions[${index}]`);
    positiveInteger(suspension.userId, "F5", `activeSuspensions[${index}].userId`);
    if (!F5_KINDS.includes(text(suspension.kind, "F5", `activeSuspensions[${index}].kind`))) invalid("F5", "activeSuspensions.kind");
  });
  if (row.coverage != null) {
    const coverage = object(row, "coverage", "F5");
    if (coverage.reliable !== undefined && typeof coverage.reliable !== "boolean") invalid("F5", "coverage.reliable");
    for (const key of ["coverageRatio", "redlinePct"]) if (coverage[key] != null) finite(coverage[key], "F5", `coverage.${key}`);
  }
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
