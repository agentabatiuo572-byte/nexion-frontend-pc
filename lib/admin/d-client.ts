import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { normalizeD1NullableString } from "@/lib/admin/d1-nullable-string";
import { formatAdminApiError } from "@/lib/admin/error-messages";

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
  feeValue: number;
  feeUnit: "PERCENT" | "USDT_FIXED";
  minAmountValue: number;
  minAmountUnit: "USD";
}

export interface D1CardParam {
  key: string;
  name: string;
  value: string;
  note: string;
  numericValue: number;
  unit: "USD" | "COUNT" | "HOUR";
  minValue: number;
  maxValue: number;
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
  feeBufferComplete: boolean;
  treasuryReserveComplete: boolean;
  historicalBackfillComplete: boolean;
  feeEvidenceAnomalyCount: number;
  treasuryReserveAnomalyCount: number;
  historicalBackfillAnomalyCount: number;
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
  userStatus: string;
  riskScore: number | null;
  hitRules: string;
  riskReason: string;
  withdrawalCount24h: number;
  statusHistory: string;
  auditTrail: string;
  failureReason: string;
  userLevel: string;
  deviceSummary: string;
  referralPosition: string;
  riskScoreBreakdown: string;
  withdrawalHistory: string;
  penaltyFeeRate: number;
  grossFee: number;
  nexBurned: number;
  nexFeeOffsetRate: number;
  feeWaived: number;
  actualFee: number;
  netReceive: number;
  ipSegment: string;
  holdUntil: string;
  lifecycleOwner: string;
  freezePeriod: string;
  previousStatus: string;
  routingPriority: "ESCALATED" | "HIGH" | "NORMAL" | "LOW" | "UNAVAILABLE";
  k4BandLowMax: number | null;
  k4BandHighMin: number | null;
  k4AutoEscalateScore: number | null;
  k3RiskRoute: string;
}

export type D2ReviewAction = "APPROVE" | "DELAY" | "FREEZE" | "UNFREEZE" | "REJECT" | "REFUND";

export interface D2ReviewInput {
  reason: string;
  reasonCode?: string;
  holdDays?: number;
  period?: string;
  owner?: string;
  reviewAt?: string;
  fundsVerified?: boolean;
  addressVerified?: boolean;
}

export interface D2BatchResult {
  batchId: string;
  accepted: string[];
  rejected: string[];
  conflicts: Array<{ withdrawalId: string; reason: string }>;
  reason: string;
}

export interface D3WaterLevel {
  tier: "NORMAL" | "WATCH" | "WARNING" | "DANGER";
  color: string;
  reserveCoverDays: number;
  dailyAverageDueUsdt: number;
  suggestedAction: string;
  notification: string;
  thresholds: Array<{ tier: "NORMAL" | "WATCH" | "WARNING" | "DANGER"; condition: string }>;
}

export interface D3Reserve {
  usdtReserveUsdt: number;
  otherLiquidUsdt: number;
  injectedCumulativeUsdt: number;
  lockedStakingPrincipalDeductedUsdt: number;
  reserveTotalUsdt: number;
  asOf: string;
  waterLevel: D3WaterLevel;
  sources: string[];
}

export interface D3Liabilities {
  totalUsdt: number;
  hardLiabilityCategoryCount: number;
  trialShadowIncluded: boolean;
  asOf: string;
  breakdown: Array<{ category: string; label: string; amountUsdt: number; share: number; source: string }>;
  sources: string[];
}

export interface D3MaturityForecast {
  window: "7d" | "30d";
  daily: Array<{
    date: string;
    withdrawDueUsdt: number;
    interestDueUsdt: number;
    genesisDividendUsdt: number;
    trialShadowStressUsdt: number;
    totalDueUsdt: number;
  }>;
  cumulative: Array<{ date: string; amountUsdt: number }>;
  cumulativeUsdt: number;
  reserveCoverDays: number;
  farLiabilityExcluded: boolean;
  farLiabilityNote: string;
  trialStressIncluded: boolean;
  asOf: string;
}

export interface D3NetExposure {
  window: "7d" | "30d" | "90d";
  series: Array<{
    date: string;
    reserveUsdt: number;
    liabilitiesUsdt: number;
    netExposureUsdt: number;
    negative: boolean;
  }>;
  asOf: string;
}

export interface D3ForecastConfig {
  reserveCategories: Record<string, boolean>;
  liabilityCategories: Record<string, boolean>;
  forecastWindow: "7d" | "30d" | "90d";
  genesisIncluded: boolean;
  includeFarLiabilities: boolean;
  stakingInterestMode: "LINEAR" | "AT_MATURITY";
  trialStressEnabled: boolean;
  version: number;
  effectiveRule: string;
  pendingConfig?: {
    reserveCategories: Record<string, boolean>;
    liabilityCategories: Record<string, boolean>;
    forecastWindow: "7d" | "30d" | "90d";
    genesisIncluded: boolean;
    includeFarLiabilities: boolean;
    stakingInterestMode: "LINEAR" | "AT_MATURITY";
    trialStressEnabled: boolean;
  };
  pendingEffectiveAt?: string;
  pendingVersion?: number;
  effectiveVersion: number;
}

export interface D3Dashboard {
  reserve: D3Reserve;
  liabilities: D3Liabilities;
  maturity: D3MaturityForecast;
  exposure: D3NetExposure;
  config: D3ForecastConfig;
}

export interface D4Bill {
  id: number;
  userId: number;
  userNo: string;
  nickname: string;
  bizNo: string;
  bizType: string;
  billType: D4BillType;
  subtype: string;
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
  userNo: string;
  nickname: string;
  rows: D4Bill[];
  total: number;
  totals: Record<string, number>;
  categoryTotals: Record<string, number>;
  balance: Record<string, number>;
  sources: string[];
}

export type D4BillType = "swap" | "topup" | "withdraw" | "earning" | "commission" | "refund" | "bonus";

export interface D4RunningBalanceRow {
  bill: D4Bill;
  expectedBalanceAfter: number;
  difference: number;
  breakDetected: boolean;
}

export interface D4RunningBalance {
  userId: number;
  total: number;
  rows: D4RunningBalanceRow[];
  breakCount: number;
  reconciliation: Record<"USDT" | "NEX", number>;
  balanced: boolean;
  sources: string[];
}

export interface D5Params {
  version: number;
  dailyLimitCount: number;
  maxBalanceRatio: number;
  networkFeeRatio: number;
  networkFeeMin: number;
  networkFeeMax: number;
  nexFeeOffsetRate: number;
  cooldownDays: number;
  penaltyFeeRate: number;
  complianceHoldEnabled: boolean;
  currentPhase: string;
  currentMonth: number;
  coverageRatio: number;
  redlinePct: number;
  coverageReliable: boolean;
  sourceByField: Record<string, "d5" | "phase-h1">;
  updatedFields?: string[];
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

function userNoOf(value: unknown) {
  const id = Math.trunc(num(value));
  return id > 0 ? `U${String(id).padStart(8, "0")}` : "—";
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

async function apiRequest<T>(base: "finance" | "treasury" | "bills" | "withdraw", path: string, init?: RequestInit & { idempotencyPrefix?: string; idempotencyKey?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.idempotencyKey || init?.idempotencyPrefix) {
    headers.set("Idempotency-Key", init.idempotencyKey || nextId(init.idempotencyPrefix!));
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
    throw new Error(formatAdminApiError(result?.message, `D_REQUEST_FAILED_${response.status}`));
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

function d1Invalid(field: string): never {
  throw new Error(formatAdminApiError("D1_RESPONSE_INVALID", `D1_RESPONSE_INVALID:${field}`));
}

function d1Object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) d1Invalid(field);
  return value as Record<string, unknown>;
}

function d1String(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) d1Invalid(field);
  return value;
}

function d1OptionalString(value: unknown, field: string): string {
  return normalizeD1NullableString(value, field, d1Invalid);
}

function d1Number(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) d1Invalid(field);
  return parsed;
}

