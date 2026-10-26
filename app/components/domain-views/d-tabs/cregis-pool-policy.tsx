"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import { financeAdminRequest } from "@/lib/admin/d-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { DCtx } from "./types";

type Policy={enabled:boolean;target:number;lowWatermark:number;batchSize:number;concurrency:number;version:number};
export function parsePoolPolicy(value:unknown):Policy {
  const p=value as Policy;
  if(!p || typeof p.enabled!=="boolean" || [p.target,p.lowWatermark,p.batchSize,p.concurrency,p.version].some(n=>!Number.isSafeInteger(n))
    || p.target<10 || p.target>100000 || p.lowWatermark<1 || p.lowWatermark>=p.target || p.batchSize<1 || p.batchSize>100
    || p.concurrency<1 || p.concurrency>10 || p.concurrency>p.batchSize || p.version<0) throw new Error("地址池配置无效，请刷新核对");
  return p;
}
export function CregisPoolPolicy({canManage,openActionConfirm}:{canManage:boolean;openActionConfirm:DCtx["openActionConfirm"]}) {
  const [saved,setSaved]=useState<Policy|null>(null),[draft,setDraft]=useState<Policy|null>(null);
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  const sequence=useRef(0),live=useRef(true),owner=useAdminAuth(s=>s.session?.adminId),epoch=useAdminAuth(s=>s.authEpoch);
  const owns=useCallback(()=>live.current && useAdminAuth.getState().isAuthenticated
    && useAdminAuth.getState().session?.adminId===owner && useAdminAuth.getState().authEpoch===epoch,[owner,epoch]);
  const refresh=useCallback(async()=>{
    const at=++sequence.current;setBusy(true);setError("");
    try {const next=parsePoolPolicy(await financeAdminRequest<unknown>("/cregis/addresses/policy"));
      if(owns() && at===sequence.current){setSaved(next);setDraft(next);}}
    catch(e){if(owns() && at===sequence.current){setSaved(null);setDraft(null);setError(e instanceof Error?e.message:"读取失败");}}
    finally{if(owns() && at===sequence.current)setBusy(false);}
  },[owns]);
  useEffect(()=>{live.current=true;void refresh();return()=>{live.current=false;sequence.current++;};},[refresh]);
  const save=()=>{
    if(!draft || !saved || busy || !canManage || !owns())return;
    let selected:Policy;try{selected=parsePoolPolicy({...draft,version:saved.version});}catch(e){setError((e as Error).message);return;}
    openActionConfirm({action:"保存地址池补充配置",detail:`备用目标 ${selected.target}，低于 ${selected.lowWatermark} 触发补充，每批 ${selected.batchSize}，建址并发 ${selected.concurrency}；自动补充${selected.enabled?"开启":"关闭"}。`,
      reasonMin:10,reasonMax:255,completionCopy:"保存后按新配置补充地址，已有用户地址保持绑定",run:async(reason)=>{
        if(!owns() || !useAdminAuth.getState().session?.authorities.includes("finance_d1_channel_manage"))throw new Error("登录身份或权限已变化，请重新打开页面");
        setBusy(true);setError("");setNotice("");
        try{const next=parsePoolPolicy(await financeAdminRequest<unknown>("/cregis/addresses/policy",{method:"POST",body:JSON.stringify({...selected,reason}),idempotencyPrefix:"cregis-pool-policy"}));
          if(owns()){setSaved(next);setDraft(next);setNotice("配置已保存");}}
        catch(e){if(owns())setError(e instanceof Error?e.message:"保存失败，请刷新核对");throw e;}
        finally{if(owns())setBusy(false);}
      }});
  };
  return <div className="cregis-history" style={{marginTop:16}}>
    <div className="cregis-section-title">专属充值地址 · 库存与自动补充 <button className="l-btn sm" disabled={busy} onClick={()=>void refresh()}>刷新配置</button></div>
    <p className="sub">首次进入充值页时分配专属地址，后续重复使用。低于补充阈值后，分批补至目标库存；已分配地址不计入备用库存。</p>
    {error && <div className="dtint warn" role="alert">{error}</div>}{notice && <div className="dtint">{notice}</div>}
    {!draft && !error && <div className="sub">正在读取地址池配置…</div>}
    {draft && <>
      <label><input type="checkbox" checked={draft.enabled} disabled={!canManage||busy} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/> 自动补充</label>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12,margin:"12px 0"}}>
        {([["target","备用地址目标",10,100000],["lowWatermark","补充触发阈值",1,draft.target-1],["batchSize","每批补充数量",1,100],["concurrency","建址并发上限",1,10]] as const).map(([key,label,min,max])=>
          <label key={key}>{label}<input aria-label={label} type="number" min={min} max={max} step={1} value={draft[key]} disabled={!canManage||busy}
            onChange={e=>{setNotice("");setDraft({...draft,[key]:Number(e.target.value)});}} style={{display:"block",width:"100%"}}/></label>)}
      </div>
      <p className="sub">阈值须低于目标，并发不能超过每批数量。供应商限流或额度不足时延后补充；结果不明的建址请求须核查后恢复。</p>
      {canManage && <button className="l-btn sm" disabled={busy} onClick={save}>保存地址池配置</button>}
    </>}
  </div>;
}
