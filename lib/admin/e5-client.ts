import { formatAdminApiError } from "@/lib/admin/error-messages";

export const E5_MAX_DEVICES = 6;

export type E5DeviceState = "active" | "busy" | "offline" | "inventory" | "unbound" | "abnormal";
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
  slot: string;
  state: E5DeviceState;
  rawStatus: string;
  runtimeStatus: string;
  hashrate: number;
  dailyUsdt: number;
  dailyNex: number;
  activeTaskNo: string;
  heartbeatAt: string;
  activatedAt: string;
  deactivatedAt: string;
  pendingDeactivate: boolean;
}

export interface E5Datacenter {
  dcLocation: string;
  regionLabel: string;
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
}

export interface E5DatacenterInput {
  dcLocation: string;
  regionLabel: string;
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
  datacenters: E5Datacenter[];
}

export interface E5DeviceQuery {
  status?: string;
  dcLocation?: string;
  keyword?: string;
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
  activatedAt?: string | null;
  deactivatedAt?: string | null;
  pendingDeactivate?: number | string | boolean | null;
  runtimeStatus?: string | null;
  gpuUsage?: number | string | null;
  gpuTempC?: number | string | null;
  gpuPowerW?: number | string | null;
  pausedReason?: string | null;
  activeTaskNo?: string | null;
  heartbeatAt?: string | null;
}

interface BackendDatacenter {
  dcLocation?: string | null;
  regionLabel?: string | null;
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
}

interface BackendOverview {
  totalDevices?: number | string | null;
  onlineDevices?: number | string | null;
  offlineDevices?: number | string | null;
  recycledDevices?: number | string | null;
  pendingRecycleDevices?: number | string | null;
  abnormalDevices?: number | string | null;
  datacenters?: BackendDatacenter[] | null;
}

let requestSeq = 0;

function idempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
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

function normalizeState(statusRaw: string | null | undefined, runtimeRaw: string | null | undefined, pendingDeactivate: boolean): E5DeviceState {
  const status = text(statusRaw).toUpperCase();
  const runtime = text(runtimeRaw).toUpperCase();
  if (["RECYCLED", "DEACTIVATED", "RETIRED"].includes(status) || pendingDeactivate) return "unbound";
  if (["INVENTORY", "PENDING", "PENDING_ACTIVATION", "INACTIVE"].includes(status)) return "inventory";
  if (["ERROR", "ABNORMAL", "LOST"].includes(runtime)) return "abnormal";
  if (status === "BUSY") return "busy";
  if (status === "ONLINE") return "active";
  if (status === "OFFLINE") return "offline";
  return "offline";
}

async function e5Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }) {
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
    throw new Error(formatAdminApiError(result?.message, `E5_REQUEST_FAILED_${response.status}`));
  }

  return result.data as T;
}

function queryString(query: E5DeviceQuery) {
  const params = new URLSearchParams();
  if (query.status && query.status !== "all") params.set("status", query.status);
  if (query.dcLocation && query.dcLocation !== "all") params.set("dcLocation", query.dcLocation);
  if (query.keyword?.trim()) params.set("keyword", query.keyword.trim());
  params.set("pageNum", String(query.pageNum ?? 1));
  params.set("pageSize", String(query.pageSize ?? 10));
  const raw = params.toString();
  return raw ? `?${raw}` : "";
}

function fromDatacenter(row: BackendDatacenter): E5Datacenter {
  const status = text(row.status, "active").toLowerCase();
  return {
    dcLocation: text(row.dcLocation, "UNASSIGNED"),
    regionLabel: text(row.regionLabel, "未配置区域"),
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
  };
}

function fromDevice(row: BackendDevice, slot: string): E5Device {
  const deviceId = toNumber(row.id);
  const instanceNo = text(row.instanceNo, deviceId ? `dev-${deviceId}` : "unknown-device");
  const userId = text(row.userId);
  const userNo = text(row.userNo, userId ? `U${userId.padStart(8, "0")}` : "");
  const nickname = text(row.nickname, userId ? `user-${userId}` : "未绑定用户");
  const pendingDeactivate = toBool(row.pendingDeactivate);
  const productTier = text(row.productTier);
  const productCode = text(row.productCode);
  const deviceName = text(row.name, instanceNo);
  const sku = [productCode, productTier].filter(Boolean).join(" / ") || "未知 SKU";
  return {
    id: instanceNo,
    deviceId,
    userId,
    userNo,
    nickname,
    user: userNo ? `${nickname} · ${userNo}` : nickname,
    deviceName,
    sku,
    productTier,
    productCode,
    serial: instanceNo,
    dc: text(row.dcLocation, "UNASSIGNED"),
    slot,
    state: normalizeState(row.status, row.runtimeStatus, pendingDeactivate),
    rawStatus: text(row.status, "UNKNOWN"),
    runtimeStatus: text(row.runtimeStatus, "UNKNOWN"),
    hashrate: toNumber(row.hashrate),
    dailyUsdt: toNumber(row.dailyUsdt),
    dailyNex: toNumber(row.dailyNex),
    activeTaskNo: text(row.activeTaskNo, "—"),
    heartbeatAt: text(row.heartbeatAt || row.lastSeenAt, "—"),
    activatedAt: text(row.activatedAt, "—"),
    deactivatedAt: text(row.deactivatedAt, ""),
    pendingDeactivate,
  };
}

