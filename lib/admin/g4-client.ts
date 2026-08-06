import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { assertG4OverviewContract } from "@/lib/admin/g-overview-contract";
import { createStableMutationExecutor, stableMutationFingerprint, stableMutationHttpFailure } from "@/lib/admin/stable-mutation";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

type RawNumber = number | string | null | undefined;

interface BackendStats {
  totalSlots?: RawNumber;
  sold?: RawNumber;
  unitPrice?: RawNumber;
  unsold?: RawNumber;
  soldPct?: RawNumber;
  genesisAccrualUsd?: RawNumber;
  marketOn?: boolean | string | null;
  todayBatch?: string | null;
  secondary?: {
    floor?: RawNumber;
    vol24h?: RawNumber;
    listed?: RawNumber;
    owners?: RawNumber;
    royaltyPct?: RawNumber;
  } | null;
}

interface BackendParam {
  key?: string | null;
  configKey?: string | null;
  name?: string | null;
  sub?: string | null;
  value?: RawNumber;
  displayValue?: string | null;
  note?: string | null;
  b1RedlineTriggered?: boolean | string | null;
  valueType?: string | null;
}

interface BackendDividend {
  dailyVolumeBase?: RawNumber;
  dividendPct?: RawNumber;
  poolToday?: RawNumber;
  perSlotPerDay?: RawNumber;
  floorPerNodePerDay?: RawNumber;
  payoutToday?: RawNumber;
  batchNo?: string | null;
  batchStatus?: string | null;
}

interface BackendMarket {
  enabled?: boolean | string | null;
  configKey?: string | null;
  linkedDomain?: string | null;
  /** 创世市场状态(FEAT-GEN10b)。字段名两端统一 `marketOpenState`(2026-08-05 主人拍板,
   *  与熔断端点 market-status 不撞音);后端未实现时缺省,normalize 落 fail-open "open"。 */
  marketOpenState?: string | null;
  closedNoticeKey?: string | null;
  /** 最近一次市场状态变更摘要(来自服务端审计,如「08-05 14:02 ops-lin 开放→暂未开放:节奏调控」)。 */
  marketLastChange?: string | null;
}

interface BackendGeoBlocked {
  cc?: string | null;
  name?: string | null;
  status?: string | null;
  reason?: string | null;
}

interface BackendNodeFact {
  label?: string | null;
  value?: string | null;
}

interface BackendNodeTransfer {
  time?: string | null;
  event?: string | null;
  royalty?: string | null;
}

interface BackendNode {
  id?: string | null;
  owner?: string | null;
  userNo?: string | null;
  source?: string | null;
  lifetimeDividend?: string | null;
  status?: string | null;
  statusLabel?: string | null;
  statusTone?: string | null;
  buy?: string | null;
  dividends?: BackendNodeFact[] | null;
  transfers?: BackendNodeTransfer[] | null;
}

interface BackendNodePage {
  page?: RawNumber;
  pageSize?: RawNumber;
  total?: RawNumber;
  totalPages?: RawNumber;
  hasPrev?: boolean | string | null;
  hasNext?: boolean | string | null;
}

interface BackendCoverage {
  coverageRatio?: RawNumber;
  redlinePct?: RawNumber;
  redlineBreached?: boolean | string | null;
  precheck?: string | null;
}

interface BackendTier {
  id?: string | null;
  from?: RawNumber;
  to?: RawNumber;
  priceUSDT?: RawNumber;
}

interface BackendOverview {
  domain?: string | null;
  product?: string | null;
  asset?: string | null;
  currentNexPrice?: RawNumber;
  stats?: BackendStats | null;
  params?: BackendParam[] | null;
  dividend?: BackendDividend | null;
  emissionGate?: { configKey?: string | null; open?: boolean | string | null; owner?: string | null } | null;
  market?: BackendMarket | null;
  geoBlocked?: BackendGeoBlocked[] | null;
  nodes?: BackendNode[] | null;
  nodePage?: BackendNodePage | null;
  stateMachine?: string[] | null;
  coverage?: BackendCoverage | null;
  /** 阶梯档位定价(合并底账 §二#1 恢复)。后端未升级时缺席。 */
  tiers?: BackendTier[] | null;
  /** 档表整表版本(区间耦合结构,任一行增删改都递增):三个档位 mutation 以它做 CAS。 */
  tiersVersion?: RawNumber;
  serverCanonical?: boolean | null;
  sources?: string[] | null;
}

