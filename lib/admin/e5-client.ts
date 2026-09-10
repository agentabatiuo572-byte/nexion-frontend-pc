import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import {
  parseE5DatacenterRows,
  parseE5DevicePage,
  parseE5Overview,
} from "@/lib/admin/e456-overview-contract";
import { parseE5DeviceDailyRate } from "@/lib/admin/e5-device-rate";
import { parseE5DeviceIdentity } from "@/lib/admin/e5-device-identity";
import { parseE5Observability, type E5Observability } from "@/lib/admin/e5-observability-contract";
import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import {
  E5OutcomeUncertainError,
  e5StableDeviceCommand,
} from "@/lib/admin/e5-stable-device-command";

export type { E5Observability } from "@/lib/admin/e5-observability-contract";

export type E5DeviceState = "active" | "busy" | "offline" | "inventory" | "pending-deactivate" | "unbound" | "abnormal" | "unknown";
export type E5DatacenterStatus = "active" | "maintenance" | "disabled";

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
  dc: string;
  state: E5DeviceState;
  rawStatus: string;
  runtimeStatus: string;
  hashrate: number;
  dailyUsdt: number | null;
  dailyNex: number | null;
  activeTaskNo: string;
  heartbeatAt: string;
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

export interface E5Datacenter {
  dcLocation: string;
  regionLabel: string;
  location: string;
  displayName: string;
  status: E5DatacenterStatus;
  sortOrder: number;
  totalDevices: number;
  onlineDevices: number;
  pendingRecycleDevices: number;
  abnormalDevices: number;
  avgGpuUsage: number;
  avgGpuTempC: number;
  avgGpuPowerW: number;
  dispatchPaused: boolean;
  pausedReason: string;
  onlineSeries: number[];
}

export interface E5DatacenterInput {
  dcLocation: string;
  regionLabel: string;
  location: string;
  displayName: string;
  status: E5DatacenterStatus;
  sortOrder: number;
}

export interface E5Overview {
  totalDevices: number;
  onlineDevices: number;
  offlineDevices: number;
  recycledDevices: number;
  pendingRecycleDevices: number;
  abnormalDevices: number;
  maxDevicesPerUser: number | null;
  datacenters: E5Datacenter[];
}

export interface E5DeviceQuery {
  status?: string;
  dcLocation?: string;
  keyword?: string;
  userId?: number;
  kind?: string;
  heartbeat?: string;
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
  dcLocation?: string | null;
  hashrate?: number | string | null;
  dailyUsdt?: number | string | null;
  dailyNex?: number | string | null;
  lastSeenAt?: string | null;
  purchasedAt?: string | null;
  activatedAt?: string | null;
  deactivatedAt?: string | null;
  baseRate?: string | null;
  currentEfficiency?: number | string | null;
  pendingDeactivate?: number | string | boolean | null;
  runtimeStatus?: string | null;
  gpuUsage?: number | string | null;
  gpuTempC?: number | string | null;
  gpuPowerW?: number | string | null;
  pausedReason?: string | null;
  activeTaskNo?: string | null;
  heartbeatAt?: string | null;
  batteryLevel?: number | string | null;
  isCharging?: number | string | boolean | null;
  networkReachable?: number | string | boolean | null;
  thermalState?: string | null;
  activeDevicesForUser?: number | string | null;
  userDeviceSlotNo?: number | string | null;
}

interface BackendDatacenter {
  dcLocation?: string | null;
  regionLabel?: string | null;
  location?: string | null;
  displayName?: string | null;
  status?: string | null;
  sortOrder?: number | string | null;
  totalDevices?: number | string | null;
  onlineDevices?: number | string | null;
  pendingRecycleDevices?: number | string | null;
  abnormalDevices?: number | string | null;
  avgGpuUsage?: number | string | null;
  avgGpuTempC?: number | string | null;
  avgGpuPowerW?: number | string | null;
  dispatchPaused?: boolean | string | number | null;
  pausedReason?: string | null;
  onlineSeries?: unknown;
}

