import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";

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
  // FEAT-DEV01 任务产能节奏(键名 capacity 口径;数值与旧三段曲线等效)
  capacityBand1DeltaPct: "E.device.capacity.band1DeltaPct",
  capacityBand2DeltaPct: "E.device.capacity.band2DeltaPct",
  capacityBand3DeltaPct: "E.device.capacity.band3DeltaPct",
  stageEarlyEnd: "E.device.stageEarlyEnd",
  stageMidEnd: "E.device.stageMidEnd",
  cycleMonths: "E.device.cycleMonths",
  capacityFloorPct: "E.device.capacity.floorPct",
  capacitySubsidyDays: "E.device.capacity.subsidyDays",
  capacityApplyToPhone: "E.device.capacity.applyTo.phone",
  capacityApplyToCloudShare: "E.device.capacity.applyTo.cloud-share",
  capacityApplyToPcGpu: "E.device.capacity.applyTo.pc-gpu",
  capacityApplyToS1: "E.device.capacity.applyTo.stellarbox-s1",
  capacityApplyToPro: "E.device.capacity.applyTo.stellarbox-pro",
  capacityApplyToProV2: "E.device.capacity.applyTo.stellarbox-pro-v2",
  capacityApplyToRackP1: "E.device.capacity.applyTo.stellarrack-p1",
  capacityApplyToRackP2: "E.device.capacity.applyTo.stellarrack-p2",
  taskLockS1: "E.device.taskLock.s1",
  taskLockPro: "E.device.taskLock.pro",
  taskLockRack: "E.device.taskLock.rack",
  tradeinEnabled: "E.tradein.enabled",
  tradeinLadderCut1: "E.tradein.ladder.cut1",
  tradeinLadderCut2: "E.tradein.ladder.cut2",
  tradeinLadderCut3: "E.tradein.ladder.cut3",
  tradeinLadderCut4: "E.tradein.ladder.cut4",
  tradeinLadderCredit1: "E.tradein.ladder.credit1",
  tradeinLadderCredit2: "E.tradein.ladder.credit2",
  tradeinLadderCredit3: "E.tradein.ladder.credit3",
  tradeinLadderCredit4: "E.tradein.ladder.credit4",
  tradeinLadderCredit5: "E.tradein.ladder.credit5",
  tradeinRequireHigherPrice: "E.tradein.requireHigherPrice",
  tradeinMaxDevicesPerOrder: "E.tradein.maxDevicesPerOrder",
  eligibility: "E.tradein.eligibility",
  promoMult: "E.tradein.promoMult",
  promoCooldownDays: "E.tradein.promo.cooldownDays",
  promoMaxPerSession: "E.tradein.promo.maxPerSession",
  promoDelaySeconds: "E.tradein.promo.delaySec",
  promoMinAgeDays: "E.tradein.promo.minAgeDays",
  promoRoutes: "E.tradein.promo.routes",
  inventorySoftMax: "E.tradein.inventorySoftMax",
  earlyAccessEnabled: "E.release.earlyAccess.enabled",
  earlyAccessLeadDays: "E.release.earlyAccess.leadDays",
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

function toBackendValue(frontendKey: string, value: string) {
  if (frontendKey.startsWith("E.device.capacity.applyTo.")) {
    return value === "参与递减" ? "true" : value === "免递减" ? "false" : value;
  }
  if (["E.tradein.enabled", "E.tradein.requireHigherPrice", "E.release.earlyAccess.enabled"].includes(frontendKey)) {
    return value === "开" ? "true" : value === "关" ? "false" : value;
  }
  return value;
}

function toFrontendValue(frontendKey: string, value: string | number | null) {
  const normalized = text(value, "—");
  if (frontendKey.startsWith("E.device.capacity.applyTo.")) {
    return normalized === "true" || normalized === "1" ? "参与递减" : normalized === "false" || normalized === "0" ? "免递减" : normalized;
  }
  if (["E.tradein.enabled", "E.tradein.requireHigherPrice", "E.release.earlyAccess.enabled"].includes(frontendKey)) {
    return normalized === "true" || normalized === "1" ? "开" : normalized === "false" || normalized === "0" ? "关" : normalized;
  }
  return normalized;
}

function frontendParams(config: Record<string, string | number | null> | null | undefined) {
  return Object.entries(config ?? {}).reduce<Record<string, string>>((acc, [key, value]) => {
    const frontendKey = BACKEND_TO_FRONTEND_KEY[key] ?? key;
    acc[frontendKey] = toFrontendValue(frontendKey, value);
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

  const response = await guardedFetch(`/api/admin/devices${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) {
      resetAdminSession();
    }
    throw new Error(formatAdminApiError(result?.message, `E3_REQUEST_FAILED_${response.status}`));
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
    body: JSON.stringify({ key: toBackendKey(key), value: toBackendValue(key, value), reason, operator }),
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
