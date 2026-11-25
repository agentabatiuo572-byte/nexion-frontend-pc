import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { normalizeOutboxDeadLetters, normalizeOutboxDiagnostics, nullableA4UserNo, outboxDiagnosticsQuery, type OutboxFilters } from "./a4-outbox-diagnostics";
import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError } from "./a2-client";
import { createPendingMutationStore, createPendingRecovery, type PendingMutationRecord } from "./pending-mutation-store";
import type { AdminSession } from "@/lib/store/admin-auth";
import { explicitRejectionCode } from "./explicit-rejection";
import { currentRecoveryActor } from "./abe-recovery-access";
import { OutcomeUnknownError } from "./outcome-classification";

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
  displayName?: string | null;
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
  displayName?: string | null;
};

export type A4DomainExtensionBatch = {
  id: string;
  title: string;
  state: "done" | "inprogress" | "pending" | "scheduled" | "registered";
  proposer?: string | null;
  producerReference?: string | null;
  consumerReference?: string | null;
  impact: string;
  newDomains: A4DomainItem[];
  details: A4EventDetailRow[];
};

export type A4SchemaRegistration = {
  eventName: string;
  ownerDomain: string;
  displayName?: string | null;
  ownerDisplayName?: string | null;
  producerReference?: string | null;
  familyKey: string;
  producer: string;
  consumers: string;
  properties: string;
  serverAuthoritative: boolean;
  samplingPolicy: string;
  version: string;
  updatedAt: string;
  lifecycleState: "new" | "pending_publish" | "gray" | "full" | "disabled";
  lifecycleVersion: number;
};

export type A4Overview = {
  stats: A4Stats;
  eventFamilies: A4EventFamily[];
  registeredDomains: string[];
  pendingDomains: string[];
  sunsetDomains: string[];
  domainDisplayNames?: Record<string, string>;
  commonFields: A4CommonField[];
  dimensionParams: A4DimensionParam[];
  kpiFormulas: A4KpiFormula[];
  schemaRegistrations: A4SchemaRegistration[];
  domainExtensions: A4DomainExtensionBatch[];
  guardrails: string[];
};

