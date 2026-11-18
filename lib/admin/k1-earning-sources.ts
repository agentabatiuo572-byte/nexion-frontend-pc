/**
 * 被保护收益（nx_earnings_release_entry.source_type）的来源名，K1 收益审核和 A2 两类 K1 审批单共用。
 * 来源码取自后端写入被保护收益的各处（EarningsReleaseService.creditReward 的调用方）；叫法和 H、G、I 各页一致。
 * 测试环境写入时前面加 MOCK_，名字相同。前六项是旧数据可能留下的来源码。
 */
const K1_EARNING_SOURCE_NAMES: Record<string, string> = {
  TRIAL: "试用收益", DEVICE: "设备收益", TASK: "任务奖励", COMMISSION: "团队奖励", REFERRAL: "邀请奖励", WELCOME: "新人奖励",
  QUEST_REWARD: "任务奖励",
  EVENT_REWARD: "活动奖励",
  PROMOTION_REWARD: "促销活动奖励",
  DAILY_CHECK_IN: "签到奖励",
  DAILY_MILESTONE: "连签里程碑奖励",
  EARNING_MILESTONE: "收益里程碑奖励",
  H4_WHEEL: "转盘奖励",
  H2_TRIAL_BONUS: "试用奖励",
  H2_TRIAL_REMAINDER: "试用剩余金额",
  H8_REFERRAL: "邀请奖励",
  DIRECT_REFERRAL: "好友奖励",
  STAKING_INTEREST: "质押奖励",
  G4_GENESIS_EMISSION: "创世节点收益",
  LEARNING_REWARD: "课程奖励",
};

/** 后端没给来源写「来源未知」；给了但这里不认识的写「其他来源」，原值由调用方放进技术信息。 */
export function k1EarningSourceName(code: string | null | undefined): string {
  const key = (code ?? "").trim().toUpperCase();
  if (!key) return "来源未知";
  return K1_EARNING_SOURCE_NAMES[key.replace(/^MOCK_/, "")] ?? "其他来源";
}
