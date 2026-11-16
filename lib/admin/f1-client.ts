import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { finiteDashboardNumber } from "@/lib/admin/dashboard-number";
import { formatAdminApiError, guardedFetch, rawFetch } from "@/lib/admin/error-messages";
import { isIdempotencyOutcomeOpen, outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { F1OutcomeUncertainError, f1StableWrite } from "@/lib/admin/f1-stable-write";
import { verifyF5CsvArtifact } from "@/lib/admin/f5-export-verifier";
import { parseDirectReferralPolicy } from "@/lib/admin/direct-referral-policy";
import type { OpsVRankRewardItem, VRankRewardType } from "@/lib/admin/platform-types";
import type { F1PolicyValues } from "./f1-policy-change";
import { f3SpilloverState } from "./f3-policy";
import { f4Decimal, f4MonthlyCap } from "./f4-money";
import { readF4VoteProjection } from "./f4-vote-projection";
import type { BusinessZone } from "./business-time";
import {
  assertF1Overview,
  assertF2Overview,
  assertF3Overview,
  assertF4Overview,
  assertF4MaterialPacket,
  assertF5Overview,
} from "@/lib/admin/f-overview-contract";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

interface BackendVRankRow {
  policyRevision?: string | null;
  v?: string | null;
  label?: string | null;
  selfBuy?: string | number | null;
  directRefs?: string | null;
  teamGv?: string | number | null;
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
  amountText?: string | null;
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
  rewardValuationUsdtPerUvt?: string | null;
  vrankRows?: BackendVRankRow[] | null;
  monthlyPromotionCount?: number | null;
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
  reliable?: boolean;
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
  sevenLayerRevision?: number | string;
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
  h1BinaryDailyCap?: string | number | null;
  currentLabel?: string | null;
  windowLabel?: string | null;
  nextTrigger?: string | null;
  nextLabel?: string | null;
  currentMonth?: number | string | null;
  currentPhase?: string | null;
}

interface BackendF3Config {
  paused?: boolean | null;
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
  id?: number | string | null;
  quotaCode?: string | null;
  productNo?: string | null;
  name?: string | null;
  directRefs?: number | string | null;
  monthComputePoints?: number | string | null;
  monthComputePointsText?: string | null;
  unlockMode?: string | null;
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
  memberUserId?: number | string | null;
  computePoints?: number | null;
}

interface BackendF4QuotaUsage { id?: number | string | null; quotaCode?: string | null; productNo?: string | null; userId?: number | string | null; orderNo?: string | null; quantity?: number | string | null; status?: string | null; occurredAt?: string | null }
interface BackendF4AmbassadorApplication extends Partial<F4AmbassadorMaterialSummary> { id?: number | string | null; userId?: number | string | null; applicantName?: string | null; region?: string | null; city?: string | null; currentRank?: string | null; requestedBudgetUsd?: number | string | null; kolBudgetPct?: number | string | null; status?: string | null; eventDate?: string | null; createdAt?: string | null }

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
  configVersion?: string | number | null;
  settlementConfigStatus?: string | null;
  settlementConfigUnavailableKey?: string | null;
  settlementConfigUnavailableReason?: string | null;
  metrics?: BackendF4Metric[] | null;
  weeklyInjectedUsd?: number | string | null;
  currentWeekPoolUsd?: number | string | null;
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
  nextSettlementAt?: string | null;
  quotaRows?: BackendF4QuotaRow[] | null;
  quotaUsages?: BackendF4QuotaUsage[] | null;
  quotaMonthlyStockLabel?: string | null;
  quotaMonthlyStockTotal?: number | string | null;
  quotaMonthlyStockUsed?: number | string | null;
  quotaMonthlyStockRemaining?: number | string | null;
  proUnlock?: string | null;
  rackUnlock?: string | null;
  ambassadorBands?: BackendF4AmbassadorBand[] | null;
  ambassadorApplications?: BackendF4AmbassadorApplication[] | null;
  ambassadorStatus?: string | null;
  ambassadorPendingCount?: number | string | null;
  ambassadorBudgetApprovedLabel?: string | null;
  ambassadorBudgetCapLabel?: string | null;
  ambassadorKolBudgetPct?: number | string | null;
  ambassadorNextQuotaReviewDate?: string | null;
  leaderboardPeriods?: unknown;
  leaderboardPoolLabel?: string | null;
  leaderboardParticipantCount?: number | string | null;
  leaderboardFraudHitCount?: number | string | null;
  leaderboardDisqualified?: boolean | string | null;
  leaderboardPaused?: boolean | null;
  leaderboardSnapshotState?: string | null;
  leaderboardDataAvailable?: boolean | null;
  leaderboardSnapshotId?: string | null;
  leaderboardSnapshotAt?: string | null;
  leaderboardSnapshotUnavailableReason?: string | null;
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
  monthlyCommissionSpendLabel: string;
  monthlyCommissionSpend: BackendF5MoneySnapshot;
  coolingBalanceLabel: string;
  coolingBalance: BackendF5MoneySnapshot;
  withdrawableThisMonthLabel: string;
  withdrawableThisMonth: BackendF5MoneySnapshot;
  frozenCount: number | string;
}

interface BackendF5MoneySnapshot {
  usdt: number | string;
  nex: number | string;
  count: number | string;
}

interface BackendF5CommissionKind {
  key: string;
  code: string;
  label: string;
  amountLabel: string;
  amounts: BackendF5MoneySnapshot;
  count: number | string;
  countLabel: string;
  className: string;
  amountColor?: string | null;
}

interface BackendF5Filter {
  key: string;
  label: string;
}

interface BackendF5CommissionEvent {
  unlockAt?: number | null;
  settlementNo?: string | null;
  sourceRef?: string | null;
  sourceDeviceId?: string | null;
  policyVersion?: number | string | null;
  basisUsdt?: number | string | null;
  nexUsdtPrice?: number | string | null;
  amountUSDT?: number | string | null;
  amountNEX?: number | string | null;
  recoveryPendingUSDT?: number | string | null;
  recoveryPendingNEX?: number | string | null;
  reversalRecorded?: boolean | null;
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
  version?: number | string | null;
  frozenFromStatus?: string | null;
  ledgerBizNo?: string | null;
}

interface BackendF5StatusItem {
  color: string;
  name: string;
  count: number | string;
}

interface BackendF5AuditFeedItem {
  when?: string | null;
  text?: string | null;
  level?: string | null;
}

interface BackendF5Pagination {
  mode: string;
  defaultWindow: string;
  defaultPageSize: number | string;
  maxPageSize: number | string;
  pageSize: number | string;
  requestCursor: string;
  nextCursor: string;
  total: number | string;
}

interface BackendF5CommissionAuditOverview {
  pendingCalculations: F5PendingCalculation[];
  pendingCalculationCount: number | string;
  summary: BackendF5Summary;
  commissionKinds: BackendF5CommissionKind[];
  commissionFilters: BackendF5Filter[];
  commissionEvents: BackendF5CommissionEvent[];
  statusDistribution: BackendF5StatusItem[];
  recentAuditFeed: BackendF5AuditFeedItem[];
  pagination: BackendF5Pagination;
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
  policyRevision?: string;
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
  rewardValuationUsdtPerUvt: string | null;
  rows: F1VRankRow[];
  monthlyPromotionCount: number | null;
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
  cursor?: string;
}

export interface F1RewardPayout {
  payoutId: string;
  userId: string;
  rankCode: string;
  rewardType: string;
  amount: number;
  /** 后端给的金额原文，显示用；amount 已转成数字，会丢小数位。 */
  amountText: string;
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
  usdt: number | null;
  nex: number | null;
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
  sevenLayerRevision: number | null;
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
  amountUsdt: string | null;
  currentLabel: string;
  windowLabel: string;
  nextTrigger: string;
  nextLabel: string;
  currentMonth: number;
  currentPhase: string;
}

/**
 * F3 归零口径的服务端配置键。
 *
 * 🔴 为什么定义在 client 而不是页面里(2026-08-06):f3-binary-closure-contract 有一道术语门,
 *   断言 F3 页面正文(含注释)不得出现开发代号形态的英文标识。归零口径本身是**合法可配项**
 *   ——后端结算策略一直读它、该门自己的合法配置键清单里也有它——所以运营入口该有;
 *   键名放这里、页面只出中文标签,两个约束同时满足。
 */
export const F3_GV_RESET_PARAM_KEY = ["F", "binary", "gvResetCron"].join(".");

