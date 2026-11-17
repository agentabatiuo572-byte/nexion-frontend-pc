import type { H3QuestEventBinding } from "./h-client";

export type H3PendingApproval = {
  action: string | null;
  ticketId: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  configKey: string | null;
  currentValue: string | null;
  proposedValue: string | null;
};

export type H3PendingMissionCreation = {
  action: string | null;
  ticketId: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  missionCode: string | null;
  missionName: string | null;
  missionType: string | null;
  rewardPoints: number | null;
  category: string | null;
  actionRoute: string | null;
};

export type H3Task = Record<string, any> & { contentState?: "UNKNOWN" | "DRAFT" | "OPENED"; pendingApproval?: H3PendingApproval | null };

export interface H3TaskContract extends Record<string, any> {
  missionCode?: string;
  pendingApproval?: H3PendingApproval | null;
  completed24h?: number | null;
  b3Default?: boolean | number | string;
  retentionOnlyDefault?: boolean | number | string;
  attributionAvailable?: boolean;
  fieldSemantics?: { serverEvent: string; b3: string; retentionOnly: string; sample24h: string; anomalyPct: string };
  completionBasis?: { source: string; timestamp: string; states: string[]; window: string; deduplication: string };
}

/** Only the tasks GET supplies these aggregates; absent fields retain the legacy unknown state. */
export type H3Stats = {
  dayOneTaskCount?: number;
  weeklyTier1Count?: number;
  weeklyTier2Count?: number;
  monthlyMissionCount?: number;
  phaseBonusP3?: string;
  operatingStatsAvailable?: boolean;
  operatingStatsComplete?: boolean;
  operatingStatsReason?: string;
  dayOneRate24h?: number | null;
  dayOneRateGrace?: number | null;
  dayOneRate24hAvailable?: boolean;
  dayOneRateGraceAvailable?: boolean;
  dayOneClaimCounts?: { fullEligible: number; fullClaimed: number; graceEligible: number; graceClaimed: number };
  dayOneRateBasis?: string;
  dayOneRateUnit?: string;
  dayOneClaimTimeSource?: string;
  dayOneWindowSource?: string;
  weeklyDone?: number | null;
  weeklyDoneAvailable?: boolean;
  weeklyKnownDone?: number;
  weeklyUndatedCount?: number;
  weeklyUnknownTierCount?: number;
  t1Done?: number | null;
  t2Done?: number | null;
  weeklyCompletionTimeSource?: string;
  weeklyTierSource?: string;
  weeklyNex?: string | null;
  weeklyNexAsset?: string;
  weeklyPaidByAsset?: Array<{ asset: string; amount: string; ledgerCount: number }>;
  weeklyPaidSource?: string;
  monthlyInflight?: number | null;
  monthlyInflightAvailable?: boolean;
  monthlyInflightReason?: string;
  userScope?: string;
  asOf?: string;
  weekTimeZone?: string;
  storageTimeZone?: string;
  weekFromStorage?: string;
  weekUntilExclusiveStorage?: string;
};

/** f85e1742/ec68f13e: documented write contract; ASCII codes compare without changing stored values. */
export function h3MissionEnableRefusal(taskKind: string, taskCode: string): "H3_MISSION_RETIRED" | undefined {
  return taskKind === "MISSION" && ["weekly_t1_nex_v2_lock", "weekly_t1_stake_fallback", "weekly_t2_stake_small"].includes(taskCode.toLowerCase())
    ? "H3_MISSION_RETIRED" : undefined;
}

export function h3MissionCreationRefusal(missionType: string, missionCode: string): "H3_DAY_ONE_STAKING_MISSION_REFUSED" | undefined {
  const normalized = missionCode.toLowerCase();
  return missionType === "DAY_ONE" && (normalized.includes("stake") || normalized.includes("lock"))
    ? "H3_DAY_ONE_STAKING_MISSION_REFUSED" : undefined;
}

