"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Coins, Landmark, RefreshCw, User } from "lucide-react";
import {
  BlockState, Button, Cell, Decision, Drawer, FilterBar, FilterField, Fold, Input, JudgmentPoints, KeyValues, Notice, Pager, Panel, Select, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr,
} from "@/app/components/rd";
import type { StateTone } from "@/app/components/rd";
import { displayAdminReadError } from "@/lib/admin/error-messages";
import { adminAuthLifecycleEpoch } from "@/lib/admin/auth-lifecycle";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { fetchD1BankOrders, type D1BankOrder, type D1BankOrdersPage } from "@/lib/admin/d-client";
import { readPage, readParam, usdt, vnd, writeParams, zoneLabel, type D1Count } from "./d1-shared";

const ORDER_STATUS: Record<string, string> = {
  CREATING: "创建中", AWAITING_PAYMENT: "待付款", UNKNOWN: "结果未知",
  PROCESSING: "处理中", FAILED: "失败", EXPIRED: "已过期",
  CANCELLED: "已取消", CREDITED: "已入账", RETURNED: "已退回",
  RECEIPT_REVIEW: "回单待核对", MISMATCH_REVIEW: "信息不一致待核对",
  LATE_REVIEW: "逾期回单待核对", RETURN_PENDING: "退回处理中",
  MANUAL_REVIEW: "本地待人工核对",
};
/** 原有三种展示状态与本地待人工核对取并集。 */
export const BANK_REVIEW_STATUSES = ["RECEIPT_REVIEW", "MISMATCH_REVIEW", "LATE_REVIEW"] as const;
const STATUS_GROUPS = [
  { label: "待核对", statuses: [...BANK_REVIEW_STATUSES, "MANUAL_REVIEW"] },
  { label: "处理中", statuses: ["CREATING", "AWAITING_PAYMENT", "UNKNOWN", "PROCESSING", "RETURN_PENDING"] },
  { label: "已结束", statuses: ["CREDITED", "FAILED", "EXPIRED", "CANCELLED", "RETURNED"] },
] as const;
const PAGE_SIZES = [10, 20, 50, 100] as const;

export function orderStatusText(status: string) { return ORDER_STATUS[status] ?? "状态未知"; }
const orderTone = (order: D1BankOrder): StateTone => order.creditedUsdt > 0 || order.status === "CREDITED" ? "ok"
  : order.settlementStatus === "MANUAL_REVIEW" || (BANK_REVIEW_STATUSES as readonly string[]).includes(order.status) || order.status === "UNKNOWN" ? "warn"
    : ["FAILED", "EXPIRED", "CANCELLED", "RETURNED"].includes(order.status) ? "done" : "progress";
