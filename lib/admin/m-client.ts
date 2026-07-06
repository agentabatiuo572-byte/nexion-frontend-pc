import { formatAdminApiError } from "@/lib/admin/error-messages";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import type { OpsSku, PurchaseGate } from "@/lib/admin/platform-types";
import type { User360Profile, UserProfileQuery } from "@/lib/admin/user360-client";
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

type ApiResult<T> = {
  code?: number;
  message?: string;
  data?: T;
};

export type AdminPage<T> = {
  total: number;
  pageNum: number;
  pageSize: number;
  records: T[];
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
};

type ContentConversationMessageView = {
  id?: number;
  conversationNo?: string;
  senderType?: string;
  senderName?: string;
  content?: string;
  createdAt?: string;
};

// 后端 ConversationCustomerProfile record 的镜像(跨域聚合客户档案,只读快照)。
type ConversationCustomerProfile = {
  uid?: string;
  nickname?: string;
  phone?: string;
  vlevel?: string;
  kyc?: string;
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
  updatedAt?: string;
};

type SupportSlaView = {
  category?: string;
  firstResponseMins?: number;
  resolutionHours?: number;
  queue?: string;
  escalation?: string;
  updatedAt?: string;
};

type SupportKnowledgeOverview = {
  faqs?: SupportFaqView[];
  sla?: SupportSlaView[];
};

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

type SupportAgentOverview = {
  agents?: Record<string, unknown>[];
  advisorAssignments?: Record<string, unknown>[];
  transferTargets?: Record<string, unknown>[];
};

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
  rating?: number | string | null;
  reviews?: number | null;
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
};

export type MLoadConfigWrite = MLoadConfig & {
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
    rating: optionalNum(sku.rating),
    reviews: sku.reviews ?? undefined,
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
  return ["account", "withdrawal", "deposit", "kyc", "hardware", "earnings", "genesis", "technical", "other"].includes(v)
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

function conversationStatus(value: string | undefined): SessionConvo["status"] {
  const v = upper(value, "OPEN");
  if (v === "RESOLVED") return "resolved";
  if (v === "CLOSED") return "closed";
  return "open";
}

export function toBackendConversationStatus(value: SessionConvo["status"]) {
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
      kyc: "待核对",
      systemTags: [type === "advisor" ? "顾问会话" : "客服会话"],
      customTags: [],
      risk: "中",
      riskNote: "打开会话后由后端聚合客户资金 / 实名 / 设备档案。",
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
    kyc: str(backend.kyc, "待核对"),
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
  const created = asTs(base.createdAt);
  const updated = asTs(base.updatedAt, created);
  const messages = asArray<SupportTicketMessageView>("messages" in detail ? detail.messages : []).map((m) => ({
    ts: asTs(m.createdAt, updated),
    author: upper(m.senderType, "USER") === "USER" ? ("user" as const) : ("agent" as const),
    agentName: upper(m.senderType, "USER") === "USER" ? undefined : str(m.senderName, base.assignedAdminName || "客服台"),
    body: str(m.content, ""),
  }));
  if (!messages.length && base.lastMessage) {
    messages.push({
      ts: asTs(base.lastMessageAt, updated),
      author: "agent",
      agentName: base.assignedAdminName || "客服台",
      body: base.lastMessage,
    });
  }
  return {
    id: str(base.ticketNo, `TK-${base.id ?? "UNKNOWN"}`),
    subject: str(base.title, "未命名工单"),
    category: ticketCategory(base.category),
    status: ticketStatus(base.status),
    priority: ticketPriority(base.priority),
    createdAt: created,
    updatedAt: updated,
    lastReplyAt: asTs(base.lastMessageAt, updated),
    unread: num(base.opsUnreadCount, 0),
    owner: str(base.assignedAdminName, "Unassigned"),
    messages,
  };
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
      text: str(m.content, ""),
    };
  });
  if (!messages.length && base.lastMessage) {
    messages.push({
      ts: asTs(base.lastMessageAt, updated),
      sender: "agent",
      agentName: base.ownerAgentName || "客服台",
      text: base.lastMessage,
    });
  }
  const transfer = base.transferToType
    ? {
        from: str(base.transferFromAgentName, "客服台"),
        to:
          base.transferToType === "agent"
            ? ({ kind: "agent" as const, name: str(base.transferToName, "Unassigned") })
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
    type,
    agentName: str(base.ownerAgentName, type === "advisor" ? "Mia" : "客服台"),
    roleKey: roleKey(type),
    unread: num(base.unreadCount, 0),
    lastTs: asTs(base.lastMessageAt, updated),
    status: conversationStatus(base.status),
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
    status: status(row.status),
  };
}

