"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import "./phone-calibration-panel.css";
import { Btn, OperationConfirmModal } from "../design-kit";
import type { EViewCtx } from "./types";
import { usePropose } from "@/lib/admin/use-propose";
import { createA2CommandKey } from "@/lib/admin/a2-client";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { displayAdminError } from "@/lib/admin/error-messages";
import { fetchPhoneCalibration, previewPhoneCalibration, phoneProposalError,
  type PhoneCalibrationOverview, type PhonePolicyProposal, type PhoneRule, type PhoneHardware, type PhonePreview } from "@/lib/admin/phone-calibration-client";
import { formatRange, type IosModelRule } from "@/lib/admin/ios-model-rules";
import { IosModelRulesSection } from "./ios-model-rules-section";

const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 };
const time = (value: number) => new Date(value).toLocaleString("zh-CN", { hour12: false });
const emptyHardware: PhoneHardware = { platform: "android", model: "", soc: "", gpu: "", memoryGb: 0 };

const PENDING_TEXT: Record<string, string> = {
  MODEL_MISSING: "未提供具体机型", MODEL_UNKNOWN: "没有这个机型的规则", MODEL_DISABLED: "该机型规则已停用",
};
function trialText(result: PhonePreview): string {
  const { match, possibleTiers } = result;
  if (match.status !== "MATCHED") return `试算：待核验${PENDING_TEXT[match.status] ? `（${PENDING_TEXT[match.status]}）` : ""}，不能激活手机算力。`;
  if (match.method === "IOS_MODEL_RANGE") {
    const tiers = possibleTiers.length === 0 ? "未知" : possibleTiers.length > 1
      ? `T${possibleTiers[0]}–T${possibleTiers[possibleTiers.length - 1]}` : `T${possibleTiers[0]}`;
    return `试算：命中 ${match.model}，运营预设范围 ${formatRange(match)}，可能档位 ${tiers}。用户首次校准成功时，系统在范围内随机取值并保存；试算不会产生校准记录。`;
  }
  return `试算：T${match.tier}，平台算力 ${match.computeValue}`;
}

