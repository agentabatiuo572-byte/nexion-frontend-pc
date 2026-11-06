export const TREASURY_VALUATION_UNAVAILABLE = "暂时无法估值";

export function treasuryValuation(raw: Record<string, unknown>, invalid: () => never) {
  if (raw.valuationStatus === undefined && raw.valuationReliable === undefined) return "LEGACY";
  if (raw.valuationStatus === "AVAILABLE" && raw.valuationReliable === true) return "AVAILABLE";
  if (raw.valuationStatus === "VALUATION_UNAVAILABLE" && raw.valuationReliable === false) return "VALUATION_UNAVAILABLE";
  return invalid();
}
