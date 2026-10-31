"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import "./payment-password-panel.css";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { formatBusinessTime, formatBusinessTimeCompact, businessZoneText } from "@/lib/admin/business-time";
import { DataListPager } from "../design-kit";
import { fetchPaymentPolicy, fetchPaymentStatus, fetchPaymentAttempts, submitPaymentPolicy, queryPaymentPolicy, pendingPaymentPolicy } from "@/lib/admin/payment-password-client";
import { paymentPolicyFields, type PaymentPolicy, type PaymentPolicyValues, type PaymentPasswordStatus, type PaymentPasswordAttempts, type PaymentPolicyReceipt } from "@/lib/admin/payment-password-contract";
import { PaymentSecurityList } from "@/app/components/payment-security/payment-security-list";
import { PaymentSecurityCard } from "@/app/components/payment-security/payment-security-card";
import { paymentSecurityPorts } from "@/lib/admin/payment-password-client";
import { useMemo } from "react";

const labels = { maxAttempts: "窗口内输错上限", windowMinutes: "错误统计窗口", lockMinutes: "锁定时长" };
const units = { maxAttempts: "次", windowMinutes: "分钟", lockMinutes: "分钟" };
const time = (value: string | null) => formatBusinessTime(value, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }, "暂无记录");
const failureText = (failure: unknown) => failure instanceof Error ? failure.message : "支付密码信息读取失败，请重新加载。";

export function PaymentPasswordPanel({ userId, userLabel }: { userId: string | null; userLabel: string }) {
  const session = useAdminAuth(state => state.session);
  const epoch = useAdminAuth(state => state.authEpoch);
  const [view, setView] = useState("rules");
  const port = useMemo(() => userId ? paymentSecurityPorts.global(userId) : null, [userId]);
  if (!session?.authorities.includes("user_c5_read")) return <section id="payment-password-panels" className="payment-pin payment-pin__card" aria-label="支付密码"><h2>支付密码</h2><p>当前没有查看权限，请联系有权限的管理员。</p></section>;
  return <div id="payment-password-panels" className="payment-pin">
    <div className="payment-security ps-tabs" aria-label="支付密码管理视图"><button className="ps-tab" aria-pressed={view === "rules"} onClick={() => setView("rules")}>规则配置</button><button className="ps-tab" aria-pressed={view === "records"} onClick={() => setView("records")}>支付密码异常列表</button></div>
    <p className="payment-pin__secondary">支付密码仅用于钱包余额付款；HDPay 银行直付和 USDT-BSC / ERC20 链上直付无需支付密码，不受支付密码锁定影响。</p>
    <div hidden={view !== "rules"}><PaymentPolicySection key={`policy:${session.adminId}:${epoch}`} owner={session.adminId} canWrite={session.authorities.includes("user_c5_payment_password_policy_write")} /></div>
    {view === "records" && <section className="payment-pin__card"><PaymentSecurityList key={`records:${session.adminId}:${epoch}`} /></section>}
    {port && <section className="payment-pin__card"><PaymentSecurityCard key={`${port.key}:${session.adminId}:${epoch}`} port={port} userLabel={userLabel} /></section>}
    {userId ? <PaymentUserSection key={`payment:${session.adminId}:${epoch}:${userId}`} userId={userId} userLabel={userLabel} /> : <section className="payment-pin__card" aria-label="用户支付密码"><h2>用户支付密码</h2><p className="payment-pin__empty">请先在上方用户列表中点击“查看安全信息”，再查看该用户的支付密码状态及验证记录。</p></section>}
  </div>;
}

