"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { guardedFetch } from "@/lib/admin/error-messages";
import { businessStamp } from "@/lib/admin/business-time";
import { isSupportSessionExpired, parseSupportApiEnvelope, readSupportResponseText, SupportClientError, supportRequest } from "@/lib/admin/m-support-client";
import { MContentReadError } from "@/lib/admin/m-support-read-contract";
import { isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { createPendingMutationStore, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { performanceEnum as enumeration, performanceInstant as instant, performanceInteger as integer, performanceList as array, performanceMalformed as invalid, performanceObject as object, performanceText as text, performanceWindow, samePerformanceWindow } from "@/lib/admin/support-performance-contract";
import { PERFORMANCE_EXPORT_SUMMARY as SUMMARY, PERFORMANCE_EXPORT_DETAIL as DETAIL, PERFORMANCE_EXPORT_APPROVE as APPROVE } from "@/lib/admin/support-performance-contract";
import { normalizeSessionRole } from "@/lib/admin/session-role";
import { ROLE_LABEL, roleLabel } from "@/lib/nav/console-nav";
import { EXPORT_TYPES, ExportOutcomeUnknownError, type DecisionLookup, type ExportCheck, type ExportColumns, type ExportDownload, type ExportDraft, type ExportConditionDifference, type ExportSelection, type ExportVisibleReceipt, type ExportOriginal, type ExportPersona, type ExportQuery, type ExportSubmitted, type ExportTask, type ExportType, type PendingDecision, type PerfExportPorts, type SubmitLookup } from "./perf-view";

const PATH = "/support-workbench/performance-exports";
const TYPES = { SUMMARY, CUSTOMER_DETAIL: DETAIL, TRANSACTION_DETAIL: DETAIL } as const;
const GRAIN = { SUMMARY: "一位客服在一个组一个月一行", CUSTOMER_DETAIL: "一位客户在一位客服名下一个月一行", TRANSACTION_DETAIL: "一笔入金、提现或参考交易一行" };
const namePending = (adminId: string) => `账号 ${adminId}（姓名待补）`;
const optionalName = (value: unknown) => typeof value === "string" ? value.trim() : "";

function requesterRoleLabel(value: unknown) {
  const raw = optionalName(value);
  if (!raw) return "";
  const alias = { 超管: "superadmin", 配置管理员: "config", 内容: "content", 增长: "growth", super: "superadmin" } as Record<string, string>;
  const code = normalizeSessionRole(alias[raw] ?? raw);
  const label = roleLabel(code);
  if (label !== code || Object.values(ROLE_LABEL).includes(raw) || raw === "财务主管" || raw === "风控主管") return label;
  return "";
}
const COVERAGE_TEXT: Record<string, string> = { COMPLETE: "完整", PARTIAL: "部分数据还在核对", UNKNOWN: "暂时无法确认是否完整", FAILED: "核对没完成" };
const STALE_BLOCKED = "这一版数据更新延迟，暂时不能导出。关掉这个框，在页面上刷新到最新一版后再导出。";
const SCOPES = ["SELF", "MANAGED_GROUPS", "ALL"] as const;
const STATES = ["PENDING_GENERATION", "PENDING_APPROVAL", "APPROVED", "REJECTED", "WITHDRAWN", "READY", "FAILED", "EXPIRED"] as const;
const ACTIONS = ["APPROVE", "REJECT", "WITHDRAW"] as const;
type Action = typeof ACTIONS[number];
type View = ExportPersona["views"][number];
type Operator = { id: string; epoch: number; name: string; authorities: readonly string[] };
type Selection = ExportSelection;
type Scope = Selection["scope"];
type SubmitBody = Selection & { previewVersion: string; reason: string };
type DecisionBody = { expectedVersion: number; reason: string; decision?: Exclude<Action, "WITHDRAW"> };
type SavedExport = PendingMutationRecord & ({ action: "SUBMIT"; body: SubmitBody; selection: ExportQuery; acceptedRequestId?: string }
  | { action: Action; taskId: string; body: DecisionBody });
const store = createPendingMutationStore<SavedExport>({
  storageKey: "nexion-support-performance-commands",
  retainExpiredRecords: true,
  isValidRecord: record => typeof record.body?.reason === "string" && (record.action === "SUBMIT"
    ? typeof record.body.previewVersion === "string" && typeof record.selection?.month === "string" && Array.isArray(record.selection.types)
    : ACTIONS.includes(record.action) && /^[1-9]\d*$/.test(record.taskId) && Number.isSafeInteger(record.body.expectedVersion)),
});
const pendingListeners = new Set<() => void>();
const notifyPending = () => pendingListeners.forEach(update => update());

let recovered: { owner: string; submit?: ExportDraft; decisions: Map<string, string> } | undefined;
const decisionDraftKey = (taskId: string, action: Action) => `${taskId}:${action}`;
function draftsFor(operator: Operator) {
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || auth.logoutUnknown
    || String(auth.session?.adminId) !== operator.id || auth.authEpoch !== operator.epoch) return undefined;
  const owner = `${operator.id}:${operator.epoch}`;
  if (recovered?.owner !== owner) recovered = { owner, decisions: new Map() };
  return recovered;
}

export function useExportClock(records: readonly (ExportOriginal | undefined)[]) {
  const [, tick] = useState(0);
  const now = Date.now();
  const deadline = Math.min(...records.flatMap(record => record && record.expiresAt > now ? [record.expiresAt] : []));
  useEffect(() => {
    if (!Number.isFinite(deadline)) return;
    const timer = setTimeout(() => tick(value => value + 1), Math.max(1, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [deadline]);
  return now;
}

const scopeLabels = { SELF: "本人", MANAGED_GROUPS: "负责组", ALL: "全部范围" };
const bool = (value: unknown) => typeof value === "boolean" ? value : invalid("export.boolean");
const nullableText = (value: unknown) => value === null ? null : text(value);
const nullableNumber = (value: unknown) => value === null ? null : integer(value);
const id = (value: unknown) => {
  const key = typeof value === "number" ? String(integer(value)) : text(value);
  return /^[1-9]\d*$/.test(key) ? key : invalid("export.id");
};
const read = <T>(path: string, parse: (value: unknown) => T, signal?: AbortSignal) => supportRequest(`${PATH}${path}`, parse, { signal });
const post = <T>(path: string, body: object | undefined, parse: (value: unknown) => T, key?: string) => supportRequest(`${PATH}${path}`, parse, {
  method: "POST", body: body === undefined ? undefined : JSON.stringify(body), preserveUnknownOutcome: key !== undefined,
  headers: key === undefined ? undefined : { "Idempotency-Key": key },
});
const receipt = (path: string, key: string) => supportRequest(`${PATH}${path}`, object, { headers: { "Idempotency-Key": key } });

function columns(value: unknown, type: ExportType): ExportColumns {
  const labels = value == null ? [] : array(value, text);
  if (labels.some(label => !label)) invalid("export.columns");
  return { total: labels.length, summary: labels.join("、"), groups: labels.length ? [{ name: GRAIN[type], columns: labels }] : [] };
}

function scopeTitle(value: unknown) {
  const row = object(value);
  const kind = enumeration(row.kind, SCOPES);
  const names = array(row.names, text);
  return names.length ? names.join("、") : scopeLabels[kind];
}

function parseOptions(value: unknown) {
  const root = object(value);
  const months = array(root.months, value => {
    const month = object(value);
    const key = text(month.month);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) invalid("export.month");
    enumeration(month.availability, ["READY", "PARTIAL", "UNKNOWN"]);
    const from = instant(month.from), to = instant(month.to);
    if (Date.parse(from) >= Date.parse(to)) invalid("export.monthWindow");
    return { value: key, label: key, from };
  });
  const scopes = array(root.scopes, value => {
    const row = object(value);
    return {
      kind: enumeration(row.kind, SCOPES), allowed: array(row.allowedTypes, value => enumeration(value, EXPORT_TYPES)),
      blocked: nullableText(row.blockedReason), groups: array(row.groups, value => {
        const group = object(value);
        return { id: id(group.id), name: text(group.name) };
      }),
    };
  });
  return { months, scopes, minReasonChars: integer(root.minReasonChars), maxReasonChars: integer(root.maxReasonChars) };
}
type Options = ReturnType<typeof parseOptions>;

function parsePreview(value: unknown) {
  const row = object(value);
  const window = row.window === null ? null : performanceWindow(row.window);
  const items = array(row.items, value => {
    const item = object(value);
    const type = enumeration(item.type, EXPORT_TYPES);
    if (bool(item.requiresApproval) !== (type !== "SUMMARY")) invalid("export.approval");
    const rows = nullableNumber(item.availableRows), limit = integer(item.limit);
    const reasons = array(item.reasonCodes, text);
    const coverage = item.coverage === null ? null : enumeration(object(item.coverage).status, ["COMPLETE", "PARTIAL", "UNKNOWN", "FAILED"]);
    const status = enumeration(item.status, ["AVAILABLE", "EMPTY", "LIMIT_EXCEEDED", "READ_FAILED", "UNAVAILABLE"]);
    const stale = reasons.includes("EXPORT_REFRESH_FAILED") || reasons.includes("EXPORT_DATA_STALE");
    let check: ExportCheck;
    // 这一版不可用（刷新没成功、更新延迟）、没核完、升级中各写各的原因；只有真读取失败才给重试。
    if (stale) check = { state: "stale", rows };
    else if (status === "AVAILABLE") check = { state: "ok", rows, note: coverage === "PARTIAL" ? "部分数据还在核对" : undefined };
    else if (status === "EMPTY") check = { state: "empty", text: "这个月还没有记录。" };
    else if (status === "LIMIT_EXCEEDED") {
      if (rows === null) return invalid("export.limitRows");
      check = rows > limit ? { state: "over", limitKind: "rows", rows, text: `共 ${rows.toLocaleString("en-US")} 行，行数超过上限。` }
        : { state: "over", limitKind: "file", rows, text: "文件超过本次导出大小限制。" };
    }
    else if (status === "READ_FAILED") check = { state: "failed", text: "没加载出来。" };
    else check = { state: "unavailable", text: reasons.includes("EXPORT_GENERATION_UPGRADING") ? "数据正在升级，这一项暂时不能导出。"
      : reasons.includes("EXPORT_ROWS_UNVERIFIED") ? "新的一版还没核完，行数要等核完才知道。" : "这一项的数据暂时无法确认，暂时不能导出。" };
    // 看不到明细的记录（归属不明、或现在不在你能看的客户里）合成一行匿名小计；只用来写说明。
    const anonymous = typeof item.restrictedHistoryRows === "number" && item.restrictedHistoryRows > 0;
    return { type, grain: GRAIN[type], limit, columns: columns(item.columns, type), check, reasons, anonymous };
  });
  if (new Set(items.map(item => item.type)).size !== items.length) invalid("export.previewItems");
  return { version: text(row.previewVersion), window, scope: object(row.scope), items };
}
type Preview = ReturnType<typeof parsePreview>;

function previewBlocked(preview: Preview | undefined) {
  if (!preview) return undefined;
  if (preview.items.some(item => item.reasons.includes("EXPORT_REFRESH_FAILED"))) return "这一版数据刷新没成功，暂时不能导出。关掉这个框，在页面上刷新成功后再导出。";
  if (!preview.window) return "数据正在升级，这一版暂时不能导出。升级完、页面刷新后再导出。";
  if (preview.items.some(item => item.reasons.includes("EXPORT_DATA_STALE"))) return STALE_BLOCKED;
}

function taskParser(operator: Operator) {
  return (value: unknown): ExportTask => {
    const row = object(value);
    const type = enumeration(row.type, EXPORT_TYPES);
    const status = enumeration(row.status, STATES);
    const requesterId = id(row.requesterId);
    const mine = requesterId === operator.id;
    const reasons = array(row.reasonCodes, text);
    const window = row.window === null ? null : performanceWindow(row.window);
    const capabilities = object(row.decisionCapabilities);
    const approve = object(capabilities.APPROVE), reject = object(capabilities.REJECT);
    const canApprove = bool(approve.available) && operator.authorities.includes(APPROVE) && !mine;
    const canReject = bool(reject.available) && operator.authorities.includes(APPROVE) && !mine;
    const reason = nullableText(approve.reasonCode);
    const approvalTime = row.approvedAt === null ? undefined : instant(row.approvedAt);
    const scopeLost = row.scope === null;
    const requesterName = scopeLost ? "" : optionalName(row.requesterName);
    const requesterRole = requesterName ? requesterRoleLabel(row.requesterRole) : "";
    const requester = requesterName ? [requesterName, requesterRole].filter(Boolean).join(" · ")
      : mine ? operator.name : namePending(requesterId);
    const reviewerId = row.reviewerId == null ? undefined : id(row.reviewerId);
    const reviewerName = scopeLost ? "" : optionalName(row.reviewerName);
    const decidedBy = reviewerName || (reviewerId ? reviewerId === operator.id ? operator.name : namePending(reviewerId) : undefined);
    const failure = status !== "FAILED" ? undefined
      : scopeLost ? "SCOPE_HIDDEN"
      : reasons.some(reason => reason === "EXPORT_SCOPE_CHANGED" || reason === "EXPORT_APPLICANT_INELIGIBLE") ? "SCOPE_LOST_BEFORE_GENERATE" : "GENERATE_FAILED";
    return {
      taskId: id(row.taskId), version: integer(row.version), type, mine,
      requester, hasRequesterName: !!requesterName,
      scope: row.scope === null ? null : scopeTitle(row.scope), month: window?.month ?? null, asOf: window?.asOf ?? null,
      rows: nullableNumber(row.rowCount), columns: columns(row.columns, type),
      coverage: row.coverage == null ? null : COVERAGE_TEXT[String(object(row.coverage).status)] ?? null,
      requestReason: row.requestReason == null ? "" : text(row.requestReason), requestedAt: instant(row.requestedAt),
      state: status,
      decidedBy,
      decidedAt: approvalTime ? businessStamp(Date.parse(approvalTime)) : undefined,
      decisionReason: row.decisionReason == null ? undefined : text(row.decisionReason), failure,
      canDownload: bool(row.canDownload) && mine && operator.authorities.includes(TYPES[type]),
      canApprove, canReject, canWithdraw: bool(row.canWithdraw) && mine && operator.authorities.includes(DETAIL),
      approveBlocked: canApprove ? undefined : reason === "EXPORT_SCOPE_CHANGED" || reason === "EXPORT_APPLICANT_INELIGIBLE" ? "申请人已没有这个范围的导出权限" : "当前不能批准",
      scopeLost,
    };
  };
}

const uncheckedItems = (types: readonly ExportType[]) => types.map(type => ({
  type, grain: GRAIN[type], limit: 0, columns: columns(null, type), check: { state: "unchecked" as const },
}));
const fingerprint = (query: ExportQuery) => JSON.stringify([query.month, query.scope, [...query.types].sort()]);
const originalFields = (row: SavedExport) => ({ operationId: row.commandKey, createdAt: row.createdAt, expiresAt: row.expiresAt });
type SavedDecision = Extract<SavedExport, { taskId: string }>;
const decisionLane = (row: SavedDecision): View => row.action === "WITHDRAW" ? "MINE" : "APPROVALS";
const pendingDecision = (row: SavedDecision, visible: boolean): PendingDecision =>
  ({ ...originalFields(row), taskId: row.taskId, decision: row.action, objectHidden: !visible,
    reason: visible ? row.body.reason : undefined, at: businessStamp(row.createdAt) });
function restoredDraft(row: Extract<SavedExport, { action: "SUBMIT" }>): ExportDraft {
  const { month, scope, types, reason } = row.body;
  return { reason, query: row.selection, selection: { month, scope, types } };
}
const updateOriginal = (row: SavedExport) => { store.remember(row.fingerprint, row.commandKey, row); notifyPending(); };
const forget = (row: SavedExport) => { store.forget(row.fingerprint, row.commandKey); notifyPending(); };
const save = (slot: string, extra: Omit<Extract<SavedExport, { action: "SUBMIT" }>, keyof PendingMutationRecord> | Omit<Extract<SavedExport, { taskId: string }>, keyof PendingMutationRecord>) => {
  if (store.get(slot)) throw new ExportOutcomeUnknownError("请先查询原操作。");
  const key = crypto.randomUUID();
  store.remember(slot, key, extra);
  if (!store.isDurablyStored(slot, key)) {
    store.forget(slot, key);
    throw new Error("原操作无法保存，暂时不能提交。");
  }
  notifyPending();
  return key;
};

function apiStatus(error: SupportClientError | MContentReadError) {
  return error.status >= 200 && error.status < 300 ? error.apiCode : error.status;
}

export function isExportPermissionDenied(error: unknown) {
  if (isSupportSessionExpired(error)) return false;
  if (isPermissionDenied(error)) return true;
  if (!(error instanceof SupportClientError || error instanceof MContentReadError)) return false;
  const status = apiStatus(error);
  return status === 403
    && ["PERMISSION_DENIED", "ADMIN_PASSWORD_CHANGE_REQUIRED", "无权限访问"].includes(error.backendMessage ?? "");
}

export function exportDecisionConflict(error: unknown) {
  return error instanceof SupportClientError && apiStatus(error) === 409
    && ["EXPORT_TASK_VERSION_CHANGED", "EXPORT_INVALID_STATE", "EXPORT_APPLICANT_INELIGIBLE", "EXPORT_SCOPE_CHANGED"].includes(error.backendMessage ?? "");
}

export function exportTaskHidden(error: unknown) {
  if (!(error instanceof SupportClientError || error instanceof MContentReadError)) return false;
  const status = apiStatus(error);
  return status === 404 && error.backendMessage === "EXPORT_TASK_NOT_FOUND"
    || status === 403 && ["EXPORT_TASK_NOT_FOUND", "EXPORT_SCOPE_CHANGED", "EXPORT_APPLICANT_INELIGIBLE"].includes(error.backendMessage ?? "");
}

export function exportPreviewChanged(error: unknown) {
  return error instanceof SupportClientError && apiStatus(error) === 409 && error.backendMessage === "EXPORT_PREVIEW_CHANGED";
}

function outcomeUnknown(error: unknown) {
  if (!(error instanceof SupportClientError)) return true;
  const status = apiStatus(error);
  return status === undefined || status >= 500 || status === 408
    || error.apiCode === undefined || error.apiCode >= 500 || error.apiCode === 408 || !error.backendMessage
    || ["IDEMPOTENCY_REQUEST_IN_PROGRESS", "IDEMPOTENCY_RESULT_UNKNOWN", "EXPORT_IDEMPOTENCY_CONFLICT"].includes(error.backendMessage);
}

function writeError(error: unknown) {
  if (isExportPermissionDenied(error)) return new Error("ADMIN_PERMISSION_DENIED", { cause: error });
  return error;
}

function canRecover(record: SavedExport, authorities: readonly string[]) {
  return record.action === "SUBMIT" ? authorities.includes(SUMMARY) || authorities.includes(DETAIL)
    : authorities.includes(record.action === "WITHDRAW" ? DETAIL : APPROVE);
}

function exportAvailability(options: Options | null | undefined) {
  return {
    canExport: options === undefined || options?.scopes.some(scope => scope.blocked === null && scope.allowed.length > 0) === true,
    exportBlocked: options?.scopes.some(scope => scope.blocked === "NO_MANAGED_GROUP") && !options.scopes.some(scope => scope.blocked === null)
      ? "没有负责的组，暂时不能导出" : undefined,
  };
}

export function usePerformanceExportPorts(scopeRevision = 0): PerfExportPorts | null | undefined {
  const session = useAdminAuth(state => state.session), epoch = useAdminAuth(state => state.authEpoch);
  const active = useAdminAuth(state => state.isAuthenticated && !state.logoutPending && !state.logoutUnknown);
  const [access, setAccess] = useState<{ key: string; options: Options | null | undefined; views: View[]; mineTotal?: number } | null>(null);
  const [revision, setRevision] = useState(0);
  const key = `${session?.adminId}:${epoch}:${session?.authorities.join(",")}:${scopeRevision}`;
  const authorized = active && !!session && !session.passwordChangeRequired
    && session.authorities.some(code => code === "service_m1_read" || code === "service_m3_read");
  const canRequest = !!session && (session.authorities.includes(SUMMARY) || session.authorities.includes(DETAIL));
  const canReview = !!session?.authorities.includes(APPROVE);
  const name = session?.operator || session?.username || "";
  useEffect(() => {
    const controller = new AbortController();
    if (!authorized || !session || !canRequest && !canReview) return;
    const signal = controller.signal;
    const available = (view: View) => read(`?view=${view}&pageNum=1&pageSize=1`, value => {
      const row = object(value);
      array(row.records, object);
      return integer(row.total);
    }, signal);
    void Promise.allSettled([
      canRequest ? read("/options", parseOptions, signal) : Promise.resolve(null),
      canRequest ? available("MINE") : Promise.resolve(null),
      canReview ? available("APPROVALS") : Promise.resolve(null),
    ] as const).then(([options, mine, approvals]) => {
      if (signal.aborted) return;
      const views: View[] = [];
      const keep = (result: PromiseSettledResult<number | null>, wanted: boolean) => {
        if (result.status === "fulfilled") return result.value !== null;
        const status = result.reason instanceof SupportClientError ? apiStatus(result.reason) : undefined;
        return wanted && !isExportPermissionDenied(result.reason)
          && (status === undefined || status === 408 || status >= 500);
      };
      if (keep(mine, canRequest)) views.push("MINE");
      if (keep(approvals, canReview)) views.push("APPROVALS");
      const exportOptions = options.status === "fulfilled" ? options.value : isExportPermissionDenied(options.reason) ? null : undefined;
      setAccess({ key, options: exportOptions, views,
        mineTotal: mine.status === "fulfilled" ? mine.value ?? undefined : undefined });
    });
    return () => controller.abort();
  }, [authorized, canRequest, canReview, key, revision]);
  const views = access?.key === key ? access.views : undefined;
  const operations = useMemo(() => {
    if (!authorized || !session || !views) return;
    return exportPorts({ id: String(session.adminId), epoch, name, authorities: session.authorities }, views,
      () => { setAccess(null); setRevision(value => value + 1); },
      options => setAccess(current => current?.key === key && current.views === views ? { ...current, options } : current));
  }, [authorized, epoch, key, name, views]);
  return useMemo(() => {
    if (!authorized || !canRequest && !canReview) return null;
    if (!operations || !access || !views) return undefined;
    if (access.options === null && !views.length) return null;
    return { ...operations, persona: { name, views, mineTotal: access.mineTotal, ...exportAvailability(access.options) } };
  }, [authorized, canRequest, canReview, operations, access, views, name]);
}

function exportPorts(operator: Operator, views: View[], invalidateAccess: () => void, updateOptions: (options: Options) => void): Omit<PerfExportPorts, "persona"> {
  let choices = new Map<string, { scope: Scope; label: string; types: ExportType[] }>();
  let latest: { id: string; payload: Selection; preview: Preview } | undefined;
  let previewSequence = 0;
  let months: string[] = [];
  let restoration: { kind: "conditions-changed"; differences: ExportConditionDifference[] } | undefined;
  let lastVisible: (ExportVisibleReceipt & { operationId: string }) | undefined;
  // A persisted operation preserves intent, never proof of this session's object access.
  const visibleDecisions = new Set<string>();
  const setTaskVisible = (taskId: string, visible: boolean) => {
    if (visible === visibleDecisions.has(taskId)) return;
    if (visible) visibleDecisions.add(taskId);
    else visibleDecisions.delete(taskId);
    notifyPending();
  };
  const accessDenied = (error: unknown) => exportTaskHidden(error) || isExportPermissionDenied(error);
  const parseTask = taskParser(operator);
  const parseBatch = (value: unknown): { requestId: string; rows: ExportSubmitted[] } => {
    const row = object(value);
    const requestId = id(row.requestId);
    const rows = array(row.items, value => {
      const task = parseTask(value);
      if (!task.mine) invalid("export.batchOwner");
      const { type, taskId, state, rows, canDownload, mine, decidedBy, decidedAt, failure } = task;
      return { type, taskId, state, rows, canDownload, mine, decidedBy, decidedAt, failure };
    });
    return { requestId, rows };
  };
  const mySubmit = () => store.list().find(row => row.action === "SUBMIT" && canRecover(row, operator.authorities));
  const readTask = (taskId: string) => read(`/${id(taskId)}`, value => {
    const task = parseTask(value);
    if (task.taskId !== taskId) invalid("export.taskIdentity");
    setTaskVisible(taskId, !task.scopeLost);
    return task;
  }).catch(error => {
    if (accessDenied(error)) setTaskVisible(taskId, false);
    throw error;
  });
  const requestPreview = async (query: ExportQuery, includeOthers = false) => {
    const sequence = ++previewSequence;
    latest = undefined;
    const choice = choices.get(query.scope);
    if (!choice || query.types.some(type => !choice.types.includes(type))) invalid("export.scope");
    const selection: Selection = { month: query.month, scope: choice.scope, types: EXPORT_TYPES.filter(type => query.types.includes(type)) };
    const catalog = includeOthers && selection.types.length !== choice.types.length
      ? { ...selection, types: choice.types } : selection;
    const display = await post("/preview", catalog, parsePreview);
    if (display.items.some(item => item.reasons.includes("PERMISSION_DENIED"))) throw new Error("ADMIN_PERMISSION_DENIED");
    const accepted = selection.types.length && catalog !== selection ? await post("/preview", selection, parsePreview) : display;
    if (accepted.items.some(item => item.reasons.includes("PERMISSION_DENIED"))) throw new Error("ADMIN_PERMISSION_DENIED");
    for (const [request, response] of [[catalog, display], [selection.types.length ? selection : catalog, accepted]] as const) {
      if (response.scope.kind !== request.scope.kind || JSON.stringify(array(response.scope.groupIds, id).sort()) !== JSON.stringify([...(request.scope.groupIds ?? [])].sort())
        || (response.window && response.window.month !== request.month)
        || JSON.stringify(response.items.map(item => item.type).sort()) !== JSON.stringify([...request.types].sort())) invalid("export.previewSelection");
    }
    if (sequence === previewSequence && selection.types.length) latest = { id: fingerprint(query), payload: selection, preview: accepted };
    const sameWindow = display.window && accepted.window ? samePerformanceWindow(display.window, accepted.window) : display.window === accepted.window;
    return { ...accepted, items: display.items.map(item => accepted.items.find(other => other.type === item.type)
      ?? (sameWindow ? item : { ...item, check: { state: "failed" as const, text: "这一版数据变了，重新检查后再提交。" } })) };
  };
  const deliverSubmit = async (record: Extract<SavedExport, { action: "SUBMIT" }>) => {
    try {
      const { rows: result } = await post("", record.body, parseBatch, record.commandKey);
      if (JSON.stringify(result.map(row => row.type).sort()) !== JSON.stringify([...record.body.types].sort())) invalid("export.batchTypes");
      forget(record);
      return result;
    } catch (error) {
      if (isSupportSessionExpired(error)) throw error;
      if (exportPreviewChanged(error)) {
        const drafts = draftsFor(operator);
        if (drafts) drafts.submit = restoredDraft(record);
      } else if (outcomeUnknown(error)) {
        throw new ExportOutcomeUnknownError("提交后没收到结果，请查询原操作。");
      }
      forget(record);
      throw writeError(error);
    }
  };
  const deliverDecision = async (record: Extract<SavedExport, { taskId: string }>) => {
    let written: ExportTask;
    try {
      const path = record.action === "WITHDRAW" ? "withdraw" : "decision";
      written = await post(`/${record.taskId}/${path}`, record.body, parseTask, record.commandKey);
      if (written.taskId !== record.taskId || written.version <= record.body.expectedVersion
        || (record.action === "REJECT" ? written.state !== "REJECTED" : record.action === "WITHDRAW" ? written.state !== "WITHDRAWN" : !["APPROVED", "READY", "FAILED"].includes(written.state))) invalid("export.decisionOutcome");
    } catch (error) {
      if (isSupportSessionExpired(error)) throw error;
      if (outcomeUnknown(error)) throw new ExportOutcomeUnknownError("没收到结果，请查询原操作。");
      if (exportDecisionConflict(error)) draftsFor(operator)?.decisions.set(decisionDraftKey(record.taskId, record.action), record.body.reason);
      forget(record);
      throw writeError(error);
    }
    const fresh = await readTask(record.taskId).catch(error => {
      if (isExportPermissionDenied(error)) throw writeError(error);
      if (exportTaskHidden(error)) throw error;
      return null;
    });
    if (!fresh || fresh.version < written.version || fresh.state === "PENDING_APPROVAL") throw new ExportOutcomeUnknownError("最新状态暂时无法确认，请查询原操作。");
    forget(record);
    return fresh;
  };
  const decision = (task: ExportTask, action: Action, reason: string) => {
    if (!(action === "APPROVE" ? task.canApprove : action === "REJECT" ? task.canReject : task.canWithdraw)) throw new Error("当前不能处理这条申请。");
    const body = { expectedVersion: task.version, reason, ...(action === "WITHDRAW" ? {} : { decision: action }) };
    const slot = `task:${task.taskId}`;
    const key = save(slot, { action, taskId: task.taskId, body });
    draftsFor(operator)?.decisions.delete(decisionDraftKey(task.taskId, action));
    const record = store.list().find(row => row.commandKey === key);
    if (!record || record.action === "SUBMIT") return invalid("export.savedDecision");
    return deliverDecision(record);
  };
  return {
    invalidateAccess,
    async open(initial) {
      latest = undefined;
      const options = await read("/options", parseOptions);
      updateOptions(options);
      choices = new Map();
      months = options.months.map(month => month.value);
      restoration = undefined;
      for (const scope of options.scopes) {
        const types = scope.allowed.filter(type => operator.authorities.includes(TYPES[type]));
        if (scope.blocked || !types.length) continue;
        if (scope.kind === "MANAGED_GROUPS") {
          if (scope.groups.length > 1) choices.set("MANAGED_GROUPS", { scope: { kind: scope.kind, groupIds: scope.groups.map(group => group.id) }, label: "全部负责组", types });
          for (const group of scope.groups) choices.set(`GROUP:${group.id}`, { scope: { kind: scope.kind, groupIds: [group.id] }, label: group.name, types });
        } else choices.set(scope.kind, { scope: { kind: scope.kind }, label: scopeLabels[scope.kind], types });
      }
      const original = mySubmit();
      const drafts = draftsFor(operator);
      // 一个范围都选不了时，留着的草稿用不上，也不再回显原范围和理由。
      if (!choices.size && drafts) delete drafts.submit;
      const draft = drafts?.submit;
      const saved = original?.action === "SUBMIT" ? original.selection : draft?.query;
      const originalHidden = original?.action === "SUBMIT" && !choices.has(original.selection.scope);
      const differences: ExportConditionDifference[] = [];
      if (!original && draft) {
        const approved = choices.get(draft.query.scope);
        const originalScope = draft.selection.scope;
        if (!months.includes(draft.selection.month)) differences.push({ field: "month", original: draft.selection.month });
        if (!approved || approved.scope.kind !== originalScope.kind
          || JSON.stringify([...(approved.scope.groupIds ?? [])].sort()) !== JSON.stringify([...(originalScope.groupIds ?? [])].sort())) {
          const availableGroups = options.scopes.find(entry => entry.kind === originalScope.kind && !entry.blocked)?.groups;
          const current = approved?.scope ?? (originalScope.kind === "MANAGED_GROUPS" && availableGroups?.length
            ? { kind: originalScope.kind, groupIds: availableGroups.map(group => group.id) } : undefined);
          differences.push({ field: "scope", original: originalScope, current });
        }
        const allowed = approved?.types ?? options.scopes.find(entry => entry.kind === originalScope.kind && !entry.blocked)?.allowed
          .filter(type => operator.authorities.includes(TYPES[type])) ?? [];
        const removed = draft.selection.types.filter(type => !allowed.includes(type));
        if (removed.length) differences.push({ field: "types", removed });
        if (differences.length) restoration = { kind: "conditions-changed", differences };
      }
      const defaultMonth = options.months.find(month => month.value === initial?.month)?.value ?? months[0] ?? "";
      const defaultScope = initial?.scope && choices.has(initial.scope) ? initial.scope : choices.keys().next().value ?? "";
      const month = originalHidden || differences.some(diff => diff.field === "month") ? "" : draft && !original ? draft.selection.month : saved?.month ?? defaultMonth;
      const scope = originalHidden || differences.some(diff => diff.field === "scope") ? "" : saved?.scope ?? defaultScope;
      const types = choices.get(scope)?.types ?? [];
      const selected = originalHidden || differences.some(diff => diff.field === "types") ? []
        : original?.action === "SUBMIT" ? original.body.types : draft?.selection.types
          ?? (types.includes("SUMMARY") ? ["SUMMARY" as const] : []);
      const preview = !original && !restoration && month && scope && types.length ? await requestPreview({ month, scope, types: selected }, true) : undefined;
      return {
        months: options.months, month, since: options.months.length ? `自 ${businessStamp(Date.parse(options.months.at(-1)!.from))} 起` : "", scopes: Array.from(choices, ([value, item]) => ({ value, label: item.label, types: item.types })), scope,
        asOf: preview?.window ? businessStamp(Date.parse(preview.window.asOf)) : "—", downloader: operator.name, items: preview?.items ?? (restoration ? uncheckedItems(types) : []),
        selected: saved ? selected : selected.filter(type => preview?.items.some(item => item.type === type && !["empty", "stale", "unavailable"].includes(item.check.state))),
        blocked: previewBlocked(preview), restoration, originalHidden,
        catalogState: months.length ? "ready" : "no-months",
        minReasonChars: options.minReasonChars, maxReasonChars: options.maxReasonChars,
      };
    },
    async check(query, edited) {
      const types = choices.get(query.scope)?.types ?? [];
      if (restoration && (!edited || !months.includes(query.month) || !query.types.length || query.types.some(type => !types.includes(type)))) {
        latest = undefined;
        return { items: uncheckedItems(types), asOf: "—", restoration };
      }
      const preview = await requestPreview(query, true);
      restoration = undefined;
      return { items: preview.items, asOf: preview.window ? businessStamp(Date.parse(preview.window.asOf)) : "—", blocked: previewBlocked(preview) };
    },
    async submit(query, reason) {
      const original = mySubmit();
      if (original) throw new ExportOutcomeUnknownError("请先查询原操作。");
      if (restoration || !latest || latest.id !== fingerprint(query) || !latest.preview.window || latest.preview.items.some(item => item.check.state !== "ok" || item.check.rows === null)) throw new Error("重新检查导出内容后再提交。");
      const body = { ...latest.payload, previewVersion: latest.preview.version, reason };
      latest = undefined;
      const key = save("submit", { action: "SUBMIT", body, selection: query });
      const drafts = draftsFor(operator);
      if (drafts) delete drafts.submit;
      const record = store.list().find(row => row.commandKey === key);
      if (!record || record.action !== "SUBMIT") return invalid("export.savedSubmission");
      return deliverSubmit(record);
    },
    pendingSubmit() {
      const original = mySubmit();
      return original?.action === "SUBMIT" ? { ...originalFields(original), ...restoredDraft(original), acceptedRequestId: original.acceptedRequestId } : undefined;
    },
    recoveredSubmit: () => draftsFor(operator)?.submit,
    recoveredDecision: (taskId, action) => draftsFor(operator)?.decisions.get(decisionDraftKey(taskId, action)),
    subscribePending(update) {
      pendingListeners.add(update);
      return () => { pendingListeners.delete(update); };
    },
    async lookupSubmit(): Promise<SubmitLookup> {
      const original = mySubmit();
      if (original?.action !== "SUBMIT") return { kind: "missing" };
      const previous = lastVisible?.operationId === original.commandKey ? lastVisible : undefined;
      try {
        const found = await receipt("/command-receipt", original.commandKey);
        if (found.status === "SUCCEEDED") {
          const { requestId, rows } = parseBatch(found.batch);
          const visibleTypes = new Set(rows.map(row => row.type));
          if (visibleTypes.size !== rows.length || rows.some(row => !original.body.types.includes(row.type))) {
            return { kind: "pending", expired: isRetryExpired(original), previous };
          }
          if (visibleTypes.size < original.body.types.length) {
            if (original.acceptedRequestId !== requestId) updateOriginal({ ...original, acceptedRequestId: requestId });
            const checkedAt = Date.now();
            lastVisible = { operationId: original.commandKey, rows, checkedAt };
            return { kind: "partial", requestId, rows, checkedAt };
          }
          forget(original);
          return { kind: "matched", rows };
        }
        if (found.status === "FAILED" || found.status === "CONFIRMED_NOT_EXECUTED") {
          const draft = restoredDraft(original);
          const drafts = draftsFor(operator);
          if (drafts) drafts.submit = draft;
          forget(original);
          return { kind: "cleared", draft };
        }
        enumeration(found.status, ["UNKNOWN", "PROCESSING"]);
        return { kind: "pending", expired: isRetryExpired(original), previous };
      } catch (error) {
        if (isSupportSessionExpired(error)) throw error;
        if (isExportPermissionDenied(error)) {
          lastVisible = undefined;
          throw error;
        }
        return { kind: "check-failed", previous };
      }
    },
    tasks(view, page, pageSize, signal) {
      if (!views.includes(view)) throw new Error("当前没有查看权限。");
      return read(`?view=${view}&pageNum=${page}&pageSize=${pageSize}`, value => {
        const row = object(value);
        if (integer(row.pageNum) !== page || integer(row.pageSize) !== pageSize) invalid("export.taskPage");
        return { rows: array(row.records, parseTask), total: integer(row.total) };
      }, signal).catch(error => {
        if (!signal?.aborted && accessDenied(error)) {
          for (const record of store.list()) {
            if (record.action !== "SUBMIT" && decisionLane(record) === view) setTaskVisible(record.taskId, false);
          }
        }
        throw error;
      });
    },
    task: readTask,
    decide: decision,
    withdraw: (task, reason) => decision(task, "WITHDRAW", reason),
    async lookupDecision(pending): Promise<DecisionLookup> {
      const row = store.list().find(record => record.commandKey === pending.operationId);
      if (!row || row.action === "SUBMIT" || row.taskId !== pending.taskId || row.action !== pending.decision) return { kind: "failed", text: "找不到本标签页保存的原操作。" };
      const command = row.action === "WITHDRAW" ? "WITHDRAW" : "DECISION";
      const hidden = (): DecisionLookup => {
        setTaskVisible(row.taskId, false);
        return { kind: "hidden", text: "这条申请现在不在你能看的范围内，原操作继续保留。" };
      };
      if (!canRecover(row, operator.authorities)) return hidden();
      try {
        const found = await receipt(`/${row.taskId}/command-receipt?command=${command}`, row.commandKey);
        if (found.status === "SUCCEEDED") {
          const response = parseTask(found.task);
          if (found.action !== row.action || found.acceptedVersion !== row.body.expectedVersion + 1 || response.taskId !== row.taskId) return { kind: "mismatch", text: "这条申请的状态对不上这次操作，继续核对，先保持锁定。" };
          // 只有审批回执直接证明看得到；撤回的成功回执交给下面的详情读取去证明。
          if (command === "DECISION") setTaskVisible(row.taskId, !response.scopeLost);
          const task = await readTask(row.taskId);
          if (task.version < response.version || task.state === "PENDING_APPROVAL") return { kind: "pending", text: "还没查到这次操作的结果，先保持锁定。" };
          forget(row);
          return { kind: "matched", task, text: "已查到这次操作。" };
        }
        if (found.status === "FAILED" || found.status === "CONFIRMED_NOT_EXECUTED") {
          draftsFor(operator)?.decisions.set(decisionDraftKey(row.taskId, row.action), row.body.reason);
          forget(row);
          return { kind: "cleared", text: "这次操作未执行，原理由已保留，可以重新确认。" };
        }
        enumeration(found.status, ["UNKNOWN", "PROCESSING"]);
        // 审批（批准、驳回）的回执 200 之前，后端已核过审批权、对象和当前组（SupportPerformanceExportService.java:293–327），证明看得到。
        // 撤回的回执申请人用瘦身权限也能查到，证明不了完整范围，继续遮住。
        if (command === "DECISION") setTaskVisible(row.taskId, true);
        if (isRetryExpired(row)) return { kind: "expired", text: RETRY_EXPIRED_TEXT };
        return { kind: "pending", text: "还没查到这次操作的结果，先保持锁定，稍后再查。" };
      } catch (error) {
        if (accessDenied(error)) return hidden();
        throw error;
      }
    },
    async download(taskId): Promise<ExportDownload> {
      const unavailable = (task: ExportTask): ExportDownload | undefined => {
        if (task.state === "EXPIRED") return { kind: "expired", task };
        if (task.state !== "READY") return { kind: "unconfirmed", task };
        if (!task.canDownload) return { kind: "forbidden", task };
      };
      const readFailure = (error: unknown) => {
        if (isSupportSessionExpired(error)) return { kind: "unconfirmed", sessionExpired: true } as const;
        if (isExportPermissionDenied(error)) return { kind: "forbidden", permissionDenied: true } as const;
        if (!(error instanceof SupportClientError || error instanceof MContentReadError)) return undefined;
        const status = apiStatus(error), code = error.backendMessage;
        if (status === 410 && code !== "EXPORT_TOKEN_EXPIRED") return { kind: "expired" } as const;
        if (status === 404 || status === 409 && code === "EXPORT_SCOPE_CHANGED"
          || status === 403 && code !== "EXPORT_TOKEN_INVALID" && code !== "EXPORT_TOKEN_REQUIRED") return { kind: "forbidden" } as const;
      };
      try {
        const task = await readTask(taskId);
        const blocked = unavailable(task);
        if (blocked) return blocked;
        const token = await post(`/${id(taskId)}/download-token`, undefined, value => {
          const row = object(value); instant(row.expiresAt); return text(row.token);
        });
        const response = await guardedFetch(`/api/admin/content${PATH}/${taskId}/file`, { headers: { "X-Download-Token": token }, cache: "no-store", credentials: "same-origin" });
        if (!response.ok || response.headers.get("Content-Type")?.split(";")[0] !== "text/csv") {
          parseSupportApiEnvelope(response.status, await readSupportResponseText(response), false);
          throw new Error("下载没有完成。");
        }
        const disposition = response.headers.get("Content-Disposition") ?? "";
        const fileName = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? `performance-${taskId}.csv`;
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url; link.download = fileName; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        return { kind: "downloaded" };
      } catch (error) {
        const blocked = readFailure(error);
        if (blocked && ("sessionExpired" in blocked || "permissionDenied" in blocked)) return blocked;
        try {
          const task = await readTask(taskId);
          if (blocked) return { ...blocked, task: { ...task, state: blocked.kind === "expired" ? "EXPIRED" : task.state, canDownload: false } };
          return unavailable(task) ?? { kind: "retry", task };
        } catch (readError) {
          return readFailure(readError) ?? blocked ?? { kind: "unconfirmed" };
        }
      }
    },
    pendingDecisions: () => store.list().flatMap(record => record.action === "SUBMIT" ? []
      : [pendingDecision(record, canRecover(record, operator.authorities) && visibleDecisions.has(record.taskId))]),
  };
}