export type A4RetentionExecution = {
  retentionMonths: number;
  /** Execution time; the retention cutoff is stored separately in the backend audit, not in this view. */
  evaluatedAt: string;
  lockAcquired: boolean;
  archivedRows: number;
  deletedRows: number;
  outboxRows: number;
  behaviorFactRows: number;
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

function optionalLabel(value: unknown, field: string): string | null | undefined {
  if (value == null) return value;
  if (typeof value !== "string") invalid(field);
  return value.trim() || null;
}

function requiredCount(value: unknown, field: string) {
  const text = requiredText(value, field);
  const count = Number(text);
  if (!/^(0|[1-9][0-9]*)$/.test(text) || !Number.isSafeInteger(count)) invalid(field);
  return text;
}

function requiredNumber(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(field);
  return value;
}

function requiredInteger(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid(field);
  return value;
}

function requiredBoolean(value: unknown, field: string) {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function lifecycleState(value: unknown): A4SchemaRegistration["lifecycleState"] {
  const state = requiredText(value, "schemaRegistrations.lifecycleState");
  return state === "new" || state === "pending_publish" || state === "gray" || state === "full" || state === "disabled"
    ? state
    : invalid("schemaRegistrations.lifecycleState");
}

function normalizeSchemaRegistration(row: Record<string, unknown>): A4SchemaRegistration {
  return {
    eventName: requiredText(row.eventName, "schemaRegistrations.eventName"),
    ownerDomain: requiredText(row.ownerDomain, "schemaRegistrations.ownerDomain"),
    displayName: optionalLabel(row.displayName, "schemaRegistrations.displayName"),
    ownerDisplayName: optionalLabel(row.ownerDisplayName, "schemaRegistrations.ownerDisplayName"),
    producerReference: optionalLabel(row.producerReference, "schemaRegistrations.producerReference"),
    familyKey: requiredText(row.familyKey, "schemaRegistrations.familyKey"),
    producer: requiredText(row.producer, "schemaRegistrations.producer"),
    consumers: requiredText(row.consumers, "schemaRegistrations.consumers"),
    // A valid existing schema may have no custom property rows yet. The exact
    // lookup must still allow its first controlled property to be added.
    properties: row.properties == null ? "" : typeof row.properties === "string" ? row.properties.trim() : invalid("schemaRegistrations.properties"),
    serverAuthoritative: requiredBoolean(row.serverAuthoritative, "schemaRegistrations.serverAuthoritative"),
    samplingPolicy: requiredText(row.samplingPolicy, "schemaRegistrations.samplingPolicy"),
    version: requiredText(row.version, "schemaRegistrations.version"),
    updatedAt: requiredText(row.updatedAt, "schemaRegistrations.updatedAt"),
    lifecycleState: lifecycleState(row.lifecycleState),
    lifecycleVersion: requiredInteger(row.lifecycleVersion, "schemaRegistrations.lifecycleVersion"),
  };
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
    displayName: optionalLabel(row.displayName, "eventDetail.displayName"),
  };
}

function normalizeFamily(row: Record<string, unknown>): A4EventFamily {
  return {
    key: requiredText(row.key, "eventFamily.key"),
    title: requiredText(row.title, "eventFamily.title"),
    sub: requiredText(row.sub, "eventFamily.sub"),
    sample: requiredText(row.sample, "eventFamily.sample"),
    serverAuth: requiredText(row.serverAuth, "eventFamily.serverAuth"),
    todayCount: requiredCount(row.todayCount, "eventFamily.todayCount"),
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
    proposer: optionalLabel(row.proposer, "domainExtension.proposer"),
    producerReference: optionalLabel(row.producerReference, "domainExtension.producerReference"),
    consumerReference: optionalLabel(row.consumerReference, "domainExtension.consumerReference"),
    impact: requiredText(row.impact, "domainExtension.impact"),
    newDomains: requiredRows(row.newDomains, "domainExtension.newDomains", (item) => ({
      name: requiredText(item.name, "domainExtension.domain"),
      n: requiredBoolean(item.n, "domainExtension.newDomainFlag"),
      displayName: optionalLabel(item.displayName, "domainExtension.displayName"),
    })),
    details: requiredRows(row.details, "domainExtension.details", normalizeDetail),
  };
}

function normalizeOverview(raw: unknown): A4Overview {
  const data = rec(raw);
  if (!Object.keys(data).length) invalid("root");
  const stats = rec(data.stats);
  if (!Object.keys(stats).length) invalid("stats");
  const labels = data.domainDisplayNames;
  if (labels != null && (typeof labels !== "object" || Array.isArray(labels))) invalid("domainDisplayNames");
  const overview: A4Overview = {
    stats: {
      todayEvents: requiredCount(stats.todayEvents, "stats.todayEvents"),
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
    domainDisplayNames: labels == null ? undefined : Object.fromEntries(Object.entries(labels).map(([code, label]) =>
      [code, requiredText(label, `domainDisplayNames.${code}`)])),
    commonFields: requiredNonEmptyRows(data.commonFields, "commonFields", (row) => ({ key: requiredText(row.key, "commonFields.key"), name: requiredText(row.name, "commonFields.name"), sub: requiredText(row.sub, "commonFields.sub"), value: requiredText(row.value, "commonFields.value") })),
    dimensionParams: requiredNonEmptyRows(data.dimensionParams, "dimensionParams", (row) => ({ key: requiredText(row.key, "dimensionParams.key"), name: requiredText(row.name, "dimensionParams.name"), sub: requiredText(row.sub, "dimensionParams.sub"), value: requiredText(row.value, "dimensionParams.value"), locked: requiredBoolean(row.locked, "dimensionParams.locked") })),
    kpiFormulas: requiredNonEmptyRows(data.kpiFormulas, "kpiFormulas", (row) => ({ n: requiredNumber(row.n, "kpiFormulas.n"), kpi: requiredText(row.kpi, "kpiFormulas.kpi"), formula: requiredText(row.formula, "kpiFormulas.formula") })),
    schemaRegistrations: requiredRows(data.schemaRegistrations, "schemaRegistrations", normalizeSchemaRegistration),
    domainExtensions: requiredNonEmptyRows(data.domainExtensions, "domainExtensions", normalizeBatch),
    guardrails: requiredNonEmptyStrings(data.guardrails, "guardrails"),
  };
  if (overview.stats.registeredDomains !== overview.registeredDomains.length
      || overview.stats.pendingDomains !== overview.pendingDomains.length
      || overview.stats.batchTotal !== overview.domainExtensions.length) {
    invalid("stats.businessCounts");
  }
  const familyTotal = overview.eventFamilies.reduce((sum, family) => sum + Number(family.todayCount), 0);
  if (!Number.isSafeInteger(familyTotal) || familyTotal !== Number(overview.stats.todayEvents)) {
    invalid("stats.todayEvents.familyTotal");
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

  if (init?.stableIdempotencyKey && (response.headers.get("X-Nexion-Upstream-Outcome")?.toLowerCase() === "unknown"
      || result?.message?.startsWith("IDEMPOTENCY_") || !result || !Number.isInteger(result.code))) {
    throw new OutcomeUnknownError("A4_MUTATION_OUTCOME_UNKNOWN");
  }

  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    throw Object.assign(new Error(formatAdminApiError(result?.message, `A4_REQUEST_FAILED_${response.status}`)), {
      status: response.ok && typeof result?.code === "number" && result.code !== 0 ? result.code : response.status,
      httpStatus: response.status, apiCode: result?.code, reasonCode: result?.message,
    });
  }

  return result.data as T;
}

export async function fetchA4Overview() {
  return normalizeOverview(await a4Request<unknown>("/events/overview"));
}

export async function fetchA4OutboxDiagnostics(filters: OutboxFilters, cursor = "0") {
  return normalizeOutboxDiagnostics(await a4Request<unknown>(`/events/outbox-diagnostics?${outboxDiagnosticsQuery(filters, cursor)}`, { method: "GET" }));
}

export async function fetchA4OutboxDeadLetters() {
  return normalizeOutboxDeadLetters(await a4Request<unknown>("/events/outbox-dead-letters", { method: "GET" }));
}

/** Read one known schema by exact event name; this deliberately is not a registry search/list API. */
export async function fetchA4SchemaRegistration(eventName: string): Promise<A4SchemaRegistration> {
  return normalizeSchemaRegistration(rec(await a4Request<unknown>(
    `/events/schema-registrations/${encodeURIComponent(eventName)}`,
    { method: "GET" },
  )));
}

export async function updateA4DimensionParam(paramKey: string, value: string, reason: string, stableIdempotencyKey?: string) {
  const row = rec(await a4Request<unknown>(`/events/params/${encodeURIComponent(paramKey)}`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason }),
    idempotencyPrefix: "a4-param",
    stableIdempotencyKey,
  }));
  if (row.key !== paramKey || typeof row.value !== "string" || !row.value.trim()) invalid("param.result");
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

