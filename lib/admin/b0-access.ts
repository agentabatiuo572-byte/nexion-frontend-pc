/**
 * 今日概览各块要的读权限（B0 重构说明 5.7）。没有权限的块不出现，也不发请求。
 * 不依赖菜单：落地页计算在 console-nav 里用它，目标页是否可达由页面逐行判断（X03）。
 */
const DEVICE_READS = ["device_e1_read", "device_e2_read", "device_e3_read", "device_e4_read", "device_e5_read", "device_e6_read"];

export function b0Blocks(authorities: readonly string[]) {
  const has = (code: string) => authorities.includes(code);
  return {
    fund: has("overview_b1_read"),
    coverDays: has("finance_d3_read") || has("overview_b2_read"),
    j1: has("emergency_j1_read"),
    withdrawals: has("finance_d2_read"),
    approvals: has("platform_a2_read"),
    support: has("service_m1_read") || has("service_m3_read"),
    sales: has("bi_l3_read"),
    newUsers: has("user_c1_read"),
    netFlow: has("overview_b2_read"),
    devices: DEVICE_READS.some(has),
    topup: has("finance_d1_read"),
    redemption: has("bi_l3_read"),
    funnel: has("overview_b3_read"),
    totalUsers: has("user_c1_read"),
    kpi: has("bi_l1_read"),
  };
}

export type B0Blocks = ReturnType<typeof b0Blocks>;

/** 看得到待处理或经营数的账号，打开就有今天的事，登录后落今日概览（Q-20）。 */
export function b0HasDailyWork(blocks: B0Blocks) {
  return blocks.fund || blocks.j1 || blocks.withdrawals || blocks.approvals || blocks.support
    || blocks.sales || blocks.newUsers || blocks.netFlow || blocks.devices;
}

/** 一块都看不到的账号不进这页（PG-22）。 */
export function b0HasAnyBlock(blocks: B0Blocks) {
  return b0HasDailyWork(blocks) || blocks.topup || blocks.funnel || blocks.kpi;
}
