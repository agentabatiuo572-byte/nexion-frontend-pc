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

function orderStatusText(status: string) { return ORDER_STATUS[status] ?? status; }
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

function D1BankOrderRow({ order, blocked, onSettled, ...actions }: OrderActions & {
  order: D1BankOrder; blocked: boolean; onSettled: () => void | Promise<void>;
}) {
  const credited = order.creditedUsdt > 0 || order.status === "CREDITED";
  const manualOrder = order.paymentRail === "MANUAL";
  const registerAllowed = manualOrder && !credited && order.manualRegistrationAllowed;
  const tone = credited ? "ok" : ["FAILED", "REJECTED", "EXPIRED", "CANCELLED"].includes(order.status) ? "bad" : "warn";
  return <tr>
    <td><span className="bdg dim">{manualOrder ? "人工银行转账 · VietQR" : "HDPay"}</span></td>
    <td className="mono">{order.intentNo}<div className="sub">用户 {order.userId}</div><div className="sub mono">{order.memoCode || "—"}</div></td>
    <td className="num mono">{orderUsdt(order.requestedUsdt)}<div className="sub">应付 {orderVnd(order.payableVnd)} · 锁价 {orderVnd(order.lockedFxRateVndPerUsdt)}/USDT</div></td>
    <td className="num mono">{orderVnd(order.receivedVnd)}<div className="sub">{order.receivedVnd === null ? "—" : orderTime(order.receivedAt)}</div></td>
    <td className="num mono">{credited ? orderUsdt(order.creditedUsdt) : "—"}<div className="sub">{credited ? (order.confirmationSource === "ADMIN_MANUAL" ? "人工确认入账" : "已入账") : "尚未入账"}</div></td>
    <td><span className={`bdg ${tone}`}>{orderStatusText(order.status)}</span><div className="sub mono">原订单 {order.intentStatus || "—"}</div></td>
    <td className="mono"><div>提交 {order.submissionStatus || "—"}</div><div className="sub">支付 {order.providerStatus || "—"} · 本地 {order.settlementStatus || "—"}</div>
      {order.paymentRail === "HDPAY" && order.submissionStatus === "REJECTED" && <div className="sub" style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>支付商拒绝原因：{order.providerReason || "支付商未提供具体原因"}</div>}
      <div className="sub">确认来源 {order.confirmationSource || "尚未确认"}</div><div className="sub mono">{order.manualConfirmationNo}</div></td>
    <td className="mono"><div>{orderTime(order.createdAt)}</div><div className="sub">截止 {orderTime(order.expiresAt)}</div></td>
    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
      {order.paymentUrl && (actions.busy || blocked ? <span className="bdg dim">正在核对结果，暂不打开付款渠道</span> : <a className="l-btn sm" href={order.paymentUrl} target="_blank" rel="noopener noreferrer">打开付款渠道</a>)}
      {actions.canManage && registerAllowed && <button className="l-btn sm mc" style={{ marginLeft: 6 }}
        disabled={actions.busy || !actions.canRegisterReceipt} onClick={() => actions.onRegister(order)}>登记这笔回单</button>}
      {actions.canManage && !manualOrder && !credited && <button className="l-btn sm mc" style={{ marginLeft: 6 }}
        disabled={actions.busy || blocked || !order.manualCreditAllowed}
        onClick={() => actions.onManualCredit(order, onSettled)}>人工确认入账</button>}
      {blocked && <div className="sub">结果未知，请先核对并使用下方原请求号</div>}
      {!manualOrder && !credited && !blocked && !order.manualCreditAllowed && <div className="sub">{order.manualCreditBlockReason || "当前状态不可人工入账，请先核对"}</div>}
      {!manualOrder && !credited && !order.paymentUrl && <div className="sub">此单当前无可用付款链接</div>}
      {registerAllowed && actions.canManage && !actions.canRegisterReceipt && <div className="sub">收款账户尚未加载，请先刷新核对</div>}
      {credited && <span className="bdg dim">已入账 · 不可重复确认</span>}
    </td>
  </tr>;
}

