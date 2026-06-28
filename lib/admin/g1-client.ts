import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError } from "@/lib/admin/error-messages";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

interface BackendCoverage {
  coverageRatio?: number | string | null;
  redlinePct?: number | string | null;
  redlineBreached?: boolean | null;
  precheck?: string | null;
}

interface BackendGate {
  enabled?: boolean | string | null;
  configKey?: string | null;
  linkedDomain?: string | null;
}

interface BackendStats {
  lockedTotalUsd?: number | string | null;
  usdtPoolUsd?: number | string | null;
  nexPoolUsd?: number | string | null;
  interestUsd?: number | string | null;
  positionCount?: number | string | null;
  activeCount?: number | string | null;
  matureCount?: number | string | null;
  pendingCount?: number | string | null;
  earlyWithdrawnMonth?: number | string | null;
  killedCount?: number | string | null;
  stakingGateOn?: boolean | string | null;
}

interface BackendPool {
  product?: string | null;
  tierKey?: string | null;
  term?: string | null;
  termDays?: number | string | null;
  apy?: string | number | null;
  apyDisplay?: string | null;
  penalty?: string | number | null;
  penaltyDisplay?: string | null;
  minStake?: string | number | null;
  minDisplayValue?: string | null;
  lockedUsd?: number | string | null;
  lockedDisplay?: string | null;
  enabled?: boolean | string | null;
  killed?: boolean | string | null;
  status?: string | null;
  statusLabel?: string | null;
  statusTone?: string | null;
  highYield?: boolean | string | null;
}

interface BackendPositionRow {
  positionNo?: string | null;
  userNo?: string | null;
  nickname?: string | null;
  tier?: string | null;
  amount?: string | null;
  status?: string | null;
  statusLabel?: string | null;
  statusTone?: string | null;
  note?: string | null;
}

interface BackendPositionGroup {
  status?: string | null;
  label?: string | null;
  note?: string | null;
  count?: number | string | null;
  rows?: BackendPositionRow[] | null;
}

interface BackendOverview {
  stats?: BackendStats | null;
  gate?: BackendGate | null;
  coverage?: BackendCoverage | null;
  pools?: BackendPool[] | null;
  positions?: BackendPositionGroup[] | null;
  stateMachine?: string[] | null;
  serverCanonical?: boolean | null;
  sources?: string[] | null;
}

export interface G1Coverage {
  coverageRatio: number;
  redlinePct: number;
  redlineBreached: boolean;
  precheck: string;
}

export interface G1Stats {
  lockedTotalUsd: number;
  usdtPoolUsd: number;
  nexPoolUsd: number;
  interestUsd: number;
  positionCount: number;
  activeCount: number;
  matureCount: number;
  pendingCount: number;
  earlyWithdrawnMonth: number;
  killedCount: number;
  stakingGateOn: boolean;
}

export interface G1Gate {
  enabled: boolean;
  configKey: string;
  linkedDomain: string;
}

export interface G1Pool {
  product: string;
  tierKey: string;
  term: string;
  termDays: number;
  apy: string;
  apyDisplay: string;
  penalty: string;
  penaltyDisplay: string;
  minStake: string;
  minDisplayValue: string;
  lockedUsd: number;
  lockedDisplay: string;
  enabled: boolean;
  killed: boolean;
  status: string;
  statusLabel: string;
  statusTone: "ok" | "bad" | "warn" | "dim";
  highYield: boolean;
}

export interface G1PositionRow {
  positionNo: string;
  userNo: string;
  nickname: string;
  tier: string;
  amount: string;
  status: string;
  statusLabel: string;
  statusTone: string;
  note: string;
}

export interface G1PositionGroup {
  status: string;
  label: string;
  note: string;
  count: number;
  rows: G1PositionRow[];
}

export interface G1Overview {
  stats: G1Stats;
  gate: G1Gate;
  coverage: G1Coverage;
  pools: G1Pool[];
  positions: G1PositionGroup[];
  stateMachine: string[];
  serverCanonical: boolean;
  sources: string[];
}

let requestSeq = 0;

function idempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

