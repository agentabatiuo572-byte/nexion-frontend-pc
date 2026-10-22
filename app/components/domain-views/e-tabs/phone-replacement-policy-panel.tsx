"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { fetchE6ComputeConfig } from "@/lib/admin/e6-client";
import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { fetchPhoneOperation, PhoneApiError } from "@/lib/admin/phone-replacement-client";
import { canReadPolicyReceipt, parsePhonePolicy, phoneDraftError, phonePolicyValues, phoneConflictMessage, record, type PhonePolicy, type PhoneReceipt } from "@/lib/admin/phone-replacement-contract";
import { PhoneFacts, PhoneReceiptView, phoneTime } from "../phone-replacement-receipt";
type ProposalInput = Parameters<typeof createA2OperationProposal>[0];
interface SavedProposal extends PendingMutationRecord {
    owner: number;
    input: ProposalInput;
    ticketId?: string;
    terminal?: string;
}
const proposals = createPendingMutationStore<SavedProposal>({ storageKey: "nexion-admin-phone-policy-proposals-v1", retainExpiredRecords: true,
    isValidRecord: r => Number.isSafeInteger(r.owner) && record(r.input) && record(r.input.command) });
export function PhoneReplacementPolicyPanel() {
    const session = useAdminAuth(s => s.session), epoch = useAdminAuth(s => s.authEpoch);
    if (!session?.authorities.includes("device_e6_read"))
        return null;
    return <PolicyEditor key={`${session.adminId}:${epoch}`} owner={session.adminId} operator={session.operator || session.username} rights={session.authorities}/>;
}
function PolicyEditor({ owner, operator, rights }: {
    owner: number;
    operator: string;
    rights: string[];
}) {
    const canWrite = rights.includes("device_e6_write") && rights.includes("device_e6_flag_toggle");
    const canRecover = canReadPolicyReceipt(rights);
    const [policy, setPolicy] = useState<PhonePolicy | null>(null), [values, setValues] = useState(["", "", ""]), [allow, setAllow] = useState(false);
    const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
    const [confirm, setConfirm] = useState<{
        values: Record<string, string>;
        version: number;
        before: PhonePolicy;
    } | null>(null);
    const [reason, setReason] = useState(""), [ack, setAck] = useState(false), [pending, setPending] = useState<SavedProposal | null>(null);
    const [lookup, setLookup] = useState(""), [mode, setMode] = useState("id"), [type, setType] = useState("PHONE_POLICY_PUBLISH"), [receipt, setReceipt] = useState<PhoneReceipt | null>(null);
    const [denied, setDenied] = useState(false);
    const live = useRef(true), generation = useRef(0), mutation = useRef(false);
    const syncPending = () => setPending(proposals.list().find(r => r.owner === owner) ?? null);
    async function refresh(preserveDraft = false) {
        const keepDraft = preserveDraft && values.some(v => v !== "");
        const id = ++generation.current;
        setLoading(true);
        setError("");
        setPolicy(null);
        try {
            const response = await fetchE6ComputeConfig();
            if (!live.current || id !== generation.current)
                return;
            const next = parsePhonePolicy(response.phoneBinding);
            if (!next)
                throw new Error("手机策略读取不完整，请重试。");
            setPolicy(next);
            if (!keepDraft) {
                setAllow(next.allowReplacement === true);
                setValues([next.minReplacementIntervalDays, next.replacementWindowDays, next.maxReplacementsInWindow].map(v => v == null ? "" : String(v)));
            }
        }
        catch (failure) {
            if (live.current && id === generation.current) {
                if (record(failure) && [401, 403].includes(Number(failure.status))) {
                    setDenied(true);
                    setPending(null);
                    setReceipt(null);
                    setConfirm(null);
                }
                setError(failure instanceof Error && !/[A-Z]{3}_/.test(failure.message) ? failure.message : "手机策略暂不可用，请重新读取。");
            }
        }
        finally {
            if (live.current && id === generation.current)
                setLoading(false);
        }
    }
    useEffect(() => { live.current = true; syncPending(); void refresh(); return () => { live.current = false; generation.current++; }; }, []);
    const draftError = phoneDraftError(values);
    const unchanged = !!policy && allow === policy.allowReplacement && values.every((v, i) => Number(v) === [policy.minReplacementIntervalDays, policy.replacementWindowDays, policy.maxReplacementsInWindow][i]);
    const blocked = loading || busy || !!confirm || !!pending || !canWrite || !policy?.policyVersion || denied;
    function preview() { if (blocked || draftError || unchanged || !policy?.policyVersion)
        return; setConfirm({ values: phonePolicyValues(allow, values), version: policy.policyVersion, before: policy }); setAck(false); setError(""); }
    async function submit() {
        if (mutation.current || !confirm || !ack || reason.trim().length < 8 || reason.trim().length > 200 || !canWrite || pending)
            return;
        mutation.current = true;
        setBusy(true);
        setError("");
        const def = findHighOp("e6_compute_config_batch")!;
        const input: ProposalInput = { action: "发布手机换机策略", obj: Object.keys(confirm.values).sort().join(","), beforeValue: `策略版本 ${confirm.version}；允许换机：${confirm.before.allowReplacement === null ? "未配置" : confirm.before.allowReplacement ? "是" : "否"}；间隔 ${confirm.before.minReplacementIntervalDays ?? "未配置"} 天；${confirm.before.replacementWindowDays ?? "未配置"} 天内最多 ${confirm.before.maxReplacementsInWindow ?? "未配置"} 次`,
            afterValue: `允许换机：${confirm.values["E.compute.phoneBinding.allowReplacement"] === "on" ? "是" : "否"}；间隔 ${values[0]} 天；${values[1]} 天内最多 ${values[2]} 次`,
            operator, operatorRole: "运营人员", type: "param", amplifies: true, sos: false, roleGate: "另一位有审批权的管理员", reason: reason.trim(), sourceDomain: "E6",
            command: def.buildCommand({ values: confirm.values, expectedPolicyVersion: confirm.version }), targets: def.buildTargets!({ values: confirm.values }) };
        const key = createA2CommandKey("phone-policy-proposal"), fingerprint = `${owner}|${key}`;
        proposals.remember(fingerprint, key, { owner, input });
        if (!proposals.isDurablyStored(fingerprint, key)) {
            proposals.forget(fingerprint, key);
            setError("浏览器无法保存恢复记录，请允许会话存储后再提交。");
            setBusy(false);
            mutation.current = false;
            return;
        }
        syncPending();
        try {
            const ticket = await createA2OperationProposal(input, key, true);
            if (!live.current)
                return;
            proposals.remember(fingerprint, key, { owner, input, ticketId: ticket.id });
            if (live.current) {
                syncPending();
                setConfirm(null);
                setMessage("申请已提交审批，尚不代表策略生效。请另一位审批人核对后批准。");
            }
        }
        catch (failure) {
            if (!isA2OutcomeUncertainError(failure))
                proposals.forget(fingerprint, key);
            if (live.current) {
                syncPending();
                setConfirm(null);
                if (record(failure) && [401, 403].includes(Number(failure.status))) {
                    setDenied(true);
                    setPolicy(null);
                    setPending(null);
                    setReceipt(null);
                }
                setError(isA2OutcomeUncertainError(failure) ? "审批提案结果暂不确定，原请求已保留。请查询审批队列，不要再次提交。" : (record(failure) ? phoneConflictMessage(failure.details) : null) ?? "审批提案被拒绝，请重新读取配置并核对权限、理由及版本。草稿已保留。");
            }
        }
        finally {
            mutation.current = false;
            if (live.current)
                setBusy(false);
        }
    }
    async function checkProposal() {
        if (!pending || !canRecover || mutation.current)
            return;
        mutation.current = true;
        setBusy(true);
        setError("");
        try {
            const original = await fetchA2ProposalByKey(pending.commandKey);
            if (!live.current)
                return;
            if (!original) {
                setMessage("暂未查到原提案，结果仍待核实。原操作标识已保留，不会重新提交。");
                return;
            }
            const id = original.id, status = original.status;
            const terminal = ["approved", "rejected", "withdrawn", "expired"].includes(status.toLowerCase()) ? status.toLowerCase() : undefined;
            proposals.remember(pending.fingerprint, pending.commandKey, { owner, input: pending.input, ticketId: id, terminal });
            syncPending();
            setMessage(terminal === "approved" ? "原提案已获批准。请刷新当前策略，并由执行审批人使用批准操作的原标识查询发布回执。" : terminal ? "原提案已结束。可核对审批记录后重新准备新变更。" : "提案仍待审批，尚未发布。");
        }
        catch (failure) {
            if (live.current) {
                if (record(failure) && [401, 403].includes(Number(failure.status))) {
                    setDenied(true);
                    setPolicy(null);
                    setPending(null);
                    setReceipt(null);
                    setConfirm(null);
                }
                setError("审批记录查询失败，请重试或前往审批页面；原提案仍保留。");
            }
        }
        finally {
            mutation.current = false;
            if (live.current)
                setBusy(false);
        }
    }
    async function query() {
        if (!canRecover || !lookup.trim() || mutation.current)
            return;
        mutation.current = true;
        setBusy(true);
        setError("");
        setReceipt(null);
        try {
            const result = await fetchPhoneOperation(mode === "id" ? { operationId: lookup.trim() } : { commandType: type, idempotencyKey: lookup.trim() });
            if (live.current) {
                setReceipt(result);
                setMessage(result ? "已读回原发布结果；当前策略可能已被后续发布改变。" : "暂未查到原发布结果，仍待核实。不会重新发布。");
            }
        }
        catch (failure) {
            if (live.current) {
                if (failure instanceof PhoneApiError && [401, 403].includes(failure.status)) {
                    setDenied(true);
                    setPolicy(null);
                    setPending(null);
                    setReceipt(null);
                    setConfirm(null);
                }
                setError(failure instanceof Error ? failure.message : "原结果查询失败。");
            }
        }
        finally {
            mutation.current = false;
            if (live.current)
                setBusy(false);
        }
    }
    return <section className="pane phone-admin-panel phone-policy-panel" data-proof="e6-phone-binding"><div className="pane-h"><span className="ttl">手机绑定与换机策略</span><span className="sub">后续换机统一规则</span></div><div className="phone-policy-body">
    <p>四项规则一起审批、同时生效。只约束后续换机；首次绑定、同绑定恢复及已运行的手机不受追溯影响。</p>
    {error && <p role="alert" className="phone-error">{error}</p>}{message && !denied && <p role="status">{message}</p>}
    {denied ? <p>当前没有查看原结果的权限，内容已隐藏，请返回。</p> : <>
    <div className="phone-actions"><button className="l-btn" disabled={loading || busy || !!confirm} onClick={() => void refresh(true)}>重新读取当前策略</button><Link href="/platform/audit?domain=E">查看审批记录</Link></div>
    {loading ? <p role="status">正在读取手机策略…</p> : !policy ? <p>策略读取失败，暂不可提交。</p> : <>
      <p>当前策略版本：{policy.policyVersion ?? "未取得"} · {policy.available ? "配置可用" : "当前配置不完整，请填齐四项后提交修复"}</p>
      <fieldset disabled={blocked}><legend>手机换机规则</legend><label><input type="checkbox" checked={allow} onChange={e => setAllow(e.target.checked)}/>允许更换绑定手机</label>
        <div className="phone-grid">{["换机最短间隔（天，0 表示不限）", "最近多少天内统计（1–365 天）", "最近这段时间内最多换机（1–100 次）"].map((label, i) => <label key={label}>{label}<input type="number" min={i === 0 ? 0 : 1} max={i === 1 ? 365 : i === 2 ? 100 : undefined} step={1} value={values[i]} onChange={e => setValues(current => current.map((v, j) => j === i ? e.target.value : v))}/></label>)}</div></fieldset>
      {draftError && <p role="status">{draftError}</p>}{!canWrite && <p>本页只读。整组提交需同时具备策略配置及开关提案权限。</p>}
      <button className="l-btn primary" disabled={blocked || !!draftError || unchanged} onClick={preview}>预览并确认策略变更</button>
    </>}
    {confirm && <div className="phone-record" aria-label="手机策略确认"><h4>确认整组策略变更</h4><div className="phone-grid"><div><h4>当前值 · 版本 {confirm.version}</h4><PhoneFacts value={{ allowReplacement: (confirm.before.allowReplacement ?? "未配置"), minReplacementIntervalDays: (confirm.before.minReplacementIntervalDays ?? "未配置"), replacementWindowDays: (confirm.before.replacementWindowDays ?? "未配置"), maxReplacementsInWindow: (confirm.before.maxReplacementsInWindow ?? "未配置") }}/></div><div><h4>目标值</h4><PhoneFacts value={{ allowReplacement: allow, minReplacementIntervalDays: Number(values[0]), replacementWindowDays: Number(values[1]), maxReplacementsInWindow: Number(values[2]) }}/></div></div>
      <p>按版本 {confirm.version} 提交。若他人先更新策略，本次审批会拒绝，须重新读取并确认。回滚也须按最新版本提交一份新变更。</p>
      <label>变更理由（8–200 字）<textarea maxLength={200} disabled={busy} value={reason} onChange={e => setReason(e.target.value)}/></label><label><input type="checkbox" disabled={busy} checked={ack} onChange={e => setAck(e.target.checked)}/>我已核对四项前后值，确认提交给另一位审批人</label>
      <div className="phone-actions"><button className="l-btn primary" disabled={busy || !ack || reason.trim().length < 8} onClick={() => void submit()}>提交审批</button><button className="l-btn" disabled={busy} onClick={() => setConfirm(null)}>取消</button></div></div>}
    {pending && !canRecover && <p>有原操作待核实，恢复当前处置权限后才能查看；暂不能发起新提案。</p>}
    {pending && canRecover && <div className="phone-record"><h4>原审批提案</h4><p>提交：{phoneTime(pending.createdAt)} · 原操作标识：{pending.commandKey}</p><p>审批单：{pending.ticketId ?? "结果待核实"}</p><details><summary>原策略与目标策略技术记录</summary><p>原值：{pending.input.beforeValue}</p><p>目标：{pending.input.afterValue}</p></details><p>理由：{pending.input.reason}</p>
      <button className="l-btn" disabled={busy} onClick={() => void checkProposal()}>只读查询审批结果</button>
      {pending.terminal && <button className="l-btn" disabled={busy} onClick={() => { proposals.forget(pending.fingerprint, pending.commandKey); syncPending(); void refresh(); }}>原提案已结束，准备新变更</button>}</div>}
    {canRecover && <details><summary>查询原发布结果</summary><p>使用发布操作号，或执行审批人批准时的原操作标识。提交提案的标识不能代替批准标识。</p><div className="phone-grid">
      <label>查询方式<select value={mode} onChange={e => setMode(e.target.value)}><option value="id">发布操作号</option><option value="key">批准操作的原标识</option></select></label>
      {mode === "key" && <label>发布类型<select value={type} onChange={e => setType(e.target.value)}><option value="PHONE_POLICY_PUBLISH">整组手机策略</option><option value="PHONE_POLICY_PARAM_PUBLISH">单项手机策略</option></select></label>}
      <label>{mode === "id" ? "发布操作号" : "当前审批人的批准操作标识"}<input maxLength={128} value={lookup} onChange={e => setLookup(e.target.value)}/></label></div><button className="l-btn" disabled={busy || !lookup.trim()} onClick={() => void query()}>只读查询原发布</button></details>}
    {receipt && <PhoneReceiptView receipt={receipt}/>}
    </>}
  </div></section>;
}
