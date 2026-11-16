import type { H3QuestEventBinding } from "./h-client";

export type H3Task = Record<string, any>;

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
  h3Stats: Record<string, unknown>;
  dayOneWindow: string;
  dayOneEligibilityHours: string;
  dayOneTriReward: string;
  dayOneTasks: H3Task[];
  dayOneStates: Array<{ st: string; label: string; tone: string }>;
  weeklyTier1: H3Task[];
  weeklyTier2: H3Task[];
  weeklyChampionBonus: string;
  weeklyMultipliers: Array<{ p: string; mult: string | null }>;
  monthlyMissions: H3Task[];
  taskMonitor: Array<{ label: string; note: string }>;
  taskContracts: Array<Record<string, any>>;
  promoBanner: Record<string, any>;
  contentLocales: Record<string, Record<string, Record<string, Record<string, string>>>>;
  phaseMultiplierReadonly: Record<string, any>;
  eventBindings: H3QuestEventBinding[];
};

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
  strings(row, ["dayOneWindow", "dayOneEligibilityHours", "dayOneTriReward", "weeklyChampionBonus"]);
  for (const key of ["h3Stats", "promoBanner", "contentLocales", "phaseMultiplierReadonly"]) object(row[key]);
  for (const key of ["dayOneTasks", "weeklyTier1", "weeklyTier2", "monthlyMissions", "dayOneStates", "weeklyMultipliers", "taskMonitor", "taskContracts", "eventBindings"]) {
    if (!Array.isArray(row[key])) throw new Error("H3_RESPONSE_INVALID");
    row[key].forEach(object);
  }
  for (const task of [...row.dayOneTasks, ...row.weeklyTier1, ...row.weeklyTier2, ...row.monthlyMissions]) {
    strings(task, ["taskCode", "taskKind", "status", "reward"]);
    if (!task.taskCode || !["MISSION", "MONTHLY"].includes(task.taskKind) || !["active", "paused", "archived"].includes(task.status)) throw new Error("H3_RESPONSE_INVALID");
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
