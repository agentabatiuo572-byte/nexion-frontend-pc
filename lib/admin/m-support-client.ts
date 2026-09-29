import { MContentReadError, parseMContentApiEnvelope } from "./m-support-read-contract.ts";
import { parseBusinessTime } from "./business-time.ts";
import { guardedFetch } from "./error-messages.ts";

const BASE = "/api/admin/content";
const FILTERS = ["ALL", "WINDOW_ACTIVE", "ACTIVE", "DORMANT", "UNKNOWN", "TODO", "DUE", "WAITING_REPLY", "FIRST_CONTACT", "STOPPED"] as const;
const POOL_REASONS = ["NO_INVITER", "INVITER_UNBOUND", "DEPTH_LIMIT", "RULE_UNCONFIGURED", "AGENT_UNAVAILABLE", "MIGRATION_REVIEW"] as const;
const MODES = ["UNCONFIGURED", "UNLIMITED", "LIMITED"] as const;

export type SupportCustomerFilter = typeof FILTERS[number];
export type SupportPoolReason = typeof POOL_REASONS[number];
export type SupportInheritanceMode = typeof MODES[number];
export type SupportPage<T> = { records: T[]; total: number; pageNum: number; pageSize: number; available?: boolean; filter?: SupportCustomerFilter };
export type SupportCounts = {
  boundCustomers: number | null;
  windowActiveCustomers: number | null;
  dormantCustomers: number | null;
  dueMaintenanceCustomers: number | null;
  waitingReplyCustomers: number | null;
  firstContactCustomers: number | null;
  stoppedMaintenanceCustomers?: number | null;
};
export type SupportOverview = {
  snapshotId: string;
  evaluatedAt: string;
  rulesVersion: number;
  scope: { actorId: number; agentAdminId: number | null; mode: "AGENT" | "SUPERVISOR_ALL" };
  counts: SupportCounts;
  knownActiveCount: number;
  unknownWindowCount: number;
  activityWindowDays?: number | null;
  performance: { executionCount: number; successfulCycleCount: number; successfulCustomerCount: number; from: string; to: string; timeZone: string; trend: Array<{ day: string; executionCount: number; successfulCycleCount: number }> };
};
export type SupportWorkbenchSnapshot = { overview: SupportOverview; customers: SupportPage<SupportCustomer>; completeness: { unknownCount: number; unknownWindowCount: number; coverageStartAt: string; observedThroughAt: string; observationLagMillis: number; activitySource: "INTERACTIVE_LOGIN" } };
export type SupportCustomer = {
  customerId: string;
  assignmentId: string | null;
  assignmentVersion: number;
  agentAdminId: number | null;
  version: number;
  customerNo?: string;
  displayName?: string;
  accountState: "ACTIVE" | "DORMANT" | "UNKNOWN";
  windowStatus: "ACTIVE" | "INACTIVE" | "UNKNOWN";
  maintenanceEnabled: boolean;
  maintenanceStatus: string;
  lastEffectiveAt: string | null;
  nextMaintenanceAt: string | null;
  waitingReply: boolean;
  firstContact: boolean;
  due: boolean | null;
  pendingReplyCount: number;
  pendingConversationNo: string | null;
  pendingThroughMessageId: number | null;
};
export type SupportCustomerDetail = SupportCustomer & { agentAdminId: number; maintenanceEnabled: boolean; maintenanceVersion: number };
export type SupportMaintenanceRecord = { id: string; kind: string; occurredAt: string; state?: string };
export type SupportMaintenanceHistory = { customerId: string; cycles: SupportMaintenanceRecord[]; executions: SupportMaintenanceRecord[]; totalCycles: number; totalExecutions: number; pageNum: number; pageSize: number };
export type SupportBindingPoolItem = {
  customerId: string;
  reason: SupportPoolReason;
  enteredAt: string;
  version: number;
  customerNo?: string;
  displayName?: string;
  inviterCustomerId?: string | null;
  pendingMessageCount?: number;
  lastMessageAt?: string | null;
};
export type SupportAgentCandidate = {
  adminId: number;
  name: string;
  seatType: "MANAGER" | "DEDICATED" | "GENERAL";
  serviceTypes: Array<"support" | "advisor">;
  enabled: boolean;
  busy: boolean;
  assignedUserCount: number;
  maxConcurrent: number;
  currentActiveSessions?: number;
  version: number;
};
export type SupportTransferResult = {
  assignments: Array<{ customerId: string; assignmentId: string; agentAdminId: number; version: number }>;
};
export type SupportRules = {
  version: number;
  dormantDays: number | null;
  maintenanceDays: number | null;
  activityWindowDays: number | null;
  inheritanceMode: SupportInheritanceMode;
  maxInheritanceDepth: number | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  reason?: string | null;
  attachmentPolicy?: Record<string, unknown> | null;
};
export type SupportAttachment = {
  id: string;
  customerId: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  state: "READY";
  expiresAt: string;
};
export type SupportAttachmentPolicy = { available: boolean; allowedMimeTypes: Array<"image/png" | "image/jpeg">; maxBytes: number | null; maxPixels: number | null; ttlSeconds: number | null; unavailableReason: string | null };
export type SupportMessageResult = { conversationNo: string };
export type SupportCommandResult = { status: "PROCESSING" | "UNKNOWN" | "PENDING" | "SUCCEEDED" | "FAILED"; result?: unknown };
export type SupportReplyTarget = { conversationNo: string; throughMessageId: number };
export type SupportMessageInput = {
  kind: "TEXT" | "IMAGE";
  content?: string;
  attachmentId?: string;
  intent: "SERVICE" | "MAINTENANCE";
  clientMessageId: string;
  replyTargets?: SupportReplyTarget[];
  expectedAssignmentId: string;
  expectedVersion: number;
};
export type SupportStartConversationInput = {
  customerId: string;
  openingText: string;
  intent: "SERVICE" | "MAINTENANCE";
  clientMessageId: string;
  expectedAssignmentId: string;
  expectedVersion: number;
  replyTargets?: SupportReplyTarget[];
};

