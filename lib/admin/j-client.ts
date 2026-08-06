import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { useAdminAuth } from "@/lib/store/admin-auth";

type ApiResult<T> = {
  code?: number;
  message?: string;
  data?: T;
};

function idempotencyKey() {
  return `j-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createJEmergencyCommandKey() {
  return idempotencyKey();
}

class EmergencyOutcomeUncertainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmergencyOutcomeUncertainError";
  }
}

export function isEmergencyOutcomeUncertain(error: unknown) {
  return error instanceof EmergencyOutcomeUncertainError
    || (error instanceof Error && error.name === "EmergencyOutcomeUncertainError");
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const isWrite = Boolean(init?.method && init.method !== "GET");
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init?.method && init.method !== "GET" && !headers.has("Idempotency-Key")) headers.set("Idempotency-Key", idempotencyKey());
  let res: Response;
  try {
    res = await guardedFetch(`/api/admin/emergency${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch {
    const message = "无法连接应急控制服务，未收到执行结果";
    throw isWrite
      ? new EmergencyOutcomeUncertainError(message)
      : new Error("无法连接应急控制服务，请检查网络后重试");
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    const message = "应急控制服务响应中断，未收到完整执行结果";
    throw isWrite ? new EmergencyOutcomeUncertainError(message) : new Error(`${message}，请稍后重试`);
  }
  let payload: ApiResult<T> = {};
  try {
    payload = text ? (JSON.parse(text) as ApiResult<T>) : {};
  } catch {
    const message = `应急控制服务返回了无法确认的内容（HTTP ${res.status}）`;
    throw isWrite ? new EmergencyOutcomeUncertainError(message) : new Error(`${message}，请稍后重试。`);
  }
  if (!res.ok || (payload.code !== undefined && payload.code >= 400)) {
    if (res.status === 401 || payload.code === 401 || payload.message === "ADMIN_AUTH_REQUIRED") {
      useAdminAuth.getState().signOut();
    }
    // unknown 头只是增强信号,不再是唯一保险丝:5xx 同样归结果未知,让调用方看到「结果未确认」
    // 而不是「失败」——冠失败会诱导运营换渠道重做,而应急止血动作(kill-switch / 地域封锁)
    // 重复执行的代价极高。
    // ⚠️ 注意范围:j 域**目前还没有 pending store**,命令号在弹窗打开时现铸、刷新即丢
    //   (属交接文档「任务 A」的迁移范围)。所以这里给的是**正确的失败分类与话术**,
    //   不是「同号重试」的保证 —— 别照着这段注释以为 j 域已经保号了。
    if (isWrite && (res.headers.get("X-Nexion-Upstream-Outcome") === "unknown"
      || outcomeStaysUnknown(res.status, payload.code))) {
      throw new EmergencyOutcomeUncertainError(
        "应急控制服务连接在提交后中断，执行结果暂未确认",
      );
    }
    throw new Error(formatAdminApiError(payload.message, `EMERGENCY_API_${res.status}`));
  }
  return payload.data as T;
}

async function contentApiRequest<T>(path: string): Promise<T> {
  const res = await guardedFetch(`/api/admin/content${path}`, {
    cache: "no-store",
  });
  const text = await res.text();
  let payload: ApiResult<T> = {};
  try {
    payload = text ? (JSON.parse(text) as ApiResult<T>) : {};
  } catch {
    throw new Error(`内容接口返回了无法识别的内容（HTTP ${res.status}），请稍后重试。`);
  }
  if (!res.ok || (payload.code !== undefined && payload.code >= 400)) {
    throw new Error(formatAdminApiError(payload.message, `CONTENT_API_${res.status}`));
  }
  return payload.data as T;
}

function withReason<T extends Record<string, unknown>>(body: T, reason: string, operator = currentAdminOperator()) {
  return { ...body, operator: operator || currentAdminOperator(), reason };
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function requiredRows<T>(value: unknown, field: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`J_DOMAIN_FIELD_REQUIRED:${field}`);
  }
  return value as T[];
}

function requiredRecordRows(value: unknown, field: string) {
  return requiredRows<unknown>(value, field).map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`J_DOMAIN_FIELD_REQUIRED:${field}.${index}`);
    }
    return item as Record<string, unknown>;
  });
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function str(value: unknown, fallback = "") {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function num(value: unknown, fallback = 0) {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requiredNum(value: unknown, field: string) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new Error(`J_DOMAIN_FIELD_REQUIRED:${field}`);
  }
  return parsed;
}

function bool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "enabled" || value === "on";
  return fallback;
}

function requiredBool(value: unknown, field: string) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "on", "enabled", "enable"].includes(normalized)) return true;
    if (["false", "0", "off", "disabled", "disable"].includes(normalized)) return false;
  }
  throw new Error(`J_DOMAIN_FIELD_REQUIRED:${field}`);
}

function requiredText(value: unknown, field: string) {
  const normalized = str(value).trim();
  if (!normalized) throw new Error(`J_DOMAIN_FIELD_REQUIRED:${field}`);
  return normalized;
}

const J1_GATE_KEYS = ["withdraw", "staking", "genesis", "exchange", "trial"] as const;
const J1_GATE_KEY_SET = new Set<string>(J1_GATE_KEYS);
const J1_EMERGENCY_SLA_IDS = ["autoConfirmMins", "recoverGate"] as const;
const J1_AUTO_RULE_IDS = ["withdrawSurge", "maturityGap", "tamperCluster", "regulatoryDirective"] as const;
const J1_GATE_SEMANTICS: Record<string, { coveragePrecheckRequired: boolean; coverageImpactCategory: "immediate" | "delayed" | "none" }> = {
  withdraw: { coveragePrecheckRequired: true, coverageImpactCategory: "immediate" },
  staking: { coveragePrecheckRequired: true, coverageImpactCategory: "delayed" },
  genesis: { coveragePrecheckRequired: true, coverageImpactCategory: "immediate" },
  exchange: { coveragePrecheckRequired: true, coverageImpactCategory: "immediate" },
  trial: { coveragePrecheckRequired: false, coverageImpactCategory: "none" },
};

function contractError(field: string): never {
  throw new Error(`服务器返回的数据不完整或格式异常（字段：${field}），请重新读取；若持续出现请联系技术人员。`);
}

function strArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => str(item)).filter(Boolean) : [];
}

function requiredStringArray(value: unknown, field: string) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string")) {
    contractError(field);
  }
  const values = value as string[];
  if (!values.some((item) => item.trim())) {
    contractError(field);
  }
  return values;
}

function requiredStringArrayAllowEmpty(value: unknown, field: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    contractError(field);
  }
  return value as string[];
}

