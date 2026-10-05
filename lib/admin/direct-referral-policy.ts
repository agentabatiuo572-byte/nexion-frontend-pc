import { parseStrictFiniteNumber } from "./strict-number.ts";

export interface DirectReferralRule {
  enabled: boolean;
  totalRatePct: number;
  usdtSharePct: number;
  coolingDays: number;
}

export interface DirectReferralPolicy {
  source: "server";
  serverCanonical: true;
  sourceEnvironment: string;
  runId: string;
  configured: boolean;
  policyVersion: number;
  effectiveAt: string | null;
  nexUsdtPrice: number | null;
  purchase: DirectReferralRule;
  deviceEarning: DirectReferralRule;
}

export interface DirectReferralUpdate {
  expectedVersion: number;
  purchase: DirectReferralRule;
  deviceEarning: DirectReferralRule;
}

export function validateDirectReferralUpdate(value: DirectReferralUpdate): string | null {
  if (!Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 0) return "配置版本无效，请重新读取。";
  for (const [key, label] of [["purchase", "直属购买分成"], ["deviceEarning", "直属设备收益分成"]] as const) {
    const rule = value[key];
    if (!rule || typeof rule.enabled !== "boolean") return `${label}：请选择启用状态。`;
    if (!Number.isFinite(rule.totalRatePct) || rule.totalRatePct < 0 || rule.totalRatePct > 100 || (rule.enabled && rule.totalRatePct === 0)) return `${label}：总比例须为 0–100%，启用时须大于 0。`;
    if (!Number.isFinite(rule.usdtSharePct) || rule.usdtSharePct < 0 || rule.usdtSharePct > 100 || (rule.enabled && (rule.usdtSharePct === 0 || rule.usdtSharePct === 100))) return `${label}：启用时 USDT 占比须大于 0% 且小于 100%，保证双币分成。`;
    if (!Number.isInteger(rule.coolingDays) || rule.coolingDays < 0 || rule.coolingDays > 365) return `${label}：冷却天数须为 0–365 的整数。`;
  }
  return null;
}

export function parseDirectReferralPolicy(value: unknown): DirectReferralPolicy {
  const invalid = (): never => { throw new Error("DIRECT_REFERRAL_POLICY_INVALID"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  const number = (raw: unknown): number => parseStrictFiniteNumber(raw) ?? invalid();
  const rule = (raw: unknown): DirectReferralRule => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
    const item = raw as Record<string, unknown>;
    if (typeof item.enabled !== "boolean") return invalid();
    return { enabled: item.enabled, totalRatePct: number(item.totalRatePct), usdtSharePct: number(item.usdtSharePct), coolingDays: number(item.coolingDays) };
  };
  if (row.source !== "server" || row.serverCanonical !== true || typeof row.sourceEnvironment !== "string" || !row.sourceEnvironment || typeof row.runId !== "string" || typeof row.configured !== "boolean") return invalid();
  const result: DirectReferralPolicy = {
    source: "server", serverCanonical: true, sourceEnvironment: row.sourceEnvironment, runId: row.runId,
    configured: row.configured, policyVersion: number(row.policyVersion),
    effectiveAt: row.effectiveAt === null ? null : typeof row.effectiveAt === "string" ? row.effectiveAt : invalid(),
    nexUsdtPrice: row.nexUsdtPrice === null ? null : number(row.nexUsdtPrice),
    purchase: rule(row.purchase), deviceEarning: rule(row.deviceEarning),
  };
  if (validateDirectReferralUpdate({ ...result, expectedVersion: result.policyVersion }) || (result.nexUsdtPrice !== null && result.nexUsdtPrice <= 0)) return invalid();
  if (result.effectiveAt !== null && (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(result.effectiveAt) || !Number.isFinite(Date.parse(result.effectiveAt)))) return invalid();
  if (result.configured ? result.policyVersion < 1 || result.effectiveAt === null : result.policyVersion !== 0 || result.effectiveAt !== null || [result.purchase, result.deviceEarning].some(r => r.enabled || r.totalRatePct !== 0 || r.usdtSharePct !== 50 || r.coolingDays !== 0)) return invalid();
  return result;
}

export function directReferralSummary(value: Pick<DirectReferralUpdate, "purchase" | "deviceEarning">): string {
  return ([["purchase", "直属购买分成"], ["deviceEarning", "直属设备收益分成"]] as const).map(([key, label]) => {
    const rule = value[key];
    return `${label}：${rule.enabled ? "启用" : "停用"}，总比例 ${rule.totalRatePct}%，USDT ${rule.usdtSharePct}% / NEX ${100 - rule.usdtSharePct}%，冷却 ${rule.coolingDays} 天`;
  }).join("；");
}

export function directReferralAmplifies(before: DirectReferralPolicy, after: DirectReferralUpdate): boolean {
  return (["purchase", "deviceEarning"] as const).some(key => {
    const old = before[key], next = after[key];
    if (!next.enabled) return false;
    if (!old.enabled || next.coolingDays < old.coolingDays) return true;
    return next.totalRatePct * next.usdtSharePct > old.totalRatePct * old.usdtSharePct
      || next.totalRatePct * (100 - next.usdtSharePct) > old.totalRatePct * (100 - old.usdtSharePct);
  });
}
