/**
 * D7 法币提现参数(FEAT-VND01b)—— 本地假数据层。
 *
 * 🔴 方案 B(主人 2026-08-06 拍板,见 docs/changes/2026-08-06-d7-payout-vnd-config.md):
 *   本机不存在 nexion-backend,且「不写后端服务接口」为标准指令;本模块以 d-client 同形状
 *   (async + version + reason + operator)在页面内存 + localStorage 记假值,不发任何请求。
 *   接真后端时:整文件替换为 fetch 版(签名不变),d7-payout-vnd.tsx 零改。
 *
 * 🔴 单源约束:baseRateVndPerUsdt 的权威在 D6 汇率牌价(真后端),本面**只读展示**同一
 *   语义值(种子 26000),不提供写入口 —— 不造第二个可写基准价。
 *   派生牌价(buyRate/sellRate)**派生不缓存**:config 里不存这两个值,读时现算。
 */

export type PayoutVndWritableField =
  | "buySpreadPct"
  | "sellSpreadPct"
  | "quoteTtlMinWithdraw"
  | "requoteTolerancePct"
  | "feeRatePct"
  | "feeMinUsd"
  | "feeMaxUsd"
  | "minAmountUsd"
  | "maxAmountUsd";

export interface PayoutVndHistoryEntry {
  id: string;
  createdAt: string;
  operator: string;
  reason: string;
  changes: Array<{ field: string; label: string; before: string; after: string }>;
  /** 倒挂强制保存(仅超管路径)标记,历史表展示风险标签。 */
  forced?: boolean;
}

export interface PayoutVndConfig {
  /** 只读:单源在 D6 汇率牌价,本面不提供写入口。 */
  baseRateVndPerUsdt: number;
  buySpreadPct: number;
  sellSpreadPct: number;
  quoteTtlMinWithdraw: number;
  requoteTolerancePct: number;
  feeRatePct: number;
  feeMinUsd: number;
  feeMaxUsd: number;
  minAmountUsd: number;
  maxAmountUsd: number;
  channelEnabled: boolean;
  version: number;
  history: PayoutVndHistoryEntry[];
}

export type PayoutVndChanges = Partial<
  Pick<PayoutVndConfig, PayoutVndWritableField | "channelEnabled">
>;

/**
 * 数值字段骨架单源:页面输入行渲染、实时字段级校验、数据层提交校验共用这一张表
 * (规格 §③ 数据字典;改域只改这里)。
 */
export const PAYOUT_VND_FIELDS: Record<
  PayoutVndWritableField,
  { label: string; unit: string; min: number; max: number; step: number; integer?: boolean }
> = {
  buySpreadPct: { label: "买入点差", unit: "%", min: 0, max: 3, step: 0.01 },
  sellSpreadPct: { label: "卖出点差", unit: "%", min: 0, max: 3, step: 0.01 },
  quoteTtlMinWithdraw: { label: "出金报价有效期", unit: "分钟", min: 1, max: 60, step: 1, integer: true },
  requoteTolerancePct: { label: "重报价偏差阈值", unit: "%", min: 0, max: 10, step: 0.1 },
  feeRatePct: { label: "提现费率", unit: "%", min: 0, max: 5, step: 0.1 },
  feeMinUsd: { label: "最低收费", unit: "USD", min: 0, max: 1000, step: 0.5 },
  feeMaxUsd: { label: "单笔封顶", unit: "USD", min: 0, max: 1000, step: 0.5 },
  minAmountUsd: { label: "单笔下限", unit: "USD", min: 0, max: 10000, step: 1 },
  maxAmountUsd: { label: "单笔上限", unit: "USD", min: 1, max: 100000, step: 1 },
};

/** 种子(规格 §③ 默认列);「恢复默认」按钮回填此值,仍走保存确认链。 */
export const PAYOUT_VND_DEFAULTS: Omit<PayoutVndConfig, "version" | "history"> = {
  baseRateVndPerUsdt: 26_000,
  buySpreadPct: 1.5,
  sellSpreadPct: 1.5,
  quoteTtlMinWithdraw: 10,
  requoteTolerancePct: 2,
  feeRatePct: 1.0,
  feeMinUsd: 1,
  feeMaxUsd: 25,
  minAmountUsd: 20,
  maxAmountUsd: 5_000,
  channelEnabled: false,
};

const STORAGE_KEY = "nexion-admin-payout-vnd-v1";
const HISTORY_LIMIT = 50;

/** 与 D6 同口径:派生牌价在整数域取整到十位。派生不缓存 —— 不写回 config。 */
const round10 = (value: number) => Math.round(value / 10) * 10;
export const deriveBuyRate = (cfg: Pick<PayoutVndConfig, "baseRateVndPerUsdt" | "buySpreadPct">) =>
  round10(cfg.baseRateVndPerUsdt * (1 + cfg.buySpreadPct / 100));