function toNumber(value: number | string | null | undefined, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function asText(value: unknown, fallback = "—") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
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

function normalizeTone(value: string | null | undefined): G1Pool["statusTone"] {
  const normalized = value?.trim().toLowerCase();
  return normalized === "ok" || normalized === "bad" || normalized === "warn" || normalized === "dim"
    ? normalized
    : "dim";
}

function moneyMillions(value: number) {
  return `$${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
}

function normalizePool(row: BackendPool): G1Pool {
  const termDays = toNumber(row.termDays);
  const tierKey = asText(row.tierKey, "unknown");
  const lockedUsd = toNumber(row.lockedUsd);
  return {
    product: asText(row.product, "USDT"),
    tierKey,
    term: asText(row.term, termDays ? `${termDays}d` : tierKey),
    termDays,
    apy: String(row.apy ?? ""),
    apyDisplay: asText(row.apyDisplay, `${row.apy ?? ""}%`),
    penalty: String(row.penalty ?? ""),
    penaltyDisplay: asText(row.penaltyDisplay, `${row.penalty ?? ""}% principal + forfeit interest`),
    minStake: String(row.minStake ?? ""),
    minDisplayValue: asText(row.minDisplayValue, String(row.minStake ?? "")),
    lockedUsd,
    lockedDisplay: asText(row.lockedDisplay, moneyMillions(lockedUsd)),
    enabled: toBool(row.enabled, true),
    killed: toBool(row.killed, false),
    status: asText(row.status, "active"),
    statusLabel: asText(row.statusLabel, "营业中"),
    statusTone: normalizeTone(row.statusTone),
    highYield: toBool(row.highYield, termDays >= 180),
  };
}

function normalizePositionRow(row: BackendPositionRow): G1PositionRow {
  return {
    positionNo: asText(row.positionNo),
    userNo: asText(row.userNo),
    nickname: asText(row.nickname, "—"),
    tier: asText(row.tier),
    amount: asText(row.amount),
    status: asText(row.status),
    statusLabel: asText(row.statusLabel),
    statusTone: asText(row.statusTone, "dim"),
    note: asText(row.note),
  };
}

function normalizeGroup(row: BackendPositionGroup): G1PositionGroup {
  const status = asText(row.status, "unknown");
  return {
    status,
    label: asText(row.label, status),
    note: asText(row.note, "—"),
    count: toNumber(row.count),
    rows: (row.rows ?? []).map(normalizePositionRow),
  };
}

function normalizeOverview(data: BackendOverview | null | undefined): G1Overview {
  const pools = (data?.pools ?? []).map(normalizePool);
  const positions = (data?.positions ?? []).map(normalizeGroup);
  const stats = data?.stats ?? {};
  const coverage = data?.coverage ?? {};
  const gate = data?.gate ?? {};
  return {
    stats: {
      lockedTotalUsd: toNumber(stats.lockedTotalUsd),
      usdtPoolUsd: toNumber(stats.usdtPoolUsd),
      nexPoolUsd: toNumber(stats.nexPoolUsd),
      interestUsd: toNumber(stats.interestUsd),
      positionCount: toNumber(stats.positionCount),
      activeCount: toNumber(stats.activeCount),
      matureCount: toNumber(stats.matureCount),
      pendingCount: toNumber(stats.pendingCount),
      earlyWithdrawnMonth: toNumber(stats.earlyWithdrawnMonth),
      killedCount: toNumber(stats.killedCount, pools.filter((pool) => pool.killed).length),
      stakingGateOn: toBool(stats.stakingGateOn, true),
    },
    gate: {
      enabled: toBool(gate.enabled, true),
      configKey: asText(gate.configKey, "J.killswitch.staking"),
      linkedDomain: asText(gate.linkedDomain, "J1"),
    },
    coverage: {
      coverageRatio: toNumber(coverage.coverageRatio),
      redlinePct: toNumber(coverage.redlinePct),
      redlineBreached: toBool(coverage.redlineBreached, false),
      precheck: asText(coverage.precheck, "raising APY, lowering penalty, restoring sale, or clearing a kill switch requires coverage redline check"),
    },
    pools,
    positions,
    stateMachine: data?.stateMachine ?? [],
    serverCanonical: data?.serverCanonical === true,
    sources: data?.sources ?? [],
  };
}

async function g1Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }) {
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
    throw new Error(formatAdminApiError(result?.message, `G1_REQUEST_FAILED_${response.status}`));
  }

  return result.data as T;
}

export async function fetchG1StakingOverview() {
  return normalizeOverview(await g1Request<BackendOverview>("/staking"));
}

export async function updateG1StakingPoolParam(tierKey: string, paramKey: "apy" | "penalty" | "min", value: string, reason: string, operator: string) {
  return normalizeOverview(await g1Request<BackendOverview>(`/staking/pools/${encodeURIComponent(tierKey)}/params/${encodeURIComponent(paramKey)}`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: `g1-${paramKey}`,
  }));
}

export async function updateG1StakingPoolSaleStatus(tierKey: string, enabled: boolean, reason: string, operator: string) {
  return normalizeOverview(await g1Request<BackendOverview>(`/staking/pools/${encodeURIComponent(tierKey)}/sale-status`, {
    method: "PATCH",
    body: JSON.stringify({ value: String(enabled), reason, operator }),
    idempotencyPrefix: "g1-sale",
  }));
}

export async function updateG1StakingPoolKillStatus(tierKey: string, killed: boolean, reason: string, operator: string) {
  return normalizeOverview(await g1Request<BackendOverview>(`/staking/pools/${encodeURIComponent(tierKey)}/kill-status`, {
    method: "PATCH",
    body: JSON.stringify({ value: String(killed), reason, operator }),
    idempotencyPrefix: "g1-kill",
  }));
}
