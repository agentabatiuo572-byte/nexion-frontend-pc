export const SKU_SERIES_CODES = ["CLOUD_SHARE", "S1", "PRO", "PRO_V2", "RACK_P1", "RACK_P2"] as const;
export type SkuSeriesCode = typeof SKU_SERIES_CODES[number];

export function supportsDeviceMonthlyTarget(seriesCode: string | null | undefined): seriesCode is SkuSeriesCode {
  return SKU_SERIES_CODES.some(code => code === seriesCode);
}

export const LEGACY_SKU_MODEL_UNRECOGNIZED_REASON = "商品编码需包含型号标识：s1、box、pro、pro-v2、rack-p1、rack-p2 或 share";

/** 运营看到的系列名，和商品名里的品牌写法一致；页面只显示名字，不显示代码值。 */
export const SKU_SERIES_NAMES: Record<SkuSeriesCode, string> = {
  CLOUD_SHARE: "Cloud Share", S1: "S1", PRO: "Pro", PRO_V2: "Pro v2", RACK_P1: "Rack P1", RACK_P2: "Rack P2",
};
export const SKU_SERIES_MISSING_TEXT = "未设系列";

/** 空值（null、undefined、空串）统一写「未设系列」，不按编号或名称推导。 */
export function skuSeriesText(seriesCode: unknown): string {
  const code = typeof seriesCode === "string" ? seriesCode.trim() : "";
  if (!code) return SKU_SERIES_MISSING_TEXT;
  return supportsDeviceMonthlyTarget(code) ? SKU_SERIES_NAMES[code] : "无法识别的系列";
}
