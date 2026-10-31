"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { displayAdminError } from "@/lib/admin/error-messages";
import { adminAuthLifecycleEpoch } from "@/lib/admin/auth-lifecycle";
import { fetchD1BankOrders, listD1PendingBankOrderCommands,
  type D1BankOrder, type D1BankOrdersPage, type D1PendingTopupCommand } from "@/lib/admin/d-client";

const ORDER_STATUS: Record<string, string> = {
  CREATING: "创建中", AWAITING_PAYMENT: "待付款", UNKNOWN: "结果未知",
  PROCESSING: "处理中", FAILED: "失败", EXPIRED: "已过期",
  CANCELLED: "已取消", CREDITED: "已入账", RETURNED: "已退回",
  RECEIPT_REVIEW: "回单待核对", MISMATCH_REVIEW: "信息不一致待核对",
  LATE_REVIEW: "逾期回单待核对", RETURN_PENDING: "退回处理中",
};

export function orderStatusText(status: string) { return ORDER_STATUS[status] ?? "状态未知"; }
const originalOrderStatusText = (value?: string | null) => value ? ({ AWAITING_PAYMENT: "待付款", EXPIRED: "已过期", CANCELLED: "已取消", RECEIPT_REVIEW: "回单待核对", MISMATCH_REVIEW: "金额或信息不符待核对", LATE_REVIEW: "逾期到账待核对", CREDITED: "已入账", RETURNED: "已登记退回", RETURN_PENDING: "退回处理中" } as Record<string,string>)[value] ?? "原订单状态待核实" : "未提供";
const submissionStatusText = (value?: string | null) => value ? ({ PENDING: "待提交", SUBMIT_UNKNOWN: "提交结果待核实", CREATED: "付款单已创建", REJECTED: "支付商拒绝创建" } as Record<string,string>)[value] ?? "未知" : "—";
const settlementStatusText = (value?: string | null) => value ? ({ UNSETTLED: "未入账", CREDITED: "已入账", MANUAL_REVIEW: "待人工核对" } as Record<string,string>)[value] ?? "未知" : "—";
const confirmationSourceText = (value?: string | null) => value ? ({ UNCONFIRMED: "尚未确认", ADMIN_MANUAL: "管理员人工确认", BANK_RECEIPT: "银行回单核实", AUTO_PROVIDER: "支付商自动确认", UNKNOWN: "未知" } as Record<string,string>)[value] ?? "未知" : "尚未确认";
const providerStatusText = (value: unknown) => value == null ? "—" : ({ "0": "支付处理中", "1": "支付处理中", "3": "支付商已确认付款", "4": "支付商结果待核对", "5": "支付商结果待核对" } as Record<string,string>)[String(value)] ?? "未知";
function orderVnd(value: number | null) { return value === null ? "—" : `${value.toLocaleString("en-US")} VND`; }
function orderUsdt(value: number) { return `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDT`; }
function orderTime(value: string) { return value ? value.replace("T", " ").slice(0, 19) : "—"; }

type OrderActions = {
  canManage: boolean;
  busy: boolean;
  canRegisterReceipt: boolean;
  onRegister: (order: D1BankOrder) => void;
  onManualCredit: (order: D1BankOrder, onSettled: () => void | Promise<void>) => void;
};

