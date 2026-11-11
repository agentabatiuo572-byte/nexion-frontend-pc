"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Clock3, KeyRound, RefreshCw, ShieldAlert } from "lucide-react";
import { BlockState, Button, Cell, Change, Check, ConfigList, ConfigRow, Decision, Drawer, Fact, Facts, Field, Fold, IconButton, KeepText, Modal, Notice, NumberInput, PageTabs, Pager, Panel, ReleaseBody, StatusTag, Table, TableLoading, TableMessage, Td, Textarea, Th, Tr, useTabIds } from "@/app/components/rd";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { formatBusinessTimeCompact, businessZoneText } from "@/lib/admin/business-time";
import { fetchPaymentPolicy, fetchPaymentStatus, fetchPaymentAttempts, submitPaymentPolicy, queryPaymentPolicy, pendingPaymentPolicy, paymentSecurityPorts, retryPaymentPolicy, releaseRejectedPaymentPolicy, isCompletePaymentPolicy } from "@/lib/admin/payment-password-client";
import { paymentPolicyFields, type PaymentPolicy, type PaymentPolicyValues, type PaymentPasswordStatus, type PaymentPasswordAttempts, type PaymentPolicyReceipt } from "@/lib/admin/payment-password-contract";
import { PaymentSecurityList } from "@/app/components/payment-security/payment-security-list";
import { PaymentSecurityCard } from "@/app/components/payment-security/payment-security-card";
import "./payment-password-panel.css";

const labels = { maxAttempts: "窗口内输错上限", windowMinutes: "错误统计窗口", lockMinutes: "锁定时长" };
const units = { maxAttempts: "次", windowMinutes: "分钟", lockMinutes: "分钟" };
const descriptions = { maxAttempts: "触发钱包支付密码锁的错误次数", windowMinutes: "累积支付密码错误的时间窗口", lockMinutes: "新支付密码锁定的持续时间" };
const time = (value: string | null) => formatBusinessTimeCompact(value, "暂无记录");
const failureText = (failure: unknown) => failure instanceof Error ? failure.message : "支付密码信息读取失败，请重新加载。";
const attemptResult = { SUCCEEDED: "验证通过", INCORRECT: "密码不正确", LOCKED: "暂时锁定", BUSINESS_REJECTED: "交易条件不满足，未计为输错" };

export function PaymentPasswordPanel({ userId, userLabel, active = true, onPendingChange, onBusyChange }: { userId: string | null; userLabel: string; active?: boolean; onPendingChange?: () => void; onBusyChange?: (busy: boolean) => void }) {
  const session = useAdminAuth(state => state.session), epoch = useAdminAuth(state => state.authEpoch);
  const params = useSearchParams(), router = useRouter(), pathname = usePathname();
  const view = params?.get("paymentTab") === "exceptions" ? "exceptions" : "policy";
  const ids = useTabIds(), port = useMemo(() => userId ? paymentSecurityPorts.global(userId) : null, [userId]);
  if (!session?.authorities.includes("user_c5_read")) return null;
  return <div id="payment-password-panels" className="c5-payment" aria-label="支付密码规则与用户状态">
    <PageTabs level={2} ids={ids} label="支付密码管理视图" value={view} onChange={value => { const next = new URLSearchParams(params?.toString() ?? ""); next.set("paymentTab", value); router.replace(`${pathname}?${next}`, { scroll: false }); }} items={[{ value: "policy", label: "规则配置" }, { value: "exceptions", label: "支付密码异常列表" }]} />
    <div {...ids.panel(view)} className="rd-tab-pane">
      <div hidden={view !== "policy"}>
        <PaymentPolicySection key={`policy:${session.adminId}:${epoch}`} visible={active && view === "policy"} owner={session.adminId} canWrite={session.authorities.includes("user_c5_payment_password_policy_write")} onPendingChange={onPendingChange} onBusyChange={onBusyChange} />
        {userId ? <PaymentUserSection key={`user:${session.adminId}:${epoch}:${userId}`} userId={userId} userLabel={userLabel} visible={active && view === "policy"} /> : <Panel aria-label="用户支付密码" title="用户支付密码"><BlockState state="empty" title="先选择用户，再查看支付密码状态与验证记录" /></Panel>}
        {active && view === "policy" && port && <PaymentSecurityCard key={`${port.key}:${session.adminId}:${epoch}`} port={port} userLabel={userLabel} compact recoveryActions />}
      </div>
      {active && view === "exceptions" && <PaymentSecurityList key={`records:${session.adminId}:${epoch}`} />}
    </div>
  </div>;
}

