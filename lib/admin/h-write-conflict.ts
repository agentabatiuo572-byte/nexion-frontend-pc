import { isDeterministicRejection } from "./outcome-classification";

/** Exact backend CAS refusals; ordinary validation, permissions and locks do not invalidate a read. */
const READ_CONFLICTS = new Set([
  "QUEST_CONFIG_STALE", "H3_BINDING_STALE", "H3_MISSION_STALE",
  "WEEKLY_REGION_VERSION_CONFLICT", "WEEKLY_REGION_ACTIVATION_CONFLICT",
  "EVENT_CONFIG_STALE", "WHEEL_CONFIG_STALE", "WHEEL_GUARD_STALE", "CONTENT_LOCALE_STALE",
  "RAFFLE_CONFIG_STALE", "H5_CONFIG_STALE", "H7_VOUCHER_STALE",
  "H8_CONFIG_VERSION_CONFLICT", "H8_REWARD_SNAPSHOT_CHANGED_REPROPOSE",
]);

export function isHGrowthReadConflict(error: unknown) {
  const e = error as { status?: number; apiCode?: number; reasonCode?: string; backendMessage?: string; unknownOutcome?: boolean; bodyUnreadable?: boolean } | null;
  return !!e && isDeterministicRejection(e.status ?? 0, e.apiCode) && !e.unknownOutcome && !e.bodyUnreadable && READ_CONFLICTS.has(e.reasonCode ?? e.backendMessage ?? "");
}

export function isH4ReadConflict(error: unknown) {
  return isHGrowthReadConflict(error) || error instanceof Error && error.message === "H4_REFRESH_REQUIRED";
}
