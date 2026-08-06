type JsonRecord = Record<string, unknown>;

const KPI_IDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("L1_DATA_PROTOCOL_INVALID");
  }
  return value as JsonRecord;
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function validateKpi(value: unknown, expectedId: number) {
  const row = record(value);
  if (row.n !== expectedId || String(row.kpiId) !== String(expectedId)) {
    throw new Error("L1_KPI_ID_SEQUENCE_INVALID");
  }
  if (typeof row.name !== "string" || !row.name.trim()
      || !finite(row.target)
      || !["gte", "lte", "band"].includes(String(row.dir))
      || !["%", "d"].includes(String(row.unit))
      || typeof row.available !== "boolean"
      || typeof row.numerator !== "number" || !Number.isInteger(row.numerator) || row.numerator < 0
      || typeof row.denominator !== "number" || !Number.isInteger(row.denominator) || row.denominator < 0
      || !Array.isArray(row.spark)
      || (row.spark.length !== 0 && row.spark.length !== 6)
      || !row.spark.every(finite)) {
    throw new Error("L1_KPI_ROW_INVALID");
  }
  if (row.available) {
    if (!finite(row.value)
        || (row.unit === "%" && (Number(row.value) < 0 || Number(row.value) > 100))
        || (row.unit === "d" && Number(row.value) <= 0)) {
      throw new Error("L1_KPI_VALUE_INVALID");
    }
  } else if (row.value !== null) {
    throw new Error("L1_KPI_UNAVAILABLE_VALUE_INVALID");
  }
  return row;
}

export function validateL1Dashboard(value: unknown): JsonRecord {
  const data = record(value);
  if (data.module !== "L1" || !Array.isArray(data.kpis) || data.kpis.length !== KPI_IDS.length) {
    throw new Error("L1_DASHBOARD_SHAPE_INVALID");
  }
  data.kpis.forEach((row, index) => validateKpi(row, KPI_IDS[index]));
  const weeks = data.weeks;
  if (!Array.isArray(weeks) || weeks.length !== 6
      || !weeks.every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error("L1_TREND_LABELS_INVALID");
  }
  for (const key of ["kpiPlain", "kpiExt"]) {
    const keyed = record(data[key]);
    if (!KPI_IDS.every((id) => Object.prototype.hasOwnProperty.call(keyed, String(id)))) {
      throw new Error("L1_KPI_DEFINITION_SET_INVALID");
    }
  }
  return data;
}

export function validateL1Drilldown(value: unknown, expectedId: number): JsonRecord {
  const data = record(value);
  if (data.module !== "L1" || data.kpiId !== expectedId) {
    throw new Error("L1_DRILLDOWN_ID_INVALID");
  }
  validateKpi(data.selected, expectedId);
  return data;
}

export function validateL1Trend(value: unknown, expectedId: number): JsonRecord {
  const data = record(value);
  if (data.module !== "L1" || data.kpiId !== expectedId
      || !Array.isArray(data.labels) || data.labels.length !== 6
      || !data.labels.every((item) => typeof item === "string" && item.length > 0)
      || !Array.isArray(data.values) || !data.values.every(finite)
      || (data.values.length !== 0 && data.values.length !== data.labels.length)) {
    throw new Error("L1_TREND_PROTOCOL_INVALID");
  }
  return data;
}