export interface F3BinaryConfig {
  paused?: boolean | null;
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
  id: number;
  quotaCode: string;
  productNo: string;
  name: string;
  directRefs: number;
  monthComputePoints: number;
  monthComputePointsText: string | null;
  unlockMode: "ALL" | "EITHER";
  criteriaKnown: boolean;
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
  memberUserId: number;
}

export interface F4LeaderboardPeriod {
  poolUsd: number;
  poolUsdText?: string;
  participantCount: number;
  topN: number;
  timezone: "Asia/Shanghai";
  snapshotAt: string;
  podium: F4Podium[];
}
export type F4LeaderboardPeriods = Partial<Record<"today" | "week" | "month" | "all", F4LeaderboardPeriod>>;

export interface F4ComputePointPodium extends F4Podium { computePoints: number }
export interface F4ComputePointPeriod extends Omit<F4LeaderboardPeriod, "podium"> {
  rankingMetric: "COMPUTE_POINTS";
  minComputePoints: number;
  businessTimezone: string;
  fromInclusive: string | null;
  toExclusive: string | null;
  podium: F4ComputePointPodium[];
}
export type F4ComputePointPeriods = Partial<Record<"today" | "week" | "month" | "all", F4ComputePointPeriod>>;

export type F4PayoutPeriod = "today" | "week" | "month" | "allTime";
export interface F4LeaderboardPayoutPreview {
  period: F4PayoutPeriod; periodKey: string; paused: boolean; alreadySettled: boolean;
  available: boolean; reason: string; rankingMetric: "COMPUTE_POINTS";
  prizePoolUsdt: string; minComputePoints: string; topN: number; top1MaxPct: string; top5MaxPct: string;
  // Not returned when the pool is absent; absence must not be turned into zero.
  candidateCount?: number; rankedCount?: number; paidCount?: number;
  amountBeforeCaps?: string; payableAmount?: string; reducedByCaps?: string;
  rows: { rank: number; userId: number; userNo: string; computePoints: string;
    amountBeforeCaps: string; amount: string; limitedBy: ("top1MaxPct" | "top5MaxPct")[] }[];
}
export interface F4LeaderboardDisqualificationReadiness {
  period: "week"; periodKey: string; rankingMetric: "COMPUTE_POINTS"; minComputePoints: string;
  rows: { rank: number; memberUserId: number; userNo: string; computePoints: string;
    disqualificationAvailable: boolean; riskEvidenceRef: string; reason: string }[];
}

export interface F4QuotaUsage { id: number; quotaCode: string; productNo: string; userId: number; orderNo: string; quantity: number; status: string; occurredAt: string }
export type F4AmbassadorBucket = "venue" | "kol" | "print" | "dev";
export interface F4AmbassadorReview {
  status: "PENDING" | "NEEDS_MORE" | "PASSED";
  reviewerLabel: string | null;
  reviewedAt: string | null;
  reason: string | null;
  verifiedAttendees?: number | null;
  recognizedBudgetUsdt?: number | string | null;
  materialRevision?: number;
  stage?: "BUSINESS" | "FINANCE";
}
export interface F4AmbassadorMaterialSummary {
  bucket: F4AmbassadorBucket | null;
  materialRevision: number;
  materialState: "NOT_SUBMITTED" | "PENDING" | "NEEDS_MORE" | "PASSED";
  businessReview: F4AmbassadorReview;
  financeReview: F4AmbassadorReview;
  missingKinds: string[];
  approvalBlockers: string[];
  legacyApproved: boolean;
}
export interface F4AmbassadorMaterialPacket extends F4AmbassadorMaterialSummary {
  applicationId: number;
  eventDate: string | null;
  budgetUsdt: number | string;
  requirements: { kind: string; label: string; required: boolean }[];
  attachments: { fileId: string; kind: string; name: string; contentType: string; sizeBytes: number }[];
  statement: string;
  canSubmit: boolean;
  canReviewBusiness: boolean;
  canReviewFinance: boolean;
  canProposeApproval: boolean;
  proposalBlockers: string[];
  canApprove: boolean;
  reviewHistory?: F4AmbassadorReview[];
}
export type F4AmbassadorMaterialProposal = Pick<F4AmbassadorMaterialPacket,
  "applicationId" | "bucket" | "budgetUsdt" | "materialRevision" | "materialState" | "businessReview" | "financeReview" | "canApprove" | "approvalBlockers"> & {
  expectedMaterialRevision: number | null;
  applicationDecision: "APPROVE" | "REJECT" | null;
  recognizedBudgetUsdt: number | string | null;
};
export interface F4AmbassadorReviewInput {
  expectedMaterialRevision: number;
  stage: "BUSINESS" | "FINANCE";
  decision: "PASSED" | "NEEDS_MORE";
  reason: string;
  verifiedAttendees?: number;
  recognizedBudgetUsdt?: string;
  missingKinds?: string[];
}
export class F4MaterialReviewNotAppliedError extends Error {
  readonly status = 409;
  readonly httpStatus = 409;
  readonly apiCode = 409;
  get backendMessage() { return this.code; }
  constructor(message: string, public readonly code: "MATERIAL_REVISION_STALE" | "APPLICATION_NOT_PENDING") {
    super(message); this.name = "F4MaterialReviewNotAppliedError";
  }
}
export interface F4AmbassadorApplication extends Partial<F4AmbassadorMaterialSummary> { id: number; userId: number; applicantName: string; region: string; city: string; currentRank: string; requestedBudgetUsd: number; kolBudgetPct: number; status: string; eventDate: string; createdAt: string }

export interface F4AmbassadorPolicyBucket {
  id: "venue" | "kol" | "print" | "dev";
  title: string;
  range: string;
  rule: string;
  minBudgetUsdt: number;
  maxBudgetUsdt: number;
}

export interface F4AmbassadorPolicy {
  policyVersion: string;
  revision: number;
  defaultBudgetUsdt: number;
  buckets: F4AmbassadorPolicyBucket[];
  serverCanonical: true;
}

export interface F4AmbassadorPolicyUpdate {
  policyVersion: string;
  expectedRevision: number;
  defaultBudgetUsdt: string;
  buckets: (Omit<F4AmbassadorPolicyBucket, "minBudgetUsdt" | "maxBudgetUsdt"> & {
    minBudgetUsdt: string;
    maxBudgetUsdt: string;
  })[];
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
  settlementZone?: BusinessZone | null;
  configVersion: string;
  settlementConfigStatus: "READY" | "HOLD";
  settlementConfigUnavailableKey: string;
  settlementConfigUnavailableReason: string;
  metrics: F4Metric[];
  weeklyInjectedUsd: number;
  currentWeekPoolUsd: number | null;
  currentWeekPoolAmount?: string | null;
  weeklyGmvUsd: number;
  poolRatio: string;
  poolRatioValue: number;
  monthlyCapLabel: string;
  monthlyCapUsd: number;
  monthlyCapAmount?: string | null;
  participantCount: number;
  topN: number;
  topSharePct: number;
  unlockRank: number;
  settlementWindow: string;
  settlementDispatchWindow: string;
  nextSettlementAt: string;
  quotaRows: F4QuotaRow[];
  quotaUsages: F4QuotaUsage[];
  quotaMonthlyStockLabel: string;
  quotaMonthlyStockTotal: number;
  quotaMonthlyStockUsed: number;
  quotaMonthlyStockRemaining: number;
  proUnlock: string;
  rackUnlock: string;
  ambassadorBands: F4AmbassadorBand[];
  ambassadorApplications: F4AmbassadorApplication[];
  ambassadorStatus: string;
  ambassadorPendingCount: number;
  ambassadorBudgetApprovedLabel: string;
  ambassadorBudgetCapLabel: string;
  ambassadorKolBudgetPct: number;
  ambassadorNextQuotaReviewDate: string;
  leaderboardPeriods?: F4LeaderboardPeriods;
  /** Point rankings await the page's point labels/units; never feed them to USDT slots. */
  leaderboardComputePointPeriods?: F4ComputePointPeriods;
  leaderboardPoolLabel: string;
  leaderboardParticipantCount: number;
  leaderboardFraudHitCount: number;
  leaderboardDisqualified: boolean;
  leaderboardPaused?: boolean;
  leaderboardSnapshotState?: "LIVE" | "FROZEN" | "UNAVAILABLE";
  leaderboardDataAvailable?: boolean;
  leaderboardSnapshotId?: string;
  leaderboardSnapshotAt?: string;
  leaderboardSnapshotUnavailableReason?: string;
  leaderboardPeriodStatus: string;
  podium: F4Podium[];
  voteWeights: F4VoteWeight[];
  config: F4Config;
  commissionPolicy: Record<string, unknown>;
  guardrails: string[];
  configValues: Record<string, string>;
  coverage?: { coverageRatio: number; redlinePct: number; reliable?: boolean; coverageRatioText?: string; redlinePctText?: string };
  sources: string[];
}