type A4RegistryActor = Pick<AdminSession, "adminId" | "operator" | "username" | "role">;
type A4RegistryProposal = Parameters<typeof createA2OperationProposal>[0];
export type A4RegistryAttempt = PendingMutationRecord & { input: A4RegistryProposal; received?: boolean; ticket?: Awaited<ReturnType<typeof createA2OperationProposal>>; verifiedNotExecuted?: true };
const REGISTRY_STRING_FIELDS: Record<string, string[]> = {
  a4_schema_register: ["eventName", "ownerDomain", "producer", "consumer", "propertyName", "propertyType", "samplingPolicy", "expectedVersion"],
  a4_schema_property_add: ["eventName", "propertyName", "propertyType", "expectedVersion"],
  a4_domain_extension_register: ["domainName", "eventName", "producer", "consumer"],
};

const registryAttempts = createPendingMutationStore<A4RegistryAttempt>({
  storageKey: "nexion-admin-a4-registry-proposals-v1",
  retainExpiredRecords: true,
  isValidRecord: ({ input }) => {
    const op = input?.command?.op;
    const fields = REGISTRY_STRING_FIELDS[op];
    const params = input?.command?.params;
    const flags = op === "a4_schema_register" ? ["pii", "serverAuthoritative"] : [];
    return !!fields && !!params && typeof params === "object" && !Array.isArray(params)
      && input.sourceDomain === "A4" && input.command.domain === "A" && input.type === "param"
      && typeof input.action === "string" && typeof input.obj === "string" && input.obj === params.eventName
      && typeof input.reason === "string" && typeof input.operator === "string" && typeof input.operatorRole === "string"
      && input.beforeValue === "—" && input.afterValue === "—" && input.amplifies === false && input.sos === false && input.roleGate === "超管"
      && input.target?.domain === "A" && input.target.id === input.obj
      && input.target.type === (op === "a4_domain_extension_register" ? "a4_domain_extension" : "a4_event_schema")
      && fields.every(key => typeof params[key] === "string") && flags.every(key => typeof params[key] === "boolean")
      && Object.keys(params).every(key => fields.includes(key) || flags.includes(key));
  },
});

