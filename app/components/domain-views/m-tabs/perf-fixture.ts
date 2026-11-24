/**
 * 客服业绩额的开发夹具（集中在这一个文件）。后端新合同（B80）还没交付，页面上新口径的状态只能靠它打开截图和走查。
 * 接线时（Codex 按后端核定的合同）把这个文件和各页标「接线删：夹具」的几行一起删掉。
 *
 * 开关：只有构建时设了 NEXT_PUBLIC_SUPPORT_PERF_FIXTURE=1 才可能生效；正常构建里 ENABLED 恒为 false，perfFixture() 恒返回 null，
 * 页面走生产路径：照旧发旧请求，新口径一律显示「业绩数据暂不可用」。
 * 生效时在浏览器 localStorage 写「nexion-dev-support-perf-fixture」选状态，例如
 *   {"m6":"ready"}、{"m6":"provisional"}、{"m1":"supervisor","export":"5a"}（导出和审批见 ExportScenario）
 * 夹具开着时，打开了夹具的那一块不发读请求（数据全部来自这里），写操作只在内存里造回包，不发请求。
 *
 * 数字只用交接 §5 和「验收修订」的样本（A、B、F、G、H），同一块画板里的数互相对得上；状态只造后端合同能产生的。
 */
import type { LeaderboardDetail, LeaderboardPage, LeaderboardQuery } from "@/lib/admin/support-leaderboard-client";
import type { SupportBoardKey, SupportBoardMovement, SupportBoardRow } from "./support-leaderboard";
import type { SupportAnalyticsAgent, SupportAnalyticsCustomer, SupportAnalyticsMonth, SupportAnalyticsQuery, SupportAnalyticsResponse } from "@/lib/admin/support-analytics-client";
import { SupportClientError } from "@/lib/admin/m-support-client";
import type { SupportProfile } from "@/lib/admin/m-support-enhancements";
import { EXPORT_TYPES, ExportOutcomeUnknownError, type AnalyticsPerf, type DecisionLookup, type ExportCheck, type ExportChoice, type ExportColumns, type ExportDialogData, type ExportItem, type ExportPersona, type ExportQuery, type ExportSubmitted, type ExportTask, type ExportType, type PendingDecision, type PerfExportPorts, type PerfTotals, type PerfValue } from "./perf-view";

const ENABLED = process.env.NEXT_PUBLIC_SUPPORT_PERF_FIXTURE === "1";
const STORAGE_KEY = "nexion-dev-support-perf-fixture";

export type PerfFixture = {
  /** 业绩榜：ready 是样本 H 的正式一版（14:20）；provisional 是样本 G 那一类入金没核完的一版（09:00）。 */
  m6?: "ready" | "provisional";
  /** 客服工作台：样本和账号角色，见 M1FixtureKind。 */
  m1?: M1FixtureKind;
  /** 客户资料：B 是样本 B 的客户林*（客服工作台和专属会话里打开的客户资料都换成它）。 */
  profile?: "B";
  /** 数据很长：客服名、组名、客户名换成长的，看省略和折行（数字不变）。 */
  long?: boolean;
  /** 导出和审批的状态，见 ExportScenario。 */
  export?: ExportScenario;
  /** 下一次写操作的回包：被拒或结果未知。 */
  write?: "rejected" | "unknown";
  /** 「查询原操作」查到什么。 */
  lookup?: DecisionLookup["kind"];
};

export function perfFixture(): PerfFixture | null {
  if (!ENABLED || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as PerfFixture : null;
  } catch {
    return null;
  }
}

/* ---------------- 共用 ---------------- */

const LONG = { agent: "Nguyen Thi Thanh Huong Wang Ke", group: "华东大区第三专属服务小组（夜班）", customer: "星河万里一路向前的阿杰Official旗舰团队" };
const longOn = () => perfFixture()?.long === true;

const done = (value: string): PerfValue => ({ state: "complete", value });
const totals = (amount: string, inflow: string, withdrawal: string): PerfTotals => ({ amount: done(amount), inflow: done(inflow), withdrawal: done(withdrawal) });
const VERSION = "slb-v1:" + "0".repeat(56) + "5f1c2026";
/** 14:20、09:00 北京时间。 */
const AS_OF = { ready: "2026-11-24T06:20:00Z", provisional: "2026-11-24T01:00:00Z" } as const;

/* ---------------- 业绩榜（样本 H：30、10、10、-5；样本 G：Chen Jiayi 的越南银行卡充值没核完） ---------------- */

type Agent = { key: string; name: string; group: string; perf: PerfTotals; first: number | null; customers: number; movement: SupportBoardMovement };
const SAME: SupportBoardMovement = { kind: "same", explanation: "" };
function agents(selfId: string, kind: "ready" | "provisional"): Agent[] {
  const chen: Agent = kind === "ready"
    ? { key: "1002", name: "Chen Jiayi", group: "华南专属服务组", perf: totals("10", "10", "0"), first: 1, customers: 2, movement: { kind: "up", places: 1, explanation: "" } }
    : { key: "1002", name: "Chen Jiayi", group: "华南专属服务组", perf: { amount: { state: "partial", observed: "0", missing: "待核" }, inflow: { state: "partial", observed: "0", missing: "待核" }, withdrawal: done("0") }, first: null, customers: 2, movement: SAME };
  return [
    { key: "1001", name: "Lin Ruoxi", group: "华南专属服务组", perf: totals("30", "70", "40"), first: 1, customers: 3, movement: SAME },
    chen,
    { key: selfId, name: longOn() ? LONG.agent : "Wang Ke", group: longOn() ? LONG.group : "华东专属服务组", perf: totals("10", "60", "50"), first: 1, customers: 4, movement: SAME },
    { key: "1004", name: "Liu Siyu", group: "华东专属服务组", perf: totals("-5", "0", "5"), first: 0, customers: 2, movement: { kind: "down", places: 1, explanation: "" } },
  ];
}
function metric(agent: Agent, board: SupportBoardKey): number | null {
  if (board === "firstPayment") return agent.first;
  if (board === "customers") return agent.customers;
  return agent.perf.amount.state === "complete" ? Number(agent.perf.amount.value) : null;
}

export type BoardFixture = { page: LeaderboardPage; perf: Record<string, PerfTotals> };

