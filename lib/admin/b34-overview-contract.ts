type JsonRecord = Record<string, unknown>;

const B3_STAGE_KEYS = ["register", "kyc", "purchase", "repurchase", "withdraw"] as const;
const B4_LINK_KEYS = ["H1", "B3", "B1", "B2"] as const;

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
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(normalized)) invalid(moduleId, field);
  return normalized;
}

function nullableFinite(value: unknown, moduleId: "B3" | "B4", field: string) {
  if (value !== null) finite(value, moduleId, field);
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
    finite(stage.distinctUsers, "B3", `stages.${index}.distinctUsers`);
    finite(stage.previousUsers, "B3", `stages.${index}.previousUsers`);
    nullableFinite(stage.cvrFromPrev, "B3", `stages.${index}.cvrFromPrev`);
    nullableFinite(stage.momDelta, "B3", `stages.${index}.momDelta`);
  }

  const metrics = record(data.auxMetrics, "B3", "auxMetrics");
  for (const key of [
    "storeViewRate",
    "purchaseFromStoreRate",
    "day0AccessRate",
    "day7Retention",
  ]) {
    nullableFinite(metrics[key], "B3", `auxMetrics.${key}`);
  }
  for (const key of [
    "storeViewNumerator",
    "storeViewDenominator",
    "purchaseFromStoreNumerator",
    "purchaseFromStoreDenominator",
    "day0Numerator",
    "day0Denominator",
    "day0Target",
    "day7Numerator",
    "day7Denominator",
    "day7Target",
  ]) {
    finite(metrics[key], "B3", `auxMetrics.${key}`);
  }
  boolean(metrics.day7Mature, "B3", "auxMetrics.day7Mature");

  records(data.trend, "B3", "trend");
  records(data.savedViews, "B3", "savedViews");
  records(data.crossDomainLinks, "B3", "crossDomainLinks");
  const sources = strings(data.sources, "B3", "sources");
  if (!sources.length || sources.some((source) => !source.trim())) invalid("B3", "sources");
  text(data.sourceStatement, "B3", "sourceStatement");
}

export function assertB4PhaseOverview(value: unknown): asserts value is JsonRecord {
  const data = record(value, "B4", "data");
  boolean(data.available, "B4", "available");

  const filters = record(data.filters, "B4", "filters");
  const granularity = text(filters.granularity, "B4", "filters.granularity");
  if (!["PHASE", "MONTH"].includes(granularity)) invalid("B4", "filters.granularity");
  finite(filters.month, "B4", "filters.month");
  text(filters.phase, "B4", "filters.phase");
  if (!Array.isArray(filters.monthOptions) || filters.monthOptions.some((item) => !Number.isFinite(Number(item)))) {
    invalid("B4", "filters.monthOptions");
  }
  strings(filters.phaseOptions, "B4", "filters.phaseOptions");

  const rhythm = record(data.rhythm, "B4", "rhythm");
  text(rhythm.currentPhase, "B4", "rhythm.currentPhase");
  for (const key of ["currentMonth", "totalMonths", "phaseProgressPct"]) {
    finite(rhythm[key], "B4", `rhythm.${key}`);
  }

  for (const key of ["phaseDistribution", "monthDistribution", "distribution"]) {
    const distribution = records(data[key], "B4", key);
    for (const [index, row] of distribution.entries()) {
      text(row.phase, "B4", `${key}.${index}.phase`);
      finite(row.userCount, "B4", `${key}.${index}.userCount`);
      boolean(row.inScope, "B4", `${key}.${index}.inScope`);
    }
  }

  const dials = records(data.dials, "B4", "dials");
  if (dials.length !== 8 || new Set(dials.map((dial) => dial.key)).size !== 8) invalid("B4", "dials");
  for (const [index, dial] of dials.entries()) {
    for (const key of ["key", "label", "source", "v1Status", "adjustHref"]) {
      text(dial[key], "B4", `dials.${index}.${key}`);
    }
    if (!["string", "number", "boolean"].includes(typeof dial.currentValue)) {
      invalid("B4", `dials.${index}.currentValue`);
    }
    if (typeof dial.unit !== "string") invalid("B4", `dials.${index}.unit`);
    boolean(dial.v1Active, "B4", `dials.${index}.v1Active`);
  }

  const pivot = record(data.nextPivot, "B4", "nextPivot");
  if (pivot.atMonth !== null) finite(pivot.atMonth, "B4", "nextPivot.atMonth");
  if (pivot.daysLeft !== null) finite(pivot.daysLeft, "B4", "nextPivot.daysLeft");
  strings(pivot.changes, "B4", "nextPivot.changes");
  text(pivot.basis, "B4", "nextPivot.basis");
  text(pivot.message, "B4", "nextPivot.message");

  records(data.monthLeverCombo, "B4", "monthLeverCombo");
  const links = records(data.attributionLinks, "B4", "attributionLinks");
  exactKeys(links, B4_LINK_KEYS, "key", "B4", "attributionLinks");
  const sources = strings(data.sources, "B4", "sources");
  if (!sources.length || sources.some((source) => !source.trim())) invalid("B4", "sources");
  text(data.sourceStatement, "B4", "sourceStatement");
  text(data.asOf, "B4", "asOf");
}
