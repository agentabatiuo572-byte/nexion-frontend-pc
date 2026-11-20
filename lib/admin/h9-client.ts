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
 * 管理配置对齐 GrowthPublicStatsService；App 只消费公开投影和独立首页批次，
 * 不能要求旧 PublicStatsConfig 类型与管理配置的字段集合相同。
 */
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { formatAdminApiError } from "@/lib/admin/error-messages";
import { growthRequest } from "@/lib/admin/h-client";
import { createH9Command, sendH9Command, type H9Command, type H9CommandDisplay } from "@/lib/admin/h9-command";
import { h9BandRowErrors, h9MoneyPrecisionValid } from "@/lib/admin/h9-validation";
import { OutcomeUnknownError } from "@/lib/admin/outcome-classification";
import { GLOBE_CENTERS, parseGlobeDisplay, type GlobeDisplayConfig } from "@/lib/admin/globe-display-config";

/** 算力分位档:tops = 算力档位,cumPct = 落在该档及以下的人口累计占比(%)。 */
export interface H9PercentileBand {
  tops: number;
  cumPct: number;
}

/** 管理接口的配置字段；公开客户端只接其中一部分。 */
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
  /** 全球作业基座：缺省 = 后端还没支持（页面不提交此项）；null = 未发布；数字 = App 全球作业的起算数。只用于展示。 */
  activeJobsBase?: number | null;
}

/** 可写配置（注册人数锚由服务端维护，不给手填）。 */
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

export interface H9AppDisplay {
  source: "server:home-display+public-stats" | "sandbox:h9-public-stats";
  sourceEnvironment: "PRODUCTION" | "SANDBOX";
  version: number;
  capturedAt: string;
  available: boolean;
  reason: string | null;
  homeDisplay: { enabled: boolean; startAt: number; serverNow: number; validUntil: number; sequence: number; onlineDevices: number; paidCents: number; paid: string } | null;
  registeredUsers: number | null;
  activeJobsBase: number | null;
  /** Real on-grid count, shown for reference only (the App does not show it); Sandbox counts task-catalog classes. */
  activeJobsActual: number | null;
  /** The App's value from the H9 home display batch; explicit null = base unpublished or batch unavailable. */
  activeJobsDisplay?: number | null;
  activeJobsSource?: "APP_HOME_ON_GRID" | "APP_HOME_SANDBOX_TASK_CATALOG" | null;
  globeDisplay: GlobeDisplayConfig | null;
  /** App display simulation supplied by the backend, not a physical node inventory. */
  centerNodes: { id: typeof GLOBE_CENTERS[number]["id"]; onlineNodes: number | null }[] | null;
  centerNodesSource?: "APP_DISPLAY_SIMULATION" | null;
  centerNodesStep?: number | null;
  unavailable: { field: string; reason: string }[];
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
  /** 可留空的单项参数:留空提交 null(不发布)。 */
  clearable?: boolean;
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
    hint: "未设置跳动间隔时按原推算起点计算月复利；只改月增长率不重置起点。",
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
  {
    key: "activeJobsBase",
    label: "全球作业基座",
    unit: "个",
    min: 0,
    max: 100_000_000,
    step: 1,
    integer: true,
    clearable: true,
    hint: "App 首页、赚取页任务中心和全球网络页的「N 个全球作业进行中」从这个数起算，首页数字增长开着时跟在线设备同步增加。留空表示不发布，App 显示「—」。只用于展示。",
  },
] as const;

// 分位表合法域常量与逐行校验已收进 lib/admin/h9-validation.ts(零 import 纯模块,
// 供 node --test 与前端 network-rank.ts 做行为级等价核对)—— 不在这里再抄一份。

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
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(field);
  return value;
}

function nonNegative(value: unknown, field: string): number {
  const parsed = finiteNumber(value, field);
  if (parsed < 0) invalid(field);
  return parsed;
}

function nonNegativeInteger(value: unknown, field: string): number {
  const parsed = finiteNumber(value, field);
  if (!Number.isSafeInteger(parsed) || parsed < 0) invalid(field);
  return parsed;
}

function bands(value: unknown, field: string): H9PercentileBand[] {
  if (!Array.isArray(value)) invalid(field);
  const parsed = value.map((raw, index) => {
    const row = record(raw, `${field}[${index}]`);
    return {
      tops: nonNegative(row.tops, `${field}[${index}].tops`),
      cumPct: nonNegative(row.cumPct, `${field}[${index}].cumPct`),
    };
  });
  if (parsed.length < 2 || h9BandRowErrors(parsed.map(row => ({ tops: String(row.tops), cumPct: String(row.cumPct) }))).some(Boolean)) invalid(field);
  return parsed;
}