function D1BankOrderRow({ order, blocked, onSettled, showRail, ...actions }: OrderActions & {
  order: D1BankOrder; blocked: boolean; onSettled: () => void | Promise<void>; showRail: boolean;
}) {
  const credited = order.creditedUsdt > 0 || order.status === "CREDITED";
  const manualOrder = order.paymentRail === "MANUAL";
  const registerAllowed = manualOrder && !credited && order.manualRegistrationAllowed;
  const tone = credited ? "ok" : ["FAILED", "REJECTED", "EXPIRED", "CANCELLED"].includes(order.status) ? "bad" : "warn";
  return <tr>
    {showRail && <td><span className="bdg dim">{manualOrder ? "银行转账（VietQR）" : "银行卡支付"}</span></td>}
    <td className="mono">{order.intentNo}<div className="sub">用户 {order.userId}</div><div className="sub mono">{order.memoCode || "—"}</div></td>
    <td className="num mono">{orderUsdt(order.requestedUsdt)}<div className="sub">应付 {orderVnd(order.payableVnd)} · 锁价 {orderVnd(order.lockedFxRateVndPerUsdt)}/USDT</div></td>
    <td className="num mono">{orderVnd(order.receivedVnd)}<div className="sub">{order.receivedVnd === null ? "—" : orderTime(order.receivedAt)}</div></td>
    <td className="num mono">{credited ? orderUsdt(order.creditedUsdt) : "—"}<div className="sub">{credited ? (order.confirmationSource === "ADMIN_MANUAL" ? "人工确认入账" : "已入账") : "尚未入账"}</div></td>
    <td><span className={`bdg ${tone}`}>{orderStatusText(order.status)}</span><div className="sub mono">原订单 {originalOrderStatusText(order.intentStatus)}</div></td>
    <td className="mono"><div>提交 {submissionStatusText(order.submissionStatus)}</div><div className="sub">支付 {providerStatusText(order.providerStatus)} · 本地 {settlementStatusText(order.settlementStatus)}</div>
      {order.paymentRail === "HDPAY" && order.submissionStatus === "REJECTED" && <div className="sub" style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>支付商拒绝原因：{order.providerReason || "支付商未提供具体原因"}</div>}
      <div className="sub">确认来源 {confirmationSourceText(order.confirmationSource)}</div><div className="sub mono">{order.manualConfirmationNo}</div></td>
    <td className="mono"><div>{orderTime(order.createdAt)}</div><div className="sub">截止 {orderTime(order.expiresAt)}</div></td>
    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
      {order.paymentUrl && (actions.busy || blocked ? <span className="bdg dim">正在核对，暂不能打开付款页</span> : <a className="l-btn sm" href={order.paymentUrl} target="_blank" rel="noopener noreferrer">打开付款页</a>)}
      {actions.canManage && registerAllowed && <button className="l-btn sm mc" style={{ marginLeft: 6 }}
        disabled={actions.busy || !actions.canRegisterReceipt} onClick={() => actions.onRegister(order)}>登记这笔回单</button>}
      {actions.canManage && !manualOrder && !credited && <button className="l-btn sm mc" style={{ marginLeft: 6 }}
        disabled={actions.busy || blocked || !order.manualCreditAllowed}
        onClick={() => actions.onManualCredit(order, onSettled)}>人工确认入账</button>}
      {blocked && <div className="sub">结果未确认，请先在下方核对</div>}
      {!manualOrder && !credited && !blocked && !order.manualCreditAllowed && <div className="sub">{order.manualCreditBlockReason || "当前状态不能人工入账，请先核对"}</div>}
      {!manualOrder && !credited && !order.paymentUrl && <div className="sub">这笔订单没有付款链接</div>}
      {registerAllowed && actions.canManage && !actions.canRegisterReceipt && <div className="sub">收款账户还没加载，请先刷新</div>}
      {credited && <span className="bdg dim">已入账</span>}
    </td>
  </tr>;
}

