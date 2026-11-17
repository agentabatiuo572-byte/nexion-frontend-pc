import { f4Decimal } from "./f4-money";

/** H5's wire boundary; nullable statistics and retired-business availability stay nullable. */
export type CheckInRule = { key: string; name: string; sub?: string; cur: string; hot?: boolean | number; configurable?: boolean; writeBlockedReason?: string };
export type StreakMilestone = { id: number; day: string; reward: string; kind?: string };
export type PowerUp = { id: number; day: number; label: string; sub?: string; downstream?: string | null; note?: string; effectType?: string; businessAvailable?: boolean | null };
export type EarnMilestone = { id: number; key: string; threshold: string; nex: string; weekTrigger?: number | null };
export type H5StatisticBasis = {
  source: string; windowType: string; window: string | null; aggregate: string; condition: string;
  denominator: string | null; unit: string | null; availability: string; fallback?: string | null;
};
export type H5Model = {
  stats: { statBasis?: Record<string, H5StatisticBasis> | null; todaySign?: number | null; signRate?: string | null; lucky15Actual?: string | null; lucky2Actual?: string | null; lucky15Config?: string | null; lucky2Config?: string | null; weekRevive?: number | null; weekMsTrigger?: number | null; weekMsNex?: string | null };
  rules: CheckInRule[];
  streakMilestones: StreakMilestone[];
  streakDistribution: { day: string; count: number; height: number }[];
  powerUps: PowerUp[];
  earnMilestones: EarnMilestone[];
  tickInterval: { value: string; seconds: number; min: number; max: number; note: string };
  coverage: { coverageRatio: string | null; redlinePct: string | null; reliable: boolean; redlineBreached: boolean };
};

/** 2c900ce6: retired keys are rejected before creating a new direct write or proposal. */
export function h5RuleWriteRefusal(key: string): "RETIRED_FEATURE" | undefined {
  return key === "interval" ? "RETIRED_FEATURE" : undefined;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("H5_RESPONSE_INVALID");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("H5_RESPONSE_INVALID");
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("H5_RESPONSE_INVALID");
  return value;
}
function decimal(value: unknown, signed = false): string {
  if ((typeof value !== "string" && typeof value !== "number") || !(signed ? /^-?\d+(?:\.\d+)?$/ : /^\d+(?:\.\d+)?$/).test(String(value))) throw new Error("H5_RESPONSE_INVALID");
  return String(value);
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("H5_RESPONSE_INVALID");
  return value;
}

export function parseH5Model(value: unknown): H5Model {
  const data = object(value);
  const rows = (key: string) => {
    if (!Array.isArray(data[key])) throw new Error("H5_RESPONSE_INVALID");
    return data[key].map(object);
  };
  const stats = object(data.stats);
  const coverage = object(data.coverage);
  const tick = object(data.tickInterval);
  const optionalText = (key: string) => stats[key] == null ? null : string(stats[key]);
  const optionalCount = (key: string) => stats[key] == null ? null : integer(stats[key]);
  const statBasis = stats.statBasis == null ? stats.statBasis as null | undefined
    : Object.fromEntries(Object.entries(object(stats.statBasis)).map(([key, value]) => {
      const row = object(value);
      return [key, {
        source: string(row.source), windowType: string(row.windowType), aggregate: string(row.aggregate),
        condition: string(row.condition), availability: string(row.availability),
        window: row.window == null ? null : string(row.window),
        denominator: row.denominator == null ? null : string(row.denominator),
        unit: row.unit == null ? null : string(row.unit),
        fallback: row.fallback == null ? row.fallback as null | undefined : string(row.fallback),
      }];
    }));
  const ruleRows = rows("rules");
  const optionalConfig = (key: "lucky15Config" | "lucky2Config", ruleKey: "p15" | "p2") => {
    const value = optionalText(key);
    if (value !== "0%" || !statBasis?.[key]?.fallback?.startsWith("ZERO_FALLBACK")) return value;
    // The new metadata explicitly admits zero on read failure. Only a readable
    // zero rule can establish that this zero is a configuration value.
    const rule = ruleRows.find(row => row.key === ruleKey);
    const raw = typeof rule?.cur === "string" ? f4Decimal(rule.cur.trim().replace(/[%,]/g, "")) : null;
    return raw !== null && /^0(?:\.0*)?$/.test(raw) ? value : null;
  };
  return {
    stats: {
      statBasis,
      todaySign: optionalCount("todaySign"), signRate: optionalText("signRate"),
      lucky15Actual: optionalText("lucky15Actual"), lucky2Actual: optionalText("lucky2Actual"),
      lucky15Config: optionalConfig("lucky15Config", "p15"), lucky2Config: optionalConfig("lucky2Config", "p2"),
      weekRevive: optionalCount("weekRevive"), weekMsTrigger: optionalCount("weekMsTrigger"), weekMsNex: optionalText("weekMsNex"),
    },
    rules: ruleRows.map(r => ({ key: string(r.key), name: string(r.name), sub: string(r.sub), cur: string(r.cur),
      hot: typeof r.hot === "boolean" ? r.hot : integer(r.hot),
      configurable: r.configurable === undefined ? undefined : bool(r.configurable),
      writeBlockedReason: r.writeBlockedReason === undefined ? undefined : string(r.writeBlockedReason) })),
    streakMilestones: rows("streakMilestones").map(r => ({ id: integer(r.id), day: string(r.day), reward: string(r.reward), kind: string(r.kind) })),
    streakDistribution: rows("streakDistribution").map(r => ({ day: string(r.day), count: integer(r.count), height: integer(r.height) })),
    powerUps: rows("powerUps").map(r => ({ id: integer(r.id), day: integer(r.day), label: string(r.label),
      sub: r.sub == null ? undefined : string(r.sub), downstream: r.downstream == null ? null : string(r.downstream),
      note: string(r.note), effectType: string(r.effectType), businessAvailable: r.businessAvailable == null ? null : bool(r.businessAvailable) })),
    earnMilestones: rows("earnMilestones").map(r => ({ id: integer(r.id), key: string(r.key), threshold: decimal(r.threshold), nex: decimal(r.nex), weekTrigger: r.weekTrigger == null ? null : integer(r.weekTrigger) })),
    tickInterval: { value: string(tick.value), seconds: integer(tick.seconds), min: integer(tick.min), max: integer(tick.max), note: string(tick.note) },
    coverage: { coverageRatio: coverage.coverageRatio == null ? null : decimal(coverage.coverageRatio, true), redlinePct: coverage.redlinePct == null ? null : decimal(coverage.redlinePct, true), reliable: bool(coverage.reliable), redlineBreached: bool(coverage.redlineBreached) },
  };
}

