/** R1's six model families, using the same identity order as the E3 classification. */
export function supportsDeviceMonthlyTarget(skuId: string, tier = ""): boolean {
  const identity = `${skuId} ${tier}`.toLowerCase().replaceAll("_", "-");
  if (/phone|mobile/.test(identity)) return false;
  if (identity.includes("cloud")) return true;
  if (/pc|gpu/.test(identity)) return false;
  return /share|rack|pro|s1|box/.test(identity);
}
