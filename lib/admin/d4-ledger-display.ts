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
  team_commission: "团队奖励",
  binary_commission: "团队平衡奖励",
  referral_reward: "推荐奖励",
  genesis_dividend: "创世节点收益",
  leaderboard_prize: "榜单奖励",
  order_purchase: "商品购买",
  genesis_purchase: "创世节点购买",
  trade_in_purchase: "升级置换抵扣",
  deposit: "充值",
  topup: "充值",
  recharge: "充值",
  card_topup: "银行卡充值",
  chain_topup: "链上充值",
  vietqr_deposit: "VietQR 充值",
  withdrawal: "提现",
  withdraw_payout: "出款",
  withdraw_net_principal: "提现净额",
  withdraw_network_fee: "提现网络费",
  withdraw_penalty_fee: "提现违约金",
  withdraw_bank_fee: "银行出款手续费",
  withdraw_fee_offset: "提现手续费抵扣",
  withdraw_payout_refund: "出款退回",
  withdraw_payout_nex_refund: "UVT 出款退回",
  withdraw_refund: "提现退款",
  withdraw_fee_offset_refund: "手续费抵扣退回",
  staking_early_withdraw: "质押提前解锁",
  repurchase_early_withdraw: "锁定计划提前解锁",
  exchange: "兑换",
  swap: "兑换",
  asset_adjustment: "人工调整",
  c3_asset_adjustment: "人工调整",
  // 以下按 proto-backend origin/test 现在写进 nx_wallet_ledger.biz_type 的值补齐（重构说明「子类对照」）。
  adjustment: "人工调整",
  order_refund: "订单退款",
  device_purchase: "设备购买",
  exchange_swap: "兑换",
  promotion_reward: "促销奖励",
  promotion_reward_reversal: "促销奖励追回",
  trial_bonus_reversal: "试用奖励冲回",
  h2_trial_bonus: "试用奖励",
  h2_trial_remainder: "试用剩余金额",
  registration_gift_hold: "新人礼（待首笔购买）",
  event_reward: "活动奖励",
  wheel_reward: "幸运转盘奖励",
  chargeback_recovery: "拒付追回",
  staking_open: "质押锁定",
  staking_claim: "质押奖励领取",
  repurchase_claim: "锁定计划奖励领取",
  genesis_emission: "创世节点产出",
  genesis_secondary_sell: "创世节点转让卖出",
  genesis_secondary_buy: "创世节点转让买入",
};

/** 带动作后缀的业务类型按开头归类（CREGIS_REORG_<动作>）。 */
const SUBTYPE_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["cregis_reorg_", "Cregis 链上重组处置"],
];

/**
 * 后端写入的英文技术备注 → 运营可读说明。逐项对照 proto-backend origin/test 现在的写入处
 * （AppWithdrawalService、WithdrawalPayoutFinalizer、AppExchangeService、AppTrialLifecycleService、PromotionRewardService、
 * H4EventEngine、GenesisRaffleService、BinaryCommissionSettlementService、各 Mapper 的 INSERT）。
 * NEX 是改名 UVT 之前的写法，历史账单里还有，保留同样的说明。
 */
const REMARK_LABELS: Record<string, string> = {
  "g1 early withdrawal net principal; unearned interest forfeited": "质押提前解锁 · 返还扣除扣款后的锁定金额，未获得的质押奖励不发放",
  "g7 early withdrawal net principal; interest and tickets forfeited": "锁定计划提前解锁 · 返还扣除扣款后的锁定金额，锁定奖励不发放，本单已发且未使用的抽奖券作废",
  "bank payout net principal": "银行出款 · 净额",
  "d7 bank payout fee": "银行出款 · 手续费",
  "d2 withdrawal net principal": "提现 · 净额",
  "d5 actual network fee after uvt offset": "提现 · UVT 抵扣后的实际网络费",
  "d5 actual network fee after nex offset": "提现 · UVT 抵扣后的实际网络费",
  "h1 actual withdrawal penalty after uvt offset": "提现 · UVT 抵扣后的实际违约金",
  "h1 actual withdrawal penalty after nex offset": "提现 · UVT 抵扣后的实际违约金",
  "d5 uvt fee offset; penalty first, then network fee": "提现 · UVT 手续费抵扣（先抵违约金，再抵网络费）",
  "d5 nex fee offset; penalty first, then network fee": "提现 · UVT 手续费抵扣（先抵违约金，再抵网络费）",
  "provider payout failed; reserved withdrawal returned": "出款失败 · 退回冻结的提现金额",
  "provider payout failed; uvt fee offset returned": "出款失败 · 退回 UVT 手续费抵扣",
  "g2 canonical swap debit": "兑换 · 转出",
  "g2 canonical swap credit; fee allocated server side": "兑换 · 转入（已扣手续费）",
  "g2 queued swap source reservation": "兑换排队 · 预扣转出的资产",
  "g2 queued swap source reservation refund": "兑换排队 · 退回预扣",
  "g2 queued swap source reservation refund by ops cancellation": "兑换排队 · 运营取消后退回预扣",
  "uvel wallet order settlement": "商品购买 · 钱包付款",
  "e3 trade in upgrade wallet payment": "升级置换 · 钱包付款",
  "e3 capacity keep purchase wallet payment": "保留算力 · 钱包付款",
  "trial converted by server canonical charge": "试用转购买 · 扣款",
  "h2 conversion via uvel usdt wallet": "试用转购买 · USDT 钱包付款",
  "h2 conversion via nexion usdt wallet": "试用转购买 · USDT 钱包付款",
  "h2 shadow remainder credited after purchase": "试用转购买 · 试用剩余金额到账",
  "h2 shadow uvt credited after purchase": "试用转购买 · 试用奖励 UVT 到账",
  "h2 shadow nex credited after purchase": "试用转购买 · 试用奖励 UVT 到账",
  "confirmed full order refund": "整单退款",
  "confirmed whole order wallet refund": "整单退款 · 退回钱包",
  "cloud share daily uvt from settled compute receipt": "算力收益 · 每日 UVT",
  "server authoritative compute task reward": "算力任务收益",
  "server authoritative task reward": "任务收益",
  "activity reward": "活动中心奖励",
  "h4 lucky spin reward": "活动中心 · 幸运转盘奖励",
  "genesis raffle reward": "创世节点抽奖奖励",
  "f3 binary commission cooling payout": "团队平衡奖励 · 冷却期后发放",
};

