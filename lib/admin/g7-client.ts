import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError } from "@/lib/admin/error-messages";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

type RawNumber = number | string | null | undefined;

interface BackendStats {
  ordersMonth?: RawNumber;
  principalUsd?: RawNumber;
  matureUsd?: RawNumber;
  ticketsMonth?: RawNumber;
  reinvestRate?: RawNumber;
  lockDays?: RawNumber;
}

interface BackendParam {
  key?: string | null;
  configKey?: string | null;
  name?: string | null;
  sub?: string | null;
  value?: RawNumber;
  displayValue?: string | null;
  note?: string | null;
  newOnly?: boolean | string | null;
  b1RedlineTriggered?: boolean | string | null;
  valueType?: string | null;
}

interface BackendPhaseGate {
  key?: string | null;
  label?: string | null;
  value?: string | null;
  linkedDomain?: string | null;
  readonly?: boolean | string | null;
}

interface BackendStatus {
  status?: string | null;
  label?: string | null;
  count?: RawNumber;
  principalUsd?: RawNumber;
  principalDisplay?: string | null;
  tone?: string | null;
}

interface BackendCoverage {
  coverageRatio?: RawNumber;
  redlinePct?: RawNumber;
  redlineBreached?: boolean | string | null;
  precheck?: string | null;
}

interface BackendOverview {
  currentNexPrice?: RawNumber;
  stats?: BackendStats | null;
  params?: BackendParam[] | null;
  phaseGate?: BackendPhaseGate | null;
  stateMachine?: string[] | null;
  statusBreakdown?: BackendStatus[] | null;
  amountDistribution?: string | null;
  coverage?: BackendCoverage | null;
  serverCanonical?: boolean | null;
  sources?: string[] | null;
}

export interface G7Stats {
  ordersMonth: number;
  principalUsd: number;
  matureUsd: number;
  ticketsMonth: number;
  reinvestRate: number;
  lockDays: number;
}

export interface G7Param {
  key: string;
  configKey: string;
  name: string;
  sub: string;
  value: string;
  displayValue: string;
  note: string;
  newOnly: boolean;
  b1RedlineTriggered: boolean;
  valueType: string;
}

export interface G7PhaseGate {
  key: string;
  label: string;
  value: string;
  linkedDomain: string;
  readonly: boolean;
}

export interface G7Status {
  status: string;
  label: string;
  count: number;
  principalUsd: number;
  principalDisplay: string;
  tone: string;
}

export interface G7Coverage {
  coverageRatio: number;
  redlinePct: number;
  redlineBreached: boolean;
  precheck: string;
}

export interface G7Overview {
  currentNexPrice: number;
  stats: G7Stats;
  params: G7Param[];
  phaseGate: G7PhaseGate;
  stateMachine: string[];
  statusBreakdown: G7Status[];
  amountDistribution: string;
  coverage: G7Coverage;
  serverCanonical: boolean;
  sources: string[];
}

let requestSeq = 0;

function idempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

function toNumber(value: RawNumber, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,%±,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toBool(value: boolean | string | null | undefined, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "on", "enabled", "enable"].includes(normalized)) return true;
    if (["false", "0", "off", "disabled", "disable"].includes(normalized)) return false;
  }
  return fallback;
}

function asText(value: unknown, fallback = "-") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeOverview(data: BackendOverview | null | undefined): G7Overview {
  const stats = data?.stats ?? {};
  const phaseGate = data?.phaseGate ?? {};
  const coverage = data?.coverage ?? {};
  return {
    currentNexPrice: toNumber(data?.currentNexPrice),
    stats: {
      ordersMonth: toNumber(stats.ordersMonth),
      principalUsd: toNumber(stats.principalUsd),
      matureUsd: toNumber(stats.matureUsd),
      ticketsMonth: toNumber(stats.ticketsMonth),
      reinvestRate: toNumber(stats.reinvestRate),
      lockDays: toNumber(stats.lockDays, 90),
    },
    params: (data?.params ?? []).map((param) => ({
      key: asText(param.key, "unknown"),
      configKey: asText(param.configKey),
      name: asText(param.name, asText(param.key, "参数")),
      sub: asText(param.sub),
      value: String(param.value ?? ""),
      displayValue: asText(param.displayValue, String(param.value ?? "")),
      note: asText(param.note),
      newOnly: toBool(param.newOnly, true),
      b1RedlineTriggered: toBool(param.b1RedlineTriggered, false),
      valueType: asText(param.valueType, "STRING"),
    })),
    phaseGate: {
      key: asText(phaseGate.key, "reinvestMultiplier"),
      label: asText(phaseGate.label, "H1 growth phase controls limited-time multiplier"),
      value: asText(phaseGate.value, "1x; month 5-6 can be 2x"),
      linkedDomain: asText(phaseGate.linkedDomain, "H1"),
      readonly: toBool(phaseGate.readonly, true),
    },
    stateMachine: data?.stateMachine ?? ["pending_lock", "active", "mature_unclaimed", "claimed", "early_withdrawn"],
    statusBreakdown: (data?.statusBreakdown ?? []).map((status) => ({
      status: asText(status.status, "unknown"),
      label: asText(status.label, asText(status.status, "状态")),
      count: toNumber(status.count),
      principalUsd: toNumber(status.principalUsd),
      principalDisplay: asText(status.principalDisplay),
      tone: asText(status.tone, "dim"),
    })),
    amountDistribution: asText(data?.amountDistribution),
    coverage: {
      coverageRatio: toNumber(coverage.coverageRatio),
      redlinePct: toNumber(coverage.redlinePct),
      redlineBreached: toBool(coverage.redlineBreached, false),
      precheck: asText(coverage.precheck),
    },
    serverCanonical: data?.serverCanonical === true,
    sources: data?.sources ?? [],
  };
}

async function g7Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.idempotencyPrefix) {
    headers.set("Idempotency-Key", idempotencyKey(init.idempotencyPrefix));
  }

  const response = await fetch(`/api/admin/market${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) {
      resetAdminSession();
    }
    throw new Error(formatAdminApiError(result?.message, `G7_REQUEST_FAILED_${response.status}`));
  }

  return result.data as T;
}

export async function fetchG7RepurchaseOverview() {
  return normalizeOverview(await g7Request<BackendOverview>("/nex/repurchase"));
}

export async function updateG7RepurchaseParam(paramKey: string, value: string, reason: string, operator: string) {
  return normalizeOverview(await g7Request<BackendOverview>(`/nex/repurchase/params/${encodeURIComponent(paramKey)}`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: `g7-param-${paramKey}`,
  }));
}
