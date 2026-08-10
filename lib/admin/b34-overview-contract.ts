import { parseStrictFiniteNumber } from "./strict-number.ts";
import { isConsecutiveDayLabels, isIncreasingIsoWeekLabels } from "./time-series-contract.ts";

type JsonRecord = Record<string, unknown>;

const B3_STAGE_KEYS = ["register", "purchase", "repurchase", "withdraw"] as const;
const B4_LINK_KEYS = ["H1", "B3", "B1", "B2"] as const;
const B4_PHASES = ["P1", "P2", "P3", "P4", "P5", "P6"] as const;
const B4_TOTAL_MONTH_OPTIONS = [9, 12, 15, 18, 24] as const;
const B4_DIAL_KEYS = [
  "newUserBonusMultiplier",
  "inviteRewardMultiplier",
  "reinvestMultiplier",
  "withdrawPenaltyFeeRate",
  "withdrawCooldownDays",
  "binaryDailyCap",
  "questBonusMultiplier",
  "complianceHoldEnabled",
] as const;

function invalid(moduleId: "B3" | "B4", field: string): never {
  throw new Error(`${moduleId}_RESPONSE_INVALID:${field}`);
}

function record(value: unknown, moduleId: "B3" | "B4", field: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(moduleId, field);
  return value as JsonRecord;
}

function records(value: unknown, moduleId: "B3" | "B4", field: string): JsonRecord[] {
  if (!Array.isArray(value)) invalid(moduleId, field);
  return value.map((item, index) => record(item, moduleId, `${field}.${index}`));
}

function strings(value: unknown, moduleId: "B3" | "B4", field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) invalid(moduleId, field);
  return value as string[];
}

function text(value: unknown, moduleId: "B3" | "B4", field: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(moduleId, field);
  return value.trim();
}

function finite(value: unknown, moduleId: "B3" | "B4", field: string): number {
  const normalized = parseStrictFiniteNumber(value);
  if (normalized === null) invalid(moduleId, field);
  return normalized;
}

function nullableFinite(value: unknown, moduleId: "B3" | "B4", field: string) {
  if (value !== null) finite(value, moduleId, field);
}

function nonNegativeInteger(value: unknown, moduleId: "B3" | "B4", field: string): number {
  const normalized = finite(value, moduleId, field);
  if (!Number.isInteger(normalized) || normalized < 0) invalid(moduleId, field);
  return normalized;
}

function nullablePercentage(value: unknown, moduleId: "B3" | "B4", field: string): number | null {
  if (value === null) return null;
  const normalized = finite(value, moduleId, field);
  if (normalized < 0 || normalized > 100) invalid(moduleId, field);
  return normalized;
}

function ratio(
  numeratorValue: unknown,
  denominatorValue: unknown,
  rateValue: unknown,
  moduleId: "B3" | "B4",
  field: string,
) {
  const numerator = nonNegativeInteger(numeratorValue, moduleId, `${field}.numerator`);
  const denominator = nonNegativeInteger(denominatorValue, moduleId, `${field}.denominator`);
  if (numerator > denominator) invalid(moduleId, `${field}.numerator`);
  const rate = nullablePercentage(rateValue, moduleId, `${field}.rate`);
  if (denominator === 0) {
    if (rate !== null) invalid(moduleId, `${field}.rate`);
    return;
  }
  if (rate === null) invalid(moduleId, `${field}.rate`);
  const expected = Math.round((numerator * 1000) / denominator) / 10;
  if (Math.abs(rate - expected) > 0.05) invalid(moduleId, `${field}.rate`);
}

function numberInRange(value: unknown, min: number, max: number, moduleId: "B3" | "B4", field: string): number {
  const normalized = finite(value, moduleId, field);
  if (normalized < min || normalized > max) invalid(moduleId, field);
  return normalized;
}

function boolean(value: unknown, moduleId: "B3" | "B4", field: string): boolean {
  if (typeof value !== "boolean") invalid(moduleId, field);
  return value;
}

function exactKeys(
  rows: JsonRecord[],
  expected: readonly string[],
  key: string,
  moduleId: "B3" | "B4",
  field: string,
) {
  const actual = rows.map((row, index) => text(row[key], moduleId, `${field}.${index}.${key}`));
  if (
    actual.length !== expected.length
    || new Set(actual).size !== expected.length
    || expected.some((value) => !actual.includes(value))
  ) {
    invalid(moduleId, field);
  }
}

