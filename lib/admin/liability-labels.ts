/** Operator-facing names for the nine canonical liability categories.
 *  Shared by B2, D3 and L3 so a category reads the same on every screen; the backend
 *  CSV export (OpsTreasuryService.liabilityExportLabel) uses the same names. */
export const LIABILITY_DISPLAY_NAMES: Record<string, string> = {
  withdrawable_balance: "可提现余额",
  usdt_staking_principal: "USDT 质押本金",
  staking_interest: "质押应付利息",
  genesis_daily_emission: "创世节点应付分红",
  nex_v2_future: "UVT 锁仓到期应付",
  withdrawal_queue: "待处理提现",
  commission_cooling: "冷却期内未发放的佣金",
  lock_other: "其他锁仓本息",
  unverified_deposit: "未确认的入金",
};

export function liabilityDisplayName(category: string, fallback: string): string {
  return LIABILITY_DISPLAY_NAMES[category] ?? fallback;
}
