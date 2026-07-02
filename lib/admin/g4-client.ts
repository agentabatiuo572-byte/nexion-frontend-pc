import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError } from "@/lib/admin/error-messages";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

type RawNumber = number | string | null | undefined;

interface BackendStats {
  totalSlots?: RawNumber;
  sold?: RawNumber;
  unitPrice?: RawNumber;
  unsold?: RawNumber;
  soldPct?: RawNumber;
  genesisAccrualUsd?: RawNumber;
  marketOn?: boolean | string | null;
  todayBatch?: string | null;
  secondary?: {
    floor?: RawNumber;
    vol24h?: RawNumber;
    listed?: RawNumber;
    owners?: RawNumber;
    royaltyPct?: RawNumber;
  } | null;
}

interface BackendParam {
  key?: string | null;
  configKey?: string | null;
  name?: string | null;
  sub?: string | null;
  value?: RawNumber;
  displayValue?: string | null;
  note?: string | null;
  b1RedlineTriggered?: boolean | string | null;
  valueType?: string | null;
}

interface BackendDividend {
  dailyVolumeBase?: RawNumber;
  dividendPct?: RawNumber;
  poolToday?: RawNumber;
  perSlotPerDay?: RawNumber;
  floorPerNodePerDay?: RawNumber;
  payoutToday?: RawNumber;
  batchNo?: string | null;
  batchStatus?: string | null;
}

interface BackendMarket {
  enabled?: boolean | string | null;
  configKey?: string | null;
  linkedDomain?: string | null;
}

interface BackendGeoBlocked {
  cc?: string | null;
  name?: string | null;
  status?: string | null;
  reason?: string | null;
}

interface BackendNodeFact {
  label?: string | null;
  value?: string | null;
}

interface BackendNodeTransfer {
  time?: string | null;
  event?: string | null;
  royalty?: string | null;
}

interface BackendNode {
  id?: string | null;
  owner?: string | null;
  userNo?: string | null;
  source?: string | null;
  lifetimeDividend?: string | null;
  status?: string | null;
  statusLabel?: string | null;
  statusTone?: string | null;
  buy?: string | null;
  dividends?: BackendNodeFact[] | null;
  transfers?: BackendNodeTransfer[] | null;
}

interface BackendNodePage {
  page?: RawNumber;
  pageSize?: RawNumber;
  total?: RawNumber;
  totalPages?: RawNumber;
  hasPrev?: boolean | string | null;
  hasNext?: boolean | string | null;
}

interface BackendCoverage {
  coverageRatio?: RawNumber;
  redlinePct?: RawNumber;
  redlineBreached?: boolean | string | null;
  precheck?: string | null;
}

interface BackendOverview {
  stats?: BackendStats | null;
  params?: BackendParam[] | null;
  dividend?: BackendDividend | null;
  market?: BackendMarket | null;
  geoBlocked?: BackendGeoBlocked[] | null;
  nodes?: BackendNode[] | null;
  nodePage?: BackendNodePage | null;
  stateMachine?: string[] | null;
  coverage?: BackendCoverage | null;
  serverCanonical?: boolean | null;
  sources?: string[] | null;
}

export interface G4Stats {
  totalSlots: number;
  sold: number;
  unitPrice: number;
  unsold: number;
  soldPct: number;
  genesisAccrualUsd: number;
  marketOn: boolean;
  todayBatch: string;
  secondary: {
    floor: number;
    vol24h: number;
    listed: number;
    owners: number;
    royaltyPct: number;
  };
}

export interface G4Param {
  key: string;
  configKey: string;
  name: string;
  sub: string;
  value: string;
  displayValue: string;
  note: string;
  b1RedlineTriggered: boolean;
  valueType: string;
}

export interface G4Dividend {
  dailyVolumeBase: number;
  dividendPct: number;
  poolToday: number;
  perSlotPerDay: number;
  floorPerNodePerDay: number;
  payoutToday: number;
  batchNo: string;
  batchStatus: string;
}

