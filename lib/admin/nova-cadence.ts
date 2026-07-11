export type NovaTimeUnit = "seconds" | "minutes" | "hours" | "days";

export const NOVA_TIME_UNITS: ReadonlyArray<{ value: NovaTimeUnit; label: string }> = [
  { value: "seconds", label: "秒" },
  { value: "minutes", label: "分钟" },
  { value: "hours", label: "小时" },
  { value: "days", label: "天" },
];

const UNIT_SECONDS: Record<NovaTimeUnit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 60 * 60,
  days: 24 * 60 * 60,
};

const UNIT_SUFFIX: Record<NovaTimeUnit, string> = {
  seconds: "s",
  minutes: " min",
  hours: "h",
  days: "d",
};

const UNIT_ALIASES: ReadonlyArray<{ pattern: string; unit: NovaTimeUnit }> = [
  { pattern: "minutes?|mins?|分钟", unit: "minutes" },
  { pattern: "seconds?|secs?|s|秒", unit: "seconds" },
  { pattern: "hours?|hrs?|h|小时", unit: "hours" },
  { pattern: "days?|d|天", unit: "days" },
];

const positiveInteger = (value: string): number | null => {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

export function parseNovaDuration(raw: string, fallbackUnit: NovaTimeUnit): { value: string; unit: NovaTimeUnit } {
  const text = raw.trim();
  for (const alias of UNIT_ALIASES) {
    const match = text.match(new RegExp(`(\\d+)\\s*(?:${alias.pattern})`, "i"));
    if (match && positiveInteger(match[1]) !== null) {
      return { value: match[1], unit: alias.unit };
    }
  }
  return { value: "", unit: fallbackUnit };
}

export function formatNovaDuration(value: string, unit: NovaTimeUnit): string {
  const number = positiveInteger(value);
  return number === null ? "" : `${number}${UNIT_SUFFIX[unit]}`;
}

export function validateNovaCadence(
  tickValue: string,
  tickUnit: NovaTimeUnit,
  cooldownValue: string,
  cooldownUnit: NovaTimeUnit,
): string | null {
  if (!tickValue.trim()) return "请填写检查间隔";
  const tick = positiveInteger(tickValue);
  if (tick === null) return "检查间隔必须是正整数";
  if (!cooldownValue.trim()) return "请填写同一用户最短推送间隔";
  const cooldown = positiveInteger(cooldownValue);
  if (cooldown === null) return "同一用户最短推送间隔必须是正整数";
  if (cooldown * UNIT_SECONDS[cooldownUnit] < tick * UNIT_SECONDS[tickUnit]) {
    return "同一用户最短推送间隔不能小于检查间隔";
  }
  return null;
}