export interface F5CommissionSummary {
  monthlyCommissionSpendLabel: string;
  coolingBalanceLabel: string;
  withdrawableThisMonthLabel: string;
  frozenCount: number;
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
  /** Grouped reads project settlement release_at; the shifted network event deadline is not returned. */
  unlockAt?: number;
  settlementNo?: string;
  sourceRef?: string;
  sourceDeviceId?: string;
  policyVersion?: number;
  basisUsdt?: string;
  nexUsdtPrice?: string;
  amountUSDT?: string;
  amountNEX?: string;
  recoveryPendingUSDT?: string;
  recoveryPendingNEX?: string;
  reversalRecorded?: boolean;
  id: string;
  eventId: number;
  kind: string;
  user: string;
  userId: number;
  amt: string;
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
  version: number;
  frozenFromStatus?: string;
  ledgerBizNo?: string;
}

export interface F5PendingCalculation {
  id: string;
  settlementNo: string;
  kind: "direct_purchase" | "direct_device_earning";
  layer: number | string;
  sourceRef: string;
  sourceUserName: string;
  basisUsdt: number | string;
  amountUSDT: number | string;
  amountNEX: number | string;
  nexUsdtPrice: null;
  status: "waiting_calculation";
  unlockAt: number | null;
  ts: number | null;
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
  amount: string | null;
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
  pendingCalculations: F5PendingCalculation[];
  pendingCalculationCount: number;
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
  coverage?: { coverageRatio: number; redlinePct: number; reliable?: boolean; coverageRatioText: string; redlinePctText: string; redlineBreached: boolean };
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
  return value === "usdt" || value === "uvt" || value === "voucher" || value === "sku" || value === "custom" ? value : "custom";
}

function normalizeReward(item: BackendReward): OpsVRankRewardItem {
  const type = normalizeRewardType(item.type ?? undefined);
  return {
    id: asText(item.id, `vr-${type}`),
    type,
    amount: type === "usdt" || type === "uvt" ? toNumber(item.amount) : undefined,
    amountText: (type === "usdt" || type === "uvt") && typeof item.amountText === "string" ? item.amountText : undefined,
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
  const monthlyPromotionCount = data?.monthlyPromotionCount;
  const backendRewards = data?.rewards ?? {};
  const rewards: Record<string, OpsVRankRewardItem[]> = {};
  const rows = (data?.vrankRows ?? []).map((row) => {
    const v = asText(row.v, "V?");
    const rowRewards = normalizeRewardList(row.rewards ?? backendRewards[v]);
    rewards[v] = rowRewards;
    return {
      v,
      policyRevision: typeof row.policyRevision === "string" ? row.policyRevision : undefined,
      label: asText(row.label, v),
      selfBuy: row.selfBuy == null ? undefined : String(row.selfBuy),
      directRefs: row.directRefs == null ? undefined : String(row.directRefs),
      teamGv: row.teamGv == null ? undefined : String(row.teamGv),
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
  const coverage = rawCoverage?.coverageRatio != null && rawCoverage.redlinePct != null
    && Number.isFinite(Number(rawCoverage.coverageRatio)) && Number.isFinite(Number(rawCoverage.redlinePct))
    ? { coverageRatio: Number(rawCoverage.coverageRatio), redlinePct: Number(rawCoverage.redlinePct) }
    : undefined;
  return {
    rows,
    rewardValuationUsdtPerUvt: typeof data?.rewardValuationUsdtPerUvt === "string" ? data.rewardValuationUsdtPerUvt : null,
    monthlyPromotionCount: typeof monthlyPromotionCount === "number"
      && Number.isSafeInteger(monthlyPromotionCount) && monthlyPromotionCount >= 0 ? monthlyPromotionCount : null,
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
    nextCursor: asText(data?.nextCursor),
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
        // 后端给的金额原文：转成数字再显示会丢小数位（F1-B04），页面显示用这一份。
        amountText: asScalarText(row.amount),
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
    usdt: item.usdtPct === null ? null : toNumber(item.usdtPct),
    nex: item.nexReward === null ? null : toNumber(item.nexReward),
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
      value: asText(item.value, ""),
      def: fallback,
      vcls: asText(item.viewClass, ""),
      sub: asText(item.sub, ""),
      amp: toBoolean(item.amplifies),
      vamp: toBoolean(item.visualAmplify),
      unit: optionalText(item.unit),
    };
  });
  return {
    sevenLayerRevision: data?.sevenLayerRevision === undefined ? null : toNumber(data.sevenLayerRevision),
    metrics,
    unilevel,
    rateTiers,
    params,
    commissionPolicy: data?.commissionPolicy ?? {},
    guardrails: data?.guardrails ?? [],
    configValues: data?.configValues ?? {},
    // coverage 可选:后端 rates() 注入 B1 备付金覆盖率快照;无则不传(OperationConfirmModal 退化为提交时由后端实时校验),范式同 normalizeOverview。
    coverage: data?.coverage
      ? {
          coverageRatio: toNumber(data.coverage.coverageRatio),
          redlinePct: toNumber(data.coverage.redlinePct),
        }
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
  if (config.paused !== undefined && config.paused !== null && typeof config.paused !== "boolean") throw new Error("F3_RESPONSE_INVALID:config.paused");
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
      amountUsdt: dailyCap.h1BinaryDailyCap == null ? null : asScalarText(dailyCap.h1BinaryDailyCap),
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
      spilloverEnabled: f3SpilloverState(config.spillover ?? undefined) === true,
      paused: config.paused,
      gvResetCron: asText(config.gvResetCron),
      settlePeriod: asText(config.settlePeriod),
      residualPolicy: asText(config.residualPolicy),
      residualPool: asText(config.residualPool),
      residualSub: asText(config.residualSub),
    },
    commissionPolicy: data?.commissionPolicy ?? {},
    guardrails: data?.guardrails ?? [],
    configValues: data?.configValues ?? {},
    // binary() 的可空 B1 快照不补0；配置护栏在批准执行，实际结算仍按当时金额复核。
    coverage: data?.coverage && finiteDashboardNumber(data.coverage.coverageRatio) !== null && finiteDashboardNumber(data.coverage.redlinePct) !== null
      ? { coverageRatio: Number(data.coverage.coverageRatio), redlinePct: Number(data.coverage.redlinePct) }
      : undefined,
    sources: data?.sources ?? [],
  };
}

function quotaPointsText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^(?:0|[1-9]\d{0,17})$/.test(text) ? text : null;
}

function quotaCriteriaKnown(row: BackendF4QuotaRow): boolean {
  const refs = finiteDashboardNumber(row.directRefs);
  return refs !== null && Number.isSafeInteger(refs) && refs >= 0
    && quotaPointsText(row.monthComputePointsText) !== null
    && ["ALL", "EITHER"].includes(asText(row.unlockMode).toUpperCase());
}

