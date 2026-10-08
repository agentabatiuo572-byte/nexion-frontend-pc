import { supportRequest, supportObject as obj, parseSupportId as id, parseSupportCount as count, parseSupportPage as page, supportJson as json, supportQuery as query, parseSupportTime as time, supportWireId } from "./m-support-client.ts";
export type SupportGroup = { status: "READY" | "UNKNOWN" | "FORBIDDEN" | "ERROR"; data: Record<string, unknown> | null; evaluatedAt: string };
export type SupportProfile = Record<"identity" | "finance" | "devices" | "risk" | "annotations" | "service", SupportGroup> & { actions: Record<string, { allowed: boolean }> };
export type SupportKind = "TEXT" | "IMAGE" | "SKU" | "LINK";
export type SupportLink = { type: "HOME" | "WALLET" | "SUPPORT"; params: Record<string, never> };
export type BulkFilters = { accountState?: string; maintenanceState?: string; level?: string; tagIds?: string[]; registeredFrom?: string; registeredTo?: string; activityFrom?: string; activityTo?: string; depositMin?: string; depositMax?: string; withdrawalMin?: string; withdrawalMax?: string; currency?: string; includeUnknown?: boolean; keyword?: string };
export type BulkPreview = { selectionId: string; actorId: number; customers: Array<{ id: string; expectedAssignmentId: string }>; excluded: Array<{ id: string; reason: string }>; count: number; evaluatedAt: string; expiresAt: string };
export type BulkContent = { selectionId: string; intent: "SERVICE" | "MAINTENANCE"; kind: SupportKind; content: string; skuId?: string; linkTarget?: SupportLink; assetId?: string; reason: string };
export type BulkJob = { batchId: string; actorId: number; state: string; version: number; counts: Record<"total" | "pending" | "sent" | "failed" | "skipped" | "cancelled" | "unknown", number>; frozenCount: number; visibleCount: number; contentRestricted: boolean; key: string; intent?: string; kind?: string; content?: string; skuId?: string; assetId?: string };
export type BulkRecipient = { customerId: string; state: "PENDING" | "SENT" | "FAILED" | "SKIPPED" | "CANCELLED"; resultCertainty: "KNOWN" | "UNKNOWN"; retryable: boolean; conversationNo?: string; failureCode?: string };
export type RandomPreview = { id: string; count: number; rulesVersion: number; expiresAt: string; customers: Array<{ id: string; poolVersion: number }>; excluded: Array<{ customerId: string; reason: string }> };
export type RandomResult = { operationId: string; customers: Array<{ customerId: string; status: string; agentAdminId: number | null }> };
export type PrivateMessageRecovery = { readOnlyRecovery: true; key: string; clientMessageId: string; customerId?: string; conversationId?: string };
export function privateMessageRecovery(value: unknown): PrivateMessageRecovery | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>, message = row.message as Record<string, unknown> | undefined;
  const clientMessageId = row.clientMessageId ?? message?.clientMessageId;
  if (typeof row.key !== "string" || !row.key || typeof clientMessageId !== "string" || !clientMessageId) return null;
  return { readOnlyRecovery: true, key: row.key, clientMessageId, ...(typeof row.customerId === "string" ? { customerId: row.customerId } : {}), ...(typeof row.conversationId === "string" ? { conversationId: row.conversationId } : {}) };
}
export function legacySupportDestination(content: string): string | undefined {
  const path=/(?:^|\s)(\/store|\/staking|\/genesis)\s*$/.exec(content)?.[1];
  return path ? {"/store":"/devices/pricing","/staking":"/finance-products/staking","/genesis":"/finance-products/genesis"}[path] : undefined;
}
function text(v: unknown): string { if (typeof v !== "string" || !v.trim()) throw new Error("SUPPORT_ENHANCEMENT_STRING_INVALID"); return v; }
function enumOf<T extends string>(v: unknown, values: readonly T[]): T { if (!values.includes(v as T)) throw new Error("SUPPORT_ENHANCEMENT_ENUM_INVALID"); return v as T; }
function rows(v: unknown): unknown[] { if (!Array.isArray(v)) throw new Error("SUPPORT_ENHANCEMENT_LIST_INVALID"); return v; }
function bool(v: unknown): boolean { if (typeof v !== "boolean") throw new Error("SUPPORT_ENHANCEMENT_BOOLEAN_INVALID"); return v; }
export function parseSupportGroup(v: unknown): SupportGroup {
  const r = obj(v, "group"); const status = enumOf(r.status, ["READY", "UNKNOWN", "FORBIDDEN", "ERROR"] as const);
  return { status, data: status === "READY" ? obj(r.data, "group.data") : null, evaluatedAt: time(r.evaluatedAt, "group.evaluatedAt") };
}
export function parseSupportProfile(v: unknown): SupportProfile {
  const r = obj(obj(v, "detail").profile, "profile");
  const groups = Object.fromEntries(["identity", "finance", "devices", "risk", "annotations", "service"].map(k => [k, parseSupportGroup(r[k])])) as Omit<SupportProfile, "actions">;
  const actions = Object.fromEntries(Object.entries(obj(r.actions, "actions")).map(([k, v]) => [k, { allowed: bool(obj(v, "action").allowed) }]));
  if (groups.finance.data) for (const value of rows(groups.finance.data.byCurrency)) {
    const currency = obj(value, "currency"); text(currency.currency); const statuses = obj(currency.fieldStatuses, "fieldStatuses");
    for (const field of ["creditedDepositTotal", "depositRefundTotal", "successfulWithdrawalPrincipalTotal", "successfulWithdrawalFeeTotal", "successfulWithdrawalNetTotal", "processingWithdrawalPrincipalTotal", "balance", "availableBalance"]) {
      const status = statuses[field];
      enumOf(status, ["READY", "UNKNOWN", "FORBIDDEN", "ERROR"] as const);
      if (status === "READY" && (typeof currency[field] !== "string" || !/^-?\d+(\.\d+)?$/.test(currency[field] as string))) throw new Error("SUPPORT_DECIMAL_INVALID");
      if (status !== "READY") currency[field] = null;
    }
  }
  return { ...groups, actions };
}
export function parseBulkPreview(v: unknown): BulkPreview {
  const r = obj(v, "bulk.preview");
  const customers = rows(r.customers).map(v => { const c = obj(v, "customer"); return { id: id(c.id, "customer.id"), expectedAssignmentId: id(c.expectedAssignmentId, "assignment") }; });
  const total = count(r.count, "count");
  if (total !== customers.length || new Set(customers.map(c => c.id)).size !== total) throw new Error("SUPPORT_SELECTION_COUNT_INVALID");
  return { selectionId: text(r.selectionId), actorId: supportWireId(r.actorId, "actor"), customers, excluded: rows(r.excluded).map(v => { const e = obj(v, "excluded"); return { id: id(e.id, "excluded.id"), reason: text(e.reason) }; }), count: total, evaluatedAt: time(r.evaluatedAt, "evaluatedAt"), expiresAt: time(r.expiresAt, "expiresAt") };
}
export function parseRandomPreview(v: unknown): RandomPreview {
  const r = obj(v, "random.preview"), selected = rows(r.customers).map(v => { const c = obj(v, "customer"); return { id: id(c.id, "id"), poolVersion: count(c.poolVersion, "version") }; });
  const total = count(r.count, "count");
  if (total !== selected.length) throw new Error("SUPPORT_RANDOM_COUNT_INVALID");
  // This endpoint computes its LocalDateTime expiry in UTC, unlike the ordinary business clock.
  const rawExpiry = time(r.expiresAt, "expiresAt"), unzoned = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?)$/.exec(rawExpiry);
  const expiresAt = new Date(unzoned ? `${unzoned[1]}T${unzoned[2]}Z` : rawExpiry).toISOString();
  return { id: text(r.id), count: total, rulesVersion: count(r.rulesVersion, "version"), expiresAt, customers: selected, excluded: rows(r.excluded).map(v => { const e = obj(v, "excluded"); return { customerId: id(e.customerId, "id"), reason: text(e.reason) }; }) };
}
export function parseBulkJob(v: unknown): BulkJob {
  const r = obj(v, "bulk.job"); const raw = obj(r.counts, "counts");
  const counts = Object.fromEntries(["total", "pending", "sent", "failed", "skipped", "cancelled", "unknown"].map(k => [k, count(raw[k], k)])) as BulkJob["counts"];
  if (counts.total !== counts.pending + counts.sent + counts.failed + counts.skipped + counts.cancelled || counts.unknown > counts.pending) throw new Error("SUPPORT_BULK_COUNT_INVALID");
  const frozenCount = count(r.frozenCount, "frozenCount"), visibleCount = count(r.visibleCount, "visibleCount");
  if (frozenCount !== counts.total || visibleCount > frozenCount) throw new Error("SUPPORT_BULK_SCOPE_INVALID");
  const restricted = bool(r.contentRestricted);
  const state = enumOf(r.state, ["QUEUED", "RUNNING", "COMPLETED", "CANCELLED"] as const);
  if (["COMPLETED", "CANCELLED"].includes(state) && counts.pending) throw new Error("SUPPORT_BULK_STATE_INVALID");
  return { batchId: text(r.batchId), actorId: supportWireId(r.actorId, "actor"), version: count(r.version, "version"), state, counts, frozenCount, visibleCount, contentRestricted: restricted, key: text(r.key), ...(!restricted ? { content: typeof r.content === "string" ? r.content : undefined, intent: enumOf(r.intent, ["SERVICE", "MAINTENANCE"] as const), kind: enumOf(r.kind, ["TEXT", "IMAGE", "SKU", "LINK"] as const), skuId: typeof r.skuId === "string" ? r.skuId : undefined, assetId: typeof r.assetId === "string" ? r.assetId : undefined } : {}) };
}
function parseRecipient(v: unknown): BulkRecipient { const r = obj(v, "recipient"); return { customerId: id(r.customerId, "customer"), state: enumOf(r.state, ["PENDING", "SENT", "FAILED", "SKIPPED", "CANCELLED"] as const), resultCertainty: enumOf(r.resultCertainty, ["KNOWN", "UNKNOWN"] as const), retryable: bool(r.retryable), conversationNo: typeof r.conversationNo === "string" ? r.conversationNo : undefined, failureCode: typeof r.failureCode === "string" ? r.failureCode : undefined }; }
export function parseRandomResult(v: unknown): RandomResult { const r = obj(v, "random"); return { operationId: text(r.operationId), customers: rows(r.customers).map(v => { const c = obj(v, "customer"); return { customerId: id(c.customerId, "id"), status: enumOf(c.status, ["ASSIGNED", "NO_CANDIDATE", "CONFLICT", "SKIPPED"] as const), agentAdminId: c.agentAdminId == null ? null : supportWireId(c.agentAdminId, "agent") }; }) }; }
const bulk = "/support-workbench/bulk";
const customer = (customerId: string) => `/support-workbench/customers/${id(customerId, "customer")}`;
export const supportEnhancements = {
  profile: (customerId: string, signal?: AbortSignal) => supportRequest(`${customer(customerId)}/360`, parseSupportProfile, { signal }),
  devices: (customerId: string, pageNum: number, signal?: AbortSignal) => supportRequest(`${customer(customerId)}/devices${query({ pageNum, pageSize: 10 })}`, parseSupportGroup, { signal }),
  flows: (customerId: string, filters: { pageNum: number; currency?: string; status?: string; from?: string; to?: string }, signal?: AbortSignal) => supportRequest(`${customer(customerId)}/flows${query({ ...filters, pageSize: 10 })}`, parseSupportGroup, { signal }),
  skus: (pageNum: number, keyword: string, signal?: AbortSignal) => supportRequest(`/support-workbench/skus${query({ pageNum, pageSize: 10, keyword })}`, v => page(v, v => { const r = obj(v, "sku"); return { id: text(r.skuId ?? r.id), name: text(r.name) }; }), { signal }),
  bulkPreview: (input: { filters: BulkFilters; customerIds: string[]; excludedIds: string[]; selectionMode: string }, signal?: AbortSignal) => supportRequest(`${bulk}/preview`, parseBulkPreview, { method: "POST", body: JSON.stringify({ ...input, customerIds: input.customerIds.map(v => supportWireId(v, "customer")), excludedIds: input.excludedIds.map(v => supportWireId(v, "excluded")) }), signal }),
  bulkCreate: (input: BulkContent, key: string) => supportRequest(bulk, parseBulkJob, json("POST", input, key)),
  bulkJobs: (pageNum: number, signal?: AbortSignal) => supportRequest(`${bulk}${query({ pageNum, pageSize: 10 })}`, v => page(v, parseBulkJob), { signal }),
  bulkJob: (batchId: string, signal?: AbortSignal) => supportRequest(`${bulk}/${encodeURIComponent(batchId)}`, parseBulkJob, { signal }),
  bulkRecipients: (batchId: string, pageNum: number, signal?: AbortSignal) => supportRequest(`${bulk}/${encodeURIComponent(batchId)}/recipients${query({ pageNum, pageSize: 10 })}`, v => page(v, parseRecipient), { signal }),
  bulkMutate: (batchId: string, action: "cancel" | "retry", input: { expectedVersion: number; reason: string }, key: string) => supportRequest(`${bulk}/${encodeURIComponent(batchId)}/${action}`, parseBulkJob, json("POST", { ...input, expectedVersion: count(input.expectedVersion, "version") }, key)),
  bulkUpload: (file: File, clientUploadId: string, key: string, signal?: AbortSignal) => { const body = new FormData(); body.set("file", file); body.set("clientUploadId", clientUploadId); return supportRequest(`${bulk}/attachments`, v => { const r = obj(v, "asset"); if (r.status !== "READY") throw new Error("SUPPORT_ASSET_NOT_READY"); return { assetId: text(r.assetId) }; }, { method: "POST", body, headers: { "Idempotency-Key": key }, signal }); },
  randomPreview: (customers: Array<{ id: string; poolVersion: number }>, reason?: string) => supportRequest("/support-agents/assignments/random-preview", parseRandomPreview, { method: "POST", body: JSON.stringify({ customers: customers.map(c => ({ id: supportWireId(c.id, "id"), poolVersion: count(c.poolVersion, "poolVersion") })), reason }) }),
  randomConfirm: (input: { previewId: string; expectedRulesVersion: number; reason: string }, key: string) => supportRequest("/support-agents/assignments/random", parseRandomResult, json("POST", input, key)),
};