export function leaderboardFixture(kind: "ready" | "provisional", q: LeaderboardQuery, selfId: string): BoardFixture {
  const list = agents(selfId, kind);
  const provisional = kind === "provisional";
  // 名次按精确值从高到低，相同的并列、下一名跳过；没核完的排最后（合同 §2.2：空值置末）。
  const sorted = [...list].sort((a, b) => (metric(b, q.board) ?? -Infinity) - (metric(a, q.board) ?? -Infinity) || list.indexOf(a) - list.indexOf(b));
  const ranks = new Map<string, number>();
  sorted.forEach((agent, index) => { const value = metric(agent, q.board), previous = sorted[index - 1]; ranks.set(agent.key, previous && metric(previous, q.board) === value ? ranks.get(previous.key)! : index + 1); });
  const tied = (agent: Agent) => sorted.filter(other => metric(other, q.board) === metric(agent, q.board)).length > 1;
  const count = (value: number | null) => value === null ? { value: null, coverage: "partial" as const, reason: "待核" } : { value: String(value), coverage: "complete" as const, reason: "" };
  const row = (agent: Agent): SupportBoardRow => ({
    id: agent.key, name: agent.name, groupName: agent.group, qualification: "ACTIVE",
    rank: provisional ? null : ranks.get(agent.key)!, isTied: !provisional && tied(agent), rankStatus: provisional ? "provisional" : "confirmed",
    amount: { value: null, coverage: "unavailable", reason: "", currency: "USDT", periodLabel: "2026-11", sourceVersion: "fixture" },
    firstPayment: count(agent.first), customers: count(agent.customers),
    movement: provisional ? { kind: "unavailable", explanation: "这一版不排名次" } : q.board === "netContribution" ? agent.movement : SAME,
    canViewCustomers: agent.key === selfId,
  });
  const keyword = q.keyword?.trim();
  const matched = sorted.filter(agent => !keyword || agent.name.toLowerCase().includes(keyword.toLowerCase()) || agent.key === keyword);
  const pageSize = q.pageSize ?? 20, pageNum = q.pageNum ?? 1;
  const rows = matched.slice((pageNum - 1) * pageSize, pageNum * pageSize).map(row);
  const self = list.find(agent => agent.key === selfId)!;
  const selfIndex = sorted.indexOf(self);
  const ahead = !provisional && selfIndex > 0 ? sorted.slice(0, selfIndex).reverse().find(agent => (metric(agent, q.board) ?? 0) > (metric(self, q.board) ?? 0)) : undefined;
  const gap = ahead ? String((metric(ahead, q.board) ?? 0) - (metric(self, q.board) ?? 0)) : null;
  const winners = provisional ? [] : sorted.filter(agent => ranks.get(agent.key)! <= 3).slice(0, 4).map(row);
  const asOf = AS_OF[kind];
  const page: LeaderboardPage = {
    viewVersion: VERSION, queryVersion: VERSION, sourceVersion: "fixture", definitionVersion: "NET_INFLOW_V1",
    board: q.board, rankMonth: q.board === "customers" ? null : "2026-11", referenceMonth: "2026-11", currency: "USDT", scope: "all",
    businessZone: "Asia/Shanghai", asOf, publishedAt: asOf, state: provisional ? "PROVISIONAL" : "COMPLETE", candidateCoverage: "COMPLETE", stale: false, refreshFailed: false,
    selectableMonths: ["2026-11"], currencies: ["USDT"], scopeOptions: [{ scope: "all", groups: [] }],
    total: list.length, ranked: provisional ? 0 : list.length, unranked: provisional ? list.length : 0, matched: matched.length, pageNum, pageSize, rows,
    self: { row: row(self), gap, reason: !provisional && ranks.get(self.key) === 1 ? "已达到榜首成绩" : "", pageNum: Math.floor(selfIndex / pageSize) + 1 },
    podium: { total: winners.length, rows: winners },
  };
  return { page, perf: Object.fromEntries(list.map(agent => [agent.key, agent.perf])) };
}

export function leaderboardDetailFixture(fixture: BoardFixture, agentId: string): LeaderboardDetail | undefined {
  const { page } = fixture;
  const row = [...page.rows, ...(page.podium?.rows ?? []), ...(page.self.row ? [page.self.row] : [])].find(item => item.id === agentId);
  if (!row) return undefined;
  const { total: _t, ranked: _r, unranked: _u, matched: _m, pageNum: _p, pageSize: _s, rows: _rows, self: _self, podium: _podium, ...meta } = page;
  return { ...meta, row };
}

/* ---------------- 客服工作台（样本 A、F、G、H） ---------------- */

/** 客服工作台的样本：agentA 是专属客服 Xu Jia 的样本 A（2a、2b），agentG 是同一个月 09:00 有一类入金没核完（2c）；
 * agentB 是专属客服 Sun Qing 的样本 B（4，两类直付和银行卡充值）；agentEmpty 是新来的专属客服 He Tian，这个月还没有记录（5f）；supervisor 是华东主管 Zhou Ming（3b、3c、3g），super 是超级管理员（3a、3e、3f），nogroup 是没有负责组的主管 Zhao Min（3d）。 */
export type M1FixtureKind = "agentA" | "agentG" | "agentB" | "agentEmpty" | "supervisor" | "super" | "nogroup";

type Resp = SupportAnalyticsResponse;
type Cnt = Resp["selectedCurrent"]["firstConfirmed"];
type Money = Resp["selectedCurrent"]["ownLifetime"][number]["deposits"];
type Current = Resp["selectedCurrent"];
type Summary = Resp["scopeSummary"];
type Customer = SupportAnalyticsCustomer;
type AgentRow = SupportAnalyticsAgent;
const cnt = (n: number | null): Cnt => ({ observed: n, confirmed: n, status: n === null ? "UNKNOWN" : "AVAILABLE" });
const money = (v: string | null): Money => ({ observed: v, confirmed: v, observedEvents: null, confirmedEvents: null, observedCustomers: null, status: v === null ? "UNKNOWN" : "AVAILABLE" });
const noNet = (): Money => ({ observed: null, confirmed: null, observedEvents: null, confirmedEvents: null, observedCustomers: null, status: "UNKNOWN" });
const lifetime = (deposits: string | null = "0") => (["USDT", "UVT"] as const).map(currency => ({ currency, deposits: money(currency === "USDT" ? deposits : "0"), purchases: money("0"), net: noNet() }));
function current(o: { first: number; none: number; devices: number; active: number; inactive: number; deposits?: string }): Current {
  return { lifetimeBasis: "CURRENT_CUSTOMER_HISTORY", status: "AVAILABLE", ownLifetime: lifetime(o.deposits ?? "0"), firstConfirmed: cnt(o.first), firstNone: cnt(o.none), firstUnknown: cnt(0),
    devices: { held: cnt(o.devices), unknownHolding: cnt(0), status: "AVAILABLE", partitions: [] },
    activity: { active: cnt(o.active), inactive: cnt(o.inactive), unknown: cnt(0), status: "AVAILABLE", window: { days: 30, from: null, through: null, status: "AVAILABLE" } } };
}
function financial(first: number | null): Summary["financial"] {
  return { status: first === null ? "PARTIAL" : "AVAILABLE", firstCandidates: cnt(first), currencies: (["USDT", "UVT"] as const).map(currency => ({ currency, deposits: money("0"), purchases: money("0"), purchaseRefunds: money("0"), net: noNet() })), firstSources: (["USDT", "UVT"] as const).map(currency => ({ currency, deposits: money("0"), purchases: money("0") })) };
}
function personnel(service: number, supervisors = 0, groups = 0): Summary["personnel"] {
  return { status: "AVAILABLE", serviceAccounts: cnt(service), groupMembers: cnt(service), supervisors: cnt(supervisors), people: cnt(service + supervisors), groups: cnt(groups), partitions: [] };
}
const NO_FUNDS = { balanceStatus: "UNAVAILABLE" as const, withdrawalStatus: "UNAVAILABLE" as const };
const QV = "saq-v1:" + "0".repeat(56) + "5f1c2026";

