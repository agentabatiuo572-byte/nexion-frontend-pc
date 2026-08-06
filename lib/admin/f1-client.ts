import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError } from "@/lib/admin/error-messages";
import { F1OutcomeUncertainError, f1StableWrite } from "@/lib/admin/f1-stable-write";
import type { OpsVRankRewardItem, VRankRewardType } from "@/lib/admin/platform-types";
import {
  assertF1Overview,
  assertF2Overview,
  assertF3Overview,
  assertF4Overview,
  assertF5Overview,
} from "@/lib/admin/f-overview-contract";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

interface BackendVRankRow {
  v?: string | null;
  label?: string | null;
  selfBuy?: string | null;
  directRefs?: string | null;
  teamGv?: string | null;
  legCount?: string | null;
  legRank?: string | null;
  unilevelDepth?: string | null;
  peerBonusRate?: number | string | null;
  votes?: number | string | null;
  visible?: boolean | number | string | null;
  pop?: number | string | null;
  rewards?: BackendReward[] | null;
}

interface BackendReward {
  id?: string | null;
  type?: string | null;
  amount?: number | string | null;
  voucherId?: string | null;
  skuId?: string | null;
  custom?: string | null;
}

interface BackendLeadershipRank {
  v?: number | string | null;
  votes?: number | string | null;
  pop?: number | string | null;
}

interface BackendLeadership {
  weeklyGmvUsdt?: number | string | null;
  poolRatio?: number | string | null;
  monthlyCapUsdt?: number | string | null;
  unlockRank?: number | string | null;
  topN?: number | string | null;
  ranks?: BackendLeadershipRank[] | null;
  topConcentrationPct?: number | string | null;
  qualifiers?: number | string | null;
  totalMembers?: number | string | null;
}

interface BackendOverview {
  vrankRows?: BackendVRankRow[] | null;
  rewards?: Record<string, BackendReward[] | null> | null;
  voucherOptions?: string[] | null;
  voucherLabels?: Record<string, string> | null;
  skuOptions?: string[] | null;
  skuLabels?: Record<string, string> | null;
  leadership?: BackendLeadership | null;
  configValues?: Record<string, string> | null;
  coverage?: BackendCoverage | null;
  sources?: string[] | null;
}

interface BackendCoverage {
  coverageRatio?: number | string | null;
  redlinePct?: number | string | null;
}

interface BackendF2Metric {
  id?: string | null;
  label?: string | null;
  value?: string | null;
  sub?: string | null;
  tone?: string | null;
  configKey?: string | null;
}

interface BackendF2UnilevelRate {
  level?: string | null;
  usdtPct?: number | string | null;
  nexReward?: number | string | null;
  label?: string | null;
  direct?: boolean | string | null;
  configKey?: string | null;
  nexConfigKey?: string | null;
}

interface BackendF2RateTier {
  name?: string | null;
  requirement?: string | null;
  rate?: string | null;
  ratePct?: number | string | null;
  distribution?: string | null;
  className?: string | null;
  configKey?: string | null;
}

interface BackendF2PolicyParam {
  id?: string | null;
  name?: string | null;
  key?: string | null;
  value?: string | null;
  defaultValue?: string | null;
  viewClass?: string | null;
  sub?: string | null;
  amplifies?: boolean | string | null;
  visualAmplify?: boolean | string | null;
  unit?: string | null;
}

interface BackendF2Overview {
  metrics?: BackendF2Metric[] | null;
  unilevelRates?: BackendF2UnilevelRate[] | null;
  rateTiers?: BackendF2RateTier[] | null;
  policyParams?: BackendF2PolicyParam[] | null;
  commissionPolicy?: Record<string, unknown> | null;
  guardrails?: string[] | null;
  configValues?: Record<string, string> | null;
  coverage?: BackendCoverage | null;
  sources?: string[] | null;
}

interface BackendF3Metric {
  id?: string | null;
  label?: string | null;
  value?: string | null;
  sub?: string | null;
  tone?: string | null;
  configKey?: string | null;
}

interface BackendF3Settlement {
  ownerUserId?: number | string | null;
  user?: string | null;
  settlementDate?: string | null;
  cohort?: string | null;
  trackA?: number | string | null;
  trackB?: number | string | null;
  matchAmount?: number | string | null;
  todayPaid?: number | string | null;
  state?: string | null;
  tone?: string | null;
}

interface BackendF3Formula {
  user?: string | null;
  trackA?: number | string | null;
  trackB?: number | string | null;
  matchAmount?: number | string | null;
  matchRate?: string | null;
  threshold?: string | null;
  settlePeriod?: string | null;
}

interface BackendF3DailyCap {
  currentLabel?: string | null;
  windowLabel?: string | null;
  nextTrigger?: string | null;
  nextLabel?: string | null;
  currentMonth?: number | string | null;
  currentPhase?: string | null;
}

interface BackendF3Config {
  threshold?: string | null;
  matchRate?: string | null;
  spillover?: string | null;
  spilloverEnabled?: boolean | string | null;
  gvResetCron?: string | null;
  settlePeriod?: string | null;
  residualPolicy?: string | null;
  residualPool?: string | null;
  residualSub?: string | null;
}

interface BackendF3Overview {
  metrics?: BackendF3Metric[] | null;
  formula?: BackendF3Formula | null;
  settlements?: BackendF3Settlement[] | null;
  maxTrackGmv?: number | string | null;
  participantCount?: number | string | null;
  blockedCount?: number | string | null;
  monthlyMatchedUsd?: number | string | null;
  autoPlacement7dCount?: number | string | null;
  dailyMatchUsd?: number | string | null;
  dailyCap?: BackendF3DailyCap | null;
  config?: BackendF3Config | null;
  commissionPolicy?: Record<string, unknown> | null;
  guardrails?: string[] | null;
  configValues?: Record<string, string> | null;
  coverage?: BackendCoverage | null;
  sources?: string[] | null;
}

interface BackendF4Metric {
  id?: string | null;
  label?: string | null;
  value?: string | null;
  sub?: string | null;
  tone?: string | null;
}

interface BackendF4QuotaRow {
  name?: string | null;
  current?: number | string | null;
  cap?: number | string | null;
  tight?: boolean | string | null;
}

interface BackendF4AmbassadorBand {
  name?: string | null;
  count?: number | string | null;
}

interface BackendF4Podium {
  rank?: number | string | null;
  userId?: string | null;
  gmvLabel?: string | null;
  tip?: string | null;
  className?: string | null;
}

interface BackendF4VoteWeight {
  v?: string | null;
  votes?: number | string | null;
  configKey?: string | null;
}

interface BackendF4Config {
  poolRatio?: string | null;
  monthlyCap?: string | null;
  proUnlock?: string | null;
  rackUnlock?: string | null;
  monthlyStock?: string | null;
  ambassadorStatus?: string | null;
  leaderboardPoolUsd?: string | null;
  leaderboardPeriodStatus?: string | null;
}

