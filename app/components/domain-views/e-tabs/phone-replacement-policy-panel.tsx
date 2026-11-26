"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRightLeft } from "lucide-react";
import { BlockState, Button, Check, ConfigList, ConfigRow, Decision, DiffList, Drawer, Fact, Facts, Field, Fold, Input, Modal, Notice, NumberInput, Panel, Select, ReleaseModal } from "@/app/components/rd";
import { OperationConfirmModal } from "../design-kit";
import { explicitRejectionCode } from "@/lib/admin/explicit-rejection";
import { isDeterministicRejection } from "@/lib/admin/outcome-classification";
import { canReadOwnRecoveryProposal, currentRecoveryActor, canCreateRecoveryProposal } from "@/lib/admin/abe-recovery-access";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { displayAdminError } from "@/lib/admin/error-messages";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { fetchE6ComputeConfig } from "@/lib/admin/e6-client";
import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { createPendingMutationStore, createPendingRecovery, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { fetchPhoneOperation, PhoneApiError } from "@/lib/admin/phone-replacement-client";
import { canReadPolicyReceipt, parsePhonePolicy, phoneFields, phonePrefix, phoneDraftError, phonePolicyValues, phoneConflictMessage, record, type PhonePolicy, type PhoneReceipt } from "@/lib/admin/phone-replacement-contract";
import { PhoneFacts, PhoneReceiptView } from "../phone-replacement-receipt";
import { useRecoveryDraftDiscard } from "../recovery-draft-discard";
import { rebaseRecoveryFields } from "@/lib/admin/abe-recovery-access";
import { PROPOSAL_END } from "./e-command-check";
type ProposalInput = Parameters<typeof createA2OperationProposal>[0];
interface SavedProposal extends PendingMutationRecord {
    owner: number;
    input: ProposalInput;
    baseline?: Record<string, string>;
    ticketId?: string;
    terminal?: string;
    absent?: boolean;
}
const policyFieldLabels = ["允许更换绑定手机", "换机最短间隔", "换机统计窗口", "窗口内换机上限"];
function policyBaseline(policy: PhonePolicy) {
    return Object.fromEntries(phoneFields.map(field => {
        const value = policy[field];
        return [phonePrefix + field, value == null ? "" : typeof value === "boolean" ? value ? "on" : "off" : String(value)];
    }));
}
function originalPolicyBaseline(original: SavedProposal) {
    if (original.baseline) return original.baseline;
    const before = /^策略版本 \d+；允许换机：(是|否|未配置)；间隔 (\d+|未配置) 天；(\d+|未配置) 天内最多 (\d+|未配置) 次$/.exec(original.input.beforeValue);
    if (!before) return null;
    return Object.fromEntries(phoneFields.map((field, i) => [phonePrefix + field, before[i + 1] === "未配置" ? ""
        : i === 0 ? before[1] === "是" ? "on" : "off" : before[i + 1]]));
}
const proposals = createPendingMutationStore<SavedProposal>({ storageKey: "nexion-admin-phone-policy-proposals-v1", retainExpiredRecords: true,
    isValidRecord: r => (r.absent === undefined || typeof r.absent === "boolean") && Number.isSafeInteger(r.owner) && record(r.input) && record(r.input.command) });
const policyRecovery = createPendingRecovery(proposals, {
    capability: () => "receipt",
    explicitRejectionCode,
    canReplay: original => {
        const rights = currentRecoveryActor(original.owner)?.authorities ?? [];
        return !original.ticketId && !original.terminal && rights.includes("device_e6_read")
            && rights.includes("device_e6_write") && rights.includes("device_e6_flag_toggle") && canCreateRecoveryProposal(rights);
    },
});
export function PhoneReplacementPolicyPanel({configReadFailed=false}:{configReadFailed?:boolean}) {
    const session = useAdminAuth(s => s.session), epoch = useAdminAuth(s => s.authEpoch);
    if (!session?.authorities.includes("device_e6_read"))
        return null;
    return <PolicyEditor key={`${session.adminId}:${epoch}`} owner={session.adminId} operator={session.operator || session.username} rights={session.authorities} configReadFailed={configReadFailed}/>;
}
function PolicyEditor({ owner, operator, rights, configReadFailed }: {
    owner: number;
    operator: string;
    rights: string[];
    configReadFailed: boolean;
}) {
    const canWrite = rights.includes("device_e6_write") && rights.includes("device_e6_flag_toggle") && rights.some(r=>["platform_a2_write","platform_a2_proposal_create"].includes(r));
    const [editor,setEditor]=useState(false),[releaseKey,setReleaseKey]=useState<string|null>(null),[discard,setDiscard]=useState(false);
    const discardRecovery = useRecoveryDraftDiscard();
    const [recoveryDraft, setRecoveryDraft] = useState<SavedProposal | null>(null);
    const canRecover = canReadPolicyReceipt(rights);
    const canQueryProposal = canReadOwnRecoveryProposal(rights);
    const [policy, setPolicy] = useState<PhonePolicy | null>(null), [values, setValues] = useState(["", "", ""]), [allow, setAllow] = useState(false);
    const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
    const [confirm, setConfirm] = useState<{
        values: Record<string, string>;
        version: number;
        before: PhonePolicy;
    } | null>(null);
    const [otherChanges, setOtherChanges] = useState<{ key: string; label: string; before: string; after: string }[]>([]);
    const openEditor = useRef(false);
    openEditor.current = editor || !!confirm;
    const [ack, setAck] = useState(false), [records, setRecords] = useState<SavedProposal[]>([]);
    const activePending = records.find(row => !row.terminal);
    const pending = activePending ?? records.at(-1);
    const [lookup, setLookup] = useState(""), [mode, setMode] = useState("id"), [type, setType] = useState("PHONE_POLICY_PUBLISH"), [receipt, setReceipt] = useState<PhoneReceipt | null>(null);
    const [queryMessage,setQueryMessage]=useState(""),[queryError,setQueryError]=useState("");
    const [denied, setDenied] = useState(false);
    const live = useRef(true), generation = useRef(0), mutation = useRef(false);
    const syncPending = () => setRecords(proposals.list().filter(r => r.owner === owner));
    useSyncExternalStore(policyRecovery.subscribe, policyRecovery.getRevision, () => 0);
    const recoveryState = pending ? policyRecovery.state(pending) : undefined;
    const retryRejectedKey = recoveryState?.replayRejection ? pending?.commandKey : undefined;
    useEffect(() => { setReleaseKey(null); setMessage(""); }, [pending?.commandKey]);
    useEffect(() => {
        if (!recoveryState || recoveryState.expired) return;
        const timer = window.setTimeout(syncPending, recoveryState.expiresAt - Date.now());
        return () => window.clearTimeout(timer);
    }, [recoveryState?.expiresAt]);
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
            return next;
        }
        catch (failure) {
            if (live.current && id === generation.current) {
                if (record(failure) && [401, 403].includes(Number(failure.status))) {
                    setDenied(true);
                    setRecords([]);
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
    const unchanged = !!policy && allow === (policy.allowReplacement === true) && values.every((v, i) => {
        const current = [policy.minReplacementIntervalDays, policy.replacementWindowDays, policy.maxReplacementsInWindow][i];
        return current == null ? v === "" : v !== "" && Number(v) === current;
    });
    const blocked = loading || busy || !!confirm || !!activePending || !canWrite || !policy?.policyVersion || denied;
    function preview() { if (blocked || draftError || unchanged || !policy?.policyVersion)
        return; setConfirm({ values: phonePolicyValues(allow, values), version: policy.policyVersion, before: policy }); setAck(false); setError(""); }
    async function submit(reason: string) {
        if (mutation.current || !confirm || !ack || reason.trim().length < 8 || reason.trim().length > 200 || !canWrite || activePending)
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
        const baseline = policyBaseline(confirm.before);
        proposals.remember(fingerprint, key, { owner, input, baseline });
        if (!proposals.isDurablyStored(fingerprint, key)) {
            proposals.forget(fingerprint, key);
            setError("浏览器没能记下这次操作，这次没有发出；请关闭无痕模式或允许本站保存数据后再试。");
            setBusy(false);
            mutation.current = false;
            return;
        }
        syncPending();
        const consumeDraft = () => {
            if (!recoveryDraft) return;
            proposals.forget(recoveryDraft.fingerprint, recoveryDraft.commandKey);
            if (live.current) setRecoveryDraft(null);
        };
        try {
            const ticket = await createA2OperationProposal(input, key, true);
            consumeDraft();
            if (!live.current)
                return;
            proposals.remember(fingerprint, key, { owner, input, baseline, ticketId: ticket.id });
            if (live.current) {
                syncPending();
                setConfirm(null); setEditor(false);
                setMessage("申请已提交审批，尚不代表策略生效。请另一位超级管理员核对后批准。");
            }
        }
        catch (failure) {
            const response = failure as { httpStatus?: number; apiCode?: number };
            const firstRejection = !isA2OutcomeUncertainError(failure) && response.httpStatus !== undefined
                && isDeterministicRejection(response.httpStatus, response.apiCode);
            if (firstRejection) proposals.forget(fingerprint, key);
            else if (proposals.isDurablyStored(fingerprint, key)) consumeDraft();
            if (live.current) {
                syncPending();
                if (!firstRejection) setConfirm(null);
                if (!firstRejection && record(failure) && [401, 403].includes(Number(failure.status))) {
                    setDenied(true);
                    setPolicy(null);
                    setRecords([]);
                    setReceipt(null);
                }
                // 结果未知时提示条已经说明，这里不再另写一句；被拒时写原因。
                setError(isA2OutcomeUncertainError(failure) ? "" : (record(failure) ? phoneConflictMessage(failure.details) : null) ?? (failure instanceof Error ? `${displayAdminError(failure)} 草稿已保留。` : "审批提案被拒绝，请重新读取配置并核对权限、理由及版本。草稿已保留。"));
            }
            throw failure;
        }
        finally {
            mutation.current = false;
            if (live.current)
                setBusy(false);
        }
    }
    async function checkProposal(propagate = false) {
        if (!pending || !canQueryProposal || mutation.current)
            return;
        if (useAdminAuth.getState().session?.adminId !== pending.owner) throw new Error("审批记录查询失败，请重试或前往审批页面；原提案仍保留。");
        mutation.current = true;
        setBusy(true);
        setError("");
        try {
            const result = await policyRecovery.query(pending, async saved => {
                const ticket = await fetchA2ProposalByKey(saved.commandKey, true, "f");
                if (!ticket && saved.ticketId || ticket && (!ticket.mine || ticket.obj !== saved.input.obj
                    || saved.ticketId && ticket.id !== saved.ticketId || ticket.operationCode && ticket.operationCode !== saved.input.command.op)) {
                    throw new Error("审批记录查询失败，请重试或前往审批页面；原提案仍保留。");
                }
                return { ticket, conclusion: !ticket ? "not-found" : ticket.status === "pending" ? "unknown"
                    : ticket.status === "approved" ? "succeeded" : "rejected" } as const;
            });
            if (!live.current || !result) return;
            if (!result.ticket) {
                setMessage(policyRecovery.state(pending).expired ? RETRY_EXPIRED_TEXT : "按原请求查不到这张审批单，可以按原操作重试。");
                return;
            }
            const { id, status } = result.ticket;
            const terminal = ["approved", "rejected", "withdrawn", "expired"].includes(status) ? status : undefined;
            proposals.remember(pending.fingerprint, pending.commandKey, { ...pending, ticketId: id, terminal });
            syncPending();
            setMessage(terminal === "approved" ? "审批已通过。请刷新当前策略；发布结果由批准人在「查询原发布结果」里查。" : terminal ? PROPOSAL_END[terminal].text : "还在等批准，没有发布。");
        }
        catch (failure) {
            if (live.current) {
                if (record(failure) && [401, 403].includes(Number(failure.status))) {
                    setDenied(true);
                    setPolicy(null);
                    setRecords([]);
                    setReceipt(null);
                    setConfirm(null);
                }
                setError(pending.ticketId ? "这次没查到审批进度；审批单已经建了，稍后再查，不会再建一张。" : "这次没查到审批记录，请稍后再查或到审批页面核对；原请求保留。");
            }
            if (propagate) throw failure;
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
        setQueryError(""); setQueryMessage("");
        setReceipt(null);
        try {
            const result = await fetchPhoneOperation(mode === "id" ? { operationId: lookup.trim() } : { commandType: type, idempotencyKey: lookup.trim() });
            if (live.current) {
                setReceipt(result);
                setQueryMessage(result ? "已重新读到原发布结果；当前策略可能已被后续发布改变。" : "暂未查到原发布结果，仍待核实。不会重新发布。");
            }
        }
        catch (failure) {
            if (live.current) {
                if (failure instanceof PhoneApiError && [401, 403].includes(failure.status)) {
                    setDenied(true);
                    setPolicy(null);
                    setRecords([]);
                    setReceipt(null);
                    setConfirm(null);
                }
                setQueryError(failure instanceof Error ? failure.message : "原结果查询失败。");
            }
        }
        finally {
            mutation.current = false;
            if (live.current)
                setBusy(false);
        }
    }
    async function retryOriginal() {
        // 当前策略没读到（读取失败）时不能重发，和新提交同一道门（OP-128、ST-34）。
        if (!pending || !policy || mutation.current || policyRecovery.state(pending).replayBlock) return;
        mutation.current = true; setBusy(true); setError(""); setMessage("");
        try {
            const ticket = await policyRecovery.replay(pending, original => createA2OperationProposal(original.input, original.commandKey, true));
            if (live.current) {
                proposals.remember(pending.fingerprint, pending.commandKey, { ...pending, ticketId: ticket.id });
                syncPending();
                setMessage("已找回原审批提案，请等待另一位超级管理员核对。");
            }
        } catch (failure) {
            if (live.current) setError(displayAdminError(failure));
        } finally {
            mutation.current = false;
            if (live.current) { setBusy(false); syncPending(); }
        }
    }
    async function prepareNewChange(original: SavedProposal) {
        if (openEditor.current || busy || !canWrite || !original.terminal) return;
        const saved = proposals.list().find(row => row.commandKey === original.commandKey && row.terminal === original.terminal);
        if (!saved) return;
        const base = saved.terminal === "approved" ? null : originalPolicyBaseline(saved);
        const desired = saved.input.command.params.values;
        if (saved.terminal !== "approved" && (!base || !record(desired) || !phoneFields.every(field => typeof desired[phonePrefix + field] === "string"))) {
            setError("原申请缺少可核对的策略基线，请到操作记录与审批核对。");
            return;
        }
        const latest = await refresh(true);
        if (!latest || openEditor.current) return;
        const current = policyBaseline(latest);
        if (base && record(desired)) {
            const merged = rebaseRecoveryFields(base, desired as Record<string, string>, current);
            const display = (value: string) => value === "on" ? "开启" : value === "off" ? "关闭" : value || "未配置";
            setOtherChanges(phoneFields.map((field, i) => {
                const key = phonePrefix + field;
                return { key, label: policyFieldLabels[i], before: display(base[key]), after: display(current[key]) };
            }).filter(row => row.before !== row.after));
            setAllow(merged[phonePrefix + phoneFields[0]] === "on");
            setValues(phoneFields.slice(1).map(field => merged[phonePrefix + field]));
            setRecoveryDraft(saved);
        } else {
            setOtherChanges([]);
            setAllow(current[phonePrefix + phoneFields[0]] === "on");
            setValues(phoneFields.slice(1).map(field => current[phonePrefix + field]));
            setRecoveryDraft(null);
            proposals.forget(saved.fingerprint, saved.commandKey);
            syncPending();
        }
        setEditor(true);
    }
    const closeEditor = () => {
        setEditor(false); setRecoveryDraft(null); setOtherChanges([]);
        if (policy) {
            const current = policyBaseline(policy);
            setAllow(current[phonePrefix + phoneFields[0]] === "on");
            setValues(phoneFields.slice(1).map(field => current[phonePrefix + field]));
        }
    };
    // 原提交的提醒和按钮：编辑抽屉开着时放进抽屉顶上，运营不用关抽屉找；抽屉关着时放在面板里。只放一处。
    const inDrawer=editor&&!!policy;
    const recovery=pending&&<>
      {pending&&!canRecover&&<Notice tone="warn">有一次换机规则提交还没有结论，恢复处置权限后才能查看；暂不能发起新提案。</Notice>}
      {pending&&(canQueryProposal || canWrite)&&pending.ticketId&&!pending.terminal&&<Notice tone="warn" action={<Button size="sm" disabled={busy} onClick={()=>void checkProposal()}>查询审批结果</Button>}><p>手机换机规则的变更已提交，等待审批 · <span data-mono>{pending.ticketId}</span></p>{error&&<p role="status">{error}</p>}{message&&!error&&<p role="status">{message}</p>}</Notice>}
      {pending&&(canQueryProposal || canWrite)&&(!pending.ticketId||pending.terminal)&&<Notice tone={pending.terminal?"done":"warn"} title={pending.terminal?`换机规则审批${PROPOSAL_END[pending.terminal]?.tag ?? "已结束"}`:retryRejectedKey===pending.commandKey?"按原操作重试被拒绝":"换机规则提交结果未知"} actionBelow action={<>{!pending.terminal&&canQueryProposal&&<Button size="sm" disabled={busy} onClick={()=>void checkProposal()}>查询原操作</Button>}{!pending.ticketId&&!recoveryState?.expired&&canWrite&&retryRejectedKey!==pending.commandKey&&<Button size="sm" disabled={busy || !!recoveryState?.replayBlock || !policy} disabledReason={!policy ? "当前策略没读到，读到后才能重试" : undefined} onClick={()=>void retryOriginal()}>按原操作重试</Button>}{(retryRejectedKey===pending.commandKey&&!pending.ticketId)&&<Button variant="ghost" size="sm" onClick={()=>setReleaseKey(pending.commandKey)}>核实后解除</Button>}{pending.terminal&&<Button size="sm" disabled={busy || editor || !!confirm || !canWrite} onClick={()=>void prepareNewChange(pending)}>准备新变更</Button>}{pending.terminal && pending.terminal !== "approved" && <Button size="sm" disabled={busy || editor || !!confirm} onClick={() => discardRecovery.ask(() => {
        proposals.forget(pending.fingerprint, pending.commandKey); syncPending();
      })}>放弃这份草稿</Button>}</>}>
      {retryRejectedKey===pending.commandKey&&!pending.terminal?<><p>拒绝原因：{error||recoveryState?.replayRejection}</p><p>核对后可以解除这条记录。</p></>:<><p>{pending.terminal?"刷新当前策略核对后，再准备新变更。":recoveryState?.expired?RETRY_EXPIRED_TEXT:"原内容和理由都已保存。不知道审批单建没建成，可以查询原操作，或按原操作重试，不会重复建单。"}</p>{error&&<p role="status">{error}</p>}</>}{message&&<p>{message}</p>}<p>提交：{formatBusinessTimeCompact(new Date(pending.createdAt).toISOString(),"—")}（{businessZone().label}）{pending.ticketId&&<> · 审批单：<span data-mono>{pending.ticketId}</span></>}</p><p>原值：{pending.input.beforeValue}</p><p>目标：{pending.input.afterValue}</p>
      <Fold title="原策略与目标策略技术记录" summary="操作编号与原文" inset><div className="e6-fold-content"><p>理由：{pending.input.reason}</p><p>操作编号：<code>{pending.commandKey}</code></p><pre className="e6-json">{JSON.stringify(pending.input,null,2)}</pre></div></Fold>
      </Notice>}
    </>;
    return <Panel title="手机绑定与换机策略" icon={ArrowRightLeft} tone="role-3" sub={policy?`当前策略版本 ${policy.policyVersion??"未取得"} · 整组审批`:undefined} data-proof="e6-phone-binding" explain="四项规则一起审批、同时生效。只约束后续换机；首次绑定、同绑定恢复及已运行手机不受追溯影响。" actions={<>{policy&&<Button size="sm" disabled={loading||busy||!!confirm} onClick={()=>policy&&!unchanged?setDiscard(true):void refresh(true)}>刷新</Button>}{canWrite&&<Button size="sm" disabledReason={activePending?"上一次提交还没有结论":!policy?.policyVersion?"未取得有效策略版本":undefined} onClick={()=>{closeEditor();setEditor(true);}}>修改换机规则</Button>}</>}>
      {discardRecovery.dialog}
      {error&&policy&&!pending&&!inDrawer&&<Notice tone="warn">{error}</Notice>}{message&&!denied&&!pending&&<Notice tone="neutral">{message}</Notice>}
      {denied?<BlockState state="denied" title="当前没有查看原结果的权限，内容已隐藏"/>:<>
        {loading?<BlockState state="loading" title="正在加载手机策略…"/>:!policy?configReadFailed?<BlockState state="empty" title="等设备配置读取成功后可用"/>:<BlockState state="error" title="策略加载失败，暂不可提交" detail={error} onRetry={()=>void refresh(true)}/>:<>
          {!policy.available&&<Notice tone="warn">策略不完整。有效版本存在时，可填齐四项后提交修复；没有版本时请先重新读取。</Notice>}
          <ConfigList label="手机换机当前规则"><ConfigRow name="允许更换绑定手机" what="是否允许后续更换绑定手机" when="四项批准后同时生效" value={policy.allowReplacement==null?"未配置":policy.allowReplacement?"开启":"关闭"}/><ConfigRow name="换机最短间隔" value={policy.minReplacementIntervalDays==null?"未配置":`${policy.minReplacementIntervalDays} 天`} note="0 表示不限间隔"/><ConfigRow name="换机统计窗口" value={policy.replacementWindowDays==null?"未配置":`${policy.replacementWindowDays} 天`}/><ConfigRow name="窗口内换机上限" value={policy.maxReplacementsInWindow==null?"未配置":`${policy.maxReplacementsInWindow} 次`}/></ConfigList>
        </>}
        {editor&&policy&&<Drawer open title="修改手机换机规则" icon={ArrowRightLeft} busy={busy} onClose={closeEditor} footer={<Decision primary={<Button variant="primary" disabledReason={activePending?"上一次提交还没有结论，先处理上面的提示":blocked?"当前只读或版本未取得":draftError||(unchanged?"没有修改":undefined)} onClick={preview}>预览并确认策略变更</Button>} others={<Button onClick={closeEditor}>取消</Button>}/> }>
          {recovery}{activePending&&<p className="e6-help">{retryRejectedKey===activePending.commandKey?"解除这条记录后才能再改这组规则，所以输入框是灰的。":"这次提交有结论前不能改这组规则，所以输入框是灰的。"}</p>}
          {error&&!activePending&&!confirm&&<Notice tone="warn">{error}</Notice>}
          {unchanged&&<p className="e6-help">没有修改，请先调整需要变更的规则。</p>}
          {otherChanges.length > 0 && <Fold inset title="别人改了什么" summary="核对完整前后值"><DiffList rows={otherChanges}/></Fold>}
          <Notice tone="neutral">四项一起提交审批；按策略版本 {policy.policyVersion??"未取得"} 核对，只影响后续换机资格。</Notice>
          <Check label="允许更换绑定手机" checked={allow} disabled={blocked} onChange={e=>setAllow(e.target.checked)}/><div className="e6-form-grid">{["换机最短间隔","换机统计窗口","窗口内换机上限"].map((label,i)=><Field key={label} label={label.split("（")[0]} help={i===0?"非负整数天，0 表示不限间隔":i===1?"1–365 整数天":"1–100 整数次"} error={draftError&&(!/^\d+$/.test(values[i])||i===0&&draftError.startsWith("换机间隔")||i===1&&draftError.startsWith("滚动窗口")||i===2&&draftError.startsWith("窗口内上限"))?draftError:undefined}><NumberInput min={i===0?0:1} max={i===1?365:i===2?100:undefined} step={1} value={values[i]} disabled={blocked} unit={i===2?"次":"天"} onChange={e=>setValues(current=>current.map((v,j)=>j===i?e.target.value:v))}/></Field>)}</div>
        </Drawer>}
        {confirm&&<OperationConfirmModal action="发布手机换机规则" briefKind="config" statedBrief={{impact:"四项批准后同时生效，只约束后续换机，不追溯已有运行手机。",check:"核对四项原值、目标值与策略版本，提交给另一位超级管理员。"}} detail="四项批准后同时生效，只约束后续换机。若他人先更新策略，须重新读取并确认。" completionCopy="由另一位超级管理员核对并批准。" reasonMin={8} reasonMax={200} confirmLabel="提交审批" blockedReason={!ack?"请先勾选下方的核对确认":undefined} onClose={()=>setConfirm(null)} onConfirm={submit}
          facts={<Facts><Fact k="原策略版本">{confirm.version}</Fact>{[
            {key:"allow",label:"允许更换绑定手机",before:confirm.before.allowReplacement==null?"未配置":confirm.before.allowReplacement?"开启":"关闭",after:confirm.values["E.compute.phoneBinding.allowReplacement"]==="on"?"开启":"关闭"},
            {key:"interval",label:"换机最短间隔",before:confirm.before.minReplacementIntervalDays==null?"未配置":`${confirm.before.minReplacementIntervalDays} 天`,after:`${confirm.values["E.compute.phoneBinding.minReplacementIntervalDays"]} 天`},
            {key:"window",label:"换机统计窗口",before:confirm.before.replacementWindowDays==null?"未配置":`${confirm.before.replacementWindowDays} 天`,after:`${confirm.values["E.compute.phoneBinding.replacementWindowDays"]} 天`},
            {key:"limit",label:"窗口内换机上限",before:confirm.before.maxReplacementsInWindow==null?"未配置":`${confirm.before.maxReplacementsInWindow} 次`,after:`${confirm.values["E.compute.phoneBinding.maxReplacementsInWindow"]} 次`},
          ].filter(row=>row.before!==row.after).map(row=><Fact key={row.key} k={row.label}><DiffList rows={[row]}/></Fact>)}</Facts>}
          content={<Check disabled={busy} checked={ack} onChange={e=>setAck(e.target.checked)} label="我已核对四项前后值，确认提交给另一位超级管理员"/>}/>
        }
        {!inDrawer&&recovery}
        {canRecover&&<Fold title="查询原发布结果" summary="按发布操作号或批准时的原标识查询" inset><div className="e6-fold-content"><p>提交提案的标识不能代替批准标识。原发布结果与当前策略分别显示。</p><div className="e6-form-grid"><Field label="查询方式"><Select aria-label="查询方式" value={mode} onChange={setMode} options={[{value:"id",label:"发布操作号"},{value:"key",label:"批准操作的原标识"}]}/></Field>{mode==="key"&&<Field label="发布类型"><Select aria-label="发布类型" value={type} onChange={setType} options={[{value:"PHONE_POLICY_PUBLISH",label:"整组手机策略"},{value:"PHONE_POLICY_PARAM_PUBLISH",label:"单项手机策略"}]}/></Field>}<Field label={mode==="id"?"发布操作号":"当前审批人的批准操作标识"}><Input maxLength={128} value={lookup} onChange={e=>setLookup(e.target.value)}/></Field></div><Button size="sm" disabled={busy||!lookup.trim()} onClick={()=>void query()}>只读查询原发布</Button>{queryMessage&&<Notice tone="neutral">{queryMessage}</Notice>}{queryError&&<Notice tone="warn">{queryError}</Notice>}{receipt&&<PhoneReceiptView receipt={receipt}/>}</div></Fold>}
        {rights.includes("platform_a2_read")&&<Link href="/platform/audit?domain=E">查看审批记录</Link>}
      </>}
      {releaseKey&&pending&&releaseKey===pending.commandKey&&<ReleaseModal label="原手机换机策略提案" onCancel={()=>setReleaseKey(null)} onConfirm={()=>{
        if (policyRecovery.releaseRejectedReplay(pending)) { syncPending(); setReleaseKey(null); }
      }}/>}
      {discard&&<Modal title="刷新会放弃未提交草稿" onClose={()=>setDiscard(false)} footer={<Decision danger={<Button variant="danger-outline" onClick={()=>{setDiscard(false);void refresh();}}>放弃草稿并刷新</Button>} others={<Button onClick={()=>setDiscard(false)}>继续编辑</Button>}/> }><p>将放弃换机规则普通草稿；原提案和原操作记录继续保留。</p></Modal>}
    </Panel>;
}
