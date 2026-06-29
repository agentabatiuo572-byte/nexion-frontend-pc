import { formatAdminApiError } from "@/lib/admin/error-messages";

const OPERATOR = "superadmin";

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

export type K1PaginationQuery = {
  clusterPageNum?: number;
  clusterPageSize?: number;
  clusterLayer?: K1ClusterLayer;
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

function idempotencyKey() {
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init?.method && init.method !== "GET" && !headers.has("Idempotency-Key")) headers.set("Idempotency-Key", idempotencyKey());
  const res = await fetch(`/api/admin/risk${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const text = await res.text();
  const payload = text ? (JSON.parse(text) as ApiResult<T>) : {};
  if (!res.ok || (payload.code !== undefined && payload.code >= 400)) {
    throw new Error(formatAdminApiError(payload.message, `RISK_API_${res.status}`));
  }
  return payload.data as T;
}

function withReason<T extends Record<string, unknown>>(body: T, reason: string) {
  return { ...body, operator: OPERATOR, reason };
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
  unit?: string;
  sub: string;
  note: string;
};

export type K1Node = [string, string, string, string, string, ClusterStatus];
export type K1Gift = [string, string, string];
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
  reviewNote?: string;
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
};
export type K2ViewGroup = { key: string; label: string; sub: string; head: string[]; note: string; rows: K2Row[] };
export type K2Stat = { key: string; name: string; value: string; sub: string; tone: string };
export type ArbitrageOverview = {
  stats: K2Stat[];
  params: KRiskParam[];
  views: K2ViewGroup[];
  minHoldingMonths: string;
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
};
export type K3RouteCount = { key: RuleAction; label: string; count: number; n: number; color: string };
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

export type K4Dimension = { dimKey: string; name: string; source: string; weightPct: number };
export type K4Config = { inputSource: string; bandLowMax: number; bandHighMin: number; autoEscalateScore: number };
export type K4Distribution = { band: string; rangeText: string; count: number; percentage: number; color: string; tone: string };
export type K4Override = { userNo: string; modelScore: number; overrideScore: number; reason: string; operator: string; timeText: string; active: boolean };
export type K4Contribution = { name: string; evidence: string; points: number };
export type K4User = {
  userNo: string;
  modelScore: number;
  effectiveScore: number;
  overridden: boolean;
  bandLabel: string;
  bandTone: string;
  modelVersion: string;
  updatedText: string;
  contributions: K4Contribution[];
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
  dimensions: K4Dimension[];
  config: K4Config;
  distribution: K4Distribution[];
  totalUsers: number;
  overrides: AdminPage<K4Override>;
  overrideActive: number;
};

export type K5Ticket = {
  id: string;
  type: string;
  user: string;
  amt: string;
  cum: string;
  kyc: string;
  st: TicketSt;
  slaPct: number;
  slaTxt: string;
  info: [string, string][];
  hist: [string, string, "" | "warn" | "bad"][];
};
export type K5Alert = { tone: string; title: string; body: string; timeText: string };
export type KycReviewOverview = {
  stats: Record<string, unknown>;
  params: KRiskParam[];
  tickets: AdminPage<K5Ticket>;
  alerts: K5Alert[];
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
  reloadKRisk: (query?: KRiskOverviewQuery) => Promise<void>;
  updateK1Param: (key: string, value: string, reason: string) => Promise<void>;
  updateK1ClusterStatus: (clusterId: string, status: ClusterStatus, reason: string) => Promise<void>;
  upsertK1Whitelist: (cidr: string, note: string, reason: string, expireText?: string) => Promise<void>;
  disableK1Whitelist: (cidr: string, reason: string) => Promise<void>;
  updateK2Param: (key: string, value: string, reason: string) => Promise<void>;
  executeK2Action: (rowId: string, action: string, reason: string) => Promise<void>;
  createK3Rule: (dimension: string, conditionText: string, action: RuleAction, reason: string) => Promise<void>;
  updateK3RuleState: (ruleId: string, state: RuleState, reason: string) => Promise<void>;
  updateK3RuleCondition: (ruleId: string, conditionText: string, reason: string) => Promise<void>;
  dryRunK3: (reason: string) => Promise<void>;
  updateK4Weights: (weights: Record<string, number>, reason: string) => Promise<void>;
  updateK4Source: (inputSource: string, reason: string) => Promise<void>;
  updateK4Band: (lowMax: number, highMin: number, reason: string) => Promise<void>;
  updateK4Escalate: (score: number, reason: string) => Promise<void>;
  searchK4Users: (keyword: string) => Promise<K4UserOption[]>;
  fetchK4User: (userNo: string) => Promise<K4User>;
  overrideK4Score: (userNo: string, score: number, reason: string) => Promise<K4User>;
  recomputeK4Score: (userNo: string, reason: string) => Promise<K4User>;
  updateK5Param: (key: string, value: string, reason: string) => Promise<void>;
  decideK5Ticket: (ticketId: string, decision: "passed" | "rejected", reason: string) => Promise<void>;
  createK5ManualTicket: (userNo: string, reason: string) => Promise<void>;
};

function normalizeParam(row: Record<string, unknown>): KRiskParam {
  const value = str(row.value, str(row.val));
  return {
    key: str(row.key),
    name: str(row.name),
    value,
    val: value,
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
        const tuple = rows<unknown>(item);
        return [str(tuple[0]), str(tuple[1]), str(tuple[2]), str(tuple[3]), str(tuple[4]), normalizeClusterStatus(tuple[5])] as K1Node;
      }),
      reviewNote: str(row.reviewNote),
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
        };
      }),
    })),
    minHoldingMonths: str(data.minHoldingMonths, "6"),
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

function normalizeK4(raw: unknown): ScoringOverview {
  const data = rec(raw);
  const config = rec(data.config);
  const normalizeOverride = (row: Record<string, unknown>): K4Override => ({
    userNo: str(row.userNo),
    modelScore: num(row.modelScore),
    overrideScore: num(row.overrideScore),
    reason: str(row.reason),
    operator: str(row.operator),
    timeText: str(row.timeText),
    active: bool(row.active, true),
  });
  return {
    dimensions: rows<Record<string, unknown>>(data.dimensions).map((row) => ({
      dimKey: str(row.dimKey),
      name: str(row.name),
      source: str(row.source),
      weightPct: num(row.weightPct),
    })),
    config: {
      inputSource: str(config.inputSource, "全部启用"),
      bandLowMax: num(config.bandLowMax, 40),
      bandHighMin: num(config.bandHighMin, 70),
      autoEscalateScore: num(config.autoEscalateScore, 85),
    },
    distribution: rows<Record<string, unknown>>(data.distribution).map((row) => ({
      band: str(row.band),
      rangeText: str(row.rangeText),
      count: num(row.count),
      percentage: num(row.percentage),
      color: str(row.color),
      tone: str(row.tone),
    })),
    totalUsers: num(data.totalUsers),
    overrides: normalizePage(data.overrides, normalizeOverride, 1, 5),
    overrideActive: num(data.overrideActive),
  };
}

function normalizeK4User(raw: unknown): K4User {
  const data = rec(raw);
  return {
    userNo: str(data.userNo),
    modelScore: num(data.modelScore),
    effectiveScore: num(data.effectiveScore, num(data.modelScore)),
    overridden: bool(data.overridden),
    bandLabel: str(data.bandLabel),
    bandTone: str(data.bandTone),
    modelVersion: str(data.modelVersion),
    updatedText: str(data.updatedText),
    contributions: rows<Record<string, unknown>>(data.contributions).map((row) => ({
      name: str(row.name),
      evidence: str(row.evidence),
      points: num(row.points),
    })),
  };
}

function normalizeK4UserOption(raw: Record<string, unknown>): K4UserOption {
  return {
    userNo: str(raw.userNo),
    label: str(raw.label, str(raw.userNo)),
    sub: str(raw.sub),
    modelScore: num(raw.modelScore),
    effectiveScore: num(raw.effectiveScore, num(raw.modelScore)),
    bandLabel: str(raw.bandLabel),
    bandTone: str(raw.bandTone),
    overridden: bool(raw.overridden),
  };
}

function normalizeK5(raw: unknown): KycReviewOverview {
  const data = rec(raw);
  const normalizeTicket = (row: Record<string, unknown>): K5Ticket => ({
    id: str(row.id),
    type: str(row.type),
    user: str(row.user),
    amt: str(row.amt),
    cum: str(row.cum),
    kyc: str(row.kyc),
    st: normalizeTicketStatus(row.st),
    slaPct: num(row.slaPct),
    slaTxt: str(row.slaTxt),
    info: parseJsonRows(row.infoJson).map((item) => {
      const tuple = rows<unknown>(item);
      return [str(tuple[0]), str(tuple[1])] as [string, string];
    }),
    hist: parseJsonRows(row.histJson).map((item) => {
      const tuple = rows<unknown>(item);
      const tone = str(tuple[2]) as "" | "warn" | "bad";
      return [str(tuple[0]), str(tuple[1]), tone === "warn" || tone === "bad" ? tone : ""] as [string, string, "" | "warn" | "bad"];
    }),
  });
  return {
    stats: rec(data.stats),
    params: rows<Record<string, unknown>>(data.params).map(normalizeParam),
    tickets: normalizePage(data.tickets, normalizeTicket, 1, 5),
    alerts: rows<Record<string, unknown>>(data.alerts).map((row) => ({
      tone: str(row.tone),
      title: str(row.title),
      body: str(row.body),
      timeText: str(row.timeText),
    })),
    sources: strArray(data.sources),
  };
}

export async function fetchK1MultiAccountOverview(query: K1PaginationQuery = {}): Promise<MultiAccountOverview> {
  const clusterLayer = query.clusterLayer && query.clusterLayer !== "all" ? query.clusterLayer : undefined;
  return apiRequest(`/multi-account/overview${queryString({
    clusterPageNum: query.clusterPageNum ?? 1,
    clusterPageSize: query.clusterPageSize ?? 5,
    clusterLayer,
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
    apiRequest(`/scoring/overview${queryString({
      overridePageNum: scoringQuery.overridePageNum ?? 1,
      overridePageSize: scoringQuery.overridePageSize ?? 5,
    })}`).then(normalizeK4),
    apiRequest(`/kyc-review/overview${queryString({
      ticketPageNum: kycReviewQuery.ticketPageNum ?? 1,
      ticketPageSize: kycReviewQuery.ticketPageSize ?? 5,
      ticketFilter: kycReviewQuery.ticketFilter,
    })}`).then(normalizeK5),
  ]);
  return { multiAccount, arbitrage, withdrawRules, scoring, kycReview };
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
  updateK1Param: (key, value, reason) => apiRequest(`/multi-account/params/${encodeURIComponent(key)}`, { method: "PATCH", body: JSON.stringify(withReason({ value }, reason)) }).then(() => undefined),
  updateK1ClusterStatus: (clusterId, status, reason) => apiRequest(`/multi-account/clusters/${encodeURIComponent(clusterId)}/status`, { method: "PATCH", body: JSON.stringify(withReason({ status }, reason)) }).then(() => undefined),
  upsertK1Whitelist: (cidr, note, reason, expireText = "2026-12-31") => apiRequest("/multi-account/whitelist", { method: "POST", body: JSON.stringify(withReason({ cidr, note, expireText }, reason)) }).then(() => undefined),
  disableK1Whitelist: (cidr, reason) => apiRequest("/multi-account/whitelist", { method: "PATCH", body: JSON.stringify(withReason({ cidr }, reason)) }).then(() => undefined),
  updateK2Param: (key, value, reason) => apiRequest(`/arbitrage/params/${encodeURIComponent(key)}`, { method: "PATCH", body: JSON.stringify(withReason({ value }, reason)) }).then(() => undefined),
  executeK2Action: (rowId, action, reason) => {
    const mapped = k2ActionMap[action] || action;
    return apiRequest(`/arbitrage/rows/${encodeURIComponent(rowId)}/${encodeURIComponent(mapped)}`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined);
  },
  createK3Rule: (dimension, conditionText, action, reason) => apiRequest("/withdraw-rules", { method: "POST", body: JSON.stringify(withReason({ dimension, conditionText, action }, reason)) }).then(() => undefined),
  updateK3RuleState: (ruleId, state, reason) => apiRequest(`/withdraw-rules/${encodeURIComponent(ruleId)}/status`, { method: "PATCH", body: JSON.stringify(withReason({ state }, reason)) }).then(() => undefined),
  updateK3RuleCondition: (ruleId, conditionText, reason) => apiRequest(`/withdraw-rules/${encodeURIComponent(ruleId)}/condition`, { method: "PATCH", body: JSON.stringify(withReason({ conditionText }, reason)) }).then(() => undefined),
  dryRunK3: (reason) => apiRequest("/withdraw-rules/dry-runs", { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  updateK4Weights: (weights, reason) => apiRequest("/scoring/weights", { method: "PATCH", body: JSON.stringify(withReason({ weights }, reason)) }).then(() => undefined),
  updateK4Source: (inputSource, reason) => apiRequest("/scoring/source", { method: "PATCH", body: JSON.stringify(withReason({ inputSource }, reason)) }).then(() => undefined),
  updateK4Band: (lowMax, highMin, reason) => apiRequest("/scoring/band", { method: "PATCH", body: JSON.stringify(withReason({ lowMax, highMin }, reason)) }).then(() => undefined),
  updateK4Escalate: (score, reason) => apiRequest("/scoring/escalate", { method: "PATCH", body: JSON.stringify(withReason({ score }, reason)) }).then(() => undefined),
  searchK4Users: (keyword) => apiRequest(`/scoring/users${queryString({ keyword: keyword.trim(), limit: 8 })}`).then((raw) => rows<Record<string, unknown>>(raw).map(normalizeK4UserOption)),
  fetchK4User: (userNo) => apiRequest(`/scoring/users/${encodeURIComponent(userNo)}`).then(normalizeK4User),
  overrideK4Score: (userNo, score, reason) => apiRequest(`/scoring/users/${encodeURIComponent(userNo)}/override`, { method: "POST", body: JSON.stringify(withReason({ score }, reason)) }).then(normalizeK4User),
  recomputeK4Score: (userNo, reason) => apiRequest(`/scoring/users/${encodeURIComponent(userNo)}/recompute`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(normalizeK4User),
  updateK5Param: (key, value, reason) => apiRequest(`/kyc-review/params/${encodeURIComponent(key)}`, { method: "PATCH", body: JSON.stringify(withReason({ value }, reason)) }).then(() => undefined),
  decideK5Ticket: (ticketId, decision, reason) => apiRequest(`/kyc-review/tickets/${encodeURIComponent(ticketId)}/decision`, { method: "POST", body: JSON.stringify(withReason({ decision }, reason)) }).then(() => undefined),
  createK5ManualTicket: (userNo, reason) => apiRequest("/kyc-review/tickets/manual", { method: "POST", body: JSON.stringify(withReason({ userNo }, reason)) }).then(() => undefined),
};