function normalizeF4Overview(data: BackendF4LeadershipPoolOverview | null | undefined): F4LeadershipPoolOverview {
  const paused = toBoolean(data?.leaderboardPaused, toBoolean(data?.configValues?.["F.leaderboard.paused"]));
  const integer = (value: unknown, minimum = 0): value is number => typeof value === "number"
    && Number.isSafeInteger(value) && value >= minimum;
  const label = (value: unknown): boolean => typeof value === "string"
    && /^\$-?\d[\d,]*(?:\.\d+)?$/.test(value);
  const snapshotReady = paused && data?.leaderboardSnapshotState === "FROZEN" && data.leaderboardDataAvailable === true
    && typeof data.leaderboardSnapshotId === "string" && !!data.leaderboardSnapshotId.trim()
    && typeof data.leaderboardSnapshotAt === "string" && Number.isFinite(Date.parse(data.leaderboardSnapshotAt));
  const legacyFrozen = snapshotReady && integer(data.leaderboardParticipantCount) && label(data.leaderboardPoolLabel)
    && Array.isArray(data.podium) && data.podium.every((row) => row && integer(row.rank, 1) && row.rank <= 3
      && integer(row.memberUserId, 1) && typeof row.userId === "string" && !!row.userId.trim()
      && label(row.gmvLabel) && typeof row.tip === "string" && typeof row.className === "string");
  const leaderboardPeriods: F4LeaderboardPeriods = {};
  const leaderboardComputePointPeriods: F4ComputePointPeriods = {};
  if ((!paused || snapshotReady) && data?.leaderboardPeriods && typeof data.leaderboardPeriods === "object") {
    const rawPeriods = data.leaderboardPeriods as Record<string, unknown>;
    for (const period of ["today", "week", "month", "all"] as const) {
      const raw = rawPeriods[period];
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const points = row.rankingMetric === "COMPUTE_POINTS";
      if (paused && !legacyFrozen && !points) continue;
      const max = period === "today" ? 20 : period === "week" ? 50 : 100;
      const poolUsd = finiteDashboardNumber(row.poolUsd);
      if (poolUsd === null || poolUsd < 0
        || !integer(row.participantCount) || row.participantCount > max
        || !integer(row.topN) || row.topN > row.participantCount
        || row.timezone !== "Asia/Shanghai" || typeof row.snapshotAt !== "string" || !Number.isFinite(Date.parse(row.snapshotAt))
        || (paused && row.snapshotAt !== data.leaderboardSnapshotAt)
        || !Array.isArray(row.podium) || row.podium.length > Math.min(3, row.participantCount)
        || !row.podium.every((item, index) => item && item.rank === index + 1
          && integer(item.memberUserId, 1) && typeof item.userId === "string" && !!item.userId.trim()
          && (points ? integer(item.computePoints, 1) && typeof item.gmvLabel === "string" : label(item.gmvLabel))
          && typeof item.tip === "string" && typeof item.className === "string")) continue;
      if (points) {
        if (!integer(row.minComputePoints) || typeof row.businessTimezone !== "string" || !row.businessTimezone.trim()
          || !(row.fromInclusive === null || typeof row.fromInclusive === "string" && !!row.fromInclusive.trim())
          || !(row.toExclusive === null || typeof row.toExclusive === "string" && !!row.toExclusive.trim())) continue;
        leaderboardComputePointPeriods[period] = { rankingMetric: "COMPUTE_POINTS", minComputePoints: row.minComputePoints,
          businessTimezone: row.businessTimezone, fromInclusive: row.fromInclusive, toExclusive: row.toExclusive,
          poolUsd, poolUsdText: f4Decimal(String(row.poolUsd)) ?? undefined, participantCount: row.participantCount,
          topN: row.topN, timezone: row.timezone, snapshotAt: row.snapshotAt, podium: row.podium as F4ComputePointPodium[] };
        continue;
      }
      leaderboardPeriods[period] = { poolUsd, poolUsdText: f4Decimal(String(row.poolUsd)) ?? undefined, participantCount: row.participantCount,
        topN: row.topN, timezone: row.timezone, snapshotAt: row.snapshotAt, podium: row.podium as F4Podium[] };
    }
  }
  const frozen = legacyFrozen || snapshotReady && Object.keys(leaderboardComputePointPeriods).length === 4;
  const metrics = (data?.metrics ?? []).map((item) => ({
    id: asText(item.id, "metric"),
    name: asText(item.label, "指标"),
    value: asText(item.value, "-"),
    sub: asText(item.sub, ""),
    tone: asText(item.tone, ""),
  }));
  const quotaRows = (data?.quotaRows ?? []).map((row) => ({
    id: toNumber(row.id),
    quotaCode: asText(row.quotaCode),
    productNo: asText(row.productNo),
    name: asText(row.name, "Quota"),
    directRefs: toNumber(row.directRefs),
    monthComputePoints: toNumber(row.monthComputePoints),
    monthComputePointsText: quotaPointsText(row.monthComputePointsText),
    unlockMode: asText(row.unlockMode).toUpperCase() === "EITHER" ? "EITHER" as const : "ALL" as const,
    criteriaKnown: quotaCriteriaKnown(row),
    current: toNumber(row.current),
    cap: toNumber(row.cap),
    tight: toBoolean(row.tight),
  }));
  const ambassadorBands = (data?.ambassadorBands ?? []).map((row) => ({
    name: asText(row.name, "BAND"),
    count: toNumber(row.count),
  }));
  const quotaUsages = (data?.quotaUsages ?? []).map((row) => ({
    id: toNumber(row.id), quotaCode: asText(row.quotaCode), productNo: asText(row.productNo),
    userId: toNumber(row.userId), orderNo: asText(row.orderNo), quantity: toNumber(row.quantity),
    status: asText(row.status), occurredAt: asText(row.occurredAt),
  }));
  const ambassadorApplications = (data?.ambassadorApplications ?? []).map((row) => ({
    id: toNumber(row.id), userId: toNumber(row.userId), applicantName: asText(row.applicantName),
    region: asText(row.region), city: asText(row.city), currentRank: asText(row.currentRank),
    requestedBudgetUsd: toNumber(row.requestedBudgetUsd), kolBudgetPct: toNumber(row.kolBudgetPct),
    status: asText(row.status), eventDate: asText(row.eventDate), createdAt: asText(row.createdAt),
    bucket: row.bucket ?? null, materialRevision: row.materialRevision, materialState: row.materialState,
    businessReview: row.businessReview, financeReview: row.financeReview, missingKinds: row.missingKinds,
    approvalBlockers: row.approvalBlockers, legacyApproved: row.legacyApproved,
  }));
  const podium = (paused && !frozen ? [] : data?.podium ?? []).filter(row => row.computePoints === undefined).map((row) => ({
    rank: toNumber(row.rank),
    userId: asText(row.userId, "usr_unknown"),
    gmvLabel: asText(row.gmvLabel, "-"),
    tip: asText(row.tip, ""),
    className: asText(row.className, ""),
    memberUserId: toNumber(row.memberUserId),
  }));
  const voteWeights = (data?.voteWeights ?? []).map((row) => ({
    v: asText(row.v, "V?"),
    votes: toNumber(row.votes),
    configKey: asText(row.configKey, ""),
  }));
  const config = data?.config ?? {};
  return {
    configVersion: asText(data?.configVersion),
    leaderboardSnapshotState: !paused ? "LIVE" : frozen ? "FROZEN" : "UNAVAILABLE",
    leaderboardDataAvailable: !paused || frozen,
    leaderboardSnapshotId: asText(data?.leaderboardSnapshotId),
    leaderboardSnapshotAt: asText(data?.leaderboardSnapshotAt),
    leaderboardSnapshotUnavailableReason: asText(data?.leaderboardSnapshotUnavailableReason),
    settlementConfigStatus: asText(data?.settlementConfigStatus) === "READY" ? "READY" : "HOLD",
    settlementConfigUnavailableKey: asText(data?.settlementConfigUnavailableKey),
    settlementConfigUnavailableReason: asText(data?.settlementConfigUnavailableReason),
    metrics,
    weeklyInjectedUsd: toNumber(data?.weeklyInjectedUsd),
    currentWeekPoolUsd: finiteDashboardNumber(data?.currentWeekPoolUsd),
    currentWeekPoolAmount: data?.currentWeekPoolUsd == null ? null : f4Decimal(data.currentWeekPoolUsd),
    weeklyGmvUsd: toNumber(data?.weeklyGmvUsd),
    poolRatio: asText(data?.poolRatio, asText(config.poolRatio)),
    poolRatioValue: toNumber(data?.poolRatioValue),
    monthlyCapLabel: asText(data?.monthlyCapLabel, asText(config.monthlyCap)),
    monthlyCapUsd: toNumber(data?.monthlyCapUsd),
    monthlyCapAmount: f4MonthlyCap(data?.configValues?.["F.pool.monthlyCap"] ?? ""),
    participantCount: toNumber(data?.participantCount),
    topN: toNumber(data?.topN),
    topSharePct: toNumber(data?.topSharePct),
    unlockRank: toNumber(data?.unlockRank),
    settlementWindow: asText(data?.settlementWindow),
    settlementDispatchWindow: asText(data?.settlementDispatchWindow),
    nextSettlementAt: asText(data?.nextSettlementAt),
    quotaRows,
    quotaUsages,
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
    ambassadorApplications,
    ambassadorStatus: asText(data?.ambassadorStatus, asText(config.ambassadorStatus)),
    ambassadorPendingCount: toNumber(data?.ambassadorPendingCount),
    ambassadorBudgetApprovedLabel: asText(data?.ambassadorBudgetApprovedLabel),
    ambassadorBudgetCapLabel: asText(data?.ambassadorBudgetCapLabel),
    ambassadorKolBudgetPct: toNumber(data?.ambassadorKolBudgetPct),
    ambassadorNextQuotaReviewDate: asText(data?.ambassadorNextQuotaReviewDate),
    leaderboardPeriods,
    leaderboardComputePointPeriods,
    leaderboardPoolLabel: asText(data?.leaderboardPoolLabel, asText(config.leaderboardPoolUsd)),
    leaderboardParticipantCount: toNumber(data?.leaderboardParticipantCount),
    leaderboardFraudHitCount: toNumber(data?.leaderboardFraudHitCount),
    leaderboardDisqualified: toBoolean(data?.leaderboardDisqualified),
    leaderboardPaused: toBoolean(data?.leaderboardPaused, toBoolean(data?.configValues?.["F.leaderboard.paused"])),
    leaderboardPeriodStatus: asText(data?.leaderboardPeriodStatus, asText(config.leaderboardPeriodStatus)),
    podium,
    voteWeights,
    config,
    commissionPolicy: data?.commissionPolicy ?? {},
    guardrails: data?.guardrails ?? [],
    configValues: data?.configValues ?? {},
    // 41a552fa rechecks approved payouts before writing. Missing values never become zero.
    coverage: finiteDashboardNumber(data?.coverage?.coverageRatio) !== null && finiteDashboardNumber(data?.coverage?.redlinePct) !== null
      ? { coverageRatio: Number(data!.coverage!.coverageRatio), redlinePct: Number(data!.coverage!.redlinePct), reliable: data!.coverage!.reliable === true,
        coverageRatioText: f4Decimal(data!.coverage!.coverageRatio!) ?? undefined, redlinePctText: f4Decimal(data!.coverage!.redlinePct!) ?? undefined }
      : undefined,
    sources: data?.sources ?? [],
  };
}

