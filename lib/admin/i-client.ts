import { formatAdminApiError } from "@/lib/admin/error-messages";
import { currentAdminOperator } from "@/lib/admin/current-operator";

type ApiResult<T> = {
  code?: number;
  message?: string;
  data?: T;
};

function idempotencyKey() {
  return `i-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init?.method && init.method !== "GET" && !headers.has("Idempotency-Key")) headers.set("Idempotency-Key", idempotencyKey());
  const res = await fetch(`/api/admin/content${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const text = await res.text();
  const payload = text ? (JSON.parse(text) as ApiResult<T>) : {};
  if (!res.ok || (payload.code !== undefined && payload.code >= 400)) {
    throw new Error(formatAdminApiError(payload.message, `CONTENT_API_${res.status}`));
  }
  return payload.data as T;
}

function withReason<T extends Record<string, unknown>>(body: T, reason: string) {
  return { ...body, operator: currentAdminOperator(), reason };
}

export type CopyAbStats = {
  managedCopies: number;
  runningExps: number;
  weeklyExposures: string;
  topLift: string;
};

export type CopyModule = "home" | "store" | "earn" | "me";

export type CopyAudienceTarget = {
  mode: "structured";
  locales: string[];
  tiers: string[];
  registrationDaysMin?: number | null;
  registrationDaysMax?: number | null;
};

export type CopyPositionView = {
  positionKey: string;
  name: string;
  surface: CopyModule;
  sortOrder: number;
  status: string;
};

export type CopyVersionOptionView = {
  versionKey: string;
  name: string;
  description: string;
  status: string;
  sortOrder: number;
  revision: number;
  usageCount?: number;
};

export type CopyContentRow = {
  key: string;
  desc: string;
  surface: string;
  version: string;
  status: string;
  i18nKey: string;
  expId: string;
  lastChange: string;
  draftVersion?: string;
  draftZh?: string;
  draftEn?: string;
  draftVi?: string;
  copyPosition?: string;
  draftCopyPosition?: string;
  draftSurface?: string;
  draftAudience?: string;
  draftAudienceTarget?: CopyAudienceTarget;
  draftTrafficSplit?: string;
  draftNote?: string;
  revision?: number;
  usedVersionKeys?: string[];
};

export type CopyVersionRow = {
  copyKey: string;
  version: string;
  status: string;
  chain: string;
  ts: string;
  zh: string;
  en: string;
  vi: string;
  copyPosition?: string;
  surface: string;
  audience: string;
  audienceTarget?: CopyAudienceTarget;
  trafficSplit: string;
  versionNote: string;
  estimatedAudience?: number;
};

export type CopyExperimentRow = {
  id: string;
  copyKey: string;
  variants: { name: string; split: number; cvr: number }[];
  audience: string;
  estimatedAudience?: number;
  impressions: string;
  conversions: string;
  state: string;
  note: string;
};

export type CopyFrameworkParamView = {
  key: string;
  name: string;
  current: string;
  description: string;
};

export type CopyAbOverview = {
  stats: CopyAbStats;
  copies: CopyContentRow[];
  versions: CopyVersionRow[];
  experiments: CopyExperimentRow[];
  frameworkParams: CopyFrameworkParamView[];
  positions: CopyPositionView[];
  versionOptions: CopyVersionOptionView[];
  surfaces: string[];
  audiences: string[];
  trafficSplits: string[];
  sources: string[];
};

export type NovaStats = {
  todayDelivered: string;
  ctr: string;
  ctrTarget: number;
  onlineChannels: number;
  totalChannels: number;
  weeklySocial: string;
};

export type NovaChannelView = {
  key: string;
  name: string;
  trigger: string;
  tick: string;
  cooldown: string;
  phaseKeyed: string;
  ctr: number;
  enabled: boolean;
};

export type NovaTemplateView = {
  channel: string;
  name: string;
  cta: string;
  version: string;
  status: string;
};

export type NovaEventDrivenView = {
  name: string;
  reason: string;
  owner: string;
  tone: string;
  status: string;
};

export type NovaSocialDistributionItem = {
  key: string;
  name: string;
  pct: number;
  color: string;
};

export type NovaSocialPoolView = {
  key: string;
  name: string;
  description: string;
  count: number;
};

export type NovaOverview = {
  stats: NovaStats;
  channels: NovaChannelView[];
  eventDriven: NovaEventDrivenView[];
  templates: NovaTemplateView[];
  socialDistribution: NovaSocialDistributionItem[];
  socialPools: NovaSocialPoolView[];
  templateStatuses: string[];
  sources: string[];
};

export type NotificationCampaignStats = {
  monthCampaigns: number;
  monthSent: number;
  monthScheduled: number;
  monthDraft: number;
  criticalInflight: number;
  avgReadRate: string;
  weeklySwipe: string;
};

export type NotificationCampaignRow = {
  id: string;
  name: string;
  kind: string;
  tier: "critical" | "high" | "normal" | "low";
  audience: string;
  reach: string;
  status: "draft" | "scheduled" | "sending" | "sent" | "cancelled";
  schedule: string;
  sent: string;
  read: string;
  bodyEn: string;
  bodyZh: string;
  swipeTo: string;
  budget?: number;
};

export type NotificationCapRuleView = {
  tier: "critical" | "high" | "normal" | "low";
  cap: string;
  policy: string;
  locked: boolean;
};

export type NotificationSwipeRouteView = {
  to: string;
  kind: string;
  note: string;
};

export type NotificationCampaignOverview = {
  stats: NotificationCampaignStats;
  campaigns: NotificationCampaignRow[];
  capRules: NotificationCapRuleView[];
  tiers: string[];
  audiences: string[];
  statuses: string[];
  swipeRoutes: NotificationSwipeRouteView[];
  sources: string[];
};

export type TrustDisclosureStats = {
  managedSections: number;
  jurisdictions: number;
  staleAckUsers: number;
  weeklyGateBlocked: number;
  reackJurisdiction?: string;
  reackPct?: number;
};

export type TrustSectionView = {
  key: string;
  desc: string;
  struct: string;
  version: string;
  status: string;
  lastChange: string;
  roleGate: string;
  highSensitivity: boolean;
};

export type FinancialFieldView = { key: string; value: string; delta: string };
export type TrustSectionFieldView = { sectionKey: string; key: string; value: string };
export type DisclosureJurisdictionView = {
  code: string;
  name: string;
  version: string;
  status: string;
  publishedAt: string;
  affected: number;
  ackProgress: number;
  blocked: number;
};
export type DisclosureChapterView = { jurisdiction: string; version: string; no: string; zh: string; en: string; zhBody: string; enBody: string };
export type DisclosureGateActionView = {
  key: string;
  name: string;
  sub: string;
  status: string;
  tone: string;
  active: boolean;
};
export type DisclosureDraftView = {
  version: string;
  jurisdiction: string;
  languageScope: string;
  effectiveDate: string;
  requiresReack: boolean;
  zh: string;
  en: string;
  status: string;
};
export type TrustDisclosureOverview = {
  stats: TrustDisclosureStats;
  trustSections: TrustSectionView[];
  financialFields: FinancialFieldView[];
  sectionFields: TrustSectionFieldView[];
  jurisdictions: DisclosureJurisdictionView[];
  chapters: DisclosureChapterView[];
  gatedActions: DisclosureGateActionView[];
  draft?: DisclosureDraftView;
  roleGates: string[];
  languageScopes: string[];
  gateScope: string;
  sources: string[];
};

export type I18nLearningStats = {
  managedKeys: number;
  totalKeys: number;
  integrityIssues: number;
  coursesOnline: number;
  weeklyNexPayout: string;
};
export type I18nNamespaceView = { ns: string; keys: number; coverage: number; variants: string; lastChange: string };
export type I18nIntegrityIssueView = { code: string; kind: string; cnt: number; samples: string[]; status: string };
export type I18nHardcodedFindingView = { location: string; rawCopy: string; suggestedKey: string; status: string };
export type I18nMessagePairView = {
  messageKey: string;
  en: string;
  zh: string;
  status: string;
  version: string;
  placeholders: string[];
};
export type LearningCourseView = {
  id: string;
  title: string;
  category: string;
  format: "Article" | "Video" | "Hands-on";
  level: "Beginner" | "Intermediate" | "Advanced";
  rewardNex: number;
  featured: boolean;
  duration: string;
  version: string;
  status: string;
  body: string;
};
export type TutorialRewardRange = { min: number; max: number };
export type LearningMetricView = { key: string; value: string };
export type I18nLearningOverview = {
  stats: I18nLearningStats;
  namespaces: I18nNamespaceView[];
  integrityIssues: I18nIntegrityIssueView[];
  hardcodedFindings: I18nHardcodedFindingView[];
  focusMessage: I18nMessagePairView;
  courses: LearningCourseView[];
  rewardRange: TutorialRewardRange;
  featuredCourseId: string;
  metrics: LearningMetricView[];
  categories: string[];
  formats: string[];
  levels: string[];
  statuses: string[];
  sources: string[];
};

export type IContentData = {
  copyAb?: CopyAbOverview;
  nova?: NovaOverview;
  campaigns?: NotificationCampaignOverview;
  trustDisclosure?: TrustDisclosureOverview;
  i18nLearning?: I18nLearningOverview;
};

export type IContentActions = {
  reloadIContent: () => Promise<void>;
  createI1Copy: (body: Record<string, unknown>, reason: string) => Promise<void>;
  createI1CopyPosition: (body: Record<string, unknown>, reason: string) => Promise<void>;
  deleteI1CopyPosition: (positionKey: string, reason: string) => Promise<void>;
  createI1CopyVersionOption: (body: Record<string, unknown>, reason: string) => Promise<void>;
  updateI1CopyVersionOption: (versionKey: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  deleteI1CopyVersionOption: (versionKey: string, revision: number, reason: string) => Promise<void>;
  saveI1CopyDraft: (copyKey: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  publishI1CopyVersion: (copyKey: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  deleteI1CopyDraft: (copyKey: string, version: string, revision: number, reason: string) => Promise<void>;
  rollbackI1CopyVersion: (copyKey: string, version: string, reason: string) => Promise<void>;
  archiveI1Copy: (copyKey: string, expectedVersion: string, reason: string) => Promise<void>;
  updateI1Framework: (paramKey: string, value: string, reason: string) => Promise<void>;
  createI1Experiment: (body: Record<string, unknown>, reason: string) => Promise<void>;
  startI1Experiment: (experimentId: string, reason: string) => Promise<void>;
  discardI1Experiment: (experimentId: string, reason: string) => Promise<void>;
  stopI1Experiment: (experimentId: string, reason: string) => Promise<void>;
  adoptI1Experiment: (experimentId: string, reason: string) => Promise<void>;
  createI2NovaChannel: (body: Record<string, unknown>, reason: string) => Promise<void>;
  updateI2NovaChannel: (key: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  updateI2NovaChannelStatus: (key: string, enabled: boolean, reason: string) => Promise<void>;
  deleteI2NovaChannel: (key: string, reason: string) => Promise<void>;
  createI2Template: (body: Record<string, unknown>, reason: string) => Promise<void>;
  updateI2TemplateStatus: (channel: string, status: string, reason: string) => Promise<void>;
  updateI2Distribution: (items: { key: string; pct: number }[], reason: string) => Promise<void>;
  updateI2Pool: (poolKey: string, count: number, reason: string) => Promise<void>;
  createI3Campaign: (body: Record<string, unknown>, reason: string) => Promise<void>;
  updateI3CampaignDraft: (campaignNo: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  scheduleI3Campaign: (campaignNo: string, reason: string) => Promise<void>;
  sendI3CampaignNow: (campaignNo: string, reason: string) => Promise<void>;
  cancelI3Campaign: (campaignNo: string, reason: string) => Promise<void>;
  updateI3Cap: (tier: string, cap: string, reason: string) => Promise<void>;
  publishI4TrustSection: (sectionKey: string, version: string, reason: string) => Promise<void>;
  rollbackI4TrustSection: (sectionKey: string, targetVersion: string, reason: string) => Promise<void>;
  archiveI4TrustSection: (sectionKey: string, reason: string) => Promise<void>;
  saveI4DisclosureDraft: (jurisdiction: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  publishI4Disclosure: (jurisdiction: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  configureI4Matrix: (reason: string) => Promise<void>;
  updateI4GateScope: (scope: string, reason: string) => Promise<void>;
  rescanI6: (reason: string) => Promise<void>;
  saveI6LocalizedDraft: (messageKey: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  publishI6LocalizedMessage: (messageKey: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  startI6MarketingExperiment: (messageKey: string, reason: string) => Promise<void>;
  fixI6Integrity: (issueCode: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  createI6Course: (courseId: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  publishI6Course: (courseId: string, reason: string) => Promise<void>;
  archiveI6Course: (courseId: string, reason: string) => Promise<void>;
  updateI6CourseReward: (courseId: string, rewardNex: number, reason: string) => Promise<void>;
  updateI6FeaturedCourse: (courseId: string, reason: string) => Promise<void>;
};

export async function fetchIContentOverviews(): Promise<IContentData> {
  const [copyAb, nova, campaigns, trustDisclosure, i18nLearning] = await Promise.all([
    apiRequest<CopyAbOverview>("/copy-ab/overview"),
    apiRequest<NovaOverview>("/nova/overview"),
    apiRequest<NotificationCampaignOverview>("/campaigns/overview"),
    apiRequest<TrustDisclosureOverview>("/trust-disclosure/overview"),
    apiRequest<I18nLearningOverview>("/i18n-learning/overview"),
  ]);
  return { copyAb, nova, campaigns, trustDisclosure, i18nLearning };
}

export const iContentActions: Omit<IContentActions, "reloadIContent"> = {
  createI1Copy: (body, reason) => apiRequest("/copy-ab/copies", { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  createI1CopyPosition: (body, reason) => apiRequest("/copy-ab/positions", { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  deleteI1CopyPosition: (positionKey, reason) => apiRequest(`/copy-ab/positions/${encodeURIComponent(positionKey)}`, { method: "DELETE", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  createI1CopyVersionOption: (body, reason) => apiRequest("/copy-ab/version-options", { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateI1CopyVersionOption: (versionKey, body, reason) => apiRequest(`/copy-ab/version-options/${encodeURIComponent(versionKey)}`, { method: "PUT", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  deleteI1CopyVersionOption: (versionKey, revision, reason) => apiRequest(`/copy-ab/version-options/${encodeURIComponent(versionKey)}`, { method: "DELETE", body: JSON.stringify(withReason({ expectedRevision: revision }, reason)) }).then(() => undefined),
  saveI1CopyDraft: (copyKey, body, reason) => apiRequest(`/copy-ab/copies/${encodeURIComponent(copyKey)}/draft`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  publishI1CopyVersion: (copyKey, body, reason) => apiRequest(`/copy-ab/copies/${encodeURIComponent(copyKey)}/versions`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  deleteI1CopyDraft: (copyKey, version, revision, reason) => apiRequest(`/copy-ab/copies/${encodeURIComponent(copyKey)}/versions/${encodeURIComponent(version)}`, { method: "DELETE", body: JSON.stringify(withReason({ expectedVersion: version, expectedRevision: revision }, reason)) }).then(() => undefined),
  rollbackI1CopyVersion: (copyKey, version, reason) => apiRequest(`/copy-ab/copies/${encodeURIComponent(copyKey)}/versions/${encodeURIComponent(version)}/rollback`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  archiveI1Copy: (copyKey, expectedVersion, reason) => apiRequest(`/copy-ab/copies/${encodeURIComponent(copyKey)}/archive`, { method: "POST", body: JSON.stringify(withReason({ expectedVersion }, reason)) }).then(() => undefined),
  updateI1Framework: (paramKey, value, reason) => apiRequest(`/copy-ab/framework/${encodeURIComponent(paramKey)}`, { method: "PATCH", body: JSON.stringify(withReason({ value }, reason)) }).then(() => undefined),
  createI1Experiment: (body, reason) => apiRequest("/copy-ab/experiments", { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  startI1Experiment: (experimentId, reason) => apiRequest(`/copy-ab/experiments/${encodeURIComponent(experimentId)}/start`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  discardI1Experiment: (experimentId, reason) => apiRequest(`/copy-ab/experiments/${encodeURIComponent(experimentId)}/discard`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  stopI1Experiment: (experimentId, reason) => apiRequest(`/copy-ab/experiments/${encodeURIComponent(experimentId)}/stop`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  adoptI1Experiment: (experimentId, reason) => apiRequest(`/copy-ab/experiments/${encodeURIComponent(experimentId)}/adopt`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  createI2NovaChannel: (body, reason) => apiRequest("/nova/channels", { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateI2NovaChannel: (key, body, reason) => apiRequest(`/nova/channels/${encodeURIComponent(key)}`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateI2NovaChannelStatus: (key, enabled, reason) => apiRequest(`/nova/channels/${encodeURIComponent(key)}/status`, { method: "PATCH", body: JSON.stringify(withReason({ enabled }, reason)) }).then(() => undefined),
  deleteI2NovaChannel: (key, reason) => apiRequest(`/nova/channels/${encodeURIComponent(key)}`, { method: "DELETE", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  createI2Template: (body, reason) => apiRequest("/nova/templates", { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateI2TemplateStatus: (channel, status, reason) => apiRequest(`/nova/templates/${encodeURIComponent(channel)}/status`, { method: "PATCH", body: JSON.stringify(withReason({ status }, reason)) }).then(() => undefined),
  updateI2Distribution: (items, reason) => apiRequest("/nova/social-distribution", { method: "PATCH", body: JSON.stringify(withReason({ items }, reason)) }).then(() => undefined),
  updateI2Pool: (poolKey, count, reason) => apiRequest(`/nova/social-pools/${encodeURIComponent(poolKey)}`, { method: "PATCH", body: JSON.stringify(withReason({ count }, reason)) }).then(() => undefined),
  createI3Campaign: (body, reason) => apiRequest("/campaigns", { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateI3CampaignDraft: (campaignNo, body, reason) => apiRequest(`/campaigns/${encodeURIComponent(campaignNo)}/draft`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  scheduleI3Campaign: (campaignNo, reason) => apiRequest(`/campaigns/${encodeURIComponent(campaignNo)}/schedule`, { method: "POST", body: JSON.stringify(withReason({ schedule: "下一时段" }, reason)) }).then(() => undefined),
  sendI3CampaignNow: (campaignNo, reason) => apiRequest(`/campaigns/${encodeURIComponent(campaignNo)}/send-now`, { method: "POST", body: JSON.stringify(withReason({ schedule: "now" }, reason)) }).then(() => undefined),
  cancelI3Campaign: (campaignNo, reason) => apiRequest(`/campaigns/${encodeURIComponent(campaignNo)}/cancel`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  updateI3Cap: (tier, cap, reason) => apiRequest(`/campaigns/caps/${encodeURIComponent(tier)}`, { method: "PATCH", body: JSON.stringify(withReason({ cap }, reason)) }).then(() => undefined),
  publishI4TrustSection: (sectionKey, version, reason) => apiRequest(`/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/publish`, { method: "POST", body: JSON.stringify(withReason({ version }, reason)) }).then(() => undefined),
  rollbackI4TrustSection: (sectionKey, targetVersion, reason) => apiRequest(`/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/rollback`, { method: "POST", body: JSON.stringify(withReason({ targetVersion }, reason)) }).then(() => undefined),
  archiveI4TrustSection: (sectionKey, reason) => apiRequest(`/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/archive`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  saveI4DisclosureDraft: (jurisdiction, body, reason) => apiRequest(`/trust-disclosure/disclosures/${encodeURIComponent(jurisdiction)}/draft`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  publishI4Disclosure: (jurisdiction, body, reason) => apiRequest(`/trust-disclosure/disclosures/${encodeURIComponent(jurisdiction)}/publish`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  configureI4Matrix: (reason) => apiRequest("/trust-disclosure/disclosures/matrix/configure", { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  updateI4GateScope: (scope, reason) => apiRequest("/trust-disclosure/disclosures/gated-actions", { method: "PATCH", body: JSON.stringify(withReason({ scope }, reason)) }).then(() => undefined),
  rescanI6: (reason) => apiRequest("/i18n-learning/rescan", { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  saveI6LocalizedDraft: (messageKey, body, reason) => apiRequest(`/i18n-learning/messages/${encodeURIComponent(messageKey)}/draft`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  publishI6LocalizedMessage: (messageKey, body, reason) => apiRequest(`/i18n-learning/messages/${encodeURIComponent(messageKey)}/publish`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  startI6MarketingExperiment: (messageKey, reason) => apiRequest(`/i18n-learning/messages/${encodeURIComponent(messageKey)}/marketing-experiment`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  fixI6Integrity: (issueCode, body, reason) => apiRequest(`/i18n-learning/integrity/${encodeURIComponent(issueCode)}/fix`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  createI6Course: (courseId, body, reason) => apiRequest(`/i18n-learning/courses/${encodeURIComponent(courseId)}`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  publishI6Course: (courseId, reason) => apiRequest(`/i18n-learning/courses/${encodeURIComponent(courseId)}/publish`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  archiveI6Course: (courseId, reason) => apiRequest(`/i18n-learning/courses/${encodeURIComponent(courseId)}/archive`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  updateI6CourseReward: (courseId, rewardNex, reason) => apiRequest(`/i18n-learning/courses/${encodeURIComponent(courseId)}/reward`, { method: "PATCH", body: JSON.stringify(withReason({ rewardNex }, reason)) }).then(() => undefined),
  updateI6FeaturedCourse: (courseId, reason) => apiRequest("/i18n-learning/courses/featured", { method: "PATCH", body: JSON.stringify(withReason({ courseId }, reason)) }).then(() => undefined),
};
