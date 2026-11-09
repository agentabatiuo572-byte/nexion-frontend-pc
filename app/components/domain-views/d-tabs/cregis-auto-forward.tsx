"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { adminAuthActivityAllowed,adminAuthLifecycleEpoch } from "@/lib/admin/auth-lifecycle";
import { exceptionRead,exceptionList,exceptionCommand,exceptionId,exceptionVersion,type ExceptionRecord,type ExceptionPage } from "@/lib/admin/cregis-exceptions";
import { autoForwardStatus,autoForwardPage,AUTO_STATES,AUTO_ERRORS,type AutoNetwork } from "@/lib/admin/cregis-auto-forward";
import type { DCtx } from "./types";
type Props={canManage:boolean;openActionConfirm:DCtx["openActionConfirm"]};
const ROOT="/auto-forward",EMPTY:ExceptionPage={records:[],hasMore:false,nextBeforeId:null};
export function CregisAutoForward(props:Props){
  const [network,setNetwork]=useState<AutoNetwork>("BEP20");
  const auth=useAdminAuth(s=>s.session),epoch=useAdminAuth(s=>s.authEpoch);
  if(!auth?.authorities.includes("finance_d1_read"))return null;
  return <Owned network={network} onNetworkChange={setNetwork} key={`${network}:${auth.adminId}:${epoch}:${adminAuthLifecycleEpoch()}:${props.canManage}:${auth.authorities.join("|")}`} {...props} owner={auth.adminId} epoch={epoch}/>;
}
function Owned({canManage,openActionConfirm,owner,epoch,network,onNetworkChange}:Props&{owner:number;epoch:number;network:AutoNetwork;onNetworkChange:(network:AutoNetwork)=>void}){
  const networkQuery=network==="BEP20"?"":`?network=${network}`;
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
    try{const [config,next]=await Promise.all([exceptionRead(`${ROOT}/status${networkQuery}`,request),exceptionList(`${ROOT}/tasks${networkQuery}`,undefined,request)]);
      request.assertOwner();if(at!==read.current)return false;const checked=autoForwardStatus(config,network);setStatus(checked);setPage(autoForwardPage(next,network));setCollect(checked.collectionEnabled===true);setPay(checked.paymentEnabled===true);return true;
    }catch(failure){if(owns()&&at===read.current){setStatus(null);setPage(EMPTY);setError((failure as Error).message);}return false;}
    finally{if(owns()&&at===read.current)setLoading(false);}
  },[scope,owns,network]);
  useEffect(()=>{live.current=true;void refresh();return()=>{live.current=false;read.current++;};},[refresh]);
  const command=async(path:string,body:ExceptionRecord)=>{
    const request=scope(true);request.assertOwner();if(mutation.current)throw new Error("上一项操作尚未完成，请先刷新核对");
    mutation.current=true;setBusy(true);setError("");
    try{await exceptionCommand(`${ROOT}${path}${networkQuery}`,body,request);request.assertOwner();if(!await refresh())throw new Error("已提交，但页面没刷新出来。请不要重复提交，关闭弹窗后刷新查看。");}
    catch(failure){if(owns())setError((failure as Error).message);throw failure;}
    finally{mutation.current=false;if(owns())setBusy(false);}
  };
  const policy=(action:"PROPOSE"|"APPROVE"|"CANCEL"|"PAUSE")=>{
    try{assertOwner(true);if(!status)throw new Error("请刷新配置");
      const snapshot={action,expectedVersion:exceptionVersion(status.version),collectionEnabled:collect,paymentEnabled:pay};
      openActionConfirm({ briefKind: "config",action:action==="PAUSE"?"暂停自动资金流程":action==="PROPOSE"?"提交自动流程开关提案":action==="APPROVE"?"复核自动流程开关":"取消自动流程开关提案",
        detail:action==="PAUSE"?`${network}：停止新的自动归集到cregis及cregis转平台收款钱包，原单仍继续只读核对。`:action==="PROPOSE"?`${network} · 自动归集到cregis ${collect?"开":"关"} · cregis转平台收款钱包 ${pay?"开":"关"}。开启需另一位管理员复核，且运行总开关已批准。`:`${network} · 待审核：自动归集到cregis ${status.pendingCollection?"开":"关"} · cregis转平台收款钱包 ${status.pendingPayment?"开":"关"}。`,
        reasonMin:10,reasonMax:300,completionCopy:"自动流程配置已保存，请核对实际开关",run:reason=>command("/policy",{...snapshot,reason})});
    }catch(failure){setError((failure as Error).message);}
  };
  const recover=(row:ExceptionRecord,retry:boolean)=>{
    try{assertOwner(true);const id=exceptionId(row.id),cid=retry?"":exceptionId((cids[id]??"").trim());
      const snapshot={expectedVersion:exceptionVersion(row.version),stage:String(row.state).startsWith("COLLECTION")?"COLLECTION":"PAYMENT",cid,retry};
      openActionConfirm({ briefKind: retry ? "funds" : "record",action:retry?"申请重试明确拒绝的自动任务":"核对自动任务原 CID",detail:retry?`${network} · 任务 ${id} · 仅限没有 CID 的明确创建拒绝；未知请求不能重试。发送仍受全部开关和证据约束。`:`${network} · 任务 ${id} · 原 CID ${cid}。仅绑定供应商核实的原单，不创建新转账。`,
        reasonMin:10,reasonMax:300,completionCopy:"任务恢复记录已保存，请刷新核对",run:reason=>command(`/tasks/${id}/recover`,{...snapshot,reason})});
    }catch(failure){setError((failure as Error).message);}
  };
  const more=async()=>{
    const request=scope();request.assertOwner();const at=++read.current;setLoading(true);
    try{const next=await exceptionList(`${ROOT}/tasks${networkQuery}`,page.nextBeforeId??undefined,request);request.assertOwner();if(at===read.current){const checked=autoForwardPage(next,network);setPage({...checked,records:[...page.records,...checked.records]});}}
    catch(failure){if(owns()&&at===read.current)setError((failure as Error).message);}
    finally{if(owns()&&at===read.current)setLoading(false);}
  };
  return <section className="cregis-exceptions cregis-settings-card cregis-auto-forward" aria-label="自动归集到cregis与cregis转平台收款钱包">
    <div className="cregis-section-title">{network} 自动归集到cregis · cregis转平台收款钱包 <button className="l-btn sm" disabled={busy||loading} onClick={()=>void refresh()}>刷新自动流程</button></div>
    <nav className="cregis-navigation" aria-label="自动资金流程网络">{(["BEP20","ERC20","TRC20"] as const).map(n=><button key={n} aria-pressed={network===n} onClick={()=>onNetworkChange(n)}>{n}</button>)}</nav>
    <p>充值核实入账 → 自动归集到cregis（充值全额）→ 链上确认 → cregis转平台收款钱包（用户入账净额）。充值手续费留在cregis归集钱包，{String(status?.gasSymbol??({BEP20:"BNB",ERC20:"ETH",TRC20:"TRX"}[network]))} 链上手续费由平台另付；不重复入账或扣用户余额。</p>
    {error&&<p role="alert" className="dtint bad">{error}</p>}{loading&&<p>正在读取自动资金流程…</p>}
    {status&&<>
      <p className={status.executionEnabled?"dtint warn":"dtint"}>{network} · {status.configured?"地址已配置":"地址待配置"} · 运行总开关：{status.runtimeApproved?"已批准":"关闭"} · 自动归集到cregis：{status.collectionEnabled?"开启":"关闭"} · cregis转平台收款钱包：{status.paymentEnabled?"开启":"关闭"}</p>
      {!status.runtimeApproved&&<p>当前不发送自动转账。未来启用前须确认 Cregis 自动审批/签名及套餐权益、绑定钱包和 {String(status.gasSymbol)} 手续费安排，再取得运行总开关批准，并由另一位管理员复核开关。</p>}
      <dl className="cregis-address-facts"><dt>cregis归集钱包 / 转出来源</dt><dd>{String(status.platformAddress??"待配置")}</dd><dt>平台收款钱包</dt><dd>{String(status.counterpartyAddress??"待配置")}</dd></dl>
      {!status.configured&&<p className="dtint warn cregis-auto-warning"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5"/><circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none"/></svg><span>地址与运行权限核实后才能启用。</span></p>}
      <p>{status.startEventId===null?"尚未首次启用，不会处理历史充值。":"仅处理首次启用水位之后的充值事件，暂停和恢复不会重置水位。"} 已发送单在关闭后仍继续只读核对。</p>
      {canWrite&&<div className="cregis-switch-form cregis-auto-controls">
        <div className="cregis-auto-options">
        <label><input aria-label="自动归集到cregis提案开关" type="checkbox" checked={collect} disabled={busy||loading||!status.runtimeApproved||!status.configured} onChange={e=>setCollect(e.target.checked)}/>自动归集到cregis</label>{" "}
        <label><input aria-label="cregis转平台收款钱包提案开关" type="checkbox" checked={pay} disabled={busy||loading||!status.runtimeApproved||!status.configured} onChange={e=>setPay(e.target.checked)}/>cregis转平台收款钱包</label>{" "}
        </div>
        <div className="cregis-auto-actions">
        <button className="l-btn" disabled={busy||loading||!status.runtimeApproved||!status.configured||status.makerId!==null} onClick={()=>policy("PROPOSE")}>提交自动流程开关提案</button>{" "}
        <button className="l-btn" disabled={busy||loading} onClick={()=>policy("PAUSE")}>暂停本网络流程</button>
        </div>
        {status.makerId!==null&&<p>待复核提案：自动归集到cregis {status.pendingCollection?"开":"关"} · cregis转平台收款钱包 {status.pendingPayment?"开":"关"} · 理由 {String(status.reason)}{" "}
          {String(status.makerId)!==String(owner)&&<button className="l-btn" disabled={busy||loading} onClick={()=>policy("APPROVE")}>复核自动流程开关</button>}{" "}
          <button className="l-btn" disabled={busy||loading} onClick={()=>policy("CANCEL")}>取消自动流程开关提案</button></p>}
      </div>}
      <div className="cregis-auto-tasks">
      <h4>{network} 自动任务与原单跟踪</h4>
      {!page.records.length&&!loading&&<div className="cregis-auto-empty">暂无自动任务。关闭状态不会创建任务或发送资金。</div>}
      {page.records.map(row=>{const id=String(row.id),state=String(row.state),stage=state.startsWith("COLLECTION")?"collection":"payment";return <article key={id} style={{border:"1px solid var(--border)",padding:12,overflowWrap:"anywhere"}}>
        <strong>{network} · 任务 {id} · {AUTO_STATES[state]??"状态未知"}</strong>
        <p>充值事件 {String(row.eventId)} · 自动归集到cregis {String(row.grossAmount)} USDT · cregis转平台收款钱包 {String(row.netAmount)} USDT · 留存手续费 {String(row.feeAmount)} USDT</p>
        <p>{String(row.sourceAddress)} → {String(row.platformAddress)} → {String(row.counterpartyAddress)}</p>
        <p>转平台收款钱包业务号 {String(row.paymentKey)} · 归集到cregis CID {String(row.collectionCid??"未取得")} · 转平台收款钱包 CID {String(row.paymentCid??"未取得")}</p>
        {Boolean(row.collectionTxid)&&<p>归集到cregis交易 {String(row.collectionTxid)}</p>}{Boolean(row.paymentTxid)&&<p>转平台收款钱包交易 {String(row.paymentTxid)}</p>}
        {Boolean(row.lastError)&&<p className="dtint warn">{AUTO_ERRORS[String(row.lastError)]??"任务条件待核实，请联系管理员"}</p>}
        {canWrite&&/_(UNKNOWN|FAILED)$/.test(state)&&<div>
          <input aria-label={`${network} · 任务 ${id} 原 CID`} value={cids[id]??""} disabled={busy||loading} inputMode="numeric" onChange={e=>setCids({...cids,[id]:e.target.value})}/>{" "}
          <button className="l-btn" disabled={busy||loading} onClick={()=>recover(row,false)}>核对原 CID</button>{" "}
          {state.endsWith("FAILED")&&!row[`${stage}Cid`]&&row.lastError==="CREGIS_AUTO_CREATE_REJECTED"&&<button className="l-btn" disabled={busy||loading} onClick={()=>recover(row,true)}>申请重试明确拒绝任务</button>}
        </div>}
      </article>;})}
      {page.hasMore&&<button className="l-btn" disabled={busy||loading} onClick={()=>void more()}>加载更早自动任务</button>}
      </div>
    </>}
  </section>;
}
