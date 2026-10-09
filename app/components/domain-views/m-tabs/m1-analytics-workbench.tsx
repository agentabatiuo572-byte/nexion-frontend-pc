"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { supportAnalyticsClient, type SupportAnalyticsQuery, type SupportAnalyticsResponse, type SupportAnalyticsView, type SupportAnalyticsCustomer } from "@/lib/admin/support-analytics-client";
import { SupportClientError } from "@/lib/admin/m-support-client";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { Modal } from "../design-kit";
import { HDSelect, type HDOption } from "./hd-ui";
import { M1PersonalWorkbench } from "./m1-personal-workbench";
import { M3CustomerProfile } from "./m3-customer-profile";
import { SupportAvatar } from "./support-avatar";
import { compactSupportBoardValue } from "./support-leaderboard";
import type { MCtx } from "./types";
import "./m1-analytics-workbench.css";

type Permission = "agent" | "supervisor" | "superadmin";
type Count = SupportAnalyticsResponse["selectedCurrent"]["firstConfirmed"];
type Money = SupportAnalyticsCustomer["lifetime"][number]["deposits"];
type Basis = NonNullable<SupportAnalyticsQuery["basis"]>;
type Currency = NonNullable<SupportAnalyticsQuery["currency"]>;
export type AnalyticsQueryState = Omit<SupportAnalyticsQuery, "signal" | "pageNum" | "pageSize" | "expectedVersion"> & { month: string; pageNum: number; expectedVersion?: string };
const DATASETS: Array<{ value: SupportAnalyticsView; label: string }> = [{ value: "OVERVIEW", label: "总览" }, { value: "AGENTS", label: "客服" }, { value: "CUSTOMERS", label: "客户" }, { value: "FINANCE", label: "资金" }, { value: "DEVICES", label: "设备" }, { value: "ACTIVITY", label: "活跃" }];
const BASIS_OPTIONS: Array<{ value: Basis; label: string }> = [{ value: "CURRENT_CUSTOMER_HISTORY", label: "当前客户" }, { value: "PERIOD_EVENT", label: "期间业绩" }, { value: "CURRENT_ASSET", label: "当前设备" }];
const FIRST_OPTIONS: Array<{ value: NonNullable<SupportAnalyticsQuery["firstState"]>; label: string }> = [{ value: "ALL", label: "全部首充状态" }, { value: "CONFIRMED", label: "已首充" }, { value: "NONE", label: "未首充" }, { value: "UNKNOWN", label: "历史待核实" }];
const FILTER_OPTIONS: Array<{ value: NonNullable<SupportAnalyticsQuery["filter"]>; label: string }> = [{ value: "ALL", label: "全部服务状态" }, { value: "WINDOW_ACTIVE", label: "窗口活跃" }, { value: "WAITING_REPLY", label: "待回复" }, { value: "DUE", label: "待维护" }, { value: "FIRST_CONTACT", label: "首次待联系" }, { value: "DORMANT", label: "沉睡" }, { value: "UNKNOWN", label: "状态待核实" }, { value: "STOPPED", label: "暂停维护" }];
const SORT_OPTIONS: Record<SupportAnalyticsView, Array<{ value: NonNullable<SupportAnalyticsQuery["sortKey"]>; label: string }>> = {
  OVERVIEW: [{ value: "LAST_ACTIVE_AT", label: "最近活动" }],
  AGENTS: [{ value: "BOUND_CUSTOMER_COUNT", label: "当前客户" }, { value: "ACTIVE_CUSTOMER_COUNT", label: "窗口活跃" }, { value: "FIRST_CONFIRMED_CUSTOMER_COUNT", label: "已首充客户" }, { value: "DEVICE_COUNT", label: "当前设备" }, { value: "PERSONAL_DEPOSIT", label: "客户累计充值" }],
  CUSTOMERS: [{ value: "LAST_ACTIVE_AT", label: "最近活动" }, { value: "REGISTERED_AT", label: "注册时间" }, { value: "DIRECT_INVITATION_COUNT", label: "直属邀请" }, { value: "TEAM_CUSTOMER_COUNT", label: "邀请后代" }, { value: "PERSONAL_DEPOSIT", label: "本人累计充值" }, { value: "TEAM_DEPOSIT", label: "邀请累计充值" }],
  FINANCE: [{ value: "SUCCEEDED_AT", label: "成功时间" }, { value: "AMOUNT", label: "金额" }],
  DEVICES: [{ value: "HASHRATE", label: "算力" }, { value: "LAST_ACTIVE_AT", label: "客户最近活动" }, { value: "DEVICE_COUNT", label: "客户设备数" }],
  ACTIVITY: [{ value: "LAST_ACTIVE_AT", label: "最近活动" }, { value: "REGISTERED_AT", label: "注册时间" }],
};
export function analyticsBusinessMonth(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${parts.find(p => p.type === "year")?.value}-${parts.find(p => p.type === "month")?.value}`;
}
export function analyticsMonthWindow(month: string): { from: string; to: string } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match || Number(match[1]) < 1001 || Number(match[1]) > 9998) throw new Error("统计月份无效，请重新选择。");
  const year = Number(match[1]), number = Number(match[2]);
  return { from: new Date(Date.UTC(year, number - 1, 1) - 8 * 3600000).toISOString(), to: new Date(Date.UTC(year, number, 1) - 8 * 3600000).toISOString() };
}
export function analyticsMonths(now = new Date()): HDOption[] {
  const [year, month] = analyticsBusinessMonth(now).split("-").map(Number);
  return Array.from({ length: 24 }, (_, index) => {
    const value = analyticsBusinessMonth(new Date(Date.UTC(year, month - 1 - index, 15)));
    return { value, label: value.replace("-", "年") + "月" };
  });
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
  if (next.basis === "CURRENT_ASSET") {
    next.firstState = "ALL";
    if (next.sortKey && ["PERSONAL_DEPOSIT", "TEAM_DEPOSIT", "FIRST_SUCCEEDED_AT"].includes(next.sortKey)) next.sortKey = undefined;
  }
  // Device sorts are independent of pool/maintenance state; the shared API default
  // sort can otherwise be POOL_ENTERED_AT/NEXT_DUE_AT, which DEVICES cannot accept.
  if (next.view === "DEVICES" && next.sortKey === undefined) next.sortKey = "LAST_ACTIVE_AT";
  return next;
}
export function analyticsWireQuery(state: AnalyticsQueryState): SupportAnalyticsQuery {
  const { month, ...query } = state;
  return { ...query, pageSize: state.view === "OVERVIEW" ? 1 : 20, ...(state.basis === "PERIOD_EVENT" ? analyticsMonthWindow(month) : {}) };
}
export function nextAnalyticsPage(state: AnalyticsQueryState, data: SupportAnalyticsResponse, pageNum: number): AnalyticsQueryState | null {
  if (!Number.isSafeInteger(pageNum) || pageNum < 1 || Math.abs(pageNum - state.pageNum) !== 1 || data.versionState !== "READY" || !data.queryVersion || pageNum > state.pageNum && !data.canContinue) return null;
  return { ...state, pageNum, expectedVersion: data.queryVersion };
}
function activeAnalyticsConditions(state: AnalyticsQueryState, groups: SupportAnalyticsResponse["scopeSummary"]["groups"]) {
  const conditions: Array<{ key: string; label: string; remove: Partial<AnalyticsQueryState> }> = [];
  if (state.groupId !== undefined) conditions.push({ key: "group", label: `负责组：${groups.find(group => group.groupId === String(state.groupId))?.name || "组名待核实"}`, remove: { groupId: undefined } });
  if (state.category && state.category !== "ALL") conditions.push({ key: "category", label: `客户类别：${({ BOUND: "已绑定", PENDING: "待分配", ANOMALY: "归属异常" })[state.category]}`, remove: { category: "ALL" } });
  if (state.firstState && state.firstState !== "ALL") conditions.push({ key: "firstState", label: `首充：${FIRST_OPTIONS.find(option => option.value === state.firstState)?.label || "状态待核实"}`, remove: { firstState: "ALL" } });
  if (state.filter && state.filter !== "ALL") conditions.push({ key: "filter", label: `服务：${FILTER_OPTIONS.find(option => option.value === state.filter)?.label || "状态待核实"}`, remove: { filter: "ALL" } });
  if (state.agentId !== undefined) conditions.push({ key: "agent", label: `当前客服：账号 ${state.agentId}`, remove: { agentId: undefined } });
  if (state.keyword) conditions.push({ key: "keyword", label: `搜索：${state.keyword}`, remove: { keyword: undefined } });
  if (state.direction !== undefined) conditions.push({ key: "direction", label: `顺序：${state.direction === "ASC" ? "从低到高 / 从早到晚" : "从高到低 / 从近到远"}`, remove: { direction: undefined } });
  return conditions;
}
export function analyticsErrorText(error: unknown): string {
  if (error instanceof AnalyticsEntryError) return error.message;
  if (error instanceof SupportClientError) {
    if (error.status === 401) return "登录已失效，请重新登录后读取。";
    if (error.status === 403) return "当前范围已无查看权限，请重新核对负责范围。";
    if (error.status === 404) return "统计入口暂不可用，请联系技术人员核对服务。";
    if (error.status === 409) return "数据或权限已变化，请从第一页重新读取。";
    if (error.status === 503) return "统计来源暂不可用，请稍后重试。";
  }
  return "统计资料暂无法核对，请重试；不会以零代替缺失数据。";
}
function dateText(value: string | null): string {
  return value === null ? "待核实" : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
function Numeric({ value, observed, label, kind = "count", onClick }: { value: string | null; observed?: string | null; label: string; kind?: "count" | "amount"; onClick?: () => void }) {
  const explanation = value === null ? observed == null ? "资料待核实" : `已观测 ${observed}，完整数值待核实` : `已核实 ${value}${observed != null && observed !== value ? `，已观测 ${observed}` : ""}`;
  const content = value === null ? "—" : compactSupportBoardValue(value, kind);
  return <span className="sa-number-wrap">{onClick ? <button type="button" className="sa-number sa-link" title={explanation} aria-label={`${label}：${explanation}；查看明细`} onClick={onClick}>{content}</button> : <span className="sa-number" tabIndex={0} title={explanation} aria-label={`${label}：${explanation}`}>{content}</span>}{value === null && <small>{observed == null ? "待核实" : `已观测 ${compactSupportBoardValue(observed, kind)}`}</small>}</span>;
}
function CountValue({ count, label, onClick }: { count: Count; label: string; onClick?: () => void }) { return <Numeric value={count.confirmed === null ? null : String(count.confirmed)} observed={count.observed === null ? null : String(count.observed)} label={label} onClick={onClick} />; }
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
  if (!data.records.length) return <p className="sa-empty">当前范围与筛选下暂无已观测记录。{data.total === null && "来源覆盖仍待核实。"}</p>;
  const name = (row: SupportAnalyticsCustomer) => row.nickname || row.customerNo || `客户 ${row.customerId}`;
  if (data.view === "AGENTS") return <div className="sa-table-scroll"><table className="sa-table"><caption className="sr-only">客服当前客户画像；金额币种 {currency}</caption><thead><tr><th>客服 / 当前组</th><th>账号 / 资格</th><th>当前绑定</th><th>窗口活跃</th><th>已首充</th><th>持有设备</th><th>客户累计充值 / {currency}</th><th>当前余额 / {currency}</th></tr></thead><tbody>{data.records.map(row => {
    const customerCount = row.funds.customerCount !== undefined ? String(row.funds.customerCount) : row.current.firstConfirmed.confirmed !== null && row.current.firstNone.confirmed !== null && row.current.firstUnknown.confirmed !== null ? (BigInt(row.current.firstConfirmed.confirmed) + BigInt(row.current.firstNone.confirmed) + BigInt(row.current.firstUnknown.confirmed)).toString() : null;
    const group = data.scopeSummary.groups.find(g => g.groupId === row.account.groupId);
    const funds = row.funds.balances?.find(f => f.currency === currency);
    const onlyAgent = (view: SupportAnalyticsView, extra: Partial<AnalyticsQueryState> = {}) => drill({ view, agentId: row.accountId, category: "BOUND", ...extra });
    return <tr key={row.accountId}><td><div className="sa-identity"><SupportAvatar name={row.displayName || "客服"} path={row.avatarRef ?? undefined} version={row.avatar?.version} /><div><button className="sa-name sa-link" type="button" title={row.displayName || "客服"} onClick={() => onlyAgent("CUSTOMERS")}>{row.displayName || "名称待核实"}</button><small>{group?.name || (row.account.groupId === null ? "待分组" : "组名待核实")}{row.account.supervisorAccount && (row.account.serviceAccount ? " · 兼主管" : " · 主管账号")}</small></div></div></td><td>{row.account.accountState === "ENABLED" ? "启用" : row.account.accountState === "DISABLED" ? "停用" : "待核实"}<small>{!row.account.serviceAccount ? "主管资格与客服资格独立" : row.account.serviceQualification === "ENABLED" ? "专属客服资格有效" : row.account.serviceQualification === "DISABLED" ? "资格暂停" : row.account.serviceQualification === "REMOVED" ? "资格已移除" : "资格待核实"}{row.account.handoverRequired && " · 待交接"}</small></td><td><Numeric value={customerCount === null ? null : String(customerCount)} label="当前绑定客户" onClick={() => onlyAgent("CUSTOMERS")} /></td><td><CountValue count={row.current.activity.active} label="窗口活跃" onClick={() => onlyAgent("ACTIVITY", { filter: "WINDOW_ACTIVE" })} /></td><td><CountValue count={row.current.firstConfirmed} label="已首充客户" onClick={() => onlyAgent("CUSTOMERS", { firstState: "CONFIRMED" })} /></td><td><CountValue count={row.current.devices.held} label="当前设备" onClick={() => onlyAgent("DEVICES", { basis: "CURRENT_ASSET" })} /></td><td><MoneyValue money={row.current.ownLifetime.find(x => x.currency === currency)?.deposits} label={`客户累计充值 ${currency}`} onClick={() => onlyAgent("FINANCE", { basis: "CURRENT_CUSTOMER_HISTORY" })} /></td><td><Numeric kind="amount" value={funds?.confirmedAmount ?? null} observed={funds?.observedAmount} label={`当前余额 ${currency}`} onClick={() => onlyAgent("CUSTOMERS")} /></td></tr>;
  })}</tbody></table></div>;
  if (data.view === "FINANCE") return <div className="sa-table-scroll"><table className="sa-table"><caption className="sr-only">授权客户资金事件，金额币种 {currency}</caption><thead><tr><th>客户 / 编码</th><th>事件类型</th><th>成功时间</th><th>观测金额 / {currency}</th><th>历史覆盖</th><th>详情</th></tr></thead><tbody>{data.records.map((row, index) => <tr key={`${row.customerId}:${row.orderNo}:${row.succeededAt}:${index}`}><td><button type="button" className="sa-name sa-link" title={row.nickname || row.customerNo || row.customerId} onClick={() => openProfile(row.customerId)}>{row.nickname || row.customerNo || `客户 ${row.customerId}`}</button><small>{row.customerNo || "编码待核实"}</small></td><td>{row.kind === "DEPOSIT" ? "充值" : row.kind === "DEVICE_PURCHASE" ? "购机" : "购机退款"}</td><td className="sa-time">{dateText(row.succeededAt)}</td><td><Numeric value={row.amount} kind="amount" label="此笔观测金额" onClick={() => openProfile(row.customerId)} /></td><td>{row.historyStatus === "READY" ? "首充历史已核实" : "首充历史待核实"}</td><td><button type="button" className="sa-link" onClick={() => openProfile(row.customerId)}>客户资金详情</button></td></tr>)}</tbody></table></div>;
  if (data.view === "DEVICES") return <div className="sa-table-scroll"><table className="sa-table"><caption className="sr-only">当前 IDC 设备存量</caption><thead><tr><th>设备 / 客户 ID</th><th>类型</th><th>算力</th><th>当前持有</th><th>连接状态</th><th>取得来源</th><th>详情</th></tr></thead><tbody>{data.records.map(row => <tr key={row.deviceId}><td>{row.deviceId}<small>客户 {row.customerId}</small></td><td>{row.deviceType === "SHARE" || row.deviceType === "CLOUD_SHARE" ? "云份额" : row.deviceType === "DEVICE" ? "实体设备" : row.deviceType === "SERVER" ? "服务器" : "类型待核实"}</td><td><Numeric value={row.hashrate} kind="amount" label="设备算力" onClick={() => openProfile(row.customerId)} /></td><td>{row.holdingStatus === "AVAILABLE" ? "已核实" : "待核实"}</td><td>{row.connectionStatus === "ONLINE" ? "在网" : row.connectionStatus === "OFFLINE" ? "离线" : row.connectionStatus === "NOT_APPLICABLE" ? "不适用" : "待核实"}</td><td>{row.acquisition === "PAID_PURCHASE" ? "付费购买" : "来源待核实"}</td><td><button type="button" className="sa-link" onClick={() => openProfile(row.customerId)}>客户设备详情</button></td></tr>)}</tbody></table></div>;
  return <div className="sa-table-scroll"><table className="sa-table"><caption className="sr-only">当前客户画像；金额币种 {currency}</caption><thead><tr><th>客户 / 当前顾问</th><th>首充状态</th><th>直属邀请</th><th>邀请后代</th><th>本人累充 / {currency}</th><th>邀请累充 / {currency}</th><th>窗口活跃 / 最近活动</th><th>服务状态</th></tr></thead><tbody>{data.records.map(row => <tr key={row.customerId}><td><div className="sa-identity"><SupportAvatar name={name(row)} path={row.avatar ?? undefined} /><div><button type="button" className="sa-name sa-link" title={name(row)} onClick={() => openProfile(row.customerId)}>{name(row)}</button><small>{row.customerNo || "编码待核实"} · {row.owner.agentName || "归属待核实"}</small></div></div></td><td><button type="button" className="sa-link" onClick={() => openProfile(row.customerId)}>{row.first.state === "CONFIRMED" ? "已首充" : row.first.state === "NONE" ? "未首充" : "历史待核实"}</button><small>{row.first.state === "CONFIRMED" && row.first.kind ? row.first.kind === "DEPOSIT" ? "首笔充值" : "首笔购机" : "终身首次付费画像"}</small></td><td><CountValue count={row.invitations.direct} label="直属邀请" onClick={() => openProfile(row.customerId)} /></td><td><CountValue count={row.invitations.descendants} label="邀请后代" onClick={() => openProfile(row.customerId)} /></td><td><MoneyValue money={row.lifetime.find(x => x.currency === currency)?.deposits} label={`本人累充 ${currency}`} onClick={() => openProfile(row.customerId)} /></td><td><MoneyValue money={row.invitations.deposits.find(x => x.currency === currency)?.deposits} label={`邀请累充 ${currency}`} onClick={() => openProfile(row.customerId)} /></td><td>{row.activity.state === "ACTIVE" ? "窗口活跃" : row.activity.state === "INACTIVE" ? "窗口未活跃" : "待核实"}<small className="sa-time">{dateText(row.activity.lastEffectiveAt)}</small></td><td>{row.task.status === "UNAVAILABLE" ? "任务资料待读取" : row.task.waitingReply === true ? "待回复" : row.task.due === true ? "待维护" : row.task.firstContact === true ? "首次待联系" : row.task.enabled === false ? "暂停主动维护" : row.task.status !== "COMPLETE" ? "待核实" : "正常跟进"}<small><button type="button" className="sa-link" onClick={() => openProfile(row.customerId)}>客户资料与记录</button></small></td></tr>)}</tbody></table></div>;
}

export function M1AnalyticsWorkbench(props: { permission: Permission; ctx: MCtx }) {
  const session = useAdminAuth(state => state.session), epoch = useAdminAuth(state => state.authEpoch);
  return <ResolvedAnalyticsWorkbench key={adminShellSessionKey(session, epoch)} {...props} />;
}
function ResolvedAnalyticsWorkbench({ permission, ctx }: { permission: Permission; ctx: MCtx }) {
  const router = useRouter();
  const [scope, setScope] = useState<SupportAnalyticsResponse | null>(null), [scopeError, setScopeError] = useState("");
  const [scopeRetry, setScopeRetry] = useState(0), [queryState, setQueryState] = useState(initialAnalyticsQuery("PERSONAL"));
  const [data, setData] = useState<SupportAnalyticsResponse | null>(null), [error, setError] = useState("");
  const [loading, setLoading] = useState(false), [retry, setRetry] = useState(0), [cancelled, setCancelled] = useState(false);
  const [operations, setOperations] = useState(false), [personalAnalytics, setPersonalAnalytics] = useState(false), [profileId, setProfileId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const controllerRef = useRef<AbortController | null>(null), generation = useRef(0);
  const isPersonal = scope?.scopeSummary.mode === "PERSONAL";
  const showStatistics = Boolean(scope && (!isPersonal || personalAnalytics) && !operations);
  useEffect(() => {
    const controller = new AbortController(); setScope(null); setScopeError(""); setData(null); setProfileId(null); setOperations(false); setPersonalAnalytics(false);
    (async () => {
      const agentId = analyticsEntryAgent(window.location.search);
      const next = await supportAnalyticsClient.query({ view: "OVERVIEW", pageSize: 1, signal: controller.signal });
      return { next, agentId };
    })().then(({ next, agentId }) => {
      if (controller.signal.aborted) return;
      setScope(next); setQueryState({ ...initialAnalyticsQuery(next.scopeSummary.mode), ...(agentId === undefined ? {} : { view: "CUSTOMERS", category: "BOUND", agentId }) });
      if (agentId !== undefined) setPersonalAnalytics(true);
      if (agentId === undefined && next.scopeSummary.mode !== "PERSONAL" && new URLSearchParams(window.location.search).get("view") === "pool") setOperations(true);
    }).catch(cause => { if (!controller.signal.aborted) setScopeError(analyticsErrorText(cause)); });
    return () => controller.abort();
  }, [scopeRetry]);
  useEffect(() => {
    if (!showStatistics) return;
    const current = ++generation.current, controller = new AbortController(); controllerRef.current = controller;
    setData(null); setProfileId(null); setError(""); setLoading(true); setCancelled(false);
    (async () => supportAnalyticsClient.query({ ...analyticsWireQuery(queryState), signal: controller.signal }))().then(next => {
      if (controller.signal.aborted || current !== generation.current) return;
      if (next.scopeSummary.mode !== scope?.scopeSummary.mode) { setScope(null); setScopeRetry(n => n + 1); return; }
      setData(next);
    }).catch(cause => {
      if (controller.signal.aborted || current !== generation.current) return;
      setData(null); setError(analyticsErrorText(cause));
      if (cause instanceof SupportClientError && [401, 403].includes(cause.status)) { setScope(null); setScopeError(analyticsErrorText(cause)); }
    }).finally(() => { if (!controller.signal.aborted && current === generation.current) setLoading(false); });
    return () => { controller.abort(); generation.current++; };
  }, [showStatistics, queryState, retry, scope?.scopeSummary.mode]);
  const change: Drill = changes => { controllerRef.current?.abort(); generation.current++; setData(null); setProfileId(null); setError(""); setQueryState(previous => changeAnalyticsQuery(previous, changes)); };
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
  const ownDeposit = scope.selectedCurrent.ownLifetime.find(x => x.currency === currency)?.deposits;
  const selectedGroup = queryState.groupId === undefined ? undefined : scope.scopeSummary.groups.find(g => g.groupId === String(queryState.groupId));
  const groups = scope.scopeSummary.groups;
  const activeConditions = activeAnalyticsConditions(queryState, groups);
  const monthOptions = analyticsMonths();
  const drill: Drill = changes => { setPersonalAnalytics(true); change(changes); };
  const current = data?.selectedCurrent, personnel = data?.scopeSummary.personnel;
  const deposits = queryState.basis === "PERIOD_EVENT" ? data?.scopeSummary.financial.currencies.find(x => x.currency === currency)?.deposits : current?.ownLifetime.find(x => x.currency === currency)?.deposits;
  const caption = queryState.basis === "PERIOD_EVENT" ? `${queryState.month}自然月期间事件 · Asia/Shanghai；当前绑定与设备仍按当前快照` : queryState.basis === "CURRENT_ASSET" ? "当前设备与活动快照；首充和累计资金未在此口径读取" : "当前客户终身画像；不代表期间新增贡献";
  return <section className="sa-workbench">
{isPersonal && <><div hidden={personalAnalytics}><div className="sa-actions"><button type="button" onClick={() => router.push("/service/leaderboard")}>查看业绩榜</button></div><M1PersonalWorkbench permission={permission} ctx={ctx} /></div>{!personalAnalytics && <section className="sa-personal-additions" aria-label="本人客户画像补充"><h3>本人客户画像</h3><div className="sa-inline-metrics"><div><span>已首充客户</span><CountValue count={scope.selectedCurrent.firstConfirmed} label="本人已首充客户" onClick={() => drill({ view: "CUSTOMERS", firstState: "CONFIRMED" })} /></div><div><span>历史待核实</span><CountValue count={scope.selectedCurrent.firstUnknown} label="首充历史待核实" onClick={() => drill({ view: "CUSTOMERS", firstState: "UNKNOWN" })} /></div><div><span>累计充值 / {currency}</span><MoneyValue money={ownDeposit} label={`本人客户累计充值 ${currency}`} onClick={() => drill({ view: "FINANCE" })} /></div><button type="button" onClick={() => drill({ view: "CUSTOMERS" })}>查看首充、邀请与充值画像</button></div><p>截至 {dateText(scope.asOf)} · 只读取当前本人客户，累计充值与购机分别统计。</p></section>}</>}
    {operations && <><button type="button" onClick={() => setOperations(false)}>返回{mode === "ALL" ? "平台数据" : "分组数据"}</button><M1PersonalWorkbench permission={permission} ctx={ctx} /></>}
    {showStatistics && <>
      <header className="sa-header"><div><h2>{isPersonal ? "本人客户画像" : mode === "ALL" ? "平台运营总览" : "我的分组数据"}</h2><p>{selectedGroup?.name || (queryState.groupId ? "组名待核实" : isPersonal ? "本人当前客户" : mode === "ALL" ? "全部获准客服范围" : "全部负责组")} · 截至 {data ? dateText(data.asOf) : "读取中"} · Asia/Shanghai</p></div><div className="sa-actions">{isPersonal ? <button type="button" onClick={() => setPersonalAnalytics(false)}>返回服务待办</button> : <><a href="/service/sessions">会话审阅</a><button type="button" onClick={() => setOperations(true)}>分配与服务</button></>}<button type="button" onClick={() => router.push("/service/leaderboard")}>查看业绩榜</button><button type="button" onClick={reloadFirstPage}>刷新数据</button></div></header>
{!isPersonal && <nav className="sa-group-tabs" aria-label="负责组范围"><button type="button" aria-pressed={queryState.groupId === undefined} onClick={() => change({ groupId: undefined })}>全部</button>{groups.map(group => <button type="button" key={group.groupId} title={group.name || "组名待核实"} aria-label={group.name || "组名待核实"} aria-pressed={String(queryState.groupId) === group.groupId} onClick={() => change({ groupId: group.groupId })}>{group.name || "组名待核实"}</button>)}</nav>}
      <nav className="sa-datasets" aria-label="数据视角">{DATASETS.filter(x => !isPersonal || !["OVERVIEW", "AGENTS"].includes(x.value)).map(item => <button type="button" key={item.value} aria-pressed={queryState.view === item.value} onClick={() => change({ view: item.value, ...(item.value === "DEVICES" ? { basis: "CURRENT_ASSET" as const } : {}) })}>{item.label}</button>)}</nav>
      <form className="sa-controls" onSubmit={event => { event.preventDefault(); change({ keyword: keyword.trim() || undefined }); }}>
        <AnalyticsSelect label="统计口径" value={queryState.basis ?? "CURRENT_CUSTOMER_HISTORY"} options={BASIS_OPTIONS.filter(x => queryState.view !== "FINANCE" || x.value !== "CURRENT_ASSET")} onChange={value => { const found = BASIS_OPTIONS.find(x => x.value === value && (queryState.view !== "FINANCE" || x.value !== "CURRENT_ASSET")); if (found) change({ basis: found.value }); }} />
        {queryState.basis === "PERIOD_EVENT" && <AnalyticsSelect label="自然月" value={queryState.month} options={monthOptions} onChange={month => change({ month })} />}
        <AnalyticsSelect label="币种" value={currency} options={[{ value: "USDT", label: "USDT" }, { value: "NEX", label: "NEX" }]} onChange={value => { if (value === "USDT" || value === "NEX") change({ currency: value }); }} />
        {queryState.view !== "OVERVIEW" && <><AnalyticsSelect label="排序" value={queryState.sortKey ?? ""} options={[{ value: "", label: "按当前筛选默认排序" }, ...SORT_OPTIONS[queryState.view].filter(x => queryState.basis !== "CURRENT_ASSET" || !["PERSONAL_DEPOSIT", "TEAM_DEPOSIT"].includes(x.value))]} onChange={value => { const found = SORT_OPTIONS[queryState.view].find(x => x.value === value); change({ sortKey: found?.value }); }} /><AnalyticsSelect label="顺序" value={queryState.direction ?? ""} options={[{ value: "", label: "默认顺序" }, { value: "DESC", label: "从高到低 / 从近到远" }, { value: "ASC", label: "从低到高 / 从早到晚" }]} onChange={value => change({ direction: value === "DESC" || value === "ASC" ? value : undefined })} /></>}
        {["CUSTOMERS", "ACTIVITY"].includes(queryState.view) && <><AnalyticsSelect label="首充状态" value={queryState.firstState ?? "ALL"} options={queryState.basis === "CURRENT_ASSET" ? [FIRST_OPTIONS[0]] : FIRST_OPTIONS} onChange={value => { const found = FIRST_OPTIONS.find(x => x.value === value); if (found) change({ firstState: found.value }); }} /><AnalyticsSelect label="服务状态" value={queryState.filter ?? "ALL"} options={FILTER_OPTIONS} onChange={value => { const found = FILTER_OPTIONS.find(x => x.value === value); if (found) change({ filter: found.value }); }} /></>}
        {queryState.view !== "OVERVIEW" && <label className="sa-search"><span className="sa-control-label">搜索客户名称或编码</span><input value={keyword} maxLength={200} onChange={event => setKeyword(event.target.value)} placeholder="客户名称或编码" /></label>}{queryState.view !== "OVERVIEW" && <button type="submit">搜索</button>}
        {(queryState.agentId !== undefined || queryState.keyword || queryState.firstState !== "ALL" || queryState.filter !== "ALL" || queryState.category !== "ALL") && <button type="button" onClick={() => { setKeyword(""); change({ agentId: undefined, keyword: undefined, firstState: "ALL", filter: "ALL", category: "ALL" }); }}>清除客服与客户筛选</button>}
      </form>
      {activeConditions.length > 0 && <div className="sa-active-conditions" role="group" aria-label="当前生效条件"><span>当前生效：</span>{activeConditions.map(condition => <button type="button" key={condition.key} title={condition.label} aria-label={`移除${condition.label}`} onClick={() => { if (condition.key === "keyword") setKeyword(""); change(condition.remove); }}><span>{condition.label}</span><span aria-hidden="true">×</span></button>)}</div>}
      <p className="sa-disclosure">{caption}{queryState.agentId !== undefined && ` · 已选客服 ID ${queryState.agentId}`} · 当前名单读取 {data?.versionState === "READY" ? "可核对" : "待核实"}。绑定与人员规模按组范围，客户画像按当前筛选；邀请金额不计入组经营金额。</p>
      {loading && <div className="sa-state" role="status">正在读取所选范围…<button type="button" onClick={() => { controllerRef.current?.abort(); generation.current++; setLoading(false); setCancelled(true); setData(null); }}>取消读取</button></div>}
      {(error || cancelled) && <div className="sa-state" role={error ? "alert" : "status"}>{error || "读取已取消，条件保持不变。"}<button type="button" onClick={reloadFirstPage}>{error.includes("第一页") ? "从第一页重新读取" : "重试读取"}</button></div>}
      {data && current && personnel && <>
        <div className={`sa-metrics ${queryState.view === "OVERVIEW" ? "sa-metrics-overview" : ""}`} aria-label="所选范围汇总">
          {!isPersonal && <div><span>专属客服</span><CountValue count={personnel.serviceAccounts} label="专属客服" onClick={() => change({ view: "AGENTS" })} /></div>}
          {mode === "ALL" && <><div><span>主管</span><CountValue count={personnel.supervisors} label="主管账号；客服列表保留兼任标识" onClick={() => change({ view: "AGENTS" })} /></div><div><span>负责组</span><CountValue count={personnel.groups} label="负责组" onClick={() => change({ view: "OVERVIEW" })} /></div></>}
          <div><span>范围绑定 · 当前</span><Numeric value={data.scopeSummary.bound === null ? null : String(data.scopeSummary.bound)} label="当前绑定客户" onClick={() => change({ view: "CUSTOMERS", category: "BOUND", firstState: "ALL", filter: "ALL" })} /></div>
          <div><span>已首充客户 · 当前</span><CountValue count={current.firstConfirmed} label="当前客户已首充" onClick={() => change({ view: "CUSTOMERS", basis: "CURRENT_CUSTOMER_HISTORY", firstState: "CONFIRMED" })} /></div>
          <div><span>持有设备 · 当前</span><CountValue count={current.devices.held} label="当前持有设备" onClick={() => change({ view: "DEVICES", basis: "CURRENT_ASSET" })} /></div>
          <div><span>窗口活跃 · 当前</span><CountValue count={current.activity.active} label="窗口活跃" onClick={() => change({ view: "ACTIVITY", filter: "WINDOW_ACTIVE" })} /></div>
          <div><span>{queryState.basis === "PERIOD_EVENT" ? "期间充值" : "客户累计充值"} / {currency}</span><MoneyValue money={deposits} label={`充值 ${currency}`} onClick={() => change({ view: "FINANCE", basis: queryState.basis === "CURRENT_ASSET" ? "CURRENT_CUSTOMER_HISTORY" : queryState.basis })} /></div>
          {queryState.basis === "PERIOD_EVENT" && <><div><span>期间首次付费</span><CountValue count={data.scopeSummary.financial.firstCandidates} label="期间首次付费；查看同范围资金事件" onClick={() => change({ view: "FINANCE" })} /></div><div><span>期间购机 / {currency}</span><MoneyValue money={data.scopeSummary.financial.currencies.find(x => x.currency === currency)?.purchases} label={`期间购机 ${currency}；查看同范围资金事件`} onClick={() => change({ view: "FINANCE" })} /></div></>}
        </div>
        {queryState.view === "FINANCE" && <section className="sa-current-funds" aria-label="当前客户资金观测"><p>当前筛选客户的余额与提现观测，不受月份筛选；提现历史环境与发生时归属仍待核实。</p><div className="sa-inline-metrics"><div><span>当前余额 / {currency}</span><Numeric kind="amount" value={data.funds.balances?.find(x => x.currency === currency)?.confirmedAmount ?? null} observed={data.funds.balances?.find(x => x.currency === currency)?.observedAmount} label={`当前余额 ${currency}`} /></div><div><span>成功提现本金 / {currency}</span><Numeric kind="amount" value={data.funds.withdrawals?.find(x => x.currency === currency)?.successPrincipal.confirmedAmount ?? null} observed={data.funds.withdrawals?.find(x => x.currency === currency)?.successPrincipal.observedAmount} label={`已观测成功提现本金 ${currency}`} /></div><div><span>成功提现实到 / {currency}</span><Numeric kind="amount" value={data.funds.withdrawals?.find(x => x.currency === currency)?.successNet.confirmedAmount ?? null} observed={data.funds.withdrawals?.find(x => x.currency === currency)?.successNet.observedAmount} label={`已观测提现实到 ${currency}`} /></div><div><span>处理中本金 / {currency}</span><Numeric kind="amount" value={data.funds.withdrawals?.find(x => x.currency === currency)?.processingPrincipal.confirmedAmount ?? null} observed={data.funds.withdrawals?.find(x => x.currency === currency)?.processingPrincipal.observedAmount} label={`已观测处理中本金 ${currency}`} /></div></div></section>}
        {queryState.view === "OVERVIEW" ? <>
          <div className="sa-coverage"><div>待分配 <Numeric value={data.scopeSummary.pending === null ? null : String(data.scopeSummary.pending)} label="待分配客户" onClick={() => change({ view: "CUSTOMERS", category: "PENDING", firstState: "ALL", filter: "ALL" })} /></div><div>归属异常 <Numeric value={data.scopeSummary.anomaly === null ? null : String(data.scopeSummary.anomaly)} label="归属异常" onClick={() => change({ view: "CUSTOMERS", category: "ANOMALY", firstState: "ALL", filter: "ALL" })} /></div><div>有效净额 / {currency} <MoneyValue money={data.scopeSummary.financial.currencies.find(x => x.currency === currency)?.net} label={`有效净额 ${currency}`} /></div></div>
          {queryState.groupId === undefined && <section className="sa-group-comparison"><h3>负责组概览</h3><p>展示 {Math.min(data.scopeSummary.groups.length, 4)} / {data.scopeSummary.groups.length} 个组；完整组范围可在上方选择。</p><div>{data.scopeSummary.groups.slice(0, 4).map(group => <div key={group.groupId}><button type="button" className="sa-name sa-link" title={group.name ?? "组名待核实"} onClick={() => change({ groupId: group.groupId, view: "AGENTS" })}>{group.name || "组名待核实"}</button><span>当前客户 <Numeric value={group.total === null ? null : String(group.total)} label="组当前客户" onClick={() => change({ groupId: group.groupId, view: "CUSTOMERS" })} /></span><span>专属客服 <CountValue count={group.personnel.serviceAccounts} label="组专属客服" onClick={() => change({ groupId: group.groupId, view: "AGENTS" })} /></span></div>)}</div></section>}
          {!data.scopeSummary.groups.length && mode === "MANAGED" && <p className="sa-empty">当前没有负责组，未回退至全平台范围。</p>}
        </> : <><AnalyticsTable data={data} currency={currency} drill={change} openProfile={setProfileId} /><footer className="sa-pager"><p>{data.total === null ? `已观测 ${data.observedTotal} 条；完整总数待核实` : `共 ${data.total} 条`} · 第 {queryState.pageNum} 页</p><div><button type="button" disabled={queryState.pageNum <= 1 || data.versionState !== "READY"} onClick={() => page(queryState.pageNum - 1)}>上一页</button><button type="button" disabled={!data.canContinue || data.versionState !== "READY"} onClick={() => page(queryState.pageNum + 1)}>下一页</button></div></footer>{data.versionState === "UNKNOWN" && <p className="sa-disclosure">来源尚未形成可核对的查询版本，暂不继续翻页。</p>}</>}
      </>}
    </>}
    {profileId && <Modal wide title="客户资料与原业务明细" onClose={() => setProfileId(null)} footer={<button type="button" onClick={() => setProfileId(null)}>返回统计列表</button>}><p className="sa-disclosure">按现有客户资料权限读取；统计可见不增加资金操作或回复权限。</p><M3CustomerProfile key={profileId} ctx={ctx} customerId={profileId} onHistory={no => router.push(`/service/sessions?conversationNo=${encodeURIComponent(no)}`)} onRetryMessages={() => void ctx.refreshConversations()} /></Modal>}
  </section>;
}
