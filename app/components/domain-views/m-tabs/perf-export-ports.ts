"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { guardedFetch } from "@/lib/admin/error-messages";
import { businessStamp } from "@/lib/admin/business-time";
import { SupportClientError, supportRequest } from "@/lib/admin/m-support-client";
import { parseMContentApiEnvelope } from "@/lib/admin/m-support-read-contract";
import { createPendingMutationStore, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { performanceEnum as enumeration, performanceInstant as instant, performanceInteger as integer, performanceList as array, performanceMalformed as invalid, performanceObject as object, performanceText as text, performanceWindow } from "@/lib/admin/support-performance-contract";
import { EXPORT_TYPES, ExportOutcomeUnknownError, type DecisionLookup, type ExportCheck, type ExportColumns, type ExportDialogData, type ExportItem, type ExportPersona, type ExportQuery, type ExportSubmitted, type ExportTask, type ExportType, type PendingDecision, type PerfExportPorts, type SubmitLookup } from "./perf-view";

const PATH = "/support-workbench/performance-exports";
const SUMMARY = "service_performance_export_summary", DETAIL = "service_performance_export_detail", APPROVE = "service_performance_export_approve";
const TYPES = { SUMMARY, CUSTOMER_DETAIL: DETAIL, TRANSACTION_DETAIL: DETAIL } as const;
const GRAIN = { SUMMARY: "一个客服在一个组一个月一行", CUSTOMER_DETAIL: "一位客户一个月一行", TRANSACTION_DETAIL: "一笔记录一行" };
const SCOPES = ["SELF", "MANAGED_GROUPS", "ALL"] as const;
const STATES = ["PENDING_GENERATION", "PENDING_APPROVAL", "APPROVED", "REJECTED", "WITHDRAWN", "READY", "FAILED", "EXPIRED"] as const;
const ACTIONS = ["APPROVE", "REJECT", "WITHDRAW"] as const;
type Action = typeof ACTIONS[number];
type View = ExportPersona["views"][number];
type Operator = { id: string; name: string; authorities: readonly string[] };
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
    if (stale && rows !== null) check = { state: "stale", rows };
    else if (status === "AVAILABLE") check = { state: "ok", rows, note: coverage === "PARTIAL" ? "部分数据还在核对" : undefined };
    else if (status === "EMPTY") check = { state: "empty", text: "这个月还没有记录。" };
    else if (status === "LIMIT_EXCEEDED") check = { state: "over", text: `共 ${rows ?? "—"} 行，超过导出上限。` };
    else check = { state: "failed", text: reasons.some(reason => reason === "EXPORT_GENERATION_UPGRADING" || reason === "EXPORT_ROWS_UNVERIFIED") ? "新的一版还没核完，行数要等核完才知道。" : "没加载出来。" };
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
      requester: mine ? operator.name : id(row.requesterId), requesterRole: "",
      scope: row.scope === null ? null : scopeTitle(row.scope), month: window?.month ?? null, asOf: window?.asOf ?? null,
      rows: nullableNumber(row.rowCount), columns: columns(row.columns, type),
      coverage: row.coverage == null ? null : object(row.coverage).status === "PARTIAL" ? "部分数据还在核对" : null,
      requestReason: row.requestReason == null ? "" : text(row.requestReason), requestedAt: instant(row.requestedAt),
      state: status === "PENDING_GENERATION" ? "APPROVED" : status,
      decidedBy: row.reviewerId === null ? undefined : id(row.reviewerId),
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
const pendingDecision = (row: Extract<SavedExport, { taskId: string }>): PendingDecision =>
  ({ taskId: row.taskId, decision: row.action, reason: row.body.reason, operationId: row.commandKey, at: businessStamp(row.createdAt) });
const forget = (row: SavedExport) => store.forget(row.fingerprint, row.commandKey);
const save = (slot: string, extra: Omit<Extract<SavedExport, { action: "SUBMIT" }>, keyof PendingMutationRecord> | Omit<Extract<SavedExport, { taskId: string }>, keyof PendingMutationRecord>) => {
  if (store.get(slot)) throw new ExportOutcomeUnknownError("请先查询原操作。");
  const key = crypto.randomUUID();
  store.remember(slot, key, extra);
  if (!store.isDurablyStored(slot, key)) {
    store.forget(slot, key);
    throw new Error("原操作无法保存，暂时不能提交。");
  }
  return key;
};

function outcomeUnknown(error: unknown) {
  return !(error instanceof SupportClientError) || error.status >= 500 || error.status === 408
    || (error.status === 200 && error.apiCode === undefined)
    || ["IDEMPOTENCY_REQUEST_IN_PROGRESS", "IDEMPOTENCY_RESULT_UNKNOWN"].includes(error.backendMessage ?? "");
}

function writeError(error: unknown) {
  if (error instanceof SupportClientError && error.backendMessage === "EXPORT_PREVIEW_CHANGED") return new Error("这一版数据变了，重新检查后再提交。");
  if (error instanceof SupportClientError && ["EXPORT_SCOPE_CHANGED", "EXPORT_TASK_VERSION_CHANGED"].includes(error.backendMessage ?? "")) return new Error("这条申请的范围或状态变了，刷新后再看。");
  return error;
}

export function usePerformanceExportPorts(): PerfExportPorts | null {
  const session = useAdminAuth(state => state.session), epoch = useAdminAuth(state => state.authEpoch);
  const active = useAdminAuth(state => state.isAuthenticated && !state.logoutPending && !state.logoutUnknown);
  const [access, setAccess] = useState<{ key: string; options: Options | null; views: View[] } | null>(null);
  const key = `${session?.adminId}:${epoch}:${session?.authorities.join(",")}`;
  useEffect(() => {
    const controller = new AbortController();
    if (!active || !session || session.passwordChangeRequired || !session.authorities.some(code => code === "service_m1_read" || code === "service_m3_read")) return;
    const canRequest = session.authorities.includes(SUMMARY) || session.authorities.includes(DETAIL);
    const canReview = session.authorities.includes(APPROVE);
    if (!canRequest && !canReview) return;
    const signal = controller.signal;
    const available = (view: View) => read(`?view=${view}&pageNum=1&pageSize=1`, value => { array(object(value).records, object); return view; }, signal);
    void Promise.allSettled([
      canRequest ? read("/options", parseOptions, signal) : Promise.resolve(null),
      canRequest ? available("MINE") : Promise.resolve(null),
      canReview ? available("APPROVALS") : Promise.resolve(null),
    ] as const).then(([options, mine, approvals]) => {
      if (signal.aborted) return;
      const views: View[] = [];
      if (mine.status === "fulfilled" && mine.value) views.push(mine.value);
      if (approvals.status === "fulfilled" && approvals.value) views.push(approvals.value);
      setAccess({ key, options: options.status === "fulfilled" ? options.value : null, views });
    });
    return () => controller.abort();
  }, [active, key, session]);
  return useMemo(() => active && session && access?.key === key && (access.options || access.views.length)
    ? exportPorts({ id: String(session.adminId), name: session.operator || session.username, authorities: session.authorities }, access.options, access.views)
    : null, [active, session, key, access]);
}

function exportPorts(operator: Operator, initialOptions: Options | null, views: View[]): PerfExportPorts {
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
      return { type: task.type, taskId: task.taskId, state: task.state, rows: task.rows };
    });
  };
  const mySubmit = () => store.list().find(row => row.action === "SUBMIT");
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
    const accepted = selection.types.length && catalog !== selection ? await post("/preview", selection, parsePreview) : display;
    for (const [request, response] of [[catalog, display], [selection.types.length ? selection : catalog, accepted]] as const) {
      if (response.scope.kind !== request.scope.kind || JSON.stringify(array(response.scope.groupIds, id).sort()) !== JSON.stringify([...(request.scope.groupIds ?? [])].sort())
        || (response.window && response.window.month !== request.month)
        || JSON.stringify(response.items.map(item => item.type).sort()) !== JSON.stringify([...request.types].sort())) invalid("export.previewSelection");
    }
    if (sequence === previewSequence && selection.types.length) latest = { id: fingerprint(query), payload: selection, preview: accepted };
    const sameWindow = display.window?.sourceVersion === accepted.window?.sourceVersion
      && display.window?.sourceScopeVersion === accepted.window?.sourceScopeVersion;
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
      forget(record);
      throw writeError(error);
    }
    const fresh = await readTask(record.taskId).catch(() => null);
    if (!fresh || fresh.version < written.version || fresh.state === "PENDING_APPROVAL") throw new ExportOutcomeUnknownError("最新状态暂时无法确认，请查询原操作。");
    forget(record);
    return fresh;
  };
  const decision = (task: ExportTask, action: Action, reason: string) => {
    if (!(action === "APPROVE" ? task.canApprove : action === "REJECT" ? task.canReject : task.canWithdraw)) throw new Error("当前不能处理这条申请。");
    const body = { expectedVersion: task.version, reason, ...(action === "WITHDRAW" ? {} : { decision: action }) };
    const slot = `task:${task.taskId}`;
    const key = save(slot, { action, taskId: task.taskId, body });
    const record = store.list().find(row => row.commandKey === key);
    if (!record || record.action === "SUBMIT") return invalid("export.savedDecision");
    return deliverDecision(record);
  };
  return {
    persona: {
      name: operator.name, views, canExport: initialOptions?.scopes.some(scope => scope.blocked === null && scope.allowed.length > 0) ?? false,
      exportBlocked: initialOptions?.scopes.some(scope => scope.blocked === "NO_MANAGED_GROUP") && !initialOptions.scopes.some(scope => scope.blocked === null) ? "没有负责组" : undefined,
    },
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
      const defaultMonth = options.months.find(month => month.value === initial?.month) ?? options.months[0];
      const month = original?.action === "SUBMIT" ? original.selection.month : defaultMonth?.value ?? "";
      const defaultScope = initial?.scope && choices.has(initial.scope) ? initial.scope : choices.keys().next().value;
      const scope = original?.action === "SUBMIT" ? original.selection.scope : defaultScope ?? "";
      const types = choices.get(scope)?.types ?? [];
      const selected = original?.action === "SUBMIT" ? original.selection.types : types.includes("SUMMARY") ? ["SUMMARY" as const] : [];
      const preview = !original && month && scope && types.length ? await requestPreview({ month, scope, types: selected }, true) : undefined;
      return {
        months: options.months, month, since: options.months.length ? `自 ${businessStamp(Date.parse(options.months.at(-1)!.from))} 起` : "", scopes: Array.from(choices, ([value, item]) => ({ value, label: item.label })), scope,
        asOf: preview?.window ? businessStamp(Date.parse(preview.window.asOf)) : "—", downloader: operator.name, items: preview?.items ?? [],
        selected: original ? selected : selected.filter(type => preview?.items.some(item => item.type === type && item.check.state !== "empty")),
        blocked: !preview?.window ? "数据正在升级，这一版暂时不能导出。升级完、页面刷新后再导出。"
          : preview.items.some(item => item.reasons.includes("EXPORT_REFRESH_FAILED")) ? "这一版数据刷新没成功，暂时不能导出。关掉这个框，在页面上刷新成功后再导出。" : undefined,
        minReasonChars: options.minReasonChars, maxReasonChars: options.maxReasonChars,
      };
    },
    async check(query) {
      const preview = await requestPreview(query, true);
      const blocked = !preview.window ? "数据正在升级，这一版暂时不能导出。升级完、页面刷新后再导出。"
        : preview.items.some(item => item.reasons.includes("EXPORT_REFRESH_FAILED")) ? "这一版数据刷新没成功，暂时不能导出。关掉这个框，在页面上刷新成功后再导出。" : undefined;
      return { items: preview.items, asOf: preview.window ? businessStamp(Date.parse(preview.window.asOf)) : "—", blocked };
    },
    async submit(query, reason) {
      const original = mySubmit();
      if (original) throw new ExportOutcomeUnknownError("请先查询原操作。");
      if (!latest || latest.id !== fingerprint(query) || !latest.preview.window || latest.preview.items.some(item => item.check.state !== "ok" || item.check.rows === null)) throw new Error("重新检查导出内容后再提交。");
      const body = { ...latest.payload, previewVersion: latest.preview.version, reason };
      latest = undefined;
      const key = save("submit", { action: "SUBMIT", body, selection: query });
      const record = store.list().find(row => row.commandKey === key);
      if (!record || record.action !== "SUBMIT") return invalid("export.savedSubmission");
      return deliverSubmit(record);
    },
    pendingSubmit() {
      const original = mySubmit();
      return original?.action === "SUBMIT" ? { reason: original.body.reason, query: original.selection } : undefined;
    },
    async lookupSubmit(): Promise<SubmitLookup> {
      const original = mySubmit();
      if (original?.action !== "SUBMIT") return { kind: "cleared" };
      const found = await receipt("/command-receipt", original.commandKey);
      if (found.status === "SUCCEEDED") {
        const rows = parseBatch(found.batch);
        if (JSON.stringify(rows.map(row => row.type).sort()) !== JSON.stringify([...original.body.types].sort())) return { kind: "pending", expired: isRetryExpired(original) };
        forget(original);
        return { kind: "matched", rows };
      }
      if (found.status === "FAILED" || found.status === "CONFIRMED_NOT_EXECUTED") {
        forget(original);
        return { kind: "cleared" };
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
      if (!row || row.action === "SUBMIT" || row.taskId !== pending.taskId) return { kind: "failed", text: "找不到本标签页保存的原操作。" };
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
        forget(row);
        return { kind: "cleared", text: "这次操作未执行，原理由已保留，可以重新确认。" };
      }
      enumeration(found.status, ["UNKNOWN", "PROCESSING"]);
      if (isRetryExpired(row)) return { kind: "expired", text: RETRY_EXPIRED_TEXT };
      return { kind: "pending", text: "还没查到这次操作的结果，先保持锁定，稍后再查。" };
    },
    async download(taskId) {
      const task = await readTask(taskId);
      if (!task.canDownload) throw new Error("你现在没有这份文件的下载权限。");
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
    },
    pendingDecisions: () => store.list().flatMap(record => record.action === "SUBMIT" ? [] : [pendingDecision(record)]),
  };
}
