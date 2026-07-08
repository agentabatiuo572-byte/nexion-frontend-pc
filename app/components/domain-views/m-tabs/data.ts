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
  { category: "withdrawal", firstResponseMins: 15, resolutionHours: 12, queue: "支付台", escalation: "D2 withdrawal review" },
  { category: "kyc", firstResponseMins: 30, resolutionHours: 24, queue: "合规台", escalation: "C4 KYC ledger" },
  { category: "hardware", firstResponseMins: 45, resolutionHours: 48, queue: "设备运维台", escalation: "E5 device ops" },
  { category: "genesis", firstResponseMins: 20, resolutionHours: 18, queue: "创世节点台", escalation: "G4 Genesis economy" },
  { category: "account", firstResponseMins: 30, resolutionHours: 24, queue: "账户台", escalation: "C5 security" },
  { category: "technical", firstResponseMins: 60, resolutionHours: 72, queue: "技术支持台", escalation: "A3 system config" },
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
 * ai(Nova)类别的推送/模板归 I2,不在坐席台;坐席台只接 advisor/support。
 * (原 I9_STATS 静态常量已删:M1 客服总览改为从 I.support.* / I.session.* 实时派生,不再持第二份硬编码统计。) */

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
  { id: "AS-002", group: "升级", text: "你的设备近期有不少时段闲置,升级到 NexionBox Pro,同样插着能明显多赚。", ctaHref: "/store", status: "published" },
  { id: "AS-003", group: "锁仓", text: "180 天锁仓有更优的收益档位,适合短期不动用的余额。哪怕先锁一部分,复利也跑得快。", ctaHref: "/staking", status: "published" },
  { id: "AS-004", group: "复投", text: "你这个月的收益到账了,要不要我帮你把一部分复投进去,利滚利会更快一些?", ctaHref: "/staking", status: "published" },
  { id: "AS-005", group: "开场", text: "好久没见你上线啦,最近设备运行还顺利吗?有任何问题我都在。", ctaHref: "—", status: "published" },
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
  { id: "RT-S3", type: "support", text: "这笔提现在风控复核队列里,通常数小时内完成,我帮你催一下进度。", status: "published" },
  { id: "RT-S4", type: "support", text: "实名没通过一般是证件照模糊;麻烦在光线好的地方重拍正反面再上传。", status: "published" },
  { id: "RT-S5", type: "support", text: "设备掉线先长按电源 10 秒重启、在 App 里重新配网;还不行我帮你登记换货。", status: "published" },
];

// 坐席可向会话推送的商品卡(顾问对客呈现;副标只写定性卖点,不写年化/收益数字,守铁律)
export type PushSku = { id: string; title: string; subtitle: string; to: string };
export const PUSH_SKUS: PushSku[] = [
  { id: "SKU-PRO", title: "NexionBox Pro 升级", subtitle: "算力更高 · 设备闲置时也多赚", to: "/store" },
  { id: "SKU-LOCK", title: "180 天锁仓 · 稳收计划", subtitle: "更优收益档位 · 适合短期不动用的余额", to: "/staking" },
  { id: "SKU-GEN", title: "创世节点", subtitle: "稀缺权益 · 长期排放", to: "/genesis" },
];

/* ============ 主动发起会话(融合:设计稿身份+撰写+预览 ⊕ v3 单人/固定档/自定义圈选)============ */
// 一个后台客服账号可挂的客服 / 顾问身份;发起会话时择一对客呈现。
export type InitiateIdentity = { id: string; name: string; type: "support" | "advisor"; label: string };
export const INITIATE_IDENTITIES: InitiateIdentity[] = [
  { id: "ID-7741", name: "Marina K.", type: "support", label: "普通客服" },
  { id: "ID-7742", name: "Mia", type: "advisor", label: "专属顾问" },
  { id: "ID-7758", name: "Aria", type: "advisor", label: "专属顾问" },
];
// 受众固定档(快选)
export const AUDIENCE_PRESETS = ["全量", "设备闲置户", "持币 ≥ 30 天", "新注册 7 日内", "高价值客户"] as const;
// 自定义圈选字段 × 运算符 × 值,多条件「且」组合(从 v3 builder 落地)。
export type SegField = { id: string; label: string; ops: string[]; vals?: string[]; unit?: string };
export const SEG_FIELDS: SegField[] = [
  { id: "vrank", label: "V 等级", ops: ["≥", "≤", "="], vals: ["V0", "V1", "V2", "V3", "V4", "V5"] },
  { id: "balance", label: "账户余额", ops: ["≥", "≤"], unit: "USDT" },
  { id: "withdraw30", label: "近30天提现额", ops: ["≥", "≤"], unit: "USDT" },
  { id: "holdings", label: "持仓节点数", ops: ["≥", "≤", "="] },
  { id: "regdays", label: "注册天数", ops: ["≤", "≥"], unit: "天" },
  { id: "jurisdiction", label: "司法辖区", ops: ["="], vals: ["越南", "印尼", "泰国"] },
  { id: "kyc", label: "KYC 状态", ops: ["="], vals: ["已通过", "待补充", "未提交"] },
  { id: "device", label: "持有设备", ops: ["="], vals: ["NexionBox Air", "NexionBox Pro", "创世节点", "未购机"] },
];
export type SegCond = { field: string; op: string; value: string };

