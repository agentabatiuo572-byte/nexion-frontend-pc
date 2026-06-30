/**
 * Janus C2 控制台(K6)— 规则字段目录(PRD §6.3)。
 * 规则编辑器据此给运营**选字段 / 选操作符 / 按值类型给输入**(枚举值下拉,不手输工程字段名)。
 * field = 内部 key(与 evaluate.ts resolveField 对齐);label / 输入控件 = 运营可读。
 */
import type { DeviceStatus, RuleOp } from "./types";
import { STATUS_LABEL, channelLabel } from "./labels";

/** 枚举字段取值的运营可读译名(status / channel),避免规则标签露工程代码。 */
function enumValueLabel(field: string, v: string): string {
  if (field === "status") return STATUS_LABEL[v as DeviceStatus] ?? v;
  if (field === "channel") return channelLabel(v);
  return v;
}

export type RuleValueType = "number" | "boolean" | "enum" | "text" | "multi";

export interface RuleFieldDef {
  field: string;
  label: string;
  category: string;
  type: RuleValueType;
  ops: RuleOp[];
  options?: string[];
  unit?: string;
  /** 数值类默认值,新建规则时预填。 */
  defaultValue: unknown;
}

const DEVICE_STATUSES = ["NEW", "OBSERVING", "RECOMMENDED", "HIT", "ACTIVATED", "ENV_FILTERED", "MANUAL_HOLD", "MANUAL_FORCED", "BLOCKED", "STALE", "RESET", "ERROR"];

/**
 * §6.3.1–6.3.6 规则字段(覆盖时间 / 使用深度 / 成熟度 / 邀请渠道 / 环境指纹 / 运营保护)。
 * 本表为运营高频字段精选子集;PRD §6.3 全量 ~50 字段(localHour / maturityLevel / uaContains /
 * lastSeenWithinMinutes / importedAllowlist 等)按需扩充 —— 新增字段必须同步 evaluate.ts resolveField,
 * 否则该字段恒取 undefined 致规则静默不通过。
 */
export const RULE_FIELDS: RuleFieldDef[] = [
  // 时间与安装
  { field: "installDays", label: "安装天数", category: "时间与安装", type: "number", ops: [">=", "<=", "between"], unit: "天", defaultValue: 3 },
  // 使用深度
  { field: "appOpenCount", label: "打开 APP 次数", category: "使用深度", type: "number", ops: [">=", "<="], unit: "次", defaultValue: 5 },
  { field: "sessionCount", label: "会话次数", category: "使用深度", type: "number", ops: [">=", "<="], unit: "次", defaultValue: 3 },
  { field: "foregroundDurationSeconds", label: "前台停留", category: "使用深度", type: "number", ops: [">=", "<="], unit: "秒", defaultValue: 300 },
  { field: "repeatStreakDays", label: "连续活跃天数", category: "使用深度", type: "number", ops: [">=", "<="], unit: "天", defaultValue: 2 },
  { field: "benchmarkViewed", label: "看过跑分页面", category: "使用深度", type: "boolean", ops: ["="], defaultValue: true },
  { field: "optimizeDone", label: "执行过优化", category: "使用深度", type: "boolean", ops: ["="], defaultValue: true },
  { field: "marketViewed", label: "看过市场页面", category: "使用深度", type: "boolean", ops: ["="], defaultValue: true },
  { field: "walletViewed", label: "看过资产页面", category: "使用深度", type: "boolean", ops: ["="], defaultValue: true },
  // 成熟度
  { field: "maturityScore", label: "成熟度分", category: "成熟度", type: "number", ops: [">=", "<=", "between"], defaultValue: 60 },
  // 邀请码与渠道
  { field: "inviteCode", label: "邀请码", category: "邀请与渠道", type: "multi", ops: ["in", "notIn"], defaultValue: [] },
  { field: "channel", label: "来源渠道", category: "邀请与渠道", type: "enum", ops: ["in", "=", "!="], options: ["official", "invite", "ad", "test", "internal"], defaultValue: "official" },
  // 环境与指纹
  { field: "environmentRiskScore", label: "环境风险分", category: "环境与指纹", type: "number", ops: ["<", "<=", ">=", ">"], defaultValue: 50 },
  { field: "isHeadless", label: "疑似无头浏览器", category: "环境与指纹", type: "boolean", ops: ["="], defaultValue: true },
  { field: "automationSignalCount", label: "自动化信号数量", category: "环境与指纹", type: "number", ops: [">=", "<="], unit: "个", defaultValue: 3 },
  { field: "fpBlocklistHit", label: "命中指纹黑名单", category: "环境与指纹", type: "boolean", ops: ["="], defaultValue: true },
  { field: "screenAnomaly", label: "屏幕尺寸异常", category: "环境与指纹", type: "boolean", ops: ["="], defaultValue: true },
  { field: "timezoneMismatch", label: "时区不一致", category: "环境与指纹", type: "boolean", ops: ["="], defaultValue: true },
  // 运营保护
  { field: "activated", label: "已激活", category: "运营保护", type: "boolean", ops: ["="], defaultValue: false },
  { field: "status", label: "设备状态", category: "运营保护", type: "enum", ops: ["in", "notIn", "=", "!="], options: DEVICE_STATUSES, defaultValue: "OBSERVING" },
];

export const ruleFieldDef = (field: string): RuleFieldDef | undefined => RULE_FIELDS.find((f) => f.field === field);

/** 操作符运营可读符号(编辑器下拉)。 */
export const OP_SYMBOL: Record<RuleOp, string> = {
  "=": "等于",
  "!=": "不等于",
  ">": "大于",
  ">=": "不小于",
  "<": "小于",
  "<=": "不大于",
  in: "属于",
  notIn: "不属于",
  between: "介于",
  contains: "包含",
};

/** 由 field+op+value 自动生成运营可读规则标签(自然语言,PRD §18.3-4)。 */
export function autoRuleLabel(field: string, op: RuleOp, value: unknown): string {
  const def = ruleFieldDef(field);
  if (!def) return `${field} ${op} ${String(value)}`;
  if (def.type === "boolean") return op === "=" && value === false ? `非「${def.label}」` : def.label;
  const disp = (v: unknown) => (def.type === "enum" ? enumValueLabel(field, String(v)) : String(v));
  if (op === "in" || op === "notIn") {
    const list = Array.isArray(value) ? value.map(disp).join(" / ") : disp(value);
    return `${def.label}${op === "notIn" ? "不" : ""}属于 ${list || "(空)"}`;
  }
  if (op === "between" && Array.isArray(value)) return `${def.label}介于 ${value[0]}–${value[1]}${def.unit ?? ""}`;
  return `${def.label} ${OP_SYMBOL[op]} ${disp(value)}${def.unit ?? ""}`;
}
