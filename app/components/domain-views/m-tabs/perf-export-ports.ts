"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { guardedFetch } from "@/lib/admin/error-messages";
import { businessStamp } from "@/lib/admin/business-time";
import { SupportClientError, supportRequest } from "@/lib/admin/m-support-client";
import { MContentReadError, parseMContentApiEnvelope } from "@/lib/admin/m-support-read-contract";
import { isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { createPendingMutationStore, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { performanceEnum as enumeration, performanceInstant as instant, performanceInteger as integer, performanceList as array, performanceMalformed as invalid, performanceObject as object, performanceText as text, performanceWindow, samePerformanceWindow } from "@/lib/admin/support-performance-contract";
import { EXPORT_TYPES, ExportOutcomeUnknownError, type DecisionLookup, type ExportCheck, type ExportColumns, type ExportDownload, type ExportDraft, type ExportOriginal, type ExportPersona, type ExportQuery, type ExportSubmitted, type ExportTask, type ExportType, type PendingDecision, type PerfExportPorts, type SubmitLookup } from "./perf-view";

const PATH = "/support-workbench/performance-exports";
const SUMMARY = "service_performance_export_summary", DETAIL = "service_performance_export_detail", APPROVE = "service_performance_export_approve";
const TYPES = { SUMMARY, CUSTOMER_DETAIL: DETAIL, TRANSACTION_DETAIL: DETAIL } as const;
const GRAIN = { SUMMARY: "一位客服在一个组一个月一行", CUSTOMER_DETAIL: "一位客户在一位客服名下一个月一行", TRANSACTION_DETAIL: "一笔入金、提现或参考交易一行" };
/** 申请人、审批人：后端给姓名之前不显示内部账号编号。 */
const NAME_PENDING = "（姓名待补）";
const COVERAGE_TEXT: Record<string, string> = { COMPLETE: "完整", PARTIAL: "部分数据还在核对", UNKNOWN: "暂时无法确认是否完整", FAILED: "核对没完成，文件可能缺数" };
const STALE_BLOCKED = "这一版数据更新延迟，暂时不能导出。关掉这个框，在页面上刷新到最新一版后再导出。";
const SCOPES = ["SELF", "MANAGED_GROUPS", "ALL"] as const;
const STATES = ["PENDING_GENERATION", "PENDING_APPROVAL", "APPROVED", "REJECTED", "WITHDRAWN", "READY", "FAILED", "EXPIRED"] as const;
const ACTIONS = ["APPROVE", "REJECT", "WITHDRAW"] as const;
type Action = typeof ACTIONS[number];
type View = ExportPersona["views"][number];
type Operator = { id: string; epoch: number; name: string; authorities: readonly string[] };
type Scope = { kind: typeof SCOPES[number]; groupIds?: string[] };
type Selection = { month: string; scope: Scope; types: ExportType[] };
type SubmitBody = Selection & { previewVersion: string; reason: string };
type DecisionBody = { expectedVersion: number; reason: string; decision?: Exclude<Action, "WITHDRAW"> };
type SavedExport = PendingMutationRecord & ({ action: "SUBMIT"; body: SubmitBody; selection: ExportQuery } | { action: Action; taskId: string; body: DecisionBody });
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
    const rows = nullableNumber(item.availableRows);
    const reasons = array(item.reasonCodes, text);
    const coverage = item.coverage === null ? null : enumeration(object(item.coverage).status, ["COMPLETE", "PARTIAL", "UNKNOWN", "FAILED"]);
    const status = enumeration(item.status, ["AVAILABLE", "EMPTY", "LIMIT_EXCEEDED", "READ_FAILED", "UNAVAILABLE"]);
    const stale = reasons.includes("EXPORT_REFRESH_FAILED") || reasons.includes("EXPORT_DATA_STALE");
    let check: ExportCheck;
    // 这一版不可用（刷新没成功、更新延迟）、没核完、升级中各写各的原因；只有真读取失败才给重试。
    if (stale) check = { state: "stale", rows };
    else if (status === "AVAILABLE") check = { state: "ok", rows, note: coverage === "PARTIAL" ? "部分数据还在核对" : undefined };
    else if (status === "EMPTY") check = { state: "empty", text: "这个月还没有记录。" };
    else if (status === "LIMIT_EXCEEDED") check = { state: "over", text: `共 ${rows ?? "—"} 行，超过导出上限。` };
    else if (status === "READ_FAILED") check = { state: "failed", text: "没加载出来。" };
    else check = { state: "unavailable", text: reasons.includes("EXPORT_GENERATION_UPGRADING") ? "数据正在升级，这一项暂时不能导出。"
      : reasons.includes("EXPORT_ROWS_UNVERIFIED") ? "新的一版还没核完，行数要等核完才知道。" : "这一项暂时不能导出。" };
    return { type, grain: GRAIN[type], limit: integer(item.limit), columns: columns(item.columns, type), check, reasons };
  });
  if (new Set(items.map(item => item.type)).size !== items.length) invalid("export.previewItems");
  return { version: text(row.previewVersion), window, scope: object(row.scope), items };
}
type Preview = ReturnType<typeof parsePreview>;

