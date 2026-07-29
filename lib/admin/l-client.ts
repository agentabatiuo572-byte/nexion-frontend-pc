import { formatAdminApiError } from "@/lib/admin/error-messages";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { assertL3FinanceContract } from "@/lib/admin/l3-finance-contract";
import { assertL5OverviewContract } from "@/lib/admin/l5-overview-contract";

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
  cohort?: string;
  phase?: string;
  locale?: string;
  ref?: string;
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
  publishedAt: string;
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
  createReport: (input: LReportCreateInput, reason: string, idempotencyKey?: string) => Promise<void>;
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

function networkFailure(isReportCreation: boolean) {
  return new Error(isReportCreation
    ? "网络连接已中断，未收到任务创建成功确认；请恢复网络后重试，同一请求会自动防重。"
    : "网络连接已中断，请恢复网络后重试；本次操作没有成功确认。");
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init?.method && init.method !== "GET" && !headers.has("Idempotency-Key")) headers.set("Idempotency-Key", idempotencyKey());
  const execute = () => fetch(`/api/admin/bi${path}`, { ...init, headers, cache: "no-store" });
  const isReportCreation = (path === "/reports" && init?.method === "POST")
    || (path.startsWith("/export/network?") && init?.method === "GET");
  let res: Response;
  try {
    res = await execute();
  } catch {
    // A lost response after report creation is safe to retry only because this
    // request reuses the same Idempotency-Key and the backend durably replays it.
    if (!isReportCreation) throw networkFailure(false);
    try {
      res = await execute();
    } catch {
      throw networkFailure(true);
    }
  }
  // The BFF converts an upstream lost response into 503. Retrying this one
  // operation with the unchanged durable key replays the committed result.
  if (isReportCreation && res.status === 503) res = await execute();
  const text = await res.text();
  const payload = text ? (JSON.parse(text) as ApiResult<T>) : {};
  if (!res.ok || (payload.code !== undefined && payload.code >= 400)) {
    throw new Error(formatAdminApiError(payload.message, `BI_API_${res.status}`));
  }
  return payload.data as T;
}

