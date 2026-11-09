/** Same identity and precedence as E3, with the type persisted for delivery by E1. */
export function storeSkuModel(skuId: string, tier = "", productType?: string): string | null {
  // New codes undergo the catalog's slug normalization before they become runtime identities.
  const key = productType === undefined ? skuId.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") : skuId;
  const deliveredType = productType ?? (tier.trim() === "Share" ? "SHARE" : "DEVICE");
  const identity = `${key} ${deliveredType}`.toLowerCase().replaceAll("_", "-");
  if (/phone|mobile/.test(identity)) return null;
  if (identity.includes("cloud")) return "CloudShare";
  if (/pc|gpu/.test(identity)) return null;
  if (identity.includes("share")) return "CloudShare";
  if (/rack-p2|rackp2/.test(identity)) return "RackP2";
  if (/rack-p1|rackp1|rack/.test(identity)) return "RackP1";
  if (/pro-v2|prov2/.test(identity)) return "ProV2";
  if (identity.includes("pro")) return "Pro";
  if (/s1|box/.test(identity)) return "S1";
  return null;
}

export function supportsDeviceMonthlyTarget(skuId: string, tier = "", productType?: string): boolean {
  return storeSkuModel(skuId, tier, productType) !== null;
}

export const SKU_MODEL_UNRECOGNIZED_REASON = "商品编码需包含型号标识：s1、box、pro、pro-v2、rack-p1、rack-p2 或 share";