export const deriveSellRate = (cfg: Pick<PayoutVndConfig, "baseRateVndPerUsdt" | "sellSpreadPct">) =>
  round10(cfg.baseRateVndPerUsdt * (1 - cfg.sellSpreadPct / 100));

/** 倒挂 = 出金派生价 ≥ 入金派生价(平台两个方向都不赚价差,规格异常2)。 */
export const isInverted = (cfg: Pick<PayoutVndConfig, "baseRateVndPerUsdt" | "buySpreadPct" | "sellSpreadPct">) =>
  deriveSellRate(cfg) >= deriveBuyRate(cfg);

export const PAYOUT_VND_INVERTED_MESSAGE =
  "卖出牌价已不低于买入牌价(价差倒挂),默认拒绝保存;仅超级管理员可在风险声明下强制保存";
export const PAYOUT_VND_VERSION_CONFLICT_MESSAGE = "参数已被其他运营员更新;请关闭弹窗查看最新值后重新提交";
export const PAYOUT_VND_PERSIST_FAILED_MESSAGE = "保存失败:本地存储不可用(空间不足或隐私模式),原值未变,请重试";

/** 逐字段域校验(骨架单源);返回 {} = 全部合法。页面实时红字与提交校验共用。 */
export function payoutVndFieldErrors(next: PayoutVndConfig): Partial<Record<PayoutVndWritableField, string>> {
  const errors: Partial<Record<PayoutVndWritableField, string>> = {};
  for (const key of Object.keys(PAYOUT_VND_FIELDS) as PayoutVndWritableField[]) {
    const spec = PAYOUT_VND_FIELDS[key];
    const value = next[key];
    if (!Number.isFinite(value)) {
      // 空串/非数值草稿:与「越界」分开报,清空输入框 ≠ 改成 0。
      errors[key] = `${spec.label}请输入有效数值`;
    } else if (value < spec.min || value > spec.max) {
      errors[key] = `${spec.label}超出合法范围 ${spec.min}–${spec.max} ${spec.unit}`;
    } else if (spec.integer && !Number.isInteger(value)) {
      errors[key] = `${spec.label}必须是整数`;
    }
  }
  return errors;
}

/** 组合冲突校验(规格异常3 + 常识约束);返回 [] = 无冲突。倒挂单独走 isInverted。 */
export function payoutVndCrossErrors(next: PayoutVndConfig): string[] {
  const errors: string[] = [];
  // 规格异常3的意图是防「到手为负或为零」;最低收费为 0 时不可能吃穿本金,不误伤。
  if (next.feeMinUsd > 0 && next.feeMinUsd >= next.minAmountUsd) {
    errors.push("最低收费不得大于等于单笔下限,否则最小额提现到手为零或为负");
  }
  if (next.feeMinUsd > next.feeMaxUsd) {
    errors.push("最低收费不得高于单笔封顶");
  }
  if (next.minAmountUsd > next.maxAmountUsd) {
    errors.push("单笔下限不得高于单笔上限");
  }
  return errors;
}

function seedConfig(): PayoutVndConfig {
  return { ...PAYOUT_VND_DEFAULTS, version: 1, history: [] };
}

/** node(契约测试)与浏览器共用内存态;浏览器额外落 localStorage。 */
let memory: PayoutVndConfig | null = null;

function isValidHistoryEntry(value: unknown): value is PayoutVndHistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.operator === "string" &&
    typeof record.reason === "string" &&
    Array.isArray(record.changes) &&
    record.changes.every(
      (change) =>
        typeof change === "object" && change !== null &&
        typeof (change as Record<string, unknown>).label === "string" &&
        typeof (change as Record<string, unknown>).before === "string" &&
        typeof (change as Record<string, unknown>).after === "string",
    )
  );
}

function isValidStored(value: unknown): value is PayoutVndConfig {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    !Number.isFinite(record.baseRateVndPerUsdt) ||
    !Number.isFinite(record.version) ||
    typeof record.channelEnabled !== "boolean" ||
    !Array.isArray(record.history)
  ) {
    return false;
  }
  // 数值域也要过骨架校验:被篡改成越界值的持久态同样按脏数据回种子。
  return Object.keys(payoutVndFieldErrors(record as unknown as PayoutVndConfig)).length === 0;
}

function readStored(): PayoutVndConfig {
  // 浏览器分支每次回读 localStorage:跨标签页写入必须被看见,CAS 才是真的
  //(内存短路会让两个 tab 各自拿旧 version 互相抹掉对方的改动与历史)。
  if (typeof window !== "undefined") {
    try {
      const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "");
      // 旧 schema / 脏数据一律回种子,不让坏持久值把页面打白。
      if (isValidStored(parsed)) {
        // 历史坏行只过滤该行,不连累合法配置整体回种子。
        memory = { ...parsed, history: parsed.history.filter(isValidHistoryEntry) };
        return memory;
      }
    } catch {
      /* 无持久值或解析失败 → 种子 */
    }
    memory = seedConfig();
    return memory;
  }
  if (memory) return memory;
  memory = seedConfig();
  return memory;
}

