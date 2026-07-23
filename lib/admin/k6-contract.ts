import type {
  AuditLog,
  C2Summary,
  DecisionRuleResult,
  DecisionSnapshot,
  Device,
  DeviceStatus,
  FunnelRow,
  HealthReport,
  K6DashboardSnapshot,
  K6ExportFile,
  ManualOverride,
  Rule,
  RuleGroup,
  RuleMode,
  RuleOp,
  Session,
  Strategy,
  StrategyAction,
  StrategyActionType,
  StrategySafeguards,
  StrategyScope,
  StrategyStatus,
  StrategyVersion,
} from "./janus-c2/types";

export const K6_DEVICE_STATUSES = [
  "NEW", "OBSERVING", "RECOMMENDED", "HIT", "ACTIVATED", "ENV_FILTERED",
  "MANUAL_HOLD", "MANUAL_FORCED", "BLOCKED", "STALE", "RESET", "ERROR",
] as const;
export const K6_STATUS_SOURCES = ["system", "strategy", "environment", "manual", "error"] as const;
export const K6_DEVICE_PLATFORMS = ["iOS", "Android", "windows", "mac", "linux", "unknown"] as const;
export const K6_COMMAND_STATES = ["PENDING", "PUBLISHED", "ACKED", "FAILED", "EXPIRED"] as const;
export const K6_STRATEGY_STATUSES = ["draft", "active", "paused", "archived"] as const;
export const K6_ACTION_TYPES = [
  "BENIGN", "RECOMMEND", "REVERSAL_IMMEDIATE", "REVERSAL_SESSION_EDGE",
  "ENV_FILTER", "MANUAL_HOLD", "BLOCK", "DRY_RUN_ONLY",
] as const;
export const K6_RULE_MODES = ["ALL", "ANY", "N_OF_M", "NOT", "WEIGHTED_SCORE"] as const;
export const K6_RULE_OPS = ["=", "!=", ">", ">=", "<", "<=", "in", "notIn", "between", "contains"] as const;
export const K6_HEALTH_LEVELS = ["HEALTHY", "WARNING", "RISK", "CRITICAL"] as const;
export const K6_REMOTE_TARGETS = ["default", "backup", "promo"] as const;
export const K6_CHANNELS = ["official", "invite", "ad", "test", "internal"] as const;
export const K6_RULE_FIELDS = [
  "installDays", "maturityScore", "environmentRiskScore", "inviteCode", "channel",
  "activated", "status", "appOpenCount", "sessionCount", "foregroundDurationSeconds", "repeatStreakDays",
  "benchmarkViewed", "optimizeDone", "marketViewed", "walletViewed", "isHeadless", "automationSignalCount",
  "fpBlocklistHit", "screenAnomaly", "timezoneMismatch",
] as const;
const NUMERIC_RULE_FIELDS = new Set(["installDays", "appOpenCount", "sessionCount", "foregroundDurationSeconds", "repeatStreakDays", "maturityScore", "environmentRiskScore", "automationSignalCount"]);
const BOOLEAN_RULE_FIELDS = new Set(["benchmarkViewed", "optimizeDone", "marketViewed", "walletViewed", "isHeadless", "fpBlocklistHit", "screenAnomaly", "timezoneMismatch", "activated"]);

const FUNNEL_LABELS = ["总设备", "在线活跃", "环境通过", "成熟达标", "建议下发", "已命中", "已激活"] as const;

