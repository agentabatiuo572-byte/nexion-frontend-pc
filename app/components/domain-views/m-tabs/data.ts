// 客服中心域 M 数据。真写键前缀沿用 I.support.*/I.session.* 保 persist 兼容,与 nav 域 code M 解耦。从 i-tabs/data.ts 迁出。

/* ============ M2 Help/Support CMS + Ticket Desk(原 I8）============ */
export type SupportTicketStatus = "open" | "in_progress" | "pending_user" | "resolved" | "closed";
export type SupportTicketCategory =
  | "account"
  | "withdrawal"
  | "deposit"
  | "kyc"
  | "hardware"
  | "earnings"
  | "genesis"
  | "technical"
  | "other";
export type SupportTicketPriority = "low" | "normal" | "high" | "urgent";

export type SupportTicketMessage = {
  ts: number;
  author: "user" | "agent";
  agentName?: string;
  body: string;
};

export type SupportTicket = {
  id: string;
  subject: string;
  category: SupportTicketCategory;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  createdAt: number;
  updatedAt: number;
  lastReplyAt: number;
  unread: number;
  owner: string;
  messages: SupportTicketMessage[];
};

export type SupportFaq = {
  id: string;
  category: SupportTicketCategory | "general";
  question: string;
  answer: string;
  status: "published" | "draft";
  surface: "Help Center" | "Ticket Create" | "Nova";
  updatedAt: string;
};

export type SupportSla = {
  category: SupportTicketCategory;
  firstResponseMins: number;
  resolutionHours: number;
  queue: string;
  escalation: string;
};

export const SUPPORT_STATUS_LABEL: Record<SupportTicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  pending_user: "Awaiting user",
  resolved: "Resolved",
  closed: "Closed",
};

export const SUPPORT_CATEGORY_LABEL: Record<SupportTicketCategory | "general", string> = {
  general: "General",
  account: "Account",
  withdrawal: "Withdrawal",
  deposit: "Deposit",
  kyc: "KYC",
  hardware: "Hardware",
  earnings: "Earnings",
  genesis: "Genesis",
  technical: "Technical",
  other: "Other",
};

export const SUPPORT_PRIORITY_LABEL: Record<SupportTicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const SUPPORT_AGENTS = ["Marina K.", "Tomas R.", "Hiro T.", "Aisha O.", "Yuki H.", "Unassigned"] as const;

export const SUPPORT_FAQS: SupportFaq[] = [
  {
    id: "FAQ-001",
    category: "withdrawal",
    question: "Why is my withdrawal still pending?",
    answer: "Most pending withdrawals are waiting for payment desk review, network settlement, or KYC re-check. The ticket desk can attach a queue reference and ETA.",
    status: "published",
    surface: "Help Center",
    updatedAt: "2026-06-08",
  },
  {
    id: "FAQ-002",
    category: "kyc",
    question: "What should I do after a KYC rejection?",
    answer: "Re-upload a clear document image, keep the MRZ visible, and avoid cropped corners. Support can reset the Sumsub link when the retry window is exhausted.",
    status: "published",
    surface: "Ticket Create",
    updatedAt: "2026-06-05",
  },
  {
    id: "FAQ-003",
    category: "hardware",
    question: "How do I recover a disconnected NexionBox?",
    answer: "Hold power for 10 seconds, re-pair the device in the app, then attach the LED pattern to a hardware support ticket if it stays offline.",
    status: "published",
    surface: "Nova",
    updatedAt: "2026-06-01",
  },
];

export const SUPPORT_SLA: SupportSla[] = [
  { category: "withdrawal", firstResponseMins: 15, resolutionHours: 12, queue: "Payment desk", escalation: "D2 withdrawal review" },
  { category: "kyc", firstResponseMins: 30, resolutionHours: 24, queue: "Compliance desk", escalation: "C4 KYC ledger" },
  { category: "hardware", firstResponseMins: 45, resolutionHours: 48, queue: "Device ops", escalation: "E5 device ops" },
  { category: "genesis", firstResponseMins: 20, resolutionHours: 18, queue: "Genesis desk", escalation: "G4 Genesis economy" },
  { category: "account", firstResponseMins: 30, resolutionHours: 24, queue: "Account desk", escalation: "C5 security" },
  { category: "technical", firstResponseMins: 60, resolutionHours: 72, queue: "Technical desk", escalation: "A3 system config" },
];