function taskParser(operator: Operator) {
  return (value: unknown): ExportTask => {
    const row = object(value);
    const type = enumeration(row.type, EXPORT_TYPES);
    const status = enumeration(row.status, STATES);
    const mine = id(row.requesterId) === operator.id;
    const reasons = array(row.reasonCodes, text);
    const window = row.window === null ? null : performanceWindow(row.window);
    const capabilities = object(row.decisionCapabilities);
    const approve = object(capabilities.APPROVE), reject = object(capabilities.REJECT);
    const canApprove = bool(approve.available) && operator.authorities.includes(APPROVE) && !mine;
    const canReject = bool(reject.available) && operator.authorities.includes(APPROVE) && !mine;
    const reason = nullableText(approve.reasonCode);
    const approvalTime = row.approvedAt === null ? undefined : instant(row.approvedAt);
    const failure = status === "FAILED" ? reasons.some(reason => /SCOPE|INELIGIBLE|PERMISSION/.test(reason)) ? "SCOPE_LOST_BEFORE_GENERATE" : "GENERATE_FAILED" : undefined;
    return {
      taskId: id(row.taskId), version: integer(row.version), type, mine,
      requester: mine ? operator.name : NAME_PENDING, requesterRole: "",
      scope: row.scope === null ? null : scopeTitle(row.scope), month: window?.month ?? null, asOf: window?.asOf ?? null,
      rows: nullableNumber(row.rowCount), columns: columns(row.columns, type),
      coverage: row.coverage == null ? null : COVERAGE_TEXT[String(object(row.coverage).status)] ?? null,
      requestReason: row.requestReason == null ? "" : text(row.requestReason), requestedAt: instant(row.requestedAt),
      state: status,
      decidedBy: row.reviewerId === null ? undefined : id(row.reviewerId) === operator.id ? operator.name : NAME_PENDING,
      decidedAt: approvalTime ? businessStamp(Date.parse(approvalTime)) : undefined,
      decisionReason: row.decisionReason == null ? undefined : text(row.decisionReason), failure,
      canDownload: bool(row.canDownload) && mine && operator.authorities.includes(TYPES[type]),
      canApprove, canReject, canWithdraw: bool(row.canWithdraw) && mine && operator.authorities.includes(DETAIL),
      approveBlocked: canApprove ? undefined : reason === "EXPORT_SCOPE_CHANGED" || reason === "EXPORT_APPLICANT_INELIGIBLE" ? "申请人已没有这个范围的导出权限" : "当前不能批准",
      scopeLost: row.scope === null,
    };
  };
}

const fingerprint = (query: ExportQuery) => JSON.stringify([query.month, query.scope, [...query.types].sort()]);
const originalFields = (row: SavedExport) => ({ operationId: row.commandKey, createdAt: row.createdAt, expiresAt: row.expiresAt });
const pendingDecision = (row: Extract<SavedExport, { taskId: string }>): PendingDecision =>
  ({ ...originalFields(row), taskId: row.taskId, decision: row.action, reason: row.body.reason, at: businessStamp(row.createdAt) });
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
  if (isPermissionDenied(error)) return true;
  if (!(error instanceof SupportClientError || error instanceof MContentReadError)) return false;
  const status = apiStatus(error);
  return status === 401 || status === 403
    && ["PERMISSION_DENIED", "ADMIN_PASSWORD_CHANGE_REQUIRED", "无权限访问"].includes(error.backendMessage ?? "");
}

export function exportDecisionConflict(error: unknown) {
  return error instanceof SupportClientError && apiStatus(error) === 409
    && ["EXPORT_TASK_VERSION_CHANGED", "EXPORT_INVALID_STATE", "EXPORT_APPLICANT_INELIGIBLE", "EXPORT_SCOPE_CHANGED"].includes(error.backendMessage ?? "");
}

export function exportTaskHidden(error: unknown) {
  return error instanceof SupportClientError && apiStatus(error) === 404 && error.backendMessage === "EXPORT_TASK_NOT_FOUND";
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
  if (error instanceof SupportClientError && error.backendMessage === "EXPORT_PREVIEW_CHANGED") return new Error("这一版数据变了，重新检查后再提交。");
  return error;
}