// 坐席会话(字段镜像前端 Conversation/ConvMessage + 后台 owner/status)
export type SessionStatus = "open" | "resolved" | "closed";
/** 坐席消息回执:sent=已送达用户未读,read=用户已读(仅 sender==="agent" 有意义;镜像前端 ConvMessageStatus) */
export type SessionMsgStatus = "sent" | "read";
export type SessionMsg = { ts: number; sender: "user" | "agent"; agentName?: string; status?: SessionMsgStatus; text: string; ctaHref?: string };

// 用户短回执池(坐席回复后模拟用户已读→输入中→回执到达的会话闭环;按会话消息数轮询取用)
export const USER_ACK_POOL: string[] = [
  "好的,谢谢!",
  "明白了,我试一下。",
  "收到,麻烦你了 🙏",
  "OK,那我等通知。",
];

/* 完整客户档案(设计稿 CustomerProfile 合并）—— 坐席接待时一眼看清价值 / 风险。只读快照,
 * 客户侧真实账户操作回 C/D 域;此处的备注 notes 是客服侧留档(随 convo 写入 I.session.convos 持久)。 */
export type CustomerNote = { id: string; ts: number; author: string; text: string };
export type CustomerLedgerEntry = { label: string; when: string; amount: string; up?: boolean; pending?: boolean };
export type CustomerProfile = {
  uid: string;
  nickname: string;
  phone: string;
  vlevel: string;        // V 等级
  kyc: string;           // KYC 状态
  tags: string[];
  risk: "低" | "中" | "高";
  riskNote: string;
  recharge: string;      // 累计充值
  withdraw: string;      // 累计提现
  balance: string;       // 当前余额
  tickets: number;       // 关联工单
  device: string;
  hashrate: string;
  idle?: string;
  region: string;
  joined: string;        // 账龄
  lastActive: string;
  ledger: CustomerLedgerEntry[];
  notes?: CustomerNote[];
};

/* ============ 跨坐席转交(转入待处理)============
 * 坐席 A 在会话中发起转交 → 选目标(指定坐席 / 技能队列 / 备勤池)+ 填转交原因 → 会话进「转入待处理」。
 * 属例行内部交接:用 I.session.convos 例行直写 + 系统消息留档,**不弹操作确认(MC)、不调 logAudit(高敏 A2)**。
 * 目标坐席 B 工作台从「转入待处理」筛选档看到,三选一处置:接收接入 / 等待处理 / 手动退回(注明原因)。
 * 超时回落备勤池为工作台可选策略(I.session.workbench.timeoutFallback):开则超时未接入自动回落备勤池重分配,关则一直等待。 */
export type TransferTarget =
  | { kind: "agent"; name: string }   // 指定坐席 B
  | { kind: "queue"; queue: string }  // 技能队列(派生 SUPPORT_SLA.queue)
  | { kind: "standby" };              // 备勤池
export type SessionTransfer = {
  from: string;        // 来源坐席 A
  to: TransferTarget;  // 转交目标
  reason: string;      // 转交原因(留档进会话系统消息,不入 A2)
  ts: number;          // 转交时刻(用于「转入待处理」超时判定)
  fellBack?: boolean;  // 已超时回落备勤池(防重复回落)
};
// 技能队列单源:派生 SUPPORT_SLA.queue(去重),不另造常量。
export const TRANSFER_QUEUES: string[] = Array.from(new Set(SUPPORT_SLA.map((s) => s.queue)));
export const STANDBY_POOL_LABEL = "备勤池";
// 转入待处理超时阈值(分钟):超过视为超时;工作台开「超时回落备勤池」则自动回落,否则持续等待。
export const TRANSFER_TIMEOUT_MINS = 30;
export function transferTargetLabel(t: TransferTarget): string {
  return t.kind === "agent" ? t.name : t.kind === "queue" ? t.queue : STANDBY_POOL_LABEL;
}

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
  customer?: string;   // 接待的终端用户昵称(对话主角;agentName 为坐席)
  profile?: CustomerProfile; // 完整客户档案(只读快照 + 客服备注)
  archived?: boolean;  // 归档态(已解决会话可单条 / 批量归档,默认 false)
  origin?: "user" | "support" | "advisor"; // 发起来源:用户咨询 / 客服主动 / 顾问主动(旧 persist 缺则按 user 兜底)
  batchInfo?: { audienceDesc: string; identity: string; script: string }; // 人群群发会话上下文(无单一客户档案,右栏显批次信息)
  transfer?: SessionTransfer; // 跨坐席转交态;存在即「转入待处理」(挂目标坐席 B/队列/备勤池,待接收/退回)
};

