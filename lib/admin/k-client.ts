import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { formatAdminApiError } from "@/lib/admin/error-messages";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { isK1LocalIsoDateTime } from "@/lib/admin/k1-date-contract";
import {
  K5_ALERT_CHANNELS,
  K5_ALERT_TONES,
  K5_ALERT_TYPES,
  K5_KYC_STATUSES,
  K5_PARAM_KEYS,
  K5_TICKET_TYPES,
  type K5KycStatus,
  type K5TicketType,
  hasAllowedK5AlertEventKey,
  hasExactAllowedValues,
  validateK5ParamValue,
  validateK5Stats,
} from "@/lib/admin/k5-contract";

type ApiResult<T> = {
  code?: number;
  message?: string;
  data?: T;
};

export type AdminPage<T> = {
  total: number;
  pageNum: number;
  pageSize: number;
  records: T[];
};

export type K1ClusterLayer = "all" | "ip" | "device" | "payment";
export type K1ClusterStatusFilter = "all" | ClusterStatus;
export type K1ClusterSort = "strength_desc" | "account_desc";

export type K1PaginationQuery = {
  clusterPageNum?: number;
  clusterPageSize?: number;
  clusterLayer?: K1ClusterLayer;
  clusterStatus?: K1ClusterStatusFilter;
  clusterSort?: K1ClusterSort;
  whitelistPageNum?: number;
  whitelistPageSize?: number;
};

export type K3PaginationQuery = {
  rulePageNum?: number;
  rulePageSize?: number;
  hitPageNum?: number;
  hitPageSize?: number;
  hitAction?: "all" | RuleAction;
};

export type K4PaginationQuery = {
  overridePageNum?: number;
  overridePageSize?: number;
};

export type K5PaginationQuery = {
  ticketPageNum?: number;
  ticketPageSize?: number;
  ticketFilter?: string;
};

export type KRiskOverviewQuery = {
  multiAccount?: K1PaginationQuery;
  withdrawRules?: K3PaginationQuery;
  scoring?: K4PaginationQuery;
  kycReview?: K5PaginationQuery;
};

