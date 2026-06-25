import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

export interface PageResult<T> {
  total: number;
  pageNum: number;
  pageSize: number;
  records: T[];
}

export interface D1Channel {
  id: string;
  code: string;
  fee: string;
  minAmount: string;
  enabled: boolean;
}

export interface D1CardParam {
  key: string;
  name: string;
  value: string;
  note: string;
}

export interface D1ReconciliationRow {
  channel: string;
  providerCount: number;
  providerAmount: number;
  ledgerCount: number;
  ledgerAmount: number;
  diffAmount: number;
  diff: string;
  reconciled: boolean;
}

export interface D1BinRisk {
  segment: string;
  meta: string;
  fails24h: number;
  locked: boolean;
  note: string;
  manual: boolean;
}

export interface D1Chargeback {
  caseNo: string;
  userId: number;
  userCode: string;
  amount: number;
  reasonCode: string;
  enteredStatus: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface D1Overview {
  channels: D1Channel[];
  primaryPsp: string;
  backupPsp: string;
  cardParams: D1CardParam[];
  reconciliation: D1ReconciliationRow[];
  ledgerTotal: number;
  ledgerCount: number;
  diffCount: number;
  diffAmount: number;
  feeBufferUsd: number;
  bins: D1BinRisk[];
  binLockedCount: number;
  chargebacks: D1Chargeback[];
  sources: string[];
}

export interface D1DepositFlow {
  id: number;
  userId: number;
  depositNo: string;
  channel: string;
  asset: string;
  amount: number;
  providerReceived: number;
  proof: string;
  status: string;
  statusLabel: string;
  createdAt: string;
  confirmedAt: string;
  creditedAt: string;
}

export interface D2Withdrawal {
  id: number;
  userId: number;
  withdrawalNo: string;
  asset: string;
  chain: string;
  amount: number;
  fee: number;
  targetAddress: string;
  riskDecisionId?: number | null;
  chainTxHash?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  userNo: string;
  nickname: string;
  phoneMasked: string;
  kycStatus: string;
  riskScore: number;
  hitRules: string;
  withdrawalCount24h: number;
  statusHistory: string;
  auditTrail: string;
}

export interface D3DualLedger {
  generatedAt?: string;
  sources: string[];
  snapshot: {
    reserveUsd: number;
    liabilitiesUsd: number;
    coverageRatio: number;
    redlinePct: number;
    healthyPct: number;
    runRiskPct: number;
    redlineBreached: boolean;
    netFlow24hUsd: number;
    queueBacklogCount: number;
    queueBacklogUsd: number;
    avgRiskScore: number;
    coverageSeries: number[];
    scope: string;
  };
  accounts: Array<{ key: string; label: string; amount: number; source: string }>;
  maturity7d: Array<{ day: string; withdrawUsd: number; interestUsd: number; genesisUsd: number }>;
  prev?: { reserveUsd?: number; netFlow24hUsd?: number };
}

export interface D4Bill {
  id: number;
  userId: number;
  bizNo: string;
  bizType: string;
  asset: string;
  direction: string;
  amount: number;
  balanceAfter: number;
  status: string;
  remark: string;
  createdAt: string;
  updatedAt: string;
}

export interface D4UserLedger {
  userId: number;
  rows: D4Bill[];
  totals: Record<string, number>;
  balance: Record<string, number>;
  sources: string[];
}

export interface D5Params {
  dailyLimitCount: number;
  maxBalancePct: number;
  maxBalanceRatio: number;
  feeRatePct: number;
  feeRate: number;
  minUsdt: number;
  trc20Enabled: boolean;
  erc20Enabled: boolean;
  coverageRatio: number;
  redlinePct: number;
  sources: string[];
  updated?: { key: string; configKey: string; oldValue: number; newValue: number };
}

let requestSeq = 0;

function nextId(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

function num(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function text(value: unknown, fallback = "—") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function bool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "on", "enabled", "enable", "locked"].includes(normalized)) return true;
    if (["false", "0", "off", "disabled", "disable", "unlocked"].includes(normalized)) return false;
  }
  return fallback;
}

function arr<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function buildQuery(params: Record<string, string | number | undefined | null>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      query.set(key, String(value));
    }
  });
  const qs = query.toString();
  return qs ? `?${qs}` : "";
}