export function D1BankOrders({ refreshKey, onRetry, hdpayOnly = false, ...actions }: OrderActions & {
  refreshKey: string; onRetry: (commandKey: string) => Promise<void>;
  /** 人工银行转账隐藏时只列 HDPay 充值单，去掉转账类型筛选和类型列。 */
  hdpayOnly?: boolean;
}) {
  const [rail, setRail] = useState(hdpayOnly ? "HDPAY" : "");
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<D1BankOrdersPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [writeError, setWriteError] = useState("");
  const [pending, setPending] = useState<D1PendingTopupCommand[]>([]);
  const [retrying, setRetrying] = useState(false);
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const authEpoch = adminAuthLifecycleEpoch();
    const current = ++requestId.current;
    setLoading(true); setError(""); setData(null);
    setPending(listD1PendingBankOrderCommands());
    try {
      const next = await fetchD1BankOrders({ paymentRail: rail, status, keyword: query, pageNum, pageSize }, authEpoch);
      if (authEpoch === adminAuthLifecycleEpoch() && current === requestId.current) {
        const lastPage = Math.max(1, Math.ceil(next.total / pageSize));
        if (pageNum > lastPage) setPageNum(lastPage);
        else setData(next);
      }
    } catch (failure) {
      if (authEpoch === adminAuthLifecycleEpoch() && current === requestId.current) setError(failure instanceof Error ? displayAdminError(failure) : "银行订单加载失败");
    } finally { if (authEpoch === adminAuthLifecycleEpoch() && current === requestId.current) setLoading(false); }
  }, [rail, status, query, pageNum, pageSize]);
  useEffect(() => { void load(); return () => { requestId.current++; }; }, [load, refreshKey]);
  const disabled = actions.busy || loading || retrying;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const retry = async (commandKey: string) => {
    const authEpoch = adminAuthLifecycleEpoch();
    setRetrying(true); setWriteError("");
    try { await onRetry(commandKey); }
    catch (failure) { if (authEpoch === adminAuthLifecycleEpoch()) setWriteError(failure instanceof Error ? displayAdminError(failure) : "重试结果尚未确认"); }
    finally { if (authEpoch === adminAuthLifecycleEpoch()) { setRetrying(false); await load(); } }
  };
  return <>
    <div className="l-h">{hdpayOnly ? <span className="ttl">银行卡支付订单</span> : <><span className="ttl">全部银行转账订单</span><span className="sub">· 人工转账和银行卡支付</span></>}</div>
    <div className="l-b" style={{ paddingBottom: 8 }}>
      <div className="dtint">{hdpayOnly ? "包含所有状态的订单。订单数不等于实际收款，实际入账看「实际入账」列。" : "包含所有状态的订单。订单数不等于实际收款；登记回单、匹配、核销和退回在下方「银行回单处理与已入账记录」操作。"}</div>
      <div className="ui-form-grid" style={{ marginTop: 12 }}>
        {!hdpayOnly && <label>转账类型 <select className="ui-control" aria-label="银行订单转账类型" value={rail} disabled={disabled} onChange={event => { setRail(event.target.value); setPageNum(1); }}><option value="">全部类型</option><option value="MANUAL">银行转账（VietQR）</option><option value="HDPAY">银行卡支付</option></select></label>}
        <label>订单状态 <select className="ui-control" aria-label="银行订单状态" value={status} disabled={disabled} onChange={event => { setStatus(event.target.value); setPageNum(1); }}><option value="">全部状态</option>{Object.entries(ORDER_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>付款单、用户或附言<input className="ui-control" aria-label="银行订单查询：付款单、用户或附言" placeholder="付款单 / 用户 / 附言" value={keyword} disabled={disabled} onChange={event => setKeyword(event.target.value)} /></label>
        <button className="l-btn sm" disabled={disabled} onClick={() => { setPageNum(1); if (query === keyword.trim() && pageNum === 1) void load(); else setQuery(keyword.trim()); }}>查询</button>
        <button className="l-btn sm" disabled={disabled} onClick={() => void load()}>刷新订单</button>
      </div>
      {(error || writeError) && <div className="dtint warn" role="alert" style={{ marginTop: 12 }}>银行订单加载失败或操作结果未确认，不能当作已对平 · {error || writeError}</div>}
      {pending.length > 0 && <div className="dtint warn" style={{ marginTop: 12 }}>以下人工入账结果暂未确认，可能已经生效。请先刷新核对；确实没成功再点「再提交一次」，不要重新提交新的入账。
        {pending.map(command => <div key={command.commandKey} className="p-row"><div className="txt"><div className="mono">{command.commandKey}</div><div className="sub">{command.path}</div></div>{actions.canManage && <button className="l-btn sm" disabled={disabled} onClick={() => void retry(command.commandKey)}>核对后再提交一次（不会重复执行）</button>}</div>)}
      </div>}
    </div>
    <div style={{ overflowX: "auto" }}><table className="l-tbl" style={{ minWidth: 1250 }}>
      <thead><tr>{!hdpayOnly && <th>类型</th>}<th>付款单 / 用户 / 附言</th><th className="num">申请 / 应付</th><th className="num">实际收款 / 到账时间</th><th className="num">实际入账</th><th>订单状态</th><th>支付商 / 确认来源</th><th>创建 / 截止时间</th><th style={{ textAlign: "right" }}>操作</th></tr></thead>
      <tbody>{data?.records.map(order => <D1BankOrderRow key={order.intentNo} order={order} {...actions} busy={disabled}
        blocked={pending.some(command => command.path === `/vietqr/orders/${order.intentNo}/manual-credit`)} onSettled={load} showRail={!hdpayOnly} />)}
        {!data && <tr><td colSpan={hdpayOnly ? 8 : 9} style={{ padding: 24, textAlign: "center" }}>{loading ? "银行订单加载中…" : "银行订单加载失败，请刷新重试"}</td></tr>}
        {data?.records.length === 0 && <tr><td colSpan={hdpayOnly ? 8 : 9} style={{ padding: 24, textAlign: "center" }}>没有符合条件的订单，可以换个筛选条件或用付款单号查询。</td></tr>}
      </tbody></table></div>
    <div className="l-b" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
      <span className="sub">{data ? `共 ${data.total} 张付款单 · 第 ${data.pageNum} / ${pages} 页 · 数据时间 ${orderTime(data.asOf)}` : "—"}</span>
      <div style={{ display: "flex", gap: 8 }}><select className="ui-control" aria-label="银行订单每页数量" value={pageSize} disabled={disabled} onChange={event => { setPageSize(Number(event.target.value)); setPageNum(1); }}>{[10, 20, 50, 100].map(value => <option key={value} value={value}>{value} 条/页</option>)}</select>
        <button className="l-btn sm" disabled={disabled || pageNum <= 1 || !data} onClick={() => setPageNum(value => value - 1)}>上一页</button>
        <button className="l-btn sm" disabled={disabled || pageNum >= pages || !data} onClick={() => setPageNum(value => value + 1)}>下一页</button></div>
    </div>
  </>;
}