export type H3Model = {
  h3Stats: H3Stats;
  dayOneWindow: string;
  dayOneWindowConfig?: { key: "dayOne.windowMs"; readOnly: true; retired: true; valueKind: "DISPLAY_TEXT_ONLY" };
  dayOneEligibilityHours: string;
  dayOneTriReward: string;
  pendingApprovals?: Record<string, H3PendingApproval | null>;
  pendingMissionCreations?: H3PendingMissionCreation[];
  dayOneTasks: H3Task[];
  dayOneStates: Array<{ st: string; label: string; tone: string }>;
  weeklyTier1: H3Task[];
  weeklyTier2: H3Task[];
  weeklyChampionBonus: string;
  weeklyMultipliers: Array<{ p: string; mult: string | null }>;
  monthlyMissions: H3Task[];
  taskMonitor: Array<{ label: string; note: string }>;
  taskContracts: H3TaskContract[];
  promoBanner: Record<string, any>;
  contentLocales: Record<string, Record<string, Record<string, Record<string, string>>>>;
  phaseMultiplierReadonly: Record<string, any>;
  eventBindings: H3QuestEventBinding[];
};

/** d9e2038f: match the writer's normalized key without changing historical values. */
export function h3QuestConfigWriteRefusal(key: string): "H3_DAY_ONE_WINDOW_RETIRED" | "RETIRED_FEATURE" | undefined {
  if (/^promoBanner\.(baseReward|multiplier|countdownDays|countdownHours|targetDevice|targetDaily|status)$/.test(key)) return "RETIRED_FEATURE";
  return key.replace(/H3\.|H4\.|event\./g, "") === "dayOne.windowMs" ? "H3_DAY_ONE_WINDOW_RETIRED" : undefined;
}

