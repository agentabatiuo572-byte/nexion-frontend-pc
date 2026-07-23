import { formatAdminApiError } from "@/lib/admin/error-messages";
import { currentAdminOperator } from "@/lib/admin/current-operator";
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
  stats: Record<string, unknown>;
  params: KRiskParam[];
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

function normalizeK1(raw: unknown): MultiAccountOverview {
  const data = rec(raw);
  return {
    stats: rec(data.stats),
    params: rows<Record<string, unknown>>(data.params).map(normalizeParam),
    clusters: normalizePage(data.clusters, (row) => ({
      id: str(row.id),
      key: str(row.key),
      layer: str(row.layer, "ip"),
      layerLabel: str(row.layerLabel, str(row.layer)),
      n: num(row.n),
      strength: num(row.strength),
      span: str(row.span),
      status: normalizeClusterStatus(row.status),
      note: str(row.note),
      gifts: parseJsonRows(row.giftsJson).map((item) => {
        const tuple = rows<unknown>(item);
        return [str(tuple[0]), str(tuple[1]), str(tuple[2])] as K1Gift;
      }),
      nodes: parseJsonRows(row.nodesJson).map((item) => {
        const object = rec(item);
        if (!Array.isArray(item) && Object.keys(object).length) {
          const giftState = object.gotWelcomeGift == null ? "—" : bool(object.gotWelcomeGift) ? "是" : "否";
          return [str(object.userNo), str(object.joinedAt), str(object.sponsorUserNo, "—"), giftState, str(object.depositCumulativeUsdt, "—"), str(object.accountStatus, "UNKNOWN")] as K1Node;
        }
        const tuple = rows<unknown>(item);
        return [str(tuple[0]), str(tuple[1]), str(tuple[2], "—"), str(tuple[3], "—"), str(tuple[4], "—"), str(tuple[5], "UNKNOWN")] as K1Node;
      }),
      edges: parseJsonRows(row.edgesJson).map((item) => {
        const object = rec(item);
        if (!Array.isArray(item) && Object.keys(object).length) return [str(object.from), str(object.to), str(object.layer), num(object.weight)] as K1Edge;
        const tuple = rows<unknown>(item);
        return [str(tuple[0]), str(tuple[1]), str(tuple[2]), num(tuple[3])] as K1Edge;
      }).filter((edge) => edge[0] && edge[1]),
      reviewNote: str(row.reviewNote),
      version: num(row.version),
    })),
    whitelist: normalizePage(data.whitelist, (row) => ({
      cidr: str(row.cidr),
      note: str(row.note),
      operator: str(row.operator),
      expireText: str(row.expireText),
      active: bool(row.active, true),
    })),
    sources: strArray(data.sources),
  };
}

function normalizeK2(raw: unknown): ArbitrageOverview {
  const data = rec(raw);
  return {
    stats: rows<Record<string, unknown>>(data.stats).map((row) => ({
      key: str(row.key),
      name: str(row.name),
      value: str(row.value),
      sub: str(row.sub),
      tone: str(row.tone),
    })),
    params: rows<Record<string, unknown>>(data.params).map(normalizeParam),
    views: rows<Record<string, unknown>>(data.views).map((view) => ({
      key: str(view.key),
      label: str(view.label),
      sub: str(view.sub),
      head: strArray(view.head),
      note: str(view.note),
      rows: rows<Record<string, unknown>>(view.rows).map((row) => {
        const rowId = str(row.rowId, str(row.rid));
        const clusterId = str(row.clusterId, str(row.cluster));
        const actions = strArray(row.actions ?? row.acts);
        const level = num(row.level, num(row.lvl));
        return {
          rowId,
          rid: rowId,
          viewKey: str(row.viewKey, str(view.key)),
          clusterId,
          cluster: clusterId || undefined,
          cells: strArray(row.cells),
          level,
          lvl: level,
          actions,
          acts: actions,
          disposition: row.disposition == null ? null : str(row.disposition),
          version: num(row.version),
          clusterStatus: str(row.clusterStatus) || undefined,
          clusterVersion: row.clusterVersion == null ? undefined : num(row.clusterVersion),
        };
      }),
    })),
    sources: strArray(data.sources),
  };
}