type CustomerSeed = { id: string; no: string; name: string; agent?: [string, string, string]; first: "DEPOSIT" | "DEVICE_PURCHASE" | "NONE" | "UNKNOWN"; last: string; active: boolean; task: "normal" | "waiting" | "due"; perf: PerfValue };
function customer(seed: CustomerSeed): Customer {
  const profileRef = `/api/admin/content/support-workbench/customers/${seed.id}`;
  const confirmed = seed.first === "DEPOSIT" || seed.first === "DEVICE_PURCHASE";
  return {
    customerId: seed.id, customerNo: seed.no, nickname: seed.name, avatar: null, level: null, customTags: [], systemTags: [], systemTagsStatus: "PARTIAL", profileRef,
    registeredAt: "2026-11-01T02:00:00Z", assignedAt: "2026-11-02T02:00:00Z", category: "BOUND", placement: "GROUPED", handoverRequired: false,
    owner: { agentId: seed.agent?.[0] ?? null, groupId: seed.agent?.[2] ?? null, agentName: seed.agent?.[1] ?? null, advisorAvatar: null, advisorAvatarRef: null },
    first: { state: confirmed ? "CONFIRMED" : seed.first === "NONE" ? "NONE" : "UNKNOWN", status: seed.first === "UNKNOWN" ? "PARTIAL" : "AVAILABLE", kind: confirmed ? seed.first as "DEPOSIT" | "DEVICE_PURCHASE" : null, currency: confirmed ? "USDT" : null, amount: null, succeededAt: confirmed ? "2026-11-21T02:05:00Z" : null },
    lifetime: lifetime(), lifetimeStatus: "AVAILABLE",
    invitations: { direct: cnt(0), descendants: cnt(0), status: "AVAILABLE", deposits: [] },
    activity: { state: seed.active ? "ACTIVE" : "INACTIVE", status: "AVAILABLE", lastEffectiveAt: seed.last },
    devices: { held: cnt(0), unknownHolding: cnt(0), status: "AVAILABLE", partitions: [] },
    task: { status: "COMPLETE", enabled: true, due: seed.task === "due", waitingReply: seed.task === "waiting", firstContact: false, nextDueAt: seed.task === "due" ? "2026-11-24T02:00:00Z" : null, waitingSinceAt: seed.task === "waiting" ? "2026-11-24T03:10:00Z" : null },
    funds: NO_FUNDS,
  };
}
function agentRow(id: string, name: string, groupId: string, o: { bound: number; active: number; devices: number }): AgentRow {
  return { accountId: id, displayName: name, avatar: null, avatarRef: null,
    account: { serviceAccount: true, supervisorAccount: false, serviceCategoryStatus: "AVAILABLE", supervisorCategoryStatus: "AVAILABLE", accountState: "ENABLED", serviceQualification: "ENABLED", supervisorQualification: "UNKNOWN", receptionEligibility: "ENABLED", memberState: "GROUPED", groupId, handoverRequired: false, status: "AVAILABLE" },
    current: current({ first: 0, none: o.bound, devices: o.devices, active: o.active, inactive: o.bound - o.active }), funds: NO_FUNDS };
}

/** 2026-11-20 22:57:06.829277（北京时间）是正式首月的起点；当前月截至 14:20。 */
const MONTHS: SupportAnalyticsMonth[] = [{ month: "2026-11", from: "2026-11-20T14:57:06.829277Z", to: "2026-11-30T16:00:00Z" }];
const SUPER_AGENTS: Record<string, [string, string, string]> = { wang: ["2003", "Wang Ke", "301"], liu: ["2004", "Liu Siyu", "301"] };

type FixtureWorld = { mode: Summary["mode"]; asOf: string; customers: CustomerSeed[]; agents: AgentRow[]; groups: Summary["groups"]; bound: number; scopeCurrent: Current; personnel: Summary["personnel"]; first: number | null };
/** 客服工作台的统计截至取打开页面的那一分钟：超过 2 分钟页面会写「统计更新延迟」，夹具不造这个状态。 */
function fixtureNow() { return new Date(Math.floor(Date.now() / 60000) * 60000).toISOString().replace(".000Z", "Z"); }
function world(kind: M1FixtureKind): FixtureWorld {
  const asOf = fixtureNow();
  if (kind === "agentB") {
    const customers: CustomerSeed[] = [
      { id: "40000001", no: "U40000001", name: "黄*", first: "DEVICE_PURCHASE", last: "2026-11-21T03:20:00Z", active: true, task: "normal", perf: done("50") },
      { id: "40000002", no: "U40000002", name: "林*", first: "DEVICE_PURCHASE", last: "2026-11-22T06:10:00Z", active: true, task: "waiting", perf: done("100") },
    ];
    return { mode: "PERSONAL", asOf, customers, agents: [], groups: [], bound: 2, scopeCurrent: current({ first: 2, none: 0, devices: 2, active: 2, inactive: 0, deposits: "20" }), personnel: personnel(1), first: 2 };
  }
  if (kind === "agentEmpty") return { mode: "PERSONAL", asOf, customers: [], agents: [], groups: [], bound: 0, scopeCurrent: current({ first: 0, none: 0, devices: 0, active: 0, inactive: 0 }), personnel: personnel(1), first: 0 };
  if (kind === "agentA" || kind === "agentG") {
    const partial = kind === "agentG";
    const customers: CustomerSeed[] = [
      { id: "20000001", no: "U20000001", name: "陈*", first: "DEPOSIT", last: "2026-11-22T07:40:00Z", active: true, task: "normal", perf: done("60") },
      { id: "20000002", no: "U20000002", name: "李*", first: partial ? "UNKNOWN" : "DEPOSIT", last: "2026-11-22T01:30:00Z", active: true, task: "waiting", perf: partial ? { state: "partial", observed: "0", missing: "缺越南银行卡充值" } : done("70") },
      { id: "20000004", no: "U20000004", name: "赵*", first: "DEVICE_PURCHASE", last: "2026-11-21T10:30:00Z", active: true, task: "normal", perf: done("0") },
    ];
    return { mode: "PERSONAL", asOf, customers, agents: [], groups: [], bound: 3, scopeCurrent: current({ first: 3, none: 0, devices: 1, active: 3, inactive: 0 }), personnel: personnel(1), first: partial ? null : 4 };
  }
  const east = "301", south = "302";
  const group = (groupId: string, name: string, total: number, devices: number): Summary["groups"][number] =>
    ({ groupId, name, total, current: current({ first: 2, none: total - 2, devices, active: 3, inactive: total - 3 }), period: financial(2), personnel: personnel(2) });
  const supervisorCustomers: CustomerSeed[] = [
    { id: "30000001", no: "U30000001", name: "周*", agent: SUPER_AGENTS.wang, first: "DEPOSIT", last: "2026-11-23T13:05:00Z", active: true, task: "normal", perf: done("30") },
    { id: "30000002", no: "U30000002", name: "吴*", agent: SUPER_AGENTS.wang, first: "DEVICE_PURCHASE", last: "2026-11-23T08:40:00Z", active: true, task: "waiting", perf: done("10") },
    { id: "30000003", no: "U30000003", name: "郑*", agent: SUPER_AGENTS.wang, first: "NONE", last: "2026-11-18T02:12:00Z", active: false, task: "normal", perf: done("0") },
    { id: "30000004", no: "U30000004", name: "冯*", agent: SUPER_AGENTS.wang, first: "NONE", last: "2026-11-15T01:30:00Z", active: false, task: "due", perf: done("0") },
    { id: "30000006", no: "U30000006", name: "孙*", agent: SUPER_AGENTS.liu, first: "NONE", last: "2026-11-19T12:02:00Z", active: false, task: "normal", perf: done("0") },
    { id: "30000005", no: "U30000005", name: "钱*", agent: SUPER_AGENTS.liu, first: "DEPOSIT", last: "2026-11-22T03:18:00Z", active: true, task: "normal", perf: done("-5") },
  ];
  const agents = [agentRow("2003", "Wang Ke", east, { bound: 4, active: 2, devices: 5 }), agentRow("2004", "Liu Siyu", east, { bound: 2, active: 1, devices: 2 })];
  if (kind === "supervisor") return { mode: "MANAGED", asOf, customers: supervisorCustomers, agents, groups: [group(east, "华东专属服务组", 6, 7)], bound: 6, scopeCurrent: current({ first: 3, none: 3, devices: 7, active: 3, inactive: 3 }), personnel: personnel(2, 1, 1), first: 2 };
  return { mode: "ALL", asOf, customers: supervisorCustomers, agents, groups: [group(south, "华南专属服务组", 5, 5), group(east, "华东专属服务组", 6, 7)], bound: 11, scopeCurrent: current({ first: 5, none: 6, devices: 12, active: 6, inactive: 5 }), personnel: personnel(4, 2, 2), first: 4 };
}