export function newK1CommandKey() {
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type RiskRequestInit = RequestInit & { commandKey?: string };

export class K1OutcomeUncertainError extends Error {
  constructor(message: string, readonly commandKey: string) {
    super(message);
    this.name = "K1OutcomeUncertainError";
  }
}

async function apiRequest<T>(path: string, init?: RiskRequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const isWrite = !!init?.method && init.method !== "GET";
  const commandKey = init?.commandKey ?? newK1CommandKey();
  if (isWrite && !headers.has("Idempotency-Key")) headers.set("Idempotency-Key", commandKey);
  let res: Response;
  try {
    res = await fetch(`/api/admin/risk${path}`, { ...init, headers, cache: "no-store" });
  } catch (error) {
    if (isWrite) throw new K1OutcomeUncertainError(error instanceof Error ? error.message : "RISK_REQUEST_OUTCOME_UNKNOWN", commandKey);
    throw error;
  }
  let payload: ApiResult<T>;
  try {
    const text = await res.text();
    if (!text) throw new Error("RISK_RESPONSE_BODY_MISSING");
    payload = JSON.parse(text) as ApiResult<T>;
  } catch (error) {
    if (isWrite) {
      throw new K1OutcomeUncertainError(
        error instanceof Error ? error.message : "RISK_RESPONSE_UNREADABLE",
        commandKey,
      );
    }
    throw error;
  }
  if (isWrite && res.headers.get("X-Nexion-Upstream-Outcome") === "unknown") {
    throw new K1OutcomeUncertainError(formatAdminApiError(payload.message, "RISK_REQUEST_OUTCOME_UNKNOWN"), commandKey);
  }
  if (!res.ok || (payload.code !== undefined && payload.code >= 400)) {
    // 5xx 不是「确定失败」:后端可能已经落库,弃号重试会变成第二条命令(统一口径见
    // outcome-classification.ts)。只有 4xx / 2xx 业务码非 0 才确定这次没生效。
    if (isWrite && outcomeStaysUnknown(res.status, payload.code)) {
      throw new K1OutcomeUncertainError(
        formatAdminApiError(payload.message, `RISK_REQUEST_OUTCOME_UNKNOWN_${res.status}`), commandKey);
    }
    throw new Error(formatAdminApiError(payload.message, `RISK_API_${res.status}`));
  }
  return payload.data as T;
}

function withReason<T extends Record<string, unknown>>(body: T, reason: string) {
  return { ...body, operator: currentAdminOperator(), reason };
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function str(value: unknown, fallback = "") {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function num(value: unknown, fallback = 0) {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "enabled" || value === "on" || value === "1";
  if (typeof value === "number") return value !== 0;
  return fallback;
}

function strArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => str(item)).filter(Boolean) : [];
}

function queryString(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : "";
}

function normalizePage<T>(
  value: unknown,
  normalizeRow: (row: Record<string, unknown>) => T,
  fallbackPageNum = 1,
  fallbackPageSize = 5,
): AdminPage<T> {
  if (Array.isArray(value)) {
    const records = rows<Record<string, unknown>>(value).map(normalizeRow);
    return { total: records.length, pageNum: fallbackPageNum, pageSize: fallbackPageSize, records };
  }
  const data = rec(value);
  const records = rows<Record<string, unknown>>(data.records).map(normalizeRow);
  return {
    total: num(data.total, records.length),
    pageNum: num(data.pageNum, fallbackPageNum),
    pageSize: num(data.pageSize, fallbackPageSize),
    records,
  };
}

function parseJsonRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export type ClusterStatus = "detected" | "flagged" | "frozen" | "released" | "cleared";
export type TicketSt = "triggered" | "in-review" | "overdue" | "passed" | "rejected";
export type RuleState = "draft" | "active" | "paused" | "archived";
export type RuleAction = "pass" | "delay" | "freeze" | "manual";

export type KRiskParam = {
  key: string;
  name: string;
  value: string;
  val: string;
  version: number;
  adjustable?: boolean;
  unit?: string;
  sub: string;
  note: string;
};

export type K1Node = [string, string, string, string, string, string];
export type K1Gift = [string, string, string];
export type K1Edge = [string, string, string, number];
export type K1Cluster = {
  id: string;
  key: string;
  layer: "ip" | "device" | "payment" | string;
  layerLabel: string;
  n: number;
  strength: number;
  span: string;
  status: ClusterStatus;
  note: string;
  gifts: K1Gift[];
  nodes: K1Node[];
  edges: K1Edge[];
  reviewNote?: string;
  version: number;
};
export type K1WhitelistRow = { cidr: string; note: string; operator: string; expireText: string; active: boolean };
export type MultiAccountOverview = {
  serverCanonical: true;
  domain: "K1";
  stats: Record<string, unknown>;
  params: KRiskParam[];
  /** 收益释放参数(SPEC-7 搬回,合并底账 §二#5):与整簇冻结分开的放行细调,全局风控参数。
   *  形态复用 KRiskParam;缺席(老后端)→ [] 向后兼容,卡片 fail-closed;在场坏形 → 严格抛(K1 契约纪律)。 */
  releaseParams: KRiskParam[];
  clusters: AdminPage<K1Cluster>;
  whitelist: AdminPage<K1WhitelistRow>;
  sources: string[];
};

export type K2Row = {
  rowId: string;
  rid: string;
  viewKey: string;
  clusterId?: string;
  cluster?: string;
  cells: string[];
  level: number;
  lvl: number;
  actions: string[];
  acts: string[];
  disposition?: string | null;
  version: number;
  clusterStatus?: string;
  clusterVersion?: number;
};
export type K2ViewGroup = { key: string; label: string; sub: string; head: string[]; note: string; rows: K2Row[] };
export type K2Stat = { key: string; name: string; value: string; sub: string; tone: string };
export type ArbitrageOverview = {
  serverCanonical: true;
  domain: "K2";
  stats: K2Stat[];
  params: KRiskParam[];
  views: K2ViewGroup[];
  sources?: string[];
};

export type K3Dimension = {
  ruleKey: string;
  ruleId: string;
  name: string;
  conditionText: string;
  conditionDefault: string;
  why: string;
  action: RuleAction;
  note: string;
  icon: string;
  priority?: number;
  version?: number;
};
export type K3Rule = {
  ruleId: string;
  id: string;
  dimension: string;
  dim: string;
  conditionText: string;
  cond: string;
  action: RuleAction;
  act: RuleAction;
  state: RuleState;
  builtIn: boolean;
  priority: number;
  version: number;
};
export type K3RouteCount = { key: RuleAction; label: string; count: number; n: number; color: string };
export type K3DryRunResult = {
  batchNo: string;
  status: "COMPLETED" | string;
  sampleWindowDays: number;
  evaluatedWithdrawals: number;
  activeRules: number;
  hitCount: number;
  hitCountsByRule: Record<string, number>;
  routeCounts: K3RouteCount[];
  completedAt: string;
};
export type K3Hit = {
  withdrawalNo: string;
  userNo: string;
  amount: string;
  ruleId: string;
  dimension: string;
  action: RuleAction;
  reason: string;
  timeText: string;
};
export type WithdrawRuleOverview = {
  dimensions: K3Dimension[];
  rules: AdminPage<K3Rule>;
  routeCounts: K3RouteCount[];
  routeTotal: number;
  hits: AdminPage<K3Hit>;
  sources?: string[];
};

export const K4_DIMENSION_KEYS = [
  "multiAccount",
  "arbitrage",
  "kycStatus",
  "withdrawVelocity",
  "accountAge",
  "anomalyBehavior",
] as const;
export type K4DimensionKey = (typeof K4_DIMENSION_KEYS)[number];
export const K4_SCORE_MAPPING_KEYS = [
  "multiAccount.mediumMin", "multiAccount.highMin", "multiAccount.mediumScore", "multiAccount.highScore", "multiAccount.fraudScore",
  "arbitrage.singleScore", "arbitrage.repeatMin", "arbitrage.repeatScore", "arbitrage.severeScore",
  "kyc.reviewScore", "kyc.pendingScore", "kyc.rejectedScore", "kyc.sanctionedScore",
  "withdraw.baselineMultiplierPct", "withdraw.baselineScore", "withdraw.highFrequency24h", "withdraw.largeAmountUsd", "withdraw.highScore",
  "account.matureDays", "account.newDays", "account.middleScore", "account.newLargeScore",
  "anomaly.lowScore", "anomaly.tamperScore",
] as const;
export type K4ScoreMappingKey = (typeof K4_SCORE_MAPPING_KEYS)[number];
export type K4ScoreMappings = Record<K4ScoreMappingKey, number>;
export const K4_SCORE_MAPPING_BOUNDS: Record<K4ScoreMappingKey, readonly [number, number]> = {
  "multiAccount.mediumMin": [1, 100], "multiAccount.highMin": [1, 100],
  "multiAccount.mediumScore": [0, 100], "multiAccount.highScore": [0, 100], "multiAccount.fraudScore": [0, 100],
  "arbitrage.singleScore": [0, 100], "arbitrage.repeatMin": [2, 100],
  "arbitrage.repeatScore": [0, 100], "arbitrage.severeScore": [0, 100],
  "kyc.reviewScore": [0, 100], "kyc.pendingScore": [0, 100], "kyc.rejectedScore": [0, 100], "kyc.sanctionedScore": [0, 100],
  "withdraw.baselineMultiplierPct": [100, 1000], "withdraw.baselineScore": [0, 100],
  "withdraw.highFrequency24h": [1, 100], "withdraw.largeAmountUsd": [1, 1_000_000], "withdraw.highScore": [0, 100],
  "account.matureDays": [1, 10_000], "account.newDays": [1, 10_000],
  "account.middleScore": [0, 100], "account.newLargeScore": [0, 100],
  "anomaly.lowScore": [0, 100], "anomaly.tamperScore": [0, 100],
};
export type K4ModelState = "draft" | "active" | "archived";
export type K4Dimension = { dimKey: K4DimensionKey; name: string; source: string; weightPct: number };
export type K4Config = {
  inputSources: Record<K4DimensionKey, boolean>;
  bandLowMax: number;
  bandHighMin: number;
  autoEscalateScore: number;
};
export type K4Model = K4Config & {
  version: number;
  rowVersion: number;
  state: K4ModelState;
  weights: Record<K4DimensionKey, number>;
  scoreMappings: K4ScoreMappings;
  reason: string;
  createdBy: string;
  publishedBy: string | null;
  createdAt: string;
  publishedAt: string | null;
};
export type K4ModelDraftInput = {
  expectedVersion: number;
  weights: Record<K4DimensionKey, number>;
  inputSources: Record<K4DimensionKey, boolean>;
  scoreMappings: K4ScoreMappings;
  lowMax: number;
  highMin: number;
  autoEscalateScore: number;
};
export type K4Distribution = { band: string; rangeText: string; count: number; percentage: number; color: string; tone: string };
export type K4Override = { userNo: string; modelScore: number; overrideScore: number; reason: string; operator: string; timeText: string; active: boolean };
export type K4Contribution = {
  dimKey: K4DimensionKey;
  name: string;
  evidence: string;
  hit: boolean;
  subScore: number;
  weightPct: number;
  points: number;
};
export type K4ScoreHistory = {
  modelVersion: number;
  modelScore: number;
  effectiveScore: number;
  scoreState: string;
  contributions: K4Contribution[];
  reason: string;
  operator: string;
  createdAt: string;
};
export type K4User = {
  userNo: string;
  modelScore: number;
  effectiveScore: number;
  overridden: boolean;
  bandLabel: string;
  bandTone: string;
  modelVersion: string;
  updatedText: string;
  rowVersion: number;
  asOf: string;
  contributions: K4Contribution[];
  history: K4ScoreHistory[];
};
export type K4UserOption = {
  userNo: string;
  label: string;
  sub: string;
  modelScore: number;
  effectiveScore: number;
  bandLabel: string;
  bandTone: string;
  overridden: boolean;
};
export type ScoringOverview = {
  model: K4Model;
  draft: K4Model | null;
  modelHistory: K4Model[];
  dimensions: K4Dimension[];
  config: K4Config;
  distribution: K4Distribution[];
  totalUsers: number;
  recomputePending: number;
  overrides: AdminPage<K4Override>;
  overrideActive: number;
};

export type K4WithdrawalAlert = {
  id: string;
  domain: "K4";
  level: "critical";
  title: string;
  hint: string;
  withdrawalNo: string;
  riskScore: number;
  priority: string;
  modelVersion: string;
  scoreAsOf: string;
  read: boolean;
  createdAt: string;
};

export type K4WithdrawalAlertOverview = {
  alerts: K4WithdrawalAlert[];
  source: string;
};

export type K5Ticket = {
  id: string;
  type: K5TicketType;
  user: string;
  amt: string;
  cum: string;
  kyc: K5KycStatus;
  st: TicketSt;
  version: number;
  slaPct: number;
  slaTxt: string;
  info: [string, string][];
  hist: [string, string, "" | "warn" | "bad"][];
};
export type K5Alert = { eventKey: string; tone: "warn" | "bad"; title: string; body: string; timeText: string };
export type K5AlertSubscription = {
  alertTypes: string[];
  channels: string[];
  version: number;
};
export type K5UserOption = {
  userNo: string;
  label: string;
  sub: string;
  kycStatus: K5KycStatus;
};
export type K5ManualResult = {
  ticketId: string;
  userNo: string;
  merged: boolean;
};
export type K5Stats = {
  openTickets: number;
  reviewOverdue: number;
  reviewDecidedMonth: number;
  reviewDecidedPass: number;
  reviewFrozenUsd: number;
};
export type KycReviewOverview = {
  stats: K5Stats;
  params: KRiskParam[];
  tickets: AdminPage<K5Ticket>;
  alerts: K5Alert[];
  subscription: K5AlertSubscription;
  sources: string[];
};

export type KRiskData = {
  multiAccount?: MultiAccountOverview;
  arbitrage?: ArbitrageOverview;
  withdrawRules?: WithdrawRuleOverview;
  scoring?: ScoringOverview;
  kycReview?: KycReviewOverview;
};

export type KRiskActions = {
  reloadKRisk: (query?: KRiskOverviewQuery) => Promise<MultiAccountOverview | void>;
  updateK1Param: (key: string, value: string, reason: string, commandKey?: string) => Promise<void>;
  updateK1ReleaseParam: (key: string, value: string, reason: string, commandKey?: string) => Promise<void>;
  updateK1ClusterStatus: (clusterId: string, status: ClusterStatus, expectedVersion: number, reason: string, commandKey?: string) => Promise<void>;
  updateK1ClusterReviewNote: (clusterId: string, expectedVersion: number, reason: string, commandKey?: string) => Promise<void>;
  upsertK1Whitelist: (cidr: string, note: string, reason: string, expireText: string, commandKey?: string) => Promise<void>;
  disableK1Whitelist: (cidr: string, reason: string, commandKey?: string) => Promise<void>;
  updateK2Param: (key: string, value: string, expectedVersion: number, reason: string, commandKey?: string) => Promise<void>;
  executeK2Action: (rowId: string, action: string, expectedVersion: number, clusterExpectedVersion: number | undefined, reason: string, commandKey?: string) => Promise<void>;
  createK3Rule: (dimension: string, conditionText: string, action: RuleAction, priority: number, reason: string, commandKey?: string) => Promise<void>;
  updateK3RuleState: (ruleId: string, state: RuleState, expectedVersion: number, reason: string, commandKey?: string) => Promise<void>;
  updateK3Rule: (ruleId: string, conditionText: string, action: RuleAction, priority: number, expectedVersion: number, reason: string, commandKey?: string) => Promise<void>;
  archiveK3Rule: (ruleId: string, expectedVersion: number, reason: string, commandKey?: string) => Promise<void>;
  dryRunK3: (reason: string, commandKey?: string) => Promise<K3DryRunResult>;
  saveK4ModelDraft: (input: K4ModelDraftInput, reason: string, commandKey?: string) => Promise<void>;
  publishK4ModelDraft: (expectedVersion: number, reason: string, commandKey?: string) => Promise<void>;
  restoreK4ModelDraft: (modelVersion: number, expectedVersion: number, reason: string, commandKey?: string) => Promise<void>;
  searchK4Users: (keyword: string) => Promise<K4UserOption[]>;
  fetchK4User: (userNo: string) => Promise<K4User>;
  overrideK4Score: (userNo: string, score: number, expectedVersion: number, reason: string, commandKey?: string) => Promise<void>;
  recomputeK4Score: (userNo: string, expectedVersion: number, reason: string, commandKey?: string) => Promise<void>;
  recomputeK4Scores: (userNos: string[], expectedModelVersion: number, reason: string, commandKey?: string) => Promise<void>;
  updateK5Param: (key: string, value: string, expectedVersion: number, reason: string, commandKey?: string) => Promise<void>;
  decideK5Ticket: (ticketId: string, decision: "passed" | "rejected", expectedVersion: number, reasonCode: string | undefined, reason: string, commandKey?: string) => Promise<void>;
  createK5ManualTicket: (userNo: string, reason: string, commandKey?: string) => Promise<K5ManualResult>;
  updateK5AlertSubscription: (alertTypes: string[], channels: string[], expectedVersion: number, reason: string, commandKey?: string) => Promise<void>;
  searchK5Users: (keyword: string) => Promise<K5UserOption[]>;
};

function normalizeParam(row: Record<string, unknown>): KRiskParam {
  const value = str(row.value, str(row.val));
  return {
    key: str(row.key),
    name: str(row.name),
    value,
    val: value,
    version: num(row.version),
    unit: str(row.unit),
    sub: str(row.sub),
    note: str(row.note),
  };
}

function normalizeClusterStatus(value: unknown): ClusterStatus {
  const status = str(value, "detected") as ClusterStatus;
  return ["detected", "flagged", "frozen", "released", "cleared"].includes(status) ? status : "detected";
}

function normalizeTicketStatus(value: unknown): TicketSt {
  const status = str(value, "triggered") as TicketSt;
  return ["triggered", "in-review", "overdue", "passed", "rejected"].includes(status) ? status : "triggered";
}

function normalizeRuleAction(value: unknown): RuleAction {
  const action = str(value, "manual").trim().toLowerCase() as RuleAction;
  return ["pass", "delay", "freeze", "manual"].includes(action) ? action : "manual";
}

function normalizeRuleState(value: unknown): RuleState {
  const state = str(value, "draft").trim().toLowerCase() as RuleState;
  return ["draft", "active", "paused", "archived"].includes(state) ? state : "draft";
}

const K1_RESPONSE_INVALID = "K1_RESPONSE_INVALID";
const K1_REQUIRED_PARAM_KEYS = [
  "maxSignupPerIp24h",
  "maxAccountsPerDevice",
  "maxAccountsPerPaymentInstrument",
  "linkWeight",
  "clusterFreezeSuggestThreshold",
] as const;
const K1_REQUIRED_SOURCES = [
  "nx_user_registration_otp:consumed_client_ip",
  "nx_risk_decision:device_fingerprint",
  "nx_wallet_bank_card:card_token",
  "nx_admin_risk_multi_account_cluster",
  "nx_admin_risk_ip_whitelist",
] as const;

/** 收益释放参数键集(SPEC-7,合并底账 §二#5)。releaseParams 组在场时七键齐备、不许未知键,
 *  与拦截参数 K1_REQUIRED_PARAM_KEYS 同款精确集合纪律。 */
export const K1_RELEASE_PARAM_KEYS = [
  "freePhoneSlotsPerCluster",
  "duplicateAccountPendingFrom",
  "duplicateAccountFreezeFrom",
  "pendingReleaseHours",
  "appAttestationReleaseHours",
  "releaseMode",
  "freeSlotRequiresBinding",
] as const;
export type K1ReleaseParamKey = (typeof K1_RELEASE_PARAM_KEYS)[number];

/** 数值型释放参数的范围(读校验与编辑弹窗共用同一份,避免两处漂移)。
 *  下界对齐原型可编辑域(min 1:「第 1 个账号即待审」是合法的严格模式,读校验收紧会误拒
 *  合法服务端值);上界是防御性护栏,权威裁决在服务端。跨字段关系(冻结建议线 ≥ 待审起点等)
 *  由服务端权威校验,此处只管单键形态。 */
export const K1_RELEASE_PARAM_LIMITS: Record<string, { min: number; max: number; step: number; integer: boolean }> = {
  freePhoneSlotsPerCluster: { min: 1, max: 10, step: 1, integer: true },
  duplicateAccountPendingFrom: { min: 1, max: 50, step: 1, integer: true },
  duplicateAccountFreezeFrom: { min: 1, max: 50, step: 1, integer: true },
  pendingReleaseHours: { min: 1, max: 720, step: 1, integer: true },
  appAttestationReleaseHours: { min: 1, max: 168, step: 1, integer: true },
};

/** 释放模式取值全集(工程串)。运营可读中文标签由 UI 层映射,页面禁裸工程串。 */
export const K1_RELEASE_MODE_VALUES = ["attest_or_manual", "manual_only"] as const;

export function validateK1ReleaseParamValue(key: string, value: string): boolean {
  const limits = K1_RELEASE_PARAM_LIMITS[key];
  if (limits) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= limits.min && parsed <= limits.max;
  }
  if (key === "releaseMode") return (K1_RELEASE_MODE_VALUES as readonly string[]).includes(value);
  if (key === "freeSlotRequiresBinding") return value === "true" || value === "false";
  return false;
}