function exactRowIds(rows: Record<string, unknown>[], expectedIds: readonly string[], field: string) {
  const ids = rows.map((row, index) => requiredText(row.id, `${field}.${index}.id`));
  if (ids.length !== expectedIds.length
    || new Set(ids).size !== expectedIds.length
    || expectedIds.some((id) => !ids.includes(id))) {
    contractError(`${field}.ids`);
  }
  return ids;
}

export type JGate = {
  key: string;
  name: string;
  cap: string;
  desc: string;
  enabled: boolean;
  on: boolean;
  status: string;
  coveragePrecheckRequired: boolean;
  coverageImpactCategory: string;
  amplifies: boolean;
  lastChange: string;
  emergency: boolean;
};

export type EmergencySlaRow = {
  id: string;
  k: string;
  d: string;
  v: string;
  unit: string;
  kind: "number" | "text";
  editable?: boolean;
};

export type AutoRuleRow = {
  id: string;
  nm: string;
  tag: string;
  icon: string;
  cond: string[];
  thrK: string;
  thr: string;
  kind: "number" | "text";
  unit: string;
  mode: "automatic" | "advisory" | "manual";
  adjustable: boolean;
  refNote?: string;
  refTitle?: string;
};

export type KillSwitchStats = {
  liveGateCount: number;
  killedGateCount: number;
  emergencyGateCount: number;
  coverageBlockedCount: number;
};

export type AutoConfirmationRow = {
  key: string;
  name: string;
  incidentId: string;
  ruleId: string;
  signalValue: number;
  threshold: number;
  triggeredAt: string;
  dueAt: string;
  overdue: boolean;
};

export type KillSwitchOverview = {
  activeGateCount: number;
  activeGates: JGate[];
  retiredGates: Record<string, unknown>[];
  coverage: { coverageRatio: number; redlinePct: number; yellowLinePct: number; recoveryAllowed: boolean };
  stats: KillSwitchStats;
  emergencySla: EmergencySlaRow[];
  autoRules: AutoRuleRow[];
  autoConfirmations: AutoConfirmationRow[];
  sources: string[];
};

export type GeoCountry = { cc: string; name: string; reason: string; status: string; operator: string; updatedAt: string; activeUsers: number; walletUsdt: number };
export type GeoCountryOption = { value: string; label: string; source: string; activeUsers: number; walletUsdt: number };
export type GeoEdgeSourceOption = { value: string; label: string; description: string; healthy: boolean; healthStatus: string; sampleCount: number };
export type GeoRecentChange = { action: string; resourceType: string; resourceId: string; operator: string; reason: string; beforeValue: string; afterValue: string; createdAt: string };
export type GeoEndpoint = {
  key: string;
  ep: string;
  endpoint: string;
  label: string;
  biz: string;
  domain: string;
  countries: string[];
  geo: string[];
  source: string;
  src: string;
  sourceLabel: string;
  sourceDescription: string;
  srcDesc: string;
  hits: number;
  configurable: boolean;
};
export type GeoHit = { cc: string; name: string; nm: string; count: number; ct: number };
export type GeoEdgeMetric = { key: string; k: string; value: string; v: string; tone: string };
export type GeoBlockOverview = {
  blocked: GeoCountry[];
  limited: GeoCountry[];
  countries: GeoCountry[];
  countryOptions: GeoCountryOption[];
  endpoints: GeoEndpoint[];
  hits: GeoHit[];
  edge: { source: string; sourceKnown: boolean; sources: GeoEdgeSourceOption[]; healthy: boolean; healthStatus: string; metrics: GeoEdgeMetric[] };
  recentChanges: GeoRecentChange[];
  stats: Record<string, unknown>;
  sources: string[];
};

export type TamperTrendWindow = { points: number[]; pts: number[]; max: number; labels: string[] };
export type TamperTrend = Record<"24h" | "7d" | "30d", TamperTrendWindow>;
export type TamperPath = {
  id: string;
  name: string;
  nm: string;
  description: string;
  desc: string;
  count: number;
  ct: number;
  accounts: number;
  acct: number;
  color: string;
};
export type TamperAccount = {
  userCode: string;
  userNo: string;
  count: number;
  cnt: number;
  k4: string;
  last: string;
  paths: string[];
  cluster: string;
  fedToK4: boolean;
  b5Triggered: boolean;
  alertState: "flagged" | "escalated";
};
export type TamperAccountPage = {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  hasPrev: boolean;
  hasNext: boolean;
};
export type TamperOverview = {
  window: "24h" | "7d" | "30d";
  hasData: boolean;
  stats: Record<string, unknown>;
  trend: TamperTrend;
  paths: TamperPath[];
  accounts: TamperAccount[];
  accountPage: TamperAccountPage;
  coverage: {
    status: "partial" | "complete";
    registeredCount: number;
    activeCount: number;
    registeredPaths: string[];
    activePaths: string[];
    missingPaths: string[];
  };
  alertConfig: {
    threshold: number;
    label: string;
    feedK4: boolean;
    effectiveThreshold: number;
    effectiveLabel: string;
    sevenDayAlertAccounts: number;
    sevenDayPreviewByThreshold: Record<string, number>;
  };
  sources: string[];
};
export type TamperReport = {
  reportId: string;
  window: "24h" | "7d" | "30d";
  masked: boolean;
  status: string;
  filename: string;
  contentType: string;
  contentBase64: string;
  eventCount: number;
  accountCount: number;
};

export type PlaybookStep = { domain: string; dom: string; action: string; ax: string; approve: boolean; ref?: string | null };
export type Playbook = {
  code: string;
  name: string;
  scene: string;
  emergency: boolean;
  emer: boolean;
  sla: string;
  state: "active" | "todo" | string;
  owner: string;
  lastDrill: string;
  sequence: PlaybookStep[];
  seq: PlaybookStep[];
  notifyCampaignNo?: string;
  notifyTemplate?: string;
  rollback?: string;
  drillRequired?: boolean;
  draft?: boolean;
  version?: string;
  executionReady?: boolean;
  drillFresh?: boolean;
  campaignReady?: boolean;
  readinessReason?: string;
};
export type SopExecution = {
  timestamp: string;
  ts: string;
  code: string;
  name: string;
  trigger: string;
  trig: string;
  mode: string;
  steps: string[];
  operator: string;
  roleGate: string;
  executionId?: string;
  rollbackStatus?: string;
  rollbackAt?: string;
  rollbackReason?: string;
  notificationDispatch: Record<string, unknown>;
  domainActions: Array<Record<string, unknown>>;
  rollbackActions: Array<Record<string, unknown>>;
  reversible: boolean;
};

