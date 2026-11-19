import type { CohortRow } from "./l2-funnel-views";

const CURVE_DAYS = [1, 3, 7, 14, 21, 30, 60];
const MATRIX_DAYS = [1, 7, 14, 30, 60];
const WEEK = /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const MISSING = "DAU_NOT_COLLECTED";
const IMMATURE = "WINDOW_IMMATURE";
const PROTECTED = "BELOW_MINIMUM";
const NO_COHORT = "NO_REGISTRATION_COHORT";

type WireObject = Record<string, unknown>;
type Coverage = { retentionCollectionFrom: string | null };
type Point = [number, number];
export type L2RetentionMatrix = WireObject & Coverage & { cohorts: CohortRow[] };
export type L2RetentionCurve = Coverage & {
  curve: Point[];
  retentionUnavailableReasons: Record<string, string>;
  suppressed?: boolean;
};

function record(value: unknown): value is WireObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validL2CollectionDate(value: unknown): value is string | null {
  return value === null || typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function optionalProtection(value: unknown) {
  return value === undefined || typeof value === "boolean";
}

function rate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function validDay7(value: unknown, coverage: string | null) {
  if (!record(value) || !optionalProtection(value.suppressed) || !rate(value.target)) return false;
  if (value.available === true) return coverage !== null && value.suppressed !== true && rate(value.value) && value.unavailableReason === null;
  if (value.available !== false || value.value !== null) return false;
  if (value.suppressed === true) return coverage !== null && value.unavailableReason === PROTECTED;
  return value.unavailableReason === MISSING || value.unavailableReason === "NO_MATURE_DAY7_COHORT";
}

function validReasons(value: unknown, suppressed: boolean, coverage: string | null): value is Record<string, string> {
  if (!record(value) || !Object.entries(value).every(([key, reason]) =>
    CURVE_DAYS.some(day => key === `d${day}`)
    && (reason === MISSING || reason === IMMATURE || suppressed && coverage !== null && reason === PROTECTED))) return false;
  return !suppressed || CURVE_DAYS.every(day => value[`d${day}`] !== undefined);
}

function validCohorts(raw: unknown, pattern: RegExp, coverage: string | null, allowEmpty = false): raw is CohortRow[] {
  if (!Array.isArray(raw) || (!allowEmpty && raw.length === 0)) return false;
  const seen = new Set<string>();
  return raw.every(row => {
    if (!record(row) || typeof row.w !== "string" || !pattern.test(row.w) || seen.has(row.w)
        || !optionalProtection(row.suppressed)) return false;
    seen.add(row.w);
    const suppressed = row.suppressed === true;
    const reasons = row.retentionUnavailableReasons;
    if (!validReasons(reasons, suppressed, coverage)) return false;
    if (suppressed ? row.size !== null : typeof row.size !== "number" || !Number.isSafeInteger(row.size) || row.size < 5) return false;
    return MATRIX_DAYS.every(day => {
      const key = `d${day}`;
      return row[key] === null ? reasons[key] !== undefined
        : !suppressed && coverage !== null && rate(row[key]) && reasons[key] === undefined;
    });
  });
}

function validCurve(raw: unknown, reasons: Record<string, string>, suppressed: boolean, coverage: string | null): raw is Point[] {
  if (!Array.isArray(raw)) return false;
  if (suppressed) return raw.length === 0;
  if (raw.length === 0) return false;
  const days = new Set<number>();
  let previousDay = 0;
  for (const [index, point] of raw.entries()) {
    if (!Array.isArray(point) || point.length !== 2) return false;
    const [day, value] = point;
    if (index === 0) {
      if (day !== 0 || value !== 100) return false;
      continue;
    }
    if (coverage === null || !CURVE_DAYS.includes(day) || day <= previousDay || reasons[`d${day}`] !== undefined || !rate(value)) return false;
    days.add(day);
    previousDay = day;
  }
  return CURVE_DAYS.every(day => days.has(day) || reasons[`d${day}`] !== undefined);
}

export function validL2RetentionMatrix(value: unknown): value is L2RetentionMatrix {
  return record(value) && value.available === true && validL2CollectionDate(value.retentionCollectionFrom)
    && validCohorts(value.cohorts, WEEK, value.retentionCollectionFrom);
}

export function validL2RetentionCurve(value: unknown): value is L2RetentionCurve {
  if (!record(value) || value.available !== true || !validL2CollectionDate(value.retentionCollectionFrom)
      || !optionalProtection(value.suppressed)) return false;
  const suppressed = value.suppressed === true;
  return validReasons(value.retentionUnavailableReasons, suppressed, value.retentionCollectionFrom)
    && validCurve(value.curve, value.retentionUnavailableReasons, suppressed, value.retentionCollectionFrom);
}

export function validL2RetentionDashboard(value: WireObject): value is WireObject & Coverage {
  if (!validL2RetentionMatrix(value) || !validDay7(value.day7Kpi, value.retentionCollectionFrom)
      || !validCohorts(value.monthlyCohorts, MONTH, value.retentionCollectionFrom, true)) return false;
  return validCurves(value.cohorts, value.curves, value.retentionCollectionFrom)
    && validCurves(value.monthlyCohorts, value.monthlyCurves, value.retentionCollectionFrom);
}

function validCurves(cohorts: CohortRow[], raw: unknown, coverage: string | null) {
  return record(raw) && cohorts.every(row => row.retentionUnavailableReasons
    && validCurve(raw[row.w], row.retentionUnavailableReasons, row.suppressed === true, coverage));
}

function validCrossMetric(metric: unknown, retention: boolean, coverage: string | null) {
  if (!record(metric) || !optionalProtection(metric.suppressed) || !Array.isArray(metric.columns) || !Array.isArray(metric.rows)) return false;
  const columns = metric.columns;
  const rows = metric.rows;
  if (!columns.length || new Set(columns).size !== columns.length || columns.some(column => typeof column !== "string" || !column.trim())
      || !rows.length || rows.some(row => !Array.isArray(row) || row.length !== columns.length + 2
        || typeof row[0] !== "string" || !row[0].trim()
        || row.slice(1).some(cell => cell !== null && (!rate(cell) || retention && coverage === null)))) return false;

  const emptyCell = (row: unknown, column: unknown): boolean =>
    typeof row === "number" && Number.isSafeInteger(row) && row >= 0 && row < rows.length
    && typeof column === "number" && Number.isSafeInteger(column) && column >= 0 && column <= columns.length
    && rows[row][column + 1] === null;
  const suppressed = new Set<string>();
  const suppressedCells = metric.suppressedCells === undefined ? [] : metric.suppressedCells;
  if (!Array.isArray(suppressedCells) || (metric.suppressed === true) !== (suppressedCells.length > 0)) return false;
  for (const cell of suppressedCells) {
    if (!Array.isArray(cell) || cell.length !== 2 || !emptyCell(cell[0], cell[1])) return false;
    const key = `${cell[0]}:${cell[1]}`;
    if (suppressed.has(key)) return false;
    suppressed.add(key);
  }
  if (!retention) return true;

  const unavailable = new Map<string, string>();
  if (!Array.isArray(metric.unavailableCells)) return false;
  for (const cell of metric.unavailableCells) {
    if (!record(cell) || !emptyCell(cell.row, cell.column)) return false;
    const key = `${cell.row}:${cell.column}`;
    if (unavailable.has(key) || !(cell.reason === MISSING || cell.column !== columns.length
        && (cell.reason === IMMATURE || cell.reason === NO_COHORT && !suppressed.has(key)))) return false;
    unavailable.set(key, cell.reason);
  }
  return rows.every((row, rowIndex) => {
    const meanKey = `${rowIndex}:${columns.length}`;
    const languageKeys = columns.map((_, column) => `${rowIndex}:${column}`);
    return (unavailable.get(meanKey) === MISSING) === languageKeys.some(key => unavailable.get(key) === MISSING)
      && suppressed.has(meanKey) === languageKeys.some(key => suppressed.has(key))
      && languageKeys.every((key, column) => row[column + 1] !== null || unavailable.has(key) || suppressed.has(key))
      && (row[columns.length + 1] !== null) === (!suppressed.has(meanKey) && !unavailable.has(meanKey)
        && row.slice(1, -1).some((cell: unknown) => cell !== null));
  });
}

export function validL2CrossAnalysis(value: unknown, coverage: string | null) {
  return record(value) && validCrossMetric(value.cvr, false, coverage)
    && validCrossMetric(value.ret, true, coverage) && validCrossMetric(value.trial, false, coverage);
}
