import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";

export interface E3Stats {
  averageAgeMonths: number;
  cliffDeviceCount: number;
  tradeinMonthCount: number;
  tradeinDiscountUsdt: number;
  k2ArbitrageHits: number;
}

export interface E3OperationMetric {
  nm: string;
  endpoint: string;
  ok: number;
  fail: number;
  roll: number;
  k: string;
  dot: "ok" | "fail";
  ts: string;
  reason: string;
}

export interface E3Snapshot {
  params: Record<string, string>;
  stats: E3Stats;
  operations: E3OperationMetric[];
}

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

interface BackendE3Overview {
  config?: Record<string, string | number | null> | null;
}

interface BackendTradeinOverview {
  averageAgeMonths?: number | string | null;
  cliffDeviceCount?: number | string | null;
  tradeinMonthCount?: number | string | null;
  tradeinDiscountUsdt?: number | string | null;
  k2ArbitrageHits?: number | string | null;
  txStats?: BackendTradeinTx[] | null;
}

interface BackendTradeinTx {
  operation?: string | null;
  name?: string | null;
  endpoint?: string | null;
  successCount?: number | string | null;
  failureCount?: number | string | null;
  rollbackCount?: number | string | null;
  latestKind?: string | null;
  latestStatus?: string | null;
  latestAt?: string | null;
  latestReason?: string | null;
}

const BACKEND_TO_FRONTEND_KEY: Record<string, string> = {
  degradeEarly: "E.device.degradeEarly",
  degradeMid: "E.device.degradeMid",
  degradeLate: "E.device.degradeLate",
  stageEarlyEnd: "E.device.stageEarlyEnd",
  stageMidEnd: "E.device.stageMidEnd",
  cycleMonths: "E.device.cycleMonths",
  minEfficiency: "E.device.minEfficiency",
  taskLockS1: "E.device.taskLock.s1",
  taskLockPro: "E.device.taskLock.pro",
  taskLockRack: "E.device.taskLock.rack",
  salvagePct: "E.tradein.salvagePct",
  eligibility: "E.tradein.eligibility",
  minHoldingMonths: "E.tradein.minHoldingMonths",
  promoMult: "E.tradein.promoMult",
  promoCooldownDays: "E.tradein.promo.cooldownDays",
  promoMaxPerSession: "E.tradein.promo.maxPerSession",
  promoDelaySeconds: "E.tradein.promo.delaySec",
  promoMinAgeDays: "E.tradein.promo.minAgeDays",
  promoRoutes: "E.tradein.promo.routes",
  inventorySoftMax: "E.tradein.inventorySoftMax",
};

const FRONTEND_TO_BACKEND_KEY = Object.entries(BACKEND_TO_FRONTEND_KEY).reduce<Record<string, string>>(
  (acc, [backend, frontend]) => {
    acc[frontend] = backend;
    return acc;
  },
  {},
);

let requestSeq = 0;

function idempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

function toNumber(value: number | string | null | undefined, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function text(value: string | number | null | undefined, fallback = "") {
  const normalized = value == null ? "" : String(value).trim();
  return normalized || fallback;
}

function toBackendKey(frontendKey: string) {
  return FRONTEND_TO_BACKEND_KEY[frontendKey] ?? frontendKey;
}

function frontendParams(config: Record<string, string | number | null> | null | undefined) {
  return Object.entries(config ?? {}).reduce<Record<string, string>>((acc, [key, value]) => {
    const frontendKey = BACKEND_TO_FRONTEND_KEY[key] ?? key;
    acc[frontendKey] = text(value, "0");
    return acc;
  }, {});
}

function timeText(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return value;
}

function fromTx(row: BackendTradeinTx): E3OperationMetric {
  return {
    nm: text(row.name || row.operation, "trade-in"),
    endpoint: text(row.endpoint, "POST /api/admin/devices/e3/tradein"),
    ok: toNumber(row.successCount),
    fail: toNumber(row.failureCount),
    roll: toNumber(row.rollbackCount),
    k: text(row.latestKind, "最新状态"),
    dot: text(row.latestStatus, "ok") === "fail" ? "fail" : "ok",
    ts: timeText(row.latestAt),
    reason: text(row.latestReason, "暂无最新样本"),
  };
}

async function e3Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.idempotencyPrefix) {
    headers.set("Idempotency-Key", idempotencyKey(init.idempotencyPrefix));
  }

  const response = await fetch(`/api/admin/devices${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) {
      resetAdminSession();
    }
    throw new Error(result?.message || `E3_REQUEST_FAILED_${response.status}`);
  }

  return result.data as T;
}

export async function fetchE3Snapshot(): Promise<E3Snapshot> {
  const [overview, tradein] = await Promise.all([
    e3Request<BackendE3Overview>("/e3/overview"),
    e3Request<BackendTradeinOverview>("/e3/tradein/overview"),
  ]);

  return {
    params: frontendParams(overview.config),
    stats: {
      averageAgeMonths: toNumber(tradein.averageAgeMonths),
      cliffDeviceCount: toNumber(tradein.cliffDeviceCount),
      tradeinMonthCount: toNumber(tradein.tradeinMonthCount),
      tradeinDiscountUsdt: toNumber(tradein.tradeinDiscountUsdt),
      k2ArbitrageHits: toNumber(tradein.k2ArbitrageHits),
    },
    operations: (tradein.txStats ?? []).map(fromTx),
  };
}

export async function updateE3Param(key: string, value: string, reason: string, operator: string) {
  const overview = await e3Request<BackendE3Overview>("/e3/config", {
    method: "PATCH",
    body: JSON.stringify({ key: toBackendKey(key), value, reason, operator }),
    idempotencyPrefix: "e3-config",
  });
  return frontendParams(overview.config);
}

export async function updateE3Params(values: Record<string, string>, reason: string, operator: string) {
  let latest: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    latest = await updateE3Param(key, value, reason, operator);
  }
  return latest;
}
