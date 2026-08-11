/**
 * Janus C2 控制台(K6)— 数据模型(PRD §16)。
 * 100% backend-replaceable:纯可序列化结构,时间用 ms epoch,无函数/类实例。
 * 真后台对接时这些接口即 API 响应 schema,前端零重写。
 * 文案不在这里 —— 所有 code→运营可读中文映射在 labels.ts(单源)。
 */
import type { TakeoverExecution } from "./takeover";

// ===== 设备状态机(PRD §8.1)=====
export type DeviceStatus =
  | "NEW"
  | "OBSERVING"
  | "RECOMMENDED"
  | "HIT"
  | "ACTIVATED"
  | "ENV_FILTERED"
  | "MANUAL_HOLD"
  | "MANUAL_FORCED"
  | "BLOCKED"
  | "STALE"
  | "RESET"
  | "ERROR";

/** 状态来源(PRD §4 状态来源 / §7.2)。 */
export type StatusSource = "system" | "strategy" | "environment" | "manual" | "error";

/** App / H5 producer 可上报的平台值。 */
export type DevicePlatform = "iOS" | "Android" | "windows" | "mac" | "linux" | "unknown";

/** 角色(PRD §15)。 */
export type Role = "viewer" | "operator" | "senior_operator" | "admin";

// ===== 规则与策略(PRD §6 / §16.3 / §16.4)=====
export type RuleOp =
  | "="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "in"
  | "notIn"
  | "between"
  | "contains";

export type RuleMode = "ALL" | "ANY" | "N_OF_M" | "NOT" | "WEIGHTED_SCORE";

export interface Rule {
  field: string;
  op: RuleOp;
  value: unknown;
  /** WEIGHTED_SCORE 模式下的权重。 */
  weight?: number;
  /** 运营可读的规则说明(自然语言,展示用)。 */
  label: string;
}

export interface RuleGroup {
  mode: RuleMode;
  /** 作为加权组的子节点时由服务端参与计算。 */
  weight?: number;
  /** N_OF_M 模式下需满足的条数。 */
  required?: number;
  /** WEIGHTED_SCORE 模式下的命中阈值。 */
  threshold?: number;
  rules: Array<Rule | RuleGroup>;
}

export function isRuleGroup(node: Rule | RuleGroup): node is RuleGroup {
  return (node as RuleGroup).mode !== undefined;
}

export type StrategyStatus = "draft" | "active" | "paused" | "archived";

export type StrategyActionType =
  | "BENIGN"
  | "RECOMMEND"
  | "REVERSAL_IMMEDIATE"
  | "REVERSAL_SESSION_EDGE"
  | "ENV_FILTER"
  | "MANUAL_HOLD"
  | "BLOCK"
  | "DRY_RUN_ONLY";

export interface StrategyAction {
  type: StrategyActionType;
  /** 接管类动作的远程地址配置键。 */
  remoteUrlKey?: string;
  remoteTargetVersion?: number;
  remoteTargetCatalogVersion?: number;
}

export interface StrategyScope {
  channels?: string[];
  inviteCodes?: string[];
  cohortIds?: string[];
}

export interface StrategySafeguards {
  maxDailyRecommendations?: number;
  maxDailyHits?: number;
  requireFreshReportMinutes?: number;
  minDecisionIntervalHours?: number;
}

export interface RolloutConfig {
  /** 灰度比例 0–100。 */
  percent: number;
  cohortIds?: string[];
  startedAt?: number;
  endsAt?: number;
}

export interface HealthConfig {
  maxHitRate?: number;
  maxFilterRate?: number;
  minActivationRate?: number;
}

/** 策略版本快照(PRD §14.4,不可变)。 */
export interface StrategyVersion {
  version: number;
  /** 发布 / 暂停 / 回滚基线。 */
  note: string;
  actorId: string;
  createdAt: number;
  ruleTree: RuleGroup;
  action: StrategyAction;
}

export interface Strategy {
  strategyId: string;
  name: string;
  description: string;
  status: StrategyStatus;
  version: number;
  priority: number;
  owner: string;
  scope: StrategyScope;
  ruleTree: RuleGroup;
  action: StrategyAction;
  safeguards: StrategySafeguards;
  rollout?: RolloutConfig;
  healthConfig?: HealthConfig;
  /** 模板键:从 §14.2 预设模板派生时标记。 */
  templateKey?: string;
  versions: StrategyVersion[];
  createdAt: number;
  publishedAt?: number;
  /** 后端草稿乐观锁版本,只用于 If-Match/CAS。 */
  lockVersion?: number;
}

// ===== 判定轨迹(PRD §13.5)=====
export interface DecisionRuleResult {
  label: string;
  passed: boolean;
  /** 实际值说明,如「当前 3 天」。 */
  detail: string;
}

export interface DecisionSnapshot {
  strategyId?: string;
  strategyName?: string;
  strategyVersion?: number;
  decidedAt: number;
  action: StrategyActionType;
  ruleResults: DecisionRuleResult[];
  /** 冲突策略名(同设备多策略命中)。 */
  conflicts?: string[];
  /** 被保护规则阻断的原因。 */
  blockedReason?: string;
}

// ===== 手动覆盖(PRD §9.2 / §16.5)=====
export type ConfirmationMode = "standard" | "strong_single";
export type EffectiveTiming = "immediate" | "session_edge";