export interface G4Stats {
  totalSlots: number;
  sold: number;
  unitPrice: number;
  unsold: number;
  soldPct: number;
  genesisAccrualUsd: number;
  marketOn: boolean;
  todayBatch: string;
  secondary: {
    floor: number;
    vol24h: number;
    listed: number;
    owners: number;
    royaltyPct: number;
  };
}

export interface G4Param {
  key: string;
  configKey: string;
  name: string;
  sub: string;
  value: string;
  displayValue: string;
  note: string;
  b1RedlineTriggered: boolean;
  valueType: string;
}

export interface G4Dividend {
  dailyVolumeBase: number;
  dividendPct: number;
  poolToday: number;
  perSlotPerDay: number;
  floorPerNodePerDay: number;
  payoutToday: number;
  batchNo: string;
  batchStatus: string;
}

export interface G4Market {
  /** 熔断闸:false = 已熔断。恢复只能走 J1。与下面的 marketOpenState **不是**一回事。 */
  enabled: boolean;
  configKey: string;
  linkedDomain: string;
  /** 创世市场状态(规格 FEAT-GEN10b):`closed` = 前端可见但一律不可购买。
   *  运营节奏开关,双向可切(都要确认 + 理由 + 审计),与熔断独立并存。
   *  🔴 字段名两端统一 `marketOpenState`(2026-08-05 主人拍板;此前前端叫 marketStatus、
   *  这里叫 openState,而 marketStatus 在本仓已被熔断端点占名 —— 同名异义必串档)。 */
  marketOpenState: "open" | "closed";
  /** 关闭态文案变体键;取值限于前端白名单,后台不接受自由文本(规格 ③)。 */
  closedNoticeKey: string;
  /** 最近一次市场状态变更摘要(规格 ②/⑤「当前状态 + 最近变更信息」;J1/J2/A3 同款成例)。
   *  空串 = 服务端尚无记录。 */
  lastChange: string;
}

export interface G4GeoBlocked {
  cc: string;
  name: string;
  status: string;
  reason: string;
}

export interface G4NodeFact {
  label: string;
  value: string;
}

export interface G4NodeTransfer {
  time: string;
  event: string;
  royalty: string;
}

export interface G4Node {
  id: string;
  owner: string;
  userNo: string;
  source: string;
  lifetimeDividend: string;
  status: string;
  statusLabel: string;
  statusTone: string;
  buy: string;
  dividends: G4NodeFact[];
  transfers: G4NodeTransfer[];
}

export interface G4NodePage {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export interface G4Coverage {
  coverageRatio: number;
  redlinePct: number;
  redlineBreached: boolean;
  precheck: string;
}

/** 创世阶梯档位:累计售出落在 [from, to) 的购买按 priceUSDT 结算(合并底账 §二#1)。 */
export interface G4Tier {
  id: string;
  from: number;
  to: number;
  priceUSDT: number;
}

export interface G4Overview {
  stats: G4Stats;
  params: G4Param[];
  dividend: G4Dividend;
  emissionGate: { configKey: string; open: boolean; owner: string };
  market: G4Market;
  geoBlocked: G4GeoBlocked[];
  nodes: G4Node[];
  nodePage: G4NodePage;
  stateMachine: string[];
  coverage: G4Coverage;
  /** 阶梯档位。null = 后端未下发或数据坏形 —— 与 marketOpenState 的 fail-open 相反,
   *  档位是编辑对象本身,坏数据上做增删改会写出错档,所以整组判 null、卡片 fail-closed 不给入口。 */
  tiers: G4Tier[] | null;
  /** 档表整表版本:提交增/编/删时作为 expectedTiersVersion 回传,服务端 CAS 拒绝过期提交
   *  (幂等键只防重复,防不了两运营基于旧档表并发互踩 —— 区间耦合结构必须 CAS)。 */
  tiersVersion: number;
  serverCanonical: boolean;
  sources: string[];
}

let requestSeq = 0;

function idempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

const executeG4Mutation = createStableMutationExecutor(idempotencyKey, "nexion-admin-g4-genesis-commands-v1");

function toNumber(value: RawNumber, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,%±,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toBool(value: boolean | string | null | undefined, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "on", "enabled", "enable"].includes(normalized)) return true;
    if (["false", "0", "off", "disabled", "disable"].includes(normalized)) return false;
  }
  return fallback;
}