function validateK1ParamValue(key: string, value: string): boolean {
  if (key === "maxSignupPerIp24h") return Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 10;
  if (key === "maxAccountsPerDevice" || key === "maxAccountsPerPaymentInstrument") {
    return Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 5;
  }
  if (key === "clusterFreezeSuggestThreshold") {
    const threshold = Number(value);
    return Number.isFinite(threshold) && threshold >= 0 && threshold <= 1;
  }
  if (key === "linkWeight") {
    const weights = value.match(/设备\s*([0-9.]+)\s*·\s*支付\s*([0-9.]+)\s*·\s*IP\s*([0-9.]+)/i);
    if (!weights) return false;
    const values = weights.slice(1).map(Number);
    return values.every((weight) => Number.isFinite(weight) && weight >= 0 && weight <= 1)
      && Math.abs(values.reduce((sum, weight) => sum + weight, 0) - 1) <= 0.001;
  }
  return false;
}

function invalidK1Response(path: string): never {
  throw new Error(formatAdminApiError(K1_RESPONSE_INVALID, K1_RESPONSE_INVALID) + ` · ${path}`);
}

function requiredK1Record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidK1Response(path);
  return value as Record<string, unknown>;
}

function requiredK1Array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalidK1Response(path);
  return value;
}

function requiredK1String(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) invalidK1Response(path);
  return value;
}

function requiredK1LocalIsoDateTime(value: unknown, path: string): string {
  if (!isK1LocalIsoDateTime(value)) invalidK1Response(path);
  return value;
}

function requiredK1Number(
  value: unknown,
  path: string,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) invalidK1Response(path);
  return value;
}

function requiredK1Integer(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const result = requiredK1Number(value, path, min, max);
  if (!Number.isInteger(result)) invalidK1Response(path);
  return result;
}

function requiredK1Boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalidK1Response(path);
  return value;
}

function requiredK1StringArray(value: unknown, path: string): string[] {
  return requiredK1Array(value, path).map((item, index) => requiredK1String(item, `${path}[${index}]`));
}

function requiredK1JsonRows(value: unknown, path: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") invalidK1Response(path);
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) invalidK1Response(path);
    return parsed;
  } catch {
    return invalidK1Response(path);
  }
}

function requiredK1Page<T>(
  value: unknown,
  path: string,
  normalizeRow: (row: Record<string, unknown>, rowPath: string) => T,
): AdminPage<T> {
  const page = requiredK1Record(value, path);
  const records = requiredK1Array(page.records, `${path}.records`).map((item, index) =>
    normalizeRow(requiredK1Record(item, `${path}.records[${index}]`), `${path}.records[${index}]`));
  const total = requiredK1Integer(page.total, `${path}.total`);
  if (records.length > total) invalidK1Response(`${path}.records`);
  return {
    total,
    pageNum: requiredK1Integer(page.pageNum, `${path}.pageNum`, 1),
    pageSize: requiredK1Integer(page.pageSize, `${path}.pageSize`, 1, 50),
    records,
  };
}

function normalizeK1(raw: unknown): MultiAccountOverview {
  const data = requiredK1Record(raw, "multiAccount");
  if (data.serverCanonical !== true) invalidK1Response("multiAccount.serverCanonical");
  if (data.domain !== "K1") invalidK1Response("multiAccount.domain");

  const stats = requiredK1Record(data.stats, "multiAccount.stats");
  for (const key of ["activeClusters", "highClusters", "frozenClusters", "frozenAccounts", "flaggedAccounts"]) {
    requiredK1Integer(stats[key], `multiAccount.stats.${key}`);
  }

  const params = requiredK1Array(data.params, "multiAccount.params").map((item, index) => {
    const path = `multiAccount.params[${index}]`;
    const row = requiredK1Record(item, path);
    const value = requiredK1String(row.value ?? row.val, `${path}.value`);
    return {
      key: requiredK1String(row.key, `${path}.key`),
      name: requiredK1String(row.name, `${path}.name`),
      value,
      val: value,
      version: requiredK1Integer(row.version, `${path}.version`),
      adjustable: row.adjustable == null ? undefined : requiredK1Boolean(row.adjustable, `${path}.adjustable`),
      unit: row.unit == null ? undefined : requiredK1String(row.unit, `${path}.unit`, true),
      sub: requiredK1String(row.sub, `${path}.sub`, true),
      note: requiredK1String(row.note, `${path}.note`, true),
    };
  });
  const paramKeys = new Set(params.map((param) => param.key));
  if (params.length !== paramKeys.size || K1_REQUIRED_PARAM_KEYS.some((key) => !paramKeys.has(key))) {
    invalidK1Response("multiAccount.params");
  }
  params.forEach((param, index) => {
    if (!validateK1ParamValue(param.key, param.value)) invalidK1Response(`multiAccount.params[${index}].value`);
  });

  // 收益释放参数:缺席(老后端未升级)→ [] 向后兼容;在场则七键精确集合 + 逐键值校验,坏形严格抛。
  const releaseParams = data.releaseParams == null ? [] : requiredK1Array(data.releaseParams, "multiAccount.releaseParams").map((item, index) => {
    const path = `multiAccount.releaseParams[${index}]`;
    const row = requiredK1Record(item, path);
    const value = requiredK1String(row.value ?? row.val, `${path}.value`);
    return {
      key: requiredK1String(row.key, `${path}.key`),
      name: requiredK1String(row.name, `${path}.name`),
      value,
      val: value,
      version: requiredK1Integer(row.version, `${path}.version`),
      adjustable: row.adjustable == null ? undefined : requiredK1Boolean(row.adjustable, `${path}.adjustable`),
      unit: row.unit == null ? undefined : requiredK1String(row.unit, `${path}.unit`, true),
      sub: requiredK1String(row.sub, `${path}.sub`, true),
      note: requiredK1String(row.note, `${path}.note`, true),
    };
  });
  if (releaseParams.length > 0) {
    const releaseKeys = new Set(releaseParams.map((param) => param.key));
    if (releaseParams.length !== releaseKeys.size || releaseParams.length !== K1_RELEASE_PARAM_KEYS.length
      || K1_RELEASE_PARAM_KEYS.some((key) => !releaseKeys.has(key))) {
      invalidK1Response("multiAccount.releaseParams");
    }
    releaseParams.forEach((param, index) => {
      if (!validateK1ReleaseParamValue(param.key, param.value)) invalidK1Response(`multiAccount.releaseParams[${index}].value`);
    });
  }

  const clusters = requiredK1Page(data.clusters, "multiAccount.clusters", (row, path): K1Cluster => {
    const layer = requiredK1String(row.layer, `${path}.layer`);
    if (!["ip", "device", "payment"].includes(layer)) invalidK1Response(`${path}.layer`);
    const status = requiredK1String(row.status, `${path}.status`) as ClusterStatus;
    if (!["detected", "flagged", "frozen", "released", "cleared"].includes(status)) invalidK1Response(`${path}.status`);
    const gifts = requiredK1JsonRows(row.giftsJson, `${path}.giftsJson`).map((item, index) => {
      const tuple = requiredK1Array(item, `${path}.giftsJson[${index}]`);
      if (tuple.length < 3) invalidK1Response(`${path}.giftsJson[${index}]`);
      return [
        requiredK1String(tuple[0], `${path}.giftsJson[${index}][0]`),
        requiredK1String(tuple[1], `${path}.giftsJson[${index}][1]`, true),
        requiredK1String(tuple[2], `${path}.giftsJson[${index}][2]`, true),
      ] as K1Gift;
    });
    const nodes = requiredK1JsonRows(row.nodesJson, `${path}.nodesJson`).map((item, index) => {
      const nodePath = `${path}.nodesJson[${index}]`;
      if (!Array.isArray(item)) {
        const object = requiredK1Record(item, nodePath);
        const gotWelcomeGift = object.gotWelcomeGift;
        if (gotWelcomeGift != null) requiredK1Boolean(gotWelcomeGift, `${nodePath}.gotWelcomeGift`);
        return [
          requiredK1String(object.userNo, `${nodePath}.userNo`),
          requiredK1LocalIsoDateTime(object.joinedAt, `${nodePath}.joinedAt`),
          object.sponsorUserNo == null ? "—" : requiredK1String(object.sponsorUserNo, `${nodePath}.sponsorUserNo`, true),
          gotWelcomeGift == null ? "—" : gotWelcomeGift ? "是" : "否",
          object.depositCumulativeUsdt == null
            ? "—"
            : typeof object.depositCumulativeUsdt === "number"
              ? String(requiredK1Number(object.depositCumulativeUsdt, `${nodePath}.depositCumulativeUsdt`, 0))
              : requiredK1String(object.depositCumulativeUsdt, `${nodePath}.depositCumulativeUsdt`, true),
          requiredK1String(object.accountStatus, `${nodePath}.accountStatus`),
        ] as K1Node;
      }
      if (item.length < 6) invalidK1Response(nodePath);
      return item.slice(0, 6).map((value, tupleIndex) =>
        tupleIndex === 1
          ? requiredK1LocalIsoDateTime(value, `${nodePath}[${tupleIndex}]`)
          : requiredK1String(value, `${nodePath}[${tupleIndex}]`, tupleIndex >= 2)) as K1Node;
    });
    const edges = requiredK1JsonRows(row.edgesJson, `${path}.edgesJson`).map((item, index) => {
      const edgePath = `${path}.edgesJson[${index}]`;
      if (!Array.isArray(item)) {
        const object = requiredK1Record(item, edgePath);
        return [
          requiredK1String(object.from, `${edgePath}.from`),
          requiredK1String(object.to, `${edgePath}.to`),
          requiredK1String(object.layer, `${edgePath}.layer`),
          requiredK1Number(object.weight, `${edgePath}.weight`, 0, 1),
        ] as K1Edge;
      }
      if (item.length < 4) invalidK1Response(edgePath);
      return [
        requiredK1String(item[0], `${edgePath}[0]`),
        requiredK1String(item[1], `${edgePath}[1]`),
        requiredK1String(item[2], `${edgePath}[2]`),
        requiredK1Number(item[3], `${edgePath}[3]`, 0, 1),
      ] as K1Edge;
    });
    return {
      id: requiredK1String(row.id, `${path}.id`),
      key: requiredK1String(row.key, `${path}.key`),
      layer,
      layerLabel: requiredK1String(row.layerLabel, `${path}.layerLabel`),
      n: requiredK1Integer(row.n, `${path}.n`),
      strength: requiredK1Number(row.strength, `${path}.strength`, 0, 1),
      span: requiredK1String(row.span, `${path}.span`),
      status,
      note: requiredK1String(row.note, `${path}.note`, true),
      gifts,
      nodes,
      edges,
      reviewNote: row.reviewNote == null ? undefined : requiredK1String(row.reviewNote, `${path}.reviewNote`, true),
      version: requiredK1Integer(row.version, `${path}.version`),
    };
  });

  const whitelist = requiredK1Page(data.whitelist, "multiAccount.whitelist", (row, path): K1WhitelistRow => ({
    cidr: requiredK1String(row.cidr, `${path}.cidr`),
    note: requiredK1String(row.note, `${path}.note`, true),
    operator: requiredK1String(row.operator, `${path}.operator`),
    expireText: requiredK1String(row.expireText, `${path}.expireText`),
    active: requiredK1Boolean(row.active, `${path}.active`),
  }));
  const sources = requiredK1StringArray(data.sources, "multiAccount.sources");
  if (K1_REQUIRED_SOURCES.some((source) => !sources.includes(source))) invalidK1Response("multiAccount.sources");
  return { serverCanonical: true, domain: "K1", stats, params, releaseParams, clusters, whitelist, sources };
}

