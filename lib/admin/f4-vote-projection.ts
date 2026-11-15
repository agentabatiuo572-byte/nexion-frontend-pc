type EstimateUnavailable = { available: false; reason: "CURRENT_WEEK_SETTLED" | "SETTLEMENT_CONFIG_UNAVAILABLE" | "NO_ELIGIBLE_VOTERS" | "NO_CURRENT_POOL" };
type VoteValue = { available: true; currency: "USDT"; poolUsd: string; totalVotes: string; perVoteUsd: string | null };
export type F4VoteProjection = {
  domain: "F4";
  estimate: EstimateUnavailable | VoteValue & {
    period: "CURRENT_WEEK"; eligibleCount: number; ranksAvailability: "CURRENT_ELIGIBILITY_ESTIMATE";
    ranks: { rank: string; eligibleCount: number; votesPerMember: number; totalVotes: string }[];
  };
  settled: { available: false; reason: "NO_SETTLEMENT_AUDIT" } | VoteValue & {
    period: "SETTLED_WEEK"; weekKey: string; settledUsers: number; ranks: null; ranksAvailability: "PER_RANK_NOT_RECORDED";
  };
  sources: string[];
};

export type F4VoteProjectionRead =
  | { status: "idle" | "loading" | "denied" }
  | { status: "error"; message: string }
  | { status: "ready"; data: F4VoteProjection };

function invalid(): never { throw new Error("F4_VOTE_PROJECTION_INVALID"); }
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
}
function text(value: unknown): string { return typeof value === "string" && value.trim() ? value : invalid(); }
function count(value: unknown): number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : invalid(); }
// Numeric JSON tokens are preserved by f1Request before this boundary receives them.
function decimal(value: unknown): string {
  return typeof value === "string" && /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) ? value : invalid();
}
function voteValue(row: Record<string, unknown>): VoteValue {
  if (row.currency !== "USDT") invalid();
  return { available: true, currency: "USDT", poolUsd: decimal(row.poolUsd), totalVotes: decimal(row.totalVotes),
    perVoteUsd: row.perVoteUsd === null ? null : decimal(row.perVoteUsd) };
}

export function readF4VoteProjection(value: unknown): F4VoteProjection {
  const root = record(value), estimate = record(root.estimate), settled = record(root.settled);
  if (root.domain !== "F4" || !Array.isArray(root.sources)) invalid();
  let current: F4VoteProjection["estimate"];
  if (estimate.available === false) {
    const reason = estimate.reason;
    if (reason !== "CURRENT_WEEK_SETTLED" && reason !== "SETTLEMENT_CONFIG_UNAVAILABLE" && reason !== "NO_ELIGIBLE_VOTERS" && reason !== "NO_CURRENT_POOL") invalid();
    current = { available: false, reason };
  } else {
    if (estimate.available !== true || estimate.period !== "CURRENT_WEEK"
      || estimate.ranksAvailability !== "CURRENT_ELIGIBILITY_ESTIMATE" || !Array.isArray(estimate.ranks)) invalid();
    current = { ...voteValue(estimate), period: "CURRENT_WEEK", eligibleCount: count(estimate.eligibleCount),
      ranksAvailability: "CURRENT_ELIGIBILITY_ESTIMATE", ranks: estimate.ranks.map(value => {
        const row = record(value), rank = text(row.rank), eligibleCount = count(row.eligibleCount), votesPerMember = count(row.votesPerMember);
        if (!/^V[1-8]$/.test(rank) || eligibleCount === 0 || votesPerMember === 0) invalid();
        return { rank, eligibleCount, votesPerMember, totalVotes: decimal(row.totalVotes) };
      }) };
  }
  let actual: F4VoteProjection["settled"];
  if (settled.available === false) {
    if (settled.reason !== "NO_SETTLEMENT_AUDIT") invalid();
    actual = { available: false, reason: "NO_SETTLEMENT_AUDIT" };
  } else {
    if (settled.available !== true || settled.period !== "SETTLED_WEEK"
      || settled.ranks !== null || settled.ranksAvailability !== "PER_RANK_NOT_RECORDED") invalid();
    actual = { ...voteValue(settled), period: "SETTLED_WEEK", weekKey: text(settled.weekKey),
      settledUsers: count(settled.settledUsers), ranks: null, ranksAvailability: "PER_RANK_NOT_RECORDED" };
  }
  return { domain: "F4", estimate: current, settled: actual, sources: root.sources.map(text) };
}
