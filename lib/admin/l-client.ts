import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { isIdempotencyOutcomeOpen, OutcomeUnknownError } from "@/lib/admin/outcome-classification";
import {
  l6UnavailableStateFromError,
  l6UnavailableStateFromFailures,
} from "@/lib/admin/l6-runtime-state";
import { assertL3FinanceContract, assertL3TreasurySnapshot } from "@/lib/admin/l3-finance-contract";
import { assertL5OverviewContract, assertL5ReportContract, assertL5TaskPageContract, CURRENT_L5_REPORT_TYPES } from "@/lib/admin/l5-overview-contract";
import type { L3DetailRequest } from "./l3-detail-export";

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
  lastActionAt?: string | null;
  requestedAt?: string | null;
  reason?: string;
  snapshotAvailable: boolean;
};

export type LExportTask = {
  id: string;
  type: string;
  reportType: string;
  supported: boolean;
  snapshotAvailable: boolean;
  scope: string;
  fields: string;
  pii: boolean;
  mask: "masked" | "partial" | "decrypted" | "—";
  rows: string;
  st: string;
  chain: string;
  acts: ("approve" | "download" | "retry")[];
  approvalEligibility?: "ELIGIBLE" | "SELF" | "MAKER_UNVERIFIED";
  requesterDisplayName?: string | null;
  requestedAt?: string | null;
  lastActionAt?: string | null;
};

export type L5TaskActionRequest = { includeSensitive: boolean; includeDecrypted: false; reason: string; operator: string };

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
  window?: L1KpiQuery["window"];
  from?: string;
  to?: string;
  exportType?: string;
  timeRange?: string;
  fields?: string;
  piiLevel?: string;
  maskPolicy?: string;
  recipient?: string;
  ticket?: string;
  cohort?: string;
  phase?: string;
  locale?: string;
  ref?: string;
  granularity?: L1Granularity;
  asOf?: string;
};

export type LRegulatoryReportInput = {
  templateCode: string;
  period: string;
  jurisdictionCode: string;
  disclosureVersion: string;
  recipient: string;
  ticket: string;
};

export type LNetworkTreeExportResult = {
  reportId: string;
  status: string;
  rowCount: number;
  maskingPolicy: string;
  containsPii: boolean;
  downloadTtlHours: number;
};

export type LRegulatoryDisclosureOption = {
  jurisdictionCode: string;
  jurisdictionName: string;
  countryCodes: string[];
  disclosureVersion: string;
  disclosureStatus: string;
  chapterCount: number;
  publishedAt: string | null;
};

export type LRegulatoryOptions = {
  templates: { code: string; label: string }[];
  disclosures: LRegulatoryDisclosureOption[];
  maskingPolicy: string;
  containsPii: boolean;
  decryptedPiiBlocked: boolean;
};

export type LExportAuditRow = {
  ts: string;
  who: string;
  what: string;
  rows: string | number;
  pii: boolean;
  mask: "masked" | "partial" | "decrypted" | "—";
  chain: string;
  dl: string;
};

export type LBiActions = {
  createReport: (input: LReportCreateInput, reason: string, idempotencyKey?: string, operator?: string) => Promise<void>;
  createRegulatoryReport: (input: LRegulatoryReportInput, reason: string, idempotencyKey?: string) => Promise<void>;
  createNetworkTreeExport: (
    query: { period: "day" | "week" | "month"; depth: number },
    reason: string,
    idempotencyKey: string,
  ) => Promise<LNetworkTreeExportResult>;
  reportAction: (reportId: string, action: "approve" | "rerun" | "download", reason: string, includeSensitive?: boolean) => Promise<void>;
  downloadToken: (reportId: string) => Promise<Record<string, unknown>>;
  downloadReport: (reportId: string) => Promise<{ blob: Blob; fileName: string }>;
  updateExportParam: (key: string, value: string, reason: string) => Promise<void>;
  updateRegulatorySchedule: (value: string, reason: string) => Promise<void>;
  createRegulatoryTemplate: (name: string, reason: string) => Promise<void>;
};