function invalid(path: string): never {
  throw new Error(`K6_RESPONSE_INVALID:${path}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(path);
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(path);
  return value;
}

function optionalText(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return text(value, path);
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(path);
  return value;
}

function integer(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const result = finite(value, path);
  if (!Number.isInteger(result) || result < min || result > max) invalid(path);
  return result;
}

function optionalInteger(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number | undefined {
  if (value === undefined || value === null) return undefined;
  return integer(value, path, min, max);
}

function optionalRate(value: unknown, path: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const result = finite(value, path);
  if (result < 0 || result > 100) invalid(path);
  return result;
}

function flag(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path);
  return value;
}

function oneOf<T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] {
  const result = text(value, path);
  if (!(allowed as readonly string[]).includes(result)) invalid(path);
  return result as T[number];
}

function optionalOneOf<T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return oneOf(value, allowed, path);
}

function stringArray(value: unknown, path: string, allowed?: readonly string[], unique = false): string[] {
  const result = array(value, path).map((item, index) => text(item, `${path}[${index}]`));
  if (unique && new Set(result).size !== result.length) invalid(`${path}.duplicate`);
  if (allowed && result.some((item) => !allowed.includes(item))) invalid(path);
  return result;
}

function optionalStringArray(value: unknown, path: string, allowed?: readonly string[]): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const result = stringArray(value, path, allowed);
  return result.length ? result : undefined;
}

function emptyRecord(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
}

function decisionRuleResult(value: unknown, path: string): DecisionRuleResult {
  const row = record(value, path);
  return {
    label: text(row.label, `${path}.label`),
    passed: flag(row.passed, `${path}.passed`),
    detail: text(row.detail, `${path}.detail`),
  };
}

function serverTrace(value: unknown, path: string): DecisionRuleResult[] {
  const details = record(value, path);
  const passed = flag(details.passed, `${path}.passed`);
  const hasPassedLeaves = Object.prototype.hasOwnProperty.call(details, "passedLeaves");
  const hasTotalLeaves = Object.prototype.hasOwnProperty.call(details, "totalLeaves");
  if (hasPassedLeaves !== hasTotalLeaves) invalid(path);
  if (hasPassedLeaves) {
    const passedLeaves = integer(details.passedLeaves, `${path}.passedLeaves`);
    const totalLeaves = integer(details.totalLeaves, `${path}.totalLeaves`);
    if (passedLeaves > totalLeaves) invalid(path);
  }
  const traces = stringArray(details.trace, `${path}.trace`, undefined, false);
  if (!traces.length) return [{ label: "服务端规则判定", passed, detail: passed ? "已命中" : "未命中" }];
  return traces.map((entry) => {
    if (entry === "NO_ACTIVE_STRATEGY_MATCH") return { label: "无生效策略命中", passed: false, detail: "保持观察" };
    const match = entry.match(/^(.*):(PASS|FAIL)$/);
    return match
      ? { label: match[1] || "规则", passed: match[2] === "PASS", detail: match[2] === "PASS" ? "服务端判定通过" : "服务端判定未通过" }
      : { label: "服务端判定轨迹", passed, detail: entry };
  });
}

function normalizeDecision(value: unknown, path: string): DecisionSnapshot | undefined {
  if (value === undefined || value === null || emptyRecord(value)) return undefined;
  const row = record(value, path);
  const strategyId = optionalText(row.strategyId, `${path}.strategyId`);
  const strategyName = optionalText(row.strategyName, `${path}.strategyName`) ?? strategyId;
  const rawResults = row.ruleResults;
  const ruleResults = Array.isArray(rawResults)
    ? rawResults.map((item, index) => decisionRuleResult(item, `${path}.ruleResults[${index}]`))
    : serverTrace(rawResults, `${path}.ruleResults`);
  return {
    strategyId,
    strategyName,
    strategyVersion: optionalInteger(row.strategyVersion, `${path}.strategyVersion`, 1),
    decidedAt: integer(row.decidedAt, `${path}.decidedAt`, 1),
    action: oneOf(row.action, K6_ACTION_TYPES, `${path}.action`),
    ruleResults,
    conflicts: optionalStringArray(row.conflicts, `${path}.conflicts`),
    blockedReason: optionalText(row.blockedReason, `${path}.blockedReason`),
  };
}

function normalizeSession(value: unknown, path: string): Session | undefined {
  if (value === undefined || value === null || emptyRecord(value)) return undefined;
  const row = record(value, path);
  return {
    sessionId: text(row.sessionId, `${path}.sessionId`),
    sid: optionalText(row.sid, `${path}.sid`),
    startedAt: integer(row.startedAt, `${path}.startedAt`, 1),
    lastSeenAt: integer(row.lastSeenAt, `${path}.lastSeenAt`, 1),
    appPhase: optionalText(row.appPhase, `${path}.appPhase`),
    simDay: optionalInteger(row.simDay, `${path}.simDay`, 0),
    ua: optionalText(row.ua, `${path}.ua`),
    deviceFp: row.deviceFp == null ? undefined : record(row.deviceFp, `${path}.deviceFp`),
    foregroundDurationSeconds: optionalInteger(row.foregroundDurationSeconds, `${path}.foregroundDurationSeconds`),
    pageViews: row.pageViews == null ? undefined : stringArray(row.pageViews, `${path}.pageViews`),
    actions: row.actions == null ? undefined : stringArray(row.actions, `${path}.actions`),
    lastDecision: normalizeDecision(row.lastDecision, `${path}.lastDecision`),
  };
}

function normalizeOverride(value: unknown, path: string): ManualOverride | undefined {
  if (value === undefined || value === null || emptyRecord(value)) return undefined;
  const row = record(value, path);
  return {
    targetStatus: oneOf(row.targetStatus, K6_DEVICE_STATUSES, `${path}.targetStatus`),
    reasonCategory: text(row.reasonCategory, `${path}.reasonCategory`),
    reasonText: text(row.reasonText, `${path}.reasonText`),
    operatorId: text(row.operatorId ?? row.actorId, `${path}.operatorId`),
    effectiveTiming: oneOf(row.effectiveTiming, ["immediate", "session_edge"] as const, `${path}.effectiveTiming`),
    expireAt: optionalInteger(row.expireAt, `${path}.expireAt`, 1),
    createdAt: integer(row.createdAt, `${path}.createdAt`, 1),
    confirmationMode: oneOf(row.confirmationMode, ["standard", "strong_single"] as const, `${path}.confirmationMode`),
    remoteUrlKey: optionalOneOf(row.remoteUrlKey, K6_REMOTE_TARGETS, `${path}.remoteUrlKey`),
  };
}

export function normalizeK6Device(value: unknown, path = "janus.device"): Device {
  const row = record(value, path);
  const environmentRiskScore = integer(row.environmentRiskScore, `${path}.environmentRiskScore`, 0, 100);
  const maturity = record(row.maturity, `${path}.maturity`);
  const environment = record(row.environment, `${path}.environment`);
  const platform = oneOf(row.platform, K6_DEVICE_PLATFORMS, `${path}.platform`);
  return {
    sid: text(row.sid, `${path}.sid`),
    deviceId: optionalText(row.deviceId, `${path}.deviceId`),
    firstSeenAt: integer(row.firstSeenAt, `${path}.firstSeenAt`, 1),
    lastSeenAt: integer(row.lastSeenAt, `${path}.lastSeenAt`, 1),
    installAt: optionalInteger(row.installAt, `${path}.installAt`, 1),
    installDays: integer(row.installDays, `${path}.installDays`),
    inviteCode: optionalText(row.inviteCode, `${path}.inviteCode`),
    channel: optionalOneOf(row.channel, K6_CHANNELS, `${path}.channel`),
    cohortId: optionalText(row.cohortId, `${path}.cohortId`),
    status: oneOf(row.status, K6_DEVICE_STATUSES, `${path}.status`) as DeviceStatus,
    desiredStatus: optionalOneOf(row.desiredStatus, K6_DEVICE_STATUSES, `${path}.desiredStatus`) as DeviceStatus | undefined,
    commandState: optionalOneOf(row.commandState, K6_COMMAND_STATES, `${path}.commandState`),
    statusSource: oneOf(row.statusSource, K6_STATUS_SOURCES, `${path}.statusSource`),
    activated: flag(row.activated, `${path}.activated`),
    remoteUrlKey: optionalOneOf(row.remoteUrlKey, K6_REMOTE_TARGETS, `${path}.remoteUrlKey`),
    maturityScore: integer(row.maturityScore, `${path}.maturityScore`, 0, 100),
    recommendationScore: integer(row.recommendationScore, `${path}.recommendationScore`, 0, 100),
    environmentRiskScore,
    priorityScore: integer(row.priorityScore, `${path}.priorityScore`, -1000, 1000),
    ua: optionalText(row.ua, `${path}.ua`),
    platform,
    model: optionalText(row.model, `${path}.model`),
    osName: optionalText(row.osName, `${path}.osName`),
    browser: optionalText(row.browser, `${path}.browser`),
    maturity: {
      appOpenCount: integer(maturity.appOpenCount, `${path}.maturity.appOpenCount`),
      sessionCount: integer(maturity.sessionCount, `${path}.maturity.sessionCount`),
      repeatStreakDays: integer(maturity.repeatStreakDays, `${path}.maturity.repeatStreakDays`),
      foregroundDurationSeconds: integer(maturity.foregroundDurationSeconds, `${path}.maturity.foregroundDurationSeconds`),
      benchmarkViewed: flag(maturity.benchmarkViewed, `${path}.maturity.benchmarkViewed`),
      optimizeDone: flag(maturity.optimizeDone, `${path}.maturity.optimizeDone`),
      marketViewed: flag(maturity.marketViewed, `${path}.maturity.marketViewed`),
      walletViewed: flag(maturity.walletViewed, `${path}.maturity.walletViewed`),
    },
    environment: {
      environmentRiskScore,
      riskReasons: environment.riskReasons == null ? [] : stringArray(environment.riskReasons, `${path}.environment.riskReasons`),
      isHeadless: flag(environment.isHeadless, `${path}.environment.isHeadless`),
      automationSignalCount: integer(environment.automationSignalCount, `${path}.environment.automationSignalCount`),
      fpBlocklistHit: flag(environment.fpBlocklistHit, `${path}.environment.fpBlocklistHit`),
      screenAnomaly: flag(environment.screenAnomaly, `${path}.environment.screenAnomaly`),
      timezoneMismatch: flag(environment.timezoneMismatch, `${path}.environment.timezoneMismatch`),
      languageMismatch: flag(environment.languageMismatch, `${path}.environment.languageMismatch`),
    },
    hitStrategy: optionalText(row.hitStrategy, `${path}.hitStrategy`),
    hitStrategyVersion: optionalInteger(row.hitStrategyVersion, `${path}.hitStrategyVersion`, 1),
    latestDecision: normalizeDecision(row.latestDecision, `${path}.latestDecision`),
    latestSession: normalizeSession(row.latestSession, `${path}.latestSession`),
    manualOverride: normalizeOverride(row.manualOverride, `${path}.manualOverride`),
    lastOperatorId: optionalText(row.lastOperatorId, `${path}.lastOperatorId`),
    lastOperationReason: optionalText(row.lastOperationReason, `${path}.lastOperationReason`),
    activationKind: optionalOneOf(row.activationKind, ["auto", "manual", "session_edge", "immediate"] as const, `${path}.activationKind`),
    tags: stringArray(row.tags, `${path}.tags`),
    version: integer(row.version, `${path}.version`),
  };
}

function normalizeRule(value: unknown, path: string, depth: number, requiresWeight = false): Rule | RuleGroup {
  if (depth > 8) invalid(`${path}.depth`);
  const row = record(value, path);
  if (row.mode !== undefined) {
    const mode = oneOf(row.mode, K6_RULE_MODES, `${path}.mode`) as RuleMode;
    const rawRules = array(row.rules, `${path}.rules`);
    if (!rawRules.length || rawRules.length > 100 || (mode === "NOT" && rawRules.length !== 1)) invalid(`${path}.rules`);
    const rules = rawRules.map((item, index) => normalizeRule(item, `${path}.rules[${index}]`, depth + 1, mode === "WEIGHTED_SCORE"));
    const weight = row.weight == null ? undefined : finite(row.weight, `${path}.weight`);
    if ((requiresWeight && (weight == null || weight <= 0)) || (weight != null && weight <= 0)) invalid(`${path}.weight`);
    const group: RuleGroup = { mode, rules, weight };
    if (mode === "N_OF_M") group.required = integer(row.required, `${path}.required`, 1, Math.max(1, rules.length));
    if (mode === "WEIGHTED_SCORE") {
      group.threshold = finite(row.threshold, `${path}.threshold`);
      if (group.threshold <= 0) invalid(`${path}.threshold`);
    }
    return group;
  }
  const field = oneOf(row.field, K6_RULE_FIELDS, `${path}.field`);
  const op = oneOf(row.op, K6_RULE_OPS, `${path}.op`) as RuleOp;
  if (row.value === undefined || row.value === null) invalid(`${path}.value`);
  if (NUMERIC_RULE_FIELDS.has(field)) {
    if (op === "contains") invalid(`${path}.op`);
    if (op === "between") {
      if (!Array.isArray(row.value) || row.value.length !== 2 || row.value.some((item) => typeof item !== "number" || !Number.isFinite(item)) || row.value[0] > row.value[1]) invalid(`${path}.value`);
    } else if (op === "in" || op === "notIn") {
      if (!Array.isArray(row.value) || !row.value.length || row.value.some((item) => typeof item !== "number" || !Number.isFinite(item))) invalid(`${path}.value`);
    } else finite(row.value, `${path}.value`);
  } else if (BOOLEAN_RULE_FIELDS.has(field)) {
    if (op === "in" || op === "notIn") {
      if (!Array.isArray(row.value) || !row.value.length || row.value.some((item) => typeof item !== "boolean")) invalid(`${path}.value`);
    } else if ((op !== "=" && op !== "!=") || typeof row.value !== "boolean") invalid(`${path}.value`);
  } else {
    if (!["=", "!=", "in", "notIn", "contains"].includes(op)) invalid(`${path}.op`);
    const allowed = field === "status" ? K6_DEVICE_STATUSES : field === "channel" ? K6_CHANNELS : undefined;
    if (op === "in" || op === "notIn") {
      const values = array(row.value, `${path}.value`).map((item, index) => text(item, `${path}.value[${index}]`));
      if (!values.length || (allowed && values.some((item) => !(allowed as readonly string[]).includes(item)))) invalid(`${path}.value`);
    } else {
      const valueText = text(row.value, `${path}.value`);
      if (allowed && !(allowed as readonly string[]).includes(valueText)) invalid(`${path}.value`);
    }
  }
  const weight = row.weight == null ? undefined : finite(row.weight, `${path}.weight`);
  if ((requiresWeight && (weight == null || weight <= 0)) || (weight != null && weight <= 0)) invalid(`${path}.weight`);
  return {
    field,
    op,
    value: row.value,
    label: text(row.label, `${path}.label`),
    weight,
  };
}

function normalizeRuleGroup(value: unknown, path: string): RuleGroup {
  const result = normalizeRule(value, path, 0);
  if (!("mode" in result)) invalid(path);
  return result;
}

function normalizeAction(value: unknown, path: string): StrategyAction {
  const row = record(value, path);
  const type = oneOf(row.type, K6_ACTION_TYPES, `${path}.type`) as StrategyActionType;
  const remoteUrlKey = optionalOneOf(row.remoteUrlKey, K6_REMOTE_TARGETS, `${path}.remoteUrlKey`);
  if ((type === "REVERSAL_IMMEDIATE" || type === "REVERSAL_SESSION_EDGE") && !remoteUrlKey) invalid(`${path}.remoteUrlKey`);
  return { type, remoteUrlKey };
}

function normalizeScope(value: unknown, path: string): StrategyScope {
  const row = record(value, path);
  return {
    channels: optionalStringArray(row.channels, `${path}.channels`, K6_CHANNELS),
    inviteCodes: optionalStringArray(row.inviteCodes, `${path}.inviteCodes`),
    cohortIds: optionalStringArray(row.cohortIds, `${path}.cohortIds`),
  };
}

function normalizeSafeguards(value: unknown, path: string): StrategySafeguards {
  const row = record(value, path);
  return {
    maxDailyRecommendations: optionalInteger(row.maxDailyRecommendations, `${path}.maxDailyRecommendations`),
    maxDailyHits: optionalInteger(row.maxDailyHits, `${path}.maxDailyHits`),
    requireFreshReportMinutes: optionalInteger(row.requireFreshReportMinutes, `${path}.requireFreshReportMinutes`),
    minDecisionIntervalHours: optionalInteger(row.minDecisionIntervalHours, `${path}.minDecisionIntervalHours`),
  };
}

function normalizeVersion(value: unknown, path: string): StrategyVersion {
  const row = record(value, path);
  return {
    version: integer(row.version, `${path}.version`, 1),
    note: text(row.note, `${path}.note`),
    actorId: text(row.actorId, `${path}.actorId`),
    createdAt: integer(row.createdAt, `${path}.createdAt`, 1),
    ruleTree: normalizeRuleGroup(row.ruleTree, `${path}.ruleTree`),
    action: normalizeAction(row.action, `${path}.action`),
  };
}

export function normalizeK6Strategy(value: unknown, path = "janus.strategy"): Strategy {
  const row = record(value, path);
  const rolloutRow = row.rollout == null || emptyRecord(row.rollout) ? undefined : record(row.rollout, `${path}.rollout`);
  const healthRow = row.healthConfig == null || emptyRecord(row.healthConfig) ? undefined : record(row.healthConfig, `${path}.healthConfig`);
  const startedAt = rolloutRow ? optionalInteger(rolloutRow.startedAt, `${path}.rollout.startedAt`, 1) : undefined;
  const endsAt = rolloutRow ? optionalInteger(rolloutRow.endsAt, `${path}.rollout.endsAt`, 1) : undefined;
  if (startedAt != null && endsAt != null && startedAt >= endsAt) invalid(`${path}.rollout.endsAt`);
  return {
    strategyId: text(row.strategyId, `${path}.strategyId`),
    name: text(row.name, `${path}.name`),
    description: typeof row.description === "string" ? row.description : invalid(`${path}.description`),
    status: oneOf(row.status, K6_STRATEGY_STATUSES, `${path}.status`) as StrategyStatus,
    version: integer(row.version, `${path}.version`, 1),
    priority: integer(row.priority, `${path}.priority`, 0, 1000),
    owner: text(row.owner, `${path}.owner`),
    scope: normalizeScope(row.scope, `${path}.scope`),
    ruleTree: normalizeRuleGroup(row.ruleTree, `${path}.ruleTree`),
    action: normalizeAction(row.action, `${path}.action`),
    safeguards: normalizeSafeguards(row.safeguards, `${path}.safeguards`),
    rollout: rolloutRow ? {
      percent: rolloutRow.percent == null ? 100 : integer(rolloutRow.percent, `${path}.rollout.percent`, 0, 100),
      cohortIds: optionalStringArray(rolloutRow.cohortIds, `${path}.rollout.cohortIds`),
      startedAt,
      endsAt,
    } : undefined,
    healthConfig: healthRow ? {
      maxHitRate: optionalRate(healthRow.maxHitRate, `${path}.healthConfig.maxHitRate`),
      maxFilterRate: optionalRate(healthRow.maxFilterRate, `${path}.healthConfig.maxFilterRate`),
      minActivationRate: optionalRate(healthRow.minActivationRate, `${path}.healthConfig.minActivationRate`),
    } : undefined,
    templateKey: optionalText(row.templateKey, `${path}.templateKey`),
    versions: array(row.versions, `${path}.versions`).map((item, index) => normalizeVersion(item, `${path}.versions[${index}]`)),
    createdAt: integer(row.createdAt, `${path}.createdAt`, 1),
    publishedAt: optionalInteger(row.publishedAt, `${path}.publishedAt`, 1),
    lockVersion: integer(row.lockVersion, `${path}.lockVersion`),
  };
}

export function normalizeK6Audit(value: unknown, path = "janus.audit"): AuditLog {
  const row = record(value, path);
  return {
    auditId: text(row.auditId, `${path}.auditId`),
    actorId: text(row.actorId, `${path}.actorId`),
    action: text(row.action, `${path}.action`),
    targetType: oneOf(row.targetType, ["device", "strategy", "config"] as const, `${path}.targetType`),
    targetId: text(row.targetId, `${path}.targetId`),
    beforeSnapshot: row.beforeSnapshot,
    afterSnapshot: row.afterSnapshot,
    reasonCategory: optionalText(row.reasonCategory, `${path}.reasonCategory`),
    reasonText: optionalText(row.reasonText, `${path}.reasonText`),
    sourceContext: row.sourceContext,
    createdAt: integer(row.createdAt, `${path}.createdAt`, 1),
    requestId: optionalText(row.requestId, `${path}.requestId`),
  };
}

export function normalizeK6Health(value: unknown, path = "janus.health"): HealthReport {
  const row = record(value, path);
  return {
    level: oneOf(row.level, K6_HEALTH_LEVELS, `${path}.level`),
    indicators: array(row.indicators, `${path}.indicators`).map((item, index) => {
      const indicator = record(item, `${path}.indicators[${index}]`);
      const rawNote = typeof indicator.note === "string" ? indicator.note : invalid(`${path}.indicators[${index}].note`);
      const note = rawNote.includes("nx_janus_device") ? "服务端设备台账" : rawNote;
      const raw = indicator.value;
      if ((typeof raw !== "string" && typeof raw !== "number") || (typeof raw === "number" && !Number.isFinite(raw))) invalid(`${path}.indicators[${index}].value`);
      return {
        key: text(indicator.key, `${path}.indicators[${index}].key`),
        label: text(indicator.label, `${path}.indicators[${index}].label`),
        value: `${String(raw)}${note === "%" || note === "台" ? note : ""}`,
        level: oneOf(indicator.level, K6_HEALTH_LEVELS, `${path}.indicators[${index}].level`),
        note,
      };
    }),
    reasons: stringArray(row.reasons, `${path}.reasons`),
    suggestions: stringArray(row.suggestions, `${path}.suggestions`),
  };
}

function normalizeSummary(value: unknown, path: string): C2Summary {
  const row = record(value, path);
  const result: C2Summary = {
    totalDevices: integer(row.totalDevices, `${path}.totalDevices`),
    activeDevices: integer(row.activeDevices, `${path}.activeDevices`),
    newDevices: integer(row.newDevices, `${path}.newDevices`),
    recommended: integer(row.recommended, `${path}.recommended`),
    hit: integer(row.hit, `${path}.hit`),
    activated: integer(row.activated, `${path}.activated`),
    envFiltered: integer(row.envFiltered, `${path}.envFiltered`),
    manualHold: integer(row.manualHold, `${path}.manualHold`),
    manualOverrides: integer(row.manualOverrides, `${path}.manualOverrides`),
    hitRate: finite(row.hitRate, `${path}.hitRate`),
  };
  if (result.hitRate < 0 || result.hitRate > 100) invalid(`${path}.hitRate`);
  if ([result.activeDevices, result.newDevices, result.recommended, result.hit, result.activated, result.envFiltered, result.manualHold, result.manualOverrides].some((count) => count > result.totalDevices)) invalid(`${path}.totalDevices`);
  return result;
}

export function normalizeK6Funnel(value: unknown, path = "janus.funnel"): FunnelRow[] {
  const rows = array(value, path);
  if (rows.length !== FUNNEL_LABELS.length) invalid(`${path}.length`);
  return rows.map((item, index) => {
    const row = record(item, `${path}[${index}]`);
    const label = text(row.label, `${path}[${index}].label`);
    if (label !== FUNNEL_LABELS[index]) invalid(`${path}[${index}].label`);
    const rate = finite(row.rate, `${path}[${index}].rate`);
    if (rate < 0 || rate > 100) invalid(`${path}[${index}].rate`);
    return { label, count: integer(row.count, `${path}[${index}].count`), rate };
  });
}

export function normalizeK6Dashboard(value: unknown, path = "janus.dashboard"): K6DashboardSnapshot {
  const row = record(value, path);
  const summary = normalizeSummary(row.summary, `${path}.summary`);
  const distributionRow = record(row.distribution, `${path}.distribution`);
  const distribution = Object.fromEntries(K6_DEVICE_STATUSES.map((status) => [status, integer(distributionRow[status], `${path}.distribution.${status}`)])) as Record<DeviceStatus, number>;
  if (Object.values(distribution).reduce((sum, count) => sum + count, 0) !== summary.totalDevices) invalid(`${path}.distribution.total`);
  const primaryStrategy = row.primaryStrategy == null || emptyRecord(row.primaryStrategy) ? undefined : normalizeK6Strategy(row.primaryStrategy, `${path}.primaryStrategy`);
  return {
    summary,
    distribution,
    funnel: normalizeK6Funnel(row.funnel, `${path}.funnel`),
    primaryStrategy,
    health: normalizeK6Health(row.health, `${path}.health`),
    recentAudit: array(row.recentAudit, `${path}.recentAudit`).map((item, index) => normalizeK6Audit(item, `${path}.recentAudit[${index}]`)),
  };
}

export function normalizeK6DevicePage(value: unknown): { total: number; pageNum: number; pageSize: number; records: Device[] } {
  const row = record(value, "janus.devices");
  const records = array(row.records, "janus.devices.records").map((item, index) => normalizeK6Device(item, `janus.devices.records[${index}]`));
  const total = integer(row.total, "janus.devices.total");
  const pageNum = integer(row.pageNum, "janus.devices.pageNum", 1);
  const pageSize = integer(row.pageSize, "janus.devices.pageSize", 1, 200);
  if (records.length > pageSize || records.length > total) invalid("janus.devices.records");
  return { total, pageNum, pageSize, records };
}

export function normalizeK6Strategies(value: unknown): Strategy[] {
  return array(value, "janus.strategies").map((item, index) => normalizeK6Strategy(item, `janus.strategies[${index}]`));
}

export function normalizeK6Audits(value: unknown): AuditLog[] {
  return array(value, "janus.audit").map((item, index) => normalizeK6Audit(item, `janus.audit[${index}]`));
}

export function normalizeK6DryRun(value: unknown): {
  evaluated: number; hit: number; recommend: number; filtered: number; takeover: number; other: number;
  conflicts: number; hitRate: number; dryRunId: string; configHash: string; expectedVersion: number;
} {
  const row = record(value, "janus.dryRun");
  const result = {
    evaluated: integer(row.evaluated, "janus.dryRun.evaluated"),
    hit: integer(row.hit, "janus.dryRun.hit"),
    recommend: integer(row.recommend, "janus.dryRun.recommend"),
    filtered: integer(row.filtered, "janus.dryRun.filtered"),
    takeover: integer(row.takeover, "janus.dryRun.takeover"),
    other: integer(row.other, "janus.dryRun.other"),
    conflicts: integer(row.conflicts, "janus.dryRun.conflicts"),
    hitRate: finite(row.hitRate, "janus.dryRun.hitRate"),
    dryRunId: text(row.dryRunId, "janus.dryRun.dryRunId"),
    configHash: text(row.configHash, "janus.dryRun.configHash"),
    expectedVersion: integer(row.expectedVersion, "janus.dryRun.expectedVersion"),
  };
  if (result.hit > result.evaluated || result.hitRate < 0 || result.hitRate > 100) invalid("janus.dryRun");
  return result;
}

export function normalizeK6ExportFile(value: unknown, reportType: "health" | "audit" | "funnel", format: "csv" | "json"): K6ExportFile {
  const row = record(value, "janus.export");
  const actualFormat = oneOf(row.format, ["csv", "json"] as const, "janus.export.format");
  if (actualFormat !== format) invalid("janus.export.format");
  const fileName = text(row.fileName, "janus.export.fileName");
  if (!fileName.endsWith(`.${format}`)) invalid("janus.export.fileName");
  const data = reportType === "health" ? normalizeK6Health(row.data, "janus.export.data")
    : reportType === "funnel" ? normalizeK6Funnel(row.data, "janus.export.data")
      : normalizeK6Audits(row.data);
  return { fileName, format: actualFormat, data };
}

function containsEmptyRule(group: RuleGroup): boolean {
  return group.rules.length === 0 || group.rules.some((node) => "mode" in node && containsEmptyRule(node));
}

export function strategyDraftIssues(strategy: Strategy): string[] {
  const issues: string[] = [];
  if (strategy.name.trim().length < 2) issues.push("策略名称至少 2 个字");
  if (!strategy.owner.trim()) issues.push("负责人不能为空");
  if (!Number.isInteger(strategy.priority) || strategy.priority < 0 || strategy.priority > 1000) issues.push("优先级必须是 0 到 1000 的整数");
  try { normalizeRuleGroup(strategy.ruleTree, "strategy.ruleTree"); } catch { issues.push("规则树存在空组、非法取值或组合条件"); }
  if (containsEmptyRule(strategy.ruleTree)) issues.push("规则组不能为空");
  if ((strategy.action.type === "REVERSAL_IMMEDIATE" || strategy.action.type === "REVERSAL_SESSION_EDGE")
      && !(K6_REMOTE_TARGETS as readonly string[]).includes(strategy.action.remoteUrlKey ?? "")) issues.push("接管动作必须选择远程地址");
  const lists = [strategy.scope.channels, strategy.scope.inviteCodes, strategy.scope.cohortIds, strategy.rollout?.cohortIds];
  if (lists.some((items) => items?.some((item) => !item.trim()) || (items && new Set(items).size !== items.length))) issues.push("适用范围与灰度队列不能包含空值或重复值");
  if (strategy.scope.channels?.some((channel) => !(K6_CHANNELS as readonly string[]).includes(channel))) issues.push("适用渠道包含未知值");
  const guards = Object.values(strategy.safeguards).filter((value): value is number => value !== undefined);
  if (guards.some((value) => !Number.isInteger(value) || value < 0)) issues.push("保护条件必须是非负整数");
  const percent = strategy.rollout?.percent ?? 100;
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) issues.push("灰度比例必须是 0 到 100 的整数");
  return Array.from(new Set(issues));
}