async function treasuryRequest<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/admin/treasury${path}`, { cache: "no-store" });
  } catch {
    throw networkFailure(false);
  }
  const text = await res.text();
  const payload = text ? (JSON.parse(text) as ApiResult<T>) : {};
  if (!res.ok || (payload.code !== undefined && payload.code >= 400)) {
    throw new Error(formatAdminApiError(payload.message, `TREASURY_API_${res.status}`));
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
    snapshotAvailable: bool(row.snapshotAvailable),
  };
}

function formatRows(value: number) {
  if (value >= 10000) return value.toLocaleString("en-US");
  return String(value || "—");
}

const REPORT_TYPE_LABELS: Record<string, string> = {
  KPI_SERIES: "KPI 聚合",
  FUNNEL_COHORT: "漏斗聚合",
  FINANCE_AGG: "财务聚合",
  OPERATIONS_AGG: "运营聚合",
  NETWORK_TREE: "团队树明细",
  KYC_REGULATORY: "C4 KYC 监管脱敏台账",
  REGULATORY: "监管报告",
};

function reportToTask(report: LReportView): LExportTask {
  const status = report.status.toUpperCase();
  const mask = report.maskingPolicy.toUpperCase();
  const normalizedType = report.type.trim().toUpperCase();
  const supported = ["KPI_SERIES", "FUNNEL_COHORT", "FINANCE_AGG", "OPERATIONS_AGG", "NETWORK_TREE", "KYC_REGULATORY", "REGULATORY"]
    .includes(normalizedType);
  const acts: LExportTask["acts"] = !supported ? []
    : status === "PENDING_CONFIRM" || status === "PENDING_SPLIT_CONFIRM" ? ["approve"]
      : status === "READY" && report.snapshotAvailable ? ["download"]
        : (status === "EXPIRED" || status === "FAILED") && report.snapshotAvailable ? ["retry"]
          : [];
  return {
    id: report.reportId,
    type: REPORT_TYPE_LABELS[normalizedType] || report.name || report.type,
    reportType: report.type,
    supported,
    snapshotAvailable: report.snapshotAvailable,
    scope: normalizedType === "KYC_REGULATORY" ? "全量脱敏台账" : report.scope || report.cycle,
    fields: normalizedType === "KYC_REGULATORY" ? "用户编码、实名状态、网络、配对时间、触发来源" : report.fields,
    pii: report.containsPii,
    mask: mask === "MASKED" ? "masked" : mask === "PARTIAL" ? "partial" : mask === "DECRYPTED" ? "decrypted" : "—",
    rows: formatRows(report.rowCount),
    st: status,
    chain: report.note || report.reason || "后台生成",
    acts,
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
  stage?: "auth.register_completed" | "kyc.express_verified" | "checkout.completed" | "wallet.reinvest" | "withdraw.submitted";
  cohort?: string;
  phase?: "" | "P1" | "P2" | "P3" | "P4" | "P5" | "P6";
  locale?: string;
  ref?: string;
};

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
  return apiRequest<Record<string, unknown>>(`/funnel/drilldown?${query.toString()}`);
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
  const [behaviorRaw, catalogRaw] = await Promise.all([
    apiRequest<unknown>(`/behavior?${query.toString()}`),
    apiRequest<unknown>("/behavior/page-catalog"),
  ]);
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

export async function downloadL6Behavior(input: L6BehaviorQuery = {}) {
  const res = await fetch(`/api/admin/bi/export/behavior?${l6Query(input).toString()}`, { cache: "no-store" });
  const contentType = res.headers.get("Content-Type") || "";
  if (!res.ok || contentType.includes("application/json")) {
    const payload = (await res.json().catch(() => null)) as ApiResult<unknown> | null;
    throw new Error(formatAdminApiError(payload?.message, `BI_L6_EXPORT_${res.status}`));
  }
  return {
    blob: await res.blob(),
    fileName: filenameFromDisposition(res.headers.get("Content-Disposition"), "l6-behavior.csv"),
  };
}

export type L1KpiQuery = {
  window?: "1d" | "7d" | "30d" | "custom";
  from?: string;
  to?: string;
  cohort?: string;
  phase?: string;
  locale?: string;
  ref?: string;
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
  return query;
}

export async function fetchL1Kpi(input: L1KpiQuery = {}): Promise<Record<string, unknown>> {
  return apiRequest<unknown>(`/kpi?${l1Query(input).toString()}`).then(rec);
}

export async function fetchL1KpiDrilldown(kpiId: number, input: L1KpiQuery = {}): Promise<Record<string, unknown>> {
  return apiRequest<unknown>(`/kpi/${encodeURIComponent(String(kpiId))}/drilldown?${l1Query(input).toString()}`).then(rec);
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
  if (moduleCode === "L5") return { [key]: normalizeL5(raw) } as LBiData;
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
  const [overviewRaw, revenueRaw, redemptionRaw, coverageRaw, liabilitiesRaw, maturity7Raw, maturity30Raw] = await Promise.all([
    apiRequest<unknown>("/finance/overview"),
    apiRequest<unknown>(`/finance/revenue?${params.toString()}`),
    apiRequest<unknown>(`/finance/redemption?${redemptionParams.toString()}`),
    treasuryRequest<unknown>("/coverage"),
    treasuryRequest<unknown>("/liabilities?breakdown=true"),
    treasuryRequest<unknown>("/maturity-forecast?window=7d"),
    treasuryRequest<unknown>("/maturity-forecast?window=30d"),
  ]);
  const checked = assertL3FinanceContract({
    overview: rec(overviewRaw),
    revenue: rec(revenueRaw),
    redemption: rec(redemptionRaw),
    coverage: rec(coverageRaw),
    liabilities: rec(liabilitiesRaw),
    maturity7: rec(maturity7Raw),
    maturity30: rec(maturity30Raw),
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
    treasury: {
      coverageRatio: num(coverage.coverageRatio),
      redLine: num(coverage.redLine),
      yellowLine: num(coverage.yellowLine),
      netExposure: num(coverage.netExposureUsdt),
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
      prevRate: num(redemption.previousRate),
      prevLabel: str(redemption.previousLabel, "上期"),
    },
    coverage12w: coverageSeries.map((row) => num(row.coverageRatio)),
    coverageWeeks: coverageSeries.map((row) => {
      const value = str(row.period);
      return value.includes("T") ? value.slice(5, 16).replace("T", " ") : value;
    }),
    coverageBreaches: rows<Record<string, unknown>>(coverage.breaches).flatMap((row) => {
      const index = coverageSeries.findIndex((point) => str(point.period) === str(row.period));
      return index < 0 ? [] : [{ i: index, type: str(row.type), label: str(row.label) }];
    }),
    liabilities: liabilityRows.map((row, index) => ({
      id: index + 1,
      name: str(row.label),
      amount: num(row.amountUsdt),
      color: liabilityColors[index] ?? "var(--ink-4)",
    })),
    maturityWindow: {
      "7d": maturityTotals(maturity7Days),
      "30d": maturityTotals(maturity30Days),
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
  return apiRequest<AdminPage<LReportView>>(`/reports?${query.toString()}`).then((page) => ({
    ...page,
    records: page.records.map(reportToTask),
  }));
}

export async function fetchL5ExportAudits(limit = 50): Promise<LExportAuditRow[]> {
  return apiRequest<LExportAuditRow[]>(`/export/audit?limit=${Math.max(1, Math.min(limit, 100))}`);
}

async function regulatoryRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init?.method && init.method !== "GET" && !headers.has("Idempotency-Key")) headers.set("Idempotency-Key", idempotencyKey());
  const execute = () => fetch(`/api/admin/regulatory${path}`, { ...init, headers, cache: "no-store" });
  let response: Response;
  try {
    response = await execute();
  } catch {
    if (path !== "/report" || init?.method !== "POST") throw networkFailure(false);
    response = await execute().catch(() => { throw networkFailure(true); });
  }
  if (path === "/report" && init?.method === "POST" && response.status === 503) response = await execute();
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as ApiResult<T>) : {};
  if (!response.ok || (payload.code !== undefined && payload.code >= 400)) {
    throw new Error(formatAdminApiError(payload.message, `REGULATORY_API_${response.status}`));
  }
  return payload.data as T;
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

async function downloadReportFile(reportId: string) {
  const issued = await apiRequest<Record<string, unknown>>(`/exports/${encodeURIComponent(reportId)}/download-token`);
  const token = typeof issued.downloadToken === "string" ? issued.downloadToken : "";
  if (!token) throw new Error("下载链接签发失败 · 请重新尝试");
  const query = new URLSearchParams({ token });
  const res = await fetch(`/api/admin/bi/exports/${encodeURIComponent(reportId)}/download?${query.toString()}`, { cache: "no-store" });
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

function withReason<T extends Record<string, unknown>>(body: T, reason: string) {
  return { ...body, reason, operator: currentAdminOperator() };
}

export const lBiActions: LBiActions = {
  createReport: (input, reason, stableIdempotencyKey) => apiRequest("/reports", {
    method: "POST",
    headers: stableIdempotencyKey ? { "Idempotency-Key": stableIdempotencyKey } : undefined,
    body: JSON.stringify(withReason(input, reason)),
  }).then(() => undefined),
  createRegulatoryReport: (input, reason, stableIdempotencyKey) => regulatoryRequest("/report", {
    method: "POST",
    headers: stableIdempotencyKey ? { "Idempotency-Key": stableIdempotencyKey } : undefined,
    body: JSON.stringify(withReason(input, reason)),
  }).then(() => undefined),
  createNetworkTreeExport: (query, reason, stableIdempotencyKey) => {
    const params = new URLSearchParams({
      period: query.period,
      detail: "tree",
      depth: String(query.depth),
    });
    return apiRequest<LNetworkTreeExportResult>(`/export/network?${params.toString()}`, {
      method: "GET",
      headers: {
        "Idempotency-Key": stableIdempotencyKey,
        "X-Operation-Reason": encodeURIComponent(reason),
      },
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
