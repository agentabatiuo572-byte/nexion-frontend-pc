import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError } from "@/lib/admin/error-messages";
import type { OpsVRankRewardItem, VRankRewardType } from "@/lib/admin/platform-types";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

interface BackendVRankRow {
  v?: string | null;
  selfBuy?: string | null;
  directRefs?: string | null;
  teamGv?: string | null;
  legCount?: string | null;
  legRank?: string | null;
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
  sources?: string[] | null;
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
  user?: string | null;
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
  kind?: string | null;
  user?: string | null;
  amount?: number | string | null;
  currency?: string | null;
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
  commissionPolicy?: Record<string, unknown> | null;
  guardrails?: string[] | null;
  configValues?: Record<string, string> | null;
  sources?: string[] | null;
}

export interface F1VRankRow {
  v: string;
  selfBuy?: string;
  directRefs?: string;
  teamGv?: string;
  legCount?: string;
  legRank?: string;
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
  sources: string[];
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
  user: string;
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
  kind: string;
  user: string;
  amt: number;
  cur: string;
  coolPct: number;
  coolLb: string;
  state: string;
  auditKey: string;
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
  commissionPolicy: Record<string, unknown>;
  guardrails: string[];
  configValues: Record<string, string>;
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
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function asText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toBoolean(value: boolean | string | null | undefined, fallback = false) {
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
      selfBuy: optionalText(row.selfBuy),
      directRefs: optionalText(row.directRefs),
      teamGv: optionalText(row.teamGv),
      legCount: optionalText(row.legCount),
      legRank: optionalText(row.legRank),
      pop: toNumber(row.pop),
      rewards: rowRewards,
    };
  });
  for (const [level, items] of Object.entries(backendRewards)) {
    if (!rewards[level]) rewards[level] = normalizeRewardList(items);
  }
  const voucherOptions = data?.voucherOptions ?? [];
  const skuOptions = data?.skuOptions ?? [];
  return {
    rows,
    rewards,
    voucherOptions,
    voucherLabels: normalizeLabels(voucherOptions, data?.voucherLabels),
    skuOptions,
    skuLabels: normalizeLabels(skuOptions, data?.skuLabels),
    leadership: normalizeLeadership(data?.leadership),
    configValues: data?.configValues ?? {},
    sources: data?.sources ?? [],
  };
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
    user: asText(item.user, "usr_unknown"),
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
      user: asText(formula.user, "usr_31E8"),
      trackA: toNumber(formula.trackA),
      trackB: toNumber(formula.trackB),
      matchAmount: toNumber(formula.matchAmount),
      matchRate: asText(formula.matchRate, "10%"),
      threshold: asText(formula.threshold, "$1,000 / 轨"),
      settlePeriod: asText(formula.settlePeriod, "每月"),
    },
    settlements,
    maxTrackGmv: toNumber(data?.maxTrackGmv, Math.max(1, ...settlements.flatMap((row) => [row.a, row.b]))),
    participantCount: toNumber(data?.participantCount),
    blockedCount: toNumber(data?.blockedCount),
    monthlyMatchedUsd: toNumber(data?.monthlyMatchedUsd),
    autoPlacement7dCount: toNumber(data?.autoPlacement7dCount),
    dailyMatchUsd: toNumber(data?.dailyMatchUsd),
    dailyCap: {
      currentLabel: asText(dailyCap.currentLabel, "$5,000"),
      windowLabel: asText(dailyCap.windowLabel, "月 1-6 现值 · 全局统一"),
      nextTrigger: asText(dailyCap.nextTrigger, "月 7"),
      nextLabel: asText(dailyCap.nextLabel, "$2,000"),
      currentMonth: toNumber(dailyCap.currentMonth, 6),
      currentPhase: asText(dailyCap.currentPhase, "收缩期"),
    },
    config: {
      threshold: asText(config.threshold, "$1,000 / 轨"),
      matchRate: asText(config.matchRate, "10%"),
      spillover: asText(config.spillover, "已启用"),
      spilloverEnabled: toBoolean(config.spilloverEnabled, asText(config.spillover, "已启用") !== "已关闭"),
      gvResetCron: asText(config.gvResetCron, "每月 1 日 00:00 UTC"),
      settlePeriod: asText(config.settlePeriod, "每月"),
      residualPolicy: asText(config.residualPolicy, "每月清零"),
      residualPool: asText(config.residualPool, "$1.2M"),
      residualSub: asText(config.residualSub, "月底归零 · 不结转"),
    },
    commissionPolicy: data?.commissionPolicy ?? {},
    guardrails: data?.guardrails ?? [],
    configValues: data?.configValues ?? {},
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
    poolRatio: asText(data?.poolRatio, asText(config.poolRatio, "5%")),
    poolRatioValue: toNumber(data?.poolRatioValue, 0.05),
    monthlyCapLabel: asText(data?.monthlyCapLabel, asText(config.monthlyCap, "$2,600,000")),
    monthlyCapUsd: toNumber(data?.monthlyCapUsd, 2600000),
    participantCount: toNumber(data?.participantCount),
    topN: toNumber(data?.topN, 10),
    topSharePct: toNumber(data?.topSharePct),
    unlockRank: toNumber(data?.unlockRank, 3),
    settlementWindow: asText(data?.settlementWindow, "周日 23:59 UTC"),
    settlementDispatchWindow: asText(data?.settlementDispatchWindow, "周一 00:00 UTC"),
    quotaRows,
    quotaMonthlyStockLabel: asText(data?.quotaMonthlyStockLabel, asText(config.monthlyStock, "96 台")),
    quotaMonthlyStockTotal: toNumber(data?.quotaMonthlyStockTotal, quotaRows.reduce((sum, row) => sum + row.cap, 0)),
    quotaMonthlyStockUsed: toNumber(data?.quotaMonthlyStockUsed, quotaRows.reduce((sum, row) => sum + row.current, 0)),
    quotaMonthlyStockRemaining: toNumber(
      data?.quotaMonthlyStockRemaining,
      quotaRows.reduce((sum, row) => sum + Math.max(0, row.cap - row.current), 0),
    ),
    proUnlock: asText(data?.proUnlock, asText(config.proUnlock, "直推 5 / 月业绩 $50k")),
    rackUnlock: asText(data?.rackUnlock, asText(config.rackUnlock, "直推 15")),
    ambassadorBands,
    ambassadorStatus: asText(data?.ambassadorStatus, asText(config.ambassadorStatus, "pending")),
    ambassadorPendingCount: toNumber(data?.ambassadorPendingCount),
    ambassadorBudgetApprovedLabel: asText(data?.ambassadorBudgetApprovedLabel, "$48,200"),
    ambassadorBudgetCapLabel: asText(data?.ambassadorBudgetCapLabel, "$80,000"),
    ambassadorKolBudgetPct: toNumber(data?.ambassadorKolBudgetPct, 50),
    ambassadorNextQuotaReviewDate: asText(data?.ambassadorNextQuotaReviewDate, "2026-09-01"),
    leaderboardPoolLabel: asText(data?.leaderboardPoolLabel, asText(config.leaderboardPoolUsd, "$48,000")),
    leaderboardParticipantCount: toNumber(data?.leaderboardParticipantCount),
    leaderboardFraudHitCount: toNumber(data?.leaderboardFraudHitCount),
    leaderboardDisqualified: toBoolean(data?.leaderboardDisqualified),
    leaderboardPeriodStatus: asText(data?.leaderboardPeriodStatus, asText(config.leaderboardPeriodStatus, "active")),
    podium,
    voteWeights,
    config,
    commissionPolicy: data?.commissionPolicy ?? {},
    guardrails: data?.guardrails ?? [],
    configValues: data?.configValues ?? {},
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
    const id = asText(item.id, "CM-UNKNOWN");
    return {
      id,
      kind: asText(item.kind, "network"),
      user: asText(item.user, "usr_unknown"),
      amt: toNumber(item.amount),
      cur: asText(item.currency, "USDT"),
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
    commissionPolicy: data?.commissionPolicy ?? {},
    guardrails: data?.guardrails ?? [],
    configValues: data?.configValues ?? {},
    sources: data?.sources ?? [],
  };
}

