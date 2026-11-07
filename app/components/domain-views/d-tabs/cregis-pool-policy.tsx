"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, RefreshCw } from "lucide-react";
import { BlockState, Button, ConfigList, ConfigRow, Panel, StatusTag } from "@/app/components/rd";
import { financeAdminRequest } from "@/lib/admin/d-client";
import { displayAdminReadError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { SwitchTag } from "./d1-shared";
import type { DCtx } from "./types";

type Policy={enabled:boolean;target:number;lowWatermark:number;batchSize:number;concurrency:number;version:number};
export function parsePoolPolicy(value:unknown):Policy {
  const p=value as Policy;
  if(!p || typeof p.enabled!=="boolean" || [p.target,p.lowWatermark,p.batchSize,p.concurrency,p.version].some(n=>!Number.isSafeInteger(n))
    || p.target<10 || p.target>100000 || p.lowWatermark<1 || p.lowWatermark>=p.target || p.batchSize<1 || p.batchSize>100
    || p.concurrency<1 || p.concurrency>10 || p.concurrency>p.batchSize || p.version<0) throw new Error("地址池配置无效，请刷新核对");
  return p;
}
const NUMBERS = [
  ["target", "备用地址目标", "每个网络要备多少地址。", "10–100,000 的整数", 10, 100000],
  ["lowWatermark", "补充触发阈值", "低于这个数开始补。", "1 到目标减 1 的整数", 1, 99999],
  ["batchSize", "每批补充数量", "一批补多少地址。", "1–100 的整数", 1, 100],
  ["concurrency", "建址并发上限", "同时创建多少地址。", "1–10 的整数，不超过每批数量", 1, 10],
] as const;

export function CregisPoolPolicy({canManage,openActionConfirm}:{canManage:boolean;openActionConfirm:DCtx["openActionConfirm"]}) {
  const [saved,setSaved]=useState<Policy|null>(null);
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const sequence=useRef(0),live=useRef(true),owner=useAdminAuth(s=>s.session?.adminId),epoch=useAdminAuth(s=>s.authEpoch);
  const owns=useCallback(()=>live.current && useAdminAuth.getState().isAuthenticated
    && useAdminAuth.getState().session?.adminId===owner && useAdminAuth.getState().authEpoch===epoch,[owner,epoch]);
  const refresh=useCallback(async()=>{
    const at=++sequence.current;setLoading(true);setError("");
    try {const next=parsePoolPolicy(await financeAdminRequest<unknown>("/cregis/addresses/policy"));
      if(owns() && at===sequence.current)setSaved(next);}
    catch(e){if(owns() && at===sequence.current){setSaved(null);setError(displayAdminReadError(e));}}
    finally{if(owns() && at===sequence.current)setLoading(false);}
  },[owns]);
  useEffect(()=>{live.current=true;void refresh();return()=>{live.current=false;sequence.current++;};},[refresh]);
  const save=()=>{
    if(!saved || busy || !canManage || !owns())return;
    const current=saved;
    openActionConfirm({ briefKind: "config",action:"保存地址池补充配置",title:"调整地址池补充",confirmLabel:"确认保存",
      effect:<StatusTag tone="progress" filled>保存后立即生效</StatusTag>,
      detail:`现在：备用目标 ${current.target}，低于 ${current.lowWatermark} 触发补充，每批 ${current.batchSize}，建址并发 ${current.concurrency}；自动补充${current.enabled?"开启":"关闭"}。`,
      reasonMin:10,reasonMax:255,completionCopy:"保存后按新配置补充地址，已有用户地址保持绑定",
      businessForm:{kind:"multi-field",requireAnyChange:true,
        feedback:(form)=>{
          const target=Number(form.target),low=Number(form.lowWatermark),batch=Number(form.batchSize),concurrency=Number(form.concurrency);
          if([target,low,batch,concurrency].some(n=>!Number.isFinite(n)))return {message:"",invalid:false};
          if(low>=target)return {field:"lowWatermark",message:"补充触发阈值要低于备用地址目标",invalid:true};
          if(concurrency>batch)return {field:"concurrency",message:"建址并发上限不能超过每批补充数量",invalid:true};
          return {message:"",invalid:false};
        },
        fields:[
          {key:"enabled",label:"自动补充",inputKind:"select",options:["true","false"],optionLabels:{true:"开启",false:"关闭"},current:String(current.enabled),showDiff:true,explain:"库存低时自动补地址。"},
          ...NUMBERS.map(([key,label,what,hint,min,max])=>({key,label,inputKind:"number" as const,current:String(current[key]),min,max,step:1,showDiff:true,required:true,explain:`${what}${hint}。用户看不到，只影响地址库存。`})),
        ]},
      run:async(reason,_value,form)=>{
        if(!owns() || !useAdminAuth.getState().session?.authorities.includes("finance_d1_channel_manage"))throw new Error("登录身份或权限已变化，请重新打开页面");
        const selected=parsePoolPolicy({enabled:form?.enabled==="true",target:Number(form?.target),lowWatermark:Number(form?.lowWatermark),batchSize:Number(form?.batchSize),concurrency:Number(form?.concurrency),version:current.version});
        setBusy(true);
        try{const next=parsePoolPolicy(await financeAdminRequest<unknown>("/cregis/addresses/policy",{method:"POST",body:JSON.stringify({...selected,reason}),idempotencyPrefix:"cregis-pool-policy"}));
          if(owns())setSaved(next);}
        catch(e){if(owns())void refresh();throw e;}
        finally{if(owns())setBusy(false);}
      }});
  };
  const block=loading?"正在读取最新数据":busy?"正在提交":!saved?"地址池配置没读到，刷新后再试":undefined;
  return <Panel icon={MapPin} tone="role-4" title="专属充值地址 · 库存与自动补充" sub={saved?`版本 v${saved.version}`:undefined}
    explain="首次进入充值页时分配专属地址，后续重复使用。BEP20 与 ERC20 分别计算库存，共用以下补充目标。低于补充阈值后，分批补至目标库存；已分配地址不计入备用库存。保存后直接生效；供应商限流或额度不足时延后补充。"
    actions={<>
      <Button size="sm" variant="ghost" icon={<RefreshCw size={14} aria-hidden/>} loading={loading} disabled={busy} onClick={()=>void refresh()}>刷新配置</Button>
      {canManage && <Button size="sm" disabledReason={block} onClick={save}>调整</Button>}
    </>}>
    {loading && !saved ? <BlockState state="loading" title="正在读取地址池配置…"/>
      : !saved ? <BlockState state="error" title="地址池配置读取失败" detail={error} onRetry={()=>void refresh()}/>
        : <ConfigList label="地址池补充">
          <ConfigRow name="自动补充" what="库存低时自动补地址。" when="保存后立即生效。" value={<SwitchTag on={saved.enabled}>{saved.enabled?"开启":"关闭"}</SwitchTag>}/>
          {NUMBERS.map(([key,label,what,hint])=><ConfigRow key={key} name={label} what={what} when="保存后立即生效。" effect={`${hint}。用户看不到，只影响地址库存。`} value={`${saved[key].toLocaleString("en-US")} 个`}/>)}
        </ConfigList>}
  </Panel>;
}