function d1Boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") d1Invalid(field);
  return value;
}

function d1Array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) d1Invalid(field);
  return value;
}

function d2Number(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new Error(formatAdminApiError("D2_RESPONSE_INVALID", `D2_RESPONSE_INVALID:${field}`));
  }
  return parsed;
}

function d2NullableNumber(value: unknown, field = "riskScore"): number | null {
  return value === null || value === undefined || value === "" ? null : d2Number(value, field);
}

function d2RoutingPriority(value: unknown): D2Withdrawal["routingPriority"] {
  const priority = String(value ?? "").trim().toUpperCase();
  if (!["ESCALATED", "HIGH", "NORMAL", "LOW", "UNAVAILABLE"].includes(priority)) {
    throw new Error(formatAdminApiError("D2_RESPONSE_INVALID", "D2_RESPONSE_INVALID:routingPriority"));
  }
  return priority as D2Withdrawal["routingPriority"];
}

function d5Number(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new Error(formatAdminApiError("D5_RESPONSE_INVALID", `D5_RESPONSE_INVALID:${field}`));
  }
  return parsed;
}

function d5Object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(formatAdminApiError("D5_RESPONSE_INVALID", `D5_RESPONSE_INVALID:${field}`));
  }
  return value as Record<string, unknown>;
}

function d5Integer(value: unknown, field: string, min = 0): number {
  const parsed = d5Number(value, field);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(formatAdminApiError("D5_RESPONSE_INVALID", `D5_RESPONSE_INVALID:${field}`));
  }
  return parsed;
}

function d5Boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(formatAdminApiError("D5_RESPONSE_INVALID", `D5_RESPONSE_INVALID:${field}`));
  }
  return value;
}

function d5String(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(formatAdminApiError("D5_RESPONSE_INVALID", `D5_RESPONSE_INVALID:${field}`));
  }
  return value.trim();
}

function requireD1Overview(raw: Record<string, unknown> | null | undefined): D1Overview {
  const root = d1Object(raw, "overview");
  return {
    channels: d1Array(root.channels, "channels").map((item, index) => {
      const row = d1Object(item, `channels[${index}]`);
      const feeUnit = d1String(row.feeUnit, `channels[${index}].feeUnit`);
      const minUnit = d1String(row.minAmountUnit, `channels[${index}].minAmountUnit`);
      if (!(["PERCENT", "USDT_FIXED"] as string[]).includes(feeUnit) || minUnit !== "USD") d1Invalid(`channels[${index}].unit`);
      return {
      id: d1String(row.id, `channels[${index}].id`),
      code: d1String(row.code, `channels[${index}].code`),
      fee: d1String(row.fee, `channels[${index}].fee`),
      minAmount: d1String(row.minAmount, `channels[${index}].minAmount`),
      enabled: d1Boolean(row.enabled, `channels[${index}].enabled`),
      feeValue: d1Number(row.feeValue, `channels[${index}].feeValue`),
      feeUnit: feeUnit as D1Channel["feeUnit"],
      minAmountValue: d1Number(row.minAmountValue, `channels[${index}].minAmountValue`),
      minAmountUnit: minUnit as "USD",
    };
    }),
    primaryPsp: d1String(root.primaryPsp, "primaryPsp"),
    backupPsp: d1String(root.backupPsp, "backupPsp"),
    cardParams: d1Array(root.cardParams, "cardParams").map((item, index) => {
      const row = d1Object(item, `cardParams[${index}]`);
      const unit = d1String(row.unit, `cardParams[${index}].unit`);
      if (!(["USD", "COUNT", "HOUR"] as string[]).includes(unit)) d1Invalid(`cardParams[${index}].unit`);
      return {
      key: d1String(row.key, `cardParams[${index}].key`),
      name: d1String(row.name, `cardParams[${index}].name`),
      value: d1String(row.value, `cardParams[${index}].value`),
      note: d1String(row.note, `cardParams[${index}].note`),
      numericValue: d1Number(row.numericValue, `cardParams[${index}].numericValue`),
      unit: unit as D1CardParam["unit"],
      minValue: d1Number(row.minValue, `cardParams[${index}].minValue`),
      maxValue: d1Number(row.maxValue, `cardParams[${index}].maxValue`),
    };
    }),
    reconciliation: d1Array(root.reconciliation, "reconciliation").map((item, index) => {
      const row = d1Object(item, `reconciliation[${index}]`);
      return {
      channel: d1String(row.channel, `reconciliation[${index}].channel`),
      providerCount: d1Number(row.providerCount, `reconciliation[${index}].providerCount`),
      providerAmount: d1Number(row.providerAmount, `reconciliation[${index}].providerAmount`),
      ledgerCount: d1Number(row.ledgerCount, `reconciliation[${index}].ledgerCount`),
      ledgerAmount: d1Number(row.ledgerAmount, `reconciliation[${index}].ledgerAmount`),
      diffAmount: d1Number(row.diffAmount, `reconciliation[${index}].diffAmount`),
      // A fully matched row is represented by the backend with diff=null.
      // Normalize that explicit absence to an empty display value while still
      // rejecting every other malformed type.
      diff: d1OptionalString(row.diff, `reconciliation[${index}].diff`),
      reconciled: d1Boolean(row.reconciled, `reconciliation[${index}].reconciled`),
    };
    }),
    ledgerTotal: d1Number(root.ledgerTotal, "ledgerTotal"),
    ledgerCount: d1Number(root.ledgerCount, "ledgerCount"),
    diffCount: d1Number(root.diffCount, "diffCount"),
    diffAmount: d1Number(root.diffAmount, "diffAmount"),
    feeBufferUsd: d1Number(root.feeBufferUsd, "feeBufferUsd"),
    feeBufferComplete: d1Boolean(root.feeBufferComplete, "feeBufferComplete"),
    treasuryReserveComplete: d1Boolean(root.treasuryReserveComplete, "treasuryReserveComplete"),
    historicalBackfillComplete: d1Boolean(root.historicalBackfillComplete, "historicalBackfillComplete"),
    feeEvidenceAnomalyCount: d1Number(root.feeEvidenceAnomalyCount, "feeEvidenceAnomalyCount"),
    treasuryReserveAnomalyCount: d1Number(root.treasuryReserveAnomalyCount, "treasuryReserveAnomalyCount"),
    historicalBackfillAnomalyCount: d1Number(root.historicalBackfillAnomalyCount, "historicalBackfillAnomalyCount"),
    bins: d1Array(root.bins, "bins").map((item, index) => {
      const row = d1Object(item, `bins[${index}]`);
      return {
      segment: d1String(row.segment, `bins[${index}].segment`),
      meta: d1String(row.meta, `bins[${index}].meta`),
      fails24h: d1Number(row.fails24h, `bins[${index}].fails24h`),
      locked: d1Boolean(row.locked, `bins[${index}].locked`),
      note: d1String(row.note, `bins[${index}].note`),
      manual: d1Boolean(row.manual, `bins[${index}].manual`),
    };
    }),
    binLockedCount: d1Number(root.binLockedCount, "binLockedCount"),
    chargebacks: d1Array(root.chargebacks, "chargebacks").map((item, index) => {
      const row = d1Object(item, `chargebacks[${index}]`);
      return {
      caseNo: d1String(row.caseNo, `chargebacks[${index}].caseNo`),
      userId: d1Number(row.userId, `chargebacks[${index}].userId`),
      userCode: d1String(row.userCode, `chargebacks[${index}].userCode`),
      amount: d1Number(row.amount, `chargebacks[${index}].amount`),
      reasonCode: d1String(row.reasonCode, `chargebacks[${index}].reasonCode`),
      enteredStatus: d1String(row.enteredStatus, `chargebacks[${index}].enteredStatus`),
      status: d1String(row.status, `chargebacks[${index}].status`),
      createdAt: d1String(row.createdAt, `chargebacks[${index}].createdAt`),
      updatedAt: d1String(row.updatedAt, `chargebacks[${index}].updatedAt`),
    };
    }),
    sources: d1Array(root.sources, "sources").map((value, index) => d1String(value, `sources[${index}]`)),
  };
}

