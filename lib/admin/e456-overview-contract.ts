type UnknownRecord = Record<string, unknown>;

function object(value: unknown, message: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as UnknownRecord;
}

function has(row: UnknownRecord, key: string, message: string) {
  if (!Object.prototype.hasOwnProperty.call(row, key)) throw new Error(message);
}

function text(value: unknown, message: string, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw new Error(message);
  return value;
}

function finiteNumber(value: unknown, message: string, minimum = 0) {
  if ((typeof value !== "number" && typeof value !== "string")
      || (typeof value === "string" && !value.trim())) {
    throw new Error(message);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) throw new Error(message);
  return parsed;
}

function nonNegativeInteger(value: unknown, message: string, minimum = 0) {
  const parsed = finiteNumber(value, message, minimum);
  if (!Number.isInteger(parsed)) throw new Error(message);
  return parsed;
}

function validateE4Order(value: unknown, message: string) {
  const row = object(value, message);
  text(row.orderNo, message);
  text(row.userNo, message);
  if (row.amount != null) finiteNumber(row.amount, message);
  if (row.state != null) text(row.state, message);
}

export function parseE4OrderPage<T = UnknownRecord>(raw: unknown): T {
  const message = "E4_ORDER_PAGE_CONTRACT_INVALID";
  const page = object(raw, message);
  for (const key of ["total", "pageNum", "pageSize", "records"]) has(page, key, message);
  const total = nonNegativeInteger(page.total, message);
  const pageNum = nonNegativeInteger(page.pageNum, message, 1);
  const pageSize = nonNegativeInteger(page.pageSize, message, 1);
  if (!Array.isArray(page.records)
      || page.records.length > pageSize
      || page.records.length > total
      || (total === 0 && page.records.length !== 0)
      || pageNum < 1) {
    throw new Error(message);
  }
  page.records.forEach((row) => validateE4Order(row, message));
  return raw as T;
}

function validateE5Device(value: unknown, message: string) {
  const row = object(value, message);
  if (row.id == null || (typeof row.id !== "number" && typeof row.id !== "string")) throw new Error(message);
  if (typeof row.id === "string" && !row.id.trim()) throw new Error(message);
  if (row.userId != null && typeof row.userId !== "number" && typeof row.userId !== "string") throw new Error(message);
  if (row.status != null) text(row.status, message);
}

export function parseE5DevicePage<T = UnknownRecord>(raw: unknown): T {
  const message = "E5_DEVICE_PAGE_CONTRACT_INVALID";
  const page = object(raw, message);
  for (const key of ["total", "pageNum", "pageSize", "records"]) has(page, key, message);
  const total = nonNegativeInteger(page.total, message);
  const pageSize = nonNegativeInteger(page.pageSize, message, 1);
  nonNegativeInteger(page.pageNum, message, 1);
  if (!Array.isArray(page.records)
      || page.records.length > pageSize
      || page.records.length > total
      || (total === 0 && page.records.length !== 0)) {
    throw new Error(message);
  }
  page.records.forEach((row) => validateE5Device(row, message));
  return raw as T;
}

function validateE5Datacenter(value: unknown, message: string) {
  const row = object(value, message);
  text(row.dcLocation, message);
  for (const key of ["regionLabel", "location", "displayName", "status"]) {
    if (row[key] != null) text(row[key], message, key !== "status");
  }
  for (const key of [
    "sortOrder",
    "totalDevices",
    "onlineDevices",
    "pendingRecycleDevices",
    "abnormalDevices",
    "avgGpuUsage",
    "avgGpuTempC",
    "avgGpuPowerW",
  ]) {
    if (row[key] != null) finiteNumber(row[key], message);
  }
  if (row.dispatchPaused != null
      && typeof row.dispatchPaused !== "boolean"
      && typeof row.dispatchPaused !== "number"
      && typeof row.dispatchPaused !== "string") {
    throw new Error(message);
  }
  if (row.onlineSeries != null && !Array.isArray(row.onlineSeries)) throw new Error(message);
}