export interface G4Market {
  enabled: boolean;
  configKey: string;
  linkedDomain: string;
}

export interface G4GeoBlocked {
  cc: string;
  name: string;
  status: string;
  reason: string;
}

export interface G4NodeFact {
  label: string;
  value: string;
}

export interface G4NodeTransfer {
  time: string;
  event: string;
  royalty: string;
}

export interface G4Node {
  id: string;
  owner: string;
  userNo: string;
  source: string;
  lifetimeDividend: string;
  status: string;
  statusLabel: string;
  statusTone: string;
  buy: string;
  dividends: G4NodeFact[];
  transfers: G4NodeTransfer[];
}

export interface G4NodePage {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export interface G4Coverage {
  coverageRatio: number;
  redlinePct: number;
  redlineBreached: boolean;
  precheck: string;
}

export interface G4Overview {
  stats: G4Stats;
  params: G4Param[];
  dividend: G4Dividend;
  market: G4Market;
  geoBlocked: G4GeoBlocked[];
  nodes: G4Node[];
  nodePage: G4NodePage;
  stateMachine: string[];
  coverage: G4Coverage;
  serverCanonical: boolean;
  sources: string[];
}

let requestSeq = 0;

function idempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

function toNumber(value: RawNumber, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,%±,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toBool(value: boolean | string | null | undefined, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "on", "enabled", "enable"].includes(normalized)) return true;
    if (["false", "0", "off", "disabled", "disable"].includes(normalized)) return false;
  }
  return fallback;
}

function asText(value: unknown, fallback = "-") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeOverview(data: BackendOverview | null | undefined): G4Overview {
  const stats = data?.stats ?? {};
  const secondary = stats.secondary ?? {};
  const dividend = data?.dividend ?? {};
  const market = data?.market ?? {};
  const coverage = data?.coverage ?? {};
  const nodes = (data?.nodes ?? []).map((node) => ({
    id: asText(node.id),
    owner: asText(node.owner),
    userNo: asText(node.userNo),
    source: asText(node.source),
    lifetimeDividend: asText(node.lifetimeDividend, ""),
    status: asText(node.status, ""),
    statusLabel: asText(node.statusLabel, asText(node.status, "")),
    statusTone: asText(node.statusTone, "dim"),
    buy: asText(node.buy),
    dividends: (node.dividends ?? []).map((fact) => ({
      label: asText(fact.label),
      value: asText(fact.value),
    })),
    transfers: (node.transfers ?? []).map((transfer) => ({
      time: asText(transfer.time),
      event: asText(transfer.event),
      royalty: asText(transfer.royalty),
    })),
  }));
  const nodePage = data?.nodePage ?? {};
  const pageSize = Math.max(1, Math.trunc(toNumber(nodePage.pageSize, nodes.length || 10)));
  const total = Math.max(0, Math.trunc(toNumber(nodePage.total, nodes.length)));
  const totalPages = Math.max(1, Math.trunc(toNumber(nodePage.totalPages, Math.ceil(total / pageSize) || 1)));
  const page = Math.max(1, Math.min(totalPages, Math.trunc(toNumber(nodePage.page, 1))));
  return {
    stats: {
      totalSlots: toNumber(stats.totalSlots),
      sold: toNumber(stats.sold),
      unitPrice: toNumber(stats.unitPrice),
      unsold: toNumber(stats.unsold),
      soldPct: toNumber(stats.soldPct),
      genesisAccrualUsd: toNumber(stats.genesisAccrualUsd),
      marketOn: toBool(stats.marketOn, false),
      todayBatch: asText(stats.todayBatch, ""),
      secondary: {
        floor: toNumber(secondary.floor),
        vol24h: toNumber(secondary.vol24h),
        listed: toNumber(secondary.listed),
        owners: toNumber(secondary.owners),
        royaltyPct: toNumber(secondary.royaltyPct),
      },
    },
    params: (data?.params ?? []).map((param) => ({
      key: asText(param.key, "unknown"),
      configKey: asText(param.configKey),
      name: asText(param.name, asText(param.key, "参数")),
      sub: asText(param.sub),
      value: String(param.value ?? ""),
      displayValue: asText(param.displayValue, String(param.value ?? "")),
      note: asText(param.note),
      b1RedlineTriggered: toBool(param.b1RedlineTriggered, false),
      valueType: asText(param.valueType, "STRING"),
    })),
    dividend: {
      dailyVolumeBase: toNumber(dividend.dailyVolumeBase),
      dividendPct: toNumber(dividend.dividendPct),
      poolToday: toNumber(dividend.poolToday),
      perSlotPerDay: toNumber(dividend.perSlotPerDay),
      floorPerNodePerDay: toNumber(dividend.floorPerNodePerDay),
      payoutToday: toNumber(dividend.payoutToday),
      batchNo: asText(dividend.batchNo, ""),
      batchStatus: asText(dividend.batchStatus, "ready"),
    },
    market: {
      enabled: toBool(market.enabled, false),
      configKey: asText(market.configKey, ""),
      linkedDomain: asText(market.linkedDomain, ""),
    },
    geoBlocked: (data?.geoBlocked ?? []).map((geo) => ({
      cc: asText(geo.cc),
      name: asText(geo.name),
      status: asText(geo.status),
      reason: asText(geo.reason),
    })),
    nodes,
    nodePage: {
      page,
      pageSize,
      total,
      totalPages,
      hasPrev: toBool(nodePage.hasPrev, page > 1),
      hasNext: toBool(nodePage.hasNext, page < totalPages),
    },
    stateMachine: data?.stateMachine ?? ["minted", "held", "listed", "sold"],
    coverage: {
      coverageRatio: toNumber(coverage.coverageRatio),
      redlinePct: toNumber(coverage.redlinePct),
      redlineBreached: toBool(coverage.redlineBreached, false),
      precheck: asText(coverage.precheck),
    },
    serverCanonical: data?.serverCanonical === true,
    sources: data?.sources ?? [],
  };
}