function PaymentPolicySection({ owner, canWrite, visible, onPendingChange, onBusyChange }: { visible: boolean; owner: number; canWrite: boolean; onPendingChange?: () => void; onBusyChange?: (busy: boolean) => void }) {
  const [policy, setPolicy] = useState<PaymentPolicy | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [editing, setEditing] = useState(false), [reviewing, setReviewing] = useState(false), [values, setValues] = useState({ maxAttempts: "", windowMinutes: "", lockMinutes: "" });
  const [reason, setReason] = useState(""), [leftReason, setLeftReason] = useState(false), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(() => pendingPaymentPolicy(owner)), [receipt, setReceipt] = useState<PaymentPolicyReceipt | null>(null);
  const [localRelease, setLocalRelease] = useState(false);
  const original = pending && isCompletePaymentPolicy(pending) ? pending : null;
  const generation = useRef(0), live = useRef(true), mutation = useRef(false);
  const load = useCallback(async () => {
    const id = ++generation.current; setLoading(true); setError(""); setPolicy(null);
    try { const next = await fetchPaymentPolicy(); if (live.current && id === generation.current) setPolicy(next); }
    catch (failure) { if (live.current && id === generation.current) setError(failureText(failure)); }
    finally { if (live.current && id === generation.current) setLoading(false); }
  }, []);
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; generation.current++; }; }, [load]);
  const parsed = Object.fromEntries(paymentPolicyFields.map(key => [key, Number(values[key])])) as PaymentPolicyValues;
  const valid = !!policy?.constraints && paymentPolicyFields.every(key => /^\d+$/.test(values[key]) && Number.isSafeInteger(parsed[key]) && parsed[key] >= policy.constraints![key].min && parsed[key] <= policy.constraints![key].max);
  const changed = !!policy && paymentPolicyFields.some(key => parsed[key] !== policy.values[key]);
  const reasonValid = reason.trim().length >= 8 && reason.trim().length <= 200;
  const editable = !!policy && canWrite && policy.editable && !!policy.constraints && !!policy.effectDescription && !pending;
  const editReason = pending ? "请先查询上一笔调整结果" : !policy ? "当前规则尚未读取" : !policy.constraints || !policy.effectDescription ? "可调整范围或生效说明尚未确认" : !policy.editable ? "当前规则只能查看" : undefined;
  async function finish(queryOnly = false, replay = false) {
    if (mutation.current || replay && !canWrite || !queryOnly && !replay && (!editable || !policy || !valid || !changed || !reasonValid || !confirmed)) return;
    mutation.current = true; setBusy(true); onBusyChange?.(true); setError(""); setReceipt(null);
    try {
      const result = queryOnly ? await queryPaymentPolicy(owner) : replay ? await retryPaymentPolicy(owner) : await submitPaymentPolicy(owner, parsed, policy!.version, reason.trim(), policy!.values);
      if (!live.current) return;
      setReceipt(result);
      if (result.status !== "PENDING") { setEditing(false); setReviewing(false); setReason(""); setConfirmed(false); await load(); }
    } catch (failure) { if (live.current) setError(failureText(failure)); }
    finally { mutation.current = false; onBusyChange?.(false); if (live.current) { setBusy(false); const next = pendingPaymentPolicy(owner); setPending(next); if (next) { setReviewing(false); setEditing(false); } onPendingChange?.(); } }
  }
  return <Panel aria-label="支付密码规则" title="支付密码规则" icon={KeyRound} explain="钱包余额付款和修改原支付密码共用错误次数。登录锁与钱包支付密码锁分开。" actions={<>{canWrite && <Button aria-label="调整支付密码规则" size="sm" disabledReason={loading ? "正在读取规则" : busy ? "正在提交" : editReason} onClick={() => { if (!policy) return; setValues({ maxAttempts: String(policy.values.maxAttempts), windowMinutes: String(policy.values.windowMinutes), lockMinutes: String(policy.values.lockMinutes) }); setReason(""); setConfirmed(false); setReceipt(null); setEditing(true); }}>调整规则</Button>}<IconButton aria-label="重新加载规则" disabled={loading || busy} onClick={() => { setEditing(false); setReviewing(false); setReason(""); setConfirmed(false); void load(); }}><RefreshCw size={16} /></IconButton></>}>
    {loading && <BlockState state="loading" title="正在读取支付密码规则" />}
    {error && <Notice tone={pending ? "warn" : "danger"}>{error}</Notice>}
    {pending && <Notice tone="warn" title="上一笔规则调整结果待确认" action={<><Button size="sm" loading={busy} onClick={() => void finish(true)}>查询原调整结果</Button>{original && !pending.rejection && pending.expiresAt > Date.now() && <Button size="sm" disabledReason={!canWrite ? "当前缺少原操作权限" : busy ? "正在处理原操作" : undefined} onClick={() => void finish(false, true)}>按原操作重试</Button>}{pending.rejection && <Button size="sm" variant="danger-outline" disabled={busy} onClick={() => setLocalRelease(true)}>解除待确认</Button>}</>}><span data-mono>{pending.commandKey}</span> · {time(new Date(pending.createdAt).toISOString())}{pending.expiresAt <= Date.now() ? " · 已过 24 小时，仅查询" : ""}{original ? <Fold inset title="原规则调整" summary="原值、新值、理由与版本"><Facts><Fact k="原理由">{original.reason}</Fact><Fact k="原版本">{original.expectedVersion}</Fact><Fact k="操作人">{original.operator}</Fact>{paymentPolicyFields.map(key => <Fact key={key} k={labels[key]}><Change from={`${original.oldValues[key]} ${units[key]}`} to={`${original.values[key]} ${units[key]}`} /></Fact>)}</Facts></Fold> : <p>原记录缺少完整请求，只查询原操作。</p>}{pending.rejection && <p>{pending.rejection}</p>}</Notice>}
    {visible && localRelease && pending?.rejection && <Modal title="解除待确认" icon={ShieldAlert} busy={busy} onClose={() => setLocalRelease(false)} footer={<Decision others={<Button onClick={() => setLocalRelease(false)}>返回</Button>} danger={<Button variant="danger" onClick={() => { releaseRejectedPaymentPolicy(owner, pending.commandKey); setPending(null); setLocalRelease(false); setError(""); onPendingChange?.(); }}>确认解除</Button>} />}><ReleaseBody label="原支付密码规则调整" explain={pending.rejection} /></Modal>}
    {policy && <><ConfigList label="支付密码规则">{paymentPolicyFields.map(key => <ConfigRow key={key} name={labels[key]} what={descriptions[key]} when={policy.effectDescription || "生效方式未确认"} effect={key === "lockMinutes" ? "只改变之后触发的锁，不解除现有锁" : "后续验证读取当前规则，不改变登录锁"} where="App 支付密码验证与锁定提示" value={`${policy.values[key]} ${units[key]}`} />)}</ConfigList><div className="c5-context-line">最近调整：{time(policy.updatedAt)}{policy.updatedBy ? ` · ${policy.updatedBy}` : ""}{editReason && <span>{editReason}</span>}</div></>}
    {!policy && !loading && <BlockState state="error" title="当前生效规则尚未确认" onRetry={() => void load()} retryLabel="重新加载规则" />}
    {receipt && <Notice tone={receipt.status === "APPLIED" ? "ok" : receipt.status === "REJECTED" ? "danger" : "warn"} title={receipt.status === "APPLIED" ? "规则已保存，审计记录已核对" : receipt.status === "REJECTED" ? "本次调整未生效，请核对当前规则" : "本次调整仍在处理中，请继续查询"}>{receipt.status === "APPLIED" && <Fold title="查看调整回执" summary={`${receipt.changedBy} · ${time(receipt.changedAt)}`}><Facts><Fact k="审计记录">{receipt.auditId}</Fact><Fact k="调整理由">{receipt.reason}</Fact><Fact k="生效方式">{receipt.effectDescription}</Fact>{paymentPolicyFields.map(key => <Fact key={key} k={labels[key]}><Change settled from={`${receipt.oldValues[key]} ${units[key]}`} to={`${receipt.newValues[key]} ${units[key]}`} /></Fact>)}</Facts></Fold>}</Notice>}
    {visible && policy && editing && <Drawer open busy={busy} onClose={() => { setEditing(false); setReviewing(false); setReason(""); setConfirmed(false); }} title="调整支付密码规则" icon={KeyRound} footer={<Decision others={<Button disabled={busy} onClick={() => { setEditing(false); setReason(""); setConfirmed(false); }}>取消调整</Button>} primary={<Button variant="primary" disabledReason={!valid ? "填写允许范围内的整数" : !changed ? "请先调整至少一项规则" : undefined} onClick={() => { setReviewing(true); setConfirmed(false); }}>下一步：核对调整</Button>} />}>
      <Facts><Fact k="规则版本">{policy.version}</Fact></Facts>{paymentPolicyFields.map(key => <Field key={key} label={labels[key]} help={`允许 ${policy.constraints![key].min}–${policy.constraints![key].max} ${units[key]}，整数`} error={values[key] && (!/^\d+$/.test(values[key]) || parsed[key] < policy.constraints![key].min || parsed[key] > policy.constraints![key].max) ? "请填写允许范围内的整数" : undefined}><NumberInput aria-label={labels[key]} unit={units[key]} step={1} min={policy.constraints![key].min} max={policy.constraints![key].max} value={values[key]} onChange={event => setValues(current => ({ ...current, [key]: event.target.value }))} /></Field>)}
      {reviewing && <Modal title="核对支付密码规则调整" icon={KeyRound} sub={<StatusTag tone="progress">保存后生效</StatusTag>} busy={busy} onClose={() => setReviewing(false)} footer={<Decision others={<Button disabled={busy} onClick={() => setReviewing(false)}>返回修改</Button>} primary={<Button variant="primary" loading={busy} loadingText="正在保存并核对审计…" disabledReason={!valid || !changed ? "请返回填写有效调整" : !reasonValid ? "请填写 8–200 字的调整理由" : !confirmed ? "请核对数值与生效说明" : !editable ? editReason : undefined} onClick={() => void finish()}>确认并保存规则</Button>} />}>
        <Facts>{paymentPolicyFields.map(key => <Fact key={key} k={labels[key]}><Change from={`${policy.values[key]} ${units[key]}`} to={`${parsed[key]} ${units[key]}`} /></Fact>)}</Facts><Notice tone="progress">{policy.effectDescription}</Notice><Field label="调整理由" required hint="8–200 字" error={leftReason && !reasonValid ? "请填写 8–200 字的调整理由" : undefined}><Textarea aria-label="支付密码规则调整理由" value={reason} disabled={busy} onChange={event => setReason(event.target.value)} onBlur={() => setLeftReason(true)} rows={3} count={`${reason.trim().length}/200`} /></Field><Check checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} label="我已核对调整前后数值与生效说明" />{error && <Notice tone="danger">{error}</Notice>}
      </Modal>}
    </Drawer>}
  </Panel>;
}