export function parseE5DatacenterRows<T = UnknownRecord[]>(raw: unknown): T {
  const message = "E5_DATACENTERS_CONTRACT_INVALID";
  if (!Array.isArray(raw)) throw new Error(message);
  raw.forEach((row) => validateE5Datacenter(row, message));
  return raw as T;
}

export function parseE5Overview<T = UnknownRecord>(raw: unknown): T {
  const message = "E5_OVERVIEW_CONTRACT_INVALID";
  const overview = object(raw, message);
  for (const key of [
    "totalDevices",
    "onlineDevices",
    "offlineDevices",
    "recycledDevices",
    "pendingRecycleDevices",
    "abnormalDevices",
    "maxDevicesPerUser",
    "datacenters",
  ]) {
    has(overview, key, message);
  }
  for (const key of [
    "totalDevices",
    "onlineDevices",
    "offlineDevices",
    "recycledDevices",
    "pendingRecycleDevices",
    "abnormalDevices",
  ]) {
    nonNegativeInteger(overview[key], message);
  }
  if (overview.maxDevicesPerUser != null) nonNegativeInteger(overview.maxDevicesPerUser, message, 1);
  if (!Array.isArray(overview.datacenters)) throw new Error(message);
  overview.datacenters.forEach((row) => validateE5Datacenter(row, message));
  return raw as T;
}

function validateE6Flag(value: unknown, message: string) {
  const row = object(value, message);
  for (const key of ["key", "label", "desc", "frontendEffect"]) text(row[key], message, key !== "key" && key !== "label");
  if (typeof row.enabled !== "boolean") throw new Error(message);
}

function validateE6ValueRow(value: unknown, message: string, includeDescription: boolean) {
  const row = object(value, message);
  for (const key of ["key", "label", "value", "unit"]) text(row[key], message, key === "value" || key === "unit");
  if (includeDescription) {
    text(row.desc, message, true);
    text(row.frontendEffect, message, true);
  }
}

function validateE6GpuTier(value: unknown, message: string) {
  const row = object(value, message);
  for (const key of ["id", "label", "desc", "defaultModel", "tops"]) text(row[key], message, key === "desc" || key === "defaultModel");
  if (!Array.isArray(row.keywords)) throw new Error(message);
  row.keywords.forEach((keyword) => {
    const entry = object(keyword, message);
    text(entry.slot, message);
    text(entry.value, message, true);
  });
}

export function parseE6ComputeConfig<T = UnknownRecord>(raw: unknown): T {
  const message = "E6_COMPUTE_CONFIG_CONTRACT_INVALID";
  const config = object(raw, message);
  for (const key of ["domain", "flags", "coefficients", "yieldEstimate", "gpuTiers", "download", "sources"]) {
    has(config, key, message);
  }
  if (text(config.domain, message) !== "E6"
      || !Array.isArray(config.flags)
      || !Array.isArray(config.coefficients)
      || !Array.isArray(config.yieldEstimate)
      || !Array.isArray(config.gpuTiers)
      || !Array.isArray(config.sources)
      || config.flags.length === 0
      || config.coefficients.length === 0
      || config.yieldEstimate.length === 0
      || config.gpuTiers.length !== 6
      || config.sources.length === 0) {
    throw new Error(message);
  }
  config.flags.forEach((row) => validateE6Flag(row, message));
  config.coefficients.forEach((row) => validateE6ValueRow(row, message, true));
  config.yieldEstimate.forEach((row) => validateE6ValueRow(row, message, false));
  config.gpuTiers.forEach((row) => validateE6GpuTier(row, message));
  const tierIds = config.gpuTiers.map((row) => object(row, message).id);
  if (new Set(tierIds).size !== 6 || !["G1", "G2", "G3", "G4", "G5", "G6"].every((id) => tierIds.includes(id))) {
    throw new Error(message);
  }
  const download = object(config.download, message);
  for (const key of ["url", "zhTitle", "zhGuide", "enTitle", "enGuide"]) text(download[key], message, true);
  config.sources.forEach((source) => text(source, message));
  return raw as T;
}
