import { f4Decimal } from "./f4-money";

export type H4Statistics = {
  wheelEvUsd?: string | null;
  wheelEvByAsset?: Record<string, string | null> | null;
  h4Stats?: Record<string, unknown> & {
    wheelSpinsToday?: number | null;
    wheelSpinsTodayBasis?: string | null;
    regionRestrictionCount?: number | null;
    regionRestrictionsAvailable?: boolean | null;
    regionRestrictionsReason?: string | null;
  };
};

/** Keep monetary JSON tokens before JSON.parse converts them to floating point. */
export function parseH4StatisticsJson(text: string): unknown {
  return JSON.parse(text.replace(/("(?:wheelEvUsd|amount|realPayoutUsdt)"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"')
    .replace(/"wheelEvByAsset"\s*:\s*\{[^{}]*\}/g, map => map.replace(/(:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"')));
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("H4_RESPONSE_INVALID");
  return value as Record<string, unknown>;
}
function decimal(value: unknown): string | null {
  if (value == null) return null;
  const result = typeof value === "string" || typeof value === "number" ? f4Decimal(value) : null;
  if (result === null || result.startsWith("-")) throw new Error("H4_RESPONSE_INVALID");
  return result;
}

/** New projections are optional on old backends; unavailable values never become zero. */
export function readH4Statistics(raw: Record<string, unknown>): H4Statistics {
  const result: H4Statistics = {};
  if (raw.wheelEvUsd !== undefined) result.wheelEvUsd = decimal(raw.wheelEvUsd);
  if (raw.wheelEvByAsset !== undefined) result.wheelEvByAsset = raw.wheelEvByAsset === null ? null
    : Object.fromEntries(Object.entries(object(raw.wheelEvByAsset)).map(([asset, value]) => [asset, decimal(value)]));
  if (raw.h4Stats !== undefined) {
    const stats = object(raw.h4Stats);
    for (const key of ["wheelSpinsToday", "regionRestrictionCount"]) {
      if (stats[key] != null && (!Number.isSafeInteger(stats[key]) || Number(stats[key]) < 0)) throw new Error("H4_RESPONSE_INVALID");
    }
    for (const key of ["wheelSpinsTodayBasis", "regionRestrictionsReason"]) {
      if (stats[key] != null && typeof stats[key] !== "string") throw new Error("H4_RESPONSE_INVALID");
    }
    if (stats.regionRestrictionsAvailable != null && typeof stats.regionRestrictionsAvailable !== "boolean") throw new Error("H4_RESPONSE_INVALID");
    result.h4Stats = stats;
  }
  return result;
}
