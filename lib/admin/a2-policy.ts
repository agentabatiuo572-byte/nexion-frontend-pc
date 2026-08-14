export const A2_AUDIT_DOMAINS = [..."ABCDEFGHIJKLM"] as const;

export type A2AuditDomain = typeof A2_AUDIT_DOMAINS[number];

export type A2AuditFilter = {
  domain?: A2AuditDomain | "all";
  operator?: string;
  action?: string;
  object?: string;
  startTime?: string;
  endTime?: string;
};

type FilterableAuditRow = {
  domain: A2AuditDomain;
  actor: string;
  action: string;
  obj: string;
  createdAt: string;
};

const FILTER_KEYS = ["domain", "operator", "action", "object", "startTime", "endTime"] as const;

export function normalizeA2AuditFilter(filter: A2AuditFilter): A2AuditFilter {
  const normalized: A2AuditFilter = {};
  for (const key of FILTER_KEYS) {
    const raw = filter[key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value || (key === "domain" && value === "all")) continue;
    Object.assign(normalized, { [key]: key === "endTime" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
      ? `${value}:59.999`
      : value });
  }
  return normalized;
}

export function buildA2FilterQuery(filter: A2AuditFilter): URLSearchParams {
  const normalized = normalizeA2AuditFilter(filter);
  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = normalized[key];
    if (value) query.set(key, value);
  }
  return query;
}

export function parseA2FilterQuery(search: string | URLSearchParams): A2AuditFilter {
  const query = typeof search === "string" ? new URLSearchParams(search) : search;
  const filter: A2AuditFilter = {};
  const domain = query.get("domain")?.trim().toUpperCase();
  if (domain && A2_AUDIT_DOMAINS.includes(domain as A2AuditDomain)) {
    filter.domain = domain as A2AuditDomain;
  }
  for (const key of FILTER_KEYS) {
    if (key === "domain") continue;
    const value = query.get(key)?.trim();
    if (value) Object.assign(filter, { [key]: value });
  }
  return normalizeA2AuditFilter(filter);
}

