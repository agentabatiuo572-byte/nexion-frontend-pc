// 客服中心域 M 数据模型。运行态业务数据由后端 content 接口提供;I.support.*/I.session.* 仅作为视图适配键。

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

/* ============ M3/M5 会话中心运营(原 I9）============
 * 运行态由后端 content/conversations 与 session-template 接口提供。
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

// 顾问主动话术类型;运行态列表由后端 session-template 接口提供。
export type AdvisorScript = {
  id: string;
  group: "开场" | "升级" | "锁仓" | "复投";
  text: string;
  ctaHref: string;
  status: "published" | "draft";
};

// 即时回复模板类型;运行态列表由后端 session-template 接口提供。
export type SessionReplyTpl = { id: string; type: "advisor" | "support"; text: string; status: "published" | "draft" };

/* ============ 主动发起会话(融合:设计稿身份+撰写+预览 ⊕ v3 单人/固定档/自定义圈选)============ */
// 一个后台客服账号可挂的客服 / 顾问身份;发起会话时从后端坐席列表派生。
export type InitiateIdentity = { id: string; name: string; type: "support" | "advisor"; label: string };
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
export type SessionMsg = { ts: number; sender: "user" | "agent"; agentName?: string; text: string; ctaHref?: string };

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
 * 属例行内部交接:经后端会话接口写入系统消息和 A2 审计。
 * 目标坐席 B 工作台从「转入待处理」筛选档看到,三选一处置:接收接入 / 等待处理 / 手动退回(注明原因)。
 * 超时回落备勤池为工作台可选策略(I.session.workbench.timeoutFallback):后端定时任务读取该策略并执行回落。 */
export type TransferTarget =
  | { kind: "agent"; name: string }   // 指定坐席 B
  | { kind: "queue"; queue: string }  // 技能队列(后端 transferTargets)
  | { kind: "standby" };              // 备勤池
export type SessionTransfer = {
  from: string;        // 来源坐席 A
  to: TransferTarget;  // 转交目标
  reason: string;      // 转交原因(留档进会话系统消息,不入 A2)
  ts: number;          // 转交时刻(用于「转入待处理」超时判定)
  fellBack?: boolean;  // 后端已超时回落备勤池
};
export const STANDBY_POOL_LABEL = "备勤池";
// 转入待处理超时阈值(分钟):超过视为超时;实际回落由后端定时任务执行。
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

/* M3 会话、客户档案运行态必须从后端 content/conversations 与 C1 用户接口读取。 */
export const CUSTOMER_DIRECTORY: CustomerProfile[] = [];
export const SESSION_AGENTS: readonly string[] = [];
export const SESSION_CONVOS: SessionConvo[] = [];

/* M1 负载配置的当前值必须来自后端 /content/tickets/load-config。这里仅保留类型。 */
export type LoadConfig = {
  autoBalance: boolean;
  defaultCap: number;
  burstCap: number;
  warnPct: number;
  quietHourBalance: boolean;
  overflowQueue: string;
};