function PaymentUserSection({ userId, userLabel, visible }: { userId: string; userLabel: string; visible: boolean }) {
  const [status, setStatus] = useState<PaymentPasswordStatus | null>(null), [attempts, setAttempts] = useState<PaymentPasswordAttempts | null>(null);
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [open, setOpen] = useState(false), [attempt, setAttempt] = useState<PaymentPasswordAttempts["records"][number] | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const id = ++generation.current; setLoading(true); setError(""); setStatus(null); setAttempts(null); setAttempt(null);
    try { const [nextStatus, nextAttempts] = await Promise.all([fetchPaymentStatus(userId), fetchPaymentAttempts(userId, page, pageSize)]); if (id === generation.current) { setStatus(nextStatus); setAttempts(nextAttempts); } }
    catch (failure) { if (id === generation.current) setError(failureText(failure)); }
    finally { if (id === generation.current) setLoading(false); }
  }, [userId, page, pageSize]);
  useEffect(() => { void load(); const refresh = () => void load(); window.addEventListener("nexion-payment-security-updated", refresh); return () => { generation.current++; window.removeEventListener("nexion-payment-security-updated", refresh); }; }, [load]);
  const state = status?.state === "LOCKED" ? "暂时锁定" : status?.state === "SET" ? "已设置" : status?.state === "UNSET" ? "未设置" : "未确认";
  return <Panel aria-label="用户支付密码" title="用户支付密码" icon={KeyRound} sub={userLabel} actions={<>{status && !loading && !error && <Button size="sm" onClick={() => setOpen(true)}>查看验证记录</Button>}<IconButton aria-label="重新加载支付密码信息" disabled={loading} onClick={() => void load()}><RefreshCw size={16} /></IconButton></>}>
    {loading ? <BlockState state="loading" title="正在读取支付密码状态与验证记录" /> : error ? <BlockState state="error" title="支付密码信息未能读取" detail={error} onRetry={() => void load()} /> : status && <><Facts><Fact k="支付密码"><StatusTag tone={status.state === "LOCKED" ? "warn" : status.state === "SET" ? "ok" : "done"} icon={status.state === "LOCKED" ? ShieldAlert : status.state === "SET" ? CheckCircle2 : undefined}>{state}</StatusTag></Fact><Fact k="最近设置或修改">{time(status.updatedAt)}</Fact><Fact k="锁定至">{status.state === "LOCKED" ? time(status.lockedUntil) : "当前未锁定"}</Fact><Fact k="查询时间">{time(status.observedAt)}</Fact></Facts>{status.state === "LOCKED" && <Notice tone="warn">支付密码暂时锁定，登录锁单独处理。到期后请重新加载确认。</Notice>}</>}
    {visible && open && <Drawer open onClose={() => setOpen(false)} title="支付密码验证记录" sub={`${userLabel} · ${businessZoneText()}`} icon={Clock3}>
      {error && <BlockState state="error" title="状态与验证记录尚未确认" detail={error} onRetry={() => void load()} />}
      <Table aria-label="支付密码验证记录" label="支付密码验证记录" className="c5-attempts"><thead><tr><Th>时间</Th><Th>用途</Th><Th>结果</Th><Th>来源</Th></tr></thead><tbody>{loading ? <TableLoading columns={4} /> : attempts?.records.map(row => <Tr key={row.id} selected={attempt?.id === row.id} onOpen={() => setAttempt(row)}><Td><Cell num main={time(row.occurredAt)} /></Td><Td>{row.purpose === "PAYMENT" ? "确认购买或置换" : "修改支付密码"}</Td><Td>{attemptResult[row.result]}</Td><Td>{row.channel}</Td></Tr>)}{!loading && !attempts?.records.length && <TableMessage columns={4}>{error ? "验证记录未能读取" : "该用户暂无支付密码验证记录"}</TableMessage>}</tbody></Table>{attempts && attempts.total > 0 && <Pager label="支付密码验证记录" total={attempts.total} page={page} pageSize={pageSize} sizes={[10, 20, 50]} loading={loading} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1); }} />}
      {attempt && <Facts><Fact k="验证时间">{time(attempt.occurredAt)}</Fact><Fact k="结果">{attemptResult[attempt.result]}</Fact><Fact k="访问地址（已脱敏）">{attempt.clientIpMasked || "未记录"}</Fact></Facts>}
      <Fold title="忘记支付密码时如何处理" summary="用户自行重设"><p><KeepText text="引导用户在 App 或 H5 的“忘记支付密码”完成本人验证后重设，不能索要用户支付密码。" /></p></Fold>
    </Drawer>}
  </Panel>;
}
