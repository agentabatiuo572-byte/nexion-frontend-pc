/**
 * H9「历史估算配置」client —— 保留原有参数供内部历史估算。
 *
 * 数据面沿用 H 域既有后端族(与 H1–H8 同一 growthRequest 通道 · 见 h-client.ts):
 *   GET   /public-stats  → 当前值 + 默认种子 + 历史估算锚与真实注册人口
 *   PATCH /public-stats  → 整组原子写:expectedVersion CAS + 必填理由 + 幂等键;任一字段非法整组不落库。
 *
 * 后端真实 H9 配置接口已经落地；读取失败或契约非法时冻结本页。
 *
 * 本文件**没有任何平台数字的字面量**:当前值、默认种子、历史日产锚全部由服务端读模型下发。
 *    在后台再抄一份设备总数 / 日产档,就是把单源变双源,两处早晚分叉(前端 platform_stats_anchor
 *    哨兵守的正是这条,后台侧同理)。「恢复默认」回填的是 overview.defaults,不是本地常量。
 *
 * 🔴 字段名逐字对齐前端 `Nexion-uniapp/src/store/config-types.ts` 的 `PublicStatsConfig`;
 *    键集合由 scripts/h9-public-stats-parity.mjs 逐键双向核对,少一个多一个都红。
 */
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { formatAdminApiError } from "@/lib/admin/error-messages";
import { growthRequest } from "@/lib/admin/h-client";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import { parseGlobeDisplay, type GlobeDisplayConfig } from "@/lib/admin/globe-display-config";

/** 算力分位档:tops = 算力档位,cumPct = 落在该档及以下的人口累计占比(%)。 */
export interface H9PercentileBand {
  tops: number;
  cumPct: number;
}

/** 与前端 PublicStatsConfig 逐键等同(8 键)。 */
export interface H9PublicStatsValues {
  globeDisplay?: GlobeDisplayConfig;
  homeOnlineCurrent: number;
  homeOnlineStepMin: number;
  homeOnlineStepMax: number;
  homePaidCurrent: number;
  homePaidStepMin: number;
  homePaidStepMax: number;
  homeDisplayEnabled: boolean;
  fleetDevices: number;
  onlineRatePct: number;
  onlineJitter: number;
  registeredUsersBase: number;
  registeredUsersMonthlyGrowthPct: number;
  registeredUsersAnchorAt: number;
  /** 跳动间隔与每次增加人数范围一起保存；未设置时缺省，网络脉搏按月增长率推算。 */
  registeredUsersTickIntervalSec?: number;
  registeredUsersTickStepMin?: number;
  registeredUsersTickStepMax?: number;
  virtualUserCount: number;
  hashratePercentileTable: H9PercentileBand[];
}

/** 运营可写的 7 项(锚点 registeredUsersAnchorAt 由服务端在改基数时重置,不给手填)。 */
export type H9EditableValues = Omit<H9PublicStatsValues, "registeredUsersAnchorAt">;

export interface H9PublicStatsOverview {
  /** 配置版本,写入时回传做 CAS;并发改动返回 409。 */
  version: number;
  values: H9PublicStatsValues;
  /** 服务端下发的出厂种子,「恢复默认」按钮回填用。 */
  defaults: H9PublicStatsValues;
  /** 历史估算的单台日产(USD/台/日)—— 仅用于内部影响预览。 */
  publishedDailyUsdPerDevice: number;
  /** 真实注册人口 —— 仅用于历史本地估算分母，不参与设备预估排名。 */
  realUserCount: number;
  effectiveAt: string;
}

/** 单个数值参数的运营面定义:中文标签 + 英文标识 + 合法域(逐字取自规格 FEAT-HOME02b ③)。 */
export interface H9FieldDef {
  key: keyof Omit<H9EditableValues, "hashratePercentileTable" | "homeDisplayEnabled" | "globeDisplay">;
  /** 运营可读中文名(页面主标)。 */
  label: string;
  /** 单位,无量纲留空。 */
  unit: string;
  min: number;
  max: number;
  step: number;
  /** 是否只收整数(台 / 人 / 个)。 */
  integer: boolean;
  /** 一句人话:这个数改了会影响什么。 */
  hint: string;
  /** 可留空的成对参数:成对字段要么都填、要么都空,留空不提交。 */
  pairedOptional?: boolean;
}

