import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { parseIOverview } from "@/lib/admin/i-overview-contract";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { trimStoredContent } from "@/lib/admin/content-language-rules";

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
const contentCommands = createPendingMutationStore<PendingMutationRecord & { confirmed?: { data: unknown } }>({
  storageKey: "nexion-admin-i-content-uncertain-commands-v1",
  retainExpiredRecords: true,
  // 未确认命令仍按幂等期限淘汰。已确认回执保留到读回完成或会话结束。
  isValidRecord: (attempt) => attempt.confirmed?.data !== undefined || attempt.expiresAt > Date.now(),
});

export class IContentReceiptError extends Error {}

const unknownWrite = (message = "写入结果未确认，请保留原内容和理由重试，系统会沿用原操作编号。") => new IContentReceiptError(message);

type ReadBack = (check: () => Promise<void>, version?: string) => Promise<void>;
type VerifyReceipt<T> = (data: T, readBack: ReadBack) => void | Promise<void>;

async function apiRequest<T>(path: string, init?: RequestInit, verifyReceipt?: VerifyReceipt<T>): Promise<T> {
  const headers = new Headers(init?.headers);
  const isWrite = !!init?.method && init.method !== "GET";
  const commandFingerprint = isWrite
    ? `${init?.method}:${path}:${typeof init?.body === "string" ? init.body : ""}`
    : "";
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const attempt = isWrite
    ? contentCommands.list().find((row) => row.fingerprint === commandFingerprint)
    : undefined;
  const commandKey = isWrite ? attempt?.commandKey ?? headers.get("Idempotency-Key") ?? idempotencyKey() : null;
  const verify = async (data: T) => {
    await verifyReceipt?.(data, async (check, version) => {
      if (commandKey && !attempt?.confirmed) contentCommands.remember(commandFingerprint, commandKey, { confirmed: { data } });
      try {
        await check();
      } catch {
        throw new IContentReceiptError(version
          ? `写入已确认，读回未确认。请重试核对或刷新查看目标版本 ${version}。`
          : "写入已确认，读回未确认。请重试核对或刷新查看目标版本。");
      }
    });
    if (commandKey) contentCommands.forget(commandFingerprint, commandKey);
    return data;
  };
  // 确认过的回执只用于读回，原命令超过 24 小时后也不会再次写入。
  if (attempt?.confirmed) return verify(attempt.confirmed.data as T);
  if (commandKey) {
    if (!attempt) contentCommands.remember(commandFingerprint, commandKey);
    headers.set("Idempotency-Key", commandKey);
  }

  let res: Response;
  let payload: ApiResult<T>;
  try {
    res = await guardedFetch(`/api/admin/content${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
    const text = await res.text();
    const parsed: unknown = text ? JSON.parse(text) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("CONTENT_API_INVALID_RESPONSE");
    payload = parsed as ApiResult<T>;
  } catch (error) {
    if (isWrite && verifyReceipt) throw unknownWrite();
    throw error;
  }
  if (isWrite && (payload.message === "IDEMPOTENCY_REQUEST_IN_PROGRESS" || payload.message === "IDEMPOTENCY_RESULT_UNKNOWN")) {
    throw unknownWrite();
  }
  if (!res.ok || (payload.code !== undefined && payload.code >= 400)
    || (verifyReceipt && typeof payload.code === "number" && payload.code !== 0)) {
    // 本域早就是目标口径(只在确定性拒绝时弃号),2026-08-06 改接共享谓词统一来源:
    // 判据只此一处,别处再改口径时不会落下这一面。
    if (isWrite && !outcomeStaysUnknown(res.status, payload.code)) {
      contentCommands.forget(commandFingerprint, commandKey ?? undefined);
    } else if (isWrite && verifyReceipt) {
      throw unknownWrite();
    }
    const message = payload.message === "DISCLOSURE_JURISDICTION_CODE_EXISTS"
      ? "该适用地区代码已存在，请更换代码；如需改名，请编辑已有地区。"
      : payload.message;
    throw new Error(formatAdminApiError(message, `CONTENT_API_${res.status}`, payload.data));
  }
  if (verifyReceipt && payload.code !== 0) throw unknownWrite();
  return verify(payload.data as T);
}

function withReason<T extends Record<string, unknown>>(body: T, reason: string) {
  return { ...body, operator: currentAdminOperator(), reason };
}

function writeContent<T, B extends Record<string, unknown>>(
  path: string, method: string, body: B, reason: string,
  verify: (data: T, submitted: B, readBack: ReadBack) => void | Promise<void>,
) {
  const submitted = withReason(body, reason);
  return apiRequest<T>(path, { method, body: JSON.stringify(submitted) },
    (data, readBack) => verify(data, submitted, readBack));
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
  draftAudienceTarget?: CopyAudienceTarget | null;
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
  audienceTarget?: CopyAudienceTarget | null;
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

type LocalizedTitleBody = Pick<NovaTemplateView, "titleEn" | "bodyEn" | "titleZh" | "bodyZh" | "titleVi" | "bodyVi">;
type NovaTemplateWrite = LocalizedTitleBody & Record<string, unknown>;
type NotificationCampaignWrite = LocalizedTitleBody & {
  ctaHref: string;
  ctaLabel?: string;
  translations?: NotificationCampaignTranslations;
} & Record<string, unknown>;

export type LearningCourseVersionView = {
  courseId: string;
  version: string;
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED";
  payload: Record<string, unknown> & Partial<CourseWrite>;
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
  runtimeSourceOptions: NovaOptionView[];
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

type NotificationCampaignTranslations = Partial<Record<string, { title: string; body: string; ctaLabel: string }>>;

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
  translations?: NotificationCampaignTranslations;
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
export type DisclosureChapterView = {
  jurisdiction: string; version: string; no: string;
  zh: string; vi: string; en: string; zhBody: string; viBody: string; enBody: string;
  titleTranslations?: Record<string, string>; bodyTranslations?: Record<string, string>;
};
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
  translations?: Record<string, string>;
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
export type I18nIntegrityIssueView = { code: string; kind: string; cnt: number; samples: string[]; status: string; repairedCount?: number };
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
  completionCondition?: string | null;
  rewardEvent?: string | null;
  revision: number;
};
export type LearningQuizQuestionView = {
  questionId: string;
  questionZh: string;
  questionEn: string;
  optionsZh: string[];
  optionsEn: string[];
  questionVi?: string;
  optionsVi?: string[];
  correctOptionIndex: number;
};
type LocalizedCopyWrite = { zh: string; en: string; vi: string };
type CopyWrite = LocalizedCopyWrite & {
  version: string | undefined;
  surface: string;
  copyPosition: string;
  trafficSplit: string;
  versionNote: string;
  audienceTarget: CopyAudienceTarget;
  expectedRevision?: number;
} & Record<string, unknown>;
type TrustDraftWrite = Pick<TrustSectionVersionView, "version" | "description" | "structure" | "fields"> & {
  expectedSectionVersion: string;
  expectedSectionStatus: string;
  expectedRevision?: number;
};
type DisclosureWrite = LocalizedCopyWrite & Pick<DisclosureDraftView, "jurisdiction" | "languageScope" | "effectiveDate" | "requiresReack" | "translations"> & {
  version?: string;
  expectedRevision?: number;
  expectedContentHash?: string;
  chapters: {
    no: string; zhTitle: string; enTitle: string; viTitle: string; zhBody: string; enBody: string; viBody: string;
    titleTranslations?: Record<string, string>; bodyTranslations?: Record<string, string>;
  }[];
};
type CourseWrite = Pick<LearningCourseView,
  "category" | "duration" | "titleZh" | "titleEn" | "titleVi" | "bodyZh" | "bodyEn" | "bodyVi"
  | "quizQuestions" | "passScore" | "retryLimit" | "rewardNex" | "completionCondition" | "rewardEvent"
> & { format: string; difficulty: string; version?: string; expectedRevision?: number; publishState: string };
export type TutorialRewardRange = { min: number; max: number };
export type LearningMetricView = { key: string; value: string };
export type I18nLearningOverview = {
  stats: I18nLearningStats;
  namespaces: I18nNamespaceView[];
  integrityIssues: I18nIntegrityIssueView[];
  hardcodedFindings: I18nHardcodedFindingView[];
  focusMessage?: I18nMessagePairView;
  messages: I18nMessagePairView[];
  publishedMessages: Record<string, I18nMessagePairView>;
  courses: LearningCourseView[];
  rewardRange: TutorialRewardRange;
  featuredCourseId: string;
  metrics?: LearningMetricView[];
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
  createI1Copy: (body: CopyWrite & { copyKey: string; description: string; i18nKey: string }, reason: string) => Promise<void>;
  createI1CopyPosition: (body: Record<string, unknown>, reason: string) => Promise<void>;
  deleteI1CopyPosition: (positionKey: string, reason: string) => Promise<void>;
  createI1CopyVersionOption: (body: Record<string, unknown>, reason: string) => Promise<void>;
  updateI1CopyVersionOption: (versionKey: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  deleteI1CopyVersionOption: (versionKey: string, revision: number, reason: string) => Promise<void>;
  saveI1CopyDraft: (copyKey: string, body: CopyWrite, reason: string) => Promise<void>;
  publishI1CopyVersion: (copyKey: string, body: CopyWrite, reason: string) => Promise<void>;
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
  createI2Template: (body: NovaTemplateWrite, reason: string) => Promise<void>;
  updateI2Template: (channel: string, body: NovaTemplateWrite, reason: string) => Promise<void>;
  deleteI2Template: (channel: string, reason: string) => Promise<void>;
  updateI2TemplateStatus: (channel: string, status: string, reason: string) => Promise<void>;
  updateI2Distribution: (items: { key: string; pct: number }[], expectedItems: { key: string; pct: number }[], reason: string) => Promise<void>;
  syncI2SocialEvents: (reason: string) => Promise<NovaSocialSyncResult>;
  listI2SocialEvents: (eventType: string, status: string, page: number, pageSize: number) => Promise<NovaSocialEventPage>;
  previewI2SocialEvent: (language: "ZH" | "VI" | "EN") => Promise<NovaSocialEventSampleView | null>;
  updateI2SocialEventStatus: (id: number, status: NovaSocialEventStatus, reason: string) => Promise<void>;
  deleteI2SocialEvent: (id: number, reason: string) => Promise<void>;
  createI3Campaign: (body: NotificationCampaignWrite, reason: string) => Promise<void>;
  updateI3CampaignDraft: (campaignNo: string, body: NotificationCampaignWrite, expectedRevision: number, reason: string) => Promise<void>;
  estimateI3Audience: (target: NotificationAudienceTarget) => Promise<NotificationAudienceEstimateView>;
  scheduleI3Campaign: (campaignNo: string, scheduledAt: string, expectedRevision: number, reason: string) => Promise<void>;
  sendI3CampaignNow: (campaignNo: string, expectedRevision: number, reason: string) => Promise<void>;
  cancelI3Campaign: (campaignNo: string, expectedRevision: number, reason: string) => Promise<void>;
  deleteI3Campaign: (campaignNo: string, expectedRevision: number, reason: string) => Promise<void>;
  updateI3Cap: (tier: string, cap: string, expectedCap: string, reason: string) => Promise<void>;
  publishI4TrustSection: (sectionKey: string, body: { version: string; expectedRevision: number; expectedVersion: string; expectedStatus: string; dataSourceStatement: string; bilingualConfirmed: true }, reason: string) => Promise<void>;
  createI4TrustSectionDraft: (sectionKey: string, body: TrustDraftWrite, reason: string) => Promise<void>;
  updateI4TrustSectionDraft: (sectionKey: string, version: string, body: TrustDraftWrite, reason: string) => Promise<void>;
  deleteI4TrustSectionDraft: (sectionKey: string, version: string, expectedRevision: number, reason: string) => Promise<void>;
  rollbackI4TrustSection: (sectionKey: string, targetVersion: string, expectedVersion: string, expectedStatus: string, reason: string) => Promise<void>;
  archiveI4TrustSection: (sectionKey: string, expectedVersion: string, expectedStatus: string, reason: string) => Promise<void>;
  saveI5DisclosureDraft: (jurisdiction: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  publishI5Disclosure: (jurisdiction: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  configureI5Matrix: (jurisdiction: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  archiveI5Matrix: (jurisdiction: string, reason: string) => Promise<void>;
  updateI5GateScope: (scope: string, reason: string) => Promise<void>;
  fetchI5DisclosureVersion: (jurisdiction: string, version: string) => Promise<DisclosureVersionItemView>;
  createI5DisclosureVersion: (jurisdiction: string, body: DisclosureWrite, reason: string) => Promise<DisclosureDraftView>;
  updateI5DisclosureVersion: (jurisdiction: string, version: string, body: DisclosureWrite, reason: string) => Promise<DisclosureDraftView>;
  deleteI5DisclosureVersion: (jurisdiction: string, version: string, expectedRevision: number, expectedContentHash: string, reason: string) => Promise<void>;
  createI5Jurisdiction: (body: { code: string; name: string }, reason: string) => Promise<void>;
  updateI5Jurisdiction: (code: string, body: { name: string; expectedRevision: number }, reason: string) => Promise<void>;
  enableI5Jurisdiction: (code: string, expectedRevision: number, reason: string) => Promise<void>;
  disableI5Jurisdiction: (code: string, expectedRevision: number, reason: string) => Promise<void>;
  archiveI5Jurisdiction: (code: string, expectedRevision: number, reason: string) => Promise<void>;
  deleteI5Jurisdiction: (code: string, expectedRevision: number, reason: string) => Promise<void>;
  rescanI6: (reason: string) => Promise<void>;
  saveI6LocalizedDraft: (messageKey: string, body: LocalizedCopyWrite & { expectedVersion: string }, reason: string) => Promise<void>;
  publishI6LocalizedMessage: (messageKey: string, body: LocalizedCopyWrite & { expectedVersion: string }, reason: string) => Promise<void>;
  archiveI6LocalizedMessage: (messageKey: string, expectedVersion: string, reason: string) => Promise<void>;
  fetchI6MessageVersions: (messageKey: string) => Promise<I18nMessagePairView[]>;
  rollbackI6LocalizedMessage: (messageKey: string, target: I18nMessagePairView, expectedVersion: string, reason: string) => Promise<void>;
  fixI6Integrity: (issueCode: string, body: LocalizedCopyWrite & { messageKey: string }, reason: string) => Promise<I18nIntegrityIssueView>;
  createI6Course: (courseId: string, body: CourseWrite, reason: string) => Promise<void>;
  updateI7CourseDraft: (courseId: string, body: CourseWrite, reason: string) => Promise<void>;
  fetchI7CourseVersions: (courseId: string) => Promise<LearningCourseVersionView[]>;
  createI7CourseVersion: (courseId: string, body: CourseWrite, reason: string) => Promise<void>;
  updateI7CourseVersion: (courseId: string, version: string, body: CourseWrite, reason: string) => Promise<void>;
  deleteI7CourseVersion: (courseId: string, version: string, reason: string) => Promise<void>;
  publishI7CourseVersion: (courseId: string, version: string, reason: string) => Promise<void>;
  rollbackI7CourseVersion: (courseId: string, version: string, reason: string) => Promise<void>;
  deleteI7CourseDraft: (courseId: string, reason: string) => Promise<void>;
  publishI6Course: (courseId: string, version: string, reason: string) => Promise<void>;
  archiveI6Course: (courseId: string, version: string, reason: string) => Promise<void>;
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

function requireNovaCopyReceipt(saved: NovaTemplateView, submitted: NovaTemplateWrite) {
  const fields = ["titleEn", "bodyEn", "titleZh", "bodyZh", "titleVi", "bodyVi"] as const;
  if (!saved || fields.some((field) => saved[field] !== submitted[field])) throw unknownWrite("NOVA_TEMPLATE_COPY_NOT_SAVED");
}

function requireCampaignCopyReceipt(saved: NotificationCampaignRow, submitted: NotificationCampaignWrite) {
  const label = submitted.ctaLabel ?? "";
  if (!saved || saved.bodyEn !== `${submitted.titleEn}\n${submitted.bodyEn}`
    || saved.bodyZh !== `${submitted.titleZh}\n${submitted.bodyZh}`
    || saved.bodyVi !== `${submitted.titleVi}\n${submitted.bodyVi}`
    || saved.ctaHref !== submitted.ctaHref || saved.ctaLabel !== label
    || (saved.translations?.en?.ctaLabel || saved.ctaLabel) !== label
    || (submitted.translations && Object.entries(submitted.translations).some(([language, copy]) => {
      const actual = saved.translations?.[language];
      return copy && (!actual || actual.title !== copy.title || actual.body !== copy.body || actual.ctaLabel !== copy.ctaLabel);
    }))) {
    throw unknownWrite("NOTIFICATION_CAMPAIGN_COPY_NOT_SAVED");
  }
}

function matchesLocalizedCopy(saved: LocalizedCopyWrite, submitted: LocalizedCopyWrite) {
  return saved.zh === trimStoredContent(submitted.zh)
    && saved.en === trimStoredContent(submitted.en)
    && saved.vi === trimStoredContent(submitted.vi);
}

function matchesCopyPlacement(saved: Pick<CopyVersionRow, "surface" | "copyPosition" | "trafficSplit" | "versionNote" | "audienceTarget">, submitted: CopyWrite) {
  const target = saved.audienceTarget;
  return saved.surface === submitted.surface.trim().toLowerCase() && saved.copyPosition === submitted.copyPosition.trim()
    && saved.trafficSplit === String(Number(submitted.trafficSplit.trim().replace("%", "")))
    && saved.versionNote === submitted.versionNote.trim() && target?.mode === "structured"
    && target.registrationDaysMin === submitted.audienceTarget.registrationDaysMin
    && (target.registrationDaysMax ?? null) === (submitted.audienceTarget.registrationDaysMax ?? null)
    && Array.isArray(target.locales) && Array.isArray(target.tiers)
    && target.locales.join(",") === submitted.audienceTarget.locales.join(",")
    && target.tiers.join(",") === submitted.audienceTarget.tiers.join(",");
}

function requireCopyDraft(saved: CopyContentRow, submitted: CopyWrite, key: string) {
  if (saved?.key !== key || saved.draftVersion !== submitted.version || saved.revision !== Number(submitted.expectedRevision) + 1
    || !matchesLocalizedCopy({ zh: saved.draftZh ?? "", en: saved.draftEn ?? "", vi: saved.draftVi ?? "" }, submitted)
    || !matchesCopyPlacement({
      surface: saved.draftSurface ?? "", copyPosition: saved.draftCopyPosition, trafficSplit: saved.draftTrafficSplit ?? "",
      versionNote: saved.draftNote ?? "", audienceTarget: saved.draftAudienceTarget,
    }, submitted)) throw unknownWrite();
}

async function requirePublishedCopy(saved: CopyContentRow, submitted: CopyWrite, key: string, readBack: ReadBack) {
  if (saved?.key !== key || !saved.version || saved.version !== submitted.version || saved.status !== "published"
    || (submitted.expectedRevision !== undefined
      && saved.revision !== submitted.expectedRevision + 1 && saved.revision !== submitted.expectedRevision + 2)
    || (typeof submitted.description === "string" && saved.desc !== submitted.description.trim())
    || (typeof submitted.i18nKey === "string" && saved.i18nKey !== submitted.i18nKey.trim())) throw unknownWrite();
  await readBack(async () => {
    const overview = await apiRequest<CopyAbOverview>("/copy-ab/overview");
    const version = overview.versions.find((row) => row.copyKey === key && row.version === saved.version);
    if (!version || !matchesLocalizedCopy(version, submitted) || !matchesCopyPlacement(version, submitted)) throw unknownWrite();
  });
}

function requireTrustDraft(saved: TrustSectionVersionView, submitted: TrustDraftWrite, sectionKey: string) {
  if (saved?.sectionKey !== sectionKey || saved.version !== submitted.version || saved.status !== "DRAFT"
    || !Number.isInteger(saved.revision)
    || (submitted.expectedRevision !== undefined && saved.revision !== submitted.expectedRevision + 1)
    || saved.description !== submitted.description || saved.structure !== submitted.structure
    || !Array.isArray(saved.fields)
    || !submitted.fields.every((field) => saved.fields.some((row) => row?.key === field.key && row.label === field.label && row.value === field.value))) {
    throw unknownWrite();
  }
}

function matchesSubmittedTranslations(saved: Record<string, string> | undefined, submitted: Record<string, string> | undefined) {
  if (!submitted) return true;
  const values = Object.entries(submitted).filter(([, value]) => value.trim());
  return values.length === Object.keys(saved ?? {}).length
    && values.every(([language, value]) => saved?.[language] === value.trim());
}

async function requireDisclosureDraft(
  saved: DisclosureDraftView, submitted: DisclosureWrite,
  readBack: ReadBack, expectedVersion?: string,
) {
  const languageScope = submitted.languageScope.startsWith("zh+vi+en") ? submitted.languageScope : "zh+vi+en";
  if (saved?.jurisdiction !== submitted.jurisdiction || typeof saved.version !== "string" || !saved.version
    || (expectedVersion !== undefined && saved.version !== expectedVersion)
    || saved.status !== "draft" || !Number.isInteger(saved.revision)
    || (submitted.expectedRevision !== undefined && saved.revision !== submitted.expectedRevision + 1)
    || typeof saved.contentHash !== "string" || !saved.contentHash
    || saved.languageScope !== languageScope || saved.effectiveDate !== submitted.effectiveDate
    || saved.requiresReack !== submitted.requiresReack || !matchesLocalizedCopy(saved, submitted)
    || !matchesSubmittedTranslations(saved.translations, submitted.translations)) throw unknownWrite();
  const matchesChapters = (chapters: DisclosureChapterView[]) => chapters.length === submitted.chapters.length
    && submitted.chapters.every((chapter) => chapters.some((row) =>
      row?.jurisdiction === saved.jurisdiction && row.version === saved.version && row.no === chapter.no.trim()
      && row.zh === chapter.zhTitle.trim() && row.en === chapter.enTitle.trim() && row.vi === chapter.viTitle.trim()
      && row.zhBody === chapter.zhBody.trim() && row.enBody === chapter.enBody.trim() && row.viBody === chapter.viBody.trim()
      && matchesSubmittedTranslations(row.titleTranslations, chapter.titleTranslations)
      && matchesSubmittedTranslations(row.bodyTranslations, chapter.bodyTranslations)));
  await readBack(async () => {
    const target = await iContentActions.fetchI5DisclosureVersion(saved.jurisdiction, saved.version);
    if (target?.jurisdiction !== saved.jurisdiction || target.version !== saved.version
      || target.revision !== saved.revision || target.contentHash !== saved.contentHash
      || target.languageScope !== saved.languageScope || target.effectiveDate !== saved.effectiveDate
      || target.requiresReack !== saved.requiresReack || !matchesLocalizedCopy(target, submitted)
      || !matchesSubmittedTranslations(target.translations, submitted.translations)
      || !Array.isArray(target.chapters) || !matchesChapters(target.chapters)) throw unknownWrite();
  }, saved.version);
}

function nextMessageVersion(version: string) {
  return `v${Number(version.slice(1)) + 1}`;
}

function requireMessageCopy(saved: I18nMessagePairView | undefined, messageKey: string, version: string, status: string, submitted: LocalizedCopyWrite) {
  if (saved?.messageKey !== messageKey || saved.version !== version || saved.status !== status || !matchesLocalizedCopy(saved, submitted)) {
    throw unknownWrite();
  }
}

function matchesCourseCopy(
  saved: Partial<CourseWrite> | undefined, submitted: CourseWrite,
  duration: string, difficulty: string | undefined,
) {
  const fields = ["titleZh", "titleEn", "titleVi", "bodyZh", "bodyEn", "bodyVi"] as const;
  const quiz = saved?.quizQuestions;
  return saved && fields.every((field) => saved[field] === submitted[field].trim())
    && saved.category === submitted.category && saved.format === submitted.format && difficulty === submitted.difficulty
    && saved.duration === duration && saved.rewardNex === Number(submitted.rewardNex.toFixed(6))
    && saved.passScore === submitted.passScore && saved.retryLimit === submitted.retryLimit
    && (saved.completionCondition ?? "") === (submitted.completionCondition?.trim() ?? "")
    && (saved.rewardEvent ?? "") === (submitted.rewardEvent?.trim() ?? "")
    && Array.isArray(quiz) && quiz.length === submitted.quizQuestions.length
    && submitted.quizQuestions.every((question, index) => {
      const row = quiz[index];
      return row && row.questionId === question.questionId.trim() && row.correctOptionIndex === question.correctOptionIndex
        && (["Zh", "En", "Vi"] as const).every((language) => {
          const options = row[`options${language}`];
          const expected = question[`options${language}`];
          return row[`question${language}`] === question[`question${language}`]?.trim()
            && Array.isArray(options) && expected?.length === options.length
            && expected.every((option, optionIndex) => options[optionIndex] === option.trim());
        });
    });
}

function requireCourseDraft(saved: LearningCourseView, courseId: string, submitted: CourseWrite) {
  const duration = `${Number(submitted.duration.replace(/[^0-9]/g, "") || "5")} min`;
  if (saved?.id !== courseId || saved.version !== submitted.version || saved.status !== "draft"
    || saved.revision !== (submitted.expectedRevision === undefined ? 0 : submitted.expectedRevision + 1)
    || !matchesCourseCopy(saved, submitted, duration, saved.level)) throw unknownWrite();
}

function requireCourseVersionDraft(saved: LearningCourseVersionView, courseId: string, version: string | undefined, submitted: CourseWrite) {
  const payload = saved?.payload;
  if (saved?.courseId !== courseId || saved.version !== version || saved.status !== "DRAFT"
    || saved.revision !== (submitted.expectedRevision === undefined ? 0 : submitted.expectedRevision + 1)
    || payload?.publishState !== "draft" || payload.version !== version
    || !matchesCourseCopy(payload, submitted, submitted.duration.trim(), payload.difficulty)) throw unknownWrite();
}

function deleteContentDraft(path: string, body: Record<string, unknown>, reason: string, isAbsent: () => Promise<boolean>, version?: string) {
  return writeContent(path, "DELETE", body, reason, (data: null, _submitted, readBack) => {
    if (data !== null) throw unknownWrite();
    return readBack(async () => {
      if (!await isAbsent()) throw new Error("CONTENT_DRAFT_DELETION_NOT_CONFIRMED");
    }, version);
  }).then(() => undefined);
}

export const iContentActions: Omit<IContentActions, "reloadIContent"> = {
  createI1Copy: (body, reason) => writeContent("/copy-ab/copies", "POST", body, reason,
    (saved: CopyContentRow, submitted, readBack) => requirePublishedCopy(saved, submitted, body.copyKey, readBack)).then(() => undefined),
  createI1CopyPosition: (body, reason) => apiRequest("/copy-ab/positions", { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  deleteI1CopyPosition: (positionKey, reason) => apiRequest(`/copy-ab/positions/${encodeURIComponent(positionKey)}`, { method: "DELETE", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  createI1CopyVersionOption: (body, reason) => apiRequest("/copy-ab/version-options", { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateI1CopyVersionOption: (versionKey, body, reason) => apiRequest(`/copy-ab/version-options/${encodeURIComponent(versionKey)}`, { method: "PUT", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  deleteI1CopyVersionOption: (versionKey, revision, reason) => apiRequest(`/copy-ab/version-options/${encodeURIComponent(versionKey)}`, { method: "DELETE", body: JSON.stringify(withReason({ expectedRevision: revision }, reason)) }).then(() => undefined),
  saveI1CopyDraft: (copyKey, body, reason) => writeContent(`/copy-ab/copies/${encodeURIComponent(copyKey)}/draft`, "PATCH", body, reason,
    (saved: CopyContentRow, submitted) => requireCopyDraft(saved, submitted, copyKey)).then(() => undefined),
  publishI1CopyVersion: (copyKey, body, reason) => writeContent(`/copy-ab/copies/${encodeURIComponent(copyKey)}/versions`, "POST", body, reason,
    (saved: CopyContentRow, submitted, readBack) => requirePublishedCopy(saved, submitted, copyKey, readBack)).then(() => undefined),
  deleteI1CopyDraft: (copyKey, version, revision, reason) => writeContent(
    `/copy-ab/copies/${encodeURIComponent(copyKey)}/versions/${encodeURIComponent(version)}`, "DELETE", { expectedVersion: version, expectedRevision: revision }, reason,
    async (saved: CopyContentRow, submitted, readBack) => {
      if (saved?.key !== copyKey || saved.draftVersion != null || saved.revision !== submitted.expectedRevision + 1) throw unknownWrite();
      await readBack(async () => {
        const overview = await apiRequest<CopyAbOverview>("/copy-ab/overview");
        if (overview.versions.some((row) => row.copyKey === copyKey && row.version === submitted.expectedVersion)) throw unknownWrite();
      });
    }).then(() => undefined),
  rollbackI1CopyVersion: (copyKey, version, expectedVersion, expectedRevision, reason) => writeContent(
    `/copy-ab/copies/${encodeURIComponent(copyKey)}/versions/${encodeURIComponent(version)}/rollback`, "POST", { expectedVersion, expectedRevision }, reason,
    async (saved: CopyContentRow, submitted, readBack) => {
      if (saved?.key !== copyKey || saved.version !== version || saved.status !== "published"
        || saved.revision !== submitted.expectedRevision + 1) throw unknownWrite();
      await readBack(async () => {
        const overview = await apiRequest<CopyAbOverview>("/copy-ab/overview");
        if (!overview.versions.some((row) => row.copyKey === copyKey && row.version === version && row.status === "published")) throw unknownWrite();
      });
    }).then(() => undefined),
  archiveI1Copy: (copyKey, expectedVersion, expectedRevision, reason) => writeContent(
    `/copy-ab/copies/${encodeURIComponent(copyKey)}/archive`, "POST", { expectedVersion, expectedRevision }, reason,
    (saved: CopyContentRow, submitted) => {
      if (saved?.key !== copyKey || saved.version !== submitted.expectedVersion || saved.status !== "archived"
        || saved.revision !== submitted.expectedRevision + 1) throw unknownWrite();
    }).then(() => undefined),
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
  createI2Template: (body, reason) => apiRequest<NovaTemplateView>("/nova/templates", { method: "POST", body: JSON.stringify(withReason(body, reason)) }, (saved) => requireNovaCopyReceipt(saved, body)).then(() => undefined),
  updateI2Template: (channel, body, reason) => apiRequest<NovaTemplateView>(`/nova/templates/${encodeURIComponent(channel)}`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }, (saved) => requireNovaCopyReceipt(saved, body)).then(() => undefined),
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
  createI3Campaign: (body, reason) => apiRequest<NotificationCampaignRow>("/campaigns", { method: "POST", body: JSON.stringify(withReason(body, reason)) }, (saved) => requireCampaignCopyReceipt(saved, body)).then(() => undefined),
  updateI3CampaignDraft: (campaignNo, body, expectedRevision, reason) => apiRequest<NotificationCampaignRow>(`/campaigns/${encodeURIComponent(campaignNo)}/draft`, { method: "PATCH", body: JSON.stringify(withReason({ ...body, expectedRevision }, reason)) }, (saved) => requireCampaignCopyReceipt(saved, body)).then(() => undefined),
  estimateI3Audience: (target) => apiRequest<NotificationAudienceEstimateView>("/campaigns/audience-estimate", { method: "POST", body: JSON.stringify({ target }) }),
  scheduleI3Campaign: (campaignNo, scheduledAt, expectedRevision, reason) => apiRequest(`/campaigns/${encodeURIComponent(campaignNo)}/schedule`, { method: "POST", body: JSON.stringify(withReason({ schedule: scheduledAt, expectedRevision }, reason)) }).then(() => undefined),
  sendI3CampaignNow: (campaignNo, expectedRevision, reason) => apiRequest(`/campaigns/${encodeURIComponent(campaignNo)}/send-now`, { method: "POST", body: JSON.stringify(withReason({ schedule: "now", expectedRevision }, reason)) }).then(() => undefined),
  cancelI3Campaign: (campaignNo, expectedRevision, reason) => apiRequest(`/campaigns/${encodeURIComponent(campaignNo)}/cancel`, { method: "POST", body: JSON.stringify(withReason({ expectedRevision }, reason)) }).then(() => undefined),
  deleteI3Campaign: (campaignNo, expectedRevision, reason) => apiRequest(`/campaigns/${encodeURIComponent(campaignNo)}`, { method: "DELETE", body: JSON.stringify(withReason({ expectedRevision }, reason)) }).then(() => undefined),
  updateI3Cap: (tier, cap, expectedCap, reason) => apiRequest(`/campaigns/caps/${encodeURIComponent(tier)}`, { method: "PATCH", body: JSON.stringify(withReason({ cap, expectedCap }, reason)) }).then(() => undefined),
  publishI4TrustSection: (sectionKey, body, reason) => apiRequest(`/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/publish`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  createI4TrustSectionDraft: (sectionKey, body, reason) => writeContent(`/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/versions`, "POST", body, reason,
    (saved: TrustSectionVersionView, submitted) => requireTrustDraft(saved, submitted, sectionKey)).then(() => undefined),
  updateI4TrustSectionDraft: (sectionKey, version, body, reason) => writeContent(`/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/versions/${encodeURIComponent(version)}`, "PATCH", body, reason,
    (saved: TrustSectionVersionView, submitted) => requireTrustDraft(saved, submitted, sectionKey)).then(() => undefined),
  deleteI4TrustSectionDraft: (sectionKey, version, expectedRevision, reason) => deleteContentDraft(
    `/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/versions/${encodeURIComponent(version)}`, { expectedRevision }, reason,
    async () => {
      const overview = await apiRequest<TrustDisclosureOverview>("/trust-disclosure/overview");
      return Array.isArray(overview?.trustSectionVersions) && overview.trustSectionVersions.every((row) =>
        typeof row?.sectionKey === "string" && typeof row.version === "string" && (row.sectionKey !== sectionKey || row.version !== version));
    }, version),
  rollbackI4TrustSection: (sectionKey, targetVersion, expectedVersion, expectedStatus, reason) => apiRequest(`/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/rollback`, { method: "POST", body: JSON.stringify(withReason({ targetVersion, expectedVersion, expectedStatus }, reason)) }).then(() => undefined),
  archiveI4TrustSection: (sectionKey, expectedVersion, expectedStatus, reason) => apiRequest(`/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/archive`, { method: "POST", body: JSON.stringify(withReason({ expectedVersion, expectedStatus }, reason)) }).then(() => undefined),
  saveI5DisclosureDraft: (jurisdiction, body, reason) => apiRequest(`/trust-disclosure/disclosures/${encodeURIComponent(jurisdiction)}/draft`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  publishI5Disclosure: (jurisdiction, body, reason) => apiRequest(`/trust-disclosure/disclosures/${encodeURIComponent(jurisdiction)}/publish`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  configureI5Matrix: (jurisdiction, body, reason) => apiRequest(`/trust-disclosure/disclosures/matrix/${encodeURIComponent(jurisdiction)}`, { method: "PUT", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  archiveI5Matrix: (jurisdiction, reason) => apiRequest(`/trust-disclosure/disclosures/matrix/${encodeURIComponent(jurisdiction)}`, { method: "DELETE", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  updateI5GateScope: (scope, reason) => apiRequest("/trust-disclosure/disclosures/gated-actions", { method: "PATCH", body: JSON.stringify(withReason({ scope }, reason)) }).then(() => undefined),
  fetchI5DisclosureVersion: (jurisdiction, version) => apiRequest(`/trust-disclosure/disclosures/${encodeURIComponent(jurisdiction)}/versions/${encodeURIComponent(version)}`),
  createI5DisclosureVersion: (jurisdiction, body, reason) => writeContent(`/trust-disclosure/disclosures/${encodeURIComponent(jurisdiction)}/versions`, "POST", body, reason, requireDisclosureDraft),
  updateI5DisclosureVersion: (jurisdiction, version, body, reason) => writeContent(`/trust-disclosure/disclosures/${encodeURIComponent(jurisdiction)}/versions/${encodeURIComponent(version)}`, "PATCH", body, reason,
    (saved: DisclosureDraftView, submitted, readBack) => requireDisclosureDraft(saved, submitted, readBack, version)),
  deleteI5DisclosureVersion: (jurisdiction, version, expectedRevision, expectedContentHash, reason) => deleteContentDraft(
    `/trust-disclosure/disclosures/${encodeURIComponent(jurisdiction)}/versions/${encodeURIComponent(version)}`, { expectedRevision, expectedContentHash }, reason,
    async () => {
      const overview = await apiRequest<TrustDisclosureOverview>("/trust-disclosure/overview");
      return Array.isArray(overview?.disclosureVersionItems) && overview.disclosureVersionItems.every((row) =>
        typeof row?.jurisdiction === "string" && typeof row.version === "string" && (row.jurisdiction !== jurisdiction || row.version !== version));
    }, version),
  createI5Jurisdiction: (body, reason) => apiRequest("/trust-disclosure/disclosures/jurisdictions", { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateI5Jurisdiction: (code, body, reason) => apiRequest(`/trust-disclosure/disclosures/jurisdictions/${encodeURIComponent(code)}`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  enableI5Jurisdiction: (code, expectedRevision, reason) => apiRequest(`/trust-disclosure/disclosures/jurisdictions/${encodeURIComponent(code)}/enable`, { method: "POST", body: JSON.stringify(withReason({ expectedRevision }, reason)) }).then(() => undefined),
  disableI5Jurisdiction: (code, expectedRevision, reason) => apiRequest(`/trust-disclosure/disclosures/jurisdictions/${encodeURIComponent(code)}/disable`, { method: "POST", body: JSON.stringify(withReason({ expectedRevision }, reason)) }).then(() => undefined),
  archiveI5Jurisdiction: (code, expectedRevision, reason) => apiRequest(`/trust-disclosure/disclosures/jurisdictions/${encodeURIComponent(code)}/archive`, { method: "POST", body: JSON.stringify(withReason({ expectedRevision }, reason)) }).then(() => undefined),
  deleteI5Jurisdiction: (code, expectedRevision, reason) => apiRequest(`/trust-disclosure/disclosures/jurisdictions/${encodeURIComponent(code)}`, { method: "DELETE", body: JSON.stringify(withReason({ expectedRevision }, reason)) }).then(() => undefined),
  rescanI6: (reason) => apiRequest("/i18n-learning/rescan", { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  saveI6LocalizedDraft: (messageKey, body, reason) => writeContent(`/i18n-learning/messages/${encodeURIComponent(messageKey)}/draft`, "PATCH", body, reason,
    (saved: I18nMessagePairView, submitted) => requireMessageCopy(saved, messageKey, nextMessageVersion(submitted.expectedVersion), "draft", submitted)).then(() => undefined),
  publishI6LocalizedMessage: (messageKey, body, reason) => writeContent(`/i18n-learning/messages/${encodeURIComponent(messageKey)}/publish`, "POST", body, reason,
    (saved: I18nMessagePairView, submitted) => requireMessageCopy(saved, messageKey, submitted.expectedVersion, "published", submitted)).then(() => undefined),
  archiveI6LocalizedMessage: (messageKey, expectedVersion, reason) => writeContent(
    `/i18n-learning/messages/${encodeURIComponent(messageKey)}`, "DELETE", { expectedVersion }, reason,
    (saved: I18nMessagePairView, submitted) => {
      if (saved?.messageKey !== messageKey || saved.version !== submitted.expectedVersion || saved.status !== "archived") throw unknownWrite();
    }).then(() => undefined),
  fetchI6MessageVersions: (messageKey) => apiRequest<I18nMessagePairView[]>(`/i18n-learning/messages/${encodeURIComponent(messageKey)}/versions`),
  rollbackI6LocalizedMessage: (messageKey, target, expectedVersion, reason) => writeContent(
    `/i18n-learning/messages/${encodeURIComponent(messageKey)}/versions/${encodeURIComponent(target.version)}/rollback`, "POST", { expectedVersion }, reason,
    (saved: I18nMessagePairView, submitted) => requireMessageCopy(saved, messageKey, nextMessageVersion(submitted.expectedVersion), "published", target)).then(() => undefined),
  fixI6Integrity: (issueCode, body, reason) => writeContent(`/i18n-learning/integrity/${encodeURIComponent(issueCode)}/fix`, "POST", body, reason,
    (saved: I18nIntegrityIssueView) => {
      if (saved?.code !== issueCode || !Array.isArray(saved.samples) || !Number.isInteger(saved.repairedCount)) throw unknownWrite();
    }),
  createI6Course: (courseId, body, reason) => writeContent(`/i18n-learning/courses/${encodeURIComponent(courseId)}`, "POST", body, reason,
    (saved: LearningCourseView, submitted) => requireCourseDraft(saved, courseId, submitted)).then(() => undefined),
  updateI7CourseDraft: (courseId, body, reason) => writeContent(`/i18n-learning/courses/${encodeURIComponent(courseId)}/draft`, "PATCH", body, reason,
    (saved: LearningCourseView, submitted) => requireCourseDraft(saved, courseId, submitted)).then(() => undefined),
  fetchI7CourseVersions: (courseId) => apiRequest<LearningCourseVersionView[]>(`/i18n-learning/courses/${encodeURIComponent(courseId)}/versions`),
  createI7CourseVersion: (courseId, body, reason) => writeContent(`/i18n-learning/courses/${encodeURIComponent(courseId)}/versions`, "POST", body, reason,
    (saved: LearningCourseVersionView, submitted) => requireCourseVersionDraft(saved, courseId, submitted.version, submitted)).then(() => undefined),
  updateI7CourseVersion: async (courseId, version, body, reason) => {
    if (body.version !== version) throw new Error("课程版本号必须与所编辑的版本一致。");
    await writeContent(`/i18n-learning/courses/${encodeURIComponent(courseId)}/versions/${encodeURIComponent(version)}`, "PATCH", body, reason,
      (saved: LearningCourseVersionView, submitted) => requireCourseVersionDraft(saved, courseId, version, submitted));
  },
  deleteI7CourseVersion: (courseId, version, reason) => deleteContentDraft(
    `/i18n-learning/courses/${encodeURIComponent(courseId)}/versions/${encodeURIComponent(version)}`, {}, reason,
    async () => {
      const versions = await iContentActions.fetchI7CourseVersions(courseId);
      return Array.isArray(versions) && versions.every((row) => row?.courseId === courseId && typeof row.version === "string" && row.version !== version);
    }, version),
  publishI7CourseVersion: (courseId, version, reason) => changeCourseStatus(courseId, `/versions/${encodeURIComponent(version)}/publish`, version, "published", reason),
  rollbackI7CourseVersion: (courseId, version, reason) => changeCourseStatus(courseId, `/versions/${encodeURIComponent(version)}/rollback`, version, "published", reason),
  deleteI7CourseDraft: (courseId, reason) => deleteContentDraft(`/i18n-learning/courses/${encodeURIComponent(courseId)}`, {}, reason,
    async () => {
      const overview = await apiRequest<I18nLearningOverview>("/i18n-learning/overview");
      return Array.isArray(overview?.courses) && overview.courses.every((row) => typeof row?.id === "string" && row.id !== courseId);
    }),
  publishI6Course: (courseId, version, reason) => changeCourseStatus(courseId, "/publish", version, "published", reason),
  archiveI6Course: (courseId, version, reason) => changeCourseStatus(courseId, "/archive", version, "archived", reason),
  updateI6CourseReward: (courseId, rewardNex, reason) => apiRequest(`/i18n-learning/courses/${encodeURIComponent(courseId)}/reward`, { method: "PATCH", body: JSON.stringify(withReason({ rewardNex }, reason)) }).then(() => undefined),
  updateI6FeaturedCourse: (courseId, reason) => writeContent("/i18n-learning/courses/featured", "PATCH", { courseId }, reason,
    (saved: LearningCourseView, submitted) => {
      if (saved?.id !== submitted.courseId || saved.featured !== true) throw unknownWrite();
    }).then(() => undefined),
};

function changeCourseStatus(courseId: string, suffix: string, version: string, status: string, reason: string) {
  return writeContent(`/i18n-learning/courses/${encodeURIComponent(courseId)}${suffix}`, "POST", {}, reason,
    (saved: LearningCourseView) => {
      if (saved?.id !== courseId || saved.version !== version || saved.status !== status) throw unknownWrite();
    }).then(() => undefined);
}
