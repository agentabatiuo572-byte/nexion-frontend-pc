"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { formatBusinessTime } from "@/lib/admin/business-time";
import { pendingPaymentRelease, queryPaymentRelease, submitPaymentRelease, PaymentPasswordApiError, type PaymentSecurityPort } from "@/lib/admin/payment-password-client";
import type { PaymentSecurityRecord, PaymentSecurityDetail as Detail, PaymentSecuritySummary, PaymentReleaseReceipt } from "@/lib/admin/payment-password-contract";
import { Modal, DataListPager } from "../domain-views/design-kit";
import "./payment-security.css";

const message = (failure: unknown) => failure instanceof Error ? failure.message : "支付安全信息未确认，请重新加载。";
const time = (value: string | null) => formatBusinessTime(value, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }, "暂无记录");
export const paymentSecurityStateText = { ACTIVE: "暂时锁定", RELEASED: "已手动解除", EXPIRED: "自然到期", UNKNOWN: "状态未确认" };
export function PaymentSecurityState({ record }: { record: PaymentSecurityRecord }) {
  if (record.type === "UNSUPPORTED") return <span className="ps-state ps-history">异常类型未确认</span>;
  return <span className={`ps-state ps-${record.state === "ACTIVE" ? "locked" : record.state === "RELEASED" ? "released" : "history"}`}>{record.state === "ACTIVE" && record.type === "PAYMENT_PASSWORD_EXCEPTION" ? "待核查" : paymentSecurityStateText[record.state]}</span>;
}
const actionText = (record: PaymentSecurityRecord) => record.type === "PAYMENT_PASSWORD_EXCEPTION" ? "解除异常标记" : "解除锁定";
function Facts({ record }: { record: PaymentSecurityRecord }) {
  return <dl className="ps-facts"><div><dt>异常原因</dt><dd className={record.state === "ACTIVE" ? "ps-reason" : "ps-history"}>{record.reason}</dd></div><div><dt>原锁定至</dt><dd>{time(record.lockedUntil)}</dd></div></dl>;
}

/** Existing customer/profile surfaces inject their own scoped port; never fall back to global access. */
export function PaymentSecurityCard({ port, userLabel, compact = false }: { port: PaymentSecurityPort; userLabel: string; compact?: boolean }) {
  const session = useAdminAuth(state => state.session), epoch = useAdminAuth(state => state.authEpoch);
  const [summary, setSummary] = useState<PaymentSecuritySummary | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ id: string; release: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const generation = useRef(0);
  const owner = session?.adminId ?? 0;
  const load = useCallback(async () => {
    const id = ++generation.current; setSummary(null); setError(""); setLoading(true); setPending(!!pendingPaymentRelease(owner, port.userId));
    try { const next = await port.summary(); if (id === generation.current) setSummary(next); }
    catch (failure) { if (id === generation.current) setError(message(failure)); }
    finally { if (id === generation.current) setLoading(false); }
  }, [port, owner, epoch]);
  useEffect(() => { if (owner) void load(); const refresh = () => { void load(); }; window.addEventListener("nexion-payment-security-updated", refresh); return () => { generation.current++; window.removeEventListener("nexion-payment-security-updated", refresh); }; }, [load, owner]);
  if (!session) return null;
  const record = summary?.record;
  return <section className={`payment-security ps-card ${compact ? "ps-compact" : ""}`} aria-label="支付安全">
    <header className="ps-header"><h3 className="ps-payment">支付安全</h3>{record && <PaymentSecurityState record={record} />}</header>
    <p className="ps-description">支付密码仅用于钱包余额付款。HDPay 银行直付和 USDT-BSC 链上直付无需支付密码，不受此锁定影响。</p>
    {loading && <div className="ps-skeleton" role="status" aria-label="正在读取支付安全信息"><span /><span /></div>}
    {error && <p className="ps-reason" role="alert">{error}</p>}
    {record && <><Facts record={record} /><p className="ps-description">仅处理本条支付密码异常，登录状态不受影响。</p><div className="ps-actions"><button className="ps-button" onClick={() => setSelected({ id: record.id, release: false })}>查看详情</button>{record.state === "ACTIVE" && <button className="ps-button ps-primary" disabled={!record.capabilities.releaseAllowed || pending} onClick={() => setSelected({ id: record.id, release: true })}>{actionText(record)}</button>}</div>{record.state === "ACTIVE" && !record.capabilities.releaseAllowed && <p className="ps-secondary">{record.capabilities.disabledReason}</p>}</>}
    {summary && !record && <p>当前没有支付密码异常。历史处置记录仍保留。</p>}
    {pending && <p className="ps-secondary">有一笔解除结果等待确认。<button className="ps-link" onClick={() => { const row = pendingPaymentRelease(owner, port.userId); if (row) setSelected({ id: row.recordId, release: false }); }}>查询原操作</button></p>}
    <div className="ps-card-footer"><span className="ps-secondary">{summary ? `查询时间：${time(summary.observedAt)}` : "信息尚未确认"}</span><button className="ps-link" disabled={loading} onClick={() => void load()}>{loading ? "读取中…" : error ? "重试查询" : "重新加载"}</button></div>
    {selected && <PaymentSecurityDetail key={`${port.key}:${owner}:${epoch}:${selected.id}`} port={port} recordId={selected.id} userLabel={userLabel} initialAction={selected.release} onClose={() => setSelected(null)} />}
  </section>;
}