/* 客户档案库 —— 镜像 C1 真实用户(uid/昵称/VIP/KYC/充提余额 与 lib/mock/admin/users.ts 同源),
 * 这样「查看完整客户档案」跳 /users/search/{uid} 能加载该用户的真实 360 页。主动发起单用户从此选取。
 * 副标只定性,不写自曝收益率。 */
export const CUSTOMER_DIRECTORY: CustomerProfile[] = [
  {
    uid: "U-88421", nickname: "minerJoe", phone: "+84 ··· 7741", vlevel: "V3", kyc: "已认证",
    tags: ["高潜复投", "设备闲置"], risk: "低", riskNote: "充提对称,账户行为稳定,无异常登录;近 30 天活跃,适合主动升级触达。",
    recharge: "12,400", withdraw: "6,200", balance: "4,820", tickets: 1,
    device: "2 台 NexionBox Air", hashrate: "6.4 TH/s", idle: "近 7 天约三成时段闲置",
    region: "越南 · 胡志明市", joined: "注册 96 天", lastActive: "今日活跃",
    ledger: [
      { label: "算力日结收益", when: "今天 08:00", amount: "+18.4", up: true },
      { label: "充值 USDT", when: "3 天前", amount: "+500", up: true },
      { label: "提现 USDT", when: "6 天前", amount: "-300" },
    ],
    notes: [],
  },
  {
    uid: "U-90233", nickname: "stella_w", phone: "+60 ··· 2074", vlevel: "V6", kyc: "已认证",
    tags: ["高价值", "大额波动"], risk: "中", riskNote: "余额与团队规模大;近 7 日提现波动偏高,大额操作建议复核台账后处理。",
    recharge: "42,000", withdraw: "9,800", balance: "18,640", tickets: 1,
    device: "4 台 NexionBox Pro", hashrate: "24 TH/s",
    region: "马来西亚 · 吉隆坡", joined: "注册 109 天", lastActive: "12 分钟前",
    ledger: [
      { label: "算力日结收益", when: "今天 08:00", amount: "+96.0", up: true },
      { label: "提现 USDT", when: "昨天 09:02", amount: "-3,000" },
      { label: "充值 USDT", when: "4 天前", amount: "+8,000", up: true },
    ],
    notes: [],
  },
  {
    uid: "U-39922", nickname: "fastCash99", phone: "+84 ··· 8830", vlevel: "V1", kyc: "复审中",
    tags: ["套现模式", "多账户关联", "新账户大额"], risk: "高", riskNote: "K1 反多账户命中、设备指纹与他人重叠;提现已冻结转合规核查,客服侧只解释不放行。",
    recharge: "48,000", withdraw: "0", balance: "47,200", tickets: 2,
    device: "1 台 NexionBox Pro", hashrate: "6 TH/s",
    region: "越南 · 河内", joined: "注册 21 天", lastActive: "30 分钟前",
    ledger: [
      { label: "提现 USDT", when: "今天 09:40", amount: "-2,000", pending: true },
      { label: "充值 USDT", when: "5 天前", amount: "+20,000", up: true },
    ],
    notes: [],
  },
  {
    uid: "U-66120", nickname: "newbie_8821", phone: "+62 ··· 4471", vlevel: "V0", kyc: "复审中",
    tags: ["新账户大额", "KYC 待补"], risk: "高", riskNote: "新注册即大额入金、7 天内首提;KYC 资料待补充,需引导完成实名后再处理提现。",
    recharge: "9,600", withdraw: "0", balance: "9,600", tickets: 1,
    device: "1 台 NexionBox Air", hashrate: "3.2 TH/s",
    region: "印尼 · 雅加达", joined: "注册 17 天", lastActive: "1 小时前",
    ledger: [{ label: "充值 USDT", when: "5 天前", amount: "+9,600", up: true }],
    notes: [],
  },
  {
    uid: "U-77810", nickname: "cryptoLily", phone: "+62 ··· 7755", vlevel: "V0", kyc: "已认证",
    tags: ["新户", "小额"], risk: "低", riskNote: "KYC 已通过,小额体验用户,暂无异常。",
    recharge: "1,200", withdraw: "600", balance: "320", tickets: 0,
    device: "1 台 NexionBox Air", hashrate: "3.2 TH/s",
    region: "印尼 · 泗水", joined: "注册 59 天", lastActive: "今日活跃",
    ledger: [
      { label: "算力日结收益", when: "今天 08:00", amount: "+3.1", up: true },
      { label: "提现 USDT", when: "8 天前", amount: "-200" },
    ],
    notes: [],
  },
  {
    uid: "U-43391", nickname: "quietRiver", phone: "+66 ··· 5026", vlevel: "V4", kyc: "已认证",
    tags: ["大额提现", "风控关注"], risk: "中", riskNote: "团队规模较大、近期有大额提现;提现咨询需核对支付台账后再答复。",
    recharge: "31,000", withdraw: "4,200", balance: "26,800", tickets: 1,
    device: "2 台 NexionBox Pro", hashrate: "12 TH/s", idle: "近 7 天约两成时段闲置",
    region: "泰国 · 曼谷", joined: "注册 106 天", lastActive: "3 小时前",
    ledger: [
      { label: "算力日结收益", when: "今天 08:00", amount: "+34.0", up: true },
      { label: "提现 USDT", when: "2 天前", amount: "-1,500" },
      { label: "充值 USDT", when: "9 天前", amount: "+5,000", up: true },
    ],
    notes: [],
  },
];

