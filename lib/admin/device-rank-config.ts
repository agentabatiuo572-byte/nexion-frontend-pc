export type DeviceRankTier = { name: string; sharePct: number; minTops: number; maxTops: number };
export type DeviceRankConfig = { version: number; enabled: boolean; tiers: DeviceRankTier[] };
export type DeviceRankTierDraft = { name: string; sharePct: string; minTops: string; maxTops: string };

function decimalPlaces(value: number): number {
  const [mantissa, exponent = "0"] = String(value).toLowerCase().split("e");
  return Math.max(0, (mantissa.split(".")[1]?.length ?? 0) - Number(exponent));
}

export function deviceRankConfigError(enabled: boolean, tiers: readonly DeviceRankTier[]): string {
  if (tiers.length > 20 || (enabled && tiers.length === 0)) return "开启时须配置 1–20 个档位，关闭时允许清空档位。";
  if (!tiers.length) return "";
  let shareTotal = 0;
  for (const [index, tier] of tiers.entries()) {
    const prefix = `第 ${index + 1} 档：`;
    if (!tier.name.trim() || tier.name.trim().length > 60) return `${prefix}名称须为 1–60 个字符。`;
    if (!Number.isFinite(tier.sharePct) || tier.sharePct < 0 || tier.sharePct > 100
      || decimalPlaces(tier.sharePct) > 2) return `${prefix}占比须为 0–100%，最多两位小数。`;
    if (![tier.minTops, tier.maxTops].every((value) => Number.isFinite(value) && value >= 0 && value <= 1e9 && decimalPlaces(value) <= 6)) return `${prefix}算力须为 0–1000000000 TOPS 的有限数字，最多六位小数。`;
    if (tier.minTops > tier.maxTops) return `${prefix}最高算力不能低于最低算力。`;
    shareTotal += Math.round(tier.sharePct * 100);
  }
  return shareTotal === 10000 ? "" : "全部档位占比合计必须为 100%。";
}

export function parseDeviceRankConfig(raw: unknown): DeviceRankConfig {
  const invalid = () => { throw new Error("设备预估排名配置返回异常，请重新读取后再修改。"); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
  const row = raw as Record<string, unknown>;
  if (!Number.isSafeInteger(row.version) || (row.version as number) < 0 || typeof row.enabled !== "boolean" || !Array.isArray(row.tiers)) return invalid();
  const tiers = row.tiers.map((value: unknown): DeviceRankTier => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
    const tier = value as Record<string, unknown>;
    if (typeof tier.name !== "string" || typeof tier.sharePct !== "number" || typeof tier.minTops !== "number" || typeof tier.maxTops !== "number") return invalid();
    return { name: tier.name, sharePct: tier.sharePct, minTops: tier.minTops, maxTops: tier.maxTops };
  });
  if (deviceRankConfigError(row.enabled, tiers)) return invalid();
  return { version: row.version as number, enabled: row.enabled, tiers };
}