export const a4RegistryRecovery = createPendingRecovery(registryAttempts, {
  capability: () => "receipt",
  explicitRejectionCode,
  canReplay: attempt => {
    const rights = currentRecoveryActor(attempt.fingerprint)?.authorities ?? [];
    return !attempt.received && !attempt.verifiedNotExecuted && rights.includes("platform_a4_read") && rights.includes("platform_a4_write");
  },
});

export function pendingA4RegistryProposal(adminId: number) {
  return registryAttempts.list().find(row => row.fingerprint === String(adminId) && !row.verifiedNotExecuted && !row.ticket);
}

export function pendingA4RegistryObject(adminId: number, eventName: string) {
  const target = eventName.trim().toLowerCase();
  return registryAttempts.list().find(row => row.fingerprint === String(adminId) && !row.verifiedNotExecuted
    && row.input.obj.trim().toLowerCase() === target);
}

export function a4RegistryHistory(adminId: number) {
  return registryAttempts.list().filter(row => row.fingerprint === String(adminId) && (row.ticket || row.verifiedNotExecuted));
}

export function discardA4RegistryDraft(adminId: number, commandKey: string) {
  if (a4RegistryHistory(adminId).some(row => row.commandKey === commandKey && row.verifiedNotExecuted)) {
    registryAttempts.forget(String(adminId), commandKey);
  }
}

function observeRegistryTicket(attempt: A4RegistryAttempt, ticket: NonNullable<A4RegistryAttempt["ticket"]>) {
  if (ticket.status === "approved") {
    a4RegistryRecovery.settleAcknowledged(attempt);
  } else {
    registryAttempts.remember(attempt.fingerprint, attempt.commandKey, {
      ...attempt, received: true, ticket, verifiedNotExecuted: ticket.status === "pending" ? undefined : true,
    });
  }
}

function validateRegistryTicket(ticket: Awaited<ReturnType<typeof createA2OperationProposal>>, attempt: A4RegistryAttempt) {
  if (!ticket.mine || ticket.obj !== attempt.input.obj || ticket.operationCode !== attempt.input.command.op) {
    throw new OutcomeUnknownError("A4_REGISTRY_RESULT_UNKNOWN");
  }
  return ticket;
}

