export type A2OperationType = "fund" | "param" | "acct" | "sos";
export type A2AuditDomain = "D" | "C" | "H" | "I" | "A" | "K" | "B";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

interface BackendStats {
  pendingTickets?: number | string | null;
  fundTickets?: number | string | null;
  sosTickets?: number | string | null;
  todayAuditEvents?: number | string | null;
  weeklyApproved?: number | string | null;
  weeklyRejected?: number | string | null;
  weeklyExpired?: number | string | null;
  weeklyWithdrawn?: number | string | null;
}

interface BackendTicket {
  id: string;
  action: string;
  obj: string;
  beforeValue?: string | null;
  afterValue?: string | null;
  operator?: string | null;
  operatorRole?: string | null;
  type?: string | null;
  amplifies?: boolean | null;
  sos?: boolean | null;
  ts?: string | null;
  mine?: boolean | null;
  roleGate?: string | null;
  reason?: string | null;
  status?: string | null;
}

interface BackendHistory {
  id: string;
  action: string;
  st: string;
  chain: string;
  t: string;
  note: string;
}

interface BackendMechanismParam {
  key: string;
  name: string;
  sub: string;
  value: string;
  locked?: boolean | null;
}

interface BackendConfirmCategory {
  cat: string;
  examples: string;
  roleGate: string;
}

interface BackendAuditLog {
  id?: number | string | null;
  traceId?: string | null;
  action?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  actorType?: string | null;
  actorUsername?: string | null;
  clientIp?: string | null;
  result?: string | null;
  riskLevel?: string | null;
  detailJson?: string | null;
  createdAt?: string | null;
}

interface BackendOverview {
  stats?: BackendStats | null;
  operationQueue?: BackendTicket[] | null;
  operationHistory?: BackendHistory[] | null;
  mechanismParams?: BackendMechanismParam[] | null;
  confirmCategories?: BackendConfirmCategory[] | null;
  recentLogs?: BackendAuditLog[] | null;
}

export interface A2Stats {
  pendingTickets: number;
  fundTickets: number;
  sosTickets: number;
  todayAuditEvents: number;
  weeklyApproved: number;
  weeklyRejected: number;
  weeklyExpired: number;
  weeklyWithdrawn: number;
}

export interface A2OperationRow {
  id: string;
  action: string;
  obj: string;
  before: string;
  after: string;
  operator: string;
  operatorRole: string;
  type: A2OperationType;
  amplifies: boolean;
  sos: boolean;
  ts: string;
  mine: boolean;
  roleGate: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "withdrawn" | "expired";
}

export interface A2OperationHistory {
  id: string;
  action: string;
  st: string;
  chain: string;
  t: string;
  note: string;
}

export interface A2MechanismParam {
  key: string;
  name: string;
  sub: string;
  value: string;
  locked: boolean;
}

export interface A2ConfirmCategory {
  cat: string;
  examples: string;
  roleGate: string;
}

export interface A2AuditLogRow {
  id: string;
  ts: string;
  actor: string;
  role: string;
  action: string;
  obj: string;
  delta: string;
  domain: A2AuditDomain;
  ip: string;
  result: string;
  riskLevel: string;
}

export interface A2Overview {
  stats: A2Stats;
  operationQueue: A2OperationRow[];
  operationHistory: A2OperationHistory[];
  mechanismParams: A2MechanismParam[];
  confirmCategories: A2ConfirmCategory[];
  recentLogs: A2AuditLogRow[];
}

let requestSeq = 0;

function idempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