interface BackendF4LeadershipPoolOverview {
  metrics?: BackendF4Metric[] | null;
  weeklyInjectedUsd?: number | string | null;
  weeklyGmvUsd?: number | string | null;
  poolRatio?: string | null;
  poolRatioValue?: number | string | null;
  monthlyCapLabel?: string | null;
  monthlyCapUsd?: number | string | null;
  participantCount?: number | string | null;
  topN?: number | string | null;
  topSharePct?: number | string | null;
  unlockRank?: number | string | null;
  settlementWindow?: string | null;
  settlementDispatchWindow?: string | null;
  quotaRows?: BackendF4QuotaRow[] | null;
  quotaMonthlyStockLabel?: string | null;
  quotaMonthlyStockTotal?: number | string | null;
  quotaMonthlyStockUsed?: number | string | null;
  quotaMonthlyStockRemaining?: number | string | null;
  proUnlock?: string | null;
  rackUnlock?: string | null;
  ambassadorBands?: BackendF4AmbassadorBand[] | null;
  ambassadorStatus?: string | null;
  ambassadorPendingCount?: number | string | null;
  ambassadorBudgetApprovedLabel?: string | null;
  ambassadorBudgetCapLabel?: string | null;
  ambassadorKolBudgetPct?: number | string | null;
  ambassadorNextQuotaReviewDate?: string | null;
  leaderboardPoolLabel?: string | null;
  leaderboardParticipantCount?: number | string | null;
  leaderboardFraudHitCount?: number | string | null;
  leaderboardDisqualified?: boolean | string | null;
  leaderboardPeriodStatus?: string | null;
  podium?: BackendF4Podium[] | null;
  voteWeights?: BackendF4VoteWeight[] | null;
  config?: BackendF4Config | null;
  commissionPolicy?: Record<string, unknown> | null;
  guardrails?: string[] | null;
  configValues?: Record<string, string> | null;
  coverage?: BackendCoverage | null;
  sources?: string[] | null;
}

interface BackendF5Summary {
  monthlyCommissionSpendLabel?: string | null;
  coolingBalanceLabel?: string | null;
  withdrawableThisMonthLabel?: string | null;
  abnormalOrFrozenCount?: number | string | null;
}

interface BackendF5CommissionKind {
  key?: string | null;
  code?: string | null;
  label?: string | null;
  amountLabel?: string | null;
  countLabel?: string | null;
  className?: string | null;
  amountColor?: string | null;
}

interface BackendF5Filter {
  key?: string | null;
  label?: string | null;
}

interface BackendF5CommissionEvent {
  id?: string | null;
  commissionId?: string | null;
  eventId?: number | string | null;
  kind?: string | null;
  user?: string | null;
  userId?: number | string | null;
  amount?: number | string | null;
  currency?: string | null;
  sourceUserId?: number | string | null;
  layer?: number | string | null;
  settledAt?: string | null;
  coolingDaysLeft?: number | string | null;
  status?: string | null;
  cooldownPercent?: number | string | null;
  cooldownLabel?: string | null;
  state?: string | null;
  auditKey?: string | null;
}

interface BackendF5StatusItem {
  color?: string | null;
  name?: string | null;
  count?: number | string | null;
}

interface BackendF5AuditFeedItem {
  when?: string | null;
  text?: string | null;
  level?: string | null;
}

interface BackendF5Pagination {
  mode?: string | null;
  defaultWindow?: string | null;
  defaultPageSize?: number | string | null;
  maxPageSize?: number | string | null;
}

interface BackendF5CommissionAuditOverview {
  summary?: BackendF5Summary | null;
  commissionKinds?: BackendF5CommissionKind[] | null;
  commissionFilters?: BackendF5Filter[] | null;
  commissionEvents?: BackendF5CommissionEvent[] | null;
  statusDistribution?: BackendF5StatusItem[] | null;
  recentAuditFeed?: BackendF5AuditFeedItem[] | null;
  pagination?: BackendF5Pagination | null;
  nextCursor?: string | number | null;
  total?: number | string | null;
  anomalies?: Record<string, unknown>[] | null;
  coolingPolicy?: Record<string, unknown>[] | null;
  operationHistory?: Record<string, unknown>[] | null;
  activeSuspensions?: Record<string, unknown>[] | null;
  commissionPolicy?: Record<string, unknown> | null;
  guardrails?: string[] | null;
  configValues?: Record<string, string> | null;
  coverage?: BackendCoverage | null;
  sources?: string[] | null;
}

export interface F1VRankRow {
  v: string;
  label: string;
  selfBuy?: string;
  directRefs?: string;
  teamGv?: string;
  legCount?: string;
  legRank?: string;
  unilevelDepth: string;
  peerBonusRate: number;
  votes: number;
  visible: boolean;
  pop: number;
  rewards: OpsVRankRewardItem[];
}

export interface F1LeadershipRank {
  v: number;
  votes: number;
  pop: number;
}

export interface F1Leadership {
  weeklyGmvUsdt: number;
  poolRatio: number;
  monthlyCapUsdt: number;
  unlockRank: number;
  topN: number;
  ranks: F1LeadershipRank[];
  topConcentrationPct: number;
  qualifiers: number;
  totalMembers: number;
}

export interface F1VRankOverview {
  rows: F1VRankRow[];
  rewards: Record<string, OpsVRankRewardItem[]>;
  voucherOptions: string[];
  voucherLabels: Record<string, string>;
  skuOptions: string[];
  skuLabels: Record<string, string>;
  leadership: F1Leadership;
  configValues: Record<string, string>;
  coverage?: { coverageRatio: number; redlinePct: number };
  sources: string[];
}

export interface F1PromotionRecord {
  id: string;
  userId: string;
  nickname: string;
  fromCode: string;
  toCode: string;
  reason: string;
  operator: string;
  isManual: boolean;
  cohort: string;
  snapshot: unknown;
  triggerEventId: string;
  auditNo: string;
  createdAt: string;
}

export interface F1PromotionFilters {
  userId?: string;
  v?: string;
  cohort?: string;
  from?: string;
  to?: string;
}

export interface F1RewardPayout {
  payoutId: string;
  userId: string;
  rankCode: string;
  rewardType: string;
  amount: number;
  voucherId: string;
  skuId: string;
  customLabel: string;
  sponsorUserId: string;
  status: string;
  commissionEventId: string;
  billId: string;
  triggerEventId: string;
  operator: string;
  reason: string;
  grantedAt: string;
  reversedAt: string;
}

export interface F1PayoutFilters {
  type?: string;
  v?: string;
  status?: string;
  userId?: string;
  cursor?: string;
}

export interface F1Page<T> {
  total: number;
  limit: number;
  nextCursor: string;
  items: T[];
}

export interface F2Metric {
  id: string;
  name: string;
  value: string;
  sub: string;
  tone: string;
  configKey: string;
}

export interface F2UnilevelRate {
  l: string;
  usdt: number;
  nex: number;
  ui: string;
  direct: boolean;
  configKey: string;
  nexConfigKey: string;
}

