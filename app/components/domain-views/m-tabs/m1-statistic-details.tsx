"use client";

import { useEffect, useRef, useState } from "react";
import { Drawer, Button, BlockState, Fact, Facts, Fold, Table, Th, Tr, Td } from "@/app/components/rd";
import { nexGridBrandText, operatorNicknameText } from "@/lib/admin/brand-copy";
import { supportClient, SupportClientError, type PerformanceMetric, type SupportOverview } from "@/lib/admin/m-support-client";
import { supportAnalyticsClient, type SupportAnalyticsCustomer, type SupportAnalyticsQuery, type SupportAnalyticsResponse } from "@/lib/admin/support-analytics-client";
import "./m1-statistic-details.css";

export const maintenanceLabels = { EXECUTION: "已执行维护", SUCCESSFUL_CYCLE: "成功周期", SUCCESSFUL_CUSTOMER: "成功客户", STOPPED: "暂停主动维护" } as const;
export const fundLabels = { balance: "当前余额", successPrincipal: "成功提现金额", successNet: "成功提现实到", processingPrincipal: "处理中提现金额", net: "有效净额" } as const;
export type MaintenanceChoice = { metric: keyof typeof maintenanceLabels; day?: string };
export type FundMetric = keyof typeof fundLabels;
export type StatisticSource =
  | { kind: "maintenance"; overview: SupportOverview; choice: MaintenanceChoice }
  | { kind: "fund"; origin: SupportAnalyticsResponse; query: SupportAnalyticsQuery; metric: FundMetric };
type Result = { headings: string[]; rows: string[][]; total: number | null; next: boolean; summary: string; note?: string; version?: string };
type SuccessList = { version: string; rows: string[][]; restricted: number };
const PAGE_SIZE = 10;
const beijingTime = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Shanghai", hourCycle: "h23" });
export const beijing = (time: string) => beijingTime.format(new Date(time));
const changed = () => new SupportClientError(409, undefined, "SUPPORT_STATISTIC_CHANGED");
const summaryCounts = (total: number, visible: number, restricted: number, unit: string) => "原统计 " + total + unit + " · 可见 " + visible + unit + " · 受限 " + restricted + unit;

