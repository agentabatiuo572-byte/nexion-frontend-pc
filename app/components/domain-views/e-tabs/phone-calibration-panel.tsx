"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { Btn, OperationConfirmModal } from "../design-kit";
import type { EViewCtx } from "./types";
import { Activity, Cpu, Gauge, Send, Smartphone } from "lucide-react";
import { BlockState, Button, Check, Conclusion, Explain, Decision, Field, Fold, Input, Modal, Notice, NumberInput, Panel, ScaleBar, Segments, Select, Stat, StatBand, Table, Td, Th, Tr, Textarea, Facts, Fact } from "@/app/components/rd";
import { E6PendingNotice, useE6Mutations } from "./e6-mutations";
import { createA2CommandKey } from "@/lib/admin/a2-client";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { displayAdminError } from "@/lib/admin/error-messages";
import { fetchPhoneCalibration, fetchPhoneCalibrationDirection, previewPhoneCalibration, phoneProposalError,
  type PhoneCalibrationOverview, type PhonePolicyProposal, type PhoneHardware, type PhonePreview, type PhoneTrialFacts } from "@/lib/admin/phone-calibration-client";
import { NO_REMOVALS, diffAndroidRules, type AndroidPresetRemovals, type AndroidSocRule } from "@/lib/admin/android-soc-rules";
import { AndroidSocTiersSection } from "./android-soc-tiers-section";
import { diffIosRules, IOS_CHANGE_LABELS, formatRange, type IosModelRule } from "@/lib/admin/ios-model-rules";
import { IosModelRulesSection } from "./ios-model-rules-section";

import { RISK_CODE_LABELS, RISK_MODE_LABELS } from "@/lib/admin/phone-risk-client";

const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 };
const time = (value: number) => new Date(value).toLocaleString("zh-CN", { hour12: false });
const emptyHardware = { platform: "android", model: "", socIds: "" };

const PENDING_TEXT: Record<string, string> = {
  MODEL_MISSING: "未提供具体机型", MODEL_UNKNOWN: "没有这个机型的规则", MODEL_DISABLED: "该机型规则已停用",
  SOC_MISSING: "没有读到具体芯片", SOC_UNKNOWN: "芯片不在任何芯片档", SOC_DISABLED: "所在芯片档已停用",
  SOC_CONFLICT: "多个标识指向不同芯片", PLATFORM_UNSUPPORTED: "不支持的平台", RULES_UNAVAILABLE: "规则暂不可用", ...RISK_CODE_LABELS,
};
const emptyFacts = { osVersion: "", pixelRatio: "", screenWidth: "", screenHeight: "" };
function trialText(result: PhonePreview): string {
  const { match, possibleTiers } = result;
  if (match.status !== "MATCHED") return `试算：待核验${PENDING_TEXT[match.status] ? `（${PENDING_TEXT[match.status]}）` : ""}，不能激活手机算力。`;
  if (match.method === "IOS_MODEL_RANGE" || match.method === "ANDROID_SOC_RANGE") {
    const tiers = possibleTiers.length === 0 ? "未知" : possibleTiers.length > 1
      ? `T${possibleTiers[0]}–T${possibleTiers[possibleTiers.length - 1]}` : `T${possibleTiers[0]}`;
    return `试算：命中 ${match.model}，运营预设范围 ${formatRange(match)}，可能档位 ${tiers}。用户首次校准成功时，系统在范围内随机取值并保存；试算不会产生校准记录。`;
  }
  return `试算：T${match.tier}，平台算力 ${match.computeValue}`;
}
function riskText(result: PhonePreview): string {
  if (result.risk.length === 0) return "机型风控：按当前设置未命中。";
  return `机型风控：${result.risk.map(finding => `${RISK_CODE_LABELS[finding.code] ?? finding.code}（${RISK_MODE_LABELS[finding.mode]}）`).join("、")}。`
    + (result.risk.some(finding => finding.mode === "ENFORCE") ? "这样上报的手机会进入待核验。" : "只记录，不影响校准。");
}

