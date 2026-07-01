/**
 * Janus C2 控制台(K6)— 文案契约(单源)。
 * 🔴 铁律:UI 交互层禁出现工程化代码命名(ENV_FILTERED / MANUAL_HOLD / RECOMMENDED…)。
 * 任何状态 / 动作 / 来源 / 原因分类在界面必须经此映射为运营可读中文;
 * 代码 enum 仅作内部 key,如需展示原始 key 只能作 mono 小号副标。
 */
import type {
  ConfirmationMode,
  DeviceStatus,
  EffectiveTiming,
  HealthLevel,
  RecommendationLevel,
  Role,
  RuleMode,
  RuleOp,
  StatusSource,
  StrategyActionType,
  StrategyStatus,
} from "./types";

/** 视觉色调键 → k6 css 的 .k6-bdg / .k6-status 修饰类。 */
export type Tone = "good" | "warning" | "danger" | "cyan" | "dim";

// ===== 设备状态(PRD §8.1 / §8.2)=====
export const STATUS_LABEL: Record<DeviceStatus, string> = {
  NEW: "新设备",
  OBSERVING: "继续观察",
  RECOMMENDED: "建议下发",
  HIT: "已命中",
  ACTIVATED: "已激活",
  ENV_FILTERED: "环境过滤",
  MANUAL_HOLD: "人工挂起",
  MANUAL_FORCED: "手动下发",
  BLOCKED: "禁止下发",
  STALE: "长时间未上报",
  RESET: "已重置",
  ERROR: "状态异常",
};

export const STATUS_TONE: Record<DeviceStatus, Tone> = {
  NEW: "dim",
  OBSERVING: "cyan",
  RECOMMENDED: "good",
  HIT: "warning",
  ACTIVATED: "good",
  ENV_FILTERED: "warning",
  MANUAL_HOLD: "cyan",
  MANUAL_FORCED: "warning",
  BLOCKED: "danger",
  STALE: "dim",
  RESET: "cyan",
  ERROR: "danger",
};

/** 状态解释文案(PRD §8.2:每个状态必须展示解释,不能只显示状态名)。 */
export const STATUS_EXPLAIN: Record<DeviceStatus, string> = {
  NEW: "首次上报或数据不足,尚未形成明确判断,继续收集行为。",
  OBSERVING: "环境未过滤,但成熟度不足或策略尚未命中,保持白壳继续观察。",
  RECOMMENDED: "成熟度达到阈值、环境风险低,建议运营确认下发。",
  HIT: "自动策略已判定可下发,等待激活或下发链路。",
  ACTIVATED: "已写入远程地址或激活标记,后续进入真盘。",
  ENV_FILTERED: "命中沙箱 / 审核 / 异常环境信号,默认不下发,可复核解除。",
  MANUAL_HOLD: "运营临时暂停自动决策,到期后恢复评估或手动释放。",
  MANUAL_FORCED: "运营绕过自动策略强制下发,当前或下次会话接管。",
  BLOCKED: "明确禁止该设备下发,优先级高于策略命中,解除需更高权限。",
  STALE: "最近上报超过阈值,等待新上报,不建议直接下发。",
  RESET: "已清除激活或人工覆盖,回到策略重新评估。",
  ERROR: "数据不完整或策略计算 / 下发失败,需工程或高级运营处理。",
};

/** 建议动作(PRD §7.2 建议动作列 / §18.1 主操作):状态 → 下一步运营动作。 */
export const SUGGESTED_ACTION: Record<DeviceStatus, string> = {
  NEW: "继续收集",
  OBSERVING: "继续观察",
  RECOMMENDED: "确认下发",
  HIT: "激活接管",
  ACTIVATED: "等待启动",
  ENV_FILTERED: "复核解除",
  MANUAL_HOLD: "等待恢复",
  MANUAL_FORCED: "跟进接管",
  BLOCKED: "保持禁止",
  STALE: "等待新上报",
  RESET: "重新评估",
  ERROR: "排查异常",
};

/** 渠道(PRD §4 渠道分类):内部 enum → 运营可读中文,避免英文 enum 外露。 */
export const CHANNEL_LABEL: Record<string, string> = {
  official: "官网",
  ad: "广告",
  invite: "邀请",
  test: "测试包",
  internal: "内部包",
};
export const channelLabel = (c?: string): string => (c ? CHANNEL_LABEL[c] ?? c : "—");