function canRecover(record: SavedExport, authorities: readonly string[]) {
  return record.action === "SUBMIT" ? authorities.includes(SUMMARY) || authorities.includes(DETAIL)
    : authorities.includes(record.action === "WITHDRAW" ? DETAIL : APPROVE);
}

export function usePerformanceExportPorts(): PerfExportPorts | null | undefined {
  const session = useAdminAuth(state => state.session), epoch = useAdminAuth(state => state.authEpoch);
  const active = useAdminAuth(state => state.isAuthenticated && !state.logoutPending && !state.logoutUnknown);
  const [access, setAccess] = useState<{ key: string; options: Options | null; views: View[] } | null>(null);
  const [revision, setRevision] = useState(0);
  const key = `${session?.adminId}:${epoch}:${session?.authorities.join(",")}`;
  const authorized = active && !!session && !session.passwordChangeRequired
    && session.authorities.some(code => code === "service_m1_read" || code === "service_m3_read");
  const canRequest = !!session && (session.authorities.includes(SUMMARY) || session.authorities.includes(DETAIL));
  const canReview = !!session?.authorities.includes(APPROVE);
  const name = session?.operator || session?.username || "";
  useEffect(() => {
    const controller = new AbortController();
    if (!authorized || !session || !canRequest && !canReview) return;
    const signal = controller.signal;
    const available = (view: View) => read(`?view=${view}&pageNum=1&pageSize=1`, value => { array(object(value).records, object); return view; }, signal);
    void Promise.allSettled([
      canRequest ? read("/options", parseOptions, signal) : Promise.resolve(null),
      canRequest ? available("MINE") : Promise.resolve(null),
      canReview ? available("APPROVALS") : Promise.resolve(null),
    ] as const).then(([options, mine, approvals]) => {
      if (signal.aborted) return;
      const views: View[] = [];
      const keep = (result: PromiseSettledResult<View | null>, lane: View, wanted: boolean) => {
        if (result.status === "fulfilled") return result.value === lane;
        const status = result.reason instanceof SupportClientError ? apiStatus(result.reason) : undefined;
        return wanted && !isExportPermissionDenied(result.reason)
          && (status === undefined || status === 408 || status >= 500);
      };
      if (keep(mine, "MINE", canRequest)) views.push("MINE");
      if (keep(approvals, "APPROVALS", canReview)) views.push("APPROVALS");
      setAccess({ key, options: options.status === "fulfilled" ? options.value : null, views });
    });
    return () => controller.abort();
  }, [authorized, canRequest, canReview, key, revision]);
  return useMemo(() => {
    if (!authorized || !session || !canRequest && !canReview) return null;
    if (access?.key !== key) return undefined;
    if (!access.options && !access.views.length) return null;
    return exportPorts({ id: String(session.adminId), epoch, name, authorities: session.authorities }, access.options, access.views, () => {
      setAccess(null);
      setRevision(value => value + 1);
    });
  }, [authorized, canRequest, canReview, epoch, key, name, access]);
}

