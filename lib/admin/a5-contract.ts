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
  /**
   * 该值是否为实时权威事实(zentao #198)。
   *
   * A3 的系统健康指标由实时 provider 现算;A5 此前把 nx_config_item 里种下的
   * admin.health.* 死行当普通参数展示,同一个事件管道在 A3 显示「严重积压」、
   * 在 A5 显示「正常 · 延迟 1.2s」。`live` 为 false 表示这行不是实时事实,
   * `stale` 为 true 表示当前读不到实时值 —— 两种都不许标成「当前服务端值」。
   */
  live: boolean;
  /** 实时采样的观测时刻;非实时行为空串。 */
  observedAt: string;
  stale: boolean;
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

/** 可选文本:字段缺失时给空串,存在时仍按 text 的规则校验(不接受非字符串)。 */
function optionalText(value: unknown, field: string): string {
  return value === undefined || value === null ? "" : text(value, field, true);
}

function count(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) invalid(field);
  return value;
}

function flag(value: unknown, field: string) {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

/**
 * 可选布尔(zentao #198 的部署兼容面)。
 *
 * `live` / `stale` 由后端在「健康类键改为实时 provider 供值」那次提交里新增。老构建
 * 不返回它们,而把它们当必填会让**整页**判为数据一致性失败 —— 运营看到的是
 * 「数据一致性校验未通过,已停止展示可疑数据」,连一条参数都读不到;这与 #187 的
 * E1 是同一个缺陷类(一个未声明字段把整页读取打掉)。
 *
 * 缺失 = 「这个后端不做实时健康采样」,按非实时/非过期降级:行仍如实展示存量值,
 * 只是不打「实时权威」徽章。字段存在时仍严格按布尔校验,不接受半吊子取值。
 */
function optionalFlag(value: unknown, field: string): boolean {
  if (value === undefined || value === null) return false;
  return flag(value, field);
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
      // 老后端不返回这三个字段(见 optionalFlag 注释):缺失按「非实时、未过期」降级,
      // 而不是把整页判成一致性失败。
      live: optionalFlag(row.live, `rows[${index}].live`),
      observedAt: optionalText(row.observedAt, `rows[${index}].observedAt`),
      stale: optionalFlag(row.stale, `rows[${index}].stale`),
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