export function validateA2AuditFilterRange(filter: A2AuditFilter): string | null {
  const normalized = normalizeA2AuditFilter(filter);
  if (!normalized.startTime || !normalized.endTime) return null;
  const start = Date.parse(normalized.startTime);
  const end = Date.parse(normalized.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "请输入有效的开始和结束时间";
  return start <= end ? null : "开始时间不能晚于结束时间";
}

export function matchesA2AuditFilter(row: FilterableAuditRow, filter: A2AuditFilter): boolean {
  const normalized = normalizeA2AuditFilter(filter);
  if (normalized.domain && row.domain !== normalized.domain) return false;
  if (normalized.operator && !row.actor.toLocaleLowerCase().includes(normalized.operator.toLocaleLowerCase())) return false;
  if (normalized.action && !row.action.toLocaleLowerCase().includes(normalized.action.toLocaleLowerCase())) return false;
  if (normalized.object && !row.obj.toLocaleLowerCase().includes(normalized.object.toLocaleLowerCase())) return false;

  const rowTime = Date.parse(row.createdAt);
  if (normalized.startTime) {
    const start = Date.parse(normalized.startTime);
    if (!Number.isFinite(rowTime) || !Number.isFinite(start) || rowTime < start) return false;
  }
  if (normalized.endTime) {
    const end = Date.parse(normalized.endTime);
    if (!Number.isFinite(rowTime) || !Number.isFinite(end) || rowTime > end) return false;
  }
  return true;
}

export function resolveA2AuditObject(
  detailObject: unknown,
  detailResource: unknown,
  resourceType: unknown,
  resourceId: unknown,
): string {
  for (const explicit of [detailObject, detailResource]) {
    if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  }
  const backendParts = [resourceType, resourceId]
    .filter((value): value is string => typeof value === "string" && !!value.trim())
    .map((value) => value.trim())
    .filter((value, index, values) => values.indexOf(value) === index);
  return backendParts.length > 0 ? backendParts.join(" · ") : "—";
}

export function canAccessA2Export(authorities: readonly string[]): boolean {
  return authorities.includes("platform_a2_export");
}

export function canAccessA2Write(authorities: readonly string[]): boolean {
  return authorities.includes("platform_a2_write");
}

export function parseA2ReasonMin(value: string | null | undefined): number {
  const parsed = Number.parseInt(value?.match(/\d+/)?.[0] ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 8 && parsed <= 200 ? parsed : 8;
}

export function parseA2SchemaVersion(value: string | null | undefined): string {
  const normalized = value?.trim() ?? "";
  return normalized.replace(/^统一\s*schema\s*·?\s*/i, "").trim();
}

const A2_SUPPORTED_SCHEMA_VERSION_ORDERS: Readonly<Record<string, number>> = {
  v3: 3,
  v4: 4,
};

export function matchesA2OperationRole(operatorRole: string | null | undefined, role: string): boolean {
  const normalized = operatorRole?.trim().toLocaleLowerCase() ?? "";
  const aliases: Record<string, readonly string[]> = {
    财务: ["财务", "finance"],
    风控: ["风控", "risk"],
    增长: ["增长", "growth"],
    内容: ["内容", "content"],
    客服: ["客服", "support"],
    超管: ["超管", "总管理员", "superadmin", "super_admin", "super admin"],
  };
  return (aliases[role] ?? [role]).some((alias) => normalized.includes(alias.toLocaleLowerCase()));
}

export function resolveA2AuditDomain(
  sourceDomain: unknown,
  domain: unknown,
  action: string,
  resourceType: string,
): A2AuditDomain {
  for (const value of [sourceDomain, domain]) {
    if (typeof value !== "string") continue;
    const upper = value.trim().toUpperCase();
    const match = upper.match(/^([A-M])(?:\d|_|$)/)?.[1];
    if (match) return match as A2AuditDomain;
  }
  const source = `${action} ${resourceType}`.toUpperCase();
  const prefixedDomain = source.match(/(?:^|[^A-Z])([A-M])(?:\d|_)/)?.[1];
  if (prefixedDomain) return prefixedDomain as A2AuditDomain;
  if (source.includes("WITHDRAW") || source.includes("提现") || source.includes("账单")) return "D";
  if (source.includes("USER") || source.includes("账户") || source.includes("余额")) return "C";
  if (source.includes("PHASE")) return "H";
  if (source.includes("CONTENT") || source.includes("披露")) return "I";
  return "A";
}

export type A2MechanismValidation = { ok: true; value: string } | { ok: false; message: string };

function integerInRange(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export function validateA2MechanismValue(
  key: "ttl" | "retention" | "schema",
  raw: string,
  currentSchemaVersion?: string | null,
): A2MechanismValidation {
  const value = raw.trim();
  if (key === "ttl") {
    const parsed = integerInRange(value, 8, 200);
    return parsed === null
      ? { ok: false, message: "理由最短长度必须是 8–200 的整数" }
      : { ok: true, value: String(parsed) };
  }
  if (key === "retention") {
    const parsed = integerInRange(value, 13, 36);
    return parsed === null
      ? { ok: false, message: "日志保留期必须是 13–36 的整数月" }
      : { ok: true, value: String(parsed) };
  }
  const requestedOrder = /^v([1-9]\d*)$/.exec(value)?.[1];
  const current = parseA2SchemaVersion(currentSchemaVersion);
  const currentOrder = A2_SUPPORTED_SCHEMA_VERSION_ORDERS[current];
  if (requestedOrder && currentOrder && Number(requestedOrder) <= currentOrder) {
    return { ok: false, message: "字段结构版本只能升级，不能降级或重复提交" };
  }
  if (!(value in A2_SUPPORTED_SCHEMA_VERSION_ORDERS)) {
    return { ok: false, message: "字段结构版本仅支持已注册的 v3、v4" };
  }
  if (current && (!(current in A2_SUPPORTED_SCHEMA_VERSION_ORDERS)
      || A2_SUPPORTED_SCHEMA_VERSION_ORDERS[value] <= currentOrder)) {
    return { ok: false, message: "字段结构版本只能升级，不能降级或重复提交" };
  }
  return { ok: true, value };
}
