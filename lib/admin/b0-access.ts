/**
 * 今日概览各块要的读权限（B0 重构说明 5.7）。没有权限的块不出现，也不发请求。
 * 只判断读权限。目标页是否可达由调用方判断（X03）。
 */
export const B0_BANK_REVIEW_PATH = "/finance/recon";

export function b0Blocks(authorities: readonly string[]) {
  const has = (code: string) => authorities.includes(code);
  return {
    fund: has("overview_b1_read"),
    coverDays: has("finance_d3_read") || has("overview_b2_read"),
    j1: has("emergency_j1_read"),
    withdrawals: has("finance_d2_read"),
    approvals: has("platform_a2_read"),
    support: has("service_m1_read") || has("service_m3_read"),
    sales: has("bi_l3_read") || has("device_e4_read") || has("overview_b0_sales_read"),
    moneyFlows: has("finance_d1_read") || has("finance_d2_read"),
    deposits: has("finance_d1_read"),
    netDeposits: has("finance_d1_read") && has("finance_d2_read"),
    newUsers: has("user_c1_read"),
    activeUsers: has("bi_l1_read"),
    netFlow: has("overview_b2_read"),
    devices: has("device_e5_read"),
    exchangeQueue: has("finprod_g2_read"),
    referralRewards: has("growth_h8_read"),
    promotionRewards: has("growth_promotion_read"),
    bankManualReview: has("finance_d1_read"),
    topup: has("finance_d1_read"),
    redemption: has("bi_l3_read"),
    funnel: has("overview_b3_read"),
    kpi: has("bi_l1_read"),
  };
}

export type B0Blocks = ReturnType<typeof b0Blocks>;

/** 看得到待处理或经营数的账号，打开就有今天的事，登录后落今日概览（Q-20）。 */
export function b0HasDailyWork(blocks: B0Blocks, canReachBankReview = false) {
  return blocks.fund || blocks.j1 || blocks.withdrawals || blocks.approvals || blocks.support
    || blocks.sales || blocks.newUsers || blocks.netFlow || blocks.devices
    || blocks.exchangeQueue || blocks.referralRewards || blocks.promotionRewards
    || (blocks.bankManualReview && canReachBankReview);
}

/** 一块都看不到的账号不进这页（PG-22）。 */
export function b0HasAnyBlock(blocks: B0Blocks) {
  return b0HasDailyWork(blocks) || blocks.topup || blocks.funnel || blocks.kpi;
}