function asText(value: unknown, fallback = "-") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/** 档位读侧守卫:镜像原型 tiersProblem 的全部区间不变量(整数 / 价>0 / to>from / 区间连续
 *  从 0 起 / id 唯一 / 末档 ≥ 已售)。任一违反 → 整组 null(卡片 fail-closed)+ console.error
 *  留样本 —— 只做字段级校验会让「显示取整、编辑拒存」三处契约互相矛盾,且对乱序/重叠档渲染
 *  假的「顺移」声明。 */
function normalizeTiers(value: BackendTier[] | null | undefined, sold: number): G4Tier[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const reject = (why: string): null => {
    console.error(`[G4] tiers 契约坏形(${why}),整组 fail-closed`, value);
    return null;
  };
  const tiers: G4Tier[] = [];
  const seenIds = new Set<string>();
  let previousTo = 0;
  for (const item of value) {
    if (!item || typeof item !== "object") return reject("行不是对象");
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : null;
    if (!id) return reject("id 缺失");
    if (seenIds.has(id)) return reject(`id 重复 ${id}`);
    seenIds.add(id);
    const from = toNumber(item.from, Number.NaN);
    const to = toNumber(item.to, Number.NaN);
    const priceUSDT = toNumber(item.priceUSDT, Number.NaN);
    if (![from, to, priceUSDT].every(Number.isInteger)) return reject("边界与单价须为整数");
    if (priceUSDT <= 0) return reject("单价须大于 0");
    if (from !== previousTo) return reject("区间不连续(本档起始 ≠ 上档截止)");
    if (to <= from) return reject("截止须大于起始");
    previousTo = to;
    tiers.push({ id, from, to, priceUSDT });
  }
  if (previousTo < sold) return reject(`末档总量 ${previousTo} < 已售 ${sold}`);
  return tiers;
}

