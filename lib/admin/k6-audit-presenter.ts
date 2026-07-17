import {
  ACTION_TYPE_LABEL,
  AUDIT_ACTION_LABEL,
  CHANNEL_LABEL,
  COMMAND_STATE_LABEL,
  EFFECTIVE_TIMING_LABEL,
  RULE_MODE_LABEL,
  STATUS_LABEL,
  STATUS_SOURCE_LABEL,
  STRATEGY_STATUS_LABEL,
  remoteUrlLabel,
} from "./janus-c2/labels.ts";
import type { AuditLog } from "./janus-c2/types";

type JsonRecord = Record<string, unknown>;
type AuditExportRow = Record<string, string>;

export interface AuditObjectReference {
  label: "策略名称" | "策略编号" | "设备编号" | "配置编号";
  value: string;
}

const TARGET_LABEL: Record<AuditLog["targetType"], string> = {
  device: "设备",
  strategy: "策略",
  config: "配置",
};

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const nonEmptyText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const textList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(nonEmptyText).filter((item): item is string => item !== null)
    : [];

const knownLabel = (labels: Record<string, string>, value: unknown): string | null => {
  const key = nonEmptyText(value);
  return key ? labels[key] ?? null : null;
};

const yesNo = (value: unknown): string | null =>
  typeof value === "boolean" ? (value ? "是" : "否") : null;

export function formatAuditTime(value: unknown): string {
  const timestamp = finiteNumber(value);
  if (timestamp === null) return "—";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function joinKnown(labels: Record<string, string>, value: unknown): string | null {
  const localized = textList(value).map((item) => labels[item]).filter((item): item is string => Boolean(item));
  return localized.length ? localized.join("/") : null;
}

function ruleCount(value: unknown): number {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.rules)) return 0;
  return record.rules.reduce((count: number, child) => count + (asRecord(child)?.rules ? ruleCount(child) : 1), 0);
}

function scopeText(value: unknown): string | null {
  const scope = asRecord(value);
  if (!scope) return null;
  const parts: string[] = [];
  const channels = joinKnown(CHANNEL_LABEL, scope.channels);
  const inviteCodes = textList(scope.inviteCodes);
  const cohortIds = textList(scope.cohortIds);
  if (channels) parts.push(`渠道 ${channels}`);
  if (inviteCodes.length) parts.push(`邀请码 ${inviteCodes.join("/")}`);
  if (cohortIds.length) parts.push(`人群 ${cohortIds.join("/")}`);
  return parts.length ? parts.join("；") : null;
}

function ruleTreeText(value: unknown): string | null {
  const tree = asRecord(value);
  if (!tree) return null;
  const mode = knownLabel(RULE_MODE_LABEL, tree.mode);
  if (!mode) return null;
  const count = ruleCount(tree);
  return count ? `${mode} · ${count} 条规则` : mode;
}

function actionText(value: unknown): string | null {
  const action = asRecord(value);
  if (action) {
    const type = knownLabel(ACTION_TYPE_LABEL, action.type);
    if (!type) return null;
    const remoteKey = nonEmptyText(action.remoteUrlKey);
    const remote = remoteKey && remoteUrlLabel(remoteKey) !== "未知接管线路" ? remoteUrlLabel(remoteKey) : null;
    return remote ? `${type} · ${remote}` : type;
  }
  return knownLabel(ACTION_TYPE_LABEL, value);
}

function safeguardsText(value: unknown): string | null {
  const safeguards = asRecord(value);
  if (!safeguards) return null;
  const parts: string[] = [];
  const recommendations = finiteNumber(safeguards.maxDailyRecommendations);
  const hits = finiteNumber(safeguards.maxDailyHits);
  const freshMinutes = finiteNumber(safeguards.requireFreshReportMinutes);
  const intervalHours = finiteNumber(safeguards.minDecisionIntervalHours);
  if (recommendations !== null) parts.push(`每日建议不超过 ${recommendations} 台`);
  if (hits !== null) parts.push(`每日命中不超过 ${hits} 台`);
  if (freshMinutes !== null) parts.push(`仅采用 ${freshMinutes} 分钟内上报`);
  if (intervalHours !== null) parts.push(`决策间隔至少 ${intervalHours} 小时`);
  return parts.length ? parts.join("；") : null;
}