export interface F2RateTier {
  nm: string;
  req: string;
  rate: string;
  dist: string;
  cls: string;
  configKey: string;
}

export interface F2PolicyParam {
  id: string;
  name: string;
  key: string;
  value: string;
  def: string;
  vcls: string;
  sub: string;
  amp: boolean;
  vamp: boolean;
  unit?: string;
}

export interface F2RatesOverview {
  metrics: F2Metric[];
  unilevel: F2UnilevelRate[];
  rateTiers: F2RateTier[];
  params: F2PolicyParam[];
  commissionPolicy: Record<string, unknown>;
  guardrails: string[];
  configValues: Record<string, string>;
  coverage?: { coverageRatio: number; redlinePct: number };
  sources: string[];
}

export interface F3Metric {
  id: string;
  name: string;
  value: string;
  sub: string;
  tone: string;
  configKey: string;
}

export interface F3Settlement {
  ownerUserId: number;
  user: string;
  settlementDate: string;
  cohort: string;
  a: number;
  b: number;
  match: number;
  today: number;
  state: string;
  tone: string;
}

export interface F3Formula {
  user: string;
  trackA: number;
  trackB: number;
  matchAmount: number;
  matchRate: string;
  threshold: string;
  settlePeriod: string;
}

export interface F3DailyCap {
  currentLabel: string;
  windowLabel: string;
  nextTrigger: string;
  nextLabel: string;
  currentMonth: number;
  currentPhase: string;
}

export interface F3BinaryConfig {
  threshold: string;
  matchRate: string;
  spillover: string;
  spilloverEnabled: boolean;
  gvResetCron: string;
  settlePeriod: string;
  residualPolicy: string;
  residualPool: string;
  residualSub: string;
}

export interface F3BinaryOverview {
  metrics: F3Metric[];
  formula: F3Formula;
  settlements: F3Settlement[];
  maxTrackGmv: number;
  participantCount: number;
  blockedCount: number;
  monthlyMatchedUsd: number;
  autoPlacement7dCount: number;
  dailyMatchUsd: number;
  dailyCap: F3DailyCap;
  config: F3BinaryConfig;
  commissionPolicy: Record<string, unknown>;
  guardrails: string[];
  configValues: Record<string, string>;
  coverage?: { coverageRatio: number; redlinePct: number };
  sources: string[];
}

export interface F4Metric {
  id: string;
  name: string;
  value: string;
  sub: string;
  tone: string;
}

export interface F4QuotaRow {
  name: string;
  current: number;
  cap: number;
  tight: boolean;
}

export interface F4AmbassadorBand {
  name: string;
  count: number;
}

export interface F4Podium {
  rank: number;
  userId: string;
  gmvLabel: string;
  tip: string;
  className: string;
}

export interface F4VoteWeight {
  v: string;
  votes: number;
  configKey: string;
}

export interface F4Config {
  poolRatio?: string | null;
  monthlyCap?: string | null;
  proUnlock?: string | null;
  rackUnlock?: string | null;
  monthlyStock?: string | null;
  ambassadorStatus?: string | null;
  leaderboardPoolUsd?: string | null;
  leaderboardPeriodStatus?: string | null;
}

export interface F4LeadershipPoolOverview {
  metrics: F4Metric[];
  weeklyInjectedUsd: number;
  weeklyGmvUsd: number;
  poolRatio: string;
  poolRatioValue: number;
  monthlyCapLabel: string;
  monthlyCapUsd: number;
  participantCount: number;
  topN: number;
  topSharePct: number;
  unlockRank: number;
  settlementWindow: string;
  settlementDispatchWindow: string;
  quotaRows: F4QuotaRow[];
  quotaMonthlyStockLabel: string;
  quotaMonthlyStockTotal: number;
  quotaMonthlyStockUsed: number;
  quotaMonthlyStockRemaining: number;
  proUnlock: string;
  rackUnlock: string;
  ambassadorBands: F4AmbassadorBand[];
  ambassadorStatus: string;
  ambassadorPendingCount: number;
  ambassadorBudgetApprovedLabel: string;
  ambassadorBudgetCapLabel: string;
  ambassadorKolBudgetPct: number;
  ambassadorNextQuotaReviewDate: string;
  leaderboardPoolLabel: string;
  leaderboardParticipantCount: number;
  leaderboardFraudHitCount: number;
  leaderboardDisqualified: boolean;
  leaderboardPeriodStatus: string;
  podium: F4Podium[];
  voteWeights: F4VoteWeight[];
  config: F4Config;
  commissionPolicy: Record<string, unknown>;
  guardrails: string[];
  configValues: Record<string, string>;
  coverage?: { coverageRatio: number; redlinePct: number };
  sources: string[];
}

export interface F5CommissionSummary {
  monthlyCommissionSpendLabel: string;
  coolingBalanceLabel: string;
  withdrawableThisMonthLabel: string;
  abnormalOrFrozenCount: number;
}

export interface F5CommissionKind {
  key: string;
  code: string;
  lbl: string;
  amt: string;
  ct: string;
  cls: string;
  amtColor?: string;
}

export interface F5CommissionFilter {
  key: string;
  lbl: string;
}

export interface F5CommissionEvent {
  id: string;
  eventId: number;
  kind: string;
  user: string;
  userId: number;
  amt: number;
  cur: string;
  sourceUserId?: number;
  layer?: number;
  settledAt: string;
  coolingDaysLeft: number;
  status: string;
  coolPct: number;
  coolLb: string;
  state: string;
  auditKey: string;
}

export interface F5CommissionQuery {
  kind?: string;
  currency?: string;
  userId?: string;
  cohort?: string;
  status?: string;
  cursor?: string;
  limit?: string;
}

export interface F5Anomaly {
  id: string;
  type: string;
  commissionId: string;
  userId: string;
  evidence: string;
  relatedKCluster: string;
  status: string;
}

export interface F5CoolingPolicy {
  kind: string;
  days: number;
  policy: string;
}

export interface F5OperationHistory {
  operationNo: string;
  operationType: string;
  sourceCommissionId: string;
  resultCommissionId: string;
  userId: string;
  kinds: string;
  amount: number;
  currency: string;
  evidenceRef: string;
  reason: string;
  operator: string;
  createdAt: string;
}

export interface F5StatusDistribution {
  dot: string;
  nm: string;
  ct: string;
}

export interface F5AuditFeedItem {
  when: string;
  text: string;
  level: string;
}

export interface F5CommissionPagination {
  mode: string;
  defaultWindow: string;
  defaultPageSize: number;
  maxPageSize: number;
}