function idempotencyKey() {
  return `l-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class LOutcomeUnknownError extends Error {
  constructor(message = "结果未知：可能已经生效。请按页面上方的提示先核对，再决定是否重试。") {
    super(message);
    this.name = "LOutcomeUnknownError";
  }
}

export function isLOutcomeUnknownError(error: unknown): error is LOutcomeUnknownError {
  return error instanceof LOutcomeUnknownError
    || (error instanceof Error && error.name === "LOutcomeUnknownError");
}

function networkFailure(isReportCreation: boolean) {
  return isReportCreation
    ? new LOutcomeUnknownError()
    : Object.assign(new Error("网络连接已中断，结果未知。请先核对原操作，再决定要不要重试。"), { name: "LNetworkInterruptedError" });
}

/** A report write has a result only when the transport and business response establish one. */
function reportCreationStatus(response: Response, payload: ApiResult<unknown>): number {
  if (isIdempotencyOutcomeOpen(payload.message)) throw new LOutcomeUnknownError();
  if (!response.ok || payload.code === 0) return response.status;
  if (typeof payload.code === "number" && Number.isInteger(payload.code) && payload.code >= 400 && payload.code < 500) return payload.code;
  throw new LOutcomeUnknownError();
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init?.method && init.method !== "GET" && !headers.has("Idempotency-Key")) headers.set("Idempotency-Key", idempotencyKey());
  const execute = () => guardedFetch(`/api/admin/bi${path}`, { ...init, headers, cache: "no-store" });
  const isReportCreation = (path === "/reports" && init?.method === "POST")
    || (path.startsWith("/export/network?") && init?.method === "GET");
  let res: Response;
  try {
    res = await execute();
  } catch {
    // A lost response does not settle creation; the operator chooses recovery.
    throw networkFailure(isReportCreation);
  }
  if (isReportCreation && res.status >= 500) throw networkFailure(true);
  let payload: ApiResult<T> = {};
  try {
    const raw = await res.text();
    // This coverage amount is displayed as its decimal text, before any JSON number conversion.
    const text = path === "/finance/treasury-snapshot"
      ? raw.replace(/("valuedNetExposureUsdt"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"') : raw;
    if (text) payload = (JSON.parse(text) ?? {}) as ApiResult<T>;
  } catch (cause) {
    if (!isReportCreation) throw cause;
    if (res.ok) throw new LOutcomeUnknownError();
  }
  const status = isReportCreation ? reportCreationStatus(res, payload) : res.status;
  if (!res.ok || (payload.code !== undefined && payload.code >= 400)) {
    const error = new Error(formatAdminApiError(payload.message, `BI_API_${status}`)) as Error & { code?: string; status: number; reasonCode?: string };
    error.code = payload.message;
    error.status = status;
    error.reasonCode = payload.message;
    throw error;
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
    lastActionAt: row.lastActionAt as string | null | undefined,
    requestedAt: row.requestedAt as string | null | undefined,
    reason: str(row.reason),
    snapshotAvailable: bool(row.snapshotAvailable),
  };
}

function formatRows(value: number) {
  if (value >= 10000) return value.toLocaleString("en-US");
  return String(value);
}

const REPORT_TYPE_LABELS: Record<string, string> = {
  KPI_SERIES: "KPI 聚合",
  FUNNEL_COHORT: "漏斗聚合",
  FINANCE_AGG: "财务聚合",
  OPERATIONS_AGG: "运营聚合",
  NETWORK_TREE: "团队树明细",
  REGULATORY: "当前披露快照",
};

function reportToTask(report: LReportView): LExportTask {
  const status = report.status.toUpperCase();
  const mask = report.maskingPolicy.toUpperCase();
  const normalizedType = report.type.trim().toUpperCase();
  const supported = CURRENT_L5_REPORT_TYPES.includes(normalizedType as typeof CURRENT_L5_REPORT_TYPES[number]);
  const acts: LExportTask["acts"] = !supported ? []
    : status === "PENDING_CONFIRM" || status === "PENDING_SPLIT_CONFIRM" ? ["approve"]
      : status === "READY" && report.snapshotAvailable ? ["download"]
        : normalizedType !== "NETWORK_TREE" && (status === "EXPIRED" || status === "FAILED") && report.snapshotAvailable ? ["retry"]
          : [];
  return {
    id: report.reportId,
    type: REPORT_TYPE_LABELS[normalizedType] || report.name || report.type,
    reportType: report.type,
    supported,
    snapshotAvailable: report.snapshotAvailable,
    scope: report.scope || report.cycle,
    fields: report.fields,
    pii: report.containsPii,
    mask: mask === "MASKED" ? "masked" : mask === "PARTIAL" ? "partial" : mask === "DECRYPTED" ? "decrypted" : "—",
    rows: formatRows(report.rowCount),
    st: status,
    chain: report.note || report.reason || "后台生成",
    acts,
    lastActionAt: report.lastActionAt,
    requestedAt: report.requestedAt,
  };
}

function normalizeL5(raw: unknown) {
  const data = assertL5OverviewContract(raw);
  const reports = normalizePage(data.reports, normalizeReport);
  return {
    ...data,
    reports,
    exportTasks: reports.records.map(reportToTask),
  };
}

export type LModuleCode = "L1" | "L2" | "L3" | "L4" | "L5" | "L6";

export type L3FinanceQuery = {
  period: "day" | "week" | "month" | "quarter" | "custom";
  from?: string;
  to?: string;
  cohort?: string;
};

export type L4OperationsQuery = {
  period: "day" | "week" | "month" | "custom";
  phase: "ALL" | "P1" | "P2" | "P3" | "P4" | "P5" | "P6";
  from?: string;
  to?: string;
};

export type L2FunnelQuery = {
  stage?: "auth.register_completed" | "checkout.completed" | "wallet.reinvest" | "withdraw.submitted";
  cohort?: string;
  phase?: "" | "P1" | "P2" | "P3" | "P4" | "P5" | "P6";
  locale?: string;
  ref?: string;
};

export type L2TrialStep = {
  e: "trial.started" | "trial.redeemed";
  n: number | null;
  available: boolean;
  includedInFunnel: true;
  arr: string | null;
  arrLb: string | null;
  suppressed?: true;
  reason?: string;
};
export type L2TrialFunnel = {
  available: boolean;
  reason: string | null;
  stages: ["trial.started", "trial.redeemed"];
  association: "USER_ID_AND_TRIAL_AGGREGATE_ID";
  deduplication: "DISTINCT_ACTOR_PER_STAGE";
  conversion: "REDEEMED_STRICTLY_AFTER_SAME_TRIAL_START";
  window: "LEGACY_DAY_START_MINUS_400_DAYS";
  cohort: "SELECTED_REGISTRATION_ACTORS";
  exposureAvailable: false;
  legacyExposureRowIncludedInFunnel: false;
  steps: L2TrialStep[];
};

/** Only the new authoritative basis enables trial facts; old exposure chains stay unsupported. */
function normalizeL2Trial(raw: unknown): Record<string, unknown> & { trialFunnel?: L2TrialFunnel } {
  const data = rec(raw);
  const basisValue = rec(data.quality).trialBasis;
  if (basisValue === undefined) return data;
  const invalid = () => { throw new Error(formatAdminApiError("L2_TRIAL_RESPONSE_INVALID", "L2_TRIAL_RESPONSE_INVALID")); };
  const basis = rec(basisValue);
  if (typeof basis.available !== "boolean" || basis.reason !== null && typeof basis.reason !== "string"
    || !Array.isArray(basis.stages) || basis.stages.length !== 2 || basis.stages[0] !== "trial.started" || basis.stages[1] !== "trial.redeemed"
    || basis.association !== "USER_ID_AND_TRIAL_AGGREGATE_ID" || basis.deduplication !== "DISTINCT_ACTOR_PER_STAGE"
    || basis.conversion !== "REDEEMED_STRICTLY_AFTER_SAME_TRIAL_START" || basis.window !== "LEGACY_DAY_START_MINUS_400_DAYS"
    || basis.cohort !== "SELECTED_REGISTRATION_ACTORS" || basis.exposureAvailable !== false
    || basis.legacyExposureRowIncludedInFunnel !== false || !Array.isArray(data.trialSteps) || data.trialSteps.length !== 3) return invalid();
  const exposure = rec(data.trialSteps[0]);
  if (exposure.e !== "trial.claim_sheet_shown" || exposure.n !== null || exposure.available !== false
    || exposure.includedInFunnel !== false || exposure.reason !== "EVENT_NOT_PRODUCED") return invalid();
  const stages = basis.stages;
  const steps = data.trialSteps.slice(1).map((value, index) => {
    const step = rec(value);
    if (step.e !== stages[index] || step.available !== basis.available || step.includedInFunnel !== true
      || step.suppressed !== undefined && step.suppressed !== true
      || step.reason !== undefined && typeof step.reason !== "string"
      || step.n !== null && !(typeof step.n === "number" && Number.isSafeInteger(step.n) && step.n >= 0)
      || [step.arr, step.arrLb].some(cell => cell !== null && typeof cell !== "string")
      || (!basis.available || step.suppressed) && [step.n, step.arr, step.arrLb].some(cell => cell !== null)) return invalid();
    return step as unknown as L2TrialStep;
  });
  return { ...data, trialFunnel: { ...basis, steps } as L2TrialFunnel };
}

function l2FunnelQuery(input: L2FunnelQuery = {}) {
  const query = new URLSearchParams();
  if (input.stage) query.set("stage", input.stage);
  if (input.cohort?.trim()) query.set("cohort", input.cohort.trim());
  if (input.phase) query.set("phase", input.phase);
  if (input.locale?.trim()) query.set("locale", input.locale.trim());
  if (input.ref?.trim()) query.set("ref", input.ref.trim());
  return query;
}

export async function fetchL2FunnelDrilldown(input: L2FunnelQuery = {}): Promise<Record<string, unknown>> {
  const query = l2FunnelQuery(input);
  return normalizeL2Trial(await apiRequest<unknown>(`/funnel/drilldown?${query.toString()}`));
}

export async function fetchL2RetentionMatrix(
  input: L2FunnelQuery,
  windows: readonly string[],
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({ window: windows.join(",") });
  if (input.cohort?.trim()) query.set("cohortRange", input.cohort.trim());
  if (input.phase) query.set("phase", input.phase);
  if (input.locale?.trim()) query.set("locale", input.locale.trim());
  if (input.ref?.trim()) query.set("ref", input.ref.trim());
  return apiRequest<Record<string, unknown>>(`/retention/cohort-matrix?${query.toString()}`);
}

export async function fetchL2RetentionCurve(
  cohort: string,
  input: L2FunnelQuery = {},
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({ cohort });
  if (input.phase) query.set("phase", input.phase);
  if (input.locale?.trim()) query.set("locale", input.locale.trim());
  if (input.ref?.trim()) query.set("ref", input.ref.trim());
  return apiRequest<Record<string, unknown>>(`/retention/curve?${query.toString()}`);
}

export async function fetchL2Cross(
  metric: "cvr" | "retention" | "trial",
  input: L2FunnelQuery = {},
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({ dim1: "ref", dim2: "locale", metric });
  if (input.cohort?.trim()) query.set("cohort", input.cohort.trim());
  if (input.phase) query.set("phase", input.phase);
  if (input.locale?.trim()) query.set("locale", input.locale.trim());
  if (input.ref?.trim()) query.set("ref", input.ref.trim());
  return apiRequest<Record<string, unknown>>(`/funnel/cross?${query.toString()}`);
}

const MODULE_OVERVIEW_PATH: Record<LModuleCode, string> = {
  L1: "/kpi?window=7d",
  L2: "/funnel/overview",
  L3: "/finance/overview",
  L4: "/operations/overview",
  L5: "/export/overview",
  L6: "/behavior?window=7d",
};

export type L6BehaviorQuery = {
  window?: "24h" | "7d" | "30d";
  device?: "ALL" | "APP" | "H5" | "MP";
  locale?: string;
  depth?: "all" | "L1" | "L2" | "L3";
  sort?: "pv" | "clicks" | "dwellMs" | "bounceRate";
};

function l6Query(input: L6BehaviorQuery = {}) {
  return new URLSearchParams({
    window: input.window || "7d",
    device: input.device || "ALL",
    locale: input.locale || "ALL",
    depth: input.depth || "all",
    sort: input.sort || "pv",
  });
}

export async function fetchL6Behavior(input: L6BehaviorQuery = {}): Promise<Record<string, unknown>> {
  const query = l6Query(input);
  const [behaviorResult, catalogResult] = await Promise.allSettled([
    apiRequest<unknown>(`/behavior?${query.toString()}`),
    apiRequest<unknown>("/behavior/page-catalog"),
  ]);
  const results = [behaviorResult, catalogResult];
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length > 0) {
    const unavailable = l6UnavailableStateFromFailures(failures, results.length);
    if (unavailable) return unavailable;
    throw failures.find((error) => l6UnavailableStateFromError(error) === null) ?? failures[0];
  }
  if (behaviorResult.status !== "fulfilled" || catalogResult.status !== "fulfilled") {
    throw new Error("L6_REQUEST_STATE_INVALID");
  }
  const behaviorRaw = behaviorResult.value;
  const catalogRaw = catalogResult.value;
  const behavior = rec(behaviorRaw);
  const catalog = rec(catalogRaw);
  const window = (input.window || "7d") as "24h" | "7d" | "30d";
  return {
    ...behavior,
    ...catalog,
    activityByWindow: {
      "24h": window === "24h" ? rows(behavior.activity) : [],
      "7d": window === "7d" ? rows(behavior.activity) : [],
      "30d": window === "30d" ? rows(behavior.activity) : [],
    },
  };
}

export async function fetchL6ClickHeat(route: string, input: L6BehaviorQuery = {}): Promise<Record<string, unknown>> {
  const query = l6Query(input);
  query.set("route", route);
  return apiRequest<unknown>(`/behavior/click-heat?${query.toString()}`).then(rec);
}

export async function downloadL6Behavior(input: L6BehaviorQuery & { reason: string; sortDir?: "asc" | "desc" }) {
  const query = l6Query(input);
  if (input.sortDir) query.set("sortDir", input.sortDir);
  query.set("reason", input.reason.trim());
  const res = await guardedFetch(`/api/admin/bi/export/behavior?${query.toString()}`, { cache: "no-store" });
  const contentType = res.headers.get("Content-Type") || "";
  if (!res.ok || contentType.includes("application/json")) {
    const payload = (await res.json().catch(() => null)) as ApiResult<unknown> | null;
    throw new Error(formatAdminApiError(payload?.message, `BI_L6_EXPORT_${res.status}`));
  }
  if (!contentType.toLowerCase().includes("text/csv")) {
    throw new Error(formatAdminApiError("L6_EXPORT_FILE_INVALID", "L6_EXPORT_FILE_INVALID"));
  }
  return {
    blob: await res.blob(),
    fileName: filenameFromDisposition(res.headers.get("Content-Disposition"), "l6-behavior.csv"),
  };
}

export type L1Granularity = "registration_week" | "registration_month";

export type L1KpiQuery = {
  window?: "1d" | "7d" | "30d" | "custom";
  from?: string;
  to?: string;
  cohort?: string;
  phase?: string;
  locale?: string;
  ref?: string;
  granularity?: L1Granularity;
  asOf?: string;
};

function l1Query(input: L1KpiQuery = {}) {
  const query = new URLSearchParams({ window: input.window || "7d" });
  if (input.window === "custom" && input.from?.trim() && input.to?.trim()) {
    query.set("from", input.from.trim());
    query.set("to", input.to.trim());
  }
  if (input.cohort?.trim()) query.set("cohort", input.cohort.trim());
  if (input.phase?.trim()) query.set("phase", input.phase.trim());
  if (input.locale?.trim()) query.set("locale", input.locale.trim());
  if (input.ref?.trim()) query.set("ref", input.ref.trim());
  if (input.granularity) query.set("granularity", input.granularity);
  if (input.asOf) query.set("asOf", input.asOf);
  return query;
}

export async function fetchL1Kpi(input: L1KpiQuery = {}): Promise<Record<string, unknown>> {
  return apiRequest<unknown>(`/kpi?${l1Query(input).toString()}`).then(rec);
}

export async function fetchL1KpiDrilldown(kpiId: number, input: L1KpiQuery & { bucketKey?: string } = {}): Promise<Record<string, unknown>> {
  const query = l1Query(input);
  if (input.bucketKey) query.set("bucketKey", input.bucketKey);
  return apiRequest<unknown>(`/kpi/${encodeURIComponent(String(kpiId))}/drilldown?${query.toString()}`).then(rec);
}

export async function fetchL1KpiTrend(kpiId: number, input: L1KpiQuery = {}): Promise<Record<string, unknown>> {
  const query = l1Query(input);
  query.set("kpiId", String(kpiId));
  return apiRequest<unknown>(`/kpi/trend?${query.toString()}`).then(rec);
}

export async function fetchLBiOverview(
  moduleCode: LModuleCode,
  l3Query?: L3FinanceQuery,
  l4Query?: L4OperationsQuery,
): Promise<LBiData> {
  if (moduleCode === "L6") return { l6: await fetchL6Behavior() };
  if (moduleCode === "L3") return fetchL3FinanceOverview(l3Query);
  if (moduleCode === "L4") return fetchL4OperationsOverview(l4Query);
  const raw = await apiRequest<unknown>(MODULE_OVERVIEW_PATH[moduleCode]);
  const key = moduleCode.toLowerCase() as Lowercase<LModuleCode>;
  if (moduleCode === "L1") return { l1: rec(raw), currentPhase: rec(rec(raw).currentPhase) };
  if (moduleCode === "L5") return { [key]: normalizeL5(raw) } as LBiData;
  if (moduleCode === "L2") return { l2: normalizeL2Trial(raw) };
  return { [key]: rec(raw) } as LBiData;
}

export async function fetchL4OperationsOverview(query?: L4OperationsQuery): Promise<LBiData> {
  const active = query ?? { period: "week" as const, phase: "ALL" as const };
  const params = new URLSearchParams({ period: active.period, phase: active.phase });
  if (active.period === "custom" && active.from) params.set("from", active.from);
  if (active.period === "custom" && active.to) params.set("to", active.to);
  const raw = await apiRequest<unknown>(`/operations/overview?${params.toString()}`);
  return { l4: rec(raw) };
}

async function fetchL3FinanceOverview(query?: L3FinanceQuery): Promise<LBiData> {
  const active = query ?? { period: "month" as const };
  const params = new URLSearchParams({ period: active.period });
  if (active.period === "custom" && active.from) params.set("from", active.from);
  if (active.period === "custom" && active.to) params.set("to", active.to);
  const redemptionParams = new URLSearchParams(params);
  if (active.cohort?.trim()) redemptionParams.set("cohort", active.cohort.trim());
  const [overviewRaw, revenueRaw, redemptionRaw, treasurySnapshotRaw] = await Promise.all([
    apiRequest<unknown>("/finance/overview"),
    apiRequest<unknown>(`/finance/revenue?${params.toString()}`),
    apiRequest<unknown>(`/finance/redemption?${redemptionParams.toString()}`),
    apiRequest<unknown>("/finance/treasury-snapshot"),
  ]);
  const treasuryFacts = assertL3TreasurySnapshot(treasurySnapshotRaw);
  const checked = assertL3FinanceContract({
    overview: rec(overviewRaw),
    revenue: rec(revenueRaw),
    redemption: rec(redemptionRaw),
    coverage: treasuryFacts.coverage,
    liabilities: treasuryFacts.liabilities,
    maturity7: treasuryFacts.maturity7,
    maturity30: treasuryFacts.maturity30,
  });
  const { overview, revenue, redemption, coverage, liabilities, maturity7, maturity30 } = checked;
  const period = rec(revenue.period);
  const revenueColors = ["var(--cyan)", "var(--brand)", "var(--warning)", "var(--success)"];
  const liabilityColors = ["var(--cyan)", "var(--brand)", "var(--warning)", "var(--success)", "#a78bfa", "#fb7185", "#60a5fa", "#94a3b8"];
  const coverageSeries = rows<Record<string, unknown>>(coverage.series);
  const liabilityRows = rows<Record<string, unknown>>(liabilities.breakdown);
  const maturity7Days = rows<Record<string, unknown>>(maturity7.daily);
  const maturity30Days = rows<Record<string, unknown>>(maturity30.daily);
  const maturityTotals = (items: Record<string, unknown>[]) => ({
    withdraw: items.reduce((sum, item) => sum + num(item.withdrawDueUsdt), 0),
    interest: items.reduce((sum, item) => sum + num(item.interestDueUsdt), 0),
    genesis: items.reduce((sum, item) => sum + num(item.genesisDividendUsdt), 0),
  });
  const maturityGroups = [
    maturity30Days.slice(0, 7),
    maturity30Days.slice(7, 14),
    maturity30Days.slice(14, 21),
    maturity30Days.slice(21),
  ].filter((group) => group.length > 0);
  const labelGroup = (group: Record<string, unknown>[]) => {
    const first = str(group[0]?.date);
    const last = str(group[group.length - 1]?.date);
    return first === last ? first : `${first.slice(5)}~${last.slice(5)}`;
  };
  const l3 = {
    ...overview,
    periodLabel: str(period.label, "月度"),
    period: { ...active, ...period },
    ledger: {
      reserveUsd: num(coverage.reserveTotalUsdt),
      liabilitiesUsd: num(coverage.liabilityTotalUsdt),
    },
    valuationReliable: liabilities.valuationReliable,
    valuedLiabilitiesUsd: liabilities.valuedTotalUsdt,
    treasury: {
      coverageRatio: num(coverage.coverageRatio),
      redLine: num(coverage.redLine),
      yellowLine: num(coverage.yellowLine),
      netExposure: num(coverage.netExposureUsdt),
      valuationReliable: coverage.valuationReliable,
      valuationStatus: coverage.valuationStatus,
      valuedCoverageRatio: coverage.valuedCoverageRatio,
      valuedNetExposureUsdt: coverage.valuedNetExposureUsdt,
    },
    revenueExt: rows<Record<string, unknown>>(revenue.streams).map((row, index) => {
      const delta = row.momDelta === null || row.momDelta === undefined ? undefined : num(row.momDelta);
      return {
        nm: str(row.label),
        src: str(row.source),
        amt: num(row.amountUsdt),
        mom: delta === undefined ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`,
        up: delta === undefined ? true : delta >= 0,
        color: revenueColors[index] ?? "var(--ink-4)",
      };
    }),
    revenue,
    redemption: {
      submitted: num(redemption.submitted),
      confirmed: num(redemption.confirmed),
      rejected: num(redemption.rejected),
      delayed: num(redemption.delayed),
      frozen: num(redemption.frozen),
      avgLatency: redemption.averageLatencyHours === null || redemption.averageLatencyHours === undefined
        ? "—" : `${num(redemption.averageLatencyHours).toFixed(2)} 小时`,
      rate: redemption.redemptionRate === null ? null : num(redemption.redemptionRate),
      prevRate: redemption.previousRate === null ? null : num(redemption.previousRate),
      prevLabel: str(redemption.previousLabel, "上期"),
    },
    coverage12w: coverage.series === undefined ? null : coverageSeries.map((row) => num(row.coverageRatio)),
    coverageWeeks: coverage.series === undefined ? null : coverageSeries.map((row) => {
      const value = str(row.period);
      return value.includes("T") ? value.slice(5, 16).replace("T", " ") : value;
    }),
    coverageBreaches: coverage.breaches === undefined ? null : rows<Record<string, unknown>>(coverage.breaches).flatMap((row) => {
      const index = coverageSeries.findIndex((point) => str(point.period) === str(row.period));
      return index < 0 ? [] : [{ i: index, type: str(row.type), label: str(row.label) }];
    }),
    liabilities: liabilityRows.map((row, index) => ({
      id: index + 1,
      category: str(row.category),
      name: str(row.label),
      amount: row.valuedAmountUsdt as number | null,
      color: liabilityColors[index] ?? "var(--ink-4)",
    })),
    maturityWindow: {
      "7d": { ...maturityTotals(maturity7Days), trialStressIncluded: maturity7.trialStressIncluded, cumulativeUsdt: maturity7.cumulativeUsdt, daily: maturity7Days },
      "30d": { ...maturityTotals(maturity30Days), trialStressIncluded: maturity30.trialStressIncluded, cumulativeUsdt: maturity30.cumulativeUsdt, daily: maturity30Days },
    },
    maturitySchedule: {
      weeks: maturityGroups.map(labelGroup),
      data: maturityGroups.map((group) => {
        const totals = maturityTotals(group);
        return [totals.withdraw, totals.interest, totals.genesis];
      }),
    },
    reserveCoverDays: num(maturity30.reserveCoverDays),
    financeReportQuality: {
      revenueServerAuthoritative: revenue.serverAuthoritative === true,
      redemptionServerAuthoritative: redemption.serverAuthoritative === true,
      liabilityCategoryCount: liabilityRows.length,
      maturity7DayCount: maturity7Days.length,
      maturity30DayCount: maturity30Days.length,
    },
  };
  return { l3 };
}

