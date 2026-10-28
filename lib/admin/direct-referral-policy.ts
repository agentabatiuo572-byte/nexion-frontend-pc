import { parseStrictFiniteNumber } from "./strict-number.ts";

export interface DirectReferralRule {
  enabled: boolean;
  totalRatePct: number;
  usdtSharePct: number;
  coolingDays: number;
}

export interface DirectReferralPolicy {
  schemaVersion: 2;
  policySchemaVersion: 1 | 2;
  purchaseSplitConfigured: boolean;
  legacyPurchase: DirectReferralRule | null;
  settlementMode: "DIRECT_ONLY_V1" | "SEVEN_V2";
  sevenLayerEnabled: boolean;
  sevenLayerPaused: boolean;
  sevenLayerActivationContractVersion: 1 | null;
  cutoverAt: string | null;
  source: "server";
  serverCanonical: true;
  sourceEnvironment: string;
  runId: string;
  configured: boolean;
  policyVersion: number;
  effectiveAt: string | null;
  nexUsdtPrice: number | null;
  sevenLayerRevision: number;
  sevenLayerReference: { revision: number; baseRatePct: number | null; coolingDays: number | null; legacyNexPerUsd: number | null };
  purchaseSplit: { enabled: boolean; usdtSharePct: number };
  deviceEarning: DirectReferralRule;
}

export interface DirectReferralUpdate {
  schemaVersion: 2;
  expectedVersion: number;
  expectedSevenLayerRevision: number;
  purchaseSplit: { enabled: boolean; usdtSharePct: number };
  deviceEarning: DirectReferralRule;
}

export function validateDirectReferralUpdate(value: DirectReferralUpdate): string | null {
  if (value.schemaVersion !== 2 || "purchase" in value) return "页面版本已更新，请刷新后重试。";
  if (!Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 0) return "设置版本有误，请刷新后重试。";
  if (!Number.isSafeInteger(value.expectedSevenLayerRevision) || value.expectedSevenLayerRevision < 0) return "七层设置版本有误，请刷新后重试。";
  if (!value.purchaseSplit || Object.keys(value.purchaseSplit).some(key => !["enabled", "usdtSharePct"].includes(key))) return "直属购买奖励只能设置开关和 USDT 占比。";
  for (const [key, label] of [["purchaseSplit", "直属购买奖励拆分"], ["deviceEarning", "直属设备收益分成"]] as const) {
    const rule = value[key];
    if (!rule || typeof rule.enabled !== "boolean") return `${label}：请选择启用状态。`;
    if (!Number.isFinite(rule.usdtSharePct) || rule.usdtSharePct < 0 || rule.usdtSharePct > 100 || (rule.enabled && (rule.usdtSharePct === 0 || rule.usdtSharePct === 100))) return `${label}：开启时 USDT 占比要大于 0% 且小于 100%。`;
  }
  const device = value.deviceEarning;
  if (!Number.isFinite(device.totalRatePct) || device.totalRatePct < 0 || device.totalRatePct > 100 || (device.enabled && device.totalRatePct === 0)) return "直属设备收益分成：总比例填 0–100%，开启时要大于 0。";
  if (!Number.isInteger(device.coolingDays) || device.coolingDays < 0 || device.coolingDays > 365) return "直属设备收益分成：冷却天数填 0–365 的整数。";
  return null;
}

