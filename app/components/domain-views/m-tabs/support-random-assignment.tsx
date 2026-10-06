"use client";
import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { supportEnhancements, parseRandomResult, type RandomPreview, type RandomResult } from "@/lib/admin/m-support-enhancements";
import { supportClient, SupportClientError, isIndeterminateSupportError, type SupportBindingPoolItem } from "@/lib/admin/m-support-client";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { displayAdminError } from "@/lib/admin/error-messages";
import { Modal } from "../design-kit";
type RandomPending=PendingMutationRecord&{actorId:number;payload:{previewId:string;expectedRulesVersion:number;reason:string};customers:SupportBindingPoolItem[];preview:RandomPreview};
// Retained server operations keep their recovery locator until explicitly resolved.
const commands=createPendingMutationStore<RandomPending>({storageKey:"nexion-support-random-assignment",ttlMs:Number.MAX_SAFE_INTEGER-Date.now(),isValidRecord:r=>Number.isSafeInteger(r.actorId)&&Boolean(r.payload?.previewId)&&Array.isArray(r.customers)&&Array.isArray(r.preview?.customers)});
export const hasPendingRandomAssignment=(actorId:number)=>commands.list().some(r=>r.actorId===actorId);
export function SupportRandomAssignment({customers,onClose,onDone}:{customers:SupportBindingPoolItem[];onClose:()=>void;onDone:()=>void}) {
  const actorId=useAdminAuth(s=>s.session?.adminId??0),epoch=useAdminAuth(s=>s.authEpoch);
  const [preview,setPreview]=useState<RandomPreview|null>(null),[reason,setReason]=useState(""),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[retry,setRetry]=useState(0),[result,setResult]=useState<RandomResult|null>(null);
  const [pending,setPending]=useState<RandomPending|null>(null);
  const mounted=useRef(true),[draftOwner,setDraftOwner]=useState(0);
  const currentStamp=()=>{const state=useAdminAuth.getState();return `${state.authEpoch}:${state.session?.adminId}`;};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(!actorId)return;try{setReason(sessionStorage.getItem(`nexion-random-reason:${actorId}`)??"");}catch{setError("理由暂不能保留，请在本页完成核对。");}setDraftOwner(actorId);},[actorId,epoch]);
  useEffect(()=>{if(draftOwner!==actorId||!actorId)return;try{sessionStorage.setItem(`nexion-random-reason:${actorId}`,reason);}catch{setError("理由暂不能保留，请在本页完成核对。");}},[reason,actorId,draftOwner]);
  useEffect(()=>{const saved=commands.list().find(r=>r.actorId===actorId);setPending(saved??null);setPreview(saved?.preview??null);setResult(null);setAck(false);setBusy(false);setError(saved?"原分配结果待确认，请查询原命令，不能重新抽签。":"");if(saved)setReason(saved.payload.reason);},[actorId,epoch]);
  useEffect(()=>{if(pending||result||!customers.length||hasPendingRandomAssignment(actorId))return;let active=true;setPreview(null);setError("");supportEnhancements.randomPreview(customers.map(c=>({id:c.customerId,poolVersion:c.version}))).then(v=>{if(active)setPreview(v);}).catch(e=>{if(active)setError(displayAdminError(e));});return()=>{active=false;};},[customers,retry,epoch,pending?.commandKey,result]);
  async function confirm(recover=false){
    if(!pending&&preview&&Date.parse(preview.expiresAt)<=Date.now()){setError("预览已过期，请刷新原名单后重新核对。");setAck(false);return;}
    if(busy||!pending&&(!preview?.count||!ack||reason.trim().length<8||reason.trim().length>200||Date.parse(preview.expiresAt)<=Date.now()))return;
    const record=pending??{fingerprint:`${actorId}:random`,commandKey:crypto.randomUUID(),actorId,createdAt:Date.now(),expiresAt:Date.now()+86400000,payload:{previewId:preview!.id,expectedRulesVersion:preview!.rulesVersion,reason:reason.trim()},customers,preview:preview!};
    commands.remember(record.fingerprint,record.commandKey,{actorId,payload:record.payload,customers:record.customers,preview:record.preview});setPending(record);if(!commands.isDurablyStored(record.fingerprint,record.commandKey)){setError("原命令暂不能持久保存，尚未提交；请恢复浏览器存储后用此命令重试。");return;}setBusy(true);setError("");
    const auth=useAdminAuth.getState(),stamp=`${auth.authEpoch}:${auth.session?.adminId}`;
    let submitted=false;
    try {
      const recovered=recover?await supportClient.command(record.commandKey).catch(e=>{if(e instanceof SupportClientError&&e.status===404)return null;throw e;}):null;
      if(!mounted.current||stamp!==currentStamp())return;
      if(recovered?.status==="FAILED"){commands.forget(record.fingerprint);setPending(null);setError("原命令确认失败，名单保留；请刷新预览后重新确认。");return;}
      if(recovered?.status!=="SUCCEEDED")submitted=true;
      const next=recovered?.status==="SUCCEEDED"?parseRandomResult(recovered.result):await supportEnhancements.randomConfirm(record.payload,record.commandKey);
      if(!mounted.current||stamp!==currentStamp())return;
      if(next.customers.length!==record.preview.count || new Set(next.customers.map(c=>c.customerId)).size!==next.customers.length||record.preview.customers.some(c=>!next.customers.some(v=>v.customerId===c.id)))throw new Error("random result incomplete");
      commands.forget(record.fingerprint);setPending(null);setResult(next);onDone();
    } catch(e) {if(!mounted.current||stamp!==currentStamp())return;setError(displayAdminError(e));if(submitted&&e instanceof SupportClientError&&[400,403,404,409,422].includes(e.status)&&!isIndeterminateSupportError(e)){commands.forget(record.fingerprint);setPending(null);setPreview(null);}}
    finally{if(mounted.current&&stamp===currentStamp())setBusy(false);}
  }
  const selected=pending?.customers??customers;
  return <Modal title={result?"逐客随机分配结果":"明确处理历史待绑定客户"} icon="users" wide busy={busy} onClose={onClose} footer={<><button className="btn btn-sec btn-sm" disabled={busy} onClick={onClose}>{result?"关闭结果":"返回客户池"}</button>{!result&&<button className="btn btn-pri btn-sm" disabled={busy||!pending&&(!preview?.count||!ack||reason.trim().length<8||Date.parse(preview.expiresAt)<=Date.now())} onClick={()=>void confirm(Boolean(pending))}>{busy?"正在提交…":pending?"查询并使用原命令重试":`确认随机分配 ${preview?.count??0} 位`}</button>}</>}>
    <p>只处理本次逐项选中的历史记录，规则变更或新建顾问不会暗中处理历史池。每位成功客户成为新继承段的零层起点，已有下级保持原归属。</p>
    {error&&<p className="itint danger" role="alert">{error}{!pending&&!result&&<button className="l-btn sm" onClick={()=>setRetry(n=>n+1)}>刷新原名单预览</button>}</p>}
    {result?<><p>原选中 {selected.length} 位，预览排除 {preview?.excluded.length??0} 位；已处理 {result.customers.length} 位：成功 {result.customers.filter(c=>c.status==="ASSIGNED").length} 位；其余按下列结果逐客处理。</p>{result.customers.map(c=><p key={c.customerId}>客户 ID {c.customerId} · {{ASSIGNED:"已分配",NO_CANDIDATE:"无合格候选",CONFLICT:"资料冲突，需刷新",SKIPPED:"本次跳过"}[c.status]??"待核对"}{c.agentAdminId!==null?` · 顾问 ID ${c.agentAdminId}`:""}</p>)}</>:<><p>原选中 {selected.length} 位 · 服务端预览 {preview?.count??"待核对"} 位</p>{selected.map(c=><p key={c.customerId}>{c.displayName||"客户"} · {c.customerNo||"编码未知"} · ID {c.customerId}</p>)}{preview&&<><p>规则版本 {preview.rulesVersion} · 有效至 {new Date(preview.expiresAt).toLocaleString("zh-CN")}</p>{preview.excluded.length>0&&<details open><summary>排除 {preview.excluded.length} 位</summary>{preview.excluded.map(e=><p key={e.customerId}>客户 ID {e.customerId} · 当前不符合随机分配条件，请刷新客户池核对</p>)}</details>}</>}<label>处理理由（8–200 字）<textarea className="fld" maxLength={200} value={reason} disabled={busy||Boolean(pending)} onChange={e=>setReason(e.target.value)}/></label><label><input type="checkbox" checked={ack||Boolean(pending)} disabled={busy||Boolean(pending)} onChange={e=>setAck(e.target.checked)}/>核对人数、排除项和新继承段规则；只处理此名单。</label></>}
  </Modal>;
}
