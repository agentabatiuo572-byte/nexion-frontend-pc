/**
 * H9「对外公布数据」client —— 首页公布规模与历史本地排名估算参数。
 *
 * 数据面沿用 H 域既有后端族(与 H1–H8 同一 growthRequest 通道 · 见 h-client.ts):
 *   GET   /public-stats  → 当前值 + 默认种子 + 派生锚(公布日产 / 真实注册人口)
 *   PATCH /public-stats  → 整组原子写:expectedVersion CAS + 必填理由 + 幂等键;任一字段非法整组不落库。
 *
 * ⚠️ 上面两个端点是**本文件的契约期望,不是已核实的后端事实**:开发机无兄弟仓 nexion-backend,
 *    `/api/admin/growth/public-stats` 在后端是否已实现**未核实**;A/B(让后端补端点 vs 前端 mock
 *    兜底)需在有仓的环境或远端确认后再定。端点缺席时本页走占位卡:不显示任何数字、写操作一并
 *    后端真实 H9 聚合接口已经落地；读取失败或契约非法时冻结，**不会拿假数字冒充真值**。
 *
 * 🔴 本文件**没有任何平台数字的字面量**:当前值、默认种子、公布日产锚全部由服务端读模型下发。
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

/** 算力分位档:tops = 算力档位,cumPct = 落在该档及以下的人口累计占比(%)。 */
export interface H9PercentileBand {
  tops: number;
  cumPct: number;
}

/** 与前端 PublicStatsConfig 逐键等同(8 键)。 */
export interface H9PublicStatsValues {
  fleetDevices: number;
  onlineRatePct: number;
  onlineJitter: number;
  registeredUsersBase: number;
  registeredUsersMonthlyGrowthPct: number;
  registeredUsersAnchorAt: number;
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
  /** 对外公布的单台日产(USD/台/日)—— 派生影响预览的另一半,后台不另存一份。 */
  publishedDailyUsdPerDevice: number;
  /** 真实注册人口 —— 历史本地估算分母使用它加虚拟人口，正式服务端名次另算。 */
  realUserCount: number;
  effectiveAt: string;
}

/** 单个数值参数的运营面定义:中文标签 + 英文标识 + 合法域(逐字取自规格 FEAT-HOME02b ③)。 */
export interface H9FieldDef {
  key: keyof Omit<H9EditableValues, "hashratePercentileTable">;
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
}

export const H9_FIELDS: readonly H9FieldDef[] = [
  {
    key: "fleetDevices",
    label: "对外公布的设备总数",
    unit: "台",
    min: 1000,
    max: 1_000_000,
    step: 1,
    integer: true,
    hint: "首页「在线设备」和平台对外公布的日支付额都由它算出来。改它等于改掉对外公布的全部平台级金额口径,保存前请看下方影响预览。",
  },
  {
    key: "onlineRatePct",
    label: "在线设备占比",
    unit: "%",
    min: 50,
    max: 100,
    step: 0.1,
    integer: false,
    hint: "首页显示的在线设备数 = 设备总数 × 本比例。只影响展示,不改金额。",
  },
  {
    key: "onlineJitter",
    label: "在线数展示浮动幅度",
    unit: "台",
    min: 0,
    max: 500,
    step: 1,
    integer: true,
    hint: "让首页在线设备数看起来有呼吸感的上下浮动范围。只动展示,不参与任何金额计算。",
  },
  {
    key: "registeredUsersBase",
    label: "对外公布的注册用户数",
    unit: "人",
    min: 0,
    max: 100_000_000,
    step: 1,
    integer: true,
    hint: "首页「注册用户」的展示基数。改这一项会把下面的推算起点重置为本次保存时刻。",
  },
  {
    key: "registeredUsersMonthlyGrowthPct",
    label: "注册用户月增长率",
    unit: "%/月",
    min: 0,
    max: 50,
    step: 0.1,
    integer: false,
    hint: "首页按这个速率从推算起点往后算出当前注册数 —— 是推算不是累加,所以用户刷新页面数字不会回退。",
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
    hint: "历史本地估算分母 = 真实注册人口 + 本数值。正式 App 当前服务端排名不使用此参数；修改它不会改变当前名次。",
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
    fleetDevices: nonNegative(raw.fleetDevices, `${field}.fleetDevices`),
    onlineRatePct: nonNegative(raw.onlineRatePct, `${field}.onlineRatePct`),
    onlineJitter: nonNegative(raw.onlineJitter, `${field}.onlineJitter`),
    registeredUsersBase: nonNegative(raw.registeredUsersBase, `${field}.registeredUsersBase`),
    registeredUsersMonthlyGrowthPct: nonNegative(raw.registeredUsersMonthlyGrowthPct, `${field}.registeredUsersMonthlyGrowthPct`),
    registeredUsersAnchorAt: nonNegative(raw.registeredUsersAnchorAt, `${field}.registeredUsersAnchorAt`),
    virtualUserCount: nonNegative(raw.virtualUserCount, `${field}.virtualUserCount`),
    hashratePercentileTable: bands(raw.hashratePercentileTable, `${field}.hashratePercentileTable`),
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
 * 改了 registeredUsersBase 时由服务端把 registeredUsersAnchorAt 重置为写入时刻。
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