export function D1BankOrders({ refreshKey, onRetry, ...actions }: OrderActions & {
  refreshKey: string; onRetry: (commandKey: string) => Promise<void>;
}) {
  const [rail, setRail] = useState("");
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
      if (authEpoch === adminAuthLifecycleEpoch() && current === requestId.current) setError(failure instanceof Error ? displayAdminError(failure) : "银行订单读取失败");
    } finally { if (authEpoch === adminAuthLifecycleEpoch() && current === requestId.current) setLoading(false); }
  }, [rail, status, query, pageNum, pageSize]);
  useEffect(() => { void load(); return () => { requestId.current++; }; }, [load, refreshKey]);
  const disabled = actions.busy || loading || retrying;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const retry = async (commandKey: string) => {
    const authEpoch = adminAuthLifecycleEpoch();
    setRetrying(true); setWriteError("");
    try { await onRetry(commandKey); }
    catch (failure) { if (authEpoch === adminAuthLifecycleEpoch()) setWriteError(failure instanceof Error ? displayAdminError(failure) : "原请求号重试结果尚未确认"); }
    finally { if (authEpoch === adminAuthLifecycleEpoch()) { setRetrying(false); await load(); } }
  };
  return <>
    <div className="l-h"><span className="ttl">全部银行转账订单</span><span className="sub">· MANUAL / HDPay · 每张付款单只展示一次</span></div>
    <div className="l-b" style={{ paddingBottom: 8 }}>
      <div className="dtint">包含待付款、创建中、结果未知、失败、过期、取消和已入账订单。订单数量不代表实收或入账；人工确认与支付商自动确认分别留痕，不能重复入账。登记、匹配、核销、退回仍在下方银行回单处置。</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
        <label>转账类型 <select aria-label="银行订单转账类型" value={rail} disabled={disabled} onChange={event => { setRail(event.target.value); setPageNum(1); }}><option value="">全部类型</option><option value="MANUAL">人工银行转账</option><option value="HDPAY">HDPay</option></select></label>
        <label>订单状态 <select aria-label="银行订单状态" value={status} disabled={disabled} onChange={event => { setStatus(event.target.value); setPageNum(1); }}><option value="">全部状态</option>{Object.entries(ORDER_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <input aria-label="银行订单查询：付款单、用户或附言" placeholder="付款单 / 用户 / 附言" value={keyword} disabled={disabled} onChange={event => setKeyword(event.target.value)} />
        <button className="l-btn sm" disabled={disabled} onClick={() => { setPageNum(1); if (query === keyword.trim() && pageNum === 1) void load(); else setQuery(keyword.trim()); }}>查询</button>
        <button className="l-btn sm" disabled={disabled} onClick={() => void load()}>刷新订单</button>
      </div>
      {(error || writeError) && <div className="dtint warn" role="alert" style={{ marginTop: 12 }}>银行订单读取或操作结果未确认；不能按空数据判断已对平 · {error || writeError}</div>}
      {pending.length > 0 && <div className="dtint warn" style={{ marginTop: 12 }}>以下人工确认请求可能已经生效；请先刷新核对，仅用原请求号恢复，不要重新填写另一笔入账请求。
        {pending.map(command => <div key={command.commandKey} className="p-row"><div className="txt"><div className="mono">{command.commandKey}</div><div className="sub">{command.path}</div></div>{actions.canManage && <button className="l-btn sm" disabled={disabled} onClick={() => void retry(command.commandKey)}>核对后按原请求号重试</button>}</div>)}
      </div>}
    </div>
    <div style={{ overflowX: "auto" }}><table className="l-tbl" style={{ minWidth: 1250 }}>
      <thead><tr><th>类型</th><th>付款单 / 用户 / 附言</th><th className="num">申请 / 应付</th><th className="num">实际收款 / 到账时间</th><th className="num">实际入账</th><th>订单状态</th><th>支付商 / 确认来源</th><th>创建 / 截止时间</th><th style={{ textAlign: "right" }}>操作</th></tr></thead>
      <tbody>{data?.records.map(order => <D1BankOrderRow key={order.intentNo} order={order} {...actions} busy={disabled}
        blocked={pending.some(command => command.path === `/vietqr/orders/${order.intentNo}/manual-credit`)} onSettled={load} />)}
        {!data && <tr><td colSpan={9} style={{ padding: 24, textAlign: "center" }}>{loading ? "银行订单加载中…" : "银行订单暂时无法读取，请刷新重试；当前数量未知"}</td></tr>}
        {data?.records.length === 0 && <tr><td colSpan={9} style={{ padding: 24, textAlign: "center" }}>当前筛选没有银行转账订单；可切回全部类型、全部状态，或用付款单号查询。没有订单不代表已对平。</td></tr>}
      </tbody></table></div>
    <div className="l-b" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
      <span className="sub">{data ? `共 ${data.total} 张付款单 · 第 ${data.pageNum} / ${pages} 页 · 数据时间 ${orderTime(data.asOf)}` : "订单数量尚未确认"}</span>
      <div style={{ display: "flex", gap: 8 }}><select aria-label="银行订单每页数量" value={pageSize} disabled={disabled} onChange={event => { setPageSize(Number(event.target.value)); setPageNum(1); }}>{[10, 20, 50, 100].map(value => <option key={value} value={value}>{value} 条/页</option>)}</select>
        <button className="l-btn sm" disabled={disabled || pageNum <= 1 || !data} onClick={() => setPageNum(value => value - 1)}>上一页</button>
        <button className="l-btn sm" disabled={disabled || pageNum >= pages || !data} onClick={() => setPageNum(value => value + 1)}>下一页</button></div>
    </div>
  </>;
}