async function g4Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.idempotencyPrefix) {
    headers.set("Idempotency-Key", idempotencyKey(init.idempotencyPrefix));
  }

  const response = await fetch(`/api/admin/market${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) {
      resetAdminSession();
    }
    throw new Error(formatAdminApiError(result?.message, `G4_REQUEST_FAILED_${response.status}`));
  }

  return result.data as T;
}

export async function fetchG4GenesisOverview(page = 1, pageSize = 10) {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  return normalizeOverview(await g4Request<BackendOverview>(`/nex/genesis?${query.toString()}`));
}

export async function updateG4GenesisParam(paramKey: string, value: string, reason: string, operator: string) {
  return normalizeOverview(await g4Request<BackendOverview>(`/nex/genesis/params/${encodeURIComponent(paramKey)}`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: `g4-param-${paramKey}`,
  }));
}

export async function updateG4GenesisMarketStatus(enabled: boolean, reason: string, operator: string) {
  return normalizeOverview(await g4Request<BackendOverview>("/nex/genesis/market-status", {
    method: "PATCH",
    body: JSON.stringify({ value: String(enabled), reason, operator }),
    idempotencyPrefix: "g4-market-status",
  }));
}

export async function rerunG4GenesisDividendBatch(batchNo: string, reason: string, operator: string) {
  return normalizeOverview(await g4Request<BackendOverview>(`/nex/genesis/dividend-batches/${encodeURIComponent(batchNo)}/rerun`, {
    method: "POST",
    body: JSON.stringify({ value: "rerun", reason, operator }),
    idempotencyPrefix: `g4-rerun-${batchNo}`,
  }));
}