async function maintenancePage(source: Extract<StatisticSource, { kind: "maintenance" }>, page: number, version: string | undefined, cache: { current: SuccessList | null }, signal: AbortSignal): Promise<Result> {
  const { overview, choice: { metric, day } } = source;
  const { scope, performance } = overview;
  if (metric === "STOPPED") {
    const current = await supportClient.snapshot({ mode: scope.mode, groupId: scope.groupId ?? undefined, agentId: scope.agentAdminId ?? undefined, filter: "STOPPED", pageNum: page, pageSize: PAGE_SIZE, signal });
    const list = current.customers;
    if (!list.available || list.filter !== "STOPPED" || list.records.some(row => row.maintenanceEnabled)) throw new Error("STOPPED_LIST_UNAVAILABLE");
    if (current.overview.scope.actorId !== scope.actorId || list.total !== overview.counts.stoppedMaintenanceCustomers || list.total !== current.overview.counts.stoppedMaintenanceCustomers) throw changed();
    return { headings: ["客户编号", "客户名称", "当前归属客服编号"], rows: list.records.map(row => [row.customerNo ?? row.customerId, operatorNicknameText(row.displayName ?? "") || "未登记", String(row.agentAdminId ?? "未知")]), total: list.total, next: page * PAGE_SIZE < list.total, summary: "当前暂停主动维护 " + list.total + " 人", note: "按当前归属逐页核对 · 本页核对时间（北京时间） " + beijing(current.overview.evaluatedAt) };
  }
  const byCustomer = metric === "SUCCESSFUL_CUSTOMER";
  if (!performance.scopeVersion) return { headings: [], rows: [], total: null, next: false, summary: "明细版本待同步", note: "原工作台未返回范围版本，暂时无法核对这项维护统计。" };
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
function amountText(amount?: Amount) {
  return amount?.confirmed ?? (amount?.observed == null ? "未知" : amount.observed + "（已观测）");
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
  const summary = "原统计 " + amountText(original) + " " + nexGridBrandText(currency);
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
  if (metric === "net" && query.basis === "PERIOD_EVENT") {
    const fresh = await confirmOrigin();
    const groups = fresh.scopeSummary.groups.filter(group => query.groupId === undefined || String(query.groupId) === group.groupId);
    const amounts = groups.map(group => group.period.currencies.find(row => row.currency === currency)?.net);
    const known = amounts.flatMap(row => row?.confirmed == null ? [] : [row.confirmed]);
    const matches = original?.confirmed != null && known.length === groups.length && exactGroupSum(known, original.confirmed);
    const rows = groups.map((group, i) => [group.name ?? "组名未知", group.groupId, amountText(amounts[i])]);
    return { headings: ["负责组", "组编号", "期间净额 / " + nexGridBrandText(currency)], rows: origin.queryVersion ? rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : rows, total: origin.queryVersion ? groups.length : null, next: Boolean(origin.queryVersion) && page * PAGE_SIZE < groups.length, summary, note: (matches ? "已返回的分组净额之和与原统计一致。" : "已返回的分组数据无法完整核对原统计。") + " 期间按发生时归属统计，本页保留组级期间净额投影，不展开新的逐客户或逐笔净额投影。" + (origin.queryVersion ? "" : " 当前显示本次核权回执中的 " + rows.length + " 组。") };
  }
  // Net uses the entire authorized scope. Wallet and withdrawal totals use the selected current customers.
  // Without a query version there is no next page, so this one read takes everything the backend allows instead of cutting the list at PAGE_SIZE.
  const projection: SupportAnalyticsQuery = { ...query, view: "CUSTOMERS", sortKey: undefined, direction: undefined, pageNum: page, pageSize: origin.queryVersion ? PAGE_SIZE : 100, expectedVersion: version, signal };
  if (metric === "net") Object.assign(projection, { keyword: undefined, firstState: "ALL", category: "ALL", filter: "ALL" });
  const list = await supportAnalyticsClient.query(projection);
  if (list.view !== "CUSTOMERS") throw new Error("CUSTOMER_PROJECTION_UNAVAILABLE");
  await confirmOrigin();
  checkSummary(list);
  const rows = list.records.map(row => {
    const amount = metric === "net" ? row.lifetime.find(item => item.currency === currency)?.net : fundAmount(row.funds, metric, currency);
    return [row.customerNo ?? row.customerId, operatorNicknameText(row.nickname ?? "") || "未登记", amountText(amount)];
  });
  const stable = Boolean(origin.queryVersion && list.queryVersion);
  return { headings: ["客户编号", "客户名称", fundLabels[metric] + " / " + nexGridBrandText(currency)], rows, total: stable ? list.total : null, next: stable && list.canContinue, summary, note: (metric === "net" ? "按原范围当前客户的累计净额核对。" : "按原筛选的当前客户逐人核对，不受月份筛选。未知表示缺少可核实金额。") + (stable ? "" : " 当前显示本次核权返回的 " + rows.length + " 名客户。暂无查询版本，暂不能翻页。"), version: stable ? list.queryVersion ?? undefined : undefined };
}

export function M1StatisticDetails({ source, onClose, onInvalid }: { source: StatisticSource; onClose: () => void; onInvalid: (status: number) => void }) {
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [result, setResult] = useState<Result | null>(null), [error, setError] = useState(false);
  const version = useRef<string | undefined>(undefined), successList = useRef<SuccessList | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null); setError(false);
    const task = source.kind === "maintenance" ? maintenancePage(source, page, version.current, successList, controller.signal) : fundPage(source, page, version.current, controller.signal);
    void task.then(next => { if (!controller.signal.aborted) { version.current = next.version; setResult(next); } }).catch(cause => {
      if (controller.signal.aborted) return;
      if (cause instanceof SupportClientError && [401, 403, 404, 409].includes(cause.status)) onInvalid(cause.status);
      else setError(true);
    });
    return () => controller.abort();
  }, [source, page, retry, onInvalid]);
  const title = source.kind === "maintenance" ? maintenanceLabels[source.choice.metric] : fundLabels[source.metric];
  const cutoff = source.kind === "maintenance" ? source.overview.evaluatedAt : source.origin.asOf;
  const unit = source.kind === "fund" && source.metric === "net" && source.query.basis === "PERIOD_EVENT" ? "组" : "条";
  const move = (next: number) => { setResult(null); setPage(next); };
  const group = source.kind === "fund" && source.query.groupId != null ? source.origin.scopeSummary.groups.find(row => row.groupId === String(source.query.groupId)) : null;
  return <Drawer open title={title + "明细"} sub={"原统计截止（北京时间） " + beijing(cutoff)} onClose={onClose} wide footer={<div className="m1-stat-footer"><Button type="button" onClick={onClose}>返回工作台</Button>{result && result.total !== null && <div className="m1-stat-pager"><Button type="button" disabled={page === 1} onClick={() => move(page - 1)}>上一页</Button><span>第 {page} 页</span><Button type="button" disabled={!result.next} onClick={() => move(page + 1)}>下一页</Button></div>}</div>}>
    <section className="m1-stat-detail" data-kind={source.kind} aria-label={title + "核对"}>
      {source.kind === "fund" && <p>{source.query.groupId != null ? group?.name ?? "组编号 " + source.query.groupId : "当前获准范围"}{source.query.agentId != null && " · 客服编号 " + source.query.agentId} · {nexGridBrandText(source.query.currency ?? "USDT")}{source.metric === "net" && source.query.from && source.query.to && " · 统计区间（北京时间）" + beijing(source.query.from) + " 至 " + beijing(source.query.to) + "，不含结束时刻。"}</p>}
      {!result && !error && <p role="status">正在读取明细…</p>}
      {error && <p role="alert">明细读取失败，请重试。 <Button type="button" onClick={() => setRetry(n => n + 1)}>重试</Button></p>}
      {result && <><Facts><Fact k="核对摘要">{result.summary}</Fact></Facts><Fold title="统计口径" summary={result.version ? "已核对同版统计" : "无稳定查询版本"}><p>{result.note}</p></Fold>{result.headings.length > 0 && <div className="m1-stat-table"><Table label={title + "明细"}><thead><Tr>{result.headings.map(header => <Th key={header} scope="col">{header}</Th>)}</Tr></thead><tbody>{result.rows.map((row, index) => <Tr key={index}>{row.map((cell, i) => <Td key={i}>{i === 3 && source.kind === "maintenance" ? <Fold inset title="关联记录" summary="查看完整编号"><span data-mono>{cell}</span></Fold> : <span title={cell} tabIndex={0}>{cell}</span>}</Td>)}</Tr>)}</tbody></Table></div>}{!result.rows.length && result.total !== null && <p>当前可见列表为 0 {unit}。</p>}</>}
    </section>
  </Drawer>;
}