function response(input: FixtureWorld, q: SupportAnalyticsQuery): Resp {
  let w = input;
  const view = q.view, basis = q.basis ?? "CURRENT_CUSTOMER_HISTORY", pageSize = q.pageSize ?? 20;
  if (longOn()) {
    w = { ...w, customers: w.customers.map((seed, index) => index === 0 ? { ...seed, name: LONG.customer, agent: seed.agent ? [seed.agent[0], LONG.agent, seed.agent[2]] : undefined } : seed),
      agents: w.agents.map((row, index) => index === 0 ? { ...row, displayName: LONG.agent } : row), groups: w.groups.map((group, index) => index === w.groups.length - 1 ? { ...group, name: LONG.group } : group) };
  }
  const groupId = q.groupId === undefined ? undefined : String(q.groupId);
  const agentId = q.agentId === undefined ? undefined : String(q.agentId);
  const keyword = q.keyword?.trim();
  const customers = w.customers.filter(seed => (!groupId || seed.agent?.[2] === groupId) && (!agentId || seed.agent?.[0] === agentId) && (!keyword || seed.name.includes(keyword) || seed.no.includes(keyword)));
  const agents = w.agents.filter(row => (!groupId || row.account.groupId === groupId) && (!keyword || (row.displayName ?? "").includes(keyword)));
  const records = view === "AGENTS" ? agents : view === "OVERVIEW" || view === "CUSTOMERS" || view === "ACTIVITY" ? customers.map(customer) : [];
  const shown = view === "OVERVIEW" ? records.slice(0, pageSize) : records;
  const summary: Summary = { mode: w.mode, total: w.bound, bound: w.bound, pending: 0, anomaly: 0, status: "AVAILABLE", current: w.scopeCurrent, financial: financial(w.first), restrictedSummary: { customers: cnt(0), firstCandidates: cnt(0) }, personnel: w.personnel, groups: w.groups };
  const meta = { basis, businessZone: "Asia/Shanghai" as const, asOf: w.asOf, pageNum: 1, pageSize, total: records.length, observedTotal: records.length, versionState: "READY" as const, queryVersion: QV, canContinue: false, recordsStatus: "READY" as const,
    selectedCustomerCount: customers.length, selectedCurrent: w.scopeCurrent, scopeSummary: summary, funds: { ...NO_FUNDS, groups: [] } };
  if (view === "AGENTS") return { ...meta, recordsStatus: "AVAILABLE", view, records: agents };
  if (view === "FINANCE") return { ...meta, total: 0, observedTotal: 0, view, records: [] };
  if (view === "DEVICES") return { ...meta, total: 0, observedTotal: 0, view, records: [] };
  return { ...meta, view, records: shown as Customer[] };
}

/** 夹具开着时客服工作台用它代替读取：形状和 supportAnalyticsClient 的 query、months 一样，不发请求。 */
export function analyticsFixtureClient(kind: M1FixtureKind) {
  const w = world(kind);
  return {
    // 没有负责组、也没有本人客户的主管：后端按现有语义拒绝（403），页面显示「没有可看的内容」。
    query: async (q: SupportAnalyticsQuery): Promise<Resp> => { if (kind === "nogroup") throw new SupportClientError(403, undefined, undefined); return response(w, q); },
    months: async (): Promise<SupportAnalyticsMonth[]> => MONTHS,
  };
}