export async function fetchL5ExportTasks(status = "", pageNum = 1, pageSize = 8): Promise<AdminPage<LExportTask>> {
  const query = new URLSearchParams({
    pageNum: String(pageNum),
    pageSize: String(pageSize),
  });
  if (status.trim()) query.set("status", status.trim());
  const result = await apiRequest<unknown>(`/reports?${query.toString()}`);
  let raw: Record<string, unknown>;
  try { raw = assertL5TaskPageContract(result); }
  catch { throw new Error(formatAdminApiError("L5_TASK_RESPONSE_INVALID", "L5_TASK_RESPONSE_INVALID")); }
  const page = raw as unknown as AdminPage<LReportView> & {
    approvalEligibility: Record<string, LExportTask["approvalEligibility"]>;
    requesterDisplayNames: Record<string, string | null>;
  };
  return {
    total: page.total,
    pageNum: page.pageNum,
    pageSize: page.pageSize,
    records: page.records.map((report) => ({
      ...reportToTask(report),
      approvalEligibility: page.approvalEligibility[report.reportId],
      requesterDisplayName: page.requesterDisplayNames[report.reportId],
    })),
  };
}

/** Current task data is for comparison, never a receipt for an earlier action. */
export async function fetchL5ExportTask(reportId: string): Promise<LExportTask> {
  const result = await apiRequest<unknown>(`/export/${encodeURIComponent(reportId)}`);
  let raw: Record<string, unknown>;
  try { raw = assertL5ReportContract(result); }
  catch { throw new Error(formatAdminApiError("L5_TASK_RESPONSE_INVALID", "L5_TASK_RESPONSE_INVALID")); }
  if (raw.reportId !== reportId) throw new Error(formatAdminApiError("L5_TASK_RESPONSE_INVALID", "L5_TASK_RESPONSE_INVALID"));
  return reportToTask(normalizeReport(raw));
}

