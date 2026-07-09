import { formatAdminApiError } from "@/lib/admin/error-messages";
import { currentAdminOperator } from "@/lib/admin/current-operator";

type ApiResult<T> = {
  code?: number;
  message?: string;
  data?: T;
};

function idempotencyKey() {
  return `j-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init?.method && init.method !== "GET" && !headers.has("Idempotency-Key")) headers.set("Idempotency-Key", idempotencyKey());
  const res = await fetch(`/api/admin/emergency${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const text = await res.text();
  const payload = text ? (JSON.parse(text) as ApiResult<T>) : {};
  if (!res.ok || (payload.code !== undefined && payload.code >= 400)) {
    throw new Error(formatAdminApiError(payload.message, `EMERGENCY_API_${res.status}`));
  }
  return payload.data as T;
}

async function contentApiRequest<T>(path: string): Promise<T> {
  const res = await fetch(`/api/admin/content${path}`, {
    cache: "no-store",
  });
  const text = await res.text();
  const payload = text ? (JSON.parse(text) as ApiResult<T>) : {};
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
  const parsed = Number(value);
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

function strArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => str(item)).filter(Boolean) : [];
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
  proposalStatus: string;
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
  adjustable: boolean;
  refNote?: string;
  refTitle?: string;
};

export type KillSwitchOverview = {
  activeGateCount: number;
  activeGates: JGate[];
  retiredGates: Record<string, unknown>[];
  coverage: { coverageRatio: number; redlinePct: number; yellowLinePct: number; recoveryAllowed: boolean };
  stats: Record<string, unknown>;
  emergencySla: EmergencySlaRow[];
  autoRules: AutoRuleRow[];
  sources: string[];
};

export type GeoCountry = { cc: string; name: string; reason: string; status: string };
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
};
export type GeoHit = { cc: string; name: string; nm: string; count: number; ct: number };
export type GeoEdgeMetric = { key: string; k: string; value: string; v: string; tone: string };
export type GeoBlockOverview = {
  blocked: GeoCountry[];
  limited: GeoCountry[];
  countries: GeoCountry[];
  endpoints: GeoEndpoint[];
  hits: GeoHit[];
  edge: { source: string; metrics: GeoEdgeMetric[] };
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
  stats: Record<string, unknown>;
  trend: TamperTrend;
  paths: TamperPath[];
  accounts: TamperAccount[];
  accountPage: TamperAccountPage;
  alertConfig: { threshold: number; label: string; feedK4: boolean };
  sources: string[];
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
};
export type J4ActionOption = {
  value: string;
  domain: string;
  action: string;
  ref: string | null;
  approve: boolean;
  description: string;
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
  stats: Record<string, unknown>;
  sla: Record<string, unknown>;
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
};

export type JEmergencyData = {
  killSwitch?: KillSwitchOverview;
  geoBlock?: GeoBlockOverview;
  tamper?: TamperOverview;
  sop?: SopOverview;
  notifyTemplates?: JNotifyTemplateOption[];
};

export type JEmergencyActions = {
  reloadJEmergency: () => Promise<void>;
  toggleJ1KillSwitch: (key: string, enabled: boolean, reason: string) => Promise<void>;
  emergencyDisableJ1: (keys: string[], reason: string, operator?: string) => Promise<void>;
  updateJ1Sla: (paramKey: string, value: string, reason: string) => Promise<void>;
  updateJ1AutoRule: (ruleId: string, value: string, reason: string) => Promise<void>;
  updateJ2Country: (countryCode: string, status: "blocked" | "limited" | "allowed", reason: string) => Promise<void>;
  updateJ2Endpoint: (endpointKey: string, countries: string[], reason: string) => Promise<void>;
  updateJ2EdgeJudge: (source: string, reason: string) => Promise<void>;
  emergencyBlockJ2: (countries: string[], reason: string) => Promise<void>;
  loadJ3TamperPage: (page: number, pageSize: number) => Promise<TamperOverview>;
  updateJ3AlertConfig: (threshold: number, feedK4: boolean, reason: string) => Promise<void>;
  createJ3Report: (window: string, reason: string) => Promise<void>;
  createJ4Playbook: (body: J4PlaybookCreateInput, reason: string) => Promise<void>;
  updateJ4Playbook: (code: string, body: J4PlaybookUpdateInput, reason: string) => Promise<void>;
  drillJ4Playbook: (code: string, reason: string) => Promise<void>;
  executeJ4Playbook: (code: string, emergency: boolean, reason: string) => Promise<void>;
};