const usdt = (value: string) => done(value);
const amountDash: PerfValue = { state: "partial", observed: null, missing: "待核" };
/** 客服工作台各处的业绩额样本，和 analyticsFixtureClient 同一份世界里的人和客户对得上。 */
export function analyticsPerfFixture(kind: M1FixtureKind): AnalyticsPerf {
  const w = world(kind);
  const customers = Object.fromEntries(w.customers.map(seed => [seed.id, seed.perf]));
  if (kind === "agentB") return {
    period: {
      totals: totals("150", "150", "0"), first: { state: "complete", value: 2 }, firstSplit: { deposits: 0, purchases: 2 },
      inflow: [{ label: "链上充值", value: usdt("0") }, { label: "越南银行卡充值", value: usdt("20") }, { label: "链上购机直付", value: usdt("50") }, { label: "银行卡购机直付", value: usdt("80") }, { label: "其中本期更正", value: usdt("0"), sub: true }],
      withdrawals: ["TRC20", "BEP20", "ERC20", "越南银行卡"].map(label => ({ label, walletDebited: usdt("0"), fee: usdt("0"), received: usdt("0") })),
    },
    customers, agents: {}, groups: {}, scope: { period: totals("150", "150", "0"), current: usdt("150") },
  };
  if (kind === "agentEmpty") return {
    period: {
      totals: totals("0", "0", "0"), first: { state: "complete", value: 0 }, firstSplit: { deposits: 0, purchases: 0 },
      inflow: [...["链上充值", "越南银行卡充值", "链上购机直付", "银行卡购机直付"].map(label => ({ label, value: usdt("0") })), { label: "其中本期更正", value: usdt("0"), sub: true }],
      withdrawals: ["TRC20", "BEP20", "ERC20", "越南银行卡"].map(label => ({ label, walletDebited: usdt("0"), fee: usdt("0"), received: usdt("0") })),
    },
    customers, agents: {}, groups: {}, scope: { period: totals("0", "0", "0"), current: usdt("0") },
  };
  if (kind === "agentA" || kind === "agentG") {
    const partial = kind === "agentG";
    const vn: PerfValue = partial ? amountDash : usdt("70");
    return {
      period: {
        totals: partial
          ? { amount: { state: "partial", observed: "10", missing: "缺越南银行卡充值" }, inflow: { state: "partial", observed: "200", missing: "缺越南银行卡充值" }, withdrawal: usdt("190") }
          : totals("80", "270", "190"),
        first: partial ? { state: "partial", observed: null, missing: "缺越南银行卡充值" } : { state: "complete", value: 4 },
        firstSplit: partial ? undefined : { deposits: 3, purchases: 1 },
        inflow: [
          { label: "链上充值", value: usdt("200") }, { label: "越南银行卡充值", value: vn },
          { label: "链上购机直付", value: usdt("0") }, { label: "银行卡购机直付", value: usdt("0") },
          { label: "其中本期更正", value: usdt("0"), sub: true },
        ],
        withdrawals: [
          { label: "TRC20", walletDebited: usdt("0"), fee: usdt("0"), received: usdt("0") },
          { label: "BEP20", walletDebited: usdt("40"), fee: usdt("2"), received: usdt("38") },
          { label: "ERC20", walletDebited: usdt("0"), fee: usdt("0"), received: usdt("0") },
          { label: "越南银行卡", walletDebited: usdt("150"), fee: usdt("3"), received: usdt("147") },
        ],
      },
      events: partial ? undefined : {
        from: MONTHS[0].from, to: fixtureNow(),
        total: { amount: usdt("80"), count: 9, customers: 4 },
        visible: { amount: usdt("130"), count: 6, customers: 3 },
        restricted: { amount: usdt("-50"), count: 3, customers: 1 },
        rows: [
          { id: "e6", at: "2026-11-22T07:40:00Z", customer: "陈*", customerNo: "U20000001", kind: "提现", detail: "BEP20 · 手续费 2 · 到手 38", business: "40 USDT", delta: "-40" },
          { id: "e5", at: "2026-11-22T01:30:00Z", customer: "李*", customerNo: "U20000002", kind: "充值", detail: "越南银行卡 · 原币越南盾，见导出", business: null, delta: "70" },
          { id: "e4", at: "2026-11-21T10:30:00Z", customer: "赵*", customerNo: "U20000004", kind: "买设备", detail: "用余额 · 参考，不计", business: "50 USDT", delta: "0" },
          { id: "e3", at: "2026-11-21T10:00:00Z", customer: "赵*", customerNo: "U20000004", kind: "奖励到账", detail: "参考，不计", business: "50 USDT", delta: "0" },
          { id: "e2", at: "2026-11-21T02:20:00Z", customer: "陈*", customerNo: "U20000001", kind: "买设备", detail: "用余额 · 参考，不计", business: "60 USDT", delta: "0" },
          { id: "e1", at: "2026-11-21T02:05:00Z", customer: "陈*", customerNo: "U20000001", kind: "充值", detail: "链上", business: "100 USDT", delta: "100" },
        ],
      },
      customers, agents: {}, groups: {},
      scope: { period: { amount: usdt("80"), inflow: usdt("270"), withdrawal: usdt("190") }, current: usdt("130") },
    };
  }
  const agents = { "2003": usdt("40"), "2004": usdt("-5") };
  if (kind === "supervisor") return { period: { unavailable: "" }, customers, agents, groups: { "301": { period: usdt("5"), current: usdt("35") } }, scope: { period: totals("5", "60", "55"), current: usdt("35") } };
  return {
    period: { unavailable: "" }, customers, agents,
    groups: { "302": { period: usdt("30"), current: usdt("10") }, "301": { period: usdt("5"), current: usdt("35") } },
    scope: { period: totals("85", "180", "95"), current: usdt("45") },
    attribution: { unassigned: usdt("25"), unknown: usdt("15") },
  };
}

/* ---------------- 客户资料（样本 B 的客户 林*：银行卡购机直付 80，越南银行卡充值 20） ---------------- */

/** 客户资料里的业绩额：累计业绩额和首充来源。 */
export type ProfilePerfFixture = { cumulative: PerfValue; firstSource: string };
export function profilePerfFixture(): ProfilePerfFixture { return { cumulative: usdt("100"), firstSource: "银行卡购机直付" }; }

/** 夹具开着时客户资料不发读请求，统计组和资金组用样本 B 的客户林*；其余组写「状态未知」，按页面现有样子显示。 */
export function profileFixture(): SupportProfile {
  const evaluatedAt = fixtureNow();
  const unknown = { status: "UNKNOWN" as const, data: null, evaluatedAt };
  const money = (value: string) => ({ observed: value, confirmed: value, observedEvents: null, confirmedEvents: null, observedCustomers: null, status: "AVAILABLE" as const });
  const finance = (currency: string, deposits: string) => ({ currency, fieldStatuses: { creditedDepositTotal: "READY", depositRefundTotal: "READY", successfulWithdrawalPrincipalTotal: "READY", successfulWithdrawalFeeTotal: "READY", successfulWithdrawalNetTotal: "READY", processingWithdrawalPrincipalTotal: "READY", balance: "READY", availableBalance: "READY" },
    creditedDepositTotal: deposits, depositRefundTotal: "0", successfulWithdrawalPrincipalTotal: "0", successfulWithdrawalFeeTotal: "0", successfulWithdrawalNetTotal: "0", processingWithdrawalPrincipalTotal: "0", balance: deposits, availableBalance: deposits });
  return {
    identity: { status: "READY", evaluatedAt, data: { customerId: "40000002", userNo: "U40000002", nickname: "林*", phoneMasked: "090****1234", region: "+84", level: "V0", registeredAt: "2026-11-20T15:30:00Z", lastLoginAt: "2026-11-24T05:50:00Z" } },
    statistics: { status: "READY", evaluatedAt, data: {
      first: { state: "CONFIRMED", status: "AVAILABLE", kind: "DEVICE_PURCHASE", currency: "USDT", amount: "80", succeededAt: "2026-11-21T06:08:00Z" },
      lifetime: [{ currency: "USDT", deposits: money("20"), purchases: money("80"), net: { ...money("0"), observed: null, confirmed: null, status: "UNKNOWN" } }, { currency: "UVT", deposits: money("0"), purchases: money("0"), net: { ...money("0"), observed: null, confirmed: null, status: "UNKNOWN" } }],
      lifetimeStatus: "AVAILABLE",
      invitations: { direct: cnt(0), descendants: cnt(0), withinRewardRange: cnt(0), beyondRewardRange: cnt(0), status: "AVAILABLE", deposits: [{ currency: "USDT", deposits: money("0") }, { currency: "UVT", deposits: money("0") }] },
      activity: { state: "ACTIVE", status: "AVAILABLE", lastEffectiveAt: "2026-11-22T06:10:00Z" },
    } },
    finance: { status: "READY", evaluatedAt, data: { byCurrency: [finance("USDT", "20"), finance("UVT", "0")] } },
    devices: unknown, risk: unknown, annotations: unknown, service: unknown,
    actions: { resetPassword: { allowed: true }, freeze: { allowed: true }, unfreeze: { allowed: false }, adjustBalance: { allowed: true } },
  };
}

