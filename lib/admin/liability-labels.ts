/** Operator-facing names for the nine canonical liability categories.
 *  Shared by B2, D3 and L3 so a category reads the same on every screen; the backend
 *  CSV export (OpsTreasuryService.liabilityExportLabel) uses the same names. */
export const LIABILITY_DISPLAY_NAMES: Record<string, string> = {
  withdrawable_balance: "可提现余额",
  usdt_staking_principal: "USDT 质押锁定金额",
  staking_interest: "应付质押奖励",
  genesis_daily_emission: "创世节点应付收益",
  nex_v2_future: "UVT 锁仓到期应付",
  withdrawal_queue: "待处理提现",
  commission_cooling: "冷却期内未发放的奖励",
  lock_other: "其他锁定金额及奖励",
  unverified_deposit: "未确认的入金",
};

/** 这类钱是什么，给运营看的一句话。依据 PRD v1 [D3] ② 的科目表。 */
export const LIABILITY_EXPLANATIONS: Record<string, string> = {
  withdrawable_balance: "用户钱包里随时能提现的钱",
  usdt_staking_principal: "用户 USDT 质押还锁着的本金",
  staking_interest: "质押已产生、还没发的奖励",
  genesis_daily_emission: "创世节点持有人应得、还没发的收益",
  nex_v2_future: "UVT 锁仓到期时要兑付的钱",
  withdrawal_queue: "已提交、还没到账的提现",
  commission_cooling: "已算出、还在冷却期的奖励",
  lock_other: "已下线质押的存量本息和其他锁仓本息",
  unverified_deposit: "已收到、还没确认入账的入金",
};

export function liabilityDisplayName(category: string, fallback: string): string {
  return LIABILITY_DISPLAY_NAMES[category] ?? fallback;
}
