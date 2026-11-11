import { parseE6DecimalJson } from "./e6-decimal";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import {
  parseE5DevicePage,
  parseE5Overview,
} from "@/lib/admin/e456-overview-contract";
import { parseE5DeviceDailyRate } from "@/lib/admin/e5-device-rate";
import { parseE5DeviceIdentity } from "@/lib/admin/e5-device-identity";
import { parseE5Observability, type E5Observability } from "@/lib/admin/e5-observability-contract";
import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { parseLegacyUnknownCandidate, type LegacyUnknownCandidate } from "@/lib/admin/legacy-unknown-resolution";
import {
  E5OutcomeUncertainError,
  e5StableDeviceCommand,
} from "@/lib/admin/e5-stable-device-command";

export type { E5Observability } from "@/lib/admin/e5-observability-contract";

export type E5DeviceState = "active" | "busy" | "offline" | "inventory" | "pending-deactivate" | "unbound" | "abnormal" | "unknown";
export type E5QueryErrorCode = "E5_SIM_STATE_INVALID" | "E5_SOURCE_INVALID";
export type E5SimState = "WAITING_ACTIVATION" | "WAITING_INIT" | "LEGACY_PENDING" | "RUNNING" | "WAITING_CONFIG" | "PAUSED" | "CLOSING" | "STOPPED" | "UNBOUND" | "ERROR" | "SIM_OFF";
export interface E5CurrentTask { taskNo: string; name: string; taskClass: string; startedAt: string; dueAt: string }
export type E5SourceChannel = "ORDER" | "TRADE_IN" | "TRIAL" | "PROMOTION_GIFT";

export interface E5MonthlyTarget {
  cycleIndex: number;
  cycleStartAt: string;
  cycleEndAt: string;
  creditedUsdt: number | string;
  rangeLowUsdt: number | string | null;
  rangeHighUsdt: number | string | null;
  capacityPct: number;
  targetActive: boolean;
  configChangedInCycle: boolean;
}

export interface E5Device {
  id: string;
  deviceId: number;
  userId: string;
  userNo: string;
  nickname: string;
  user: string;
  deviceName: string;
  sku: string;
  productTier: string;
  productCode: string;
  serial: string;
  hostingLabel: string;
  sourceChannel: E5SourceChannel | string;
  simState: E5SimState | null;
  simLastError: string | null;
  simNextActionAt: string | null;
  currentTask: E5CurrentTask | null;
  maxDevicesPerUser: number;
  state: E5DeviceState;
  rawStatus: string;
  runtimeStatus: string;
  hashrate: number;
  dailyUsdt: number | null;
  dailyNex: number | null;
  dailyUsdtText?: string | null;
  dailyNexText?: string | null;
  monthlyTarget: E5MonthlyTarget | null;
  activeTaskNo: string;
  heartbeatAt: string;
  heartbeatAgeSeconds: number | null;
  purchasedAt: string;
  activatedAt: string;
  deactivatedAt: string;
  baseRate: string;
  currentEfficiency: number;
  batteryLevel: number | null;
  isCharging: boolean | null;
  isWifiConnected: boolean | null;
  thermalState: string;
  pausedReason: string;
  activeDevicesForUser: number;
  pendingDeactivate: boolean;
  slotNo: number | null;
  slot: string;
}

export interface E5Overview { total: number; running: number; waitingActivation: number; stopped: number }
export interface E5DeviceQuery {
  keyword?: string;
  simState?: string;
  source?: string;
  productCode?: string;
  pageNum?: number;
  pageSize?: number;
}

export interface E5DevicePage {
  total: number;
  pageNum: number;
  pageSize: number;
  records: E5Device[];
}

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

interface PageResult<T> {
  total: number;
  pageNum: number;
  pageSize: number;
  records: T[];
}

interface BackendDevice {
  id?: number | string | null;
  userId?: number | string | null;
  userNo?: string | null;
  nickname?: string | null;
  instanceNo?: string | null;
  name?: string | null;
  productTier?: string | null;
  productCode?: string | null;
  status?: string | null;
  hostingLabel?: string | null;
  sourceChannel?: string | null;
  simState?: E5SimState | null;
  simLastError?: string | null;
  simNextActionAt?: string | null;
  currentTask?: E5CurrentTask | null;
  maxDevicesPerUser?: number | null;
  hashrate?: number | string | null;
  dailyUsdt?: number | string | null;
  dailyNex?: number | string | null;
  monthlyTarget?: Omit<E5MonthlyTarget, "creditedUsdt" | "rangeLowUsdt" | "rangeHighUsdt" | "capacityPct"> & {
    creditedUsdt: number | string;
    rangeLowUsdt: number | string | null;
    rangeHighUsdt: number | string | null;
    capacityPct: number | string;
  } | null;
  lastSeenAt?: string | null;
  purchasedAt?: string | null;
  activatedAt?: string | null;
  deactivatedAt?: string | null;
  baseRate?: string | null;
  currentEfficiency?: number | string | null;
  pendingDeactivate?: number | string | boolean | null;
  runtimeStatus?: string | null;
  pausedReason?: string | null;
  activeTaskNo?: string | null;
  heartbeatAt?: string | null;
  heartbeatAgeSeconds?: number | string | null;
  batteryLevel?: number | string | null;
  isCharging?: number | string | boolean | null;
  networkReachable?: number | string | boolean | null;
  thermalState?: string | null;
  activeDevicesForUser?: number | string | null;
  userDeviceSlotNo?: number | string | null;
}