const K2_RESPONSE_INVALID = "K2_RESPONSE_INVALID";
const K2_STAT_KEYS = ["loopConfirmed", "loopWarn", "giftBlockedCnt", "boardSignals"] as const;
const K2_VIEW_KEYS = ["trial", "tradein", "gift", "board"] as const;
const K2_PARAM_KEYS = [
  "trialCycleThreshold",
  "welcomeGiftAnomalyThreshold",
  "leaderboardVelocityMultiplier",
  "otpGate.resendSeconds",
  "otpGate.captchaAfterSends",
  "otpGate.otpTtlSeconds",
  "otpGate.maxVerifyAttempts",
  "otpGate.captchaTicketTtlSeconds",
] as const;
const K2_REQUIRED_SOURCES = [
  "nx_tradein_application:E3",
  "nx_event_outbox:H2",
  "nx_admin_risk_multi_account_cluster:K1",
  "nx_commission_event:F4/F5",
  "nx_risk_k2_leaderboard_snapshot:F4",
  "nx_admin_risk_arbitrage_row",
] as const;

function validateK2ParamValue(key: string, value: string): boolean {
  if (key === "trialCycleThreshold") {
    const match = value.match(/^(>=|>)\s*(\d+)\s*次\s*\/\s*(7|14|30|60)\s*天$/);
    return !!match && Number(match[2]) >= 2 && Number(match[2]) <= 10;
  }
  if (key === "welcomeGiftAnomalyThreshold") {
    const match = value.match(/^(>=|>)\s*(\d+)\s*笔\s*\/\s*(实体|账户簇|手机号|设备)$/);
    return !!match && Number(match[2]) >= 1 && Number(match[2]) <= 5;
  }
  if (key === "leaderboardVelocityMultiplier") {
    const match = value.match(/^(>=|>)\s*(\d+)\s*x\s*(基线|上周期|7日均值|同层级均值)$/i);
    return !!match && Number(match[2]) >= 2 && Number(match[2]) <= 20;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return false;
  if (key === "otpGate.resendSeconds") return numeric >= 30 && numeric <= 300;
  if (key === "otpGate.captchaAfterSends" || key === "otpGate.maxVerifyAttempts") return numeric >= 1 && numeric <= 10;
  if (key === "otpGate.otpTtlSeconds") return numeric >= 60 && numeric <= 900 && numeric % 60 === 0;
  if (key === "otpGate.captchaTicketTtlSeconds") return numeric >= 30 && numeric <= 600;
  return false;
}

function invalidK2Response(path: string): never {
  throw new Error(formatAdminApiError(K2_RESPONSE_INVALID, K2_RESPONSE_INVALID) + ` · ${path}`);
}

function requiredK2Record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidK2Response(path);
  return value as Record<string, unknown>;
}

function requiredK2Array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalidK2Response(path);
  return value;
}

function requiredK2String(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) invalidK2Response(path);
  return value;
}

function requiredK2Integer(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) invalidK2Response(path);
  return value;
}

function requiredK2StringArray(value: unknown, path: string): string[] {
  return requiredK2Array(value, path).map((item, index) => requiredK2String(item, `${path}[${index}]`));
}

function normalizeK2(raw: unknown): ArbitrageOverview {
  const data = requiredK2Record(raw, "arbitrage");
  if (data.serverCanonical !== true) invalidK2Response("arbitrage.serverCanonical");
  if (data.domain !== "K2") invalidK2Response("arbitrage.domain");

  const stats = requiredK2Array(data.stats, "arbitrage.stats").map((item, index): K2Stat => {
    const path = `arbitrage.stats[${index}]`;
    const row = requiredK2Record(item, path);
    return {
      key: requiredK2String(row.key, `${path}.key`),
      name: requiredK2String(row.name ?? row.label, `${path}.name`),
      value: requiredK2String(row.value, `${path}.value`),
      sub: requiredK2String(row.sub, `${path}.sub`, true),
      tone: requiredK2String(row.tone, `${path}.tone`, true),
    };
  });
  const statKeys = new Set(stats.map((stat) => stat.key));
  if (stats.length !== K2_STAT_KEYS.length || K2_STAT_KEYS.some((key) => !statKeys.has(key))) {
    invalidK2Response("arbitrage.stats");
  }
  stats.forEach((stat, index) => {
    if (!/^\d+$/.test(stat.value)) invalidK2Response(`arbitrage.stats[${index}].value`);
    if (!["", "warn", "ok", "danger"].includes(stat.tone)) invalidK2Response(`arbitrage.stats[${index}].tone`);
  });

  const params = requiredK2Array(data.params, "arbitrage.params").map((item, index): KRiskParam => {
    const path = `arbitrage.params[${index}]`;
    const row = requiredK2Record(item, path);
    const value = requiredK2String(row.value, `${path}.value`);
    return {
      key: requiredK2String(row.key, `${path}.key`),
      name: requiredK2String(row.name, `${path}.name`),
      value,
      val: value,
      version: requiredK2Integer(row.version, `${path}.version`),
      sub: requiredK2String(row.sub, `${path}.sub`, true),
      note: requiredK2String(row.note, `${path}.note`, true),
    };
  });
  const paramKeys = new Set(params.map((param) => param.key));
  if (params.length !== paramKeys.size || K2_PARAM_KEYS.some((key) => !paramKeys.has(key))) invalidK2Response("arbitrage.params");
  params.forEach((param, index) => {
    if (!validateK2ParamValue(param.key, param.value)) invalidK2Response(`arbitrage.params[${index}].value`);
  });

  const views = requiredK2Array(data.views, "arbitrage.views").map((item, index): K2ViewGroup => {
    const path = `arbitrage.views[${index}]`;
    const view = requiredK2Record(item, path);
    const key = requiredK2String(view.key, `${path}.key`);
    if (!K2_VIEW_KEYS.includes(key as (typeof K2_VIEW_KEYS)[number])) invalidK2Response(`${path}.key`);
    return {
      key,
      label: requiredK2String(view.label, `${path}.label`),
      sub: requiredK2String(view.sub, `${path}.sub`),
      head: requiredK2StringArray(view.head, `${path}.head`),
      note: requiredK2String(view.note, `${path}.note`),
      rows: requiredK2Array(view.rows, `${path}.rows`).map((rowValue, rowIndex): K2Row => {
        const rowPath = `${path}.rows[${rowIndex}]`;
        const row = requiredK2Record(rowValue, rowPath);
        const rowId = requiredK2String(row.rowId, `${rowPath}.rowId`);
        const rowViewKey = requiredK2String(row.viewKey, `${rowPath}.viewKey`);
        if (rowViewKey !== key) invalidK2Response(`${rowPath}.viewKey`);
        const actions = requiredK2StringArray(row.actions, `${rowPath}.actions`);
        if (actions.some((action) => !["flag", "freeze", "blockgift", "boardflag"].includes(action))) {
          invalidK2Response(`${rowPath}.actions`);
        }
        const disposition = row.disposition == null
          ? null
          : requiredK2String(row.disposition, `${rowPath}.disposition`);
        if (disposition && !["account_flagged", "gift_blocked", "leaderboard_flagged", "cluster_frozen"].includes(disposition)) {
          invalidK2Response(`${rowPath}.disposition`);
        }
        const clusterStatus = row.clusterStatus == null
          ? undefined
          : requiredK2String(row.clusterStatus, `${rowPath}.clusterStatus`);
        if (clusterStatus && !["detected", "flagged", "frozen", "released", "cleared"].includes(clusterStatus)) {
          invalidK2Response(`${rowPath}.clusterStatus`);
        }
        const clusterId = row.clusterId == null ? "" : requiredK2String(row.clusterId, `${rowPath}.clusterId`, true);
        const level = requiredK2Integer(row.level, `${rowPath}.level`, 0, 3);
        return {
          rowId,
          rid: rowId,
          viewKey: rowViewKey,
          clusterId,
          cluster: clusterId || undefined,
          cells: requiredK2StringArray(row.cells, `${rowPath}.cells`),
          level,
          lvl: level,
          actions,
          acts: actions,
          disposition,
          version: requiredK2Integer(row.version, `${rowPath}.version`),
          clusterStatus,
          clusterVersion: row.clusterVersion == null
            ? undefined
            : requiredK2Integer(row.clusterVersion, `${rowPath}.clusterVersion`),
        };
      }),
    };
  });
  const viewKeys = new Set(views.map((view) => view.key));
  if (views.length !== K2_VIEW_KEYS.length || K2_VIEW_KEYS.some((key) => !viewKeys.has(key))) invalidK2Response("arbitrage.views");
  const sources = requiredK2StringArray(data.sources, "arbitrage.sources");
  if (K2_REQUIRED_SOURCES.some((source) => !sources.includes(source))) invalidK2Response("arbitrage.sources");
  return { serverCanonical: true, domain: "K2", stats, params, views, sources };
}

const K3_RESPONSE_INVALID = "K3_RESPONSE_INVALID";

function invalidK3Response(path: string): never {
  void path;
  throw new Error(formatAdminApiError(K3_RESPONSE_INVALID, K3_RESPONSE_INVALID));
}

function requiredK3Record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidK3Response(path);
  return value as Record<string, unknown>;
}

function requiredK3Array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalidK3Response(path);
  return value;
}

function requiredK3String(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) invalidK3Response(path);
  return value.trim();
}

function requiredK3DisplayText(value: unknown, path: string): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return requiredK3String(value, path);
}

function requiredK3Integer(
  value: unknown,
  path: string,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) invalidK3Response(path);
  return value;
}

function requiredK3Boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalidK3Response(path);
  return value;
}