export interface F5CommissionAuditOverview {
  summary: F5CommissionSummary;
  commissionKinds: F5CommissionKind[];
  commissionFilters: F5CommissionFilter[];
  commissionEvents: F5CommissionEvent[];
  statusDistribution: F5StatusDistribution[];
  recentAuditFeed: F5AuditFeedItem[];
  pagination: F5CommissionPagination;
  nextCursor: string;
  total: number;
  anomalies: F5Anomaly[];
  coolingPolicy: F5CoolingPolicy[];
  operationHistory: F5OperationHistory[];
  activeSuspensions: Array<{ userId: string; kind: string; reason: string; operator: string; updatedAt: string }>;
  commissionPolicy: Record<string, unknown>;
  guardrails: string[];
  configValues: Record<string, string>;
  coverage?: { coverageRatio: number; redlinePct: number };
  sources: string[];
}

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function asText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export interface F3SettlementExecution {
  ownerUserId: number;
  settlementDate: string;
  status: string;
  reason: string;
  leftVolume: number;
  rightVolume: number;
  matchedVolume: number;
  amountUsdt: number;
  dailyCapUsdt: number;
  commissionEventId: number | null;
  replayed: boolean;
}

function asScalarText(value: unknown, fallback = "") {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return asText(value, fallback);
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "on";
  }
  return fallback;
}

function normalizeRewardType(value: string | null | undefined): VRankRewardType {
  return value === "usdt" || value === "nex" || value === "voucher" || value === "sku" || value === "custom" ? value : "custom";
}

function normalizeReward(item: BackendReward): OpsVRankRewardItem {
  const type = normalizeRewardType(item.type ?? undefined);
  return {
    id: asText(item.id, `vr-${type}`),
    type,
    amount: type === "usdt" || type === "nex" ? toNumber(item.amount) : undefined,
    voucherId: type === "voucher" ? optionalText(item.voucherId) : undefined,
    skuId: type === "sku" ? optionalText(item.skuId) : undefined,
    custom: type === "custom" ? asText(item.custom, "自定义") : undefined,
  };
}

function normalizeRewardList(items: BackendReward[] | null | undefined) {
  return (items ?? []).map(normalizeReward);
}

function normalizeLabels(options: string[], labels: Record<string, string> | null | undefined) {
  const map: Record<string, string> = {};
  for (const option of options) {
    map[option] = labels?.[option] || option;
  }
  return map;
}

function normalizeLeadership(data: BackendLeadership | null | undefined): F1Leadership {
  const ranks = (data?.ranks ?? []).map((rank) => ({
    v: toNumber(rank.v),
    votes: toNumber(rank.votes),
    pop: toNumber(rank.pop),
  }));
  const totalMembers = toNumber(data?.totalMembers, ranks.reduce((sum, rank) => sum + rank.pop, 0));
  const unlockRank = toNumber(data?.unlockRank, 3);
  return {
    weeklyGmvUsdt: toNumber(data?.weeklyGmvUsdt),
    poolRatio: toNumber(data?.poolRatio),
    monthlyCapUsdt: toNumber(data?.monthlyCapUsdt),
    unlockRank,
    topN: toNumber(data?.topN, 10),
    ranks,
    topConcentrationPct: toNumber(data?.topConcentrationPct),
    qualifiers: toNumber(data?.qualifiers, ranks.filter((rank) => rank.v >= unlockRank).reduce((sum, rank) => sum + rank.pop, 0)),
    totalMembers,
  };
}

function normalizeOverview(data: BackendOverview | null | undefined): F1VRankOverview {
  const backendRewards = data?.rewards ?? {};
  const rewards: Record<string, OpsVRankRewardItem[]> = {};
  const rows = (data?.vrankRows ?? []).map((row) => {
    const v = asText(row.v, "V?");
    const rowRewards = normalizeRewardList(row.rewards ?? backendRewards[v]);
    rewards[v] = rowRewards;
    return {
      v,
      label: asText(row.label, v),
      selfBuy: optionalText(row.selfBuy),
      directRefs: row.directRefs == null ? undefined : String(row.directRefs),
      teamGv: optionalText(row.teamGv),
      legCount: row.legCount == null ? undefined : String(row.legCount),
      legRank: optionalText(row.legRank),
      unilevelDepth: asText(row.unilevelDepth),
      peerBonusRate: toNumber(row.peerBonusRate),
      votes: toNumber(row.votes),
      visible: toBoolean(row.visible, true),
      pop: toNumber(row.pop),
      rewards: rowRewards,
    };
  });
  for (const [level, items] of Object.entries(backendRewards)) {
    if (!rewards[level]) rewards[level] = normalizeRewardList(items);
  }
  const voucherOptions = data?.voucherOptions ?? [];
  const skuOptions = data?.skuOptions ?? [];
  // coverage 可选:后端 ranks() 注入 B1 备付金覆盖率快照;无则不传(OperationConfirmModal 退化为提交时由后端实时校验)。
  const rawCoverage = data?.coverage;
  const coverage = rawCoverage
    ? {
        coverageRatio: toNumber(rawCoverage.coverageRatio),
        redlinePct: toNumber(rawCoverage.redlinePct),
      }
    : undefined;
  return {
    rows,
    rewards,
    voucherOptions,
    voucherLabels: normalizeLabels(voucherOptions, data?.voucherLabels),
    skuOptions,
    skuLabels: normalizeLabels(skuOptions, data?.skuLabels),
    leadership: normalizeLeadership(data?.leadership),
    configValues: data?.configValues ?? {},
    coverage,
    sources: data?.sources ?? [],
  };
}

function normalizePromotionPage(data: Record<string, unknown> | null | undefined): F1Page<F1PromotionRecord> {
  const rawItems = Array.isArray(data?.items) ? data.items : [];
  return {
    total: toNumber(data?.total),
    limit: toNumber(data?.limit, 100),
    nextCursor: "",
    items: rawItems.map((item) => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        id: asScalarText(row.id),
        userId: asScalarText(row.userId),
        nickname: asText(row.nickname),
        fromCode: asText(row.fromCode),
        toCode: asText(row.toCode),
        reason: asText(row.reason),
        operator: asText(row.operator),
        isManual: toBoolean(row.isManual),
        cohort: asText(row.cohort),
        snapshot: row.snapshot ?? null,
        triggerEventId: asText(row.triggerEventId),
        auditNo: asText(row.auditNo),
        createdAt: asText(row.createdAt),
      };
    }),
  };
}

function normalizePayoutPage(data: Record<string, unknown> | null | undefined): F1Page<F1RewardPayout> {
  const rawItems = Array.isArray(data?.items) ? data.items : [];
  return {
    total: toNumber(data?.total),
    limit: toNumber(data?.limit, 100),
    nextCursor: asText(data?.nextCursor),
    items: rawItems.map((item) => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        payoutId: asScalarText(row.payoutId),
        userId: asScalarText(row.userId),
        rankCode: asText(row.rankCode),
        rewardType: asText(row.rewardType),
        amount: toNumber(row.amount),
        voucherId: asText(row.voucherId),
        skuId: asText(row.skuId),
        customLabel: asText(row.customLabel),
        sponsorUserId: asScalarText(row.sponsorUserId),
        status: asText(row.status).toUpperCase(),
        commissionEventId: asScalarText(row.commissionEventId),
        billId: asText(row.billId),
        triggerEventId: asText(row.triggerEventId),
        operator: asText(row.operator),
        reason: asText(row.reason),
        grantedAt: asText(row.grantedAt),
        reversedAt: asText(row.reversedAt),
      };
    }),
  };
}

