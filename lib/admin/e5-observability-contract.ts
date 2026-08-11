export interface E5Observability {
  telemetry: {
    heartbeatLost1h: number;
    reconnectEvents24h: number;
    persistentOffline1h: number;
    activeTasks: number;
    avgGpuUsagePct: number | null;
    avgGpuPowerW: number | null;
    avgCpuUsagePct: number | null;
    dispatchLatencyP95Ms: number | null;
    dispatchLatencySampleCount: number;
    latestRuntimeAt: string | null;
  };
  activity: Array<{
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    occurredAt: string;
  }>;
  sources: string[];
  missingMetrics: string[];
}

function invalid(path: string): never {
  throw new Error(`E5_OBSERVABILITY_SCHEMA_INVALID:${path}`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(path);
  return value as Record<string, unknown>;
}

function count(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return invalid(path);
  return value;
}

function metric(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return invalid(path);
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) return invalid(path);
  return value.trim();
}

function timestamp(value: unknown, path: string): string {
  const normalized = nonEmptyString(value, path);
  if (!Number.isFinite(Date.parse(normalized))) return invalid(path);
  return normalized;
}

function nullableTimestamp(value: unknown, path: string): string | null {
  return value === null ? null : timestamp(value, path);
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) return invalid(path);
  return value.map((item, index) => nonEmptyString(item, `${path}[${index}]`));
}

/**
 * The E5 observability response is operational evidence, so it is deliberately
 * not permissively coerced. A malformed HTTP 200 is unavailable evidence, not
 * a healthy zero or an empty activity stream.
 */
export function parseE5Observability(value: unknown): E5Observability {
  const root = object(value, "root");
  const telemetry = object(root.telemetry, "telemetry");
  if (!Array.isArray(root.activity)) return invalid("activity");

  return {
    telemetry: {
      heartbeatLost1h: count(telemetry.heartbeatLost1h, "telemetry.heartbeatLost1h"),
      reconnectEvents24h: count(telemetry.reconnectEvents24h, "telemetry.reconnectEvents24h"),
      persistentOffline1h: count(telemetry.persistentOffline1h, "telemetry.persistentOffline1h"),
      activeTasks: count(telemetry.activeTasks, "telemetry.activeTasks"),
      avgGpuUsagePct: metric(telemetry.avgGpuUsagePct, "telemetry.avgGpuUsagePct"),
      avgGpuPowerW: metric(telemetry.avgGpuPowerW, "telemetry.avgGpuPowerW"),
      avgCpuUsagePct: metric(telemetry.avgCpuUsagePct, "telemetry.avgCpuUsagePct"),
      dispatchLatencyP95Ms: metric(telemetry.dispatchLatencyP95Ms, "telemetry.dispatchLatencyP95Ms"),
      dispatchLatencySampleCount: count(telemetry.dispatchLatencySampleCount, "telemetry.dispatchLatencySampleCount"),
      latestRuntimeAt: nullableTimestamp(telemetry.latestRuntimeAt, "telemetry.latestRuntimeAt"),
    },
    activity: root.activity.map((entry, index) => {
      const row = object(entry, `activity[${index}]`);
      return {
        eventType: nonEmptyString(row.eventType, `activity[${index}].eventType`),
        aggregateType: nonEmptyString(row.aggregateType, `activity[${index}].aggregateType`),
        aggregateId: nonEmptyString(row.aggregateId, `activity[${index}].aggregateId`),
        occurredAt: timestamp(row.occurredAt, `activity[${index}].occurredAt`),
      };
    }),
    sources: stringArray(root.sources, "sources"),
    missingMetrics: stringArray(root.missingMetrics, "missingMetrics"),
  };
}