function adaptReplyTemplate(row: SessionReplyTemplateView): SessionReplyTpl {
  const type = str(row.type, "support") === "advisor" ? "advisor" : "support";
  return {
    id: str(row.id, `RT-${Date.now()}`),
    type,
    text: str(row.text, ""),
    status: status(row.status),
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

function adaptLoadConfig(raw: Record<string, unknown> | undefined, agents: MSupportAgent[]): MLoadConfigWrite {
  const loadRaw = requireLoadRaw(raw);
  const base: MLoadConfig = {
    autoBalance: loadBoolean(loadRaw, "autoBalance"),
    defaultCap: loadNumber(loadRaw, "defaultCap"),
    burstCap: loadNumber(loadRaw, "burstCap"),
    warnPct: loadNumber(loadRaw, "warnPct"),
    quietHourBalance: loadBoolean(loadRaw, "quietHourBalance"),
    overflowQueue: loadText(loadRaw, "overflowQueue"),
  };
  const agentRaw = loadRaw.agentState && typeof loadRaw.agentState === "object" ? (loadRaw.agentState as Record<string, unknown>) : {};
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

async function detailOrRow<T extends { id?: string }>(
  rows: T[],
  loader: (id: string) => Promise<unknown>,
  adapt: (value: unknown) => T,
) {
  const details = await Promise.all(
    rows.map(async (row) => {
      if (!row.id) return row;
      try {
        return adapt(await loader(row.id));
      } catch {
        return row;
      }
    }),
  );
  return details;
}

export async function fetchMContentData(): Promise<MContentData> {
  const [ticketPage, loadRaw, convoPage, supportAgentOverview, knowledge, sessionTemplates] = await Promise.all([
    apiRequest<AdminPage<SupportTicketView>>("/tickets?pageNum=1&pageSize=100"),
    apiRequest<Record<string, unknown>>("/tickets/load-config"),
    apiRequest<AdminPage<ContentConversationView>>("/conversations?pageNum=1&pageSize=100"),
    apiRequest<SupportAgentOverview>("/support-agents"),
    apiRequest<SupportKnowledgeOverview>("/knowledge/overview"),
    apiRequest<SessionTemplateOverview>("/session-templates/overview"),
  ]);

  const ticketRows = asArray<SupportTicketView>(ticketPage.records).map((row) => adaptTicket(row));
  const convoRows = asArray<ContentConversationView>(convoPage.records).map((row) => adaptConversation(row));
  const tickets = await detailOrRow(ticketRows, (id) => apiRequest<SupportTicketDetail>(`/tickets/${encodeURIComponent(id)}`), (value) => adaptTicket(value as SupportTicketDetail));
  const conversations = await detailOrRow(convoRows, (id) => apiRequest<ContentConversationDetail>(`/conversations/${encodeURIComponent(id)}`), (value) => adaptConversation(value as ContentConversationDetail));
  const supportAgents = asArray<Record<string, unknown>>(supportAgentOverview.agents).map(adaptSupportAgent);
  const advisorAssignments = asArray<Record<string, unknown>>(supportAgentOverview.advisorAssignments).map(adaptAdvisorAssignment);
  const transferTargets = asArray<Record<string, unknown>>(supportAgentOverview.transferTargets);
  const loadConfig = adaptLoadConfig(loadRaw, supportAgents);
  const scriptAudience = Object.fromEntries(asArray<SessionScriptView>(sessionTemplates.scripts).map((row) => [str(row.id), str(row.audience)]));

  return {
    tickets,
    conversations,
    faqs: asArray<SupportFaqView>(knowledge.faqs).map(adaptFaq),
    sla: asArray<SupportSlaView>(knowledge.sla).map(adaptSla),
    loadConfig: {
      autoBalance: loadConfig.autoBalance,
      defaultCap: loadConfig.defaultCap,
      burstCap: loadConfig.burstCap,
      warnPct: loadConfig.warnPct,
      quietHourBalance: loadConfig.quietHourBalance,
      overflowQueue: loadConfig.overflowQueue,
    },
    agentState: loadConfig.agentState,
    supportAgents,
    advisorAssignments,
    categories: asArray<SessionCategoryView>(sessionTemplates.categories).map(adaptCategory),
    advisorPolicy: {
      enabled: bool(sessionTemplates.advisorPolicy?.enabled, true) ? "on" : "off",
      delayMs: num(sessionTemplates.advisorPolicy?.delayMs, 1500),
      cooldownHours: num(sessionTemplates.advisorPolicy?.cooldownHours, 24),
      maxPerSession: num(sessionTemplates.advisorPolicy?.maxPerSession, 1),
      audience: str(sessionTemplates.advisorPolicy?.audience),
    },
    workbenchPolicy: {
      timeoutFallback: bool(sessionTemplates.workbenchPolicy?.timeoutFallback, false) ? "on" : "off",
    },
    audienceOptions: asArray<string>(sessionTemplates.audienceOptions).map((item) => str(item)).filter(Boolean),
    segmentFields: asArray<Record<string, unknown>>(sessionTemplates.segmentFields),
    scripts: asArray<SessionScriptView>(sessionTemplates.scripts).map(adaptScript),
    scriptAudience,
    replyTemplates: asArray<SessionReplyTemplateView>(sessionTemplates.replyTemplates).map(adaptReplyTemplate),
    transferTargets,
  };
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
    "I.support.advisorAssignments": JSON.stringify(data.advisorAssignments),
    "I.session.convos": JSON.stringify(data.conversations),
    "I.session.categories": JSON.stringify(data.categories),
    "I.session.scripts": JSON.stringify(data.scripts),
    "I.session.replyTemplates": JSON.stringify(data.replyTemplates),
    "I.session.transferTargets": JSON.stringify(data.transferTargets),
    "I.support.load.autoBalance": data.loadConfig.autoBalance ? "1" : "0",
    "I.support.load.defaultCap": String(data.loadConfig.defaultCap),
    "I.support.load.burstCap": String(data.loadConfig.burstCap),
    "I.support.load.warnPct": String(data.loadConfig.warnPct),
    "I.support.load.quietHourBalance": data.loadConfig.quietHourBalance ? "1" : "0",
    "I.support.load.overflowQueue": data.loadConfig.overflowQueue,
    "I.session.advisor.policy.enabled": data.advisorPolicy.enabled,
    "I.session.advisor.policy.delayMs": String(data.advisorPolicy.delayMs),
    "I.session.advisor.policy.cooldownHours": String(data.advisorPolicy.cooldownHours),
    "I.session.advisor.policy.maxPerSession": String(data.advisorPolicy.maxPerSession),
    "I.session.workbench.timeoutFallback": data.workbenchPolicy.timeoutFallback,
    "I.session.audienceOptions": JSON.stringify(data.audienceOptions),
    "I.session.segmentFields": JSON.stringify(data.segmentFields),
  };
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
  return agent?.adminId ?? 0;
}

export function agentIdForName(name: string, data?: MContentData | null) {
  const agent = data?.supportAgents.find((item) => item.name === name || item.id === name);
  if (agent) return agent.id;
  const fallback = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return fallback || "agent";
}

export const mContentActions = {
  updateLoadConfig(payload: MLoadConfigWrite, reason: string) {
    return apiRequest<Record<string, unknown>>("/tickets/load-config", {
      method: "PATCH",
      body: JSON.stringify(withReason(payload, reason)),
    });
  },
  rebalanceLoad(agents: Array<Record<string, unknown>>, reason: string) {
    return apiRequest<Record<string, unknown>>("/tickets/load-config/rebalance", {
      method: "POST",
      body: JSON.stringify(withReason({ agents }, reason)),
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
  }, reason: string) {
    return apiRequest<SupportTicketDetail>("/tickets", {
      method: "POST",
      body: JSON.stringify(withReason({ ...ticket, category: ticket.category.toUpperCase(), priority: toBackendTicketPriority(ticket.priority) }, reason)),
    });
  },
  replyTicket(ticketNo: string, body: string, reason: string) {
    return apiRequest<SupportTicketDetail>(`/tickets/${encodeURIComponent(ticketNo)}/replies`, {
      method: "POST",
      body: JSON.stringify(withReason({ body }, reason)),
    });
  },
  updateTicketStatus(ticketNo: string, statusValue: SupportTicketStatus, reason: string) {
    return apiRequest<SupportTicketDetail>(`/tickets/${encodeURIComponent(ticketNo)}/status`, {
      method: "PATCH",
      body: JSON.stringify(withReason({ status: toBackendTicketStatus(statusValue) }, reason)),
    });
  },
  updateTicketPriority(ticketNo: string, priority: SupportTicketPriority, reason: string) {
    return apiRequest<SupportTicketDetail>(`/tickets/${encodeURIComponent(ticketNo)}/priority`, {
      method: "PATCH",
      body: JSON.stringify(withReason({ priority: toBackendTicketPriority(priority) }, reason)),
    });
  },
  assignTicket(ticketNo: string, assignedAdminName: string, assignedAdminId: number, reason: string) {
    return apiRequest<SupportTicketDetail>(`/tickets/${encodeURIComponent(ticketNo)}/assignee`, {
      method: "PATCH",
      body: JSON.stringify(withReason({ assignedAdminId, assignedAdminName }, reason)),
    });
  },
  replyConversation(conversationNo: string, body: string, reason: string) {
    return apiRequest<ContentConversationView>(`/conversations/${encodeURIComponent(conversationNo)}/replies`, {
      method: "POST",
      body: JSON.stringify(withReason({ body }, reason)),
    });
  },
  updateConversationStatus(conversationNo: string, statusValue: SessionConvo["status"], reason: string) {
    return apiRequest<ContentConversationView>(`/conversations/${encodeURIComponent(conversationNo)}/status`, {
      method: "PATCH",
      body: JSON.stringify(withReason({ status: toBackendConversationStatus(statusValue) }, reason)),
    });
  },
  archiveConversation(conversationNo: string, archived: boolean, reason: string) {
    return apiRequest<ContentConversationView>(`/conversations/${encodeURIComponent(conversationNo)}/archive`, {
      method: "PATCH",
      body: JSON.stringify(withReason({ archived }, reason)),
    });
  },
  addCustomerTag(conversationNo: string, tag: string, reason: string) {
    return apiRequest<string[]>(`/conversations/${encodeURIComponent(conversationNo)}/customer-tags`, {
      method: "POST",
      body: JSON.stringify(withReason({ tag }, reason)),
    });
  },
  removeCustomerTag(conversationNo: string, tag: string, reason: string) {
    return apiRequest<string[]>(`/conversations/${encodeURIComponent(conversationNo)}/customer-tags`, {
      method: "DELETE",
      body: JSON.stringify(withReason({ tag }, reason)),
    });
  },
  addCustomerNote(conversationNo: string, text: string, reason: string) {
    return apiRequest<{ id?: string; ts?: number; author?: string; text?: string }>(`/conversations/${encodeURIComponent(conversationNo)}/customer-notes`, {
      method: "POST",
      body: JSON.stringify(withReason({ text }, reason)),
    });
  },
  removeCustomerNote(conversationNo: string, noteId: string, reason: string) {
    return apiRequest<unknown>(`/conversations/${encodeURIComponent(conversationNo)}/customer-notes/${encodeURIComponent(noteId)}`, {
      method: "DELETE",
      body: JSON.stringify(withReason({}, reason)),
    });
  },
  transferConversation(conversationNo: string, transfer: SessionConvo["transfer"], reason: string, targetIdOverride?: string) {
    const target = transfer?.to;
    const body =
      target?.kind === "agent"
        ? { targetType: "agent", targetId: targetIdOverride || agentIdForName(target.name), targetName: target.name }
        : target?.kind === "queue"
          ? { targetType: "queue", targetId: target.queue, targetName: target.queue }
          : { targetType: "standby", targetId: "standby-pool", targetName: "备勤池" };
    return apiRequest<ContentConversationView>(`/conversations/${encodeURIComponent(conversationNo)}/transfer`, {
      method: "POST",
      body: JSON.stringify(withReason(body, transfer?.reason || reason)),
    });
  },
  acceptTransfer(conversationNo: string, reason: string) {
    return apiRequest<ContentConversationView>(`/conversations/${encodeURIComponent(conversationNo)}/transfer/accept`, {
      method: "POST",
      body: JSON.stringify(withReason({}, reason)),
    });
  },
  returnTransfer(conversationNo: string, reason: string) {
    return apiRequest<ContentConversationView>(`/conversations/${encodeURIComponent(conversationNo)}/transfer/return`, {
      method: "POST",
      body: JSON.stringify(withReason({}, reason)),
    });
  },
  waitTransfer(conversationNo: string, reason: string) {
    return apiRequest<ContentConversationView>(`/conversations/${encodeURIComponent(conversationNo)}/transfer/wait`, {
      method: "POST",
      body: JSON.stringify(withReason({}, reason)),
    });
  },
  fallbackTransfer(conversationNo: string, reason: string) {
    return apiRequest<ContentConversationView>(`/conversations/${encodeURIComponent(conversationNo)}/transfer/fallback`, {
      method: "POST",
      body: JSON.stringify(withReason({}, reason)),
    });
  },
  initiateConversation(convo: {
    conversationType: SessionConvo["type"];
    userId?: number;
    ownerAgentId?: string;
    ownerAgentName: string;
    openingText: string;
  }, reason: string) {
    return apiRequest<ContentConversationView>("/conversations", {
      method: "POST",
      body: JSON.stringify(withReason({ ...convo, ownerAgentId: convo.ownerAgentId || agentIdForName(convo.ownerAgentName), conversationType: convo.conversationType.toUpperCase() }, reason)),
    });
  },
  convertConversationToTicket(conversationNo: string, ticket: {
    category: SupportTicketCategory;
    priority: SupportTicketPriority;
    title: string;
    assignedAdminId: number;
    assignedAdminName: string;
  }, reason: string) {
    return apiRequest<unknown>(`/conversations/${encodeURIComponent(conversationNo)}/ticket`, {
      method: "POST",
      body: JSON.stringify(withReason({ ...ticket, category: ticket.category.toUpperCase(), priority: toBackendTicketPriority(ticket.priority) }, reason)),
    });
  },
  updateSupportAgentProfile(adminId: number, profile: {
    serviceTypes?: MSupportServiceType[];
    tags?: string[];
    maxConcurrent?: number;
    enabled?: boolean;
    transferable?: boolean;
    busy?: boolean;
  }, reason: string) {
    return apiRequest<MSupportAgent>(`/support-agents/${encodeURIComponent(String(adminId))}/profile`, {
      method: "PATCH",
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
  }, reason: string) {
    return apiRequest<MSupportAgent>(`/support-agents/${encodeURIComponent(String(adminId))}/seat-assignment`, {
      method: "PATCH",
      body: JSON.stringify(withReason(seat, reason)),
    });
  },
  assignAdvisorUser(adminId: number, userId: number, reason: string) {
    return apiRequest<MAdvisorAssignment>(`/support-agents/${encodeURIComponent(String(adminId))}/assignments`, {
      method: "POST",
      body: JSON.stringify(withReason({ userId }, reason)),
    });
  },
  async assignAdvisorUsers(adminId: number, userIds: number[], reason: string) {
    const normalizedUserIds = Array.from(new Set(userIds
      .map((userId) => Number(userId))
      .filter((userId) => Number.isFinite(userId) && userId > 0)));
    const assignments: MAdvisorAssignment[] = [];
    for (const userId of normalizedUserIds) {
      assignments.push(await apiRequest<MAdvisorAssignment>(`/support-agents/${encodeURIComponent(String(adminId))}/assignments`, {
        method: "POST",
        body: JSON.stringify(withReason({ userId }, reason)),
      }));
    }
    return assignments;
  },
  deactivateAdvisorAssignment(adminId: number, assignmentId: number, reason: string) {
    return apiRequest<MAdvisorAssignment>(`/support-agents/${encodeURIComponent(String(adminId))}/assignments/${encodeURIComponent(String(assignmentId))}`, {
      method: "DELETE",
      body: JSON.stringify(withReason({}, reason)),
    });
  },
  createFaq(faq: Omit<SupportFaq, "id" | "updatedAt">, reason: string) {
    return apiRequest<SupportFaqView>("/knowledge/faqs", {
      method: "POST",
      body: JSON.stringify(withReason(faq, reason)),
    });
  },
  updateFaq(faq: SupportFaq, reason: string) {
    return apiRequest<SupportFaqView>(`/knowledge/faqs/${encodeURIComponent(faq.id)}`, {
      method: "PATCH",
      body: JSON.stringify(withReason(faq, reason)),
    });
  },
  updateFaqStatus(id: string, nextStatus: SupportFaq["status"], reason: string) {
    return apiRequest<SupportFaqView>(`/knowledge/faqs/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify(withReason({ status: nextStatus }, reason)),
    });
  },
  updateSla(row: SupportSla, reason: string) {
    return apiRequest<SupportSlaView>(`/knowledge/sla/${encodeURIComponent(row.category)}`, {
      method: "PATCH",
      body: JSON.stringify(withReason(row, reason)),
    });
  },
  updateCategory(type: SessionType, enabled: boolean, reason: string) {
    return apiRequest<SessionCategoryView>(`/session-templates/categories/${encodeURIComponent(type)}`, {
      method: "PATCH",
      body: JSON.stringify(withReason({ enabled }, reason)),
    });
  },
  updateAdvisorPolicy(field: string, value: string, reason: string) {
    return apiRequest<SessionAdvisorPolicyView>(`/session-templates/advisor-policy/${encodeURIComponent(field)}`, {
      method: "PATCH",
      body: JSON.stringify(withReason({ value }, reason)),
    });
  },
  updateWorkbenchPolicy(field: string, value: string, reason: string) {
    return apiRequest<SessionWorkbenchPolicyView>(`/session-templates/workbench-policy/${encodeURIComponent(field)}`, {
      method: "PATCH",
      body: JSON.stringify(withReason({ value }, reason)),
    });
  },
  createScript(script: { scriptGroup: AdvisorScript["group"]; text: string; ctaPath: string; audience: string; status: AdvisorScript["status"] }, reason: string) {
    return apiRequest<SessionScriptView>("/session-templates/scripts", {
      method: "POST",
      body: JSON.stringify(withReason(script, reason)),
    });
  },
  updateScriptStatus(scriptId: string, nextStatus: AdvisorScript["status"], reason: string) {
    return apiRequest<SessionScriptView>(`/session-templates/scripts/${encodeURIComponent(scriptId)}/status`, {
      method: "PATCH",
      body: JSON.stringify(withReason({ status: nextStatus }, reason)),
    });
  },
  updateScriptAudience(scriptId: string, audience: string, reason: string) {
    return apiRequest<SessionScriptView>(`/session-templates/scripts/${encodeURIComponent(scriptId)}/audience`, {
      method: "PATCH",
      body: JSON.stringify(withReason({ audience }, reason)),
    });
  },
  createReplyTemplate(template: { type: SessionReplyTpl["type"]; text: string; status: SessionReplyTpl["status"] }, reason: string) {
    return apiRequest<SessionReplyTemplateView>("/session-templates/reply-templates", {
      method: "POST",
      body: JSON.stringify(withReason(template, reason)),
    });
  },
  updateReplyTemplateStatus(templateId: string, nextStatus: SessionReplyTpl["status"], reason: string) {
    return apiRequest<SessionReplyTemplateView>(`/session-templates/reply-templates/${encodeURIComponent(templateId)}/status`, {
      method: "PATCH",
      body: JSON.stringify(withReason({ status: nextStatus }, reason)),
    });
  },
};