async function apiRequest<T>(base: "finance" | "treasury", path: string, init?: RequestInit & { idempotencyPrefix?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.idempotencyPrefix) {
    headers.set("Idempotency-Key", nextId(init.idempotencyPrefix));
  }
  const response = await fetch(`/api/admin/${base}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) {
      resetAdminSession();
    }
    throw new Error(result?.message || `D_REQUEST_FAILED_${response.status}`);
  }
  return result.data as T;
}

function normalizePage<T>(raw: Partial<PageResult<T>> | null | undefined, map: (row: T) => T): PageResult<T> {
  return {
    total: num(raw?.total),
    pageNum: num(raw?.pageNum, 1),
    pageSize: num(raw?.pageSize, 20),
    records: arr<T>(raw?.records).map(map),
  };
}

function normalizeD1Overview(raw: Record<string, unknown> | null | undefined): D1Overview {
  return {
    channels: arr<Record<string, unknown>>(raw?.channels).map((row) => ({
      id: text(row.id),
      code: text(row.code),
      fee: text(row.fee),
      minAmount: text(row.minAmount),
      enabled: bool(row.enabled, true),
    })),
    primaryPsp: text(raw?.primaryPsp, "Checkout.com"),
    backupPsp: text(raw?.backupPsp, "Stripe"),
    cardParams: arr<Record<string, unknown>>(raw?.cardParams).map((row) => ({
      key: text(row.key),
      name: text(row.name),
      value: text(row.value),
      note: text(row.note),
    })),
    reconciliation: arr<Record<string, unknown>>(raw?.reconciliation).map((row) => ({
      channel: text(row.channel),
      providerCount: num(row.providerCount),
      providerAmount: num(row.providerAmount),
      ledgerCount: num(row.ledgerCount),
      ledgerAmount: num(row.ledgerAmount),
      diffAmount: num(row.diffAmount),
      diff: text(row.diff, "matched"),
      reconciled: bool(row.reconciled),
    })),
    ledgerTotal: num(raw?.ledgerTotal),
    ledgerCount: num(raw?.ledgerCount),
    diffCount: num(raw?.diffCount),
    diffAmount: num(raw?.diffAmount),
    feeBufferUsd: num(raw?.feeBufferUsd),
    bins: arr<Record<string, unknown>>(raw?.bins).map((row) => ({
      segment: text(row.segment),
      meta: text(row.meta),
      fails24h: num(row.fails24h),
      locked: bool(row.locked),
      note: text(row.note),
      manual: bool(row.manual),
    })),
    binLockedCount: num(raw?.binLockedCount),
    chargebacks: arr<Record<string, unknown>>(raw?.chargebacks).map((row) => ({
      caseNo: text(row.caseNo),
      userId: num(row.userId),
      userCode: text(row.userCode),
      amount: num(row.amount),
      reasonCode: text(row.reasonCode),
      enteredStatus: text(row.enteredStatus),
      status: text(row.status),
      createdAt: text(row.createdAt),
      updatedAt: text(row.updatedAt),
    })),
    sources: arr<string>(raw?.sources),
  };
}

function normalizeFlow(row: D1DepositFlow): D1DepositFlow {
  return {
    ...row,
    id: num(row.id),
    userId: num(row.userId),
    amount: num(row.amount),
    providerReceived: num(row.providerReceived),
    depositNo: text(row.depositNo),
    channel: text(row.channel),
    asset: text(row.asset),
    proof: text(row.proof),
    status: text(row.status),
    statusLabel: text(row.statusLabel, row.status),
    createdAt: text(row.createdAt),
    confirmedAt: text(row.confirmedAt, ""),
    creditedAt: text(row.creditedAt, ""),
  };
}

function normalizeWithdrawal(row: D2Withdrawal): D2Withdrawal {
  return {
    ...row,
    id: num(row.id),
    userId: num(row.userId),
    amount: num(row.amount),
    fee: num(row.fee),
    withdrawalNo: text(row.withdrawalNo),
    asset: text(row.asset),
    chain: text(row.chain),
    targetAddress: text(row.targetAddress),
    status: text(row.status),
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt),
    userNo: text(row.userNo, `UID-${num(row.userId)}`),
    nickname: text(row.nickname),
    phoneMasked: text(row.phoneMasked, ""),
    kycStatus: text(row.kycStatus),
    riskScore: num(row.riskScore),
    hitRules: text(row.hitRules, ""),
    withdrawalCount24h: num(row.withdrawalCount24h),
    statusHistory: text(row.statusHistory, ""),
    auditTrail: text(row.auditTrail, ""),
  };
}

function normalizeDualLedger(raw: Record<string, unknown> | null | undefined): D3DualLedger {
  const snapshot = (raw?.snapshot ?? {}) as Record<string, unknown>;
  return {
    generatedAt: text(raw?.generatedAt, ""),
    sources: arr<string>(raw?.sources),
    snapshot: {
      reserveUsd: num(snapshot.reserveUsd),
      liabilitiesUsd: num(snapshot.liabilitiesUsd),
      coverageRatio: num(snapshot.coverageRatio),
      redlinePct: num(snapshot.redlinePct),
      healthyPct: num(snapshot.healthyPct),
      runRiskPct: num(snapshot.runRiskPct),
      redlineBreached: bool(snapshot.redlineBreached),
      netFlow24hUsd: num(snapshot.netFlow24hUsd),
      queueBacklogCount: num(snapshot.queueBacklogCount),
      queueBacklogUsd: num(snapshot.queueBacklogUsd),
      avgRiskScore: num(snapshot.avgRiskScore),
      coverageSeries: arr<unknown>(snapshot.coverageSeries).map((item) => num(item)),
      scope: text(snapshot.scope, "all active liabilities"),
    },
    accounts: arr<Record<string, unknown>>(raw?.accounts).map((row) => ({
      key: text(row.key),
      label: text(row.label),
      amount: num(row.amount),
      source: text(row.source),
    })),
    maturity7d: arr<Record<string, unknown>>(raw?.maturity7d).map((row) => ({
      day: text(row.day),
      withdrawUsd: num(row.withdrawUsd),
      interestUsd: num(row.interestUsd),
      genesisUsd: num(row.genesisUsd),
    })),
    prev: raw?.prev as D3DualLedger["prev"],
  };
}

function normalizeBill(row: D4Bill): D4Bill {
  return {
    ...row,
    id: num(row.id),
    userId: num(row.userId),
    bizNo: text(row.bizNo),
    bizType: text(row.bizType),
    asset: text(row.asset),
    direction: text(row.direction),
    amount: num(row.amount),
    balanceAfter: num(row.balanceAfter),
    status: text(row.status),
    remark: text(row.remark),
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt),
  };
}

function normalizeD5Params(raw: Record<string, unknown> | null | undefined): D5Params {
  return {
    dailyLimitCount: num(raw?.dailyLimitCount, 1),
    maxBalancePct: num(raw?.maxBalancePct),
    maxBalanceRatio: num(raw?.maxBalanceRatio),
    feeRatePct: num(raw?.feeRatePct),
    feeRate: num(raw?.feeRate),
    minUsdt: num(raw?.minUsdt),
    trc20Enabled: bool(raw?.trc20Enabled, true),
    erc20Enabled: bool(raw?.erc20Enabled, true),
    coverageRatio: num(raw?.coverageRatio),
    redlinePct: num(raw?.redlinePct),
    sources: arr<string>(raw?.sources),
    updated: raw?.updated as D5Params["updated"],
  };
}

export async function fetchD1TopupOverview() {
  return normalizeD1Overview(await apiRequest<Record<string, unknown>>("finance", "/topup/overview"));
}

export async function fetchD1TopupFlows(params: { status?: string; keyword?: string; pageNum?: number; pageSize?: number }) {
  return normalizePage(await apiRequest<PageResult<D1DepositFlow>>("finance", `/topup/flows${buildQuery(params)}`), normalizeFlow);
}

export async function updateD1TopupChannelEnabled(channelCode: string, enabled: boolean, reason: string, operator: string) {
  return normalizeD1Overview(await apiRequest<Record<string, unknown>>("finance", `/topup/channels/${encodeURIComponent(channelCode)}/enabled`, {
    method: "PATCH",
    body: JSON.stringify({ enabled, reason, operator }),
    idempotencyPrefix: "d1-channel-enabled",
  }));
}

export async function updateD1TopupChannelFee(channelCode: string, value: string, reason: string, operator: string) {
  return normalizeD1Overview(await apiRequest<Record<string, unknown>>("finance", `/topup/channels/${encodeURIComponent(channelCode)}/fee`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: "d1-channel-fee",
  }));
}

export async function updateD1TopupChannelMin(channelCode: string, value: string, reason: string, operator: string) {
  return normalizeD1Overview(await apiRequest<Record<string, unknown>>("finance", `/topup/channels/${encodeURIComponent(channelCode)}/min-amount`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: "d1-channel-min",
  }));
}

export async function switchD1Psp(value: string, reason: string, operator: string) {
  return normalizeD1Overview(await apiRequest<Record<string, unknown>>("finance", "/topup/psp/primary", {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: "d1-psp",
  }));
}

export async function updateD1CardRisk(key: string, value: string, reason: string, operator: string) {
  return normalizeD1Overview(await apiRequest<Record<string, unknown>>("finance", `/topup/card-risk/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: "d1-card-risk",
  }));
}