function exportPorts(operator: Operator, initialOptions: Options | null, views: View[], invalidateAccess: () => void): PerfExportPorts {
  let choices = new Map<string, { scope: Scope; label: string; types: ExportType[] }>();
  let latest: { id: string; payload: Selection; preview: Preview } | undefined;
  let previewSequence = 0;
  const parseTask = taskParser(operator);
  const parseBatch = (value: unknown): ExportSubmitted[] => {
    const row = object(value);
    id(row.requestId);
    return array(row.items, value => {
      const task = parseTask(value);
      if (!task.mine) invalid("export.batchOwner");
      const { type, taskId, state, rows, canDownload, mine, decidedBy, decidedAt, failure } = task;
      return { type, taskId, state, rows, canDownload, mine, decidedBy, decidedAt, failure };
    });
  };
  const mySubmit = () => store.list().find(row => row.action === "SUBMIT" && canRecover(row, operator.authorities));
  const readTask = (taskId: string) => read(`/${id(taskId)}`, value => {
    const task = parseTask(value);
    if (task.taskId !== taskId) invalid("export.taskIdentity");
    return task;
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
      const result = await post("", record.body, parseBatch, record.commandKey);
      if (JSON.stringify(result.map(row => row.type).sort()) !== JSON.stringify([...record.body.types].sort())) invalid("export.batchTypes");
      forget(record);
      return result;
    } catch (error) {
      if (outcomeUnknown(error)) throw new ExportOutcomeUnknownError("提交后没收到结果，请查询原操作。");
      const drafts = draftsFor(operator);
      if (drafts && error instanceof SupportClientError && error.backendMessage === "EXPORT_PREVIEW_CHANGED") {
        drafts.submit = { reason: record.body.reason, query: record.selection };
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
    persona: {
      name: operator.name, views, canExport: initialOptions?.scopes.some(scope => scope.blocked === null && scope.allowed.length > 0) ?? false,
      exportBlocked: initialOptions?.scopes.some(scope => scope.blocked === "NO_MANAGED_GROUP") && !initialOptions.scopes.some(scope => scope.blocked === null) ? "没有负责组" : undefined,
    },
    invalidateAccess,
    async open(initial) {
      const options = await read("/options", parseOptions);
      choices = new Map();
      latest = undefined;
      for (const scope of options.scopes) {
        const types = scope.allowed.filter(type => operator.authorities.includes(TYPES[type]));
        if (scope.blocked || !types.length) continue;
        if (scope.kind === "MANAGED_GROUPS") {
          if (scope.groups.length > 1) choices.set("MANAGED_GROUPS", { scope: { kind: scope.kind, groupIds: scope.groups.map(group => group.id) }, label: "全部负责组", types });
          for (const group of scope.groups) choices.set(`GROUP:${group.id}`, { scope: { kind: scope.kind, groupIds: [group.id] }, label: group.name, types });
        } else choices.set(scope.kind, { scope: { kind: scope.kind }, label: scopeLabels[scope.kind], types });
      }
      const original = mySubmit();
      const draft = draftsFor(operator)?.submit;
      const saved = original?.action === "SUBMIT" ? original.selection : draft?.query;
      const defaultMonth = options.months.find(month => month.value === initial?.month) ?? options.months[0];
      const month = original?.action === "SUBMIT" ? original.selection.month
        : options.months.find(month => month.value === saved?.month)?.value ?? defaultMonth?.value ?? "";
      const defaultScope = initial?.scope && choices.has(initial.scope) ? initial.scope : choices.keys().next().value;
      const scope = original?.action === "SUBMIT" ? original.selection.scope
        : saved && choices.has(saved.scope) ? saved.scope : defaultScope ?? "";
      const types = choices.get(scope)?.types ?? [];
      const selected = original?.action === "SUBMIT" ? original.selection.types
        : saved ? saved.types.filter(type => types.includes(type)) : types.includes("SUMMARY") ? ["SUMMARY" as const] : [];
      const preview = !original && month && scope && types.length ? await requestPreview({ month, scope, types: selected }, true) : undefined;
      return {
        months: options.months, month, since: options.months.length ? `自 ${businessStamp(Date.parse(options.months.at(-1)!.from))} 起` : "", scopes: Array.from(choices, ([value, item]) => ({ value, label: item.label, types: item.types })), scope,
        asOf: preview?.window ? businessStamp(Date.parse(preview.window.asOf)) : "—", downloader: operator.name, items: preview?.items ?? [],
        selected: original ? selected : selected.filter(type => preview?.items.some(item => item.type === type && item.check.state !== "empty")),
        blocked: !preview?.window ? "数据正在升级，这一版暂时不能导出。升级完、页面刷新后再导出。"
          : preview.items.some(item => item.reasons.includes("EXPORT_REFRESH_FAILED")) ? "这一版数据刷新没成功，暂时不能导出。关掉这个框，在页面上刷新成功后再导出。"
          : preview.items.some(item => item.reasons.includes("EXPORT_DATA_STALE")) ? STALE_BLOCKED : undefined,
        minReasonChars: options.minReasonChars, maxReasonChars: options.maxReasonChars,
      };
    },
    async check(query) {
      const preview = await requestPreview(query, true);
      const blocked = !preview.window ? "数据正在升级，这一版暂时不能导出。升级完、页面刷新后再导出。"
        : preview.items.some(item => item.reasons.includes("EXPORT_REFRESH_FAILED")) ? "这一版数据刷新没成功，暂时不能导出。关掉这个框，在页面上刷新成功后再导出。"
          : preview.items.some(item => item.reasons.includes("EXPORT_DATA_STALE")) ? STALE_BLOCKED : undefined;
      return { items: preview.items, asOf: preview.window ? businessStamp(Date.parse(preview.window.asOf)) : "—", blocked };
    },
    async submit(query, reason) {
      const original = mySubmit();
      if (original) throw new ExportOutcomeUnknownError("请先查询原操作。");
      if (!latest || latest.id !== fingerprint(query) || !latest.preview.window || latest.preview.items.some(item => item.check.state !== "ok" || item.check.rows === null)) throw new Error("重新检查导出内容后再提交。");
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
      return original?.action === "SUBMIT" ? { ...originalFields(original), reason: original.body.reason, query: original.selection } : undefined;
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
      const found = await receipt("/command-receipt", original.commandKey);
      if (found.status === "SUCCEEDED") {
        const rows = parseBatch(found.batch);
        const visibleTypes = original.body.types.filter(type => operator.authorities.includes(TYPES[type]));
        if (!rows.length || JSON.stringify(rows.map(row => row.type).sort()) !== JSON.stringify(visibleTypes.sort())) {
          return { kind: "pending", expired: isRetryExpired(original) };
        }
        forget(original);
        return { kind: "matched", rows };
      }
      if (found.status === "FAILED" || found.status === "CONFIRMED_NOT_EXECUTED") {
        const draft = { reason: original.body.reason, query: original.selection };
        const drafts = draftsFor(operator);
        if (drafts) drafts.submit = draft;
        forget(original);
        return { kind: "cleared", draft };
      }
      enumeration(found.status, ["UNKNOWN", "PROCESSING"]);
      return { kind: "pending", expired: isRetryExpired(original) };
    },
    tasks(view, page, pageSize, signal) {
      if (!views.includes(view)) throw new Error("当前没有查看权限。");
      return read(`?view=${view}&pageNum=${page}&pageSize=${pageSize}`, value => {
        const row = object(value);
        if (integer(row.pageNum) !== page || integer(row.pageSize) !== pageSize) invalid("export.taskPage");
        return { rows: array(row.records, parseTask), total: integer(row.total) };
      }, signal);
    },
    task: readTask,
    decide: decision,
    withdraw: (task, reason) => decision(task, "WITHDRAW", reason),
    async lookupDecision(pending): Promise<DecisionLookup> {
      const row = store.list().find(record => record.commandKey === pending.operationId);
      if (!row || row.action === "SUBMIT" || row.taskId !== pending.taskId || row.action !== pending.decision || !canRecover(row, operator.authorities)) return { kind: "failed", text: "找不到本标签页保存的原操作。" };
      const command = row.action === "WITHDRAW" ? "WITHDRAW" : "DECISION";
      const found = await receipt(`/${row.taskId}/command-receipt?command=${command}`, row.commandKey);
      if (found.status === "SUCCEEDED") {
        const response = parseTask(found.task);
        if (found.action !== row.action || found.acceptedVersion !== row.body.expectedVersion + 1 || response.taskId !== row.taskId) return { kind: "mismatch", text: "这条申请的状态对不上这次操作，继续核对，先保持锁定。" };
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
      if (isRetryExpired(row)) return { kind: "expired", text: RETRY_EXPIRED_TEXT };
      return { kind: "pending", text: "还没查到这次操作的结果，先保持锁定，稍后再查。" };
    },
    async download(taskId): Promise<ExportDownload> {
      const unavailable = (task: ExportTask): ExportDownload | undefined => {
        if (task.state === "EXPIRED") return { kind: "expired", task };
        if (task.state !== "READY") return { kind: "unconfirmed", task };
        if (!task.canDownload) return { kind: "forbidden", task };
      };
      const readFailure = (error: unknown) => {
        if (isExportPermissionDenied(error)) return { kind: "forbidden", permissionDenied: true } as const;
        if (!(error instanceof SupportClientError || error instanceof MContentReadError)) return undefined;
        const status = apiStatus(error), code = error.backendMessage;
        if (status === 410 && code !== "EXPORT_TOKEN_EXPIRED") return { kind: "expired" } as const;
        if (status === 401 || status === 404 || status === 409 && code === "EXPORT_SCOPE_CHANGED"
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
          parseMContentApiEnvelope(response.status, await response.text(), false);
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
        if (blocked && "permissionDenied" in blocked) return blocked;
        try {
          const task = await readTask(taskId);
          if (blocked) return { ...blocked, task: { ...task, state: blocked.kind === "expired" ? "EXPIRED" : task.state, canDownload: false } };
          return unavailable(task) ?? { kind: "retry", task };
        } catch (readError) {
          return readFailure(readError) ?? blocked ?? { kind: "unconfirmed" };
        }
      }
    },
    pendingDecisions: () => store.list().flatMap(record => record.action === "SUBMIT" || !canRecover(record, operator.authorities)
      || !views.includes(record.action === "WITHDRAW" ? "MINE" : "APPROVALS") ? [] : [pendingDecision(record)]),
  };
}