function normalizeK3(raw: unknown): WithdrawRuleOverview {
  const data = rec(raw);
  const normalizeRule = (row: Record<string, unknown>): K3Rule => ({
    ruleId: str(row.ruleId),
    id: str(row.ruleId),
    dimension: str(row.dimension),
    dim: str(row.dimension),
    conditionText: str(row.conditionText),
    cond: str(row.conditionText),
    action: normalizeRuleAction(row.action),
    act: normalizeRuleAction(row.action),
    state: normalizeRuleState(row.state),
    builtIn: bool(row.builtIn),
    priority: num(row.priority),
    version: num(row.version),
  });
  const normalizeHit = (row: Record<string, unknown>): K3Hit => ({
    withdrawalNo: str(row.withdrawalNo),
    userNo: str(row.userNo),
    amount: str(row.amount, str(row.amountText)),
    ruleId: str(row.ruleId),
    dimension: str(row.dimension),
    action: normalizeRuleAction(row.action),
    reason: str(row.reason),
    timeText: str(row.timeText),
  });
  return {
    dimensions: rows<Record<string, unknown>>(data.dimensions).map((row) => ({
      ruleKey: str(row.ruleKey),
      ruleId: str(row.ruleId),
      name: str(row.name),
      conditionText: str(row.conditionText),
      conditionDefault: str(row.conditionDefault),
      why: str(row.why),
      action: normalizeRuleAction(row.action),
      note: str(row.note),
      icon: str(row.icon),
      priority: row.priority == null ? undefined : num(row.priority),
      version: row.version == null ? undefined : num(row.version),
    })),
    rules: normalizePage(data.rules, normalizeRule, 1, 5),
    routeCounts: rows<Record<string, unknown>>(data.routeCounts).map((row) => ({
      key: normalizeRuleAction(row.key ?? row.routeKey),
      label: str(row.label),
      count: num(row.count),
      n: num(row.count),
      color: str(row.color),
    })),
    routeTotal: num(data.routeTotal),
    hits: normalizePage(data.hits, normalizeHit, 1, 5),
    sources: strArray(data.sources),
  };
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
  return {
    version: requiredK4Integer(model.version, `${path}.version`, 1),
    rowVersion: requiredK4Integer(model.rowVersion, `${path}.rowVersion`, 0),
    state: state as K4ModelState,
    weights,
    scoreMappings: normalizeK4ScoreMappings(model.scoreMappings, `${path}.scoreMappings`),
    inputSources: normalizeK4BooleanMap(model.inputSources, `${path}.inputSources`),
    bandLowMax,
    bandHighMin,
    autoEscalateScore: requiredK4Integer(model.autoEscalateScore, `${path}.autoEscalateScore`, 70, 100),
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
  const data = rec(raw);
  const rawHitCounts = rec(data.hitCountsByRule);
  return {
    batchNo: str(data.batchNo),
    status: str(data.status, "COMPLETED"),
    sampleWindowDays: num(data.sampleWindowDays),
    evaluatedWithdrawals: num(data.evaluatedWithdrawals),
    activeRules: num(data.activeRules),
    hitCount: num(data.hitCount),
    hitCountsByRule: Object.fromEntries(Object.entries(rawHitCounts).map(([key, value]) => [key, num(value)])),
    routeCounts: rows<Record<string, unknown>>(data.routeCounts).map((row) => ({
      key: normalizeRuleAction(row.key ?? row.routeKey),
      label: str(row.label),
      count: num(row.count),
      n: num(row.count),
      color: str(row.color),
    })),
    completedAt: str(data.completedAt),
  };
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
  dryRunK3: (reason, commandKey) => apiRequest("/withdraw-rules/dry-runs", { method: "POST", commandKey, body: JSON.stringify(withReason({}, reason)) }).then(normalizeK3DryRun),
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
