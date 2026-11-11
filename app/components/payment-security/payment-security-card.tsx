"use client";
import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { useReasonRule } from "@/lib/admin/use-reason-rule";
import { pendingPaymentRelease, queryPaymentRelease, submitPaymentRelease, retryPaymentRelease, releaseRejectedPaymentRelease, isCompletePaymentRelease, PaymentPasswordApiError, type PaymentSecurityPort } from "@/lib/admin/payment-password-client";
import type { PaymentSecurityRecord, PaymentSecurityDetail as Detail, PaymentSecuritySummary, PaymentReleaseReceipt } from "@/lib/admin/payment-password-contract";
import { visibleReasonLength } from "@/lib/admin/a2-client";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { announcePermissionDenied } from "@/lib/admin/operation-confirm-error";
import { BlockState, Button, Cell, Check, Decision, Drawer as RdDrawer, Modal as RdModal, Fact as RdFact, Facts as RdFacts, Field as RdField, Fold, JudgmentPoints, Notice, PageTabs, Panel, ReleaseBody, StatusTag, Table, TableLoading, TableMessage, Td, Textarea, Th, Timeline, Tr, useTabIds, useRdSurface } from "@/app/components/rd";
import { ShieldAlert } from "lucide-react";
import { Modal, DataListPager } from "../domain-views/design-kit";
import "./payment-security.css";

