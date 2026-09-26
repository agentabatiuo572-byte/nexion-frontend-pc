import type { PurchaseGate } from "./platform-types";

export interface BackendPurchaseGate {
  rankMin?: number | null;
  activeDirectMin?: number | null;
  teamVolumeMin?: number | null;
  mode?: "all" | "either" | null;
  quotaCap?: number | null;
  quotaSold?: number | null;
  quotaPeriod?: "month" | "lifetime" | null;
  enforce?: boolean | null;
}

export function fromPurchaseGate(gate: BackendPurchaseGate | null | undefined): PurchaseGate | undefined {
  if (!gate) return undefined;
  const purchaseGate: PurchaseGate = {
    rankMin: gate.rankMin ?? undefined,
    activeDirectMin: gate.activeDirectMin ?? undefined,
    teamVolumeMin: gate.teamVolumeMin ?? undefined,
    mode: gate.mode === "either" ? "either" : "all",
    quotaCap: gate.quotaCap ?? undefined,
    quotaSold: gate.quotaSold ?? undefined,
    // Preserve a legacy month value for the editor to surface as HOLD. The
    // form blocks saving it and formToGate serializes only lifetime.
    quotaPeriod: gate.quotaPeriod === "month" ? "month" : gate.quotaCap != null ? "lifetime" : undefined,
    enforce: gate.enforce !== false,
  };
  const hasValue =
    purchaseGate.rankMin != null ||
    purchaseGate.activeDirectMin != null ||
    purchaseGate.teamVolumeMin != null ||
    purchaseGate.quotaCap != null;
  return hasValue ? purchaseGate : undefined;
}

export function toPurchaseGate(gate: PurchaseGate | undefined): BackendPurchaseGate | null {
  if (!gate) return null;
  return {
    rankMin: gate.rankMin ?? null,
    activeDirectMin: gate.activeDirectMin ?? null,
    teamVolumeMin: gate.teamVolumeMin ?? null,
    mode: gate.mode,
    quotaCap: gate.quotaCap ?? null,
    quotaSold: gate.quotaSold ?? null,
    quotaPeriod: gate.quotaCap != null ? "lifetime" : null,
    enforce: gate.enforce,
  };
}
