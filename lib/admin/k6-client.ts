import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import {
  normalizeK6Audit,
  normalizeK6Audits,
  normalizeK6Dashboard,
  normalizeK6Device,
  normalizeK6DevicePage,
  normalizeK6DryRun,
  normalizeK6ExportFile,
  normalizeK6Health,
  normalizeK6Strategies,
  normalizeK6Strategy,
} from "@/lib/admin/k6-contract";
import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";
import type {
  AuditLog,
  Device,
  HealthReport,
  K6DashboardSnapshot,
  K6ExportFile,
  Strategy,
} from "@/lib/admin/janus-c2/types";
import {
  normalizeK6RemoteTarget,
  normalizeK6RemoteTargetOrigins,
  normalizeK6RemoteTargets,
  type K6RemoteTarget,
} from "@/lib/admin/k6-remote-target-contract";

type ApiResult = { code?: unknown; message?: unknown; data?: unknown };
export type AdminPage<T> = { total: number; pageNum: number; pageSize: number; records: T[] };

export type DeviceQuery = {
  q?: string;
  status?: string;
  riskBand?: string;
  channel?: string;
  strategyId?: string;
  pageNum?: number;
  pageSize?: number;
};

export type StatusChange = {
  targetStatus: string;
  reasonCategory: string;
  reasonText: string;
  effectiveTiming: "immediate" | "session_edge";
  expireAt?: number;
  remoteUrlKey?: string;
  remoteTargetVersion?: number;
  remoteTargetCatalogVersion?: number;
  confirmationMode: "standard" | "strong_single";
  expectedDeviceVersion: number;
};

export type StrategyAction = {
  note?: string;
  reason?: string;
  targetVersion?: number;
  expectedVersion: number;
  dryRunId?: string;
  configHash?: string;
};

export type DryRun = ReturnType<typeof normalizeK6DryRun>;
export type K6RemoteTargetCreate = {
  remoteTargetKey: string;
  label: string;
  url: string;
  ownerId: string;
  expectedLatestVersion: number;
  reason: string;
  impact: string;
};
export type K6RemoteTargetDisable = {
  expectedVersion: number;
  expectedCatalogVersion: number;
  reason: string;
  impact: string;
};
type Normalizer<T> = (value: unknown) => T;

const BASE = "/api/admin/janus";
/** K6 远端写入命令号:落 sessionStorage,刷新后重试仍是同一号,后端才能去重。
 *  fingerprint = writeFingerprint(method, path, body) —— path 带目标对象 id,method + path 区分动作类型。 */
export const pendingWriteKeys = createPendingMutationStore({
  storageKey: "nexion-admin-k6-janus-write-commands-v1",
});

function readInvalidResponseError() {
  return new Error(formatAdminApiError("K6_RESPONSE_INVALID", "K6_RESPONSE_INVALID"));
}

export class K6OutcomeUncertainError extends Error {
  readonly commandKey: string;

  constructor(commandKey: string, detail?: string) {
    super(`本次写入结果未知，请先刷新核对；若确需重试，请保持内容不变。请求号：${commandKey}${detail ? `（${detail}）` : ""}`);
    this.name = "K6OutcomeUncertainError";
    this.commandKey = commandKey;
  }
}