async function f1Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.idempotencyPrefix) {
    headers.set("Idempotency-Key", idempotencyKey(init.idempotencyPrefix));
  }

  const response = await fetch(`/api/admin/teams${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) {
      resetAdminSession();
    }
    throw new Error(formatAdminApiError(result?.message, `F1_REQUEST_FAILED_${response.status}`));
  }

  return result.data as T;
}

export async function fetchF1VRankOverview() {
  return normalizeOverview(await f1Request<BackendOverview>("/ranks"));
}

export async function fetchF2RatesOverview() {
  return normalizeF2Overview(await f1Request<BackendF2Overview>("/rates"));
}

export async function fetchF3BinaryOverview() {
  return normalizeF3Overview(await f1Request<BackendF3Overview>("/binary"));
}

export async function fetchF4LeadershipPoolOverview() {
  return normalizeF4Overview(await f1Request<BackendF4LeadershipPoolOverview>("/leadership-pool"));
}

export async function fetchF5CommissionAuditOverview() {
  return normalizeF5Overview(await f1Request<BackendF5CommissionAuditOverview>("/commissions"));
}

export async function updateFTeamConfig(key: string, value: string, reason: string, operator: string) {
  await f1Request<unknown>(`/commissions/config/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: `f-config-${key.replace(/[^A-Za-z0-9]+/g, "-")}`,
  });
  return fetchF2RatesOverview();
}