export function PhoneCalibrationPanel({ ctx, thresholdsOnly = false, onPendingCount }: { ctx: EViewCtx; thresholdsOnly?: boolean; onPendingCount?: (count:number|null)=>void }) {
  const mutations = useE6Mutations();
  const [hardwareTab,setHardwareTab] = useState<"android"|"ios">("android");
  const [discard,setDiscard] = useState(false);
  const [snapshot, setSnapshot] = useState<PhoneCalibrationOverview | null>(null);
  useEffect(()=>onPendingCount?.(snapshot?.pendingHardware.length??null),[snapshot,onPendingCount]);
  const [thresholds, setThresholds] = useState<string[]>(["","","",""]);
  const [androidRules, setAndroidRules] = useState<AndroidSocRule[]>([]);
  const [removals, setRemovals] = useState<AndroidPresetRemovals>(NO_REMOVALS);
  const [iosRules, setIosRules] = useState<IosModelRule[]>([]);
  const [effective, setEffective] = useState("");
  const [hardware, setHardware] = useState(emptyHardware);
  const [facts, setFacts] = useState(emptyFacts);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ key: string; result: PhonePreview; amplifies: boolean } | null>(null);
  const [confirm, setConfirm] = useState<{ proposal: PhonePolicyProposal; commandKey: string; amplifies: boolean } | null>(null);
  const generation = useRef(0);
  const live = useRef(true);
  const editing = ctx.canWriteE6 && !!snapshot && !snapshot.policy.scheduled && !busy && !confirm && !mutations.locked("calibration") && mutations.canPropose;
  const proposal: PhonePolicyProposal = { expectedRevision: snapshot?.policy.revision ?? 0,
    effectiveAt: effective ? new Date(effective).getTime() : 0,
    thresholds: thresholds.map(value => value.trim() ? Number(value) : NaN), androidSocRules: androidRules, iosModelRules: iosRules,
    androidPresetRemovals: removals };
  const publishedPolicy = snapshot ? snapshot.policy.scheduled ?? snapshot.policy.current : null;
  const ios = hardware.platform === "ios";
  // iOS is matched by model only; Android by every chip identifier the phone would report.
  const trialHardware: PhoneHardware = ios ? { platform: "ios", model: hardware.model, socIds: [] }
    : { platform: "android", model: hardware.model, socIds: hardware.socIds.split(/[\r\n,，、]+/).map(id => id.trim()).filter(Boolean).slice(0, 4) };
  // Optional iPhone facts show which model checks a report like this would hit.
  const trialFacts: PhoneTrialFacts | null = ios && Object.values(facts).some(value => value.trim()) ? {
    osVersion: facts.osVersion.trim() || null, pixelRatio: facts.pixelRatio ? Number(facts.pixelRatio) : null,
    screenWidth: facts.screenWidth ? Number(facts.screenWidth) : null, screenHeight: facts.screenHeight ? Number(facts.screenHeight) : null,
  } : null;
  const draftKey = JSON.stringify({ proposal, hardware: trialHardware, facts: trialFacts });
  const baseline = publishedPolicy ? JSON.stringify({thresholds:publishedPolicy.thresholds,androidRules:publishedPolicy.androidSocRules,iosRules:publishedPolicy.iosModelRules,removals:publishedPolicy.androidPresetRemovals}) : JSON.stringify({thresholds:[null,null,null,null],androidRules:[],iosRules:[],removals:NO_REMOVALS});
  const dirty = !!snapshot && (baseline !== JSON.stringify({thresholds:proposal.thresholds,androidRules,iosRules,removals}) || !!effective);
  const thresholdError = proposal.thresholds.some((v,i)=>!Number.isFinite(v)||v<=0||i>0&&v<=proposal.thresholds[i-1]);
  const axisMax = Math.max(...[snapshot?.policy.current,snapshot?.policy.scheduled].flatMap(p=>p?[p.thresholds[3]]:[]),!thresholdError?proposal.thresholds[3]:1);
  const axisText = (values:number[])=>`T1 < ${values[0]}；T2 [${values[0]}, ${values[1]})；T3 [${values[1]}, ${values[2]})；T4 [${values[2]}, ${values[3]})；T5 ≥ ${values[3]}。平台算力值`;
  useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[dirty]);
  const validation = phoneProposalError(proposal);
  const previewCurrent = preview?.key === draftKey;
  useEffect(() => { setPreview(null); }, [draftKey]);

  async function refresh() {
    const request = ++generation.current;
    setBusy(true); setError(""); setPreview(null);
    try {
      const result = await fetchPhoneCalibration();
      if (!live.current || request !== generation.current) return;
      setSnapshot(result);
      const policy = result.policy.scheduled ?? result.policy.current;
      setThresholds(policy ? policy.thresholds.map(String) : ["","","",""]);
      setAndroidRules(policy?.androidSocRules ?? []); setRemovals(policy?.androidPresetRemovals ?? NO_REMOVALS);
      setIosRules(policy?.iosModelRules ?? []); setEffective("");
    } catch (failure) {
      if (live.current && request === generation.current) { setSnapshot(null); setError(displayAdminError(failure)); }
    } finally { if (live.current && request === generation.current) setBusy(false); }
  }
  useEffect(() => { live.current = true; void refresh(); return () => { live.current = false; generation.current++; }; }, []);

  async function runPreview() {
    if (!editing || validation) return;
    const request = generation.current;
    setBusy(true); setError(""); setPreview(null);
    try {
      const [result, amplifies] = await Promise.all([
        previewPhoneCalibration(proposal, trialHardware, trialFacts), fetchPhoneCalibrationDirection(proposal),
      ]);
      if (live.current && request === generation.current) setPreview({ key: draftKey, result, amplifies });
    } catch (failure) {
      if (live.current && request === generation.current) setError(displayAdminError(failure));
    } finally { if (live.current && request === generation.current) setBusy(false); }
  }

  return <div className="e6-tab">
    <E6PendingNotice section="calibration" onRead={()=>{void refresh();void ctx.refreshE6();}}/>
    <Conclusion state={error?"warn":!snapshot?"unknown":snapshot.policy.scheduled?"warn":"neutral"} icon={Gauge}>{error?"手机校准读取失败":!snapshot?"正在读取手机校准规则":snapshot.policy.current?`当前校准规则第 ${snapshot.policy.current.version} 版`:"尚未发布手机校准规则"}</Conclusion>
    {snapshot?.policy.scheduled&&<Notice tone="warn" title={`第 ${snapshot.policy.scheduled.version} 版预约在 ${time(snapshot.policy.scheduled.effectiveAt)} 生效`}>整个校准草稿只读；到达预约时间后仍须刷新核对，不能据本地时钟认定已发布。</Notice>}
    <Panel id="section-rules" title="档位分界" icon={Gauge} tone="role-4" data-proof="phone-calibration-panel" sub={snapshot?`修订号 ${snapshot.policy.revision}`:undefined}
      explain="平台算力值用于后续校准分档，不代表硬件物理 TOPS；等于分界进入高一档，不修改历史结算。" actions={<Button size="sm" disabled={busy||!!confirm} onClick={()=>dirty?setDiscard(true):void refresh()}>刷新</Button>}>
      {error&&<Notice tone="warn">{error}</Notice>}
      {!snapshot?<BlockState state={busy?"loading":"error"} title={busy?"正在加载…":"手机校准规则加载失败"} onRetry={busy?undefined:()=>void refresh()}/>:<>
        <div className="e6-threshold-block"><div className="e6-axis-grid">{([{label:"当前生效",policy:snapshot.policy.current},{label:"预约版本",policy:snapshot.policy.scheduled}]).filter(p=>p.policy).map(({label,policy})=><div className="e6-axis" key={label}><div className="e6-actions"><strong>{label} · 第 {policy!.version} 版</strong><Explain label={`${label}分档区间`} content={axisText(policy!.thresholds)}/></div><ScaleBar label={`${label}平台算力分界`} valueText={axisText(policy!.thresholds)} max={axisMax} bands={{labels:["T1","T2","T3","T4","T5"],openEnd:true,marks:policy!.thresholds.map(value=>({value,text:String(value)}))}}/></div>)}</div>
        {!snapshot.policy.current&&<Notice tone="neutral">尚未发布，填写四个分界和硬件规则后试算。</Notice>}
        {dirty&&!thresholdError&&<div className="e6-axis"><div className="e6-actions"><strong>草稿 · 未提交</strong><Explain label="草稿分档区间" content={axisText(proposal.thresholds)}/></div><ScaleBar label="草稿平台算力分界" valueText={axisText(proposal.thresholds)} max={axisMax} bands={{labels:["T1","T2","T3","T4","T5"],openEnd:true,marks:proposal.thresholds.map(value=>({value,text:String(value)}))}}/></div>}
        {ctx.canWriteE6&&!snapshot.policy.scheduled&&<div className="e6-threshold-inputs">{thresholds.map((value,index)=><Field key={index} label={`T${index+1} / T${index+2} 分界`} help="严格递增正数" error={dirty&&thresholdError?"四个分界须为严格递增的正数":undefined} explain="等于分界进入高一档，批准后用于后续校准。"><NumberInput aria-label={`T${index+1} / T${index+2} 分界`} min={0} step={0.001} value={value} disabled={!editing} onChange={event=>setThresholds(old=>old.map((v,i)=>i===index?event.target.value:v))}/></Field>)}</div>}
        </div>
      </>}
    </Panel>
    {!thresholdsOnly&&<>
      <Panel id="section-hardware" title="硬件规则" icon={Cpu} tone="role-3" sub={snapshot?`Android ${androidRules.length} 档 · iPhone ${iosRules.length} 机型 · ${dirty?"草稿有变更":"无变更"}`:undefined}>
        {!snapshot?<BlockState state={busy?"loading":"error"} title="硬件规则暂不可读"/>:<div className="e6-hardware">{!editing&&<Notice tone="neutral">{!ctx.canWriteE6?"你只能查看硬件规则，修改需要设备配置权限。":snapshot.policy.scheduled?"已有预约版本，硬件规则暂只读。":!mutations.canPropose?"修改硬件规则需要发起审批权限。":mutations.locked("calibration")?"原校准提案待确认，硬件草稿暂不可修改。":"正在读取或确认规则，硬件草稿暂不可修改。"}</Notice>}<Segments label="硬件目录" value={hardwareTab} onChange={setHardwareTab} items={[{value:"android",label:"Android 芯片"},{value:"ios",label:"iPhone 机型"}]}/>
          <div hidden={hardwareTab!=="android"} className="e6-legacy-fields"><AndroidSocTiersSection rules={androidRules} removals={removals} published={publishedPolicy?.androidSocRules??[]} iosRuleIds={iosRules.map(r=>r.id)} canWrite={ctx.canWriteE6} editing={editing&&hardwareTab==="android"} onChange={(next,nextRemovals)=>{setAndroidRules(next);setRemovals(nextRemovals);setPreview(null);}}/></div>
          <div hidden={hardwareTab!=="ios"} className="e6-legacy-fields"><IosModelRulesSection rules={iosRules} published={publishedPolicy?.iosModelRules??[]} androidRuleIds={androidRules.map(r=>r.id)} canWrite={ctx.canWriteE6} editing={editing&&hardwareTab==="ios"} onChange={next=>{setIosRules(next);setPreview(null);}}/></div>
        </div>}
      </Panel>
      <Panel id="section-pending" title="待核验硬件" icon={Smartphone} tone="role-3" sub={snapshot?`${snapshot.pendingHardware.length} 组`:undefined} explain="最多展示 100 组，记录数不是独立手机数。核实整组芯片标识后维护规则，不可把冲突样本拆开直接加入。">
        {!snapshot?<BlockState state={busy?"loading":"error"} title="待核验样本暂不可读"/>:!snapshot.pendingHardware.length?<BlockState state="empty" title="暂无待核验样本。"/>:<Table label="待核验样本（最多展示 100 组）"><thead><tr><Th>平台 / 机型</Th><Th>同次上报的芯片标识</Th><Th>原因</Th><Th align="right">记录数</Th></tr></thead><tbody>{snapshot.pendingHardware.map((sample,index)=><Tr key={index}><Td>{sample.platform||"未知"} / {sample.model||"未知"}</Td><Td>{sample.socIds.join("、")||"—"}</Td><Td>{sample.reason?PENDING_TEXT[sample.reason]??"待核验（原因未识别）":"待核验（原因未识别）"} <Explain label="待核验原因原码" content={sample.reason??"未提供"}/></Td><Td align="right">{sample.count}</Td></Tr>)}</tbody></Table>}
      </Panel>
    </>}
    <Panel id="section-trial" title="试算与发布" icon={Send} tone="role-2" explain="试算只读，不激活手机，不创建校准记录；硬件预览和放大方向必须同次成功。已匹配人群中的变化数不是独立人群。审批生效后用于后续校准，不修改历史结算。">
      {!snapshot?<BlockState state={busy?"loading":"error"} title="校准规则未就绪，暂不能试算"/>:<>
        {!ctx.canWriteE6?<Notice tone="neutral">你只能查看，修改和发布需要设备配置权限。</Notice>:<>
          <div className="e6-trial-form"><div className="e6-form-grid"><Field label="平台"><Select aria-label="平台" value={hardware.platform} disabled={!editing} onChange={platform=>setHardware(old=>({...old,platform}))} options={[{value:"android",label:"Android"},{value:"ios",label:"iOS"}]}/></Field>
            {ios?<Field label="试算机型（名称或硬件标识符）"><Input value={hardware.model} disabled={!editing} onChange={event=>setHardware(old=>({...old,model:event.target.value}))}/></Field>:<Field label="试算芯片标识" help="最多 4 个，每行或逗号分隔，例如 SM8550"><Textarea rows={2} value={hardware.socIds} disabled={!editing} onChange={event=>setHardware(old=>({...old,socIds:event.target.value}))}/></Field>}
            {ios&&<><Field label="试算系统版本（选填）"><Input value={facts.osVersion} maxLength={8} disabled={!editing} onChange={event=>setFacts(old=>({...old,osVersion:event.target.value}))}/></Field><Field label="试算屏幕倍率（选填）" help="1–3 整数"><NumberInput value={facts.pixelRatio} min={1} max={3} step={1} disabled={!editing} onChange={event=>setFacts(old=>({...old,pixelRatio:event.target.value}))}/></Field><Field label="试算屏幕宽（选填）"><NumberInput aria-label="试算屏幕宽" value={facts.screenWidth} min={1} step={1} unit="点" disabled={!editing} onChange={event=>setFacts(old=>({...old,screenWidth:event.target.value}))}/></Field><Field label="试算屏幕高（选填）"><NumberInput aria-label="试算屏幕高" value={facts.screenHeight} min={1} step={1} unit="点" disabled={!editing} onChange={event=>setFacts(old=>({...old,screenHeight:event.target.value}))}/></Field></>}
            <Field label="生效时间（留空为批准后生效）" help={`浏览器时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}`} explain="预约须先获批准并到达所选时间；批准时已过预约时间则批准后生效。"><Input type="datetime-local" value={effective} disabled={!editing} onChange={event=>setEffective(event.target.value)}/></Field>
          </div>
          {validation&&<Notice tone="warn">{validation}</Notice>}
          <div className="e6-actions"><Button disabledReason={!editing?"规则只读、待确认或尚未就绪":validation??undefined} onClick={()=>void runPreview()}>试算并预览影响</Button><Button variant="primary" disabledReason={!editing?"规则只读、待确认或尚未就绪":validation??(!previewCurrent?"请先完成本次草稿的试算和方向预览":undefined)} onClick={()=>preview&&setConfirm({proposal,commandKey:createA2CommandKey("phone-policy"),amplifies:preview.amplifies})}>提交审批</Button></div></div>
        </>}
        {previewCurrent&&preview&&<div className="e6-trial-result"><Notice tone={preview.result.match.status==="MATCHED"?"neutral":"warn"}>{trialText(preview.result)}{trialFacts&&preview.result.match.status==="MATCHED"&&<p>{riskText(preview.result)}</p>}</Notice><StatBand fit><Stat label="匹配记录" value={preview.result.impact.matched} icon={Activity} tone="role-2"/><Stat label="数值或档位变化" value={preview.result.impact.changed} icon={Gauge} tone="role-4" explain="已匹配记录中的变化数，不与匹配数相加。"/><Stat label="待核验记录" value={preview.result.impact.pending} icon={Smartphone} tone="role-3"/></StatBand></div>}
        <div className="e6-section-link">{mutations.canAudit?<Link href="/platform/audit?domain=E&object=phone-calibration">查看审批记录</Link>:<p>查看审批记录需要操作记录与审批读取权限。</p>}</div>
      </>}
    </Panel>
    {discard&&<Modal title="刷新会放弃未提交草稿" onClose={()=>setDiscard(false)} footer={<Decision primary={<Button variant="primary" onClick={()=>{setDiscard(false);void refresh();}}>放弃草稿并刷新</Button>} others={<Button onClick={()=>setDiscard(false)}>继续编辑</Button>}/>}><Notice tone="warn">将放弃校准分界、硬件规则及本次试算的普通草稿。已发出的待确认原操作会继续保留。</Notice></Modal>}
    {confirm&&<OperationConfirmModal briefKind="config" statedBrief={{impact:"整份规则只提交审批，批准后用于后续校准；历史结算不变。",check:"核对原修订号、同次试算和生效时间，批准时检查兑付覆盖率。"}} action="发布手机校准规则" amplifies={confirm.amplifies} coverageCheck="批准时检查兑付覆盖率。" detail="整份 Android 芯片档、iPhone 机型与四分界一起提交审批，批准后用于后续校准；已派任务和历史结算不变。预约发布还须到所选时间。" completionCopy="另一位有批准权限和手机配置读取权限的管理员批准后生效。" reasonMin={8} reasonMax={200}
      facts={<Facts><Fact k="原修订号">{confirm.proposal.expectedRevision}</Fact><Fact k="当前分界">{publishedPolicy?.thresholds.join(" / ")??"尚未发布"}</Fact><Fact k="目标分界">{confirm.proposal.thresholds.join(" / ")}</Fact><Fact k="硬件规则">Android {confirm.proposal.androidSocRules.length} 档 · iPhone {confirm.proposal.iosModelRules.length} 个</Fact><Fact k="生效时间">{confirm.proposal.effectiveAt?`${time(confirm.proposal.effectiveAt)}（${Intl.DateTimeFormat().resolvedOptions().timeZone}）`:"批准后生效"}</Fact></Facts>}
      content={<Fold title="规则差异与完整草稿" summary="核对硬件改动、同次试算与原修订" inset>
        <p>{preview?`本次试算：匹配 ${preview.result.impact.matched}，其中变化 ${preview.result.impact.changed}；待核验 ${preview.result.impact.pending}。`:"本次试算已记录"}方向：{confirm.amplifies?"会增加支出":"未增加支出"}。</p>
        {diffAndroidRules(publishedPolicy?.androidSocRules??[],confirm.proposal.androidSocRules).map(c=><p key={`android-${c.id}`}>Android · {IOS_CHANGE_LABELS[c.kind]}「{c.name}」：{c.details.join("；")||"状态变化"}</p>)}
        {diffIosRules(publishedPolicy?.iosModelRules??[],confirm.proposal.iosModelRules).map(c=><p key={`ios-${c.id}`}>iPhone · {IOS_CHANGE_LABELS[c.kind]}「{c.after?.model??c.before?.model}」：{c.details.join("；")||"状态变化"}</p>)}
        <Fold title="完整规则技术信息" summary="当前规则与目标草稿，含全部字段" inset><pre className="e6-json">{JSON.stringify({before:publishedPolicy,after:confirm.proposal})}</pre></Fold>
      </Fold>}
      getPendingReason={()=>mutations.pendingReason("calibration")} onClose={()=>setConfirm(null)} onConfirm={async reason=>{
        const original=mutations.pending.find(r=>r.scope==="calibration");
        if(original)await mutations.send(original,true);else {if(!ctx.canWriteE6||!mutations.canPropose)throw new Error("你没有发布手机校准规则的权限");const definition=findHighOp("e6_phone_calibration")!;await mutations.proposal("calibration","calibration",{action:definition.action,obj:"phone-calibration",beforeValue:`修订号 ${confirm.proposal.expectedRevision}`,afterValue:`Android ${confirm.proposal.androidSocRules.length} 档 · iPhone ${confirm.proposal.iosModelRules.length} 个；分界 ${confirm.proposal.thresholds.join(" / ")}`,type:"param",amplifies:confirm.amplifies,reason,sourceDomain:"E6",command:definition.buildCommand({...confirm.proposal}),target:definition.buildTarget({})},{preview:preview?.result,direction:confirm.amplifies,draftKey});}
        if(live.current){setConfirm(null);setPreview(null);ctx.toast("已提交，等待审批后执行");}
      }}/>}
  </div>;
}
