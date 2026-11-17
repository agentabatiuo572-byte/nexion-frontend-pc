import { formatAdminApiError } from "./error-messages";

// 7bfde504/f4712255: batch entries use the same ordered authority/target mapping as single writes.
const TEAM_RATE_KEYS = new Set(["directRoyaltyPct", "networkRoyaltyPct", "binaryPairRatePct", "maxCombinedOutflowPct", "minPayoutUsdt"]);
const TEAM_WRITE_KEYS = new Set(["rankWindowDays", "hardwareQuotaPerRank"]);

export function fConfigBatchTargetType(key: string) {
  return TEAM_RATE_KEYS.has(key) || TEAM_WRITE_KEYS.has(key) ? "team_config" : "ui_config";
}

function authorityFor(key: string): string | null {
  if (TEAM_RATE_KEYS.has(key)) return "network_f2_royalty_rate";
  if (TEAM_WRITE_KEYS.has(key)) return "network_f2_write";
  if (["F.prize.name", "F.vrank.titles"].includes(key)) return "network_f1_write";
  if (key === "F.vrank.permanent") return "network_f1_permanent_protection";
  if (/^F\.unilevel\.(?:nex\.)?L[1-7]$/.test(key) || ["F.promo.weekMultiplier", "F.peer.rate"].includes(key)) return "network_f2_royalty_rate";
  if (["F.influence.clampMin", "F.influence.clampMax", "F.cooldown", "F.partner.tiers", "F.royalty.minPayout", "F.unilevel.depthGate", "F.unilevel.depthGateRank", "F.unilevel.nexCap", "F.unilevel.backfill", "F.unilevel.depth", "F.unilevel.mergeExitMaxPct", "F.sunset.exclusions"].includes(key)
    || /^F\.unilevel\.L[1-7]\.paused$/.test(key)) return "network_f2_policy_amplify";
  if (key === "F.binary.paused") return "network_f3_engine_pause";
  if (key.startsWith("F.binary.")) return "network_f3_match_rate";
  if (key.startsWith("F3.dailyCap.")) return "network_f3_write";
  if (key.startsWith("F.pool.votes.") || key.startsWith("F.quota.")) return "network_f4_write";
  if (key.startsWith("F.ambassador.") && key.endsWith(".status")) return "network_f4_ambassador_approve";
  if (["F.pool.monthlyCap", "F.pool.settleCron", "F.pool.unlockVRank", "F.leaderboard.minUsd", "F.leaderboard.minComputePoints"].includes(key)) return "network_f4_write";
  if (key === "F.leaderboard.poolUsd") return "network_f4_pool_fund";
  if (key.startsWith("F.leaderboard.")) return "network_f4_leaderboard_control";
  if (key.startsWith("F.pool.")) return "network_f4_pool_fund";
  return null;
}

export function fConfigBatchPermissionIssue(keys: readonly string[], authorities: readonly string[]): string | undefined {
  for (const key of keys) {
    const authority = authorityFor(key.trim());
    const code = authority === null ? "A2_BUSINESS_PERMISSION_UNMAPPED"
      : !authorities.includes(authority) ? "A2_BUSINESS_PERMISSION_DENIED" : undefined;
    if (code) return `${key} · ${formatAdminApiError(code, code)}`;
  }
}
