/**
 * 客服业绩额的开发夹具（集中在这一个文件）。后端新合同（B80）还没交付，页面上新口径的状态只能靠它打开截图和走查。
 * 接线时（Codex 按后端核定的合同）把这个文件和各页标「接线删：夹具」的几行一起删掉。
 *
 * 开关：只有构建时设了 NEXT_PUBLIC_SUPPORT_PERF_FIXTURE=1 才可能生效；正常构建里 ENABLED 恒为 false，perfFixture() 恒返回 null，
 * 页面走生产路径：照旧发旧请求，新口径一律显示「业绩数据暂不可用」。
 * 生效时在浏览器 localStorage 写「nexion-dev-support-perf-fixture」选状态，例如
 *   {"m6":"ready"}、{"m6":"provisional"}
 * 夹具开着时，打开了夹具的那一块不发读请求（数据全部来自这里），写操作只在内存里造回包，不发请求。
 *
 * 数字只用交接 §5 和「验收修订」的样本（A、B、F、G、H），同一块画板里的数互相对得上；状态只造后端合同能产生的。
 */
import type { LeaderboardDetail, LeaderboardPage, LeaderboardQuery } from "@/lib/admin/support-leaderboard-client";
import type { SupportBoardKey, SupportBoardMovement, SupportBoardRow } from "./support-leaderboard";
import type { SupportAnalyticsAgent, SupportAnalyticsCustomer, SupportAnalyticsMonth, SupportAnalyticsQuery, SupportAnalyticsResponse } from "@/lib/admin/support-analytics-client";
import { SupportClientError } from "@/lib/admin/m-support-client";
import type { SupportProfile } from "@/lib/admin/m-support-enhancements";
import type { AnalyticsPerf, PerfTotals, PerfValue } from "./perf-view";

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
 * agentB 是专属客服 Sun Qing 的样本 B（4，两类直付和银行卡充值）；supervisor 是华东主管 Zhou Ming（3b、3c、3g），super 是超级管理员（3a、3e、3f），nogroup 是没有负责组的主管 Zhao Min（3d）。 */
export type M1FixtureKind = "agentA" | "agentG" | "agentB" | "supervisor" | "super" | "nogroup";

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
  const finance = (currency: string, deposits: string) => ({ currency, fieldStatuses: { creditedDepositTotal: "READY", depositRefundTotal: "READY", successfulWithdrawalPrincipalTotal: "READY", successfulWithdrawalFeeTotal: "READY", successfulWithdrawalNetTotal: "READY", processingWithdrawalPrincipalTotal: "READY", balance: "READY", availableBalance: "READY", netContributionTotal: "UNKNOWN" },
    creditedDepositTotal: deposits, depositRefundTotal: "0", successfulWithdrawalPrincipalTotal: "0", successfulWithdrawalFeeTotal: "0", successfulWithdrawalNetTotal: "0", processingWithdrawalPrincipalTotal: "0", balance: deposits, availableBalance: deposits, netContributionTotal: null });
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
    actions: {},
  };
}
