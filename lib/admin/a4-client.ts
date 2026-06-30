import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError } from "@/lib/admin/error-messages";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

export type A4Stats = {
  todayEvents: string;
  todayAuditEvents: number;
  registeredDomains: number;
  pendingDomains: number;
  batchDone: number;
  batchTotal: number;
  schemaVersion: string;
};

export type A4EventDetailRow = {
  item: string;
  desc: string;
};

export type A4EventFamily = {
  key: string;
  title: string;
  sub: string;
  sample: string;
  serverAuth: string;
  todayCount: string;
  events: A4EventDetailRow[];
};

export type A4CommonField = {
  key: string;
  name: string;
  sub: string;
  value: string;
};

export type A4DimensionParam = {
  key: string;
  name: string;
  sub: string;
  value: string;
  locked: boolean;
};

export type A4KpiFormula = {
  n: number;
  kpi: string;
  formula: string;
};

export type A4DomainItem = {
  name: string;
  n: boolean;
};

export type A4DomainExtensionBatch = {
  id: string;
  title: string;
  state: "done" | "inprogress" | "pending" | "scheduled" | "registered";
  proposer: string;
  impact: string;
  newDomains: A4DomainItem[];
  details: A4EventDetailRow[];
};

export type A4Overview = {
  stats: A4Stats;
  eventFamilies: A4EventFamily[];
  registeredDomains: string[];
  pendingDomains: string[];
  sunsetDomains: string[];
  commonFields: A4CommonField[];
  dimensionParams: A4DimensionParam[];
  kpiFormulas: A4KpiFormula[];
  domainExtensions: A4DomainExtensionBatch[];
  guardrails: string[];
};

let requestSeq = 0;

function idempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

function text(value: unknown, fallback = "—") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function num(value: unknown, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rows<T>(value: unknown, normalize: (row: Record<string, unknown>) => T): T[] {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object").map((item) => normalize(item as Record<string, unknown>))
    : [];
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeDetail(row: Record<string, unknown>): A4EventDetailRow {
  return {
    item: text(row.item),
    desc: text(row.desc),
  };
}

function normalizeFamily(row: Record<string, unknown>): A4EventFamily {
  return {
    key: text(row.key),
    title: text(row.title),
    sub: text(row.sub),
    sample: text(row.sample),
    serverAuth: text(row.serverAuth),
    todayCount: text(row.todayCount, "0"),
    events: rows(row.events, normalizeDetail),
  };
}

function normalizeBatchState(value: unknown): A4DomainExtensionBatch["state"] {
  const normalized = text(value, "pending").toLowerCase();
  return normalized === "done" || normalized === "inprogress" || normalized === "scheduled" || normalized === "registered"
    ? normalized
    : "pending";
}

function normalizeBatch(row: Record<string, unknown>): A4DomainExtensionBatch {
  return {
    id: text(row.id),
    title: text(row.title),
    state: normalizeBatchState(row.state),
    proposer: text(row.proposer),
    impact: text(row.impact),
    newDomains: rows(row.newDomains, (item) => ({ name: text(item.name), n: !!item.n })),
    details: rows(row.details, normalizeDetail),
  };
}

function normalizeOverview(raw: unknown): A4Overview {
  const data = rec(raw);
  const stats = rec(data.stats);
  return {
    stats: {
      todayEvents: text(stats.todayEvents, "0"),
      todayAuditEvents: num(stats.todayAuditEvents),
      registeredDomains: num(stats.registeredDomains),
      pendingDomains: num(stats.pendingDomains),
      batchDone: num(stats.batchDone),
      batchTotal: num(stats.batchTotal),
      schemaVersion: text(stats.schemaVersion, "v3"),
    },
    eventFamilies: rows(data.eventFamilies, normalizeFamily),
    registeredDomains: Array.isArray(data.registeredDomains) ? data.registeredDomains.map((item) => text(item)).filter(Boolean) : [],
    pendingDomains: Array.isArray(data.pendingDomains) ? data.pendingDomains.map((item) => text(item)).filter(Boolean) : [],
    sunsetDomains: Array.isArray(data.sunsetDomains) ? data.sunsetDomains.map((item) => text(item)).filter(Boolean) : [],
    commonFields: rows(data.commonFields, (row) => ({ key: text(row.key), name: text(row.name), sub: text(row.sub), value: text(row.value) })),
    dimensionParams: rows(data.dimensionParams, (row) => ({ key: text(row.key), name: text(row.name), sub: text(row.sub), value: text(row.value), locked: !!row.locked })),
    kpiFormulas: rows(data.kpiFormulas, (row) => ({ n: num(row.n), kpi: text(row.kpi), formula: text(row.formula) })),
    domainExtensions: rows(data.domainExtensions, normalizeBatch),
    guardrails: Array.isArray(data.guardrails) ? data.guardrails.map((item) => text(item)).filter(Boolean) : [],
  };
}

async function a4Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init?.idempotencyPrefix) headers.set("Idempotency-Key", idempotencyKey(init.idempotencyPrefix));

  const response = await fetch(`/api/admin/platform${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    throw new Error(formatAdminApiError(result?.message, `A4_REQUEST_FAILED_${response.status}`));
  }

  return result.data as T;
}

export async function fetchA4Overview() {
  return normalizeOverview(await a4Request<unknown>("/events/overview"));
}

export async function updateA4DimensionParam(paramKey: string, value: string, reason: string, operator: string) {
  await a4Request(`/events/params/${encodeURIComponent(paramKey)}`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: "a4-param",
  });
  return fetchA4Overview();
}

export async function registerA4Schema(value: string, reason: string, operator: string) {
  return a4Request<unknown>("/events/schema-registrations", {
    method: "POST",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: "a4-schema",
  }).then(normalizeOverview);
}

export async function registerA4DomainExtension(value: string, reason: string, operator: string) {
  return a4Request<unknown>("/events/domain-extension-batches", {
    method: "POST",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: "a4-domain-extension",
  });
}