function requireD1Flow(value: unknown, index: number): D1DepositFlow {
  const row = d1Object(value, `flows.records[${index}]`);
  return {
    id: d1Number(row.id, `flows.records[${index}].id`),
    userId: d1Number(row.userId, `flows.records[${index}].userId`),
    amount: d1Number(row.amount, `flows.records[${index}].amount`),
    providerReceived: d1Number(row.providerReceived, `flows.records[${index}].providerReceived`),
    depositNo: d1String(row.depositNo, `flows.records[${index}].depositNo`),
    channel: d1String(row.channel, `flows.records[${index}].channel`),
    asset: d1String(row.asset, `flows.records[${index}].asset`),
    proof: d1String(row.proof, `flows.records[${index}].proof`),
    status: d1String(row.status, `flows.records[${index}].status`),
    statusLabel: d1String(row.statusLabel, `flows.records[${index}].statusLabel`),
    createdAt: d1String(row.createdAt, `flows.records[${index}].createdAt`),
    confirmedAt: d1OptionalString(row.confirmedAt, `flows.records[${index}].confirmedAt`),
    creditedAt: d1OptionalString(row.creditedAt, `flows.records[${index}].creditedAt`),
  };
}

function requireD1FlowsPage(raw: unknown): PageResult<D1DepositFlow> {
  const page = d1Object(raw, "flows");
  return {
    total: d1Number(page.total, "flows.total"),
    pageNum: d1Number(page.pageNum, "flows.pageNum"),
    pageSize: d1Number(page.pageSize, "flows.pageSize"),
    records: d1Array(page.records, "flows.records").map(requireD1Flow),
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
    userNo: text(row.userNo, userNoOf(row.userId)),
    nickname: text(row.nickname),
    phoneMasked: text(row.phoneMasked, ""),
    kycStatus: text(row.kycStatus),
    userStatus: text(row.userStatus, "UNKNOWN"),
    riskScore: d2NullableNumber(row.riskScore),
    hitRules: text(row.hitRules, ""),
    riskReason: text(row.riskReason, ""),
    withdrawalCount24h: num(row.withdrawalCount24h),
    statusHistory: text(row.statusHistory, ""),
    auditTrail: text(row.auditTrail, ""),
    failureReason: text(row.failureReason, ""),
    userLevel: text(row.userLevel, "—"),
    deviceSummary: text(row.deviceSummary, "无设备事实"),
    referralPosition: text(row.referralPosition, "无推荐关系"),
    riskScoreBreakdown: text(row.riskScoreBreakdown, "无评分明细"),
    withdrawalHistory: text(row.withdrawalHistory, "无历史提现"),
    penaltyFeeRate: d2Number(row.penaltyFeeRate, "withdrawal.penaltyFeeRate"),
    grossFee: d2Number(row.grossFee, "withdrawal.grossFee"),
    nexBurned: d2Number(row.nexBurned, "withdrawal.nexBurned"),
    nexFeeOffsetRate: d2Number(row.nexFeeOffsetRate, "withdrawal.nexFeeOffsetRate"),
    feeWaived: d2Number(row.feeWaived, "withdrawal.feeWaived"),
    actualFee: d2Number(row.actualFee, "withdrawal.actualFee"),
    netReceive: d2Number(row.netReceive, "withdrawal.netReceive"),
    ipSegment: text(row.ipSegment, "—"),
    holdUntil: text(row.holdUntil, ""),
    lifecycleOwner: text(row.lifecycleOwner, ""),
    freezePeriod: text(row.freezePeriod, ""),
    previousStatus: text(row.previousStatus, ""),
    routingPriority: d2RoutingPriority(row.routingPriority),
    k4BandLowMax: d2NullableNumber(row.k4BandLowMax, "k4BandLowMax"),
    k4BandHighMin: d2NullableNumber(row.k4BandHighMin, "k4BandHighMin"),
    k4AutoEscalateScore: d2NullableNumber(row.k4AutoEscalateScore, "k4AutoEscalateScore"),
    k3RiskRoute: text(row.k3RiskRoute, ""),
  };
}

function d3Invalid(field: string): never {
  throw new Error(formatAdminApiError("D3_RESPONSE_INVALID", `D3_RESPONSE_INVALID:${field}`));
}

function d3Object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) d3Invalid(field);
  return value as Record<string, unknown>;
}

function d3String(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) d3Invalid(field);
  return value.trim();
}

function d3Number(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) d3Invalid(field);
  return parsed;
}

function d3Boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") d3Invalid(field);
  return value;
}

function d3Array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) d3Invalid(field);
  return value;
}

function d3StringArray(value: unknown, field: string): string[] {
  return d3Array(value, field).map((item, index) => d3String(item, `${field}[${index}]`));
}

const D3_RESERVE_KEYS = ["usdt", "otherLiquid"] as const;
const D3_LIABILITY_KEYS = [
  "withdrawable_balance", "usdt_staking_principal", "staking_interest", "genesis_daily_emission",
  "nex_v2_future", "withdrawal_queue", "commission_cooling", "lock_other",
] as const;
const D3_WATER_TIERS = ["NORMAL", "WATCH", "WARNING", "DANGER"] as const;

function d3BooleanRecord(value: unknown, field: string, expectedKeys: readonly string[]): Record<string, boolean> {
  const root = d3Object(value, field);
  const keys = Object.keys(root);
  if (keys.length !== expectedKeys.length || expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(root, key))) d3Invalid(field);
  return Object.fromEntries(expectedKeys.map((key) => [key, d3Boolean(root[key], `${field}.${key}`)]));
}