function toNumber(value: number | string | boolean | null | undefined, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toBool(value: boolean | string | number | null | undefined) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") return ["1", "true", "yes", "paused"].includes(value.trim().toLowerCase());
  return false;
}

function text(value: string | number | null | undefined, fallback = "") {
  const normalized = value == null ? "" : String(value).trim();
  return normalized || fallback;
}

function normalizeState(statusRaw: string | null | undefined, runtimeRaw: string | null | undefined, pendingDeactivate: boolean, activatedAt?: string | null, deactivatedAt?: string | null): E5DeviceState {
  const status = text(statusRaw).toUpperCase();
  const runtime = text(runtimeRaw).toUpperCase();
  if (pendingDeactivate) return "pending-deactivate";
  if (["RECYCLED", "DEACTIVATED", "RETIRED", "UNBOUND"].includes(status)) return "unbound";
  if (["INVENTORY", "PENDING", "PENDING_ACTIVATION", "INACTIVE"].includes(status)) return "inventory";
  if (!["ACTIVE", "ONLINE", "BUSY", "RUNNING", "OFFLINE"].includes(status)
      || !text(activatedAt) || text(deactivatedAt)) return "unknown";
  if (["ERROR", "ABNORMAL", "LOST"].includes(runtime)) return "abnormal";
  if (runtime === "OFFLINE") return "offline";
  if (runtime === "ONLINE") return status === "BUSY" ? "busy" : "active";
  return "unknown";
}

