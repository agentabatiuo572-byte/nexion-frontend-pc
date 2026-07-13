import { formatAdminApiError } from "@/lib/admin/error-messages";
import type { AuditLog, Device, HealthReport, Strategy } from "@/lib/admin/janus-c2/types";

type ApiResult<T> = { code?: number; message?: string; data?: T };
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

export type DryRun = {
  evaluated: number;
  hit: number;
  recommend: number;
  filtered: number;
  takeover: number;
  other: number;
  conflicts: number;
  hitRate: number;
  dryRunId: string;
  configHash: string;
  expectedVersion: number;
};

const BASE = "/api/admin/janus";

function idempotencyKey() {
  return `k6-${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

function query(params: Record<string, unknown>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  });
  return search.size ? `?${search.toString()}` : "";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  if (init?.method && !["GET", "HEAD"].includes(init.method)) headers.set("Idempotency-Key", idempotencyKey());
  const options = { ...init, headers, cache: "no-store" as const };
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, options);
  } catch {
    // A timed-out request may already have committed server-side. Retry once
    // with the exact same Idempotency-Key so the stored first result is returned.
    response = await fetch(`${BASE}${path}`, options);
  }
  const text = await response.text();
  let payload: ApiResult<T> = {};
  try {
    payload = text ? (JSON.parse(text) as ApiResult<T>) : {};
  } catch {
    throw new Error(`JANUS_API_INVALID_RESPONSE_${response.status}`);
  }
  if (!response.ok || (payload.code !== undefined && payload.code >= 400)) {
    throw new Error(formatAdminApiError(payload.message, `JANUS_API_${response.status}`));
  }
  return payload.data as T;
}

function device(row: Device & { lockVersion?: number }): Device {
  const maturity = (row.maturity ?? {}) as Partial<Device["maturity"]>;
  const environment = (row.environment ?? {}) as Partial<Device["environment"]>;
  return {
    ...row,
    maturity: {
      appOpenCount: 0, sessionCount: 0, repeatStreakDays: 0, foregroundDurationSeconds: 0,
      benchmarkViewed: false, optimizeDone: false, marketViewed: false, walletViewed: false,
      ...maturity,
    },
    environment: {
      environmentRiskScore: row.environmentRiskScore ?? 0, riskReasons: [], isHeadless: false,
      automationSignalCount: 0, fpBlocklistHit: false, screenAnomaly: false,
      timezoneMismatch: false, languageMismatch: false,
      ...environment,
    },
    tags: Array.isArray(row.tags) ? row.tags : [],
    version: row.version ?? row.lockVersion ?? 0,
  };
}

function strategy(row: Strategy): Strategy {
  return { ...row, versions: Array.isArray(row.versions) ? row.versions : [] };
}

export async function fetchK6Devices(params: DeviceQuery = {}): Promise<AdminPage<Device>> {
  const page = await request<AdminPage<Device>>(`/devices${query({ pageNum: 1, pageSize: 200, ...params })}`);
  return { ...page, records: (page.records ?? []).map(device) };
}

/**
 * K6 dashboard and strategy preview need the whole authoritative device set.
 * The backend remains paginated; pages are drained in small batches instead of
 * silently treating the first 200 rows as the complete business table.
 */
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
  return records;
}

export async function fetchK6Device(sid: string) {
  return device(await request<Device>(`/devices/${encodeURIComponent(sid)}`));
}

export async function fetchK6Strategies() {
  return (await request<Strategy[]>("/strategies")).map(strategy);
}

export async function fetchK6Audit(limit = 200) {
  return request<AuditLog[]>(`/audit${query({ limit })}`);
}

export async function fetchK6Health() {
  const report = await request<HealthReport & { indicators?: Array<HealthReport["indicators"][number] & { value: unknown }> }>("/health");
  return {
    ...report,
    indicators: (report.indicators ?? []).map((indicator) => ({
      ...indicator,
      value: `${String(indicator.value)}${indicator.note === "%" || indicator.note === "台" ? indicator.note : ""}`,
    })),
    reasons: Array.isArray(report.reasons) ? report.reasons : [],
    suggestions: Array.isArray(report.suggestions) ? report.suggestions : [],
  } satisfies HealthReport;
}

export async function updateK6DeviceStatus(sid: string, body: StatusChange) {
  return device(await request<Device>(`/devices/${encodeURIComponent(sid)}/status`, {
    method: "POST",
    body: JSON.stringify(body),
  }));
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

export async function saveK6Strategy(value: Strategy, reason: string, forceCreate = false) {
  const isNew = forceCreate || !value.strategyId || value.strategyId.startsWith("draft_");
  return strategy(await request<Strategy>(isNew ? "/strategies" : `/strategies/${encodeURIComponent(value.strategyId)}`, {
    method: isNew ? "POST" : "PUT",
    body: JSON.stringify(strategyPayload(value, reason)),
  }));
}

export async function runK6DryRun(strategyId: string, expectedVersion: number, reason: string) {
  return request<DryRun>(`/strategies/${encodeURIComponent(strategyId)}/dry-run`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion, reason, note: reason }),
  });
}

export async function changeK6StrategyStatus(strategyId: string, action: "publish" | "pause" | "archive", body: StrategyAction) {
  return strategy(await request<Strategy>(`/strategies/${encodeURIComponent(strategyId)}/${action}`, {
    method: "POST",
    body: JSON.stringify(body),
  }));
}

export async function rollbackK6Strategy(strategyId: string, body: StrategyAction) {
  return strategy(await request<Strategy>(`/strategies/${encodeURIComponent(strategyId)}/rollback`, {
    method: "POST",
    body: JSON.stringify(body),
  }));
}

export async function deleteK6Strategy(strategyId: string, expectedVersion: number, reason: string) {
  await request<void>(`/strategies/${encodeURIComponent(strategyId)}`, {
    method: "DELETE",
    body: JSON.stringify({ expectedVersion, reason, note: reason }),
  });
}

export async function recordK6Export(reportType: "health" | "audit" | "funnel", format: "csv" | "json", filters: Record<string, unknown>) {
  return request<{ fileName: string; format: string; data: unknown }>("/exports", {
    method: "POST",
    body: JSON.stringify({ reportType, format, filters }),
  });
}