export function PaymentSecurityDetail({ port, recordId, userLabel, initialAction = false, onClose }: { port: PaymentSecurityPort; recordId: string; userLabel: string; initialAction?: boolean; onClose: () => void }) {
  const session = useAdminAuth(state => state.session), epoch = useAdminAuth(state => state.authEpoch), owner = session?.adminId ?? 0;
  const [detail, setDetail] = useState<Detail | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [reviewing, setReviewing] = useState(false), [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("info"), [receipt, setReceipt] = useState<PaymentReleaseReceipt | null>(null);
  const [pending, setPending] = useState(() => pendingPaymentRelease(owner, port.userId));
  const generation = useRef(0), live = useRef(true), mutation = useRef(false), started = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    const id = ++generation.current; setLoading(true); setError(""); setDetail(null);
    try {
      const next = await port.detail(recordId);
      if (live.current && id === generation.current) { setDetail(next); if (!started.current) { setReviewing(initialAction && next.record.capabilities.releaseAllowed && !pendingPaymentRelease(owner, port.userId)); started.current = true; } }
    } catch (failure) { if (live.current && id === generation.current) setError(message(failure)); }
    finally { if (live.current && id === generation.current) setLoading(false); }
  }, [port, recordId, initialAction, owner, epoch]);
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; generation.current++; }; }, [load]);
  useEffect(() => {
    if (!busy && document.activeElement === document.body) contentRef.current?.closest<HTMLElement>('[role="dialog"]')?.focus();
  }, [busy, reviewing, pending]);
  const record = detail?.record;
  const canRelease = !!record?.capabilities.releaseAllowed && !pending && owner > 0;
  async function execute(queryOnly: boolean) {
    if (mutation.current || !queryOnly && (!record || !canRelease || reason.trim().length < 8 || reason.trim().length > 200 || !confirmed)) return;
    mutation.current = true; setBusy(true); setError("");
    try {
      const next = queryOnly ? await queryPaymentRelease(owner, port) : await submitPaymentRelease(owner, port, record!, reason.trim());
      if (!live.current) return;
      setReceipt(next); setReviewing(false);
      if (next.status === "APPLIED" || next.status === "REJECTED") { await load(); setConfirmed(false); }
    } catch (failure) {
      if (!live.current) return;
      if (failure instanceof PaymentPasswordApiError && [401, 403, 404].includes(failure.status)) { setReviewing(false); setDetail(null); }
      if (failure instanceof PaymentPasswordApiError && failure.status === 409 && !failure.unknownOutcome) { setReviewing(false); await load(); setError("异常信息已变化，请核对最新状态后再操作。"); }
      else setError(message(failure));
    } finally { mutation.current = false; if (live.current) { setBusy(false); const next = pendingPaymentRelease(owner, port.userId); setPending(next); if (next) setReviewing(false); } }
  }
  async function attemptPage(next: number) {
    if (!detail || loading) return; const id = ++generation.current; setLoading(true); setError("");
    try { const attempts = await port.attempts(recordId, next, 10); if (live.current && id === generation.current) setDetail({ ...detail, attempts }); }
    catch (failure) { if (live.current && id === generation.current) setError(message(failure)); }
    finally { if (live.current && id === generation.current) setLoading(false); }
  }
  if (!session) return null;
  return <div className="payment-security"><Modal title={reviewing && record ? `解除支付密码${record.type === "PAYMENT_PASSWORD_EXCEPTION" ? "异常标记" : "锁定"}` : "支付密码异常详情"} onClose={onClose} busy={busy} wide footer={<><button className="ps-button" disabled={busy} onClick={() => reviewing ? setReviewing(false) : onClose()}>{reviewing ? "返回详情" : "关闭"}</button>{reviewing ? <button className="ps-button ps-primary" disabled={busy || !canRelease || reason.trim().length < 8 || reason.trim().length > 200 || !confirmed} onClick={() => void execute(false)}>{busy ? "正在提交…" : "确认解除"}</button> : record?.state === "ACTIVE" && <button className="ps-button ps-primary" disabled={busy || loading || !canRelease} onClick={() => { setReviewing(true); setConfirmed(false); }}>{actionText(record)}</button>}</>}>
    <div ref={contentRef} className="ps-modal-content">
      {loading && <div className="ps-skeleton" role="status" aria-label="正在读取异常详情"><span /><span /><span /></div>}
      {error && <p className="ps-reason" role="alert">{error} {!busy && <button className="ps-link" onClick={() => void load()}>重新加载详情</button>}</p>}
      {pending && <div className="ps-pending" role="status"><p>解除结果暂未确认，请查询原操作，不能重复提交。</p><button className="ps-button" disabled={busy || pending.portKey !== port.key} onClick={() => void execute(true)}>{busy ? "正在查询…" : "查询本次结果"}</button>{pending.portKey !== port.key && <p className="ps-secondary">请回原操作入口查询。</p>}</div>}
      {receipt?.status === "APPLIED" && <p role="status"><strong className="ps-released">解除已确认，审计记录已核对</strong><br /><span className="ps-secondary">{receipt.auditId} · {receipt.changedBy} · {time(receipt.changedAt)}</span></p>}
      {receipt?.status === "REJECTED" && <p className="ps-reason" role="status">本次解除未执行，请核对最新状态。</p>}
      {(receipt?.status === "PENDING" || receipt?.status === "NOT_FOUND") && <p className="ps-secondary">处理结果尚未确认，请继续查询本次操作。</p>}
      {record && <>
        <dl className="ps-facts"><div><dt>操作对象</dt><dd className="ps-user">{userLabel} · {port.userId}</dd></div><div><dt>当前状态</dt><dd><PaymentSecurityState record={record} /></dd></div><div><dt>{reviewing ? "本次解除范围" : "凭证类型"}</dt><dd>{reviewing ? "仅本条" : ""}<span className="ps-payment">支付密码</span>{reviewing ? record.type === "PAYMENT_PASSWORD_EXCEPTION" ? "异常标记" : "锁定" : ""}</dd></div><div><dt>原锁定至</dt><dd>{time(record.lockedUntil)}</dd></div></dl>
        {reviewing ? <><p className="ps-description">{record.capabilities.effectDescription} 仅影响钱包余额付款的支付密码验证；HDPay 银行直付和 USDT-BSC 链上直付不受此锁定影响。本次操作不改变登录状态，不修改支付密码，也不会自动完成付款。</p><label className="ps-field"><span>解除原因 <span className="ps-reason">*</span></span><textarea value={reason} onChange={event => setReason(event.target.value)} minLength={8} maxLength={200} rows={3} placeholder="请输入已核查的事实和解除依据，至少8个字" /><span className="ps-secondary">{reason.trim().length} / 200 字</span></label><label className="ps-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已核对操作对象、异常信息和解除影响，确认执行本次解除。</label></> : <>
          <div className="ps-tabs">{[["info", "异常信息"], ["attempts", "近期验证记录"], ["audit", "处置审计"]].map(([value, label]) => <button key={value} className="ps-tab" aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div>
          {tab === "info" && <><Facts record={record} /><dl className="ps-facts"><div><dt>开始时间</dt><dd>{time(record.startedAt)}</dd></div><div><dt>累计输错</dt><dd>{record.failedAttempts ?? "未确认"} 次 / {record.windowMinutes ?? "未确认"} 分钟</dd></div></dl><p className="ps-description">登录安全与支付安全分别处理；解除后原异常与审计记录继续保留。</p>{!canRelease && <p className="ps-secondary">{pending ? "请先查询上一笔解除结果。" : record.capabilities.disabledReason}</p>}</>}
          {tab === "attempts" && <><div className="ps-table-scroll"><table className="ps-table"><thead><tr><th>时间</th><th>用途</th><th>结果</th><th>来源</th></tr></thead><tbody>{detail.attempts.records.map(row => <tr key={row.id}><td>{time(row.occurredAt)}</td><td>{row.purpose === "PAYMENT" ? "购买或置换" : "修改支付密码"}</td><td className={row.result === "INCORRECT" ? "ps-reason" : ""}>{{ SUCCEEDED: "验证通过", INCORRECT: "密码不正确", LOCKED: "暂时锁定", BUSINESS_REJECTED: "交易条件不满足" }[row.result]}</td><td>{row.channel}</td></tr>)}{!detail.attempts.records.length && <tr><td colSpan={4}>暂无相关验证记录</td></tr>}</tbody></table></div><DataListPager label="异常关联验证记录" page={detail.attempts.pageNum} pageSize={10} total={detail.attempts.total} onPageChange={next => void attemptPage(next)} onPageSizeChange={() => void attemptPage(1)} pageSizeOptions={[10]} /></>}
          {tab === "audit" && <div className="ps-audit">{detail.audit.map(row => <div key={row.id}><strong>{{ RELEASE_LOCK: "解除支付密码锁定", CLEAR_EXCEPTION: "解除支付密码异常", LOCKED: "触发支付密码锁定" }[row.action] ?? "支付安全操作"}</strong><p>{row.reason}</p><p className="ps-secondary">{time(row.occurredAt)} · {row.operator} · {row.id}</p></div>)}{!detail.audit.length && <p>暂无处置记录</p>}</div>}
        </>}
        <details className="ps-help"><summary>忘记支付密码时如何处理</summary><p>引导用户在 APP 或 H5 完成既有身份验证后重设；无法使用恢复渠道时，按既有身份核验流程协助。运营不能查看、代设或清除支付密码。</p></details>
      </>}
    </div>
  </Modal></div>;
}
