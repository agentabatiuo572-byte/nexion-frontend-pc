import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { formatAdminApiError } from "@/lib/admin/error-messages";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { parseIOverview } from "@/lib/admin/i-overview-contract";
import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";

type ApiResult<T> = {
  code?: number;
  message?: string;
  data?: T;
};

function idempotencyKey() {
  return `i-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// A transport failure has an unknown outcome: the backend may already have
// committed. Keep the key by exact command fingerprint so a manual retry
// replays the same command instead of creating a second write.
// 落 sessionStorage 而非内存:刷新页面后重试必须仍是同一命令号,否则后端无法去重。
// fingerprint = `${method}:${path}:${body}` —— path 带目标对象 id,method + path 区分动作类型。
const uncertainCommandKeys = createPendingMutationStore({
  storageKey: "nexion-admin-i-content-uncertain-commands-v1",
});

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const isWrite = !!init?.method && init.method !== "GET";
  const commandFingerprint = isWrite
    ? `${init?.method}:${path}:${typeof init?.body === "string" ? init.body : ""}`
    : "";
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (isWrite && !headers.has("Idempotency-Key")) {
    const stableKey = uncertainCommandKeys.get(commandFingerprint) ?? idempotencyKey();
    uncertainCommandKeys.remember(commandFingerprint, stableKey);
    headers.set("Idempotency-Key", stableKey);
  }
  let res: Response;
  try {
    res = await fetch(`/api/admin/content${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch (error) {
    // Preserve the fingerprint/key pair. The next identical operator retry is
    // a durable idempotent replay, never a fresh mutation.
    throw error;
  }
  const text = await res.text();
  const payload = text ? (JSON.parse(text) as ApiResult<T>) : {};
  if (!res.ok || (payload.code !== undefined && payload.code >= 400)) {
    // 本域早就是目标口径(只在确定性拒绝时弃号),2026-08-06 改接共享谓词统一来源:
    // 判据只此一处,别处再改口径时不会落下这一面。
    if (isWrite && !outcomeStaysUnknown(res.status, payload.code)) {
      uncertainCommandKeys.forget(commandFingerprint);
    }
    throw new Error(formatAdminApiError(payload.message, `CONTENT_API_${res.status}`));
  }
  if (isWrite) uncertainCommandKeys.forget(commandFingerprint);
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
  titleZh: string;
  bodyZh: string;
  titleVi: string;
  bodyVi: string;
  titleEn: string;
  bodyEn: string;
  status: string;
};

export type LearningCourseVersionView = {
  courseId: string;
  version: string;
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED";
  payload: Record<string, unknown>;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type NovaOptionView = { value: string; label: string };

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

export type NovaSocialEventStatus = "ACTIVE" | "DISABLED" | "EXPIRED";

export type NovaSocialEventView = {
  id: number;
  eventType: string;
  eventTypeLabel?: string;
  sourceSystem: string;
  sourceEventId: string;
  actorDisplay: string;
  cityDisplay: string;
  amountDisplay: string;
  sourceNote: string;
  status: NovaSocialEventStatus;
  eligible?: boolean;
  occurredAt: string;
  expiresAt: string;
  verifiedAt?: string;
  lastDispatchedAt?: string;
  dispatchCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type NovaSocialEventPage = {
  items: NovaSocialEventView[];
  page: number;
  pageSize: number;
  total: number;
};

export type NovaSocialEventSampleView = {
  id?: number;
  eventType?: string;
  sourceEventId?: string;
  language: "ZH" | "VI" | "EN";
  title?: string;
  body: string;
};

export type NovaSocialSyncResult = {
  discovered: number;
  inserted: number;
  duplicates: number;
  sources: Array<{
    sourceType: string;
    sourceTable: string;
    status: "AVAILABLE" | "UNAVAILABLE";
    discovered: number;
    inserted: number;
    duplicates: number;
    message: string;
  }>;
};

export type NovaOverview = {
  stats: NovaStats;
  channels: NovaChannelView[];
  eventDriven: NovaEventDrivenView[];
  templates: NovaTemplateView[];
  socialDistribution: NovaSocialDistributionItem[];
  socialEvents: NovaSocialEventView[];
  socialEventTypes: NovaOptionView[];
  socialEventStatuses: NovaOptionView[];
  templateStatuses: string[];
  templateCtaOptions: NovaOptionView[];
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
  status: "draft" | "scheduled" | "sending" | "sent" | "failed" | "cancelled";
  schedule: string;
  sent: string;
  read: string;
  bodyEn: string;
  bodyZh: string;
  bodyVi: string;
  ctaLabel: string;
  ctaHref: string;
  swipeTo: string;
  budget?: number;
  audienceTarget: NotificationAudienceTarget;
  revision: number;
};

export type NotificationAudienceTarget = {
  phaseMin: string;
  phaseMax: string;
  language: "all" | "zh" | "vi" | "en";
  registrationDaysMin: number;
};

export type NotificationAudienceOption = { value: string; label: string };
export type NotificationAudienceCatalog = {
  phases: NotificationAudienceOption[];
  languages: NotificationAudienceOption[];
  conditionLogic: "AND";
};

export type NotificationAudienceEstimateView = {
  target: NotificationAudienceTarget;
  estimatedUsers: number;
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
  audienceCatalog: NotificationAudienceCatalog;
  deliveryCatalog: {
    kinds: NotificationAudienceOption[];
    ctaRoutes: NotificationAudienceOption[];
  };
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
export type TrustSectionVersionView = {
  sectionKey: string;
  version: string;
  description: string;
  structure: string;
  fields: { key: string; label: string; value: string }[];
  status: string;
  revision: number;
  operator: string;
  updatedAt: string;
};
export type DisclosureJurisdictionView = {
  code: string;
  name: string;
  countryCodes: string[];
  version: string;
  status: string;
  publishedAt: string;
  affected: number;
  ackProgress: number;
  blocked: number;
  pendingAck?: number;
  acked?: number;
};
export type DisclosureChapterView = { jurisdiction: string; version: string; no: string; zh: string; vi: string; en: string; zhBody: string; viBody: string; enBody: string };
export type DisclosureVersionItemView = DisclosureDraftView & {
  chapters: DisclosureChapterView[];
  operator?: string;
  reason?: string;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
  affected?: number;
  acked?: number;
  pendingAck?: number;
  blocked?: number;
};
export type DisclosureJurisdictionOption = {
  code: string;
  name: string;
  status: string;
  revision: number;
  referencedVersionCount: number;
  hasActiveMapping: boolean;
  lastOperator: string;
  updatedAt: string;
};
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
  vi: string;
  en: string;
  status: string;
  revision?: number;
  contentHash?: string;
};
export type TrustDisclosureOverview = {
  stats: TrustDisclosureStats;
  trustSections: TrustSectionView[];
  trustSectionVersions: TrustSectionVersionView[];
  pendingTrustSectionKeys: string[];
  financialFields: FinancialFieldView[];
  sectionFields: TrustSectionFieldView[];
  jurisdictions: DisclosureJurisdictionView[];
  countryOptions: { code: string; name: string }[];
  chapters: DisclosureChapterView[];
  gatedActions: DisclosureGateActionView[];
  draft?: DisclosureDraftView;
  roleGates: string[];
  languageScopes: string[];
  disclosureVersions: string[];
  disclosureVersionItems?: DisclosureVersionItemView[];
  nextDisclosureVersion?: string;
  nextDisclosureVersionByJurisdiction?: Record<string, string>;
  nextVersionByJurisdiction?: Record<string, string>;
  jurisdictionCatalog?: DisclosureJurisdictionOption[];
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
  namespace: string;
  en: string;
  zh: string;
  vi: string;
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
  titleZh: string;
  titleEn: string;
  titleVi: string;
  bodyZh: string;
  bodyEn: string;
  bodyVi: string;
  quizQuestions: LearningQuizQuestionView[];
  passScore?: number;
  retryLimit?: number;
  completionCondition?: string;
  rewardEvent?: string;
  revision: number;
};
export type LearningQuizQuestionView = {
  questionId: string;
  questionZh: string;
  questionEn: string;
  optionsZh: string[];
  optionsEn: string[];
  correctOptionIndex: number;
};
export type TutorialRewardRange = { min: number; max: number };
export type LearningMetricView = { key: string; value: string };
export type I18nLearningOverview = {
  stats: I18nLearningStats;
  namespaces: I18nNamespaceView[];
  integrityIssues: I18nIntegrityIssueView[];
  hardcodedFindings: I18nHardcodedFindingView[];
  focusMessage?: I18nMessagePairView;
  messages: I18nMessagePairView[];
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
  errors?: Partial<Record<IContentErrorKey, string>>;
};

export type IContentErrorKey = "copyAb" | "nova" | "campaigns" | "trustDisclosure" | "i18nLearning";

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
  rollbackI1CopyVersion: (copyKey: string, version: string, expectedVersion: string, expectedRevision: number, reason: string) => Promise<void>;
  archiveI1Copy: (copyKey: string, expectedVersion: string, expectedRevision: number, reason: string) => Promise<void>;
  updateI1Framework: (paramKey: string, value: string, expectedValue: string, reason: string) => Promise<void>;
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
  updateI2Template: (channel: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  deleteI2Template: (channel: string, reason: string) => Promise<void>;
  updateI2TemplateStatus: (channel: string, status: string, reason: string) => Promise<void>;
  updateI2Distribution: (items: { key: string; pct: number }[], expectedItems: { key: string; pct: number }[], reason: string) => Promise<void>;
  syncI2SocialEvents: (reason: string) => Promise<NovaSocialSyncResult>;
  listI2SocialEvents: (eventType: string, status: string, page: number, pageSize: number) => Promise<NovaSocialEventPage>;
  previewI2SocialEvent: (language: "ZH" | "VI" | "EN") => Promise<NovaSocialEventSampleView | null>;
  updateI2SocialEventStatus: (id: number, status: NovaSocialEventStatus, reason: string) => Promise<void>;
  deleteI2SocialEvent: (id: number, reason: string) => Promise<void>;
  createI3Campaign: (body: Record<string, unknown>, reason: string) => Promise<void>;
  updateI3CampaignDraft: (campaignNo: string, body: Record<string, unknown>, expectedRevision: number, reason: string) => Promise<void>;
  estimateI3Audience: (target: NotificationAudienceTarget) => Promise<NotificationAudienceEstimateView>;
  scheduleI3Campaign: (campaignNo: string, scheduledAt: string, expectedRevision: number, reason: string) => Promise<void>;
  sendI3CampaignNow: (campaignNo: string, expectedRevision: number, reason: string) => Promise<void>;
  cancelI3Campaign: (campaignNo: string, expectedRevision: number, reason: string) => Promise<void>;
  deleteI3Campaign: (campaignNo: string, expectedRevision: number, reason: string) => Promise<void>;
  updateI3Cap: (tier: string, cap: string, expectedCap: string, reason: string) => Promise<void>;
  publishI4TrustSection: (sectionKey: string, body: { version: string; expectedRevision: number; expectedVersion: string; expectedStatus: string; dataSourceStatement: string; bilingualConfirmed: true }, reason: string) => Promise<void>;
  createI4TrustSectionDraft: (sectionKey: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  updateI4TrustSectionDraft: (sectionKey: string, version: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  deleteI4TrustSectionDraft: (sectionKey: string, version: string, expectedRevision: number, reason: string) => Promise<void>;
  rollbackI4TrustSection: (sectionKey: string, targetVersion: string, expectedVersion: string, expectedStatus: string, reason: string) => Promise<void>;
  archiveI4TrustSection: (sectionKey: string, expectedVersion: string, expectedStatus: string, reason: string) => Promise<void>;
  saveI5DisclosureDraft: (jurisdiction: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  publishI5Disclosure: (jurisdiction: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  configureI5Matrix: (jurisdiction: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  archiveI5Matrix: (jurisdiction: string, reason: string) => Promise<void>;
  updateI5GateScope: (scope: string, reason: string) => Promise<void>;
  fetchI5DisclosureVersion: (jurisdiction: string, version: string) => Promise<DisclosureVersionItemView>;
  createI5DisclosureVersion: (jurisdiction: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  updateI5DisclosureVersion: (jurisdiction: string, version: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  deleteI5DisclosureVersion: (jurisdiction: string, version: string, expectedRevision: number, expectedContentHash: string, reason: string) => Promise<void>;
  createI5Jurisdiction: (body: { code: string; name: string }, reason: string) => Promise<void>;
  updateI5Jurisdiction: (code: string, body: { name: string; expectedRevision: number }, reason: string) => Promise<void>;
  enableI5Jurisdiction: (code: string, expectedRevision: number, reason: string) => Promise<void>;
  disableI5Jurisdiction: (code: string, expectedRevision: number, reason: string) => Promise<void>;
  archiveI5Jurisdiction: (code: string, expectedRevision: number, reason: string) => Promise<void>;
  deleteI5Jurisdiction: (code: string, expectedRevision: number, reason: string) => Promise<void>;
  rescanI6: (reason: string) => Promise<void>;
  saveI6LocalizedDraft: (messageKey: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  publishI6LocalizedMessage: (messageKey: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  archiveI6LocalizedMessage: (messageKey: string, expectedVersion: string, reason: string) => Promise<void>;
  fetchI6MessageVersions: (messageKey: string) => Promise<I18nMessagePairView[]>;
  rollbackI6LocalizedMessage: (messageKey: string, targetVersion: string, expectedVersion: string, reason: string) => Promise<void>;
  fixI6Integrity: (issueCode: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  createI6Course: (courseId: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  updateI7CourseDraft: (courseId: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  fetchI7CourseVersions: (courseId: string) => Promise<LearningCourseVersionView[]>;
  createI7CourseVersion: (courseId: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  updateI7CourseVersion: (courseId: string, version: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  deleteI7CourseVersion: (courseId: string, version: string, reason: string) => Promise<void>;
  publishI7CourseVersion: (courseId: string, version: string, reason: string) => Promise<void>;
  rollbackI7CourseVersion: (courseId: string, version: string, reason: string) => Promise<void>;
  deleteI7CourseDraft: (courseId: string, reason: string) => Promise<void>;
  publishI6Course: (courseId: string, reason: string) => Promise<void>;
  archiveI6Course: (courseId: string, reason: string) => Promise<void>;
  updateI6CourseReward: (courseId: string, rewardNex: number, reason: string) => Promise<void>;
  updateI6FeaturedCourse: (courseId: string, reason: string) => Promise<void>;
};

export async function fetchIContentOverviews(): Promise<IContentData> {
  const [copyAb, nova, campaigns, trustDisclosure, i18nLearning] = await Promise.allSettled([
    apiRequest<unknown>("/copy-ab/overview").then((value) => parseIOverview("I1", value) as CopyAbOverview),
    apiRequest<unknown>("/nova/overview").then((value) => parseIOverview("I2", value) as NovaOverview),
    apiRequest<unknown>("/campaigns/overview").then((value) => parseIOverview("I3", value) as NotificationCampaignOverview),
    apiRequest<unknown>("/trust-disclosure/overview").then((value) => parseIOverview("I4", value) as TrustDisclosureOverview),
    apiRequest<unknown>("/i18n-learning/overview").then((value) => parseIOverview("I6", value) as I18nLearningOverview),
  ]);

  const safeError = (moduleId: string, result: PromiseSettledResult<unknown>) => {
    if (result.status === "fulfilled") return undefined;
    const message = result.reason instanceof Error ? result.reason.message : "";
    return message === `${moduleId} 返回数据格式异常，请刷新重试`
      ? message
      : `${moduleId} 数据加载失败，请刷新重试`;
  };

  return {
    copyAb: copyAb.status === "fulfilled" ? copyAb.value : undefined,
    nova: nova.status === "fulfilled" ? nova.value : undefined,
    campaigns: campaigns.status === "fulfilled" ? campaigns.value : undefined,
    trustDisclosure: trustDisclosure.status === "fulfilled" ? trustDisclosure.value : undefined,
    i18nLearning: i18nLearning.status === "fulfilled" ? i18nLearning.value : undefined,
    errors: {
      copyAb: safeError("I1", copyAb),
      nova: safeError("I2", nova),
      campaigns: safeError("I3", campaigns),
      trustDisclosure: safeError("I4", trustDisclosure),
      i18nLearning: safeError("I6", i18nLearning),
    },
  };
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
  rollbackI1CopyVersion: (copyKey, version, expectedVersion, expectedRevision, reason) => apiRequest(`/copy-ab/copies/${encodeURIComponent(copyKey)}/versions/${encodeURIComponent(version)}/rollback`, { method: "POST", body: JSON.stringify(withReason({ expectedVersion, expectedRevision }, reason)) }).then(() => undefined),
  archiveI1Copy: (copyKey, expectedVersion, expectedRevision, reason) => apiRequest(`/copy-ab/copies/${encodeURIComponent(copyKey)}/archive`, { method: "POST", body: JSON.stringify(withReason({ expectedVersion, expectedRevision }, reason)) }).then(() => undefined),
  updateI1Framework: (paramKey, value, expectedValue, reason) => apiRequest(`/copy-ab/framework/${encodeURIComponent(paramKey)}`, { method: "PATCH", body: JSON.stringify(withReason({ value, expectedValue }, reason)) }).then(() => undefined),
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
  updateI2Template: (channel, body, reason) => apiRequest(`/nova/templates/${encodeURIComponent(channel)}`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  deleteI2Template: (channel, reason) => apiRequest(`/nova/templates/${encodeURIComponent(channel)}`, { method: "DELETE", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  updateI2TemplateStatus: (channel, status, reason) => apiRequest(`/nova/templates/${encodeURIComponent(channel)}/status`, { method: "PATCH", body: JSON.stringify(withReason({ status }, reason)) }).then(() => undefined),
  updateI2Distribution: (items, expectedItems, reason) => apiRequest("/nova/social-distribution", { method: "PATCH", body: JSON.stringify(withReason({ items, expectedItems }, reason)) }).then(() => undefined),
  syncI2SocialEvents: (reason) => apiRequest<NovaSocialSyncResult>("/nova/social-events/sync", { method: "POST", body: JSON.stringify(withReason({}, reason)) }),
  listI2SocialEvents: (eventType, status, page, pageSize) => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (eventType) query.set("eventType", eventType);
    if (status) query.set("status", status);
    return apiRequest<NovaSocialEventPage>(`/nova/social-events?${query.toString()}`);
  },
  previewI2SocialEvent: (language) => apiRequest<NovaSocialEventSampleView | null>(`/nova/social-events/sample?language=${encodeURIComponent(language)}`),
  updateI2SocialEventStatus: (id, status, reason) => apiRequest(`/nova/social-events/${id}/status`, { method: "PATCH", body: JSON.stringify(withReason({ status }, reason)) }).then(() => undefined),
  deleteI2SocialEvent: (id, reason) => apiRequest(`/nova/social-events/${id}`, { method: "DELETE", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  createI3Campaign: (body, reason) => apiRequest("/campaigns", { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateI3CampaignDraft: (campaignNo, body, expectedRevision, reason) => apiRequest(`/campaigns/${encodeURIComponent(campaignNo)}/draft`, { method: "PATCH", body: JSON.stringify(withReason({ ...body, expectedRevision }, reason)) }).then(() => undefined),
  estimateI3Audience: (target) => apiRequest<NotificationAudienceEstimateView>("/campaigns/audience-estimate", { method: "POST", body: JSON.stringify({ target }) }),
  scheduleI3Campaign: (campaignNo, scheduledAt, expectedRevision, reason) => apiRequest(`/campaigns/${encodeURIComponent(campaignNo)}/schedule`, { method: "POST", body: JSON.stringify(withReason({ schedule: scheduledAt, expectedRevision }, reason)) }).then(() => undefined),
  sendI3CampaignNow: (campaignNo, expectedRevision, reason) => apiRequest(`/campaigns/${encodeURIComponent(campaignNo)}/send-now`, { method: "POST", body: JSON.stringify(withReason({ schedule: "now", expectedRevision }, reason)) }).then(() => undefined),
  cancelI3Campaign: (campaignNo, expectedRevision, reason) => apiRequest(`/campaigns/${encodeURIComponent(campaignNo)}/cancel`, { method: "POST", body: JSON.stringify(withReason({ expectedRevision }, reason)) }).then(() => undefined),
  deleteI3Campaign: (campaignNo, expectedRevision, reason) => apiRequest(`/campaigns/${encodeURIComponent(campaignNo)}`, { method: "DELETE", body: JSON.stringify(withReason({ expectedRevision }, reason)) }).then(() => undefined),
  updateI3Cap: (tier, cap, expectedCap, reason) => apiRequest(`/campaigns/caps/${encodeURIComponent(tier)}`, { method: "PATCH", body: JSON.stringify(withReason({ cap, expectedCap }, reason)) }).then(() => undefined),
  publishI4TrustSection: (sectionKey, body, reason) => apiRequest(`/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/publish`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  createI4TrustSectionDraft: (sectionKey, body, reason) => apiRequest(`/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/versions`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateI4TrustSectionDraft: (sectionKey, version, body, reason) => apiRequest(`/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/versions/${encodeURIComponent(version)}`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  deleteI4TrustSectionDraft: (sectionKey, version, expectedRevision, reason) => apiRequest(`/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/versions/${encodeURIComponent(version)}`, { method: "DELETE", body: JSON.stringify(withReason({ expectedRevision }, reason)) }).then(() => undefined),
  rollbackI4TrustSection: (sectionKey, targetVersion, expectedVersion, expectedStatus, reason) => apiRequest(`/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/rollback`, { method: "POST", body: JSON.stringify(withReason({ targetVersion, expectedVersion, expectedStatus }, reason)) }).then(() => undefined),
  archiveI4TrustSection: (sectionKey, expectedVersion, expectedStatus, reason) => apiRequest(`/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/archive`, { method: "POST", body: JSON.stringify(withReason({ expectedVersion, expectedStatus }, reason)) }).then(() => undefined),
  saveI5DisclosureDraft: (jurisdiction, body, reason) => apiRequest(`/trust-disclosure/disclosures/${encodeURIComponent(jurisdiction)}/draft`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  publishI5Disclosure: (jurisdiction, body, reason) => apiRequest(`/trust-disclosure/disclosures/${encodeURIComponent(jurisdiction)}/publish`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  configureI5Matrix: (jurisdiction, body, reason) => apiRequest(`/trust-disclosure/disclosures/matrix/${encodeURIComponent(jurisdiction)}`, { method: "PUT", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  archiveI5Matrix: (jurisdiction, reason) => apiRequest(`/trust-disclosure/disclosures/matrix/${encodeURIComponent(jurisdiction)}`, { method: "DELETE", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  updateI5GateScope: (scope, reason) => apiRequest("/trust-disclosure/disclosures/gated-actions", { method: "PATCH", body: JSON.stringify(withReason({ scope }, reason)) }).then(() => undefined),
  fetchI5DisclosureVersion: (jurisdiction, version) => apiRequest(`/trust-disclosure/disclosures/${encodeURIComponent(jurisdiction)}/versions/${encodeURIComponent(version)}`),
  createI5DisclosureVersion: (jurisdiction, body, reason) => apiRequest(`/trust-disclosure/disclosures/${encodeURIComponent(jurisdiction)}/versions`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateI5DisclosureVersion: (jurisdiction, version, body, reason) => apiRequest(`/trust-disclosure/disclosures/${encodeURIComponent(jurisdiction)}/versions/${encodeURIComponent(version)}`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  deleteI5DisclosureVersion: (jurisdiction, version, expectedRevision, expectedContentHash, reason) => apiRequest(`/trust-disclosure/disclosures/${encodeURIComponent(jurisdiction)}/versions/${encodeURIComponent(version)}`, { method: "DELETE", body: JSON.stringify(withReason({ expectedRevision, expectedContentHash }, reason)) }).then(() => undefined),
  createI5Jurisdiction: (body, reason) => apiRequest("/trust-disclosure/disclosures/jurisdictions", { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateI5Jurisdiction: (code, body, reason) => apiRequest(`/trust-disclosure/disclosures/jurisdictions/${encodeURIComponent(code)}`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  enableI5Jurisdiction: (code, expectedRevision, reason) => apiRequest(`/trust-disclosure/disclosures/jurisdictions/${encodeURIComponent(code)}/enable`, { method: "POST", body: JSON.stringify(withReason({ expectedRevision }, reason)) }).then(() => undefined),
  disableI5Jurisdiction: (code, expectedRevision, reason) => apiRequest(`/trust-disclosure/disclosures/jurisdictions/${encodeURIComponent(code)}/disable`, { method: "POST", body: JSON.stringify(withReason({ expectedRevision }, reason)) }).then(() => undefined),
  archiveI5Jurisdiction: (code, expectedRevision, reason) => apiRequest(`/trust-disclosure/disclosures/jurisdictions/${encodeURIComponent(code)}/archive`, { method: "POST", body: JSON.stringify(withReason({ expectedRevision }, reason)) }).then(() => undefined),
  deleteI5Jurisdiction: (code, expectedRevision, reason) => apiRequest(`/trust-disclosure/disclosures/jurisdictions/${encodeURIComponent(code)}`, { method: "DELETE", body: JSON.stringify(withReason({ expectedRevision }, reason)) }).then(() => undefined),
  rescanI6: (reason) => apiRequest("/i18n-learning/rescan", { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  saveI6LocalizedDraft: (messageKey, body, reason) => apiRequest(`/i18n-learning/messages/${encodeURIComponent(messageKey)}/draft`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  publishI6LocalizedMessage: (messageKey, body, reason) => apiRequest(`/i18n-learning/messages/${encodeURIComponent(messageKey)}/publish`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  archiveI6LocalizedMessage: (messageKey, expectedVersion, reason) => apiRequest(`/i18n-learning/messages/${encodeURIComponent(messageKey)}`, { method: "DELETE", body: JSON.stringify(withReason({ expectedVersion }, reason)) }).then(() => undefined),
  fetchI6MessageVersions: (messageKey) => apiRequest<I18nMessagePairView[]>(`/i18n-learning/messages/${encodeURIComponent(messageKey)}/versions`),
  rollbackI6LocalizedMessage: (messageKey, targetVersion, expectedVersion, reason) => apiRequest(`/i18n-learning/messages/${encodeURIComponent(messageKey)}/versions/${encodeURIComponent(targetVersion)}/rollback`, { method: "POST", body: JSON.stringify(withReason({ expectedVersion }, reason)) }).then(() => undefined),
  fixI6Integrity: (issueCode, body, reason) => apiRequest(`/i18n-learning/integrity/${encodeURIComponent(issueCode)}/fix`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  createI6Course: (courseId, body, reason) => apiRequest(`/i18n-learning/courses/${encodeURIComponent(courseId)}`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateI7CourseDraft: (courseId, body, reason) => apiRequest(`/i18n-learning/courses/${encodeURIComponent(courseId)}/draft`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  fetchI7CourseVersions: (courseId) => apiRequest<LearningCourseVersionView[]>(`/i18n-learning/courses/${encodeURIComponent(courseId)}/versions`),
  createI7CourseVersion: (courseId, body, reason) => apiRequest(`/i18n-learning/courses/${encodeURIComponent(courseId)}/versions`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateI7CourseVersion: (courseId, version, body, reason) => apiRequest(`/i18n-learning/courses/${encodeURIComponent(courseId)}/versions/${encodeURIComponent(version)}`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  deleteI7CourseVersion: (courseId, version, reason) => apiRequest(`/i18n-learning/courses/${encodeURIComponent(courseId)}/versions/${encodeURIComponent(version)}`, { method: "DELETE", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  publishI7CourseVersion: (courseId, version, reason) => apiRequest(`/i18n-learning/courses/${encodeURIComponent(courseId)}/versions/${encodeURIComponent(version)}/publish`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  rollbackI7CourseVersion: (courseId, version, reason) => apiRequest(`/i18n-learning/courses/${encodeURIComponent(courseId)}/versions/${encodeURIComponent(version)}/rollback`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  deleteI7CourseDraft: (courseId, reason) => apiRequest(`/i18n-learning/courses/${encodeURIComponent(courseId)}`, { method: "DELETE", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  publishI6Course: (courseId, reason) => apiRequest(`/i18n-learning/courses/${encodeURIComponent(courseId)}/publish`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  archiveI6Course: (courseId, reason) => apiRequest(`/i18n-learning/courses/${encodeURIComponent(courseId)}/archive`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  updateI6CourseReward: (courseId, rewardNex, reason) => apiRequest(`/i18n-learning/courses/${encodeURIComponent(courseId)}/reward`, { method: "PATCH", body: JSON.stringify(withReason({ rewardNex }, reason)) }).then(() => undefined),
  updateI6FeaturedCourse: (courseId, reason) => apiRequest("/i18n-learning/courses/featured", { method: "PATCH", body: JSON.stringify(withReason({ courseId }, reason)) }).then(() => undefined),
};