/**
 * 带业务单号、参数的备注按开头的业务词归类，单号和参数留在技术详情。
 * 只按后端现在写的开头匹配，不按「D+数字」这类编号猜业务。
 */
const REMARK_PREFIXES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^E4 order refund\b/i, "订单退款"],
  [/^ADMIN manual HDPay BANKQR deposit\b/i, "人工补记 · HDPay 扫码充值"],
  [/^HDPay\s+BANKQR\s+deposit\b/i, "HDPay 扫码充值"],
  [/^HDPay\s+.*\bwithdraw(al)?\b/i, "HDPay 出款"],
  [/^VietQR\s+.*\bdeposit\b/i, "VietQR 银行充值"],
  [/^H2 forced trial charge\b/i, "试用强制扣款"],
  [/^Trial early-conversion reward reversed with order refund\b/i, "订单退款 · 追回提前转购的试用奖励"],
  [/^Trial reward reversed with refund\b/i, "退款 · 追回试用奖励"],
  [/^Cregis incident\b/i, "Cregis 链上异常处置"],
  [/^Approved promotion reward\b/i, "促销奖励"],
  [/^Direct referral recovery\b/i, "直推奖励追回"],
  [/^Direct referral wallet release\b/i, "直推奖励到账"],
  [/^Seven layer reissue recovery\b/i, "七层奖励补发追回"],
  [/^F5 commission reissue\b/i, "团队奖励补发"],
  [/^F2 unilevel\b/i, "团队奖励"],
  [/^F1 V-Rank reward REISSUE\b/i, "等级晋升奖励补发"],
  [/^F1 V-Rank reward\b/i, "等级晋升奖励"],
  [/^F3 binary settlement\b/i, "团队平衡奖励结算"],
  [/^Commission wallet release\b/i, "团队奖励到账"],
  [/^Commission wallet reversal\b/i, "团队奖励冲正"],
];

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

/** 业务子类:未知值原样保留(可能是新业务),绝不显示成空白。 */
export function formatD4Subtype(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "—";
  const key = raw.toLowerCase();
  return SUBTYPE_LABELS[key] ?? SUBTYPE_PREFIXES.find(([prefix]) => key.startsWith(prefix))?.[1] ?? (/[\u3400-\u9fff]/.test(raw) ? raw : "其他业务");
}

/** 「其他业务」时给提示用的原码（大写，和后端 biz_type 一致）；认得的返回空串。 */
export function d4SubtypeCode(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw && formatD4Subtype(raw) === "其他业务" ? raw.toUpperCase() : "";
}

/**
 * 备注:命中已知英文技术串时给中文说明;未知值原样保留。
 * 返回 `{ label, technical }`,`technical` 非空时调用方应把原始值降级为次级技术信息。
 */
export function formatD4Remark(value: unknown): { label: string; technical: string } {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return { label: "—", technical: "" };
  const mapped = REMARK_LABELS[normalizeKey(raw)];
  if (mapped) return { label: mapped, technical: raw };

  // 带业务单号的备注:形如 `HDPay BANKQR deposit VQR-...`、`HDPay BANKQR deposit WD-...`。
  // 此前这类值整串直上屏,运营看到的是英文技术串 + 内部单号 —— 缺陷要求「中文化,或把原始
  // 技术值降级为技术详情」。这里把前缀归一到中文业务名,单号降级为 title(鼠标悬停可见),
  // 单元格只留可读文案。前缀按**已知的业务词**匹配,不做「猜语义」的模糊替换。
  const prefixed = REMARK_PREFIXES.find(([pattern]) => pattern.test(raw));
  if (prefixed) {
    return { label: prefixed[1], technical: raw };
  }

  // 没有中文的串都是系统写的技术备注（含单号、键值、竖线分隔的参数）：整串降级为技术详情，
  // 单元格给中性说明，不把内部标识当业务文案上屏。有中文的（课程名、新人礼、运营写的理由）原样显示。
  if (!/[\u3400-\u9fff]/.test(raw)) {
    return { label: "系统备注（详见技术详情）", technical: raw };
  }
  return { label: raw, technical: "" };
}