function persist(next: PayoutVndConfig) {
  if (typeof window === "undefined") return;
  // 写失败(配额/隐私模式)必须暴露为失败态,禁假成功(规格异常4);报运营可读中文,不透浏览器原生英文。
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    throw new Error(PAYOUT_VND_PERSIST_FAILED_MESSAGE);
  }
}

const clone = (cfg: PayoutVndConfig): PayoutVndConfig => JSON.parse(JSON.stringify(cfg)) as PayoutVndConfig;

export async function loadPayoutVndConfig(): Promise<PayoutVndConfig> {
  return clone(readStored());
}

export async function updatePayoutVndConfig(
  changes: PayoutVndChanges,
  version: number,
  reason: string,
  operator: string,
  opts?: { forceInverted?: boolean },
): Promise<PayoutVndConfig> {
  const current = readStored();
  if (version !== current.version) {
    throw new Error(PAYOUT_VND_VERSION_CONFLICT_MESSAGE);
  }
  const trimmedReason = reason.trim();
  if (trimmedReason.length < 8 || trimmedReason.length > 200) {
    throw new Error("请输入 8-200 字变更理由");
  }
  // 可写键白名单:baseRateVndPerUsdt(单源在 D6)/version/history 不接受外部写入,
  // 靠显式过滤而不是「碰巧在别处报错」挡住第二写入口。
  const WRITABLE_KEYS = new Set<string>([...Object.keys(PAYOUT_VND_FIELDS), "channelEnabled"]);
  const sanitized: PayoutVndChanges = {};
  for (const [key, value] of Object.entries(changes)) {
    if (WRITABLE_KEYS.has(key)) (sanitized as Record<string, unknown>)[key] = value;
  }
  const next: PayoutVndConfig = { ...current, ...sanitized };

  const fieldErrors = payoutVndFieldErrors(next);
  const firstFieldError = Object.values(fieldErrors)[0];
  if (firstFieldError) throw new Error(firstFieldError);
  const crossErrors = payoutVndCrossErrors(next);
  if (crossErrors.length) throw new Error(crossErrors[0]);
  // 倒挂闸(规格异常2):拦「由本次变更引入倒挂」与「倒挂态下继续改点差」;
  // 已倒挂时不碰点差的变更(停用通道、收紧费率等止血动作)必须放行——
  // 否则强制保存过一次倒挂后,最该按的应急开关反而被这个闸锁死。
  const forced = Boolean(opts?.forceInverted);
  const touchesSpread = sanitized.buySpreadPct !== undefined || sanitized.sellSpreadPct !== undefined;
  if (isInverted(next) && !forced && (!isInverted(current) || touchesSpread)) {
    throw new Error(PAYOUT_VND_INVERTED_MESSAGE);
  }

  const diff: PayoutVndHistoryEntry["changes"] = [];
  for (const key of Object.keys(sanitized) as Array<keyof PayoutVndChanges>) {
    const before = current[key];
    const after = next[key];
    if (before === after) continue;
    if (key === "channelEnabled") {
      diff.push({ field: key, label: "法币提现通道", before: before ? "开启" : "关闭", after: after ? "开启" : "关闭" });
    } else {
      // 历史行带单位,与确认弹窗 diff 同口径(如「1.5 % → 2 %」)。
      const unit = PAYOUT_VND_FIELDS[key].unit;
      diff.push({ field: key, label: PAYOUT_VND_FIELDS[key].label, before: `${String(before)} ${unit}`, after: `${String(after)} ${unit}` });
    }
  }
  if (diff.length === 0) {
    throw new Error("参数值未变化,本次未提交");
  }

  const entry: PayoutVndHistoryEntry = {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `h-${Date.now()}`,
    createdAt: new Date().toISOString(),
    operator,
    reason: trimmedReason,
    changes: diff,
    ...(forced ? { forced: true } : {}),
  };
  const saved: PayoutVndConfig = {
    ...next,
    version: current.version + 1,
    history: [entry, ...current.history].slice(0, HISTORY_LIMIT),
  };
  persist(saved);
  memory = saved;
  return clone(saved);
}

/**
 * 通道启停专用入口(OPS-D-17 独立锚):语义上是「资金流向类动作」,与参数调整分开留痕;
 * 删掉通道开关 UI 而参数提交还在时,动作完整性门必须能红。
 */
export async function togglePayoutVndChannel(
  enabled: boolean,
  version: number,
  reason: string,
  operator: string,
): Promise<PayoutVndConfig> {
  return updatePayoutVndConfig({ channelEnabled: enabled }, version, reason, operator);
}