export function assertB3Dashboard(value: unknown): asserts value is JsonRecord {
  const data = record(value, "B3", "data");
  const available = boolean(data.available, "B3", "available");
  text(data.generatedAt, "B3", "generatedAt");

  const filters = record(data.filters, "B3", "filters");
  for (const key of ["cohort", "phase", "ref"]) text(filters[key], "B3", `filters.${key}`);

  const options = record(data.filterOptions, "B3", "filterOptions");
  for (const key of ["cohorts", "phases", "refs"]) strings(options[key], "B3", `filterOptions.${key}`);

  const stages = records(data.stages, "B3", "stages");
  if (available) exactKeys(stages, B3_STAGE_KEYS, "key", "B3", "stages");
  for (const [index, stage] of stages.entries()) {
    for (const key of ["stage", "event", "lifecycleLabel", "color", "source"]) {
      text(stage[key], "B3", `stages.${index}.${key}`);
    }
    const distinctUsers = nonNegativeInteger(stage.distinctUsers, "B3", `stages.${index}.distinctUsers`);
    const previousUsers = nonNegativeInteger(stage.previousUsers, "B3", `stages.${index}.previousUsers`);
    if (index === 0) {
      if (distinctUsers !== previousUsers || stage.cvrFromPrev !== null) invalid("B3", `stages.${index}.cvrFromPrev`);
    } else {
      const previousStageUsers = nonNegativeInteger(stages[index - 1].distinctUsers, "B3", `stages.${index - 1}.distinctUsers`);
      if (previousUsers !== previousStageUsers || distinctUsers > previousUsers) invalid("B3", `stages.${index}.distinctUsers`);
      ratio(distinctUsers, previousUsers, stage.cvrFromPrev, "B3", `stages.${index}.cvrFromPrev`);
    }
    nullableFinite(stage.momDelta, "B3", `stages.${index}.momDelta`);
  }

  const metrics = record(data.auxMetrics, "B3", "auxMetrics");
  ratio(metrics.storeViewNumerator, metrics.storeViewDenominator, metrics.storeViewRate, "B3", "auxMetrics.storeViewRate");
  ratio(metrics.purchaseFromStoreNumerator, metrics.purchaseFromStoreDenominator, metrics.purchaseFromStoreRate, "B3", "auxMetrics.purchaseFromStoreRate");
  ratio(metrics.day0Numerator, metrics.day0Denominator, metrics.day0AccessRate, "B3", "auxMetrics.day0AccessRate");
  ratio(metrics.day7Numerator, metrics.day7Denominator, metrics.day7Retention, "B3", "auxMetrics.day7Retention");
  if (nullablePercentage(metrics.day0Target, "B3", "auxMetrics.day0Target") !== 95) invalid("B3", "auxMetrics.day0Target");
  if (nullablePercentage(metrics.day7Target, "B3", "auxMetrics.day7Target") !== 60) invalid("B3", "auxMetrics.day7Target");
  const day7Mature = boolean(metrics.day7Mature, "B3", "auxMetrics.day7Mature");
  const day7Denominator = nonNegativeInteger(metrics.day7Denominator, "B3", "auxMetrics.day7Denominator");
  if (day7Mature !== (day7Denominator > 0)) invalid("B3", "auxMetrics.day7Mature");

  const trend = records(data.trend, "B3", "trend");
  for (const [index, point] of trend.entries()) {
    text(point.cohort, "B3", `trend.${index}.cohort`);
    nonNegativeInteger(point.distinctUsers, "B3", `trend.${index}.distinctUsers`);
    nullablePercentage(point.cvrFromPrev, "B3", `trend.${index}.cvrFromPrev`);
  }
  const trendLabels = trend.map((point) => String(point.cohort));
  if ((available && (trend.length < 1 || trend.length > 13 || !isIncreasingIsoWeekLabels(trendLabels)))
      || (!available && trend.length !== 0)) invalid("B3", "trend");
  const dailyTarget = finite(data.dailyFirstPurchaseTargetPct, "B3", "dailyFirstPurchaseTargetPct");
  if (dailyTarget !== 18) invalid("B3", "dailyFirstPurchaseTargetPct");
  const daily = records(data.dailyFirstPurchase, "B3", "dailyFirstPurchase");
  if (daily.length !== 8) invalid("B3", "dailyFirstPurchase");
  const dailyDates = new Set<string>();
  for (const [index, point] of daily.entries()) {
    dailyDates.add(text(point.date, "B3", `dailyFirstPurchase.${index}.date`));
    try {
      ratio(point.firstPurchaseUsers, point.registeredUsers, point.conversionPct, "B3", `dailyFirstPurchase.${index}.conversionPct`);
    } catch (error) {
      if (error instanceof Error && error.message.endsWith(`dailyFirstPurchase.${index}.conversionPct.numerator`)) {
        invalid("B3", `dailyFirstPurchase.${index}.firstPurchaseUsers`);
      }
      throw error;
    }
  }
  if (dailyDates.size !== 8 || !isConsecutiveDayLabels([...dailyDates])) invalid("B3", "dailyFirstPurchase.date");
  const channels = records(data.purchaseChannels, "B3", "purchaseChannels");
  let channelShareTotal = 0;
  let channelUserTotal = 0;
  for (const [index, channel] of channels.entries()) {
    text(channel.channel, "B3", `purchaseChannels.${index}.channel`);
    const firstPurchaseUsers = nonNegativeInteger(channel.firstPurchaseUsers, "B3", `purchaseChannels.${index}.firstPurchaseUsers`);
    if (firstPurchaseUsers === 0) invalid("B3", `purchaseChannels.${index}.firstPurchaseUsers`);
    const sharePct = nullablePercentage(channel.sharePct, "B3", `purchaseChannels.${index}.sharePct`);
    if (sharePct === null) invalid("B3", `purchaseChannels.${index}.sharePct`);
    channelUserTotal += firstPurchaseUsers;
    channelShareTotal += sharePct;
  }
  if (channels.length && Math.abs(channelShareTotal - 100) > Math.max(0.2, channels.length * 0.1)) {
    invalid("B3", "purchaseChannels.sharePct");
  }
  const purchaseStage = stages.find((stage) => stage.key === "purchase");
  const purchaseUsers = purchaseStage ? nonNegativeInteger(purchaseStage.distinctUsers, "B3", "stages.purchase.distinctUsers") : 0;
  if (channelUserTotal !== purchaseUsers || (purchaseUsers === 0) !== (channels.length === 0)) invalid("B3", "purchaseChannels");
  for (const [index, channel] of channels.entries()) {
    const expectedShare = Math.round((Number(channel.firstPurchaseUsers) * 100 / channelUserTotal) * 10) / 10;
    if (Math.abs(Number(channel.sharePct) - expectedShare) > 0.001) invalid("B3", `purchaseChannels.${index}.sharePct`);
  }
  records(data.savedViews, "B3", "savedViews");
  records(data.crossDomainLinks, "B3", "crossDomainLinks");
  const sources = strings(data.sources, "B3", "sources");
  if (!sources.length || sources.some((source) => !source.trim())) invalid("B3", "sources");
  text(data.sourceStatement, "B3", "sourceStatement");
}

