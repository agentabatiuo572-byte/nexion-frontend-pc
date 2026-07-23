export type A5RegistryRow = {
  canonicalKey: string;
  displayName: string;
  description: string;
  domain: string;
  domainLabel: string;
  ownerCode: string;
  ownerLabel: string;
  ownerRoute: string;
  currentValue: string;
  valueType: string;
  unit: string;
  source: string;
  sourceStatus: "READY" | "PARTIAL";
  updatedAt: string;
  operationConfirm: boolean;
  serverCanonical: true;
};

export type A5RegistrySource = {
  key: string;
  label: string;
  status: "READY" | "PARTIAL" | "EMPTY";
  rowCount: number;
  detail: string;
};

export type A5RegistryOverview = {
  rows: A5RegistryRow[];
  stats: {
    registeredCount: number;
    domainCount: number;
    highSensitivityCount: number;
    sourceCount: number;
  };
  sources: A5RegistrySource[];
  observedAt: string;
};

function invalid(field: string): never {
  throw new Error(`A5_DATA_INTEGRITY_ERROR:${field}`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) invalid(field);
  return value.trim();
}

function count(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) invalid(field);
  return value;
}

function flag(value: unknown, field: string) {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function status<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  const normalized = text(value, field).toUpperCase();
  if (!allowed.includes(normalized as T)) invalid(field);
  return normalized as T;
}

export function normalizeA5Overview(raw: unknown): A5RegistryOverview {
  const root = record(raw, "root");
  if (!Array.isArray(root.rows)) invalid("rows");
  const rows = root.rows.map((value, index): A5RegistryRow => {
    const row = record(value, `rows[${index}]`);
    const ownerRoute = text(row.ownerRoute, `rows[${index}].ownerRoute`);
    if (!ownerRoute.startsWith("/") || ownerRoute.startsWith("//")) invalid(`rows[${index}].ownerRoute`);
    if (flag(row.serverCanonical, `rows[${index}].serverCanonical`) !== true) invalid(`rows[${index}].serverCanonical`);
    return {
      canonicalKey: text(row.canonicalKey, `rows[${index}].canonicalKey`),
      displayName: text(row.displayName, `rows[${index}].displayName`),
      description: text(row.description, `rows[${index}].description`),
      domain: text(row.domain, `rows[${index}].domain`),
      domainLabel: text(row.domainLabel, `rows[${index}].domainLabel`),
      ownerCode: text(row.ownerCode, `rows[${index}].ownerCode`),
      ownerLabel: text(row.ownerLabel, `rows[${index}].ownerLabel`),
      ownerRoute,
      currentValue: text(row.currentValue, `rows[${index}].currentValue`, true),
      valueType: text(row.valueType, `rows[${index}].valueType`),
      unit: text(row.unit, `rows[${index}].unit`, true),
      source: text(row.source, `rows[${index}].source`),
      sourceStatus: status(row.sourceStatus, `rows[${index}].sourceStatus`, ["READY", "PARTIAL"] as const),
      updatedAt: text(row.updatedAt, `rows[${index}].updatedAt`),
      operationConfirm: flag(row.operationConfirm, `rows[${index}].operationConfirm`),
      serverCanonical: true,
    };
  });

  const uniqueKeys = new Set(rows.map((row) => row.canonicalKey));
  if (uniqueKeys.size !== rows.length) invalid("rows.duplicateKey");

  const statsRaw = record(root.stats, "stats");
  const stats = {
    registeredCount: count(statsRaw.registeredCount, "stats.registeredCount"),
    domainCount: count(statsRaw.domainCount, "stats.domainCount"),
    highSensitivityCount: count(statsRaw.highSensitivityCount, "stats.highSensitivityCount"),
    sourceCount: count(statsRaw.sourceCount, "stats.sourceCount"),
  };
  if (stats.registeredCount !== rows.length) invalid("stats.registeredCount");
  if (stats.domainCount !== new Set(rows.map((row) => row.domain)).size) invalid("stats.domainCount");
  if (stats.highSensitivityCount !== rows.filter((row) => row.operationConfirm).length) invalid("stats.highSensitivityCount");

  if (!Array.isArray(root.sources)) invalid("sources");
  const sources = root.sources.map((value, index): A5RegistrySource => {
    const source = record(value, `sources[${index}]`);
    return {
      key: text(source.key, `sources[${index}].key`),
      label: text(source.label, `sources[${index}].label`),
      status: status(source.status, `sources[${index}].status`, ["READY", "PARTIAL", "EMPTY"] as const),
      rowCount: count(source.rowCount, `sources[${index}].rowCount`),
      detail: text(source.detail, `sources[${index}].detail`),
    };
  });
  if (stats.sourceCount !== sources.length) invalid("stats.sourceCount");
  if (new Set(sources.map((source) => source.key)).size !== sources.length) invalid("sources.duplicateKey");
  if (sources.reduce((total, source) => total + source.rowCount, 0) !== rows.length) invalid("sources.rowCount");

  return { rows, stats, sources, observedAt: text(root.observedAt, "observedAt") };
}
