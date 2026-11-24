"use client";
import { m1CustomerCode } from "./m1-customer-code";
import { ADMIN_ERROR_MESSAGES, displayAdminError } from "@/lib/admin/error-messages";
import { operatorNicknameText } from "@/lib/admin/brand-copy";

import { nexGridBrandText } from "@/lib/admin/brand-copy";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { BarChart3, Users } from "lucide-react";
import { DomainModuleLoading } from "../domain-module-state";
import { useRouter } from "next/navigation";
import { supportPerformanceAnalyticsClient as analytics, type SupportAnalyticsMonth, type SupportAnalyticsQuery, type SupportAnalyticsResponse, type SupportAnalyticsView, type SupportAnalyticsDetailView, type SupportAnalyticsCustomer } from "@/lib/admin/support-analytics-client";
import { sameCoveredPerformance, samePerformanceWindow } from "@/lib/admin/support-performance-contract";
import { SupportClientError, supportClient, SUPPORT_SESSION_ROLE_LABEL, type SupportSessionHold } from "@/lib/admin/m-support-client";
import { formatBusinessTimeCompact, parseBusinessTime } from "@/lib/admin/business-time";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { businessZone, businessZoneText } from "@/lib/admin/business-time";
import { Button, BlockState, Cell, Drawer, Explain, Fact, Facts, FilterBar, FilterField, Fold, Input, Modal, Notice, PageHeader, PageTabs, Panel, Select, Segments, Stat, StatBand, StatusTag, Table, Th, Tr, Td, useTabIds } from "@/app/components/rd";
import { canAccessResolvedPath, resolveVisibleDomains } from "@/lib/nav/console-nav";
import { HDSelect, type HDOption } from "./hd-ui";
import { M1PersonalWorkbench, SupportSeatRolesButton, maintenanceCommands, type PersonalWorkbenchView } from "./m1-personal-workbench";
import { M1StatisticDetails, fundAmount, fundLabels, type FundMetric, type StatisticSource } from "./m1-statistic-details";
import { M1LiveService } from "./m1-live-service";
import { CustomerTransferDialog, TransferPendingNotes, transferCommands } from "./m1-customer-transfer";
import { groupPendingCommands, isInvitePending } from "@/lib/admin/support-group-client";
import { selfAvatarCommands, avatarDrafts } from "@/lib/admin/account-avatar-pending";
import { pendingPaymentReleases } from "@/lib/admin/payment-password-client";
import { poolCommands, routeCommands } from "./m1-supervisor-pool";
import { randomAssignmentCommands } from "./support-random-assignment";
import { SupportBulkComposer, hasBulkPending } from "./support-bulk-composer";
import { SelfAvatarEditor } from "./self-avatar-editor";
import { SupportAvatar } from "./support-avatar";
import { compactSupportBoardValue } from "./support-leaderboard";
import { AnalyticsFreshness } from "./analytics-freshness";
import type { MCtx } from "./types";
import "./m1-analytics-workbench.css";
import { amountDisplay } from "@/lib/format";
import { PERF_UNAVAILABLE_VALUE, perfNote, perfText, type AnalyticsPerf, type PerfValue } from "./perf-view";
import { analyticsPerf, boardTotals, eventsPerf } from "./perf-wiring";
import { usePerformanceExportPorts } from "./perf-export-ports";
import { PerfEventsDrawer, PeriodPerfPanel } from "./m1-performance";
import { PerfExportDialog } from "./perf-export";
import { PerfExportRecords } from "./perf-export-records";
import { InviterCell } from "@/app/components/invitation/invitation-view";
import { inviterView, supportCountsView } from "@/app/components/invitation/wiring";


const M1SupervisorPool = dynamic(() => import("./m1-supervisor-pool").then(m => m.M1SupervisorPool), { loading: DomainModuleLoading });
const M1GroupManagement = dynamic(() => import("./m1-group-management").then(m => m.M1GroupManagement), { loading: DomainModuleLoading });
const M3CustomerProfile = dynamic(() => import("./m3-customer-profile").then(m => m.M3CustomerProfile), { loading: DomainModuleLoading });

