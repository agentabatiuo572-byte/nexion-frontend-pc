import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError } from "@/lib/admin/error-messages";

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
}

interface BackendA3Stats {
  flagCount?: number | string | null;
  flagGrayCount?: number | string | null;
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
}

export interface A3Stats {
  flagCount: number;
  flagGrayCount: number;
  killGates: number;
  killGatesUp: number;
}

export interface A3Overview {
  featureFlags: A3FeatureFlag[];
  killSwitches: A3KillSwitch[];
  systemHealth: A3SystemHealth[];
  stats: A3Stats;
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
  return normalized === "warn" || normalized === "bad" ? normalized : "ok";
}

function normalizeGateUp(row: BackendA3KillSwitch) {
  if (typeof row.up === "boolean") return row.up;
  const status = row.status?.trim().toLowerCase();
  return status === "enabled" || status === "on" || status === "true" || status === "空列表 · 无封锁";
}

function normalizeFeature(row: BackendA3FeatureFlag): A3FeatureFlag {
  const key = asText(row.key, "unknown");
  return {
    key,
    name: asText(row.name, key),
    desc: asText(row.desc, "—"),
    status: asText(row.status, "off"),
    scope: asText(row.scope, "全量"),
    lastChange: asText(row.lastChange, "—"),
    resourceOwner: asText(row.resourceOwner, "超管"),
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
  }));
  const stats = data?.stats ?? {};
  return {
    featureFlags,
    killSwitches,
    systemHealth,
    stats: {
      flagCount: toNumber(stats.flagCount, featureFlags.length),
      flagGrayCount: toNumber(stats.flagGrayCount, featureFlags.filter((flag) => flag.status.includes("灰度")).length),
      killGates: toNumber(stats.killGates, killSwitches.length),
      killGatesUp: toNumber(stats.killGatesUp, killSwitches.filter((gate) => gate.up).length),
    },
  };
}

async function a3Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.idempotencyPrefix) {
    headers.set("Idempotency-Key", idempotencyKey(init.idempotencyPrefix));
  }

  const response = await fetch(`/api/admin/platform${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
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

export async function updateA3FeatureFlag(flagKey: string, value: string, reason: string, operator: string) {
  await a3Request("/config", {
    method: "PUT",
    body: JSON.stringify({
      kind: "flag",
      flagKey,
      value,
      reason,
      operator,
    }),
    idempotencyPrefix: "a3-flag",
  });
  return fetchA3Overview();
}