/* ---------------- 导出和审批（第二批）：5a–5h、6a–6l ---------------- */

/**
 * 导出的状态，和 m1 / m6 一起写进 localStorage，例如 {"m1":"supervisor","export":"5a"}。
 * 5a 主管三项都能选；5b 超管这一版有几项不能选；5c 勾了的逐笔记录没加载出来（取消勾选就是 5h）；5e 专属客服本人只有汇总；
 * 5f 这个月没有记录；5g 页面这一版刷新没成功；6a 主管的申请（点开一条是 6b，撤回是 6g，下载失败用 6h）；6f 已批准、文件在生成；
 * 6c 超管待我审批（批准 6d、驳回 6e）；6i 批准结果未知；6j 批准不了、驳回照常；6k 只有审批权；6l 申请人已没有这个范围；
 * more 是没画的几种状态（已驳回、已过期、执行失败、已生成但不能下载）。
 * write：下一次写操作的回包，rejected 被拒、unknown 结果未知；不写就成功（导出汇总可下载、明细待审批）。
 * lookup：「查询原操作」查到什么，默认对上了这次（matched）。
 */
export type ExportScenario = "5a" | "5b" | "5c" | "5e" | "5f" | "5g" | "6a" | "6c" | "6f" | "6h" | "6i" | "6j" | "6k" | "6l" | "more";

const GRAIN: Record<ExportType, string> = { SUMMARY: "一位客服在一个组一个月一行", CUSTOMER_DETAIL: "一位客户在一位客服名下一个月一行", TRANSACTION_DETAIL: "一笔入金、提现或参考交易一行" };
const LIMIT: Record<ExportType, number> = { SUMMARY: 5000, CUSTOMER_DETAIL: 5000, TRANSACTION_DETAIL: 100000 };
const groupsOf = (rows: [string, string[]][]) => rows.map(([name, columns]) => ({ name, columns }));
const SUMMARY_GROUPS = groupsOf([
  ["客服和组", ["客服", "组", "统计截至时的组主管"]], ["月份", ["月份"]], ["业绩额", ["业绩额"]],
  ["入金", ["入金合计", "链上充值", "越南银行卡充值", "链上购机直付", "银行卡购机直付", "本期更正合计", "链上充值更正", "越南银行卡充值更正", "链上购机直付更正", "银行卡购机直付更正"]],
  ["提现", ["提现合计", ...["TRC20", "BEP20", "ERC20", "越南银行卡"].flatMap(n => [`${n}${n === "越南银行卡" ? "" : " "}钱包扣款`, `${n}${n === "越南银行卡" ? "" : " "}手续费`, `${n}${n === "越南银行卡" ? "" : " "}客户到手`])]],
  ["越南盾参考", ["越南银行卡充值到账（越南盾）", "银行卡购机直付到账（越南盾）", "越南银行卡提现到账（越南盾）", "越南银行卡入金更正（越南盾）"]],
  ["不计入业绩的参考", ["买设备", "退款", "人工加款", "奖励到账"]],
  ["人数", ["月末绑定客户", "本月新绑定", "本月有入金", "本月有提现", "本月首充", "本月业绩为负"]],
  ["说明", ["统计截至", "时区", "数据覆盖", "缺口原因"]],
]);
const CUSTOMER_GROUPS = groupsOf([
  ["客户", ["用户编码", "昵称（打码）", "当时的客服", "这个月在这位客服名下的绑定时间段"]], ["月份", ["月份"]],
  ["入金", ["链上充值", "越南银行卡充值", "链上购机直付", "银行卡购机直付", "本期更正"]],
  ["提现", ["TRC20 钱包扣款", "BEP20 钱包扣款", "ERC20 钱包扣款", "越南银行卡钱包扣款"]],
  ["参考", ["买设备", "退款"]], ["业绩额", ["业绩额"]], ["累计业绩额", ["累计业绩额（本月写到统计截至）"]],
  ["说明", ["统计截至", "时区", "数据覆盖", "缺口原因"]],
]);
const TRANSACTION_GROUPS = groupsOf([
  ["时间", ["生效时间", "发生时间"]], ["客户和归属", ["用户编码", "当时的客服", "当时的组"]], ["类别", ["类别", "参考类别", "渠道", "网络"]],
  ["单号", ["业务单号", "原单号"]], ["金额", ["业务原金额", "原币种", "进位调整", "总实付", "计入业绩的增减额", "钱包扣款", "手续费", "通道费", "网络费", "客户到手"]],
  ["越南盾", ["越南盾金额"]], ["状态", ["来源状态", "状态", "缺口原因"]],
]);
/** 预检回来的列（导出框）。 */
const PREVIEW_COLUMNS: Record<ExportType, ExportColumns> = {
  SUMMARY: { total: 46, summary: "客服和组 3 · 月份 1 · 业绩额 1 · 入金 10 · 提现 13 · 越南盾参考 4 · 不计入业绩的参考 4 · 人数 6 · 说明 4。", groups: SUMMARY_GROUPS },
  CUSTOMER_DETAIL: { total: 22, summary: "客户 4 · 月份 1 · 入金 5 · 提现 4 · 参考 2 · 业绩额 1 · 累计业绩额 1 · 说明 4；不含手机号。", groups: CUSTOMER_GROUPS },
  TRANSACTION_DETAIL: { total: 25, summary: "时间 2 · 客户和归属 3 · 类别 4 · 单号 2 · 金额 10 · 越南盾 1 · 状态 3。", groups: TRANSACTION_GROUPS },
};
/** 提交时冻结的列（导出记录、审批）。 */
const FROZEN_COLUMNS: Record<ExportType, ExportColumns> = {
  SUMMARY: PREVIEW_COLUMNS.SUMMARY,
  CUSTOMER_DETAIL: { ...PREVIEW_COLUMNS.CUSTOMER_DETAIL, summary: "客户 4 · 月份 1 · 入金 5 · 提现 4 · 参考 2 · 业绩额 1 · 累计业绩额 1（本月写到统计截至）· 说明 4；不含手机号。列名写在文件第一行。" },
  TRANSACTION_DETAIL: { ...PREVIEW_COLUMNS.TRANSACTION_DETAIL, summary: "时间 2 · 客户和归属 3 · 类别 4 · 单号 2 · 金额 10 · 越南盾 1 · 状态 3。列名写在文件第一行。" },
};
const exportItem = (type: ExportType, check: ExportCheck, grain = GRAIN[type]): ExportItem => ({ type, grain, limit: LIMIT[type], columns: PREVIEW_COLUMNS[type], check });
/** 华东专属服务组 2026-11 截至 14:20 这一版的行数（画布 5a）。 */
const EAST_ROWS: Record<ExportType, number> = { SUMMARY: 2, CUSTOMER_DETAIL: 2, TRANSACTION_DETAIL: 3 };
const EMPTY_TEXT = "这个月还没有记录，你名下客户有入金或提现后才会有。";
const REASON_A = "核对华东组 11 月业绩，发财务对账，工单 CS-1124-07";
const ASOF_1420 = "2026-11-24 14:20";
const ASOF_0900 = "2026-11-24 09:00";
const ONE_MONTH: ExportChoice[] = [{ value: "2026-11", label: "2026-11" }];

