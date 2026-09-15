import type { D1VietQrRow } from "./d-client";

type AmountRow = Pick<D1VietQrRow,
  "viewType" | "status" | "payableVnd" | "receivedVnd" | "lockedFxRateVndPerUsdt" | "creditedUsdt">;

/** Display-only amount; never used to settle, reconcile, or change an order. */
export function d1VietQrUsdtAmount(row: AmountRow): number | null {
  if (row.status === "CREDITED") {
    return Number.isFinite(row.creditedUsdt) && row.creditedUsdt >= 0 ? row.creditedUsdt : null;
  }
  // An unpaid intent has no received funds yet: quote its payable VND using its locked rate.
  // Other uncredited receipts continue to use received VND, including amount mismatches.
  const vnd = row.viewType === "INFLIGHT" ? row.payableVnd : row.receivedVnd;
  if (vnd === null || !Number.isFinite(vnd) || vnd < 0
      || !Number.isFinite(row.lockedFxRateVndPerUsdt) || row.lockedFxRateVndPerUsdt <= 0) return null;
  const amount = vnd / row.lockedFxRateVndPerUsdt;
  return Number.isFinite(amount) ? amount : null;
}