export type J4StepConfirmationInput = {
  step: number;
  domain: string;
  ref: string;
  confirmed: true;
};
export type J4ActionOption = {
  value: string;
  domain: string;
  action: string;
  ref: string | null;
  approve: boolean;
  description: string;
  parameterLabel?: string;
  parameterPlaceholder?: string;
  label: string;
  searchText: string;
};
export type J4RollbackOption = {
  value: string;
  label: string;
  scene: string;
  riskLevel: string;
  plan: string;
  searchText: string;
};
export type SopOverview = {
  contractVersion: string;
  stats: Record<string, unknown>;
  scenes: string[];
  actionOptions: J4ActionOption[];
  rollbackOptions: J4RollbackOption[];
  playbooks: Playbook[];
  executions: SopExecution[];
  sources: string[];
};

export type JNotifyTemplateOption = {
  value: string;
  label: string;
  campaignNo: string;
  name: string;
  tier: string;
  audience: string;
  status: string;
  meta: string;
  searchText: string;
};

export type J4PlaybookCreateInput = {
  name: string;
  scene?: string;
  owner?: string;
  sla?: string;
  emergencyTrack?: boolean;
  actionSeq?: string;
  notifyCampaignNo?: string;
  notifyTemplate?: string;
  rollback?: string;
  drillRequired?: boolean;
};

export type J4PlaybookUpdateInput = Partial<J4PlaybookCreateInput> & {
  summary?: string;
  version: string;
};

export type JEmergencyData = {
  killSwitch?: KillSwitchOverview;
  geoBlock?: GeoBlockOverview;
  tamper?: TamperOverview;
  sop?: SopOverview;
  notifyTemplates?: JNotifyTemplateOption[];
  notifyTemplatesError?: string;
};

export type JEmergencyActions = {
  reloadJEmergency: () => Promise<void>;
  toggleJ1KillSwitch: (key: string, enabled: boolean, reason: string, context?: { triggerBasis?: string; dispositionPlan?: string }, commandKey?: string) => Promise<void>;
  emergencyDisableJ1: (keys: string[], reason: string, operator?: string, context?: { triggerBasis: string; regulatoryContext: string; dispositionPlan?: string }, commandKey?: string) => Promise<void>;
  updateJ1Sla: (paramKey: string, value: string, expectedValue: string, reason: string, commandKey?: string) => Promise<void>;
  updateJ1AutoRule: (ruleId: string, value: string, expectedValue: string, reason: string, commandKey?: string) => Promise<void>;
  confirmJ1AutoTrigger: (key: string, incidentId: string, decision: "keep_disabled" | "recommend_restore", reason: string, commandKey?: string) => Promise<void>;
  updateJ2Country: (countryCode: string, status: "blocked" | "limited" | "allowed", expectedStatus: "blocked" | "limited" | "allowed", triggerBasis: string | undefined, reason: string, commandKey?: string) => Promise<void>;
  replaceJ2CountryList: (status: "blocked" | "limited", countries: string[], expectedCountries: string[], triggerBasis: string | undefined, reason: string, commandKey?: string) => Promise<void>;
  updateJ2Endpoint: (endpointKey: string, mode: "explicit" | "derived", countries: string[], expectedMode: "explicit" | "derived", expectedCountries: string[], reason: string, commandKey?: string) => Promise<void>;
  updateJ2EdgeJudge: (source: string, expectedSource: string, reason: string, commandKey?: string) => Promise<void>;
  emergencyBlockJ2: (countries: string[], triggerBasis: string, reason: string, commandKey?: string) => Promise<void>;
  loadJ3TamperPage: (window: "24h" | "7d" | "30d", page: number, pageSize: number) => Promise<TamperOverview>;
  updateJ3AlertConfig: (threshold: number, feedK4: boolean, expectedThreshold: number, expectedFeedK4: boolean, reason: string, commandKey?: string) => Promise<void>;
  createJ3Report: (window: "24h" | "7d" | "30d", reason: string, commandKey?: string) => Promise<TamperReport>;
  createJ4Playbook: (body: J4PlaybookCreateInput, reason: string, commandKey?: string) => Promise<void>;
  updateJ4Playbook: (code: string, body: J4PlaybookUpdateInput, reason: string, commandKey?: string) => Promise<void>;
  drillJ4Playbook: (code: string, reason: string, commandKey?: string) => Promise<void>;
  executeJ4Playbook: (
    code: string,
    emergency: boolean,
    reason: string,
    confirmation: { triggerBasis: string; triggerContext: string; stepConfirmations: J4StepConfirmationInput[] },
    commandKey?: string,
  ) => Promise<void>;
  cancelJ4Playbook: (code: string, executionId: string, reason: string, commandKey?: string) => Promise<void>;
  resumeJ4Playbook: (code: string, executionId: string, reason: string, commandKey?: string) => Promise<void>;
  rollbackJ4Playbook: (code: string, executionId: string, reason: string, commandKey?: string) => Promise<void>;
};

