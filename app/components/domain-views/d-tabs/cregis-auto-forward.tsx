"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { adminAuthActivityAllowed,adminAuthLifecycleEpoch } from "@/lib/admin/auth-lifecycle";
import { exceptionRead,exceptionList,exceptionCommand,exceptionId,exceptionVersion,type ExceptionRecord,type ExceptionPage } from "@/lib/admin/cregis-exceptions";
import { autoForwardStatus,AUTO_STATES,AUTO_ERRORS } from "@/lib/admin/cregis-auto-forward";
import type { DCtx } from "./types";
type Props={canManage:boolean;openActionConfirm:DCtx["openActionConfirm"]};
const ROOT="/auto-forward",EMPTY:ExceptionPage={records:[],hasMore:false,nextBeforeId:null};
export function CregisAutoForward(props:Props){
  const auth=useAdminAuth(s=>s.session),epoch=useAdminAuth(s=>s.authEpoch);
  if(!auth?.authorities.includes("finance_d1_read"))return null;
  return <Owned key={`${auth.adminId}:${epoch}:${adminAuthLifecycleEpoch()}:${props.canManage}:${auth.authorities.join("|")}`} {...props} owner={auth.adminId} epoch={epoch}/>;
}
function Owned({canManage,openActionConfirm,owner,epoch}:Props&{owner:number;epoch:number}){
  const lifecycle=useRef(adminAuthLifecycleEpoch()).current,live=useRef(true),mutation=useRef(false),read=useRef(0);
  const [status,setStatus]=useState<ExceptionRecord|null>(null),[page,setPage]=useState<ExceptionPage>(EMPTY);
  const [collect,setCollect]=useState(false),[pay,setPay]=useState(false),[cids,setCids]=useState<Record<string,string>>({});
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const session=useAdminAuth(s=>s.session);
  const canWrite=canManage&&!!session?.authorities.includes("finance_d1_channel_manage")&&!!session?.authorities.includes("finance_d2_withdrawal_approve");
  const assertOwner=useCallback((write=false)=>{
    const now=useAdminAuth.getState(),rights=now.session?.authorities??[];
    if(!live.current||!now.isAuthenticated||now.session?.adminId!==owner||now.authEpoch!==epoch||adminAuthLifecycleEpoch()!==lifecycle
      ||!adminAuthActivityAllowed()||!rights.includes("finance_d1_read")||write&&(!canManage||!rights.includes("finance_d1_channel_manage")||!rights.includes("finance_d2_withdrawal_approve")))
      throw new Error("登录身份或权限已变化，请重新打开自动资金流程");
  },[owner,epoch,lifecycle,canManage]);
  const owns=useCallback(()=>{try{assertOwner();return true;}catch{return false;}},[assertOwner]);
  const scope=useCallback((write=false)=>({authEpoch:lifecycle,assertOwner:()=>assertOwner(write)}),[lifecycle,assertOwner]);
  const refresh=useCallback(async()=>{
    const request=scope();request.assertOwner();const at=++read.current;setLoading(true);setError("");
    try{const [config,next]=await Promise.all([exceptionRead(`${ROOT}/status`,request),exceptionList(`${ROOT}/tasks`,undefined,request)]);
      request.assertOwner();if(at!==read.current)return false;const checked=autoForwardStatus(config);setStatus(checked);setPage(next);setCollect(checked.collectionEnabled===true);setPay(checked.paymentEnabled===true);return true;
    }catch(failure){if(owns()&&at===read.current){setStatus(null);setPage(EMPTY);setError((failure as Error).message);}return false;}
    finally{if(owns()&&at===read.current)setLoading(false);}
  },[scope,owns]);
  useEffect(()=>{live.current=true;void refresh();return()=>{live.current=false;read.current++;};},[refresh]);
  const command=async(path:string,body:ExceptionRecord)=>{
    const request=scope(true);request.assertOwner();if(mutation.current)throw new Error("上一项操作尚未完成，请先刷新核对");
    mutation.current=true;setBusy(true);setError("");
    try{await exceptionCommand(`${ROOT}${path}`,body,request);request.assertOwner();if(!await refresh())throw new Error("变更已提交，但回读失败。请勿重复提交，关闭弹窗后刷新原记录核对。");}
    catch(failure){if(owns())setError((failure as Error).message);throw failure;}
    finally{mutation.current=false;if(owns())setBusy(false);}
  };
  const policy=(action:"PROPOSE"|"APPROVE"|"CANCEL"|"PAUSE")=>{
    try{assertOwner(true);if(!status)throw new Error("请刷新配置");
      const snapshot={action,expectedVersion:exceptionVersion(status.version),collectionEnabled:collect,paymentEnabled:pay};
      openActionConfirm({action:action==="PAUSE"?"暂停自动归集及付款":action==="PROPOSE"?"提交自动流程开关提案":action==="APPROVE"?"复核自动流程开关":"取消自动流程开关提案",
        detail:action==="PAUSE"?"停止新的自动归集与甲方付款，原单仍继续只读核对。":action==="PROPOSE"?`归集 ${collect?"开":"关"} · 付款 ${pay?"开":"关"}。开启须另一管理员复核及服务端运行总闸批准。`:`归集提案 ${status.pendingCollection?"开":"关"} · 付款提案 ${status.pendingPayment?"开":"关"}。按服务端提案版本处理。`,
        reasonMin:10,reasonMax:300,completionCopy:"自动流程配置已保存，请核对实际开关",run:reason=>command("/policy",{...snapshot,reason})});
    }catch(failure){setError((failure as Error).message);}
  };
  const recover=(row:ExceptionRecord,retry:boolean)=>{
    try{assertOwner(true);const id=exceptionId(row.id),cid=retry?"":exceptionId((cids[id]??"").trim());
      const snapshot={expectedVersion:exceptionVersion(row.version),stage:String(row.state).startsWith("COLLECTION")?"COLLECTION":"PAYMENT",cid,retry};
      openActionConfirm({action:retry?"申请重试明确拒绝的自动任务":"核对自动任务原 CID",detail:retry?`任务 ${id} · 仅限没有 CID 的明确创建拒绝；未知请求不能重试。发送仍受全部开关和证据约束。`:`任务 ${id} · 原 CID ${cid}。仅绑定供应商核实的原单，不创建新转账。`,
        reasonMin:10,reasonMax:300,completionCopy:"任务恢复记录已保存，请刷新核对",run:reason=>command(`/tasks/${id}/recover`,{...snapshot,reason})});
    }catch(failure){setError((failure as Error).message);}
  };
  const more=async()=>{
    const request=scope();request.assertOwner();const at=++read.current;setLoading(true);
    try{const next=await exceptionList(`${ROOT}/tasks`,page.nextBeforeId??undefined,request);request.assertOwner();if(at===read.current)setPage({...next,records:[...page.records,...next.records]});}
    catch(failure){if(owns()&&at===read.current)setError((failure as Error).message);}
    finally{if(owns()&&at===read.current)setLoading(false);}
  };
  return <section className="cregis-exceptions" aria-label="自动归集与甲方付款">
    <div className="cregis-section-title">USDT-BSC 自动归集与甲方付款 <button className="l-btn sm" disabled={busy||loading} onClick={()=>void refresh()}>刷新自动流程</button></div>
    <p>充值核实入账 → 自动归集充值全额至平台钱包 → 链上确认 → 自动向甲方支付用户入账净额。充值手续费留平台，链上手续费由平台另付；不重复入账或扣用户余额。</p>
    {error&&<p role="alert" className="dtint bad">{error}</p>}{loading&&<p>正在读取自动资金流程…</p>}
    {status&&<>
      <p className={status.executionEnabled?"dtint warn":"dtint"}>执行总闸：{status.runtimeApproved?"已批准":"关闭"} · 自动归集：{status.collectionEnabled?"开启":"关闭"} · 自动付款：{status.paymentEnabled?"开启":"关闭"}</p>
      {!status.runtimeApproved&&<p>当前不发送自动转账。未来启用前须确认 Cregis 自动审批/签名及套餐权益、绑定钱包和 BNB 手续费安排，再取得运行总闸批准及双人开关复核。</p>}
      <p style={{overflowWrap:"anywhere"}}>归集接收 / 付款来源：{String(status.platformAddress)}<br/>甲方接收：{String(status.counterpartyAddress)}</p>
      <p>{status.startEventId===null?"尚未首次启用，不会处理历史充值。":"仅处理首次启用水位之后的充值事件，暂停和恢复不会重置水位。"} 已发送单在关闭后仍继续只读核对。</p>
      {canWrite&&<div>
        <label><input aria-label="自动归集提案开关" type="checkbox" checked={collect} disabled={busy||loading||!status.runtimeApproved} onChange={e=>setCollect(e.target.checked)}/>自动归集</label>{" "}
        <label><input aria-label="自动甲方付款提案开关" type="checkbox" checked={pay} disabled={busy||loading||!status.runtimeApproved} onChange={e=>setPay(e.target.checked)}/>自动甲方付款</label>{" "}
        <button className="l-btn" disabled={busy||loading||!status.runtimeApproved||status.makerId!==null} onClick={()=>policy("PROPOSE")}>提交自动流程开关提案</button>{" "}
        <button className="l-btn" disabled={busy||loading} onClick={()=>policy("PAUSE")}>暂停自动归集及付款</button>
        {status.makerId!==null&&<p>待复核提案：归集 {status.pendingCollection?"开":"关"} · 付款 {status.pendingPayment?"开":"关"} · 理由 {String(status.reason)}{" "}
          {String(status.makerId)!==String(owner)&&<button className="l-btn" disabled={busy||loading} onClick={()=>policy("APPROVE")}>复核自动流程开关</button>}{" "}
          <button className="l-btn" disabled={busy||loading} onClick={()=>policy("CANCEL")}>取消自动流程开关提案</button></p>}
      </div>}
      <h4>自动任务与原单跟踪</h4>
      {!page.records.length&&!loading&&<p>暂无自动任务。关闭状态不会创建任务或发送资金。</p>}
      {page.records.map(row=>{const id=String(row.id),state=String(row.state),stage=state.startsWith("COLLECTION")?"collection":"payment";return <article key={id} style={{border:"1px solid var(--border)",padding:12,overflowWrap:"anywhere"}}>
        <strong>任务 {id} · {AUTO_STATES[state]??"状态待核实"}</strong>
        <p>充值事件 {String(row.eventId)} · 归集 {String(row.grossAmount)} USDT · 甲方 {String(row.netAmount)} USDT · 留存手续费 {String(row.feeAmount)} USDT</p>
        <p>{String(row.sourceAddress)} → {String(row.platformAddress)} → {String(row.counterpartyAddress)}</p>
        <p>付款业务号 {String(row.paymentKey)} · 归集 CID {String(row.collectionCid??"未取得")} · 付款 CID {String(row.paymentCid??"未取得")}</p>
        {Boolean(row.collectionTxid)&&<p>归集交易 {String(row.collectionTxid)}</p>}{Boolean(row.paymentTxid)&&<p>付款交易 {String(row.paymentTxid)}</p>}
        {Boolean(row.lastError)&&<p className="dtint warn">{AUTO_ERRORS[String(row.lastError)]??"任务条件待核实，请联系管理员"}</p>}
        {canWrite&&/_(UNKNOWN|FAILED)$/.test(state)&&<div>
          <input aria-label={`任务 ${id} 原 CID`} value={cids[id]??""} disabled={busy||loading} inputMode="numeric" onChange={e=>setCids({...cids,[id]:e.target.value})}/>{" "}
          <button className="l-btn" disabled={busy||loading} onClick={()=>recover(row,false)}>核对原 CID</button>{" "}
          {state.endsWith("FAILED")&&!row[`${stage}Cid`]&&row.lastError==="CREGIS_AUTO_CREATE_REJECTED"&&<button className="l-btn" disabled={busy||loading} onClick={()=>recover(row,true)}>申请重试明确拒绝任务</button>}
        </div>}
      </article>;})}
      {page.hasMore&&<button className="l-btn" disabled={busy||loading} onClick={()=>void more()}>加载更早自动任务</button>}
    </>}
  </section>;
}