function values(value: unknown, field: string): H9PublicStatsValues {
  const raw = record(value, field);
  const parsed: H9PublicStatsValues = {
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
    // 后端未返回此键 = 还没支持:不放进值里,保存时也就不会提交。
    ...(raw.activeJobsBase === undefined ? {} : {
      // 缺键 / null / 0–1亿整数三态;其他类型或越界走解析错误,不能让保存其他模块时把坏值回传。
      activeJobsBase: raw.activeJobsBase === null ? null
        : typeof raw.activeJobsBase === "number" && Number.isSafeInteger(raw.activeJobsBase) && raw.activeJobsBase >= 0 && raw.activeJobsBase <= 100_000_000
          ? raw.activeJobsBase : invalid(`${field}.activeJobsBase`),
    }),
  };
  for (const definition of H9_FIELDS) {
    const number = parsed[definition.key];
    if (number == null && (definition.pairedOptional || definition.clearable)) continue;
    if (number === undefined || number === null || number < definition.min || number > definition.max
      || definition.integer && !Number.isSafeInteger(number)
      || definition.key.startsWith("homePaid") && !h9MoneyPrecisionValid(number)) invalid(`${field}.${definition.key}`);
  }
  if (parsed.homeOnlineStepMin > parsed.homeOnlineStepMax || parsed.homePaidStepMin > parsed.homePaidStepMax
    || parsed.registeredUsersTickStepMin !== undefined && parsed.registeredUsersTickStepMin > parsed.registeredUsersTickStepMax!) invalid(field);
  if (!Number.isSafeInteger(parsed.registeredUsersAnchorAt) || parsed.registeredUsersAnchorAt <= 0) invalid(`${field}.registeredUsersAnchorAt`);
  return parsed;
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
    version: nonNegativeInteger(root.version, "version"),
    values: values(root.values, "values"),
    defaults: values(root.defaults, "defaults"),
    publishedDailyUsdPerDevice: finiteNumber(root.publishedDailyUsdPerDevice, "publishedDailyUsdPerDevice"),
    realUserCount: nonNegativeInteger(root.realUserCount, "realUserCount"),
    effectiveAt,
  };
}

export async function fetchH9PublicStats(): Promise<H9PublicStatsOverview> {
  return parseH9PublicStatsOverview(await growthRequest<unknown>("/public-stats"));
}

