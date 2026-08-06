import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";

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

export type A4SchemaRegistration = {
  eventName: string;
  ownerDomain: string;
  familyKey: string;
  producer: string;
  consumers: string;
  properties: string;
  serverAuthoritative: boolean;
  samplingPolicy: string;
  version: string;
  updatedAt: string;
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
  schemaRegistrations: A4SchemaRegistration[];
  domainExtensions: A4DomainExtensionBatch[];
  guardrails: string[];
};

let requestSeq = 0;

export function createA4IdempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function invalid(field: string): never {
  throw new Error(`A4_OVERVIEW_INVALID:${field}`);
}

function requiredText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) invalid(field);
  return value.trim();
}

function requiredNumber(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(field);
  return value;
}

function requiredBoolean(value: unknown, field: string) {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function requiredRows<T>(value: unknown, field: string, normalize: (row: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(value)) invalid(field);
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) invalid(`${field}[${index}]`);
    return normalize(item as Record<string, unknown>);
  });
}

function requiredStrings(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) invalid(field);
  return value.map((item, index) => requiredText(item, `${field}[${index}]`));
}

function requiredNonEmptyRows<T>(value: unknown, field: string, normalize: (row: Record<string, unknown>) => T): T[] {
  const rows = requiredRows(value, field, normalize);
  if (!rows.length) invalid(`${field}.empty`);
  return rows;
}

function requiredNonEmptyStrings(value: unknown, field: string): string[] {
  const rows = requiredStrings(value, field);
  if (!rows.length) invalid(`${field}.empty`);
  return rows;
}

function normalizeDetail(row: Record<string, unknown>): A4EventDetailRow {
  return {
    item: requiredText(row.item, "eventDetail.item"),
    desc: requiredText(row.desc, "eventDetail.desc"),
  };
}

function normalizeFamily(row: Record<string, unknown>): A4EventFamily {
  return {
    key: requiredText(row.key, "eventFamily.key"),
    title: requiredText(row.title, "eventFamily.title"),
    sub: requiredText(row.sub, "eventFamily.sub"),
    sample: requiredText(row.sample, "eventFamily.sample"),
    serverAuth: requiredText(row.serverAuth, "eventFamily.serverAuth"),
    todayCount: requiredText(row.todayCount, "eventFamily.todayCount"),
    events: requiredRows(row.events, "eventFamily.events", normalizeDetail),
  };
}

function normalizeBatchState(value: unknown): A4DomainExtensionBatch["state"] {
  const normalized = requiredText(value, "domainExtension.state").toLowerCase();
  return normalized === "done" || normalized === "inprogress" || normalized === "pending" || normalized === "scheduled" || normalized === "registered"
    ? normalized
    : invalid("domainExtension.state");
}

function normalizeBatch(row: Record<string, unknown>): A4DomainExtensionBatch {
  return {
    id: requiredText(row.id, "domainExtension.id"),
    title: requiredText(row.title, "domainExtension.title"),
    state: normalizeBatchState(row.state),
    proposer: requiredText(row.proposer, "domainExtension.proposer"),
    impact: requiredText(row.impact, "domainExtension.impact"),
    newDomains: requiredRows(row.newDomains, "domainExtension.newDomains", (item) => ({ name: requiredText(item.name, "domainExtension.domain"), n: requiredBoolean(item.n, "domainExtension.newDomainFlag") })),
    details: requiredRows(row.details, "domainExtension.details", normalizeDetail),
  };
}