/** The tasks endpoint is independent of H4. Nullable SQL cells stay nullable. */
export function parseH3Model(value: unknown): H3Model {
  const object = (v: unknown): Record<string, any> => {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("H3_RESPONSE_INVALID");
    return v as Record<string, any>;
  };
  const row = object(value);
  if (row.domain !== "H3" || row.rewardAsset !== "UVT") throw new Error("H3_RESPONSE_INVALID");
  const strings = (r: Record<string, any>, keys: string[]) => {
    if (keys.some(key => typeof r[key] !== "string")) throw new Error("H3_RESPONSE_INVALID");
  };
  const pendingApproval = (value: unknown) => {
    if (value === null) return;
    const pending = object(value);
    if (["action", "ticketId", "submittedBy", "submittedAt", "configKey", "currentValue", "proposedValue"]
      .some(key => pending[key] !== null && typeof pending[key] !== "string")) throw new Error("H3_RESPONSE_INVALID");
  };
  if (row.pendingApprovals !== undefined) Object.values(object(row.pendingApprovals)).forEach(pendingApproval);
  if (row.pendingMissionCreations !== undefined) {
    if (!Array.isArray(row.pendingMissionCreations)) throw new Error("H3_RESPONSE_INVALID");
    for (const value of row.pendingMissionCreations) {
      const pending = object(value);
      if (["action", "ticketId", "submittedBy", "submittedAt", "missionCode", "missionName", "missionType", "category", "actionRoute"]
        .some(key => pending[key] !== null && typeof pending[key] !== "string")
        || pending.rewardPoints !== null && (!Number.isInteger(pending.rewardPoints) || pending.rewardPoints < 0 || pending.rewardPoints > 2147483647)) throw new Error("H3_RESPONSE_INVALID");
    }
  }
  strings(row, ["dayOneWindow", "dayOneEligibilityHours", "dayOneTriReward", "weeklyChampionBonus"]);
  for (const key of ["h3Stats", "promoBanner", "contentLocales", "phaseMultiplierReadonly"]) object(row[key]);
  const banner = row.promoBanner;
  if (["promoBannerConfigurable", "promoBannerRetired", "promoBannerRetiredReason"].some(key => banner[key] !== undefined)
    && (banner.promoBannerConfigurable !== false || banner.promoBannerRetired !== true
      || banner.promoBannerRetiredReason !== "RETIRED_FEATURE")) throw new Error("H3_RESPONSE_INVALID");
  if (row.dayOneWindowConfig !== undefined) {
    const config = object(row.dayOneWindowConfig);
    if (config.key !== "dayOne.windowMs" || config.readOnly !== true || config.retired !== true || config.valueKind !== "DISPLAY_TEXT_ONLY") throw new Error("H3_RESPONSE_INVALID");
  }
  const stats = row.h3Stats;
  if (stats.operatingStatsAvailable !== undefined) {
    const invalid = () => { throw new Error("H3_RESPONSE_INVALID"); };
    if (typeof stats.operatingStatsAvailable !== "boolean" || typeof stats.operatingStatsComplete !== "boolean"
      || typeof stats.monthlyInflightAvailable !== "boolean") invalid();
    strings(stats, ["monthlyInflightReason", "dayOneRateBasis", "dayOneRateUnit", "weeklyNexAsset", "userScope"]);
    for (const key of ["dayOneRate24h", "dayOneRateGrace", "weeklyDone", "t1Done", "t2Done", "monthlyInflight"]) {
      const value = stats[key];
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0
        || (key.startsWith("dayOneRate") ? value > 100 : !Number.isSafeInteger(value)))) invalid();
    }
    if (stats.weeklyNex !== null && (typeof stats.weeklyNex !== "string" || h3Decimal(stats.weeklyNex) === null)) invalid();
    if (stats.operatingStatsAvailable) {
      strings(stats, ["asOf", "weekTimeZone", "storageTimeZone", "weekFromStorage", "weekUntilExclusiveStorage",
        "dayOneClaimTimeSource", "dayOneWindowSource", "weeklyCompletionTimeSource", "weeklyTierSource", "weeklyPaidSource"]);
      for (const key of ["dayOneRate24hAvailable", "dayOneRateGraceAvailable", "weeklyDoneAvailable"]) {
        if (typeof stats[key] !== "boolean") invalid();
      }
      const claims = object(stats.dayOneClaimCounts);
      for (const key of ["fullEligible", "fullClaimed", "graceEligible", "graceClaimed"]) {
        if (!Number.isSafeInteger(claims[key]) || claims[key] < 0) invalid();
      }
      for (const key of ["weeklyKnownDone", "weeklyUndatedCount", "weeklyUnknownTierCount"]) {
        if (!Number.isSafeInteger(stats[key]) || stats[key] < 0) invalid();
      }
      if (!Array.isArray(stats.weeklyPaidByAsset)) invalid();
      for (const paid of stats.weeklyPaidByAsset) {
        const item = object(paid);
        strings(item, ["asset", "amount"]);
        if (h3Decimal(item.amount) === null || !Number.isSafeInteger(item.ledgerCount) || item.ledgerCount < 0) invalid();
      }
    } else strings(stats, ["operatingStatsReason"]);
  }
  for (const key of ["dayOneTasks", "weeklyTier1", "weeklyTier2", "monthlyMissions", "dayOneStates", "weeklyMultipliers", "taskMonitor", "taskContracts", "eventBindings"]) {
    if (!Array.isArray(row[key])) throw new Error("H3_RESPONSE_INVALID");
    row[key].forEach(object);
  }
  for (const contract of row.taskContracts) {
    if (contract.pendingApproval !== undefined) pendingApproval(contract.pendingApproval);
    if (contract.completed24h === undefined) continue;
    strings(contract, ["missionCode"]);
    if (contract.completed24h !== null && (!Number.isSafeInteger(contract.completed24h) || contract.completed24h < 0)
      || typeof contract.attributionAvailable !== "boolean"
      || [contract.b3Default, contract.retentionOnlyDefault].some(value => ![true, false, 0, 1, "0", "1", "true", "false"].includes(value))) throw new Error("H3_RESPONSE_INVALID");
    strings(object(contract.fieldSemantics), ["serverEvent", "b3", "retentionOnly", "sample24h", "anomalyPct"]);
    const basis = object(contract.completionBasis);
    strings(basis, ["source", "timestamp", "window", "deduplication"]);
    if (!Array.isArray(basis.states) || basis.states.some(state => typeof state !== "string")) throw new Error("H3_RESPONSE_INVALID");
  }
  for (const task of [...row.dayOneTasks, ...row.weeklyTier1, ...row.weeklyTier2, ...row.monthlyMissions]) {
    if (task.pendingApproval !== undefined) pendingApproval(task.pendingApproval);
    strings(task, ["taskCode", "taskKind", "status", "reward"]);
    if (!task.taskCode || !["MISSION", "MONTHLY"].includes(task.taskKind) || !["active", "paused", "archived"].includes(task.status)) throw new Error("H3_RESPONSE_INVALID");
    if (task.contentState !== undefined && !["UNKNOWN", "DRAFT", "OPENED"].includes(task.contentState)) throw new Error("H3_RESPONSE_INVALID");
  }
  for (const item of row.weeklyMultipliers) {
    strings(item, ["p"]);
    if (item.mult !== null && typeof item.mult !== "string") throw new Error("H3_RESPONSE_INVALID");
  }
  for (const item of row.dayOneStates) strings(item, ["st", "label", "tone"]);
  for (const item of row.taskMonitor) strings(item, ["label", "note"]);
  for (const item of row.eventBindings) {
    strings(item, ["bindingCode", "producer", "eventType", "questCode", "userIdField"]);
    if (!Number.isSafeInteger(item.status) || !["ORDER", "REFERRAL", "LEARNING", "DEVICE", "COMMISSION", "SYSTEM"].includes(item.producer)
      || !["user_id", "inviter_user_id"].includes(item.userIdField)) throw new Error("H3_RESPONSE_INVALID");
  }
  return row as H3Model;
}

