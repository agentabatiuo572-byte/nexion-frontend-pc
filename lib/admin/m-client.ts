import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import type { OpsSku, PurchaseGate } from "@/lib/admin/platform-types";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { User360Profile, UserProfileQuery } from "@/lib/admin/user360-client";
import {
  MContentReadError,
  classifySupportAgentFailure,
  loadWithBoundedAbortRetry,
  parseMContentApiEnvelope,
  parseM1SupportAgentOverview,
  parseTicketAssigneeCandidates,
  type M1SupportAgentOverviewPayload,
  type MSupportAgentFailureKind,
  type MTicketAssigneeCandidate,
} from "@/lib/admin/m-support-read-contract";
export type { MTicketAssigneeCandidate } from "@/lib/admin/m-support-read-contract";
import type {
  AdvisorScript,
  CustomerProfile,
  SessionCategory,
  SessionConvo,
  SessionReplyTpl,
  SessionType,
  SupportFaq,
  SupportSla,
  SupportTicket,
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
} from "@/app/components/domain-views/m-tabs/data";

export type AdminPage<T> = {
  total: number;
  pageNum: number;
  pageSize: number;
  records: T[];
};

export type ConversationTimeoutPolicy = {
  policyKey: string;
  warnMinutes: number;
  closeMinutes: number;
  version: number;
  updatedBy?: string;
  reason?: string;
  updatedAt?: string;
};

type SupportTicketView = {
  id?: number;
  ticketNo?: string;
  userId?: number;
  category?: string;
  priority?: string;
  status?: string;
  title?: string;
  lastMessage?: string;
  assignedAdminId?: number;
  assignedAdminName?: string;
  userUnreadCount?: number;
  opsUnreadCount?: number;
  messageCount?: number;
  lastMessageAt?: string;
  closedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
  archivedAt?: string;
  version?: number;
  userExists?: boolean;
};

type SupportTicketMessageView = {
  id?: number;
  ticketNo?: string;
  senderType?: string;
  senderName?: string;
  content?: string;
  createdAt?: string;
};

type SupportTicketDetail = {
  ticket?: SupportTicketView;
  messages?: SupportTicketMessageView[];
  slaTarget?: {
    ruleVersion?: number;
    firstResponseMins?: number;
    resolutionHours?: number;
    queue?: string;
    escalation?: string;
    firstResponseDeadlineAt?: string;
    resolutionDeadlineAt?: string;
    firstResponseAt?: string;
    resolvedAt?: string;
    firstResponseOverdue?: boolean;
    resolutionOverdue?: boolean;
    evaluatedAt?: string;
  };
};

type ContentConversationView = {
  id?: number;
  conversationNo?: string;
  userId?: number;
  conversationType?: string;
  status?: string;
  ownerAgentId?: string;
  ownerAgentName?: string;
  unreadCount?: number;
  lastMessage?: string;
  lastMessageAt?: string;
  transferFromAgentId?: string;
  transferFromAgentName?: string;
  transferToType?: string;
  transferToId?: string;
  transferToName?: string;
  transferReason?: string;
  transferredAt?: string;
  updatedAt?: string;
  version?: number;
};

type ContentConversationMessageView = {
  id?: number;
  conversationNo?: string;
  senderType?: string;
  senderName?: string;
  content?: string;
  receiptStatus?: string;
  createdAt?: string;
};

// 后端 ConversationCustomerProfile record 的镜像(跨域聚合客户档案,只读快照)。
type ConversationCustomerProfile = {
  uid?: string;
  nickname?: string;
  phone?: string;
  vlevel?: string;
  systemTags?: string[];
  customTags?: string[];
  risk?: string;
  riskNote?: string;
  recharge?: string;
  withdraw?: string;
  balance?: string;
  tickets?: number;
  device?: string;
  hashrate?: string;
  idle?: string | null;
  region?: string;
  joined?: string;
  lastActive?: string;
  ledger?: Array<{ label?: string; when?: string; amount?: string; up?: boolean; pending?: boolean }>;
  notes?: Array<{ id?: string; ts?: number; author?: string; text?: string }>;
};

type ContentConversationDetail = {
  conversation?: ContentConversationView;
  messages?: ContentConversationMessageView[];
  customerProfile?: ConversationCustomerProfile;
};

type SupportFaqView = {
  id?: string;
  category?: string;
  question?: string;
  answer?: string;
  status?: string;
  surface?: string;
  language?: string;
  sortOrder?: number;
  version?: number;
  updatedAt?: string;
};

type SupportSlaView = {
  category?: string;
  firstResponseMins?: number;
  resolutionHours?: number;
  queue?: string;
  escalation?: string;
  version?: number;
  updatedAt?: string;
};

type SupportKnowledgeOverview = {
  faqs?: SupportFaqView[];
  sla?: SupportSlaView[];
  categories?: string[];
  surfaces?: string[];
  statuses?: string[];
  queues?: string[];
  escalations?: string[];
  sources?: string[];
};

const SLA_CATEGORIES = ["account", "withdrawal", "deposit", "hardware", "earnings", "genesis", "technical", "other"] as const;

function assertSupportKnowledgeOverview(value: unknown): SupportKnowledgeOverview {
  const malformed = () => {
    throw new Error("M4_KNOWLEDGE_OVERVIEW_MALFORMED");
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) malformed();
  const overview = value as SupportKnowledgeOverview;
  const arrays = [
    overview.faqs,
    overview.sla,
    overview.categories,
    overview.surfaces,
    overview.statuses,
    overview.queues,
    overview.escalations,
    overview.sources,
  ];
  if (!arrays.every(Array.isArray)) malformed();
  const faqs = overview.faqs as SupportFaqView[];
  const sla = overview.sla as SupportSlaView[];
  if (!faqs.every((faq) =>
    typeof faq.id === "string" && faq.id.trim().length > 0
    && typeof faq.question === "string" && faq.question.trim().length > 0
    && typeof faq.answer === "string" && faq.answer.trim().length > 0
    && typeof faq.category === "string"
    && typeof faq.surface === "string"
    && typeof faq.language === "string"
    && typeof faq.status === "string"
    && Number.isSafeInteger(faq.sortOrder)
    && Number.isSafeInteger(faq.version) && Number(faq.version) >= 1
    && typeof faq.updatedAt === "string" && !Number.isNaN(Date.parse(faq.updatedAt))
  )) malformed();
  if (new Set(faqs.map((faq) => faq.id)).size !== faqs.length) {
    throw new Error("M4_KNOWLEDGE_FAQ_ID_COLLISION");
  }
  if (!sla.every((row) =>
    typeof row.category === "string"
    && Number.isSafeInteger(row.firstResponseMins) && Number(row.firstResponseMins) > 0
    && Number.isSafeInteger(row.resolutionHours) && Number(row.resolutionHours) > 0
    && typeof row.queue === "string" && row.queue.trim().length > 0
    && typeof row.escalation === "string" && row.escalation.trim().length > 0
    && Number.isSafeInteger(row.version) && Number(row.version) >= 1
    && typeof row.updatedAt === "string" && !Number.isNaN(Date.parse(row.updatedAt))
  )) malformed();
  if (new Set(sla.map((row) => row.category)).size !== sla.length
    || !SLA_CATEGORIES.every((category) => sla.some((row) => row.category === category))) malformed();
  return overview;
}

type SessionCategoryView = {
  type?: string;
  name?: string;
  roleKey?: string;
  enabled?: boolean;
  managedBy?: string;
  readOnly?: boolean;
};

type SessionAdvisorPolicyView = {
  enabled?: boolean;
  delayMs?: number;
  cooldownHours?: number;
  maxPerSession?: number;
  audience?: string;
};

type SessionWorkbenchPolicyView = {
  timeoutFallback?: boolean;
};

type SessionScriptView = {
  id?: string;
  scriptGroup?: string;
  text?: string;
  ctaPath?: string;
  status?: string;
  audience?: string;
  updatedAt?: string;
};

type SessionReplyTemplateView = {
  id?: string;
  type?: string;
  text?: string;
  status?: string;
  updatedAt?: string;
};

type SessionTemplateOverview = {
  categories?: SessionCategoryView[];
  advisorPolicy?: SessionAdvisorPolicyView;
  workbenchPolicy?: SessionWorkbenchPolicyView;
  audienceOptions?: string[];
  segmentFields?: Record<string, unknown>[];
  scripts?: SessionScriptView[];
  replyTemplates?: SessionReplyTemplateView[];
};

type SupportAgentOverview = M1SupportAgentOverviewPayload;

type SupportAgentPageView = {
  total?: number;
  pageNum?: number;
  pageSize?: number;
  records?: Record<string, unknown>[];
  advisorAssignments?: Record<string, unknown>[];
};

type SupportWorkbenchPurchaseGate = {
  rankMin?: number | null;
  activeDirectMin?: number | null;
  teamVolumeMin?: number | null;
  mode?: "all" | "either" | null;
  quotaCap?: number | null;
  quotaSold?: number | null;
  quotaPeriod?: "month" | "lifetime" | null;
  enforce?: boolean | null;
};

type SupportWorkbenchSkuView = {
  skuId?: string;
  name?: string;
  tier?: string | null;
  tagline?: string | null;
  badge?: string | null;
  gpu?: string | null;
  vram?: string | null;
  hashRate?: string | null;
  power?: string | null;
  datacenter?: string | null;
  price?: number | string | null;
  dailyEarn?: number | string | null;
  dailyEarnNex?: number | string | null;
  shareYieldMin?: number | string | null;
  shareYieldMax?: number | string | null;
  baseRate?: string | null;
  sold?: number | null;
  stock?: string | null;
  aiImageGenPerMin?: number | null;
  aiLlmTokensPerSec?: number | null;
  aiVideoMinPerHour?: number | null;
  aiFineTuneMins?: number | null;
  aiUnlocks?: string | null;
  features?: string[] | null;
  generation?: number | null;
  lifecycle?: string | null;
  supersededBy?: string | null;
  tradeinDiscount?: number | string | null;
  unlockPhase?: string | null;
  purchaseGate?: SupportWorkbenchPurchaseGate | null;
  imageAssetId?: string | null;
  imageObjectKey?: string | null;
  imagePreviewUrl?: string | null;
  tag?: string | null;
  status?: string | null;
};

export type MLoadConfig = {
  version: number;
  autoBalance: boolean;
  defaultCap: number;
  burstCap: number;
  warnPct: number;
  quietHourBalance: boolean;
  overflowQueue: string;
};

export type MAgentState = Record<string, { cap: number; busy: boolean }>;

export type MSupportServiceType = "support" | "advisor";