export const SUPPORT_REPLY_TEMPLATES = [
  "已确认工单信息,我会先核对后台状态并在本线程同步处理进度。",
  "支付台账已核对,当前卡在链上确认队列;我会保留人工复核并继续跟进。",
  "请补充截图、设备 LED pattern 或交易 hash,这样我们能把工单转给对应队列。",
  "问题已处理并关闭;如果状态未更新,回复本工单会自动重新打开。",
];

const SUPPORT_T0 = Date.UTC(2026, 5, 12, 8, 0, 0);
const HOUR = 3_600_000;
const DAY = 86_400_000;

export const SUPPORT_TICKETS: SupportTicket[] = [
  {
    id: "TK-1024",
    subject: "Withdrawal pending more than 24 hours",
    category: "withdrawal",
    status: "open",
    priority: "high",
    createdAt: SUPPORT_T0 - 1.5 * DAY,
    updatedAt: SUPPORT_T0 - 4 * HOUR,
    lastReplyAt: SUPPORT_T0 - 4 * HOUR,
    unread: 2,
    owner: "Marina K.",
    messages: [
      { ts: SUPPORT_T0 - 1.5 * DAY, author: "user", body: "Hi, I requested a $250 USDT withdrawal yesterday at 14:20 UTC and it is still showing pending. Tx hash should be 0xab12..." },
      { ts: SUPPORT_T0 - 1.4 * DAY, author: "agent", agentName: "Marina K.", body: "I have escalated this to our payment desk. Reference #PD-7723." },
      { ts: SUPPORT_T0 - 6 * HOUR, author: "agent", agentName: "Marina K.", body: "Payment desk found a TRC20 network congestion delay. ETA 8-12h." },
      { ts: SUPPORT_T0 - 4 * HOUR, author: "agent", agentName: "Marina K.", body: "Quick check: has the USDT arrived yet? If not we can issue a manual replay." },
    ],
  },
  {
    id: "TK-1023",
    subject: "KYC documents rejected - what is wrong?",
    category: "kyc",
    status: "pending_user",
    priority: "normal",
    createdAt: SUPPORT_T0 - 2 * DAY,
    updatedAt: SUPPORT_T0 - 9 * HOUR,
    lastReplyAt: SUPPORT_T0 - 9 * HOUR,
    unread: 1,
    owner: "Tomas R.",
    messages: [
      { ts: SUPPORT_T0 - 2 * DAY, author: "user", body: "Just got KYC rejected but no reason was shown. My passport is valid through 2031." },
      { ts: SUPPORT_T0 - 9 * HOUR, author: "agent", agentName: "Tomas R.", body: "The rejection reason was blurry photo, MRZ unreadable. Please re-upload with better lighting." },
    ],
  },
  {
    id: "TK-1019",
    subject: "NexionBox Pro disconnected after firmware v3.4",
    category: "hardware",
    status: "in_progress",
    priority: "high",
    createdAt: SUPPORT_T0 - 3 * DAY,
    updatedAt: SUPPORT_T0 - 1 * DAY,
    lastReplyAt: SUPPORT_T0 - 1 * DAY,
    unread: 0,
    owner: "Hiro T.",
    messages: [
      { ts: SUPPORT_T0 - 3 * DAY, author: "user", body: "After the v3.4 firmware push my NexionBox Pro went offline and will not reconnect." },
      { ts: SUPPORT_T0 - 2.9 * DAY, author: "agent", agentName: "Hiro T.", body: "Amber-amber-red means WiFi auth failure after update. Hold power for 10s, then re-pair via app." },
      { ts: SUPPORT_T0 - 2 * DAY, author: "user", body: "Reset worked but it is only earning 60% of normal rate now." },
      { ts: SUPPORT_T0 - 1 * DAY, author: "agent", agentName: "Hiro T.", body: "Detected thermal throttle. We are shipping a free cleaning kit; ETA 4d." },
    ],
  },
  {
    id: "TK-1011",
    subject: "Cannot login from my new phone",
    category: "account",
    status: "resolved",
    priority: "normal",
    createdAt: SUPPORT_T0 - 7 * DAY,
    updatedAt: SUPPORT_T0 - 5 * DAY,
    lastReplyAt: SUPPORT_T0 - 5 * DAY,
    unread: 0,
    owner: "Aisha O.",
    messages: [
      { ts: SUPPORT_T0 - 7 * DAY, author: "user", body: "Got a new phone, cannot login because 2FA codes do not match." },
      { ts: SUPPORT_T0 - 6.9 * DAY, author: "agent", agentName: "Aisha O.", body: "Phone changes invalidate the old TOTP secret. I started recovery; check your email for video verification." },
      { ts: SUPPORT_T0 - 5 * DAY, author: "user", body: "All good, recovered. Thanks!" },
    ],
  },
  {
    id: "TK-1007",
    subject: "Genesis Node #4192 not received",
    category: "genesis",
    status: "closed",
    priority: "urgent",
    createdAt: SUPPORT_T0 - 12 * DAY,
    updatedAt: SUPPORT_T0 - 10 * DAY,
    lastReplyAt: SUPPORT_T0 - 10 * DAY,
    unread: 0,
    owner: "Marina K.",
    messages: [
      { ts: SUPPORT_T0 - 12 * DAY, author: "user", body: "Purchased Genesis Node #4192 two days ago, tx confirmed but NFT not in wallet." },
      { ts: SUPPORT_T0 - 11.9 * DAY, author: "agent", agentName: "Marina K.", body: "Confirmed your purchase. Mint queue had a backlog; yours is bumped to priority." },
      { ts: SUPPORT_T0 - 10 * DAY, author: "user", body: "Received, all good." },
    ],
  },
];