/** BigDecimal input syntax used by H3, expanded without passing amounts through Number. */
export function h3Decimal(value: string): string | null {
  const match = /^([+-]?)((?:\d+(?:\.\d*)?|\.\d+))(?:[eE]([+-]?\d+))?$/.exec(value.trim().replace(/[,%]/g, ""));
  if (!match) return null;
  const [whole, fraction = ""] = match[2].split(".");
  const digits = whole + fraction;
  const point = whole.length + Number(match[3] ?? "0");
  // Outside this range a nonzero H3 value is already outside its backend bounds
  // or six-decimal precision. Let the ordinary endpoint return that validation.
  if (!Number.isSafeInteger(point) || Math.abs(point) > 200) return /^0+$/.test(digits) ? "0" : null;
  const expanded = point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length ? digits.padEnd(point, "0") : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return `${match[1] === "-" ? "-" : ""}${expanded.replace(/^0+(?=\d)/, "").replace(/\.$/, "")}`;
}

export function compareH3Decimal(a: string, b: string): number {
  const scale = Math.max((a.split(".")[1] ?? "").length, (b.split(".")[1] ?? "").length);
  const integer = (v: string) => {
    const [whole, fraction = ""] = v.replace(/^-/, "").split(".");
    return BigInt(whole + fraction.padEnd(scale, "0")) * (v.startsWith("-") ? -BigInt(1) : BigInt(1));
  };
  const delta = integer(a) - integer(b);
  return delta > 0 ? 1 : delta < 0 ? -1 : 0;
}

/** 111e00cd: DayOneTriRewardPolicy.increases / amplifiesQuestValue / promoAmplifiesOutflow. */
export function h3ConfigNeedsApproval(key: string, before: string, after: string): boolean {
  if (key === "dayOne.triReward") {
    const parse = (v: string) => /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*\/\s*0(?:\.0+)?\s+UVT\s*$/i.exec(v);
    const next = parse(after), previous = parse(before);
    return !!next && (!previous || compareH3Decimal(next[1], previous[1]) > 0 || compareH3Decimal(next[2], previous[2]) > 0);
  }
  if (key === "promoBanner.status") return before.toLowerCase() !== "active" && after.trim().toLowerCase() === "active";
  if (/^(?:mission|monthly)\..+\.reward$/.test(key) || /^weekly\.mult\.P[1-6]$/.test(key) || /^promoBanner\.(?:baseReward|multiplier)$/.test(key)) {
    const weekly = key.startsWith("weekly.mult.");
    const next = h3Decimal(weekly ? after.replace(/[×x]/g, "") : after);
    let previous = h3Decimal(weekly ? before.replace(/[×x]/g, "") : before);
    if (weekly && previous !== null && ((previous.split(".")[1] ?? "").replace(/0+$/, "").length > 6
      || compareH3Decimal(previous, "0.1") < 0 || compareH3Decimal(previous, "5") > 0)) previous = null;
    return next !== null && (previous === null ? key.startsWith("weekly.mult.") || key.startsWith("promoBanner.") && compareH3Decimal(next, "0") > 0 : compareH3Decimal(next, previous) > 0);
  }
  return false;
}