type Permission = "agent" | "supervisor" | "superadmin";
/** M-41: one tab row per role. Agents: home / my-customers / my-data; supervisors and the super admin: data / customers / pool / team (+ mine for a supervisor with a seat). */
type M1Tab = "home" | "my-customers" | "my-data" | "data" | "customers" | "pool" | "team" | "mine" | "exports";
type Section = "personal" | "stats" | "pool" | "team" | "mine" | "exports";
const TAB_LABEL: Record<M1Tab, string> = { home: "工作台", "my-customers": "我的客户", "my-data": "我的数据", data: "数据", customers: "客户", pool: "待分配", team: "客服与分组", mine: "我的客户", exports: "导出记录" };
// 「导出记录」只在服务端允许读取至少一个导出视图时出现。
function roleTabs(personal: boolean, canMine: boolean, withExports = false): M1Tab[] {
  const tabs: M1Tab[] = personal ? ["home", "my-customers", "my-data"] : ["data", "pool", "customers", "team", ...(canMine ? ["mine" as const] : [])];
  return withExports ? [...tabs, "exports"] : tabs;
}
function entryTab(personal: boolean, canMine: boolean, withExports = false): M1Tab {
  const tabs = roleTabs(personal, canMine, withExports), wanted = new URLSearchParams(window.location.search).get("view");
  return tabs.find(tab => tab === wanted) ?? tabs[0];
}
type Count = SupportAnalyticsResponse["scopeSummary"]["current"]["firstConfirmed"];
type Money = SupportAnalyticsCustomer["lifetime"][number]["deposits"];
type Basis = NonNullable<SupportAnalyticsQuery["basis"]>;
type Currency = NonNullable<SupportAnalyticsQuery["currency"]>;
export type AnalyticsQueryState = Omit<SupportAnalyticsQuery, "signal" | "pageNum" | "pageSize" | "expectedVersion"> & { month: string; pageNum: number; expectedVersion?: string };
const DATASETS: Array<{ value: SupportAnalyticsView; label: string }> = [{ value: "OVERVIEW", label: "总览" }, { value: "AGENTS", label: "客服" }, { value: "CUSTOMERS", label: "客户" }, { value: "FINANCE", label: "资金" }, { value: "DEVICES", label: "设备" }, { value: "ACTIVITY", label: "活跃" }];
const BASIS_OPTIONS: Array<{ value: Basis; label: string }> = [{ value: "PERIOD_EVENT", label: "按发生时归属" }, { value: "CURRENT_CUSTOMER_HISTORY", label: "按现在的客户" }, { value: "CURRENT_ASSET", label: "按当前设备" }];
const FIRST_OPTIONS: Array<{ value: NonNullable<SupportAnalyticsQuery["firstState"]>; label: string }> = [{ value: "ALL", label: "全部首充状态" }, { value: "CONFIRMED", label: "已首充" }, { value: "NONE", label: "未首充" }, { value: "UNKNOWN", label: "历史未同步" }];
const FILTER_OPTIONS: Array<{ value: NonNullable<SupportAnalyticsQuery["filter"]>; label: string }> = [{ value: "ALL", label: "全部服务状态" }, { value: "WINDOW_ACTIVE", label: "当前统计期活跃" }, { value: "WAITING_REPLY", label: "待回复" }, { value: "DUE", label: "待维护" }, { value: "FIRST_CONTACT", label: "首次待联系" }, { value: "DORMANT", label: "沉睡" }, { value: "UNKNOWN", label: "状态未知" }, { value: "STOPPED", label: "暂停维护" }];
const PERSONAL_FILTER_OPTIONS = [...FILTER_OPTIONS, { value: "ACTIVE" as const, label: "当前活跃" }, { value: "TODO" as const, label: "全部待办" }];
const SORT_OPTIONS: Record<SupportAnalyticsView, Array<{ value: NonNullable<SupportAnalyticsQuery["sortKey"]>; label: string }>> = {
  OVERVIEW: [{ value: "LAST_ACTIVE_AT", label: "最近活动" }],
  AGENTS: [{ value: "BOUND_CUSTOMER_COUNT", label: "当前客户" }, { value: "ACTIVE_CUSTOMER_COUNT", label: "当前统计期活跃" }, { value: "FIRST_CONFIRMED_CUSTOMER_COUNT", label: "已首充客户" }, { value: "DEVICE_COUNT", label: "当前设备" }, { value: "PERSONAL_DEPOSIT", label: "客户累计充值" }],
  CUSTOMERS: [{ value: "LAST_ACTIVE_AT", label: "最近活动" }, { value: "REGISTERED_AT", label: "注册时间" }, { value: "DIRECT_INVITATION_COUNT", label: "直接邀请" }, { value: "TEAM_CUSTOMER_COUNT", label: "全部团队成员" }, { value: "PERSONAL_DEPOSIT", label: "本人累计充值" }, { value: "NET_CONTRIBUTION", label: "净贡献额" }, { value: "TEAM_DEPOSIT", label: "邀请累计充值" }],
  FINANCE: [{ value: "SUCCEEDED_AT", label: "成功时间" }, { value: "AMOUNT", label: "金额" }],
  DEVICES: [{ value: "HASHRATE", label: "算力" }, { value: "LAST_ACTIVE_AT", label: "客户最近活动" }, { value: "DEVICE_COUNT", label: "客户设备数" }],
  ACTIVITY: [{ value: "LAST_ACTIVE_AT", label: "最近活动" }, { value: "REGISTERED_AT", label: "注册时间" }],
};
export function analyticsBusinessMonth(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: businessZone().zoneId, year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${parts.find(p => p.type === "year")?.value}-${parts.find(p => p.type === "month")?.value}`;
}
// Month windows come from the server's business calendar, so a month settled before a time-zone change
// keeps the zone it was settled in (BUG-005).
export function analyticsMonthWindow(month: string, calendar: readonly SupportAnalyticsMonth[]): { from: string; to: string } {
  const row = calendar.find(entry => entry.month === month);
  if (!row) throw new Error("统计月份无效，请重新选择。");
  return { from: row.from, to: row.to };
}
export function analyticsMonths(calendar: readonly SupportAnalyticsMonth[]): HDOption[] {
  return calendar.map(({ month }) => ({ value: month, label: month.replace("-", "年") + "月" }));
}
export function initialAnalyticsQuery(mode: SupportAnalyticsResponse["scopeSummary"]["mode"], month = analyticsBusinessMonth()): AnalyticsQueryState {
  return { view: mode === "MANAGED" ? "AGENTS" : mode === "ALL" ? "OVERVIEW" : "CUSTOMERS", basis: "CURRENT_CUSTOMER_HISTORY", currency: "USDT", category: "ALL", firstState: "ALL", filter: "ALL", month, pageNum: 1 };
}
class AnalyticsEntryError extends Error {}
export function analyticsEntryAgent(search: string): string | undefined {
  const values = new URLSearchParams(search).getAll("agentId");
  if (!values.length) return undefined;
  const value = values[0];
  // Match the private client's canonical positive decimal and request-safe bound;
  // keep the original string rather than coercing an account ID through Number.
  if (values.length !== 1 || !/^[1-9]\d*$/.test(value) || value.length > 16 || BigInt(value) > BigInt("9007199254740991")) throw new AnalyticsEntryError("客服入口参数无效，请返回业绩榜重新选择客服。");
  return value;
}
export function changeAnalyticsQuery(state: AnalyticsQueryState, changes: Partial<AnalyticsQueryState>): AnalyticsQueryState {
  const next = { ...state, ...changes, pageNum: 1, expectedVersion: undefined };
  if (changes.groupId !== undefined || Object.hasOwn(changes, "groupId")) next.agentId = undefined;
  if (changes.view !== undefined || changes.basis !== undefined || changes.firstState !== undefined || changes.filter !== undefined || changes.category !== undefined) next.sortKey = undefined;
  // Finance has no current-asset projection. A dataset click changes that inherited basis,
  // while keeping the selected group/agent/customer conditions.
  if (changes.view === "FINANCE" && changes.basis === undefined && next.basis === "CURRENT_ASSET") next.basis = "CURRENT_CUSTOMER_HISTORY";
  if (next.sortKey === "NET_CONTRIBUTION" && next.basis !== "CURRENT_CUSTOMER_HISTORY" || next.sortKey === "PERFORMANCE_AMOUNT" && (next.basis !== "CURRENT_CUSTOMER_HISTORY" || next.currency !== "USDT" || next.view !== "CUSTOMERS")) next.sortKey = undefined;
  if (next.basis === "CURRENT_ASSET") {
    if (changes.basis || changes.view) next.direction = undefined;
    next.firstState = "ALL";
    if (next.sortKey && ["PERSONAL_DEPOSIT", "TEAM_DEPOSIT", "FIRST_SUCCEEDED_AT", "FIRST_CONFIRMED_CUSTOMER_COUNT"].includes(next.sortKey)) next.sortKey = undefined;
  }
  // Device sorts are independent of pool/maintenance state; the shared API default
  // sort can otherwise be POOL_ENTERED_AT/NEXT_DUE_AT, which DEVICES cannot accept.
  if (next.view === "DEVICES" && next.sortKey === undefined) next.sortKey = "LAST_ACTIVE_AT";
  return next;
}
export function analyticsWireQuery(state: AnalyticsQueryState, calendar: readonly SupportAnalyticsMonth[]): SupportAnalyticsQuery {
  const { month, ...query } = state;
  return { ...query, pageSize: state.view === "OVERVIEW" ? 1 : 20, ...(state.basis === "PERIOD_EVENT" ? analyticsMonthWindow(month, calendar) : {}) };
}
export function nextAnalyticsPage(state: AnalyticsQueryState, data: SupportAnalyticsResponse, pageNum: number): AnalyticsQueryState | null {
  if (!Number.isSafeInteger(pageNum) || pageNum < 1 || Math.abs(pageNum - state.pageNum) !== 1 || data.versionState !== "READY" || !data.queryVersion || pageNum > state.pageNum && !data.canContinue) return null;
  return { ...state, pageNum, expectedVersion: data.queryVersion };
}
function activeAnalyticsConditions(state: AnalyticsQueryState, groups: SupportAnalyticsResponse["scopeSummary"]["groups"], defaultBasis: Basis, personal = false) {
  const conditions: Array<{ key: string; label: string; remove: Partial<AnalyticsQueryState> }> = [];
  // 统计规则在「更多筛选」里时，不是默认的「按现在的客户」就写成条件条，收起时也看得见（ST-15）。总览的统计规则露在筛选条上，不另写。
  if (state.view !== "OVERVIEW" && state.basis && state.basis !== defaultBasis) conditions.push({ key: "basis", label: `统计规则：${BASIS_OPTIONS.find(option => option.value === state.basis)?.label ?? "未知"}`, remove: { basis: defaultBasis } });
  if (state.groupId !== undefined) conditions.push({ key: "group", label: `负责组：${groups.find(group => group.groupId === String(state.groupId))?.name || "组名未同步"}`, remove: { groupId: undefined } });
  if (state.category && state.category !== "ALL") conditions.push({ key: "category", label: `客户类别：${({ BOUND: "已绑定", PENDING: "待分配", ANOMALY: "归属异常" })[state.category]}`, remove: { category: "ALL" } });
  if (state.firstState && state.firstState !== "ALL") conditions.push({ key: "firstState", label: `首充：${FIRST_OPTIONS.find(option => option.value === state.firstState)?.label || "状态未知"}`, remove: { firstState: "ALL" } });
  if (state.filter && state.filter !== "ALL") conditions.push({ key: "filter", label: `服务：${(personal ? PERSONAL_FILTER_OPTIONS : FILTER_OPTIONS).find(option => option.value === state.filter)?.label || "状态未知"}`, remove: { filter: "ALL" } });
  if (state.agentId !== undefined) conditions.push({ key: "agent", label: `当前客服：账号 ${state.agentId}`, remove: { agentId: undefined } });
  if (state.keyword) conditions.push({ key: "keyword", label: `关键词：${state.keyword}`, remove: { keyword: undefined } });
  if (state.direction !== undefined) conditions.push({ key: "direction", label: `顺序：${state.direction === "ASC" ? "从低到高 / 从早到晚" : "从高到低 / 从近到远"}`, remove: { direction: undefined } });
  return conditions;
}
export function analyticsErrorText(error: unknown): string {
  if (error instanceof AnalyticsEntryError) return error.message;
  if (error instanceof SupportClientError) {
    if (error.backendMessage === "SUPPORT_ANALYTICS_SOURCE_UNAVAILABLE") return "统计来源暂不可用，请稍后重试。";
    if (error.backendMessage && ADMIN_ERROR_MESSAGES[error.backendMessage]) return displayAdminError(error);
    if (error.status === 401) return "登录已失效，请重新登录。";
    if (error.status === 403) return "当前范围已无查看权限，请重新核对负责范围。";
    if (error.status === 404) return "统计入口暂不可用，请联系技术人员核对服务。";
    if (error.status === 409) return "数据或权限有变化，请从第一页重新加载。";
    if (error.status === 503) return "统计来源暂不可用，请稍后重试。";
  }
  return "统计资料暂时无法确认，请重试。";
}
// TX-26 list time: 2026-11-05 14:30; the zone is stated once in the panel heading.
function dateText(value: string | null): string {
  return value === null ? "未知" : formatBusinessTimeCompact(value, "未知");
}
function Numeric({ value, observed, label, kind = "count", onClick, unavailable = false, places }: { value: string | null; observed?: string | null; label: string; kind?: "count" | "amount" | "hashrate"; onClick?: () => void; unavailable?: boolean; places?: number }) {
  const content = value === null ? "—" : kind === "amount" ? fullAmount(value, places) : kind === "hashrate" ? hashrateText(value, places) : value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const explanation = unavailable ? "资料暂不可用" : content === "—" ? observed == null ? "资料未同步" : `已数到 ${observed}，完整数还在统计` : `已核实 ${value}${observed != null && observed !== value ? `，已数到 ${observed}` : ""}`;
  const quiet = content === "—" ? " sa-quiet sa-dash" : /^0(\.0+)?$/.test(content) ? " sa-quiet" : "";
  return <span className="sa-number-wrap">{onClick ? <button type="button" className={`rd-link sa-number sa-link${quiet}`} title={explanation} aria-label={`${label}：${explanation}；查看明细`} onClick={onClick}>{content}</button> : <span className={`sa-number${quiet}`} tabIndex={0} title={explanation} aria-label={`${label}：${explanation}`}>{content}</span>}</span>;
}
function CountValue({ count, coverage = [], label, onClick }: { count: Count; coverage?: Count["status"][]; label: string; onClick?: () => void }) {
  const statuses = [count.status, ...coverage], unavailable = statuses.some(status => status === "FAILED" || status === "UNAVAILABLE");
  return <Numeric value={count.confirmed === null || !statuses.every(status => status === "AVAILABLE") ? null : String(count.confirmed)} observed={count.observed === null ? null : String(count.observed)} label={label} onClick={onClick} unavailable={unavailable} />;
}
function MoneyValue({ money, label, onClick, places }: { money?: Money; label: string; onClick?: () => void; places?: number }) { return <Numeric value={money?.confirmed ?? null} observed={money?.observed ?? null} label={label} kind="amount" onClick={onClick} places={places} />; }

// Customer table (design ①): full amounts, a real value drills down, a real 0 stays plain, unknown is a muted "-".
// Trailing zeros the backend pads are dropped; values shown side by side (one column, one card group) share
// the most decimals any of them really needs, at least two.
function fullAmount(value: string, _places?: number): string {
  // 金额按全站写法（amountDisplay）：千分位、去掉末尾 0、整数不写小数点，同列不补零对齐（PRD §5A）。
  return /^-?\d+(?:\.\d+)?$/.test(value) ? amountDisplay(value) : "—";
}
/** 算力不是金额，写法不变：同列补到 places 位（至少两位）。 */
function hashrateText(value: string, places = 2): string {
  const parts = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!parts) return "—";
  const fraction = (parts[3] ?? "").replace(/0+$/, "").padEnd(Math.max(2, places), "0");
  return `${parts[1]}${parts[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}
function amountPlaces(values: ReadonlyArray<string | null | undefined>): number {
  return values.reduce<number>((max, value) => Math.max(max, (/^-?\d+(?:\.(\d+))?$/.exec(value ?? "")?.[1] ?? "").replace(/0+$/, "").length), 2);
}
function CustomerValue({ value, observed, status, kind, label, onClick, places }: { value: string | null; observed?: string | null; status: Count["status"]; kind: "count" | "amount"; label: string; onClick: () => void; places?: number }) {
  const missing = value === null || status !== "AVAILABLE";
  const text = missing ? "—" : kind === "amount" ? fullAmount(value, places) : value;
  const note = !missing ? text : status === "FAILED" || status === "UNAVAILABLE" ? "资料暂不可用" : observed == null ? "数据还在同步" : `已数到 ${observed}，完整数还在统计`;
  return <button type="button" className={`rd-link sa-cell-value sa-link${/^0(\.0+)?$/.test(text) ? " zero" : missing ? " unknown sa-dash" : ""}`} title={missing ? note : undefined} aria-label={`${label}：${note}；查看明细`} onClick={onClick}>{text}</button>;
}
function countValue(count: Count): string | null { return count.confirmed === null || count.status !== "AVAILABLE" ? null : String(count.confirmed); }
function activityTime(value: string): string {
  return formatBusinessTimeCompact(value, "时间待核验");
}
/** 服务状态和它的颜色（VS-20、VS-22）：待回复橙黄；待维护、首次待联系是专属客服要去做的事，不是系统在跑，用灰色的默认待办态，和「我的客户」表同色（VS-21）；其余灰。 */
function serviceTag(task: SupportAnalyticsCustomer["task"]): [string, "warn" | "neutral"] {
  return task.status === "UNAVAILABLE" ? ["任务资料待加载", "neutral"] : task.waitingReply === true ? ["待回复", "warn"] : task.due === true ? ["待维护", "neutral"] : task.firstContact === true ? ["首次待联系", "neutral"] : task.enabled === false ? ["暂停主动维护", "neutral"] : task.status !== "COMPLETE" ? ["未知", "neutral"] : ["正常跟进", "neutral"];
}
export type CustomerSessionStart = { checkingId: string | null; start: (row: SupportAnalyticsCustomer) => void };
const SESSION_RETURN_KEY = "nexion-m1-customers-return-v1";

// The existing house picker lacks Escape/arrow focus; keep its appearance and supply keyboard behavior here.
export function analyticsOptionIndex(key: string, selected: number, length: number): number {
  if (length === 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowUp") return selected < 0 ? length - 1 : (selected - 1 + length) % length;
  return selected < 0 ? 0 : (selected + 1) % length;
}
function sortDirectionText(key: string): [string, string] {
  return ["PERSONAL_DEPOSIT", "TEAM_DEPOSIT", "AMOUNT", "HASHRATE"].includes(key) ? ["从高到低", "从低到高"]
    : ["LAST_ACTIVE_AT", "REGISTERED_AT", "ASSIGNED_AT", "FIRST_SUCCEEDED_AT", "SUCCEEDED_AT"].includes(key) ? ["从近到远", "从早到晚"] : ["从多到少", "从少到多"];
}
function AnalyticsSelect({ label, value, options, onChange }: { label: string; value: string; options: HDOption[]; onChange: (value: string) => void }) {
  return <FilterField label={label}><Select aria-label={label} value={value} options={options} onChange={onChange} /></FilterField>;
}

type Drill = (changes: Partial<AnalyticsQueryState>) => void;
/** 表里的业绩额格：核完了写数，点开看下钻；没核完写「—」和已核小计；不可用写「—」，原因在悬停和读屏里。 */
function PerfAmount({ value, label, onClick }: { value: PerfValue | undefined; label: string; onClick: () => void }) {
  const shown = value ?? PERF_UNAVAILABLE_VALUE, text = perfText(shown), note = perfNote(shown);
  return <Cell num main={<button type="button" className={`rd-link sa-number sa-link${text === "—" ? " sa-quiet sa-dash" : /^0$/.test(text) ? " sa-quiet" : ""}`} title={note} aria-label={`${label}：${note ?? text}；查看明细`} onClick={onClick}>{text}</button>}
    sub={shown.state === "partial" && shown.observed !== null ? `已核 ${perfText({ state: "complete", value: shown.observed })}` : undefined} />;
}
const PERF_SINCE = "自 2026-11-20 起";
export function AnalyticsTable({ data, currency, drill, openProfile, session, perf, month, groupId }: { data: SupportAnalyticsResponse; currency: Currency; drill: Drill; openProfile: (customerId: string) => void; session?: CustomerSessionStart; perf: AnalyticsPerf; month: string; groupId?: SupportAnalyticsQuery["groupId"] }) {
  const [agentId, setAgentId] = useState<string | null>(null);
  const agent = data.view === "AGENTS" && agentId ? data.records.find(row => row.accountId === agentId) : undefined;
  const accountId = agent?.accountId;
  const [targetPeriod, setTargetPeriod] = useState<{ origin: SupportAnalyticsResponse; accountId: string; month: string; groupId: typeof groupId; amount: PerfValue }>();
  useEffect(() => {
    const origin = data.performance?.window;
    if (!accountId || data.generation !== "READY" || data.basis !== "CURRENT_CUSTOMER_HISTORY" || !origin) return;
    const controller = new AbortController();
    const signal = controller.signal;
    void (async () => {
      const calendar = await analytics.months(signal);
      const selected = calendar.months.find(entry => entry.month === month);
      if (calendar.generation !== "READY" || !selected || signal.aborted) return;
      const receipt = await analytics.query({ view: "AGENTS", basis: "PERIOD_EVENT", from: selected.from, to: selected.to,
        agentId: accountId, groupId, currency: "USDT", pageNum: 1, pageSize: 100, signal }, "READY");
      if (signal.aborted || receipt.view !== "AGENTS" || receipt.scopeSummary.mode !== data.scopeSummary.mode) return;
      const window = receipt.performance?.window;
      const record = receipt.records.find(row => row.accountId === accountId)?.periodPerformance;
      if (!window || !record || window.month !== month || window.sourceVersion !== origin.sourceVersion
        || window.asOf !== origin.asOf || !samePerformanceWindow(record.window, window)) return;
      setTargetPeriod({ origin: data, accountId, month, groupId, amount: boardTotals(record).amount });
    })().catch(() => { /* The existing unavailable value covers an unsuccessful targeted read. */ });
    return () => controller.abort();
  }, [data, accountId, month, groupId]);
  // 这位客服所选月份的期间业绩额：有就写数，没有写「—」和原因（新版接口读成但没给这一项、升级中、旧版接口各一种说法）。
  const agentPeriod: PerfValue | undefined = agent && ((agent.periodPerformance?.window.month === month ? perf.agentPeriods?.[agent.accountId] : undefined)
    ?? (targetPeriod?.origin === data && targetPeriod.accountId === accountId && targetPeriod.month === month && targetPeriod.groupId === groupId ? targetPeriod.amount : undefined)
    ?? (data.generation === "READY" ? { state: "unavailable", reason: "暂时无法确认" } : data.generation === "UPGRADING" ? { state: "unavailable", reason: "数据正在升级" } : PERF_UNAVAILABLE_VALUE));
  if (!data.records.length) return <BlockState state="empty" title={data.total === null ? "还没数到记录，总数还在统计。" : "当前筛选下没有记录。"} />;
  const name = (row: Pick<SupportAnalyticsCustomer, "nickname" | "customerNo" | "customerId">) => operatorNicknameText(row.nickname || "") || m1CustomerCode(row.customerId);
  const unit = nexGridBrandText(currency);
  if (data.view === "AGENTS") {
    const days = (data.selectedCurrent ?? data.scopeSummary.current).activity.window.days, assets = data.basis === "CURRENT_ASSET";
    const activeHead = data.basis === "PERIOD_EVENT" ? `${month} 活跃` : days ? `近 ${days} 天活跃` : "当前统计期活跃";
    const role = (row: (typeof data.records)[number]) => row.account.handoverRequired ? "待交接" : !row.account.serviceAccount ? "客服主管" : row.account.serviceQualification === "ENABLED" ? row.account.supervisorAccount ? "专属客服兼主管" : "专属客服" : "资格暂停或未知";
    return <>
    <Table label="客服统计" className="m1-analytics-table m1-agent-table"><colgroup><col /><col /><col /><col /><col /></colgroup><thead><Tr><Th>客服 / 当前组</Th><Th align="right">当前绑定</Th><Th align="right">{activeHead}</Th>
      <Th align="right">{assets ? <span className="m1-th-stack">持有设备<small>当前 · 台</small></span>
        : <span className="m1-th-stack"><span className="m1-th-title">当前客户累计业绩额<Explain label="当前客户累计业绩额的说明" content="按现在的客户算，自 2026-11-20 22:57 起。每位客服这个月的业绩额：点「查看统计」，或看业绩榜。" /></span><small>按现在的客户 · {PERF_SINCE}</small></span>}</Th>
      <Th sticky="end" fit>操作</Th></Tr></thead><tbody>{data.records.map(row => {
      const customerCount = row.funds.customerCount !== undefined ? String(row.funds.customerCount) : row.current.firstConfirmed.confirmed !== null && row.current.firstNone.confirmed !== null && row.current.firstUnknown.confirmed !== null ? (BigInt(row.current.firstConfirmed.confirmed) + BigInt(row.current.firstNone.confirmed) + BigInt(row.current.firstUnknown.confirmed)).toString() : null;
      const group = data.scopeSummary.groups.find(g => g.groupId === row.account.groupId);
      const onlyAgent = (view: SupportAnalyticsView, extra: Partial<AnalyticsQueryState> = {}) => drill({ view, agentId: row.accountId, category: "BOUND", ...extra });
      return <Tr key={row.accountId} selected={agentId === row.accountId}><Td><div className="sa-identity"><SupportAvatar name={row.displayName || "客服"} path={row.avatarRef ?? undefined} version={row.avatar?.version} /><div><Button variant="ghost" size="sm" title={row.displayName || "客服"} onClick={() => onlyAgent("CUSTOMERS")}>{row.displayName || "名称未同步"}</Button><span className="rd-note">{group?.name || (row.account.groupId === null ? "待分组" : "组名未同步")} · {role(row)}</span></div></div></Td><Td align="right"><Numeric value={customerCount} label="当前绑定客户" onClick={() => onlyAgent("CUSTOMERS")} /></Td><Td align="right"><CountValue count={row.current.activity.active} coverage={[row.current.activity.status, row.current.activity.window.status]} label={activeHead} onClick={() => onlyAgent("ACTIVITY", { filter: "WINDOW_ACTIVE" })} /></Td><Td align="right">{assets ? <CountValue count={row.current.devices.held} label="当前持有设备" onClick={() => onlyAgent("DEVICES", { basis: "CURRENT_ASSET" })} /> : <PerfAmount value={perf.agents[row.accountId]} label="当前客户累计业绩额" onClick={() => onlyAgent("CUSTOMERS")} />}</Td><Td sticky="end" fit><Button size="sm" onClick={() => setAgentId(row.accountId)}>查看统计</Button></Td></Tr>;
    })}</tbody></Table>
    {agent && <Drawer open title="客服统计详情" sub={agent.displayName || `客服 ${agent.accountId}`} onClose={() => setAgentId(null)} footer={<div className="m1-drawer-actions"><Button type="button" onClick={() => setAgentId(null)}>返回统计列表</Button></div>}><Facts>
      <Fact k="当前组">{data.scopeSummary.groups.find(g => g.groupId === agent.account.groupId)?.name || "待分组"}</Fact>
      <Fact k="账号"><StatusTag tone={agent.account.accountState === "ENABLED" ? "ok" : "done"}>{agent.account.accountState === "ENABLED" ? "已启用" : agent.account.accountState === "DISABLED" ? "已停用" : "未知"}</StatusTag></Fact>
      <Fact k="资格">{agent.account.serviceQualification === "ENABLED" ? "专属客服资格有效" : agent.account.serviceQualification === "DISABLED" ? "资格暂停" : agent.account.serviceQualification === "REMOVED" ? "资格已移除" : "资格未知"}</Fact>
      {agentPeriod && <Fact k="期间业绩额" unit={agentPeriod.state === "complete" ? "USDT" : undefined}>{perfText(agentPeriod)}<span className="m1-fact-reason">{agentPeriod.state === "complete" ? month : perfNote(agentPeriod)}</span></Fact>}
      <Fact k="已首充"><CountValue count={agent.current.firstConfirmed} label="已首充客户" onClick={() => drill({ view: "CUSTOMERS", agentId: agent.accountId, category: "BOUND", firstState: "CONFIRMED" })} /></Fact>
      <Fact k="持有设备"><CountValue count={agent.current.devices.held} label="当前设备" onClick={() => drill({ view: "DEVICES", agentId: agent.accountId, category: "BOUND", basis: "CURRENT_ASSET" })} /></Fact>
      <Fact k="客户累计充值" unit={unit}><MoneyValue money={agent.current.ownLifetime.find(x => x.currency === currency)?.deposits} label={`客户累计充值 ${unit}`} onClick={() => drill({ view: "FINANCE", agentId: agent.accountId, category: "BOUND", basis: "CURRENT_CUSTOMER_HISTORY" })} /></Fact>
      <Fact k="当前余额" unit={unit}><Numeric kind="amount" value={agent.funds.balances?.find(f => f.currency === currency)?.confirmedAmount ?? null} observed={agent.funds.balances?.find(f => f.currency === currency)?.observedAmount} label={`当前余额 ${unit}`} onClick={() => drill({ view: "CUSTOMERS", agentId: agent.accountId, category: "BOUND" })} /></Fact>
    </Facts></Drawer>}
  </>;
  }
  if (data.view === "FINANCE") return <Table label="授权客户资金事件" className="m1-analytics-table m1-finance-table"><colgroup><col /><col /><col /><col /><col /><col /></colgroup><thead><Tr><Th>客户 / 用户编码</Th><Th>事件类型</Th><Th>成功时间</Th><Th align="right">金额 · {unit}</Th><Th>历史覆盖</Th><Th sticky="end" fit>详情</Th></Tr></thead><tbody>{data.records.map((row, index) => <Tr key={`${row.customerId}:${row.orderNo}:${row.succeededAt}:${index}`}><Td><Button variant="ghost" size="sm" title={name(row)} onClick={() => openProfile(row.customerId)}>{name(row)}</Button><span className="rd-note"><span className="m-user-code">{m1CustomerCode(row.customerId)}</span></span></Td><Td>{row.kind === "DEPOSIT" ? "充值" : row.kind === "DEVICE_PURCHASE" ? "购机" : row.kind === "CONSUMPTION" ? "付费消费" : "购机退款"}</Td><Td><span className="sa-nowrap" title={dateText(row.succeededAt)}>{row.succeededAt ? activityTime(row.succeededAt) : "—"}</span></Td><Td align="right"><Numeric value={row.amount} kind="amount" label={`此笔当前查到的金额 ${unit}`} onClick={() => openProfile(row.customerId)} places={amountPlaces(data.records.map(item => item.amount))} /></Td><Td><span className="sa-nowrap">{row.historyStatus === "READY" ? "已核实" : "历史未同步"}</span></Td><Td sticky="end" fit><Button size="sm" onClick={() => openProfile(row.customerId)}>客户资金详情</Button></Td></Tr>)}</tbody></Table>;
  if (data.view === "DEVICES") return <Table label="当前托管设备" className="m1-analytics-table m1-device-table"><colgroup><col /><col /><col /><col /><col /><col /></colgroup><thead><Tr><Th>设备 / 用户编码</Th><Th>类型</Th><Th align="right">算力</Th><Th>持有 / 连接</Th><Th>取得来源</Th><Th sticky="end" fit>详情</Th></Tr></thead><tbody>{data.records.map(row => <Tr key={row.deviceId}><Td><span title={row.deviceId}>{row.deviceId.length > 20 ? `${row.deviceId.slice(0, 8)}…${row.deviceId.slice(-8)}` : row.deviceId}</span><span className="rd-note">客户 <span className="m-user-code">{m1CustomerCode(row.customerId)}</span></span></Td><Td>{row.deviceType === "SHARE" || row.deviceType === "CLOUD_SHARE" ? "云份额" : row.deviceType === "DEVICE" ? "实体设备" : row.deviceType === "SERVER" ? "服务器" : "类型未知"}</Td><Td align="right"><Numeric value={row.hashrate} kind="hashrate" label="设备算力" onClick={() => openProfile(row.customerId)} places={amountPlaces(data.records.map(item => item.hashrate))} /></Td><Td>{row.holdingStatus === "AVAILABLE" ? "持有已核实" : "持有未知"}<span className="rd-note">{row.connectionStatus === "ONLINE" ? "在网" : row.connectionStatus === "OFFLINE" ? "离线" : row.connectionStatus === "NOT_APPLICABLE" ? "不适用" : "未知"}</span></Td><Td>{row.acquisition === "PAID_PURCHASE" ? "付费购买" : "来源未知"}</Td><Td sticky="end" fit><Button size="sm" onClick={() => openProfile(row.customerId)}>客户设备详情</Button></Td></Tr>)}</tbody></Table>;
  const personal = data.scopeSummary.mode === "PERSONAL";
  const showInviter = data.records.some(row => row.inviter !== undefined);
  // 客户、总览、活动三个视角共用这张客户表：邀请人放第二列，服务状态和最近活动合成一格两行，仍是 6 列（PRD §4.3，画布 06）。
  return <Table label="客户统计" className={`m1-analytics-table m1-customer-table${showInviter ? "" : " m1-customer-table-5"}`}><colgroup><col />{showInviter && <col />}<col /><col /><col /><col /></colgroup><thead><Tr><Th>{personal ? "客户" : "客户 / 专属客服"}</Th>{showInviter && <Th>邀请人<Explain label="邀请人的说明" content="邀请这位客户注册的人。人数在客户资料里看。" /></Th>}<Th>首充</Th><Th align="right">{personal ? "累计业绩额（USDT）" : <span className="m1-th-title"><Explain label="累计业绩额怎么算" content="这位客户自 2026-11-20 22:57 起的入金减提现，跟着客户走：转来之前在别的客服名下的也算在这里。" />累计业绩额（USDT）</span>}</Th><Th>服务状态 / 最近活动</Th><Th sticky="end">操作</Th></Tr></thead><tbody>{data.records.map(row => {
    const [status, statusTone] = serviceTag(row.task), checking = session?.checkingId === row.customerId;
    return <Tr key={row.customerId}><Td><div className="sa-identity"><SupportAvatar name={name(row)} path={row.avatar ?? undefined} /><div><Button variant="ghost" size="sm" title={`${name(row)}：查看资料与记录`} onClick={() => openProfile(row.customerId)}>{name(row)}</Button><span className="rd-note"><span className="m-user-code">{m1CustomerCode(row.customerId)}</span>{personal ? "" : ` · ${row.owner.agentName || "归属未知"}`}</span></div></div></Td>{showInviter && <Td><InviterCell view={inviterView(row.inviter)} /></Td>}<Td>{row.first.state === "CONFIRMED" ? <><StatusTag tone="ok">已首充</StatusTag><span className="rd-note">{row.first.kind ? row.first.kind === "DEPOSIT" ? "充值" : "购机" : "来源未知"}</span></> : row.first.state === "NONE" ? <StatusTag tone="done">未首充</StatusTag> : <span className="sa-nowrap" title="首充历史尚未同步">历史未同步</span>}</Td><Td align="right"><PerfAmount value={perf.customers[row.customerId]} label="累计业绩额" onClick={() => openProfile(row.customerId)} /></Td><Td><Cell main={<StatusTag tone={statusTone}>{status}</StatusTag>} sub={<>{row.activity.lastEffectiveAt ? <span className="sa-nowrap" tabIndex={0} title={dateText(row.activity.lastEffectiveAt)}>{activityTime(row.activity.lastEffectiveAt)}</span> : "—"} · {row.activity.state === "ACTIVE" ? "本统计期活跃" : row.activity.state === "INACTIVE" ? "本统计期未活跃" : "活动未知"}</>} /></Td><Td sticky="end">{session && row.category === "BOUND" ? <Button size="sm" loading={checking} onClick={() => session.start(row)}>发起会话</Button> : <Button size="sm" onClick={() => openProfile(row.customerId)}>查看资料</Button>}</Td></Tr>;
  })}</tbody></Table>;
}

function clockText(value: string | null): string {
  return value === null ? "-" : new Intl.DateTimeFormat("zh-CN", { timeZone: businessZone().zoneId, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(parseBusinessTime(value));
}
/** Design ②: someone else holds this customer; the operator can only wait or read the history. */
function SessionBusyDialog({ customer, hold, onRead, onClose }: { customer: string; hold: SupportSessionHold; onRead: () => void; onClose: () => void }) {
  const holder = hold.holder!, role = SUPPORT_SESSION_ROLE_LABEL[holder.role];
  return <Modal title="暂时不能发起会话" onClose={onClose} footer={<><Button onClick={onRead}>查看会话记录</Button><Button variant="primary" onClick={onClose}>知道了</Button></>}>
    <Facts><Fact k="客户">{customer}</Fact><Fact k="当前接待人">{holder.name} · {role}</Fact><Fact k="接待人最后发消息">{hold.lastSentAt ? dateText(hold.lastSentAt) : "—"}</Fact><Fact k="预计无人发言结束接待">{hold.autoEndAt ? dateText(hold.autoEndAt) : "—"}</Fact></Facts>
    <p>当前由 {holder.name} 接待，暂不能同时发起接待。可以查看会话记录，或等接待结束后再联系。</p><Fold inset title="接待规则" summary={hold.endMinutes === null ? "期限未读取" : `无人发言 ${hold.endMinutes} 分钟`}><p>接待人最后发消息后这么久没再发，接待就结束（客户发消息不算）；不结束对话、不改专属客服，也不清除待回复。</p></Fold>
  </Modal>;
}

export function M1AnalyticsWorkbench(props: { permission: Permission; ctx: MCtx }) {
  const session = useAdminAuth(state => state.session), epoch = useAdminAuth(state => state.authEpoch);
  return <ResolvedAnalyticsWorkbench key={adminShellSessionKey(session, epoch)} {...props} />;
}
function ResolvedAnalyticsWorkbench({ permission, ctx }: { permission: Permission; ctx: MCtx }) {
  const router = useRouter();
  const [, setRecoveryRevision] = useState(0);
  const [bulkRecovery, setBulkRecovery] = useState(false);
  const exportsPorts = usePerformanceExportPorts();
  const [exportOpen, setExportOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [events, setEvents] = useState<Awaited<ReturnType<typeof analytics.events>> | null>(null);
  const [eventPage, setEventPage] = useState<{ number: number; version?: string }>({ number: 1 });
  const [eventError, setEventError] = useState("");
  const eventPairRetried = useRef(false);
  const closeEvents = () => { setEventsOpen(false); setEvents(null); setEventError(""); setEventPage({ number: 1 }); };
  const openEvents = () => { eventPairRetried.current = false; setEventError(""); setEventPage({ number: 1 }); setEventsOpen(true); };
  useEffect(() => { const update = () => setRecoveryRevision(n => n + 1); window.addEventListener("m1-pending-changed", update); window.addEventListener("nexion-payment-security-updated", update); return () => { window.removeEventListener("m1-pending-changed", update); window.removeEventListener("nexion-payment-security-updated", update); }; }, []);
  const authSession = useAdminAuth(state => state.session);
  const tabIds = useTabIds();
  const pendingTabFocus = useRef<M1Tab | null>(null);
  const [scope, setScope] = useState<SupportAnalyticsResponse | null>(null), [scopeError, setScopeError] = useState(""), [scopeDenied, setScopeDenied] = useState(false);
  const teamChanged = useRef(false);
  const targetedRefresh = useRef(false);
  const [scopeRetry, setScopeRetry] = useState(0), [queryState, setQueryState] = useState(initialAnalyticsQuery("PERSONAL"));
  const [data, setData] = useState<SupportAnalyticsResponse | null>(null), [error, setError] = useState("");
  const [loading, setLoading] = useState(false), [retry, setRetry] = useState(0), [cancelled, setCancelled] = useState(false);
  const [requestedExports] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "exports");
  const restoreExports = useRef(requestedExports);
  const [section, setSection] = useState<Section>("stats"), [personalView, setPersonalView] = useState<PersonalWorkbenchView>("dashboard");
  const lastDataView = useRef<SupportAnalyticsView>("OVERVIEW");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [periodDetail, setPeriodDetail] = useState<SupportAnalyticsDetailView | null>(null);
  const [personalPeriodRetry, setPersonalPeriodRetry] = useState(0);
  const [fundMetric, setFundMetric] = useState<FundMetric | null>(null);
  const [monthCalendar, setMonthCalendar] = useState<SupportAnalyticsMonth[] | null>(null);
  const [calendarGeneration, setCalendarGeneration] = useState<"LEGACY" | "READY" | "UPGRADING">();
  const [calendarError, setCalendarError] = useState(""), [calendarRetry, setCalendarRetry] = useState(0);
  const [personalPeriod, setPersonalPeriod] = useState<SupportAnalyticsResponse | null>(null), [personalPeriodError, setPersonalPeriodError] = useState("");
  const perf = useMemo(() => analyticsPerf(data, personalPeriod), [data, personalPeriod]);
  const adminId = useAdminAuth(state => state.session?.adminId);
  const operatorName = useAdminAuth(state => state.session?.operator || state.session?.username || "本人账号");
  // 「返回负责组客户」 from M3 brings back the list view, filters and page saved when 发起会话 was clicked.
  const [sessionReturn] = useState<AnalyticsQueryState | null>(() => {
    if (typeof window === "undefined" || new URLSearchParams(window.location.search).get("restore") !== "customers") return null;
    let saved: { adminId?: number; query?: AnalyticsQueryState } | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(SESSION_RETURN_KEY) ?? "null"); } catch { return null; }
    return saved?.adminId === adminId && saved?.query?.view === "CUSTOMERS" ? saved.query : null;
  });
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("restore") !== "customers") return;
    const url = new URL(window.location.href); url.searchParams.delete("restore"); window.history.replaceState(null, "", url);
    try { sessionStorage.removeItem(SESSION_RETURN_KEY); } catch { /* nothing left to clear */ }
  }, []);
  const managementReturnQuery = useRef<AnalyticsQueryState | null>(sessionReturn);
  const managementCustomerGroup = useRef<string | null>(null);
  const [keyword, setKeyword] = useState(sessionReturn?.keyword ?? "");
  const [transferCustomer, setTransferCustomer] = useState<string | null>(null), [transferRevision, setTransferRevision] = useState(0), [transferNotice, setTransferNotice] = useState("");
  const [sessionCheck, setSessionCheck] = useState<string | null>(null), [sessionBusy, setSessionBusy] = useState<{ row: SupportAnalyticsCustomer; hold: SupportSessionHold } | null>(null), [sessionError, setSessionError] = useState<SupportAnalyticsCustomer | null>(null);
  const sessionController = useRef<AbortController | null>(null);
  useEffect(() => () => sessionController.current?.abort(), []);
  useEffect(() => { sessionController.current?.abort(); setSessionCheck(null); setSessionBusy(null); setSessionError(null); }, [queryState, section]);
  // 9) A saved group that is no longer in this operator's scope is not widened silently.
  const [restoreNotice, setRestoreNotice] = useState("");
  useEffect(() => { setRestoreNotice(""); }, [queryState.groupId, section]);
  const controllerRef = useRef<AbortController | null>(null), scopeControllerRef = useRef<AbortController | null>(null), generation = useRef(0);
  const entryStatistics = useRef<{ query: string; data: SupportAnalyticsResponse } | null>(null);
  const isPersonal = scope?.scopeSummary.mode === "PERSONAL";
  const showStatistics = Boolean(scope && section === "stats");
  const statisticsCalendar = queryState.basis === "PERIOD_EVENT" ? monthCalendar : null;
  const fundSource = useMemo<StatisticSource | null>(() => {
    if (periodDetail && personalPeriod && monthCalendar) return { kind: "fund", metric: "net", detailView: periodDetail, origin: personalPeriod,
      query: { view: "OVERVIEW", basis: "PERIOD_EVENT", ...analyticsMonthWindow(queryState.month, monthCalendar), currency: queryState.currency ?? "USDT" } };
    return data && fundMetric && (queryState.basis !== "PERIOD_EVENT" || statisticsCalendar)
      ? { kind: "fund", metric: fundMetric, origin: data, query: analyticsWireQuery(queryState, statisticsCalendar ?? []) } : null;
  }, [periodDetail, personalPeriod, monthCalendar, data, fundMetric, queryState, statisticsCalendar]);
  const readModes = useAdminAuth(state => state.session?.supportReadModes);
  // A session hint only chooses the requested projection. The response still resolves current authority.
  const noReadableServiceScope = readModes?.length === 0 && authSession?.role !== "super" && authSession?.role !== "superadmin";
  const noScopedContent = scopeDenied && (noReadableServiceScope || !!exportsPorts?.persona.views.length);
  const entryReadMode = readModes?.includes("ALL") ? "ALL" : readModes?.includes("MANAGED") ? "MANAGED" : readModes?.includes("PERSONAL") ? "PERSONAL" : "ALL";
  const needsCalendar = Boolean(scope && (isPersonal || queryState.basis === "PERIOD_EVENT"));
  // A supervisor who also holds personal service keeps a tab for their own customers, grouped or not (the managed agent list omits an ungrouped self).
  const canMine = scope?.scopeSummary.mode === "MANAGED" && Boolean(readModes?.includes("PERSONAL"));
  useEffect(() => { if (queryState.view !== "CUSTOMERS") lastDataView.current = queryState.view; }, [queryState.view]);
  // The 正式转绑 links from M3 land on the customer's transfer form, whichever tab this role opens on. Personal mode keeps its drawer.
  const scopeMode = scope?.scopeSummary.mode;
  useEffect(() => {
    const params = new URLSearchParams(window.location.search), customerId = params.get("customerId");
    if (scopeMode && scopeMode !== "PERSONAL" && params.get("action") === "transfer" && customerId && /^[1-9]\d*$/.test(customerId)) setTransferCustomer(customerId);
  }, [scopeMode]);
  useEffect(() => {
    const controller = new AbortController();
    setPersonalPeriod(null); setPersonalPeriodError("");
    if (scope?.scopeSummary.mode !== "PERSONAL" || !monthCalendar?.some(month => month.month === queryState.month)) return () => controller.abort();
    void analytics.query({ view: "OVERVIEW", basis: "PERIOD_EVENT", ...analyticsMonthWindow(queryState.month, monthCalendar), currency: queryState.currency ?? "USDT", pageSize: 1, signal: controller.signal }, scope.generation)
      .then(next => { if (!controller.signal.aborted && next.scopeSummary.mode === "PERSONAL") setPersonalPeriod(next); })
      .catch(cause => { if (!controller.signal.aborted) setPersonalPeriodError(analyticsErrorText(cause)); });
    return () => controller.abort();
  }, [scope, queryState.month, queryState.currency, monthCalendar, personalPeriodRetry]);
  useEffect(() => {
    const controller = new AbortController();
    setMonthCalendar(null); setCalendarGeneration(undefined); setCalendarError("");
    if (!needsCalendar) return () => controller.abort();
    void analytics.months(controller.signal).then(({ months, generation }) => {
      if (controller.signal.aborted) return;
      setMonthCalendar(months); setCalendarGeneration(generation);
      if (months[0]) setQueryState(previous => months.some(month => month.month === previous.month) ? previous : changeAnalyticsQuery(previous, { month: months[0].month }));
    })
      .catch(cause => { if (!controller.signal.aborted) setCalendarError(analyticsErrorText(cause)); });
    return () => controller.abort();
  }, [needsCalendar, scopeRetry, calendarRetry]);
  useEffect(() => {
    const controller = new AbortController(); scopeControllerRef.current = controller; entryStatistics.current = null; if (!targetedRefresh.current) setScope(null); targetedRefresh.current = false; setScopeError(""); setScopeDenied(false); setData(null); setProfileId(null);
    (async () => {
      const agentId = analyticsEntryAgent(window.location.search);
      let query = analyticsWireQuery(initialAnalyticsQuery(entryReadMode), []);
      let next: SupportAnalyticsResponse;
      try {
        next = await analytics.query({ ...query, signal: controller.signal });
      } catch (cause) {
        // A stale seat/supervisor hint can request a projection no longer allowed to this operator.
        if (controller.signal.aborted || query.view === "OVERVIEW" || !(cause instanceof SupportClientError) || cause.status !== 403) throw cause;
        query = analyticsWireQuery(initialAnalyticsQuery("ALL"), []);
        next = await analytics.query({ ...query, signal: controller.signal });
      }
      return { next, agentId, query };
    })().then(({ next, agentId, query }) => {
      if (controller.signal.aborted) return;
      entryStatistics.current = { query: JSON.stringify(query), data: next };
      const remembered = managementReturnQuery.current;
      managementReturnQuery.current = null;
      const customerGroup = managementCustomerGroup.current;
      managementCustomerGroup.current = null;
      const groupId = remembered && next.scopeSummary.mode !== "PERSONAL" && next.scopeSummary.groups.some(group => group.groupId === String(remembered.groupId)) ? remembered.groupId : undefined;
      if (remembered && remembered === sessionReturn && remembered.groupId !== undefined && groupId === undefined) setRestoreNotice("原来选的分组已不在你的负责范围，下面显示的是全部负责组。请重新选择分组。");
      if (customerGroup && String(groupId) !== customerGroup) throw new SupportClientError(403, undefined, undefined);
      const restored: AnalyticsQueryState = remembered ? { ...changeAnalyticsQuery(remembered, { groupId, view: next.scopeSummary.mode === "PERSONAL" && ["OVERVIEW", "AGENTS"].includes(remembered.view) ? "CUSTOMERS" : remembered.view }), agentId: groupId === remembered.groupId ? remembered.agentId : undefined } : { ...initialAnalyticsQuery(next.scopeSummary.mode), ...(agentId === undefined ? {} : { view: "CUSTOMERS" as const, category: "BOUND" as const, agentId }) };
      if (!remembered) {
        if (next.generation !== "LEGACY" && restored.view === "OVERVIEW" && agentId === undefined) restored.basis = "PERIOD_EVENT";
        const params = new URLSearchParams(window.location.search);
        const fields = { dataset: ["OVERVIEW", "AGENTS", "CUSTOMERS", "FINANCE", "DEVICES", "ACTIVITY"], basis: BASIS_OPTIONS.map(x => x.value), currency: ["USDT", "UVT"], category: ["ALL", "BOUND", "PENDING", "ANOMALY"], firstState: FIRST_OPTIONS.map(x => x.value), filter: PERSONAL_FILTER_OPTIONS.map(x => x.value), direction: ["ASC", "DESC"] };
        const changes: Partial<AnalyticsQueryState> = {};
        for (const [key, choices] of Object.entries(fields)) {
          const value = params.get(key); if (!value) continue;
          if (params.getAll(key).length !== 1 || !choices.includes(value as never)) { setRestoreNotice("部分入口筛选无效，已恢复当前范围的默认条件。"); continue; }
          Object.assign(changes, { [key === "dataset" ? "view" : key]: value });
        }
        if (next.scopeSummary.mode === "PERSONAL" && (changes.view === "AGENTS" || changes.view === "OVERVIEW")) changes.view = "CUSTOMERS";
        const requestedGroup = params.get("groupId");
        if (requestedGroup && next.scopeSummary.mode !== "PERSONAL") {
          if (next.scopeSummary.groups.some(g => g.groupId === requestedGroup)) changes.groupId = requestedGroup;
          else setRestoreNotice("原组已不在当前负责范围，请重新选择分组。");
        }
        const month = params.get("month"); if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) changes.month = month;
        Object.assign(restored, changeAnalyticsQuery(restored, changes));
        const sortKey = params.get("sortKey");
        if (restored.basis !== "CURRENT_ASSET" && sortKey && SORT_OPTIONS[restored.view].some(x => x.value === sortKey)) restored.sortKey = sortKey as AnalyticsQueryState["sortKey"];
        if ((sortKey === "NET_CONTRIBUTION" || sortKey === "PERFORMANCE_AMOUNT") && next.generation === "READY" && restored.view === "CUSTOMERS" && restored.basis === "CURRENT_CUSTOMER_HISTORY" && restored.currency === "USDT") restored.sortKey = "PERFORMANCE_AMOUNT";
        if (restored.basis === "CURRENT_ASSET") restored.direction = undefined;
        try { const savedKeyword = sessionStorage.getItem(`nexion-m1-keyword:${adminId}`); if (savedKeyword && savedKeyword.length <= 200) { restored.keyword = savedKeyword; setKeyword(savedKeyword); } } catch { /* Search remains usable without memory. */ }
      }
      if (remembered && remembered.view === restored.view && restored.basis !== "CURRENT_ASSET" && (remembered.sortKey !== "PERFORMANCE_AMOUNT" || next.generation === "READY")) restored.sortKey = remembered.sortKey;
      if (remembered === sessionReturn && sessionReturn && restored.groupId === sessionReturn.groupId && sessionReturn.pageNum > 1 && sessionReturn.expectedVersion) Object.assign(restored, { pageNum: sessionReturn.pageNum, expectedVersion: sessionReturn.expectedVersion });
      const personal = next.scopeSummary.mode === "PERSONAL";
      if (agentId !== undefined) setSection("stats");
      else if (!remembered) {
        const tab = entryTab(personal, next.scopeSummary.mode === "MANAGED" && Boolean(readModes?.includes("PERSONAL")), false);
        if (tab === "customers") restored.view = "CUSTOMERS";
        setSection(personal ? tab === "my-data" ? "stats" : tab === "exports" ? "exports" : "personal" : tab === "data" || tab === "customers" ? "stats" : tab as Section);
        if (personal) setPersonalView(tab === "my-customers" ? "customers" : "dashboard");
      } else setSection(current => current === "exports" || personal === (current === "personal") || current === "stats" ? current : personal ? "personal" : "stats");
      setScope(next); setQueryState(restored);
    }).catch(cause => { if (!controller.signal.aborted) { setScope(null); setScopeDenied(cause instanceof SupportClientError && cause.status === 403); setScopeError(analyticsErrorText(cause)); } });
    return () => controller.abort();
  }, [scopeRetry, entryReadMode]);
  useEffect(() => {
    const invalidate = (event: Event) => refreshScope(true, Boolean((event as CustomEvent<{ customerId?: string }>).detail?.customerId));
    window.addEventListener("support-scope-invalidated", invalidate);
    return () => window.removeEventListener("support-scope-invalidated", invalidate);
  }, [queryState]);
  useEffect(() => {
    if (!showStatistics) { entryStatistics.current = null; return; }
    if (queryState.basis === "PERIOD_EVENT" && !statisticsCalendar?.some(month => month.month === queryState.month)) return;
    const current = ++generation.current, controller = new AbortController(); controllerRef.current = controller;
    setData(null); setProfileId(null); setError(""); setLoading(true); setCancelled(false);
    (async () => {
      const query = analyticsWireQuery(queryState, statisticsCalendar ?? []);
      const entry = entryStatistics.current;
      entryStatistics.current = null;
      // Reuse only this mount's just-authorized response for the identical first query.
      return entry?.query === JSON.stringify(query) ? entry.data : analytics.query({ ...query, signal: controller.signal }, scope?.generation);
    })().then(next => {
      if (controller.signal.aborted || current !== generation.current) return;
      if (next.scopeSummary.mode !== scope?.scopeSummary.mode) { setScope(null); setScopeRetry(n => n + 1); return; }
      setData(next);
    }).catch(cause => {
      if (controller.signal.aborted || current !== generation.current) return;
      setData(null); setError(analyticsErrorText(cause));
      if (cause instanceof SupportClientError && (cause.status === 409 || cause.apiCode === 409)) {
        setEventsOpen(false); setFundMetric(null); setProfileId(null);
        if (queryState.expectedVersion) setQueryState(previous => changeAnalyticsQuery(previous, {}));
      }
      if (cause instanceof SupportClientError && [401, 403].includes(cause.status)) { setScope(null); setScopeError(analyticsErrorText(cause)); }
    }).finally(() => { if (!controller.signal.aborted && current === generation.current) setLoading(false); });
    return () => { controller.abort(); generation.current++; };
  }, [showStatistics, queryState, retry, scope?.scopeSummary.mode, scope?.generation, statisticsCalendar]);
  useEffect(() => {
    const origin = personalPeriod?.performance;
    const period = origin?.period?.totals;
    if (!eventsOpen || !origin || !period || !monthCalendar?.some(entry => entry.month === queryState.month)) return;
    const controller = new AbortController();
    const calendar = analyticsMonthWindow(queryState.month, monthCalendar);
    void analytics.events({ ...calendar, pageNum: eventPage.number, pageSize: 20, expectedVersion: eventPage.version, signal: controller.signal }).then(next => {
      if (controller.signal.aborted) return;
      if (!samePerformanceWindow(next.window, period.window)) throw new SupportClientError(409, undefined, "SUPPORT_ANALYTICS_QUERY_CHANGED");
      if (!samePerformanceWindow(next.window, origin.window)
        || [next.totals, next.visible, next.restricted].some(part => !samePerformanceWindow(part.window, next.window))
        || !sameCoveredPerformance(next.totals, period)) throw new Error("SUPPORT_CONTRACT_MALFORMED:performance.eventReconciliation");
      setEvents(next);
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setEvents(null);
      if (cause instanceof SupportClientError && (cause.status === 409 || cause.apiCode === 409) && !eventPairRetried.current) {
        eventPairRetried.current = true;
        setEventPage({ number: 1 });
        setPersonalPeriod(null);
        setPersonalPeriodRetry(value => value + 1);
        return;
      }
      setEventsOpen(false);
      setEventError(analyticsErrorText(cause));
    });
    return () => controller.abort();
  }, [eventsOpen, eventPage, personalPeriod, monthCalendar, queryState.month]);
  useEffect(() => {
    if (!scope || exportsPorts === undefined) return;
    if (restoreExports.current) {
      restoreExports.current = false;
      if (exportsPorts?.persona.views.length) setSection("exports");
    } else if (section === "exports" && !exportsPorts?.persona.views.length) {
      setSection(isPersonal ? "personal" : "stats");
    }
  }, [scope, exportsPorts, section, isPersonal]);
  const change: Drill = changes => {
    controllerRef.current?.abort(); generation.current++; setData(null); setProfileId(null); setFundMetric(null); setError("");
    if (changes.month !== undefined || changes.currency !== undefined) closeEvents();
    const basis = scope?.generation !== "LEGACY" && changes.basis === undefined
      ? changes.view === "OVERVIEW" ? "PERIOD_EVENT" : changes.view === "AGENTS" ? "CURRENT_CUSTOMER_HISTORY" : undefined : undefined;
    setQueryState(previous => changeAnalyticsQuery(previous, basis ? { ...changes, basis } : changes));
  };
  function refreshScope(invalidated = false, targeted = false) {
    closeEvents();
    targetedRefresh.current = targeted;
    setFundMetric(null);
    scopeControllerRef.current?.abort(); controllerRef.current?.abort(); generation.current++;
    sessionController.current?.abort(); setSessionCheck(null); setSessionBusy(null); setSessionError(null);
    managementReturnQuery.current = invalidated ? changeAnalyticsQuery(queryState, { groupId: undefined, keyword: undefined }) : { ...queryState, pageNum: 1, expectedVersion: undefined };
    if (invalidated) setKeyword("");
    if (!targeted) setScope(null);
    setScopeError(""); setData(null); setProfileId(null); setError("");
    setScopeRetry(n => n + 1);
  }
  function reloadFirstPage() { change({}); setRetry(n => n + 1); }
  function closeTransfer(keepCustomer = false) {
    const url = new URL(window.location.href); url.searchParams.delete("action"); if (!keepCustomer) url.searchParams.delete("customerId"); window.history.replaceState(null, "", url);
    setTransferCustomer(null);
  }
  const invalidateFund = useCallback((status: number) => {
    if (status === 409) {
      setRestoreNotice("统计已变化，正在重新读取汇总和明细第一页。");
      setData(null);
      setPersonalPeriod(null);
      setPersonalPeriodRetry(n => n + 1);
      setQueryState(previous => ({ ...previous, pageNum: 1, expectedVersion: undefined }));
    } else {
      refreshScope();
      setRestoreNotice("查看权限已变化，已关闭资金明细并重新核对范围。");
    }
  }, [queryState]);
  function openSessions(row: SupportAnalyticsCustomer) {
    try { sessionStorage.setItem(SESSION_RETURN_KEY, JSON.stringify({ adminId, query: queryState })); } catch { /* without storage the back link opens the default list */ }
    router.push(`/service/sessions?customerId=${encodeURIComponent(row.customerId)}&from=customers`);
  }
  const sessionStart: CustomerSessionStart = { checkingId: sessionCheck, start: row => {
    sessionController.current?.abort();
    const controller = new AbortController(); sessionController.current = controller;
    setSessionCheck(row.customerId); setSessionError(null); setSessionBusy(null);
    void supportClient.sessionHold(row.customerId, controller.signal).then(hold => {
      if (controller.signal.aborted) return;
      setSessionCheck(null);
      if (hold.state === "OTHER") setSessionBusy({ row, hold }); else openSessions(row);
    }).catch(() => { if (!controller.signal.aborted) { setSessionCheck(null); setSessionError(row); } });
  } };
  const customerName = (row: SupportAnalyticsCustomer) => operatorNicknameText(row.nickname || "") || m1CustomerCode(row.customerId);
  function page(number: number) {
    if (!data) return;
    const next = nextAnalyticsPage(queryState, data, number);
    if (!next) return;
    controllerRef.current?.abort(); generation.current++; setData(null); setProfileId(null);
    // Paging keeps the signed query; all other edits use the reset reducer.
    setQueryState(next);
  }
  useEffect(() => {
    if (!scope) return;
    const url = new URL(window.location.href);
    const tab = section === "exports" ? "exports" : isPersonal ? section === "stats" ? "my-data" : personalView === "customers" ? "my-customers" : "home" : section === "stats" ? queryState.view === "CUSTOMERS" ? "customers" : "data" : section;
    if (!restoreExports.current) url.searchParams.set("view", tab);
    const fields = { dataset: queryState.view, basis: queryState.basis, currency: queryState.currency, month: queryState.month, groupId: queryState.groupId, category: queryState.category, firstState: queryState.firstState, filter: queryState.filter, sortKey: queryState.sortKey, direction: queryState.direction };
    for (const [key, value] of Object.entries(fields)) { if (key === "filter" && section !== "stats") continue; if (value === undefined) url.searchParams.delete(key); else url.searchParams.set(key, String(value)); }
    window.history.replaceState(null, "", url);
    try { sessionStorage.setItem(`nexion-m1-keyword:${adminId}`, queryState.keyword ?? ""); } catch { /* Search remains usable without memory. */ }
  }, [scope, section, personalView, isPersonal, queryState, adminId, exportsPorts]);
  useLayoutEffect(() => {
    if (!scope || !pendingTabFocus.current) return;
    document.getElementById(tabIds.tab(pendingTabFocus.current))?.focus();
    pendingTabFocus.current = null;
  }, [section, personalView, queryState.view, scope, tabIds]);
  const visible = authSession ? resolveVisibleDomains(authSession) : [];
  const leaderboardReachable = !!authSession && (scope || readModes?.length || authSession.role === "super" || authSession.role === "superadmin") && authSession.authorities.some(code => code === "service_m1_read" || code === "service_m3_read") && canAccessResolvedPath(visible, "/service/leaderboard");
  const personalHeader = scope?.scopeSummary.mode === "PERSONAL";
  // 主管和超管：页头次按钮是会话审阅、刷新，「业绩榜」在页底相关页面一行（PG-15、PG-40）；专属客服本人仍在页头。
  // 没有负责组、只有导出记录的账号（申请人调出了组，或只有审批权）：只露「导出记录」一个页签（6k、6l）。
  const exportsOnly = !!exportsPorts?.persona.views.length && noScopedContent;
  const header = <PageHeader pageId="M1" title="客服工作台" summary={exportsOnly ? exportsPorts.persona.views.includes("MINE") ? "查看和撤回你提交的业绩导出申请。" : "审批客服业绩明细的导出申请。" : noScopedContent ? "设置负责组后，这里显示组里的客服和客户。" : "先处理客户待办，再核对分配和维护进展。"} actions={<>
    {exportsPorts && (exportsPorts.persona.canExport || exportsPorts.persona.exportBlocked) && <Button disabledReason={exportsPorts.persona.exportBlocked} onClick={() => setExportOpen(true)}>导出业绩</Button>}
    {scope?.scopeSummary.mode === "MANAGED" && <SelfAvatarEditor name={operatorName} ctx={ctx} onChanged={() => undefined} />}
    {scope && scope.scopeSummary.mode !== "PERSONAL" && canAccessResolvedPath(visible, "/service/sessions") && <Button onClick={() => router.push("/service/sessions?tab=pending")}>会话审阅</Button>}
    {personalHeader && leaderboardReachable && <Button onClick={() => router.push("/service/leaderboard")}>业绩榜</Button>}{!noScopedContent && <Button onClick={() => refreshScope()}>刷新</Button>}
  </>} />;
  const related = !personalHeader && leaderboardReachable && <nav className="rd-links" aria-label="相关页面"><span>相关页面</span><a className="rd-link" href="/service/leaderboard" onClick={event => { event.preventDefault(); router.push("/service/leaderboard"); }}>业绩榜</a></nav>;
  if (!scope) return <section className="sa-workbench" aria-busy={!scopeError} {...(exportsOnly ? tabIds.panel("exports") : {})}>{header}{exportsOnly ? <><PageTabs ids={tabIds} label="客服工作台" value="exports" items={[{ value: "exports", label: TAB_LABEL.exports }]} onChange={() => undefined} /><PerfExportRecords ports={exportsPorts} /></> : <Panel><BlockState state={noScopedContent ? "empty" : scopeError ? "error" : "loading"} title={noScopedContent ? "你的账号没有负责的组，也没有本人客户，这页没有可看的内容。" : scopeError || "正在核对当前可见范围…"} detail={noScopedContent ? "主管负责的组由超级管理员在「客服与分组」里设置。" : undefined} onRetry={scopeError && !noScopedContent ? () => setScopeRetry(n => n + 1) : undefined} retryLabel="重新核对范围" /></Panel>}{noScopedContent && related}</section>;

  const mode = scope.scopeSummary.mode, currency = queryState.currency ?? "USDT";
  const leadPermission: Permission = mode === "ALL" ? "superadmin" : "supervisor";
  const tabs = roleTabs(isPersonal, canMine, Boolean(exportsPorts?.persona.views.length));
  const currentTab: M1Tab = section === "exports" ? "exports" : isPersonal
    ? section === "stats" ? "my-data" : personalView === "customers" ? "my-customers" : "home"
    : section === "stats" ? queryState.view === "CUSTOMERS" ? "customers" : "data" : section === "personal" ? "data" : section;
  function openTab(tab: M1Tab) {
    // Group changes in 客服与分组 feed the scope (group chips, names); re-read it once the supervisor leaves that tab.
    if (section === "team" && tab !== "team" && teamChanged.current) { teamChanged.current = false; setScope(null); setScopeRetry(n => n + 1); }
    restoreExports.current = false;
    closeEvents();
    const url = new URL(window.location.href); url.searchParams.set("view", tab); window.history.replaceState(null, "", url);
    if (tab === "exports") { setSection("exports"); return; }
    if (tab === "home" || tab === "my-customers") { setSection("personal"); setPersonalView(tab === "home" ? "dashboard" : "customers"); return; }
    if (tab === "mine") { setSection("mine"); setPersonalView("customers"); return; }
    if (tab === "pool" || tab === "team") { setSection(tab); return; }
    setSection("stats");
    if (tab === "customers" && queryState.view !== "CUSTOMERS") change({ view: "CUSTOMERS" });
    if (tab === "data" && queryState.view === "CUSTOMERS") change({ view: lastDataView.current });
  }
  const personalFinancial = personalPeriod?.scopeSummary.financial;
  const selectedGroup = queryState.groupId === undefined ? undefined : scope.scopeSummary.groups.find(g => g.groupId === String(queryState.groupId));
  const groups = scope.scopeSummary.groups;
  const defaultBasis = queryState.view === "DEVICES" ? "CURRENT_ASSET"
    : queryState.view === "OVERVIEW" && scope.generation !== "LEGACY" ? "PERIOD_EVENT" : "CURRENT_CUSTOMER_HISTORY";
  const activeConditions = activeAnalyticsConditions(queryState, groups, defaultBasis, isPersonal);
  const monthOptions = monthCalendar ? analyticsMonths(monthCalendar) : [];
  const drill: Drill = changes => { setSection("stats"); setKeyword(""); change({ groupId: undefined, agentId: undefined, category: "ALL", keyword: undefined, firstState: "ALL", filter: "ALL", sortKey: undefined, direction: undefined, ...changes }); };
  const current = data?.selectedCurrent ?? data?.scopeSummary.current, personnel = data?.scopeSummary.personnel;
  const scopeCurrent = scope.selectedCurrent ?? scope.scopeSummary.current;
  const deposits = queryState.basis === "PERIOD_EVENT" ? data?.scopeSummary.financial.currencies.find(x => x.currency === currency)?.deposits : current?.ownLifetime.find(x => x.currency === currency)?.deposits;
  /** 折叠标题写结论，不重复里面的数字（DP-04、DP-61）。 */
  const perfConclusion = (value: PerfValue) => value.state === "complete" ? "已核完" : value.state === "partial" ? "有数据没核完" : value.reason;
  const overviewSummary = !data || queryState.view !== "OVERVIEW" ? undefined
    : queryState.basis === "PERIOD_EVENT" ? `期间业绩 · ${perfConclusion(perf.scope.period.amount)}`
    : queryState.basis === "CURRENT_ASSET" ? "按当前设备 · 不含业绩额"
    : `当前客户累计 · ${perfConclusion(perf.scope.current)}`;
  const basisExplain = queryState.view === "OVERVIEW" ? "按发生时归属：组卡写这个月的业绩额，下面一行写当前客户累计。按现在的客户：只写当前客户累计。按当前设备：只写设备，不写业绩额。"
    : "客服表的当前客户累计业绩额总是按现在的客户算。选「按发生时归属」时，近 30 天活跃换成所选月份的活跃；选「按当前设备」时，累计业绩额那一列换成持有设备。";
  const basisField = <FilterField label={<span className="m1-field-label">统计规则<Explain label="统计规则的说明" content={basisExplain} /></span>}><Select aria-label="统计规则" value={queryState.basis ?? "CURRENT_CUSTOMER_HISTORY"} options={BASIS_OPTIONS.filter(x => queryState.view !== "FINANCE" || x.value !== "CURRENT_ASSET")} onChange={value => { const found = BASIS_OPTIONS.find(x => x.value === value && (queryState.view !== "FINANCE" || x.value !== "CURRENT_ASSET")); if (found) change({ basis: found.value }); }} /></FilterField>;
  const monthField = <AnalyticsSelect label="月份" value={queryState.month} options={(monthCalendar ?? []).map(({ month }) => ({ value: month, label: month }))} onChange={month => change({ month })} />;
  // 排序项和方向共用一个下拉（ST-05）。
  const sortChoices = queryState.view === "OVERVIEW" ? [] : SORT_OPTIONS[queryState.view].filter(x => x.value !== "NET_CONTRIBUTION" && (queryState.basis !== "CURRENT_ASSET" || !["PERSONAL_DEPOSIT", "TEAM_DEPOSIT", "FIRST_CONFIRMED_CUSTOMER_COUNT"].includes(x.value)))
    .flatMap(x => { const [down, up] = sortDirectionText(x.value); return [{ value: `${x.value}:DESC`, label: `${x.label} · ${down}` }, { value: `${x.value}:ASC`, label: `${x.label} · ${up}` }]; });
  const perfSortShown = scope.generation === "READY" && queryState.view === "CUSTOMERS" && queryState.basis === "CURRENT_CUSTOMER_HISTORY" && queryState.currency === "USDT" && !isPersonal;
  const sortValue = queryState.sortKey ? `${queryState.sortKey}:${queryState.direction ?? "DESC"}` : queryState.view === "AGENTS" ? "BOUND_CUSTOMER_COUNT:DESC" : "";
  const sortField = queryState.view !== "OVERVIEW" && <FilterField label="排序"><Select aria-label="排序" value={sortValue} options={[...(queryState.view === "AGENTS" ? [] : [{ value: "", label: "默认顺序" }]), ...(perfSortShown ? [{ value: "PERFORMANCE_AMOUNT:DESC", label: "累计业绩额 · 从高到低" }] : []), ...sortChoices]}
    onChange={value => { if (value === "PERFORMANCE_AMOUNT:DESC") { change({ sortKey: "PERFORMANCE_AMOUNT", direction: "DESC" }); return; } if (!value) { change({ sortKey: undefined, direction: undefined }); return; } const [key, direction] = value.split(":"); const found = SORT_OPTIONS[queryState.view].find(x => x.value === key); if (found) change({ sortKey: found.value, direction: direction === "ASC" ? "ASC" : "DESC" }); }} /></FilterField>;
  const caption = queryState.basis === "PERIOD_EVENT" ? `统计 ${queryState.month} 当月发生的业务（${businessZone().label}）；绑定和设备按当前状态` : queryState.basis === "CURRENT_ASSET" ? "按当前设备和活跃状态统计；不含首充和累计资金" : "按客户注册以来的累计数据统计，不是本月新增";
  const navigation = <PageTabs ids={tabIds} label="客服工作台" value={currentTab} items={tabs.map(tab => ({ value: tab, label: TAB_LABEL[tab], count: tab === "pool" ? scope.scopeSummary.pending ?? "—" : undefined }))} onChange={tab => {
    if (document.activeElement?.closest('[role="tablist"][aria-label="客服工作台"]')) pendingTabFocus.current = tab;
    openTab(tab);
  }} />;
  const unresolvedMaintenance = maintenanceCommands.list().some(r => r.actorId === adminId);
  // Where the personal workbench is on screen it lists each pending maintenance record with its own query button;
  // the page bar then only carries the other kinds, so one pending result is not announced twice.
  const maintenanceInBar = unresolvedMaintenance && !(isPersonal ? section !== "stats" : section === "mine");
  const unresolvedPool = poolCommands.list().some(r => r.actorId === adminId) || routeCommands.list().some(r => r.actorId === adminId) || randomAssignmentCommands.list().some(r => r.actorId === adminId);
  const unresolvedGroups = groupPendingCommands.list().some(r => r.actorId === adminId && (!isInvitePending(r) || r.intent.kind === "INVITE_REVOKE"));
  const unresolvedInvite = groupPendingCommands.list().some(r => r.actorId === adminId && isInvitePending(r) && r.intent.kind === "INVITE_ISSUE");
  const unresolvedAvatar = selfAvatarCommands.list().some(r => r.actorId === adminId) || avatarDrafts.list().some(r => r.actorId === adminId && r.scope === "self" && (!r.asset || r.cancelKey));
  const unresolvedPayments = pendingPaymentReleases(adminId ?? 0).filter(r => r.portKey.startsWith("support:"));
  const unresolvedBulk = hasBulkPending(adminId ?? 0);
  const profileStats = profileId && data && (data.view === "CUSTOMERS" || data.view === "ACTIVITY") ? data.records.find(row => row.customerId === profileId) : undefined;
  const profileCounts = supportCountsView(profileStats?.invitations);
  return <section className="sa-workbench" {...tabIds.panel(currentTab)}>
    {header}
    {!isPersonal && <M1LiveService ctx={ctx} />}
    {(maintenanceInBar || unresolvedPool || unresolvedGroups || unresolvedInvite || unresolvedAvatar || unresolvedBulk || unresolvedPayments.length > 0) && <Notice tone="warn" title="有操作结果未知，先查询原结果" actionBelow action={<>
      {maintenanceInBar && <Button size="sm" onClick={() => openTab(isPersonal ? "my-customers" : "mine")}>核对维护原操作</Button>}
      {unresolvedPool && <Button size="sm" onClick={() => openTab("pool")}>核对分配原操作</Button>}
      {unresolvedGroups && <Button size="sm" onClick={() => openTab("team")}>核对分组原操作</Button>}
      {unresolvedInvite && <Button size="sm" onClick={() => openTab(isPersonal ? "home" : "mine")}>核对邀请码原操作</Button>}
      {unresolvedAvatar && <SelfAvatarEditor name={operatorName} ctx={ctx} onChanged={() => setRecoveryRevision(n => n + 1)} />}
      {unresolvedBulk && <Button size="sm" onClick={() => setBulkRecovery(true)}>核对群发原操作</Button>}
      {unresolvedPayments.map(row => <Button size="sm" key={row.commandKey} onClick={() => setProfileId(row.userId)}>{unresolvedPayments.length > 1 ? `核对支付安全原操作 · 用户 ${row.userId}` : "核对支付安全原操作"}</Button>)}
    </>}>原内容和理由已保留；超过 24 小时只能查询，不能再重试。</Notice>}

    {!(isPersonal && currentTab === "home") && navigation}