function requiredK3RuleAction(value: unknown, path: string): RuleAction {
  const action = requiredK3String(value, path).toLowerCase();
  if (!["pass", "delay", "freeze", "manual"].includes(action)) invalidK3Response(path);
  return action as RuleAction;
}

function requiredK3RuleState(value: unknown, path: string): RuleState {
  const state = requiredK3String(value, path).toLowerCase();
  if (!["draft", "active", "paused", "archived"].includes(state)) invalidK3Response(path);
  return state as RuleState;
}

function requiredK3Page<T>(
  value: unknown,
  path: string,
  normalizeRow: (row: Record<string, unknown>, path: string) => T,
): AdminPage<T> {
  const page = requiredK3Record(value, path);
  const rawRecords = requiredK3Array(page.records, `${path}.records`);
  const total = requiredK3Integer(page.total, `${path}.total`, 0);
  const normalized: AdminPage<T> = {
    total,
    pageNum: requiredK3Integer(page.pageNum, `${path}.pageNum`, 1),
    pageSize: requiredK3Integer(page.pageSize, `${path}.pageSize`, 1, 200),
    records: rawRecords.map((item, index) =>
      normalizeRow(requiredK3Record(item, `${path}.records[${index}]`), `${path}.records[${index}]`)),
  };
  if (normalized.records.length > total) invalidK3Response(`${path}.records`);
  return normalized;
}

function normalizeK3(raw: unknown): WithdrawRuleOverview {
  const data = requiredK3Record(raw, "withdrawRules");
  const dimensions = requiredK3Array(data.dimensions, "withdrawRules.dimensions").map((item, index) => {
    const path = `withdrawRules.dimensions[${index}]`;
    const row = requiredK3Record(item, path);
    return {
      ruleKey: requiredK3String(row.ruleKey, `${path}.ruleKey`),
      ruleId: requiredK3String(row.ruleId, `${path}.ruleId`),
      name: requiredK3String(row.name, `${path}.name`),
      conditionText: requiredK3String(row.conditionText, `${path}.conditionText`),
      conditionDefault: requiredK3String(row.conditionDefault, `${path}.conditionDefault`, true),
      why: requiredK3String(row.why, `${path}.why`),
      action: requiredK3RuleAction(row.action, `${path}.action`),
      note: requiredK3String(row.note, `${path}.note`, true),
      icon: requiredK3String(row.icon, `${path}.icon`),
      priority: requiredK3Integer(row.priority, `${path}.priority`, 1, 100),
      version: requiredK3Integer(row.version, `${path}.version`, 0),
    };
  });
  const rules = requiredK3Page(data.rules, "withdrawRules.rules", (row, path): K3Rule => {
    const ruleId = requiredK3String(row.ruleId, `${path}.ruleId`);
    const dimension = requiredK3String(row.dimension, `${path}.dimension`);
    const conditionText = requiredK3String(row.conditionText, `${path}.conditionText`);
    const action = requiredK3RuleAction(row.action, `${path}.action`);
    return {
      ruleId,
      id: ruleId,
      dimension,
      dim: dimension,
      conditionText,
      cond: conditionText,
      action,
      act: action,
      state: requiredK3RuleState(row.state, `${path}.state`),
      builtIn: requiredK3Boolean(row.builtIn, `${path}.builtIn`),
      priority: requiredK3Integer(row.priority, `${path}.priority`, 1, 100),
      version: requiredK3Integer(row.version, `${path}.version`, 0),
    };
  });
  const routeCounts = requiredK3Array(data.routeCounts, "withdrawRules.routeCounts").map((item, index) => {
    const path = `withdrawRules.routeCounts[${index}]`;
    const row = requiredK3Record(item, path);
    const count = requiredK3Integer(row.count, `${path}.count`, 0);
    return {
      key: requiredK3RuleAction(row.key ?? row.routeKey, `${path}.key`),
      label: requiredK3String(row.label, `${path}.label`),
      count,
      n: count,
      color: requiredK3String(row.color, `${path}.color`),
    };
  });
  const routeTotal = requiredK3Integer(data.routeTotal, "withdrawRules.routeTotal", 0);
  if (routeCounts.reduce((sum, row) => sum + row.count, 0) !== routeTotal) {
    invalidK3Response("withdrawRules.routeTotal");
  }
  const hits = requiredK3Page(data.hits, "withdrawRules.hits", (row, path): K3Hit => ({
    withdrawalNo: requiredK3String(row.withdrawalNo, `${path}.withdrawalNo`),
    userNo: requiredK3String(row.userNo, `${path}.userNo`),
    amount: requiredK3DisplayText(row.amount ?? row.amountText, `${path}.amount`),
    ruleId: requiredK3String(row.ruleId, `${path}.ruleId`),
    dimension: requiredK3String(row.dimension, `${path}.dimension`),
    action: requiredK3RuleAction(row.action, `${path}.action`),
    reason: requiredK3String(row.reason, `${path}.reason`, true),
    timeText: requiredK3String(row.timeText, `${path}.timeText`),
  }));
  const sources = data.sources === undefined
    ? undefined
    : requiredK3Array(data.sources, "withdrawRules.sources").map((value, index) =>
      requiredK3String(value, `withdrawRules.sources[${index}]`));
  return { dimensions, rules, routeCounts, routeTotal, hits, sources };
}

const K4_RESPONSE_INVALID = "K4_RESPONSE_INVALID";

function invalidK4Response(path: string): never {
  throw new Error(formatAdminApiError(K4_RESPONSE_INVALID, K4_RESPONSE_INVALID) + ` · ${path}`);
}

function requiredK4Record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidK4Response(path);
  return value as Record<string, unknown>;
}

function requiredK4Array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalidK4Response(path);
  return value;
}

function requiredK4Number(value: unknown, path: string, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) invalidK4Response(path);
  return value;
}

function requiredK4Integer(value: unknown, path: string, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): number {
  const result = requiredK4Number(value, path, min, max);
  if (!Number.isInteger(result)) invalidK4Response(path);
  return result;
}

function requiredK4String(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) invalidK4Response(path);
  return value.trim();
}

function requiredK4Boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalidK4Response(path);
  return value;
}

function nullableK4String(value: unknown, path: string): string | null {
  if (value == null) return null;
  return requiredK4String(value, path);
}

function k4DimensionKey(value: unknown, path: string): K4DimensionKey {
  const key = requiredK4String(value, path);
  if (!K4_DIMENSION_KEYS.includes(key as K4DimensionKey)) invalidK4Response(path);
  return key as K4DimensionKey;
}

function normalizeK4NumberMap(value: unknown, path: string): Record<K4DimensionKey, number> {
  const record = requiredK4Record(value, path);
  if (Object.keys(record).length !== K4_DIMENSION_KEYS.length
      || Object.keys(record).some((key) => !K4_DIMENSION_KEYS.includes(key as K4DimensionKey))) {
    invalidK4Response(path);
  }
  return Object.fromEntries(K4_DIMENSION_KEYS.map((key) => [key, requiredK4Integer(record[key], `${path}.${key}`, 0, 100)])) as Record<K4DimensionKey, number>;
}

function normalizeK4BooleanMap(value: unknown, path: string): Record<K4DimensionKey, boolean> {
  const record = requiredK4Record(value, path);
  if (Object.keys(record).length !== K4_DIMENSION_KEYS.length
      || Object.keys(record).some((key) => !K4_DIMENSION_KEYS.includes(key as K4DimensionKey))) {
    invalidK4Response(path);
  }
  return Object.fromEntries(K4_DIMENSION_KEYS.map((key) => [key, requiredK4Boolean(record[key], `${path}.${key}`)])) as Record<K4DimensionKey, boolean>;
}

function normalizeK4ScoreMappings(value: unknown, path: string): K4ScoreMappings {
  const record = requiredK4Record(value, path);
  if (Object.keys(record).length !== K4_SCORE_MAPPING_KEYS.length
      || Object.keys(record).some((key) => !K4_SCORE_MAPPING_KEYS.includes(key as K4ScoreMappingKey))) {
    invalidK4Response(path);
  }
  const result = Object.fromEntries(K4_SCORE_MAPPING_KEYS.map((key) => {
    const [min, max] = K4_SCORE_MAPPING_BOUNDS[key];
    return [key, requiredK4Integer(record[key], `${path}.${key}`, min, max)];
  })) as K4ScoreMappings;
  const ordered = (...keys: K4ScoreMappingKey[]) => keys.every((key, index) => index === 0 || result[keys[index - 1]] <= result[key]);
  if (!(result["multiAccount.mediumMin"] < result["multiAccount.highMin"])
      || !(result["account.newDays"] < result["account.matureDays"])
      || !ordered("multiAccount.mediumScore", "multiAccount.highScore", "multiAccount.fraudScore")
      || !ordered("arbitrage.singleScore", "arbitrage.repeatScore", "arbitrage.severeScore")
      || !ordered("kyc.reviewScore", "kyc.pendingScore", "kyc.rejectedScore", "kyc.sanctionedScore")
      || !ordered("withdraw.baselineScore", "withdraw.highScore")
      || !ordered("account.middleScore", "account.newLargeScore")
      || !ordered("anomaly.lowScore", "anomaly.tamperScore")) {
    invalidK4Response(`${path}.order`);
  }
  return result;
}

function normalizeK4Model(value: unknown, path: string, expectedState?: K4ModelState): K4Model {
  const model = requiredK4Record(value, path);
  const state = requiredK4String(model.state, `${path}.state`);
  if (!(["draft", "active", "archived"] as string[]).includes(state)
      || (expectedState && state !== expectedState)) invalidK4Response(`${path}.state`);
  const weights = normalizeK4NumberMap(model.weights, `${path}.weights`);
  if (K4_DIMENSION_KEYS.reduce((total, key) => total + weights[key], 0) !== 100) invalidK4Response(`${path}.weights.total`);
  const bandLowMax = requiredK4Integer(model.bandLowMax, `${path}.bandLowMax`, 0, 99);
  const bandHighMin = requiredK4Integer(model.bandHighMin, `${path}.bandHighMin`, 1, 100);
  if (bandLowMax >= bandHighMin) invalidK4Response(`${path}.bands`);
  const autoEscalateScore = requiredK4Integer(model.autoEscalateScore, `${path}.autoEscalateScore`, 70, 100);
  if (autoEscalateScore < bandHighMin) invalidK4Response(`${path}.autoEscalateScore`);
  return {
    version: requiredK4Integer(model.version, `${path}.version`, 1),
    rowVersion: requiredK4Integer(model.rowVersion, `${path}.rowVersion`, 0),
    state: state as K4ModelState,
    weights,
    scoreMappings: normalizeK4ScoreMappings(model.scoreMappings, `${path}.scoreMappings`),
    inputSources: normalizeK4BooleanMap(model.inputSources, `${path}.inputSources`),
    bandLowMax,
    bandHighMin,
    autoEscalateScore,
    reason: requiredK4String(model.reason, `${path}.reason`),
    createdBy: requiredK4String(model.createdBy, `${path}.createdBy`),
    publishedBy: nullableK4String(model.publishedBy, `${path}.publishedBy`),
    createdAt: requiredK4String(model.createdAt, `${path}.createdAt`),
    publishedAt: nullableK4String(model.publishedAt, `${path}.publishedAt`),
  };
}

