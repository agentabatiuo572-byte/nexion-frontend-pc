/** R1's six model families, using the same identity order as the E3 classification. */
export function supportsDeviceMonthlyTarget(skuId: string, tier = ""): boolean {
  const identity = `${skuId} ${tier}`.toLowerCase().replaceAll("_", "-");
  if (/phone|mobile/.test(identity)) return false;
  if (identity.includes("cloud")) return true;
  if (/pc|gpu/.test(identity)) return false;
  return /share|rack|pro|s1|box/.test(identity);
}

export const UNSUPPORTED_MONTHLY_TARGET_REASON = "此型号还没有产能规则，暂不支持任务等级和月收益目标";
