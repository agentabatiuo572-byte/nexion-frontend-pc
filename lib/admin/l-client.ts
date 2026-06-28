import { formatAdminApiError } from "@/lib/admin/error-messages";

const OPERATOR = "superadmin";

type ApiResult<T> = {
  code?: number;
  message?: string;
  data?: T;
};

export type AdminPage<T> = {
  total: number;
  pageNum: number;
  pageSize: number;
  records: T[];
};

export type LReportView = {
  reportId: string;
  name: string;
  type: string;
  cycle: string;
  format: string;
  scope: string;
  fields: string;
  rowCount: number;
  containsPii: boolean;
  maskingPolicy: string;
  status: string;
  note?: string;
  lastAction?: string;
  reason?: string;
};

export type LExportTask = {
  id: string;
  type: string;
  scope: string;
  fields: string;
  pii: boolean;
  mask: "masked" | "partial" | "decrypted" | "—";
  rows: string;
  st: string;
  chain: string;
  acts: ("approve" | "download" | "retry")[];
};

export type LBiData = {
  currentPhase?: Record<string, unknown>;
  phases?: Record<string, unknown>[];
  l1?: Record<string, unknown>;
  l2?: Record<string, unknown>;
  l3?: Record<string, unknown>;
  l4?: Record<string, unknown>;
  l5?: Record<string, unknown> & {
    exportTasks?: LExportTask[];
    reports?: AdminPage<LReportView>;
    statusLabels?: Record<string, [string, string]>;
  };
  l6?: Record<string, unknown>;
};

export type LReportCreateInput = {
  exportType?: string;
  timeRange?: string;
  fields?: string;
  piiLevel?: string;
  maskPolicy?: string;
  recipient?: string;
  ticket?: string;
};

export type LBiActions = {
  createReport: (input: LReportCreateInput, reason: string) => Promise<void>;
  reportAction: (reportId: string, action: "approve" | "rerun" | "download", reason: string, includeSensitive?: boolean) => Promise<void>;
  downloadToken: (reportId: string) => Promise<Record<string, unknown>>;
  updateExportParam: (key: string, value: string, reason: string) => Promise<void>;
  updateRegulatorySchedule: (value: string, reason: string) => Promise<void>;
  createRegulatoryTemplate: (name: string, reason: string) => Promise<void>;
};

function idempotencyKey() {
  return `l-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init?.method && init.method !== "GET" && !headers.has("Idempotency-Key")) headers.set("Idempotency-Key", idempotencyKey());
  const res = await fetch(`/api/admin/bi${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const text = await res.text();
  const payload = text ? (JSON.parse(text) as ApiResult<T>) : {};
  if (!res.ok || (payload.code !== undefined && payload.code >= 400)) {
    throw new Error(formatAdminApiError(payload.message, `BI_API_${res.status}`));
  }
  return payload.data as T;
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function str(value: unknown, fallback = "") {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function num(value: unknown, fallback = 0) {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return ["true", "1", "yes"].includes(value.toLowerCase());
  return fallback;
}

function normalizePage<T>(value: unknown, normalizeRow: (row: Record<string, unknown>) => T): AdminPage<T> {
  const data = rec(value);
  const records = rows<Record<string, unknown>>(data.records).map(normalizeRow);
  return {
    total: num(data.total, records.length),
    pageNum: num(data.pageNum, 1),
    pageSize: num(data.pageSize, 20),
    records,
  };
}

function normalizeReport(row: Record<string, unknown>): LReportView {
  return {
    reportId: str(row.reportId),
    name: str(row.name),
    type: str(row.type),
    cycle: str(row.cycle),
    format: str(row.format),
    scope: str(row.scope),
    fields: str(row.fields),
    rowCount: num(row.rowCount),
    containsPii: bool(row.containsPii),
    maskingPolicy: str(row.maskingPolicy, "NONE"),
    status: str(row.status, "GENERATING").toUpperCase(),
    note: str(row.note),
    lastAction: str(row.lastAction),
    reason: str(row.reason),
  };
}

function formatRows(value: number) {
  if (value >= 10000) return value.toLocaleString("en-US");
  return String(value || "—");
}

function reportToTask(report: LReportView): LExportTask {
  const status = report.status.toUpperCase();
  const mask = report.maskingPolicy.toUpperCase();
  const acts: LExportTask["acts"] =
    status === "PENDING_CONFIRM" || status === "PENDING_SPLIT_CONFIRM" ? ["approve"]
    : status === "READY" ? ["download"]
    : status === "EXPIRED" || status === "FAILED" ? ["retry"]
    : [];
  return {
    id: report.reportId,
    type: report.name || report.type,
    scope: report.scope || report.cycle,
    fields: report.fields,
    pii: report.containsPii,
    mask: mask === "MASKED" ? "masked" : mask === "PARTIAL" ? "partial" : mask === "DECRYPTED" ? "decrypted" : "—",
    rows: formatRows(report.rowCount),
    st: status,
    chain: report.note || report.reason || "后台生成",
    acts,
  };
}

function normalizeL5(raw: unknown) {
  const data = rec(raw);
  const reports = normalizePage(data.reports, normalizeReport);
  return {
    ...data,
    reports,
    exportTasks: reports.records.map(reportToTask),
  };
}

function normalizeOverviews(raw: unknown): LBiData {
  const data = rec(raw);
  return {
    currentPhase: rec(data.currentPhase),
    phases: rows<Record<string, unknown>>(data.phases),
    l1: rec(data.l1),
    l2: rec(data.l2),
    l3: rec(data.l3),
    l4: rec(data.l4),
    l5: normalizeL5(data.l5),
    l6: rec(data.l6),
  };
}

export async function fetchLBiOverviews(): Promise<LBiData> {
  return apiRequest("/overview").then(normalizeOverviews);
}

function withReason<T extends Record<string, unknown>>(body: T, reason: string) {
  return { ...body, reason, operator: OPERATOR };
}

export const lBiActions: LBiActions = {
  createReport: (input, reason) => apiRequest("/reports", { method: "POST", body: JSON.stringify(withReason(input, reason)) }).then(() => undefined),
  reportAction: (reportId, action, reason, includeSensitive = true) => apiRequest(`/reports/${encodeURIComponent(reportId)}/${encodeURIComponent(action)}`, {
    method: "POST",
    body: JSON.stringify(withReason({ includeSensitive, includeDecrypted: false }, reason)),
  }).then(() => undefined),
  downloadToken: (reportId) => apiRequest(`/exports/${encodeURIComponent(reportId)}/download-token`),
  updateExportParam: (key, value, reason) => apiRequest(`/export/params/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify(withReason({ value }, reason)),
  }).then(() => undefined),
  updateRegulatorySchedule: (value, reason) => apiRequest("/regulatory/schedule", {
    method: "PATCH",
    body: JSON.stringify(withReason({ value }, reason)),
  }).then(() => undefined),
  createRegulatoryTemplate: (name, reason) => apiRequest("/regulatory/templates", {
    method: "POST",
    body: JSON.stringify(withReason({ name }, reason)),
  }).then(() => undefined),
};