function normalizeK4Override(row: unknown, path: string): K4Override {
  const data = requiredK4Record(row, path);
  return {
    userNo: requiredK4String(data.userNo, `${path}.userNo`),
    modelScore: requiredK4Integer(data.modelScore, `${path}.modelScore`, 0, 100),
    overrideScore: requiredK4Integer(data.overrideScore, `${path}.overrideScore`, 0, 100),
    reason: requiredK4String(data.reason, `${path}.reason`),
    operator: requiredK4String(data.operator, `${path}.operator`),
    timeText: requiredK4String(data.timeText, `${path}.timeText`),
    active: requiredK4Boolean(data.active, `${path}.active`),
  };
}

function normalizeK4OverridePage(value: unknown): AdminPage<K4Override> {
  const page = requiredK4Record(value, "overrides");
  const records = requiredK4Array(page.records, "overrides.records").map((row, index) => normalizeK4Override(row, `overrides.records[${index}]`));
  const total = requiredK4Integer(page.total, "overrides.total", 0);
  if (total < records.length) invalidK4Response("overrides.total");
  return {
    total,
    pageNum: requiredK4Integer(page.pageNum, "overrides.pageNum", 1),
    pageSize: requiredK4Integer(page.pageSize, "overrides.pageSize", 1, 50),
    records,
  };
}

function normalizeK4(raw: unknown): ScoringOverview {
  const data = requiredK4Record(raw, "scoring");
  const model = normalizeK4Model(data.model, "model", "active");
  const draft = data.draft == null ? null : normalizeK4Model(data.draft, "draft", "draft");
  const modelHistory = requiredK4Array(data.modelHistory, "modelHistory")
    .map((value, index) => normalizeK4Model(value, `modelHistory[${index}]`));
  const seen = new Set<K4DimensionKey>();
  const dimensions = requiredK4Array(data.dimensions, "dimensions").map((value, index) => {
    const row = requiredK4Record(value, `dimensions[${index}]`);
    const dimKey = k4DimensionKey(row.dimKey, `dimensions[${index}].dimKey`);
    if (seen.has(dimKey)) invalidK4Response(`dimensions[${index}].dimKey`);
    seen.add(dimKey);
    const weightPct = requiredK4Integer(row.weightPct, `dimensions[${index}].weightPct`, 0, 100);
    if (weightPct !== model.weights[dimKey]) invalidK4Response(`dimensions[${index}].weightPct`);
    return {
      dimKey,
      name: requiredK4String(row.name, `dimensions[${index}].name`),
      source: requiredK4String(row.source, `dimensions[${index}].source`),
      weightPct,
    };
  });
  if (dimensions.length !== K4_DIMENSION_KEYS.length || K4_DIMENSION_KEYS.some((key) => !seen.has(key))) invalidK4Response("dimensions");
  const distribution = requiredK4Array(data.distribution, "distribution").map((value, index) => {
    const row = requiredK4Record(value, `distribution[${index}]`);
    return {
      band: requiredK4String(row.band, `distribution[${index}].band`),
      rangeText: requiredK4String(row.rangeText, `distribution[${index}].rangeText`),
      count: requiredK4Integer(row.count, `distribution[${index}].count`, 0),
      percentage: requiredK4Number(row.percentage, `distribution[${index}].percentage`, 0, 100),
      color: requiredK4String(row.color, `distribution[${index}].color`),
      tone: requiredK4String(row.tone, `distribution[${index}].tone`),
    };
  });
  const totalUsers = requiredK4Integer(data.totalUsers, "totalUsers", 0);
  const recomputePending = requiredK4Integer(data.recomputePending, "recomputePending", 0, totalUsers);
  if (distribution.reduce((total, row) => total + row.count, 0) !== totalUsers) invalidK4Response("totalUsers");
  const overrides = normalizeK4OverridePage(data.overrides);
  const overrideActive = requiredK4Integer(data.overrideActive, "overrideActive", 0);
  if (overrideActive > overrides.total) invalidK4Response("overrideActive");
  return {
    model,
    draft,
    modelHistory,
    dimensions,
    config: {
      inputSources: model.inputSources,
      bandLowMax: model.bandLowMax,
      bandHighMin: model.bandHighMin,
      autoEscalateScore: model.autoEscalateScore,
    },
    distribution,
    totalUsers,
    recomputePending,
    overrides,
    overrideActive,
  };
}

function normalizeK4Contributions(value: unknown, path: string, modelScore: number): K4Contribution[] {
  const contributionKeys = new Set<K4DimensionKey>();
  const contributions = requiredK4Array(value, path).map((item, index) => {
    const row = requiredK4Record(item, `${path}[${index}]`);
    const dimKey = k4DimensionKey(row.dimKey, `${path}[${index}].dimKey`);
    if (contributionKeys.has(dimKey)) invalidK4Response(`${path}[${index}].dimKey`);
    contributionKeys.add(dimKey);
    return {
      dimKey,
      name: requiredK4String(row.name, `${path}[${index}].name`),
      evidence: typeof row.evidence === "string" ? row.evidence.trim() : invalidK4Response(`${path}[${index}].evidence`),
      hit: requiredK4Boolean(row.hit, `${path}[${index}].hit`),
      subScore: requiredK4Integer(row.subScore, `${path}[${index}].subScore`, 0, 100),
      weightPct: requiredK4Integer(row.weightPct, `${path}[${index}].weightPct`, 0, 100),
      points: requiredK4Integer(row.points, `${path}[${index}].points`, 0, 100),
    };
  });
  if (contributions.length !== K4_DIMENSION_KEYS.length
      || K4_DIMENSION_KEYS.some((key) => !contributionKeys.has(key))
      || contributions.reduce((total, row) => total + row.points, 0) !== modelScore) {
    invalidK4Response(path);
  }
  return contributions;
}

function normalizeK4User(raw: unknown): K4User {
  const data = requiredK4Record(raw, "scoreUser");
  const modelScore = requiredK4Integer(data.modelScore, "scoreUser.modelScore", 0, 100);
  const effectiveScore = requiredK4Integer(data.effectiveScore, "scoreUser.effectiveScore", 0, 100);
  const contributions = normalizeK4Contributions(data.contributions, "scoreUser.contributions", modelScore);
  const history = requiredK4Array(data.history, "scoreUser.history").map((item, index) => {
    const row = requiredK4Record(item, `scoreUser.history[${index}]`);
    const historyModelScore = requiredK4Integer(row.modelScore, `scoreUser.history[${index}].modelScore`, 0, 100);
    return {
      modelVersion: requiredK4Integer(row.modelVersion, `scoreUser.history[${index}].modelVersion`, 1),
      modelScore: historyModelScore,
      effectiveScore: requiredK4Integer(row.effectiveScore, `scoreUser.history[${index}].effectiveScore`, 0, 100),
      scoreState: requiredK4String(row.scoreState, `scoreUser.history[${index}].scoreState`),
      contributions: normalizeK4Contributions(row.contributions, `scoreUser.history[${index}].contributions`, historyModelScore),
      reason: requiredK4String(row.reason, `scoreUser.history[${index}].reason`),
      operator: requiredK4String(row.operator, `scoreUser.history[${index}].operator`),
      createdAt: requiredK4String(row.createdAt, `scoreUser.history[${index}].createdAt`),
    };
  });
  return {
    userNo: requiredK4String(data.userNo, "scoreUser.userNo"),
    modelScore,
    effectiveScore,
    overridden: requiredK4Boolean(data.overridden, "scoreUser.overridden"),
    bandLabel: requiredK4String(data.bandLabel, "scoreUser.bandLabel"),
    bandTone: requiredK4String(data.bandTone, "scoreUser.bandTone"),
    modelVersion: requiredK4String(data.modelVersion, "scoreUser.modelVersion"),
    updatedText: requiredK4String(data.updatedText, "scoreUser.updatedText"),
    rowVersion: requiredK4Integer(data.rowVersion, "scoreUser.rowVersion", 0),
    asOf: requiredK4String(data.asOf, "scoreUser.asOf"),
    contributions,
    history,
  };
}

function normalizeK4UserOption(raw: Record<string, unknown>): K4UserOption {
  const userNo = requiredK4String(raw.userNo, "scoreUserOption.userNo");
  return {
    userNo,
    label: requiredK4String(raw.label, "scoreUserOption.label"),
    sub: requiredK4String(raw.sub, "scoreUserOption.sub"),
    modelScore: requiredK4Integer(raw.modelScore, "scoreUserOption.modelScore", 0, 100),
    effectiveScore: requiredK4Integer(raw.effectiveScore, "scoreUserOption.effectiveScore", 0, 100),
    bandLabel: requiredK4String(raw.bandLabel, "scoreUserOption.bandLabel"),
    bandTone: requiredK4String(raw.bandTone, "scoreUserOption.bandTone"),
    overridden: requiredK4Boolean(raw.overridden, "scoreUserOption.overridden"),
  };
}

const K5_RESPONSE_INVALID = "K5_RESPONSE_INVALID";

function invalidK5Response(path: string): never {
  console.error("K5 response validation failed", path);
  throw new Error(formatAdminApiError(K5_RESPONSE_INVALID, K5_RESPONSE_INVALID));
}

function requiredK5Record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidK5Response(path);
  return value as Record<string, unknown>;
}

function requiredK5Array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalidK5Response(path);
  return value;
}

function requiredK5String(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) invalidK5Response(path);
  return value.trim();
}

function requiredK5Number(value: unknown, path: string, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) invalidK5Response(path);
  return value;
}

function requiredK5Integer(value: unknown, path: string, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): number {
  const result = requiredK5Number(value, path, min, max);
  if (!Number.isInteger(result)) invalidK5Response(path);
  return result;
}

function requiredK5Boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalidK5Response(path);
  return value;
}

function requiredK5JsonRows(value: unknown, path: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") invalidK5Response(path);
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) invalidK5Response(path);
    return parsed;
  } catch {
    return invalidK5Response(path);
  }
}

function requiredK5StringArray(value: unknown, path: string): string[] {
  return requiredK5Array(value, path).map((item, index) => requiredK5String(item, `${path}[${index}]`));
}