interface BackendOverview {
  totalDevices?: number | string | null;
  onlineDevices?: number | string | null;
  offlineDevices?: number | string | null;
  recycledDevices?: number | string | null;
  pendingRecycleDevices?: number | string | null;
  abnormalDevices?: number | string | null;
  maxDevicesPerUser?: number | string | null;
  datacenters?: BackendDatacenter[] | null;
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
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    if (commandKey && outcomeStaysUnknown(response.status, result?.code)) {
      throw new E5OutcomeUncertainError(
        `E5_DEVICE_ACTION_OUTCOME_UNCERTAIN_${response.status}`,
        commandKey,
      );
    }
    throw new Error(formatAdminApiError(result?.message, `E5_REQUEST_FAILED_${response.status}`));
  }
  if (commandKey && result.data == null) {
    throw new E5OutcomeUncertainError("E5_DEVICE_ACTION_OUTCOME_UNCERTAIN", commandKey);
  }

  return result.data as T;
}

function queryString(query: E5DeviceQuery) {
  const params = new URLSearchParams();
  if (query.status && query.status !== "all") params.set("status", query.status);
  if (query.dcLocation && query.dcLocation !== "all") params.set("dcLocation", query.dcLocation);
  if (query.keyword?.trim()) params.set("keyword", query.keyword.trim());
  if (query.userId && query.userId > 0) params.set("userId", String(query.userId));
  if (query.kind && query.kind !== "all") params.set("kind", query.kind);
  if (query.heartbeat && query.heartbeat !== "all") params.set("heartbeat", query.heartbeat);
  params.set("pageNum", String(query.pageNum ?? 1));
  params.set("pageSize", String(query.pageSize ?? 10));
  const raw = params.toString();
  return raw ? `?${raw}` : "";
}