export class SupportClientError extends Error {
  readonly status: number;
  readonly apiCode: number | undefined;
  readonly backendMessage: string | undefined;
  constructor(status: number, apiCode: number | undefined, backendMessage: string | undefined) {
    super(`SUPPORT_API_${status}`);
    this.name = "SupportClientError";
    this.status = status;
    this.apiCode = apiCode;
    this.backendMessage = backendMessage;
  }
}
export function isIndeterminateSupportError(error: unknown): boolean {
  return error instanceof SupportClientError && error.status === 409
    && (error.backendMessage ?? "").startsWith("IDEMPOTENCY_");
}

function malformed(field: string): never { throw new Error(`SUPPORT_CONTRACT_MALFORMED:${field}`); }
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) malformed(field);
  return value as Record<string, unknown>;
}
function nonempty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) malformed(field);
  return value;
}
function id(value: unknown, field: string): string {
  if (typeof value === "string" && /^\d+$/.test(value) && /[1-9]/.test(value) && Number.isSafeInteger(Number(value))) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  malformed(field);
}
export function supportWireId(value: unknown, field: string): number { return Number(id(value, field)); }
const wireId = supportWireId;
function opaqueId(value: unknown, field: string): string {
  const text = nonempty(value, field);
  if (text.includes("..") || text.includes("/") || text.includes("\\")) malformed(field);
  return text;
}
function count(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) malformed(field);
  return value as number;
}
function positive(value: unknown, field: string): number {
  const result = count(value, field);
  if (result === 0) malformed(field);
  return result;
}
function nullableCount(value: unknown, field: string): number | null { return value === null ? null : count(value, field); }
function nullablePositive(value: unknown, field: string): number | null { return value === null ? null : positive(value, field); }
function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") malformed(field);
  return value;
}
function timestamp(value: unknown, field: string): string {
  const text = nonempty(value, field);
  if (Number.isNaN(parseBusinessTime(text))) malformed(field);
  return text;
}
function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return nonempty(value, field);
}
function nullableString(value: unknown, field: string): string | null {
  return value === null ? null : nonempty(value, field);
}
function nullableTimestamp(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  return timestamp(value, field);
}
function optionalBool(value: unknown, field: string): boolean | undefined {
  return value === undefined ? undefined : bool(value, field);
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T)) malformed(field);
  return value as T;
}
function page<T>(value: unknown, parse: (value: unknown) => T): SupportPage<T> {
  const row = object(value, "page");
  if (!Array.isArray(row.records)) malformed("page.records");
  return { total: count(row.total, "page.total"), pageNum: positive(row.pageNum, "page.pageNum"), pageSize: positive(row.pageSize, "page.pageSize"), records: row.records.map(parse) };
}
function customer(value: unknown): SupportCustomer {
  const row = object(value, "customer");
  const enabled = bool(row.enabled, "customer.enabled");
  const due = row.due === null ? null : bool(row.due, "customer.due");
  const openCycleId = row.openCycleId === null ? null : id(row.openCycleId, "customer.openCycleId");
  return {
    customerId: id(row.customerId, "customer.customerId"),
    assignmentId: row.assignmentId === null ? null : id(row.assignmentId, "customer.assignmentId"),
    assignmentVersion: count(row.assignmentVersion, "customer.assignmentVersion"),
    agentAdminId: row.agentAdminId === null ? null : positive(row.agentAdminId, "customer.agentAdminId"),
    version: count(row.preferenceVersion, "customer.preferenceVersion"),
    customerNo: optionalString(row.customerNo, "customer.customerNo"),
    displayName: nullableString(row.nickname, "customer.nickname") ?? undefined,
    accountState: enumValue(row.activityStatus, ["ACTIVE", "DORMANT", "UNKNOWN"] as const, "customer.activityStatus"),
    windowStatus: enumValue(row.windowStatus, ["ACTIVE", "INACTIVE", "UNKNOWN"] as const, "customer.windowStatus"),
    maintenanceEnabled: enabled,
    maintenanceStatus: !enabled ? "STOPPED" : due === null ? "UNCONFIGURED" : due ? "DUE" : openCycleId ? "OPEN" : "CURRENT",
    lastEffectiveAt: row.lastEffectiveAt === null ? null : timestamp(row.lastEffectiveAt, "customer.lastEffectiveAt"),
    nextMaintenanceAt: row.nextDueAt === null ? null : timestamp(row.nextDueAt, "customer.nextDueAt"),
    waitingReply: bool(row.waitingReply, "customer.waitingReply"),
    firstContact: bool(row.firstContact, "customer.firstContact"),
    due,
    pendingReplyCount: count(row.pendingReplyCount, "customer.pendingReplyCount"),
    pendingConversationNo: nullableString(row.pendingConversationNo, "customer.pendingConversationNo"),
    pendingThroughMessageId: row.pendingThroughMessageId === null ? null : positive(row.pendingThroughMessageId, "customer.pendingThroughMessageId"),
  };
}
function detail(value: unknown): SupportCustomerDetail {
  const row = object(value, "detail");
  const parsed = customer(row.customer);
  return { ...parsed, agentAdminId: positive(parsed.agentAdminId, "detail.agentAdminId"), maintenanceVersion: parsed.version };
}
function workbenchSnapshot(value: unknown): SupportWorkbenchSnapshot {
  const row = object(value, "workbench");
  const scope = object(row.scope, "workbench.scope");
  const rules = object(row.rules, "workbench.rules");
  const totals = object(row.overview, "workbench.overview");
  const performance = object(row.performance, "workbench.performance");
  const completeness = object(row.completeness, "workbench.completeness");
  const rawPage = object(row.customers, "workbench.customers");
  if (!Array.isArray(performance.days)) malformed("workbench.performance.days");
  const unknownWindowCount = count(totals.unknownWindowCount, "workbench.unknownWindowCount");
  const counts: SupportCounts = {
    boundCustomers: count(totals.boundTotal, "workbench.boundTotal"),
    windowActiveCustomers: nullableCount(totals.activeTotal, "workbench.activeTotal"),
    dormantCustomers: nullableCount(totals.dormantTotal, "workbench.dormantTotal"),
    dueMaintenanceCustomers: nullableCount(totals.dueTotal, "workbench.dueTotal"),
    waitingReplyCustomers: count(totals.waitingReplyTotal, "workbench.waitingReplyTotal"),
    firstContactCustomers: count(totals.firstContactTotal, "workbench.firstContactTotal"),
    stoppedMaintenanceCustomers: count(totals.stoppedTotal, "workbench.stoppedTotal"),
  };
  if (unknownWindowCount > 0 && counts.windowActiveCustomers !== null) malformed("workbench.activeTotal");
  const trend = performance.days.map((entry) => {
    const point = object(entry, "workbench.performance.day");
    const day = nonempty(point.day, "workbench.performance.day.day");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) malformed("workbench.performance.day.day");
    return { day, executionCount: count(point.executionCount, "workbench.performance.day.executionCount"), successfulCycleCount: count(point.successfulCycleCount, "workbench.performance.day.successfulCycleCount") };
  });
  const overview: SupportOverview = {
    snapshotId: nonempty(row.snapshotId, "workbench.snapshotId"),
    evaluatedAt: timestamp(row.evaluatedAt, "workbench.evaluatedAt"),
    rulesVersion: count(row.rulesVersion, "workbench.rulesVersion"),
    scope: { actorId: positive(scope.actorId, "workbench.scope.actorId"), agentAdminId: scope.agentAdminId === null ? null : positive(scope.agentAdminId, "workbench.scope.agentAdminId"), mode: enumValue(scope.mode, ["AGENT", "SUPERVISOR_ALL"] as const, "workbench.scope.mode") },
    counts,
    knownActiveCount: count(totals.knownActiveCount, "workbench.knownActiveCount"),
    unknownWindowCount,
    activityWindowDays: nullablePositive(rules.activityWindowDays, "workbench.rules.activityWindowDays"),
    performance: { executionCount: count(performance.executionCount, "workbench.performance.executionCount"), successfulCycleCount: count(performance.successfulCycleCount, "workbench.performance.successfulCycleCount"), successfulCustomerCount: count(performance.successfulCustomerCount, "workbench.performance.successfulCustomerCount"), from: timestamp(performance.from, "workbench.performance.from"), to: timestamp(performance.to, "workbench.performance.to"), timeZone: nonempty(performance.timeZone, "workbench.performance.timeZone"), trend },
  };
  const customers = { ...page(rawPage, customer), available: bool(rawPage.available, "workbench.customers.available"), filter: enumValue(rawPage.filter, FILTERS, "workbench.customers.filter") };
  if (!customers.available && customers.records.length) malformed("workbench.customers.records");
  const completenessValue = {
    unknownCount: count(completeness.unknownCount, "workbench.completeness.unknownCount"),
    unknownWindowCount: count(completeness.unknownWindowCount, "workbench.completeness.unknownWindowCount"),
    coverageStartAt: timestamp(completeness.coverageStartAt, "workbench.completeness.coverageStartAt"),
    observedThroughAt: timestamp(completeness.observedThroughAt, "workbench.completeness.observedThroughAt"),
    observationLagMillis: count(completeness.observationLagMillis, "workbench.completeness.observationLagMillis"),
    activitySource: enumValue(completeness.activitySource, ["INTERACTIVE_LOGIN"] as const, "workbench.completeness.activitySource"),
  };
  if (completenessValue.unknownWindowCount !== unknownWindowCount) malformed("workbench.completeness.unknownWindowCount");
  return { overview, customers, completeness: completenessValue };
}
function rules(value: unknown): SupportRules {
  const row = object(value, "rules");
  const mode = enumValue(row.inheritanceMode, MODES, "rules.inheritanceMode");
  const result: SupportRules = {
    version: count(row.version, "rules.version"),
    dormantDays: nullablePositive(row.dormantDays, "rules.dormantDays"),
    maintenanceDays: nullablePositive(row.maintenanceDays, "rules.maintenanceDays"),
    activityWindowDays: nullablePositive(row.activityWindowDays, "rules.activityWindowDays"),
    inheritanceMode: mode,
    maxInheritanceDepth: row.maxInheritanceDepth === null ? null : count(row.maxInheritanceDepth, "rules.maxInheritanceDepth"),
    updatedAt: nullableTimestamp(row.updatedAt, "rules.updatedAt"),
    updatedBy: row.updatedBy === null ? null : optionalString(row.updatedBy, "rules.updatedBy"),
    reason: row.reason === null ? null : optionalString(row.reason, "rules.reason"),
    attachmentPolicy: row.attachmentPolicy === undefined || row.attachmentPolicy === null ? row.attachmentPolicy : object(row.attachmentPolicy, "rules.attachmentPolicy"),
  };
  if ((mode === "LIMITED") !== (result.maxInheritanceDepth !== null)) malformed("rules.maxInheritanceDepth");
  if (result.dormantDays !== null && result.activityWindowDays !== null && result.activityWindowDays > result.dormantDays) malformed("rules.activityWindowDays");
  return result;
}
function query(input: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== "") params.set(key, String(value));
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}
function keyHeader(key: string): HeadersInit {
  if (key.length < 8 || key.length > 128) throw new Error("SUPPORT_IDEMPOTENCY_KEY_INVALID");
  return { "Idempotency-Key": key };
}
async function request<T>(path: string, parse: (value: unknown) => T, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await guardedFetch(`${BASE}${path}`, { ...init, headers, cache: "no-store", credentials: "same-origin" });
  const text = await response.text();
  try { return parse(parseMContentApiEnvelope<unknown>(response.status, text, true)); }
  catch (error) {
    if (error instanceof MContentReadError) throw new SupportClientError(error.status, error.apiCode, error.backendMessage);
    throw error;
  }
}
function json(method: "POST" | "PUT" | "PATCH", body: object, key: string, signal?: AbortSignal): RequestInit {
  return { method, body: JSON.stringify(body), headers: keyHeader(key), signal };
}
function customerPath(customerId: string): string { return `/support-workbench/customers/${encodeURIComponent(id(customerId, "customerId"))}`; }
function attachmentPath(attachmentId: string): string { return `/conversations/attachments/${encodeURIComponent(opaqueId(attachmentId, "attachmentId"))}`; }