/* ============ M3/M5 会话中心运营(原 I9）============
 * 对齐前端 UniApp 即时会话中心(Nexion-uniapp/src/mock/conversations.ts):
 *   ConversationType = advisor | support | ai;Conversation{id,type,agentName,roleKey,messages,unread,lastTs}。
 * 后台补齐 owner/status 为运营可控字段(字段镜像门:admin 字段 ⊇ 前端展示字段)。
 * ai(Nova)类别的推送/模板归 I2,不在坐席台;坐席台只接 advisor/support。 */
export const I9_STATS = {
  liveSessions: 2,   // advisor + support 进行中
  pendingReplies: 1, // 待坐席回复(user 末发言)
  catEnabled: 3,     // 启用类别数
  advisorScripts: 3, // 顾问话术条数
};

export type SessionType = "advisor" | "support" | "ai";

export type SessionCategory = {
  type: SessionType;
  name: string;      // 展示名
  roleKey: string;   // 角色副标题 i18n key(镜像前端 conversations.role*)
  enabled: boolean;  // 默认启用(实时态 pget I.session.cat.<type>.enabled 覆盖)
  managedBy: string; // 谁接待
};
export const SESSION_CATEGORIES: SessionCategory[] = [
  { type: "advisor", name: "专属顾问", roleKey: "conversations.roleAdvisor", enabled: true, managedBy: "增长 / 客服坐席" },
  { type: "support", name: "普通客服", roleKey: "conversations.roleSupport", enabled: true, managedBy: "客服坐席" },
  { type: "ai", name: "Nova AI 顾问", roleKey: "conversations.roleAi", enabled: true, managedBy: "Nova 自动(配置见 I2)" },
];

// 顾问主动话术(AutoPushPolicy 驱动;CTA 镜像前端 advisor seed)
export type AdvisorScript = {
  id: string;
  group: "开场" | "升级" | "锁仓" | "复投";
  text: string;
  ctaHref: string;
  status: "published" | "draft";
};
export const ADVISOR_SCRIPTS: AdvisorScript[] = [
  { id: "AS-001", group: "开场", text: "你好,我是你的专属顾问 {name} 👋 有明显的机会第一时间提醒你。", ctaHref: "—", status: "published" },
  { id: "AS-002", group: "升级", text: "你的设备这几天闲置了约 30%,升级到 NexionBox Pro,同样插着能多赚不少。", ctaHref: "/store", status: "published" },
  { id: "AS-003", group: "锁仓", text: "180 天锁仓今天 95% 年化,仅限今天。现在哪怕锁一部分,复利也跑得很快。", ctaHref: "/staking", status: "published" },
];