function fromDatacenter(row: BackendDatacenter): E5Datacenter {
  const status = text(row.status, "active").toLowerCase();
  const onlineSeries = Array.isArray(row.onlineSeries)
    ? row.onlineSeries.map((value) => toNumber(value as number | string | boolean | null | undefined)).filter((value) => value >= 0)
    : [];
  return {
    dcLocation: text(row.dcLocation, "UNASSIGNED"),
    regionLabel: text(row.regionLabel, "未配置区域"),
    location: text(row.location || row.regionLabel, "未配置所在地"),
    displayName: text(row.displayName || row.regionLabel, "未配置展示名"),
    status: status === "maintenance" || status === "disabled" ? status : "active",
    sortOrder: toNumber(row.sortOrder, 100),
    totalDevices: toNumber(row.totalDevices),
    onlineDevices: toNumber(row.onlineDevices),
    pendingRecycleDevices: toNumber(row.pendingRecycleDevices),
    abnormalDevices: toNumber(row.abnormalDevices),
    avgGpuUsage: toNumber(row.avgGpuUsage),
    avgGpuTempC: toNumber(row.avgGpuTempC),
    avgGpuPowerW: toNumber(row.avgGpuPowerW),
    dispatchPaused: toBool(row.dispatchPaused),
    pausedReason: text(row.pausedReason, ""),
    onlineSeries,
  };
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
    dc: text(row.dcLocation, "UNASSIGNED"),
    state: normalizeState(row.status, row.runtimeStatus, pendingDeactivate, row.activatedAt, row.deactivatedAt),
    rawStatus: text(row.status, "UNKNOWN"),
    runtimeStatus: text(row.runtimeStatus, "UNKNOWN"),
    hashrate: toNumber(row.hashrate),
    dailyUsdt: dailyRate.dailyUsdt,
    dailyNex: dailyRate.dailyNex,
    activeTaskNo: text(row.activeTaskNo, "—"),
    heartbeatAt: text(row.heartbeatAt || row.lastSeenAt, "—"),
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

function mapDevices(records: BackendDevice[]) {
  return (records ?? []).map(mapE5Device);
}

export async function fetchE5Devices(query: E5DeviceQuery = {}): Promise<E5DevicePage> {
  const page = parseE5DevicePage<PageResult<BackendDevice>>(
    await e5Request<unknown>(queryString(query)),
  );
  return {
    total: toNumber(page.total),
    pageNum: toNumber(page.pageNum, query.pageNum ?? 1),
    pageSize: toNumber(page.pageSize, query.pageSize ?? 10),
    records: mapDevices(page.records ?? []),
  };
}

export async function fetchE5Overview(): Promise<E5Overview> {
  const overview = parseE5Overview<BackendOverview>(await e5Request<unknown>("/overview"));
  return {
    totalDevices: toNumber(overview.totalDevices),
    onlineDevices: toNumber(overview.onlineDevices),
    offlineDevices: toNumber(overview.offlineDevices),
    recycledDevices: toNumber(overview.recycledDevices),
    pendingRecycleDevices: toNumber(overview.pendingRecycleDevices),
    abnormalDevices: toNumber(overview.abnormalDevices),
    maxDevicesPerUser: toNumber(overview.maxDevicesPerUser) > 0 ? toNumber(overview.maxDevicesPerUser) : null,
    datacenters: (overview.datacenters ?? []).map(fromDatacenter),
  };
}

export async function fetchE5Observability(): Promise<E5Observability> {
  return parseE5Observability(await e5Request<unknown>("/observability"));
}

export async function fetchE5Datacenters(): Promise<E5Datacenter[]> {
  const rows = parseE5DatacenterRows<BackendDatacenter[]>(
    await e5Request<unknown>("/datacenters"),
  );
  return (rows ?? []).map(fromDatacenter);
}

export async function activateE5Device(deviceId: number, force: boolean, reason: string, operator: string) {
  const action = force ? "force-activate" : "activate";
  const body = { reason, operator };
  const saved = await e5StableDeviceCommand(
    `e5-device:${deviceId}:${action}`,
    JSON.stringify(body),
    commandKey => e5Request<BackendDevice>(`/${encodeURIComponent(String(deviceId))}/${action}`, {
      method: "POST",
      body: JSON.stringify(body),
      idempotencyKey: commandKey,
    }),
  );
  return mapDevices([saved])[0];
}

export async function deactivateE5Device(deviceId: number, unbind: boolean, reason: string, operator: string) {
  const action = unbind ? "unbind" : "deactivate";
  const body = { reason, operator };
  const saved = await e5StableDeviceCommand(
    `e5-device:${deviceId}:${action}`,
    JSON.stringify(body),
    commandKey => e5Request<BackendDevice>(`/${encodeURIComponent(String(deviceId))}/${action}`, {
      method: "POST",
      body: JSON.stringify(body),
      idempotencyKey: commandKey,
    }),
  );
  return mapDevices([saved])[0];
}

export async function setE5UserDevicesPaused(userId: number, paused: boolean, reason: string, operator: string) {
  const action = paused ? "pause" : "resume";
  const body = { userId, reason, operator };
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

export async function setE5DatacenterPaused(dcLocation: string, paused: boolean, reason: string, operator: string) {
  const action = paused ? "pause" : "resume";
  const body = { reason, operator };
  return e5StableDeviceCommand(
    `e5-datacenter:${dcLocation}:${action}`,
    JSON.stringify(body),
    commandKey => e5Request<E5Overview>(`/datacenters/${encodeURIComponent(dcLocation)}/${action}`, {
      method: "POST",
      body: JSON.stringify(body),
      idempotencyKey: commandKey,
    }),
  );
}

export async function createE5Datacenter(input: E5DatacenterInput, reason: string, operator: string) {
  const body = { ...input, reason, operator };
  const saved = await e5StableDeviceCommand(
    "e5-datacenter:create",
    JSON.stringify(body),
    commandKey => e5Request<BackendDatacenter>("/datacenters", {
      method: "POST",
      body: JSON.stringify(body),
      idempotencyKey: commandKey,
    }),
  );
  return fromDatacenter(saved);
}

export async function updateE5Datacenter(dcLocation: string, input: E5DatacenterInput, reason: string, operator: string) {
  const body = { ...input, reason, operator };
  const saved = await e5StableDeviceCommand(
    `e5-datacenter:${dcLocation}:update`,
    JSON.stringify(body),
    commandKey => e5Request<BackendDatacenter>(`/datacenters/${encodeURIComponent(dcLocation)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      idempotencyKey: commandKey,
    }),
  );
  return fromDatacenter(saved);
}

export async function deleteE5Datacenter(dcLocation: string, reason: string, operator: string) {
  const body = { reason, operator };
  return e5StableDeviceCommand(
    `e5-datacenter:${dcLocation}:delete`,
    JSON.stringify(body),
    commandKey => e5Request<{ dcLocation: string; deleted: boolean }>(`/datacenters/${encodeURIComponent(dcLocation)}`, {
      method: "DELETE",
      body: JSON.stringify(body),
      idempotencyKey: commandKey,
    }),
  );
}