function rolloutText(value: unknown): string | null {
  const rollout = asRecord(value);
  if (!rollout) return null;
  const parts: string[] = [];
  const percent = finiteNumber(rollout.percent);
  const cohortIds = textList(rollout.cohortIds);
  if (percent !== null) parts.push(`比例 ${percent}%`);
  if (cohortIds.length) parts.push(`人群 ${cohortIds.join("/")}`);
  if (finiteNumber(rollout.startedAt) !== null) parts.push(`开始 ${formatAuditTime(rollout.startedAt)}`);
  if (finiteNumber(rollout.endsAt) !== null) parts.push(`结束 ${formatAuditTime(rollout.endsAt)}`);
  return parts.length ? parts.join("；") : null;
}

function maturityText(value: unknown): string | null {
  const maturity = asRecord(value);
  if (!maturity) return null;
  const parts: string[] = [];
  const values: Array<[string, unknown, string]> = [
    ["打开次数", maturity.appOpenCount, "次"],
    ["会话次数", maturity.sessionCount, "次"],
    ["连续使用", maturity.repeatStreakDays, "天"],
    ["前台停留", maturity.foregroundDurationSeconds, "秒"],
  ];
  for (const [label, raw, unit] of values) {
    const valueNumber = finiteNumber(raw);
    if (valueNumber !== null) parts.push(`${label} ${valueNumber}${unit}`);
  }
  const signals: Array<[string, unknown]> = [
    ["查看基准", maturity.benchmarkViewed],
    ["完成优化", maturity.optimizeDone],
    ["查看行情", maturity.marketViewed],
    ["查看钱包", maturity.walletViewed],
  ];
  for (const [label, raw] of signals) {
    const valueBoolean = yesNo(raw);
    if (valueBoolean) parts.push(`${label} ${valueBoolean}`);
  }
  return parts.length ? parts.join("；") : null;
}

function environmentText(value: unknown): string | null {
  const environment = asRecord(value);
  if (!environment) return null;
  const parts: string[] = [];
  const score = finiteNumber(environment.environmentRiskScore);
  if (score !== null) parts.push(`风险分 ${score}`);
  const flags: Array<[string, unknown]> = [
    ["无界面环境", environment.isHeadless],
    ["指纹黑名单", environment.fpBlocklistHit],
    ["屏幕异常", environment.screenAnomaly],
    ["时区不一致", environment.timezoneMismatch],
    ["语言不一致", environment.languageMismatch],
  ];
  for (const [label, raw] of flags) {
    if (raw === true) parts.push(label);
  }
  return parts.length ? parts.join("；") : null;
}

function manualOverrideText(value: unknown): string | null {
  const override = asRecord(value);
  if (!override) return null;
  const parts: string[] = [];
  const status = knownLabel(STATUS_LABEL, override.targetStatus);
  const timing = knownLabel(EFFECTIVE_TIMING_LABEL, override.effectiveTiming);
  const reasonCategory = nonEmptyText(override.reasonCategory);
  const reason = nonEmptyText(override.reasonText);
  if (status) parts.push(`目标 ${status}`);
  if (timing) parts.push(timing);
  if (reasonCategory) parts.push(reasonCategory);
  if (reason) parts.push(reason);
  if (finiteNumber(override.expireAt) !== null) parts.push(`到期 ${formatAuditTime(override.expireAt)}`);
  return parts.length ? parts.join("；") : null;
}

function latestDecisionText(value: unknown): string | null {
  const decision = asRecord(value);
  if (!decision) return null;
  const parts: string[] = [];
  const action = knownLabel(ACTION_TYPE_LABEL, decision.action);
  if (action) parts.push(action);
  if (finiteNumber(decision.decidedAt) !== null) parts.push(formatAuditTime(decision.decidedAt));
  return parts.length ? parts.join("；") : null;
}