function normalizeOverview(data: BackendOverview | null | undefined): G4Overview {
  assertG4OverviewContract(data);
  const stats = data?.stats ?? {};
  const secondary = stats.secondary ?? {};
  const dividend = data?.dividend ?? {};
  const emissionGate = data?.emissionGate ?? {};
  const market = data?.market ?? {};
  const coverage = data?.coverage ?? {};
  const nodes = (data?.nodes ?? []).map((node) => ({
    id: asText(node.id),
    owner: asText(node.owner),
    userNo: asText(node.userNo),
    source: asText(node.source),
    lifetimeDividend: asText(node.lifetimeDividend, ""),
    status: asText(node.status, ""),
    statusLabel: asText(node.statusLabel, asText(node.status, "")),
    statusTone: asText(node.statusTone, "dim"),
    buy: asText(node.buy),
    dividends: (node.dividends ?? []).map((fact) => ({
      label: asText(fact.label),
      value: asText(fact.value),
    })),
    transfers: (node.transfers ?? []).map((transfer) => ({
      time: asText(transfer.time),
      event: asText(transfer.event),
      royalty: asText(transfer.royalty),
    })),
  }));
  const nodePage = data?.nodePage ?? {};
  const pageSize = Math.max(1, Math.trunc(toNumber(nodePage.pageSize, nodes.length || 10)));
  const total = Math.max(0, Math.trunc(toNumber(nodePage.total, nodes.length)));
  const totalPages = Math.max(1, Math.trunc(toNumber(nodePage.totalPages, Math.ceil(total / pageSize) || 1)));
  const page = Math.max(1, Math.min(totalPages, Math.trunc(toNumber(nodePage.page, 1))));
  return {
    stats: {
      totalSlots: toNumber(stats.totalSlots),
      sold: toNumber(stats.sold),
      unitPrice: toNumber(stats.unitPrice),
      unsold: toNumber(stats.unsold),
      soldPct: toNumber(stats.soldPct),
      genesisAccrualUsd: toNumber(stats.genesisAccrualUsd),
      marketOn: toBool(stats.marketOn, false),
      todayBatch: asText(stats.todayBatch, ""),
      secondary: {
        floor: toNumber(secondary.floor),
        vol24h: toNumber(secondary.vol24h),
        listed: toNumber(secondary.listed),
        owners: toNumber(secondary.owners),
        royaltyPct: toNumber(secondary.royaltyPct),
      },
    },
    params: (data?.params ?? []).map((param) => ({
      key: asText(param.key, "unknown"),
      configKey: asText(param.configKey),
      name: asText(param.name, asText(param.key, "参数")),
      sub: asText(param.sub),
      value: String(param.value ?? ""),
      displayValue: asText(param.displayValue, String(param.value ?? "")),
      note: asText(param.note),
      b1RedlineTriggered: toBool(param.b1RedlineTriggered, false),
      valueType: asText(param.valueType, "STRING"),
    })),
    dividend: {
      dailyVolumeBase: toNumber(dividend.dailyVolumeBase),
      dividendPct: toNumber(dividend.dividendPct),
      poolToday: toNumber(dividend.poolToday),
      perSlotPerDay: toNumber(dividend.perSlotPerDay),
      floorPerNodePerDay: toNumber(dividend.floorPerNodePerDay),
      payoutToday: toNumber(dividend.payoutToday),
      batchNo: asText(dividend.batchNo, ""),
      batchStatus: asText(dividend.batchStatus, "ready"),
    },
    emissionGate: {
      configKey: asText(emissionGate.configKey, "growth.phase.genesis_emissions_open"),
      open: toBool(emissionGate.open, false),
      owner: asText(emissionGate.owner, "H1"),
    },
    market: {
      enabled: toBool(market.enabled, false),
      configKey: asText(market.configKey, ""),
      linkedDomain: asText(market.linkedDomain, ""),
      // 🔴 缺省 **open**:后端还没下发这个字段时不该把市场判成关闭 —— 那会让一个
      //   「字段没接」的环境问题表现成「全平台停售」。真关闭必须是显式的 "closed"。
      marketOpenState: asText(market.marketOpenState, "open") === "closed" ? "closed" : "open",
      closedNoticeKey: asText(market.closedNoticeKey, "default"),
      lastChange: asText(market.marketLastChange, ""),
    },
    geoBlocked: (data?.geoBlocked ?? []).map((geo) => ({
      cc: asText(geo.cc),
      name: asText(geo.name),
      status: asText(geo.status),
      reason: asText(geo.reason),
    })),
    nodes,
    nodePage: {
      page,
      pageSize,
      total,
      totalPages,
      hasPrev: toBool(nodePage.hasPrev, page > 1),
      hasNext: toBool(nodePage.hasNext, page < totalPages),
    },
    stateMachine: data?.stateMachine ?? ["minted", "held", "listed", "sold"],
    tiers: normalizeTiers(data?.tiers, toNumber(stats.sold)),
    tiersVersion: Math.max(0, Math.trunc(toNumber(data?.tiersVersion, 0))),
    coverage: {
      coverageRatio: toNumber(coverage.coverageRatio),
      redlinePct: toNumber(coverage.redlinePct),
      redlineBreached: toBool(coverage.redlineBreached, false),
      precheck: asText(coverage.precheck),
    },
    serverCanonical: data?.serverCanonical === true,
    sources: data?.sources ?? [],
  };
}