function PaymentPolicySection({ owner, canWrite }: { owner: number; canWrite: boolean }) {
  const [policy, setPolicy] = useState<PaymentPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [values, setValues] = useState({ maxAttempts: "", windowMinutes: "", lockMinutes: "" });
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [receipt, setReceipt] = useState<PaymentPolicyReceipt | null>(null);
  const generation = useRef(0), live = useRef(true), mutation = useRef(false);
  const load = useCallback(async () => {
    const id = ++generation.current;
    setLoading(true); setError(""); setPolicy(null); setEditing(false); setReviewing(false);
    try { const next = await fetchPaymentPolicy(); if (live.current && id === generation.current) setPolicy(next); }
    catch (failure) { if (live.current && id === generation.current) setError(failureText(failure)); }
    finally { if (live.current && id === generation.current) setLoading(false); }
  }, []);
  useEffect(() => { live.current = true; setPending(!!pendingPaymentPolicy(owner)); void load(); return () => { live.current = false; generation.current++; }; }, [load, owner]);
  const parsed = Object.fromEntries(paymentPolicyFields.map(key => [key, Number(values[key])])) as PaymentPolicyValues;
  const valid = !!policy?.constraints && paymentPolicyFields.every(key => /^\d+$/.test(values[key]) && Number.isSafeInteger(parsed[key]) && parsed[key] >= policy.constraints![key].min && parsed[key] <= policy.constraints![key].max);
  const changed = !!policy && paymentPolicyFields.some(key => parsed[key] !== policy.values[key]);
  const editable = !!policy && canWrite && policy.editable && !!policy.constraints && !!policy.effectDescription && !pending;
  const editReason = !canWrite ? "当前只有查看权限" : pending ? "请先查询上一笔调整结果" : policy && (!policy.constraints || !policy.effectDescription) ? "可调整范围或生效说明尚未确认，暂时只能查看" : policy && !policy.editable ? "当前规则只能查看" : "";
  async function finish(queryOnly = false) {
    if (mutation.current || !queryOnly && (!editable || !policy || !valid || !changed || reason.trim().length < 8 || !confirmed)) return;
    mutation.current = true; setBusy(true); setError(""); setReceipt(null);
    try {
      const result = queryOnly ? await queryPaymentPolicy(owner) : await submitPaymentPolicy(owner, parsed, policy!.version, reason.trim());
      if (!live.current) return;
      setReceipt(result);
      if (result.status !== "PENDING") { setEditing(false); setReviewing(false); setReason(""); setConfirmed(false); await load(); }
    } catch (failure) { if (live.current) setError(failureText(failure)); }
    finally { mutation.current = false; if (live.current) { setBusy(false); setPending(!!pendingPaymentPolicy(owner)); } }
  }
  return <section className="payment-pin__card" aria-label="支付密码规则">
    <header className="payment-pin__header">
      <div><h2>支付密码规则</h2><p className="payment-pin__secondary">钱包余额付款和修改原支付密码共用错误次数</p></div>
      <div className="payment-pin__actions">
        {!editing && <button className="payment-pin__button payment-pin__button--primary" aria-label="调整支付密码规则" disabled={!editable || loading || busy} onClick={() => { setValues({ maxAttempts: String(policy!.values.maxAttempts), windowMinutes: String(policy!.values.windowMinutes), lockMinutes: String(policy!.values.lockMinutes) }); setReason(""); setConfirmed(false); setReceipt(null); setEditing(true); }}>调整规则</button>}
        <button className="payment-pin__button payment-pin__icon-button" aria-label="重新加载规则" title="重新加载规则" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={16} /></button>
      </div>
    </header>
    {loading && <p className="payment-pin__notice" role="status">正在读取支付密码规则…</p>}
    {error && <p className="payment-pin__notice payment-pin__notice--error" role="alert">{error}</p>}
    {pending && <div className="payment-pin__notice payment-pin__notice--warning" role="status"><span>上一笔调整结果还未确认。请先查询，期间不能再次保存。</span><button className="payment-pin__button" disabled={busy} onClick={() => void finish(true)}>{busy ? "正在查询…" : "查询原调整结果"}</button></div>}
    {policy && !editing && <>
      <dl className="payment-pin__rules">{paymentPolicyFields.map(key => <div key={key}><dt>{labels[key]}</dt><dd><span className="payment-pin__number">{policy.values[key]}</span><span className="payment-pin__unit">{units[key]}</span></dd></div>)}</dl>
      <div className="payment-pin__policy-note"><p>{policy.effectDescription || "生效方式尚未确认。"}</p><p className="payment-pin__secondary">最近调整：{time(policy.updatedAt)}{policy.updatedBy ? ` · ${policy.updatedBy}` : ""}</p>{editReason && <p className="payment-pin__secondary">{editReason}</p>}</div>
    </>}
    {policy && editing && !pending && <div className="payment-pin__editor">
      <h3>{reviewing ? "确认本次调整" : "填写新的规则"}</h3>
      {!reviewing ? <>
        <div className="payment-pin__fields">{paymentPolicyFields.map(key => <label key={key}>{labels[key]}（{units[key]}）<input type="number" inputMode="numeric" step={1} min={policy.constraints![key].min} max={policy.constraints![key].max} value={values[key]} onChange={event => setValues(current => ({ ...current, [key]: event.target.value }))} /><span className="payment-pin__secondary">允许 {policy.constraints![key].min}–{policy.constraints![key].max} {units[key]}</span></label>)}</div>
        <p className="payment-pin__secondary">{!valid ? "请填写允许范围内的整数。" : !changed ? "请先调整至少一项规则。" : "下一步核对调整前后数值，并填写调整理由。"}</p>
      </> : <>
        <table className="payment-pin__table payment-pin__comparison" aria-label="支付密码规则调整对照"><thead><tr><th>规则</th><th>调整前</th><th>调整后</th></tr></thead><tbody>{paymentPolicyFields.map(key => <tr key={key}><td>{labels[key]}</td><td>{policy.values[key]} {units[key]}</td><td className={policy.values[key] !== parsed[key] ? "payment-pin__changed" : undefined}>{parsed[key]} {units[key]}</td></tr>)}</tbody></table>
        <p className="payment-pin__secondary payment-pin__effect">{policy.effectDescription}</p>
        <div className="payment-pin__reason"><label>调整理由（至少 8 个字）<textarea aria-label="支付密码规则调整理由" value={reason} disabled={busy} onChange={event => setReason(event.target.value)} rows={3} /></label><label className="payment-pin__check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />我已核对调整前后数值与生效说明</label>{reason.trim().length < 8 && <p className="payment-pin__secondary">请填写至少 8 个字的调整理由后保存。</p>}</div>
      </>}
      <footer className="payment-pin__form-actions">
        <button className="payment-pin__button" disabled={busy} onClick={() => { setEditing(false); setReviewing(false); setReason(""); setConfirmed(false); }}>取消调整</button>
        {reviewing ? <><button className="payment-pin__button" disabled={busy} onClick={() => setReviewing(false)}>返回修改</button><button className="payment-pin__button payment-pin__button--primary" disabled={busy || !confirmed || reason.trim().length < 8 || !valid || !changed || !editable} onClick={() => void finish()}>{busy ? "正在保存并核对审计…" : "确认并保存规则"}</button></> : <button className="payment-pin__button payment-pin__button--primary" disabled={!valid || !changed || busy} onClick={() => { setReviewing(true); setConfirmed(false); }}>下一步：核对调整</button>}
      </footer>
    </div>}
    {!policy && !loading && <p className="payment-pin__empty">当前生效规则尚未确认。方案默认：错误上限 5 次、统计窗口 15 分钟、锁定 15 分钟；此处不是当前生效值。</p>}
    {receipt && <div className={`payment-pin__receipt ${receipt.status === "APPLIED" ? "payment-pin__receipt--success" : ""}`} role="status"><strong>{receipt.status === "APPLIED" ? "规则已保存，审计记录已核对" : receipt.status === "REJECTED" ? "本次调整未生效，请核对当前规则后重试" : "本次调整仍在处理中，请稍后继续查询"}</strong>{receipt.status === "APPLIED" && <><p>审计记录：{receipt.auditId} · {time(receipt.changedAt)} · {receipt.changedBy}</p><p>{paymentPolicyFields.map(key => `${labels[key]}：${receipt.oldValues[key]} → ${receipt.newValues[key]} ${units[key]}`).join("；")}</p><p>调整理由：{receipt.reason}</p><p>{receipt.effectDescription}</p></>}</div>}
  </section>;
}