function normalizeKillSwitch(raw: unknown): KillSwitchOverview {
  const data = rec(raw);
  const coverage = rec(data.coverage);
  const activeGateCount = requiredNum(data.activeGateCount, "killSwitch.activeGateCount");
  const rawGates = requiredRows<Record<string, unknown>>(data.activeGates, "killSwitch.activeGates");
  if (activeGateCount !== J1_GATE_KEYS.length || rawGates.length !== J1_GATE_KEYS.length) {
    contractError("killSwitch.activeGates.count");
  }
  const activeGates = rawGates.map((gate, index) => {
    const key = requiredText(gate.key, `killSwitch.activeGates.${index}.key`);
    const enabled = requiredBool(gate.enabled, `killSwitch.activeGates.${index}.enabled`);
    const on = requiredBool(gate.on, `killSwitch.activeGates.${index}.on`);
    const status = requiredText(gate.status, `killSwitch.activeGates.${index}.status`);
    const coveragePrecheckRequired = requiredBool(gate.coveragePrecheckRequired, `killSwitch.activeGates.${index}.coveragePrecheckRequired`);
    const coverageImpactCategory = requiredText(gate.coverageImpactCategory, `killSwitch.activeGates.${index}.coverageImpactCategory`);
    const amplifies = requiredBool(gate.amplifies, `killSwitch.activeGates.${index}.amplifies`);
    const emergency = requiredBool(gate.emergency, `killSwitch.activeGates.${index}.emergency`);
    const expected = J1_GATE_SEMANTICS[key];
    if (!J1_GATE_KEY_SET.has(key)
      || !expected
      || on !== enabled
      || status !== (enabled ? "enabled" : "disabled")
      || !["immediate", "delayed", "none"].includes(coverageImpactCategory)
      || coveragePrecheckRequired !== amplifies
      || coveragePrecheckRequired !== expected.coveragePrecheckRequired
      || coverageImpactCategory !== expected.coverageImpactCategory
      || (emergency && enabled)) {
      contractError(`killSwitch.activeGates.${index}`);
    }
    return {
      key,
      name: requiredText(gate.name, `killSwitch.activeGates.${index}.name`),
      cap: requiredText(gate.cap, `killSwitch.activeGates.${index}.cap`),
      desc: requiredText(gate.desc, `killSwitch.activeGates.${index}.desc`),
      enabled,
      on,
      status,
      coveragePrecheckRequired,
      coverageImpactCategory,
      amplifies,
      lastChange: str(gate.lastChange),
      emergency,
    };
  });
  if (new Set(activeGates.map((gate) => gate.key)).size !== J1_GATE_KEYS.length
    || J1_GATE_KEYS.some((key) => !activeGates.some((gate) => gate.key === key))) {
    contractError("killSwitch.activeGates.keys");
  }
  const coverageRatio = requiredNum(coverage.coverageRatio, "coverage.coverageRatio");
  const redlinePct = requiredNum(coverage.redlinePct, "coverage.redlinePct");
  const yellowLinePct = requiredNum(coverage.yellowLinePct, "coverage.yellowLinePct");
  const recoveryAllowed = requiredBool(coverage.recoveryAllowed, "coverage.recoveryAllowed");
  if (coverageRatio < 0 || redlinePct < 0 || yellowLinePct < 0 || yellowLinePct <= redlinePct) {
    contractError("coverage.thresholds");
  }
  if (recoveryAllowed !== (coverageRatio >= redlinePct)) contractError("coverage.recoveryAllowed");
  const stats = rec(data.stats);
  const liveGateCount = requiredNum(stats.liveGateCount, "killSwitch.stats.liveGateCount");
  const killedGateCount = requiredNum(stats.killedGateCount, "killSwitch.stats.killedGateCount");
  const emergencyGateCount = requiredNum(stats.emergencyGateCount, "killSwitch.stats.emergencyGateCount");
  const coverageBlockedCount = requiredNum(stats.coverageBlockedCount, "killSwitch.stats.coverageBlockedCount");
  if (liveGateCount !== activeGates.filter((gate) => gate.enabled).length
    || killedGateCount !== activeGates.filter((gate) => !gate.enabled).length
    || emergencyGateCount !== activeGates.filter((gate) => gate.emergency).length
    || ![liveGateCount, killedGateCount, emergencyGateCount, coverageBlockedCount].every(Number.isInteger)
    || coverageBlockedCount < 0) {
    contractError("killSwitch.stats");
  }
  const autoConfirmations = requiredRows<Record<string, unknown>>(
    data.autoConfirmations,
    "killSwitch.autoConfirmations",
  ).map((row, index) => {
    const key = requiredText(row.key, `killSwitch.autoConfirmations.${index}.key`);
    const gate = activeGates.find((candidate) => candidate.key === key);
    if (!gate || gate.enabled || !gate.emergency) {
      contractError(`killSwitch.autoConfirmations.${index}.gateState`);
    }
    return {
      key,
      name: requiredText(row.name, `killSwitch.autoConfirmations.${index}.name`),
      incidentId: requiredText(row.incidentId, `killSwitch.autoConfirmations.${index}.incidentId`),
      ruleId: requiredText(row.ruleId, `killSwitch.autoConfirmations.${index}.ruleId`),
      signalValue: requiredNum(row.signalValue, `killSwitch.autoConfirmations.${index}.signalValue`),
      threshold: requiredNum(row.threshold, `killSwitch.autoConfirmations.${index}.threshold`),
      triggeredAt: requiredText(row.triggeredAt, `killSwitch.autoConfirmations.${index}.triggeredAt`),
      dueAt: requiredText(row.dueAt, `killSwitch.autoConfirmations.${index}.dueAt`),
      overdue: requiredBool(row.overdue, `killSwitch.autoConfirmations.${index}.overdue`),
    };
  });
  if (new Set(autoConfirmations.map((row) => row.key)).size !== autoConfirmations.length) {
    contractError("killSwitch.autoConfirmations.keys");
  }
  const emergencySlaRows = requiredRecordRows(
    data.emergencySla,
    "killSwitch.emergencySla",
  );
  const emergencySlaIds = exactRowIds(
    emergencySlaRows,
    J1_EMERGENCY_SLA_IDS,
    "killSwitch.emergencySla",
  );
  const emergencySla = emergencySlaRows.map((row, index) => {
    const id = emergencySlaIds[index];
    const value = requiredText(row.v, `killSwitch.emergencySla.${index}.v`);
    const kind = requiredText(row.kind, `killSwitch.emergencySla.${index}.kind`);
    const editable = requiredBool(row.editable, `killSwitch.emergencySla.${index}.editable`);
    const unit = requiredText(row.unit, `killSwitch.emergencySla.${index}.unit`);
    const numericValue = requiredNum(value, `killSwitch.emergencySla.${index}.v`);
    if (kind !== "number"
      || (id === "autoConfirmMins"
        && (!editable || unit !== "分钟" || !Number.isInteger(numericValue) || numericValue < 10 || numericValue > 120))
      || (id === "recoverGate"
        && (editable || unit !== "%" || numericValue < 0 || numericValue !== redlinePct))) {
      contractError(`killSwitch.emergencySla.${index}.semantics`);
    }
    requiredText(row.source, `killSwitch.emergencySla.${index}.source`);
    return {
      id,
      k: requiredText(row.k, `killSwitch.emergencySla.${index}.k`),
      d: requiredText(row.d, `killSwitch.emergencySla.${index}.d`),
      v: value,
      unit,
      kind: "number" as const,
      editable,
    };
  });
  const autoRuleRows = requiredRecordRows(data.autoRules, "killSwitch.autoRules");
  const autoRuleIds = exactRowIds(autoRuleRows, J1_AUTO_RULE_IDS, "killSwitch.autoRules");
  const expectedRuleSemantics: Record<string, {
    kind: "number" | "text";
    mode: "automatic" | "advisory" | "manual";
    adjustable: boolean;
  }> = {
    withdrawSurge: { kind: "number", mode: "automatic", adjustable: false },
    maturityGap: { kind: "number", mode: "automatic", adjustable: true },
    tamperCluster: { kind: "number", mode: "advisory", adjustable: false },
    regulatoryDirective: { kind: "text", mode: "manual", adjustable: false },
  };
  const autoRules = autoRuleRows.map((row, index) => {
    const id = autoRuleIds[index];
    const expected = expectedRuleSemantics[id];
    const kind = requiredText(row.kind, `killSwitch.autoRules.${index}.kind`);
    const mode = requiredText(row.mode, `killSwitch.autoRules.${index}.mode`);
    const adjustable = requiredBool(row.adjustable, `killSwitch.autoRules.${index}.adjustable`);
    const threshold = requiredText(row.thr, `killSwitch.autoRules.${index}.thr`);
    if (!expected || kind !== expected.kind || mode !== expected.mode || adjustable !== expected.adjustable) {
      contractError(`killSwitch.autoRules.${index}.semantics`);
    }
    requiredText(row.configKey, `killSwitch.autoRules.${index}.configKey`);
    if (kind === "number") {
      requiredNum(threshold.replaceAll(",", ""), `killSwitch.autoRules.${index}.thr`);
    }
    return {
      id,
      nm: requiredText(row.nm, `killSwitch.autoRules.${index}.nm`),
      tag: requiredText(row.tag, `killSwitch.autoRules.${index}.tag`),
      icon: requiredText(row.icon, `killSwitch.autoRules.${index}.icon`),
      cond: requiredStringArray(row.cond, `killSwitch.autoRules.${index}.cond`),
      thrK: requiredText(row.thrK, `killSwitch.autoRules.${index}.thrK`),
      thr: threshold,
      kind: expected.kind,
      unit: str(row.unit),
      mode: expected.mode,
      adjustable,
      refNote: str(row.refNote),
      refTitle: str(row.refTitle),
    };
  });
  return {
    activeGateCount,
    activeGates,
    retiredGates: rows<Record<string, unknown>>(data.retiredGates),
    coverage: {
      coverageRatio,
      redlinePct,
      yellowLinePct,
      recoveryAllowed,
    },
    stats: (() => {
      return {
        liveGateCount,
        killedGateCount,
        emergencyGateCount,
        coverageBlockedCount,
      };
    })(),
    emergencySla,
    autoRules,
    autoConfirmations,
    sources: strArray(data.sources),
  };
}