function toNumber(value: number | string | null | undefined, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function asText(value: unknown, fallback = "—") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function parseDetail(detailJson: string | null | undefined): Record<string, unknown> {
  if (!detailJson) return {};
  try {
    const parsed = JSON.parse(detailJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeType(value: string | null | undefined): A2OperationType {
  const normalized = value?.trim().toLowerCase();
  return normalized === "fund" || normalized === "param" || normalized === "acct" || normalized === "sos"
    ? normalized
    : "param";
}

function normalizeStatus(value: string | null | undefined): A2OperationRow["status"] {
  const normalized = value?.trim().toLowerCase();
  return normalized === "approved" || normalized === "rejected" || normalized === "withdrawn" || normalized === "expired"
    ? normalized
    : "pending";
}

function normalizeDomain(value: unknown, action: string, obj: string): A2AuditDomain {
  if (typeof value === "string") {
    const upper = value.trim().toUpperCase();
    if (upper === "D" || upper === "C" || upper === "H" || upper === "I" || upper === "A" || upper === "K" || upper === "B") {
      return upper;
    }
  }
  const source = `${action} ${obj}`.toUpperCase();
  if (source.includes("D2") || source.includes("WITHDRAW") || source.includes("提现") || source.includes("账单")) return "D";
  if (source.includes("C2") || source.includes("C3") || source.includes("USER") || source.includes("账户") || source.includes("余额")) return "C";
  if (source.includes("H1") || source.includes("PHASE")) return "H";
  if (source.includes("I1") || source.includes("I5") || source.includes("I7") || source.includes("CONTENT") || source.includes("披露")) return "I";
  return "A";
}

function formatTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fromTicket(ticket: BackendTicket): A2OperationRow {
  return {
    id: ticket.id,
    action: ticket.action,
    obj: ticket.obj,
    before: ticket.beforeValue?.trim() || "—",
    after: ticket.afterValue?.trim() || "—",
    operator: ticket.operator?.trim() || "系统",
    operatorRole: ticket.operatorRole?.trim() || "super",
    type: normalizeType(ticket.type),
    amplifies: !!ticket.amplifies,
    sos: !!ticket.sos,
    ts: ticket.ts?.trim() || "—",
    mine: !!ticket.mine,
    roleGate: ticket.roleGate?.trim() || "超管",
    reason: ticket.reason?.trim() || "—",
    status: normalizeStatus(ticket.status),
  };
}

function fromLog(log: BackendAuditLog): A2AuditLogRow {
  const detail = parseDetail(log.detailJson);
  const action = asText(log.action, "UNKNOWN");
  const obj = asText(detail.obj ?? detail.resource ?? log.resourceId ?? log.resourceType, "—");
  const delta = asText(detail.delta, detail.before || detail.after ? `${asText(detail.before)} → ${asText(detail.after)}` : "—");
  return {
    id: String(log.id ?? `${action}-${log.createdAt ?? Date.now()}`),
    ts: asText(detail.tsLabel, formatTime(log.createdAt)),
    actor: asText(detail.actor ?? log.actorUsername, "系统"),
    role: asText(detail.role ?? log.actorType, "ADMIN"),
    action,
    obj,
    delta,
    domain: normalizeDomain(detail.domain, action, obj),
    ip: log.clientIp?.trim() || "—",
    result: log.result?.trim() || "SUCCESS",
    riskLevel: log.riskLevel?.trim() || "INFO",
  };
}

function normalizeOverview(data: BackendOverview | null | undefined): A2Overview {
  const stats = data?.stats ?? {};
  return {
    stats: {
      pendingTickets: toNumber(stats.pendingTickets),
      fundTickets: toNumber(stats.fundTickets),
      sosTickets: toNumber(stats.sosTickets),
      todayAuditEvents: toNumber(stats.todayAuditEvents),
      weeklyApproved: toNumber(stats.weeklyApproved),
      weeklyRejected: toNumber(stats.weeklyRejected),
      weeklyExpired: toNumber(stats.weeklyExpired),
      weeklyWithdrawn: toNumber(stats.weeklyWithdrawn),
    },
    operationQueue: (data?.operationQueue ?? []).map(fromTicket),
    operationHistory: (data?.operationHistory ?? []).map((row) => ({ ...row })),
    mechanismParams: (data?.mechanismParams ?? []).map((row) => ({ ...row, locked: !!row.locked })),
    confirmCategories: (data?.confirmCategories ?? []).map((row) => ({ ...row })),
    recentLogs: (data?.recentLogs ?? []).map(fromLog),
  };
}

async function a2Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.idempotencyPrefix) {
    headers.set("Idempotency-Key", idempotencyKey(init.idempotencyPrefix));
  }

  const response = await fetch(`/api/admin/platform/audit${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    throw new Error(result?.message || `A2_REQUEST_FAILED_${response.status}`);
  }

  return result.data as T;
}

export async function fetchA2Overview() {
  return normalizeOverview(await a2Request<BackendOverview>("/overview"));
}

export async function approveA2Operation(operationId: string, reason: string, operator: string) {
  const row = await a2Request<BackendTicket>(`/operations/${encodeURIComponent(operationId)}/approve`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "a2-operation-approve",
  });
  return fromTicket(row);
}

export async function rejectA2Operation(operationId: string, reason: string, operator: string) {
  const row = await a2Request<BackendTicket>(`/operations/${encodeURIComponent(operationId)}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "a2-operation-reject",
  });
  return fromTicket(row);
}

export async function exportA2Audit(reason: string, filter: Record<string, unknown>) {
  return a2Request<{ jobNo: string; status: string; idempotencyKey: string; createdAt: string }>("/exports", {
    method: "POST",
    body: JSON.stringify({ reason, filter }),
    idempotencyPrefix: "a2-audit-export",
  });
}

export async function updateA2MechanismParam(paramKey: string, value: string, reason: string, operator: string) {
  return a2Request<BackendMechanismParam>(`/mechanism-params/${encodeURIComponent(paramKey)}`, {
    method: "POST",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: "a2-mechanism-param",
  });
}