/** L5 sends the stored body once; retries belong to its persisted recovery path. */
export async function submitL5TaskAction(reportId: string, action: "approve" | "rerun", request: L5TaskActionRequest, commandKey: string): Promise<void> {
  let response: Response;
  try {
    response = await guardedFetch(`/api/admin/bi/reports/${encodeURIComponent(reportId)}/${action}`, {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", "Idempotency-Key": commandKey },
      body: JSON.stringify(request),
    });
  } catch {
    throw new OutcomeUnknownError(formatAdminApiError("L5_TASK_OUTCOME_UNKNOWN", "L5_TASK_OUTCOME_UNKNOWN"));
  }
  const raw: unknown = await response.json().catch(() => null);
  const payload = rec(raw);
  const apiCode = typeof payload.code === "number" ? payload.code : undefined;
  const reasonCode = typeof payload.message === "string" ? payload.message : undefined;
  if (response.headers.get("X-Nexion-Upstream-Outcome") === "unknown") {
    throw new OutcomeUnknownError(formatAdminApiError("L5_TASK_OUTCOME_UNKNOWN", "L5_TASK_OUTCOME_UNKNOWN"));
  }
  if (!response.ok || (apiCode !== undefined && apiCode !== 0)) {
    throw Object.assign(new Error(formatAdminApiError(reasonCode, `BI_API_${response.status}`)), {
      status: response.ok && apiCode !== undefined ? apiCode : response.status,
      httpStatus: response.status, apiCode, reasonCode,
    });
  }
  const receipt = rec(payload.data);
  if (payload.code !== 0 || receipt.reportId !== reportId || receipt.action !== action.toUpperCase()
    || !["READY", "PENDING_CONFIRM"].includes(String(receipt.status))
    || action === "approve" && receipt.status !== "READY"
    || typeof receipt.containsPii !== "boolean" || !["NONE", "MASKED", "PARTIAL", "DECRYPTED"].includes(String(receipt.maskingPolicy))
    || action === "rerun" && receipt.status !== (receipt.containsPii ? "PENDING_CONFIRM" : "READY")) {
    throw new OutcomeUnknownError(formatAdminApiError("L5_TASK_OUTCOME_UNKNOWN", "L5_TASK_OUTCOME_UNKNOWN"));
  }
}