function normalizeGeo(raw: unknown): GeoBlockOverview {
  const data = rec(raw);
  const edge = rec(data.edge);
  const normalizeCountries = (value: unknown, field: string) => requiredRows<Record<string, unknown>>(value, field).map((row, index) => ({
    cc: requiredText(row.cc, `${field}.${index}.cc`),
    name: requiredText(row.name, `${field}.${index}.name`),
    reason: str(row.reason),
    status: requiredText(row.status, `${field}.${index}.status`),
    operator: str(row.operator),
    updatedAt: str(row.updatedAt),
    activeUsers: requiredNum(row.activeUsers, `${field}.${index}.activeUsers`),
    walletUsdt: requiredNum(row.walletUsdt, `${field}.${index}.walletUsdt`),
  }));
  const countryOptionsRaw = requiredRows<Record<string, unknown>>(data.countryOptions, "geo.countryOptions");
  if (countryOptionsRaw.length === 0) contractError("geo.countryOptions.empty");
  const edgeSourcesRaw = requiredRows<Record<string, unknown>>(edge.sources, "geo.edge.sources");
  if (edgeSourcesRaw.length === 0) contractError("geo.edge.sources.empty");
  return {
    blocked: normalizeCountries(data.blocked, "geo.blocked"),
    limited: normalizeCountries(data.limited, "geo.limited"),
    countries: normalizeCountries(data.countries, "geo.countries"),
    countryOptions: countryOptionsRaw.map((row, index) => ({
      value: requiredText(row.value, `geo.countryOptions.${index}.value`),
      label: requiredText(row.label, `geo.countryOptions.${index}.label`),
      source: requiredText(row.source, `geo.countryOptions.${index}.source`),
      activeUsers: requiredNum(row.activeUsers, `geo.countryOptions.${index}.activeUsers`),
      walletUsdt: requiredNum(row.walletUsdt, `geo.countryOptions.${index}.walletUsdt`),
    })),
    endpoints: requiredRows<Record<string, unknown>>(data.endpoints, "geo.endpoints").map((row, index) => {
      const endpoint = str(row.endpoint);
      const countries = strArray(row.countries);
      const source = str(row.source);
      return {
        key: str(row.key),
        ep: endpoint,
        endpoint,
        label: str(row.label),
        biz: str(row.biz),
        domain: str(row.domain),
        countries,
        geo: countries,
        source,
        src: source,
        sourceLabel: str(row.sourceLabel),
        sourceDescription: str(row.sourceDescription),
        srcDesc: str(row.sourceDescription),
        hits: requiredNum(row.hits, `geo.endpoints.${index}.hits`),
        configurable: requiredBool(row.configurable, `geo.endpoints.${index}.configurable`),
      };
    }),
    hits: requiredRows<Record<string, unknown>>(data.hits, "geo.hits").map((row, index) => ({
      cc: str(row.cc),
      name: str(row.name),
      nm: str(row.name),
      count: requiredNum(row.count, `geo.hits.${index}.count`),
      ct: requiredNum(row.count, `geo.hits.${index}.count`),
    })),
    edge: {
      source: str(edge.source),
      sourceKnown: requiredBool(edge.sourceKnown, "geo.edge.sourceKnown"),
      sources: edgeSourcesRaw.map((row, index) => ({
        value: requiredText(row.value, `geo.edge.sources.${index}.value`),
        label: requiredText(row.label, `geo.edge.sources.${index}.label`),
        description: requiredText(row.description, `geo.edge.sources.${index}.description`),
        healthy: requiredBool(row.healthy, `geo.edge.sources.${index}.healthy`),
        healthStatus: requiredText(row.healthStatus, `geo.edge.sources.${index}.healthStatus`),
        sampleCount: requiredNum(row.sampleCount, `geo.edge.sources.${index}.sampleCount`),
      })),
      healthy: requiredBool(edge.healthy, "geo.edge.healthy"),
      healthStatus: requiredText(edge.healthStatus, "geo.edge.healthStatus"),
      metrics: requiredRows<Record<string, unknown>>(edge.metrics, "geo.edge.metrics").map((row) => ({
        key: str(row.key),
        k: str(row.key),
        value: str(row.value),
        v: str(row.value),
        tone: str(row.tone),
      })),
    },
    recentChanges: requiredRows<Record<string, unknown>>(data.recentChanges, "geo.recentChanges").map((row) => ({
      action: str(row.action),
      resourceType: str(row.resourceType),
      resourceId: str(row.resourceId),
      operator: str(row.operator),
      reason: str(row.reason),
      beforeValue: str(row.beforeValue),
      afterValue: str(row.afterValue),
      createdAt: str(row.createdAt),
    })),
    stats: rec(data.stats),
    sources: strArray(data.sources),
  };
}