function snapshotEntries(snapshot: unknown): Array<[string, string]> {
  const data = asRecord(snapshot);
  if (!data) return [];
  const entries: Array<[string, string | null]> = [
    ["名称", nonEmptyText(data.name)],
    ["说明", nonEmptyText(data.description)],
    ["策略状态", knownLabel(STRATEGY_STATUS_LABEL, data.status)],
    ["设备状态", knownLabel(STATUS_LABEL, data.status)],
    ["目标状态", knownLabel(STATUS_LABEL, data.desiredStatus)],
    ["状态来源", knownLabel(STATUS_SOURCE_LABEL, data.statusSource)],
    ["下发状态", knownLabel(COMMAND_STATE_LABEL, data.commandState)],
    ["版本", finiteNumber(data.version) === null ? null : String(data.version)],
    ["优先级", finiteNumber(data.priority) === null ? null : String(data.priority)],
    ["负责人", nonEmptyText(data.owner)],
    ["适用范围", scopeText(data.scope)],
    ["规则", ruleTreeText(data.ruleTree)],
    ["命中动作", actionText(data.action)],
    ["保护条件", safeguardsText(data.safeguards)],
    ["灰度范围", rolloutText(data.rollout)],
    ["回滚来源版本", finiteNumber(data.rolledBackFrom) === null ? null : String(data.rolledBackFrom)],
    ["是否激活", yesNo(data.activated)],
    ["远程线路", nonEmptyText(data.remoteUrlKey) && remoteUrlLabel(nonEmptyText(data.remoteUrlKey)) !== "未知接管线路" ? remoteUrlLabel(nonEmptyText(data.remoteUrlKey)) : null],
    ["成熟度分", finiteNumber(data.maturityScore) === null ? null : String(data.maturityScore)],
    ["建议分", finiteNumber(data.recommendationScore) === null ? null : String(data.recommendationScore)],
    ["环境风险分", finiteNumber(data.environmentRiskScore) === null ? null : String(data.environmentRiskScore)],
    ["队列优先级分", finiteNumber(data.priorityScore) === null ? null : String(data.priorityScore)],
    ["设备平台", knownLabel({ iOS: "iOS", Android: "Android" }, data.platform)],
    ["设备型号", nonEmptyText(data.model)],
    ["渠道", knownLabel(CHANNEL_LABEL, data.channel)],
    ["成熟信号", maturityText(data.maturity)],
    ["环境信号", environmentText(data.environment)],
    ["人工覆盖", manualOverrideText(data.manualOverride)],
    ["最近判定", latestDecisionText(data.latestDecision)],
    ["首次发现", finiteNumber(data.firstSeenAt) === null ? null : formatAuditTime(data.firstSeenAt)],
    ["最近上报", finiteNumber(data.lastSeenAt) === null ? null : formatAuditTime(data.lastSeenAt)],
  ];
  return entries.filter((entry): entry is [string, string] => entry[1] !== null);
}

export function auditSnapshotText(snapshot: unknown): string {
  const entries = snapshotEntries(snapshot);
  return entries.length ? entries.map(([label, value]) => `${label} ${value}`).join(" · ") : "—";
}

export function auditReasonText(row: Pick<AuditLog, "reasonCategory" | "reasonText">): string {
  const parts = [nonEmptyText(row.reasonCategory), nonEmptyText(row.reasonText)]
    .filter((item): item is string => item !== null);
  return parts.length ? parts.join(" · ") : "—";
}

export function auditTargetLabel(targetType: AuditLog["targetType"]): string {
  return TARGET_LABEL[targetType];
}

export function auditObjectReference(row: Pick<AuditLog, "targetType" | "targetId" | "beforeSnapshot" | "afterSnapshot">): AuditObjectReference {
  if (row.targetType === "strategy") {
    const afterName = nonEmptyText(asRecord(row.afterSnapshot)?.name);
    const beforeName = nonEmptyText(asRecord(row.beforeSnapshot)?.name);
    const name = afterName ?? beforeName;
    return name
      ? { label: "策略名称", value: name }
      : { label: "策略编号", value: row.targetId };
  }
  return row.targetType === "device"
    ? { label: "设备编号", value: row.targetId }
    : { label: "配置编号", value: row.targetId };
}

export function auditExportRows(rows: AuditLog[]): AuditExportRow[] {
  return rows.map((row) => {
    const object = auditObjectReference(row);
    return {
      时间: formatAuditTime(row.createdAt),
      操作: AUDIT_ACTION_LABEL[row.action] ?? "",
      对象类型: auditTargetLabel(row.targetType),
      对象名称: object.label === "策略名称" ? object.value : "",
      对象编号: object.label === "策略名称" ? "" : object.value,
      操作人: row.actorId,
      原因: auditReasonText(row),
      变更前: auditSnapshotText(row.beforeSnapshot),
      变更后: auditSnapshotText(row.afterSnapshot),
      追踪号: nonEmptyText(row.requestId) ?? "",
    };
  });
}