export async function fetchL5ExportAudits(limit = 50): Promise<LExportAuditRow[]> {
  return apiRequest<LExportAuditRow[]>(`/export/audit?limit=${Math.max(1, Math.min(limit, 100))}`);
}

export type L3DetailReceipt = { reportId: string; status: string; replayed?: boolean };

function l3DetailReceipt(value: unknown, request: L3DetailRequest): L3DetailReceipt {
  const report = rec(value);
  if (typeof report.reportId !== "string" || !/^EXP-[A-Z0-9]{8}$/.test(report.reportId)
    || report.type !== "FINANCE_AGG" || report.containsPii !== true || report.maskingPolicy !== "MASKED"
    || report.cycle !== request.timeRange || report.fields !== request.fields
    || typeof report.status !== "string"
    || !["PENDING_CONFIRM", "PENDING_SPLIT_CONFIRM", "PENDING", "GENERATING", "READY", "EXPIRED", "FAILED"].includes(report.status)) {
    throw new Error(formatAdminApiError("L3_DETAIL_RECEIPT_INVALID", "L3_DETAIL_RECEIPT_INVALID"));
  }
  return { reportId: report.reportId, status: report.status };
}

/** L3 detail submits the retained request, including its original operator and reason. */
export async function submitL3FinanceDetail(request: L3DetailRequest, commandKey: string): Promise<L3DetailReceipt> {
  const data = await apiRequest<Record<string, unknown>>("/reports", {
    method: "POST",
    headers: { "Idempotency-Key": commandKey },
    body: JSON.stringify(request),
  });
  try {
    return l3DetailReceipt(data?.created, request);
  } catch {
    // A malformed success receipt cannot settle a command which may have committed.
    throw new LOutcomeUnknownError(formatAdminApiError("L3_DETAIL_RECEIPT_INVALID", "L3_DETAIL_RECEIPT_INVALID"));
  }
}