<TransferPendingNotes key={transferRevision} onOpen={setTransferCustomer} />
{transferNotice && <Notice tone="ok" action={<Button size="sm" type="button" onClick={() => setTransferNotice("")}>知道了</Button>}>{transferNotice}</Notice>}
{isPersonal && <div hidden={section === "stats" || section === "exports"}><M1PersonalWorkbench permission="agent" ctx={ctx} view={personalView} active={section !== "stats" && section !== "exports"} onViewChange={next => { setSection("personal"); setPersonalView(next); }}
  onBrowseCustomers={filter => { if (queryState.view === "CUSTOMERS" && queryState.basis === "CURRENT_CUSTOMER_HISTORY" && queryState.filter === filter) { setSection("stats"); return; } drill({ view: "CUSTOMERS", category: "BOUND", basis: "CURRENT_CUSTOMER_HISTORY", filter, firstState: "ALL", keyword: undefined }); }}
  navigation={currentTab === "home" ? navigation : undefined} primarySummary={<section className="sa-personal-summary" aria-label="本人客户与期间业绩">
    <div className="sa-personal-head"><h3>期间业绩</h3><Explain label="期间业绩的说明" content={<>{queryState.month} · {nexGridBrandText(currency)} · {businessZoneText()}；绑定与活跃按当前客户统计，首充和净贡献按所选自然月统计。</>} /><div className="sa-personal-period-controls"><AnalyticsSelect label="业绩自然月" value={queryState.month} options={monthOptions} onChange={month => change({ month })} /><AnalyticsSelect label="业绩币种" value={currency} options={[{ value: "USDT", label: "USDT" }, { value: "UVT", label: "UVT" }]} onChange={value => { if (value === "USDT" || value === "UVT") change({ currency: value }); }} /></div></div>
    <p className="sa-personal-asof"><AnalyticsFreshness asOf={scope.asOf} label="客户统计" onRefresh={() => refreshScope()} />{personalPeriod && <AnalyticsFreshness asOf={personalPeriod.asOf} label="期间业绩" onRefresh={() => refreshScope()} />}</p>
    {/* 月份目录读不到时写错误卡：哪块读不到、原因、重试（ST-34、ST-35，BUG-650）。 */}
    {!monthCalendar && (calendarError ? <BlockState state="error" compact title="业绩月份加载失败" detail={calendarError} onRetry={() => setCalendarRetry(n => n + 1)} retryLabel="重试" />
      : <p className="sa-state" role="status">正在加载业绩月份…</p>)}
    {personalPeriodError && <p className="sa-state" role="alert">{personalPeriodError}<Button type="button" onClick={() => refreshScope()}>重新加载业绩</Button></p>}
    <div className="sa-personal-primary-metrics" data-secondary="">
      <div><span>当前本人绑定</span><Numeric value={scope.scopeSummary.bound === null ? null : String(scope.scopeSummary.bound)} label="当前本人绑定客户" onClick={() => drill({ view: "CUSTOMERS", category: "BOUND", basis: "CURRENT_CUSTOMER_HISTORY", filter: "ALL", firstState: "ALL" })} /></div>
      <div><span>{scopeCurrent.activity.window.days ? `近 ${scopeCurrent.activity.window.days} 天活跃` : "当前统计期活跃"}</span><CountValue count={scopeCurrent.activity.active} coverage={[scopeCurrent.activity.status, scopeCurrent.activity.window.status]} label="当前统计期活跃客户" onClick={() => drill({ view: "ACTIVITY", category: "BOUND", basis: "CURRENT_ASSET", filter: "WINDOW_ACTIVE" })} /></div>
      <div><span>期间首充（含付费购机）</span><CountValue count={personalFinancial?.firstCandidates ?? { observed: null, confirmed: null, status: "UNKNOWN" }} label="期间首充客户" onClick={() => drill({ view: "CUSTOMERS", basis: "PERIOD_EVENT", firstState: "CONFIRMED", filter: "ALL" })} /></div>
    </div>
    <div className="sa-personal-first-sources" aria-label="期间首充金额来源">{(["deposits", "purchases"] as const).map(source => <div key={source}><span>{source === "deposits" ? "充值首充" : "付费购机首充"} / {nexGridBrandText(currency)}</span><MoneyValue money={personalFinancial?.firstSources.find(row => row.currency === currency)?.[source]} label={source === "deposits" ? `充值首充金额 ${nexGridBrandText(currency)}` : `付费购机首充金额 ${nexGridBrandText(currency)}`} onClick={() => setPeriodDetail(source === "deposits" ? "FIRST_DEPOSITS" : "FIRST_PURCHASES")} /></div>)}</div>
  </section>} /></div>}
    {!isPersonal && section === "pool" && <M1SupervisorPool permission={leadPermission} toast={ctx.toast} />}
    {!isPersonal && section === "team" && <M1GroupManagement mode={mode} initialGroupId={queryState.groupId === undefined ? undefined : String(queryState.groupId)} actions={<SupportSeatRolesButton permission={leadPermission} ctx={ctx} />} onChanged={() => { teamChanged.current = true; controllerRef.current?.abort(); generation.current++; setData(null); setProfileId(null); }} onViewCustomers={(groupId, category) => {
      managementCustomerGroup.current = groupId;
      managementReturnQuery.current = changeAnalyticsQuery(queryState, { groupId, view: "CUSTOMERS", basis: "CURRENT_CUSTOMER_HISTORY", category, agentId: undefined, keyword: undefined, firstState: "ALL", filter: "ALL" });
      setKeyword(""); setSection("stats"); setScope(null); setScopeRetry(n => n + 1);
    }} />}
    {!isPersonal && section === "mine" && <M1PersonalWorkbench permission="supervisor" ctx={ctx} view={personalView} onViewChange={setPersonalView} onTransfer={setTransferCustomer} transferRevision={transferRevision} />}
    {section === "exports" && !!exportsPorts?.persona.views.length && <PerfExportRecords ports={exportsPorts} />}
    {exportOpen && exportsPorts && <PerfExportDialog ports={exportsPorts} initialMonth={queryState.month} initialScope={queryState.groupId ? `GROUP:${queryState.groupId}` : mode === "PERSONAL" ? "SELF" : mode === "MANAGED" ? "MANAGED_GROUPS" : "ALL"} onClose={() => setExportOpen(false)} onRecords={() => { setExportOpen(false); openTab("exports"); }} />}
    {isPersonal && showStatistics && <PeriodPerfPanel perf={perf.period} month={queryState.month} asOf={personalPeriod ? `${formatBusinessTimeCompact(personalPeriod.asOf, "—")}（${businessZone().label}）` : undefined}
      status={personalPeriodError ? { error: personalPeriodError, onRetry: () => setPersonalPeriodRetry(value => value + 1) } : !personalPeriod && monthCalendar?.some(entry => entry.month === queryState.month) ? "loading" : undefined}
      detail={{ loading: eventsOpen && !events, error: eventError || undefined }}
      monthControl={<span className="m1-group-scope"><span aria-hidden="true">月份</span><Select aria-label="业绩月份" value={queryState.month} onChange={month => change({ month })} options={(monthCalendar ?? []).map(({ month }) => ({ value: month, label: month }))} placeholder="加载后可选" /></span>}
      onDetail={personalPeriod?.performance?.period ? openEvents : undefined} />}
    {eventsOpen && events && <PerfEventsDrawer events={eventsPerf(events)} page={events.pageNum} pageSize={events.pageSize}
      total={events.total} observedTotal={events.observedTotal} canContinue={events.canContinue && events.version !== null}
      loading={events.pageNum !== eventPage.number}
      onPage={number => { if (events.version) setEventPage({ number, version: events.version }); }}
      onClose={closeEvents} />}
    {showStatistics && <Panel className="sa-stats" icon={currentTab === "customers" ? Users : BarChart3} tone="role-1" title={isPersonal ? "本人客户画像" : currentTab === "customers" ? mode === "ALL" ? "全部客户" : "负责组客户" : mode === "ALL" ? "平台运营总览" : "我的分组数据"}
      sub={<>{selectedGroup?.name || (queryState.groupId ? "组名未同步" : isPersonal ? "本人当前客户" : mode === "ALL" ? "全部获准客服范围" : `全部负责组 · ${groups.length} 个`)}{queryState.basis === "CURRENT_ASSET" ? "" : ` · ${nexGridBrandText(currency)}`}{data ? <> · <AnalyticsFreshness asOf={data.asOf} label="" explain={false} onRefresh={() => refreshScope()} />{data.versionState === "READY" ? "" : " · 数据仍在同步"}</> : <> · {businessZone().label}</>}</>}
      explain={isPersonal ? <><p>你现在名下的客户。累计业绩额是这位客户自 2026-11-20 22:57 起的入金减提现。</p><p>{caption}。统计约每分钟更新一次，刷新读最近算好的一版。</p></>
        : mode === "MANAGED" ? currentTab === "customers" ? <><p>只算你负责的组：{groups.map(g => g.name || "组名未同步").join("、") || "—"}。别的组、未分配和归属未知的业绩不在这里。</p><p>统计约每分钟更新一次，刷新读最近算好的一版。</p></>
          : <><p>只算你负责的组：{groups.map(g => g.name || "组名未同步").join("、") || "—"}。</p><p>别的组不在这里。</p><p>未分配和归属未知的业绩只有超级管理员能看。</p></>
        : <><p>期间业绩按所选月份里发生的业务和当时的归属算；当前客户累计按现在的客户算，自 2026-11-20 22:57 起。</p><p>{caption}。统计约每分钟更新一次，刷新读最近算好的一版。</p></>} explainLabel={`${isPersonal ? "本人客户画像" : currentTab === "customers" ? mode === "ALL" ? "全部客户" : "负责组客户" : mode === "ALL" ? "平台运营总览" : "我的分组数据"}的说明`}>
      {restoreNotice && <Notice tone="warn" action={<Button size="sm" type="button" onClick={() => setRestoreNotice("")}>知道了</Button>}>{restoreNotice}</Notice>}
      {(isPersonal || queryState.view !== "CUSTOMERS") && <PageTabs level={2} label="数据视角" value={queryState.view} items={DATASETS.filter(x => isPersonal ? !["OVERVIEW", "AGENTS"].includes(x.value) : x.value !== "CUSTOMERS")} onChange={value => change({ view: value, ...(value === "DEVICES" ? { basis: "CURRENT_ASSET" as const } : {}) })} />}
      {/* 总览只有三个范围控件：包一层让三格等宽铺开（样式见 m1-analytics-workbench.css）。 */}
      <div className={queryState.view === "OVERVIEW" ? "m1-overview-filter" : undefined}>
      <FilterBar onSubmit={() => change({ keyword: keyword.trim() || undefined })} querying={loading} action={queryState.view === "OVERVIEW" ? <></> : <Button type="submit">查询</Button>} onClear={() => { setKeyword(""); change({ groupId: undefined, agentId: undefined, basis: defaultBasis, keyword: undefined, firstState: "ALL", filter: "ALL", category: "ALL", sortKey: undefined, direction: undefined }); }} canClear={activeConditions.length > 0 || queryState.basis !== defaultBasis}
        sort={!isPersonal ? sortField : undefined}
        moreCount={activeConditions.filter(condition => ["basis", "firstState", "direction"].includes(condition.key)).length}
        applied={activeConditions.map(condition => ({ key: condition.key, label: condition.label, onRemove: () => { if (condition.key === "keyword") setKeyword(""); change(condition.remove); } }))}
        more={queryState.view === "OVERVIEW" ? undefined : <>
        {basisField}
        {queryState.basis === "PERIOD_EVENT" && monthField}
        <AnalyticsSelect label="币种" value={currency} options={[{ value: "USDT", label: "USDT" }, { value: "UVT", label: "UVT" }]} onChange={value => { if (value === "USDT" || value === "UVT") change({ currency: value }); }} />
        {isPersonal && sortField}
        {["CUSTOMERS", "ACTIVITY"].includes(queryState.view) && <><AnalyticsSelect label="首充状态" value={queryState.firstState ?? "ALL"} options={queryState.basis === "CURRENT_ASSET" ? [FIRST_OPTIONS[0]] : FIRST_OPTIONS} onChange={value => { const found = FIRST_OPTIONS.find(x => x.value === value); if (found) change({ firstState: found.value }); }} /></>}
</>}>
        {/* 负责组是范围控件：放在筛选条同一行最左（ST-15、ST-16）。 */}
        {!isPersonal && <FilterField label="负责组"><Select aria-label="负责组范围" value={String(queryState.groupId ?? "")} onChange={value => change({ groupId: value || undefined })} options={[{ value: "", label: mode === "ALL" ? "全部获准范围" : "全部负责组" }, ...groups.map(g => ({ value: g.groupId, label: g.name || "组名未同步" }))]} /></FilterField>}
        {queryState.view === "OVERVIEW" && <>{basisField}{queryState.basis === "PERIOD_EVENT" && monthField}</>}
        {queryState.view !== "OVERVIEW" && <FilterField label={isPersonal || queryState.view !== "AGENTS" ? "客户" : "客服"} grow><Input value={keyword} maxLength={200} onChange={event => setKeyword(event.target.value)} placeholder={isPersonal || queryState.view !== "AGENTS" ? "客户名称或用户编码" : "客服名称"} aria-label={isPersonal || queryState.view !== "AGENTS" ? "查询客户名称或用户编码" : "查询客服名称"} /></FilterField>}
        {["CUSTOMERS", "ACTIVITY"].includes(queryState.view) && <AnalyticsSelect label="服务状态" value={queryState.filter ?? "ALL"} options={isPersonal ? PERSONAL_FILTER_OPTIONS : FILTER_OPTIONS} onChange={value => change({ filter: value as AnalyticsQueryState["filter"] })} />}
      </FilterBar>
      </div>
      {queryState.basis === "PERIOD_EVENT" && !monthCalendar && (calendarError ? <BlockState state="error" compact title="统计月份加载失败" detail={calendarError} onRetry={() => setCalendarRetry(n => n + 1)} retryLabel="重试" />
        : <div className="sa-state" role="status">正在加载统计月份…</div>)}
      {queryState.basis === "PERIOD_EVENT" && monthCalendar?.length === 0 && <BlockState state="empty" title={calendarGeneration === "UPGRADING" ? "数据正在升级" : PERF_UNAVAILABLE_VALUE.reason} onRetry={() => setCalendarRetry(n => n + 1)} />}
      {loading && <div className="sa-state" role="status">正在加载…<Button type="button" size="sm" onClick={() => { controllerRef.current?.abort(); generation.current++; setLoading(false); setCancelled(true); setData(null); }}>取消读取</Button></div>}
      {error ? <BlockState state="error" title={error} onRetry={reloadFirstPage} retryLabel={error.includes("第一页") ? "从第一页重新加载" : "重试"} /> : cancelled && <div className="sa-state" role="status">已取消加载，筛选条件不变。<Button type="button" size="sm" onClick={reloadFirstPage}>重试</Button></div>}
      {data && current && personnel && <>
        {(queryState.view === "OVERVIEW" || queryState.view === "FINANCE") && <Fold title="经营概况" summary={overviewSummary ?? `已绑定 ${data.scopeSummary.bound == null ? "—" : `${data.scopeSummary.bound} 位`} · 已首充 ${countValue(current.firstConfirmed) == null ? "—" : `${countValue(current.firstConfirmed)} 位`} · 持有设备 ${countValue(current.devices.held) == null ? "—" : `${countValue(current.devices.held)} 台`}`} explain={queryState.view === "OVERVIEW" && queryState.basis === "PERIOD_EVENT" && perf.attribution ? "业绩按所选月份发生时的归属算。当时还没分组的客服的业绩算给客服本人、不进组，所以组卡和下面两类加起来比总额少；在业绩榜里能看到。" : caption}>
          {queryState.view === "OVERVIEW" && queryState.basis !== "CURRENT_ASSET" && <StatBand label="经营概况">
            {queryState.basis === "PERIOD_EVENT" ? <>
              <Stat label="期间业绩额" value={perfText(perf.scope.period.amount)} unit={perf.scope.period.amount.state === "complete" ? "USDT" : undefined} sub={perfNote(perf.scope.period.amount)} />
              <Stat label="客户入金" tone="role-2" value={perfText(perf.scope.period.inflow)} unit={perf.scope.period.inflow.state === "complete" ? "USDT" : undefined} />
              <Stat label="客户提现" tone="role-4" value={perfText(perf.scope.period.withdrawal)} unit={perf.scope.period.withdrawal.state === "complete" ? "USDT" : undefined} />
            </> : <Stat label="当前客户累计业绩额" value={perfText(perf.scope.current)} unit={perf.scope.current.state === "complete" ? "USDT" : undefined} sub={perfNote(perf.scope.current)} />}
          </StatBand>}
          <div className={`sa-metrics ${queryState.view === "OVERVIEW" ? "sa-metrics-overview" : ""}`} aria-label="所选范围汇总">
          {!isPersonal && <div><span>专属客服</span><CountValue count={personnel.serviceAccounts} label="专属客服" onClick={() => change({ view: "AGENTS" })} /></div>}
          {mode === "ALL" && <><div><span>主管</span><CountValue count={personnel.supervisors} label="主管账号；客服列表保留兼任标识" onClick={() => change({ view: "AGENTS" })} /></div><div><span>负责组</span><CountValue count={personnel.groups} label="负责组" onClick={() => change({ view: "OVERVIEW" })} /></div></>}
          <div><span>已绑定客户</span><Numeric value={data.scopeSummary.bound === null ? null : String(data.scopeSummary.bound)} label="当前绑定客户" onClick={() => change({ view: "CUSTOMERS", category: "BOUND", firstState: "ALL", filter: "ALL" })} /></div>
          <div><span>已首充客户 · 当前</span><CountValue count={current.firstConfirmed} label="当前客户已首充" onClick={() => change({ view: "CUSTOMERS", basis: "CURRENT_CUSTOMER_HISTORY", firstState: "CONFIRMED" })} /></div>
          <div><span>持有设备 · 当前</span><CountValue count={current.devices.held} label="当前持有设备" onClick={() => change({ view: "DEVICES", basis: "CURRENT_ASSET" })} /></div>
          <div><span>当前统计期活跃 · 当前</span><CountValue count={current.activity.active} coverage={[current.activity.status, current.activity.window.status]} label="当前统计期活跃" onClick={() => change({ view: "ACTIVITY", filter: "WINDOW_ACTIVE" })} /></div>
          <div><span>{queryState.basis === "PERIOD_EVENT" ? "期间充值" : "客户累计充值"} / {nexGridBrandText(currency)}</span><MoneyValue money={deposits} label={`充值 ${nexGridBrandText(currency)}`} onClick={() => change({ view: "FINANCE", basis: queryState.basis === "CURRENT_ASSET" ? "CURRENT_CUSTOMER_HISTORY" : queryState.basis })} /></div>
          {queryState.basis === "PERIOD_EVENT" && <><div><span>期间首次付费</span><CountValue count={data.scopeSummary.financial.firstCandidates} label="期间首次付费；查看同范围资金事件" onClick={() => change({ view: "FINANCE" })} /></div><div><span>期间购机 / {nexGridBrandText(currency)}</span><MoneyValue money={data.scopeSummary.financial.currencies.find(x => x.currency === currency)?.purchases} label={`期间购机 ${nexGridBrandText(currency)}；查看同范围资金事件`} onClick={() => change({ view: "FINANCE" })} /></div></>}
        </div>
        {queryState.view === "FINANCE" && <section className="sa-current-funds" aria-label="当前客户资金观测"><p>当前客户资金<Explain label="当前客户资金的说明" content="当前筛选客户的余额和提现，不受月份筛选；系统没有记下提现当时客户归谁。" /></p><div className="sa-inline-metrics">{(["balance", "successPrincipal", "successNet", "processingPrincipal"] as const).map(metric => {
          const amount = fundAmount(data.funds, metric, currency);
          return <div key={metric}><span>{fundLabels[metric]} / {nexGridBrandText(currency)}</span><Numeric kind="amount" value={amount.confirmed} observed={amount.observed} label={fundLabels[metric] + " " + nexGridBrandText(currency)} onClick={() => setFundMetric(metric)} /></div>;
        })}</div></section>}
        {queryState.view === "OVERVIEW" && <div className="sa-coverage"><div><span>待分配</span><Numeric value={data.scopeSummary.pending === null ? null : String(data.scopeSummary.pending)} label="待分配客户，打开待分配客户池" onClick={() => openTab("pool")} /></div><div><span>归属异常</span><Numeric value={data.scopeSummary.anomaly === null ? null : String(data.scopeSummary.anomaly)} label="归属异常" onClick={() => change({ view: "CUSTOMERS", category: "ANOMALY", firstState: "ALL", filter: "ALL" })} /></div></div>}</Fold>}
        {queryState.view === "OVERVIEW" ? <>
          {queryState.groupId === undefined && <section className="sa-group-comparison" aria-label="负责组概览">
            <div className="sa-group-head"><h3>负责组</h3><Explain label="负责组的说明" content={queryState.basis === "PERIOD_EVENT" ? "期间业绩额按发生时所在的组算。当前客户累计业绩额按组里现在的客户算，自 2026-11-20 22:57 起。" : queryState.basis === "CURRENT_ASSET" ? "按组里现在的客户持有的设备算；点数字看设备列表。" : "按组里现在的客户算累计业绩额，自 2026-11-20 22:57 起；点数字看客户表。"} /><span className="rd-note">{data.scopeSummary.groups.length > 4 ? `展示 4 / ${data.scopeSummary.groups.length} 组` : `${data.scopeSummary.groups.length} 组`}</span></div>
            <ul>{data.scopeSummary.groups.slice(0, 4).map(group => {
              const gp = perf.groups[group.groupId], period = gp?.period ?? PERF_UNAVAILABLE_VALUE, cumulative = gp?.current ?? PERF_UNAVAILABLE_VALUE;
              const keyValue = queryState.basis === "CURRENT_ASSET" ? null : queryState.basis === "PERIOD_EVENT" ? period : cumulative;
              return <li key={group.groupId}>
              <button type="button" className="sa-group-name" title={group.name ?? "组名未同步"} onClick={() => change({ groupId: group.groupId, view: "AGENTS" })}>{group.name || "组名未同步"}</button>
              <div className="sa-group-key"><span>{queryState.basis === "PERIOD_EVENT" ? `期间业绩额 · ${queryState.month}` : queryState.basis === "CURRENT_ASSET" ? "持有设备 · 当前" : `当前客户累计业绩额 · ${PERF_SINCE}`}</span>
                <strong>{keyValue ? <><button type="button" className="rd-link sa-number sa-link" title={perfNote(keyValue)} onClick={() => change({ groupId: group.groupId, view: queryState.basis === "PERIOD_EVENT" ? "OVERVIEW" : "CUSTOMERS" })}>{perfText(keyValue)}</button>{keyValue.state === "complete" && <small>USDT</small>}</>
                  : <><CountValue count={group.current.devices.held} label="组持有设备" onClick={() => change({ groupId: group.groupId, view: "DEVICES", basis: "CURRENT_ASSET" })} />{countValue(group.current.devices.held) !== null && <small>台</small>}</>}</strong></div>
              <dl className="rd-stat-rows">
                {queryState.basis === "PERIOD_EVENT" && <div className="rd-stat-row"><dt>当前客户累计业绩额</dt><dd><button type="button" className="rd-link sa-number sa-link" title={perfNote(cumulative)} onClick={() => change({ groupId: group.groupId, view: "CUSTOMERS", basis: "CURRENT_CUSTOMER_HISTORY" })}>{perfText(cumulative)}</button>{cumulative.state === "complete" && " USDT"}</dd></div>}
                <div className="rd-stat-row"><dt>当前客户</dt><dd><Numeric value={group.total === null ? null : String(group.total)} label="组当前客户" onClick={() => change({ groupId: group.groupId, view: "CUSTOMERS" })} />{group.total !== null && " 位"}</dd></div>
                <div className="rd-stat-row"><dt>专属客服</dt><dd><CountValue count={group.personnel.serviceAccounts} label="组专属客服" onClick={() => change({ groupId: group.groupId, view: "AGENTS" })} />{countValue(group.personnel.serviceAccounts) !== null && " 位"}</dd></div>
              </dl>
            </li>; })}</ul>
          </section>}
          {perf.attribution && queryState.basis === "PERIOD_EVENT" && queryState.groupId === undefined && <section className="sa-group-comparison m1-attribution" aria-label="不在负责组里的业绩">
            <div className="sa-group-head"><h3>不在负责组里的业绩</h3><Explain label="不在负责组里的业绩的说明" content="只有超级管理员看得到。这两类不算给任何客服，没有明细。" /><span className="rd-note">2 类 · {queryState.month}</span></div>
            <ul>{([["未分配", perf.attribution.unassigned, "当时没有绑定客服的客户的业绩。"], ["归属未知", perf.attribution.unknown, "金额已核；查不清当时归哪位客服，不算给任何客服，不用处理。"]] as const).map(([label, value, explain]) => <li key={label}>
              <span className="m1-bucket-name">{label}<Explain label={`${label}的说明`} content={explain} /></span>
              <div className="sa-group-key"><span>业绩额 · {queryState.month}</span><strong>{perfText(value)}{value.state === "complete" && <small>USDT</small>}</strong></div>
            </li>)}</ul>
          </section>}
          {!data.scopeSummary.groups.length && mode === "MANAGED" && <BlockState state="empty" title="当前没有负责组。" />}
        </> : <>{queryState.view === "CUSTOMERS" && <div className="sa-legend"><span>金额单位 {nexGridBrandText(currency)}</span><span><span className="sa-dot on" aria-hidden="true" />本统计期活跃</span><span><span className="sa-dot off" aria-hidden="true" />本统计期未活跃</span><span><span className="sa-cell-unknown">-</span> 数据还在同步</span><span>点客户名查看资料与记录</span></div>}
          {sessionError && <Notice tone="danger" action={<><Button size="sm" type="button" onClick={() => { const row = sessionError; setSessionError(null); openSessions(row); }}>查看会话记录</Button><Button size="sm" type="button" onClick={() => setSessionError(null)}>知道了</Button></>}>{customerName(sessionError)}：暂时无法核对接待状态，请稍后重试。</Notice>}
          <AnalyticsTable data={data} currency={currency} drill={change} openProfile={setProfileId} session={!isPersonal && queryState.view === "CUSTOMERS" ? sessionStart : undefined} perf={perf} month={queryState.month} groupId={queryState.groupId} /><footer className="sa-pager"><p>{data.total === null ? `第 ${queryState.pageNum} 页 · 共 — 条（已数到 ${data.observedTotal ?? "—"} 条）` : `第 ${queryState.pageNum} / ${Math.max(1, Math.ceil(data.total / data.pageSize))} 页 · 共 ${data.total} 条`}</p><div><Button type="button" disabled={queryState.pageNum <= 1 || data.versionState !== "READY"} onClick={() => page(queryState.pageNum - 1)}>上一页</Button><Button type="button" disabled={!data.canContinue || data.versionState !== "READY"} onClick={() => page(queryState.pageNum + 1)}>下一页</Button></div></footer>{data.versionState === "UNKNOWN" && <p className="sa-disclosure">这份数据还在变，暂时不能翻页；请刷新后重试。</p>}</>}
      </>}
    </Panel>}
    {(showStatistics || periodDetail) && fundSource && <M1StatisticDetails key={`${periodDetail ?? fundMetric}:${fundSource.kind === "fund" ? fundSource.origin.asOf : ""}`} source={fundSource} onClose={() => { setFundMetric(null); setPeriodDetail(null); }} onInvalid={invalidateFund} />}
    {sessionBusy && <SessionBusyDialog customer={customerName(sessionBusy.row)} hold={sessionBusy.hold} onClose={() => setSessionBusy(null)} onRead={() => { const row = sessionBusy.row; setSessionBusy(null); openSessions(row); }} />}
    {transferCustomer && <CustomerTransferDialog key={transferCustomer} customerId={transferCustomer} mode={mode === "ALL" ? "ALL" : "MANAGED"} onClose={() => closeTransfer()} onDone={notice => { closeTransfer(); setTransferNotice(notice); setTransferRevision(n => n + 1); setRetry(n => n + 1); }} onOpenOwn={canMine ? () => { closeTransfer(true); openTab("mine"); } : undefined} />}
    {bulkRecovery && <SupportBulkComposer ctx={ctx} onClose={() => setBulkRecovery(false)} />}
    {related}
    {profileId && <Drawer open wide title="客户资料" sub={profileStats ? `${customerName(profileStats)} · ${profileStats.customerNo ?? m1CustomerCode(profileStats.customerId)}` : undefined} onClose={() => setProfileId(null)} footer={<div className="m1-drawer-actions"><Button type="button" onClick={() => setProfileId(null)}>{isPersonal ? "关闭" : "返回统计列表"}</Button></div>}><p className="sa-disclosure">按你的客户资料查看权限显示；能看到统计不代表能操作资金或回复客户。</p>{profileStats && ["CUSTOMERS", "ACTIVITY"].includes(data?.view || "") && <Fold title="统计依据" summary={`${m1CustomerCode(profileStats.customerId)} · ${currency}`}><Facts>
      <Fact k="直接邀请"><CustomerValue kind="count" value={profileCounts.kind === "ready" ? String(profileCounts.direct) : null} status={profileStats.invitations.direct.status} label="直接邀请" onClick={() => setProfileId(profileStats.customerId)} /></Fact>
      <Fact k="全部团队成员"><CustomerValue kind="count" value={profileCounts.kind === "ready" ? String(profileCounts.total) : null} status={profileStats.invitations.descendants.status} label="全部团队成员" onClick={() => setProfileId(profileStats.customerId)} /></Fact>
      <Fact k={`本人累充 / ${currency}`}><MoneyValue money={profileStats.lifetime.find(x => x.currency === currency)?.deposits} label="本人累充" onClick={() => setProfileId(profileStats.customerId)} /></Fact>
      <Fact k={`邀请累充 / ${currency}`}><MoneyValue money={profileStats.invitations.deposits.find(x => x.currency === currency)?.deposits} label="邀请累充" onClick={() => setProfileId(profileStats.customerId)} /></Fact>
    </Facts></Fold>}<M3CustomerProfile key={profileId} ctx={ctx} customerId={profileId} source="M1" onHistory={no => router.push(`/service/sessions?conversationNo=${encodeURIComponent(no)}`)} onRetryMessages={() => void ctx.refreshConversations()} /></Drawer>}
  </section>;
}