function d3Near(left: number, right: number, tolerance = 0.011) {
  return Math.abs(left - right) <= tolerance;
}

function d3AssertDateSeries(rows: Array<{ date: string }>, expectedLength: number, field: string) {
  if (rows.length !== expectedLength) d3Invalid(`${field}.length`);
  let previous = 0;
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || seen.has(row.date)) d3Invalid(`${field}[${index}].date`);
    const current = Date.parse(`${row.date}T00:00:00Z`);
    if (!Number.isFinite(current) || (index > 0 && current - previous !== 86_400_000)) d3Invalid(`${field}[${index}].date`);
    seen.add(row.date);
    previous = current;
  });
}

function normalizeD3Reserve(raw: Record<string, unknown>): D3Reserve {
  const water = d3Object(raw.waterLevel, "reserve.waterLevel");
  const tier = d3String(water.tier, "reserve.waterLevel.tier");
  if (!( ["NORMAL", "WATCH", "WARNING", "DANGER"] as string[]).includes(tier)) d3Invalid("reserve.waterLevel.tier");
  const usdtReserveUsdt = d3Number(raw.usdtReserveUsdt, "reserve.usdtReserveUsdt");
  const otherLiquidUsdt = d3Number(raw.otherLiquidUsdt, "reserve.otherLiquidUsdt");
  const injectedCumulativeUsdt = d3Number(raw.injectedCumulativeUsdt, "reserve.injectedCumulativeUsdt");
  const lockedStakingPrincipalDeductedUsdt = d3Number(raw.lockedStakingPrincipalDeductedUsdt, "reserve.lockedStakingPrincipalDeductedUsdt");
  const reserveTotalUsdt = d3Number(raw.reserveTotalUsdt, "reserve.reserveTotalUsdt");
  if ([usdtReserveUsdt, otherLiquidUsdt, injectedCumulativeUsdt, lockedStakingPrincipalDeductedUsdt, reserveTotalUsdt].some((value) => value < 0)
      || !d3Near(usdtReserveUsdt + otherLiquidUsdt, reserveTotalUsdt)) d3Invalid("reserve.arithmetic");
  const thresholds = d3Array(water.thresholds, "reserve.waterLevel.thresholds").map((item, index) => {
    const row = d3Object(item, `reserve.waterLevel.thresholds[${index}]`);
    const rowTier = d3String(row.tier, `reserve.waterLevel.thresholds[${index}].tier`);
    if (!(D3_WATER_TIERS as readonly string[]).includes(rowTier)) d3Invalid(`reserve.waterLevel.thresholds[${index}].tier`);
    return { tier: rowTier as D3WaterLevel["tier"], condition: d3String(row.condition, `reserve.waterLevel.thresholds[${index}].condition`) };
  });
  if (thresholds.length !== 4 || new Set(thresholds.map((row) => row.tier)).size !== 4
      || D3_WATER_TIERS.some((expected) => !thresholds.some((row) => row.tier === expected))) d3Invalid("reserve.waterLevel.thresholds");
  return {
    usdtReserveUsdt,
    otherLiquidUsdt,
    injectedCumulativeUsdt,
    lockedStakingPrincipalDeductedUsdt,
    reserveTotalUsdt,
    asOf: d3String(raw.asOf, "reserve.asOf"),
    sources: d3StringArray(raw.sources, "reserve.sources"),
    waterLevel: {
      tier: tier as D3WaterLevel["tier"],
      color: d3String(water.color, "reserve.waterLevel.color"),
      reserveCoverDays: d3Number(water.reserveCoverDays, "reserve.waterLevel.reserveCoverDays"),
      dailyAverageDueUsdt: d3Number(water.dailyAverageDueUsdt, "reserve.waterLevel.dailyAverageDueUsdt"),
      suggestedAction: d3String(water.suggestedAction, "reserve.waterLevel.suggestedAction"),
      notification: d3String(water.notification, "reserve.waterLevel.notification"),
      thresholds,
    },
  };
}

function normalizeD3Liabilities(raw: Record<string, unknown>): D3Liabilities {
  const totalUsdt = d3Number(raw.totalUsdt, "liabilities.totalUsdt");
  const hardLiabilityCategoryCount = d3Number(raw.hardLiabilityCategoryCount, "liabilities.hardLiabilityCategoryCount");
  const breakdown = d3Array(raw.breakdown, "liabilities.breakdown").map((item, index) => {
    const row = d3Object(item, `liabilities.breakdown[${index}]`);
    const normalized = {
      category: d3String(row.category, `liabilities.breakdown[${index}].category`),
      label: d3String(row.label, `liabilities.breakdown[${index}].label`),
      amountUsdt: d3Number(row.amountUsdt, `liabilities.breakdown[${index}].amountUsdt`),
      share: d3Number(row.share, `liabilities.breakdown[${index}].share`),
      source: d3String(row.source, `liabilities.breakdown[${index}].source`),
    };
    if (normalized.amountUsdt < 0 || normalized.share < 0 || normalized.share > 1) d3Invalid(`liabilities.breakdown[${index}].range`);
    return normalized;
  });
  const categories = breakdown.map((row) => row.category);
  const amountTotal = breakdown.reduce((sum, row) => sum + row.amountUsdt, 0);
  const shareTotal = breakdown.reduce((sum, row) => sum + row.share, 0);
  if (totalUsdt < 0 || hardLiabilityCategoryCount !== 8 || breakdown.length !== 8
      || new Set(categories).size !== 8 || D3_LIABILITY_KEYS.some((key) => !categories.includes(key))
      || !d3Near(amountTotal, totalUsdt)
      || (totalUsdt > 0 && Math.abs(shareTotal - 1) > 0.001)) d3Invalid("liabilities.invariants");
  return {
    totalUsdt,
    hardLiabilityCategoryCount,
    trialShadowIncluded: d3Boolean(raw.trialShadowIncluded, "liabilities.trialShadowIncluded"),
    asOf: d3String(raw.asOf, "liabilities.asOf"),
    breakdown,
    sources: d3StringArray(raw.sources, "liabilities.sources"),
  };
}

