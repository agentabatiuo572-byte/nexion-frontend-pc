import type { F3BinaryConfig } from "./f1-client";
import { f4Decimal } from "./f4-money.ts";

export const F3_AUTO_SETTLE_KEY = "F.binary.autoSettle";
export const F3_PLATFORM_CAP_PCT_KEY = "F.binary.platformCapPct";
export type F3PayoutControlKey = typeof F3_AUTO_SETTLE_KEY | typeof F3_PLATFORM_CAP_PCT_KEY;

export function isF3PayoutControlKey(key: unknown): key is F3PayoutControlKey {
  return key === F3_AUTO_SETTLE_KEY || key === F3_PLATFORM_CAP_PCT_KEY;
}

export function f3PayoutControlAuthority(key: F3PayoutControlKey) {
  return key === F3_AUTO_SETTLE_KEY ? "network_f3_engine_pause" : "network_f3_match_rate";
}

/** BinarySettlementPolicyProvider at 111e00cd: trim + Locale.ROOT case folding. */
export function f3PauseState(raw: string | undefined, authoritative?: boolean | null): boolean | null {
  if (authoritative !== undefined) return authoritative;
  const value = raw?.trim().toLowerCase();
  if (["true", "1", "on"].includes(value ?? "")) return true;
  if (["false", "0", "off"].includes(value ?? "")) return false;
  return null;
}

export function f3SpilloverState(raw: string | undefined): boolean | null {
  const value = raw?.trim();
  return value === "已启用" ? true : value === "已关闭" ? false : f3PauseState(value);
}

/** BigDecimal.scale() counts trailing zeroes and subtracts the exponent. */
export function validF3Threshold(raw: string): boolean {
  const match = /^[+-]?(?:\d+(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(raw.trim());
  const value = Number(raw);
  return !!match && Number.isFinite(value) && value > 0 && value <= 5000
    && (match[1] ?? match[2] ?? "").length - Number(match[3] ?? 0) <= 6;
}

/** Percentage points, with the same significant scale as the stored BigDecimal. */
export function f3PlatformCapPct(raw: string): string | null {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw.trim().replace(/%$/, "").trim());
  if (!match || !(match[2] || match[3])) return null;
  const fraction = match[3] ?? "";
  const digits = (match[2] + fraction).replace(/^0+/, "");
  if (!digits) return "0";
  const significant = digits.replace(/0+$/, "");
  const scale = fraction.length - Number(match[4] ?? 0) - (digits.length - significant.length);
  if (match[1] === "-" || scale > 10 || significant.length - scale > 3) return null;
  const percent = f4Decimal(`${significant}e${-scale}`);
  return percent !== null && capUnits(percent) <= capUnits("100") ? percent : null;
}

function capUnits(percent: string) {
  const [whole, fraction = ""] = percent.split(".");
  return BigInt(whole + fraction.padEnd(10, "0"));
}

export function planF3PayoutControl(key: F3PayoutControlKey, raw: string, config: F3BinaryConfig) {
  const authority = f3PayoutControlAuthority(key);
  if (key === F3_AUTO_SETTLE_KEY) {
    const next = f3PauseState(raw);
    if (next === null) throw new Error("F_TEAM_TOGGLE_INVALID");
    const before = config.autoSettle;
    if (before == null) throw new Error("F3_CONFIG_READ_UNAVAILABLE");
    return { authority, before: before ? "on" : "off", value: next ? "on" : "off",
      direction: next === before ? "unchanged" : next ? "proposal" : "direct" } as const;
  }
  const next = f3PlatformCapPct(raw);
  if (next === null) throw new Error("F3_PLATFORM_CAP_PCT_INVALID");
  const before = config.platformCapPct;
  if (before == null) throw new Error("F3_CONFIG_READ_UNAVAILABLE");
  const currentUnits = capUnits(before), nextUnits = capUnits(next);
  return { authority, before: `${before}%`, value: `${next}%`,
    direction: nextUnits === currentUnits ? "unchanged" : nextUnits > currentUnits ? "proposal" : "direct" } as const;
}