export async function fetchL3FinanceDetail(reportId: string, request: L3DetailRequest): Promise<L3DetailReceipt> {
  const report = l3DetailReceipt(await apiRequest<unknown>(`/export/${encodeURIComponent(reportId)}`), request);
  if (report.reportId !== reportId) throw new Error(formatAdminApiError("L3_DETAIL_RECEIPT_INVALID", "L3_DETAIL_RECEIPT_INVALID"));
  return report;
}

async function regulatoryRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init?.method && init.method !== "GET" && !headers.has("Idempotency-Key")) headers.set("Idempotency-Key", idempotencyKey());
  const execute = () => guardedFetch(`/api/admin/regulatory${path}`, { ...init, headers, cache: "no-store" });
  const creating = path === "/report" && init?.method === "POST";
  let response: Response;
  try {
    response = await execute();
  } catch {
    throw networkFailure(creating);
  }
  if (creating && response.status >= 500) throw networkFailure(true);
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    if (creating && response.ok) throw new LOutcomeUnknownError();
    throw Object.assign(new Error(formatAdminApiError(undefined, `REGULATORY_API_${response.status}`)), {
      status: response.status,
    });
  }
  const payload = rec(raw) as ApiResult<T>;
  const status = creating ? reportCreationStatus(response, payload) : response.status;
  if (!response.ok || (payload?.code !== undefined && payload.code !== 0)) {
    throw Object.assign(new Error(formatAdminApiError(payload?.message, `REGULATORY_API_${status}`)), {
      status, reasonCode: payload?.message,
    });
  }
  return payload?.data as T;
}