export const H9_FIELDS: readonly H9FieldDef[] = [
  { key: "homeOnlineCurrent", label: "在线设备当前值", unit: "台", min: 0, max: 9000000000000, step: 1, integer: true, hint: "用于首页数字展示；仅开启后按区间累计，不改变资金账单。" },
  { key: "homeOnlineStepMin", label: "每秒增加设备下限", unit: "台", min: 0, max: 1000000, step: 1, integer: true, hint: "用于首页数字展示；仅开启后按区间累计，不改变资金账单。" },
  { key: "homeOnlineStepMax", label: "每秒增加设备上限", unit: "台", min: 0, max: 1000000, step: 1, integer: true, hint: "用于首页数字展示；仅开启后按区间累计，不改变资金账单。" },
  { key: "homePaidCurrent", label: "累计已发放当前值", unit: "USD", min: 0, max: 9000000000000, step: 0.01, integer: false, hint: "用于首页数字展示；仅开启后按区间累计，不改变资金账单。" },
  { key: "homePaidStepMin", label: "每秒增加金额下限", unit: "USD", min: 0, max: 1000000, step: 0.01, integer: false, hint: "用于首页数字展示；仅开启后按区间累计，不改变资金账单。" },
  { key: "homePaidStepMax", label: "每秒增加金额上限", unit: "USD", min: 0, max: 1000000, step: 0.01, integer: false, hint: "用于首页数字展示；仅开启后按区间累计，不改变资金账单。" },

  {
    key: "fleetDevices",
    label: "历史估算设备总数",
    unit: "台",
    min: 1000,
    max: 1_000_000,
    step: 1,
    integer: true,
    hint: "仅用于历史在线量与日金额估算；正式 App 的在线设备和已完成提现不读此值。",
  },
  {
    key: "onlineRatePct",
    label: "历史在线设备占比",
    unit: "%",
    min: 50,
    max: 100,
    step: 0.1,
    integer: false,
    hint: "仅用于历史估算中的在线设备占比；介绍页与网络脉搏使用上方首页数字设置。",
  },
  {
    key: "onlineJitter",
    label: "历史在线浮动幅度",
    unit: "台",
    min: 0,
    max: 500,
    step: 1,
    integer: true,
    hint: "仅保留历史估算参数；正式 App 在线设备数不使用人为浮动。",
  },
  {
    key: "registeredUsersBase",
    label: "网络脉搏注册用户基数",
    unit: "人",
    min: 0,
    max: 100_000_000,
    step: 1,
    integer: true,
    hint: "网络脉搏注册用户的起跳值。修改基数、跳动间隔或每次增加人数范围时，推算起点重置为保存时刻；不参与设备预估排名，不改变真实账户。",
  },
  {
    key: "registeredUsersMonthlyGrowthPct",
    label: "网络脉搏注册用户月增长率",
    unit: "%/月",
    min: 0,
    max: 50,
    step: 0.1,
    integer: false,
    hint: "未设置跳动间隔时，用于「网络脉搏」注册用户增长推算，从保存时开始计算。",
  },
  {
    key: "registeredUsersTickIntervalSec",
    label: "网络脉搏注册用户跳动间隔",
    unit: "秒",
    min: 1,
    max: 86_400,
    step: 1,
    integer: true,
    pairedOptional: true,
    hint: "每隔多少秒增加一次。与每次最少、最多增加人数一起填写后，网络脉搏从基数开始按间隔增加，不再使用月增长率；三项都留空则保持按月增长率。",
  },
  {
    key: "registeredUsersTickStepMin",
    label: "网络脉搏注册用户每次最少增加",
    unit: "人",
    min: 0,
    max: 100_000_000,
    step: 1,
    integer: true,
    pairedOptional: true,
    hint: "每次跳动至少增加的人数，可填 0。",
  },
  {
    key: "registeredUsersTickStepMax",
    label: "网络脉搏注册用户每次最多增加",
    unit: "人",
    min: 0,
    max: 100_000_000,
    step: 1,
    integer: true,
    pairedOptional: true,
    hint: "每次跳动最多增加的人数，不能小于最少值；每次在两者之间取值，所有用户看到的数字一致。",
  },
  {
    key: "virtualUserCount",
    // 🔴 全页只用「虚拟人口」这一个称呼(规格 FEAT-HOME02b ④:禁委婉措辞)。
    //    表单标签 / 统计卡副标 / 确认弹窗警示三处曾各叫一个名字,运营照弹窗回表单找不到那一项。
    label: "虚拟人口",
    unit: "人",
    min: 0,
    max: 10_000_000,
    step: 1,
    integer: true,
    hint: "历史本地估算分母 = 真实注册人口 + 本数值。虚拟人口不参与设备预估排名。",
  },
] as const;