function exportPersona(s: ExportScenario): ExportPersona {
  if (s === "5b" || s === "6c" || s === "6i" || s === "6j") return { name: "Local Backup Admin", canExport: true, views: ["APPROVALS", "MINE"] };
  if (s === "5e") return { name: "Wang Ke", canExport: true, views: ["MINE"] };
  if (s === "5f") return { name: "He Tian", canExport: true, views: ["MINE"] };
  if (s === "6k") return { name: "Gao Lan", canExport: false, views: ["APPROVALS"] };
  if (s === "6l") return { name: "Zhou Ming", canExport: false, exportBlocked: "没有负责的组，暂时不能导出", views: ["MINE"] };
  return { name: "Zhou Ming", canExport: true, views: ["MINE"] };
}

function dialogData(s: ExportScenario): ExportDialogData {
  const base = { months: ONE_MONTH, month: "2026-11", since: "自 2026-11-20 22:57 起", asOf: ASOF_1420 };
  if (s === "5b") return { ...base, asOf: ASOF_0900, scopes: [{ value: "ALL", label: "全部范围（含未分配、归属未知）" }], scope: "ALL", downloader: "你本人（Local Backup Admin）", selected: ["SUMMARY"],
    items: [
      exportItem("SUMMARY", { state: "ok", rows: 6, note: "越南银行卡充值还没核完：文件写已核小计和缺口。" }),
      exportItem("CUSTOMER_DETAIL", { state: "failed", text: "这一项没加载出来。" }),
      exportItem("TRANSACTION_DETAIL", { state: "over", text: "126,480 行，超过上限，本月暂时不能导出。" }),
    ] };
  if (s === "5e") return { ...base, scopes: [{ value: "SELF", label: "本人（Wang Ke）" }], scope: "SELF", downloader: "你本人（Wang Ke）", selected: ["SUMMARY"],
    items: [exportItem("SUMMARY", { state: "ok", rows: 1 }, "本人在一个组一个月一行")] };
  if (s === "5f") return { ...base, scopes: [{ value: "SELF", label: "本人（He Tian）" }], scope: "SELF", downloader: "你本人（He Tian）", selected: [],
    items: [exportItem("SUMMARY", { state: "empty", text: EMPTY_TEXT }, "本人在一个组一个月一行")] };
  const supervisor = { ...base, scopes: [{ value: "301", label: "华东专属服务组" }, { value: "SELF", label: "本人（Zhou Ming）" }], scope: "301", downloader: "你本人（Zhou Ming）" };
  if (s === "5g") return { ...supervisor, asOf: ASOF_0900, selected: [], blocked: "这一版数据刷新没成功，暂时不能导出。关掉这个框，在页面上刷新成功后再导出。",
    items: EXPORT_TYPES.map(type => exportItem(type, { state: "stale", rows: EAST_ROWS[type] })) };
  if (s === "5c") return { ...supervisor, selected: [...EXPORT_TYPES],
    items: EXPORT_TYPES.map(type => exportItem(type, type === "TRANSACTION_DETAIL" ? { state: "failed", text: "没加载出来。" } : { state: "ok", rows: EAST_ROWS[type] })) };
  return { ...supervisor, selected: ["SUMMARY"], items: EXPORT_TYPES.map(type => exportItem(type, { state: "ok", rows: EAST_ROWS[type] })) };
}

function exportTask(seq: string, type: ExportType, o: Partial<ExportTask> = {}): ExportTask {
  return { taskId: `PE20261124-${seq}`, type, requester: "Zhou Ming", requesterRole: "客服主管", mine: true, scope: "华东专属服务组", month: "2026-11", asOf: "2026-11-24T06:20:00Z",
    rows: EAST_ROWS[type], columns: FROZEN_COLUMNS[type], coverage: "完整", requestReason: REASON_A, requestedAt: "2026-11-24T06:26:00Z",
    state: "PENDING_APPROVAL", canDownload: false, canReview: false, canWithdraw: true, ...o };
}
const APPROVED_BY = { decidedBy: "Local Backup Admin", decidedAt: "14:32", decisionReason: "已核对范围和用途，同意导出给财务对账" };
function exportTasks(s: ExportScenario, view: "MINE" | "APPROVALS"): ExportTask[] {
  const lost = { scope: null, month: null, rows: null, asOf: null, coverage: null, scopeLost: true };
  if (s === "6l") return [
    exportTask("0011", "SUMMARY", { ...lost, state: "READY", canWithdraw: false }),
    exportTask("0012", "CUSTOMER_DETAIL", lost), exportTask("0013", "TRANSACTION_DETAIL", lost),
    exportTask("0004", "TRANSACTION_DETAIL", { ...lost, state: "WITHDRAWN", canWithdraw: false, requestedAt: "2026-11-24T02:40:00Z" }),
  ];
  if (s === "6c" || s === "6i" || s === "6j" || s === "6k") {
    const others = [
      exportTask("0012", "CUSTOMER_DETAIL", { mine: false, canWithdraw: false, canReview: true, approveBlocked: s === "6j" ? "申请人已没有这个范围的导出权限" : undefined }),
      exportTask("0013", "TRANSACTION_DETAIL", { mine: false, canWithdraw: false, canReview: true }),
    ];
    if (s === "6k") return view === "APPROVALS" ? others : [];
    const own = exportTask("0009", "TRANSACTION_DETAIL", { requester: "Local Backup Admin", requesterRole: "超级管理员", scope: "全部范围", rows: 8, requestedAt: "2026-11-24T05:50:00Z", canReview: false });
    return view === "APPROVALS" ? [...others, own] : [own];
  }
  const mine = [
    exportTask("0011", "SUMMARY", { state: "READY", canDownload: true, canWithdraw: false }),
    exportTask("0012", "CUSTOMER_DETAIL", s === "6f" ? { state: "APPROVED", canWithdraw: false, ...APPROVED_BY } : {}),
    exportTask("0013", "TRANSACTION_DETAIL"),
    exportTask("0004", "TRANSACTION_DETAIL", { state: "WITHDRAWN", canWithdraw: false, requestedAt: "2026-11-24T02:40:00Z" }),
  ];
  if (s !== "more") return mine;
  return [
    exportTask("0008", "TRANSACTION_DETAIL", { state: "REJECTED", canWithdraw: false, decidedBy: "Local Backup Admin", decidedAt: "11:05", decisionReason: "逐笔记录里有业务单号，请写清接收人后重新申请", requestedAt: "2026-11-24T02:50:00Z" }),
    exportTask("0007", "SUMMARY", { state: "EXPIRED", canWithdraw: false, requestedAt: "2026-11-20T15:10:00Z" }),
    exportTask("0006", "CUSTOMER_DETAIL", { state: "APPROVED", failure: "GENERATE_FAILED", canWithdraw: false, ...APPROVED_BY, requestedAt: "2026-11-24T06:26:00Z" }),
    exportTask("0005", "SUMMARY", { state: "READY", canDownload: false, canWithdraw: false, requestedAt: "2026-11-23T10:00:00Z" }),
  ];
}

