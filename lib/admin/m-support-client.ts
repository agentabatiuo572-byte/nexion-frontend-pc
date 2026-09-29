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
export type SupportPage<T> = { records: T[]; total: number; pageNum: number; pageSize: number };
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
  evaluatedAt: string;
  rulesVersion: number;
  scope: string;
  counts: SupportCounts;
  knownActiveCount: number;
  unknownWindowCount: number;
  activityWindowDays?: number | null;
  performance?: { executionCount: number; successfulCycleCount: number; successfulCustomerCount: number; from: string; to: string; trend?: Array<{ day: string; executionCount: number; successfulCycleCount: number }> };
};
export type SupportCustomer = {
  customerId: string;
  assignmentId: string | null;
  agentAdminId: number | null;
  version: number;
  customerNo?: string;
  displayName?: string;
  accountState: "ACTIVE" | "DORMANT" | "UNKNOWN";
  maintenanceEnabled: boolean;
  maintenanceStatus: string;
  lastEffectiveAt: string | null;
  nextMaintenanceAt: string | null;
  waitingReply?: boolean;
  firstContact?: boolean;
};
export type SupportCustomerDetail = SupportCustomer & { agentAdminId: number; maintenanceEnabled: boolean; maintenanceVersion: number };
export type SupportMaintenanceRecord = { id: string; kind: string; occurredAt: string; state?: string };
export type SupportMaintenanceHistory = SupportPage<SupportMaintenanceRecord>;
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
export type SupportMessageResult = { conversationNo: string; messageId: string; clientMessageId: string; assignmentId: string };
export type SupportCommandResult = { status: "PENDING" | "SUCCEEDED" | "FAILED"; result?: unknown };
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
  return {
    customerId: id(row.customerId, "customer.customerId"),
    assignmentId: row.assignmentId === null ? null : id(row.assignmentId, "customer.assignmentId"),
    agentAdminId: row.agentAdminId === null ? null : positive(row.agentAdminId, "customer.agentAdminId"),
    version: count(row.version, "customer.version"),
    customerNo: optionalString(row.customerNo, "customer.customerNo"),
    displayName: optionalString(row.displayName, "customer.displayName"),
    accountState: enumValue(row.accountState, ["ACTIVE", "DORMANT", "UNKNOWN"] as const, "customer.accountState"),
    maintenanceEnabled: bool(row.maintenanceEnabled, "customer.maintenanceEnabled"),
    maintenanceStatus: nonempty(row.maintenanceStatus, "customer.maintenanceStatus"),
    lastEffectiveAt: row.lastEffectiveAt === null ? null : timestamp(row.lastEffectiveAt, "customer.lastEffectiveAt"),
    nextMaintenanceAt: row.nextMaintenanceAt === null ? null : timestamp(row.nextMaintenanceAt, "customer.nextMaintenanceAt"),
    waitingReply: optionalBool(row.waitingReply, "customer.waitingReply"),
    firstContact: optionalBool(row.firstContact, "customer.firstContact"),
  };
}
function detail(value: unknown): SupportCustomerDetail {
  const row = object(value, "detail");
  return { ...customer(row), agentAdminId: positive(row.agentAdminId, "detail.agentAdminId"), maintenanceEnabled: bool(row.maintenanceEnabled, "detail.maintenanceEnabled"), maintenanceVersion: count(row.maintenanceVersion, "detail.maintenanceVersion") };
}
function overview(value: unknown): SupportOverview {
  const row = object(value, "overview");
  const rawCounts = object(row.counts ?? row.overview, "overview.counts");
  const keys = ["boundCustomers", "windowActiveCustomers", "dormantCustomers", "dueMaintenanceCustomers", "waitingReplyCustomers", "firstContactCustomers"] as const;
  const counts = Object.fromEntries(keys.map((key) => [key, nullableCount(rawCounts[key], `overview.counts.${key}`)])) as SupportCounts;
  if (rawCounts.stoppedMaintenanceCustomers !== undefined) counts.stoppedMaintenanceCustomers = nullableCount(rawCounts.stoppedMaintenanceCustomers, "overview.counts.stoppedMaintenanceCustomers");
  const result: SupportOverview = {
    evaluatedAt: timestamp(row.evaluatedAt, "overview.evaluatedAt"),
    rulesVersion: count(row.rulesVersion, "overview.rulesVersion"),
    scope: nonempty(row.scope, "overview.scope"), counts,
    knownActiveCount: count(row.knownActiveCount, "overview.knownActiveCount"),
    unknownWindowCount: count(row.unknownWindowCount, "overview.unknownWindowCount"),
    activityWindowDays: row.activityWindowDays === undefined ? undefined : nullablePositive(row.activityWindowDays, "overview.activityWindowDays"),
  };
  if (result.unknownWindowCount > 0 && result.counts.windowActiveCustomers !== null) malformed("overview.windowActiveCustomers");
  if (row.performance !== undefined) {
    const performance = object(row.performance, "overview.performance");
    result.performance = {
      executionCount: count(performance.executionCount, "overview.performance.executionCount"),
      successfulCycleCount: count(performance.successfulCycleCount, "overview.performance.successfulCycleCount"),
      successfulCustomerCount: count(performance.successfulCustomerCount, "overview.performance.successfulCustomerCount"),
      from: timestamp(performance.from, "overview.performance.from"),
      to: timestamp(performance.to, "overview.performance.to"),
      trend: performance.trend === undefined ? undefined : Array.isArray(performance.trend) ? performance.trend.map((entry) => { const point = object(entry, "overview.performance.trend"); const day = nonempty(point.day, "overview.performance.trend.day"); if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(parseBusinessTime(`${day}T00:00:00`))) malformed("overview.performance.trend.day"); return { day, executionCount: count(point.executionCount, "overview.performance.trend.executionCount"), successfulCycleCount: count(point.successfulCycleCount, "overview.performance.trend.successfulCycleCount") }; }) : malformed("overview.performance.trend"),
    };
  }
  return result;
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
  overview: (options: { from?: string; to?: string; signal?: AbortSignal } = {}) =>
    request(`/support-workbench/overview${query({ from: options.from, to: options.to })}`, overview, { signal: options.signal }),
  customers: (options: { pageNum: number; pageSize: number; keyword?: string; filter?: SupportCustomerFilter; signal?: AbortSignal }) =>
    request(`/support-workbench/customers${query({ pageNum: positive(options.pageNum, "pageNum"), pageSize: positive(options.pageSize, "pageSize"), keyword: options.keyword, filter: options.filter })}`, (value) => page(value, customer), { signal: options.signal }),
  customerDetail: (customerId: string, signal?: AbortSignal) => request(customerPath(customerId), detail, { signal }),
  maintenanceHistory: (customerId: string, options: { pageNum: number; pageSize: number; signal?: AbortSignal }) =>
    request(`${customerPath(customerId)}/maintenance${query({ pageNum: positive(options.pageNum, "pageNum"), pageSize: positive(options.pageSize, "pageSize") })}`, (value): SupportMaintenanceHistory => page(value, (entry) => {
      const row = object(entry, "maintenance.record");
      return { id: id(row.id, "maintenance.id"), kind: nonempty(row.kind, "maintenance.kind"), occurredAt: timestamp(row.occurredAt, "maintenance.occurredAt"), state: optionalString(row.state, "maintenance.state") };
    }), { signal: options.signal }),
  setMaintenance: (customerId: string, input: { enabled: boolean; reason: string; expectedVersion: number; expectedAssignmentId: string }, idempotencyKey: string, signal?: AbortSignal) =>
    request(`${customerPath(customerId)}/maintenance`, detail, json("PATCH", { ...input, expectedVersion: positive(input.expectedVersion, "maintenance.expectedVersion"), expectedAssignmentId: wireId(input.expectedAssignmentId, "maintenance.expectedAssignmentId") }, idempotencyKey, signal)),
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
    return { status: enumValue(row.status, ["PENDING", "SUCCEEDED", "FAILED"] as const, "command.status"), result: row.result };
  }, { signal }),
  uploadAttachment: (input: { file: File; customerId: string; clientUploadId: string; expectedAssignmentId: string }, idempotencyKey: string, signal?: AbortSignal) => {
    const form = new FormData();
    form.set("file", input.file);
    form.set("customerId", id(input.customerId, "upload.customerId"));
    form.set("clientUploadId", nonempty(input.clientUploadId, "upload.clientUploadId"));
    form.set("expectedAssignmentId", id(input.expectedAssignmentId, "upload.expectedAssignmentId"));
    return request("/conversations/attachments", (value): SupportAttachment => {
      const row = object(value, "attachment");
      return { id: opaqueId(row.id, "attachment.id"), customerId: id(row.customerId, "attachment.customerId"), mime: enumValue(row.mime, ["image/jpeg", "image/png", "image/webp"] as const, "attachment.mime"), bytes: positive(row.bytes, "attachment.bytes"), width: positive(row.width, "attachment.width"), height: positive(row.height, "attachment.height"), state: enumValue(row.state, ["READY"] as const, "attachment.state"), expiresAt: timestamp(row.expiresAt, "attachment.expiresAt") };
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
    if (!["image/jpeg", "image/png", "image/webp"].includes((response.headers.get("Content-Type") || "").split(";")[0].toLowerCase())) malformed("attachment.contentType");
    return response.blob();
  },
  cancelAttachment: (attachmentId: string, idempotencyKey: string, signal?: AbortSignal) =>
    request(attachmentPath(attachmentId), () => undefined, { method: "DELETE", headers: keyHeader(idempotencyKey), signal }),
  sendConversationReply: (conversationNo: string, input: SupportMessageInput, idempotencyKey: string, signal?: AbortSignal) =>
    request(`/conversations/${encodeURIComponent(nonempty(conversationNo, "conversationNo"))}/replies`, messageResult, json("POST", wireMessageInput(input), idempotencyKey, signal)),
  createConversation: (input: SupportMessageInput & { customerId: string }, idempotencyKey: string, signal?: AbortSignal) =>
    request("/conversations", messageResult, json("POST", { ...wireMessageInput(input), customerId: wireId(input.customerId, "conversation.customerId") }, idempotencyKey, signal)),
  startConversation: (input: SupportStartConversationInput, idempotencyKey: string, signal?: AbortSignal) =>
    request("/conversations", messageResult, json("POST", { customerId: wireId(input.customerId, "conversation.customerId"), content: input.openingText, kind: "TEXT", intent: input.intent, clientMessageId: input.clientMessageId, expectedAssignmentId: wireId(input.expectedAssignmentId, "conversation.expectedAssignmentId"), expectedVersion: positive(input.expectedVersion, "conversation.expectedVersion"), replyTargets: input.replyTargets?.map((target) => ({ ...target, throughMessageId: positive(target.throughMessageId, "conversation.throughMessageId") })) }, idempotencyKey, signal)),
};

function wireMessageInput(input: SupportMessageInput): Omit<SupportMessageInput, "expectedAssignmentId"> & { expectedAssignmentId: number } {
  return { ...input, expectedAssignmentId: wireId(input.expectedAssignmentId, "conversation.expectedAssignmentId"), expectedVersion: positive(input.expectedVersion, "conversation.expectedVersion"), replyTargets: input.replyTargets?.map((target) => ({ ...target, throughMessageId: positive(target.throughMessageId, "conversation.throughMessageId") })) };
}

function messageResult(value: unknown): SupportMessageResult {
  const row = object(value, "messageResult");
  return { conversationNo: nonempty(row.conversationNo, "messageResult.conversationNo"), messageId: id(row.messageId, "messageResult.messageId"), clientMessageId: nonempty(row.clientMessageId, "messageResult.clientMessageId"), assignmentId: id(row.assignmentId, "messageResult.assignmentId") };
}