/** Exact comparison for the six-decimal configuration amounts; never round input. */
export function h5Amount(value: string): bigint | undefined {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return undefined;
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (fraction.length > 6) return undefined;
  return BigInt(match[1]) * BigInt(1000000) + BigInt(fraction.padEnd(6, "0"));
}

export function h5WholeReward(value: string) {
  // Matches positiveWholeReward: +2 and 2.0 are integral, 0 and 2.1 are not. No digit extraction.
  const amount = h5Amount(value.trim().replace(/^\+/, ""));
  return amount !== undefined && amount > BigInt(0) && amount <= BigInt(100000000000) && amount % BigInt(1000000) === BigInt(0);
}

export function h5StreakReward(value: string): { type: string; amount?: bigint; issue?: string } {
  const text = value.trim().toUpperCase();
  if (text.length > 128) return { type: "", issue: "STREAK_REWARD_TEXT_TOO_LONG" };
  if (/(?<![A-Z0-9_])(?:NEX|POINTS)(?![A-Z0-9_])|积分/.test(text)) return { type: "", issue: "REWARD_TYPE_UNSUPPORTED" };
  const types = [
    ["UVT", /(?<![A-Z0-9_])UVT(?![A-Z0-9_])/], ["USDT", /(?<![A-Z0-9_])USDT(?![A-Z0-9_])|\$/],
    ["SPIN", /(?<![A-Z0-9_])SPIN(?![A-Z0-9_])|转盘/], ["BADGE", /(?<![A-Z0-9_])BADGE(?![A-Z0-9_])|徽章/],
  ] as const;
  const found = types.filter(([, pattern]) => pattern.test(text));
  if (found.length !== 1) return { type: "", issue: found.length ? "STREAK_REWARD_AMBIGUOUS" : "REWARD_TYPE_UNSUPPORTED" };
  const type = found[0][0];
  if (type === "BADGE") return { type }; // The backend alone can verify the original badge code.
  const number = "[0-9]+(?:\\.[0-9]+)?";
  const label = type === "SPIN" ? "(?:(?:LUCKY\\s+)?SPIN(?:\\s*票)?|转盘票?)" : type;
  const pattern = new RegExp(`^(?:\\+?${number}\\s*${label}|${label}\\s*[×X*]?\\s*\\+?${number}${type === "USDT" ? `|\\$\\s*\\+?${number}(?:\\s*USDT)?` : ""})$`);
  if (!pattern.test(text)) return { type, issue: "STREAK_REWARD_AMOUNT_INVALID" };
  const amount = h5Amount(text.match(/[0-9]+(?:\.[0-9]+)?/)![0]);
  if (amount === undefined || amount >= BigInt("1000000000000000000")) return { type, issue: "STREAK_REWARD_AMOUNT_PRECISION_INVALID" };
  if (amount <= BigInt(0)) return { type, issue: "STREAK_REWARD_AMOUNT_INVALID" };
  if (type === "SPIN" && (amount % BigInt(1000000) !== BigInt(0) || amount > BigInt("2147483647000000"))) return { type, issue: "STREAK_SPIN_INTEGER_REQUIRED" };
  return { type, amount };
}
