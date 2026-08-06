import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

interface BackendA3FeatureFlag {
  key?: string | null;
  name?: string | null;
  desc?: string | null;
  status?: string | null;
  scope?: string | null;
  lastChange?: string | null;
  resourceOwner?: string | null;
  allowedValues?: string[] | null;
  writable?: boolean | null;
  category?: string | null;
  consumer?: string | null;
}

interface BackendA3KillSwitch {
  key?: string | null;
  name?: string | null;
  status?: string | null;
  up?: boolean | null;
  lastChange?: string | null;
  chain?: string | null;
}

interface BackendA3SystemHealth {
  name?: string | null;
  tone?: string | null;
  metric?: string | null;
  observedAt?: string | null;
  source?: string | null;
  stale?: boolean | null;
}

interface BackendA3Stats {
  flagCount?: number | string | null;
  flagOnCount?: number | string | null;
  killGates?: number | string | null;
  killGatesUp?: number | string | null;
}

interface BackendA3Overview {
  featureFlags?: BackendA3FeatureFlag[] | null;
  killSwitches?: BackendA3KillSwitch[] | null;
  systemHealth?: BackendA3SystemHealth[] | null;
  stats?: BackendA3Stats | null;
}

export interface A3FeatureFlag {
  key: string;
  name: string;
  desc: string;
  status: string;
  scope: string;
  lastChange: string;
  resourceOwner: string;
  allowedValues: string[];
  writable: boolean;
  category: string;
  consumer: string;
}

export interface A3KillSwitch {
  key: string;
  name: string;
  status: string;
  up: boolean;
  lastChange: string;
  chain: string;
}

export interface A3SystemHealth {
  name: string;
  tone: "ok" | "warn" | "bad";
  metric: string;
  observedAt: string;
  source: string;
  stale: boolean;
}

export interface A3Stats {
  flagCount: number;
  flagOnCount: number;
  killGates: number;
  killGatesUp: number;
}

export interface A3Overview {
  featureFlags: A3FeatureFlag[];
  killSwitches: A3KillSwitch[];
  systemHealth: A3SystemHealth[];
  stats: A3Stats;
}

export class A3OutcomeUncertainError extends Error {
  constructor(message: string, public readonly commandKey: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "A3OutcomeUncertainError";
  }
}

export class A3ReadbackFailedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "A3ReadbackFailedError";
  }
}

export function isA3OutcomeUncertainError(error: unknown): error is A3OutcomeUncertainError {
  return error instanceof A3OutcomeUncertainError;
}

export function isA3ReadbackFailedError(error: unknown): error is A3ReadbackFailedError {
  return error instanceof A3ReadbackFailedError;
}

export interface A3RuntimeFlags {
  maintenanceBanner: boolean;
  configured: boolean;
  value: string;
  source: string;
  observedAt: string;
}

let requestSeq = 0;

function idempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