function normalizeKillSwitch(raw: unknown): KillSwitchOverview {
  const data = rec(raw);
  const coverage = rec(data.coverage);
  return {
    activeGateCount: num(data.activeGateCount),
    activeGates: rows<Record<string, unknown>>(data.activeGates).map((gate) => ({
      key: str(gate.key),
      name: str(gate.name, str(gate.key)),
      cap: str(gate.cap),
      desc: str(gate.desc),
      enabled: bool(gate.enabled, true),
      on: bool(gate.on, bool(gate.enabled, true)),
      status: str(gate.status, bool(gate.enabled, true) ? "enabled" : "disabled"),
      coveragePrecheckRequired: bool(gate.coveragePrecheckRequired),
      coverageImpactCategory: str(gate.coverageImpactCategory, "none"),
      amplifies: bool(gate.amplifies),
      lastChange: str(gate.lastChange),
      proposalStatus: str(gate.proposalStatus, "idle"),
      emergency: bool(gate.emergency),
    })),
    retiredGates: rows<Record<string, unknown>>(data.retiredGates),
    coverage: {
      coverageRatio: requiredNum(coverage.coverageRatio, "coverage.coverageRatio"),
      redlinePct: requiredNum(coverage.redlinePct, "coverage.redlinePct"),
      yellowLinePct: requiredNum(coverage.yellowLinePct, "coverage.yellowLinePct"),
      recoveryAllowed: requiredBool(coverage.recoveryAllowed, "coverage.recoveryAllowed"),
    },
    stats: rec(data.stats),
    emergencySla: rows<Record<string, unknown>>(data.emergencySla).map((row) => ({
      id: str(row.id),
      k: str(row.k),
      d: str(row.d),
      v: str(row.v),
      unit: str(row.unit),
      kind: str(row.kind, "text") === "number" ? "number" : "text",
      editable: bool(row.editable, true),
    })),
    autoRules: rows<Record<string, unknown>>(data.autoRules).map((row) => ({
      id: str(row.id),
      nm: str(row.nm),
      tag: str(row.tag),
      icon: str(row.icon),
      cond: strArray(row.cond),
      thrK: str(row.thrK),
      thr: str(row.thr),
      adjustable: bool(row.adjustable),
      refNote: str(row.refNote),
      refTitle: str(row.refTitle),
    })),
    sources: strArray(data.sources),
  };
}

function normalizeGeo(raw: unknown): GeoBlockOverview {
  const data = rec(raw);
  const edge = rec(data.edge);
  return {
    blocked: rows<GeoCountry>(data.blocked),
    limited: rows<GeoCountry>(data.limited),
    countries: rows<GeoCountry>(data.countries),
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
      metrics: requiredRows<Record<string, unknown>>(edge.metrics, "geo.edge.metrics").map((row) => ({
        key: str(row.key),
        k: str(row.key),
        value: str(row.value),
        v: str(row.value),
        tone: str(row.tone),
      })),
    },
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
  return {
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
    alertConfig: {
      threshold: requiredNum(alertConfig.threshold, "alertConfig.threshold"),
      label: str(alertConfig.label),
      feedK4: requiredBool(alertConfig.feedK4, "alertConfig.feedK4"),
    },
    sources: strArray(data.sources),
  };
}

function normalizeSop(raw: unknown): SopOverview {
  const data = rec(raw);
  const actionOptions = rows<Record<string, unknown>>(data.actionOptions).map((row) => {
    const domain = str(row.domain).toUpperCase();
    const action = str(row.action);
    const ref = row.ref == null ? null : str(row.ref);
    const description = str(row.description);
    const label = `${domain} · ${action}`;
    return {
      value: str(row.value, ref ? `${domain}:${ref}` : `${domain}:${action}`),
      domain,
      action,
      ref,
      approve: bool(row.approve, domain !== "I3"),
      description,
      label,
      searchText: [domain, action, ref, description, label].filter(Boolean).join(" ").toLowerCase(),
    };
  });
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
  });
  return {
    stats: rec(data.stats),
    sla: rec(data.sla),
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
    .filter((item) => item.campaignNo && item.status !== "cancelled")
    .sort((a, b) => (priority[a.tier] ?? 9) - (priority[b.tier] ?? 9) || a.name.localeCompare(b.name));
}