// 分位表合法域常量与逐行校验已收进 lib/admin/h9-validation.ts(零 import 纯模块,
// 供 node --test 与前端 network-rank.ts 做行为级等价核对)—— 不在这里再抄一份。

/**
 * 「一次保存意图」的幂等键槽位。
 *
 * 🔴 失败横幅向运营承诺「原样重试用的是同一个幂等键,不会重复落账」——所以键**不能**在每次
 *    点「保存变更」时现铸(旧实现就是那样,承诺是空的:PATCH 已落库、响应丢在网络上时,
 *    第二次提交对服务端是一条全新命令)。改用全仓共享的槽位式命令存储:
 *    同一组值 + 同一基版本 + 同一理由 = 同一意图 → 复用同键(sessionStorage,刷新也不丢);
 *    任一项变了 = 新意图 → 换新键并丢弃旧键;保存成功即收敛,下次保存重新铸。
 */
const h9Attempts = createSlotAttemptStore({ storageKey: "nexion-admin-h9-public-stats-attempt" });
const H9_SLOT = "h9-public-stats";

function invalid(field: string): never {
  // 🔴 机器码不外露给运营:占位卡直接渲染这条 message,裸抛 `H9_RESPONSE_INVALID:values.fleetDevices`
  //    就是把英文错误码摆在运营面上。同 d-client / b2-client 范式:先过共享错误字典翻成中文。
  throw new Error(formatAdminApiError("H9_RESPONSE_INVALID", `H9_RESPONSE_INVALID:${field}`));
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, field: string): number {
  const parsed = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(parsed)) invalid(field);
  return parsed;
}

function nonNegative(value: unknown, field: string): number {
  const parsed = finiteNumber(value, field);
  if (parsed < 0) invalid(field);
  return parsed;
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = finiteNumber(value, field);
  if (!Number.isSafeInteger(parsed) || parsed < 1) invalid(field);
  return parsed;
}

function bands(value: unknown, field: string): H9PercentileBand[] {
  if (!Array.isArray(value)) invalid(field);
  return value.map((raw, index) => {
    const row = record(raw, `${field}[${index}]`);
    return {
      tops: nonNegative(row.tops, `${field}[${index}].tops`),
      cumPct: nonNegative(row.cumPct, `${field}[${index}].cumPct`),
    };
  });
}

function values(value: unknown, field: string): H9PublicStatsValues {
  const raw = record(value, field);
  return {
    homeOnlineCurrent: nonNegative(raw.homeOnlineCurrent, `${field}.homeOnlineCurrent`),
    ...(raw.globeDisplay === undefined ? {} : { globeDisplay: parseGlobeDisplay(raw.globeDisplay) ?? invalid(`${field}.globeDisplay`) }),
    homeOnlineStepMin: nonNegative(raw.homeOnlineStepMin, `${field}.homeOnlineStepMin`),
    homeOnlineStepMax: nonNegative(raw.homeOnlineStepMax, `${field}.homeOnlineStepMax`),
    homePaidCurrent: nonNegative(raw.homePaidCurrent, `${field}.homePaidCurrent`),
    homePaidStepMin: nonNegative(raw.homePaidStepMin, `${field}.homePaidStepMin`),
    homePaidStepMax: nonNegative(raw.homePaidStepMax, `${field}.homePaidStepMax`),
    homeDisplayEnabled: typeof raw.homeDisplayEnabled === "boolean" ? raw.homeDisplayEnabled : invalid(`${field}.homeDisplayEnabled`),
    fleetDevices: nonNegative(raw.fleetDevices, `${field}.fleetDevices`),
    onlineRatePct: nonNegative(raw.onlineRatePct, `${field}.onlineRatePct`),
    onlineJitter: nonNegative(raw.onlineJitter, `${field}.onlineJitter`),
    registeredUsersBase: nonNegative(raw.registeredUsersBase, `${field}.registeredUsersBase`),
    registeredUsersMonthlyGrowthPct: nonNegative(raw.registeredUsersMonthlyGrowthPct, `${field}.registeredUsersMonthlyGrowthPct`),
    registeredUsersAnchorAt: nonNegative(raw.registeredUsersAnchorAt, `${field}.registeredUsersAnchorAt`),
    ...optionalPair(raw, field),
    virtualUserCount: nonNegative(raw.virtualUserCount, `${field}.virtualUserCount`),
    hashratePercentileTable: bands(raw.hashratePercentileTable, `${field}.hashratePercentileTable`),
  };
}