function normalizeD3Maturity(raw: Record<string, unknown>): D3MaturityForecast {
  const window = d3String(raw.window, "maturity.window");
  if (!( ["7d", "30d"] as string[]).includes(window)) d3Invalid("maturity.window");
  const daily = d3Array(raw.daily, "maturity.daily").map((item, index) => {
      const row = d3Object(item, `maturity.daily[${index}]`);
      const normalized = {
        date: d3String(row.date, `maturity.daily[${index}].date`),
        withdrawDueUsdt: d3Number(row.withdrawDueUsdt, `maturity.daily[${index}].withdrawDueUsdt`),
        interestDueUsdt: d3Number(row.interestDueUsdt, `maturity.daily[${index}].interestDueUsdt`),
        genesisDividendUsdt: d3Number(row.genesisDividendUsdt, `maturity.daily[${index}].genesisDividendUsdt`),
        trialShadowStressUsdt: d3Number(row.trialShadowStressUsdt, `maturity.daily[${index}].trialShadowStressUsdt`),
        totalDueUsdt: d3Number(row.totalDueUsdt, `maturity.daily[${index}].totalDueUsdt`),
      };
      const parts = normalized.withdrawDueUsdt + normalized.interestDueUsdt + normalized.genesisDividendUsdt + normalized.trialShadowStressUsdt;
      if ([normalized.withdrawDueUsdt, normalized.interestDueUsdt, normalized.genesisDividendUsdt, normalized.trialShadowStressUsdt].some((value) => value < 0)
          || !d3Near(parts, normalized.totalDueUsdt)) d3Invalid(`maturity.daily[${index}].arithmetic`);
      return normalized;
    });
  const cumulative = d3Array(raw.cumulative, "maturity.cumulative").map((item, index) => {
      const row = d3Object(item, `maturity.cumulative[${index}]`);
      return { date: d3String(row.date, `maturity.cumulative[${index}].date`), amountUsdt: d3Number(row.amountUsdt, `maturity.cumulative[${index}].amountUsdt`) };
    });
  const expectedLength = window === "7d" ? 7 : 30;
  d3AssertDateSeries(daily, expectedLength, "maturity.daily");
  d3AssertDateSeries(cumulative, expectedLength, "maturity.cumulative");
  let running = 0;
  daily.forEach((row, index) => {
    running += row.totalDueUsdt;
    if (cumulative[index].date !== row.date || !d3Near(cumulative[index].amountUsdt, running)) d3Invalid(`maturity.cumulative[${index}].arithmetic`);
  });
  const cumulativeUsdt = d3Number(raw.cumulativeUsdt, "maturity.cumulativeUsdt");
  if (!d3Near(cumulativeUsdt, running)) d3Invalid("maturity.cumulativeUsdt");
  return {
    window: window as D3MaturityForecast["window"],
    daily,
    cumulative,
    cumulativeUsdt,
    reserveCoverDays: d3Number(raw.reserveCoverDays, "maturity.reserveCoverDays"),
    farLiabilityExcluded: d3Boolean(raw.farLiabilityExcluded, "maturity.farLiabilityExcluded"),
    farLiabilityNote: d3String(raw.farLiabilityNote, "maturity.farLiabilityNote"),
    trialStressIncluded: d3Boolean(raw.trialStressIncluded, "maturity.trialStressIncluded"),
    asOf: d3String(raw.asOf, "maturity.asOf"),
  };
}

function normalizeD3Exposure(raw: Record<string, unknown>): D3NetExposure {
  const window = d3String(raw.window, "exposure.window");
  if (!( ["7d", "30d", "90d"] as string[]).includes(window)) d3Invalid("exposure.window");
  const series = d3Array(raw.series, "exposure.series").map((item, index) => {
      const row = d3Object(item, `exposure.series[${index}]`);
      const normalized = {
        date: d3String(row.date, `exposure.series[${index}].date`),
        reserveUsdt: d3Number(row.reserveUsdt, `exposure.series[${index}].reserveUsdt`),
        liabilitiesUsdt: d3Number(row.liabilitiesUsdt, `exposure.series[${index}].liabilitiesUsdt`),
        netExposureUsdt: d3Number(row.netExposureUsdt, `exposure.series[${index}].netExposureUsdt`),
        negative: d3Boolean(row.negative, `exposure.series[${index}].negative`),
      };
      if (normalized.reserveUsdt < 0 || normalized.liabilitiesUsdt < 0
          || !d3Near(normalized.reserveUsdt - normalized.liabilitiesUsdt, normalized.netExposureUsdt)
          || normalized.negative !== (normalized.netExposureUsdt < 0)) d3Invalid(`exposure.series[${index}].arithmetic`);
      return normalized;
    });
  d3AssertDateSeries(series, Number(window.slice(0, -1)), "exposure.series");
  return {
    window: window as D3NetExposure["window"],
    series,
    asOf: d3String(raw.asOf, "exposure.asOf"),
  };
}

function normalizeD3ForecastConfig(raw: Record<string, unknown>): D3ForecastConfig {
  const window = d3String(raw.forecastWindow, "config.forecastWindow");
  const mode = d3String(raw.stakingInterestMode, "config.stakingInterestMode");
  if (!( ["7d", "30d", "90d"] as string[]).includes(window)) d3Invalid("config.forecastWindow");
  if (!( ["LINEAR", "AT_MATURITY"] as string[]).includes(mode)) d3Invalid("config.stakingInterestMode");
  let pendingConfig: D3ForecastConfig["pendingConfig"];
  let pendingEffectiveAt: string | undefined;
  if (raw.pendingConfig !== undefined) {
    const pending = d3Object(raw.pendingConfig, "config.pendingConfig");
    const pendingWindow = d3String(pending.forecastWindow, "config.pendingConfig.forecastWindow");
    const pendingMode = d3String(pending.stakingInterestMode, "config.pendingConfig.stakingInterestMode");
    if (!( ["7d", "30d", "90d"] as string[]).includes(pendingWindow)) d3Invalid("config.pendingConfig.forecastWindow");
    if (!( ["LINEAR", "AT_MATURITY"] as string[]).includes(pendingMode)) d3Invalid("config.pendingConfig.stakingInterestMode");
    pendingConfig = {
      reserveCategories: d3BooleanRecord(pending.reserveCategories, "config.pendingConfig.reserveCategories", D3_RESERVE_KEYS),
      liabilityCategories: d3BooleanRecord(pending.liabilityCategories, "config.pendingConfig.liabilityCategories", D3_LIABILITY_KEYS),
      forecastWindow: pendingWindow as D3ForecastConfig["forecastWindow"],
      genesisIncluded: d3Boolean(pending.genesisIncluded, "config.pendingConfig.genesisIncluded"),
      includeFarLiabilities: d3Boolean(pending.includeFarLiabilities, "config.pendingConfig.includeFarLiabilities"),
      stakingInterestMode: pendingMode as D3ForecastConfig["stakingInterestMode"],
      trialStressEnabled: d3Boolean(pending.trialStressEnabled, "config.pendingConfig.trialStressEnabled"),
    };
    pendingEffectiveAt = d3String(raw.pendingEffectiveAt, "config.pendingEffectiveAt");
  }
  const version = d3Number(raw.version, "config.version");
  const effectiveVersion = d3Number(raw.effectiveVersion, "config.effectiveVersion");
  const pendingVersion = raw.pendingVersion === undefined ? undefined : d3Number(raw.pendingVersion, "config.pendingVersion");
  if (!Number.isInteger(version) || !Number.isInteger(effectiveVersion) || version < 0 || effectiveVersion < 0 || effectiveVersion > version
      || (pendingConfig && (pendingVersion === undefined || pendingVersion !== version))
      || (!pendingConfig && pendingVersion !== undefined)) d3Invalid("config.versionInvariant");
  return {
    reserveCategories: d3BooleanRecord(raw.reserveCategories, "config.reserveCategories", D3_RESERVE_KEYS),
    liabilityCategories: d3BooleanRecord(raw.liabilityCategories, "config.liabilityCategories", D3_LIABILITY_KEYS),
    forecastWindow: window as D3ForecastConfig["forecastWindow"],
    genesisIncluded: d3Boolean(raw.genesisIncluded, "config.genesisIncluded"),
    includeFarLiabilities: d3Boolean(raw.includeFarLiabilities, "config.includeFarLiabilities"),
    stakingInterestMode: mode as D3ForecastConfig["stakingInterestMode"],
    trialStressEnabled: d3Boolean(raw.trialStressEnabled, "config.trialStressEnabled"),
    version,
    effectiveVersion,
    effectiveRule: d3String(raw.effectiveRule, "config.effectiveRule"),
    pendingConfig,
    pendingEffectiveAt,
    pendingVersion,
  };
}

