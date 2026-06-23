export const E5_MAX_DEVICES = 6;

export type E5DeviceState = "active" | "busy" | "offline" | "inventory" | "unbound" | "abnormal";

export interface E5Device {
  id: string;
  deviceId: number;
  user: string;
  sku: string;
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
    throw new Error(result?.message || `E5_REQUEST_FAILED_${response.status}`);
  }

  return result.data as T;
}

function queryString(query: E5DeviceQuery) {
  const params = new URLSearchParams();
  if (query.status && query.status !== "all") params.set("status", query.status);
  if (query.dcLocation && query.dcLocation !== "all") params.set("dcLocation", query.dcLocation);
  if (query.keyword?.trim()) params.set("keyword", query.keyword.trim());
  params.set("pageNum", String(query.pageNum ?? 1));
  params.set("pageSize", String(query.pageSize ?? 100));
  const raw = params.toString();
  return raw ? `?${raw}` : "";
}

function fromDatacenter(row: BackendDatacenter): E5Datacenter {
  return {
    dcLocation: text(row.dcLocation, "UNASSIGNED"),
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
  const userId = text(row.userId, "unassigned");
  const pendingDeactivate = toBool(row.pendingDeactivate);
  const productTier = text(row.productTier);
  const productCode = text(row.productCode);
  return {
    id: instanceNo,
    deviceId,
    user: userId === "unassigned" ? "—" : `uid:${userId}`,
    sku: text(row.name, productTier || productCode || "未知设备"),
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
    const userKey = text(row.userId, "unassigned");
    const slotNo = (slotsByUser.get(userKey) ?? 0) + 1;
    slotsByUser.set(userKey, slotNo);
    return fromDevice(row, `${Math.min(slotNo, E5_MAX_DEVICES)}/${E5_MAX_DEVICES}`);
  });
}

export async function fetchE5Devices(query: E5DeviceQuery = {}) {
  const page = await e5Request<PageResult<BackendDevice>>(queryString(query));
  return mapDevices(page.records ?? []);
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