/** 跳动间隔与增加范围三项一起出现或都缺省;只出现一部分视为坏数据,走占位态。 */
function optionalPair(raw: Record<string, unknown>, field: string): Pick<H9PublicStatsValues, "registeredUsersTickIntervalSec" | "registeredUsersTickStepMin" | "registeredUsersTickStepMax"> {
  const interval = raw.registeredUsersTickIntervalSec;
  const stepMin = raw.registeredUsersTickStepMin;
  const stepMax = raw.registeredUsersTickStepMax;
  if (interval == null && stepMin == null && stepMax == null) return {};
  if (interval == null || stepMin == null || stepMax == null) invalid(`${field}.registeredUsersTickIntervalSec`);
  return {
    registeredUsersTickIntervalSec: nonNegative(interval, `${field}.registeredUsersTickIntervalSec`),
    registeredUsersTickStepMin: nonNegative(stepMin, `${field}.registeredUsersTickStepMin`),
    registeredUsersTickStepMax: nonNegative(stepMax, `${field}.registeredUsersTickStepMax`),
  };
}

/** 服务端读模型解析 —— 缺字段 / 类型不对一律抛错走占位态,绝不给页面兜个 0 冒充真值。 */
export function parseH9PublicStatsOverview(payload: unknown): H9PublicStatsOverview {
  const root = record(payload, "root");
  const effectiveAt = typeof root.effectiveAt === "string" ? root.effectiveAt.trim() : "";
  if (!effectiveAt || Number.isNaN(Date.parse(effectiveAt))) invalid("effectiveAt");
  return {
    version: positiveInteger(root.version, "version"),
    values: values(root.values, "values"),
    defaults: values(root.defaults, "defaults"),
    publishedDailyUsdPerDevice: nonNegative(root.publishedDailyUsdPerDevice, "publishedDailyUsdPerDevice"),
    realUserCount: nonNegative(root.realUserCount, "realUserCount"),
    effectiveAt,
  };
}

export async function fetchH9PublicStats(): Promise<H9PublicStatsOverview> {
  return parseH9PublicStatsOverview(await growthRequest<unknown>("/public-stats"));
}

/**
 * 整组原子写。服务端按合法域复核后落库 + 记审计 + 版本 +1;
 * 改了 registeredUsersBase、跳动间隔或每次增加人数范围时,由服务端把 registeredUsersAnchorAt 重置为写入时刻。
 *
 * 幂等键由本函数从槽位存储取,**不由调用方传** —— 调用方一传就有人在 onClick 里现铸,
 * 「原样重试同键」的承诺又会变成空的(见上方 h9Attempts 说明)。
 */
export async function updateH9PublicStats(
  next: H9EditableValues,
  expectedVersion: number,
  reason: string,
): Promise<H9PublicStatsOverview> {
  const idempotencyKey = h9Attempts.resolve(
    H9_SLOT,
    JSON.stringify({ next, expectedVersion, reason }),
    () => `h9-public-stats-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const saved = parseH9PublicStatsOverview(
    await growthRequest<unknown>("/public-stats", {
      method: "PATCH",
      body: JSON.stringify({ ...next, expectedVersion, reason, operator: currentAdminOperator() }),
      headers: { "Idempotency-Key": idempotencyKey },
    }),
  );
  // 命令已收敛(服务端返回了新版本):丢弃该槽位,下一次保存是新意图、铸新键。
  h9Attempts.forget(H9_SLOT);
  return saved;
}