function normalizeTrendWindow(value: unknown, field: string): TamperTrendWindow {
  const row = rec(value);
  const points = requiredRows<unknown>(row.points, `${field}.points`)
    .map((item, index) => requiredNum(item, `${field}.points.${index}`));
  return { points, pts: points, max: requiredNum(row.max, `${field}.max`), labels: strArray(row.labels) };
}

function normalizeTamper(raw: unknown): TamperOverview {
  const data = rec(raw);
  const trend = rec(data.trend);
  const alertConfig = rec(data.alertConfig);
  const accountPage = rec(data.accountPage);
  const coverage = rec(data.coverage);
  const window = requiredText(data.window, "tamper.window");
  if (window !== "24h" && window !== "7d" && window !== "30d") contractError("tamper.window");
  return {
    window,
    hasData: requiredBool(data.hasData, "tamper.hasData"),
    stats: rec(data.stats),
    trend: {
      "24h": normalizeTrendWindow(trend["24h"], "trend.24h"),
      "7d": normalizeTrendWindow(trend["7d"], "trend.7d"),
      "30d": normalizeTrendWindow(trend["30d"], "trend.30d"),
    },
    paths: requiredRows<Record<string, unknown>>(data.paths, "tamper.paths").map((row, index) => ({
      id: str(row.id),
      name: str(row.name),
      nm: str(row.name),
      description: str(row.description),
      desc: str(row.description),
      count: requiredNum(row.count, `tamper.paths.${index}.count`),
      ct: requiredNum(row.count, `tamper.paths.${index}.count`),
      accounts: requiredNum(row.accounts, `tamper.paths.${index}.accounts`),
      acct: requiredNum(row.accounts, `tamper.paths.${index}.accounts`),
      color: str(row.color),
    })),
    accounts: requiredRows<Record<string, unknown>>(data.accounts, "tamper.accounts").map((row, index) => {
      const userCode = str(row.userCode, str(row.userNo));
      return {
        userCode,
        userNo: userCode,
        count: requiredNum(row.count, `tamper.accounts.${index}.count`),
        cnt: requiredNum(row.count, `tamper.accounts.${index}.count`),
        k4: str(row.k4),
        last: str(row.last),
        paths: strArray(row.paths),
        cluster: str(row.cluster),
        fedToK4: requiredBool(row.fedToK4, `tamper.accounts.${index}.fedToK4`),
        b5Triggered: requiredBool(row.b5Triggered, `tamper.accounts.${index}.b5Triggered`),
        alertState: (() => {
          const value = requiredText(row.alertState, `tamper.accounts.${index}.alertState`);
          if (value !== "flagged" && value !== "escalated") contractError(`tamper.accounts.${index}.alertState`);
          return value;
        })(),
      };
    }),
    accountPage: {
      page: requiredNum(accountPage.page, "accountPage.page"),
      pageSize: requiredNum(accountPage.pageSize, "accountPage.pageSize"),
      total: requiredNum(accountPage.total, "accountPage.total"),
      pages: requiredNum(accountPage.pages, "accountPage.pages"),
      hasPrev: requiredBool(accountPage.hasPrev, "accountPage.hasPrev"),
      hasNext: requiredBool(accountPage.hasNext, "accountPage.hasNext"),
    },
    coverage: (() => {
      const status = requiredText(coverage.status, "coverage.status");
      if (status !== "partial" && status !== "complete") contractError("coverage.status");
      const registeredCount = requiredNum(coverage.registeredCount, "coverage.registeredCount");
      const activeCount = requiredNum(coverage.activeCount, "coverage.activeCount");
      const registeredPaths = requiredStringArray(coverage.registeredPaths, "coverage.registeredPaths");
      const activePaths = requiredStringArrayAllowEmpty(coverage.activePaths, "coverage.activePaths");
      const missingPaths = requiredStringArrayAllowEmpty(coverage.missingPaths, "coverage.missingPaths");
      if (!Number.isInteger(registeredCount) || !Number.isInteger(activeCount)
        || registeredCount !== registeredPaths.length || activeCount !== activePaths.length
        || missingPaths.length !== registeredCount - activeCount
        || (status === "complete") !== (activeCount === registeredCount)) {
        contractError("coverage.consistency");
      }
      return { status, registeredCount, activeCount, registeredPaths, activePaths, missingPaths };
    })(),
    alertConfig: (() => {
      const threshold = requiredNum(alertConfig.threshold, "alertConfig.threshold");
      const effectiveThreshold = requiredNum(alertConfig.effectiveThreshold, "alertConfig.effectiveThreshold");
      const sevenDayAlertAccounts = requiredNum(alertConfig.sevenDayAlertAccounts, "alertConfig.sevenDayAlertAccounts");
      const rawPreview = rec(alertConfig.sevenDayPreviewByThreshold);
      const previewEntries = Object.entries(rawPreview);
      const expectedKeys = Array.from({ length: 100 }, (_, index) => String(index + 1));
      if (previewEntries.length !== expectedKeys.length
        || expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(rawPreview, key))) {
        contractError("alertConfig.sevenDayPreviewByThreshold.keys");
      }
      const sevenDayPreviewByThreshold = Object.fromEntries(previewEntries.map(([key, value]) => {
        const count = requiredNum(value, `alertConfig.sevenDayPreviewByThreshold.${key}`);
        if (!Number.isInteger(count) || count < 0) contractError(`alertConfig.sevenDayPreviewByThreshold.${key}`);
        return [key, count];
      }));
      if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100
        || !Number.isInteger(effectiveThreshold) || effectiveThreshold < threshold
        || !Number.isInteger(sevenDayAlertAccounts) || sevenDayAlertAccounts < 0
        || sevenDayPreviewByThreshold[String(threshold)] !== sevenDayAlertAccounts) {
        contractError("alertConfig.consistency");
      }
      return {
        threshold,
        label: requiredText(alertConfig.label, "alertConfig.label"),
        feedK4: requiredBool(alertConfig.feedK4, "alertConfig.feedK4"),
        effectiveThreshold,
        effectiveLabel: requiredText(alertConfig.effectiveLabel, "alertConfig.effectiveLabel"),
        sevenDayAlertAccounts,
        sevenDayPreviewByThreshold,
      };
    })(),
    sources: strArray(data.sources),
  };
}