const originalOrderStatusText = (value?: string | null) => value ? ({ AWAITING_PAYMENT: "待付款", EXPIRED: "已过期", CANCELLED: "已取消", RECEIPT_REVIEW: "回单待核对", MISMATCH_REVIEW: "金额或信息不符待核对", LATE_REVIEW: "逾期到账待核对", CREDITED: "已入账", RETURNED: "已登记退回", RETURN_PENDING: "退回处理中" } as Record<string,string>)[value] ?? "原订单状态待核实" : "未提供";
const submissionStatusText = (value?: string | null) => value ? ({ PENDING: "待提交", SUBMIT_UNKNOWN: "提交结果待核实", CREATED: "付款单已创建", REJECTED: "支付商拒绝创建" } as Record<string,string>)[value] ?? "未知" : "—";
const settlementStatusText = (value?: string | null) => value ? ({ UNSETTLED: "未入账", CREDITED: "已入账", MANUAL_REVIEW: "待人工核对" } as Record<string,string>)[value] ?? "未知" : "—";
const confirmationSourceText = (value?: string | null) => value ? ({ UNCONFIRMED: "尚未确认", ADMIN_MANUAL: "管理员人工确认", BANK_RECEIPT: "银行回单核实", AUTO_PROVIDER: "支付商自动确认", UNKNOWN: "未知" } as Record<string,string>)[value] ?? "未知" : "尚未确认";
const providerStatusText = (value: unknown) => value == null ? "—" : ({ "0": "支付商：处理中", "1": "支付商：处理中", "3": "支付商：已确认付款", "4": "支付商：结果待核对", "5": "支付商：结果待核对" } as Record<string,string>)[String(value)] ?? "支付商：状态未知";
/** 不能人工入账的原因，后端代码转成中文，不露原始代码（D1 第五节）。 */
const MANUAL_BLOCK_TEXT: Record<string, string> = {
  HDPAY_ORDER_ALREADY_CREDITED: "这笔已入账，不能重复入账",
  HDPAY_MANUAL_INTENT_STATE_CONFLICT: "当前状态不能人工入账",
  HDPAY_MANUAL_PROVIDER_STATE_CONFLICT: "支付商状态不允许人工入账，请先核对",
  HDPAY_MANUAL_AMOUNT_MISMATCH: "订单金额和支付商金额不一致，不能人工入账",
  HDPAY_BANK_RECEIPT_REQUIRES_REVIEW: "这笔挂着多张或不能复用的银行回单，要先核清回单才能人工入账。这页没有回单核对入口（旧入口已下线），请联系财务负责人处理",
  HDPAY_LOCAL_SETTLEMENT_CONFLICT: "这笔已有入账记录，请先核对",
  HDPAY_ORDER_NOT_FOUND: "找不到支付商订单",
  HDPAY_SETTLEMENT_TARGET_INVALID: "这笔不是钱包充值，不能人工入账",
  MANUAL_BANK_RECEIPT_FLOW: "这笔不是银行卡支付订单",
};
export const manualBlockText = (code?: string | null) => (code && MANUAL_BLOCK_TEXT[code]) || "当前状态不能人工入账，请先核对";
const time = (value?: string | null) => formatBusinessTimeCompact(value, "—");
const credited = (order: D1BankOrder) => order.creditedUsdt > 0 || order.status === "CREDITED";

type OrderActions = {
  canManage: boolean;
  /** 刷新中或提交中：依赖最新数据的写入口禁用，原因写这里。 */
  busyReason?: string;
  /** 这一行有人工入账结果未确认。 */
  blocked: (order: D1BankOrder) => boolean;
  onManualCredit: (order: D1BankOrder, onSettled: () => void | Promise<void>) => void;
};

/** 人工确认入账为什么不能点，按顺序写第一条。 */
function creditBlock(order: D1BankOrder, actions: OrderActions) {
  if (actions.blocked(order)) return "结果未确认，请先在上方核对";
  if (actions.busyReason) return actions.busyReason;
  if (order.paymentRail !== "HDPAY") return manualBlockText("MANUAL_BANK_RECEIPT_FLOW");
  if (!order.manualCreditAllowed) return manualBlockText(order.manualCreditBlockReason);
  if (order.providerVersion === null) return "支付商订单版本没读到，请刷新";
  return undefined;
}