const message = (failure: unknown) => failure instanceof Error ? failure.message : "支付安全信息未确认，请重新加载。";
const time = (value: string | null) => formatBusinessTimeCompact(value, "暂无记录");
/** 改版页面里的框用全站按钮，旧页面保持原样。 */
function PsButton({ primary, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return useRdSurface() ? <Button variant={primary ? "primary" : "secondary"} {...props} /> : <button className={primary ? "ps-button ps-primary" : "ps-button"} {...props} />;
}
export const paymentSecurityStateText = { ACTIVE: "当前异常", RELEASED: "已手动解除", EXPIRED: "自然到期", UNKNOWN: "状态未知" };
export function PaymentSecurityState({ record }: { record: PaymentSecurityRecord }) {
  const surface = useRdSurface();
  if (surface) return <StatusTag tone={record.state === "ACTIVE" || record.state === "UNKNOWN" ? "warn" : "done"}>{record.type === "UNSUPPORTED" ? "异常类型未确认" : paymentSecurityStateText[record.state]}</StatusTag>;
  if (record.type === "UNSUPPORTED") return <span className="ps-state ps-history">异常类型未确认</span>;
  return <span className={`ps-state ps-${record.state === "ACTIVE" ? "locked" : record.state === "RELEASED" ? "released" : "history"}`}>{record.state === "ACTIVE" && record.type === "PAYMENT_PASSWORD_EXCEPTION" ? "待核查" : paymentSecurityStateText[record.state]}</span>;
}
const auditActionText: Record<string, string> = { RELEASE_LOCK: "解除支付密码锁定", CLEAR_EXCEPTION: "解除支付密码异常", LOCKED: "触发支付密码锁定", PAYMENT_PASSWORD_LOCKED: "触发支付密码锁定", PAYMENT_PASSWORD_LOCK_RELEASED: "解除支付密码锁定", PAYMENT_PASSWORD_EXCEPTION_CLEARED: "解除支付密码异常" };
const actionText = (record: PaymentSecurityRecord) => record.type === "PAYMENT_PASSWORD_EXCEPTION" ? "解除异常标记" : "解除锁定";
/** 解除是独立权限：没有就不给入口（OP-124）。有权限但这一条解除不了时才禁用写原因，后端 capability 和提交鉴权照旧。 */
const mayRelease = (session: { role?: string; authorities?: string[] } | null) => !!session?.authorities?.includes("user_c5_payment_password_release");
function Facts({ record }: { record: PaymentSecurityRecord }) {
  return <dl className="ps-facts"><div><dt>异常原因</dt><dd className={record.state === "ACTIVE" ? "ps-reason" : "ps-history"}>{record.reason}</dd></div>{record.lockedUntil && <div><dt>原锁定至</dt><dd>{time(record.lockedUntil)}</dd></div>}</dl>;
}

/** Existing customer/profile surfaces inject their own scoped port; never fall back to global access. */
export function PaymentSecurityCard({ port, userLabel, compact = false, recoveryActions = false }: { port: PaymentSecurityPort; userLabel: string; compact?: boolean; recoveryActions?: boolean }) {
  const surface = useRdSurface();
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
  // 侧栏里没有异常时一行带过（DP-05）。有异常、读取失败、有待确认的解除都照常全展开。
  const quiet = compact && Boolean(summary) && !record && !pending;
  if (surface) return <Panel title="支付安全" icon={ShieldAlert} actions={<>{record && <Button size="sm" onClick={() => setSelected({ id: record.id, release: false })}>查看详情</Button>}{record && record.state === "ACTIVE" && mayRelease(session) && <Button size="sm" disabledReason={pending ? "先查询原操作" : !record.capabilities.releaseAllowed ? record.capabilities.disabledReason || "当前记录不可解除" : undefined} onClick={() => setSelected({ id: record.id, release: true })}>{actionText(record)}</Button>}<Button size="sm" disabled={loading} onClick={() => void load()}>重新加载</Button></>}>
    {loading && <BlockState state="loading" title="正在读取支付安全信息" />}{error && <Notice tone="warn">{error}</Notice>}
    {summary && !record && <span>当前没有支付密码异常，历史处置记录仍保留。</span>}
    {summary && <RdFacts>{record && <><RdFact k="当前状态"><PaymentSecurityState record={record} /></RdFact><RdFact k="异常原因">{record.reason}</RdFact></>}<RdFact k="查询时间">{time(summary.observedAt)}</RdFact></RdFacts>}
    {pending && <Notice tone="warn" title="解除结果待确认" action={<Button size="sm" onClick={() => { const row = pendingPaymentRelease(owner, port.userId); if (row) setSelected({ id: row.recordId, release: false }); }}>查询原操作</Button>}>原操作已保留，请先查询结果。</Notice>}
    {selected && <PaymentSecurityDetail key={`${port.key}:${owner}:${epoch}:${selected.id}`} port={port} recordId={selected.id} userLabel={userLabel} initialAction={selected.release} recoveryActions={recoveryActions} onClose={() => setSelected(null)} />}
  </Panel>;
  return <section className={`payment-security ps-card ${compact ? "ps-compact" : ""}`} data-quiet={quiet ? "" : undefined} aria-label="支付安全">
    <header className="ps-header"><h3 className="ps-payment">支付安全</h3>{record && <PaymentSecurityState record={record} />}</header>
    {!quiet && <p className="ps-description">支付密码仅用于钱包余额付款。HDPay 银行直付和 USDT-BSC / ERC20 链上直付无需支付密码，不受此锁定影响。</p>}
    {loading && <div className="ps-skeleton" role="status" aria-label="正在读取支付安全信息"><span /><span /></div>}
    {error && <p className="ps-reason" role="alert">{error}</p>}
    {record && <><Facts record={record} /><p className="ps-description">仅处理本条支付密码异常，登录状态不受影响。</p><div className="ps-actions"><button className="ps-button" onClick={() => setSelected({ id: record.id, release: false })}>查看详情</button>{record.state === "ACTIVE" && mayRelease(session) && <button className="ps-button ps-primary" disabled={!record.capabilities.releaseAllowed || pending} onClick={() => setSelected({ id: record.id, release: true })}>{actionText(record)}</button>}</div>{record.state === "ACTIVE" && !record.capabilities.releaseAllowed && <p className="ps-secondary">{record.capabilities.disabledReason}</p>}</>}
    {summary && !record && <p>当前没有支付密码异常。历史处置记录仍保留。</p>}
    {pending && <p className="ps-secondary">有一笔解除结果等待确认。<button className="ps-link" onClick={() => { const row = pendingPaymentRelease(owner, port.userId); if (row) setSelected({ id: row.recordId, release: false }); }}>查询原操作</button></p>}
    <div className="ps-card-footer">{!quiet && <span className="ps-secondary">{summary ? `查询时间：${time(summary.observedAt)}` : "信息尚未确认"}</span>}<button className="ps-link" disabled={loading} onClick={() => void load()}>{loading ? "读取中…" : error ? "重试查询" : "重新加载"}</button></div>
    {selected && <PaymentSecurityDetail key={`${port.key}:${owner}:${epoch}:${selected.id}`} port={port} recordId={selected.id} userLabel={userLabel} initialAction={selected.release} onClose={() => setSelected(null)} />}
  </section>;
}

export function PaymentSecurityDetail({ port, recordId, userLabel, initialAction = false, recoveryActions = false, onClose }: { port: PaymentSecurityPort; recordId: string; userLabel: string; initialAction?: boolean; recoveryActions?: boolean; onClose: () => void }) {
  const session = useAdminAuth(state => state.session), epoch = useAdminAuth(state => state.authEpoch), owner = session?.adminId ?? 0;
  const [detail, setDetail] = useState<Detail | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [reviewing, setReviewing] = useState(false), [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const reasonRule = useReasonRule(reviewing);
  const surface = useRdSurface();
  const tabIds = useTabIds();
  const [attemptFailure, setAttemptFailure] = useState("");
  const [attemptDetail, setAttemptDetail] = useState<Detail["attempts"]["records"][number] | null>(null);
  const [reasonLeft, setReasonLeft] = useState(false);
  const [tab, setTab] = useState("info"), [receipt, setReceipt] = useState<PaymentReleaseReceipt | null>(null);
  const [pending, setPending] = useState(() => pendingPaymentRelease(owner, port.userId));
  const [localRelease, setLocalRelease] = useState(false);
  const generation = useRef(0), live = useRef(true), mutation = useRef(false), started = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const clearInaccessibleDetail = useCallback(() => {
    setDetail(null); setAttemptDetail(null); setReviewing(false); setConfirmed(false); setReason(""); setReasonLeft(false); setLocalRelease(false); setReceipt(null);
    announcePermissionDenied();
  }, []);
  const load = useCallback(async () => {
    const id = ++generation.current; setLoading(true); setError(""); setDetail(null); setAttemptFailure(""); setAttemptDetail(null);
    try {
      const next = await port.detail(recordId);
      if (live.current && id === generation.current) { setDetail(next); if (!started.current) { setReviewing(initialAction && next.record.capabilities.releaseAllowed && !pendingPaymentRelease(owner, port.userId)); started.current = true; } }
    } catch (failure) { if (live.current && id === generation.current) { if (failure instanceof PaymentPasswordApiError && [401, 403, 404].includes(failure.status)) clearInaccessibleDetail(); setError(message(failure)); } }
    finally { if (live.current && id === generation.current) setLoading(false); }
  }, [port, recordId, initialAction, owner, epoch, clearInaccessibleDetail]);
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; generation.current++; }; }, [load]);
  useEffect(() => {
    if (!busy && document.activeElement === document.body) contentRef.current?.closest<HTMLElement>('[role="dialog"]')?.focus();
  }, [busy, reviewing, pending]);
  const record = detail?.record;
  const canRelease = !!record?.capabilities.releaseAllowed && mayRelease(session) && !pending && owner > 0;
  const reasonValid = reasonRule.ok(reason) && reason.trim().length >= 8 && reason.trim().length <= 200;
  async function execute(queryOnly: boolean, replay = false) {
    if (mutation.current || replay && !mayRelease(session) || !queryOnly && !replay && (!record || !canRelease || !reasonValid || !confirmed)) return;
    mutation.current = true; setBusy(true); setError("");
    try {
      const next = queryOnly ? await queryPaymentRelease(owner, port) : replay ? await retryPaymentRelease(owner, port) : await submitPaymentRelease(owner, port, record!, reason.trim());
      if (!live.current) return;
      setReceipt(next); setReviewing(false);
      if (next.status === "APPLIED" || next.status === "REJECTED") { await load(); setConfirmed(false); }
    } catch (failure) {
      if (!live.current) return;
      if (failure instanceof PaymentPasswordApiError && [401, 403, 404].includes(failure.status)) clearInaccessibleDetail();
      if (failure instanceof PaymentPasswordApiError && failure.status === 409 && isExplicitRejection(failure)) { setReviewing(false); await load(); setError("异常信息已变化，请核对最新状态后再操作。"); }
      else setError(message(failure));
    } finally { mutation.current = false; if (live.current) { setBusy(false); const next = pendingPaymentRelease(owner, port.userId); setPending(next); if (next) setReviewing(false); window.dispatchEvent(new Event("nexion-payment-security-updated")); } }
  }
  async function attemptPage(next: number) {
    if (!detail || loading) return; const id = ++generation.current; setLoading(true); setError("");
    try { const attempts = await port.attempts(recordId, next, 10); if (live.current && id === generation.current) setDetail({ ...detail, attempts }); }
    catch (failure) { if (live.current && id === generation.current) { if (failure instanceof PaymentPasswordApiError && [401, 403, 404].includes(failure.status)) clearInaccessibleDetail(); setError(message(failure)); setAttemptFailure(message(failure)); } }
    finally { if (live.current && id === generation.current) setLoading(false); }
  }
  if (!session) return null;
  if (surface) return <RdDrawer open title="支付密码异常详情" icon={ShieldAlert} onClose={onClose} busy={busy} footer={<Decision others={<Button disabled={busy} onClick={onClose}>关闭</Button>} primary={record?.state === "ACTIVE" && mayRelease(session) && <Button disabledReason={busy ? "正在提交" : loading ? "正在读取" : pending ? "请先查询原解除结果" : !record.capabilities.releaseAllowed ? record.capabilities.disabledReason || "当前记录不可解除" : undefined} onClick={() => { setReviewing(true); setConfirmed(false); }}>{actionText(record)}</Button>} />}>
    {loading && <BlockState state="loading" title="正在读取异常详情" />}
    {error && <Notice tone={pending ? "warn" : "danger"} action={<Button size="sm" disabled={busy} onClick={() => void load()}>重新加载详情</Button>}>{error}</Notice>}
    {pending && <Notice tone="warn" title="解除结果待确认" action={<><Button size="sm" disabledReason={pending.portKey !== port.key ? "请回原操作入口查询" : undefined} loading={busy} onClick={() => void execute(true)}>查询本次结果</Button>{recoveryActions && pending.portKey === port.key && isCompletePaymentRelease(pending) && !pending.rejection && pending.expiresAt > Date.now() && <Button size="sm" disabledReason={!mayRelease(session) ? "当前缺少原操作权限" : busy ? "正在处理原操作" : undefined} onClick={() => void execute(false, true)}>按原操作重试</Button>}{recoveryActions && pending.portKey === port.key && pending.rejection && <Button size="sm" variant="danger-outline" disabled={busy} onClick={() => setLocalRelease(true)}>解除待确认</Button>}</>}><span data-mono>{pending.commandKey}</span> · {time(new Date(pending.createdAt).toISOString())}{pending.expiresAt <= Date.now() ? " · 已过 24 小时，仅查询" : ""}<Fold inset title="原解除操作" summary="理由、版本与命令号"><RdFacts><RdFact k="原理由">{pending.reason ?? "原记录未保存此项，只查询原操作"}</RdFact><RdFact k="原版本">{pending.expectedVersion ?? "原记录未保存此项，只查询原操作"}</RdFact><RdFact k="原命令号"><span data-mono>{pending.commandKey}</span></RdFact></RdFacts></Fold>{pending.rejection && <p>{pending.rejection}</p>}</Notice>}
    {localRelease && recoveryActions && pending?.rejection && <RdModal title="解除待确认" icon={ShieldAlert} busy={busy} onClose={() => setLocalRelease(false)} footer={<Decision others={<Button onClick={() => setLocalRelease(false)}>返回</Button>} danger={<Button variant="danger" onClick={() => { releaseRejectedPaymentRelease(owner, port, pending.commandKey); setPending(null); setLocalRelease(false); setError(""); }}>确认解除</Button>} />}><ReleaseBody label={userLabel + " · 原支付密码解除"} explain={pending.rejection} /></RdModal>}
    {receipt && <Notice tone={receipt.status === "APPLIED" ? "ok" : receipt.status === "REJECTED" ? "danger" : "warn"} title={receipt.status === "APPLIED" ? "解除已确认，审计记录已核对" : receipt.status === "REJECTED" ? "本次解除未执行，请核对最新状态" : "处理结果尚未确认，请继续查询本次操作"}>{receipt.status === "APPLIED" && `${receipt.auditId} · ${receipt.changedBy} · ${time(receipt.changedAt)}`}</Notice>}
    {record && <>
      <JudgmentPoints rows={[{ label: "操作对象", value: userLabel }, { label: "当前状态", value: <PaymentSecurityState record={record} /> }, { label: "凭证类型", value: "支付密码" }, { label: "原锁定至", value: time(record.lockedUntil) }]} />
      <PageTabs ids={tabIds} level={2} label="支付异常详情内容" value={tab} onChange={setTab} items={[{ value: "info", label: "异常信息" }, { value: "attempts", label: "近期验证记录" }, { value: "audit", label: "处置审计" }]} />
      <div {...tabIds.panel(tab)} className="rd-tab-pane">
        {tab === "info" && <RdFacts><RdFact k="异常原因">{record.reason}</RdFact><RdFact k="开始时间">{time(record.startedAt)}</RdFact><RdFact k="累计输错">{record.failedAttempts ?? "未确认"} 次</RdFact><RdFact k="错误统计窗口">{record.windowMinutes ?? "未确认"} 分钟</RdFact></RdFacts>}
        {tab === "attempts" && <><Table aria-label="异常关联验证记录" label="异常关联验证记录" className="c5-attempts"><thead><tr><Th>时间</Th><Th>用途</Th><Th>结果</Th><Th>来源</Th></tr></thead><tbody>{loading ? <TableLoading columns={4} /> : attemptFailure ? <TableMessage columns={4}>记录尚未确认，请重新加载详情</TableMessage> : detail.attempts.records.map(row => <Tr key={row.id} onOpen={() => setAttemptDetail(row)} selected={attemptDetail?.id === row.id}><Td><Cell num main={time(row.occurredAt)} /></Td><Td>{row.purpose === "PAYMENT" ? "确认购买或置换" : "修改支付密码"}</Td><Td>{{ SUCCEEDED: "验证通过", INCORRECT: "密码不正确", LOCKED: "暂时锁定", BUSINESS_REJECTED: "交易条件不满足，未计为输错" }[row.result]}</Td><Td>{row.channel}</Td></Tr>)}{!loading && !attemptFailure && !detail.attempts.records.length && <TableMessage columns={4}>暂无相关验证记录</TableMessage>}</tbody></Table>{!attemptFailure && detail.attempts.total > 0 && <div className="c5-pager"><span>第 {detail.attempts.pageNum} / {Math.ceil(detail.attempts.total / 10)} 页 · 共 {detail.attempts.total} 条</span><Button size="sm" disabled={loading || detail.attempts.pageNum <= 1} onClick={() => void attemptPage(detail.attempts.pageNum - 1)}>上一页</Button><Button size="sm" disabled={loading || detail.attempts.pageNum * 10 >= detail.attempts.total} onClick={() => void attemptPage(detail.attempts.pageNum + 1)}>下一页</Button></div>}{attemptDetail && <RdFacts><RdFact k="时间">{time(attemptDetail.occurredAt)}</RdFact><RdFact k="访问地址（已脱敏）">{attemptDetail.clientIpMasked || "未记录"}</RdFact></RdFacts>}</>}
        {tab === "audit" && <Timeline entries={detail.audit.map(row => ({ id: row.id, action: auditActionText[row.action] ?? "支付安全操作", actor: row.operator, at: row.occurredAt, detail: <>{row.reason}<span className="ps-audit-ref">审计编号 <span data-mono>{row.id}</span></span></> }))} />}
      </div>
      <Fold title="忘记支付密码时如何处理" summary="用户自行重设"><p>引导用户在 App 或 H5 完成本人验证后重设。运营不能查看或代设支付密码。</p></Fold>
    </>}
    {reviewing && record && <RdModal title={actionText(record)} icon={ShieldAlert} sub={<StatusTag tone="progress" filled>立即生效</StatusTag>} busy={busy} onClose={() => setReviewing(false)} footer={<Decision others={<Button disabled={busy} onClick={() => setReviewing(false)}>返回详情</Button>} primary={<Button variant="primary" loading={busy} disabledReason={!canRelease ? "当前记录不能解除" : !reasonValid ? "填写符合规则的 8–200 字原因" : !confirmed ? "请先核对对象与解除影响" : undefined} onClick={() => void execute(false)}>确认{actionText(record)}</Button>} />}>
      <RdFacts><RdFact k="用户">{userLabel}</RdFact><RdFact k="当前状态"><PaymentSecurityState record={record} /></RdFact><RdFact k="本次解除范围">{record.type === "PAYMENT_PASSWORD_EXCEPTION" ? "仅本条支付密码异常标记" : "仅本条支付密码锁定"}</RdFact><RdFact k="原锁定至">{time(record.lockedUntil)}</RdFact></RdFacts>
      <Notice tone="warn">{record.capabilities.effectDescription}不改变登录状态，不修改支付密码，不会自动完成付款。</Notice>
      <RdField label="解除原因" required hint="8–200 字" error={reasonLeft && !reasonValid ? reasonRule.hint(reason) || "请填写 8–200 字的解除原因" : undefined}><Textarea aria-label="解除原因" disabled={busy} value={reason} onChange={event => setReason(event.target.value)} onBlur={() => setReasonLeft(true)} rows={3} count={`${visibleReasonLength(reason)}/200`} placeholder="写清已核查的事实和解除依据" /></RdField><Check checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} label="我已核对操作对象、异常信息和解除影响，确认执行本次解除" />{error && <Notice tone="danger">{error}</Notice>}
    </RdModal>}
  </RdDrawer>;
  return <div className="payment-security"><Modal className="payment-security" icon="shield" sub={reviewing ? <StatusTag tone="progress" filled>立即生效</StatusTag> : undefined} title={reviewing && record ? `解除支付密码${record.type === "PAYMENT_PASSWORD_EXCEPTION" ? "异常标记" : "锁定"}` : "支付密码异常详情"} onClose={onClose} busy={busy} wide footer={<><PsButton disabled={busy} onClick={() => reviewing ? setReviewing(false) : onClose()}>{reviewing ? "返回详情" : "关闭"}</PsButton>{reviewing ? <PsButton primary disabled={busy || !canRelease || !reasonRule.ok(reason) || !confirmed} onClick={() => void execute(false)}>{busy ? "正在提交…" : "确认解除"}</PsButton> : record?.state === "ACTIVE" && mayRelease(session) && <PsButton primary disabled={busy || loading || !canRelease} onClick={() => { setReviewing(true); setConfirmed(false); }}>{actionText(record)}</PsButton>}</>}>
    <div ref={contentRef} className="ps-modal-content">
      {loading && <div className="ps-skeleton" role="status" aria-label="正在读取异常详情"><span /><span /><span /></div>}
      {error && (surface
        ? <Notice tone={pending ? "warn" : "danger"} action={!busy && <button className="ps-link" onClick={() => void load()}>重新加载详情</button>}>{error}</Notice>
        : <p className="ps-reason" role="alert">{error} {!busy && <button className="ps-link" onClick={() => void load()}>重新加载详情</button>}</p>)}
      {pending && <div className="ps-pending" role="status">{surface ? !error && <Notice tone="warn">解除结果暂未确认，请查询原操作，不能重复提交。</Notice> : <p>解除结果暂未确认，请查询原操作，不能重复提交。</p>}{surface && <Fold inset title="原解除操作" summary="理由、版本与命令号"><RdFacts><RdFact k="原理由">{pending.reason ?? "原记录未保存此项，只查询原操作"}</RdFact><RdFact k="原版本">{pending.expectedVersion ?? "原记录未保存此项，只查询原操作"}</RdFact><RdFact k="原命令号"><span data-mono>{pending.commandKey}</span></RdFact></RdFacts></Fold>}<PsButton disabled={busy || pending.portKey !== port.key} onClick={() => void execute(true)}>{busy ? "正在查询…" : "查询本次结果"}</PsButton>{pending.portKey !== port.key && <p className="ps-secondary">请回原操作入口查询。</p>}</div>}
      {receipt?.status === "APPLIED" && <p role="status"><strong className="ps-released">解除已确认，审计记录已核对</strong><br /><span className="ps-secondary">{receipt.auditId} · {receipt.changedBy} · {time(receipt.changedAt)}</span></p>}
      {receipt?.status === "REJECTED" && (surface ? <Notice tone="danger">本次解除未执行，请核对最新状态。</Notice> : <p className="ps-reason" role="status">本次解除未执行，请核对最新状态。</p>)}
      {(receipt?.status === "PENDING" || receipt?.status === "NOT_FOUND") && <p className="ps-secondary">处理结果尚未确认，请继续查询本次操作。</p>}
      {record && <>
        <dl className="ps-facts"><div><dt>操作对象</dt><dd className="ps-user">{userLabel}</dd></div><div><dt>当前状态</dt><dd><PaymentSecurityState record={record} /></dd></div><div><dt>{reviewing ? "本次解除范围" : "凭证类型"}</dt><dd>{reviewing ? "仅本条" : ""}<span className="ps-payment">支付密码</span>{reviewing ? record.type === "PAYMENT_PASSWORD_EXCEPTION" ? "异常标记" : "锁定" : ""}</dd></div>{record.lockedUntil && <div><dt>原锁定至</dt><dd>{time(record.lockedUntil)}</dd></div>}</dl>
        {reviewing ? <><p className="ps-description">{record.capabilities.effectDescription} 仅影响钱包余额付款的支付密码验证；HDPay 银行直付和 USDT-BSC / ERC20 链上直付不受此锁定影响。本次操作不改变登录状态，不修改支付密码，也不会自动完成付款。</p>{surface
          ? <RdField label="解除原因" required hint={`至少 ${reasonRule.min} 字`} error={reasonLeft ? reasonRule.hint(reason) || undefined : undefined}>{control => <Textarea {...control} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} onBlur={() => setReasonLeft(true)} minLength={8} maxLength={200} rows={3} count={`${visibleReasonLength(reason)}/${reasonRule.max}`} placeholder="写清已核查的事实和解除依据" />}</RdField>
          : <label className="ps-field"><span>解除原因 <span className="ps-reason">*</span></span><textarea disabled={busy} value={reason} onChange={event => setReason(event.target.value)} minLength={8} maxLength={200} rows={3} placeholder="请输入已核查的事实和解除依据，至少8个字" /><span className="ps-secondary">{reasonRule.hint(reason) || `${reason.trim().length} / ${reasonRule.max} 字`}</span></label>}<label className="ps-check"><input disabled={busy} type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已核对操作对象、异常信息和解除影响，确认执行本次解除。</label></> : <>
          <div className="ps-tabs">{[["info", "异常信息"], ["attempts", "近期验证记录"], ["audit", "处置审计"]].map(([value, label]) => <button key={value} className="ps-tab" aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div>
          {tab === "info" && <><Facts record={record} /><dl className="ps-facts"><div><dt>开始时间</dt><dd>{time(record.startedAt)}</dd></div><div><dt>累计输错</dt><dd>{record.failedAttempts ?? "未确认"} 次 / {record.windowMinutes ?? "未确认"} 分钟</dd></div></dl><p className="ps-description">登录安全与支付安全分别处理；解除后原异常与审计记录继续保留。</p>{!canRelease && mayRelease(session) && <p className="ps-secondary">{pending ? "请先查询上一笔解除结果。" : record.capabilities.disabledReason}</p>}</>}
          {tab === "attempts" && <><div className="ps-table-scroll"><table className="ps-table"><thead><tr><th>时间</th><th>用途</th><th>结果</th><th>来源</th></tr></thead><tbody>{detail.attempts.records.map(row => <tr key={row.id}><td>{time(row.occurredAt)}</td><td>{row.purpose === "PAYMENT" ? "购买或置换" : "修改支付密码"}</td><td className={row.result === "INCORRECT" ? "ps-reason" : ""}>{{ SUCCEEDED: "验证通过", INCORRECT: "密码不正确", LOCKED: "暂时锁定", BUSINESS_REJECTED: "交易条件不满足" }[row.result]}</td><td>{row.channel}</td></tr>)}{!detail.attempts.records.length && <tr><td colSpan={4}>暂无相关验证记录</td></tr>}</tbody></table></div><DataListPager label="异常关联验证记录" page={detail.attempts.pageNum} pageSize={10} total={detail.attempts.total} onPageChange={next => void attemptPage(next)} onPageSizeChange={() => void attemptPage(1)} pageSizeOptions={[10]} /></>}
          {tab === "audit" && <div className="ps-audit">{detail.audit.map(row => <div key={row.id}><strong>{auditActionText[row.action] ?? "支付安全操作"}</strong><p>{row.reason}</p><p className="ps-secondary">{time(row.occurredAt)} · {row.operator} · {row.id}</p></div>)}{!detail.audit.length && <p>暂无处置记录</p>}</div>}
        </>}
        {surface ? <Fold inset title="忘记支付密码时如何处理" summary="用户自己重设"><p className="ps-description">支付密码无法恢复，只能重置：引导用户在 App 或 H5 完成身份验证后重设。运营不能查看、代设或清除支付密码。</p></Fold> : <details className="ps-help"><summary>忘记支付密码时如何处理</summary><p>支付密码无法恢复，只能重置：引导用户在 App 或 H5 完成身份验证后重设。运营不能查看、代设或清除支付密码。</p></details>}
      </>}
    </div>
  </Modal></div>;
}
