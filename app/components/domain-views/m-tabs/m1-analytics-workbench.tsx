"use client";
import { operatorNicknameText } from "@/lib/admin/brand-copy";

import { nexGridBrandText } from "@/lib/admin/brand-copy";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import { DomainModuleLoading } from "../domain-module-state";
import { useRouter } from "next/navigation";
import { supportAnalyticsClient, type SupportAnalyticsMonth, type SupportAnalyticsQuery, type SupportAnalyticsResponse, type SupportAnalyticsView, type SupportAnalyticsCustomer } from "@/lib/admin/support-analytics-client";
import { SupportClientError } from "@/lib/admin/m-support-client";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { businessZone, businessZoneText } from "@/lib/admin/business-time";
import { Modal } from "../design-kit";
import { HDSelect, type HDOption } from "./hd-ui";
import { M1PersonalWorkbench, SupportSeatRolesButton, type PersonalWorkbenchView } from "./m1-personal-workbench";
import { M1LiveService } from "./m1-live-service";
import { SupportAvatar } from "./support-avatar";
import { compactSupportBoardValue } from "./support-leaderboard";
import { AnalyticsFreshness } from "./analytics-freshness";
import type { MCtx } from "./types";
import "./m1-analytics-workbench.css";
import "./m1-personal-priority.css";

const M1SupervisorPool = dynamic(() => import("./m1-supervisor-pool").then(m => m.M1SupervisorPool), { loading: DomainModuleLoading });
const M1GroupManagement = dynamic(() => import("./m1-group-management").then(m => m.M1GroupManagement), { loading: DomainModuleLoading });
const M3CustomerProfile = dynamic(() => import("./m3-customer-profile").then(m => m.M3CustomerProfile), { loading: DomainModuleLoading });

