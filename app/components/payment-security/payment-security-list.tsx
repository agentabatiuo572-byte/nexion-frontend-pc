"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { BlockState, Button, Cell, Conclusion, FilterBar, FilterField, IconButton, Input, Panel, Pager, Select, Table, TableLoading, TableMessage, Td, Th, Tr } from "@/app/components/rd";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { businessZoneText, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { fetchPaymentSecurityRecords, paymentSecurityPorts } from "@/lib/admin/payment-password-client";
import type { PaymentSecurityPage, PaymentSecurityRecord } from "@/lib/admin/payment-password-contract";
import { PaymentSecurityDetail, PaymentSecurityState } from "./payment-security-card";

const initial = { keyword: "", state: "ACTIVE", from: "", to: "" };
export function PaymentSecurityList() {
  const epoch = useAdminAuth(state => state.authEpoch), role = useAdminAuth(state => state.session?.role);
  const [draft, setDraft] = useState(initial), [query, setQuery] = useState(initial), [pageNum, setPage] = useState(1), [pageSize, setSize] = useState(10);
  const [data, setData] = useState<PaymentSecurityPage | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [filterError, setFilterError] = useState("");
  const [selected, setSelected] = useState<PaymentSecurityRecord | null>(null);
  const generation = useRef(0), selectedPort = useMemo(() => selected ? paymentSecurityPorts.global(selected.userId) : null, [selected?.userId]);
  const scoped = role === "support";
  const load = useCallback(async () => {
    if (scoped) { setLoading(false); setData(null); return; }
    const id = ++generation.current; setLoading(true); setError(""); setData(null);
    try { const next = await fetchPaymentSecurityRecords({ ...query, state: query.state === "ALL" ? "" : query.state, pageNum, pageSize }); if (id === generation.current) setData(next); }
    catch (failure) { if (id === generation.current) setError(failure instanceof Error ? failure.message : "支付异常列表未确认，请重试。"); }
    finally { if (id === generation.current) setLoading(false); }
  }, [query, pageNum, pageSize, epoch, scoped]);
  useEffect(() => { void load(); const refresh = () => { void load(); }; window.addEventListener("nexion-payment-security-updated", refresh); return () => { generation.current++; window.removeEventListener("nexion-payment-security-updated", refresh); }; }, [load]);
  const changed = JSON.stringify(draft) !== JSON.stringify(query);
  const invalidDates = !!filterError && !!draft.from && !!draft.to && draft.from > draft.to;
  return <div className="c5-payment-records" aria-label="支付密码异常列表">
    <Conclusion state={error || scoped ? "warn" : "neutral"} icon={ShieldAlert}>{scoped ? "无权读取全域支付异常，请按客户范围查看" : loading ? "正在查询支付密码异常" : error ? "支付密码异常尚未确认" : query.state === "ACTIVE" && !query.keyword && !query.from && !query.to ? `当前异常 ${data?.total ?? "—"} 条` : `符合已提交条件的异常 ${data?.total ?? "—"} 条`}</Conclusion>
    {scoped ? <BlockState state="denied" title="无权读取全域支付异常" detail="选择服务范围内的客户，查看该用户的支付安全。" /> : <Panel title="支付密码异常列表" sub={`按发生时间倒序 · ${businessZoneText()}`} icon={ShieldAlert} flush actions={<IconButton aria-label="重新加载列表" disabled={loading} onClick={() => void load()}><RefreshCw size={16} /></IconButton>}>
      <FilterBar onSubmit={() => { if (draft.from && draft.to && draft.from > draft.to) { setFilterError("起始日期不能晚于结束日期，条件未应用。"); return; } setFilterError(""); setQuery({ ...draft }); setPage(1); }} querying={loading} onClear={() => { setDraft(initial); setQuery({ ...initial }); setPage(1); setFilterError(""); }} canClear={JSON.stringify(draft) !== JSON.stringify(initial) || JSON.stringify(query) !== JSON.stringify(initial)} notice={filterError || undefined} result={changed ? "条件未应用" : data ? `共 ${data.total} 条` : undefined} moreCount={Number(!!query.from) + Number(!!query.to)} more={<FilterField label="发生日期" wide><span className="rd-filter-range"><Input aria-label="发生日期起" aria-invalid={invalidDates || undefined} type="date" value={draft.from} onChange={event => { setFilterError(""); setDraft({ ...draft, from: event.target.value }); }} /><span>–</span><Input aria-label="发生日期止" aria-invalid={invalidDates || undefined} type="date" value={draft.to} onChange={event => { setFilterError(""); setDraft({ ...draft, to: event.target.value }); }} /></span></FilterField>}>
        <FilterField grow><Input aria-label="搜索支付异常用户" value={draft.keyword} maxLength={100} placeholder="用户编码、昵称或手机号" onChange={event => setDraft({ ...draft, keyword: event.target.value })} /></FilterField><FilterField><Select aria-label="异常状态" value={draft.state} onChange={value => setDraft({ ...draft, state: value })} options={[{ value: "ACTIVE", label: "当前异常" }, { value: "ALL", label: "全部状态" }, { value: "RELEASED", label: "已手动解除" }, { value: "EXPIRED", label: "自然到期" }]} /></FilterField>
      </FilterBar>
      {error && <BlockState state="error" compact title="异常列表未能读取" detail={error} onRetry={() => void load()} retryLabel="重试查询" />}
      <Table aria-label="支付密码异常记录" label="支付密码异常记录" className="c5-payment-table"><thead><tr><Th>用户</Th><Th>状态</Th><Th>异常原因</Th><Th>发生时间</Th><Th sticky="end">操作</Th></tr></thead><tbody>{loading ? <TableLoading columns={5} /> : data?.records.map(row => <Tr key={row.id} selected={selected?.id === row.id} onOpen={() => setSelected(row)}><Td><Cell main={row.userLabel} title={row.userLabel} /></Td><Td><PaymentSecurityState record={row} /></Td><Td><Cell main={row.reason} title={row.reason} /></Td><Td><Cell num main={formatBusinessTimeCompact(row.startedAt)} /></Td><Td sticky="end"><Button size="sm" onClick={() => setSelected(row)}>查看详情</Button></Td></Tr>)}{!loading && !data?.records.length && <TableMessage columns={5}>{error ? "记录尚未确认，请重新加载" : "没有匹配的支付密码异常记录，可调整筛选"}</TableMessage>}</tbody></Table>
      {data && data.total > 0 && <Pager label="支付密码异常记录" total={data.total} page={data.pageNum} pageSize={data.pageSize} sizes={[10, 20, 50]} loading={loading} onPage={setPage} onPageSize={size => { setSize(size); setPage(1); }} />}
    </Panel>}
    {selected && selectedPort && <PaymentSecurityDetail key={`${selectedPort.key}:${selected.id}:${epoch}`} port={selectedPort} recordId={selected.id} userLabel={selected.userLabel} recoveryActions onClose={() => setSelected(null)} />}
  </div>;
}