const D4_BILL_TYPES = new Set<D4BillType>(["swap", "topup", "withdraw", "earning", "commission", "refund", "bonus"]);

function d4Invalid(field: string): never {
  throw new Error(formatAdminApiError("D4_RESPONSE_INVALID", `D4_RESPONSE_INVALID:${field}`));
}

function d4Object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) d4Invalid(field);
  return value as Record<string, unknown>;
}

function d4String(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) d4Invalid(field);
  return value;
}

function d4OptionalString(value: unknown, field: string): string {
  if (value === null || value === undefined) return "";
  return d4String(value, field, true);
}

function d4Number(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) d4Invalid(field);
  return parsed;
}

function d4Integer(value: unknown, field: string, min = 0): number {
  const parsed = d4Number(value, field);
  if (!Number.isInteger(parsed) || parsed < min) d4Invalid(field);
  return parsed;
}

function d4Boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") d4Invalid(field);
  return value;
}

function normalizeBill(value: unknown): D4Bill {
  const row = d4Object(value, "bill");
  const billType = d4String(row.billType, "bill.billType") as D4BillType;
  if (!D4_BILL_TYPES.has(billType)) d4Invalid("bill.billType");
  const asset = d4String(row.asset, "bill.asset").toUpperCase();
  if (!["USDT", "NEX"].includes(asset)) d4Invalid("bill.asset");
  const direction = d4String(row.direction, "bill.direction").toUpperCase();
  if (!["IN", "OUT", "CREDIT", "DEBIT"].includes(direction)) d4Invalid("bill.direction");
  const amount = d4Number(row.amount, "bill.amount");
  if (amount < 0) d4Invalid("bill.amount");
  return {
    id: d4Integer(row.id, "bill.id", 1),
    userId: d4Integer(row.userId, "bill.userId", 0),
    userNo: d4String(row.userNo, "bill.userNo"),
    nickname: d4OptionalString(row.nickname, "bill.nickname"),
    bizNo: d4String(row.bizNo, "bill.bizNo"),
    bizType: d4String(row.bizType, "bill.bizType"),
    billType,
    subtype: d4String(row.subtype, "bill.subtype"),
    asset,
    direction,
    amount,
    balanceAfter: d4Number(row.balanceAfter, "bill.balanceAfter"),
    status: d4String(row.status, "bill.status"),
    remark: d4OptionalString(row.remark, "bill.remark"),
    createdAt: d4String(row.createdAt, "bill.createdAt"),
    updatedAt: d4String(row.updatedAt, "bill.updatedAt"),
  };
}

function normalizeD4Page(value: unknown): PageResult<D4Bill> {
  const raw = d4Object(value, "page");
  if (!Array.isArray(raw.records)) d4Invalid("page.records");
  return {
    total: d4Integer(raw.total, "page.total"),
    pageNum: d4Integer(raw.pageNum, "page.pageNum", 1),
    pageSize: d4Integer(raw.pageSize, "page.pageSize", 1),
    records: raw.records.map(normalizeBill),
  };
}

function normalizeD5Params(value: unknown): D5Params {
  const raw = d5Object(value, "root");
  const source = d5Object(raw.sourceByField, "sourceByField");
  const sourceKeys = [
    "dailyLimitCount", "balanceMaxRatio", "networkFeeRatio", "networkFeeMin", "networkFeeMax",
    "nexFeeOffsetRate", "cooldownDays", "penaltyFeeRate", "complianceHoldEnabled",
  ];
  const sourceByField: Record<string, "d5" | "phase-h1"> = {};
  sourceKeys.forEach((key) => {
    const item = d5String(source[key], `sourceByField.${key}`);
    if (item !== "d5" && item !== "phase-h1") {
      throw new Error(formatAdminApiError("D5_RESPONSE_INVALID", `D5_RESPONSE_INVALID:sourceByField.${key}`));
    }
    sourceByField[key] = item;
  });
  const result: D5Params = {
    version: d5Integer(raw.version, "version", 0),
    dailyLimitCount: d5Integer(raw.dailyLimitCount, "dailyLimitCount", 1),
    maxBalanceRatio: d5Number(raw.balanceMaxRatio, "balanceMaxRatio"),
    networkFeeRatio: d5Number(raw.networkFeeRatio, "networkFeeRatio"),
    networkFeeMin: d5Number(raw.networkFeeMin, "networkFeeMin"),
    networkFeeMax: d5Number(raw.networkFeeMax, "networkFeeMax"),
    nexFeeOffsetRate: d5Number(raw.nexFeeOffsetRate, "nexFeeOffsetRate"),
    cooldownDays: d5Integer(raw.cooldownDays, "cooldownDays", 0),
    penaltyFeeRate: d5Number(raw.penaltyFeeRate, "penaltyFeeRate"),
    complianceHoldEnabled: d5Boolean(raw.complianceHoldEnabled, "complianceHoldEnabled"),
    currentPhase: d5String(raw.currentPhase, "currentPhase"),
    currentMonth: d5Integer(raw.currentMonth, "currentMonth", 1),
    coverageRatio: d5Number(raw.coverageRatio, "coverageRatio"),
    redlinePct: d5Number(raw.redlinePct, "redlinePct"),
    coverageReliable: d5Boolean(raw.coverageReliable, "coverageReliable"),
    sourceByField,
    updatedFields: raw.updatedFields === undefined ? undefined : (() => {
      if (!Array.isArray(raw.updatedFields) || raw.updatedFields.some((item) => typeof item !== "string")) {
        throw new Error(formatAdminApiError("D5_RESPONSE_INVALID", "D5_RESPONSE_INVALID:updatedFields"));
      }
      return raw.updatedFields as string[];
    })(),
  };
  if (result.dailyLimitCount > 10
      || result.maxBalanceRatio < 0.5 || result.maxBalanceRatio > 1
      || result.networkFeeRatio < 0 || result.networkFeeRatio > 0.05
      || result.networkFeeMin < 0 || result.networkFeeMax < result.networkFeeMin
      || result.nexFeeOffsetRate <= 0 || result.penaltyFeeRate < 0 || result.penaltyFeeRate > 1) {
    throw new Error(formatAdminApiError("D5_RESPONSE_INVALID", "D5_RESPONSE_INVALID:business-range"));
  }
  return result;
}

export async function fetchD1TopupOverview() {
  return requireD1Overview(await apiRequest<Record<string, unknown>>("finance", "/topup/overview"));
}