function normalizeTamperReport(raw: unknown, expectedWindow: "24h" | "7d" | "30d"): TamperReport {
  const data = rec(raw);
  const window = requiredText(data.window, "tamperReport.window");
  if (window !== "24h" && window !== "7d" && window !== "30d") contractError("tamperReport.window");
  const masked = requiredBool(data.masked, "tamperReport.masked");
  const status = requiredText(data.status, "tamperReport.status");
  const filename = requiredText(data.filename, "tamperReport.filename");
  const contentType = requiredText(data.contentType, "tamperReport.contentType");
  const contentBase64 = requiredText(data.contentBase64, "tamperReport.contentBase64");
  if (window !== expectedWindow || !masked || status !== "READY" || !filename.toLowerCase().endsWith(".csv")
    || !contentType.toLowerCase().startsWith("text/csv")
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(contentBase64) || contentBase64.length % 4 !== 0) {
    contractError("tamperReport.invariants");
  }
  return {
    reportId: requiredText(data.reportId, "tamperReport.reportId"),
    window,
    masked,
    status,
    filename,
    contentType,
    contentBase64,
    eventCount: requiredNum(data.eventCount, "tamperReport.eventCount"),
    accountCount: requiredNum(data.accountCount, "tamperReport.accountCount"),
  };
}

function normalizeSop(raw: unknown): SopOverview {
  const data = rec(raw);
  const actionOptions = rows<Record<string, unknown>>(data.actionOptions).map((row) => {
    const domain = str(row.domain).toUpperCase();
    const ref = row.ref == null ? null : str(row.ref);
    const canonical = ref === "withdraw"
      ? { action: "熔断提现通道", description: "暂停用户提现，用于挤兑或对账缺口止血" }
      : ref === "genesis"
        ? { action: "熔断 Genesis 交易", description: "暂停 Genesis 交易或二级市场入口" }
        : ref === "campaign-notify"
          ? { action: "发送通知模板", description: "使用已排期的通知活动通知用户、法务、财务或超管" }
          : { action: str(row.action), description: str(row.description) };
    const { action, description } = canonical;
    const label = `${domain} · ${action}`;
    return {
      value: str(row.value, ref ? `${domain}:${ref}` : `${domain}:${action}`),
      domain,
      action,
      ref,
      approve: bool(row.approve, domain !== "I3"),
      description,
      parameterLabel: str(row.parameterLabel) || undefined,
      parameterPlaceholder: str(row.parameterPlaceholder) || undefined,
      label,
      searchText: [domain, action, ref, description, label, row.parameterLabel].filter(Boolean).join(" ").toLowerCase(),
    };
  }).filter((item) => (item.domain === "J1" && ["withdraw", "genesis"].includes(item.ref ?? ""))
    || (item.domain === "J2" && item.ref === "geo-block:{target}")
    || (item.domain === "C2" && item.ref === "user-freeze:{target}")
    || (item.domain === "K1" && item.ref === "cluster-freeze:{target}")
    || (item.domain === "I3" && item.ref === "campaign-notify")
    || (item.domain === "I5" && item.ref === "disclosure-publish:{target}"));
  const rollbackOptions = rows<Record<string, unknown>>(data.rollbackOptions).map((row) => {
    const label = str(row.label, str(row.value));
    const scene = str(row.scene, "通用");
    const riskLevel = str(row.riskLevel, "MEDIUM");
    const plan = str(row.plan);
    return {
      value: str(row.value, label),
      label,
      scene,
      riskLevel,
      plan,
      searchText: [label, scene, riskLevel, plan].filter(Boolean).join(" ").toLowerCase(),
    };
  }).filter((item) => item.value === "root-cause-standard");
  return {
    contractVersion: str(data.contractVersion),
    stats: rec(data.stats),
    scenes: strArray(data.scenes),
    actionOptions,
    rollbackOptions,
    playbooks: rows<Record<string, unknown>>(data.playbooks).map((row) => {
      const sequence = rows<Record<string, unknown>>(row.sequence).map((step) => ({
        domain: str(step.domain),
        dom: str(step.domain),
        action: str(step.action),
        ax: str(step.action),
        approve: bool(step.approve),
        ref: step.ref == null ? null : str(step.ref),
      }));
      const emergency = bool(row.emergency);
      return {
        code: str(row.code),
        name: str(row.name),
        scene: str(row.scene),
        emergency,
        emer: emergency,
        sla: str(row.sla),
        state: str(row.state, "todo"),
        owner: str(row.owner),
        lastDrill: str(row.lastDrill),
        sequence,
        seq: sequence,
        notifyCampaignNo: str(row.notifyCampaignNo),
        notifyTemplate: str(row.notifyTemplate),
        rollback: str(row.rollback),
        drillRequired: bool(row.drillRequired, true),
        draft: bool(row.draft),
        version: str(row.version) || undefined,
        executionReady: bool(row.executionReady),
        drillFresh: bool(row.drillFresh),
        campaignReady: bool(row.campaignReady),
        readinessReason: str(row.readinessReason),
      };
    }),
    executions: rows<Record<string, unknown>>(data.executions).map((row) => ({
      timestamp: str(row.timestamp),
      ts: str(row.timestamp),
      code: str(row.code),
      name: str(row.name),
      trigger: str(row.trigger),
      trig: str(row.trigger),
      mode: str(row.mode),
      steps: strArray(row.steps),
      operator: str(row.operator),
      roleGate: str(row.roleGate),
      executionId: str(row.executionId),
      rollbackStatus: str(row.rollbackStatus),
      rollbackAt: str(row.rollbackAt),
      rollbackReason: str(row.rollbackReason),
      notificationDispatch: rec(row.notificationDispatch),
      domainActions: rows<Record<string, unknown>>(row.domainActions),
      rollbackActions: rows<Record<string, unknown>>(row.rollbackActions),
      reversible: bool(row.reversible),
    })),
    sources: strArray(data.sources),
  };
}

function normalizeNotifyTemplates(raw: unknown): JNotifyTemplateOption[] {
  const data = rec(raw);
  const priority: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
  return rows<Record<string, unknown>>(data.campaigns)
    .map((row) => {
      const campaignNo = str(row.id, str(row.campaignNo));
      const name = str(row.name, campaignNo);
      const tier = str(row.tier, "normal");
      const audience = str(row.audience);
      const status = str(row.status, "draft");
      const schedule = str(row.schedule);
      const label = [name, tier, audience].filter(Boolean).join(" · ");
      const meta = [campaignNo, status, schedule].filter(Boolean).join(" · ");
      const searchText = [campaignNo, name, tier, audience, status, schedule, label, meta]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return {
        value: campaignNo,
        label,
        campaignNo,
        name,
        tier,
        audience,
        status,
        meta,
        searchText,
      };
    })
    .filter((item) => item.campaignNo && item.status === "scheduled")
    .sort((a, b) => (priority[a.tier] ?? 9) - (priority[b.tier] ?? 9) || a.name.localeCompare(b.name));
}