export async function updateF3TeamConfig(key: string, value: string, reason: string, operator: string) {
  await f1Request<unknown>(`/commissions/config/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: `f3-config-${key.replace(/[^A-Za-z0-9]+/g, "-")}`,
  });
  return fetchF3BinaryOverview();
}

export async function updateF4TeamConfig(key: string, value: string, reason: string, operator: string) {
  await f1Request<unknown>(`/commissions/config/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: `f4-config-${key.replace(/[^A-Za-z0-9]+/g, "-")}`,
  });
  return fetchF4LeadershipPoolOverview();
}

export async function updateF5TeamConfig(key: string, value: string, reason: string, operator: string) {
  await f1Request<unknown>(`/commissions/config/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: `f5-config-${key.replace(/[^A-Za-z0-9]+/g, "-")}`,
  });
  return fetchF5CommissionAuditOverview();
}

export async function updateF1VRankThreshold(rank: string, field: string, value: string, reason: string, operator: string) {
  return normalizeOverview(await f1Request<BackendOverview>(`/ranks/${encodeURIComponent(rank)}/thresholds/${encodeURIComponent(field)}`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: `f1-${rank}-${field}`,
  }));
}

export async function addF1VRankReward(rank: string, item: Omit<OpsVRankRewardItem, "id">, reason: string, operator: string) {
  return normalizeOverview(await f1Request<BackendOverview>(`/ranks/${encodeURIComponent(rank)}/rewards`, {
    method: "POST",
    body: JSON.stringify({ ...item, reason, operator }),
    idempotencyPrefix: `f1-${rank}-reward-add`,
  }));
}

export async function updateF1VRankReward(rank: string, rewardId: string, item: Omit<OpsVRankRewardItem, "id">, reason: string, operator: string) {
  return normalizeOverview(await f1Request<BackendOverview>(`/ranks/${encodeURIComponent(rank)}/rewards/${encodeURIComponent(rewardId)}`, {
    method: "PUT",
    body: JSON.stringify({ ...item, reason, operator }),
    idempotencyPrefix: `f1-${rank}-reward-update`,
  }));
}

export async function removeF1VRankReward(rank: string, rewardId: string, reason: string, operator: string) {
  return normalizeOverview(await f1Request<BackendOverview>(`/ranks/${encodeURIComponent(rank)}/rewards/${encodeURIComponent(rewardId)}`, {
    method: "DELETE",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: `f1-${rank}-reward-remove`,
  }));
}