function normalizeK5Ticket(value: unknown, path: string): K5Ticket {
  const row = requiredK5Record(value, path);
  const ticketType = requiredK5String(row.type, `${path}.type`) as K5TicketType;
  if (!K5_TICKET_TYPES.includes(ticketType)) invalidK5Response(`${path}.type`);
  const status = requiredK5String(row.st, `${path}.st`) as TicketSt;
  if (!["triggered", "in-review", "overdue", "passed", "rejected"].includes(status)) invalidK5Response(`${path}.st`);
  const kyc = requiredK5String(row.kyc, `${path}.kyc`) as K5KycStatus;
  if (!K5_KYC_STATUSES.includes(kyc)) invalidK5Response(`${path}.kyc`);
  const info = requiredK5JsonRows(row.infoJson, `${path}.infoJson`).map((item, index) => {
    const tuple = requiredK5Array(item, `${path}.infoJson[${index}]`);
    if (tuple.length < 2) invalidK5Response(`${path}.infoJson[${index}]`);
    return [requiredK5String(tuple[0], `${path}.infoJson[${index}][0]`), requiredK5String(tuple[1], `${path}.infoJson[${index}][1]`)] as [string, string];
  });
  const hist = requiredK5JsonRows(row.histJson, `${path}.histJson`).map((item, index) => {
    const tuple = requiredK5Array(item, `${path}.histJson[${index}]`);
    if (tuple.length < 3) invalidK5Response(`${path}.histJson[${index}]`);
    const tone = requiredK5String(tuple[2], `${path}.histJson[${index}][2]`, true);
    if (!["", "warn", "bad"].includes(tone)) invalidK5Response(`${path}.histJson[${index}][2]`);
    return [
      requiredK5String(tuple[0], `${path}.histJson[${index}][0]`),
      requiredK5String(tuple[1], `${path}.histJson[${index}][1]`),
      tone as "" | "warn" | "bad",
    ] as [string, string, "" | "warn" | "bad"];
  });
  return {
    id: requiredK5String(row.id, `${path}.id`),
    type: ticketType,
    user: requiredK5String(row.user, `${path}.user`),
    amt: requiredK5String(row.amt, `${path}.amt`),
    cum: requiredK5String(row.cum, `${path}.cum`),
    kyc,
    st: status,
    version: requiredK5Integer(row.version, `${path}.version`, 0),
    slaPct: requiredK5Number(row.slaPct, `${path}.slaPct`, 0, 1),
    slaTxt: requiredK5String(row.slaTxt, `${path}.slaTxt`),
    info,
    hist,
  };
}

function normalizeK5(raw: unknown): KycReviewOverview {
  const data = requiredK5Record(raw, "kycReview");
  const statsRow = requiredK5Record(data.stats, "kycReview.stats");
  const stats: KycReviewOverview["stats"] = {
    openTickets: requiredK5Number(statsRow.openTickets, "kycReview.stats.openTickets", 0),
    reviewOverdue: requiredK5Number(statsRow.reviewOverdue, "kycReview.stats.reviewOverdue", 0),
    reviewDecidedMonth: requiredK5Number(statsRow.reviewDecidedMonth, "kycReview.stats.reviewDecidedMonth", 0),
    reviewDecidedPass: requiredK5Number(statsRow.reviewDecidedPass, "kycReview.stats.reviewDecidedPass", 0),
    reviewFrozenUsd: requiredK5Number(statsRow.reviewFrozenUsd, "kycReview.stats.reviewFrozenUsd", 0),
  };
  if (!validateK5Stats(stats)) {
    invalidK5Response("kycReview.stats");
  }

  const params = requiredK5Array(data.params, "kycReview.params").map((item, index) => {
    const row = requiredK5Record(item, `kycReview.params[${index}]`);
    const key = requiredK5String(row.key, `kycReview.params[${index}].key`);
    if (!K5_PARAM_KEYS.includes(key as (typeof K5_PARAM_KEYS)[number])) invalidK5Response(`kycReview.params[${index}].key`);
    const value = requiredK5String(row.value, `kycReview.params[${index}].value`);
    if (!validateK5ParamValue(key, value)) invalidK5Response(`kycReview.params[${index}].value`);
    return {
      key,
      name: requiredK5String(row.name, `kycReview.params[${index}].name`),
      value,
      val: value,
      version: requiredK5Integer(row.version, `kycReview.params[${index}].version`, 0),
      adjustable: requiredK5Boolean(row.adjustable, `kycReview.params[${index}].adjustable`),
      unit: typeof row.unit === "string" ? row.unit.trim() : undefined,
      sub: requiredK5String(row.sub, `kycReview.params[${index}].sub`),
      note: requiredK5String(row.note, `kycReview.params[${index}].note`),
    };
  });
  if (params.length !== K5_PARAM_KEYS.length || new Set(params.map((row) => row.key)).size !== K5_PARAM_KEYS.length) {
    invalidK5Response("kycReview.params");
  }

  const ticketPage = requiredK5Record(data.tickets, "kycReview.tickets");
  const ticketRecords = requiredK5Array(ticketPage.records, "kycReview.tickets.records")
    .map((item, index) => normalizeK5Ticket(item, `kycReview.tickets.records[${index}]`));
  const tickets: AdminPage<K5Ticket> = {
    total: requiredK5Integer(ticketPage.total, "kycReview.tickets.total", 0),
    pageNum: requiredK5Integer(ticketPage.pageNum, "kycReview.tickets.pageNum", 1),
    pageSize: requiredK5Integer(ticketPage.pageSize, "kycReview.tickets.pageSize", 1, 50),
    records: ticketRecords,
  };
  if (tickets.records.length > tickets.total) invalidK5Response("kycReview.tickets.records");

  const alerts = requiredK5Array(data.alerts, "kycReview.alerts").map((item, index) => {
    const row = requiredK5Record(item, `kycReview.alerts[${index}]`);
    const eventKey = requiredK5String(row.eventKey, `kycReview.alerts[${index}].eventKey`);
    if (!hasAllowedK5AlertEventKey(eventKey)) invalidK5Response(`kycReview.alerts[${index}].eventKey`);
    const tone = requiredK5String(row.tone, `kycReview.alerts[${index}].tone`);
    if (!K5_ALERT_TONES.includes(tone as (typeof K5_ALERT_TONES)[number])) invalidK5Response(`kycReview.alerts[${index}].tone`);
    return {
      eventKey,
      tone: tone as K5Alert["tone"],
      title: requiredK5String(row.title, `kycReview.alerts[${index}].title`),
      body: requiredK5String(row.body, `kycReview.alerts[${index}].body`),
      timeText: requiredK5String(row.timeText, `kycReview.alerts[${index}].timeText`),
    };
  });
  const subscriptionRow = requiredK5Record(data.subscription, "kycReview.subscription");
  const subscription: K5AlertSubscription = {
    alertTypes: requiredK5StringArray(subscriptionRow.alertTypes, "kycReview.subscription.alertTypes"),
    channels: requiredK5StringArray(subscriptionRow.channels, "kycReview.subscription.channels"),
    version: requiredK5Integer(subscriptionRow.version, "kycReview.subscription.version", 0),
  };
  if (!hasExactAllowedValues(subscription.alertTypes, K5_ALERT_TYPES)) {
    invalidK5Response("kycReview.subscription.alertTypes");
  }
  if (!hasExactAllowedValues(subscription.channels, K5_ALERT_CHANNELS)) {
    invalidK5Response("kycReview.subscription.channels");
  }
  return { stats, params, tickets, alerts, subscription, sources: requiredK5StringArray(data.sources, "kycReview.sources") };
}

function normalizeK5UserOption(value: unknown, path: string): K5UserOption {
  const row = requiredK5Record(value, path);
  const kycStatus = requiredK5String(row.kycStatus, `${path}.kycStatus`) as K5KycStatus;
  if (!K5_KYC_STATUSES.includes(kycStatus)) invalidK5Response(`${path}.kycStatus`);
  return {
    userNo: requiredK5String(row.userNo, `${path}.userNo`),
    label: requiredK5String(row.label, `${path}.label`),
    sub: requiredK5String(row.sub, `${path}.sub`),
    kycStatus,
  };
}

function normalizeK5ManualResult(value: unknown): K5ManualResult {
  const data = requiredK5Record(value, "kycReview");
  const result = requiredK5Record(data.manualResult, "kycReview.manualResult");
  return {
    ticketId: requiredK5String(result.ticketId, "kycReview.manualResult.ticketId"),
    userNo: requiredK5String(result.userNo, "kycReview.manualResult.userNo"),
    merged: requiredK5Boolean(result.merged, "kycReview.manualResult.merged"),
  };
}

function normalizeK5ManualResultForWrite(value: unknown, commandKey: string): K5ManualResult {
  try {
    return normalizeK5ManualResult(value);
  } catch (error) {
    throw new K1OutcomeUncertainError(
      error instanceof Error ? error.message : "K5_MANUAL_RESULT_INVALID",
      commandKey,
    );
  }
}

export async function fetchK1MultiAccountOverview(query: K1PaginationQuery = {}): Promise<MultiAccountOverview> {
  const clusterLayer = query.clusterLayer && query.clusterLayer !== "all" ? query.clusterLayer : undefined;
  const clusterStatus = query.clusterStatus && query.clusterStatus !== "all" ? query.clusterStatus : undefined;
  return apiRequest(`/multi-account/overview${queryString({
    clusterPageNum: query.clusterPageNum ?? 1,
    clusterPageSize: query.clusterPageSize ?? 5,
    clusterLayer,
    clusterStatus,
    clusterSort: query.clusterSort ?? "strength_desc",
    whitelistPageNum: query.whitelistPageNum ?? 1,
    whitelistPageSize: query.whitelistPageSize ?? 5,
  })}`).then(normalizeK1);
}

export async function fetchKRiskOverviews(query: KRiskOverviewQuery = {}): Promise<KRiskData> {
  const withdrawRulesQuery = query.withdrawRules ?? {};
  const scoringQuery = query.scoring ?? {};
  const kycReviewQuery = query.kycReview ?? {};
  const [multiAccount, arbitrage, withdrawRules, scoring, kycReview] = await Promise.all([
    fetchK1MultiAccountOverview(query.multiAccount),
    apiRequest("/arbitrage/overview").then(normalizeK2),
    apiRequest(`/withdraw-rules/overview${queryString({
      rulePageNum: withdrawRulesQuery.rulePageNum ?? 1,
      rulePageSize: withdrawRulesQuery.rulePageSize ?? 5,
      hitPageNum: withdrawRulesQuery.hitPageNum ?? 1,
      hitPageSize: withdrawRulesQuery.hitPageSize ?? 5,
      hitAction: withdrawRulesQuery.hitAction ?? "all",
    })}`).then(normalizeK3),
    fetchK4ScoringOverview(scoringQuery),
    apiRequest(`/kyc-review/overview${queryString({
      ticketPageNum: kycReviewQuery.ticketPageNum ?? 1,
      ticketPageSize: kycReviewQuery.ticketPageSize ?? 5,
      ticketFilter: kycReviewQuery.ticketFilter,
    })}`).then(normalizeK5),
  ]);
  return { multiAccount, arbitrage, withdrawRules, scoring, kycReview };
}

function normalizeK3DryRun(raw: unknown): K3DryRunResult {
  const data = requiredK3Record(raw, "withdrawRules.dryRun");
  const rawHitCounts = requiredK3Record(data.hitCountsByRule, "withdrawRules.dryRun.hitCountsByRule");
  const routeCounts = requiredK3Array(data.routeCounts, "withdrawRules.dryRun.routeCounts").map((item, index) => {
    const path = `withdrawRules.dryRun.routeCounts[${index}]`;
    const row = requiredK3Record(item, path);
    const count = requiredK3Integer(row.count, `${path}.count`, 0);
    return {
      key: requiredK3RuleAction(row.key ?? row.routeKey, `${path}.key`),
      label: requiredK3String(row.label, `${path}.label`),
      count,
      n: count,
      color: requiredK3String(row.color, `${path}.color`),
    };
  });
  return {
    batchNo: requiredK3String(data.batchNo, "withdrawRules.dryRun.batchNo"),
    status: requiredK3String(data.status, "withdrawRules.dryRun.status"),
    sampleWindowDays: requiredK3Integer(data.sampleWindowDays, "withdrawRules.dryRun.sampleWindowDays", 1),
    evaluatedWithdrawals: requiredK3Integer(data.evaluatedWithdrawals, "withdrawRules.dryRun.evaluatedWithdrawals", 0),
    activeRules: requiredK3Integer(data.activeRules, "withdrawRules.dryRun.activeRules", 0),
    hitCount: requiredK3Integer(data.hitCount, "withdrawRules.dryRun.hitCount", 0),
    hitCountsByRule: Object.fromEntries(Object.entries(rawHitCounts).map(([key, value]) => [
      key,
      requiredK3Integer(value, `withdrawRules.dryRun.hitCountsByRule.${key}`, 0),
    ])),
    routeCounts,
    completedAt: requiredK3String(data.completedAt, "withdrawRules.dryRun.completedAt"),
  };
}