export async function fetchJTamperOverview(window: "24h" | "7d" | "30d" = "24h", accountPage = 1, accountPageSize = 5): Promise<TamperOverview> {
  const params = new URLSearchParams({
    window: window,
    accountPage: String(accountPage),
    accountPageSize: String(accountPageSize),
  });
  return apiRequest(`/tamper/overview?${params.toString()}`).then(normalizeTamper);
}

export async function fetchJ4NotifyTemplateOptions(): Promise<JNotifyTemplateOption[]> {
  return contentApiRequest("/campaigns/overview").then(normalizeNotifyTemplates);
}

export async function fetchJEmergencyOverviews(tab: "J1" | "J2" | "J3" | "J4",
  j3Window: "24h" | "7d" | "30d" = "24h",
  j3AccountPage = 1,
  j3AccountPageSize = 5,
): Promise<JEmergencyData> {
  switch (tab) {
    case "J1":
      return { killSwitch: await apiRequest("/kill-switches").then(normalizeKillSwitch) };
    case "J2":
      return { geoBlock: await apiRequest("/geo-block").then(normalizeGeo) };
    case "J3":
      return { tamper: await fetchJTamperOverview(j3Window, j3AccountPage, j3AccountPageSize) };
    case "J4": {
      const [sop, notifyTemplatesResult] = await Promise.all([
        apiRequest("/sop/playbooks").then(normalizeSop),
        fetchJ4NotifyTemplateOptions().then(
          (value) => ({ value, error: "" }),
          (error: unknown) => ({ value: [] as JNotifyTemplateOption[], error: error instanceof Error ? error.message : "I3_NOTIFY_TEMPLATE_LOAD_FAILED" }),
        ),
      ]);
      return { sop, notifyTemplates: notifyTemplatesResult.value, notifyTemplatesError: notifyTemplatesResult.error || undefined };
    }
  }
}

export const jEmergencyActions: Omit<JEmergencyActions, "reloadJEmergency"> = {
  toggleJ1KillSwitch: (key, enabled, reason, context, commandKey) => apiRequest(`/kill-switches/${encodeURIComponent(key)}`, { method: "PUT", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ enabled: enabled ? "enabled" : "disabled", ...context }, reason)) }).then(() => undefined),
  emergencyDisableJ1: (keys, reason, operator, context, commandKey) => apiRequest("/kill-switches/emergency-disable", { method: "POST", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ keys, ...context }, reason, operator)) }).then(() => undefined),
  updateJ1Sla: (paramKey, value, expectedValue, reason, commandKey) => apiRequest(`/kill-switches/emergency-sla/${encodeURIComponent(paramKey)}`, { method: "PATCH", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ value, expectedValue }, reason)) }).then(() => undefined),
  updateJ1AutoRule: (ruleId, value, expectedValue, reason, commandKey) => apiRequest(`/kill-switches/auto-rules/${encodeURIComponent(ruleId)}`, { method: "PATCH", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ value, expectedValue }, reason)) }).then(() => undefined),
  confirmJ1AutoTrigger: (key, incidentId, decision, reason, commandKey) => apiRequest(`/kill-switches/auto-confirmations/${encodeURIComponent(key)}`, { method: "POST", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ incidentId, decision }, reason)) }).then(() => undefined),
  updateJ2Country: (countryCode, status, expectedStatus, triggerBasis, reason, commandKey) => apiRequest(`/geo-block/countries/${encodeURIComponent(countryCode)}`, { method: "PUT", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ status, expectedStatus, triggerBasis }, reason)) }).then(() => undefined),
  replaceJ2CountryList: (status, countries, expectedCountries, triggerBasis, reason, commandKey) => apiRequest(`/geo-block/country-lists/${encodeURIComponent(status)}`, { method: "PUT", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ status, countries, expectedCountries, triggerBasis }, reason)) }).then(() => undefined),
  updateJ2Endpoint: (endpointKey, mode, countries, expectedMode, expectedCountries, reason, commandKey) => apiRequest(`/geo-block/endpoints/${encodeURIComponent(endpointKey)}`, { method: "PUT", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ mode, countries, expectedMode, expectedCountries }, reason)) }).then(() => undefined),
  updateJ2EdgeJudge: (source, expectedSource, reason, commandKey) => apiRequest("/geo-block/edge-judge", { method: "PUT", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ source, expectedSource }, reason)) }).then(() => undefined),
  emergencyBlockJ2: (countries, triggerBasis, reason, commandKey) => apiRequest("/geo-block/emergency-blocks", { method: "POST", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ countries, triggerBasis }, reason)) }).then(() => undefined),
  loadJ3TamperPage: fetchJTamperOverview,
  updateJ3AlertConfig: (threshold, feedK4, expectedThreshold, expectedFeedK4, reason, commandKey) => apiRequest("/tamper/alert-config", { method: "PUT", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ threshold, feedK4, expectedThreshold, expectedFeedK4 }, reason)) }).then(() => undefined),
  createJ3Report: (window, reason, commandKey) => apiRequest("/tamper/reports", { method: "POST", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ window }, reason)) }).then((raw) => normalizeTamperReport(raw, window)),
  createJ4Playbook: (body, reason, commandKey) => apiRequest("/sop/playbooks", { method: "POST", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateJ4Playbook: (code, body, reason, commandKey) => apiRequest(`/sop/playbooks/${encodeURIComponent(code)}`, { method: "PUT", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  drillJ4Playbook: (code, reason, commandKey) => apiRequest(`/sop/playbooks/${encodeURIComponent(code)}/drills`, { method: "POST", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  executeJ4Playbook: (code, emergency, reason, confirmation, commandKey) => apiRequest(`/sop/playbooks/${encodeURIComponent(code)}/executions`, { method: "POST", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ emergency, ...confirmation }, reason)) }).then(() => undefined),
  cancelJ4Playbook: (code, executionId, reason, commandKey) => apiRequest(`/sop/playbooks/${encodeURIComponent(code)}/executions/${encodeURIComponent(executionId)}/cancel`, { method: "POST", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ emergency: false }, reason)) }).then(() => undefined),
  resumeJ4Playbook: (code, executionId, reason, commandKey) => apiRequest(`/sop/playbooks/${encodeURIComponent(code)}/executions/${encodeURIComponent(executionId)}/resume`, { method: "POST", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ emergency: false }, reason)) }).then(() => undefined),
  rollbackJ4Playbook: (code, executionId, reason, commandKey) => apiRequest(`/sop/playbooks/${encodeURIComponent(code)}/executions/${encodeURIComponent(executionId)}/rollback`, { method: "POST", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ emergency: false }, reason)) }).then(() => undefined),
};
