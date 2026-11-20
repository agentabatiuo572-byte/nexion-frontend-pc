"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Drawer, Button, BlockState, Explain, Fact, Facts, Fold, Notice, Table, Th, Tr, Td } from "@/app/components/rd";
import { nexGridBrandText, operatorNicknameText } from "@/lib/admin/brand-copy";
import { supportClient, SupportClientError, type PerformanceMetric, type SupportOverview } from "@/lib/admin/m-support-client";
import { supportAnalyticsClient, type SupportAnalyticsDetailView, type SupportAnalyticsCustomer, type SupportAnalyticsQuery, type SupportAnalyticsResponse } from "@/lib/admin/support-analytics-client";
import "./m1-statistic-details.css";

export const maintenanceLabels = { EXECUTION: "已执行维护", SUCCESSFUL_CYCLE: "成功周期", SUCCESSFUL_CUSTOMER: "成功客户", STOPPED: "暂停主动维护" } as const;
export const fundLabels = { balance: "当前余额", successPrincipal: "成功提现金额", successNet: "成功提现实到", processingPrincipal: "处理中提现金额", net: "有效净额" } as const;
export type MaintenanceChoice = { metric: keyof typeof maintenanceLabels; day?: string };
export type FundMetric = keyof typeof fundLabels;
export type StatisticSource =
  | { kind: "maintenance"; overview: SupportOverview; choice: MaintenanceChoice }
  | { kind: "fund"; origin: SupportAnalyticsResponse; query: SupportAnalyticsQuery; metric: FundMetric; detailView?: SupportAnalyticsDetailView };