type Permission = "agent" | "supervisor" | "superadmin";
/** M-41: one tab row per role. Agents: home / my-customers / my-data; supervisors and the super admin: data / customers / pool / team (+ mine for a supervisor with a seat). */
type M1Tab = "home" | "my-customers" | "my-data" | "data" | "customers" | "pool" | "team" | "mine";
type Section = "personal" | "stats" | "pool" | "team" | "mine";
const TAB_LABEL: Record<M1Tab, string> = { home: "工作台", "my-customers": "我的客户", "my-data": "我的数据", data: "数据", customers: "客户", pool: "待分配", team: "客服与分组", mine: "我的客户" };
function roleTabs(personal: boolean, canMine: boolean): M1Tab[] {
  return personal ? ["home", "my-customers", "my-data"] : ["data", "pool", "customers", "team", ...(canMine ? ["mine" as const] : [])];
}
function entryTab(personal: boolean, canMine: boolean): M1Tab {
  const tabs = roleTabs(personal, canMine), wanted = new URLSearchParams(window.location.search).get("view");
  return tabs.find(tab => tab === wanted) ?? tabs[0];
}
type Count = SupportAnalyticsResponse["selectedCurrent"]["firstConfirmed"];
type Money = SupportAnalyticsCustomer["lifetime"][number]["deposits"];
type Basis = NonNullable<SupportAnalyticsQuery["basis"]>;
type Currency = NonNullable<SupportAnalyticsQuery["currency"]>;
export type AnalyticsQueryState = Omit<SupportAnalyticsQuery, "signal" | "pageNum" | "pageSize" | "expectedVersion"> & { month: string; pageNum: number; expectedVersion?: string };
const DATASETS: Array<{ value: SupportAnalyticsView; label: string }> = [{ value: "OVERVIEW", label: "总览" }, { value: "AGENTS", label: "客服" }, { value: "CUSTOMERS", label: "客户" }, { value: "FINANCE", label: "资金" }, { value: "DEVICES", label: "设备" }, { value: "ACTIVITY", label: "活跃" }];
const BASIS_OPTIONS: Array<{ value: Basis; label: string }> = [{ value: "CURRENT_CUSTOMER_HISTORY", label: "当前客户" }, { value: "PERIOD_EVENT", label: "期间业绩" }, { value: "CURRENT_ASSET", label: "当前设备" }];
const FIRST_OPTIONS: Array<{ value: NonNullable<SupportAnalyticsQuery["firstState"]>; label: string }> = [{ value: "ALL", label: "全部首充状态" }, { value: "CONFIRMED", label: "已首充" }, { value: "NONE", label: "未首充" }, { value: "UNKNOWN", label: "历史未同步" }];
const FILTER_OPTIONS: Array<{ value: NonNullable<SupportAnalyticsQuery["filter"]>; label: string }> = [{ value: "ALL", label: "全部服务状态" }, { value: "WINDOW_ACTIVE", label: "当前统计期活跃" }, { value: "WAITING_REPLY", label: "待回复" }, { value: "DUE", label: "待维护" }, { value: "FIRST_CONTACT", label: "首次待联系" }, { value: "DORMANT", label: "沉睡" }, { value: "UNKNOWN", label: "状态未知" }, { value: "STOPPED", label: "暂停维护" }];
const PERSONAL_FILTER_OPTIONS = [...FILTER_OPTIONS, { value: "ACTIVE" as const, label: "当前活跃" }, { value: "TODO" as const, label: "全部待办" }];
const SORT_OPTIONS: Record<SupportAnalyticsView, Array<{ value: NonNullable<SupportAnalyticsQuery["sortKey"]>; label: string }>> = {
  OVERVIEW: [{ value: "LAST_ACTIVE_AT", label: "最近活动" }],
  AGENTS: [{ value: "BOUND_CUSTOMER_COUNT", label: "当前客户" }, { value: "ACTIVE_CUSTOMER_COUNT", label: "当前统计期活跃" }, { value: "FIRST_CONFIRMED_CUSTOMER_COUNT", label: "已首充客户" }, { value: "DEVICE_COUNT", label: "当前设备" }, { value: "PERSONAL_DEPOSIT", label: "客户累计充值" }],
  CUSTOMERS: [{ value: "LAST_ACTIVE_AT", label: "最近活动" }, { value: "REGISTERED_AT", label: "注册时间" }, { value: "DIRECT_INVITATION_COUNT", label: "直属邀请" }, { value: "TEAM_CUSTOMER_COUNT", label: "邀请后代" }, { value: "PERSONAL_DEPOSIT", label: "本人累计充值" }, { value: "NET_CONTRIBUTION", label: "净贡献额" }, { value: "TEAM_DEPOSIT", label: "邀请累计充值" }],
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
  if (next.sortKey === "NET_CONTRIBUTION" && next.basis !== "CURRENT_CUSTOMER_HISTORY") next.sortKey = undefined;
  if (next.basis === "CURRENT_ASSET") {
    next.firstState = "ALL";
    if (next.sortKey && ["PERSONAL_DEPOSIT", "TEAM_DEPOSIT", "FIRST_SUCCEEDED_AT"].includes(next.sortKey)) next.sortKey = undefined;
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
function activeAnalyticsConditions(state: AnalyticsQueryState, groups: SupportAnalyticsResponse["scopeSummary"]["groups"], personal = false) {
  const conditions: Array<{ key: string; label: string; remove: Partial<AnalyticsQueryState> }> = [];
  if (state.groupId !== undefined) conditions.push({ key: "group", label: `负责组：${groups.find(group => group.groupId === String(state.groupId))?.name || "组名未同步"}`, remove: { groupId: undefined } });
  if (state.category && state.category !== "ALL") conditions.push({ key: "category", label: `客户类别：${({ BOUND: "已绑定", PENDING: "待分配", ANOMALY: "归属异常" })[state.category]}`, remove: { category: "ALL" } });
  if (state.firstState && state.firstState !== "ALL") conditions.push({ key: "firstState", label: `首充：${FIRST_OPTIONS.find(option => option.value === state.firstState)?.label || "状态未知"}`, remove: { firstState: "ALL" } });
  if (state.filter && state.filter !== "ALL") conditions.push({ key: "filter", label: `服务：${(personal ? PERSONAL_FILTER_OPTIONS : FILTER_OPTIONS).find(option => option.value === state.filter)?.label || "状态未知"}`, remove: { filter: "ALL" } });
  if (state.agentId !== undefined) conditions.push({ key: "agent", label: `当前客服：账号 ${state.agentId}`, remove: { agentId: undefined } });
  if (state.keyword) conditions.push({ key: "keyword", label: `搜索：${state.keyword}`, remove: { keyword: undefined } });
  if (state.direction !== undefined) conditions.push({ key: "direction", label: `顺序：${state.direction === "ASC" ? "从低到高 / 从早到晚" : "从高到低 / 从近到远"}`, remove: { direction: undefined } });
  return conditions;
}
export function analyticsErrorText(error: unknown): string {
  if (error instanceof AnalyticsEntryError) return error.message;
  if (error instanceof SupportClientError) {
    if (error.status === 401) return "登录已失效，请重新登录。";
    if (error.status === 403) return "当前范围已无查看权限，请重新核对负责范围。";
    if (error.status === 404) return "统计入口暂不可用，请联系技术人员核对服务。";
    if (error.status === 409) return "数据或权限有变化，请从第一页重新加载。";
    if (error.status === 503) return "统计来源暂不可用，请稍后重试。";
  }
  return "统计资料暂时无法确认，请重试。";
}
function dateText(value: string | null): string {
  return value === null ? "未知" : new Intl.DateTimeFormat("zh-CN", { timeZone: businessZone().zoneId, dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
function Numeric({ value, observed, label, kind = "count", onClick, unavailable = false }: { value: string | null; observed?: string | null; label: string; kind?: "count" | "amount"; onClick?: () => void; unavailable?: boolean }) {
  const content = compactSupportBoardValue(value, kind);
  const explanation = unavailable ? "资料暂不可用" : content === "-" ? observed == null ? "资料未同步" : `已观测 ${observed}，完整数值仍在统计` : `已核实 ${value}${observed != null && observed !== value ? `，已观测 ${observed}` : ""}`;
  return <span className="sa-number-wrap">{onClick ? <button type="button" className="sa-number sa-link" title={explanation} aria-label={`${label}：${explanation}；查看明细`} onClick={onClick}>{content}</button> : <span className="sa-number" tabIndex={0} title={explanation} aria-label={`${label}：${explanation}`}>{content}</span>}</span>;
}
function CountValue({ count, coverage = [], label, onClick }: { count: Count; coverage?: Count["status"][]; label: string; onClick?: () => void }) {
  const statuses = [count.status, ...coverage], unavailable = statuses.some(status => status === "FAILED" || status === "UNAVAILABLE");
  return <Numeric value={count.confirmed === null || !statuses.every(status => status === "AVAILABLE") ? null : String(count.confirmed)} observed={count.observed === null ? null : String(count.observed)} label={label} onClick={onClick} unavailable={unavailable} />;
}
function MoneyValue({ money, label, onClick }: { money?: Money; label: string; onClick?: () => void }) { return <Numeric value={money?.confirmed ?? null} observed={money?.observed ?? null} label={label} kind="amount" onClick={onClick} />; }

// The existing house picker lacks Escape/arrow focus; keep its appearance and supply keyboard behavior here.
export function analyticsOptionIndex(key: string, selected: number, length: number): number {
  if (length === 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowUp") return selected < 0 ? length - 1 : (selected - 1 + length) % length;
  return selected < 0 ? 0 : (selected + 1) % length;
}
function AnalyticsSelect({ label, value, options, onChange }: { label: string; value: string; options: HDOption[]; onChange: (value: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const labelControls = () => { root.querySelector("button[aria-haspopup]")?.setAttribute("aria-label", label); root.querySelector("[role=listbox]")?.setAttribute("aria-label", label); };
    labelControls();
    const observer = new MutationObserver(labelControls); observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [label]);
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    const trigger = ref.current?.querySelector<HTMLButtonElement>("button[aria-haspopup]");
    if (!trigger) return;
    const open = trigger.getAttribute("aria-expanded") === "true";
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); trigger.click(); trigger.focus(); return; }
    if (event.key === "Tab" && open) { trigger.click(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (!open) trigger.click();
    queueMicrotask(() => {
      const choices = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? [])];
      const selected = choices.findIndex(choice => choice === document.activeElement);
      const index = analyticsOptionIndex(event.key, selected, choices.length);
      choices[index]?.focus();
    });
  }
  return <div className="sa-select" ref={ref} onKeyDownCapture={keyboard}><span className="sa-control-label">{label}</span><HDSelect value={value} options={options} onChange={next => { onChange(next); queueMicrotask(() => ref.current?.querySelector<HTMLButtonElement>("button[aria-haspopup]")?.focus()); }} /></div>;
}

type Drill = (changes: Partial<AnalyticsQueryState>) => void;
export function AnalyticsTable({ data, currency, drill, openProfile }: { data: SupportAnalyticsResponse; currency: Currency; drill: Drill; openProfile: (customerId: string) => void }) {
  if (!data.records.length) return <p className="sa-empty">当前范围与筛选下暂无已观测记录。{data.total === null && "总数仍在统计。"}</p>;
  const name = (row: SupportAnalyticsCustomer) => operatorNicknameText(row.nickname || "") || row.customerNo || `客户 ${row.customerId}`;
  if (data.view === "AGENTS") return <div className="sa-table-scroll"><table className="sa-table"><caption className="sr-only">客服当前客户画像；金额币种 {nexGridBrandText(currency)}</caption><thead><tr><th>客服 / 当前组</th><th>账号 / 资格</th><th>当前绑定</th><th>当前统计期活跃</th><th>已首充</th><th>持有设备</th><th>客户累计净贡献 / {nexGridBrandText(currency)}</th><th>客户累计充值 / {nexGridBrandText(currency)}</th><th>当前余额 / {nexGridBrandText(currency)}</th></tr></thead><tbody>{data.records.map(row => {
    const customerCount = row.funds.customerCount !== undefined ? String(row.funds.customerCount) : row.current.firstConfirmed.confirmed !== null && row.current.firstNone.confirmed !== null && row.current.firstUnknown.confirmed !== null ? (BigInt(row.current.firstConfirmed.confirmed) + BigInt(row.current.firstNone.confirmed) + BigInt(row.current.firstUnknown.confirmed)).toString() : null;
    const group = data.scopeSummary.groups.find(g => g.groupId === row.account.groupId);
    const funds = row.funds.balances?.find(f => f.currency === currency);
    const onlyAgent = (view: SupportAnalyticsView, extra: Partial<AnalyticsQueryState> = {}) => drill({ view, agentId: row.accountId, category: "BOUND", ...extra });
    return <tr key={row.accountId}><td><div className="sa-identity"><SupportAvatar name={row.displayName || "客服"} path={row.avatarRef ?? undefined} version={row.avatar?.version} /><div><button className="sa-name sa-link" type="button" title={row.displayName || "客服"} onClick={() => onlyAgent("CUSTOMERS")}>{row.displayName || "名称未同步"}</button><small>{group?.name || (row.account.groupId === null ? "待分组" : "组名未同步")}{row.account.supervisorAccount && (row.account.serviceAccount ? " · 兼主管" : " · 主管账号")}</small></div></div></td><td>{row.account.accountState === "ENABLED" ? "启用" : row.account.accountState === "DISABLED" ? "停用" : "未知"}<small>{!row.account.serviceAccount ? "主管资格与客服资格独立" : row.account.serviceQualification === "ENABLED" ? "专属客服资格有效" : row.account.serviceQualification === "DISABLED" ? "资格暂停" : row.account.serviceQualification === "REMOVED" ? "资格已移除" : "资格未知"}{row.account.handoverRequired && " · 待交接"}</small></td><td><Numeric value={customerCount === null ? null : String(customerCount)} label="当前绑定客户" onClick={() => onlyAgent("CUSTOMERS")} /></td><td><CountValue count={row.current.activity.active} coverage={[row.current.activity.status, row.current.activity.window.status]} label="当前统计期活跃" onClick={() => onlyAgent("ACTIVITY", { filter: "WINDOW_ACTIVE" })} /></td><td><CountValue count={row.current.firstConfirmed} label="已首充客户" onClick={() => onlyAgent("CUSTOMERS", { firstState: "CONFIRMED" })} /></td><td><CountValue count={row.current.devices.held} label="当前设备" onClick={() => onlyAgent("DEVICES", { basis: "CURRENT_ASSET" })} /></td><td><MoneyValue money={row.current.ownLifetime.find(x => x.currency === currency)?.net} label={`客户累计净贡献 ${nexGridBrandText(currency)}`} onClick={() => onlyAgent("CUSTOMERS")} /></td><td><MoneyValue money={row.current.ownLifetime.find(x => x.currency === currency)?.deposits} label={`客户累计充值 ${nexGridBrandText(currency)}`} onClick={() => onlyAgent("FINANCE", { basis: "CURRENT_CUSTOMER_HISTORY" })} /></td><td><Numeric kind="amount" value={funds?.confirmedAmount ?? null} observed={funds?.observedAmount} label={`当前余额 ${nexGridBrandText(currency)}`} onClick={() => onlyAgent("CUSTOMERS")} /></td></tr>;
  })}</tbody></table></div>;
  if (data.view === "FINANCE") return <div className="sa-table-scroll"><table className="sa-table"><caption className="sr-only">授权客户资金事件，金额币种 {nexGridBrandText(currency)}</caption><thead><tr><th>客户 / 编码</th><th>事件类型</th><th>成功时间</th><th>当前查到的金额 / {nexGridBrandText(currency)}</th><th>历史覆盖</th><th>详情</th></tr></thead><tbody>{data.records.map((row, index) => <tr key={`${row.customerId}:${row.orderNo}:${row.succeededAt}:${index}`}><td><button type="button" className="sa-name sa-link" title={operatorNicknameText(row.nickname || "") || row.customerNo || row.customerId} onClick={() => openProfile(row.customerId)}>{operatorNicknameText(row.nickname || "") || row.customerNo || `客户 ${row.customerId}`}</button><small>{row.customerNo || "编码未同步"}</small></td><td>{row.kind === "DEPOSIT" ? "充值" : row.kind === "DEVICE_PURCHASE" ? "购机" : row.kind === "CONSUMPTION" ? "付费消费" : "购机退款"}</td><td className="sa-time">{dateText(row.succeededAt)}</td><td><Numeric value={row.amount} kind="amount" label="此笔当前查到的金额" onClick={() => openProfile(row.customerId)} /></td><td>{row.historyStatus === "READY" ? "首充历史已核实" : "首充历史未同步"}</td><td><button type="button" className="sa-link" onClick={() => openProfile(row.customerId)}>客户资金详情</button></td></tr>)}</tbody></table></div>;
  if (data.view === "DEVICES") return <div className="sa-table-scroll"><table className="sa-table"><caption className="sr-only">当前托管设备数量</caption><thead><tr><th>设备 / 客户编号</th><th>类型</th><th>算力</th><th>当前持有</th><th>连接状态</th><th>取得来源</th><th>详情</th></tr></thead><tbody>{data.records.map(row => <tr key={row.deviceId}><td>{row.deviceId}<small>客户 {row.customerId}</small></td><td>{row.deviceType === "SHARE" || row.deviceType === "CLOUD_SHARE" ? "云份额" : row.deviceType === "DEVICE" ? "实体设备" : row.deviceType === "SERVER" ? "服务器" : "类型未知"}</td><td><Numeric value={row.hashrate} kind="amount" label="设备算力" onClick={() => openProfile(row.customerId)} /></td><td>{row.holdingStatus === "AVAILABLE" ? "已核实" : "未知"}</td><td>{row.connectionStatus === "ONLINE" ? "在网" : row.connectionStatus === "OFFLINE" ? "离线" : row.connectionStatus === "NOT_APPLICABLE" ? "不适用" : "未知"}</td><td>{row.acquisition === "PAID_PURCHASE" ? "付费购买" : "来源未知"}</td><td><button type="button" className="sa-link" onClick={() => openProfile(row.customerId)}>客户设备详情</button></td></tr>)}</tbody></table></div>;
  return <div className="sa-table-scroll"><table className="sa-table"><caption className="sr-only">当前客户画像；金额币种 {nexGridBrandText(currency)}</caption><thead><tr><th>客户 / 专属客服</th><th>首充状态</th><th>直属邀请</th><th>下级邀请用户</th><th>本人累计净贡献 / {nexGridBrandText(currency)}</th><th>本人累充 / {nexGridBrandText(currency)}</th><th>邀请累充 / {nexGridBrandText(currency)}</th><th>当前统计期活跃 / 最近活动</th><th>服务状态</th></tr></thead><tbody>{data.records.map(row => <tr key={row.customerId}><td><div className="sa-identity"><SupportAvatar name={name(row)} path={row.avatar ?? undefined} /><div><button type="button" className="sa-name sa-link" title={name(row)} onClick={() => openProfile(row.customerId)}>{name(row)}</button><small>{row.customerNo || "编码未同步"} · {row.owner.agentName || "归属未知"}</small></div></div></td><td><button type="button" className="sa-link" onClick={() => openProfile(row.customerId)}>{row.first.state === "CONFIRMED" ? "已首充" : row.first.state === "NONE" ? "未首充" : "历史未同步"}</button><small>{row.first.state === "CONFIRMED" && row.first.kind ? row.first.kind === "DEPOSIT" ? "首笔充值" : "首笔购机" : "首次付费记录"}</small></td><td><CountValue count={row.invitations.direct} label="直属邀请" onClick={() => openProfile(row.customerId)} /></td><td><CountValue count={row.invitations.descendants} label="邀请后代" onClick={() => openProfile(row.customerId)} /></td><td><MoneyValue money={row.lifetime.find(x => x.currency === currency)?.net} label={`本人累计净贡献 ${nexGridBrandText(currency)}`} onClick={() => openProfile(row.customerId)} /></td><td><MoneyValue money={row.lifetime.find(x => x.currency === currency)?.deposits} label={`本人累充 ${nexGridBrandText(currency)}`} onClick={() => openProfile(row.customerId)} /></td><td><MoneyValue money={row.invitations.deposits.find(x => x.currency === currency)?.deposits} label={`邀请累充 ${nexGridBrandText(currency)}`} onClick={() => openProfile(row.customerId)} /></td><td>{row.activity.state === "ACTIVE" ? "当前统计期活跃" : row.activity.state === "INACTIVE" ? "当前统计期未活跃" : "未知"}<small className="sa-time">{dateText(row.activity.lastEffectiveAt)}</small></td><td>{row.task.status === "UNAVAILABLE" ? "任务资料待加载" : row.task.waitingReply === true ? "待回复" : row.task.due === true ? "待维护" : row.task.firstContact === true ? "首次待联系" : row.task.enabled === false ? "暂停主动维护" : row.task.status !== "COMPLETE" ? "未知" : "正常跟进"}<small><button type="button" className="sa-link" onClick={() => openProfile(row.customerId)}>客户资料与记录</button></small></td></tr>)}</tbody></table></div>;
}

export function M1AnalyticsWorkbench(props: { permission: Permission; ctx: MCtx }) {
  const session = useAdminAuth(state => state.session), epoch = useAdminAuth(state => state.authEpoch);
  return <ResolvedAnalyticsWorkbench key={adminShellSessionKey(session, epoch)} {...props} />;
}
function ResolvedAnalyticsWorkbench({ permission, ctx }: { permission: Permission; ctx: MCtx }) {
  const router = useRouter();
  const [scope, setScope] = useState<SupportAnalyticsResponse | null>(null), [scopeError, setScopeError] = useState("");
  const teamChanged = useRef(false);
  const [scopeRetry, setScopeRetry] = useState(0), [queryState, setQueryState] = useState(initialAnalyticsQuery("PERSONAL"));
  const [data, setData] = useState<SupportAnalyticsResponse | null>(null), [error, setError] = useState("");
  const [loading, setLoading] = useState(false), [retry, setRetry] = useState(0), [cancelled, setCancelled] = useState(false);
  const [section, setSection] = useState<Section>("stats"), [personalView, setPersonalView] = useState<PersonalWorkbenchView>("dashboard");
  const lastDataView = useRef<SupportAnalyticsView>("OVERVIEW");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [monthCalendar, setMonthCalendar] = useState<SupportAnalyticsMonth[] | null>(null);
  const [calendarError, setCalendarError] = useState(""), [calendarRetry, setCalendarRetry] = useState(0);
  const [personalPeriod, setPersonalPeriod] = useState<SupportAnalyticsResponse | null>(null), [personalPeriodError, setPersonalPeriodError] = useState("");
  const managementReturnQuery = useRef<AnalyticsQueryState | null>(null);
  const managementCustomerGroup = useRef<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const controllerRef = useRef<AbortController | null>(null), scopeControllerRef = useRef<AbortController | null>(null), generation = useRef(0);
  const entryStatistics = useRef<{ query: string; data: SupportAnalyticsResponse } | null>(null);
  const isPersonal = scope?.scopeSummary.mode === "PERSONAL";
  const showStatistics = Boolean(scope && section === "stats");
  const statisticsCalendar = queryState.basis === "PERIOD_EVENT" ? monthCalendar : null;
  const adminId = useAdminAuth(state => state.session?.adminId);
  const readModes = useAdminAuth(state => state.session?.supportReadModes);
  // A session hint only chooses the requested projection. The response still resolves current authority.
  const entryReadMode = readModes?.includes("ALL") ? "ALL" : readModes?.includes("MANAGED") ? "MANAGED" : readModes?.includes("PERSONAL") ? "PERSONAL" : "ALL";
  const needsCalendar = Boolean(scope && (isPersonal || queryState.basis === "PERIOD_EVENT"));
  // A supervisor who also holds a receiving seat keeps a tab for their own customers.
  const canMine = scope?.scopeSummary.mode === "MANAGED" && (() => { try { return (JSON.parse(ctx.pget("I.support.agents") ?? "[]") as Array<{ adminId?: number; assignmentEligible?: boolean }>).some(agent => agent.adminId === adminId && agent.assignmentEligible === true); } catch { return false; } })();
  useEffect(() => { if (queryState.view !== "CUSTOMERS") lastDataView.current = queryState.view; }, [queryState.view]);
  useEffect(() => {
    const controller = new AbortController();
    setPersonalPeriod(null); setPersonalPeriodError("");
    if (scope?.scopeSummary.mode !== "PERSONAL" || !monthCalendar) return () => controller.abort();
    void supportAnalyticsClient.query({ view: "OVERVIEW", basis: "PERIOD_EVENT", ...analyticsMonthWindow(queryState.month, monthCalendar), currency: queryState.currency ?? "USDT", pageSize: 1, signal: controller.signal })
      .then(next => { if (!controller.signal.aborted && next.scopeSummary.mode === "PERSONAL") setPersonalPeriod(next); })
      .catch(cause => { if (!controller.signal.aborted) setPersonalPeriodError(analyticsErrorText(cause)); });
    return () => controller.abort();
  }, [scope, queryState.month, queryState.currency, monthCalendar]);
  useEffect(() => {
    const controller = new AbortController();
    setMonthCalendar(null); setCalendarError("");
    if (!needsCalendar) return () => controller.abort();
    void supportAnalyticsClient.months(controller.signal).then(months => { if (!controller.signal.aborted) setMonthCalendar(months); })
      .catch(cause => { if (!controller.signal.aborted) setCalendarError(analyticsErrorText(cause)); });
    return () => controller.abort();
  }, [needsCalendar, scopeRetry, calendarRetry]);
  useEffect(() => {
    const controller = new AbortController(); scopeControllerRef.current = controller; entryStatistics.current = null; setScope(null); setScopeError(""); setData(null); setProfileId(null);
    (async () => {
      const agentId = analyticsEntryAgent(window.location.search);
      let query = analyticsWireQuery(initialAnalyticsQuery(entryReadMode), []);
      let next: SupportAnalyticsResponse;
      try {
        next = await supportAnalyticsClient.query({ ...query, signal: controller.signal });
      } catch (cause) {
        // A stale seat/supervisor hint can request a projection no longer allowed to this operator.
        if (controller.signal.aborted || query.view === "OVERVIEW" || !(cause instanceof SupportClientError) || cause.status !== 403) throw cause;
        query = analyticsWireQuery(initialAnalyticsQuery("ALL"), []);
        next = await supportAnalyticsClient.query({ ...query, signal: controller.signal });
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
      if (customerGroup && String(groupId) !== customerGroup) throw new SupportClientError(403, undefined, undefined);
      const restored: AnalyticsQueryState = remembered ? { ...changeAnalyticsQuery(remembered, { groupId, view: next.scopeSummary.mode === "PERSONAL" && ["OVERVIEW", "AGENTS"].includes(remembered.view) ? "CUSTOMERS" : remembered.view }), agentId: groupId === remembered.groupId ? remembered.agentId : undefined } : { ...initialAnalyticsQuery(next.scopeSummary.mode), ...(agentId === undefined ? {} : { view: "CUSTOMERS" as const, category: "BOUND" as const, agentId }) };
      if (remembered && remembered.view === restored.view) restored.sortKey = remembered.sortKey;
      const personal = next.scopeSummary.mode === "PERSONAL";
      if (agentId !== undefined) setSection("stats");
      else if (!remembered) {
        const tab = entryTab(personal, false);
        if (tab === "customers") restored.view = "CUSTOMERS";
        setSection(personal ? tab === "my-data" ? "stats" : "personal" : tab === "data" || tab === "customers" ? "stats" : tab as Section);
        if (personal) setPersonalView(tab === "my-customers" ? "customers" : "dashboard");
      } else setSection(current => personal === (current === "personal") || current === "stats" ? current : personal ? "personal" : "stats");
      setScope(next); setQueryState(restored);
    }).catch(cause => { if (!controller.signal.aborted) setScopeError(analyticsErrorText(cause)); });
    return () => controller.abort();
  }, [scopeRetry, entryReadMode]);
  useEffect(() => {
    const invalidate = () => refreshScope(true);
    window.addEventListener("support-scope-invalidated", invalidate);
    return () => window.removeEventListener("support-scope-invalidated", invalidate);
  }, [queryState]);
  useEffect(() => {
    if (!showStatistics) { entryStatistics.current = null; return; }
    if (queryState.basis === "PERIOD_EVENT" && !statisticsCalendar) return;
    const current = ++generation.current, controller = new AbortController(); controllerRef.current = controller;
    setData(null); setProfileId(null); setError(""); setLoading(true); setCancelled(false);
    (async () => {
      const query = analyticsWireQuery(queryState, statisticsCalendar ?? []);
      const entry = entryStatistics.current;
      entryStatistics.current = null;
      // Reuse only this mount's just-authorized response for the identical first query.
      return entry?.query === JSON.stringify(query) ? entry.data : supportAnalyticsClient.query({ ...query, signal: controller.signal });
    })().then(next => {
      if (controller.signal.aborted || current !== generation.current) return;
      if (next.scopeSummary.mode !== scope?.scopeSummary.mode) { setScope(null); setScopeRetry(n => n + 1); return; }
      setData(next);
    }).catch(cause => {
      if (controller.signal.aborted || current !== generation.current) return;
      setData(null); setError(analyticsErrorText(cause));
      if (cause instanceof SupportClientError && [401, 403].includes(cause.status)) { setScope(null); setScopeError(analyticsErrorText(cause)); }
    }).finally(() => { if (!controller.signal.aborted && current === generation.current) setLoading(false); });
    return () => { controller.abort(); generation.current++; };
  }, [showStatistics, queryState, retry, scope?.scopeSummary.mode, statisticsCalendar]);
  const change: Drill = changes => { controllerRef.current?.abort(); generation.current++; setData(null); setProfileId(null); setError(""); setQueryState(previous => changeAnalyticsQuery(previous, changes)); };
  function refreshScope(invalidated = false) {
    scopeControllerRef.current?.abort(); controllerRef.current?.abort(); generation.current++;
    managementReturnQuery.current = invalidated ? changeAnalyticsQuery(queryState, { groupId: undefined, keyword: undefined }) : { ...queryState, pageNum: 1, expectedVersion: undefined };
    if (invalidated) setKeyword("");
    setScope(null); setScopeError(""); setData(null); setProfileId(null); setError("");
    setScopeRetry(n => n + 1);
  }
  function reloadFirstPage() { change({}); setRetry(n => n + 1); }
  function page(number: number) {
    if (!data) return;
    const next = nextAnalyticsPage(queryState, data, number);
    if (!next) return;
    controllerRef.current?.abort(); generation.current++; setData(null); setProfileId(null);
    // Paging keeps the signed query; all other edits use the reset reducer.
    setQueryState(next);
  }
if (!scope) return <section className="sa-workbench" aria-label="客服范围核对"><div className="sa-state" role={scopeError ? "alert" : "status"}>{scopeError || "正在核对当前可见范围…"}{scopeError && <button type="button" onClick={() => setScopeRetry(n => n + 1)}>重新核对范围</button>}{scopeError && <button type="button" onClick={() => router.push("/service/leaderboard")}>查看业绩榜</button>}</div></section>;
  const mode = scope.scopeSummary.mode, currency = queryState.currency ?? "USDT";
  const leadPermission: Permission = mode === "ALL" ? "superadmin" : "supervisor";
  const tabs = roleTabs(isPersonal, canMine);
  const currentTab: M1Tab = isPersonal
    ? section === "stats" ? "my-data" : personalView === "customers" ? "my-customers" : "home"
    : section === "stats" ? queryState.view === "CUSTOMERS" ? "customers" : "data" : section === "personal" ? "data" : section;
  function openTab(tab: M1Tab) {
    // Group changes in 客服与分组 feed the scope (group chips, names); re-read it once the supervisor leaves that tab.
    if (section === "team" && tab !== "team" && teamChanged.current) { teamChanged.current = false; setScope(null); setScopeRetry(n => n + 1); }
    const url = new URL(window.location.href); url.searchParams.set("view", tab); window.history.replaceState(null, "", url);
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
  const activeConditions = activeAnalyticsConditions(queryState, groups, isPersonal);
  const monthOptions = monthCalendar ? analyticsMonths(monthCalendar) : [];
  const drill: Drill = changes => { setSection("stats"); setKeyword(""); change({ groupId: undefined, agentId: undefined, category: "ALL", keyword: undefined, firstState: "ALL", filter: "ALL", sortKey: undefined, direction: undefined, ...changes }); };
  const current = data?.selectedCurrent, personnel = data?.scopeSummary.personnel;
  const deposits = queryState.basis === "PERIOD_EVENT" ? data?.scopeSummary.financial.currencies.find(x => x.currency === currency)?.deposits : current?.ownLifetime.find(x => x.currency === currency)?.deposits;
  const caption = queryState.basis === "PERIOD_EVENT" ? `统计 ${queryState.month} 当月发生的业务（${businessZone().label}）；绑定和设备按当前状态` : queryState.basis === "CURRENT_ASSET" ? "按当前设备和活跃状态统计；不含首充和累计资金" : "按客户注册以来的累计数据统计，不是本月新增";
  return <section className="sa-workbench">
{!isPersonal && <M1LiveService ctx={ctx} />}
<div className="sa-tabbar">
  <nav className="sa-main-tabs" aria-label="客服工作台">{tabs.map(tab => <button type="button" key={tab} aria-current={currentTab === tab ? "page" : undefined} onClick={() => openTab(tab)}>{TAB_LABEL[tab]}{tab === "pool" && scope.scopeSummary.pending ? <span className="sa-tab-count">{scope.scopeSummary.pending}</span> : null}</button>)}</nav>
  <div className="sa-actions">{!isPersonal && <button type="button" onClick={() => { window.location.href = "/service/sessions?tab=pending"; }}>会话审阅</button>}<button type="button" onClick={() => router.push("/service/leaderboard")}>业绩榜</button><button type="button" onClick={() => refreshScope()}>刷新</button></div>
</div>
{isPersonal && <div hidden={section === "stats"}><M1PersonalWorkbench permission="agent" ctx={ctx} view={personalView} onViewChange={next => { setSection("personal"); setPersonalView(next); }}
  onBrowseCustomers={filter => { if (queryState.view === "CUSTOMERS" && queryState.basis === "CURRENT_CUSTOMER_HISTORY" && queryState.filter === filter) { setSection("stats"); return; } drill({ view: "CUSTOMERS", category: "BOUND", basis: "CURRENT_CUSTOMER_HISTORY", filter, firstState: "ALL", keyword: undefined }); }}
  primarySummary={<section className="sa-personal-summary" aria-label="本人客户与期间业绩">
    <AnalyticsFreshness asOf={scope.asOf} label="客户统计" onRefresh={() => refreshScope()} />
    {!monthCalendar && <p role={calendarError ? "alert" : "status"}>{calendarError || "正在读取业绩月份…"}{calendarError && <button type="button" onClick={() => setCalendarRetry(n => n + 1)}>重试读取月份</button>}</p>}
    <div className="sa-personal-period-controls"><AnalyticsSelect label="业绩自然月" value={queryState.month} options={monthOptions} onChange={month => change({ month })} /><AnalyticsSelect label="业绩币种" value={currency} options={[{ value: "USDT", label: "USDT" }, { value: "UVT", label: "UVT" }]} onChange={value => { if (value === "USDT" || value === "UVT") change({ currency: value }); }} /></div>
    <div className="sa-personal-primary-metrics">
      <div><span>当前本人绑定</span><Numeric value={scope.scopeSummary.bound === null ? null : String(scope.scopeSummary.bound)} label="当前本人绑定客户" onClick={() => drill({ view: "CUSTOMERS", category: "BOUND", basis: "CURRENT_CUSTOMER_HISTORY", filter: "ALL", firstState: "ALL" })} /></div>
      <div><span>{scope.selectedCurrent.activity.window.days ? `近 ${scope.selectedCurrent.activity.window.days} 天活跃` : "当前统计期活跃"}</span><CountValue count={scope.selectedCurrent.activity.active} coverage={[scope.selectedCurrent.activity.status, scope.selectedCurrent.activity.window.status]} label="当前统计期活跃客户" onClick={() => drill({ view: "ACTIVITY", category: "BOUND", basis: "CURRENT_ASSET", filter: "WINDOW_ACTIVE" })} /></div>
      <div><span>期间首充（含付费购机）</span><CountValue count={personalFinancial?.firstCandidates ?? { observed: null, confirmed: null, status: "UNKNOWN" }} label="期间首充客户" onClick={() => drill({ view: "CUSTOMERS", basis: "PERIOD_EVENT", firstState: "CONFIRMED", filter: "ALL" })} /></div>
      <div><span>期间净贡献 / {nexGridBrandText(currency)}</span><MoneyValue money={personalFinancial?.currencies.find(row => row.currency === currency)?.net} label={`期间净贡献 ${nexGridBrandText(currency)}`} onClick={() => drill({ view: "FINANCE", basis: "PERIOD_EVENT", filter: "ALL" })} /></div>
    </div>
    <p>{queryState.month} · {nexGridBrandText(currency)} · {businessZoneText()}；绑定与活跃按当前客户统计。</p>
    {personalPeriod && <AnalyticsFreshness asOf={personalPeriod.asOf} label="期间业绩" onRefresh={() => refreshScope()} />}
    {personalPeriodError && <p role="alert">{personalPeriodError}<button type="button" onClick={() => refreshScope()}>重新加载业绩</button></p>}
    <div className="sa-personal-first-sources" aria-label="期间首充金额来源">{(["deposits", "purchases"] as const).map(source => <div key={source}><span>{source === "deposits" ? "充值首充" : "付费购机首充"} / {nexGridBrandText(currency)}</span><MoneyValue money={personalFinancial?.firstSources.find(row => row.currency === currency)?.[source]} label={source === "deposits" ? `充值首充金额 ${nexGridBrandText(currency)}` : `付费购机首充金额 ${nexGridBrandText(currency)}`} onClick={() => drill({ view: "FINANCE", basis: "PERIOD_EVENT" })} /></div>)}</div>
  </section>} /></div>}
    {!isPersonal && section === "pool" && <M1SupervisorPool permission={leadPermission} />}
    {!isPersonal && section === "team" && <M1GroupManagement mode={mode} initialGroupId={queryState.groupId === undefined ? undefined : String(queryState.groupId)} actions={<SupportSeatRolesButton permission={leadPermission} ctx={ctx} />} onChanged={() => { teamChanged.current = true; controllerRef.current?.abort(); generation.current++; setData(null); setProfileId(null); }} onViewCustomers={(groupId, category) => {
      managementCustomerGroup.current = groupId;
      managementReturnQuery.current = changeAnalyticsQuery(queryState, { groupId, view: "CUSTOMERS", basis: "CURRENT_CUSTOMER_HISTORY", category, agentId: undefined, keyword: undefined, firstState: "ALL", filter: "ALL" });
      setKeyword(""); setSection("stats"); setScope(null); setScopeRetry(n => n + 1);
    }} />}
    {!isPersonal && section === "mine" && <M1PersonalWorkbench permission="supervisor" ctx={ctx} view={personalView} onViewChange={setPersonalView} />}
    {showStatistics && <>
      <header className="sa-header"><div><h2>{isPersonal ? "本人客户画像" : currentTab === "customers" ? mode === "ALL" ? "全部客户" : "负责组客户" : mode === "ALL" ? "平台运营总览" : "我的分组数据"}</h2><p>{selectedGroup?.name || (queryState.groupId ? "组名未同步" : isPersonal ? "本人当前客户" : mode === "ALL" ? "全部获准客服范围" : "全部负责组")} · {businessZone().label}</p></div></header>
      {data && <AnalyticsFreshness asOf={data.asOf} onRefresh={() => refreshScope()} />}
{!isPersonal && <nav className="sa-group-tabs" aria-label="负责组范围"><span className="sa-group-label">分组</span><button type="button" aria-pressed={queryState.groupId === undefined} onClick={() => change({ groupId: undefined })}>全部</button>{groups.map(group => <button type="button" key={group.groupId} title={group.name || "组名未同步"} aria-label={group.name || "组名未同步"} aria-pressed={String(queryState.groupId) === group.groupId} onClick={() => change({ groupId: group.groupId })}>{group.name || "组名未同步"}</button>)}</nav>}
      {(isPersonal || queryState.view !== "CUSTOMERS") && <nav className="sa-datasets" aria-label="数据视角">{DATASETS.filter(x => isPersonal ? !["OVERVIEW", "AGENTS"].includes(x.value) : x.value !== "CUSTOMERS").map(item => <button type="button" key={item.value} aria-pressed={queryState.view === item.value} onClick={() => change({ view: item.value, ...(item.value === "DEVICES" ? { basis: "CURRENT_ASSET" as const } : {}) })}>{item.label}</button>)}</nav>}
      <form className="sa-controls" onSubmit={event => { event.preventDefault(); change({ keyword: keyword.trim() || undefined }); }}>
        <AnalyticsSelect label="统计规则" value={queryState.basis ?? "CURRENT_CUSTOMER_HISTORY"} options={BASIS_OPTIONS.filter(x => queryState.view !== "FINANCE" || x.value !== "CURRENT_ASSET")} onChange={value => { const found = BASIS_OPTIONS.find(x => x.value === value && (queryState.view !== "FINANCE" || x.value !== "CURRENT_ASSET")); if (found) change({ basis: found.value }); }} />
        {queryState.basis === "PERIOD_EVENT" && <AnalyticsSelect label="自然月" value={queryState.month} options={monthOptions} onChange={month => change({ month })} />}
        <AnalyticsSelect label="币种" value={currency} options={[{ value: "USDT", label: "USDT" }, { value: "UVT", label: "UVT" }]} onChange={value => { if (value === "USDT" || value === "UVT") change({ currency: value }); }} />
        {queryState.view !== "OVERVIEW" && <><AnalyticsSelect label="排序" value={queryState.sortKey ?? ""} options={[{ value: "", label: "按当前筛选默认排序" }, ...SORT_OPTIONS[queryState.view].filter(x => (x.value !== "NET_CONTRIBUTION" || queryState.basis === "CURRENT_CUSTOMER_HISTORY") && (queryState.basis !== "CURRENT_ASSET" || !["PERSONAL_DEPOSIT", "TEAM_DEPOSIT"].includes(x.value)))]} onChange={value => { const found = SORT_OPTIONS[queryState.view].find(x => x.value === value); change({ sortKey: found?.value }); }} /><AnalyticsSelect label="顺序" value={queryState.direction ?? ""} options={[{ value: "", label: "默认顺序" }, { value: "DESC", label: "从高到低 / 从近到远" }, { value: "ASC", label: "从低到高 / 从早到晚" }]} onChange={value => change({ direction: value === "DESC" || value === "ASC" ? value : undefined })} /></>}
        {["CUSTOMERS", "ACTIVITY"].includes(queryState.view) && <><AnalyticsSelect label="首充状态" value={queryState.firstState ?? "ALL"} options={queryState.basis === "CURRENT_ASSET" ? [FIRST_OPTIONS[0]] : FIRST_OPTIONS} onChange={value => { const found = FIRST_OPTIONS.find(x => x.value === value); if (found) change({ firstState: found.value }); }} /><AnalyticsSelect label="服务状态" value={queryState.filter ?? "ALL"} options={isPersonal ? PERSONAL_FILTER_OPTIONS : FILTER_OPTIONS} onChange={value => { const found = (isPersonal ? PERSONAL_FILTER_OPTIONS : FILTER_OPTIONS).find(x => x.value === value); if (found) change({ filter: found.value }); }} /></>}
        {queryState.view !== "OVERVIEW" && <label className="sa-search"><span className="sa-control-label">搜索客户名称或编码</span><input value={keyword} maxLength={200} onChange={event => setKeyword(event.target.value)} placeholder="客户名称或编码" /></label>}{queryState.view !== "OVERVIEW" && <button type="submit">搜索</button>}
        {(queryState.agentId !== undefined || queryState.keyword || queryState.firstState !== "ALL" || queryState.filter !== "ALL" || queryState.category !== "ALL") && <button type="button" onClick={() => { setKeyword(""); change({ agentId: undefined, keyword: undefined, firstState: "ALL", filter: "ALL", category: "ALL" }); }}>清除客服与客户筛选</button>}
      </form>
      {activeConditions.length > 0 && <div className="sa-active-conditions" role="group" aria-label="当前生效条件"><span>当前生效：</span>{activeConditions.map(condition => <button type="button" key={condition.key} title={condition.label} aria-label={`移除${condition.label}`} onClick={() => { if (condition.key === "keyword") setKeyword(""); change(condition.remove); }}><span>{condition.label}</span><span aria-hidden="true">×</span></button>)}</div>}
      <p className="sa-disclosure" title="绑定与人员规模按所选分组统计，客户数据按当前筛选；邀请金额不计入分组经营金额。">{caption}{queryState.agentId !== undefined && ` · 已选客服编号 ${queryState.agentId}`}{data?.versionState === "READY" ? "" : " · 数据仍在同步"}</p>
      {queryState.basis === "PERIOD_EVENT" && !monthCalendar && <div className="sa-state" role={calendarError ? "alert" : "status"}>{calendarError || "正在读取统计月份…"}{calendarError && <button type="button" onClick={() => setCalendarRetry(n => n + 1)}>重试读取月份</button>}</div>}
      {loading && <div className="sa-state" role="status">正在加载…<button type="button" onClick={() => { controllerRef.current?.abort(); generation.current++; setLoading(false); setCancelled(true); setData(null); }}>取消读取</button></div>}
      {(error || cancelled) && <div className="sa-state" role={error ? "alert" : "status"}>{error || "已取消加载，筛选条件不变。"}<button type="button" onClick={reloadFirstPage}>{error.includes("第一页") ? "从第一页重新加载" : "重试"}</button></div>}
      {data && current && personnel && <>
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
        {queryState.view === "FINANCE" && <section className="sa-current-funds" aria-label="当前客户资金观测"><p>当前筛选客户的余额与提现观测，不受月份筛选；提现发生时的客户归属暂无记录。</p><div className="sa-inline-metrics"><div><span>当前余额 / {nexGridBrandText(currency)}</span><Numeric kind="amount" value={data.funds.balances?.find(x => x.currency === currency)?.confirmedAmount ?? null} observed={data.funds.balances?.find(x => x.currency === currency)?.observedAmount} label={`当前余额 ${nexGridBrandText(currency)}`} /></div><div><span>成功提现本金 / {nexGridBrandText(currency)}</span><Numeric kind="amount" value={data.funds.withdrawals?.find(x => x.currency === currency)?.successPrincipal.confirmedAmount ?? null} observed={data.funds.withdrawals?.find(x => x.currency === currency)?.successPrincipal.observedAmount} label={`已观测成功提现本金 ${nexGridBrandText(currency)}`} /></div><div><span>成功提现实到 / {nexGridBrandText(currency)}</span><Numeric kind="amount" value={data.funds.withdrawals?.find(x => x.currency === currency)?.successNet.confirmedAmount ?? null} observed={data.funds.withdrawals?.find(x => x.currency === currency)?.successNet.observedAmount} label={`已观测提现实到 ${nexGridBrandText(currency)}`} /></div><div><span>处理中本金 / {nexGridBrandText(currency)}</span><Numeric kind="amount" value={data.funds.withdrawals?.find(x => x.currency === currency)?.processingPrincipal.confirmedAmount ?? null} observed={data.funds.withdrawals?.find(x => x.currency === currency)?.processingPrincipal.observedAmount} label={`已观测处理中本金 ${nexGridBrandText(currency)}`} /></div></div></section>}
        {queryState.view === "OVERVIEW" ? <>
          <div className="sa-coverage"><div>待分配 <Numeric value={data.scopeSummary.pending === null ? null : String(data.scopeSummary.pending)} label="待分配客户，打开待分配客户池" onClick={() => openTab("pool")} /></div><div>归属异常 <Numeric value={data.scopeSummary.anomaly === null ? null : String(data.scopeSummary.anomaly)} label="归属异常" onClick={() => change({ view: "CUSTOMERS", category: "ANOMALY", firstState: "ALL", filter: "ALL" })} /></div><div>有效净额 / {nexGridBrandText(currency)} <MoneyValue money={data.scopeSummary.financial.currencies.find(x => x.currency === currency)?.net} label={`有效净额 ${nexGridBrandText(currency)}`} /></div></div>
          {queryState.groupId === undefined && <section className="sa-group-comparison"><h3>负责组概览</h3><p>展示 {Math.min(data.scopeSummary.groups.length, 4)} / {data.scopeSummary.groups.length} 个组；完整组范围可在上方选择。</p><div>{data.scopeSummary.groups.slice(0, 4).map(group => <div key={group.groupId}><button type="button" className="sa-name sa-link" title={group.name ?? "组名未同步"} onClick={() => change({ groupId: group.groupId, view: "AGENTS" })}>{group.name || "组名未同步"}</button><span>{queryState.basis === "PERIOD_EVENT" ? "当期净贡献" : "当前客户累计净贡献"} / {nexGridBrandText(currency)} <MoneyValue money={queryState.basis === "PERIOD_EVENT" ? group.period?.currencies.find(x => x.currency === currency)?.net : group.current.ownLifetime.find(x => x.currency === currency)?.net} label={`组净贡献 ${nexGridBrandText(currency)}`} onClick={() => change({ groupId: group.groupId, view: "OVERVIEW" })} /></span><span>当前客户 <Numeric value={group.total === null ? null : String(group.total)} label="组当前客户" onClick={() => change({ groupId: group.groupId, view: "CUSTOMERS" })} /></span><span>专属客服 <CountValue count={group.personnel.serviceAccounts} label="组专属客服" onClick={() => change({ groupId: group.groupId, view: "AGENTS" })} /></span></div>)}</div></section>}
          {!data.scopeSummary.groups.length && mode === "MANAGED" && <p className="sa-empty">当前没有负责组。</p>}
        </> : <><AnalyticsTable data={data} currency={currency} drill={change} openProfile={setProfileId} /><footer className="sa-pager"><p>{data.total === null ? `已观测 ${data.observedTotal} 条；总数仍在统计` : `共 ${data.total} 条`} · 第 {queryState.pageNum} 页</p><div><button type="button" disabled={queryState.pageNum <= 1 || data.versionState !== "READY"} onClick={() => page(queryState.pageNum - 1)}>上一页</button><button type="button" disabled={!data.canContinue || data.versionState !== "READY"} onClick={() => page(queryState.pageNum + 1)}>下一页</button></div></footer>{data.versionState === "UNKNOWN" && <p className="sa-disclosure">当前结果尚未确认，暂时无法继续翻页。请刷新后重试。</p>}</>}
      </>}
    </>}
    {profileId && <Modal wide title="客户资料与原业务明细" onClose={() => setProfileId(null)} footer={<button type="button" onClick={() => setProfileId(null)}>返回统计列表</button>}><p className="sa-disclosure">按你的客户资料查看权限显示；统计可见不增加资金操作或回复权限。</p><M3CustomerProfile key={profileId} ctx={ctx} customerId={profileId} onHistory={no => router.push(`/service/sessions?conversationNo=${encodeURIComponent(no)}`)} onRetryMessages={() => void ctx.refreshConversations()} /></Modal>}
  </section>;
}
