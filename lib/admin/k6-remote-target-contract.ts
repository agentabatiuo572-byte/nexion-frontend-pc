export type K6RemoteTargetStatus = "ACTIVE" | "DISABLED";

export type K6RemoteTarget = {
  catalogVersion: number;
  remoteTargetKey: string;
  remoteTargetVersion: number;
  status: K6RemoteTargetStatus;
  label: string;
  url: string;
  origin: string;
  source: "ADMIN";
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  changeReason: string;
  impact: string;
  lockVersion: number;
  strategyCount: number;
  pendingCommandCount: number;
  cancelledCommandCount: number;
};

function invalid(path: string): never {
  throw new Error(`K6_RESPONSE_INVALID:janus.remoteTargets.${path}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(path);
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string, max = 1024): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) invalid(path);
  return value;
}

function integer(value: unknown, path: string, min = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) invalid(path);
  return value;
}

export function normalizeK6RemoteTarget(value: unknown): K6RemoteTarget {
  const row = record(value, "item");
  const status = text(row.status, "status", 16);
  if (status !== "ACTIVE" && status !== "DISABLED") invalid("status");
  const source = text(row.source, "source", 16);
  if (source !== "ADMIN") invalid("source");
  const url = text(row.url, "url");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    invalid("url");
  }
  if (parsed.protocol !== "https:") invalid("url");
  const origin = text(row.origin, "origin", 320);
  if (parsed.origin !== origin) invalid("origin");
  const remoteTargetKey = text(row.remoteTargetKey, "remoteTargetKey", 64);
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(remoteTargetKey)) invalid("remoteTargetKey");
  return {
    catalogVersion: integer(row.catalogVersion, "catalogVersion", 1),
    remoteTargetKey,
    remoteTargetVersion: integer(row.remoteTargetVersion, "remoteTargetVersion", 1),
    status,
    label: text(row.label, "label", 96),
    url,
    origin,
    source,
    ownerId: text(row.ownerId, "ownerId", 96),
    createdAt: integer(row.createdAt, "createdAt"),
    updatedAt: integer(row.updatedAt, "updatedAt"),
    updatedBy: text(row.updatedBy, "updatedBy", 96),
    changeReason: text(row.changeReason, "changeReason", 500),
    impact: text(row.impact, "impact", 500),
    lockVersion: integer(row.lockVersion, "lockVersion"),
    strategyCount: integer(row.strategyCount, "strategyCount"),
    pendingCommandCount: integer(row.pendingCommandCount, "pendingCommandCount"),
    cancelledCommandCount: integer(row.cancelledCommandCount, "cancelledCommandCount"),
  };
}

export function normalizeK6RemoteTargets(value: unknown): K6RemoteTarget[] {
  if (!Array.isArray(value)) invalid("list");
  return value.map(normalizeK6RemoteTarget);
}

export function normalizeK6RemoteTargetOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) invalid("origins");
  return value.map((item, index) => {
    const origin = text(item, `origins.${index}`, 320);
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      invalid(`origins.${index}`);
    }
    if (parsed.protocol !== "https:" || parsed.origin !== origin || parsed.pathname !== "/") {
      invalid(`origins.${index}`);
    }
    return origin;
  });
}