export function assertB4PhaseOverview(value: unknown): asserts value is JsonRecord {
  const data = record(value, "B4", "data");
  const available = boolean(data.available, "B4", "available");

  const filters = record(data.filters, "B4", "filters");
  const granularity = text(filters.granularity, "B4", "filters.granularity");
  if (!["PHASE", "MONTH"].includes(granularity)) invalid("B4", "filters.granularity");
  const selectedMonth = nonNegativeInteger(filters.month, "B4", "filters.month");
  const selectedPhase = text(filters.phase, "B4", "filters.phase");
  if (selectedPhase !== "ALL" && !B4_PHASES.includes(selectedPhase as typeof B4_PHASES[number])) invalid("B4", "filters.phase");

  const rhythm = record(data.rhythm, "B4", "rhythm");
  const currentPhase = text(rhythm.currentPhase, "B4", "rhythm.currentPhase");
  if (!B4_PHASES.includes(currentPhase as typeof B4_PHASES[number])) invalid("B4", "rhythm.currentPhase");
  const totalMonths = nonNegativeInteger(rhythm.totalMonths, "B4", "rhythm.totalMonths");
  if (!B4_TOTAL_MONTH_OPTIONS.includes(totalMonths as typeof B4_TOTAL_MONTH_OPTIONS[number])) invalid("B4", "rhythm.totalMonths");
  const currentMonth = nonNegativeInteger(rhythm.currentMonth, "B4", "rhythm.currentMonth");
  if (currentMonth < 1 || currentMonth > totalMonths || selectedMonth < 1 || selectedMonth > totalMonths) invalid("B4", "rhythm");
  numberInRange(rhythm.phaseProgressPct, 0, 100, "B4", "rhythm.phaseProgressPct");
  const monthOptions = Array.isArray(filters.monthOptions)
    ? filters.monthOptions.map((item, index) => nonNegativeInteger(item, "B4", `filters.monthOptions.${index}`))
    : invalid("B4", "filters.monthOptions");
  if (monthOptions.length !== totalMonths || monthOptions.some((month, index) => month !== index + 1)) invalid("B4", "filters.monthOptions");
  const phaseOptions = strings(filters.phaseOptions, "B4", "filters.phaseOptions");
  if (phaseOptions.length !== B4_PHASES.length || phaseOptions.some((phase, index) => phase !== B4_PHASES[index])) invalid("B4", "filters.phaseOptions");

  const distributions = new Map<string, JsonRecord[]>();
  for (const key of ["phaseDistribution", "monthDistribution", "distribution"]) {
    const distribution = records(data[key], "B4", key);
    distributions.set(key, distribution);
    for (const [index, row] of distribution.entries()) {
      const phase = text(row.phase, "B4", `${key}.${index}.phase`);
      if (!B4_PHASES.includes(phase as typeof B4_PHASES[number])) invalid("B4", `${key}.${index}.phase`);
      nonNegativeInteger(row.userCount, "B4", `${key}.${index}.userCount`);
      boolean(row.inScope, "B4", `${key}.${index}.inScope`);
    }
  }
  const phaseDistribution = distributions.get("phaseDistribution")!;
  const monthDistribution = distributions.get("monthDistribution")!;
  const selectedDistribution = distributions.get("distribution")!;
  exactKeys(phaseDistribution, B4_PHASES, "phase", "B4", "phaseDistribution");
  if (monthDistribution.length !== totalMonths) invalid("B4", "monthDistribution");
  const monthKeys = monthDistribution.map((row, index) => nonNegativeInteger(row.month, "B4", `monthDistribution.${index}.month`));
  if (monthKeys.some((month, index) => month !== index + 1)) invalid("B4", "monthDistribution");
  if (selectedDistribution.length !== (granularity === "MONTH" ? totalMonths : B4_PHASES.length)) invalid("B4", "distribution");
  const phaseTotal = phaseDistribution.reduce((sum, item) => sum + Number(item.userCount), 0);
  const monthTotal = monthDistribution.reduce((sum, item) => sum + Number(item.userCount), 0);
  const selectedTotal = selectedDistribution.reduce((sum, item) => sum + Number(item.userCount), 0);
  if (phaseTotal !== monthTotal || phaseTotal !== selectedTotal || available !== (phaseTotal > 0)) invalid("B4", "distribution.userCount");

  const dials = records(data.dials, "B4", "dials");
  exactKeys(dials, B4_DIAL_KEYS, "key", "B4", "dials");
  for (const [index, dial] of dials.entries()) {
    for (const key of ["key", "label", "source", "v1Status", "adjustHref"]) {
      text(dial[key], "B4", `dials.${index}.${key}`);
    }
    const key = String(dial.key);
    if (key === "complianceHoldEnabled") {
      boolean(dial.currentValue, "B4", `dials.${index}.currentValue`);
    } else if (["newUserBonusMultiplier", "inviteRewardMultiplier", "reinvestMultiplier", "questBonusMultiplier"].includes(key)) {
      numberInRange(dial.currentValue, 1, 4, "B4", `dials.${index}.currentValue`);
    } else if (key === "withdrawPenaltyFeeRate") {
      numberInRange(dial.currentValue, 0, 100, "B4", `dials.${index}.currentValue`);
    } else if (key === "withdrawCooldownDays") {
      const days = nonNegativeInteger(dial.currentValue, "B4", `dials.${index}.currentValue`);
      if (days < 7 || days > 90) invalid("B4", `dials.${index}.currentValue`);
    } else if (key === "binaryDailyCap") {
      numberInRange(dial.currentValue, 0, 50_000, "B4", `dials.${index}.currentValue`);
    }
    if (typeof dial.unit !== "string") invalid("B4", `dials.${index}.unit`);
    boolean(dial.v1Active, "B4", `dials.${index}.v1Active`);
  }

  const pivot = record(data.nextPivot, "B4", "nextPivot");
  if (currentMonth >= totalMonths) {
    if (pivot.atMonth !== null || pivot.daysLeft !== null) invalid("B4", "nextPivot");
  } else {
    const atMonth = nonNegativeInteger(pivot.atMonth, "B4", "nextPivot.atMonth");
    if (atMonth !== currentMonth + 1) invalid("B4", "nextPivot.atMonth");
    if (pivot.daysLeft !== null) nonNegativeInteger(pivot.daysLeft, "B4", "nextPivot.daysLeft");
  }
  strings(pivot.changes, "B4", "nextPivot.changes");
  text(pivot.basis, "B4", "nextPivot.basis");
  text(pivot.message, "B4", "nextPivot.message");

  const levers = records(data.monthLeverCombo, "B4", "monthLeverCombo");
  if (levers.length > 3) invalid("B4", "monthLeverCombo");
  for (const [index, lever] of levers.entries()) {
    for (const key of ["key", "label", "purpose"]) text(lever[key], "B4", `monthLeverCombo.${index}.${key}`);
  }
  const links = records(data.attributionLinks, "B4", "attributionLinks");
  exactKeys(links, B4_LINK_KEYS, "key", "B4", "attributionLinks");
  for (const [index, link] of links.entries()) {
    text(link.label, "B4", `attributionLinks.${index}.label`);
    text(link.href, "B4", `attributionLinks.${index}.href`);
  }
  const sources = strings(data.sources, "B4", "sources");
  if (!sources.length || sources.some((source) => !source.trim())) invalid("B4", "sources");
  text(data.sourceStatement, "B4", "sourceStatement");
  text(data.asOf, "B4", "asOf");
}
