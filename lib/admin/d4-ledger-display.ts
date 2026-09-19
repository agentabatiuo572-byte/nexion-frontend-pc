/**
 * D4 账本「业务子类 / 备注」的运营展示口径。
 *
 * 后端 `TreasuryLedgerBillView.subtype()` 直接返回 `biz_type` 的小写原值
 * (LEARNING_REWARD → learning_reward),`remark` 是各业务写入的英文技术串
 * (如 "D2 withdrawal net principal")。两者都是内部标识,直接上屏就是中英混排。
 * 这是展示层问题,不改后端契约:在 PC 侧做映射,原始值降级为可展开的技术详情。
 */

/** biz_type(小写)→ 运营可读业务子类。 */
const SUBTYPE_LABELS: Record<string, string> = {
  learning_reward: "学习奖励",
  daily_check_in: "每日签到",
  trial_charge: "试用扣款",
  trial_bonus: "试用奖励",
  quest_reward: "任务奖励",
  purchase_reward: "购买奖励",
  compute_task_reward: "算力任务收益",
  team_commission: "团队佣金",
  binary_commission: "对碰佣金",
  referral_reward: "推荐奖励",
  genesis_dividend: "Genesis 分红",
  leaderboard_prize: "榜单奖励",
  order_purchase: "商品购买",
  genesis_purchase: "Genesis 购买",
  trade_in_purchase: "以旧换新抵扣",
  deposit: "充值",
  topup: "充值",
  recharge: "充值",
  card_topup: "银行卡充值",
  chain_topup: "链上充值",
  vietqr_deposit: "VietQR 充值",
  withdrawal: "提现",
  withdraw_payout: "出款",
  withdraw_net_principal: "提现净额本金",
  withdraw_network_fee: "提现网络费",
  withdraw_penalty_fee: "提现违约金",
  withdraw_bank_fee: "银行出款手续费",
  withdraw_fee_offset: "提现手续费抵扣",
  withdraw_payout_refund: "出款退回",
  withdraw_payout_nex_refund: "NEX 出款退回",
  withdraw_refund: "提现退款",
  withdraw_fee_offset_refund: "手续费抵扣退回",
  exchange: "兑换",
  swap: "兑换",
  asset_adjustment: "人工调整",
  c3_asset_adjustment: "人工调整",
};

/** 后端写入的英文技术备注 → 运营可读说明。 */
const REMARK_LABELS: Record<string, string> = {
  "bank payout net principal": "银行出款 · 净额本金",
  "d7 bank payout fee": "银行出款 · 手续费",
  "d2 withdrawal net principal": "提现 · 净额本金",
  "d5 actual network fee after nex offset": "提现 · NEX 抵扣后的实际网络费",
  "h1 actual withdrawal penalty after nex offset": "提现 · NEX 抵扣后的实际违约金",
  "d5 nex fee offset; penalty first, then network fee": "提现 · NEX 手续费抵扣（先抵违约金，再抵网络费）",
};

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

/** 业务子类:未知值原样保留(可能是新业务),绝不显示成空白。 */
export function formatD4Subtype(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "—";
  return SUBTYPE_LABELS[raw.toLowerCase()] ?? raw;
}

/**
 * 备注:命中已知英文技术串时给中文说明;未知值原样保留。
 * 返回 `{ label, technical }`,`technical` 非空时调用方应把原始值降级为次级技术信息。
 */
export function formatD4Remark(value: unknown): { label: string; technical: string } {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return { label: "—", technical: "" };
  const mapped = REMARK_LABELS[normalizeKey(raw)];
  return mapped ? { label: mapped, technical: raw } : { label: raw, technical: "" };
}
