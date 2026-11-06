export const TREASURY_VALUATION_UNAVAILABLE = "暂时无法估值";
export const TREASURY_EXPORT_BLOCKED = "暂时无法估值，导出的金额会低报，等价格恢复后再导。";

export function treasuryValuation(raw: Record<string, unknown>, invalid: () => never) {
  if (raw.valuationStatus === undefined && raw.valuationReliable === undefined) return "LEGACY";
  if (raw.valuationStatus === "AVAILABLE" && raw.valuationReliable === true) return "AVAILABLE";
  if (raw.valuationStatus === "VALUATION_UNAVAILABLE" && raw.valuationReliable === false) return "VALUATION_UNAVAILABLE";
  return invalid();
}