async function e5Request<T>(path: string, init?: RequestInit & { idempotencyKey?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const commandKey = init?.idempotencyKey ?? "";
  if (commandKey) {
    headers.set("Idempotency-Key", commandKey);
  }

  const { idempotencyKey: _key, ...requestInit } = init ?? {};
  let response: Response;
  try {
    response = await guardedFetch(`/api/admin/devices${path}`, {
      ...requestInit,
      headers,
      cache: "no-store",
    });
  } catch (cause) {
    if (commandKey) {
      throw new E5OutcomeUncertainError("E5_DEVICE_ACTION_OUTCOME_UNCERTAIN", commandKey, { cause });
    }
    throw cause;
  }
  if (commandKey && response.headers.get("X-Nexion-Upstream-Outcome")?.trim().toLowerCase() === "unknown") {
    throw new E5OutcomeUncertainError("E5_DEVICE_ACTION_OUTCOME_UNCERTAIN", commandKey);
  }
  const result = (await response.text().then(text => path.startsWith("/phones") ? parseE6DecimalJson(text) : JSON.parse(text)).catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    if (commandKey && outcomeStaysUnknown(response.status, result?.code)) {
      throw new E5OutcomeUncertainError(
        `E5_DEVICE_ACTION_OUTCOME_UNCERTAIN_${response.status}`,
        commandKey,
      );
    }
    throw Object.assign(new Error(formatAdminApiError(result?.message, `E5_REQUEST_FAILED_${response.status}`)), {
      status: response.ok && result && result.code >= 400 && result.code < 500 ? result.code : response.status, backendMessage: result?.message ?? "",
    });
  }
  if (commandKey && result.data == null) {
    throw new E5OutcomeUncertainError("E5_DEVICE_ACTION_OUTCOME_UNCERTAIN", commandKey);
  }

  return result.data as T;
}

function queryString(query: E5DeviceQuery) {
  const params = new URLSearchParams();
  for (const key of ["simState", "source", "productCode", "keyword"] as const) {
    const value = query[key]?.trim();
    if (value && value !== "all") params.set(key, value);
  }
  params.set("pageNum", String(query.pageNum ?? 1));
  params.set("pageSize", String(query.pageSize ?? 10));
  return `?${params}`;
}

export function mapE5Device(row: BackendDevice): E5Device {
  const deviceId = toNumber(row.id);
  const identity = parseE5DeviceIdentity(row.instanceNo, row.name, deviceId);
  const userId = text(row.userId);
  const userNo = text(row.userNo, userId ? `U${userId.padStart(8, "0")}` : "");
  const nickname = text(row.nickname, userId ? `user-${userId}` : "未绑定用户");
  const pendingDeactivate = toBool(row.pendingDeactivate);
  const productTier = text(row.productTier);
  const productCode = text(row.productCode);
  const sku = [productCode, productTier].filter(Boolean).join(" / ") || "未知 SKU";
  const slotNo = toNumber(row.userDeviceSlotNo);
  const dailyRate = parseE5DeviceDailyRate(row.dailyUsdt, row.dailyNex);
  const heartbeatAgeSeconds = toNumber(row.heartbeatAgeSeconds, Number.NaN);
  return {
    id: identity.id,
    deviceId,
    userId,
    userNo,
    nickname,
    user: userNo ? `${nickname} · ${userNo}` : nickname,
    deviceName: identity.deviceName,
    sku,
    productTier,
    productCode,
    serial: identity.serial,
    hostingLabel: row.hostingLabel ?? "",
    sourceChannel: row.sourceChannel ?? "",
    simState: row.simState ?? null,
    simLastError: row.simLastError ?? null,
    simNextActionAt: row.simNextActionAt ?? null,
    currentTask: row.currentTask ?? null,
    maxDevicesPerUser: row.maxDevicesPerUser ?? 6,
    state: normalizeState(row.status, row.runtimeStatus, pendingDeactivate, row.activatedAt, row.deactivatedAt),
    rawStatus: text(row.status, "UNKNOWN"),
    runtimeStatus: text(row.runtimeStatus, "UNKNOWN"),
    hashrate: toNumber(row.hashrate),
    dailyUsdt: dailyRate.dailyUsdt,
      dailyUsdtText: row.dailyUsdt == null ? null : String(row.dailyUsdt), dailyNexText: row.dailyNex == null ? null : String(row.dailyNex),
    dailyNex: dailyRate.dailyNex,
    monthlyTarget: row.monthlyTarget == null ? null : {
      ...row.monthlyTarget,
      creditedUsdt: row.monthlyTarget.creditedUsdt,
      rangeLowUsdt: row.monthlyTarget.rangeLowUsdt,
      rangeHighUsdt: row.monthlyTarget.rangeHighUsdt,
      capacityPct: Number(row.monthlyTarget.capacityPct),
    },
    activeTaskNo: text(row.activeTaskNo, "—"),
    heartbeatAt: text(row.heartbeatAt, "—"),
    heartbeatAgeSeconds: Number.isFinite(heartbeatAgeSeconds) && heartbeatAgeSeconds >= 0 ? heartbeatAgeSeconds : null,
    purchasedAt: text(row.purchasedAt, "—"),
    activatedAt: text(row.activatedAt, "—"),
    deactivatedAt: text(row.deactivatedAt, ""),
    baseRate: text(row.baseRate, "—"),
    currentEfficiency: toNumber(row.currentEfficiency, 1),
    batteryLevel: row.batteryLevel == null ? null : toNumber(row.batteryLevel),
    isCharging: row.isCharging == null ? null : toBool(row.isCharging),
    isWifiConnected: row.networkReachable == null ? null : toBool(row.networkReachable),
    thermalState: text(row.thermalState, "未采集"),
    pausedReason: text(row.pausedReason, ""),
    activeDevicesForUser: toNumber(row.activeDevicesForUser),
    pendingDeactivate,
    slotNo: slotNo > 0 ? slotNo : null,
    slot: slotNo > 0 ? String(slotNo) : "—",
  };
}

export function e5HeartbeatLagMinutes(ageSeconds: number | null | undefined): number | null {
  return typeof ageSeconds === "number" && Number.isFinite(ageSeconds) && ageSeconds >= 0 ? ageSeconds / 60 : null;
}

function mapDevices(records: BackendDevice[]) {
  return (records ?? []).map(mapE5Device);
}

export async function fetchE5Devices(query: E5DeviceQuery = {}, phones = false): Promise<E5DevicePage> {
  const page = parseE5DevicePage<PageResult<BackendDevice>>(
    await e5Request<unknown>(`${phones ? "/phones" : ""}${queryString(query)}`),
    phones,
  );
  return {
    total: toNumber(page.total),
    pageNum: toNumber(page.pageNum, query.pageNum ?? 1),
    pageSize: toNumber(page.pageSize, query.pageSize ?? 10),
    records: mapDevices(page.records ?? []),
  };
}

export async function fetchE5Overview(): Promise<E5Overview> {
  return parseE5Overview<E5Overview>(await e5Request<unknown>("/overview"));
}
export async function fetchE5Observability(): Promise<E5Observability> {
  return parseE5Observability(await e5Request<unknown>("/observability"));
}

export async function activateE5Device(deviceId: number, force: boolean, reason: string, operator: string, originalCommandKey?: string) {
  const action = force ? "force-activate" : "activate";
  const body = { reason, operator };
  const request = (commandKey: string) => e5Request<BackendDevice>(`/${encodeURIComponent(String(deviceId))}/${action}`, { method: "POST", body: JSON.stringify(body), idempotencyKey: commandKey });
  const saved = originalCommandKey ? await request(originalCommandKey) : await e5StableDeviceCommand(
    `e5-device:${deviceId}:${action}`,
    JSON.stringify(body),
    commandKey => e5Request<BackendDevice>(`/${encodeURIComponent(String(deviceId))}/${action}`, {
      method: "POST",
      body: JSON.stringify(body),
      idempotencyKey: commandKey,
    }),
  );
  if (originalCommandKey && Number(saved.id) !== deviceId) throw new E5OutcomeUncertainError("设备操作回执无法核对，结果仍未确认。", originalCommandKey);
  return mapDevices([saved])[0];
}

export async function deactivateE5Device(deviceId: number, unbind: boolean, reason: string, operator: string, originalCommandKey?: string) {
  const action = unbind ? "unbind" : "deactivate";
  const body = { reason, operator };
  const request = (commandKey: string) => e5Request<BackendDevice>(`/${encodeURIComponent(String(deviceId))}/${action}`, { method: "POST", body: JSON.stringify(body), idempotencyKey: commandKey });
  const saved = originalCommandKey ? await request(originalCommandKey) : await e5StableDeviceCommand(
    `e5-device:${deviceId}:${action}`,
    JSON.stringify(body),
    commandKey => e5Request<BackendDevice>(`/${encodeURIComponent(String(deviceId))}/${action}`, {
      method: "POST",
      body: JSON.stringify(body),
      idempotencyKey: commandKey,
    }),
  );
  if (originalCommandKey && Number(saved.id) !== deviceId) throw new E5OutcomeUncertainError("设备操作回执无法核对，结果仍未确认。", originalCommandKey);
  return mapDevices([saved])[0];
}

export async function setE5UserDevicesPaused(userId: number, paused: boolean, reason: string, operator: string, originalCommandKey?: string) {
  const action = paused ? "pause" : "resume";
  const body = { userId, reason, operator };
  if (originalCommandKey) {
    const result = await e5Request<{ userId: number; changedCount: number; paused: boolean }>(`/batch/${action}`, { method: "POST", body: JSON.stringify(body), idempotencyKey: originalCommandKey });
    if (result.userId !== userId || !Number.isSafeInteger(result.changedCount) || result.changedCount < 0 || result.paused !== paused)
      throw new E5OutcomeUncertainError("用户设备操作回执无法核对，结果仍未确认。", originalCommandKey);
    return result;
  }
  return e5StableDeviceCommand(
    `e5-user:${userId}:${action}`,
    JSON.stringify(body),
    commandKey => e5Request<{ userId: number; changedCount: number; paused: boolean }>(`/batch/${action}`, {
      method: "POST",
      body: JSON.stringify(body),
      idempotencyKey: commandKey,
    }),
  );
}

export async function fetchLegacyUnknownCandidate(deviceId: number, signal?: AbortSignal) {
  return parseLegacyUnknownCandidate(await e5Request<unknown>(`/legacy-unknown-resolutions/${deviceId}`, { signal }), deviceId);
}

export async function proposeLegacyUnknownCancellation(candidate: LegacyUnknownCandidate, reason: string) {
  if (!candidate.eligible || !candidate.proofSha || !candidate.caseId || reason.trim().length < 8 || reason.trim().length > 200)
    throw new Error("LEGACY_UNKNOWN_PROPOSAL_INVALID");
  const body = { reason: reason.trim(), proofSha: candidate.proofSha };
  // A reason edit never turns an uncertain proposal into a new command; backend payload binding still applies.
  const fingerprint = JSON.stringify([candidate.caseId, candidate.proofSha, candidate.backendInstanceId]);
  return e5StableDeviceCommand(`legacy-unknown:${candidate.deviceId}:${candidate.caseId}`, fingerprint, async commandKey => {
    const ticket = await e5Request<{ id: string }>(`/legacy-unknown-resolutions/${candidate.deviceId}/proposals`, {
      method: "POST", body: JSON.stringify(body), idempotencyKey: commandKey,
    });
    if (!ticket || typeof ticket.id !== "string" || !ticket.id.trim())
      throw new E5OutcomeUncertainError("提案提交结果未确认，请保持内容不变重试，或到 A2 核对原提案。", commandKey);
    return ticket;
  });
}
