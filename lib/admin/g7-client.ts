import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError } from "@/lib/admin/error-messages";
import { assertG7OrderPageContract, assertG7OverviewContract } from "@/lib/admin/g-overview-contract";
import { createStableMutationExecutor, stableMutationFingerprint, stableMutationHttpFailure } from "@/lib/admin/stable-mutation";

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
  reinvestRateAvailable?: boolean | string | null;
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
  domain?: string | null;
  product?: string | null;
  asset?: string | null;
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
  g4Capacity?: { monthlyCapacity?: RawNumber; ticketsIssuedThisMonth?: RawNumber; source?: string | null } | null;
}

interface BackendOrder {
  orderNo?: string | null;
  userId?: RawNumber;
  userNo?: string | null;
  nickname?: string | null;
  amountUsdt?: RawNumber;
  apyPct?: RawNumber;
  lockDays?: RawNumber;
  lockedAt?: string | null;
  unlockAt?: string | null;
  estimatedInterestUsdt?: RawNumber;
  status?: string | null;
  billCorrelationPrefix?: string | null;
}

interface BackendOrderPage {
  orders?: BackendOrder[] | null;
  nextCursor?: RawNumber;
  hasMore?: boolean | string | null;
  serverCanonical?: boolean | null;
}

export interface G7Stats {
  ordersMonth: number;
  principalUsd: number;
  matureUsd: number;
  ticketsMonth: number;
  reinvestRate: number;
  reinvestRateAvailable: boolean;
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
  g4Capacity: { monthlyCapacity: number; ticketsIssuedThisMonth: number; source: string };
}

export interface G7Order {
  orderNo: string;
  userId: number;
  userNo: string;
  nickname: string;
  amountUsdt: number;
  apyPct: number;
  lockDays: number;
  lockedAt: string;
  unlockAt: string;
  estimatedInterestUsdt: number;
  status: string;
  billCorrelationPrefix: string;
}

export interface G7OrderPage {
  orders: G7Order[];
  nextCursor: number | null;
  hasMore: boolean;
  serverCanonical: boolean;
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
  assertG7OverviewContract(data);
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
      reinvestRateAvailable: toBool(stats.reinvestRateAvailable, false),
      lockDays: toNumber(stats.lockDays),
    },
    params: (data?.params ?? []).map((param) => ({
      key: asText(param.key, "unknown"),
      configKey: asText(param.configKey),
      name: asText(param.name, asText(param.key, "参数")),
      sub: asText(param.sub),
      value: String(param.value ?? ""),
      displayValue: asText(param.displayValue, String(param.value ?? "")),
      note: asText(param.note),
      newOnly: toBool(param.newOnly, false),
      b1RedlineTriggered: toBool(param.b1RedlineTriggered, false),
      valueType: asText(param.valueType, "STRING"),
    })),
    phaseGate: {
      key: asText(phaseGate.key, ""),
      label: asText(phaseGate.label, ""),
      value: asText(phaseGate.value, ""),
      linkedDomain: asText(phaseGate.linkedDomain, ""),
      readonly: toBool(phaseGate.readonly, false),
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
    g4Capacity: {
      monthlyCapacity: toNumber(data?.g4Capacity?.monthlyCapacity),
      ticketsIssuedThisMonth: toNumber(data?.g4Capacity?.ticketsIssuedThisMonth),
      source: asText(data?.g4Capacity?.source),
    },
  };
}

async function g7Request<T>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
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
    throw stableMutationHttpFailure(
      formatAdminApiError(result?.message, `G7_REQUEST_FAILED_${response.status}`),
      response.status,
      result?.code,
    );
  }

  return result.data as T;
}

export async function fetchG7RepurchaseOverview() {
  return normalizeOverview(await g7Request<BackendOverview>("/nex/repurchase"));
}

const executeG7Mutation = createStableMutationExecutor(idempotencyKey, "nexion-admin-g7-repurchase-commands-v1");

export async function fetchG7RepurchaseOrders(status = "") {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const data = await g7Request<BackendOrderPage>(`/nex/repurchase/orders${query}`);
  assertG7OrderPageContract(data);
  return {
    orders: (data?.orders ?? []).map((order) => ({
      orderNo: asText(order.orderNo),
      userId: toNumber(order.userId),
      userNo: asText(order.userNo),
      nickname: asText(order.nickname),
      amountUsdt: toNumber(order.amountUsdt),
      apyPct: toNumber(order.apyPct),
      lockDays: toNumber(order.lockDays),
      lockedAt: asText(order.lockedAt),
      unlockAt: asText(order.unlockAt),
      estimatedInterestUsdt: toNumber(order.estimatedInterestUsdt),
      status: asText(order.status, "UNKNOWN"),
      billCorrelationPrefix: asText(order.billCorrelationPrefix),
    })),
    nextCursor: data?.nextCursor == null ? null : toNumber(data.nextCursor),
    hasMore: toBool(data?.hasMore, false),
    serverCanonical: data?.serverCanonical === true,
  } satisfies G7OrderPage;
}

export async function updateG7RepurchaseParam(paramKey: string, value: string, reason: string, operator: string, g4Ref = "") {
  const body = { value, reason, operator, g4Ref };
  const serialized = JSON.stringify(body);
  const path = `/nex/repurchase/config/${encodeURIComponent(paramKey)}`;
  return executeG7Mutation(
    `g7-param-${paramKey}`,
    stableMutationFingerprint("PUT", path, serialized),
    (commandKey) => g7Request<BackendOverview>(path, {
      method: "PUT",
      headers: { "Idempotency-Key": commandKey },
      body: serialized,
    }),
    normalizeOverview,
  );
}