export async function fetchJTamperOverview(accountPage = 1, accountPageSize = 5): Promise<TamperOverview> {
  const params = new URLSearchParams({
    accountPage: String(accountPage),
    accountPageSize: String(accountPageSize),
  });
  return apiRequest(`/tamper/overview?${params.toString()}`).then(normalizeTamper);
}

export async function fetchJ4NotifyTemplateOptions(): Promise<JNotifyTemplateOption[]> {
  return contentApiRequest("/campaigns/overview").then(normalizeNotifyTemplates);
}

export async function fetchJEmergencyOverviews(): Promise<JEmergencyData> {
  const [killSwitch, geoBlock, tamper, sop, notifyTemplates] = await Promise.all([
    apiRequest("/kill-switches").then(normalizeKillSwitch),
    apiRequest("/geo-block").then(normalizeGeo),
    fetchJTamperOverview(),
    apiRequest("/sop/playbooks").then(normalizeSop),
    fetchJ4NotifyTemplateOptions(),
  ]);
  return { killSwitch, geoBlock, tamper, sop, notifyTemplates };
}

export const jEmergencyActions: Omit<JEmergencyActions, "reloadJEmergency"> = {
  toggleJ1KillSwitch: (key, enabled, reason) => apiRequest(`/kill-switches/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify(withReason({ enabled: enabled ? "enabled" : "disabled" }, reason)) }).then(() => undefined),
  emergencyDisableJ1: (keys, reason, operator) => apiRequest("/kill-switches/emergency-disable", { method: "POST", body: JSON.stringify(withReason({ keys }, reason, operator)) }).then(() => undefined),
  updateJ1Sla: (paramKey, value, reason) => apiRequest(`/kill-switches/emergency-sla/${encodeURIComponent(paramKey)}`, { method: "PATCH", body: JSON.stringify(withReason({ value }, reason)) }).then(() => undefined),
  updateJ1AutoRule: (ruleId, value, reason) => apiRequest(`/kill-switches/auto-rules/${encodeURIComponent(ruleId)}`, { method: "PATCH", body: JSON.stringify(withReason({ value }, reason)) }).then(() => undefined),
  updateJ2Country: (countryCode, status, reason) => apiRequest(`/geo-block/countries/${encodeURIComponent(countryCode)}`, { method: "PUT", body: JSON.stringify(withReason({ status }, reason)) }).then(() => undefined),
  updateJ2Endpoint: (endpointKey, countries, reason) => apiRequest(`/geo-block/endpoints/${encodeURIComponent(endpointKey)}`, { method: "PUT", body: JSON.stringify(withReason({ countries }, reason)) }).then(() => undefined),
  updateJ2EdgeJudge: (source, reason) => apiRequest("/geo-block/edge-judge", { method: "PUT", body: JSON.stringify(withReason({ source }, reason)) }).then(() => undefined),
  emergencyBlockJ2: (countries, reason) => apiRequest("/geo-block/emergency-blocks", { method: "POST", body: JSON.stringify(withReason({ countries }, reason)) }).then(() => undefined),
  loadJ3TamperPage: fetchJTamperOverview,
  updateJ3AlertConfig: (threshold, feedK4, reason) => apiRequest("/tamper/alert-config", { method: "PATCH", body: JSON.stringify(withReason({ threshold, feedK4 }, reason)) }).then(() => undefined),
  createJ3Report: (window, reason) => apiRequest("/tamper/reports", { method: "POST", body: JSON.stringify(withReason({ window }, reason)) }).then(() => undefined),
  createJ4Playbook: (body, reason) => apiRequest("/sop/playbooks", { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateJ4Playbook: (code, body, reason) => apiRequest(`/sop/playbooks/${encodeURIComponent(code)}`, { method: "PUT", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  drillJ4Playbook: (code, reason) => apiRequest(`/sop/playbooks/${encodeURIComponent(code)}/drills`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  executeJ4Playbook: (code, emergency, reason) => apiRequest(`/sop/playbooks/${encodeURIComponent(code)}/executions`, { method: "POST", body: JSON.stringify(withReason({ emergency }, reason)) }).then(() => undefined),
};