async function g4Request<T>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await guardedFetch(`/api/admin/market${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) {
      resetAdminSession();
    }
    throw stableMutationHttpFailure(
      formatAdminApiError(result?.message, `G4_REQUEST_FAILED_${response.status}`),
      response.status,
      result?.code,
    );
  }

  return result.data as T;
}

function g4OverviewMutation(
  path: string,
  method: "PATCH" | "POST" | "DELETE",
  body: Record<string, unknown>,
  prefix: string,
) {
  const serialized = JSON.stringify(body);
  return executeG4Mutation(
    prefix,
    stableMutationFingerprint(method, path, serialized),
    (commandKey) => g4Request<BackendOverview>(path, {
      method,
      headers: { "Idempotency-Key": commandKey },
      body: serialized,
    }),
    normalizeOverview,
  );
}

function requireG4Ack(
  value: Record<string, unknown>,
  expected: Record<string, unknown>,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("G4_COMMAND_RESPONSE_INVALID");
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) throw new Error(`G4_COMMAND_RESPONSE_INVALID:${key}`);
  }
  return value;
}

function g4AckMutation(
  path: string,
  method: "PATCH" | "POST" | "DELETE",
  body: Record<string, unknown>,
  prefix: string,
  expected: Record<string, unknown>,
) {
  const serialized = JSON.stringify(body);
  return executeG4Mutation(
    prefix,
    stableMutationFingerprint(method, path, serialized),
    (commandKey) => g4Request<Record<string, unknown>>(path, {
      method,
      headers: { "Idempotency-Key": commandKey },
      body: serialized,
    }),
    (value) => requireG4Ack(value, expected),
  );
}

export async function fetchG4GenesisOverview(page = 1, pageSize = 10) {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  return normalizeOverview(await g4Request<BackendOverview>(`/nex/genesis?${query.toString()}`));
}

export async function updateG4GenesisParam(paramKey: string, value: string, reason: string, operator: string, decisionRef?: string) {
  return g4OverviewMutation(
    `/nex/genesis/params/${encodeURIComponent(paramKey)}`,
    "PATCH",
    { value, reason, operator, decisionRef },
    `g4-param-${paramKey}`,
  );
}

export async function updateG4GenesisMarketStatus(enabled: boolean, reason: string, operator: string, context?: { dispositionPlan?: string; triggerBasis?: string }) {
  return g4OverviewMutation(
    "/nex/genesis/market-status",
    "PATCH",
    { value: String(enabled), reason, operator, dispositionPlan: context?.dispositionPlan, triggerBasis: context?.triggerBasis },
    "g4-market-status",
  );
}

/**
 * 创世市场状态开关(规格 FEAT-GEN10b)。`open` ⇄ `closed`,两个方向都要确认 + 理由 + 审计。
 *
 * 🔴 **与熔断(`updateG4GenesisMarketStatus`)是两件事,不许合并**(规格 ④ 明写):
 *   - 市场状态 = 运营节奏,可双向切,前端表现为「可见但不可购买」;
 *   - 熔断     = 止血动作,恢复入口只在 J1,前端表现为整条链停。
 *   两者可同时存在;哪一个在生效由前端按优先级链取最高(市场关闭 > 熔断),
 *   后台页面须明示当前实际生效来源,免得运营切回开放却以为已恢复销售。
 *
 * `noticeKey` 只能取前端白名单内的文案变体键,不接受自由文本(规格 ③)。
 */
export async function updateG4GenesisMarketOpenState(
  status: "open" | "closed",
  reason: string,
  operator: string,
  noticeKey?: string,
) {
  return g4OverviewMutation(
    "/nex/genesis/market-open-state",
    "PATCH",
    { value: status, reason, operator, noticeKey },
    "g4-market-open-state",
  );
}

/**
 * 阶梯档位定价三动作(合并底账 §二#1 恢复)。区间连续性(本档起始 = 上档截止)、
 * 末档总量 ≥ 已售、至少保留一档、在锁购买按开锁档价结算 —— 全部由服务端权威校验与执行,
 * 本端只提交命令 + 理由;三动作均走 g4OverviewMutation(稳定幂等键 + 回读全量 overview)。
 * 契约要点:①新档 id 由服务端分配且须历史全局唯一(原型语义 t{历史最大号+1}——删中间档
 * 再增档不得复用旧号,否则审计轨与在途引用会串档);②三动作都带 expectedTiersVersion 做
 * 整表 CAS(区间耦合:删/改会顺移邻档,基于旧档表的提交必须被拒,幂等键防不了这个);
 * ③增档扩大总供应 = 放大远期排放负债,服务端应做 B1 覆盖率预检并越线整单拒绝。
 */
export async function createG4GenesisTier(to: number, priceUSDT: number, expectedTiersVersion: number, reason: string, operator: string) {
  return g4OverviewMutation(
    "/nex/genesis/tiers",
    "POST",
    { to, priceUSDT, expectedTiersVersion, reason, operator },
    "g4-tier-create",
  );
}

export async function updateG4GenesisTier(tierId: string, to: number, priceUSDT: number, expectedTiersVersion: number, reason: string, operator: string) {
  return g4OverviewMutation(
    `/nex/genesis/tiers/${encodeURIComponent(tierId)}`,
    "PATCH",
    { to, priceUSDT, expectedTiersVersion, reason, operator },
    `g4-tier-update-${tierId}`,
  );
}

export async function deleteG4GenesisTier(tierId: string, expectedTiersVersion: number, reason: string, operator: string) {
  return g4OverviewMutation(
    `/nex/genesis/tiers/${encodeURIComponent(tierId)}`,
    "DELETE",
    { expectedTiersVersion, reason, operator },
    `g4-tier-delete-${tierId}`,
  );
}

export async function rerunG4GenesisDividendBatch(batchNo: string, reason: string, operator: string, decisionRef?: string) {
  return g4OverviewMutation(
    `/nex/genesis/dividend-batches/${encodeURIComponent(batchNo)}/rerun`,
    "POST",
    { value: "rerun", reason, operator, decisionRef },
    `g4-rerun-${batchNo}`,
  );
}

export interface G4AdminSimulation {
  id: number;
  simulationNo: string;
  side: "BUY" | "SELL";
  quantity: number | string;
  unitPrice: number | string;
  notional: number | string;
  reason: string;
  operator: string;
  recordType: "SIMULATED";
  status: string;
  createdAt: string;
}

export interface G4AdminOperationsOverview {
  config: Record<string, string | null>;
  simulations: G4AdminSimulation[];
  simulationScope: "ADMIN_ONLY";
  ledgerImpact: "NONE";
  includedInMarketStats: false;
}

export function fetchG4AdminOperations() {
  return g4Request<G4AdminOperationsOverview>("/nex/genesis/operations");
}

export function updateG4AdminOperationConfig(
  key: string,
  value: string,
  reason: string,
  operator: string,
  expectedValue: string,
) {
  return g4AckMutation(
    `/nex/genesis/operations/config/${encodeURIComponent(key)}`,
    "PATCH",
    { value, reason, operator, expectedValue },
    `g4-ops-config-${key}`,
    { key, value, status: "UPDATED" },
  );
}

export function createG4AdminSimulation(side: "BUY" | "SELL", quantity: string, unitPrice: string, reason: string, operator: string) {
  return g4AckMutation(
    "/nex/genesis/operations/simulations",
    "POST",
    { side, quantity, unitPrice, reason, operator },
    "g4-admin-simulation",
    { recordType: "SIMULATED", scope: "ADMIN_ONLY", ledgerImpact: "NONE" },
  );
}

export function archiveG4AdminSimulation(id: number, reason: string, operator: string) {
  return g4AckMutation(
    `/nex/genesis/operations/simulations/${id}`,
    "DELETE",
    { value: "ARCHIVED", reason, operator },
    `g4-admin-simulation-archive-${id}`,
    { id, status: "ARCHIVED" },
  );
}