export type MSupportAgent = {
  id: string;
  adminId: number;
  name: string;
  email: string;
  adminRole: string;
  status: string;
  seatType: "MANAGER" | "DEDICATED" | "GENERAL";
  position: string;
  serviceTypes: MSupportServiceType[];
  tags: string[];
  maxConcurrent: number;
  enabled: boolean;
  transferable: boolean;
  busy: boolean;
  assignedUserCount: number;
  updatedAt?: string;
};

export type MAdvisorAssignment = {
  id: number;
  agentAdminId: number;
  userId: number;
  userNo: string;
  nickname: string;
  status: string;
  startsAt?: string;
  endsAt?: string;
  operator?: string;
  reason?: string;
  updatedAt?: string;
};

export type MSupportAgentPage = AdminPage<MSupportAgent> & {
  advisorAssignments: MAdvisorAssignment[];
};

export type MContentData = {
  tickets: SupportTicket[];
  conversations: SessionConvo[];
  faqs: SupportFaq[];
  sla: SupportSla[];
  loadConfig: MLoadConfig;
  agentState: MAgentState;
  supportAgents: MSupportAgent[];
  supportAgentsAvailable: boolean;
  supportAgentsError: MSupportAgentFailureKind;
  ticketAssigneeCandidates: MTicketAssigneeCandidate[];
  ticketAssigneeCandidatesAvailable: boolean;
  advisorAssignments: MAdvisorAssignment[];
  categories: SessionCategory[];
  advisorPolicy: {
    enabled: string;
    delayMs: number;
    cooldownHours: number;
    maxPerSession: number;
    audience: string;
  };
  workbenchPolicy: {
    timeoutFallback: string;
  };
  audienceOptions: string[];
  segmentFields: Record<string, unknown>[];
  scripts: AdvisorScript[];
  scriptAudience: Record<string, string>;
  replyTemplates: SessionReplyTpl[];
  transferTargets: Array<Record<string, unknown>>;
  loadConfigAvailable: boolean;
  ticketsAvailable: boolean;
  conversationsAvailable: boolean;
  knowledgeAvailable: boolean;
  sessionTemplatesAvailable: boolean;
  loadWarnings: string[];
};

export type MLoadConfigWrite = Omit<MLoadConfig, "version"> & {
  expectedVersion: number;
  agentState: MAgentState;
};

const CATEGORY_LABEL: Record<string, string> = {
  advisor: "专属客服服务",
  support: "普通客服",
  ai: "Nova AI 顾问",
};

const MANAGED_BY: Record<string, string> = {
  advisor: "增长 / 客服坐席",
  support: "客服坐席",
  ai: "Nova 自动(配置见 I2)",
};

function idempotencyKey() {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function supportWorkbenchQueryString(query: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === "") return;
    params.set(key, String(value));
  });
  const text = params.toString();
  return text ? `?${text}` : "";
}