export function newK6CommandKey() {
  return `k6-${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

export function writeFingerprint(method: string, path: string, body?: BodyInit | null) {
  return `${method.toUpperCase()} ${path}\n${typeof body === "string" ? body : ""}`;
}

function query(params: Record<string, unknown>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  });
  return search.size ? `?${search.toString()}` : "";
}

function parseEnvelope(raw: string, status: number): ApiResult {
  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    throw readInvalidResponseError();
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw readInvalidResponseError();
  }
  return payload as ApiResult;
}

async function request<T>(path: string, init: RequestInit | undefined, normalize: Normalizer<T>, commandKey?: string): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const isWrite = !["GET", "HEAD"].includes(method);
  const fingerprint = writeFingerprint(method, path, init?.body);
  const stableCommandKey = isWrite ? commandKey ?? pendingWriteKeys.get(fingerprint) ?? newK6CommandKey() : "";
  if (isWrite) pendingWriteKeys.remember(fingerprint, stableCommandKey);

  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  if (isWrite) headers.set("Idempotency-Key", stableCommandKey);
  const options = { ...init, headers, cache: "no-store" as const };

  let response: Response;
  try {
    try {
      response = await guardedFetch(`${BASE}${path}`, options);
    } catch {
      // A timed-out request may already have committed. The single transport
      // retry deliberately reuses the exact same idempotency key.
      response = await guardedFetch(`${BASE}${path}`, options);
    }
  } catch {
    if (isWrite) throw new K6OutcomeUncertainError(stableCommandKey, "网络中断");
    throw new Error("K6 数据读取失败，数据未更新");
  }

  if (isWrite && response.headers.get("X-Nexion-Upstream-Outcome") === "unknown") {
    throw new K6OutcomeUncertainError(stableCommandKey, "上游结果未知");
  }

  let raw: string;
  try {
    raw = await response.text();
  } catch {
    if (isWrite) throw new K6OutcomeUncertainError(stableCommandKey, "响应传输中断");
    throw new Error("K6 数据读取失败，响应未完整接收");
  }
  let payload: ApiResult;
  try {
    payload = parseEnvelope(raw, response.status);
  } catch (error) {
    if (isWrite && response.ok) throw new K6OutcomeUncertainError(stableCommandKey, "服务端回包无法确认");
    throw error;
  }

  if (!response.ok || (typeof payload.code === "number" && payload.code !== 0)) {
    if (isWrite) pendingWriteKeys.forget(fingerprint);
    const message = typeof payload.message === "string" ? payload.message : undefined;
    throw new Error(formatAdminApiError(message, `JANUS_API_${response.status}`));
  }

  const hasData = Object.prototype.hasOwnProperty.call(payload, "data");
  const validMessage = payload.message === undefined || typeof payload.message === "string";
  if (payload.code !== 0 || !hasData || !validMessage) {
    if (isWrite) throw new K6OutcomeUncertainError(stableCommandKey, "成功响应契约不完整");
    throw readInvalidResponseError();
  }

  let result: T;
  try {
    result = normalize(payload.data);
  } catch (error) {
    if (isWrite) throw new K6OutcomeUncertainError(stableCommandKey, "响应字段不完整");
    throw readInvalidResponseError();
  }
  if (isWrite) pendingWriteKeys.forget(fingerprint);
  return result;
}

const acceptVoid = (value: unknown) => {
  if (value !== undefined && value !== null) throw new Error("K6_RESPONSE_INVALID:janus.void");
  return undefined;
};

export async function fetchK6Devices(params: DeviceQuery = {}): Promise<AdminPage<Device>> {
  return request(`/devices${query({ pageNum: 1, pageSize: 200, ...params })}`, undefined, normalizeK6DevicePage);
}

export async function fetchAllK6Devices(): Promise<Device[]> {
  const first = await fetchK6Devices({ pageNum: 1, pageSize: 200 });
  const pageCount = Math.ceil(first.total / first.pageSize);
  const records = [...first.records];
  for (let start = 2; start <= pageCount; start += 4) {
    const pages = await Promise.all(
      Array.from({ length: Math.min(4, pageCount - start + 1) }, (_, index) =>
        fetchK6Devices({ pageNum: start + index, pageSize: first.pageSize }),
      ),
    );
    pages.forEach((page) => records.push(...page.records));
  }
  if (records.length !== first.total) throw readInvalidResponseError();
  return records;
}

export function fetchK6Dashboard(): Promise<K6DashboardSnapshot> {
  return request("/dashboard", undefined, normalizeK6Dashboard);
}

export function fetchK6Device(sid: string): Promise<Device> {
  return request(`/devices/${encodeURIComponent(sid)}`, undefined, normalizeK6Device);
}

export function fetchK6Strategies(): Promise<Strategy[]> {
  return request("/strategies", undefined, normalizeK6Strategies);
}

export function fetchK6Audit(limit = 200): Promise<AuditLog[]> {
  return request(`/audit${query({ limit })}`, undefined, normalizeK6Audits);
}

export function fetchK6Health(): Promise<HealthReport> {
  return request("/health", undefined, normalizeK6Health);
}

export function fetchK6RemoteTargets(): Promise<K6RemoteTarget[]> {
  return request("/remote-targets", undefined, normalizeK6RemoteTargets);
}

export function fetchK6RemoteTargetOrigins(): Promise<string[]> {
  return request("/remote-targets/origins", undefined, normalizeK6RemoteTargetOrigins);
}

export function createK6RemoteTargetVersion(body: K6RemoteTargetCreate): Promise<K6RemoteTarget> {
  return request("/remote-targets", {
    method: "POST",
    body: JSON.stringify(body),
  }, normalizeK6RemoteTarget);
}

export function disableK6RemoteTarget(
  key: string,
  version: number,
  body: K6RemoteTargetDisable,
): Promise<K6RemoteTarget> {
  return request(`/remote-targets/${encodeURIComponent(key)}/${version}/disable`, {
    method: "POST",
    body: JSON.stringify(body),
  }, normalizeK6RemoteTarget);
}

export function updateK6DeviceStatus(sid: string, body: StatusChange): Promise<Device> {
  return request(`/devices/${encodeURIComponent(sid)}/status`, {
    method: "POST",
    body: JSON.stringify(body),
  }, normalizeK6Device);
}

function strategyPayload(value: Strategy, reason: string) {
  return {
    name: value.name,
    description: value.description,
    priority: value.priority,
    owner: value.owner,
    scope: value.scope,
    ruleTree: value.ruleTree,
    action: value.action,
    safeguards: value.safeguards,
    rollout: value.rollout ?? {},
    healthConfig: value.healthConfig ?? {},
    templateKey: value.templateKey,
    expectedVersion: value.lockVersion ?? 0,
    reason,
  };
}

export function saveK6Strategy(value: Strategy, reason: string, forceCreate = false): Promise<Strategy> {
  const isNew = forceCreate || !value.strategyId || value.strategyId.startsWith("draft_");
  return request(isNew ? "/strategies" : `/strategies/${encodeURIComponent(value.strategyId)}`, {
    method: isNew ? "POST" : "PUT",
    body: JSON.stringify(strategyPayload(value, reason)),
  }, normalizeK6Strategy);
}

export function runK6DryRun(strategyId: string, expectedVersion: number, reason: string): Promise<DryRun> {
  return request(`/strategies/${encodeURIComponent(strategyId)}/dry-run`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion, reason, note: reason }),
  }, normalizeK6DryRun);
}

export function changeK6StrategyStatus(strategyId: string, action: "publish" | "pause" | "archive", body: StrategyAction): Promise<Strategy> {
  return request(`/strategies/${encodeURIComponent(strategyId)}/${action}`, {
    method: "POST",
    body: JSON.stringify(body),
  }, normalizeK6Strategy);
}

export function rollbackK6Strategy(strategyId: string, body: StrategyAction): Promise<Strategy> {
  return request(`/strategies/${encodeURIComponent(strategyId)}/rollback`, {
    method: "POST",
    body: JSON.stringify(body),
  }, normalizeK6Strategy);
}

export function deleteK6Strategy(strategyId: string, expectedVersion: number, reason: string): Promise<void> {
  return request(`/strategies/${encodeURIComponent(strategyId)}`, {
    method: "DELETE",
    body: JSON.stringify({ expectedVersion, reason, note: reason }),
  }, acceptVoid);
}

export function recordK6Export(reportType: "health" | "audit" | "funnel", format: "csv" | "json", filters: Record<string, unknown>): Promise<K6ExportFile> {
  return request("/exports", {
    method: "POST",
    body: JSON.stringify({ reportType, format, filters }),
  }, (value) => normalizeK6ExportFile(value, reportType, format));
}

export { normalizeK6Audit };
