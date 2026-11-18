import type { L1Granularity, L1KpiQuery } from "@/lib/admin/l-client";

type JsonRecord = Record<string, unknown>;
const KPI_IDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const L1_COHORT_CONTRACT = "L1_REGISTRATION_COHORT_V1";
const COUNTS = ["cohortSize", "eligibleUsers", "sampleSize", "numerator", "denominator"] as const;
const BOUNDARIES = ["bucketKey", "startDate", "endDateExclusive", "registrationFrom", "registrationToExclusive", "selectedFrom", "selectedToExclusive", "partial", "observationAsOf"] as const;
const METRIC_FIELDS = [...COUNTS, "value", "available", "unavailableReason", "suppressed", "sampleBasis", "mature", "maturityStatus"] as const;

export type L1CohortPoint = JsonRecord & {
  bucketKey: string;
  value: number | null;
  suppressed: boolean;
  available: boolean;
  unavailableReason: string | null;
  maturityStatus: string;
};
export type L1KpiRow = {
  n: number;
  kpiId: string;
  name: string;
  value: number | null;
  target: number;
  unit: string;
  dir: "gte" | "lte" | "band";
  band: number[];
  vis: string;
  spark: (number | null)[];
  sparkSuppressed?: boolean[];
  suppressed?: boolean;
  previousSuppressed?: boolean;
  available: boolean;
  unavailableReason: string | null;
  momDelta: number | null;
  numerator: number | null;
  denominator: number | null;
  scope?: "REGISTRATION_COHORT" | "NOT_APPLICABLE_TO_COHORT";
  maturityStatus?: string;
  points?: L1CohortPoint[];
};
export type L1Dashboard = JsonRecord & {
  kpis: L1KpiRow[];
  weeks: string[];
  query?: L1KpiQuery;
  granularity?: L1Granularity;
  observationAsOf?: string;
  applicableKpiCount?: number;
};

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("L1_DATA_PROTOCOL_INVALID");
  return value as JsonRecord;
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function date(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function instant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
    && date(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}
function sameInstant(a: unknown, b: unknown) {
  const canonical = (value: string) => value.replace(/(\.\d*?)0+Z$/, "$1Z").replace(".Z", "Z");
  return instant(a) && instant(b) && canonical(a) === canonical(b);
}
function validTrend(values: unknown, markers: unknown, length: number) {
  return Array.isArray(values) && (values.length === 0 || values.length === length)
    && values.every(point => point === null || finite(point))
    && (markers === undefined || Array.isArray(markers) && markers.length === values.length
      && markers.every((masked, index) => typeof masked === "boolean" && (!masked || values[index] === null)));
}
function metadata(value: unknown, expectedId: number) {
  const row = record(value);
  if (row.n !== expectedId || String(row.kpiId) !== String(expectedId)) throw new Error("L1_KPI_ID_SEQUENCE_INVALID");
  if (typeof row.name !== "string" || !row.name.trim() || !finite(row.target)
      || !["gte", "lte", "band"].includes(String(row.dir)) || !["%", "d"].includes(String(row.unit))
      || !Array.isArray(row.band) || !row.band.every(finite)
      || (row.dir === "band" && (row.band.length !== 2 || row.band[0] > row.band[1]))
      || typeof row.vis !== "string" || typeof row.available !== "boolean"
      || (row.available ? !finite(row.value) || (row.unit === "%" ? row.value < 0 || row.value > 100 : row.value <= 0) : row.value !== null)) {
    throw new Error("L1_KPI_ROW_INVALID");
  }
  return row;
}
function legacyKpi(value: unknown, expectedId: number): L1KpiRow {
  const row = metadata(value, expectedId);
  if (!validTrend(row.spark, row.sparkSuppressed, 6)
      || (row.suppressed === true
        ? row.available || row.numerator != null || row.denominator != null || row.momDelta != null
        : !count(row.numerator) || !count(row.denominator))) throw new Error("L1_KPI_ROW_INVALID");
  return row as L1KpiRow;
}

function cohortHeader(data: JsonRecord, expected?: L1KpiQuery) {
  if (expected?.granularity && data.contractVersion === undefined) throw new Error("L1_COHORT_NOT_SUPPORTED");
  if (data.contractVersion !== L1_COHORT_CONTRACT) throw new Error("L1_DATA_PROTOCOL_INVALID");
  const query = record(data.query);
  const range = record(data.range);
  const calendar = record(data.calendar);
  const coverage = record(data.coverage);
  const capabilities = record(data.capabilities);
  if (data.module !== "L1" || !["registration_week", "registration_month"].includes(String(data.granularity))
      || !instant(data.observationAsOf) || query.granularity !== data.granularity || !sameInstant(query.asOf, data.observationAsOf)
      || query.window !== data.window || !["1d", "7d", "30d", "custom"].includes(String(query.window))
      || !["from", "to", "cohort", "phase", "locale", "ref"].every(key => typeof query[key] === "string")
      || !instant(range.registrationFrom) || !instant(range.registrationToExclusive)
      || Date.parse(range.registrationFrom) > Date.parse(range.registrationToExclusive)
      || Date.parse(range.registrationToExclusive) > Date.parse(data.observationAsOf)
      || (range.selectedFrom === null && range.selectedToExclusive === null ? false
        : !instant(range.selectedFrom) || !instant(range.selectedToExclusive)
          || Date.parse(range.selectedFrom) >= Date.parse(range.selectedToExclusive)
          || Date.parse(range.selectedFrom) < Date.parse(range.registrationFrom)
          || Date.parse(range.selectedToExclusive) > Date.parse(range.registrationToExclusive))
      || calendar.track !== "LEGACY" || calendar.weekStartsOn !== "MONDAY" || calendar.weekNumbering !== "ISO"
      || !Array.isArray(calendar.versions) || !calendar.versions.length
      || !calendar.versions.every(value => { const version = record(value); return date(version.effectiveDate) && typeof version.zoneId === "string" && version.zoneId.length > 0; })
      || coverage.registrationTimeSource !== "nx_user.created_at" || typeof coverage.historyComplete !== "boolean"
      || !["COMPLETE", "INCOMPLETE"].includes(String(coverage.registrationEventCoverage))
      || capabilities.registrationCohorts !== true || capabilities.minimumSampleSize !== 5
      || capabilities.maxPoints !== 60 || capabilities.phaseMarkers !== false || data.phaseSwitchIndex !== null
      || data.applicableKpiCount !== 7 || !count(data.onTargetKpiCount) || data.onTargetKpiCount > 7) {
    throw new Error("L1_COHORT_METADATA_INVALID");
  }
  const filters = record(data.filters);
  for (const key of ["cohort", "phase", "locale", "ref"] as const) {
    if (filters[key] !== (query[key] || null)) throw new Error("L1_COHORT_QUERY_MISMATCH");
  }
  if (expected) {
    const normalized: L1KpiQuery = { ...expected, window: expected.window ?? "7d", phase: expected.phase?.trim().toUpperCase(), locale: expected.locale?.trim().toLowerCase() };
    if (expected.granularity !== data.granularity
        || expected.asOf && !sameInstant(expected.asOf, data.observationAsOf)
        || ["window", "from", "to", "cohort", "phase", "locale", "ref"].some(key =>
          String(normalized[key as keyof L1KpiQuery] ?? "").trim() !== query[key])) throw new Error("L1_COHORT_QUERY_MISMATCH");
  }
  return { range, granularity: data.granularity as L1Granularity, asOf: data.observationAsOf };
}

function cohortMetric(row: JsonRecord, id: number) {
  const reason = row.unavailableReason;
  const applicable = id !== 8;
  const basis = id === 1 || id === 3 ? "NUMERATOR_USERS" : "DENOMINATOR_USERS";
  const noDenominator = ["NO_REGISTRATION_DENOMINATOR", "NO_MATURE_DAY7_COHORT", "NO_REGISTRATION_DENOMINATOR", "NO_STORE_VIEW_DENOMINATOR", "NO_DEVICE_HOLDER_DENOMINATOR", "NO_PUSH_SENT_DENOMINATOR", "NO_DIRECT_REFERRAL_DENOMINATOR"][id - 1];
  if (typeof row.suppressed !== "boolean" || typeof row.available !== "boolean"
      || row.sampleBasis !== (applicable ? basis : null)
      || (row.available
        ? row.suppressed || reason !== null || !finite(row.value) || row.value < 0 || row.value > 100
          || !COUNTS.every(key => count(row[key])) || Number(row.denominator) === 0
          || Number(row.numerator) > Number(row.denominator) || row.eligibleUsers !== row.denominator
          || Number(row.cohortSize) < Number(row.denominator)
          || row.sampleSize !== row[id === 1 || id === 3 ? "numerator" : "denominator"] || Number(row.sampleSize) < 5
        : row.value !== null || !COUNTS.every(key => row[key] === null)
          || !["SOURCE_INCOMPLETE", "COHORT_NOT_APPLICABLE", "BELOW_MINIMUM", noDenominator, ...(id === 1 ? ["NO_MATURE_DAY0_COHORT"] : [])].includes(String(reason)))
      || (!applicable ? row.available || row.suppressed || reason !== "COHORT_NOT_APPLICABLE"
        : reason === "COHORT_NOT_APPLICABLE" || (reason === "SOURCE_INCOMPLETE" ? row.suppressed : !row.available && !row.suppressed))
      || (id >= 3 ? row.mature !== null || row.maturityStatus !== (applicable ? "OPEN_ENDED" : "NOT_APPLICABLE")
        : !["UNKNOWN", "IMMATURE", "PARTIAL", "MATURE"].includes(String(row.maturityStatus))
          || row.mature !== (row.maturityStatus === "UNKNOWN" ? null : row.maturityStatus === "MATURE")
          || row.available && !["PARTIAL", "MATURE"].includes(String(row.maturityStatus)))) {
    throw new Error("L1_COHORT_METRIC_INVALID");
  }
}

function cohortKpi(value: unknown, id: number, header: ReturnType<typeof cohortHeader>, axis?: L1CohortPoint[]): L1KpiRow {
  const row = metadata(value, id);
  cohortMetric(row, id);
  if (row.scope !== (id === 8 ? "NOT_APPLICABLE_TO_COHORT" : "REGISTRATION_COHORT")
      || row.momDelta !== null || row.comparisonUnavailableReason !== "COHORT_COMPARISON_UNDEFINED"
      || !Array.isArray(row.points) || row.points.length > 60
      || (header.range.selectedFrom === null ? row.points.length !== 0 : row.points.length === 0)
      || axis && row.points.length !== axis.length) throw new Error("L1_COHORT_POINTS_INVALID");
  const keys = new Set<string>();
  const points = row.points.map((value, index) => {
    const point = record(value);
    cohortMetric(point, id);
    if (typeof point.bucketKey !== "string" || keys.has(point.bucketKey)
        || !(header.granularity === "registration_week" ? /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/ : /^\d{4}-(?:0[1-9]|1[0-2])$/).test(point.bucketKey)
        || !date(point.startDate) || !date(point.endDateExclusive) || point.startDate >= point.endDateExclusive
        || !["registrationFrom", "registrationToExclusive", "selectedFrom", "selectedToExclusive"].every(key => instant(point[key]))
        || Date.parse(String(point.registrationFrom)) >= Date.parse(String(point.registrationToExclusive))
        || Date.parse(String(point.selectedFrom)) >= Date.parse(String(point.selectedToExclusive))
        || Date.parse(String(point.selectedFrom)) < Date.parse(String(point.registrationFrom))
        || Date.parse(String(point.selectedToExclusive)) > Date.parse(String(point.registrationToExclusive))
        || !sameInstant(point.observationAsOf, header.asOf)
        || point.partial !== (!sameInstant(point.registrationFrom, point.selectedFrom) || !sameInstant(point.registrationToExclusive, point.selectedToExclusive))
        || !sameInstant(point.selectedFrom, index === 0 ? header.range.selectedFrom : record((row.points as unknown[])[index - 1]).selectedToExclusive)
        || index === (row.points as unknown[]).length - 1 && !sameInstant(point.selectedToExclusive, header.range.selectedToExclusive)
        || axis && BOUNDARIES.some(key => point[key] !== axis[index][key])) throw new Error("L1_COHORT_POINTS_INVALID");
    keys.add(point.bucketKey);
    const start = new Date(point.startDate);
    const end = new Date(start);
    if (header.granularity === "registration_week") {
      const thursday = new Date(start);
      thursday.setUTCDate(start.getUTCDate() + 3);
      const year = thursday.getUTCFullYear();
      const january4 = new Date(Date.UTC(year, 0, 4));
      const firstMonday = january4.getTime() - ((january4.getUTCDay() + 6) % 7) * 86_400_000;
      const week = 1 + Math.round((start.getTime() - firstMonday) / (7 * 86_400_000));
      if (start.getUTCDay() !== 1 || point.bucketKey !== `${year}-W${String(week).padStart(2, "0")}`) throw new Error("L1_COHORT_POINTS_INVALID");
      end.setUTCDate(start.getUTCDate() + 7);
    } else {
      if (start.getUTCDate() !== 1 || point.bucketKey !== point.startDate.slice(0, 7)) throw new Error("L1_COHORT_POINTS_INVALID");
      end.setUTCMonth(start.getUTCMonth() + 1);
    }
    if (end.toISOString().slice(0, 10) !== point.endDateExclusive) throw new Error("L1_COHORT_POINTS_INVALID");
    return point as L1CohortPoint;
  });
  return { ...row, points, spark: points.map(point => point.value), sparkSuppressed: points.map(point => point.suppressed) } as L1KpiRow;
}

function definitions(data: JsonRecord, kpis: L1KpiRow[]) {
  const plain = record(data.kpiPlain);
  const ext = record(data.kpiExt);
  for (const row of kpis) {
    const definition = record(ext[row.n]);
    if (typeof plain[row.n] !== "string" || typeof definition.fx !== "string"
        || !Array.isArray(definition.fxBold) || !definition.fxBold.every(item => typeof item === "string")
        || typeof definition.note !== "string" || typeof definition.delta !== "string"
        || !["num", "den"].every(key => definition[key] === null || typeof definition[key] === "string")
        || !Array.isArray(definition.jump) || !definition.jump.every(value => {
          const link = record(value); return typeof link.label === "string" && (link.href === undefined || typeof link.href === "string");
        })
        || (row.suppressed || row.scope && !row.available) && (definition.num !== null || definition.den !== null)) {
      throw new Error("L1_KPI_DEFINITION_SET_INVALID");
    }
  }
}

export function validateL1Dashboard(value: unknown, expected?: L1KpiQuery): L1Dashboard {
  const data = record(value);
  if (expected?.granularity && data.contractVersion === undefined) throw new Error("L1_COHORT_NOT_SUPPORTED");
  if (data.module !== "L1" || !Array.isArray(data.kpis) || data.kpis.length !== 8) throw new Error("L1_DASHBOARD_SHAPE_INVALID");
  let kpis: L1KpiRow[];
  let weeks: string[];
  if (data.contractVersion !== undefined) {
    const header = cohortHeader(data, expected);
    kpis = [];
    for (const id of KPI_IDS) kpis.push(cohortKpi(data.kpis[id - 1], id, header, kpis[0]?.points));
    weeks = kpis[0].points!.map(point => point.bucketKey);
  } else {
    kpis = data.kpis.map((row, index) => legacyKpi(row, KPI_IDS[index]));
    if (!Array.isArray(data.weeks) || data.weeks.length !== 6 || !data.weeks.every(item => typeof item === "string" && item.length > 0)) throw new Error("L1_TREND_LABELS_INVALID");
    weeks = data.weeks;
  }
  definitions(data, kpis);
  return { ...data, kpis, weeks } as L1Dashboard;
}

export function validateL1Drilldown(value: unknown, expectedId: number, expected?: L1KpiQuery & { bucketKey?: string }, axis?: string[]) {
  const data = record(value);
  if (expected?.granularity && data.contractVersion === undefined) throw new Error("L1_COHORT_NOT_SUPPORTED");
  if (data.module !== "L1" || data.kpiId !== expectedId) throw new Error("L1_DRILLDOWN_ID_INVALID");
  if (data.contractVersion !== undefined) {
    const header = cohortHeader(data, expected);
    const selected = cohortKpi(data.selected, expectedId, header);
    const points = selected.points!;
    if (!Array.isArray(data.points) || data.points.length !== points.length
        || data.points.some((value, index) => {
          const point = record(value);
          return [...BOUNDARIES, ...METRIC_FIELDS].some(key => point[key] !== points[index][key]);
        }) || axis && (axis.length !== points.length || points.some((point, index) => point.bucketKey !== axis[index]))) throw new Error("L1_COHORT_POINTS_INVALID");
    if (expected?.bucketKey !== undefined && data.bucketKey !== expected.bucketKey) throw new Error("L1_COHORT_POINTS_INVALID");
    if (data.bucketKey !== undefined) {
      const selectedPoint = record(data.selectedPoint);
      const point = points.find(point => point.bucketKey === data.bucketKey);
      if (!point || [...BOUNDARIES, ...METRIC_FIELDS].some(key => selectedPoint[key] !== point[key])) throw new Error("L1_COHORT_POINTS_INVALID");
    }
    definitions(data, [selected]);
    return { ...data, selected, points, weeks: points.map(point => point.bucketKey) };
  }
  return { ...data, selected: legacyKpi(data.selected, expectedId), points: undefined, weeks: data.weeks };
}

export function validateL1Trend(value: unknown, expectedId: number, expected?: L1KpiQuery, axis?: string[]) {
  const data = record(value);
  if (expected?.granularity && data.contractVersion === undefined) throw new Error("L1_COHORT_NOT_SUPPORTED");
  if (data.contractVersion !== undefined) {
    const checked = validateL1Drilldown(data, expectedId, expected, axis);
    return { ...checked, labels: checked.weeks as string[], values: checked.selected.spark, suppressedPoints: checked.selected.sparkSuppressed };
  }
  if (data.module !== "L1" || data.kpiId !== expectedId || !Array.isArray(data.labels) || data.labels.length !== 6
      || !data.labels.every(item => typeof item === "string" && item.length > 0)
      || !validTrend(data.values, data.suppressedPoints, data.labels.length)) throw new Error("L1_TREND_PROTOCOL_INVALID");
  return { ...data, labels: data.labels as string[], values: data.values as (number | null)[], suppressedPoints: data.suppressedPoints as boolean[] | undefined };
}