export async function fetchD1TopupFlows(params: { status?: string; keyword?: string; pageNum?: number; pageSize?: number }) {
  return requireD1FlowsPage(await apiRequest<PageResult<D1DepositFlow>>("finance", `/topup/flows${buildQuery(params)}`));
}

export async function updateD1TopupChannelEnabled(channelCode: string, enabled: boolean, expectedValue: boolean, reason: string, operator: string) {
  return requireD1Overview(await apiRequest<Record<string, unknown>>("finance", `/topup/channels/${encodeURIComponent(channelCode)}/enabled`, {
    method: "PATCH",
    body: JSON.stringify({ enabled, expectedValue: String(expectedValue), reason, operator }),
    idempotencyPrefix: "d1-channel-enabled",
  }));
}

export async function updateD1TopupChannelFee(channelCode: string, numericValue: number, unit: D1Channel["feeUnit"], expectedValue: number, reason: string, operator: string) {
  return requireD1Overview(await apiRequest<Record<string, unknown>>("finance", `/topup/channels/${encodeURIComponent(channelCode)}/fee`, {
    method: "PATCH",
    body: JSON.stringify({ numericValue, unit, expectedValue: String(expectedValue), reason, operator }),
    idempotencyPrefix: "d1-channel-fee",
  }));
}

export async function updateD1TopupChannelMin(channelCode: string, numericValue: number, expectedValue: number, reason: string, operator: string) {
  return requireD1Overview(await apiRequest<Record<string, unknown>>("finance", `/topup/channels/${encodeURIComponent(channelCode)}/min-amount`, {
    method: "PATCH",
    body: JSON.stringify({ numericValue, unit: "USD", expectedValue: String(expectedValue), reason, operator }),
    idempotencyPrefix: "d1-channel-min",
  }));
}

export async function switchD1Psp(value: string, expectedValue: string, reason: string, operator: string) {
  return requireD1Overview(await apiRequest<Record<string, unknown>>("finance", "/topup/psp/primary", {
    method: "PATCH",
    body: JSON.stringify({ value, expectedValue, reason, operator }),
    idempotencyPrefix: "d1-psp",
  }));
}

export async function updateD1CardRisk(key: string, numericValue: number, unit: D1CardParam["unit"], expectedValue: number, reason: string, operator: string) {
  return requireD1Overview(await apiRequest<Record<string, unknown>>("finance", `/topup/card-risk/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify({ numericValue, unit, expectedValue: String(expectedValue), reason, operator }),
    idempotencyPrefix: "d1-card-risk",
  }));
}

export async function writeoffD1Reconciliation(channelCode: string, method: "CONFIRM_EXCEPTION", evidenceRef: string, reason: string, operator: string) {
  return requireD1Overview(await apiRequest<Record<string, unknown>>("finance", `/topup/reconciliation/${encodeURIComponent(channelCode)}/writeoff`, {
    method: "POST",
    body: JSON.stringify({ method, evidenceRef, reason, operator }),
    idempotencyPrefix: "d1-reconcile",
  }));
}

export async function createD1BinLock(segment: string, reason: string, operator: string) {
  return requireD1Overview(await apiRequest<Record<string, unknown>>("finance", "/topup/bin-locks", {
    method: "POST",
    body: JSON.stringify({ value: segment, reason, operator }),
    idempotencyPrefix: "d1-bin-create",
  }));
}

export async function setD1BinLock(segment: string, enabled: boolean, reason: string, operator: string) {
  return requireD1Overview(await apiRequest<Record<string, unknown>>("finance", `/topup/bin-locks/${encodeURIComponent(segment)}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled, reason, operator }),
    idempotencyPrefix: "d1-bin-state",
  }));
}

export async function refundD1Chargeback(caseNo: string, evidenceRef: string, reason: string, operator: string) {
  return requireD1Overview(await apiRequest<Record<string, unknown>>("finance", `/topup/chargebacks/${encodeURIComponent(caseNo)}/refund`, {
    method: "POST",
    body: JSON.stringify({ evidenceConfirmed: true, evidenceRef, reason, operator }),
    idempotencyPrefix: "d1-chargeback",
  }));
}

export async function fetchD2Withdrawals(params: { status?: string; keyword?: string; minAmount?: string; maxAmount?: string; minRiskScore?: string; ipSegment?: string; sortBy?: string; sortDirection?: string; pageNum?: number; pageSize?: number }) {
  return normalizePage(await apiRequest<PageResult<D2Withdrawal>>("finance", `/withdrawals${buildQuery(params)}`), normalizeWithdrawal);
}

export async function fetchD2WithdrawalDetail(withdrawalNo: string) {
  return normalizeWithdrawal(await apiRequest<D2Withdrawal>("finance", `/withdrawals/${encodeURIComponent(withdrawalNo)}`));
}

export async function reviewD2Withdrawal(
  withdrawalNo: string,
  action: D2ReviewAction,
  input: D2ReviewInput,
  operator: string,
  idempotencyKey: string,
) {
  return normalizeWithdrawal(await apiRequest<D2Withdrawal>("finance", `/withdrawals/${encodeURIComponent(withdrawalNo)}/review`, {
    method: "POST",
    body: JSON.stringify({ action, operator, ...input }),
    idempotencyKey,
  }));
}

export async function reviewD2WithdrawalsBatch(
  action: Exclude<D2ReviewAction, "UNFREEZE" | "REFUND">,
  withdrawalIds: string[],
  input: D2ReviewInput,
  operator: string,
  idempotencyKey: string,
) {
  return apiRequest<D2BatchResult>("finance", "/withdrawals/batch", {
    method: "POST",
    body: JSON.stringify({ action, withdrawalIds, operator, ...input }),
    idempotencyKey,
  });
}

export async function fetchD3Dashboard(maturityWindow?: "7d" | "30d", exposureWindow?: "7d" | "30d" | "90d"): Promise<D3Dashboard> {
  const config = normalizeD3ForecastConfig(await apiRequest<Record<string, unknown>>("treasury", "/forecast-config"));
  const selectedMaturity = maturityWindow ?? (config.forecastWindow === "30d" ? "30d" : "7d");
  const selectedExposure = exposureWindow ?? config.forecastWindow;
  const [reserve, liabilities, maturity, exposure] = await Promise.all([
    apiRequest<Record<string, unknown>>("treasury", "/reserve"),
    apiRequest<Record<string, unknown>>("treasury", "/liabilities?breakdown=true"),
    apiRequest<Record<string, unknown>>("treasury", `/maturity-forecast?window=${selectedMaturity}`),
    apiRequest<Record<string, unknown>>("treasury", `/net-exposure?window=${selectedExposure}`),
  ]);
  return {
    reserve: normalizeD3Reserve(reserve),
    liabilities: normalizeD3Liabilities(liabilities),
    maturity: normalizeD3Maturity(maturity),
    exposure: normalizeD3Exposure(exposure),
    config,
  };
}

export async function createD3Injection(
  amount: string,
  voucherNo: string,
  reason: string,
  operator: string,
  idempotencyKey?: string,
) {
  return apiRequest<Record<string, unknown>>("treasury", "/reserve-injection", {
    method: "POST",
    body: JSON.stringify({ amount, voucherNo, reason, operator }),
    idempotencyKey,
    idempotencyPrefix: idempotencyKey ? undefined : "d3-injection",
  });
}

