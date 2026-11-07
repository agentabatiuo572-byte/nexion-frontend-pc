"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import { ArrowRightLeft, RefreshCw } from "lucide-react";
import { BlockState, Button, Cell, ConfigList, ConfigRow, Decision, Drawer, Fact, Facts, Fold, JudgmentPoints, KeyValues, Notice, Panel, StatusTag, Table, Td, Th, Tr } from "@/app/components/rd";
import type { StateTone } from "@/app/components/rd";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { adminAuthActivityAllowed,adminAuthLifecycleEpoch } from "@/lib/admin/auth-lifecycle";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { exceptionRead,exceptionList,exceptionCommand,exceptionId,exceptionVersion,type ExceptionRecord,type ExceptionPage } from "@/lib/admin/cregis-exceptions";
import { d1PendingObjectReason } from "@/lib/admin/d-client";
import { autoForwardStatus,AUTO_STATES,AUTO_ERRORS } from "@/lib/admin/cregis-auto-forward";
import { SwitchTag, usdt } from "./d1-shared";
import type { DCtx } from "./types";
type Props={canManage:boolean;openActionConfirm:DCtx["openActionConfirm"];onChanged?:()=>void};
const ROOT="/auto-forward",EMPTY:ExceptionPage={records:[],hasMore:false,nextBeforeId:null};
const taskTone=(state:string):StateTone=>state==="COMPLETED"?"ok":/_(UNKNOWN|FAILED)$/.test(state)?"warn":"progress";
export function CregisAutoForward(props:Props){
  const auth=useAdminAuth(s=>s.session),epoch=useAdminAuth(s=>s.authEpoch);
  if(!auth?.authorities.includes("finance_d1_read"))return null;
  return <Owned key={`${auth.adminId}:${epoch}:${adminAuthLifecycleEpoch()}:${props.canManage}:${auth.authorities.join("|")}`} {...props} owner={auth.adminId} epoch={epoch}/>;
}
function Owned({canManage,openActionConfirm,onChanged,owner,epoch}:Props&{owner:number;epoch:number}){
  const lifecycle=useRef(adminAuthLifecycleEpoch()).current,live=useRef(true),mutation=useRef(false),read=useRef(0);
  const [status,setStatus]=useState<ExceptionRecord|null>(null),[page,setPage]=useState<ExceptionPage>(EMPTY);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[selected,setSelected]=useState<string|null>(null);
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
      request.assertOwner();if(at!==read.current)return false;const checked=autoForwardStatus(config);setStatus(checked);setPage(next);return true;
    }catch(failure){if(owns()&&at===read.current){setStatus(null);setPage(EMPTY);setError(displayAdminReadError(failure));}return false;}
    finally{if(owns()&&at===read.current)setLoading(false);}
  },[scope,owns]);
  useEffect(()=>{live.current=true;void refresh();return()=>{live.current=false;read.current++;};},[refresh]);
  const command=async(path:string,body:ExceptionRecord)=>{
    const request=scope(true);request.assertOwner();if(mutation.current)throw new Error("上一项操作尚未完成，请先刷新核对");
    mutation.current=true;setBusy(true);
    try{await exceptionCommand(`${ROOT}${path}`,body,request);request.assertOwner();}
    finally{mutation.current=false;onChanged?.();if(owns()){setBusy(false);await refresh();}}
  };
  const approval=<StatusTag tone="progress" filled>另一位管理员复核后生效</StatusTag>;
  const policy=(action:"PROPOSE"|"APPROVE"|"CANCEL"|"PAUSE")=>{
    try{assertOwner(true);if(!status)throw new Error("请刷新配置");
      const held=d1PendingObjectReason(`/cregis${ROOT}/policy`,{action});if(held)throw new Error(held);
      const current=status,expectedVersion=exceptionVersion(current.version);
      const title=action==="PAUSE"?"暂停自动归集及付款":action==="PROPOSE"?"调整自动流程开关":action==="APPROVE"?"复核自动流程开关":"取消自动流程开关提案";
      const pendingFacts=<Facts><Fact k="待复核">归集 {current.pendingCollection?"开":"关"} · 付款 {current.pendingPayment?"开":"关"}</Fact><Fact k="发起人">{String(current.makerId)}</Fact><Fact k="理由">{String(current.reason)}</Fact></Facts>;
      openActionConfirm({ briefKind: "config",action:action==="PAUSE"?"暂停自动归集及付款":action==="PROPOSE"?"提交自动流程开关提案":action==="APPROVE"?"复核自动流程开关":"取消自动流程开关提案",
        title,confirmLabel:action==="PAUSE"?"确认暂停":action==="PROPOSE"?"提交审批":action==="APPROVE"?"确认复核":"确认取消",confirmTone:action==="PAUSE"?"danger":"primary",
        effect:action==="PROPOSE"?approval:<StatusTag tone="progress" filled>立即生效</StatusTag>,
        facts:action==="APPROVE"||action==="CANCEL"?pendingFacts:undefined,
        detail:action==="PAUSE"?"停止新的自动归集与甲方付款，原单仍继续只读核对。":action==="PROPOSE"?"开启需另一位管理员复核，且运行总开关已批准。":`待审核：归集 ${current.pendingCollection?"开":"关"} · 付款 ${current.pendingPayment?"开":"关"}。`,
        completionCopy:action==="PAUSE"?"确认后立即停止新的自动归集与甲方付款，已发送的原单继续只读核对。":action==="PROPOSE"?"另一位管理员复核后生效。":"自动流程配置已保存，请核对实际开关",
        businessForm:action==="PROPOSE"?{kind:"multi-field",requireAnyChange:true,fields:[
          {key:"collect",label:"自动归集",inputKind:"select",options:["true","false"],optionLabels:{true:"开",false:"关"},current:String(current.collectionEnabled===true),showDiff:true,explain:"入账后把充值全额归集到平台钱包。"},
          {key:"pay",label:"自动甲方付款",inputKind:"select",options:["true","false"],optionLabels:{true:"开",false:"关"},current:String(current.paymentEnabled===true),showDiff:true,explain:"归集确认后，按用户入账净额付款给甲方。"},
        ]}:undefined,
        reasonMin:10,reasonMax:300,run:(reason,_value,form)=>command("/policy",{action,expectedVersion,
          collectionEnabled:action==="PROPOSE"?form?.collect==="true":current.collectionEnabled===true,
          paymentEnabled:action==="PROPOSE"?form?.pay==="true":current.paymentEnabled===true,reason})});
    }catch(failure){setError(displayAdminError(failure));}
  };
  const recover=(row:ExceptionRecord,retry:boolean)=>{
    try{assertOwner(true);const id=exceptionId(row.id);
      const held=d1PendingObjectReason(`/cregis${ROOT}/tasks/${id}/recover`);if(held)throw new Error(held);
      const stage=String(row.state).startsWith("COLLECTION")?"COLLECTION":"PAYMENT",expectedVersion=exceptionVersion(row.version);
      openActionConfirm({ briefKind: retry ? "funds" : "record",action:retry?"申请重试明确拒绝的自动任务":"核对自动任务原 CID",title:retry?"申请重试明确拒绝的任务":"核对原 CID",
        confirmLabel:retry?"提交申请":"确认核对",effect:<StatusTag tone="progress" filled>立即生效</StatusTag>,
        facts:<Facts><Fact k="任务">{id}</Fact><Fact k="阶段">{stage==="COLLECTION"?"归集":"甲方付款"}</Fact><Fact k="金额">{usdt(String(stage==="COLLECTION"?row.grossAmount:row.netAmount))} USDT</Fact></Facts>,
        detail:retry?`任务 ${id} · 仅限没有 CID 的明确创建拒绝；未知请求不能重试。发送仍受全部开关和证据约束。`:`任务 ${id}。仅绑定供应商核实的原单，不创建新转账。`,
        completionCopy:retry?"发送仍受全部开关和证据约束，不会绕过任何检查。":"仅绑定供应商核实的原单，不创建新转账。",
        businessForm:retry?undefined:{kind:"multi-field",fields:[{key:"cid",label:"供应商原单 CID",inputKind:"text",required:true,pattern:"^[1-9][0-9]{0,18}$",patternMessage:"CID 只能是数字",maxLength:19}]},
        reasonMin:10,reasonMax:300,run:(reason,_value,form)=>command(`/tasks/${id}/recover`,{expectedVersion,stage,cid:retry?"":exceptionId((form?.cid??"").trim()),retry,reason})});
    }catch(failure){setError(displayAdminError(failure));}
  };
  const more=async()=>{
    const request=scope();request.assertOwner();const at=++read.current;setLoading(true);
    try{const next=await exceptionList(`${ROOT}/tasks`,page.nextBeforeId??undefined,request);request.assertOwner();if(at===read.current)setPage({...next,records:[...page.records,...next.records]});}
    catch(failure){if(owns()&&at===read.current)setError(displayAdminReadError(failure));}
    finally{if(owns()&&at===read.current)setLoading(false);}
  };
  const block=loading?"正在读取最新数据":busy?"正在提交":undefined;
  const proposeBlock=block??d1PendingObjectReason(`/cregis${ROOT}/policy`,{action:"PROPOSE"})??(!status?.runtimeApproved?"运行总开关还没批准，不能开启自动流程":status.makerId!==null?"有待复核的提案，先复核或取消":undefined);
  const records=page.records,index=records.findIndex(row=>String(row.id)===selected),task=index>=0?records[index]:null;
  const taskActions=(row:ExceptionRecord)=>{
    const state=String(row.state),stage=state.startsWith("COLLECTION")?"collection":"payment";
    if(!canWrite||!/_(UNKNOWN|FAILED)$/.test(state))return [];
    return [{key:"cid",label:"核对原 CID",run:()=>recover(row,false)},
      ...(state.endsWith("FAILED")&&!row[`${stage}Cid`]&&row.lastError==="CREGIS_AUTO_CREATE_REJECTED"?[{key:"retry",label:"申请重试明确拒绝任务",run:()=>recover(row,true)}]:[])];
  };
  const waiting=records.filter(row=>/_(UNKNOWN|FAILED)$/.test(String(row.state))).length;
  return <Panel icon={ArrowRightLeft} tone="role-2" title="自动归集与甲方付款"
    explain="充值核实入账 → 自动归集充值全额至平台钱包 → 链上确认 → 自动向甲方支付用户入账净额。充值手续费留平台，链上手续费由平台另付；不重复入账或扣用户余额。仅处理首次启用水位之后的充值事件，暂停和恢复不会重置水位；已发送单在关闭后仍继续只读核对。"
    actions={<>
      <Button size="sm" variant="ghost" icon={<RefreshCw size={14} aria-hidden/>} loading={loading} disabled={busy} onClick={()=>void refresh()}>刷新自动流程</Button>
      {canWrite&&status&&<Button size="sm" variant="danger-outline" disabledReason={block} onClick={()=>policy("PAUSE")}>暂停自动归集及付款</Button>}
    </>}>
    {error&&<Notice tone="warn">{error}</Notice>}
    {loading&&!status?<BlockState state="loading" title="正在读取自动资金流程…"/>
      :!status?<BlockState state="error" title="自动资金流程读取失败" detail={error} onRetry={()=>void refresh()}/>
        :<div className="rd-stack">
          {!status.runtimeApproved&&<Notice tone="neutral" title="当前不发送自动转账">未来启用前须确认 Cregis 自动审批/签名及套餐权益、绑定钱包和 BNB 手续费安排，再取得运行总开关批准，并由另一位管理员复核开关。</Notice>}
          {status.makerId!==null&&<Notice tone="progress" title="有一个开关提案待复核"
            action={canWrite?<>
              <Button size="sm" disabledReason={String(status.makerId)===String(owner)?"发起人不能复核自己的提案":block} onClick={()=>policy("APPROVE")}>复核自动流程开关</Button>
              <Button size="sm" variant="ghost" disabledReason={block} onClick={()=>policy("CANCEL")}>取消自动流程开关提案</Button>
            </>:undefined}>
            待复核提案：归集 {status.pendingCollection?"开":"关"} · 付款 {status.pendingPayment?"开":"关"} · 理由 {String(status.reason)}
          </Notice>}
          <ConfigList label="自动流程开关">
            <ConfigRow name="运行总开关" what="自动转账能不能运行" when="批准后生效" value={<SwitchTag on={status.runtimeApproved===true}>{status.runtimeApproved?"已批准":"关闭"}</SwitchTag>}/>
            <ConfigRow name="自动归集" what="入账后归集到平台钱包" when="另一位管理员复核后生效" value={<SwitchTag on={status.collectionEnabled===true}>{status.collectionEnabled?"开启":"关闭"}</SwitchTag>}
              action={canWrite?<Button size="sm" disabledReason={proposeBlock} onClick={()=>policy("PROPOSE")}>调整</Button>:undefined}/>
            <ConfigRow name="自动甲方付款" what="归集后付款给甲方" when="另一位管理员复核后生效" value={<SwitchTag on={status.paymentEnabled===true}>{status.paymentEnabled?"开启":"关闭"}</SwitchTag>}/>
            <ConfigRow name="归集接收 / 付款来源" value={<span data-mono="">{String(status.platformAddress)}</span>}/>
            <ConfigRow name="甲方接收" value={<span data-mono="">{String(status.counterpartyAddress)}</span>}/>
            <ConfigRow name="处理范围" value={status.startEventId===null?"尚未首次启用，不会处理历史充值。":"仅处理首次启用水位之后的充值事件。"}/>
          </ConfigList>
          <Fold inset title="自动任务与原单跟踪" alert={waiting>0} summary={records.length?`${waiting?`${waiting} 个待核查，`:""}共 ${records.length} 个`:"暂无自动任务"}>
            {records.length===0?<p className="rd-note">暂无自动任务。关闭状态不会创建任务或发送资金。</p>:<Table label="自动任务">
              <thead><tr><Th>任务</Th><Th align="right">归集 · 甲方（USDT）</Th><Th>状态</Th><Th sticky="end" align="right">操作</Th></tr></thead>
              <tbody>{records.map(row=>{const id=String(row.id),state=String(row.state),actions=taskActions(row);return <Tr key={id} selected={id===selected} onOpen={()=>setSelected(id)}>
                <Td><Cell mono main={`任务 ${id}`} sub={`充值事件 ${String(row.eventId)}`}/></Td>
                <Td align="right"><Cell num main={usdt(String(row.grossAmount))} sub={`甲方 ${usdt(String(row.netAmount))}`}/></Td>
                <Td><Cell main={<StatusTag tone={taskTone(state)}>{AUTO_STATES[state]??"状态未知"}</StatusTag>} sub={row.lastError?AUTO_ERRORS[String(row.lastError)]??"任务条件待核实，请联系管理员":undefined}/></Td>
                <Td sticky="end" align="right">{actions[0]?<Button size="sm" disabledReason={block} onClick={actions[0].run}>{actions[0].label}</Button>:<Button size="sm" variant="ghost" onClick={()=>setSelected(id)}>查看详情</Button>}</Td>
              </Tr>;})}</tbody>
            </Table>}
            {page.hasMore&&<Button size="sm" disabled={busy||loading} onClick={()=>void more()}>加载更早自动任务</Button>}
          </Fold>
        </div>}
    <Drawer open={!!task} onClose={()=>setSelected(null)} title="自动任务" sub={task?`任务 ${String(task.id)}`:undefined} icon={ArrowRightLeft} tone="role-2" busy={busy}
      nav={{hasPrev:index>0,hasNext:index>=0&&index<records.length-1,onPrev:()=>setSelected(String(records[index-1]?.id??selected)),onNext:()=>setSelected(String(records[index+1]?.id??selected))}}
      footer={task&&(()=>{const actions=taskActions(task);return actions.length?<Decision note={block} primary={actions.map((action,i)=><Button key={action.key} variant={i===0?"primary":"secondary"} disabledReason={block} onClick={action.run}>{action.label}</Button>)}/>:undefined;})()}>
      {task&&<>
        <JudgmentPoints rows={[
          {label:"状态",state:taskTone(String(task.state))==="progress"?undefined:taskTone(String(task.state)),value:AUTO_STATES[String(task.state)]??"状态未知",reason:task.lastError?AUTO_ERRORS[String(task.lastError)]??"任务条件待核实，请联系管理员":undefined},
          {label:"归集",value:`${usdt(String(task.grossAmount))} USDT`,reason:`甲方 ${usdt(String(task.netAmount))} USDT · 留存手续费 ${usdt(String(task.feeAmount))} USDT`},
        ]}/>
        <Fold inset title="原单和地址" summary={`付款业务号 ${String(task.paymentKey)}`}>
          <KeyValues rows={[
            {key:"from",label:"来源",value:String(task.sourceAddress),mono:true},
            {key:"platform",label:"平台钱包",value:String(task.platformAddress),mono:true},
            {key:"to",label:"甲方",value:String(task.counterpartyAddress),mono:true},
            {key:"ccid",label:"归集 CID",value:String(task.collectionCid??"未取得"),mono:true},
            {key:"pcid",label:"付款 CID",value:String(task.paymentCid??"未取得"),mono:true},
            ...(task.collectionTxid?[{key:"ctx",label:"归集交易",value:String(task.collectionTxid),mono:true}]:[]),
            ...(task.paymentTxid?[{key:"ptx",label:"付款交易",value:String(task.paymentTxid),mono:true}]:[]),
          ]}/>
        </Fold>
      </>}
    </Drawer>
  </Panel>;
}