const CONTENT_API_TIMEOUT_MS = 8_000;

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init?.method && init.method !== "GET" && !headers.has("Idempotency-Key")) headers.set("Idempotency-Key", idempotencyKey());
  const controller = new AbortController();
  const upstreamSignal = init?.signal;
  let timedOut = false;
  const forwardAbort = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) forwardAbort();
  else upstreamSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CONTENT_API_TIMEOUT_MS);
  let res: Response;
  let text: string;
  try {
    res = await fetch(`/api/admin/content${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    text = await res.text();
  } catch (error) {
    if (timedOut) throw new Error("CONTENT_API_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", forwardAbort);
  }
  const method = (init?.method ?? "GET").toUpperCase();
  try {
    return parseMContentApiEnvelope<T>(res.status, text, method === "GET");
  } catch (error) {
    if (error instanceof MContentReadError) {
      throw new MContentReadError(
        error.status,
        error.apiCode,
        error.backendMessage,
        formatAdminApiError(error.backendMessage, `CONTENT_API_${error.status}`),
      );
    }
    throw error;
  }
}

export function fetchMConversationTimeoutPolicy() {
  return apiRequest<ConversationTimeoutPolicy>("/conversations/timeout-policy");
}

export function updateMConversationTimeoutPolicy(
  policy: ConversationTimeoutPolicy,
  input: { warnMinutes: number; closeMinutes: number; reason: string },
  stableIdempotencyKey?: string,
) {
  return apiRequest<ConversationTimeoutPolicy>("/conversations/timeout-policy", {
    method: "PUT",
    headers: stableIdempotencyKey ? { "Idempotency-Key": stableIdempotencyKey } : undefined,
    body: JSON.stringify({
      warnMinutes: input.warnMinutes,
      closeMinutes: input.closeMinutes,
      expectedVersion: policy.version,
      operator: currentAdminOperator(),
      reason: input.reason,
    }),
  });
}

function withReason<T extends Record<string, unknown>>(body: T, reason: string) {
  return { ...body, operator: currentAdminOperator(), reason };
}

function upper(value: string | undefined, fallback: string) {
  return (value || fallback).trim().toUpperCase();
}

function str(value: unknown, fallback = "") {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function num(value: unknown, fallback = 0) {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["1", "true", "on", "enabled"].includes(value.toLowerCase());
  if (typeof value === "number") return value !== 0;
  return fallback;
}

function optionalNum(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = num(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function adaptPurchaseGate(gate: SupportWorkbenchPurchaseGate | null | undefined): PurchaseGate | undefined {
  if (!gate) return undefined;
  const purchaseGate: PurchaseGate = {
    rankMin: gate.rankMin ?? undefined,
    activeDirectMin: gate.activeDirectMin ?? undefined,
    teamVolumeMin: gate.teamVolumeMin ?? undefined,
    mode: gate.mode === "either" ? "either" : "all",
    quotaCap: gate.quotaCap ?? undefined,
    quotaSold: gate.quotaSold ?? undefined,
    quotaPeriod: gate.quotaPeriod === "lifetime" ? "lifetime" : "month",
    enforce: gate.enforce !== false,
  };
  const hasValue =
    purchaseGate.rankMin != null ||
    purchaseGate.activeDirectMin != null ||
    purchaseGate.teamVolumeMin != null ||
    purchaseGate.quotaCap != null;
  return hasValue ? purchaseGate : undefined;
}

function adaptSupportWorkbenchSku(sku: SupportWorkbenchSkuView): OpsSku {
  return {
    id: str(sku.skuId),
    name: str(sku.name, str(sku.skuId, "未命名 SKU")),
    tier: str(sku.tier, "Entry"),
    tagline: sku.tagline ?? undefined,
    badge: sku.badge ?? undefined,
    gpu: sku.gpu ?? undefined,
    vram: sku.vram ?? undefined,
    hashRate: sku.hashRate ?? undefined,
    power: sku.power ?? undefined,
    datacenter: sku.datacenter ?? undefined,
    price: num(sku.price),
    dailyEarn: num(sku.dailyEarn),
    dailyEarnNEX: num(sku.dailyEarnNex),
    shareYieldMin: optionalNum(sku.shareYieldMin),
    shareYieldMax: optionalNum(sku.shareYieldMax),
    baseRate: sku.baseRate ?? undefined,
    sold: sku.sold ?? undefined,
    stock: sku.stock ?? "0",
    aiImageGenPerMin: sku.aiImageGenPerMin ?? undefined,
    aiLlmTokensPerSec: sku.aiLlmTokensPerSec ?? undefined,
    aiVideoMinPerHour: sku.aiVideoMinPerHour ?? undefined,
    aiFineTuneMins: sku.aiFineTuneMins ?? undefined,
    aiUnlocks: sku.aiUnlocks ?? undefined,
    features: sku.features ?? undefined,
    generation: sku.generation ?? undefined,
    lifecycle: sku.lifecycle ?? undefined,
    supersededBy: sku.supersededBy ?? undefined,
    tradeinDiscount: optionalNum(sku.tradeinDiscount),
    unlock: str(sku.unlockPhase),
    purchaseGate: adaptPurchaseGate(sku.purchaseGate),
    imageAssetId: sku.imageAssetId ?? undefined,
    imageObjectKey: sku.imageObjectKey ?? undefined,
    imagePreviewUrl: sku.imagePreviewUrl ?? undefined,
    tag: str(sku.tag),
    status: str(sku.status, "pending"),
  };
}

function requireLoadRaw(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!raw || typeof raw !== "object") {
    throw new Error("M_LOAD_CONFIG_BACKEND_RESPONSE_MISSING");
  }
  const nested = raw.loadConfig;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return raw;
}

function loadNumber(raw: Record<string, unknown>, field: keyof MLoadConfig): number {
  const parsed = Number(raw[field]);
  if (!Number.isFinite(parsed)) {
    throw new Error(`M_LOAD_CONFIG_FIELD_MISSING:${String(field)}`);
  }
  return parsed;
}

function loadBoolean(raw: Record<string, unknown>, field: keyof MLoadConfig): boolean {
  const value = raw[field];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "on", "enabled"].includes(normalized)) return true;
    if (["0", "false", "off", "disabled"].includes(normalized)) return false;
  }
  throw new Error(`M_LOAD_CONFIG_FIELD_MISSING:${String(field)}`);
}

function loadText(raw: Record<string, unknown>, field: keyof MLoadConfig): string {
  if (!(field in raw) || raw[field] == null) {
    throw new Error(`M_LOAD_CONFIG_FIELD_MISSING:${String(field)}`);
  }
  return str(raw[field]).trim();
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asStringArray(value: unknown): string[] {
  return asArray<unknown>(value).map((item) => str(item).trim()).filter(Boolean);
}

function requireSessionTemplateOverview(value: unknown): SessionTemplateOverview {
  const invalid = () => {
    throw new Error("M5_SESSION_TEMPLATE_PROTOCOL_INVALID");
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const overview = value as SessionTemplateOverview;
  if (!Array.isArray(overview.categories)
    || !overview.advisorPolicy || typeof overview.advisorPolicy !== "object"
    || !overview.workbenchPolicy || typeof overview.workbenchPolicy !== "object"
    || !Array.isArray(overview.audienceOptions)
    || !Array.isArray(overview.segmentFields)
    || !Array.isArray(overview.scripts)
    || !Array.isArray(overview.replyTemplates)) {
    invalid();
  }

  const categories = overview.categories ?? [];
  const categoryTypes = new Set(categories.map((row) => row.type));
  if (categories.length !== 3
    || categoryTypes.size !== 3
    || !["advisor", "support", "ai"].every((type) => categoryTypes.has(type))
    || categories.some((row) => !row.name?.trim()
      || !row.roleKey?.trim()
      || !row.managedBy?.trim()
      || typeof row.enabled !== "boolean"
      || typeof row.readOnly !== "boolean")
    || categories.some((row) => row.type === "ai" ? row.readOnly !== true : row.readOnly !== false)) {
    invalid();
  }

  const audienceOptions = overview.audienceOptions ?? [];
  if (audienceOptions.length === 0
    || audienceOptions.some((item) => typeof item !== "string" || !item.trim())
    || new Set(audienceOptions).size !== audienceOptions.length) {
    invalid();
  }
  const advisorPolicy = overview.advisorPolicy ?? {};
  if (typeof advisorPolicy.enabled !== "boolean"
    || !Number.isSafeInteger(advisorPolicy.delayMs) || (advisorPolicy.delayMs ?? -1) < 0
    || !Number.isSafeInteger(advisorPolicy.cooldownHours) || (advisorPolicy.cooldownHours ?? 0) < 1
    || !Number.isSafeInteger(advisorPolicy.maxPerSession) || (advisorPolicy.maxPerSession ?? -1) < 0
    || typeof advisorPolicy.audience !== "string"
    || !audienceOptions.includes(advisorPolicy.audience)) {
    invalid();
  }
  if (typeof overview.workbenchPolicy?.timeoutFallback !== "boolean") invalid();

  const statuses = new Set(["draft", "published", "archived"]);
  const scripts = overview.scripts ?? [];
  if (new Set(scripts.map((row) => row.id)).size !== scripts.length
    || scripts.some((row) => !row.id?.trim()
      || !row.scriptGroup?.trim()
      || !row.text?.trim()
      || typeof row.ctaPath !== "string"
      || !statuses.has(row.status ?? "")
      || !audienceOptions.includes(row.audience ?? ""))) {
    invalid();
  }
  const replyTemplates = overview.replyTemplates ?? [];
  if (new Set(replyTemplates.map((row) => row.id)).size !== replyTemplates.length
    || replyTemplates.some((row) => !row.id?.trim()
      || !["advisor", "support"].includes(row.type ?? "")
      || !row.text?.trim()
      || !statuses.has(row.status ?? ""))) {
    invalid();
  }
  return overview;
}

function asTs(value: string | undefined, fallback = Date.now()) {
  if (!value) return fallback;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : fallback;
}

function asDate(value: string | undefined) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const ts = new Date(value);
  return Number.isFinite(ts.getTime()) ? ts.toISOString().slice(0, 10) : value.slice(0, 10);
}

function ticketStatus(value: string | undefined): SupportTicketStatus {
  const v = upper(value, "OPEN");
  if (v === "IN_PROGRESS") return "in_progress";
  if (v === "PENDING_USER") return "pending_user";
  if (v === "RESOLVED") return "resolved";
  if (v === "CLOSED") return "closed";
  return "open";
}

export function toBackendTicketStatus(value: SupportTicketStatus) {
  if (value === "in_progress") return "IN_PROGRESS";
  if (value === "pending_user") return "PENDING_USER";
  return value.toUpperCase();
}

function ticketPriority(value: string | undefined): SupportTicketPriority {
  const v = upper(value, "NORMAL").toLowerCase();
  return ["low", "normal", "high", "urgent"].includes(v) ? (v as SupportTicketPriority) : "normal";
}

export function toBackendTicketPriority(value: SupportTicketPriority) {
  return value.toUpperCase();
}

function ticketCategory(value: string | undefined): SupportTicketCategory {
  const v = (value || "other").toLowerCase();
  return ["account", "withdrawal", "deposit", "hardware", "earnings", "genesis", "technical", "other"].includes(v)
    ? (v as SupportTicketCategory)
    : "other";
}

function faqCategory(value: string | undefined): SupportFaq["category"] {
  const v = (value || "general").toLowerCase();
  return v === "general" ? "general" : ticketCategory(v);
}

function surface(value: string | undefined): SupportFaq["surface"] {
  if (value === "Ticket Create") return "Ticket Create";
  if (value === "Nova") return "Nova";
  return "Help Center";
}

function status(value: string | undefined): "published" | "draft" {
  return (value || "").toLowerCase() === "published" ? "published" : "draft";
}

function templateStatus(value: string | undefined): "published" | "draft" | "archived" {
  const normalized = (value || "").toLowerCase();
  return value === "archived" ? "archived" : normalized === "published" ? "published" : normalized === "archived" ? "archived" : "draft";
}

function conversationStatus(value: string | undefined): SessionConvo["status"] {
  const v = upper(value, "OPEN");
  if (v === "RESOLVED") return "resolved";
  if (v === "CLOSED") return "closed";
  return "open";
}

type ConversationExpectedStatus = SessionConvo["status"] | "transferred";

export function toBackendConversationStatus(value: ConversationExpectedStatus) {
  return value.toUpperCase();
}

function conversationType(value: string | undefined): SessionConvo["type"] {
  return (value || "").toLowerCase() === "advisor" ? "advisor" : "support";
}

function roleKey(type: SessionConvo["type"]) {
  return type === "advisor" ? "conversations.roleAdvisor" : "conversations.roleSupport";
}

// 客户档案适配:detail 场景用后端跨域聚合的真实档案;列表行(只有 ContentConversationView,
// 无 detail)或会话未关联用户时降级为占位档案,待打开 detail 后由真实档案覆盖。
function adaptCustomerProfile(
  detail: ContentConversationDetail | ContentConversationView,
  base: ContentConversationView,
): CustomerProfile {
  const type = conversationType(base.conversationType);
  const backend = "customerProfile" in detail && detail.customerProfile ? detail.customerProfile : undefined;
  const fallbackUid = base.userId ? `U-${String(base.userId).padStart(5, "0")}` : "—";
  if (!backend) {
    // 列表场景 / 会话未关联用户:占位档案(只读辅助,真实数据在打开 detail 时由后端聚合返回)
    return {
      uid: fallbackUid,
      nickname: fallbackUid === "—" ? "未关联用户" : `用户 ${fallbackUid}`,
      phone: "—",
      vlevel: "—",
      systemTags: [type === "advisor" ? "顾问会话" : "客服会话"],
      customTags: [],
      risk: "中",
      riskNote: "打开会话后由后端聚合客户资金 / 风险 / 设备档案。",
      recharge: "—",
      withdraw: "—",
      balance: "—",
      tickets: 0,
      device: "—",
      hashrate: "—",
      region: "—",
      joined: "—",
      lastActive: "刚刚",
      ledger: [],
      notes: [],
    };
  }
  // detail 场景:后端已跨域聚合真实档案,逐字段兜底
  const riskRaw = str(backend.risk);
  const risk: CustomerProfile["risk"] = riskRaw === "高" ? "高" : riskRaw === "低" ? "低" : "中";
  const systemTags = asStringArray(backend.systemTags);
  const customTags = asStringArray(backend.customTags);
  return {
    uid: str(backend.uid, fallbackUid),
    nickname: str(backend.nickname, fallbackUid === "—" ? "未关联用户" : `用户 ${fallbackUid}`),
    phone: str(backend.phone, "—"),
    vlevel: str(backend.vlevel, "—"),
    systemTags: systemTags.length ? systemTags : [type === "advisor" ? "顾问会话" : "客服会话"],
    customTags,
    risk,
    riskNote: str(backend.riskNote, "按客服流程核对"),
    recharge: str(backend.recharge, "—"),
    withdraw: str(backend.withdraw, "—"),
    balance: str(backend.balance, "—"),
    tickets: num(backend.tickets, 0),
    device: str(backend.device, "—"),
    hashrate: str(backend.hashrate, "—"),
    idle: backend.idle ? str(backend.idle) : undefined,
    region: str(backend.region, "—"),
    joined: str(backend.joined, "—"),
    lastActive: str(backend.lastActive, "—") || "—",
    ledger: asArray<Record<string, unknown>>(backend.ledger).map((row) => ({
      label: str(row.label),
      when: str(row.when),
      amount: str(row.amount),
      up: typeof row.up === "boolean" ? row.up : undefined,
      pending: typeof row.pending === "boolean" ? row.pending : undefined,
    })),
    notes: asArray<Record<string, unknown>>(backend.notes).map((row) => ({
      id: str(row.id),
      ts: num(row.ts, Date.now()),
      author: str(row.author),
      text: str(row.text),
    })),
  };
}

function adaptTicket(detail: SupportTicketDetail | SupportTicketView): SupportTicket {
  const base = "ticket" in detail && detail.ticket ? detail.ticket : (detail as SupportTicketView);
  const slaTarget = "ticket" in detail ? detail.slaTarget : undefined;
  const created = asTs(base.createdAt);
  const updated = asTs(base.updatedAt, created);
  const messages = asArray<SupportTicketMessageView>("messages" in detail ? detail.messages : []).map((m) => {
    const senderType = upper(m.senderType, "USER");
    return {
      ts: asTs(m.createdAt, updated),
      author: senderType === "USER"
        ? ("user" as const)
        : senderType === "SYSTEM"
          ? ("system" as const)
          : senderType === "INTERNAL"
            ? ("internal" as const)
            : ("agent" as const),
      agentName: senderType === "USER"
        ? undefined
        : str(m.senderName, senderType === "SYSTEM" ? "系统" : base.assignedAdminName || "客服台"),
      body: str(m.content, ""),
    };
  });
  return {
    id: str(base.ticketNo, `TK-${base.id ?? "UNKNOWN"}`),
    userId: base.userId,
    userVerified: Boolean(base.userExists),
    subject: str(base.title, "未命名工单"),
    category: ticketCategory(base.category),
    status: ticketStatus(base.status),
    priority: ticketPriority(base.priority),
    createdAt: created,
    updatedAt: updated,
    lastReplyAt: asTs(base.lastMessageAt, updated),
    unread: num(base.opsUnreadCount, 0),
    ownerAdminId: base.assignedAdminId,
    owner: str(base.assignedAdminName, "Unassigned"),
    archived: Boolean(base.archived),
    archivedAt: base.archivedAt ? asTs(base.archivedAt) : undefined,
    version: num(base.version, 0),
    slaTarget: {
      ruleVersion: num(slaTarget?.ruleVersion, 0),
      firstResponseMins: num(slaTarget?.firstResponseMins, 0),
      resolutionHours: num(slaTarget?.resolutionHours, 0),
      queue: str(slaTarget?.queue, ""),
      escalation: str(slaTarget?.escalation, ""),
      firstResponseDeadlineAt: asTs(slaTarget?.firstResponseDeadlineAt),
      resolutionDeadlineAt: asTs(slaTarget?.resolutionDeadlineAt),
      firstResponseAt: slaTarget?.firstResponseAt ? asTs(slaTarget.firstResponseAt) : undefined,
      resolvedAt: slaTarget?.resolvedAt ? asTs(slaTarget.resolvedAt) : undefined,
      firstResponseOverdue: Boolean(slaTarget?.firstResponseOverdue),
      resolutionOverdue: Boolean(slaTarget?.resolutionOverdue),
      evaluatedAt: asTs(slaTarget?.evaluatedAt),
    },
    messages,
  };
}

function assertSupportTicketPage(value: unknown): AdminPage<SupportTicketView> {
  if (!value || typeof value !== "object") throw new Error("M2_TICKET_PAGE_MALFORMED");
  const page = value as Partial<AdminPage<SupportTicketView>>;
  if (
    !Array.isArray(page.records)
    || !Number.isSafeInteger(page.total)
    || Number(page.total) < 0
    || !Number.isSafeInteger(page.pageNum)
    || !Number.isSafeInteger(page.pageSize)
  ) {
    throw new Error("M2_TICKET_PAGE_MALFORMED");
  }
  return page as AdminPage<SupportTicketView>;
}

function assertSupportTicketDetail(value: unknown): SupportTicketDetail {
  if (!value || typeof value !== "object") throw new Error("M2_TICKET_DETAIL_MALFORMED");
  const detail = value as SupportTicketDetail;
  const ticket = detail.ticket;
  const slaTarget = detail.slaTarget;
  const allowedStatuses = new Set(["OPEN", "IN_PROGRESS", "PENDING_USER", "RESOLVED", "CLOSED"]);
  const allowedPriorities = new Set(["LOW", "NORMAL", "HIGH", "URGENT"]);
  const allowedCategories = new Set(["ACCOUNT", "WITHDRAWAL", "DEPOSIT", "HARDWARE", "EARNINGS", "GENESIS", "TECHNICAL", "OTHER"]);
  if (
    !ticket
    || typeof ticket.ticketNo !== "string"
    || !ticket.ticketNo.trim()
    || !allowedStatuses.has(upper(ticket.status, ""))
    || !allowedPriorities.has(upper(ticket.priority, ""))
    || !allowedCategories.has(upper(ticket.category, ""))
    || typeof ticket.title !== "string"
    || !Number.isSafeInteger(ticket.version)
    || Number(ticket.version) < 0
    || typeof ticket.userExists !== "boolean"
    || !slaTarget
    || !Number.isSafeInteger(slaTarget.ruleVersion)
    || Number(slaTarget.ruleVersion) < 1
    || !Number.isSafeInteger(slaTarget.firstResponseMins)
    || Number(slaTarget.firstResponseMins) < 1
    || !Number.isSafeInteger(slaTarget.resolutionHours)
    || Number(slaTarget.resolutionHours) < 1
    || typeof slaTarget.queue !== "string"
    || !slaTarget.queue.trim()
    || typeof slaTarget.escalation !== "string"
    || !slaTarget.escalation.trim()
    || typeof slaTarget.firstResponseDeadlineAt !== "string"
    || Number.isNaN(Date.parse(slaTarget.firstResponseDeadlineAt))
    || typeof slaTarget.resolutionDeadlineAt !== "string"
    || Number.isNaN(Date.parse(slaTarget.resolutionDeadlineAt))
    || typeof slaTarget.firstResponseOverdue !== "boolean"
    || typeof slaTarget.resolutionOverdue !== "boolean"
    || typeof slaTarget.evaluatedAt !== "string"
    || Number.isNaN(Date.parse(slaTarget.evaluatedAt))
    || !Array.isArray(detail.messages)
  ) {
    throw new Error("M2_TICKET_DETAIL_MALFORMED");
  }
  const validMessages = detail.messages.every((message) =>
    message
    && typeof message === "object"
    && ["USER", "AGENT", "SYSTEM", "INTERNAL"].includes(upper(message.senderType, ""))
    && typeof message.content === "string"
    && typeof message.createdAt === "string"
    && Boolean(message.createdAt.trim()));
  if (!validMessages) throw new Error("M2_TICKET_DETAIL_MALFORMED");
  return detail;
}

function assertConversationRow(value: unknown): ContentConversationView {
  if (!value || typeof value !== "object") throw new Error("M3_CONVERSATION_DETAIL_INVALID");
  const row = value as ContentConversationView;
  const transferType = row.transferToType?.toLowerCase();
  if (
    !Number.isSafeInteger(row.id)
    || typeof row.conversationNo !== "string"
    || !row.conversationNo.trim()
    // The backend advertises AI conversation rows alongside advisor/support.
    // M3 renders them through its existing non-advisor, read/write-safe lane;
    // rejecting one valid AI row must not erase the real inbox.
    || !["ADVISOR", "SUPPORT", "AI"].includes(upper(row.conversationType, ""))
    || !["OPEN", "TRANSFERRED", "RESOLVED", "CLOSED"].includes(upper(row.status, ""))
    || !Number.isSafeInteger(row.unreadCount)
    || Number(row.unreadCount) < 0
    || !Number.isSafeInteger(row.version)
    || Number(row.version) < 0
    || typeof row.updatedAt !== "string"
    || Number.isNaN(Date.parse(row.updatedAt))
    || (upper(row.status, "") === "TRANSFERRED" && !["agent", "queue", "standby"].includes(transferType || ""))
  ) {
    throw new Error("M3_CONVERSATION_DETAIL_INVALID");
  }
  return row;
}

function assertConversationPage(value: unknown): AdminPage<ContentConversationView> {
  if (!value || typeof value !== "object") throw new Error("M3_CONVERSATION_PAGE_MALFORMED");
  const page = value as Partial<AdminPage<ContentConversationView>>;
  if (
    !Array.isArray(page.records)
    || !Number.isSafeInteger(page.total)
    || Number(page.total) < 0
    || !Number.isSafeInteger(page.pageNum)
    || Number(page.pageNum) < 1
    || !Number.isSafeInteger(page.pageSize)
    || Number(page.pageSize) < 1
  ) {
    throw new Error("M3_CONVERSATION_PAGE_MALFORMED");
  }
  page.records.forEach(assertConversationRow);
  return page as AdminPage<ContentConversationView>;
}

function assertConversationDetail(value: unknown): ContentConversationDetail {
  if (!value || typeof value !== "object") throw new Error("M3_CONVERSATION_DETAIL_INVALID");
  const detail = value as ContentConversationDetail;
  assertConversationRow(detail.conversation);
  if (!Array.isArray(detail.messages) || !detail.messages.every((message) =>
    message
    && typeof message === "object"
    && Number.isSafeInteger(message.id)
    && ["USER", "AGENT", "SYSTEM"].includes(upper(message.senderType, ""))
    && typeof message.content === "string"
    && typeof message.createdAt === "string"
    && !Number.isNaN(Date.parse(message.createdAt)))) {
    throw new Error("M3_CONVERSATION_DETAIL_INVALID");
  }
  return detail;
}

async function fetchAllSupportTickets(): Promise<AdminPage<SupportTicketView>> {
  const pageSize = 100;
  const first = assertSupportTicketPage(
    await apiRequest<unknown>(`/tickets?pageNum=1&pageSize=${pageSize}`),
  );
  const records = [...asArray<SupportTicketView>(first.records)];
  const total = first.total;
  let pageNum = 2;
  while (records.length < total) {
    const page = assertSupportTicketPage(
      await apiRequest<unknown>(`/tickets?pageNum=${pageNum}&pageSize=${pageSize}`),
    );
    const next = asArray<SupportTicketView>(page.records);
    if (next.length === 0) throw new Error("M2_TICKET_PAGE_INCOMPLETE");
    records.push(...next);
    pageNum += 1;
  }
  if (
    records.length !== total
    || records.some((row) => typeof row.ticketNo !== "string" || !row.ticketNo.trim())
    || new Set(records.map((row) => row.ticketNo)).size !== records.length
  ) {
    throw new Error("M2_TICKET_PAGE_INCOMPLETE");
  }
  return { total, pageNum: 1, pageSize: Math.max(records.length, pageSize), records };
}

async function fetchAllSupportConversations(): Promise<AdminPage<ContentConversationView>> {
  const pageSize = 100;
  const first = assertConversationPage(await apiRequest<unknown>(`/conversations?pageNum=1&pageSize=${pageSize}`));
  const records = [...first.records];
  const total = first.total;
  let pageNum = 2;
  while (records.length < total) {
    const page = assertConversationPage(await apiRequest<unknown>(`/conversations?pageNum=${pageNum}&pageSize=${pageSize}`));
    const next = page.records;
    if (next.length === 0) throw new Error("M3_CONVERSATION_PAGE_INCOMPLETE");
    records.push(...next);
    pageNum += 1;
  }
  if (records.length !== total || new Set(records.map((row) => row.conversationNo)).size !== records.length) {
    throw new Error("M3_CONVERSATION_PAGE_INCOMPLETE");
  }
  return { total, pageNum: 1, pageSize: Math.max(records.length, pageSize), records };
}

function adaptConversation(detail: ContentConversationDetail | ContentConversationView): SessionConvo {
  const base = "conversation" in detail && detail.conversation ? detail.conversation : (detail as ContentConversationView);
  const type = conversationType(base.conversationType);
  const updated = asTs(base.updatedAt);
  const messages = asArray<ContentConversationMessageView>("messages" in detail ? detail.messages : []).map((m) => {
    const agent = upper(m.senderType, "USER") !== "USER";
    return {
      ts: asTs(m.createdAt, updated),
      sender: agent ? ("agent" as const) : ("user" as const),
      agentName: agent ? str(m.senderName, base.ownerAgentName || "客服台") : undefined,
      status: agent && str(m.receiptStatus, "sent").toLowerCase() === "read" ? ("read" as const) : agent ? ("sent" as const) : undefined,
      text: str(m.content, ""),
    };
  });
  const transfer = base.transferToType
    ? {
        from: str(base.transferFromAgentName, "客服台"),
        to:
          base.transferToType === "agent"
            ? ({ kind: "agent" as const, agentId: str(base.transferToId), name: str(base.transferToName, "Unassigned") })
            : base.transferToType === "queue"
              ? ({ kind: "queue" as const, queue: str(base.transferToName, "客服队列") })
              : ({ kind: "standby" as const }),
        reason: str(base.transferReason, "转入待处理"),
        ts: asTs(base.transferredAt, updated),
      }
    : undefined;
  const profile = adaptCustomerProfile(detail, base);
  return {
    id: str(base.conversationNo, `CV-${base.id ?? "UNKNOWN"}`),
    version: num(base.version, -1),
    type,
    agentName: str(base.ownerAgentName, type === "advisor" ? "Mia" : "客服台"),
    roleKey: roleKey(type),
    unread: num(base.unreadCount, 0),
    lastTs: asTs(base.lastMessageAt, updated),
    status: conversationStatus(base.status),
    ownerAgentId: str(base.ownerAgentId),
    owner: str(base.ownerAgentName, "Unassigned"),
    messages,
    customer: profile.nickname,
    profile,
    archived: upper(base.status, "OPEN") === "CLOSED",
    origin: type,
    transfer,
  };
}

function adaptFaq(row: SupportFaqView): SupportFaq {
  return {
    id: str(row.id, `FAQ-${Date.now()}`),
    category: faqCategory(row.category),
    question: str(row.question, "未命名 FAQ"),
    answer: str(row.answer, ""),
    status: status(row.status),
    surface: surface(row.surface),
    language: (["zh-CN", "en-US", "vi-VN"].includes(str(row.language)) ? row.language : "zh-CN") as SupportFaq["language"],
    sortOrder: num(row.sortOrder, 0),
    version: num(row.version, 1),
    updatedAt: asDate(row.updatedAt),
  };
}

function adaptSla(row: SupportSlaView): SupportSla {
  return {
    category: ticketCategory(row.category),
    firstResponseMins: num(row.firstResponseMins, 30),
    resolutionHours: num(row.resolutionHours, 24),
    queue: str(row.queue, "客服队列"),
    escalation: str(row.escalation, "客服主管"),
    version: num(row.version, 1),
  };
}

function adaptCategory(row: SessionCategoryView): SessionCategory {
  const type = (["advisor", "support", "ai"].includes(str(row.type)) ? row.type : "support") as SessionType;
  return {
    type,
    name: str(row.name, CATEGORY_LABEL[type] || type),
    roleKey: str(row.roleKey, type === "advisor" ? "conversations.roleAdvisor" : type === "ai" ? "conversations.roleAi" : "conversations.roleSupport"),
    enabled: bool(row.enabled, true),
    managedBy: str(row.managedBy, MANAGED_BY[type] || "客服坐席"),
  };
}

function scriptGroup(value: string | undefined): AdvisorScript["group"] {
  const group = str(value, "开场");
  return ["开场", "升级", "锁仓", "复投"].includes(group) ? (group as AdvisorScript["group"]) : "开场";
}

function adaptScript(row: SessionScriptView): AdvisorScript {
  return {
    id: str(row.id, `AS-${Date.now()}`),
    group: scriptGroup(row.scriptGroup),
    text: str(row.text, ""),
    ctaHref: str(row.ctaPath, "—") || "—",
    status: templateStatus(row.status),
  };
}

function adaptReplyTemplate(row: SessionReplyTemplateView): SessionReplyTpl {
  const type = str(row.type, "support") === "advisor" ? "advisor" : "support";
  return {
    id: str(row.id, `RT-${Date.now()}`),
    type,
    text: str(row.text, ""),
    status: templateStatus(row.status),
  };
}

function supportServiceType(value: string): MSupportServiceType | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "advisor") return "advisor";
  if (normalized === "support") return "support";
  return null;
}

function adaptSupportAgent(row: Record<string, unknown>): MSupportAgent {
  const serviceTypes = asStringArray(row.serviceTypes)
    .map(supportServiceType)
    .filter((item): item is MSupportServiceType => item != null);
  const adminId = num(row.adminId, 0);
  const name = str(row.name, row.email ? str(row.email) : adminId ? `客服 ${adminId}` : "客服坐席");
  const seatTypeRaw = str(row.seatType, "").trim().toUpperCase();
  const position = str(row.position, "通用客服");
  const seatType = seatTypeRaw === "MANAGER" || seatTypeRaw === "DEDICATED" || seatTypeRaw === "GENERAL"
    ? seatTypeRaw
    : position.includes("主管")
      ? "MANAGER"
      : position.includes("专属") || position.includes("顾问")
        ? "DEDICATED"
        : "GENERAL";
  return {
    id: str(row.id, adminId ? `agent-${adminId}` : agentIdForName(name)),
    adminId,
    name,
    email: str(row.email, ""),
    adminRole: str(row.adminRole, ""),
    status: str(row.status, ""),
    seatType,
    position,
    serviceTypes: serviceTypes.length ? serviceTypes : ["support"],
    tags: asStringArray(row.tags),
    maxConcurrent: num(row.maxConcurrent, 0),
    enabled: bool(row.enabled, true),
    transferable: bool(row.transferable, true),
    busy: bool(row.busy, false),
    assignedUserCount: num(row.assignedUserCount, 0),
    updatedAt: str(row.updatedAt, ""),
  };
}

function adaptAdvisorAssignment(row: Record<string, unknown>): MAdvisorAssignment {
  return {
    id: num(row.id, 0),
    agentAdminId: num(row.agentAdminId, 0),
    userId: num(row.userId, 0),
    userNo: str(row.userNo, row.userId ? `U${String(row.userId).padStart(8, "0")}` : ""),
    nickname: str(row.nickname, "未命名用户"),
    status: str(row.status, ""),
    startsAt: str(row.startsAt, ""),
    endsAt: str(row.endsAt, ""),
    operator: str(row.operator, ""),
    reason: str(row.reason, ""),
    updatedAt: str(row.updatedAt, ""),
  };
}

function adaptLoadConfig(raw: Record<string, unknown> | undefined, agents: MSupportAgent[]): MLoadConfig & { agentState: MAgentState } {
  const loadRaw = requireLoadRaw(raw);
  const base: MLoadConfig = {
    version: loadNumber(loadRaw, "version"),
    autoBalance: loadBoolean(loadRaw, "autoBalance"),
    defaultCap: loadNumber(loadRaw, "defaultCap"),
    burstCap: loadNumber(loadRaw, "burstCap"),
    warnPct: loadNumber(loadRaw, "warnPct"),
    quietHourBalance: loadBoolean(loadRaw, "quietHourBalance"),
    overflowQueue: loadText(loadRaw, "overflowQueue"),
  };
  const agentRaw = raw?.agentState && typeof raw.agentState === "object" ? (raw.agentState as Record<string, unknown>) : {};
  const agentState: MAgentState = {};
  agents.forEach((agent) => {
    agentState[agent.id] = {
      cap: agent.maxConcurrent || base.defaultCap,
      busy: agent.busy,
    };
  });
  Object.entries(agentRaw).forEach(([id, value]) => {
    const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    agentState[id] = {
      cap: num(row.cap, agentState[id]?.cap ?? base.defaultCap),
      busy: bool(row.busy, false),
    };
  });
  return {
    ...base,
    agentState,
  };
}

async function detailOrUnavailable<T extends { id?: string }>(
  rows: T[],
  loader: (id: string) => Promise<unknown>,
  adapt: (value: unknown) => T,
): Promise<{ rows: T[]; complete: boolean }> {
  const details = await Promise.allSettled(
    rows.map(async (row) => (row.id ? adapt(await loader(row.id)) : row)),
  );
  const complete = details.every((detail) => detail.status === "fulfilled");
  return {
    rows: complete ? details.map((detail) => (detail as PromiseFulfilledResult<T>).value) : [],
    complete,
  };
}

const M1_SUPPORT_AGENT_MAX_ATTEMPTS = 2;
let m1SupportAgentGeneration = 0;
let m1SupportAgentTask: {
  sessionKey: string;
  generation: number;
  promise: Promise<SupportAgentOverview>;
} | null = null;

function fetchSharedM1SupportAgentOverview(): Promise<SupportAgentOverview> {
  const authState = useAdminAuth.getState();
  const sessionKey = adminShellSessionKey(authState.session, authState.authEpoch);
  if (m1SupportAgentTask?.sessionKey === sessionKey) return m1SupportAgentTask.promise;
  const generation = ++m1SupportAgentGeneration;
  const promise = loadWithBoundedAbortRetry(
    async () => parseM1SupportAgentOverview(await apiRequest<unknown>("/support-agents")),
    M1_SUPPORT_AGENT_MAX_ATTEMPTS,
  );
  const task = { sessionKey, generation, promise };
  m1SupportAgentTask = task;
  void promise.then(
    () => {
      if (m1SupportAgentGeneration === generation && m1SupportAgentTask === task) m1SupportAgentTask = null;
    },
    () => {
      if (m1SupportAgentGeneration === generation && m1SupportAgentTask === task) m1SupportAgentTask = null;
    },
  );
  return promise;
}

function initialMContentData(): MContentData {
  return {
    tickets: [],
    conversations: [],
    faqs: [],
    sla: [],
    loadConfig: {
      version: 1,
      autoBalance: false,
      defaultCap: 8,
      burstCap: 12,
      warnPct: 80,
      quietHourBalance: false,
      overflowQueue: "转人工备勤队列",
    },
    agentState: {},
    supportAgents: [],
    supportAgentsAvailable: false,
    supportAgentsError: "none",
    ticketAssigneeCandidates: [],
    ticketAssigneeCandidatesAvailable: false,
    advisorAssignments: [],
    categories: [],
    advisorPolicy: { enabled: "on", delayMs: 1500, cooldownHours: 24, maxPerSession: 1, audience: "" },
    workbenchPolicy: { timeoutFallback: "off" },
    audienceOptions: [],
    segmentFields: [],
    scripts: [],
    scriptAudience: {},
    replyTemplates: [],
    transferTargets: [],
    loadConfigAvailable: false,
    ticketsAvailable: false,
    conversationsAvailable: false,
    knowledgeAvailable: false,
    sessionTemplatesAvailable: false,
    loadWarnings: [],
  };
}

function currentMContentSessionKey(): string {
  const authState = useAdminAuth.getState();
  return adminShellSessionKey(authState.session, authState.authEpoch);
}

function isMContentSessionCurrent(sessionKey: string): boolean {
  return sessionKey === currentMContentSessionKey();
}

export async function fetchMContentData(onProgress?: (data: MContentData) => void): Promise<MContentData> {
  const mContentSessionKey = currentMContentSessionKey();
  let snapshot = initialMContentData();
  const authorities = useAdminAuth.getState().session?.authorities ?? [];
  const publish = (patch: Partial<MContentData>, warning?: string) => {
    if (!isMContentSessionCurrent(mContentSessionKey)) return;
    const loadWarnings = warning && !snapshot.loadWarnings.includes(warning)
      ? [...snapshot.loadWarnings, warning]
      : snapshot.loadWarnings;
    snapshot = { ...snapshot, ...patch, loadWarnings };
    onProgress?.(snapshot);
  };

  const ticketsTask = (async () => {
    let warning = "工单数据";
    try {
      const page = await fetchAllSupportTickets();
      const rows = page.records.map(adaptTicket);
      const details = await detailOrUnavailable(
        rows,
        (id) => apiRequest<unknown>(`/tickets/${encodeURIComponent(id)}`),
        (value) => adaptTicket(assertSupportTicketDetail(value)),
      );
      if (!details.complete) {
        warning = "工单明细";
        throw new Error("M2_TICKET_DETAILS_UNAVAILABLE");
      }
      publish({ tickets: details.rows, ticketsAvailable: true });
    } catch {
      publish({ tickets: [], ticketsAvailable: false }, warning);
    }
  })();

  const conversationsTask = (async () => {
    let warning = "会话数据";
    try {
      const page = await fetchAllSupportConversations();
      const rows = page.records.map(adaptConversation);
      const details = await detailOrUnavailable(
        rows,
        (id) => apiRequest<unknown>(`/conversations/${encodeURIComponent(id)}`),
        (value) => adaptConversation(assertConversationDetail(value)),
      );
      if (!details.complete) {
        warning = "会话明细";
        throw new Error("M3_CONVERSATION_DETAILS_UNAVAILABLE");
      }
      publish({ conversations: details.rows, conversationsAvailable: true });
    } catch {
      publish({ conversations: [], conversationsAvailable: false }, warning);
    }
  })();

  const m1Task = (async () => {
    if (!authorities.includes("service_m1_read")) {
      publish({
        supportAgents: [],
        supportAgentsAvailable: false,
        supportAgentsError: "permission",
        advisorAssignments: [],
        transferTargets: [],
        loadConfigAvailable: false,
      });
      return;
    }
    // The M3 transfer dialog depends only on the validated support-agent
    // overview.  Start the unrelated load-config read concurrently, but never
    // make a usable transfer target wait for it to settle.
    const loadConfigTask: Promise<PromiseSettledResult<Record<string, unknown>>> = apiRequest<Record<string, unknown>>("/tickets/load-config")
      .then((value) => ({ status: "fulfilled", value }) as const)
      .catch((reason: unknown) => ({ status: "rejected", reason }) as const);
    const agentResult: PromiseSettledResult<SupportAgentOverview> = await fetchSharedM1SupportAgentOverview()
      .then((value) => ({ status: "fulfilled", value }) as const)
      .catch((reason: unknown) => ({ status: "rejected", reason }) as const);
    const overview = agentResult.status === "fulfilled" ? agentResult.value : null;
    const supportAgents = overview ? overview.agents!.map(adaptSupportAgent) : [];
    const advisorAssignments = overview ? overview.advisorAssignments!.map(adaptAdvisorAssignment) : [];
    const transferTargets = overview ? [...overview.transferTargets!] : [];
    const supportAgentsAvailable = overview !== null;
    const supportAgentsError = agentResult.status === "rejected"
      ? classifySupportAgentFailure(agentResult.reason)
      : "none";
    // M_FINAL13_TRANSFER_CANDIDATES_PROGRESS: publish validated seats immediately.
    publish({
      supportAgents,
      supportAgentsAvailable,
      supportAgentsError,
      advisorAssignments,
      transferTargets,
    });
    if (!overview) publish({}, supportAgentsError === "permission" ? "坐席名单权限" : "坐席名单数据不可用");

    // M_FINAL13_TRANSFER_CANDIDATES_PROGRESS: load-config is independent.
    let loadConfigAvailable = false;
    const loadResult = await loadConfigTask;
    if (loadResult.status === "fulfilled") {
      try {
        const adapted = adaptLoadConfig(loadResult.value, supportAgents);
        loadConfigAvailable = true;
        publish({
          loadConfig: {
            version: adapted.version,
            autoBalance: adapted.autoBalance,
            defaultCap: adapted.defaultCap,
            burstCap: adapted.burstCap,
            warnPct: adapted.warnPct,
            quietHourBalance: adapted.quietHourBalance,
            overflowQueue: adapted.overflowQueue,
          },
          agentState: adapted.agentState,
          loadConfigAvailable,
        });
      } catch {
        publish({ loadConfigAvailable }, "负载策略");
      }
    } else {
      publish({ loadConfigAvailable }, "负载策略");
    }
  })();

  const m2CandidatesTask = (async () => {
    if (!authorities.includes("service_m2_read")) {
      publish({ ticketAssigneeCandidates: [], ticketAssigneeCandidatesAvailable: false });
      return;
    }
    try {
      const candidates = parseTicketAssigneeCandidates(
        await apiRequest<unknown>("/tickets/assignee-candidates"),
      );
      publish({ ticketAssigneeCandidates: candidates, ticketAssigneeCandidatesAvailable: true });
    } catch {
      publish({ ticketAssigneeCandidates: [], ticketAssigneeCandidatesAvailable: false }, "工单坐席候选数据");
    }
  })();

  const knowledgeTask = (async () => {
    try {
      const knowledge = assertSupportKnowledgeOverview(await apiRequest<unknown>("/knowledge/overview"));
      publish({
        faqs: knowledge.faqs!.map(adaptFaq),
        sla: knowledge.sla!.map(adaptSla),
        knowledgeAvailable: true,
      });
    } catch {
      publish({ faqs: [], sla: [], knowledgeAvailable: false }, "响应时限");
    }
  })();

  const templatesTask = (async () => {
    try {
      const templates = requireSessionTemplateOverview(await apiRequest<unknown>("/session-templates/overview"));
      const scripts = templates.scripts!.map(adaptScript);
      publish({
        categories: templates.categories!.map(adaptCategory),
        advisorPolicy: {
          enabled: bool(templates.advisorPolicy?.enabled, true) ? "on" : "off",
          delayMs: num(templates.advisorPolicy?.delayMs, 1500),
          cooldownHours: num(templates.advisorPolicy?.cooldownHours, 24),
          maxPerSession: num(templates.advisorPolicy?.maxPerSession, 1),
          audience: str(templates.advisorPolicy?.audience),
        },
        workbenchPolicy: {
          timeoutFallback: bool(templates.workbenchPolicy?.timeoutFallback, false) ? "on" : "off",
        },
        audienceOptions: templates.audienceOptions!.map((item) => str(item)).filter(Boolean),
        segmentFields: [...templates.segmentFields!],
        scripts,
        scriptAudience: Object.fromEntries(templates.scripts!.map((row) => [str(row.id), str(row.audience)])),
        replyTemplates: templates.replyTemplates!.map(adaptReplyTemplate),
        sessionTemplatesAvailable: true,
      });
    } catch {
      publish({
        categories: [],
        audienceOptions: [],
        segmentFields: [],
        scripts: [],
        scriptAudience: {},
        replyTemplates: [],
        sessionTemplatesAvailable: false,
      }, "客服话术协议");
    }
  })();

  const tasks = [ticketsTask, conversationsTask, m1Task, m2CandidatesTask, knowledgeTask, templatesTask];
  await Promise.all(tasks);
  if (!isMContentSessionCurrent(mContentSessionKey)) {
    throw new Error("M_CONTENT_AUTH_EPOCH_CHANGED");
  }
  return snapshot;
}

/** Narrow shell-badge read: never loads the M1 seat-management bundle. */
export async function fetchMServicePendingConversations(): Promise<SessionConvo[]> {
  const page = await fetchAllSupportConversations();
  return page.records.map(adaptConversation);
}

export async function fetchMSessionScriptsPage(pageNum = 1, pageSize = 5): Promise<AdminPage<AdvisorScript>> {
  const page = await apiRequest<AdminPage<SessionScriptView>>(`/session-templates/scripts?pageNum=${encodeURIComponent(String(pageNum))}&pageSize=${encodeURIComponent(String(pageSize))}`);
  return {
    total: page.total,
    pageNum: page.pageNum,
    pageSize: page.pageSize,
    records: asArray<SessionScriptView>(page.records).map(adaptScript),
  };
}

export async function fetchMReplyTemplatesPage(pageNum = 1, pageSize = 5): Promise<AdminPage<SessionReplyTpl>> {
  const page = await apiRequest<AdminPage<SessionReplyTemplateView>>(`/session-templates/reply-templates?pageNum=${encodeURIComponent(String(pageNum))}&pageSize=${encodeURIComponent(String(pageSize))}`);
  return {
    total: page.total,
    pageNum: page.pageNum,
    pageSize: page.pageSize,
    records: asArray<SessionReplyTemplateView>(page.records).map(adaptReplyTemplate),
  };
}

export async function fetchMSupportAgentsPage(pageNum = 1, pageSize = 5): Promise<MSupportAgentPage> {
  const page = await apiRequest<SupportAgentPageView>(`/support-agents/page?pageNum=${encodeURIComponent(String(pageNum))}&pageSize=${encodeURIComponent(String(pageSize))}`);
  return {
    total: num(page.total, 0),
    pageNum: num(page.pageNum, pageNum),
    pageSize: num(page.pageSize, pageSize),
    records: asArray<Record<string, unknown>>(page.records).map(adaptSupportAgent),
    advisorAssignments: asArray<Record<string, unknown>>(page.advisorAssignments).map(adaptAdvisorAssignment),
  };
}

export async function fetchMSupportWorkbenchSkus(pageNum = 1, pageSize = 100): Promise<OpsSku[]> {
  const page = await apiRequest<AdminPage<SupportWorkbenchSkuView>>(
    `/support-workbench/skus?pageNum=${encodeURIComponent(String(pageNum))}&pageSize=${encodeURIComponent(String(pageSize))}`,
  );
  return asArray<SupportWorkbenchSkuView>(page.records).map(adaptSupportWorkbenchSku);
}

export async function fetchMSupportWorkbenchUsers(query: UserProfileQuery = {}): Promise<AdminPage<User360Profile>> {
  const pageNum = query.pageNum ?? 1;
  const pageSize = query.pageSize ?? 10;
  const page = await apiRequest<AdminPage<User360Profile>>(
    `/support-workbench/users${supportWorkbenchQueryString({ ...query, pageNum, pageSize })}`,
  );
  return {
    total: num(page.total, 0),
    pageNum: num(page.pageNum, pageNum),
    pageSize: num(page.pageSize, pageSize),
    records: asArray<User360Profile>(page.records),
  };
}

export function buildMLegacyParams(data: MContentData): Record<string, string> {
  const params: Record<string, string> = {
    "I.support.tickets": JSON.stringify(data.tickets),
    "I.support.sla": JSON.stringify(data.sla),
    "I.support.faqs": JSON.stringify(data.faqs),
    "I.support.agents": JSON.stringify(data.supportAgents),
    "I.support.agentsAvailable": data.supportAgentsAvailable ? "1" : "0",
    "I.support.agentsError": data.supportAgentsError,
    "I.support.ticketAssigneeCandidates": JSON.stringify(data.ticketAssigneeCandidates),
    "I.support.ticketAssigneeCandidatesAvailable": data.ticketAssigneeCandidatesAvailable ? "1" : "0",
    "I.support.advisorAssignments": JSON.stringify(data.advisorAssignments),
    "I.session.convos": JSON.stringify(data.conversations),
    "I.session.categories": JSON.stringify(data.categories),
    "I.session.scripts": JSON.stringify(data.scripts),
    "I.session.replyTemplates": JSON.stringify(data.replyTemplates),
    "I.session.transferTargets": JSON.stringify(data.transferTargets),
    "I.support.loadWarnings": JSON.stringify(data.loadWarnings),
    "I.support.ticketsAvailable": data.ticketsAvailable ? "1" : "0",
    "I.session.conversationsAvailable": data.conversationsAvailable ? "1" : "0",
    "I.support.knowledgeAvailable": data.knowledgeAvailable ? "1" : "0",
    "I.session.templatesAvailable": data.sessionTemplatesAvailable ? "1" : "0",
    "I.session.advisor.policy.enabled": data.advisorPolicy.enabled,
    "I.session.advisor.policy.delayMs": String(data.advisorPolicy.delayMs),
    "I.session.advisor.policy.cooldownHours": String(data.advisorPolicy.cooldownHours),
    "I.session.advisor.policy.maxPerSession": String(data.advisorPolicy.maxPerSession),
    "I.session.advisor.policy.audience": data.advisorPolicy.audience,
    "I.session.workbench.timeoutFallback": data.workbenchPolicy.timeoutFallback,
    "I.session.audienceOptions": JSON.stringify(data.audienceOptions),
    "I.session.segmentFields": JSON.stringify(data.segmentFields),
  };
  if (data.loadConfigAvailable) {
    params["I.support.load.version"] = String(data.loadConfig.version);
    params["I.support.load.autoBalance"] = data.loadConfig.autoBalance ? "1" : "0";
    params["I.support.load.defaultCap"] = String(data.loadConfig.defaultCap);
    params["I.support.load.burstCap"] = String(data.loadConfig.burstCap);
    params["I.support.load.warnPct"] = String(data.loadConfig.warnPct);
    params["I.support.load.quietHourBalance"] = data.loadConfig.quietHourBalance ? "1" : "0";
    params["I.support.load.overflowQueue"] = data.loadConfig.overflowQueue;
  }
  data.categories.forEach((cat) => {
    params[`I.session.cat.${cat.type}.enabled`] = cat.enabled ? "on" : "off";
  });
  data.scripts.forEach((script) => {
    params[`I.session.script.${script.id}.status`] = script.status;
    params[`I.session.script.${script.id}.audience`] = data.scriptAudience[script.id] || "";
  });
  data.replyTemplates.forEach((tpl) => {
    params[`I.session.tpl.${tpl.id}.status`] = tpl.status;
  });
  data.supportAgents.forEach((agent) => {
    const state = data.agentState[agent.id] ?? { cap: agent.maxConcurrent, busy: agent.busy };
    if (state) {
      params[`I.support.agent.${agent.name}.cap`] = String(state.cap);
      params[`I.support.agent.${agent.name}.busy`] = state.busy ? "1" : "0";
    }
  });
  Object.entries(data.agentState).forEach(([id, state]) => {
    if (data.supportAgents.some((agent) => agent.id === id)) return;
    if (state) {
      params[`I.support.agent.${id}.cap`] = String(state.cap);
      params[`I.support.agent.${id}.busy`] = state.busy ? "1" : "0";
    }
  });
  return params;
}

export function adminIdForAgent(name: string, data?: MContentData | null) {
  const agent = data?.supportAgents.find((item) => item.name === name || item.id === name);
  if (agent) return agent.adminId;
  return data?.ticketAssigneeCandidates.find((item) => item.name === name)?.adminId ?? 0;
}

export function agentIdForName(name: string, data?: MContentData | null) {
  const agent = data?.supportAgents.find((item) => item.name === name || item.id === name);
  if (agent) return agent.id;
  const fallback = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return fallback || "agent";
}

export const mContentActions = {
  updateLoadConfig(payload: MLoadConfigWrite, reason: string, idempotencyKey?: string) {
    return apiRequest<Record<string, unknown>>("/tickets/load-config", {
      method: "PATCH",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason(payload, reason)),
    });
  },
  rebalanceLoad(agents: Array<Record<string, unknown>>, expectedVersion: number, reason: string, idempotencyKey?: string) {
    return apiRequest<Record<string, unknown>>("/tickets/load-config/rebalance", {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ agents, expectedVersion }, reason)),
    });
  },
  createTicket(ticket: {
    userId?: number;
    category: SupportTicketCategory;
    priority: SupportTicketPriority;
    title: string;
    body: string;
    assignedAdminId: number;
    assignedAdminName: string;
  }, reason: string, idempotencyKey?: string) {
    return apiRequest<SupportTicketDetail>("/tickets", {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ ...ticket, category: ticket.category.toUpperCase(), priority: toBackendTicketPriority(ticket.priority) }, reason)),
    });
  },
  replyTicket(ticketNo: string, body: string, expectedStatus: SupportTicketStatus, expectedVersion: number, reason: string, idempotencyKey?: string) {
    return apiRequest<SupportTicketDetail>(`/tickets/${encodeURIComponent(ticketNo)}/replies`, {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({
        body,
        expectedStatus: toBackendTicketStatus(expectedStatus),
        expectedVersion,
      }, reason)),
    });
  },
  updateTicketStatus(ticketNo: string, statusValue: SupportTicketStatus, expectedStatus: SupportTicketStatus, expectedVersion: number, reason: string, idempotencyKey?: string) {
    return apiRequest<SupportTicketDetail>(`/tickets/${encodeURIComponent(ticketNo)}/status`, {
      method: "PATCH",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({
        status: toBackendTicketStatus(statusValue),
        expectedStatus: toBackendTicketStatus(expectedStatus),
        expectedVersion,
      }, reason)),
    });
  },
  updateTicketPriority(ticketNo: string, priority: SupportTicketPriority, expectedStatus: SupportTicketStatus, expectedVersion: number, reason: string, idempotencyKey?: string) {
    return apiRequest<SupportTicketDetail>(`/tickets/${encodeURIComponent(ticketNo)}/priority`, {
      method: "PATCH",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({
        priority: toBackendTicketPriority(priority),
        expectedStatus: toBackendTicketStatus(expectedStatus),
        expectedVersion,
      }, reason)),
    });
  },
  assignTicket(ticketNo: string, assignedAdminName: string, assignedAdminId: number, expectedStatus: SupportTicketStatus, expectedVersion: number, reason: string, idempotencyKey?: string) {
    return apiRequest<SupportTicketDetail>(`/tickets/${encodeURIComponent(ticketNo)}/assignee`, {
      method: "PATCH",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({
        assignedAdminId,
        assignedAdminName,
        expectedStatus: toBackendTicketStatus(expectedStatus),
        expectedVersion,
      }, reason)),
    });
  },
  archiveTicket(ticketNo: string, archived: boolean, expectedStatus: SupportTicketStatus, expectedVersion: number, reason: string, idempotencyKey?: string) {
    return apiRequest<SupportTicketDetail>(`/tickets/${encodeURIComponent(ticketNo)}/archive`, {
      method: "PATCH",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({
        archived,
        expectedStatus: toBackendTicketStatus(expectedStatus),
        expectedVersion,
      }, reason)),
    });
  },
  escalateTicket(
    ticketNo: string,
    owner: { ownerAgentId: string; ownerAgentName: string },
    expectedStatus: SupportTicketStatus,
    expectedVersion: number,
    reason: string,
    idempotencyKey?: string,
  ) {
    return apiRequest<{ ticket?: SupportTicketDetail; conversation?: ContentConversationView }>(`/tickets/${encodeURIComponent(ticketNo)}/escalate`, {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({
        ...owner,
        expectedStatus: toBackendTicketStatus(expectedStatus),
        expectedVersion,
      }, reason)),
    });
  },
  addInternalNote(ticketNo: string, body: string, expectedStatus: SupportTicketStatus, expectedVersion: number, reason: string, idempotencyKey?: string) {
    return apiRequest<SupportTicketDetail>(`/tickets/${encodeURIComponent(ticketNo)}/internal-notes`, {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({
        body,
        expectedStatus: toBackendTicketStatus(expectedStatus),
        expectedVersion,
      }, reason)),
    });
  },
  replyConversation(conversationNo: string, body: string, expectedStatus: SessionConvo["status"], expectedVersion: number, reason: string, idempotencyKey?: string) {
    return apiRequest<ContentConversationView>(`/conversations/${encodeURIComponent(conversationNo)}/replies`, {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ body, expectedStatus: toBackendConversationStatus(expectedStatus), expectedVersion }, reason)),
    });
  },
  updateConversationStatus(conversationNo: string, statusValue: SessionConvo["status"], expectedStatus: SessionConvo["status"], expectedVersion: number, reason: string, idempotencyKey?: string) {
    return apiRequest<ContentConversationView>(`/conversations/${encodeURIComponent(conversationNo)}/status`, {
      method: "PATCH",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({
        status: toBackendConversationStatus(statusValue),
        expectedStatus: toBackendConversationStatus(expectedStatus),
        expectedVersion,
      }, reason)),
    });
  },
  archiveConversation(conversationNo: string, archived: boolean, expectedStatus: SessionConvo["status"], expectedVersion: number, reason: string, idempotencyKey?: string) {
    return apiRequest<ContentConversationView>(`/conversations/${encodeURIComponent(conversationNo)}/archive`, {
      method: "PATCH",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ archived, expectedStatus: toBackendConversationStatus(expectedStatus), expectedVersion }, reason)),
    });
  },
  archiveConversations(conversationNos: string[], expectedVersions: Record<string, number>, reason: string, idempotencyKey?: string) {
    return apiRequest<ContentConversationView[]>("/conversations/archive/batch", {
      method: "PATCH",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ conversationNos, expectedVersions }, reason)),
    });
  },
  addCustomerTag(conversationNo: string, tag: string, reason: string, idempotencyKey?: string) {
    return apiRequest<string[]>(`/conversations/${encodeURIComponent(conversationNo)}/customer-tags`, {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ tag }, reason)),
    });
  },
  removeCustomerTag(conversationNo: string, tag: string, reason: string, idempotencyKey?: string) {
    return apiRequest<string[]>(`/conversations/${encodeURIComponent(conversationNo)}/customer-tags`, {
      method: "DELETE",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ tag }, reason)),
    });
  },
  addCustomerNote(conversationNo: string, text: string, reason: string, idempotencyKey?: string) {
    return apiRequest<{ id?: string; ts?: number; author?: string; text?: string }>(`/conversations/${encodeURIComponent(conversationNo)}/customer-notes`, {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ text }, reason)),
    });
  },
  removeCustomerNote(conversationNo: string, noteId: string, reason: string, idempotencyKey?: string) {
    return apiRequest<unknown>(`/conversations/${encodeURIComponent(conversationNo)}/customer-notes/${encodeURIComponent(noteId)}`, {
      method: "DELETE",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({}, reason)),
    });
  },
  transferConversation(conversationNo: string, transfer: SessionConvo["transfer"], expectedStatus: SessionConvo["status"], expectedVersion: number, reason: string, idempotencyKey?: string) {
    const target = transfer?.to;
    const body =
      target?.kind === "agent"
        ? { targetType: "agent", targetId: target.agentId, targetName: target.name }
        : target?.kind === "queue"
          ? { targetType: "queue", targetId: target.queue, targetName: target.queue }
          : { targetType: "standby", targetId: "standby-pool", targetName: "备勤池" };
    return apiRequest<ContentConversationView>(`/conversations/${encodeURIComponent(conversationNo)}/transfer`, {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ ...body, expectedStatus: toBackendConversationStatus(expectedStatus), expectedVersion }, transfer?.reason || reason)),
    });
  },
  acceptTransfer(conversationNo: string, expectedStatus: ConversationExpectedStatus, expectedVersion: number, reason: string, idempotencyKey?: string) {
    return apiRequest<ContentConversationView>(`/conversations/${encodeURIComponent(conversationNo)}/transfer/accept`, {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ expectedStatus: toBackendConversationStatus(expectedStatus), expectedVersion }, reason)),
    });
  },
  returnTransfer(conversationNo: string, target: "from" | "standby", expectedStatus: ConversationExpectedStatus, expectedVersion: number, reason: string, idempotencyKey?: string) {
    return apiRequest<ContentConversationView>(`/conversations/${encodeURIComponent(conversationNo)}/transfer/return`, {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ target, expectedStatus: toBackendConversationStatus(expectedStatus), expectedVersion }, reason)),
    });
  },
  waitTransfer(conversationNo: string, expectedStatus: ConversationExpectedStatus, expectedVersion: number, reason: string, idempotencyKey?: string) {
    return apiRequest<ContentConversationView>(`/conversations/${encodeURIComponent(conversationNo)}/transfer/wait`, {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ expectedStatus: toBackendConversationStatus(expectedStatus), expectedVersion }, reason)),
    });
  },
  fallbackTransfer(conversationNo: string, expectedStatus: ConversationExpectedStatus, expectedVersion: number, reason: string, idempotencyKey?: string) {
    return apiRequest<ContentConversationView>(`/conversations/${encodeURIComponent(conversationNo)}/transfer/fallback`, {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ expectedStatus: toBackendConversationStatus(expectedStatus), expectedVersion }, reason)),
    });
  },
  initiateConversation(convo: {
    conversationType: SessionConvo["type"];
    userId?: number;
    ownerAgentId?: string;
    ownerAgentName: string;
    openingText: string;
  }, reason: string, idempotencyKey?: string) {
    return apiRequest<ContentConversationView>("/conversations", {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ ...convo, ownerAgentId: convo.ownerAgentId || agentIdForName(convo.ownerAgentName), conversationType: convo.conversationType.toUpperCase() }, reason)),
    });
  },
  convertConversationToTicket(conversationNo: string, ticket: {
    category: SupportTicketCategory;
    priority: SupportTicketPriority;
    title: string;
    assignedAdminId?: number;
    assignedAdminName: string;
    expectedStatus: SessionConvo["status"];
    expectedVersion: number;
  }, reason: string, idempotencyKey?: string) {
    return apiRequest<unknown>(`/conversations/${encodeURIComponent(conversationNo)}/ticket`, {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ ...ticket, expectedStatus: toBackendConversationStatus(ticket.expectedStatus), category: ticket.category.toUpperCase(), priority: toBackendTicketPriority(ticket.priority) }, reason)),
    });
  },
  updateSupportAgentProfile(adminId: number, profile: {
    serviceTypes?: MSupportServiceType[];
    tags?: string[];
    maxConcurrent?: number;
    enabled?: boolean;
    transferable?: boolean;
    busy?: boolean;
  }, reason: string, idempotencyKey?: string) {
    return apiRequest<MSupportAgent>(`/support-agents/${encodeURIComponent(String(adminId))}/profile`, {
      method: "PATCH",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason(profile, reason)),
    });
  },
  assignSupportSeat(adminId: number, seat: {
    position: string;
    serviceTypes?: MSupportServiceType[];
    tags?: string[];
    maxConcurrent?: number;
    enabled?: boolean;
    transferable?: boolean;
    busy?: boolean;
    userIds?: number[];
  }, reason: string, idempotencyKey?: string) {
    return apiRequest<MSupportAgent>(`/support-agents/${encodeURIComponent(String(adminId))}/seat-assignment`, {
      method: "PATCH",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason(seat, reason)),
    });
  },
  assignAdvisorUser(adminId: number, userId: number, reason: string) {
    return apiRequest<MAdvisorAssignment>(`/support-agents/${encodeURIComponent(String(adminId))}/assignments`, {
      method: "POST",
      body: JSON.stringify(withReason({ userId }, reason)),
    });
  },
  async assignAdvisorUsers(adminId: number, userIds: number[], reason: string, idempotencyKey?: string) {
    const normalizedUserIds = Array.from(new Set(userIds
      .map((userId) => Number(userId))
      .filter((userId) => Number.isFinite(userId) && userId > 0)));
    const assignments: MAdvisorAssignment[] = [];
    for (const userId of normalizedUserIds) {
      assignments.push(await apiRequest<MAdvisorAssignment>(`/support-agents/${encodeURIComponent(String(adminId))}/assignments`, {
        method: "POST",
        headers: idempotencyKey ? { "Idempotency-Key": `${idempotencyKey}:${userId}` } : undefined,
        body: JSON.stringify(withReason({ userId }, reason)),
      }));
    }
    return assignments;
  },
  deactivateAdvisorAssignment(adminId: number, assignmentId: number, reason: string, idempotencyKey?: string) {
    return apiRequest<MAdvisorAssignment>(`/support-agents/${encodeURIComponent(String(adminId))}/assignments/${encodeURIComponent(String(assignmentId))}`, {
      method: "DELETE",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({}, reason)),
    });
  },
  createFaq(faq: Omit<SupportFaq, "id" | "updatedAt" | "version">, reason: string, idempotencyKey?: string) {
    const { version: _version, ...payload } = faq as Omit<SupportFaq, "id" | "updatedAt">;
    return apiRequest<SupportFaqView>("/knowledge/faqs", {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason(payload, reason)),
    });
  },
  updateFaq(faq: SupportFaq, before: SupportFaq, reason: string, idempotencyKey?: string) {
    const { id, updatedAt: _updatedAt, version: _version, ...payload } = faq;
    return apiRequest<SupportFaqView>(`/knowledge/faqs/${encodeURIComponent(faq.id)}`, {
      method: "PATCH",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ ...payload, expectedStatus: before.status, expectedVersion: before.version }, reason)),
    });
  },
  updateFaqStatus(id: string, nextStatus: SupportFaq["status"], expectedStatus: SupportFaq["status"], expectedVersion: number, reason: string, idempotencyKey?: string) {
    return apiRequest<SupportFaqView>(`/knowledge/faqs/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ status: nextStatus, expectedStatus, expectedVersion }, reason)),
    });
  },
  deleteFaq(id: string, expectedStatus: SupportFaq["status"], expectedVersion: number, reason: string, idempotencyKey?: string) {
    return apiRequest<void>(`/knowledge/faqs/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ expectedStatus, expectedVersion }, reason)),
    });
  },
  updateSla(row: SupportSla, expectedVersion: number, reason: string, idempotencyKey?: string) {
    const { version: _version, ...payload } = row;
    return apiRequest<SupportSlaView>(`/knowledge/sla/${encodeURIComponent(row.category)}`, {
      method: "PATCH",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ ...payload, expectedVersion }, reason)),
    });
  },
  updateCategory(type: SessionType, enabled: boolean, expectedEnabled: boolean, reason: string, idempotencyKey?: string) {
    return apiRequest<SessionCategoryView>(`/session-templates/categories/${encodeURIComponent(type)}`, {
      method: "PATCH",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ enabled, expectedEnabled }, reason)),
    });
  },
  updateAdvisorPolicy(field: string, value: string, expectedValue: string, reason: string, idempotencyKey?: string) {
    return apiRequest<SessionAdvisorPolicyView>(`/session-templates/advisor-policy/${encodeURIComponent(field)}`, {
      method: "PATCH",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ value, expectedValue }, reason)),
    });
  },
  updateWorkbenchPolicy(field: string, value: string, expectedValue: string, reason: string, idempotencyKey?: string) {
    return apiRequest<SessionWorkbenchPolicyView>(`/session-templates/workbench-policy/${encodeURIComponent(field)}`, {
      method: "PATCH",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ value, expectedValue }, reason)),
    });
  },
  createScript(script: { scriptGroup: AdvisorScript["group"]; text: string; ctaPath: string; audience: string; status: AdvisorScript["status"] }, reason: string, idempotencyKey?: string) {
    return apiRequest<SessionScriptView>("/session-templates/scripts", {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason(script, reason)),
    });
  },
  updateScriptStatus(scriptId: string, nextStatus: AdvisorScript["status"], expectedStatus: AdvisorScript["status"], reason: string, idempotencyKey?: string) {
    return apiRequest<SessionScriptView>(`/session-templates/scripts/${encodeURIComponent(scriptId)}/status`, {
      method: "PATCH",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ status: nextStatus, expectedStatus }, reason)),
    });
  },
  updateScriptAudience(scriptId: string, audience: string, expectedAudience: string, reason: string, idempotencyKey?: string) {
    return apiRequest<SessionScriptView>(`/session-templates/scripts/${encodeURIComponent(scriptId)}/audience`, {
      method: "PATCH",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ audience, expectedAudience }, reason)),
    });
  },
  createReplyTemplate(template: { type: SessionReplyTpl["type"]; text: string; status: SessionReplyTpl["status"] }, reason: string, idempotencyKey?: string) {
    return apiRequest<SessionReplyTemplateView>("/session-templates/reply-templates", {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason(template, reason)),
    });
  },
  updateReplyTemplateStatus(templateId: string, nextStatus: SessionReplyTpl["status"], expectedStatus: SessionReplyTpl["status"], reason: string, idempotencyKey?: string) {
    return apiRequest<SessionReplyTemplateView>(`/session-templates/reply-templates/${encodeURIComponent(templateId)}/status`, {
      method: "PATCH",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(withReason({ status: nextStatus, expectedStatus }, reason)),
    });
  },
};