const LOOKUP_TEXT: Record<DecisionLookup["kind"], string> = {
  matched: "已查到这次批准：14:32 已批准，文件在生成。",
  mismatch: "这条申请现在是「已批准」，但对不上是不是这次批准的结果，继续核对，先保持锁定；可以再查询，或到「操作记录与审批」核对这次操作。",
  pending: "还没查到这次批准的结果，保持锁定，稍后再查。",
  "not-received": "系统确认没收到这次批准。可以按原操作重试：同一个理由，不会多批一次。",
  expired: "已超过可重试时限，不能再重试，请到「操作记录与审批」核对这次操作",
  failed: "这次查询没连上，原操作还没确定。稍后再点「查询原操作」。",
};
const wait = (ms = 500) => new Promise(resolve => setTimeout(resolve, ms));

/** 夹具开着时导出和审批走这里：读和写都只在内存里，不发请求。 */
export function exportFixturePorts(): PerfExportPorts | null {
  const f = perfFixture();
  const s = f?.export;
  if (!s) return null;
  const store: Record<"MINE" | "APPROVALS", ExportTask[]> = { MINE: exportTasks(s, "MINE"), APPROVALS: exportTasks(s, "APPROVALS") };
  let pending: PendingDecision[] = s === "6i" ? [{ taskId: "PE20261124-0012", decision: "APPROVE", reason: APPROVED_BY.decisionReason, operationId: "7f3a9c2e-1b4d-4e8a-9c61-2d5e8f0a4b13", at: "14:32" }] : [];
  let retried = false, downloadFailed = s === "6h", nextWrite = f?.write;
  const outcome = () => { const w = nextWrite; nextWrite = undefined; return w; };
  const replace = (task: ExportTask) => { for (const view of ["MINE", "APPROVALS"] as const) store[view] = store[view].map(row => row.taskId === task.taskId ? task : row); return task; };
  // 被拒（409 EXPORT_SCOPE_CHANGED 一类）：接线后由错误码翻成这句。
  const rejectWrite = () => new Error("这条申请的范围变了，刷新后再看。");
  const make = (q: ExportQuery): ExportSubmitted[] => {
    const seq: Record<ExportType, string> = { SUMMARY: "0011", CUSTOMER_DETAIL: "0012", TRANSACTION_DETAIL: "0013" };
    const made = q.types.map(type => exportTask(seq[type], type, type === "SUMMARY" ? { state: "READY", canDownload: true, canWithdraw: false } : {}));
    store.MINE = [...made, ...store.MINE.filter(row => !made.some(m => m.taskId === row.taskId))];
    return made.map(task => ({ type: task.type, taskId: task.taskId, state: task.state === "READY" ? "READY" as const : "PENDING_APPROVAL" as const, rows: task.rows }));
  };
  return {
    persona: exportPersona(s),
    open: async () => { await wait(); return dialogData(s); },
    check: async (q: ExportQuery) => {
      await wait(800);
      const data = dialogData(s);
      return q.types.map(type => {
        if (q.scope === "SELF" && s !== "5e" && s !== "5f") return exportItem(type, { state: "empty", text: EMPTY_TEXT });
        const found = data.items.find(item => item.type === type) ?? exportItem(type, { state: "ok", rows: EAST_ROWS[type] });
        // 5c：逐笔记录点「重试」后查到了。
        if (s === "5c" && type === "TRANSACTION_DETAIL") { const ok = retried; retried = true; return ok ? exportItem(type, { state: "ok", rows: EAST_ROWS[type] }) : found; }
        return found;
      });
    },
    submit: async (q: ExportQuery) => {
      await wait();
      const w = outcome();
      if (w === "unknown") throw new ExportOutcomeUnknownError("提交后没收到结果，原来的选择和理由已保存。先查询原操作，不要再点提交。");
      if (w === "rejected") throw new Error("这一版数据变了，重新检查后再提交。");
      return make(q);
    },
    lookupSubmit: async (q: ExportQuery) => {
      await wait();
      return f?.lookup && f.lookup !== "matched" ? null : make(q);
    },
    tasks: async (view: "MINE" | "APPROVALS") => { await wait(300); return store[view]; },
    decide: async (task: ExportTask, decision: "APPROVE" | "REJECT", reason: string) => {
      await wait();
      const w = outcome() ?? (s === "6i" && decision === "APPROVE" && !pending.length ? "unknown" : undefined);
      if (w === "unknown") {
        pending = [{ taskId: task.taskId, decision, reason, operationId: "7f3a9c2e-1b4d-4e8a-9c61-2d5e8f0a4b13", at: "14:32" }];
        throw new ExportOutcomeUnknownError(`${decision === "APPROVE" ? "批准" : "驳回"}后没收到结果，原操作和理由已保存。先查询原操作。`);
      }
      if (w === "rejected") throw rejectWrite();
      pending = pending.filter(p => p.taskId !== task.taskId);
      return replace({ ...task, state: decision === "APPROVE" ? "APPROVED" : "REJECTED", canReview: false, canWithdraw: false, decidedBy: exportPersona(s).name, decidedAt: "14:32", decisionReason: reason });
    },
    lookupDecision: async (p: PendingDecision) => {
      await wait();
      const kind = f?.lookup ?? "matched";
      const task = [...store.APPROVALS, ...store.MINE].find(row => row.taskId === p.taskId);
      if (kind === "matched" && task) {
        pending = pending.filter(row => row.taskId !== p.taskId);
        if (p.decision === "WITHDRAW") return { kind, task: replace({ ...task, state: "WITHDRAWN", canWithdraw: false }), text: "已查到这次撤回：这条申请已撤回。" };
        return { kind, task: replace({ ...task, state: p.decision === "APPROVE" ? "APPROVED" : "REJECTED", canReview: false, canWithdraw: false, decidedBy: exportPersona(s).name, decidedAt: p.at, decisionReason: p.reason }), text: LOOKUP_TEXT.matched };
      }
      return { kind: kind === "matched" ? "pending" : kind, text: LOOKUP_TEXT[kind === "matched" ? "pending" : kind] } as DecisionLookup;
    },
    withdraw: async (task: ExportTask, reason: string) => {
      await wait();
      const w = outcome();
      if (w === "unknown") {
        pending = [{ taskId: task.taskId, decision: "WITHDRAW", reason, operationId: "3c8e51d0-6a2f-4b97-8e14-90d2b7c5a6f1", at: "14:40" }];
        throw new ExportOutcomeUnknownError("撤回后没收到结果，原操作和理由已保存。先查询原操作，不要再点撤回。");
      }
      if (w === "rejected") throw rejectWrite();
      return replace({ ...task, state: "WITHDRAWN", canWithdraw: false, decisionReason: reason });
    },
    download: async () => {
      await wait();
      if (downloadFailed) { downloadFailed = false; throw new Error("EXPORT_DOWNLOAD_INCOMPLETE"); }
    },
    pendingDecisions: () => pending,
  };
}
