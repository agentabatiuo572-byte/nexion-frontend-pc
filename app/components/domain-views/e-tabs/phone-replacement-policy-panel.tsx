"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { BlockState, Button, Check, ConfigList, ConfigRow, Decision, Drawer, Fact, Facts, Field, Fold, Input, Modal, Notice, NumberInput, Panel, Select, Textarea, ReleaseModal } from "@/app/components/rd";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
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
    const canWrite = rights.includes("device_e6_write") && rights.includes("device_e6_flag_toggle") && rights.some(r=>["platform_a2_write","platform_a2_proposal_create"].includes(r));
    const [editor,setEditor]=useState(false),[release,setRelease]=useState(false),[retryRejected,setRetryRejected]=useState(false),[discard,setDiscard]=useState(false);
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
                setConfirm(null); setEditor(false);
                setMessage("申请已提交审批，尚不代表策略生效。请另一位审批人核对后批准。");
            }
        }
        catch (failure) {
            if (isExplicitRejection(failure))
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
    async function retryOriginal() {
      if(!pending||mutation.current||isRetryExpired(pending)||!canWrite)return;
      mutation.current=true;setBusy(true);setError("");
      try {
        const original=await fetchA2ProposalByKey(pending.commandKey);
        if(original){await checkTicket(original.id,original.status);return;}
        const ticket=await createA2OperationProposal(pending.input,pending.commandKey,true);
        if(live.current){proposals.remember(pending.fingerprint,pending.commandKey,{owner,input:pending.input,ticketId:ticket.id});syncPending();setMessage("已找回原审批提案，请等待另一位审批人核对。");}
      } catch(failure){if(live.current){setError(failure instanceof Error?failure.message:"原操作结果仍未确认");if(isExplicitRejection(failure))setRetryRejected(true);}}
      finally{mutation.current=false;if(live.current)setBusy(false);}
    }
    async function checkTicket(id:string,status:string){
      if(!pending||!live.current)return;
      const terminal=["approved","rejected","withdrawn","expired"].includes(status.toLowerCase())?status.toLowerCase():undefined;
      proposals.remember(pending.fingerprint,pending.commandKey,{owner,input:pending.input,ticketId:id,terminal});syncPending();
      setMessage(terminal?"原提案已结束，请读回当前策略核对。":"提案仍待审批，尚未发布。");
    }
    return <Panel title="手机绑定与换机策略" icon={ArrowRightLeft} tone="role-3" sub={policy?`当前策略版本 ${policy.policyVersion??"未取得"} · 整组审批`:undefined} data-proof="e6-phone-binding" explain="四项规则一起审批、同时生效。只约束后续换机；首次绑定、同绑定恢复及已运行手机不受追溯影响。" actions={<><Button size="sm" disabled={loading||busy||!!confirm} onClick={()=>!unchanged&&editor?setDiscard(true):void refresh(true)}>重新读取当前策略</Button>{canWrite&&<Button size="sm" disabledReason={pending?"原提案待核查":!policy?.policyVersion?"未取得有效策略版本":undefined} onClick={()=>setEditor(true)}>修改换机规则</Button>}</>}>
      {error&&<Notice tone="warn">{error}</Notice>}{message&&!denied&&<Notice tone="neutral">{message}</Notice>}
      {denied?<BlockState state="denied" title="当前没有查看原结果的权限，内容已隐藏"/>:<>
        {loading?<BlockState state="loading" title="正在读取手机策略…"/>:!policy?<BlockState state="error" title="策略读取失败，暂不可提交" onRetry={()=>void refresh(true)}/>:<>
          {!policy.available&&<Notice tone="warn">策略不完整。有效版本存在时，可填齐四项后提交修复；没有版本时请先重新读取。</Notice>}
          <ConfigList label="手机换机当前规则"><ConfigRow name="允许更换绑定手机" what="是否允许后续更换绑定手机" when="四项批准后同时生效" value={policy.allowReplacement==null?"未配置":policy.allowReplacement?"开启":"关闭"}/><ConfigRow name="换机最短间隔" value={policy.minReplacementIntervalDays==null?"未配置":`${policy.minReplacementIntervalDays} 天`} note="0 表示不限间隔"/><ConfigRow name="换机统计窗口" value={policy.replacementWindowDays==null?"未配置":`${policy.replacementWindowDays} 天`}/><ConfigRow name="窗口内换机上限" value={policy.maxReplacementsInWindow==null?"未配置":`${policy.maxReplacementsInWindow} 次`}/></ConfigList>
        </>}
        {editor&&policy&&<Drawer open title="修改手机换机规则" icon={ArrowRightLeft} busy={busy} onClose={()=>setEditor(false)} footer={<Decision primary={<Button variant="primary" disabledReason={blocked?"当前只读、原提案待核查或版本未取得":draftError??(unchanged?"没有修改":undefined)} onClick={preview}>预览并确认策略变更</Button>} others={<Button onClick={()=>setEditor(false)}>取消</Button>}/> }>
          <Notice tone="neutral">四项一起提交审批；按策略版本 {policy.policyVersion??"未取得"} 核对，只影响后续换机资格。</Notice>
          <Check label="允许更换绑定手机" checked={allow} disabled={blocked} onChange={e=>setAllow(e.target.checked)}/><div className="e6-form-grid">{["换机最短间隔（天，0 表示不限）","最近多少天内统计（1–365 天）","最近这段时间内最多换机（1–100 次）"].map((label,i)=><Field key={label} label={label}><NumberInput min={i===0?0:1} max={i===1?365:i===2?100:undefined} step={1} value={values[i]} disabled={blocked} unit={i===2?"次":"天"} onChange={e=>setValues(current=>current.map((v,j)=>j===i?e.target.value:v))}/></Field>)}</div>{draftError&&<Notice tone="warn">{draftError}</Notice>}
        </Drawer>}
        {confirm&&<Modal title="确认整组手机换机策略变更" busy={busy} onClose={()=>setConfirm(null)} footer={<Decision primary={<Button variant="primary" disabled={busy||!ack||reason.trim().length<8||reason.trim().length>200} onClick={()=>void submit()}>提交审批</Button>} others={<Button disabled={busy} onClick={()=>setConfirm(null)}>取消</Button>}/> }>
          <Facts><Fact k="原策略版本">{confirm.version}</Fact><Fact k="允许换机">{confirm.before.allowReplacement==null?"未配置":confirm.before.allowReplacement?"开启":"关闭"} → {allow?"开启":"关闭"}</Fact><Fact k="最短间隔">{confirm.before.minReplacementIntervalDays??"未配置"} → {values[0]} 天</Fact><Fact k="统计窗口">{confirm.before.replacementWindowDays??"未配置"} → {values[1]} 天</Fact><Fact k="次数上限">{confirm.before.maxReplacementsInWindow??"未配置"} → {values[2]} 次</Fact></Facts>
          <p>四项批准后同时生效；只约束后续换机，不追溯已有运行手机。若他人先更新策略，须重新读取并确认。</p>
          <Field label="变更理由（8–200 字）" required><Textarea maxLength={200} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></Field><Check disabled={busy} checked={ack} onChange={e=>setAck(e.target.checked)} label="我已核对四项前后值，确认提交给另一位审批人"/>
        </Modal>}
        {pending&&!canRecover&&<Notice tone="warn">有原操作待核实，恢复当前处置权限后才能查看；暂不能发起新提案。</Notice>}
        {pending&&canRecover&&<Notice tone="warn" title="原审批提案 · 结果待核对" actionBelow action={<><Button size="sm" disabled={busy} onClick={()=>void checkProposal()}>只读查询审批结果</Button>{!pending.ticketId&&!isRetryExpired(pending)&&canWrite&&<Button size="sm" disabled={busy} onClick={()=>void retryOriginal()}>按原操作重试</Button>}{retryRejected&&<Button size="sm" onClick={()=>setRelease(true)}>解除待确认</Button>}{pending.terminal&&<Button size="sm" disabled={busy} onClick={()=>{proposals.forget(pending.fingerprint,pending.commandKey);syncPending();void refresh();}}>原提案已结束，准备新变更</Button>}</>}>
          <p>提交：{phoneTime(pending.createdAt)} · 审批单：{pending.ticketId??"结果待核实"}</p><p>原值：{pending.input.beforeValue}</p><p>目标：{pending.input.afterValue}</p>{isRetryExpired(pending)&&<p>{RETRY_EXPIRED_TEXT}</p>}
          <Fold title="原策略与目标策略技术记录" summary={pending.commandKey} inset><p>理由：{pending.input.reason}</p><p>原操作标识：{pending.commandKey}</p><pre className="e6-json">{JSON.stringify(pending.input,null,2)}</pre></Fold>
        </Notice>}
        {canRecover&&<Fold title="查询原发布结果" summary="按发布操作号或批准时的原标识查询" inset><p>提交提案的标识不能代替批准标识。原发布结果与当前策略分别显示。</p><div className="e6-form-grid"><Field label="查询方式"><Select aria-label="查询方式" value={mode} onChange={setMode} options={[{value:"id",label:"发布操作号"},{value:"key",label:"批准操作的原标识"}]}/></Field>{mode==="key"&&<Field label="发布类型"><Select aria-label="发布类型" value={type} onChange={setType} options={[{value:"PHONE_POLICY_PUBLISH",label:"整组手机策略"},{value:"PHONE_POLICY_PARAM_PUBLISH",label:"单项手机策略"}]}/></Field>}<Field label={mode==="id"?"发布操作号":"当前审批人的批准操作标识"}><Input maxLength={128} value={lookup} onChange={e=>setLookup(e.target.value)}/></Field></div><Button size="sm" disabled={busy||!lookup.trim()} onClick={()=>void query()}>只读查询原发布</Button></Fold>}
        {receipt&&<PhoneReceiptView receipt={receipt}/>}
        {rights.includes("platform_a2_read")&&<Link href="/platform/audit?domain=E">查看审批记录</Link>}
      </>}
      {release&&pending&&<ReleaseModal label="原手机换机策略提案" onCancel={()=>setRelease(false)} onConfirm={()=>{proposals.forget(pending.fingerprint,pending.commandKey);syncPending();setRelease(false);void refresh();}}/>}
      {discard&&<Modal title="刷新会放弃未提交草稿" onClose={()=>setDiscard(false)} footer={<Decision primary={<Button variant="primary" onClick={()=>{setDiscard(false);void refresh();}}>放弃草稿并刷新</Button>} others={<Button onClick={()=>setDiscard(false)}>继续编辑</Button>}/> }><p>将放弃换机规则普通草稿；原提案和待确认记录继续保留。</p></Modal>}
    </Panel>;
}
