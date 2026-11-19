export const SKU_SERIES = [
  { value: "CLOUD_SHARE", label: "Cloud Share" },
  { value: "S1", label: "S1" },
  { value: "PRO", label: "Pro" },
  { value: "PRO_V2", label: "Pro v2" },
  { value: "RACK_P1", label: "Rack P1" },
  { value: "RACK_P2", label: "Rack P2" },
];

export function supportsDeviceMonthlyTarget(seriesCode: string | null | undefined): boolean {
  return SKU_SERIES.some(series => series.value === seriesCode);
}

export function skuSeriesLabel(seriesCode: string | null | undefined): string {
  return SKU_SERIES.find(series => series.value === seriesCode)?.label ?? "未选系列";
}

export const SKU_MODEL_UNRECOGNIZED_REASON = "请选择商品所属系列";