/** Only L5 calls this wrapper; the other L pages keep their existing export contract. */
export async function createL5SummaryReport(input: LReportCreateInput, reason: string): Promise<void> {
  const data = await apiRequest<Record<string, unknown>>("/reports", {
    method: "POST", body: JSON.stringify(withReason(input, reason)),
  });
  try {
    const created = assertL5ReportContract(data?.created);
    if (!/^EXP-[A-Z0-9]{8}$/.test(String(created.reportId)) || created.status !== "READY"
      || created.containsPii !== false || created.maskingPolicy !== "NONE" || created.format !== "CSV") {
      throw new Error("Invalid summary receipt");
    }
  } catch {
    throw new LOutcomeUnknownError();
  }
}

export async function fetchL5RegulatoryOptions(): Promise<LRegulatoryOptions> {
  return regulatoryRequest<LRegulatoryOptions>("/options");
}

function filenameFromDisposition(disposition: string | null, fallback: string) {
  if (!disposition) return fallback;
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8?.[1]) return decodeURIComponent(utf8[1].replace(/"/g, ""));
  const ascii = disposition.match(/filename="?([^";]+)"?/i);
  return ascii?.[1] ? ascii[1] : fallback;
}

async function downloadReportFile(reportId: string, savedToken?: string) {
  const issued = savedToken ? undefined : await apiRequest<Record<string, unknown>>(`/exports/${encodeURIComponent(reportId)}/download-token`);
  const token = savedToken ?? (typeof issued?.downloadToken === "string" ? issued.downloadToken : "");
  if (!token) throw new Error("下载链接签发失败 · 请重新尝试");
  const query = new URLSearchParams({ token });
  const res = await guardedFetch(`/api/admin/bi/exports/${encodeURIComponent(reportId)}/download?${query.toString()}`, { cache: "no-store" });
  const contentType = res.headers.get("Content-Type") || "";
  if (!res.ok || contentType.includes("application/json")) {
    const payload = (await res.json().catch(() => null)) as ApiResult<unknown> | null;
    throw new Error(formatAdminApiError(payload?.message, `BI_DOWNLOAD_${res.status}`));
  }
  return {
    blob: await res.blob(),
    fileName: filenameFromDisposition(res.headers.get("Content-Disposition"), `${reportId}.csv`),
  };
}