export async function updateD3ForecastConfig(
  values: Pick<D3ForecastConfig, "reserveCategories" | "liabilityCategories" | "forecastWindow" | "genesisIncluded" | "includeFarLiabilities" | "stakingInterestMode" | "trialStressEnabled">,
  expectedVersion: number,
  reason: string,
  operator: string,
) {
  return apiRequest<Record<string, unknown>>("treasury", "/forecast-config", {
    method: "PUT",
    body: JSON.stringify({ ...values, expectedVersion, reason, operator }),
    idempotencyPrefix: "d3-forecast-config",
  });
}

/** Legacy name retained for B1 callers; the authority and endpoint are owned by B1. */
export async function updateD3Thresholds(
  values: { redlinePct?: string; healthyPct?: string; runRiskPct?: string },
  reason: string,
  operator: string,
  idempotencyKey?: string,
) {
  return apiRequest<Record<string, unknown>>("treasury", "/dual-ledger/thresholds", {
    method: "PATCH",
    body: JSON.stringify({ ...values, reason, operator }),
    idempotencyKey,
    idempotencyPrefix: idempotencyKey ? undefined : "b1-dual-ledger-thresholds",
  });
}

export async function downloadD3Csv(kind: "reconciliation" | "liabilities") {
  const exportPath = kind === "reconciliation" ? "/reconciliation/export" : "/liabilities/export";
  const response = await fetch(`/api/admin/treasury${exportPath}`, { cache: "no-store" });
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as ApiResult<unknown> | null;
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    throw new Error(formatAdminApiError(result?.message, `D3_EXPORT_FAILED_${response.status}`));
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const fileName = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `d3-${kind}.csv`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export type D4BillQuery = {
  type?: D4BillType | "";
  userId?: number;
  keyword?: string;
  bizNo?: string;
  status?: string;
  from?: string;
  to?: string;
  pageNum?: number;
  pageSize?: number;
};

export async function fetchD4Bills(params: D4BillQuery) {
  return normalizeD4Page(await apiRequest<unknown>("bills", `${buildQuery({ ...params })}`));
}

export async function fetchD4UserLedger(userId: number) {
  const raw = d4Object(await apiRequest<unknown>("bills", `/users/${encodeURIComponent(String(userId))}`), "userLedger");
  if (!Array.isArray(raw.rows)) d4Invalid("userLedger.rows");
  const rawSums = d4Object(raw.sums, "userLedger.sums");
  const rawCategories = d4Object(raw.categorySums, "userLedger.categorySums");
  const numericRecord = (source: Record<string, unknown>, field: string) => Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, d4Number(value, `${field}.${key}`)]),
  );
  return {
    userId: d4Integer(raw.userId, "userLedger.userId", 1),
    userNo: d4String(raw.userNo, "userLedger.userNo"),
    nickname: d4OptionalString(raw.nickname, "userLedger.nickname"),
    rows: raw.rows.map(normalizeBill),
    total: d4Integer(raw.total, "userLedger.total"),
    totals: numericRecord(rawSums, "userLedger.sums"),
    categoryTotals: numericRecord(rawCategories, "userLedger.categorySums"),
    balance: {
      USDT: d4Number(raw.currentUsdtBalance, "userLedger.currentUsdtBalance"),
      NEX: d4Number(raw.currentNexBalance, "userLedger.currentNexBalance"),
    },
    sources: Array.isArray(raw.sources) ? raw.sources.map((item, index) => d4String(item, `userLedger.sources.${index}`)) : d4Invalid("userLedger.sources"),
  } satisfies D4UserLedger;
}

export async function fetchD4RunningBalance(userId: number): Promise<D4RunningBalance> {
  const raw = d4Object(await apiRequest<unknown>("bills", `/running-balance${buildQuery({ userId })}`), "runningBalance");
  if (!Array.isArray(raw.rows)) d4Invalid("runningBalance.rows");
  const reconciliation = d4Object(raw.reconciliation, "runningBalance.reconciliation");
  return {
    userId: d4Integer(raw.userId, "runningBalance.userId", 1),
    total: d4Integer(raw.total, "runningBalance.total"),
    rows: raw.rows.map((value, index) => {
      const row = d4Object(value, `runningBalance.rows.${index}`);
      return {
        bill: normalizeBill(row.bill),
        expectedBalanceAfter: d4Number(row.expectedBalanceAfter, `runningBalance.rows.${index}.expectedBalanceAfter`),
        difference: d4Number(row.difference, `runningBalance.rows.${index}.difference`),
        breakDetected: d4Boolean(row.breakDetected, `runningBalance.rows.${index}.breakDetected`),
      };
    }),
    breakCount: d4Integer(raw.breakCount, "runningBalance.breakCount"),
    reconciliation: {
      USDT: d4Number(reconciliation.USDT, "runningBalance.reconciliation.USDT"),
      NEX: d4Number(reconciliation.NEX, "runningBalance.reconciliation.NEX"),
    },
    balanced: d4Boolean(raw.balanced, "runningBalance.balanced"),
    sources: Array.isArray(raw.sources) ? raw.sources.map((item, index) => d4String(item, `runningBalance.sources.${index}`)) : d4Invalid("runningBalance.sources"),
  };
}

export async function downloadD4BillsCsv(
  params: Omit<D4BillQuery, "pageNum" | "pageSize">,
  reason: string,
) {
  const response = await fetch(`/api/admin/bills/export${buildQuery({ ...params, reason })}`, { cache: "no-store" });
  const contentType = response.headers.get("Content-Type") || "";
  if (!response.ok || !contentType.toLowerCase().includes("text/csv")) {
    const result = (await response.json().catch(() => null)) as ApiResult<unknown> | null;
    if (isAdminAuthFailure(response.status, result?.message)) resetAdminSession();
    throw new Error(formatAdminApiError(result?.message, `D4_EXPORT_FAILED_${response.status}`));
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const fileName = disposition.match(/filename="?([^";]+)"?/i)?.[1] || "d4-bills-masked.csv";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export async function fetchD5WithdrawalParams() {
  return normalizeD5Params(await apiRequest<Record<string, unknown>>("withdraw", "/limits"));
}

export type D5OwnedChanges = Partial<Pick<D5Params,
  "dailyLimitCount" | "maxBalanceRatio" | "networkFeeRatio" | "networkFeeMin" | "networkFeeMax" | "nexFeeOffsetRate">>;

export async function updateD5WithdrawalLimits(
  changes: D5OwnedChanges,
  expectedVersion: number,
  reason: string,
  operator: string,
) {
  const payload: Record<string, unknown> = { ...changes, expectedVersion, reason, operator };
  if (Object.prototype.hasOwnProperty.call(payload, "maxBalanceRatio")) {
    payload.balanceMaxRatio = payload.maxBalanceRatio;
    delete payload.maxBalanceRatio;
  }
  return normalizeD5Params(await apiRequest<Record<string, unknown>>("withdraw", "/limits", {
    method: "PUT",
    body: JSON.stringify(payload),
    idempotencyPrefix: "d5-withdrawal-limits",
  }));
}