const SESS_T0 = Date.UTC(2026, 5, 14, 8, 0, 0);
export const SESSION_AGENTS = ["Mia", "Sarah K.", "Tomas R.", "Hiro T.", "Unassigned"] as const;
export const SESSION_CONVOS: SessionConvo[] = [
  {
    id: "cv-advisor-1", type: "advisor", agentName: "Mia", roleKey: "conversations.roleAdvisor",
    unread: 2, lastTs: SESS_T0 - 12 * 60_000, status: "open", owner: "Mia", origin: "advisor",
    customer: CUSTOMER_DIRECTORY[0].nickname,
    profile: CUSTOMER_DIRECTORY[0],
    messages: [
      // 回执镜像前端 seed:用户读过欢迎语,最近两条主动触达还未读(前端侧 unread=2 同源)
      { ts: SESS_T0 - 3 * HOUR, sender: "agent", agentName: "Mia", status: "read", text: "你好,我是你的专属顾问 Mia 👋 有明显的机会第一时间提醒你。" },
      { ts: SESS_T0 - 40 * 60_000, sender: "agent", agentName: "Mia", status: "sent", text: "你的设备近期有不少时段闲置,升级到 NexionBox Pro,同样插着能明显多赚。", ctaHref: "/store" },
      { ts: SESS_T0 - 12 * 60_000, sender: "agent", agentName: "Mia", status: "sent", text: "180 天锁仓有更优的收益档位,适合短期不动用的余额,要不要我帮你看下额度?", ctaHref: "/staking" },
    ],
  },
  {
    id: "cv-support-1", type: "support", agentName: "Sarah K.", roleKey: "conversations.roleSupport",
    unread: 1, lastTs: SESS_T0 - 30 * 60_000, status: "open", owner: "Unassigned", origin: "user",
    customer: CUSTOMER_DIRECTORY[2].nickname,
    profile: CUSTOMER_DIRECTORY[2],
    messages: [
      { ts: SESS_T0 - 2 * HOUR, sender: "user", text: "你好,我的提现显示「待处理」超过一天了 — 能帮我查下状态吗?" },
    ],
  },
  {
    id: "cv-support-2", type: "support", agentName: "Tomas R.", roleKey: "conversations.roleSupport",
    unread: 0, lastTs: SESS_T0 - 5 * HOUR, status: "resolved", owner: "Tomas R.", origin: "user",
    customer: CUSTOMER_DIRECTORY[4].nickname,
    profile: CUSTOMER_DIRECTORY[4],
    messages: [
      { ts: SESS_T0 - 6 * HOUR, sender: "user", text: "KYC 一直没过,能看下原因吗?" },
      { ts: SESS_T0 - 5 * HOUR, sender: "agent", agentName: "Tomas R.", status: "read", text: "已核对,证件照模糊导致;重新上传清晰照即可,我已重置重试次数。" },
    ],
  },
  {
    id: "cv-support-3", type: "support", agentName: "Aisha O.", roleKey: "conversations.roleSupport",
    unread: 0, lastTs: SESS_T0 - 45 * 60_000, status: "open", owner: "Aisha O.", origin: "support",
    customer: CUSTOMER_DIRECTORY[5].nickname,
    profile: CUSTOMER_DIRECTORY[5],
    messages: [
      { ts: SESS_T0 - 50 * 60_000, sender: "agent", agentName: "系统", text: "由「普通客服 · Aisha O.」主动发起 · 目标:提现频繁用户主动关怀" },
      { ts: SESS_T0 - 45 * 60_000, sender: "agent", agentName: "Aisha O.", status: "sent", text: "您好,注意到您近期提现较频繁;若对提现进度或台账有任何疑问,我可以帮您逐笔核对。" },
    ],
  },
  {
    // 转入待处理种子:Sarah K. 已把此会话转交给 Tomas R.(合规),演示 B 侧 接收/等待/退回 三动作。
    id: "cv-transfer-1", type: "support", agentName: "Tomas R.", roleKey: "conversations.roleSupport",
    unread: 1, lastTs: SESS_T0 - 38 * 60_000, status: "open", owner: "Tomas R.", origin: "user",
    customer: CUSTOMER_DIRECTORY[3].nickname,
    profile: CUSTOMER_DIRECTORY[3],
    transfer: {
      from: "Sarah K.",
      to: { kind: "agent", name: "Tomas R." },
      reason: "新户首充大额＋KYC 待补,涉及实名与风控复核,转给合规客服跟进更对口。",
      ts: SESS_T0 - 38 * 60_000,
    },
    messages: [
      { ts: SESS_T0 - 70 * 60_000, sender: "user", text: "我刚充值了一笔大额,想提一部分出来,但提现一直没动静,是怎么回事?" },
      { ts: SESS_T0 - 52 * 60_000, sender: "agent", agentName: "Sarah K.", status: "read", text: "我先帮你看下账户状态。你的实名资料还差一项待补充,这块我转给更专业的合规同事帮你跟进。" },
      { ts: SESS_T0 - 38 * 60_000, sender: "agent", agentName: "系统", text: "Sarah K. 转交给 Tomas R. · 原因:新户首充大额＋KYC 待补,涉及实名与风控复核,转给合规客服跟进更对口。" },
    ],
  },
];