/** A recovered L4 file read reuses its received token; it never issues another grant. */
export const downloadL4NetworkFile = (reportId: string, token: string) => downloadReportFile(reportId, token);

export async function fetchL4NetworkReport(reportId: string, request: { period: string; depth: number }): Promise<LNetworkTreeExportResult> {
  const report = rec(await apiRequest<unknown>(`/export/${encodeURIComponent(reportId)}`));
  if (report.reportId !== reportId || report.type !== "NETWORK_TREE" || report.format !== "CSV"
    || report.scope !== `period=${request.period};depth=${request.depth}` || report.status !== "READY"
    || report.containsPii !== true || report.maskingPolicy !== "PARTIAL" || report.snapshotAvailable !== true
    || typeof report.rowCount !== "number" || !Number.isSafeInteger(report.rowCount) || report.rowCount <= 0 || report.rowCount > 100_000) {
    throw new Error(formatAdminApiError("L4_TREE_RECEIPT_INVALID", "L4_TREE_RECEIPT_INVALID"));
  }
  return { reportId, status: "READY", rowCount: report.rowCount, containsPii: true, maskingPolicy: "PARTIAL", downloadTtlHours: 24 };
}

function withReason<T extends Record<string, unknown>>(body: T, reason: string, operator = currentAdminOperator()) {
  return { ...body, reason, operator };
}

export const lBiActions: LBiActions = {
  createReport: async (input, reason, stableIdempotencyKey, operator) => {
    const data = await apiRequest<{ created?: unknown }>("/reports", {
      method: "POST",
      headers: stableIdempotencyKey ? { "Idempotency-Key": stableIdempotencyKey } : undefined,
      body: JSON.stringify(withReason(input, reason, operator)),
    });
    const created = rec(data?.created);
    if (typeof created.reportId !== "string" || !/^EXP-[A-Z0-9]{8}$/.test(created.reportId)
      || typeof created.type !== "string" || !["KPI_SERIES", "FUNNEL_COHORT", "FINANCE_AGG", "OPERATIONS_AGG"].includes(created.type)) {
      throw new LOutcomeUnknownError();
    }
  },
  createRegulatoryReport: async (input, reason, stableIdempotencyKey) => {
    const data = await regulatoryRequest<Record<string, unknown>>("/report", {
      method: "POST",
      headers: stableIdempotencyKey ? { "Idempotency-Key": stableIdempotencyKey } : undefined,
      body: JSON.stringify(withReason(input, reason)),
    });
    try {
      const created = assertL5ReportContract(data?.created);
      const disclosure = rec(data.disclosure);
      if (!/^REG-[A-Z0-9]{8}$/.test(String(created.reportId)) || created.type !== "REGULATORY"
        || created.status !== "READY" || created.containsPii !== false || created.maskingPolicy !== "MASKED"
        || created.cycle !== input.period.trim() || data.taskStatus !== "READY"
        || disclosure.jurisdictionCode !== input.jurisdictionCode.trim().toUpperCase()
        || String(disclosure.disclosureVersion).toUpperCase() !== input.disclosureVersion.trim().toUpperCase()
        || disclosure.chapterCount !== 7
        || data.downloadPath !== `/api/admin/bi/exports/${created.reportId}/download-token`) {
        throw new Error("Invalid regulatory receipt");
      }
    } catch {
      throw new LOutcomeUnknownError();
    }
  },
  createNetworkTreeExport: (query, reason, stableIdempotencyKey) => {
    const params = new URLSearchParams({
      period: query.period,
      detail: "tree",
      depth: String(query.depth),
    });
    return apiRequest<unknown>(`/export/network?${params.toString()}`, {
      method: "GET",
      headers: {
        "Idempotency-Key": stableIdempotencyKey,
        "X-Operation-Reason": encodeURIComponent(reason),
      },
    }).then((value) => {
      const result = rec(value);
      // exportNetworkTreeOnce returns these fields, not an A2 proposal envelope.
      if (typeof result.reportId !== "string" || !/^L4TREE-[A-Z0-9]{8}$/.test(result.reportId)
        || result.status !== "READY" || result.scope !== `period=${query.period};depth=${query.depth}`
        || typeof result.rowCount !== "number" || !Number.isSafeInteger(result.rowCount) || result.rowCount <= 0 || result.rowCount > 100_000
        || result.maskingPolicy !== "PARTIAL" || result.containsPii !== true || result.downloadTtlHours !== 24) {
        throw new LOutcomeUnknownError(formatAdminApiError("L4_TREE_RECEIPT_INVALID", "L4_TREE_RECEIPT_INVALID"));
      }
      return { reportId: result.reportId, status: result.status, rowCount: result.rowCount,
        maskingPolicy: result.maskingPolicy, containsPii: result.containsPii, downloadTtlHours: result.downloadTtlHours };
    });
  },
  reportAction: (reportId, action, reason, includeSensitive = true) => apiRequest(`/reports/${encodeURIComponent(reportId)}/${encodeURIComponent(action)}`, {
    method: "POST",
    body: JSON.stringify(withReason({ includeSensitive, includeDecrypted: false }, reason)),
  }).then(() => undefined),
  downloadToken: (reportId) => apiRequest(`/exports/${encodeURIComponent(reportId)}/download-token`),
  downloadReport: downloadReportFile,
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