// 顾问主动推送策略默认值(nexion-design 4 参;实时态 pget I.session.advisor.policy.<field> 覆盖)
export const ADVISOR_POLICY = { enabled: "on", delayMs: 1500, cooldownHours: 24, maxPerSession: 1 } as const;

// 即时回复模板(advisor/support;镜像前端 advisorReply/supportReply)
export type SessionReplyTpl = { id: string; type: "advisor" | "support"; text: string; status: "published" | "draft" };
export const SESSION_REPLY_TEMPLATES: SessionReplyTpl[] = [
  { id: "RT-A1", type: "advisor", text: "好嘞 — 我挑几个适合你当前配置的方案给你。", status: "published" },
  { id: "RT-A2", type: "advisor", text: "按你的算力,升一档回本很快。今天的价格我可以帮你先留住。", status: "published" },
  { id: "RT-S1", type: "support", text: "好的 — 我先调出你的账户,稍等一下。", status: "published" },
  { id: "RT-S2", type: "support", text: "收到。方便发一下订单号或交易 ID 吗?我好查具体情况。", status: "published" },
];

// 坐席会话(字段镜像前端 Conversation/ConvMessage + 后台 owner/status)
export type SessionStatus = "open" | "resolved" | "closed";
export type SessionMsg = { ts: number; sender: "user" | "agent"; agentName?: string; text: string; ctaHref?: string };
export type SessionConvo = {
  id: string;          // 镜像前端 Conversation.id
  type: "advisor" | "support";
  agentName: string;   // 镜像前端 agentName
  roleKey: string;     // 镜像前端 roleKey
  unread: number;      // 镜像前端 unread
  lastTs: number;      // 镜像前端 lastTs
  status: SessionStatus; // 后台坐席态
  owner: string;       // 后台分配坐席
  messages: SessionMsg[]; // 镜像前端 messages{sender,text,ctaHref,ts}
};

const SESS_T0 = Date.UTC(2026, 5, 14, 8, 0, 0);
export const SESSION_AGENTS = ["Mia", "Sarah K.", "Tomas R.", "Hiro T.", "Unassigned"] as const;
export const SESSION_CONVOS: SessionConvo[] = [
  {
    id: "cv-advisor-1", type: "advisor", agentName: "Mia", roleKey: "conversations.roleAdvisor",
    unread: 2, lastTs: SESS_T0 - 12 * 60_000, status: "open", owner: "Mia",
    messages: [
      { ts: SESS_T0 - 3 * HOUR, sender: "agent", agentName: "Mia", text: "你好,我是你的专属顾问 Mia 👋 有明显的机会第一时间提醒你。" },
      { ts: SESS_T0 - 40 * 60_000, sender: "agent", agentName: "Mia", text: "你的设备这几天闲置了约 30%,升级到 NexionBox Pro,同样插着能多赚不少。", ctaHref: "/store" },
      { ts: SESS_T0 - 12 * 60_000, sender: "agent", agentName: "Mia", text: "180 天锁仓今天 95% 年化,仅限今天。", ctaHref: "/staking" },
    ],
  },
  {
    id: "cv-support-1", type: "support", agentName: "Sarah K.", roleKey: "conversations.roleSupport",
    unread: 1, lastTs: SESS_T0 - 30 * 60_000, status: "open", owner: "Unassigned",
    messages: [
      { ts: SESS_T0 - 2 * HOUR, sender: "user", text: "你好,我的提现显示「待处理」超过一天了 — 能帮我查下状态吗?" },
    ],
  },
  {
    id: "cv-support-2", type: "support", agentName: "Tomas R.", roleKey: "conversations.roleSupport",
    unread: 0, lastTs: SESS_T0 - 5 * HOUR, status: "resolved", owner: "Tomas R.",
    messages: [
      { ts: SESS_T0 - 6 * HOUR, sender: "user", text: "KYC 一直没过,能看下原因吗?" },
      { ts: SESS_T0 - 5 * HOUR, sender: "agent", agentName: "Tomas R.", text: "已核对,证件照模糊导致;重新上传清晰照即可,我已重置重试次数。" },
    ],
  },
];
