"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { businessZoneText, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { fetchPaymentSecurityRecords, paymentSecurityPorts } from "@/lib/admin/payment-password-client";
import type { PaymentSecurityPage, PaymentSecurityRecord } from "@/lib/admin/payment-password-contract";
import { DataListPager } from "../domain-views/design-kit";
import { PaymentSecurityDetail, PaymentSecurityState } from "./payment-security-card";

const initial = { keyword: "", state: "ACTIVE", from: "", to: "" };
export function PaymentSecurityList() {
  const epoch = useAdminAuth(state => state.authEpoch);
  const [draft, setDraft] = useState(initial), [query, setQuery] = useState(initial), [pageNum, setPage] = useState(1), [pageSize, setSize] = useState(10);
  const [data, setData] = useState<PaymentSecurityPage | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [selected, setSelected] = useState<PaymentSecurityRecord | null>(null);
  const generation = useRef(0);
  const selectedPort = useMemo(() => selected ? paymentSecurityPorts.global(selected.userId) : null, [selected?.userId]);
  const load = useCallback(async () => {
    const id = ++generation.current; setLoading(true); setError(""); setData(null);
    try { const next = await fetchPaymentSecurityRecords({ ...query, pageNum, pageSize }); if (id === generation.current) setData(next); }
    catch (failure) { if (id === generation.current) setError(failure instanceof Error ? failure.message : "支付异常列表未确认，请重试。"); }
    finally { if (id === generation.current) setLoading(false); }
  }, [query, pageNum, pageSize, epoch]);
  useEffect(() => { void load(); const refresh = () => { void load(); }; window.addEventListener("nexion-payment-security-updated", refresh); return () => { generation.current++; window.removeEventListener("nexion-payment-security-updated", refresh); }; }, [load]);
  return <section className="payment-security" aria-label="支付密码异常列表">
    <header className="ps-header"><div><h3>支付密码异常列表</h3><p className="ps-secondary">仅查询支付密码异常，登录密码的规则和记录分别管理。</p></div><button className="ps-button" disabled={loading} onClick={() => void load()}>重新加载列表</button></header>
    <form className="ps-list-filters" onSubmit={event => { event.preventDefault(); if (draft.from && draft.to && draft.from > draft.to) { setError("起始日期不能晚于结束日期。"); return; } setQuery({ ...draft }); setPage(1); }}>
      <label className="ps-field">搜索用户<input value={draft.keyword} placeholder="用户编号、昵称或手机号" onChange={event => setDraft({ ...draft, keyword: event.target.value })} /></label>
      <label className="ps-field">异常状态<select aria-label="异常状态" value={draft.state} onChange={event => setDraft({ ...draft, state: event.target.value })}><option value="ACTIVE">当前异常</option><option value="ALL">全部状态</option><option value="RELEASED">已手动解除</option><option value="EXPIRED">自然到期</option></select></label>
      <label className="ps-field">发生日期起<input type="date" value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })} /></label>
      <label className="ps-field">发生日期止<input type="date" value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })} /></label>
      <div className="ps-actions"><button className="ps-button ps-primary" disabled={loading}>{loading ? "查询中…" : "查询"}</button><button className="ps-button" type="button" disabled={loading} onClick={() => { setDraft(initial); setQuery({ ...initial }); setPage(1); }}>重置</button></div>
    </form>
    <p className="ps-secondary">按发生时间倒序 · {businessZoneText()} · 解除后记录继续保留</p>
    {error && <p className="ps-reason" role="alert">{error} <button className="ps-link" onClick={() => void load()}>重试查询</button></p>}
    {loading ? <div className="ps-skeleton" role="status" aria-label="正在查询支付密码异常"><span /><span /><span /></div> : <div className="ps-table-scroll"><table className="ps-table ps-record-table" aria-label="支付密码异常记录"><thead><tr><th>用户</th><th>状态</th><th className="ps-list-reason">异常原因</th><th>发生时间</th><th>原锁定至</th><th>操作</th></tr></thead><tbody>
      {data?.records.map(row => <tr key={row.id}><td><span className="ps-user">{row.userLabel}</span><br /><span className="ps-secondary ps-user">{row.userId}</span></td><td><PaymentSecurityState record={row} /></td><td className={`ps-list-reason ${row.state === "ACTIVE" ? "ps-reason" : "ps-history"}`}>{row.reason}</td><td>{formatBusinessTimeCompact(row.startedAt)}</td><td>{formatBusinessTimeCompact(row.lockedUntil, "暂无记录")}</td><td><button className="ps-link" onClick={() => setSelected(row)}>查看详情</button></td></tr>)}
      {!data?.records.length && <tr><td colSpan={6}>{error ? "记录尚未确认，请重新加载。" : "没有匹配的支付密码异常记录，可调整筛选重新查询。"}</td></tr>}
    </tbody></table></div>}
    {data && <DataListPager label="支付密码异常记录" page={data.pageNum} pageSize={data.pageSize} total={data.total} onPageChange={next => { if (!loading) setPage(next); }} onPageSizeChange={next => { if (!loading) { setSize(next); setPage(1); } }} pageSizeOptions={[10, 20, 50]} />}
    {selected && selectedPort && <PaymentSecurityDetail key={`${selectedPort.key}:${selected.id}:${epoch}`} port={selectedPort} recordId={selected.id} userLabel={selected.userLabel} onClose={() => setSelected(null)} />}
  </section>;
}