function normalizeF5Overview(data: BackendF5CommissionAuditOverview | null | undefined): F5CommissionAuditOverview {
  if (!data) throw new Error("F5_OVERVIEW_RESPONSE_INVALID:data");
  const summary = data.summary;
  const commissionKinds = data.commissionKinds.map((item) => ({
    key: item.key,
    code: item.code,
    lbl: item.label,
    amt: item.amountLabel,
    ct: item.countLabel,
    cls: item.className,
    amtColor: optionalText(item.amountColor),
  }));
  const commissionFilters = data.commissionFilters.map((item) => ({
    key: item.key,
    lbl: item.label,
  }));
  const commissionEvents = data.commissionEvents.map((item) => {
    const id = asText(item.commissionId ?? item.id, "CM-UNKNOWN");
    const userId = toNumber(item.userId);
    return {
      id,
      eventId: toNumber(item.eventId, toNumber(id.replace(/^CM-/, ""))),
      kind: asText(item.kind, "network"),
      user: asText(item.user, userId > 0 ? `U${String(userId).padStart(8, "0")}` : "usr_unknown"),
      userId,
      amt: f4Decimal(item.amount!)!,
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
      version: toNumber(item.version),
      frozenFromStatus: optionalText(item.frozenFromStatus),
      ledgerBizNo: optionalText(item.ledgerBizNo),
      unlockAt: item.unlockAt ?? undefined,
      settlementNo: optionalText(item.settlementNo), sourceRef: optionalText(item.sourceRef), sourceDeviceId: optionalText(item.sourceDeviceId),
      policyVersion: item.policyVersion == null ? undefined : toNumber(item.policyVersion),
      basisUsdt: item.basisUsdt == null ? undefined : f4Decimal(item.basisUsdt)!, nexUsdtPrice: item.nexUsdtPrice == null ? undefined : f4Decimal(item.nexUsdtPrice)!,
      amountUSDT: item.amountUSDT == null ? undefined : f4Decimal(item.amountUSDT)!, amountNEX: item.amountNEX == null ? undefined : f4Decimal(item.amountNEX)!,
      recoveryPendingUSDT: item.recoveryPendingUSDT == null ? undefined : f4Decimal(item.recoveryPendingUSDT)!, recoveryPendingNEX: item.recoveryPendingNEX == null ? undefined : f4Decimal(item.recoveryPendingNEX)!,
      reversalRecorded: item.reversalRecorded ?? undefined,
    };
  });
  const pagination = data.pagination;
  const coverageRatioText = data.coverage?.coverageRatio == null ? null : f4Decimal(data.coverage.coverageRatio);
  const redlinePctText = data.coverage?.redlinePct == null ? null : f4Decimal(data.coverage.redlinePct);
  let coverage: F5CommissionAuditOverview["coverage"];
  if (coverageRatioText !== null && redlinePctText !== null) {
    const [ratioWhole, ratioFraction = ""] = coverageRatioText.split(".");
    const [redlineWhole, redlineFraction = ""] = redlinePctText.split(".");
    const scale = Math.max(ratioFraction.length, redlineFraction.length);
    coverage = { coverageRatio: Number(coverageRatioText), redlinePct: Number(redlinePctText), reliable: data.coverage?.reliable,
      coverageRatioText, redlinePctText,
      redlineBreached: BigInt(ratioWhole + ratioFraction.padEnd(scale, "0")) < BigInt(redlineWhole + redlineFraction.padEnd(scale, "0")) };
  }
  return {
    pendingCalculations: data.pendingCalculations,
    pendingCalculationCount: toNumber(data.pendingCalculationCount),
    summary: {
      monthlyCommissionSpendLabel: summary.monthlyCommissionSpendLabel,
      coolingBalanceLabel: summary.coolingBalanceLabel,
      withdrawableThisMonthLabel: summary.withdrawableThisMonthLabel,
      frozenCount: toNumber(summary.frozenCount),
    },
    commissionKinds,
    commissionFilters,
    commissionEvents,
    statusDistribution: data.statusDistribution.map((item) => ({
      dot: item.color,
      nm: item.name,
      ct: String(toNumber(item.count)),
    })),
    recentAuditFeed: (data?.recentAuditFeed ?? []).map((item) => ({
      when: asText(item.when, "-"),
      text: asText(item.text, ""),
      level: asText(item.level, "LOW"),
    })),
    pagination: {
      mode: pagination.mode,
      defaultWindow: pagination.defaultWindow,
      defaultPageSize: toNumber(pagination.defaultPageSize),
      maxPageSize: toNumber(pagination.maxPageSize),
    },
    nextCursor: asText(data?.nextCursor, ""),
    total: toNumber(data?.total, commissionEvents.length),
    anomalies: (data?.anomalies ?? []).map((item) => ({
      id: asText(item.id, "AN-UNKNOWN"),
      type: asText(item.type, "unknown"),
      commissionId: asText(item.commissionId, ""),
      userId: item.userId == null ? "" : String(item.userId),
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
      userId: item.userId == null ? "" : String(item.userId),
      kinds: asText(item.kinds, ""),
      amount: item.amount == null ? null : f4Decimal(String(item.amount)),
      currency: asText(item.currency, ""),
      evidenceRef: asText(item.evidenceRef, ""),
      reason: asText(item.reason, ""),
      operator: asText(item.operator, ""),
      createdAt: asText(item.createdAt, ""),
    })),
    activeSuspensions: (data?.activeSuspensions ?? []).map((item) => ({
      userId: item.userId == null ? "" : String(item.userId),
      kind: asText(item.kind, ""),
      reason: asText(item.reason, ""),
      operator: asText(item.operator, ""),
      updatedAt: asText(item.updatedAt, ""),
    })),
    commissionPolicy: data?.commissionPolicy ?? {},
    guardrails: data?.guardrails ?? [],
    configValues: data?.configValues ?? {},
    // Ungrouped unlocks and reissues require a reliable execution-time snapshot.
    coverage,
    sources: data?.sources ?? [],
  };
}