function PaymentUserSection({ userId, userLabel }: { userId: string; userLabel: string }) {
  const [status, setStatus] = useState<PaymentPasswordStatus | null>(null);
  const [attempts, setAttempts] = useState<PaymentPasswordAttempts | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const load = useCallback(async () => {
    const id = ++generation.current;
    setLoading(true); setError(""); setStatus(null); setAttempts(null);
    try { const [nextStatus, nextAttempts] = await Promise.all([fetchPaymentStatus(userId), fetchPaymentAttempts(userId, page, pageSize)]); if (id === generation.current) { setStatus(nextStatus); setAttempts(nextAttempts); } }
    catch (failure) { if (id === generation.current) setError(failureText(failure)); }
    finally { if (id === generation.current) setLoading(false); }
  }, [userId, page, pageSize]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  return <section className="payment-pin__card" aria-label="用户支付密码">
    <header className="payment-pin__header"><div><h2>用户支付密码</h2><p className="payment-pin__secondary">{userLabel} · {businessZoneText()}</p></div><div className="payment-pin__actions">{status && <span className={`payment-pin__status payment-pin__status--${status.state.toLowerCase()}`}>{status.state === "UNSET" ? "未设置" : status.state === "SET" ? "已设置" : "暂时锁定"}</span>}<button className="payment-pin__button payment-pin__icon-button" aria-label="重新加载支付密码信息" title="重新加载支付密码信息" disabled={loading} onClick={() => void load()}><RefreshCw size={16} /></button></div></header>
    {loading && <p className="payment-pin__notice" role="status">正在读取该用户的支付密码状态与验证记录…</p>}
    {error && <p className="payment-pin__notice payment-pin__notice--error" role="alert">{error}</p>}
    {status && <><dl className="payment-pin__facts"><div><dt>最近设置或修改</dt><dd>{formatBusinessTimeCompact(status.updatedAt, "暂无记录")}</dd></div><div><dt>锁定至</dt><dd>{status.state === "LOCKED" ? formatBusinessTimeCompact(status.lockedUntil) : "当前未锁定"}</dd></div><div><dt>查询时间</dt><dd>{formatBusinessTimeCompact(status.observedAt)}</dd></div></dl>{status.state === "LOCKED" && <p className="payment-pin__lock-note">钱包付款的支付密码暂时锁定，HDPay 银行直付、USDT-BSC / ERC20 链上直付和登录不受影响。到期后请重新加载确认。</p>}</>}
    <details className="payment-pin__help"><summary>忘记支付密码时如何处理</summary><p>用户应在 APP 或 H5 通过“忘记支付密码”验证身份；无法使用恢复渠道时，按既有账号身份核验流程协助处理。这里只查看状态和验证结果。</p></details>
    <div className="payment-pin__records"><h3>验证记录</h3><div className="payment-pin__table-scroll"><table className="payment-pin__table payment-pin__history" aria-label="支付密码验证记录"><colgroup><col /><col /><col /><col /><col /></colgroup><thead><tr><th>验证时间</th><th>用途</th><th>结果</th><th>来源</th><th>访问地址（已脱敏）</th></tr></thead><tbody>
      {attempts?.records.map(row => <tr key={row.id}><td>{formatBusinessTimeCompact(row.occurredAt)}</td><td>{row.purpose === "PAYMENT" ? "确认购买或置换" : "修改支付密码"}</td><td>{{ SUCCEEDED: "验证通过", INCORRECT: "密码不正确", LOCKED: "暂时锁定", BUSINESS_REJECTED: "交易条件不满足，未计为输错" }[row.result]}</td><td>{row.channel === "APP" ? "APP" : "H5"}</td><td>{row.clientIpMasked || "未记录"}</td></tr>)}
      {!attempts?.records.length && <tr><td colSpan={5} className="payment-pin__table-empty">{loading ? "正在加载验证记录…" : error ? "验证记录尚未确认，请重新加载" : "该用户暂无支付密码验证记录"}</td></tr>}
    </tbody></table></div></div>
    {attempts && <div className="payment-pin__pagination"><DataListPager label="支付密码验证记录" page={attempts.pageNum} pageSize={attempts.pageSize} total={attempts.total} onPageChange={next => { if (!loading) setPage(next); }} onPageSizeChange={next => { if (!loading) { setPageSize(next); setPage(1); } }} pageSizeOptions={[10, 20, 50]} /></div>}
  </section>;
}