async function postRegistryProposal(attempt: A4RegistryAttempt, retry = false) {
  if (Date.now() >= attempt.expiresAt) throw new OutcomeUnknownError("A4_ORIGINAL_QUERY_ONLY");
  if (!registryAttempts.isDurablyStored(attempt.fingerprint, attempt.commandKey)) throw new Error("A4_ORIGINAL_STORAGE_FAILED");
  let created = false;
  try {
    const post = (original: A4RegistryAttempt) => createA2OperationProposal(original.input, original.commandKey, true, true);
    const receipt = await (retry ? a4RegistryRecovery.replay(attempt, post) : post(attempt));
    created = true;
    registryAttempts.remember(attempt.fingerprint, attempt.commandKey, { ...attempt, received: true });
    const ticket = validateRegistryTicket(receipt, attempt);
    // A replay proves the application was created, not its current approval state.
    const current = retry ? await fetchA2ProposalByKey(attempt.commandKey, true, "a") : ticket;
    if (!current) throw new OutcomeUnknownError("A4_REGISTRY_RESULT_UNKNOWN");
    validateRegistryTicket(current, attempt);
    observeRegistryTicket(attempt, current);
    return { ...current, a4CommandKey: attempt.commandKey };
  } catch (error) {
    const failure = error as { status?: number; backendMessage?: string };
    // The shared A2 client already applies isDeterministicRejection to first sends;
    // only its non-uncertain backend rejection can discard a new proposal here.
    if (!created && !retry && (!isA2OutcomeUncertainError(error)
        && typeof failure.backendMessage === "string" && !failure.backendMessage.startsWith("IDEMPOTENCY_")
        && failure.status !== undefined)) {
      registryAttempts.forget(attempt.fingerprint, attempt.commandKey);
      throw error;
    }
    // Keep this page out of the shared A2 modal branch which exposes command IDs.
    throw new OutcomeUnknownError("A4_REGISTRY_RESULT_UNKNOWN", { cause: error });
  }
}

export async function recoverA4RegistryProposal(adminId: number, retryOriginal = false, commandKey?: string) {
  const attempt = commandKey ? registryAttempts.list().find(row => row.fingerprint === String(adminId)
    && row.commandKey === commandKey && !row.verifiedNotExecuted) : pendingA4RegistryProposal(adminId);
  if (!attempt) return null;
  if (retryOriginal) return postRegistryProposal(attempt, true);
  const result = await a4RegistryRecovery.query(attempt, async original => {
    const ticket = await fetchA2ProposalByKey(original.commandKey, true, "a");
    if (ticket) {
      validateRegistryTicket(ticket, original);
      if (original.ticket && original.ticket.id !== ticket.id) throw new OutcomeUnknownError("A4_REGISTRY_RESULT_UNKNOWN");
    }
    else if (original.received) throw new OutcomeUnknownError("A4_REGISTRY_RESULT_UNKNOWN");
    return { ticket, conclusion: !ticket ? "not-found" : ticket.status === "pending" ? "unknown" : ticket.status === "approved" ? "succeeded" : "rejected" } as const;
  });
  if (!result?.ticket) return null;
  observeRegistryTicket(attempt, result.ticket);
  return { ...result.ticket, a4CommandKey: attempt.commandKey };
}

async function submitRegistryProposal(actor: A4RegistryActor, action: string, op: string, type: string,
  params: Record<string, unknown> & { eventName: string }, reason: string) {
  const rights = currentRecoveryActor(actor.adminId)?.authorities ?? [];
  if (!rights.includes("platform_a4_read") || !rights.includes("platform_a4_write")) throw new Error("FORBIDDEN");
  const previous = pendingA4RegistryObject(actor.adminId, params.eventName) ?? pendingA4RegistryProposal(actor.adminId);
  if (previous) throw new OutcomeUnknownError("A4_REGISTRY_RESULT_UNKNOWN");
  const input: A4RegistryProposal = {
    action, obj: params.eventName, beforeValue: "—", afterValue: "—",
    operator: actor.operator || actor.username, operatorRole: actor.role,
    type: "param", amplifies: false, sos: false, roleGate: "超管", reason, sourceDomain: "A4",
    command: { domain: "A", op, params },
    target: { domain: "A", type, id: params.eventName },
  };
  const fingerprint = String(actor.adminId);
  const commandKey = createA2CommandKey(op);
  registryAttempts.remember(fingerprint, commandKey, { input });
  const attempt = pendingA4RegistryProposal(actor.adminId);
  if (!attempt || !registryAttempts.isDurablyStored(fingerprint, commandKey)) {
    registryAttempts.forget(fingerprint, commandKey);
    throw new Error("A4_ORIGINAL_STORAGE_FAILED");
  }
  return postRegistryProposal(attempt);
}