/** facts 有值时代替一行「核对摘要」；tech 放进折叠的技术信息。 */
type Result = { headings: string[]; rows: string[][]; total: number | null; next: boolean; summary: string; note?: string; version?: string; facts?: readonly { k: string; v: ReactNode }[]; tech?: string };
type SuccessList = { version: string; rows: string[][]; restricted: number };
const PAGE_SIZE = 10;
const beijingTime = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai", hourCycle: "h23" });
/** TX-26 full time in Beijing time, 2026-11-05 14:30:00; callers state the zone once. */
export const beijing = (time: string) => { const parts = Object.fromEntries(beijingTime.formatToParts(new Date(time)).map(part => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`; };
const changed = () => new SupportClientError(409, undefined, "SUPPORT_STATISTIC_CHANGED");
const summaryCounts = (total: number, visible: number, restricted: number, unit: string) => "统计 " + total + unit + " · 你能看到 " + visible + unit + " · 看不到 " + restricted + unit;

async function maintenancePage(source: Extract<StatisticSource, { kind: "maintenance" }>, page: number, version: string | undefined, cache: { current: SuccessList | null }, signal: AbortSignal): Promise<Result> {
  const { overview, choice: { metric, day } } = source;
  const { scope, performance } = overview;
  if (metric === "STOPPED") {
    const current = await supportClient.snapshot({ mode: scope.mode, groupId: scope.groupId ?? undefined, agentId: scope.agentAdminId ?? undefined, filter: "STOPPED", pageNum: page, pageSize: PAGE_SIZE, signal });
    const list = current.customers;
    if (!list.available || list.filter !== "STOPPED" || list.records.some(row => row.maintenanceEnabled)) throw new Error("STOPPED_LIST_UNAVAILABLE");
    if (current.overview.scope.actorId !== scope.actorId || list.total !== current.overview.counts.stoppedMaintenanceCustomers) throw changed();
    return { headings: ["客户编号", "客户名称", "当前归属客服编号"], rows: list.records.map(row => [row.customerNo ?? row.customerId, operatorNicknameText(row.displayName ?? "") || "未登记", String(row.agentAdminId ?? "未知")]), total: list.total, next: page * PAGE_SIZE < list.total, summary: "当前暂停主动维护 " + list.total + " 人", note: "按当前归属逐页核对 · 本页核对时间（北京时间） " + beijing(current.overview.evaluatedAt) };
  }
  const byCustomer = metric === "SUCCESSFUL_CUSTOMER";
  if (!performance.scopeVersion) return { headings: [], rows: [], total: null, next: false, summary: "明细还在同步", note: "这项维护统计还在同步，暂时核对不了明细，稍后刷新工作台再看。" };
  const rawMetric: PerformanceMetric = byCustomer ? "SUCCESSFUL_CYCLE" : metric;
  const pageSize = byCustomer ? 100 : PAGE_SIZE;
  const first = await supportClient.performanceDetails(overview, rawMetric, day, { pageNum: byCustomer ? 1 : page, pageSize, expectedQueryVersion: version, signal });
  const period = (day ? "业务日 " + day + " · " : "") + "业务时区 " + first.timeZone + " · 统计区间（北京时间）" + beijing(first.windowFrom) + " 至 " + beijing(first.windowTo) + "，不含结束时刻。";
  if (byCustomer) {
    if (cache.current?.version !== first.queryVersion) {
      const customers = new Map<string, { lastAt: string; cycles: number }>();
      let part = first;
      for (;;) {
        for (const row of part.records) {
          const prior = customers.get(row.customerId);
          if (prior) prior.cycles += 1;
          else customers.set(row.customerId, { lastAt: row.eventAt, cycles: 1 });
        }
        if (part.pageNum * pageSize >= first.visibleCount) break;
        part = await supportClient.performanceDetails(overview, rawMetric, day, { pageNum: part.pageNum + 1, pageSize, expectedQueryVersion: first.queryVersion, signal });
      }
      const restricted = performance.successfulCustomerCount - customers.size;
      if (restricted < 0 || restricted > first.restrictedCount) throw changed();
      cache.current = { version: first.queryVersion, restricted, rows: Array.from(customers, ([customer, row]) => [beijing(row.lastAt), customer, String(row.cycles)]) };
    }
    const list = cache.current;
    return { headings: ["最近成功时间（北京时间）", "客户编号", "成功周期数"], rows: list.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: list.rows.length, next: page * PAGE_SIZE < list.rows.length, summary: summaryCounts(performance.successfulCustomerCount, list.rows.length, list.restricted, " 人"), note: period, version: first.queryVersion };
  }
  return { headings: ["事件时间（北京时间）", "客户编号", "原客服编号", "关联记录编号"],
    rows: first.records.map(row => [beijing(row.eventAt), row.customerId, row.agentId, (metric === "EXECUTION" ? "执行 " + row.id + " · 周期 " + row.cycleId + " · 消息 " : "周期 " + row.id + " · 成功事件 ") + (row.sourceId ?? "未知") + " · 归属 " + row.assignmentId]), total: first.visibleCount, next: page * PAGE_SIZE < first.visibleCount,
    summary: summaryCounts(first.total, first.visibleCount, first.restrictedCount, " 条"), note: period, version: first.queryVersion };
}

type Amount = { confirmed: string | null; observed: string | null };
export function fundAmount(funds: SupportAnalyticsCustomer["funds"], metric: Exclude<FundMetric, "net">, currency: string): Amount {
  // READY means the read finished, so no row for this currency is a real 0. Any other status stays unknown.
  if (metric !== "balance" && funds.withdrawalStatus === "READY" && !funds.withdrawals?.some(row => row.currency === currency)) return { confirmed: "0", observed: "0" };
  const amount = metric === "balance" ? funds.balances?.find(row => row.currency === currency) : funds.withdrawals?.find(row => row.currency === currency)?.[metric];
  return { confirmed: amount?.confirmedAmount ?? null, observed: amount?.observedAmount ?? null };
}
// Display only: thousands separators, backend-padded zeros dropped, one column shares the decimals it really needs (min 2).
function amountPlaces(values: ReadonlyArray<string | null | undefined>): number {
  return values.reduce<number>((max, value) => Math.max(max, (/^-?\d+(?:\.(\d+))?$/.exec(value ?? "")?.[1] ?? "").replace(/0+$/, "").length), 2);
}
function groupedAmount(value: string, places = 2): string {
  const parts = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!parts) return value;
  return `${parts[1]}${parts[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(parts[3] ?? "").replace(/0+$/, "").padEnd(Math.max(2, places), "0")}`;
}
function amountText(amount?: Amount, places?: number) {
  return amount?.confirmed != null ? groupedAmount(amount.confirmed, places) : amount?.observed == null ? "未知" : groupedAmount(amount.observed, places) + "（未核实完）";
}
function exactGroupSum(values: string[], total: string) {
  const digits = Math.max(...[total, ...values].map(value => (value.split(".")[1] ?? "").length));
  const units = (value: string) => {
    const [integer, decimal = ""] = value.split(".");
    return BigInt(integer + decimal.padEnd(digits, "0"));
  };
  return values.reduce((sum, value) => sum + units(value), BigInt(0)) === units(total);
}

async function fundPage(source: Extract<StatisticSource, { kind: "fund" }>, page: number, version: string | undefined, signal: AbortSignal): Promise<Result> {
  const { origin, metric, query } = source;
  const currency = query.currency ?? "USDT";
  const amountOf = (receipt: SupportAnalyticsResponse) => metric === "net" ? receipt.scopeSummary.financial.currencies.find(row => row.currency === currency)?.net : fundAmount(receipt.funds, metric, currency);
  const original = amountOf(origin);
  const summary = "统计 " + amountText(original) + " " + nexGridBrandText(currency);
  const scopeGroups = origin.scopeSummary.groups.map(group => group.groupId).sort().join(",");
  const checkSummary = (receipt: SupportAnalyticsResponse) => {
    const amount = amountOf(receipt);
    if (receipt.scopeSummary.mode !== origin.scopeSummary.mode || receipt.scopeSummary.total !== origin.scopeSummary.total || receipt.scopeSummary.groups.map(group => group.groupId).sort().join(",") !== scopeGroups || amount?.confirmed !== original?.confirmed || amount?.observed !== original?.observed || (metric !== "net" && receipt.selectedCustomerCount !== origin.selectedCustomerCount)) throw changed();
  };
  // The original projection and the customer list have independent versions. An unversioned read supports a live first page only.
  const confirmOrigin = async () => {
    const fresh = await supportAnalyticsClient.query({ ...query, pageNum: 1, expectedVersion: origin.queryVersion ?? undefined, signal });
    checkSummary(fresh);
    return fresh;
  };
  if (source.detailView || metric === "net" && query.basis === "PERIOD_EVENT") {
    const view = source.detailView ?? "NET_CONTRIBUTIONS";
    const list = await supportAnalyticsClient.details({ view, basis: "PERIOD_EVENT", from: query.from, to: query.to, groupId: query.groupId, agentId: query.agentId,
      currency: query.currency, sortKey: "SUCCEEDED_AT", direction: "DESC", pageNum: page, pageSize: PAGE_SIZE, expectedVersion: version, signal });
    const expected = view === "NET_CONTRIBUTIONS" ? origin.scopeSummary.financial.currencies.find(row => row.currency === currency)?.net
      : origin.scopeSummary.financial.firstSources.find(row => row.currency === currency)?.[view === "FIRST_DEPOSITS" ? "deposits" : "purchases"];
    const detail = list.detailSummary;
    if (expected?.confirmed == null || !exactGroupSum([detail.totalAmount!], expected.confirmed)) throw changed();
    const title = view === "NET_CONTRIBUTIONS" ? fundLabels.net : view === "FIRST_DEPOSITS" ? "充值首充" : "付费购机首充";
    const unit = nexGridBrandText(currency);
    const money = (value: string) => groupedAmount(value) + " " + unit;
    const groupName = (groupId: string | null) => groupId == null ? null : origin.scopeSummary.groups.find(row => row.groupId === groupId)?.name ?? "组编号 " + groupId;
    // 原归属是这笔钱成功那一刻算给的客服和小组，不是客户现在的归属；没有有效归属写「没有归属」。
    const owner = (row: (typeof list.records)[number]) => row.agentId == null && row.groupId == null ? "没有归属"
      : [row.agentId == null ? null : row.agentDisplayName ?? "客服 " + row.agentId, groupName(row.groupId)].filter(Boolean).join(" · ");
    const facts = [
      { k: "统计总额", v: <>{money(detail.totalAmount!)} · {detail.totalCount} 条 · {detail.customerCount} 位客户</> },
      { k: "核实情况", v: detail.status === "AVAILABLE" ? "全部已核实"
        : <>部分已核实{detail.observedAmount != null && <> · 含未核实的共 {money(detail.observedAmount)}</>}<Explain label="部分已核实是什么意思" content="有的资金记录还没核实完。统计总额只算已核实的，「含未核实的共」把还没核实的也算进去。" /></> },
      { k: "你能看到", v: <>{money(detail.visibleAmount!)} · {detail.visibleCount} 条 · {detail.visibleCustomerCount} 位客户</> },
      { k: "看不到的", v: detail.restrictedCount === 0 ? "没有"
        : <>{money(detail.restrictedAmount!)} · {detail.restrictedCount} 条 · {detail.restrictedCustomerCount} 位客户<Explain label="看不到的是什么" content="这些客户不在你的查看范围里，金额计入统计总额，不列明细。" /></> },
    ];
    return { headings: ["成功时间（北京时间）", "客户编号", "客户名称", "原归属", "金额 / " + unit],
      rows: list.records.map(row => [beijing(row.succeededAt), row.customerNo ?? row.customerId, operatorNicknameText(row.nickname ?? "") || "未登记", owner(row), groupedAmount(row.amount)]),
      total: list.total, next: list.canContinue, facts,
      summary: "统计 " + detail.totalAmount + " " + unit + " · 你能看到 " + detail.visibleAmount + " " + unit + " · 看不到 " + detail.restrictedAmount + " " + unit,
      note: view === "NET_CONTRIBUTIONS" ? "列出成功时间在这段时间里的每一笔，按成功那一刻的归属算给客服和小组；金额是原币种原值，负数是退款或提现扣回。"
        : "每位客户只有一笔" + title + "，成功时间在这段时间里的才列出，按成功那一刻的归属算给客服和小组。",
      tech: list.records.length ? "本页记录编号：" + list.records.map(row => row.id).join("、") : undefined,
      version: list.queryVersion ?? undefined };
  }
  // Net uses the entire authorized scope. Wallet and withdrawal totals use the selected current customers.
  // Without a query version there is no next page, so this one read takes everything the backend allows instead of cutting the list at PAGE_SIZE.
  const projection: SupportAnalyticsQuery = { ...query, view: "CUSTOMERS", sortKey: undefined, direction: undefined, pageNum: page, pageSize: origin.queryVersion ? PAGE_SIZE : 100, expectedVersion: version, signal };
  if (metric === "net") Object.assign(projection, { keyword: undefined, firstState: "ALL", category: "ALL", filter: "ALL" });
  const list = await supportAnalyticsClient.query(projection);
  if (list.view !== "CUSTOMERS") throw new Error("CUSTOMER_PROJECTION_UNAVAILABLE");
  await confirmOrigin();
  checkSummary(list);
  const amountFor = (row: (typeof list.records)[number]) => metric === "net" ? row.lifetime.find(item => item.currency === currency)?.net : fundAmount(row.funds, metric, currency);
  const places = amountPlaces(list.records.map(row => { const amount = amountFor(row); return amount?.confirmed ?? amount?.observed; }));
  const rows = list.records.map(row => [row.customerNo ?? row.customerId, operatorNicknameText(row.nickname ?? "") || "未登记", amountText(amountFor(row), places)]);
  const stable = Boolean(origin.queryVersion && list.queryVersion);
  return { headings: ["客户编号", "客户名称", fundLabels[metric] + " / " + nexGridBrandText(currency)], rows, total: stable ? list.total : null, next: stable && list.canContinue, summary, note: (metric === "net" ? "按原范围当前客户的累计净额核对。" : "按原筛选的当前客户逐人核对，不受月份筛选。未知表示缺少可核实金额。") + (stable ? "" : " 这次只列出 " + rows.length + " 位客户；统计还在同步，暂时不能翻页。"), version: stable ? list.queryVersion ?? undefined : undefined };
}

export function M1StatisticDetails({ source, onClose, onInvalid }: { source: StatisticSource; onClose: () => void; onInvalid: (status: number) => void }) {
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [result, setResult] = useState<Result | null>(null), [error, setError] = useState<"" | "read" | "unreconciled" | "historyIncomplete">("");
  const version = useRef<string | undefined>(undefined), successList = useRef<SuccessList | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null); setError("");
    const task = source.kind === "maintenance" ? maintenancePage(source, page, version.current, successList, controller.signal) : fundPage(source, page, version.current, controller.signal);
    void task.then(next => { if (!controller.signal.aborted) { version.current = next.version; setResult(next); } }).catch(cause => {
      if (controller.signal.aborted) return;
      if (cause instanceof SupportClientError && [401, 403, 404, 409].includes(cause.status)) {
        if (cause.status === 409) { version.current = undefined; successList.current = null; setPage(1); }
        onInvalid(cause.status);
      }
      else setError(cause instanceof SupportClientError && cause.backendMessage === "SUPPORT_ANALYTICS_DETAIL_MISMATCH" ? "unreconciled"
        : cause instanceof SupportClientError && cause.backendMessage === "SUPPORT_ANALYTICS_HISTORY_INCOMPLETE" ? "historyIncomplete" : "read");
    });
    return () => controller.abort();
  }, [source, page, retry, onInvalid]);
  const title = source.kind === "maintenance" ? maintenanceLabels[source.choice.metric] : source.detailView === "FIRST_DEPOSITS" ? "充值首充" : source.detailView === "FIRST_PURCHASES" ? "付费购机首充" : fundLabels[source.metric];
  const cutoff = source.kind === "maintenance" ? source.overview.evaluatedAt : source.origin.asOf;
  const move = (next: number) => { setResult(null); setPage(next); };
  const group = source.kind === "fund" && source.query.groupId != null ? source.origin.scopeSummary.groups.find(row => row.groupId === String(source.query.groupId)) : null;
  return <Drawer open title={title + "明细"} sub={"统计截至 " + beijing(cutoff) + "（北京时间）"} onClose={onClose} wide footer={<div className="m1-stat-footer"><Button type="button" onClick={onClose}>返回工作台</Button>{result && result.total !== null && <div className="m1-stat-pager"><Button type="button" disabled={page === 1} onClick={() => move(page - 1)}>上一页</Button><span>第 {page} 页</span><Button type="button" disabled={!result.next} onClick={() => move(page + 1)}>下一页</Button></div>}</div>}>
    <section className="m1-stat-detail" data-kind={source.kind} aria-label={title + "核对"}>
      {source.kind === "fund" && <p className="rd-note">{source.query.groupId != null ? group?.name ?? "组编号 " + source.query.groupId : "当前获准范围"}{source.query.agentId != null && " · 客服编号 " + source.query.agentId} · {nexGridBrandText(source.query.currency ?? "USDT")}{source.metric === "net" && source.query.from && source.query.to && " · 统计区间（北京时间）" + beijing(source.query.from) + " 至 " + beijing(source.query.to) + "，不含结束时刻。"}</p>}
      {!result && !error && <BlockState state="loading" title="正在读取明细…" />}
      {error === "read" && <BlockState state="error" title="明细读取失败，请重试。" onRetry={() => setRetry(n => n + 1)} retryLabel="重试" />}
      {error === "historyIncomplete" && <Notice tone="progress" title="业绩历史还在同步" action={<Button size="sm" onClick={() => setRetry(n => n + 1)}>重新读取</Button>}>同步完再看明细，不用处理。</Notice>}
      {error === "unreconciled" && <Notice tone="warn" title="明细和已确认的金额或笔数对不上，先不显示" action={<Button size="sm" onClick={() => setRetry(n => n + 1)}>重新读取</Button>}>一直这样请联系技术同事。</Notice>}
      {result && <><Facts>{result.facts ? result.facts.map(row => <Fact key={row.k} k={row.k}>{row.v}</Fact>) : <Fact k="核对摘要">{result.summary}</Fact>}</Facts><Fold title="统计口径" summary={result.version ? "和工作台是同一份统计" : "只能看这一页"}><p>{result.note}</p></Fold>{result.headings.length > 0 && <div className="m1-stat-table"><Table label={title + "明细"}><thead><Tr>{result.headings.map(header => <Th key={header} scope="col">{header}</Th>)}</Tr></thead><tbody>{result.rows.map((row, index) => <Tr key={index}>{row.map((cell, i) => <Td key={i}>{i === 3 && source.kind === "maintenance" ? <Fold inset title="关联记录" summary="查看完整编号"><span data-mono>{cell}</span></Fold> : <span title={cell} tabIndex={0}>{cell}</span>}</Td>)}</Tr>)}</tbody></Table></div>}{!result.rows.length && result.total !== null && <BlockState state="empty" title="没有你能看到的记录" />}{result.tech && <Fold title="技术信息" summary="记录编号"><p data-mono>{result.tech}</p></Fold>}</>}
    </section>
  </Drawer>;
}