export const supportClient = {
  snapshot: (options: { pageNum: number; pageSize: number; keyword?: string; filter?: SupportCustomerFilter; agentId?: number; from?: string; to?: string; signal?: AbortSignal }) =>
    request(`/support-workbench/customers${query({ pageNum: positive(options.pageNum, "pageNum"), pageSize: positive(options.pageSize, "pageSize"), keyword: options.keyword, filter: options.filter, agentId: options.agentId, from: options.from, to: options.to })}`, workbenchSnapshot, { signal: options.signal }),
  overview: async (options: { from?: string; to?: string; signal?: AbortSignal } = {}) =>
    (await supportClient.snapshot({ pageNum: 1, pageSize: 1, filter: "ALL", ...options })).overview,
  customers: async (options: { pageNum: number; pageSize: number; keyword?: string; filter?: SupportCustomerFilter; signal?: AbortSignal }) =>
    (await supportClient.snapshot(options)).customers,
  customerDetail: (customerId: string, signal?: AbortSignal) => request(customerPath(customerId), detail, { signal }),
  conversationState: (conversationNo: string, signal?: AbortSignal) => request(`/conversations/${encodeURIComponent(nonempty(conversationNo, "conversationNo"))}`, (value) => {
    const row = object(object(value, "conversation.detail").conversation, "conversation");
    return { status: enumValue(row.status, ["OPEN", "TRANSFERRED", "RESOLVED", "CLOSED"] as const, "conversation.status"), version: count(row.version, "conversation.version") };
  }, { signal }),
  maintenanceHistory: (customerId: string, options: { pageNum: number; pageSize: number; signal?: AbortSignal }) =>
    request(`${customerPath(customerId)}/maintenance/history${query({ pageNum: positive(options.pageNum, "pageNum"), pageSize: positive(options.pageSize, "pageSize") })}`, (value): SupportMaintenanceHistory => {
      const row = object(value, "maintenance.history");
      if (!Array.isArray(row.cycles) || !Array.isArray(row.executions)) malformed("maintenance.history.records");
      return {
        customerId: id(row.customerId, "maintenance.customerId"), pageNum: positive(row.pageNum, "maintenance.pageNum"), pageSize: positive(row.pageSize, "maintenance.pageSize"),
        totalCycles: count(row.totalCycles, "maintenance.totalCycles"), totalExecutions: count(row.totalExecutions, "maintenance.totalExecutions"),
        cycles: row.cycles.map((entry) => { const cycle = object(entry, "maintenance.cycle"); return { id: id(cycle.id, "maintenance.cycle.id"), kind: "CYCLE", occurredAt: timestamp(cycle.openedAt, "maintenance.cycle.openedAt"), state: nonempty(cycle.status, "maintenance.cycle.status") }; }),
        executions: row.executions.map((entry) => { const execution = object(entry, "maintenance.execution"); return { id: id(execution.id, "maintenance.execution.id"), kind: "EXECUTION", occurredAt: timestamp(execution.executedAt, "maintenance.execution.executedAt") }; }),
      };
    }, { signal: options.signal }),
  setMaintenance: (customerId: string, input: { enabled: boolean; reason: string; expectedVersion: number; expectedAssignmentId: string }, idempotencyKey: string, signal?: AbortSignal) =>
    request(`${customerPath(customerId)}/maintenance`, (value) => { const row = object(value, "maintenance.result"); return { customerId: id(row.customerId, "maintenance.customerId"), assignmentId: id(row.assignmentId, "maintenance.assignmentId"), enabled: bool(row.enabled, "maintenance.enabled"), version: positive(row.version, "maintenance.version") }; }, json("PATCH", { ...input, expectedVersion: positive(input.expectedVersion, "maintenance.expectedVersion"), expectedAssignmentId: wireId(input.expectedAssignmentId, "maintenance.expectedAssignmentId") }, idempotencyKey, signal)),
  bindingPool: (options: { pageNum: number; pageSize: number; keyword?: string; reason?: SupportPoolReason; signal?: AbortSignal }) =>
    request(`/support-agents/binding-pool${query({ pageNum: positive(options.pageNum, "pageNum"), pageSize: positive(options.pageSize, "pageSize"), keyword: options.keyword, reason: options.reason })}`, (value) => page(value, (entry): SupportBindingPoolItem => {
      const row = object(entry, "bindingPool.item");
      return { customerId: id(row.customerId, "bindingPool.customerId"), reason: enumValue(row.reason, POOL_REASONS, "bindingPool.reason"), enteredAt: timestamp(row.enteredAt, "bindingPool.enteredAt"), version: count(row.version, "bindingPool.version"), customerNo: optionalString(row.customerNo, "bindingPool.customerNo"), displayName: optionalString(row.displayName, "bindingPool.displayName"), inviterCustomerId: row.inviterCustomerId === null ? null : row.inviterCustomerId === undefined ? undefined : id(row.inviterCustomerId, "bindingPool.inviterCustomerId"), pendingMessageCount: row.pendingMessageCount === undefined ? undefined : count(row.pendingMessageCount, "bindingPool.pendingMessageCount"), lastMessageAt: nullableTimestamp(row.lastMessageAt, "bindingPool.lastMessageAt") };
    }), { signal: options.signal }),
  agents: (options: { pageNum: number; pageSize: number; signal?: AbortSignal }) =>
    request(`/support-agents/page${query({ pageNum: positive(options.pageNum, "pageNum"), pageSize: positive(options.pageSize, "pageSize") })}`, (value) => page(value, (entry): SupportAgentCandidate => {
      const row = object(entry, "agent");
      if (!Array.isArray(row.serviceTypes)) malformed("agent.serviceTypes");
      return { adminId: positive(row.adminId, "agent.adminId"), name: nonempty(row.name, "agent.name"), seatType: enumValue(row.seatType, ["MANAGER", "DEDICATED", "GENERAL"] as const, "agent.seatType"), serviceTypes: row.serviceTypes.map((type) => enumValue(type, ["support", "advisor"] as const, "agent.serviceTypes")), enabled: bool(row.enabled, "agent.enabled"), busy: bool(row.busy, "agent.busy"), assignedUserCount: count(row.assignedUserCount, "agent.assignedUserCount"), maxConcurrent: count(row.maxConcurrent, "agent.maxConcurrent"), currentActiveSessions: row.currentActiveSessions === undefined ? undefined : count(row.currentActiveSessions, "agent.currentActiveSessions"), version: count(row.version, "agent.version") };
    }), { signal: options.signal }),
  transfer: (input: { targetAgentAdminId: number; customers: Array<{ id: string; expectedAssignmentId: string | null; expectedVersion: number }>; reason: string }, idempotencyKey: string, signal?: AbortSignal) =>
    request("/support-agents/assignments/transfer", (value): SupportTransferResult => {
      if (!Array.isArray(value)) malformed("transfer.assignments");
      const assignments = value.map((entry) => { const item = object(entry, "transfer.assignment"); return { customerId: id(item.customerId, "transfer.customerId"), assignmentId: id(item.id, "transfer.id"), agentAdminId: positive(item.agentAdminId, "transfer.agentAdminId"), version: positive(item.version, "transfer.version") }; });
      if (assignments.length !== input.customers.length || new Set(assignments.map((item) => item.customerId)).size !== assignments.length || assignments.some((item) => item.agentAdminId !== input.targetAgentAdminId) || input.customers.some((item) => !assignments.some((assigned) => assigned.customerId === id(item.id, "transfer.input.id")))) malformed("transfer.assignments");
      return { assignments };
    }, json("POST", { ...input, targetAgentAdminId: positive(input.targetAgentAdminId, "transfer.targetAgentAdminId"), customers: input.customers.map((item) => ({ id: wireId(item.id, "transfer.customerId"), expectedAssignmentId: item.expectedAssignmentId === null ? null : wireId(item.expectedAssignmentId, "transfer.expectedAssignmentId"), expectedVersion: positive(item.expectedVersion, "transfer.expectedVersion") })) }, idempotencyKey, signal)),
  rules: (signal?: AbortSignal) => request("/support-agents/rules", rules, { signal }),
  updateRules: (input: Pick<SupportRules, "dormantDays" | "maintenanceDays" | "activityWindowDays" | "inheritanceMode" | "maxInheritanceDepth"> & { expectedVersion: number; reason: string }, idempotencyKey: string, signal?: AbortSignal) =>
    request("/support-agents/rules", rules, json("PUT", { ...input, expectedVersion: positive(input.expectedVersion, "rules.expectedVersion") }, idempotencyKey, signal)),
  command: (key: string, signal?: AbortSignal) => request(`/support-workbench/commands/${encodeURIComponent(key)}`, (value): SupportCommandResult => {
    const row = object(value, "command");
    const result = row.result === undefined ? undefined : object(row.result, "command.result");
    if (result && result.code !== 0) malformed("command.result.code");
    return { status: enumValue(row.status, ["PROCESSING", "UNKNOWN", "PENDING", "SUCCEEDED", "FAILED"] as const, "command.status"), result: result?.data };
  }, { signal }),
  attachmentPolicy: (signal?: AbortSignal) => request("/conversations/attachments/policy", (value): SupportAttachmentPolicy => {
    const row = object(value, "attachment.policy");
    if (!Array.isArray(row.allowedMimeTypes)) malformed("attachment.policy.allowedMimeTypes");
    return { available: bool(row.available, "attachment.policy.available"), allowedMimeTypes: row.allowedMimeTypes.map((mime) => enumValue(mime, ["image/png", "image/jpeg"] as const, "attachment.policy.allowedMimeTypes")), maxBytes: nullablePositive(row.maxBytes, "attachment.policy.maxBytes"), maxPixels: nullablePositive(row.maxPixels, "attachment.policy.maxPixels"), ttlSeconds: nullablePositive(row.ttlSeconds, "attachment.policy.ttlSeconds"), unavailableReason: nullableString(row.unavailableReason, "attachment.policy.unavailableReason") };
  }, { signal }),
  uploadAttachment: (input: { file: File; customerId: string; clientUploadId: string; expectedAssignmentId: string }, idempotencyKey: string, signal?: AbortSignal) => {
    const form = new FormData();
    form.set("file", input.file);
    form.set("customerId", id(input.customerId, "upload.customerId"));
    form.set("clientUploadId", nonempty(input.clientUploadId, "upload.clientUploadId"));
    form.set("expectedAssignmentId", id(input.expectedAssignmentId, "upload.expectedAssignmentId"));
    return request("/conversations/attachments", (value): SupportAttachment => {
      const row = object(value, "attachment");
      return { id: opaqueId(row.id, "attachment.id"), customerId: id(row.customerId, "attachment.customerId"), mime: enumValue(row.mime, ["image/jpeg", "image/png"] as const, "attachment.mime"), bytes: positive(row.bytes, "attachment.bytes"), width: positive(row.width, "attachment.width"), height: positive(row.height, "attachment.height"), state: enumValue(row.state, ["READY"] as const, "attachment.state"), expiresAt: timestamp(row.expiresAt, "attachment.expiresAt") };
    }, { method: "POST", body: form, headers: keyHeader(idempotencyKey), signal });
  },
  attachmentContentUrl: (attachmentId: string) => `${BASE}${attachmentPath(attachmentId)}/content`,
  attachmentContent: async (attachmentId: string, signal?: AbortSignal, range?: string): Promise<Blob> => {
    const headers = new Headers();
    if (range) headers.set("Range", range);
    const response = await guardedFetch(`${BASE}${attachmentPath(attachmentId)}/content`, { headers, credentials: "same-origin", cache: "no-store", signal });
    if (!response.ok) {
      const text = await response.text();
      try { parseMContentApiEnvelope(response.status, text, true); }
      catch (error) { if (error instanceof MContentReadError) throw new SupportClientError(error.status, error.apiCode, error.backendMessage); throw error; }
      throw new SupportClientError(response.status, undefined, undefined);
    }
    if (!["image/jpeg", "image/png"].includes((response.headers.get("Content-Type") || "").split(";")[0].toLowerCase())) malformed("attachment.contentType");
    return response.blob();
  },
  cancelAttachment: (attachmentId: string, idempotencyKey: string, signal?: AbortSignal) =>
    request(attachmentPath(attachmentId), () => undefined, { method: "DELETE", headers: keyHeader(idempotencyKey), signal }),
  sendConversationReply: (conversationNo: string, input: SupportMessageInput, idempotencyKey: string, signal?: AbortSignal) =>
    request(`/conversations/${encodeURIComponent(nonempty(conversationNo, "conversationNo"))}/replies`, messageResult, json("POST", { body: input.content ?? "", kind: input.kind, attachmentId: input.attachmentId, intent: input.intent, clientMessageId: input.clientMessageId, expectedAssignmentId: wireId(input.expectedAssignmentId, "conversation.expectedAssignmentId"), expectedStatus: "OPEN", expectedVersion: count(input.expectedVersion, "conversation.expectedVersion"), replyTargets: input.replyTargets?.map((target) => ({ ...target, throughMessageId: positive(target.throughMessageId, "conversation.throughMessageId") })), reason: "专属客服回复客户消息" }, idempotencyKey, signal)),
  createConversation: (input: SupportMessageInput & { customerId: string }, idempotencyKey: string, signal?: AbortSignal) =>
    request("/conversations", messageResult, json("POST", { conversationType: "ADVISOR", userId: wireId(input.customerId, "conversation.customerId"), openingText: input.content ?? "", kind: input.kind, attachmentId: input.attachmentId, intent: input.intent, clientMessageId: input.clientMessageId, expectedAssignmentId: wireId(input.expectedAssignmentId, "conversation.expectedAssignmentId"), replyTargets: input.replyTargets?.map((target) => ({ ...target, throughMessageId: positive(target.throughMessageId, "conversation.throughMessageId") })) }, idempotencyKey, signal)),
  startConversation: (input: SupportStartConversationInput, idempotencyKey: string, signal?: AbortSignal) =>
    request("/conversations", messageResult, json("POST", { conversationType: "ADVISOR", userId: wireId(input.customerId, "conversation.customerId"), openingText: input.openingText, kind: "TEXT", intent: input.intent, clientMessageId: input.clientMessageId, expectedAssignmentId: wireId(input.expectedAssignmentId, "conversation.expectedAssignmentId"), replyTargets: input.replyTargets?.map((target) => ({ ...target, throughMessageId: positive(target.throughMessageId, "conversation.throughMessageId") })) }, idempotencyKey, signal)),
};

function messageResult(value: unknown): SupportMessageResult {
  const row = object(value, "messageResult");
  return { conversationNo: nonempty(row.conversationNo, "messageResult.conversationNo") };
}