export function registerA4Schema(actor: A4RegistryActor, input: A4SchemaRegistrationInput) {
  const { reason, isServerAuthoritative, ...params } = input;
  return submitRegistryProposal(actor, "登记事件", "a4_schema_register", "a4_event_schema",
    { ...params, serverAuthoritative: isServerAuthoritative }, reason);
}

/** Adds one property to a server-returned existing schema. Metadata remains server-owned. */
export function addA4SchemaProperty(
  actor: A4RegistryActor,
  eventName: string,
  propertyName: string,
  propertyType: string,
  expectedVersion: string,
  reason: string,
) {
  return submitRegistryProposal(actor, "新增事件字段", "a4_schema_property_add", "a4_event_schema",
    { eventName, propertyName, propertyType, expectedVersion }, reason);
}

export function registerA4DomainExtension(actor: A4RegistryActor, input: {
  domainName: string;
  eventName: string;
  producer: string;
  consumer: string;
  reason: string;
}) {
  const { reason, ...params } = input;
  return submitRegistryProposal(actor, "登记域扩展批次", "a4_domain_extension_register", "a4_domain_extension", params, reason);
}

export async function transitionA4Lifecycle(
  eventName: string,
  targetState: A4SchemaRegistration["lifecycleState"],
  expectedState: A4SchemaRegistration["lifecycleState"],
  expectedVersion: number,
  reason: string,
  stableIdempotencyKey?: string,
) {
  const row = rec(await a4Request<unknown>(`/events/schema-registrations/${encodeURIComponent(eventName)}/lifecycle`, {
    method: "POST",
    body: JSON.stringify({ targetState, expectedState, expectedVersion, reason }),
    idempotencyPrefix: "a4-lifecycle",
    stableIdempotencyKey,
  }));
  if (row.eventName !== eventName || row.state !== targetState || row.version !== expectedVersion + 1
      || typeof row.updatedAt !== "string" || !row.updatedAt.trim()) invalid("lifecycle.result");
}

function normalizeRetentionExecution(value: unknown): A4RetentionExecution {
  const row = rec(value);
  const integer = (key: string) => requiredNumber(row[key], `retentionRun.${key}`);
  return {
    retentionMonths: integer("retentionMonths"), evaluatedAt: requiredText(row.evaluatedAt, "retentionRun.evaluatedAt"),
    lockAcquired: requiredBoolean(row.lockAcquired, "retentionRun.lockAcquired"),
    archivedRows: integer("archivedRows"), deletedRows: integer("deletedRows"),
    outboxRows: integer("outboxRows"), behaviorFactRows: integer("behaviorFactRows"),
  };
}

export async function fetchA4RetentionLatest(): Promise<A4RetentionExecution | null> {
  const response = await a4Request<unknown>("/events/retention-runs/latest");
  return response == null ? null : normalizeRetentionExecution(response);
}

export async function runA4RetentionNow(reason: string, commandKey: string, expectedRetentionMonths?: number): Promise<A4RetentionExecution> {
  return normalizeRetentionExecution(await a4Request<unknown>("/events/retention-runs", {
    method: "POST", body: JSON.stringify({ reason, ...(expectedRetentionMonths === undefined ? {} : { expectedRetentionMonths }) }), stableIdempotencyKey: commandKey,
  }));
}

/**
 * A narrowly scoped recovery command for an audited original H3 fact.  The
 * server, not this client, locks the row and checks DEAD/original/type guards;
 * this function never accepts or sends the immutable event payload/source.
 */