export async function writeoffD1Reconciliation(channelCode: string, reason: string, operator: string) {
  return normalizeD1Overview(await apiRequest<Record<string, unknown>>("finance", `/topup/reconciliation/${encodeURIComponent(channelCode)}/writeoff`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "d1-reconcile",
  }));
}

export async function createD1BinLock(segment: string, reason: string, operator: string) {
  return normalizeD1Overview(await apiRequest<Record<string, unknown>>("finance", "/topup/bin-locks", {
    method: "POST",
    body: JSON.stringify({ value: segment, reason, operator }),
    idempotencyPrefix: "d1-bin-create",
  }));
}

export async function setD1BinLock(segment: string, enabled: boolean, reason: string, operator: string) {
  return normalizeD1Overview(await apiRequest<Record<string, unknown>>("finance", `/topup/bin-locks/${encodeURIComponent(segment)}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled, reason, operator }),
    idempotencyPrefix: "d1-bin-state",
  }));
}

export async function refundD1Chargeback(caseNo: string, reason: string, operator: string) {
  return normalizeD1Overview(await apiRequest<Record<string, unknown>>("finance", `/topup/chargebacks/${encodeURIComponent(caseNo)}/refund`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "d1-chargeback",
  }));
}

export async function fetchD2Withdrawals(params: { status?: string; keyword?: string; pageNum?: number; pageSize?: number }) {
  return normalizePage(await apiRequest<PageResult<D2Withdrawal>>("finance", `/withdrawals${buildQuery(params)}`), normalizeWithdrawal);
}

export async function reviewD2Withdrawal(withdrawalNo: string, action: "APPROVE" | "DELAY" | "FREEZE" | "UNFREEZE" | "REJECT", reason: string, operator: string) {
  return normalizeWithdrawal(await apiRequest<D2Withdrawal>("finance", `/withdrawals/${encodeURIComponent(withdrawalNo)}/review`, {
    method: "POST",
    body: JSON.stringify({ action, reason, operator }),
    idempotencyPrefix: "d2-review",
  }));
}

export async function fetchD3DualLedger() {
  return normalizeDualLedger(await apiRequest<Record<string, unknown>>("treasury", "/dual-ledger"));
}

export async function createD3Injection(amount: string, voucherNo: string, reason: string, operator: string) {
  return normalizeDualLedger(await apiRequest<Record<string, unknown>>("treasury", "/injections", {
    method: "POST",
    body: JSON.stringify({ amount, voucherNo, reason, operator }),
    idempotencyPrefix: "d3-injection",
  }));
}

export async function updateD3Scope(scope: string, reason: string, operator: string) {
  return normalizeDualLedger(await apiRequest<Record<string, unknown>>("treasury", "/dual-ledger/scope", {
    method: "PATCH",
    body: JSON.stringify({ scope, reason, operator }),
    idempotencyPrefix: "d3-scope",
  }));
}

export async function updateD3Thresholds(values: { redlinePct?: string; healthyPct?: string; runRiskPct?: string }, reason: string, operator: string) {
  return normalizeDualLedger(await apiRequest<Record<string, unknown>>("treasury", "/dual-ledger/thresholds", {
    method: "PATCH",
    body: JSON.stringify({ ...values, reason, operator }),
    idempotencyPrefix: "d3-thresholds",
  }));
}

export async function fetchD4Bills(params: { type?: string; keyword?: string; pageNum?: number; pageSize?: number }) {
  return normalizePage(await apiRequest<PageResult<D4Bill>>("treasury", `/ledger/bills${buildQuery(params)}`), normalizeBill);
}

export async function fetchD4UserLedger(userId: number) {
  const raw = await apiRequest<Record<string, unknown>>("treasury", `/ledger/users/${encodeURIComponent(String(userId))}`);
  return {
    userId: num(raw?.userId, userId),
    rows: arr<D4Bill>(raw?.rows).map(normalizeBill),
    totals: Object.fromEntries(Object.entries((raw?.sums ?? {}) as Record<string, unknown>).map(([key, value]) => [key, num(value)])),
    balance: {
      USDT: num(raw?.currentUsdtBalance),
      NEX: num(raw?.currentNexBalance),
    },
    sources: arr<string>(raw?.sources),
  } satisfies D4UserLedger;
}

export async function createD4Adjustment(payload: { userId: number; asset: string; direction: string; amount: string; relatedBizNo: string; reason: string; operator: string }) {
  return apiRequest<Record<string, unknown>>("treasury", "/ledger/adjustments", {
    method: "POST",
    body: JSON.stringify(payload),
    idempotencyPrefix: "d4-adjustment",
  });
}

export async function fetchD5WithdrawalParams() {
  return normalizeD5Params(await apiRequest<Record<string, unknown>>("finance", "/withdrawal-params"));
}

export async function updateD5WithdrawalParam(key: "dailyLimitCount" | "balanceMaxRatio" | "networkFee", value: string, reason: string, operator: string) {
  return normalizeD5Params(await apiRequest<Record<string, unknown>>("finance", "/withdrawal-params", {
    method: "PATCH",
    body: JSON.stringify({ key, value, reason, operator }),
    idempotencyPrefix: "d5-withdrawal-param",
  }));
}