function asText(value: unknown, fallback = "—") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function toNumber(value: number | string | null | undefined, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function normalizeTone(value: string | null | undefined): A3SystemHealth["tone"] {
  const normalized = value?.trim().toLowerCase();
  return normalized === "ok" || normalized === "warn" || normalized === "bad" ? normalized : "bad";
}

function normalizeGateUp(row: BackendA3KillSwitch) {
  if (typeof row.up === "boolean") return row.up;
  const status = row.status?.trim().toLowerCase();
  return status === "enabled" || status === "on" || status === "true" || status === "空列表 · 无封锁";
}

function normalizeFeature(row: BackendA3FeatureFlag): A3FeatureFlag {
  const key = asText(row.key, "");
  const status = asText(row.status, "");
  const allowedValues = (row.allowedValues ?? []).filter((value) => typeof value === "string" && value.trim());
  if (!key || !status || !allowedValues.includes(status)) {
    throw new Error("A3_RESPONSE_INVALID");
  }
  return {
    key,
    name: asText(row.name, key),
    desc: asText(row.desc, "—"),
    status,
    scope: asText(row.scope, "全量"),
    lastChange: asText(row.lastChange, "—"),
    resourceOwner: asText(row.resourceOwner, "超管"),
    allowedValues,
    writable: row.writable === true,
    category: asText(row.category, "UNKNOWN"),
    consumer: asText(row.consumer, "未声明"),
  };
}

function normalizeGate(row: BackendA3KillSwitch): A3KillSwitch {
  const key = asText(row.key, "unknown");
  return {
    key,
    name: asText(row.name, key),
    status: asText(row.status, "disabled"),
    up: normalizeGateUp(row),
    lastChange: asText(row.lastChange, "—"),
    chain: asText(row.chain, "system / config"),
  };
}

function normalizeOverview(data: BackendA3Overview | null | undefined): A3Overview {
  const featureFlags = (data?.featureFlags ?? []).map(normalizeFeature);
  const killSwitches = (data?.killSwitches ?? []).map(normalizeGate);
  const systemHealth = (data?.systemHealth ?? []).map((row) => ({
    name: asText(row.name),
    tone: normalizeTone(row.tone),
    metric: asText(row.metric),
    observedAt: asText(row.observedAt, "未知"),
    source: asText(row.source, "未声明"),
    stale: row.stale !== false,
  }));
  const stats = data?.stats ?? {};
  return {
    featureFlags,
    killSwitches,
    systemHealth,
    stats: {
      flagCount: toNumber(stats.flagCount, featureFlags.length),
      flagOnCount: toNumber(stats.flagOnCount, featureFlags.filter((flag) => flag.status === "on").length),
      killGates: toNumber(stats.killGates, killSwitches.length),
      killGatesUp: toNumber(stats.killGatesUp, killSwitches.filter((gate) => gate.up).length),
    },
  };
}

async function a3Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }) {
  const headers = new Headers(init?.headers);
  let commandKey = "";
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.idempotencyPrefix) {
    commandKey = idempotencyKey(init.idempotencyPrefix);
    headers.set("Idempotency-Key", commandKey);
  }

  const request = () => guardedFetch(`/api/admin/platform${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  let response: Response;
  try {
    response = await request();
  } catch (error) {
    if (!init?.idempotencyPrefix) throw error;
    // The same header value is reused so a lost mutation response cannot create a second write/audit row.
    try {
      response = await request();
    } catch (retryError) {
      throw new A3OutcomeUncertainError("A3_MUTATION_OUTCOME_UNCERTAIN", commandKey, { cause: retryError });
    }
  }
  if (init?.idempotencyPrefix
    && response.headers.get("X-Nexion-Upstream-Outcome")?.trim().toLowerCase() === "unknown") {
    throw new A3OutcomeUncertainError("A3_MUTATION_OUTCOME_UNCERTAIN", commandKey);
  }
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    if (init?.idempotencyPrefix && response.ok && !result) {
      throw new A3OutcomeUncertainError("A3_MUTATION_RESPONSE_UNREADABLE", commandKey);
    }
    // 5xx 不是确定失败:后端可能已经落库,弃号重试 = 第二条命令(统一口径见 outcome-classification.ts)。
    if (init?.idempotencyPrefix && outcomeStaysUnknown(response.status, result?.code)) {
      throw new A3OutcomeUncertainError(`A3_MUTATION_OUTCOME_UNCERTAIN_${response.status}`, commandKey);
    }
    if (isAdminAuthFailure(response.status, result?.message)) {
      resetAdminSession();
    }
    throw new Error(formatAdminApiError(result?.message, `A3_REQUEST_FAILED_${response.status}`));
  }

  return result.data as T;
}

export async function fetchA3Overview() {
  return normalizeOverview(await a3Request<BackendA3Overview>("/config/overview"));
}

export async function updateA3FeatureFlag(flagKey: string, value: string, expectedValue: string, reason: string, operator: string) {
  await a3Request("/config", {
    method: "PUT",
    body: JSON.stringify({
      kind: "flag",
      flagKey,
      value,
      expectedValue,
      reason,
      operator,
    }),
    idempotencyPrefix: "a3-flag",
  });
  try {
    return await fetchA3Overview();
  } catch (error) {
    throw new A3ReadbackFailedError("A3_WRITE_COMMITTED_READBACK_FAILED", { cause: error });
  }
}

export async function fetchA3RuntimeFlags(): Promise<A3RuntimeFlags> {
  const data = await a3Request<Partial<A3RuntimeFlags>>("/flags/runtime");
  return {
    maintenanceBanner: data?.maintenanceBanner === true,
    configured: data?.configured === true,
    value: asText(data?.value, ""),
    source: asText(data?.source, "未声明"),
    observedAt: asText(data?.observedAt, "未知"),
  };
}
