import { f4Decimal } from "./f4-money";

/** Explicit operator inputs for the backend's one-time, approved L1–L7 INSERT. */
export interface F2UnilevelBootstrapLayer {
  layerNo: number;
  usdtPct: string;
  nexPerUsd: string;
}

/** 028c16e3: validate new proposals without normalizing the retained command text. */
export function validateF2UnilevelBootstrap(params: Record<string, unknown>) {
  if (params.expectedVersion !== 0 || !Array.isArray(params.layers) || params.layers.length !== 7) {
    throw new Error("F2_UNILEVEL_BOOTSTRAP_INVALID");
  }
  let invalidRates = false;
  let l1Rate: bigint | undefined;
  for (const [index, value] of params.layers.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("F2_UNILEVEL_BOOTSTRAP_INVALID");
    const layer = value as Record<string, unknown>;
    if (layer.layerNo !== index + 1 || typeof layer.usdtPct !== "string" || !layer.usdtPct
        || layer.usdtPct !== layer.usdtPct.trim() || typeof layer.nexPerUsd !== "string" || !layer.nexPerUsd
        || layer.nexPerUsd !== layer.nexPerUsd.trim()) throw new Error("F2_UNILEVEL_BOOTSTRAP_INVALID");
    // The backend's BigDecimal helper strips percent signs/commas and accepts exponent notation.
    const usdt = f4Decimal(layer.usdtPct.replace(/[%,]/g, ""));
    const nex = f4Decimal(layer.nexPerUsd.replace(/[%,]/g, ""));
    if (usdt === null || nex === null) throw new Error("F2_UNILEVEL_BOOTSTRAP_INVALID");
    const [usdtWhole, usdtFraction = ""] = usdt.split(".");
    const fraction = usdtFraction.replace(/0+$/, "");
    if (fraction.length > 4) throw new Error("F2_USDT_RATE_PRECISION_INVALID");
    const [nexWhole, nexFraction = ""] = nex.split(".");
    if (nexFraction.replace(/0+$/, "").length > 6 || nexWhole.replace(/^-?0*/, "").length > 12) {
      throw new Error("F2_UNILEVEL_BOOTSTRAP_INVALID");
    }
    const rate = usdt.startsWith("-") ? BigInt(-1) : BigInt(usdtWhole) * BigInt(10000) + BigInt(fraction.padEnd(4, "0"));
    if (rate < BigInt(0) || rate > BigInt(1000000) || nex.startsWith("-")) invalidRates = true;
    if (index === 0) l1Rate = rate;
  }
  if (invalidRates) throw new Error("UNILEVEL_RULES_NOT_CONFIGURED");
  if (l1Rate !== BigInt(100000)) throw new Error("F2_L1_DIRECT_RATE_FIXED_AT_10_PERCENT");
}