export function parseDirectReferralPolicy(value: unknown): DirectReferralPolicy {
  const invalid = (): never => { throw new Error("DIRECT_REFERRAL_POLICY_INVALID"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (row.sevenLayerPaused !== undefined && typeof row.sevenLayerPaused !== "boolean") return invalid();
  if (row.sevenLayerPaused === true && row.sevenLayerEnabled !== true) return invalid();
  const number = (raw: unknown): number => parseStrictFiniteNumber(raw) ?? invalid();
  const nullableNumber = (raw: unknown) => raw === null ? null : number(raw);
  const date = (raw: unknown): string | null => raw === null ? null : typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(raw) && Number.isFinite(Date.parse(raw)) ? raw : invalid();
  const rule = (raw: unknown): DirectReferralRule => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
    const item = raw as Record<string, unknown>;
    if (typeof item.enabled !== "boolean") return invalid();
    return { enabled: item.enabled, totalRatePct: number(item.totalRatePct), usdtSharePct: number(item.usdtSharePct), coolingDays: number(item.coolingDays) };
  };
  if (row.source !== "server" || row.serverCanonical !== true || typeof row.sourceEnvironment !== "string" || !row.sourceEnvironment || typeof row.runId !== "string" || typeof row.configured !== "boolean") return invalid();
  if (row.schemaVersion !== 2 || (row.policySchemaVersion !== 1 && row.policySchemaVersion !== 2) || typeof row.purchaseSplitConfigured !== "boolean" || row.purchaseSplitConfigured !== (row.policySchemaVersion === 2) || !["DIRECT_ONLY_V1", "SEVEN_V2"].includes(String(row.settlementMode)) || typeof row.sevenLayerEnabled !== "boolean" || row.sevenLayerEnabled !== (row.settlementMode === "SEVEN_V2") || (row.sevenLayerEnabled && "purchase" in row)) return invalid();
  if (!row.purchaseSplit || typeof row.purchaseSplit !== "object" || Array.isArray(row.purchaseSplit) || !row.sevenLayerReference || typeof row.sevenLayerReference !== "object" || Array.isArray(row.sevenLayerReference)) return invalid();
  const split = row.purchaseSplit as Record<string, unknown>, ref = row.sevenLayerReference as Record<string, unknown>;
  if (typeof split.enabled !== "boolean" || Object.keys(split).some(key => !["enabled", "usdtSharePct"].includes(key))) return invalid();
  const result: DirectReferralPolicy = {
    schemaVersion: 2, settlementMode: row.settlementMode as DirectReferralPolicy["settlementMode"], sevenLayerEnabled: row.sevenLayerEnabled,
    sevenLayerPaused: row.sevenLayerPaused === true, sevenLayerActivationContractVersion: row.sevenLayerActivationContractVersion === 1 ? 1 : null,
    cutoverAt: date(row.cutoverAt),
    policySchemaVersion: row.policySchemaVersion as 1 | 2, purchaseSplitConfigured: row.purchaseSplitConfigured,
    legacyPurchase: row.purchase === undefined ? null : rule(row.purchase),
    source: "server", serverCanonical: true, sourceEnvironment: row.sourceEnvironment, runId: row.runId,
    configured: row.configured, policyVersion: number(row.policyVersion),
    effectiveAt: date(row.effectiveAt),
    nexUsdtPrice: row.nexUsdtPrice === null ? null : number(row.nexUsdtPrice),
    sevenLayerRevision: number(row.sevenLayerRevision),
    sevenLayerReference: { revision: number(ref.revision), baseRatePct: nullableNumber(ref.baseRatePct), coolingDays: nullableNumber(ref.coolingDays), legacyNexPerUsd: nullableNumber(ref.legacyNexPerUsd) },
    purchaseSplit: { enabled: split.enabled, usdtSharePct: number(split.usdtSharePct) }, deviceEarning: rule(row.deviceEarning),
  };
  if (validateDirectReferralUpdate({ ...result, expectedVersion: result.policyVersion, expectedSevenLayerRevision: result.sevenLayerRevision }) || (result.nexUsdtPrice !== null && result.nexUsdtPrice <= 0)) return invalid();
  const reference = result.sevenLayerReference;
  if (!result.purchaseSplitConfigured && (result.purchaseSplit.enabled || result.purchaseSplit.usdtSharePct !== 50)) return invalid();
  if (reference.revision !== result.sevenLayerRevision || (reference.baseRatePct !== null && reference.baseRatePct !== 10) || (reference.coolingDays !== null && (!Number.isInteger(reference.coolingDays) || reference.coolingDays < 0 || reference.coolingDays > 90)) || (reference.legacyNexPerUsd !== null && reference.legacyNexPerUsd < 0) || (result.sevenLayerEnabled && result.cutoverAt === null)) return invalid();
  if (result.configured ? result.policyVersion < 1 || result.effectiveAt === null : result.policyVersion !== 0 || result.effectiveAt !== null || result.purchaseSplit.enabled || result.purchaseSplit.usdtSharePct !== 50 || result.deviceEarning.enabled || result.deviceEarning.totalRatePct !== 0 || result.deviceEarning.usdtSharePct !== 50 || result.deviceEarning.coolingDays !== 0) return invalid();
  return result;
}

export function directReferralSummary(value: Pick<DirectReferralUpdate, "purchaseSplit" | "deviceEarning"> & { purchaseSplitConfigured?: boolean }): string {
  const split = value.purchaseSplit, device = value.deviceEarning;
  return `直属购买奖励：${value.purchaseSplitConfigured === false ? `未设置拆分，全额发 USDT（另加旧 UVT 奖励）；默认比例 USDT ${split.usdtSharePct}% / UVT ${100 - split.usdtSharePct}%，尚未生效` : split.enabled ? `开启拆分，USDT ${split.usdtSharePct}% / UVT ${100 - split.usdtSharePct}%` : `关闭拆分，全额发 USDT（另加旧 UVT 奖励）；已保存的比例 USDT ${split.usdtSharePct}% / UVT ${100 - split.usdtSharePct}%，关闭期间不生效`}；直属设备收益分成：${device.enabled ? "开启" : "关闭"}，总比例 ${device.totalRatePct}%，USDT ${device.usdtSharePct}% / UVT ${100 - device.usdtSharePct}%，冷却 ${device.coolingDays} 天`;
}

export function directReferralAmplifies(before: DirectReferralPolicy, after: DirectReferralUpdate): boolean {
  const oldSplit = before.purchaseSplit, nextSplit = after.purchaseSplit;
  if (oldSplit.enabled !== nextSplit.enabled || (nextSplit.enabled && oldSplit.usdtSharePct !== nextSplit.usdtSharePct)) {
    const { baseRatePct, legacyNexPerUsd } = before.sevenLayerReference, price = before.nexUsdtPrice;
    if (baseRatePct === null || legacyNexPerUsd === null || price === null) return true;
    const payout = (split: DirectReferralUpdate["purchaseSplit"]) => split.enabled
      ? [baseRatePct * split.usdtSharePct / 100, baseRatePct * (100 - split.usdtSharePct) / 100 / price]
      : [baseRatePct, baseRatePct * legacyNexPerUsd];
    const old = payout(oldSplit), next = payout(nextSplit);
    if (next.some((amount, index) => amount > old[index])) return true;
  }
  const old = before.deviceEarning, next = after.deviceEarning;
  return next.enabled && (!old.enabled || next.coolingDays < old.coolingDays
    || next.totalRatePct * next.usdtSharePct > old.totalRatePct * old.usdtSharePct
    || next.totalRatePct * (100 - next.usdtSharePct) > old.totalRatePct * (100 - old.usdtSharePct));
}