async function f1Request<T>(
  path: string,
  init?: RequestInit & { stableIdempotencyKey?: string; expectsData?: boolean },
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
    // 走 formatAdminApiError:裸错误码会被确认弹窗原样上屏,违反「页面文案禁工程名词/错误码」。
    throw new Error(formatAdminApiError(undefined, "F1_WRITE_REQUIRES_STABLE_KEY"));
  }

  // 读路径走 guardedFetch(网络异常统一转运营中文);带稳定命令号的写路径走 rawFetch —— 它是
  // 错误文案咽喉的显式白名单锚点,留给「自管异常语义」的调用方:网络断对写路径不是单纯的失败,
  // 而是「结果未知」,必须保留命令号供原样重试,不能被包成普通网络错误。
  const doFetch = isWrite && stableKey ? rawFetch : guardedFetch;
  let response: Response;
  try {
    response = await doFetch(`/api/admin/teams${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch (error) {
    // 网络断时请求可能已到达后端:写路径归「结果未知」,保留命令号供原样重试(K 域同款分类)。
    if (isWrite && stableKey) {
      throw new F1OutcomeUncertainError(
        formatAdminApiError(undefined, "F1_REQUEST_OUTCOME_UNKNOWN"),
        stableKey,
      );
    }
    throw error; // 读路径:guardedFetch 已把网络异常转成运营中文
  }

  let result: ApiResult<T> | null = null;
  let bodyUnreadable = false;
  try {
    if (path.startsWith("/reward-payouts") && !isWrite) {
      const raw = await response.text();
      // Preserve DECIMAL(18,6) before JSON.parse can round a JSON number.
      result = JSON.parse(raw.replace(/("amount"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"')) as ApiResult<T>;
    } else if (/^\/ambassador-applications\/\d+\/materials(?:\/review)?$/.test(path)) {
      const raw = await response.text();
      result = JSON.parse(raw.replace(/("(?:budgetUsdt|recognizedBudgetUsdt)"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g,
        (_match, key: string, amount: string) => `${key}${JSON.stringify(f4Decimal(amount) ?? amount)}`)) as ApiResult<T>;
    } else if (/^\/leadership-pool\/(?:payout-preview|disqualification-readiness)(?:\?|$)/.test(path) && !isWrite) {
      const raw = await response.text();
      result = JSON.parse(raw.replace(/("(?:prizePoolUsdt|minComputePoints|computePoints|top1MaxPct|top5MaxPct|amountBeforeCaps|amount|payableAmount|reducedByCaps)"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"')) as ApiResult<T>;
    } else if (path === "/leadership-pool/vote-projection" && !isWrite) {
      const raw = await response.text();
      result = JSON.parse(raw.replace(/("(?:poolUsd|perVoteUsd|totalVotes)"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"')) as ApiResult<T>;
    } else if (path === "/leadership-pool" && !isWrite) {
      const raw = await response.text();
      result = JSON.parse(raw.replace(/("(?:currentWeekPoolUsd|poolUsd|coverageRatio|redlinePct)"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g,
        (_match, key: string, amount: string) => `${key}${JSON.stringify(f4Decimal(amount) ?? amount)}`)) as ApiResult<T>;
    } else if (path === "/binary" && !isWrite) {
      const raw = await response.text();
      result = JSON.parse(raw.replace(/("h1BinaryDailyCap"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"')) as ApiResult<T>;
    } else if (path.startsWith("/commissions") && !isWrite) {
      const raw = await response.text();
      // Keep each monetary JSON lexeme before binary floating point can round it.
      result = JSON.parse(raw.replace(/("(?:amount|basisUsdt|nexUsdtPrice|amountUSDT|amountNEX|recoveryPendingUSDT|recoveryPendingNEX|coverageRatio|redlinePct)"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"')) as ApiResult<T>;
    } else result = (await response.json()) as ApiResult<T>;
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
      throw new F1OutcomeUncertainError(formatAdminApiError(undefined, "F1_RESPONSE_UNREADABLE"), stableKey);
    }
    // 头 + message 两路都认(与 a2-client 同款):teams proxy 目前不透传该头,靠下面的 5xx 兜底,
    // 但后端若改用「200 + 业务码非 0 + UPSTREAM_OUTCOME_UNKNOWN」表达未知,这一路能接住。
    if (response.headers.get("X-Nexion-Upstream-Outcome")?.trim().toLowerCase() === "unknown"
      || (path === "/ambassador-policy" || path === "/commissions/anomaly-config" || /^\/ambassador-applications\/\d+\/materials\/review$/.test(path)) && isIdempotencyOutcomeOpen(result?.message)
      || result?.message?.trim().toUpperCase().includes("UPSTREAM_OUTCOME_UNKNOWN") === true) {
      throw new F1OutcomeUncertainError(
        formatAdminApiError(result?.message, "F1_REQUEST_OUTCOME_UNKNOWN"),
        stableKey,
      );
    }
    // 5xx(网关超时 502/504、上游不可达 503)= 请求可能已被后端执行但结果没回来。
    // 口径对齐 stable-mutation.ts;丢号的代价(重复打款)远重于多保一次号。
    // 归类走共享谓词(判据单源 outcome-classification,主人拍板统一口径)。
    if ((!response.ok || !result || result.code !== 0)
      && outcomeStaysUnknown(response.status, result?.code)) {
      throw new F1OutcomeUncertainError(
        formatAdminApiError(result?.message, `F1_REQUEST_FAILED_${response.status}`),
        stableKey,
      );
    }
    // 200 + 业务码 0 但 data 缺失:后端可能已执行,回包被截断。范式同 a2-client 的同名守卫。
    // 🔴 只对**要读返回值**的调用开(expectsData):F5 四个 void 写若后端本就返 data:null,
    // 无条件启用会每次抛未知且不弃号 → 重试原样重放、再抛,操作面永久卡死而钱其实已经打了。
    if (init?.expectsData && response.ok && result?.code === 0 && result.data == null) {
      throw new F1OutcomeUncertainError(
        formatAdminApiError(undefined, "F1_SUCCESS_RESPONSE_DATA_MISSING"), stableKey);
    }
  }

  if (!response.ok || !result || result.code !== 0) {
    // Retained success replays before the review supplier. These two exact supplier
    // conflicts therefore prove the original review did not commit; permission or
    // generic 4xx errors do not establish that fact and must retain the pending key.
    const reviewConflict = result?.message?.trim();
    if (response.status === 409 && result?.code === 409 && /^\/ambassador-applications\/\d+\/materials\/review$/.test(path)
      && (reviewConflict === "MATERIAL_REVISION_STALE" || reviewConflict === "APPLICATION_NOT_PENDING")) {
      throw new F4MaterialReviewNotAppliedError(formatAdminApiError(reviewConflict, "F1_REQUEST_FAILED_409"), reviewConflict);
    }
    const error = new Error(formatAdminApiError(result?.message, `F1_REQUEST_FAILED_${response.status}`));
    if (/^\/leadership-pool\/(?:payout-preview|disqualification-readiness)(?:\?|$)/.test(path) || path === "/leadership-pool/vote-projection" || path.startsWith("/ranks/") || path === "/ambassador-policy" || path === "/commissions/anomaly-config" || /^\/ambassador-applications\/\d+\/materials\/review$/.test(path)) throw Object.assign(error, {
      status: response.ok && typeof result?.code === "number" ? result.code : response.status, httpStatus: response.status, apiCode: result?.code,
      backendMessage: result?.message, reasonCode: result?.message,
    });
    throw error;
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
  const data = await f1Request<unknown>("/rates?schemaVersion=2");
  assertF2Overview(data);
  return normalizeF2Overview(data as BackendF2Overview);
}

export async function fetchF2DirectReferralPolicy() {
  return parseDirectReferralPolicy(await f1Request<unknown>("/direct-referral-policy?schemaVersion=2"));
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

export async function fetchF4VoteProjection() {
  return readF4VoteProjection(await f1Request<unknown>("/leadership-pool/vote-projection"));
}

/** Both new reads validate only their HTTP boundary; money stays in its original decimal text. */
function f4LeaderboardRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("F4_OVERVIEW_RESPONSE_INVALID");
  return value as Record<string, unknown>;
}
function f4LeaderboardDecimal(value: unknown): string {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) throw new Error("F4_OVERVIEW_RESPONSE_INVALID");
  return value;
}
function f4LeaderboardCount(value: unknown, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new Error("F4_OVERVIEW_RESPONSE_INVALID");
  return value;
}

export async function fetchF4LeaderboardPayoutPreview(period: F4PayoutPeriod, periodKey?: string): Promise<F4LeaderboardPayoutPreview | null> {
  const query = new URLSearchParams({ period });
  if (periodKey !== undefined) query.set("periodKey", periodKey);
  let data: unknown;
  try { data = await f1Request<unknown>(`/leadership-pool/payout-preview?${query}`); }
  catch (error) { if ((error as { status?: number }).status === 404) return null; throw error; }
  const row = f4LeaderboardRecord(data);
  if (row.period !== period || typeof row.periodKey !== "string" || !row.periodKey
    || typeof row.paused !== "boolean" || typeof row.alreadySettled !== "boolean"
    || typeof row.available !== "boolean" || typeof row.reason !== "string"
    || row.rankingMetric !== "COMPUTE_POINTS" || !Array.isArray(row.rows)) throw new Error("F4_OVERVIEW_RESPONSE_INVALID");
  const preview: F4LeaderboardPayoutPreview = {
    period, periodKey: row.periodKey, paused: row.paused, alreadySettled: row.alreadySettled,
    available: row.available, reason: row.reason, rankingMetric: "COMPUTE_POINTS",
    prizePoolUsdt: f4LeaderboardDecimal(row.prizePoolUsdt), minComputePoints: f4LeaderboardDecimal(row.minComputePoints),
    topN: f4LeaderboardCount(row.topN, 1), top1MaxPct: f4LeaderboardDecimal(row.top1MaxPct), top5MaxPct: f4LeaderboardDecimal(row.top5MaxPct),
    rows: row.rows.map(value => {
      const entry = f4LeaderboardRecord(value);
      if (typeof entry.userNo !== "string" || !entry.userNo || !Array.isArray(entry.limitedBy)
        || !entry.limitedBy.every(cap => cap === "top1MaxPct" || cap === "top5MaxPct")) throw new Error("F4_OVERVIEW_RESPONSE_INVALID");
      return { rank: f4LeaderboardCount(entry.rank, 1), userId: f4LeaderboardCount(entry.userId, 1), userNo: entry.userNo,
        computePoints: f4LeaderboardDecimal(entry.computePoints), amountBeforeCaps: f4LeaderboardDecimal(entry.amountBeforeCaps),
        amount: f4LeaderboardDecimal(entry.amount), limitedBy: entry.limitedBy as ("top1MaxPct" | "top5MaxPct")[] };
    }),
  };
  if (row.reason !== "F4_LEADERBOARD_POOL_NOT_CONFIGURED") {
    preview.candidateCount = f4LeaderboardCount(row.candidateCount);
    preview.rankedCount = f4LeaderboardCount(row.rankedCount);
    preview.paidCount = f4LeaderboardCount(row.paidCount);
    preview.amountBeforeCaps = f4LeaderboardDecimal(row.amountBeforeCaps);
    preview.payableAmount = f4LeaderboardDecimal(row.payableAmount);
    preview.reducedByCaps = f4LeaderboardDecimal(row.reducedByCaps);
  }
  return preview;
}

export async function fetchF4LeaderboardDisqualificationReadiness(limit = 50): Promise<F4LeaderboardDisqualificationReadiness | null> {
  let data: unknown;
  try { data = await f1Request<unknown>(`/leadership-pool/disqualification-readiness?${new URLSearchParams({ limit: String(limit) })}`); }
  catch (error) { if ((error as { status?: number }).status === 404) return null; throw error; }
  const row = f4LeaderboardRecord(data);
  if (row.period !== "week" || typeof row.periodKey !== "string" || !row.periodKey
    || row.rankingMetric !== "COMPUTE_POINTS" || !Array.isArray(row.rows)) throw new Error("F4_OVERVIEW_RESPONSE_INVALID");
  return { period: "week", periodKey: row.periodKey, rankingMetric: "COMPUTE_POINTS", minComputePoints: f4LeaderboardDecimal(row.minComputePoints),
    rows: row.rows.map(value => {
      const entry = f4LeaderboardRecord(value);
      if (typeof entry.userNo !== "string" || !entry.userNo || typeof entry.disqualificationAvailable !== "boolean"
        || typeof entry.riskEvidenceRef !== "string" || typeof entry.reason !== "string") throw new Error("F4_OVERVIEW_RESPONSE_INVALID");
      return { rank: f4LeaderboardCount(entry.rank, 1), memberUserId: f4LeaderboardCount(entry.memberUserId, 1), userNo: entry.userNo,
        computePoints: f4LeaderboardDecimal(entry.computePoints), disqualificationAvailable: entry.disqualificationAvailable,
        riskEvidenceRef: entry.riskEvidenceRef, reason: entry.reason };
    }) };
}

export async function fetchF5CommissionAuditOverview(query: F5CommissionQuery = {}) {
  const search = new URLSearchParams();
  search.set("schemaVersion", "2");
  for (const [key, value] of Object.entries(query)) {
    if (value?.trim()) search.set(key, value.trim());
  }
  const suffix = search.size ? `?${search.toString()}` : "";
  const data = await f1Request<unknown>(`/commissions${suffix}`);
  assertF5Overview(data);
  return normalizeF5Overview(data as unknown as BackendF5CommissionAuditOverview);
}

function normalizeF4AmbassadorPolicy(raw: unknown): F4AmbassadorPolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("大使政策权威快照不可用");
  const row = raw as Record<string, unknown>;
  const policyVersion = asText(row.policyVersion);
  const revision = toNumber(row.revision);
  const defaultBudgetUsdt = toNumber(row.defaultBudgetUsdt);
  const input = Array.isArray(row.buckets) ? row.buckets : [];
  const ids = ["venue", "kol", "print", "dev"] as const;
  const buckets = input.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("大使政策预算分类不可用");
    const bucket = item as Record<string, unknown>;
    const id = asText(bucket.id) as F4AmbassadorPolicyBucket["id"];
    return {
      id,
      title: asText(bucket.title),
      range: asText(bucket.range),
      rule: asText(bucket.rule),
      minBudgetUsdt: toNumber(bucket.minBudgetUsdt),
      maxBudgetUsdt: toNumber(bucket.maxBudgetUsdt),
    };
  });
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(policyVersion)
    || !Number.isSafeInteger(revision) || revision <= 0
    || !Number.isFinite(defaultBudgetUsdt) || defaultBudgetUsdt <= 0
    || buckets.length !== ids.length
    || ids.some((id) => buckets.filter((bucket) => bucket.id === id).length !== 1)
    || buckets.some((bucket) => !bucket.title || !bucket.range || !bucket.rule
      || bucket.minBudgetUsdt < 100 || bucket.maxBudgetUsdt < bucket.minBudgetUsdt || bucket.maxBudgetUsdt > 10_000)
    || !buckets.some((bucket) => defaultBudgetUsdt >= bucket.minBudgetUsdt && defaultBudgetUsdt <= bucket.maxBudgetUsdt)
    || row.serverCanonical !== true) {
    throw new Error("大使政策权威快照格式无效");
  }
  return { policyVersion, revision, defaultBudgetUsdt, buckets, serverCanonical: true };
}

export async function fetchF4AmbassadorPolicy() {
  return normalizeF4AmbassadorPolicy(await f1Request<unknown>("/ambassador-policy"));
}

export async function fetchF4AmbassadorMaterials(applicationId: number) {
  const packet = await f1Request<unknown>(`/ambassador-applications/${applicationId}/materials`);
  assertF4MaterialPacket(packet);
  return packet as unknown as F4AmbassadorMaterialPacket;
}

export async function reviewF4AmbassadorMaterials(applicationId: number, input: F4AmbassadorReviewInput, commandKey: string) {
  const packet = await f1Request<unknown>(`/ambassador-applications/${applicationId}/materials/review`, {
    method: "POST", stableIdempotencyKey: commandKey, expectsData: true, body: JSON.stringify(input),
  });
  try { assertF4MaterialPacket(packet); }
  catch { throw new F1OutcomeUncertainError(formatAdminApiError(undefined, "F1_RESPONSE_UNREADABLE"), commandKey); }
  return packet as unknown as F4AmbassadorMaterialPacket;
}

export async function updateF4AmbassadorPolicy(
  policy: F4AmbassadorPolicyUpdate,
  reason: string,
  operator: string,
  originalCommandKey?: string,
) {
  const fingerprint = JSON.stringify([policy, reason, operator]);
  const write = async (commandKey: string) =>
    normalizeF4AmbassadorPolicy(await f1Request<unknown>("/ambassador-policy", {
      method: "PUT",
      stableIdempotencyKey: commandKey,
      expectsData: true,
      body: JSON.stringify({ ...policy, reason, operator }),
    }));
  return originalCommandKey ? write(originalCommandKey) : f1StableWrite("f4-ambassador-policy", fingerprint, write);
}

export interface F5ExportReceipt {
  exportId: string;
  rowCount: number;
  byteSize: number;
  sha256: string;
  redacted: true;
  filename: string;
}

/**
 * Downloads the server-canonical full result set for the active filters. The browser verifies
 * size, checksum, BOM/header and row count before exposing the artifact to the operator.
 */
export async function downloadF5RedactedCsv(
  query: F5CommissionQuery,
  reason: string,
): Promise<F5ExportReceipt> {
  const filters = {
    kind: query.kind?.trim() || undefined,
    currency: query.currency?.trim() || undefined,
    // Keep BIGINT identifiers as decimal text; converting through JS Number can silently target
    // a different user above 2^53. Jackson validates/coerces the exact decimal into Long.
    userId: query.userId?.trim() || undefined,
    cohort: query.cohort?.trim() || undefined,
    status: query.status?.trim() || undefined,
  };
  // Export filters define the operation intent. The reason is audit metadata; including it in
  // the fingerprint would mint a new command after an unknown outcome when wording is edited.
  const fingerprint = JSON.stringify([filters]);
  return f1StableWrite("f5-export", fingerprint, async (commandKey) => {
    let response: Response;
    try {
      response = await guardedFetch("/api/admin/teams/commissions/export", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": commandKey },
        body: JSON.stringify({ ...filters, reason }),
        cache: "no-store",
      });
    } catch {
      throw new F1OutcomeUncertainError(
        formatAdminApiError(undefined, "F1_REQUEST_OUTCOME_UNKNOWN"), commandKey,
      );
    }

    if (isAdminAuthFailure(response.status)) resetAdminSession();
    if (!response.ok) {
      let message: string | undefined;
      try {
        message = ((await response.json()) as ApiResult<never>)?.message;
      } catch {
        // handled as a stable generic error below
      }
      if (outcomeStaysUnknown(response.status)) {
        throw new F1OutcomeUncertainError(
          formatAdminApiError(message, `F1_REQUEST_FAILED_${response.status}`), commandKey,
        );
      }
      throw new Error(formatAdminApiError(message, `F1_REQUEST_FAILED_${response.status}`));
    }

    const exportId = response.headers.get("X-Export-Id")?.trim() ?? "";
    const rowCount = Number(response.headers.get("X-Export-Row-Count"));
    const byteSize = Number(response.headers.get("X-Export-Byte-Size"));
    const expectedSha = response.headers.get("X-Export-Sha256")?.trim().toLowerCase() ?? "";
    const redacted = response.headers.get("X-Export-Redacted") === "true";
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const filenameMatch = disposition.match(/filename\*?=(?:UTF-8''|)(?:"([^"]+)"|([^;]+))/i);
    const filename = (filenameMatch?.[1] ?? filenameMatch?.[2] ?? "").trim();
    const content = await response.arrayBuffer();
    let actualSha: string;
    try {
      ({ sha256: actualSha } = await verifyF5CsvArtifact(content, {
        exportId, rowCount, byteSize, expectedSha, redacted, filename,
      }));
    } catch {
      throw new F1OutcomeUncertainError(
        formatAdminApiError(undefined, "F1_RESPONSE_UNREADABLE"), commandKey,
      );
    }

    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
    return { exportId, rowCount, byteSize, sha256: actualSha, redacted: true, filename };
  });
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
  // 且槽位会被拼进命令号前缀,勾选量大时撑爆 HTTP 头。
  // 🔴 body 必须送**同样排序过**的数组:后端幂等是 payload-bound(同键异载荷 → 409 内容已变化),
  // 指纹排序而 body 不排序时,列表刷新导致顺序变化就会同号异载荷,把重试硬拒掉。
  const sortedIds = [...commissionIds].sort();
  return f1StableWrite("f5-reissue", JSON.stringify([sortedIds, operator]),
    (commandKey) => f1Request<Record<string, unknown>>("/commissions/reissue", {
      method: "POST",
      body: JSON.stringify({ commissionIds: sortedIds, reason, operator }),
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
  // body 与指纹用同一个排序过的数组,理由同 reissue(payload-bound 幂等,同键异载荷会 409)。
  const sortedKinds = [...kinds].sort();
  return f1StableWrite(`f5-suspend|${userId}|${suspended}`, JSON.stringify([sortedKinds, operator]),
    (commandKey) => f1Request<Record<string, unknown>>(`/commissions/users/${userId}/suspend`, {
      method: "POST",
      body: JSON.stringify({ kinds: sortedKinds, suspended, reason, operator }),
      stableIdempotencyKey: commandKey,
    }));
}

export async function updateF5AnomalyConfig(
  commissionAnomalySigma: number,
  layerRatioAnomalyPct: number,
  reason: string,
  operator: string,
  commandKey: string,
) {
  return f1Request<{ operationNo: string; commissionAnomalySigma: number; layerRatioAnomalyPct: number }>("/commissions/anomaly-config", {
    method: "PUT",
    body: JSON.stringify({ commissionAnomalySigma, layerRatioAnomalyPct, reason, operator }),
    stableIdempotencyKey: commandKey,
    expectsData: true,
  });
}

export async function updateF1VRankThreshold(rank: string, field: string, value: string, reason: string, operator: string) {
  return normalizeOverview(await f1StableWrite(`f1-vrank|${rank}|${field}`, JSON.stringify([value, operator]),
    (commandKey) => f1Request<BackendOverview>(`/ranks/${encodeURIComponent(rank)}/thresholds/${encodeURIComponent(field)}`, {
      method: "PATCH",
      body: JSON.stringify({ value, reason, operator }),
      stableIdempotencyKey: commandKey,
      expectsData: true,
    })));
}

/** F1's confirmation owns the durable original body and key; do not mint another key here. */
export async function writeF1VRankPolicy(values: F1PolicyValues, reason: string, operator: string, commandKey: string) {
  const base = `/ranks/${encodeURIComponent(values.rank)}`;
  const threshold = values.action === "threshold";
  const path = threshold ? `${base}/thresholds/${encodeURIComponent(values.field!)}`
    : `${base}/rewards${values.action === "reward_add" ? "" : `/${encodeURIComponent(values.rewardId!)}`}`;
  const data = await f1Request<unknown>(path, {
    method: threshold ? "PATCH" : values.action === "reward_add" ? "POST" : values.action === "reward_remove" ? "DELETE" : "PUT",
    body: JSON.stringify({ ...(threshold ? { value: values.value } : values.reward), reason, operator }),
    stableIdempotencyKey: commandKey, expectsData: true,
  });
  try { assertF1Overview(data); }
  catch { throw new F1OutcomeUncertainError("操作结果不完整，请按原操作重试核对。", commandKey); }
  return normalizeOverview(data as BackendOverview);
}

export async function addF1VRankReward(rank: string, item: Omit<OpsVRankRewardItem, "id">, reason: string, operator: string) {
  return normalizeOverview(await f1StableWrite(`f1-reward-add|${rank}`, JSON.stringify([item, operator]),
    (commandKey) => f1Request<BackendOverview>(`/ranks/${encodeURIComponent(rank)}/rewards`, {
      method: "POST",
      body: JSON.stringify({ ...item, reason, operator }),
      stableIdempotencyKey: commandKey,
      expectsData: true,
    })));
}

export async function updateF1VRankReward(rank: string, rewardId: string, item: Omit<OpsVRankRewardItem, "id">, reason: string, operator: string) {
  return normalizeOverview(await f1StableWrite(`f1-reward-update|${rank}|${rewardId}`, JSON.stringify([item, operator]),
    (commandKey) => f1Request<BackendOverview>(`/ranks/${encodeURIComponent(rank)}/rewards/${encodeURIComponent(rewardId)}`, {
      method: "PUT",
      body: JSON.stringify({ ...item, reason, operator }),
      stableIdempotencyKey: commandKey,
      expectsData: true,
    })));
}

export async function removeF1VRankReward(rank: string, rewardId: string, reason: string, operator: string) {
  return normalizeOverview(await f1StableWrite(`f1-reward-remove|${rank}|${rewardId}`, JSON.stringify([operator]),
    (commandKey) => f1Request<BackendOverview>(`/ranks/${encodeURIComponent(rank)}/rewards/${encodeURIComponent(rewardId)}`, {
      method: "DELETE",
      body: JSON.stringify({ reason, operator }),
      stableIdempotencyKey: commandKey,
      expectsData: true,
    })));
}