function mapDevices(records: BackendDevice[]) {
  const slotsByUser = new Map<string, number>();
  return (records ?? []).map((row) => {
    const userKey = text(row.userNo || row.userId, "unassigned");
    const slotNo = (slotsByUser.get(userKey) ?? 0) + 1;
    slotsByUser.set(userKey, slotNo);
    return fromDevice(row, `${Math.min(slotNo, E5_MAX_DEVICES)}/${E5_MAX_DEVICES}`);
  });
}

export async function fetchE5Devices(query: E5DeviceQuery = {}): Promise<E5DevicePage> {
  const page = await e5Request<PageResult<BackendDevice>>(queryString(query));
  return {
    total: toNumber(page.total),
    pageNum: toNumber(page.pageNum, query.pageNum ?? 1),
    pageSize: toNumber(page.pageSize, query.pageSize ?? 10),
    records: mapDevices(page.records ?? []),
  };
}

export async function fetchE5Overview(): Promise<E5Overview> {
  const overview = await e5Request<BackendOverview>("/overview");
  return {
    totalDevices: toNumber(overview.totalDevices),
    onlineDevices: toNumber(overview.onlineDevices),
    offlineDevices: toNumber(overview.offlineDevices),
    recycledDevices: toNumber(overview.recycledDevices),
    pendingRecycleDevices: toNumber(overview.pendingRecycleDevices),
    abnormalDevices: toNumber(overview.abnormalDevices),
    datacenters: (overview.datacenters ?? []).map(fromDatacenter),
  };
}

export async function fetchE5Datacenters(): Promise<E5Datacenter[]> {
  const rows = await e5Request<BackendDatacenter[]>("/datacenters");
  return (rows ?? []).map(fromDatacenter);
}

export async function activateE5Device(deviceId: number, reason: string, operator: string) {
  const saved = await e5Request<BackendDevice>(`/${encodeURIComponent(String(deviceId))}/restore`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "e5-device-activate",
  });
  return mapDevices([saved])[0];
}

export async function deactivateE5Device(deviceId: number, reason: string, operator: string) {
  const saved = await e5Request<BackendDevice>("/e3/tradein/deactivate", {
    method: "POST",
    body: JSON.stringify({ deviceId, reason, operator }),
    idempotencyPrefix: "e5-device-deactivate",
  });
  return mapDevices([saved])[0];
}

export async function setE5DatacenterPaused(dcLocation: string, paused: boolean, reason: string, operator: string) {
  return e5Request<E5Overview>(`/datacenters/${encodeURIComponent(dcLocation)}/${paused ? "pause" : "resume"}`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: paused ? "e5-dc-pause" : "e5-dc-resume",
  });
}

export async function createE5Datacenter(input: E5DatacenterInput, reason: string, operator: string) {
  const saved = await e5Request<BackendDatacenter>("/datacenters", {
    method: "POST",
    body: JSON.stringify({ ...input, reason, operator }),
    idempotencyPrefix: "e5-dc-create",
  });
  return fromDatacenter(saved);
}

export async function updateE5Datacenter(dcLocation: string, input: E5DatacenterInput, reason: string, operator: string) {
  const saved = await e5Request<BackendDatacenter>(`/datacenters/${encodeURIComponent(dcLocation)}`, {
    method: "PATCH",
    body: JSON.stringify({ ...input, reason, operator }),
    idempotencyPrefix: "e5-dc-update",
  });
  return fromDatacenter(saved);
}

export async function deleteE5Datacenter(dcLocation: string, reason: string, operator: string) {
  return e5Request<{ dcLocation: string; deleted: boolean }>(`/datacenters/${encodeURIComponent(dcLocation)}`, {
    method: "DELETE",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "e5-dc-delete",
  });
}
