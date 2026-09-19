/**
 * C1 用户画像里会话 / 设备 / 通知三类明细的运营展示口径。
 *
 * 这三张表都由后端直出内部枚举(ACTIVE / REVOKED、TIER-3、NOVA_WELCOME / READ),
 * 与中文运营界面混排。这是展示层问题,不改后端契约:在 PC 侧映射,
 * 原始枚举降级为次级技术信息(见 `technical`)。
 */

/** 会话状态。 */
const SESSION_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "活跃",
  REVOKED: "已撤销",
  EXPIRED: "已过期",
};

/** 设备业务状态。 */
const DEVICE_STATUS_LABELS: Record<string, string> = {
  ONLINE: "在线",
  OFFLINE: "离线",
  BUSY: "占用中",
  RUNNING: "运行中",
  ACTIVE: "已激活",
  INACTIVE: "未激活",
  RECYCLED: "已回收",
  DEACTIVATED: "已停用",
  RETIRED: "已退役",
  PENDING: "待激活",
  FAULT: "故障",
};

/** 设备运行态。 */
const RUNTIME_STATUS_LABELS: Record<string, string> = {
  RUNNING: "运行中",
  ONLINE: "在线",
  IDLE: "空闲",
  OFFLINE: "离线",
  STOPPED: "已停止",
  ERROR: "异常",
  UNKNOWN: "未知",
};

/** 通知类型。 */
const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  NOVA_WELCOME: "Nova 欢迎",
  NOVA_SOCIAL: "Nova 社交",
  SYSTEM: "系统通知",
  WALLET: "钱包通知",
  PAYMENT_METHOD: "支付方式",
  COMMISSION: "佣金",
  TEAM: "团队",
  STAKING: "质押",
  MARKET: "市场",
  GENESIS: "Genesis",
};

/** 推送状态。 */
const PUSH_STATUS_LABELS: Record<string, string> = {
  QUEUED: "排队中",
  PENDING: "待推送",
  SENT: "已发送",
  SUCCESS: "已送达",
  DELIVERED: "已送达",
  READ: "已读",
  FAILED: "推送失败",
};

/**
 * 这些 status 都是后端封闭枚举(会话 ACTIVE/REVOKED/EXPIRED、设备业务态、运行态)。
 * 未知值不原样上屏 —— 否则依旧是内部英文标识泄露;统一落到中性文案,
 * 与本仓既有约定一致(见 c5-security 的 sessionStatusLabel)。
 */
function closedSetLabel(labels: Record<string, string>, value: unknown, fallback: string) {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  return labels[raw] ?? fallback;
}

/** 设备规格 `TIER-3` → `3 档`;无法识别的规格原样保留(可能是自由文本商品名)。 */
export function formatC1DeviceTier(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "—";
  const match = /^TIER[\s_-]*(\d+)$/i.exec(raw);
  return match ? `${match[1]} 档` : raw;
}

export function formatC1SessionStatus(value: unknown) {
  return closedSetLabel(SESSION_STATUS_LABELS, value, "状态未知");
}

export function formatC1DeviceStatus(value: unknown) {
  return closedSetLabel(DEVICE_STATUS_LABELS, value, "状态未知");
}

export function formatC1RuntimeStatus(value: unknown) {
  return closedSetLabel(RUNTIME_STATUS_LABELS, value, "未知");
}

/** 通知类型:`type` 是内部枚举,未知值不原样上屏(否则仍是内部标识泄露)。 */
export function formatC1NotificationType(value: unknown) {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  return NOTIFICATION_TYPE_LABELS[raw] ?? "其他通知";
}

/** 推送状态:同上,未知值归到中性文案。 */
export function formatC1PushStatus(value: unknown) {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  return PUSH_STATUS_LABELS[raw] ?? "状态未知";
}

/** 已读标记:`readFlag` 可能是布尔、0/1 或 READ/UNREAD 字符串。 */
export function formatC1ReadFlag(value: unknown) {
  if (typeof value === "boolean") return value ? "已读" : "未读";
  if (typeof value === "number") return value ? "已读" : "未读";
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!raw) return "未读";
  if (raw === "READ" || raw === "TRUE" || raw === "1" || raw === "YES") return "已读";
  if (raw === "UNREAD" || raw === "FALSE" || raw === "0" || raw === "NO") return "未读";
  return raw;
}