export function PhoneCalibrationPanel({ ctx, thresholdsOnly = false }: { ctx: EViewCtx; thresholdsOnly?: boolean }) {
  const propose = usePropose();
  const [snapshot, setSnapshot] = useState<PhoneCalibrationOverview | null>(null);
  const [thresholds, setThresholds] = useState<string[]>(["","","",""]);
  const [rules, setRules] = useState<PhoneRule[]>([]);
  const [iosRules, setIosRules] = useState<IosModelRule[]>([]);
  const [effective, setEffective] = useState("");
  const [hardware, setHardware] = useState<PhoneHardware>(emptyHardware);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ key: string; result: PhonePreview } | null>(null);
  const [confirm, setConfirm] = useState<{ proposal: PhonePolicyProposal; commandKey: string } | null>(null);
  const generation = useRef(0);
  const live = useRef(true);
  const editing = ctx.canWriteE6 && !!snapshot && !snapshot.policy.scheduled && !busy && !confirm;
  const proposal: PhonePolicyProposal = { expectedRevision: snapshot?.policy.revision ?? 0,
    effectiveAt: effective ? new Date(effective).getTime() : 0,
    thresholds: thresholds.map(value => value.trim() ? Number(value) : NaN), rules, iosModelRules: iosRules };
  const publishedPolicy = snapshot ? snapshot.policy.scheduled ?? snapshot.policy.current : null;
  const ios = hardware.platform === "ios";
  // iOS is matched by model only; Android keeps its SoC / GPU / memory trial.
  const trialHardware: PhoneHardware = ios ? { platform: "ios", model: hardware.model, soc: "", gpu: "", memoryGb: 0 } : hardware;
  const draftKey = JSON.stringify({ proposal, hardware: trialHardware });
  const validation = phoneProposalError(proposal);
  const previewCurrent = preview?.key === draftKey;

  async function refresh() {
    const request = ++generation.current;
    setBusy(true); setError(""); setPreview(null);
    try {
      const result = await fetchPhoneCalibration();
      if (!live.current || request !== generation.current) return;
      setSnapshot(result);
      const policy = result.policy.scheduled ?? result.policy.current;
      setThresholds(policy ? policy.thresholds.map(String) : ["","","",""]);
      setRules(policy?.rules ?? []); setIosRules(policy?.iosModelRules ?? []); setEffective("");
    } catch (failure) {
      if (live.current && request === generation.current) { setSnapshot(null); setError(displayAdminError(failure)); }
    } finally { if (live.current && request === generation.current) setBusy(false); }
  }
  useEffect(() => { live.current = true; void refresh(); return () => { live.current = false; generation.current++; }; }, []);

  function changeRule(index: number, change: Partial<PhoneRule>) {
    setRules(current => current.map((rule,i) => i === index ? { ...rule, ...change } : rule));
  }
  async function runPreview() {
    if (!editing || validation) return;
    const request = generation.current;
    setBusy(true); setError(""); setPreview(null);
    try {
      const result = await previewPhoneCalibration(proposal, trialHardware);
      if (live.current && request === generation.current) setPreview({ key: draftKey, result });
    } catch (failure) {
      if (live.current && request === generation.current) setError(displayAdminError(failure));
    } finally { if (live.current && request === generation.current) setBusy(false); }
  }

  return <section className="pane phone-calibration-panel" data-proof="phone-calibration-panel" aria-label={thresholdsOnly ? "手机算力档位分界" : "手机算力规则"}>
    <div className="pane-head"><h3>{thresholdsOnly ? "手机算力档位分界" : "手机算力规则（Android 硬件 / iPhone 机型）"}</h3>
      <Btn disabled={busy || !!confirm} onClick={() => void refresh()}>刷新</Btn></div>
    <p className="f-foot">手机激活自动匹配规则；人工只审批共用规则变更。这里的数值是平台算力值，不代表硬件物理 TOPS。点「刷新」会放弃还没提交的修改。</p>
    {error && <p role="alert">{error}</p>}
    {!snapshot ? <p role="status">{busy ? "正在加载…" : "设置加载失败，请刷新重试。"}</p> : <>
      <p>发布版本：{snapshot.policy.revision} · 当前生效：{snapshot.policy.current ? `v${snapshot.policy.current.version}` : "尚未发布"}
        {snapshot.policy.scheduled && ` · 待生效 v${snapshot.policy.scheduled.version}，${time(snapshot.policy.scheduled.effectiveAt)}`}</p>
      {snapshot.policy.scheduled && <p role="status">已有待生效版本，暂不能再次发布。生效后点「刷新」即可继续修改。</p>}
      {!ctx.canWriteE6 && <p>你只能查看，修改和发布需要设备配置权限。</p>}
      <fieldset disabled={!editing}><legend>五档分界（左闭右开）</legend><div style={grid}>
        {thresholds.map((value,index) => <label key={index}>T{index+1} / T{index+2} 分界
          <input aria-label={`T${index+1} / T${index+2} 分界`} type="number" min="0" step="0.001" value={value}
            onChange={event => setThresholds(old => old.map((item,i) => i === index ? event.target.value : item))} /></label>)}
      </div></fieldset>
      <p className="f-foot">T1：低于首个分界；T2–T4：从本档下限至下一档下限；T5：不低于最后一个分界。小数不会落入空档。</p>
      {thresholdsOnly ? <p>Android 硬件规则 {rules.length} 条，iPhone 机型 {iosRules.length} 个。<Link href="/devices/compute-config#phone-calibration">去「算力与设备配置」维护手机算力规则</Link></p> : <>
        <IosModelRulesSection rules={iosRules} published={publishedPolicy?.iosModelRules ?? []} androidRuleIds={rules.map(rule => rule.id)}
          editing={editing} onChange={next => { setIosRules(next); setPreview(null); }} />
        <fieldset disabled={!editing}><legend>Android 硬件规则（{rules.length}/500）</legend>
          {rules.some(rule => rule.platform === "ios") && <p role="status">有 {rules.filter(rule => rule.platform === "ios").length} 条旧的 iOS 硬件规则，iOS 只按上方 iPhone 机型规则匹配，这些规则不再参与匹配。核对后请删除或改到 iPhone 机型。</p>}
          {rules.map((rule,index) => <details className="phone-hardware-rule" key={index}><summary>规则 {index+1} · {rule.model || rule.soc || "未填写机型"}</summary><div style={grid}>
            <label>规则编号<input value={rule.id} maxLength={64} onChange={event => changeRule(index,{id:event.target.value})} /></label>
            <label>平台<select value={rule.platform} onChange={event => changeRule(index,{platform:event.target.value as "android" | "ios"})}><option value="android">Android</option>{rule.platform === "ios" && <option value="ios">iOS（旧规则，不再匹配）</option>}</select></label>
            {(["model","soc","gpu","evidence"] as const).map(field => <label key={field}>{({model:"精确机型（留空匹配该芯片）",soc:"SoC",gpu:"GPU",evidence:"核验依据"})[field]}
              <input value={rule[field]} maxLength={field === "evidence" ? 500 : field === "gpu" ? 256 : 128} onChange={event => changeRule(index,{[field]:event.target.value})} /></label>)}
            {(["minMemoryGb","maxMemoryGb","computeValue"] as const).map(field => <label key={field}>{({minMemoryGb:"内存下限 GB（含）",maxMemoryGb:"内存上限 GB（不含）",computeValue:"平台算力值"})[field]}
              <input type="number" min="0" step="0.001" value={Number.isFinite(rule[field]) ? rule[field] : ""}
                onChange={event => changeRule(index,{[field]:event.target.value ? Number(event.target.value) : NaN})} /></label>)}
          </div><Btn onClick={() => setRules(old => old.filter((_,i) => i !== index))}>删除规则 {index+1}</Btn></details>)}
          <Btn disabled={rules.length >= 500} onClick={() => setRules(old => [...old,{id:"",platform:"android",model:"",soc:"",gpu:"",minMemoryGb:NaN,maxMemoryGb:NaN,computeValue:NaN,evidence:""}])}>添加硬件规则</Btn>
        </fieldset>
        <details><summary>待核验硬件样本（最多展示 100 组）</summary>
          {snapshot.pendingHardware.length === 0 ? <p>暂无待核验样本。</p> : <table><thead><tr><th>平台 / 机型</th><th>SoC / GPU</th><th>内存 GB</th><th>记录数</th></tr></thead><tbody>
            {snapshot.pendingHardware.map((sample,index) => <tr key={index}><td>{sample.platform || "未知"} / {sample.model || "未知"}</td><td>{sample.soc || "未知"} / {sample.gpu || "未知"}</td><td>{sample.memoryGb ?? "未知"}</td><td>{sample.count}</td></tr>)}
          </tbody></table>}
        </details>
      </>}
      <fieldset disabled={!editing}><legend>{ios ? "试算机型与生效时间（iOS 只需机型）" : "试算硬件与生效时间"}</legend><div style={grid}>
        <label>平台<select value={hardware.platform} onChange={event => setHardware(old => ({...old,platform:event.target.value}))}><option value="android">Android</option><option value="ios">iOS</option></select></label>
        {(ios ? ["model"] as const : ["model","soc","gpu"] as const).map(field => <label key={field}>{({model:ios ? "试算机型（名称或硬件标识符）" : "试算机型",soc:"试算芯片",gpu:"试算显卡"})[field]}<input value={hardware[field]} onChange={event => setHardware(old => ({...old,[field]:event.target.value}))} /></label>)}
        {!ios && <label>试算内存 GB<input type="number" min="0" step="0.001" value={hardware.memoryGb || ""} onChange={event => setHardware(old => ({...old,memoryGb:Number(event.target.value)}))} /></label>}
        <label>生效时间（留空为审批后生效）<input type="datetime-local" value={effective} onChange={event => setEffective(event.target.value)} /></label>
      </div></fieldset>
      {validation && <p role="status">{validation}</p>}
      <Btn disabled={!editing || !!validation} onClick={() => void runPreview()}>试算并预览影响</Btn>
      {previewCurrent && preview && <div role="status"><p>{trialText(preview.result)}</p>
        <p>历史采样预览：匹配 {preview.result.impact.matched}，数值或档位变化 {preview.result.impact.changed}，待核验 {preview.result.impact.pending}。审批生效后用于后续校准，不修改历史结算。</p></div>}
      <Btn disabled={!editing || !!validation || !previewCurrent} onClick={() => setConfirm({ proposal, commandKey: createA2CommandKey("phone-policy") })}>提交审批</Btn>
      <p><Link href="/platform/audit?domain=E&object=phone-calibration">查看审批记录</Link></p>
    </>}
    {confirm && <OperationConfirmModal action="发布手机校准规则" amplifies detail="整份 Android 硬件规则、iPhone 机型规则与档位分界将一起发布，须另一位有审批权的管理员确认。这里只创建提案，不代表已经生效。" reasonMin={8} reasonMax={200}
      onClose={() => setConfirm(null)} onConfirm={async reason => {
        if (!ctx.canWriteE6) throw new Error("你没有修改设备配置的权限");
        const definition = findHighOp("e6_phone_calibration")!;
        await propose(ctx.toast,{action:definition.action,obj:"phone-calibration",before:`v${confirm.proposal.expectedRevision}`,
          after:`v${confirm.proposal.expectedRevision+1} · Android ${confirm.proposal.rules.length} 条 · iPhone ${confirm.proposal.iosModelRules.length} 个`,type:"param",amplifies:true,
          gate:{roles:[]},gateLabel:definition.gateLabel,reason,sourceDomain:"E6",commandKey:confirm.commandKey,
          command:definition.buildCommand({...confirm.proposal}),target:definition.buildTarget({})});
        if (live.current) { setConfirm(null); setPreview(null); await refresh(); }
      }} />}
  </section>;
}