/** 远程地址配置键(PRD §9.2 remoteUrlKey):内部 key → 运营可读中文。 */
export const REMOTE_URL_LABEL: Record<string, string> = {
  default: "正盘默认首页",
  backup: "备用接管线路",
  promo: "活动接管线路",
};
export const remoteUrlLabel = (key?: string | null): string => (key ? REMOTE_URL_LABEL[key] ?? "未知接管线路" : "—");

// ===== 状态来源(PRD §4 状态来源 / §7.2)=====
export const STATUS_SOURCE_LABEL: Record<StatusSource, string> = {
  system: "系统",
  strategy: "自动策略",
  environment: "环境识别",
  manual: "人工覆盖",
  error: "系统异常",
};

// ===== 策略状态(PRD §6.1)=====
export const STRATEGY_STATUS_LABEL: Record<StrategyStatus, string> = {
  draft: "草稿",
  active: "生效中",
  paused: "已暂停",
  archived: "已归档",
};

export const STRATEGY_STATUS_TONE: Record<StrategyStatus, Tone> = {
  draft: "dim",
  active: "good",
  paused: "warning",
  archived: "dim",
};

// ===== 策略动作(PRD §6.4)=====
export const ACTION_TYPE_LABEL: Record<StrategyActionType, string> = {
  BENIGN: "保持白壳",
  RECOMMEND: "进入建议下发",
  REVERSAL_IMMEDIATE: "当前会话立即接管",
  REVERSAL_SESSION_EDGE: "下次会话边界接管",
  ENV_FILTER: "标记环境过滤",
  MANUAL_HOLD: "暂停自动决策",
  BLOCK: "禁止下发",
  DRY_RUN_ONLY: "仅干跑模拟",
};

// ===== 规则组合(PRD §6.2)=====
export const RULE_MODE_LABEL: Record<RuleMode, string> = {
  ALL: "全部满足",
  ANY: "任一满足",
  N_OF_M: "满足其中若干条",
  NOT: "排除",
  WEIGHTED_SCORE: "加权评分达标",
};

export const RULE_OP_LABEL: Record<RuleOp, string> = {
  "=": "等于",
  "!=": "不等于",
  ">": "大于",
  ">=": "大于等于",
  "<": "小于",
  "<=": "小于等于",
  in: "属于",
  notIn: "不属于",
  between: "介于",
  contains: "包含",
};

// ===== 建议等级(PRD §10.3)=====
export const RECOMMENDATION_LEVEL_LABEL: Record<RecommendationLevel, string> = {
  STRONG: "强建议",
  NORMAL: "普通建议",
  OBSERVE: "继续观察",
  REJECT: "不建议",
  REVIEW: "环境复核",
  FILTER: "环境过滤",
};

export const RECOMMENDATION_LEVEL_TONE: Record<RecommendationLevel, Tone> = {
  STRONG: "good",
  NORMAL: "cyan",
  OBSERVE: "dim",
  REJECT: "dim",
  REVIEW: "warning",
  FILTER: "danger",
};

// ===== 角色(PRD §15)=====
export const ROLE_LABEL: Record<Role, string> = {
  viewer: "只读观察者",
  operator: "初级运营",
  senior_operator: "高级运营",
  admin: "管理员",
};

// ===== 生效时机 / 确认模式(PRD §9.2)=====
export const EFFECTIVE_TIMING_LABEL: Record<EffectiveTiming, string> = {
  immediate: "立即生效",
  session_edge: "下次会话生效",
};

export const CONFIRMATION_MODE_LABEL: Record<ConfirmationMode, string> = {
  standard: "常规确认",
  strong_single: "单人强确认",
};

// ===== 健康度等级(PRD §12.2)=====
export const HEALTH_LEVEL_LABEL: Record<HealthLevel, string> = {
  HEALTHY: "健康",
  WARNING: "轻微异常",
  RISK: "存在风险",
  CRITICAL: "严重异常",
};

export const HEALTH_LEVEL_TONE: Record<HealthLevel, Tone> = {
  HEALTHY: "good",
  WARNING: "warning",
  RISK: "warning",
  CRITICAL: "danger",
};

/** 手动修改原因分类(PRD §9.2 reasonCategory,枚举值用下拉不让手输)。 */
export const REASON_CATEGORIES: string[] = [
  "等待更多行为数据",
  "复核环境信号",
  "已知合作 / 内部设备",
  "疑似审核 / 自动化环境",
  "高风险设备排除",
  "客诉 / 线索跟进",
  "现场演示需要",
  "其他(在详细原因说明)",
];