export type A4H3DeadOutboxRedrivePreview = {
  // Optional only for original command snapshots saved before this read projection existed.
  userNo?: string | null;
  eventId: string;
  eventType: string;
  status: "DEAD";
  retryCount: number;
  lastError: string | null;
  deliveryStatus: "DEAD";
  deliveryAttemptCount: number;
  deliveryLastError: string | null;
};

export type A4H3DeadOutboxRedriveResult = Omit<A4H3DeadOutboxRedrivePreview, "status" | "deliveryStatus" | "userNo"> & {
  status: "PENDING";
  deliveryStatus: "FAILED";
};

function normalizeH3DeadOutboxPreview(value: unknown): A4H3DeadOutboxRedrivePreview {
  const row = rec(value);
  const retryCount = requiredNumber(row.retryCount, "h3DeadOutbox.retryCount");
  const lastError = row.lastError == null ? null : requiredText(row.lastError, "h3DeadOutbox.lastError");
  const deliveryAttemptCount = requiredNumber(row.deliveryAttemptCount, "h3DeadOutbox.deliveryAttemptCount");
  const deliveryLastError = row.deliveryLastError == null ? null : requiredText(row.deliveryLastError, "h3DeadOutbox.deliveryLastError");
  if (!Number.isInteger(retryCount) || retryCount < 0 || !Number.isInteger(deliveryAttemptCount) || deliveryAttemptCount < 0) invalid("h3DeadOutbox.attemptCount");
  if (row.status !== "DEAD" || row.deliveryStatus !== "DEAD") invalid("h3DeadOutbox.deadState");
  if (lastError != null && !/^[A-Z][A-Z0-9_:-]{0,127}$/.test(lastError)) invalid("h3DeadOutbox.lastError");
  if (deliveryLastError != null && !/^[A-Z][A-Z0-9_:-]{0,127}$/.test(deliveryLastError)) invalid("h3DeadOutbox.deliveryLastError");
  return {
    userNo: nullableA4UserNo(row.userNo),
    eventId: requiredText(row.eventId, "h3DeadOutbox.eventId"),
    eventType: requiredText(row.eventType, "h3DeadOutbox.eventType"),
    status: "DEAD",
    retryCount,
    lastError,
    deliveryStatus: "DEAD",
    deliveryAttemptCount,
    deliveryLastError,
  };
}

function normalizeH3DeadOutboxRedriveResult(value: unknown): A4H3DeadOutboxRedriveResult {
  const row = rec(value);
  // POST receipts have no authorized user projection, including replayed receipts.
  const { userNo: _userNo, ...preview } = normalizeH3DeadOutboxPreview({ ...row, userNo: null, status: "DEAD", deliveryStatus: "DEAD" });
  if (row.status !== "PENDING" || row.deliveryStatus !== "FAILED") invalid("h3DeadOutbox.redrive.status");
  return { ...preview, status: "PENDING", deliveryStatus: "FAILED" };
}

export async function fetchH3DeadOutboxRedrivePreview(eventId: string): Promise<A4H3DeadOutboxRedrivePreview> {
  return normalizeH3DeadOutboxPreview(await a4Request<unknown>(
    `/events/outbox/${encodeURIComponent(eventId)}/redrive-preview`,
    { method: "GET" },
  ));
}

export async function redriveAuditedH3DeadOutboxEvent(
  eventId: string,
  expectedRetryCount: number,
  expectedDeliveryStatus: "DEAD",
  expectedDeliveryAttemptCount: number,
  reason: string,
  commandKey: string,
): Promise<A4H3DeadOutboxRedriveResult> {
  return normalizeH3DeadOutboxRedriveResult(await a4Request<unknown>(
    `/events/outbox/${encodeURIComponent(eventId)}/redrive`,
    {
      method: "POST",
      body: JSON.stringify({ reason, expectedRetryCount, expectedDeliveryStatus, expectedDeliveryAttemptCount }),
      stableIdempotencyKey: commandKey,
    },
  ));
}
