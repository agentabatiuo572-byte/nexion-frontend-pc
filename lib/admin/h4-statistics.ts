import { f4Decimal } from "./f4-money";

export type H4WheelAwards = {
  basis: string;
  spinDate?: string;
  available: boolean;
  reason?: string;
  amountBasis?: string;
  byAsset: Record<string, { count: number; realOutflowCount?: number | null; amount: string | null }>;
};

export type H4Statistics = {
  wheelAwardsToday?: H4WheelAwards | null;
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
  if (raw.wheelAwardsToday !== undefined) {
    if (raw.wheelAwardsToday === null) result.wheelAwardsToday = null;
    else {
      const awards = object(raw.wheelAwardsToday);
      if (typeof awards.basis !== "string" || typeof awards.available !== "boolean"
        || awards.spinDate !== undefined && (typeof awards.spinDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(awards.spinDate))
        || awards.reason !== undefined && typeof awards.reason !== "string"
        || awards.amountBasis !== undefined && typeof awards.amountBasis !== "string") throw new Error("H4_RESPONSE_INVALID");
      result.wheelAwardsToday = {
        basis: awards.basis, available: awards.available, spinDate: awards.spinDate as string | undefined,
        reason: awards.reason as string | undefined, amountBasis: awards.amountBasis as string | undefined,
        byAsset: Object.fromEntries(Object.entries(object(awards.byAsset)).map(([asset, value]) => {
          const award = object(value);
          if (!Number.isSafeInteger(award.count) || Number(award.count) < 0) throw new Error("H4_RESPONSE_INVALID");
          if (award.realOutflowCount != null && (!Number.isSafeInteger(award.realOutflowCount) || Number(award.realOutflowCount) < 0)) throw new Error("H4_RESPONSE_INVALID");
          return [asset, { count: award.count as number, realOutflowCount: award.realOutflowCount as number | null | undefined, amount: decimal(award.amount) }];
        })),
      };
    }
  }
  return result;
}