function normalizeOverview(raw: unknown): A4Overview {
  const data = rec(raw);
  if (!Object.keys(data).length) invalid("root");
  const stats = rec(data.stats);
  if (!Object.keys(stats).length) invalid("stats");
  const overview: A4Overview = {
    stats: {
      todayEvents: requiredText(stats.todayEvents, "stats.todayEvents"),
      todayAuditEvents: requiredNumber(stats.todayAuditEvents, "stats.todayAuditEvents"),
      registeredDomains: requiredNumber(stats.registeredDomains, "stats.registeredDomains"),
      pendingDomains: requiredNumber(stats.pendingDomains, "stats.pendingDomains"),
      batchDone: requiredNumber(stats.batchDone, "stats.batchDone"),
      batchTotal: requiredNumber(stats.batchTotal, "stats.batchTotal"),
      schemaVersion: requiredText(stats.schemaVersion, "stats.schemaVersion"),
    },
    eventFamilies: requiredNonEmptyRows(data.eventFamilies, "eventFamilies", normalizeFamily),
    registeredDomains: requiredNonEmptyStrings(data.registeredDomains, "registeredDomains"),
    pendingDomains: requiredStrings(data.pendingDomains, "pendingDomains"),
    sunsetDomains: requiredStrings(data.sunsetDomains, "sunsetDomains"),
    commonFields: requiredNonEmptyRows(data.commonFields, "commonFields", (row) => ({ key: requiredText(row.key, "commonFields.key"), name: requiredText(row.name, "commonFields.name"), sub: requiredText(row.sub, "commonFields.sub"), value: requiredText(row.value, "commonFields.value") })),
    dimensionParams: requiredNonEmptyRows(data.dimensionParams, "dimensionParams", (row) => ({ key: requiredText(row.key, "dimensionParams.key"), name: requiredText(row.name, "dimensionParams.name"), sub: requiredText(row.sub, "dimensionParams.sub"), value: requiredText(row.value, "dimensionParams.value"), locked: requiredBoolean(row.locked, "dimensionParams.locked") })),
    kpiFormulas: requiredNonEmptyRows(data.kpiFormulas, "kpiFormulas", (row) => ({ n: requiredNumber(row.n, "kpiFormulas.n"), kpi: requiredText(row.kpi, "kpiFormulas.kpi"), formula: requiredText(row.formula, "kpiFormulas.formula") })),
    schemaRegistrations: requiredNonEmptyRows(data.schemaRegistrations, "schemaRegistrations", (row) => ({
      eventName: requiredText(row.eventName, "schemaRegistrations.eventName"),
      ownerDomain: requiredText(row.ownerDomain, "schemaRegistrations.ownerDomain"),
      familyKey: requiredText(row.familyKey, "schemaRegistrations.familyKey"),
      producer: requiredText(row.producer, "schemaRegistrations.producer"),
      consumers: requiredText(row.consumers, "schemaRegistrations.consumers"),
      properties: requiredText(row.properties, "schemaRegistrations.properties"),
      serverAuthoritative: requiredBoolean(row.serverAuthoritative, "schemaRegistrations.serverAuthoritative"),
      samplingPolicy: requiredText(row.samplingPolicy, "schemaRegistrations.samplingPolicy"),
      version: requiredText(row.version, "schemaRegistrations.version"),
      updatedAt: requiredText(row.updatedAt, "schemaRegistrations.updatedAt"),
    })),
    domainExtensions: requiredNonEmptyRows(data.domainExtensions, "domainExtensions", normalizeBatch),
    guardrails: requiredNonEmptyStrings(data.guardrails, "guardrails"),
  };
  if (overview.stats.registeredDomains !== overview.registeredDomains.length
      || overview.stats.pendingDomains !== overview.pendingDomains.length
      || overview.stats.batchTotal !== overview.domainExtensions.length) {
    invalid("stats.businessCounts");
  }
  return overview;
}

async function a4Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string; stableIdempotencyKey?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init?.stableIdempotencyKey) headers.set("Idempotency-Key", init.stableIdempotencyKey);
  else if (init?.idempotencyPrefix) headers.set("Idempotency-Key", createA4IdempotencyKey(init.idempotencyPrefix));

  const response = await guardedFetch(`/api/admin/platform${path}`, {
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

export async function updateA4DimensionParam(paramKey: string, value: string, reason: string, stableIdempotencyKey?: string) {
  await a4Request(`/events/params/${encodeURIComponent(paramKey)}`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason }),
    idempotencyPrefix: "a4-param",
    stableIdempotencyKey,
  });
  return fetchA4Overview();
}

export type A4SchemaRegistrationInput = {
  eventName: string;
  ownerDomain: string;
  producer: string;
  consumer: string;
  propertyName: string;
  propertyType: string;
  pii: boolean;
  isServerAuthoritative: boolean;
  samplingPolicy: string;
  expectedVersion: string;
  reason: string;
};

export async function registerA4Schema(input: A4SchemaRegistrationInput, stableIdempotencyKey?: string) {
  return a4Request<unknown>("/events/schema-registrations", {
    method: "POST",
    body: JSON.stringify({
      eventName: input.eventName,
      ownerDomain: input.ownerDomain,
      producer: input.producer,
      consumer: input.consumer,
      propertyName: input.propertyName,
      propertyType: input.propertyType,
      pii: input.pii,
      serverAuthoritative: input.isServerAuthoritative,
      samplingPolicy: input.samplingPolicy,
      expectedVersion: input.expectedVersion,
      reason: input.reason,
    }),
    idempotencyPrefix: "a4-schema",
    stableIdempotencyKey,
  }).then(normalizeOverview);
}

export async function registerA4DomainExtension(input: {
  domainName: string;
  eventName: string;
  producer: string;
  consumer: string;
  reason: string;
}, stableIdempotencyKey?: string) {
  return a4Request<unknown>("/events/domain-extension-batches", {
    method: "POST",
    body: JSON.stringify(input),
    idempotencyPrefix: "a4-domain-extension",
    stableIdempotencyKey,
  });
}