function normalizeK3DryRunForWrite(raw: unknown, commandKey: string): K3DryRunResult {
  try {
    return normalizeK3DryRun(raw);
  } catch (error) {
    throw new K1OutcomeUncertainError(
      error instanceof Error ? error.message : "K3_DRY_RUN_RESULT_INVALID",
      commandKey,
    );
  }
}

export async function fetchK2ArbitrageOverview(): Promise<ArbitrageOverview> {
  return apiRequest("/arbitrage/overview").then(normalizeK2);
}

export async function fetchK3WithdrawRuleOverview(query: K3PaginationQuery = {}): Promise<WithdrawRuleOverview> {
  return apiRequest(`/withdraw-rules/overview${queryString({
    rulePageNum: query.rulePageNum ?? 1,
    rulePageSize: query.rulePageSize ?? 5,
    hitPageNum: query.hitPageNum ?? 1,
    hitPageSize: query.hitPageSize ?? 5,
    hitAction: query.hitAction ?? "all",
  })}`).then(normalizeK3);
}

export async function fetchK4ScoringOverview(query: K4PaginationQuery = {}): Promise<ScoringOverview> {
  return apiRequest(`/scoring/overview${queryString({
    overridePageNum: query.overridePageNum ?? 1,
    overridePageSize: query.overridePageSize ?? 5,
  })}`).then(normalizeK4);
}

export async function fetchK4WithdrawalAlerts(): Promise<K4WithdrawalAlertOverview> {
  return apiRequest("/scoring/withdrawal-alerts");
}

export async function markK4WithdrawalAlertRead(eventId: string): Promise<void> {
  await apiRequest(`/scoring/withdrawal-alerts/${encodeURIComponent(eventId)}/read`, { method: "POST" });
}

export async function fetchK5KycReviewOverview(query: K5PaginationQuery = {}): Promise<KycReviewOverview> {
  return apiRequest(`/kyc-review/overview${queryString({
    ticketPageNum: query.ticketPageNum ?? 1,
    ticketPageSize: query.ticketPageSize ?? 5,
    ticketFilter: query.ticketFilter,
  })}`).then(normalizeK5);
}

const k2ActionMap: Record<string, string> = {
  flag: "mark",
  mark: "mark",
  blockgift: "block-gift",
  "block-gift": "block-gift",
  boardflag: "board-flag",
  "board-flag": "board-flag",
  freeze: "freeze-cluster",
  "freeze-cluster": "freeze-cluster",
};

export const kRiskActions: Omit<KRiskActions, "reloadKRisk"> = {
  updateK1Param: (key, value, reason, commandKey) => apiRequest(`/multi-account/params/${encodeURIComponent(key)}`, { method: "PATCH", commandKey, body: JSON.stringify(withReason({ value }, reason)) }).then(() => undefined),
  updateK1ReleaseParam: (key, value, reason, commandKey) => apiRequest(`/multi-account/release-params/${encodeURIComponent(key)}`, { method: "PATCH", commandKey, body: JSON.stringify(withReason({ value }, reason)) }).then(() => undefined),
  updateK1ClusterStatus: (clusterId, status, expectedVersion, reason, commandKey) => apiRequest(`/multi-account/clusters/${encodeURIComponent(clusterId)}/status`, { method: "PATCH", commandKey, body: JSON.stringify(withReason({ status, expectedVersion }, reason)) }).then(() => undefined),
  updateK1ClusterReviewNote: (clusterId, expectedVersion, reason, commandKey) => apiRequest(`/multi-account/clusters/${encodeURIComponent(clusterId)}/review-note`, { method: "PATCH", commandKey, body: JSON.stringify(withReason({ expectedVersion }, reason)) }).then(() => undefined),
  upsertK1Whitelist: (cidr, note, reason, expireText, commandKey) => apiRequest("/multi-account/whitelist", { method: "POST", commandKey, body: JSON.stringify(withReason({ cidr, note, expireText }, reason)) }).then(() => undefined),
  disableK1Whitelist: (cidr, reason, commandKey) => apiRequest("/multi-account/whitelist", { method: "PATCH", commandKey, body: JSON.stringify(withReason({ cidr }, reason)) }).then(() => undefined),
  updateK2Param: (key, value, expectedVersion, reason, commandKey) => apiRequest(`/arbitrage/params/${encodeURIComponent(key)}`, { method: "PATCH", commandKey, body: JSON.stringify(withReason({ value, expectedVersion }, reason)) }).then(() => undefined),
  executeK2Action: (rowId, action, expectedVersion, clusterExpectedVersion, reason, commandKey) => {
    const mapped = k2ActionMap[action] || action;
    return apiRequest(`/arbitrage/rows/${encodeURIComponent(rowId)}/${encodeURIComponent(mapped)}`, {
      method: "POST",
      commandKey,
      body: JSON.stringify(withReason({ expectedVersion, clusterExpectedVersion }, reason)),
    }).then(() => undefined);
  },
  createK3Rule: (dimension, conditionText, action, priority, reason, commandKey) => apiRequest("/withdraw-rules", { method: "POST", commandKey, body: JSON.stringify(withReason({ dimension, conditionText, action, priority }, reason)) }).then(() => undefined),
  updateK3RuleState: (ruleId, state, expectedVersion, reason, commandKey) => apiRequest(`/withdraw-rules/${encodeURIComponent(ruleId)}/status`, { method: "PATCH", commandKey, body: JSON.stringify(withReason({ state, expectedVersion }, reason)) }).then(() => undefined),
  updateK3Rule: (ruleId, conditionText, action, priority, expectedVersion, reason, commandKey) => apiRequest(`/withdraw-rules/${encodeURIComponent(ruleId)}/condition`, { method: "PATCH", commandKey, body: JSON.stringify(withReason({ conditionText, action, priority, expectedVersion }, reason)) }).then(() => undefined),
  archiveK3Rule: (ruleId, expectedVersion, reason, commandKey) => apiRequest(`/withdraw-rules/${encodeURIComponent(ruleId)}/status`, { method: "PATCH", commandKey, body: JSON.stringify(withReason({ state: "archived", expectedVersion }, reason)) }).then(() => undefined),
  dryRunK3: async (reason, commandKey) => {
    const stableCommandKey = commandKey ?? newK1CommandKey();
    const value = await apiRequest("/withdraw-rules/dry-runs", {
      method: "POST",
      commandKey: stableCommandKey,
      body: JSON.stringify(withReason({}, reason)),
    });
    return normalizeK3DryRunForWrite(value, stableCommandKey);
  },
  saveK4ModelDraft: (input, reason, commandKey) => apiRequest("/scoring/model/draft", {
    method: "PUT",
    commandKey,
    body: JSON.stringify(withReason({
      ...input,
      weights: Object.fromEntries(K4_DIMENSION_KEYS.map((key) => [key, input.weights[key] / 100])),
    }, reason)),
  }).then(() => undefined),
  publishK4ModelDraft: (expectedVersion, reason, commandKey) => apiRequest("/scoring/model/publish", {
    method: "POST",
    commandKey,
    body: JSON.stringify(withReason({ expectedVersion }, reason)),
  }).then(() => undefined),
  restoreK4ModelDraft: (modelVersion, expectedVersion, reason, commandKey) => apiRequest("/scoring/model/restore-draft", {
    method: "POST",
    commandKey,
    body: JSON.stringify(withReason({ modelVersion, expectedVersion }, reason)),
  }).then(() => undefined),
  searchK4Users: (keyword) => apiRequest(`/scoring/users${queryString({ keyword: keyword.trim(), limit: 8 })}`).then((raw) => requiredK4Array(raw, "scoreUserOptions").map((row, index) => normalizeK4UserOption(requiredK4Record(row, `scoreUserOptions[${index}]`)))),
  fetchK4User: (userNo) => apiRequest(`/scoring/users/${encodeURIComponent(userNo)}`).then(normalizeK4User),
  overrideK4Score: (userNo, score, expectedVersion, reason, commandKey) => apiRequest(`/scoring/users/${encodeURIComponent(userNo)}/override`, {
    method: "POST",
    commandKey,
    body: JSON.stringify(withReason({ score, expectedVersion }, reason)),
  }).then(() => undefined),
  recomputeK4Score: (userNo, expectedVersion, reason, commandKey) => apiRequest(`/scoring/users/${encodeURIComponent(userNo)}/recompute`, {
    method: "POST",
    commandKey,
    body: JSON.stringify(withReason({ expectedVersion }, reason)),
  }).then(() => undefined),
  recomputeK4Scores: (userNos, expectedModelVersion, reason, commandKey) => apiRequest("/scoring/users/recompute", {
    method: "POST",
    commandKey,
    body: JSON.stringify(withReason({ userNos, expectedModelVersion }, reason)),
  }).then(() => undefined),
  updateK5Param: (key, value, expectedVersion, reason, commandKey) => apiRequest(`/kyc-review/params/${encodeURIComponent(key)}`, { method: "PATCH", commandKey, body: JSON.stringify(withReason({ value, expectedVersion }, reason)) }).then(() => undefined),
  decideK5Ticket: (ticketId, decision, expectedVersion, reasonCode, reason, commandKey) => apiRequest(`/kyc-review/tickets/${encodeURIComponent(ticketId)}/decision`, { method: "POST", commandKey, body: JSON.stringify(withReason({ decision, expectedVersion, reasonCode }, reason)) }).then(() => undefined),
  createK5ManualTicket: (userNo, reason, commandKey) => {
    const stableCommandKey = commandKey ?? newK1CommandKey();
    return apiRequest<unknown>("/kyc-review/tickets/manual", {
      method: "POST",
      commandKey: stableCommandKey,
      body: JSON.stringify(withReason({ userNo }, reason)),
    }).then((value) => normalizeK5ManualResultForWrite(value, stableCommandKey));
  },
  updateK5AlertSubscription: (alertTypes, channels, expectedVersion, reason, commandKey) => apiRequest("/kyc-review/subscription", { method: "PATCH", commandKey, body: JSON.stringify(withReason({ alertTypes, channels, expectedVersion }, reason)) }).then(() => undefined),
  searchK5Users: (keyword) => apiRequest(`/kyc-review/users${queryString({ keyword: keyword.trim(), limit: 8 })}`).then((raw) => requiredK5Array(raw, "kycReview.userOptions").map((item, index) => normalizeK5UserOption(item, `kycReview.userOptions[${index}]`))),
};