/** Server snapshot only; never replace saved configuration or guess absent App sources. */
export async function fetchH9AppDisplay(signal?: AbortSignal): Promise<H9AppDisplay> {
  const row = record(await growthRequest<unknown>("/public-stats/app-display", { signal }), "appDisplay");
  if ((row.source !== "server:home-display+public-stats" || row.sourceEnvironment !== "PRODUCTION")
    && (row.source !== "sandbox:h9-public-stats" || row.sourceEnvironment !== "SANDBOX")) invalid("appDisplay.source");
  const text = (value: unknown, field: string) => typeof value === "string" && value.trim() ? value : invalid(`appDisplay.${field}`);
  const capturedAt = text(row.capturedAt, "capturedAt");
  if (Number.isNaN(Date.parse(capturedAt)) || typeof row.available !== "boolean") invalid("appDisplay");
  let homeDisplay: H9AppDisplay["homeDisplay"] = null;
  if (row.homeDisplay !== null) {
    const batch = record(row.homeDisplay, "appDisplay.homeDisplay");
    if (typeof batch.enabled !== "boolean") invalid("appDisplay.homeDisplay.enabled");
    const paid = typeof batch.paid === "number" || typeof batch.paid === "string" ? String(batch.paid) : "";
    if (!/^\d+(?:\.\d+)?$/.test(paid)) invalid("appDisplay.homeDisplay.paid");
    homeDisplay = { enabled: batch.enabled,
      startAt: nonNegativeInteger(batch.startAt, "appDisplay.homeDisplay.startAt"),
      serverNow: nonNegativeInteger(batch.serverNow, "appDisplay.homeDisplay.serverNow"),
      validUntil: nonNegativeInteger(batch.validUntil, "appDisplay.homeDisplay.validUntil"),
      sequence: nonNegativeInteger(batch.sequence, "appDisplay.homeDisplay.sequence"),
      onlineDevices: nonNegativeInteger(batch.onlineDevices, "appDisplay.homeDisplay.onlineDevices"),
      paidCents: nonNegativeInteger(batch.paidCents, "appDisplay.homeDisplay.paidCents"), paid };
  }
  if (row.available !== (homeDisplay !== null) || !Array.isArray(row.unavailable)) invalid("appDisplay.available");
  let centerNodes: H9AppDisplay["centerNodes"] = null;
  if (row.centerNodes !== null) {
    if (!Array.isArray(row.centerNodes) || row.centerNodes.length !== GLOBE_CENTERS.length) invalid("appDisplay.centerNodes");
    const seen = new Set<string>();
    centerNodes = row.centerNodes.map((value, index) => {
      const center = record(value, `appDisplay.centerNodes.${index}`);
      const id = GLOBE_CENTERS.find(item => item.id === center.id)?.id;
      if (!id || seen.has(id)) invalid(`appDisplay.centerNodes.${index}.id`);
      seen.add(id);
      return { id, onlineNodes: center.onlineNodes === null ? null
        : nonNegativeInteger(center.onlineNodes, `appDisplay.centerNodes.${index}.onlineNodes`) };
    });
  }
  if (row.activeJobsSource !== undefined && row.activeJobsSource !== null
    && row.activeJobsSource !== "APP_HOME_ON_GRID" && row.activeJobsSource !== "APP_HOME_SANDBOX_TASK_CATALOG") invalid("appDisplay.activeJobsSource");
  if (row.centerNodesSource !== undefined && row.centerNodesSource !== null
    && row.centerNodesSource !== "APP_DISPLAY_SIMULATION") invalid("appDisplay.centerNodesSource");
  return { source: row.source as H9AppDisplay["source"], sourceEnvironment: row.sourceEnvironment as H9AppDisplay["sourceEnvironment"],
    version: nonNegativeInteger(row.version, "appDisplay.version"), capturedAt, available: row.available,
    reason: row.reason === null ? null : text(row.reason, "reason"), homeDisplay,
    registeredUsers: row.registeredUsers === null ? null : nonNegativeInteger(row.registeredUsers, "appDisplay.registeredUsers"),
    activeJobsBase: row.activeJobsBase === null ? null : nonNegativeInteger(row.activeJobsBase, "appDisplay.activeJobsBase"),
    activeJobsActual: row.activeJobsActual === null ? null : nonNegativeInteger(row.activeJobsActual, "appDisplay.activeJobsActual"),
    ...(row.activeJobsDisplay === undefined ? {} : { activeJobsDisplay: row.activeJobsDisplay === null ? null
      : nonNegativeInteger(row.activeJobsDisplay, "appDisplay.activeJobsDisplay") }),
    ...(row.activeJobsSource === undefined ? {} : { activeJobsSource: row.activeJobsSource as H9AppDisplay["activeJobsSource"] }),
    centerNodes,
    ...(row.centerNodesSource === undefined ? {} : { centerNodesSource: row.centerNodesSource as H9AppDisplay["centerNodesSource"] }),
    ...(row.centerNodesStep === undefined ? {} : { centerNodesStep: row.centerNodesStep === null ? null
      : nonNegativeInteger(row.centerNodesStep, "appDisplay.centerNodesStep") }),
    globeDisplay: row.globeDisplay === null ? null : parseGlobeDisplay(row.globeDisplay) ?? invalid("appDisplay.globeDisplay"),
    unavailable: row.unavailable.map((value, index) => {
      const item = record(value, `appDisplay.unavailable.${index}`);
      return { field: text(item.field, `unavailable.${index}.field`), reason: text(item.reason, `unavailable.${index}.reason`) };
    }) };
}

/** Freeze the complete original request, including the actor, before the first dispatch. */
export function prepareH9PublicStats(
  next: H9EditableValues,
  expectedVersion: number,
  reason: string,
  display: H9CommandDisplay,
): H9Command {
  return createH9Command("main", JSON.stringify({ ...next, expectedVersion, reason, operator: currentAdminOperator() }), display);
}

export function updateH9PublicStats(command: H9Command, recovering = false): Promise<H9PublicStatsOverview> {
  return sendH9Command("main", command, raw => {
    const saved = parseH9PublicStatsOverview(raw);
    // GrowthPublicStatsService.update always increments the locked expectedVersion once.
    if (saved.version !== command.original!.expectedVersion + 1) throw new OutcomeUnknownError("H9_SAVE_RECEIPT_INVALID");
    return saved;
  }, recovering);
}