function queryString(params: object) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params) as [string, string | undefined][]) {
    if (value?.trim()) query.set(key, value.trim());
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

function normalizeF2Overview(data: BackendF2Overview | null | undefined): F2RatesOverview {
  const metrics = (data?.metrics ?? []).map((item) => ({
    id: asText(item.id, "metric"),
    name: asText(item.label, "指标"),
    value: asText(item.value, "-"),
    sub: asText(item.sub, ""),
    tone: asText(item.tone, ""),
    configKey: asText(item.configKey, ""),
  }));
  const unilevel = (data?.unilevelRates ?? []).map((item) => ({
    l: asText(item.level, "L?"),
    usdt: toNumber(item.usdtPct),
    nex: toNumber(item.nexReward),
    ui: asText(item.label, ""),
    direct: toBoolean(item.direct),
    configKey: asText(item.configKey, ""),
    nexConfigKey: asText(item.nexConfigKey, ""),
  }));
  const rateTiers = (data?.rateTiers ?? []).map((item) => ({
    nm: asText(item.name, "Tier"),
    req: asText(item.requirement, "-"),
    rate: asText(item.rate, `${toNumber(item.ratePct)}%`),
    dist: asText(item.distribution, "-"),
    cls: asText(item.className, ""),
    configKey: asText(item.configKey, ""),
  }));
  const params = (data?.policyParams ?? []).map((item) => {
    const fallback = asText(item.defaultValue, "");
    return {
      id: asText(item.id, "param"),
      name: asText(item.name, "参数"),
      key: asText(item.key, ""),
      value: asText(item.value, fallback),
      def: fallback,
      vcls: asText(item.viewClass, ""),
      sub: asText(item.sub, ""),
      amp: toBoolean(item.amplifies),
      vamp: toBoolean(item.visualAmplify),
      unit: optionalText(item.unit),
    };
  });
  return {
    metrics,
    unilevel,
    rateTiers,
    params,
    commissionPolicy: data?.commissionPolicy ?? {},
    guardrails: data?.guardrails ?? [],
    configValues: data?.configValues ?? {},
    // coverage 可选:后端 rates() 注入 B1 备付金覆盖率快照;无则不传(OperationConfirmModal 退化为提交时由后端实时校验),范式同 normalizeOverview。
    coverage: data?.coverage
      ? { coverageRatio: toNumber(data.coverage.coverageRatio), redlinePct: toNumber(data.coverage.redlinePct) }
      : undefined,
    sources: data?.sources ?? [],
  };
}

function normalizeF3Overview(data: BackendF3Overview | null | undefined): F3BinaryOverview {
  const metrics = (data?.metrics ?? []).map((item) => ({
    id: asText(item.id, "metric"),
    name: asText(item.label, "指标"),
    value: asText(item.value, "-"),
    sub: asText(item.sub, ""),
    tone: asText(item.tone, ""),
    configKey: asText(item.configKey, ""),
  }));
  const settlements = (data?.settlements ?? []).map((item) => ({
    ownerUserId: toNumber(item.ownerUserId),
    user: asText(item.user, "usr_unknown"),
    settlementDate: asText(item.settlementDate, ""),
    cohort: asText(item.cohort, ""),
    a: toNumber(item.trackA),
    b: toNumber(item.trackB),
    match: toNumber(item.matchAmount),
    today: toNumber(item.todayPaid),
    state: asText(item.state, "-"),
    tone: asText(item.tone, ""),
  }));
  const formula = data?.formula ?? {};
  const dailyCap = data?.dailyCap ?? {};
  const config = data?.config ?? {};
  return {
    metrics,
    formula: {
      user: asText(formula.user),
      trackA: toNumber(formula.trackA),
      trackB: toNumber(formula.trackB),
      matchAmount: toNumber(formula.matchAmount),
      matchRate: asText(formula.matchRate),
      threshold: asText(formula.threshold),
      settlePeriod: asText(formula.settlePeriod),
    },
    settlements,
    maxTrackGmv: toNumber(data?.maxTrackGmv, Math.max(1, ...settlements.flatMap((row) => [row.a, row.b]))),
    participantCount: toNumber(data?.participantCount),
    blockedCount: toNumber(data?.blockedCount),
    monthlyMatchedUsd: toNumber(data?.monthlyMatchedUsd),
    autoPlacement7dCount: toNumber(data?.autoPlacement7dCount),
    dailyMatchUsd: toNumber(data?.dailyMatchUsd),
    dailyCap: {
      currentLabel: asText(dailyCap.currentLabel),
      windowLabel: asText(dailyCap.windowLabel),
      nextTrigger: asText(dailyCap.nextTrigger),
      nextLabel: asText(dailyCap.nextLabel),
      currentMonth: toNumber(dailyCap.currentMonth),
      currentPhase: asText(dailyCap.currentPhase),
    },
    config: {
      threshold: asText(config.threshold),
      matchRate: asText(config.matchRate),
      spillover: asText(config.spillover),
      spilloverEnabled: toBoolean(config.spilloverEnabled),
      gvResetCron: asText(config.gvResetCron),
      settlePeriod: asText(config.settlePeriod),
      residualPolicy: asText(config.residualPolicy),
      residualPool: asText(config.residualPool),
      residualSub: asText(config.residualSub),
    },
    commissionPolicy: data?.commissionPolicy ?? {},
    guardrails: data?.guardrails ?? [],
    configValues: data?.configValues ?? {},
    // coverage 可选:后端 binary() 注入 B1 备付金覆盖率快照;无则不传(OperationConfirmModal 退化为提交时由后端实时校验),范式同 normalizeOverview。
    coverage: data?.coverage
      ? { coverageRatio: toNumber(data.coverage.coverageRatio), redlinePct: toNumber(data.coverage.redlinePct) }
      : undefined,
    sources: data?.sources ?? [],
  };
}

function normalizeF4Overview(data: BackendF4LeadershipPoolOverview | null | undefined): F4LeadershipPoolOverview {
  const metrics = (data?.metrics ?? []).map((item) => ({
    id: asText(item.id, "metric"),
    name: asText(item.label, "指标"),
    value: asText(item.value, "-"),
    sub: asText(item.sub, ""),
    tone: asText(item.tone, ""),
  }));
  const quotaRows = (data?.quotaRows ?? []).map((row) => ({
    name: asText(row.name, "Quota"),
    current: toNumber(row.current),
    cap: toNumber(row.cap),
    tight: toBoolean(row.tight),
  }));
  const ambassadorBands = (data?.ambassadorBands ?? []).map((row) => ({
    name: asText(row.name, "BAND"),
    count: toNumber(row.count),
  }));
  const podium = (data?.podium ?? []).map((row) => ({
    rank: toNumber(row.rank),
    userId: asText(row.userId, "usr_unknown"),
    gmvLabel: asText(row.gmvLabel, "-"),
    tip: asText(row.tip, ""),
    className: asText(row.className, ""),
  }));
  const voteWeights = (data?.voteWeights ?? []).map((row) => ({
    v: asText(row.v, "V?"),
    votes: toNumber(row.votes),
    configKey: asText(row.configKey, ""),
  }));
  const config = data?.config ?? {};
  return {
    metrics,
    weeklyInjectedUsd: toNumber(data?.weeklyInjectedUsd),
    weeklyGmvUsd: toNumber(data?.weeklyGmvUsd),
    poolRatio: asText(data?.poolRatio, asText(config.poolRatio)),
    poolRatioValue: toNumber(data?.poolRatioValue),
    monthlyCapLabel: asText(data?.monthlyCapLabel, asText(config.monthlyCap)),
    monthlyCapUsd: toNumber(data?.monthlyCapUsd),
    participantCount: toNumber(data?.participantCount),
    topN: toNumber(data?.topN),
    topSharePct: toNumber(data?.topSharePct),
    unlockRank: toNumber(data?.unlockRank),
    settlementWindow: asText(data?.settlementWindow),
    settlementDispatchWindow: asText(data?.settlementDispatchWindow),
    quotaRows,
    quotaMonthlyStockLabel: asText(data?.quotaMonthlyStockLabel, asText(config.monthlyStock)),
    quotaMonthlyStockTotal: toNumber(data?.quotaMonthlyStockTotal, quotaRows.reduce((sum, row) => sum + row.cap, 0)),
    quotaMonthlyStockUsed: toNumber(data?.quotaMonthlyStockUsed, quotaRows.reduce((sum, row) => sum + row.current, 0)),
    quotaMonthlyStockRemaining: toNumber(
      data?.quotaMonthlyStockRemaining,
      quotaRows.reduce((sum, row) => sum + Math.max(0, row.cap - row.current), 0),
    ),
    proUnlock: asText(data?.proUnlock, asText(config.proUnlock)),
    rackUnlock: asText(data?.rackUnlock, asText(config.rackUnlock)),
    ambassadorBands,
    ambassadorStatus: asText(data?.ambassadorStatus, asText(config.ambassadorStatus)),
    ambassadorPendingCount: toNumber(data?.ambassadorPendingCount),
    ambassadorBudgetApprovedLabel: asText(data?.ambassadorBudgetApprovedLabel),
    ambassadorBudgetCapLabel: asText(data?.ambassadorBudgetCapLabel),
    ambassadorKolBudgetPct: toNumber(data?.ambassadorKolBudgetPct),
    ambassadorNextQuotaReviewDate: asText(data?.ambassadorNextQuotaReviewDate),
    leaderboardPoolLabel: asText(data?.leaderboardPoolLabel, asText(config.leaderboardPoolUsd)),
    leaderboardParticipantCount: toNumber(data?.leaderboardParticipantCount),
    leaderboardFraudHitCount: toNumber(data?.leaderboardFraudHitCount),
    leaderboardDisqualified: toBoolean(data?.leaderboardDisqualified),
    leaderboardPeriodStatus: asText(data?.leaderboardPeriodStatus, asText(config.leaderboardPeriodStatus)),
    podium,
    voteWeights,
    config,
    commissionPolicy: data?.commissionPolicy ?? {},
    guardrails: data?.guardrails ?? [],
    configValues: data?.configValues ?? {},
    // coverage 可选:后端 leadershipPool() 注入 B1 备付金覆盖率快照;无则不传(OperationConfirmModal 退化为提交时由后端实时校验),范式同 normalizeOverview。
    coverage: data?.coverage
      ? { coverageRatio: toNumber(data.coverage.coverageRatio), redlinePct: toNumber(data.coverage.redlinePct) }
      : undefined,
    sources: data?.sources ?? [],
  };
}

function normalizeF5Overview(data: BackendF5CommissionAuditOverview | null | undefined): F5CommissionAuditOverview {
  const summary = data?.summary ?? {};
  const commissionKinds = (data?.commissionKinds ?? []).map((item) => ({
    key: asText(item.key, "all"),
    code: asText(item.code, "ALL"),
    lbl: asText(item.label, "全部佣金类型"),
    amt: asText(item.amountLabel, "$0"),
    ct: asText(item.countLabel, "0 笔"),
    cls: asText(item.className, ""),
    amtColor: optionalText(item.amountColor),
  }));
  const commissionFilters = (data?.commissionFilters ?? []).map((item) => ({
    key: asText(item.key, "all"),
    lbl: asText(item.label, "全部状态"),
  }));
  const commissionEvents = (data?.commissionEvents ?? []).map((item) => {
    const id = asText(item.commissionId ?? item.id, "CM-UNKNOWN");
    const userId = toNumber(item.userId);
    return {
      id,
      eventId: toNumber(item.eventId, toNumber(id.replace(/^CM-/, ""))),
      kind: asText(item.kind, "network"),
      user: asText(item.user, userId > 0 ? `U${String(userId).padStart(8, "0")}` : "usr_unknown"),
      userId,
      amt: toNumber(item.amount),
      cur: asText(item.currency, "USDT"),
      sourceUserId: item.sourceUserId == null ? undefined : toNumber(item.sourceUserId),
      layer: item.layer == null ? undefined : toNumber(item.layer),
      settledAt: asText(item.settledAt, "-"),
      coolingDaysLeft: toNumber(item.coolingDaysLeft),
      status: asText(item.status, "cooling"),
      coolPct: toNumber(item.cooldownPercent),
      coolLb: asText(item.cooldownLabel, "冷却中"),
      state: asText(item.state, "计提"),
      auditKey: asText(item.auditKey, `F.commission.${id}.status`),
    };
  });
  const pagination = data?.pagination ?? {};
  return {
    summary: {
      monthlyCommissionSpendLabel: asText(summary.monthlyCommissionSpendLabel, "$0"),
      coolingBalanceLabel: asText(summary.coolingBalanceLabel, "$0"),
      withdrawableThisMonthLabel: asText(summary.withdrawableThisMonthLabel, "$0"),
      abnormalOrFrozenCount: toNumber(summary.abnormalOrFrozenCount),
    },
    commissionKinds,
    commissionFilters,
    commissionEvents,
    statusDistribution: (data?.statusDistribution ?? []).map((item) => ({
      dot: asText(item.color, "var(--ink-4)"),
      nm: asText(item.name, "-"),
      ct: String(toNumber(item.count)),
    })),
    recentAuditFeed: (data?.recentAuditFeed ?? []).map((item) => ({
      when: asText(item.when, "-"),
      text: asText(item.text, ""),
      level: asText(item.level, "LOW"),
    })),
    pagination: {
      mode: asText(pagination.mode, "server-pageable"),
      defaultWindow: asText(pagination.defaultWindow, "24h"),
      defaultPageSize: toNumber(pagination.defaultPageSize, 20),
      maxPageSize: toNumber(pagination.maxPageSize, 100),
    },
    nextCursor: asText(data?.nextCursor, ""),
    total: toNumber(data?.total, commissionEvents.length),
    anomalies: (data?.anomalies ?? []).map((item) => ({
      id: asText(item.id, "AN-UNKNOWN"),
      type: asText(item.type, "unknown"),
      commissionId: asText(item.commissionId, ""),
      userId: asText(item.userId, ""),
      evidence: asText(item.evidence, ""),
      relatedKCluster: asText(item.relatedKCluster, ""),
      status: asText(item.status, "open"),
    })),
    coolingPolicy: (data?.coolingPolicy ?? []).map((item) => ({
      kind: asText(item.kind, ""),
      days: toNumber(item.days),
      policy: asText(item.policy, ""),
    })),
    operationHistory: (data?.operationHistory ?? []).map((item) => ({
      operationNo: asText(item.operationNo, ""),
      operationType: asText(item.operationType, ""),
      sourceCommissionId: asText(item.sourceCommissionId, ""),
      resultCommissionId: asText(item.resultCommissionId, ""),
      userId: asText(item.userId, ""),
      kinds: asText(item.kinds, ""),
      amount: toNumber(item.amount),
      currency: asText(item.currency, ""),
      evidenceRef: asText(item.evidenceRef, ""),
      reason: asText(item.reason, ""),
      operator: asText(item.operator, ""),
      createdAt: asText(item.createdAt, ""),
    })),
    activeSuspensions: (data?.activeSuspensions ?? []).map((item) => ({
      userId: asText(item.userId, ""),
      kind: asText(item.kind, ""),
      reason: asText(item.reason, ""),
      operator: asText(item.operator, ""),
      updatedAt: asText(item.updatedAt, ""),
    })),
    commissionPolicy: data?.commissionPolicy ?? {},
    guardrails: data?.guardrails ?? [],
    configValues: data?.configValues ?? {},
    // coverage 可选:后端 commissions() 注入 B1 备付金覆盖率快照;无则不传(OperationConfirmModal 退化为提交时由后端实时校验),范式同 normalizeOverview。
    coverage: data?.coverage
      ? { coverageRatio: toNumber(data.coverage.coverageRatio), redlinePct: toNumber(data.coverage.redlinePct) }
      : undefined,
    sources: data?.sources ?? [],
  };
}

async function f1Request<T>(
  path: string,
  init?: RequestInit & { stableIdempotencyKey?: string },
) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const stableKey = init?.stableIdempotencyKey;
  if (stableKey) {
    headers.set("Idempotency-Key", stableKey);
  }
  const isWrite = !!init?.method && init.method !== "GET";
  // 保底:删掉 idempotencyPrefix 现铸通道后,没有任何东西还强制写请求带幂等键。
  // 新增写函数忘了走 f1StableWrite 时,契约门的计数断言仍会全绿,只有这道运行时闸拦得住。
  if (isWrite && !stableKey) {
    throw new Error("F1_WRITE_REQUIRES_STABLE_KEY");
  }

  let response: Response;
  try {
    response = await fetch(`/api/admin/teams${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch (error) {
    // 网络断时请求可能已到达后端:写路径归「结果未知」,保留命令号供原样重试(K 域同款分类)。
    if (isWrite && stableKey) {
      throw new F1OutcomeUncertainError(
        error instanceof Error ? error.message : "F1_REQUEST_OUTCOME_UNKNOWN",
        stableKey,
      );
    }
    throw error;
  }

  let result: ApiResult<T> | null = null;
  let bodyUnreadable = false;
  try {
    result = (await response.json()) as ApiResult<T>;
  } catch {
    bodyUnreadable = true;
  }

  // 会话失效判定必须排在任何 throw 之前:401 且错误页不是标准 JSON(代理 HTML 错误页)时,
  // 若先抛「响应不可读」就再也走不到这里,前端会卡在僵尸登录态(改动前的行为是会登出的)。
  const authRejected = isAdminAuthFailure(response.status, result?.message);
  if (authRejected) {
    resetAdminSession();
  }

  if (isWrite && stableKey && !authRejected) {
    // 三类「结果未知」:响应体不可读 / 上游显式声明 unknown / 5xx。都保号供原样重试。
    // 401 例外:后端明确拒绝且什么都没执行,归确定性失败弃号。
    if (bodyUnreadable) {
      throw new F1OutcomeUncertainError("F1_RESPONSE_UNREADABLE", stableKey);
    }
    // 头 + message 两路都认(与 a2-client 同款):teams proxy 目前不透传该头,靠下面的 5xx 兜底,
    // 但后端若改用「200 + 业务码非 0 + UPSTREAM_OUTCOME_UNKNOWN」表达未知,这一路能接住。
    if (response.headers.get("X-Nexion-Upstream-Outcome")?.trim().toLowerCase() === "unknown"
      || result?.message?.trim().toUpperCase().includes("UPSTREAM_OUTCOME_UNKNOWN") === true) {
      throw new F1OutcomeUncertainError(
        formatAdminApiError(result?.message, "F1_REQUEST_OUTCOME_UNKNOWN"),
        stableKey,
      );
    }
    // 5xx(网关超时 502/504、上游不可达 503)= 请求可能已被后端执行但结果没回来。
    // 口径对齐 stable-mutation.ts;丢号的代价(重复打款)远重于多保一次号。
    if (response.status >= 500) {
      throw new F1OutcomeUncertainError(
        formatAdminApiError(result?.message, `F1_REQUEST_FAILED_${response.status}`),
        stableKey,
      );
    }
    // 200 + 业务码 0 但 data 缺失:后端可能已执行,回包被截断。范式同 a2-client 的同名守卫。
    if (response.ok && result?.code === 0 && result.data == null) {
      throw new F1OutcomeUncertainError("F1_SUCCESS_RESPONSE_DATA_MISSING", stableKey);
    }
  }

  if (!response.ok || !result || result.code !== 0) {
    throw new Error(formatAdminApiError(result?.message, `F1_REQUEST_FAILED_${response.status}`));
  }

  return result.data as T;
}

export async function fetchF1VRankOverview() {
  const data = await f1Request<unknown>("/ranks");
  assertF1Overview(data);
  return normalizeOverview(data as BackendOverview);
}

export async function fetchF1PromotionLog(filters: F1PromotionFilters = {}) {
  return normalizePromotionPage(await f1Request<Record<string, unknown>>(
    `/promotion-log${queryString(filters)}`,
  ));
}

export async function fetchF1RewardPayouts(filters: F1PayoutFilters = {}) {
  return normalizePayoutPage(await f1Request<Record<string, unknown>>(
    `/reward-payouts${queryString(filters)}`,
  ));
}

export async function fetchF2RatesOverview() {
  const data = await f1Request<unknown>("/rates");
  assertF2Overview(data);
  return normalizeF2Overview(data as BackendF2Overview);
}

export async function fetchF3BinaryOverview() {
  const data = await f1Request<unknown>("/binary");
  assertF3Overview(data);
  return normalizeF3Overview(data as BackendF3Overview);
}

export async function fetchF4LeadershipPoolOverview() {
  const data = await f1Request<unknown>("/leadership-pool");
  assertF4Overview(data);
  return normalizeF4Overview(data as BackendF4LeadershipPoolOverview);
}

export async function fetchF5CommissionAuditOverview(query: F5CommissionQuery = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value?.trim()) search.set(key, value.trim());
  }
  const suffix = search.size ? `?${search.toString()}` : "";
  const data = await f1Request<unknown>(`/commissions${suffix}`);
  assertF5Overview(data);
  return normalizeF5Overview(data as BackendF5CommissionAuditOverview);
}

export async function reverseF5Commission(
  commissionId: string,
  refundRef: string,
  reason: string,
  operator: string,
) {
  // 指纹一律不含 reason:理由是审计元数据,不是意图。运营在「结果未知」后补一句理由再点是极自然的
  // 动作,若理由进指纹就会换新号 → 同一笔动作被执行两次。改理由复用旧号最坏只是审计记的是原措辞。
  return f1StableWrite(`f5-reverse|${commissionId}`, JSON.stringify([refundRef, operator]),
    (commandKey) => f1Request<Record<string, unknown>>(
      `/commissions/${encodeURIComponent(commissionId)}/reverse`,
      {
        method: "POST",
        body: JSON.stringify({ refundRef, reason, operator }),
        stableIdempotencyKey: commandKey,
      },
    ));
}

export async function reissueF5Commissions(
  commissionIds: string[],
  reason: string,
  operator: string,
) {
  // 重发 = 真实打款,最高危。整批 id 放**指纹**不放槽位:放槽位时每换一次勾选就多留一个 24h 记录,
  // 改回原勾选会复用那个可能已被后端消费的旧号(SlotAttempt 的弃旧号只在同槽位内生效);
  // 且槽位会被拼进命令号前缀,勾选量大时撑爆 HTTP 头。排序保证勾选顺序不同不算两批。
  return f1StableWrite("f5-reissue", JSON.stringify([[...commissionIds].sort(), operator]),
    (commandKey) => f1Request<Record<string, unknown>>("/commissions/reissue", {
      method: "POST",
      body: JSON.stringify({ commissionIds, reason, operator }),
      stableIdempotencyKey: commandKey,
    }));
}

export async function suspendF5UserCommissions(
  userId: number,
  kinds: string[],
  suspended: boolean,
  reason: string,
  operator: string,
) {
  return f1StableWrite(`f5-suspend|${userId}|${suspended}`, JSON.stringify([[...kinds].sort(), operator]),
    (commandKey) => f1Request<Record<string, unknown>>(`/commissions/users/${userId}/suspend`, {
      method: "POST",
      body: JSON.stringify({ kinds, suspended, reason, operator }),
      stableIdempotencyKey: commandKey,
    }));
}

export async function updateF5AnomalyConfig(
  commissionAnomalySigma: number,
  layerRatioAnomalyPct: number,
  reason: string,
  operator: string,
) {
  return f1StableWrite("f5-anomaly-config", JSON.stringify([commissionAnomalySigma, layerRatioAnomalyPct, operator]),
    (commandKey) => f1Request<Record<string, unknown>>("/commissions/anomaly-config", {
      method: "PUT",
      body: JSON.stringify({ commissionAnomalySigma, layerRatioAnomalyPct, reason, operator }),
      stableIdempotencyKey: commandKey,
    }));
}

export async function executeF3Settlement(
  ownerUserId: number,
  settlementDate: string,
  reason: string,
) {
  // 指纹恒定:同一 owner + 结算日就是同一次意图,理由措辞不改变要执行的动作。
  const data = await f1StableWrite(`f3-settle|${ownerUserId}|${settlementDate}`, "settlement",
    (commandKey) => f1Request<Record<string, unknown>>("/binary/settlements", {
      method: "POST",
      body: JSON.stringify({ ownerUserId, settlementDate, reason }),
      stableIdempotencyKey: commandKey,
    }));
  return {
    ownerUserId: toNumber(data.ownerUserId),
    settlementDate: asText(data.settlementDate, settlementDate),
    status: asText(data.status, ""),
    reason: asText(data.reason, ""),
    leftVolume: toNumber(data.leftVolume),
    rightVolume: toNumber(data.rightVolume),
    matchedVolume: toNumber(data.matchedVolume),
    amountUsdt: toNumber(data.amountUsdt),
    dailyCapUsdt: toNumber(data.dailyCapUsdt),
    commissionEventId: data.commissionEventId == null ? null : toNumber(data.commissionEventId),
    replayed: toBoolean(data.replayed),
  } satisfies F3SettlementExecution;
}

export async function updateF1VRankThreshold(rank: string, field: string, value: string, reason: string, operator: string) {
  return normalizeOverview(await f1StableWrite(`f1-vrank|${rank}|${field}`, JSON.stringify([value, operator]),
    (commandKey) => f1Request<BackendOverview>(`/ranks/${encodeURIComponent(rank)}/thresholds/${encodeURIComponent(field)}`, {
      method: "PATCH",
      body: JSON.stringify({ value, reason, operator }),
      stableIdempotencyKey: commandKey,
    })));
}

export async function addF1VRankReward(rank: string, item: Omit<OpsVRankRewardItem, "id">, reason: string, operator: string) {
  return normalizeOverview(await f1StableWrite(`f1-reward-add|${rank}`, JSON.stringify([item, operator]),
    (commandKey) => f1Request<BackendOverview>(`/ranks/${encodeURIComponent(rank)}/rewards`, {
      method: "POST",
      body: JSON.stringify({ ...item, reason, operator }),
      stableIdempotencyKey: commandKey,
    })));
}

export async function updateF1VRankReward(rank: string, rewardId: string, item: Omit<OpsVRankRewardItem, "id">, reason: string, operator: string) {
  return normalizeOverview(await f1StableWrite(`f1-reward-update|${rank}|${rewardId}`, JSON.stringify([item, operator]),
    (commandKey) => f1Request<BackendOverview>(`/ranks/${encodeURIComponent(rank)}/rewards/${encodeURIComponent(rewardId)}`, {
      method: "PUT",
      body: JSON.stringify({ ...item, reason, operator }),
      stableIdempotencyKey: commandKey,
    })));
}

export async function removeF1VRankReward(rank: string, rewardId: string, reason: string, operator: string) {
  return normalizeOverview(await f1StableWrite(`f1-reward-remove|${rank}|${rewardId}`, JSON.stringify([operator]),
    (commandKey) => f1Request<BackendOverview>(`/ranks/${encodeURIComponent(rank)}/rewards/${encodeURIComponent(rewardId)}`, {
      method: "DELETE",
      body: JSON.stringify({ reason, operator }),
      stableIdempotencyKey: commandKey,
    })));
}
