export interface UserLatestFundActivity extends Record<string, unknown> {
  sourceType: "DEPOSIT_ORDER" | "PAYMENT_RECORD" | "CARD_ADMISSION" | "HDPAY" | "VIETQR" | "VIETQR_RECONCILIATION" | "WITHDRAWAL";
  sourceId: number;
  bizNo: string | null;
  createdAt: string | null;
  amount: string | null;
  currency: string | null;
  status: string | null;
  paymentAmount: string | null;
  paymentCurrency: string | null;
}

/** Used at both 360 HTTP boundaries, before JSON.parse loses decimal digits. */
export function preserveUserFundAmounts(text: string): string {
  return text.replace(/("(?:amount|paymentAmount|refundAmountUsdt|balanceAfter|walletUsdt|walletNex|dailyUsdt|dailyNex|totalUsdt|totalNex|deviceDailyUsdt|deviceDailyNex|commissionUsdt|commissionNex|usdt|nex|currentUsdtBalance|currentNexBalance|confirmedUsd|completedUsd|requestedUsd|depositedUsd|withdrawnUsd|withdrawRequestedUsd|fee|grossFee|nexBurned|feeWaived|actualFee|netReceive|networkFee|networkFeeMin|networkFeeMax|creditedDepositTotal|successfulWithdrawalPrincipalTotal|successfulWithdrawalNetTotal|processingWithdrawalPrincipalTotal|processingWithdrawalNetTotal|balance)"\s*:\s*)(-?\d+(?:\.\d+)?)(?=\s*[,}])/g, '$1"$2"');
}

export function parseUserLatestFunds(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("USER360_RESPONSE_INVALID:latestFunds");
  const detail = value as Record<string, unknown>;
  const result: {
    latestDeposit?: UserLatestFundActivity | null; latestWithdrawal?: UserLatestFundActivity | null;
    latestDepositStatus?: "READY" | "ERROR"; latestWithdrawalStatus?: "READY" | "ERROR";
  } = {};
  const keys = ["latestDeposit", "latestWithdrawal", "latestDepositStatus", "latestWithdrawalStatus"];
  // No finance projection: the backend omits all four fields, rather than returning empty records.
  if (keys.every(key => !Object.prototype.hasOwnProperty.call(detail, key))) {
    if (detail.deposits || detail.withdrawals || detail.financial) throw new Error("USER360_RESPONSE_INVALID:latestFunds");
    return result;
  }
  for (const key of ["latestDeposit", "latestWithdrawal"] as const) {
    const invalid = (): never => { throw new Error(`USER360_RESPONSE_INVALID:${key}`); };
    const status = detail[`${key}Status`];
    if (status !== "READY" && status !== "ERROR") invalid();
    const raw = detail[key];
    if (raw !== null) {
      if (status !== "READY" || !raw || typeof raw !== "object" || Array.isArray(raw)) invalid();
      const row = raw as Record<string, unknown>;
      const sources = key === "latestWithdrawal" ? ["WITHDRAWAL"] : ["DEPOSIT_ORDER", "PAYMENT_RECORD", "CARD_ADMISSION", "HDPAY", "VIETQR", "VIETQR_RECONCILIATION"];
      if (!sources.includes(String(row.sourceType)) || !Number.isSafeInteger(row.sourceId) || Number(row.sourceId) <= 0) invalid();
      for (const field of ["bizNo", "createdAt", "currency", "status", "paymentCurrency"] as const) {
        if (row[field] !== null && (typeof row[field] !== "string" || !row[field].trim())) invalid();
      }
      if (row.createdAt !== null && !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(String(row.createdAt))) invalid();
      for (const field of ["amount", "paymentAmount"] as const) {
        if (row[field] !== null && (typeof row[field] !== "string" || !/^-?\d+(?:\.\d+)?$/.test(row[field]))) invalid();
      }
    }
    result[key] = raw as UserLatestFundActivity | null;
    result[`${key}Status`] = status as "READY" | "ERROR";
  }
  return result;
}
