export const SKU_SERIES_CODES = ["CLOUD_SHARE", "S1", "PRO", "PRO_V2", "RACK_P1", "RACK_P2"] as const;
export type SkuSeriesCode = typeof SKU_SERIES_CODES[number];

export function supportsDeviceMonthlyTarget(seriesCode: string | null | undefined): seriesCode is SkuSeriesCode {
  return SKU_SERIES_CODES.some(code => code === seriesCode);
}

export const LEGACY_SKU_MODEL_UNRECOGNIZED_REASON = "商品编码需包含型号标识：s1、box、pro、pro-v2、rack-p1、rack-p2 或 share";