export function D1BankOrders({ refreshKey, onCount, allManualReviewCount, onRefreshOverview, ...actions }: OrderActions & {
  refreshKey: string;
  onCount: (count: D1Count) => void;
  allManualReviewCount: number | "failed" | undefined;
  onRefreshOverview: () => Promise<void>;
}) {
  const [status, setStatus] = useState(() => readParam("bankSettlementStatus", ["MANUAL_REVIEW"]) === "MANUAL_REVIEW" ? "MANUAL_REVIEW" : readParam("bankStatus", Object.keys(ORDER_STATUS)) ?? "");
  const [keyword, setKeyword] = useState(() => readParam("bankQ") ?? "");
  const [query, setQuery] = useState(() => readParam("bankQ") ?? "");
  const [pageNum, setPageNum] = useState(() => readPage("bankPage"));
  const [pageSize, setPageSize] = useState(() => Number(readParam("bankPageSize", PAGE_SIZES.map(String)) ?? 20));
  const [data, setData] = useState<D1BankOrdersPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reviewCounts, setReviewCounts] = useState<{ byStatus: Record<string, number>; manual: number; nonManual: number } | "failed" | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const requestId = useRef(0), countId = useRef(0);
  const load = useCallback(async () => {
    const authEpoch = adminAuthLifecycleEpoch();
    const current = ++requestId.current;
    setLoading(true); setError(""); setData(null);
    try {
      const next = await fetchD1BankOrders({ paymentRail: "HDPAY", status: status === "MANUAL_REVIEW" ? undefined : status, settlementStatus: status === "MANUAL_REVIEW" ? "MANUAL_REVIEW" : undefined, keyword: query, pageNum, pageSize }, authEpoch);
      if (authEpoch === adminAuthLifecycleEpoch() && current === requestId.current) {
        const lastPage = Math.max(1, Math.ceil(next.total / pageSize));
        if (pageNum > lastPage) setPageNum(lastPage);
        else setData(next);
      }
    } catch (failure) {
      if (authEpoch === adminAuthLifecycleEpoch() && current === requestId.current) setError(displayAdminReadError(failure));
    } finally { if (authEpoch === adminAuthLifecycleEpoch() && current === requestId.current) setLoading(false); }
  }, [status, query, pageNum, pageSize]);
  // 全量待办不受列表关键词和分页影响；三种旧状态扣掉与本地待人工的交集。
  const loadCounts = useCallback(async () => {
    const authEpoch = adminAuthLifecycleEpoch();
    const current = ++countId.current;
    setReviewCounts(null);
    try {
      const [pages, all] = await Promise.all([
        Promise.all(BANK_REVIEW_STATUSES.map(value => fetchD1BankOrders({ paymentRail: "HDPAY", status: value, pageNum: 1, pageSize: 1 }, authEpoch))),
        fetchD1BankOrders({ paymentRail: "HDPAY", pageNum: 1, pageSize: 1 }, authEpoch),
      ]);
      if (authEpoch === adminAuthLifecycleEpoch() && current === countId.current) setReviewCounts({
        byStatus: Object.fromEntries(BANK_REVIEW_STATUSES.map((value, index) => [value, pages[index].total])),
        manual: all.manualReviewCount,
        nonManual: pages.reduce((sum, page) => sum + page.total - page.manualReviewCount, 0),
      });
    } catch {
      if (authEpoch === adminAuthLifecycleEpoch() && current === countId.current) setReviewCounts("failed");
    }
  }, []);
  useEffect(() => { void load(); return () => { requestId.current++; }; }, [load, refreshKey]);
  useEffect(() => { void loadCounts(); return () => { countId.current++; }; }, [loadCounts, refreshKey]);
  useEffect(() => {
    onCount(reviewCounts === null || allManualReviewCount === undefined ? undefined
      : reviewCounts === "failed" || allManualReviewCount === "failed" ? "failed"
        : { n: allManualReviewCount + reviewCounts.nonManual });
  }, [onCount, reviewCounts, allManualReviewCount]);
  useEffect(() => { writeParams({ bankStatus: status === "MANUAL_REVIEW" ? null : status || null, bankSettlementStatus: status === "MANUAL_REVIEW" ? "MANUAL_REVIEW" : null, bankQ: query || null, bankPage: pageNum > 1 ? pageNum : null, bankPageSize: pageSize !== 20 ? pageSize : null }); }, [status, query, pageNum, pageSize]);

  const submit = () => { setPageNum(1); if (query === keyword.trim() && pageNum === 1) void load(); else setQuery(keyword.trim()); };
  const records = data?.records ?? [];
  const index = records.findIndex(order => order.intentNo === selected);
  const current = index >= 0 ? records[index] : null;
  const reviewing = reviewCounts && reviewCounts !== "failed" ? [...BANK_REVIEW_STATUSES.filter(value => reviewCounts.byStatus[value] > 0), ...(reviewCounts.manual > 0 ? ["MANUAL_REVIEW"] : [])] : [];
  const filtered = status !== "" || query !== "";
  const columns = 5;
  const zone = zoneLabel();
  return <>
    {reviewing.length > 0 && !(reviewing as readonly string[]).includes(status) && (
      <Notice tone="warn" title="有订单待核对"
        action={reviewing.map(value => <Button key={value} size="sm" onClick={() => { setStatus(value); setKeyword(""); setQuery(""); setPageNum(1); }}>只看{ORDER_STATUS[value]}</Button>)}>
        回单、金额或到账时间和订单对不上，要人核对后再人工入账；挂着多张回单的要先核清回单，这页没有入口，请联系财务负责人。
      </Notice>
    )}
    <FilterBar
      scope={<FilterField><Select aria-label="银行订单状态" value={status} onChange={value => { setStatus(value); setPageNum(1); }} options={[{ value: "", label: "全部状态" }]}
        groups={STATUS_GROUPS.map(group => ({ label: group.label, options: group.statuses.map(value => ({ value, label: ORDER_STATUS[value] })) }))} /></FilterField>}
      onSubmit={submit}
      querying={loading}
      onClear={() => { setStatus(""); setKeyword(""); setQuery(""); setPageNum(1); }}
      canClear={filtered || keyword !== ""}
      result={data && filtered ? `当前筛选 ${data.total} 张` : undefined}
    >
      <FilterField grow><Input data-search aria-label="银行订单查询：付款单、用户或附言" placeholder="付款单 / 用户 / 附言" value={keyword} onChange={event => setKeyword(event.target.value)} /></FilterField>
    </FilterBar>
    <Panel flush icon={Landmark} tone="role-2" title="银行卡支付订单"
      sub={data ? `数据时间 ${time(data.asOf)}（${zone}）` : undefined}
      explain="包含所有状态的订单。订单数不等于实际收款，实际入账看「实际入账」列。到账时间按越南时间（UTC+7）填写和核对。"
      actions={<Button size="sm" variant="ghost" icon={<RefreshCw size={14} aria-hidden />} loading={loading} onClick={() => { void load(); void loadCounts(); void onRefreshOverview(); }}>刷新</Button>}>
      <Table label="银行卡支付订单" aria-busy={loading}>
        <thead><tr>
          <Th sticky="start">付款单 · 用户</Th>
          <Th align="right" icon={Coins} tone="money">应付（₫）</Th>
          <Th align="right">实际收款（₫）</Th>
          <Th>状态</Th>
          <Th sticky="end" align="right">操作</Th>
        </tr></thead>
        <tbody>
          {loading ? <TableLoading columns={columns} rows={5} />
            : error ? <TableMessage columns={columns} role="alert">银行订单读取失败，不能当作已对平。{error} <Button size="sm" onClick={() => void load()}>重试</Button></TableMessage>
              : records.length === 0 ? <TableMessage columns={columns} role="status">{filtered ? <>没有符合条件的订单，可以换个筛选条件或用付款单号查询。 <Button size="sm" onClick={() => { setStatus(""); setKeyword(""); setQuery(""); setPageNum(1); }}>清除筛选</Button></> : "暂无银行卡支付订单。用户在 App 充值页选银行卡支付后会出现在这里。"}</TableMessage>
                : records.map(order => {
                  const done = credited(order);
                  const block = creditBlock(order, actions);
                  return <Tr key={order.intentNo} selected={order.intentNo === selected} onOpen={() => setSelected(order.intentNo)}>
                    <Td sticky="start"><Cell mono full main={order.intentNo} sub={`用户 ${order.userId}`} /></Td>
                    <Td align="right"><Cell num main={vnd(order.payableVnd)} sub={`申请 ${usdt(order.requestedUsdt)} USDT`} /></Td>
                    <Td align="right"><Cell num main={order.receivedVnd === null ? "—" : vnd(order.receivedVnd)} sub={done ? `入账 ${usdt(order.creditedUsdt)} USDT` : order.receivedVnd === null ? "还没收到" : time(order.receivedAt)} /></Td>
                    <Td><Cell main={<StatusTag tone={orderTone(order)}>{orderStatusText(order.status)}</StatusTag>} sub={actions.blocked(order) ? "有入账结果未确认" : order.settlementStatus === "MANUAL_REVIEW" ? "本地待人工核对" : providerStatusText(order.providerStatus)} /></Td>
                    <Td sticky="end" align="right"><span className="rd-row-actions">
                      {actions.canManage && !done
                        ? <Button size="sm" disabledReason={block} onClick={() => actions.onManualCredit(order, async () => { await load(); void loadCounts(); })}>人工确认入账</Button>
                        : <Button size="sm" variant="ghost" onClick={() => setSelected(order.intentNo)}>查看详情</Button>}
                    </span></Td>
                  </Tr>;
                })}
        </tbody>
      </Table>
      {data && data.total > 0 && <Pager label="银行卡支付订单" sizeLabel="银行订单" total={data.total} page={data.pageNum} pageSize={pageSize} sizes={PAGE_SIZES} loading={loading}
        onPage={setPageNum} onPageSize={size => { setPageSize(size); setPageNum(1); }} />}
    </Panel>

    <Drawer open={!!current} onClose={() => setSelected(null)} title="银行卡订单" sub={current?.intentNo} icon={Landmark} tone="role-2"
      nav={{ hasPrev: index > 0, hasNext: index >= 0 && index < records.length - 1, onPrev: () => setSelected(records[index - 1]?.intentNo ?? selected), onNext: () => setSelected(records[index + 1]?.intentNo ?? selected) }}
      footer={current && actions.canManage && !credited(current) ? <Decision note={creditBlock(current, actions)}
        explain="确认后立即入账到用户钱包，不能撤销。实际到账金额必须等于应付金额。"
        primary={<Button variant="primary" disabledReason={creditBlock(current, actions)} onClick={() => actions.onManualCredit(current, async () => { await load(); void loadCounts(); })}>人工确认入账</Button>} /> : undefined}>
      {!current ? <BlockState state="loading" title="正在读取订单…" /> : <>
        <JudgmentPoints rows={[
          { label: "应付", icon: Coins, tone: "money", value: `${vnd(current.payableVnd)} ₫`, reason: `申请 ${usdt(current.requestedUsdt)} USDT · 锁价 1 USDT = ${vnd(current.lockedFxRateVndPerUsdt)} ₫` },
          { label: "实际收款", state: current.receivedVnd !== null && current.payableVnd !== null && current.receivedVnd !== current.payableVnd ? "warn" : undefined,
            value: current.receivedVnd === null ? "还没收到" : `${vnd(current.receivedVnd)} ₫`, reason: current.receivedVnd === null ? undefined : `到账 ${time(current.receivedAt)}（${zone}）` },
          { label: "用户", icon: User, tone: "users", value: String(current.userId), reason: `附言 ${current.memoCode || "—"}` },
          { label: "状态", state: orderTone(current) === "progress" ? undefined : orderTone(current), value: orderStatusText(current.status), reason: `原订单 ${originalOrderStatusText(current.intentStatus)} · 本地 ${settlementStatusText(current.settlementStatus)}` },
          ...(credited(current) ? [{ label: "入账", state: "ok" as const, value: `${usdt(current.creditedUsdt)} USDT`, reason: confirmationSourceText(current.confirmationSource) }]
            : actions.canManage ? [] : [{ label: "人工入账", value: current.manualCreditAllowed ? "可以人工入账，需财务主管操作" : manualBlockText(current.manualCreditBlockReason) }]),
        ]} />
        <Fold inset title="支付商与确认" summary={providerStatusText(current.providerStatus)}>
          <KeyValues rows={[
            { key: "submit", label: "提交", value: submissionStatusText(current.submissionStatus) },
            { key: "provider", label: "支付商", value: providerStatusText(current.providerStatus) },
            ...(current.paymentRail === "HDPAY" && current.submissionStatus === "REJECTED" ? [{ key: "reject", label: "支付商拒绝原因", value: current.providerReason || "支付商未提供具体原因" }] : []),
            { key: "settle", label: "本地结算", value: settlementStatusText(current.settlementStatus) },
            { key: "source", label: "确认来源", value: confirmationSourceText(current.confirmationSource) },
            { key: "confirm", label: "人工确认单号", value: current.manualConfirmationNo || "—", mono: !!current.manualConfirmationNo },
          ]} />
        </Fold>
        <Fold inset title="时间与付款页" summary={`截止 ${time(current.expiresAt)}`}>
          <KeyValues rows={[
            { key: "created", label: `创建（${zone}）`, value: time(current.createdAt) },
            { key: "expires", label: `截止（${zone}）`, value: time(current.expiresAt) },
            { key: "url", label: "付款页", value: current.paymentUrl
              ? (actions.blocked(current) ? "正在核对，暂不能打开付款页" : <a className="rd-link" href={current.paymentUrl} target="_blank" rel="noopener noreferrer">打开付款页（新窗口）</a>)
              : "这笔订单没有付款链接" },
          ]} />
        </Fold>
      </>}
    </Drawer>
  </>;
}