export interface ManualOverride {
  targetStatus: DeviceStatus;
  reasonCategory: string;
  reasonText: string;
  operatorId: string;
  effectiveTiming: EffectiveTiming;
  expireAt?: number;
  createdAt: number;
  confirmationMode: ConfirmationMode;
  roleGate?: Role;
  remoteUrlKey?: string;
  remoteTargetVersion?: number;
  remoteTargetCatalogVersion?: number;
}

// ===== 审计日志(PRD §16.6 / §19)=====
export interface AuditLog {
  auditId: string;
  actorId: string;
  action: string;
  targetType: "device" | "strategy" | "config";
  targetId: string;
  beforeSnapshot: unknown;
  afterSnapshot: unknown;
  reasonCategory?: string;
  reasonText?: string;
  /** 来源 IP / 后台登录上下文(PRD §19；由后端审计上下文注入)。 */
  sourceContext?: unknown;
  createdAt: number;
  requestId?: string;
}

// ===== 会话与设备(PRD §16.1 / §16.2)=====
export interface Session {
  sessionId: string;
  sid?: string;
  startedAt: number;
  lastSeenAt: number;
  appPhase?: string;
  simDay?: number;
  ua?: string;
  deviceFp?: Record<string, unknown>;
  foregroundDurationSeconds?: number;
  pageViews?: string[];
  actions?: string[];
  lastDecision?: DecisionSnapshot;
}

/** 设备成熟度信号(PRD §6.3.2 / §13.3)。 */
export interface MaturitySignals {
  appOpenCount: number;
  sessionCount: number;
  repeatStreakDays: number;
  foregroundDurationSeconds: number;
  benchmarkViewed: boolean;
  optimizeDone: boolean;
  marketViewed: boolean;
  walletViewed: boolean;
}

/** 环境风险信号(PRD §6.3.5 / §13.4)。 */
export interface EnvironmentSignals {
  environmentRiskScore: number;
  riskReasons: string[];
  isHeadless: boolean;
  automationSignalCount: number;
  fpBlocklistHit: boolean;
  screenAnomaly: boolean;
  timezoneMismatch: boolean;
  languageMismatch: boolean;
}

export interface Device {
  sid: string;
  deviceId?: string;
  firstSeenAt: number;
  lastSeenAt: number;
  installAt?: number;
  installDays: number;
  inviteCode?: string;
  channel?: string;
  cohortId?: string;
  status: DeviceStatus;
  statusSource: StatusSource;
  activated: boolean;
  remoteUrlKey?: string;
  remoteTargetVersion?: number;
  remoteTargetCatalogVersion?: number;
  maturityScore: number;
  recommendationScore: number;
  environmentRiskScore: number;
  priorityScore: number;
  ua?: string;
  platform: DevicePlatform;
  model?: string;
  osName?: string;
  browser?: string;
  maturity: MaturitySignals;
  environment: EnvironmentSignals;
  /** 最近命中的策略名 + 版本。 */
  hitStrategy?: string;
  hitStrategyVersion?: number;
  latestDecision?: DecisionSnapshot;
  latestSession?: Session;
  manualOverride?: ManualOverride;
  /** 最近人工操作人 + 原因(队列列展示)。 */
  lastOperatorId?: string;
  lastOperationReason?: string;
  activationKind?: "auto" | "manual" | "session_edge" | "immediate";
  tags: string[];
  /** 设备上报态与待下发命令分离,避免把数据库写成功误显示成设备已执行。 */
  desiredStatus?: DeviceStatus;
  commandState?: "PENDING" | "PUBLISHED" | "ACKED" | "FAILED" | "EXPIRED" | "CANCELLED";
  /**
   * 接管执行账本(2026-08-07 裁决①):commandState 是它的摘要,不是替代。
   * 后端未下发本段时页面显式说明「等待后端下发执行明细」,不用摘要伪装成明细。
   * 类型与判定见 lib/admin/janus-c2/takeover.ts。
   */
  takeover?: TakeoverExecution;
  version?: number;
}

// ===== 健康度(PRD §12)=====
export type HealthLevel = "HEALTHY" | "WARNING" | "RISK" | "CRITICAL";

export interface HealthIndicator {
  key: string;
  label: string;
  value: string;
  level: HealthLevel;
  /** 异常判定说明 + 建议动作(PRD §12.3 / §12.4)。 */
  note: string;
}

export interface HealthReport {
  level: HealthLevel;
  indicators: HealthIndicator[];
  /** 异常原因下钻。 */
  reasons: string[];
  /** 建议处理动作。 */
  suggestions: string[];
}

// ===== 建议等级(PRD §10.3)=====
export type RecommendationLevel =
  | "STRONG"
  | "NORMAL"
  | "OBSERVE"
  | "REJECT"
  | "REVIEW"
  | "FILTER";

/** 首页看板汇总(PRD §5.2 / §20.1)。 */
export interface C2Summary {
  totalDevices: number;
  activeDevices: number;
  newDevices: number;
  recommended: number;
  hit: number;
  activated: number;
  envFiltered: number;
  manualHold: number;
  manualOverrides: number;
  hitRate: number;
}

export interface FunnelRow {
  label: string;
  count: number;
  rate: number;
}

export interface K6DashboardSnapshot {
  executionEnvironment: "PRODUCTION" | "SANDBOX";
  summary: C2Summary;
  distribution: Record<DeviceStatus, number>;
  funnel: FunnelRow[];
  primaryStrategy?: Strategy;
  health: HealthReport;
  recentAudit: AuditLog[];
}

export interface K6ExportFile {
  fileName: string;
  format: "csv" | "json";
  data: HealthReport | FunnelRow[] | AuditLog[];
}