/* ============ 坐席名册 + 负载调度(设计稿 M1 坐席负载调度 合并）============
 * 名册 = SUPPORT_AGENTS ∪ SESSION_AGENTS 去 Unassigned;每人带 role 副标 + 默认接派单上限 defaultCap。
 * 实时态覆盖键(pget,与 M1/LoadConfig 同源):
 *   I.support.agent.<name>.cap   = 该坐席接派单上限(数字字符串)
 *   I.support.agent.<name>.busy  = "1" 暂停接派单 / 其它=正常
 *   I.support.load.<field>       = 全局负载策略(见 LOAD_CONFIG_DEFAULT)
 * 负载利用率 util% = (open 工单 + open 会话) / cap;非真实 presence。 */
export type AgentMeta = { name: string; role: string; defaultCap: number };
export const AGENT_ROSTER: AgentMeta[] = [
  { name: "Marina K.", role: "资金客服 lead", defaultCap: 12 },
  { name: "Tomas R.", role: "实名 / 合规客服", defaultCap: 10 },
  { name: "Hiro T.", role: "硬件支持", defaultCap: 10 },
  { name: "Aisha O.", role: "通用客服", defaultCap: 10 },
  { name: "Yuki H.", role: "技术支持", defaultCap: 8 },
  { name: "Mia", role: "专属顾问", defaultCap: 8 },
  { name: "Sarah K.", role: "通用客服", defaultCap: 10 },
];

export type LoadConfig = {
  autoBalance: boolean;
  defaultCap: number;
  burstCap: number;
  warnPct: number;
  quietHourBalance: boolean;
  overflowQueue: string;
};
export const LOAD_CONFIG_DEFAULT: LoadConfig = {
  autoBalance: true,
  defaultCap: 10,
  burstCap: 14,
  warnPct: 80,
  quietHourBalance: false,
  overflowQueue: "转人工备勤队列",
};
export const LOAD_FIELD_LABEL: Record<keyof LoadConfig, string> = {
  autoBalance: "自动平衡负载",
  defaultCap: "默认负载上限(人均)",
  burstCap: "突发可超额上限",
  warnPct: "使用率预警阈值",
  quietHourBalance: "夜间均衡(22:00–08:00)",
  overflowQueue: "超额溢出去向",
};
