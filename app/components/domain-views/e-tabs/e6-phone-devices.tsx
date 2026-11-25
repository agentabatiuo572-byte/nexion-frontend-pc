"use client";
import { useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, Info, CircleMinus, MoreHorizontal, PauseCircle, Power, Smartphone, WifiOff } from "lucide-react";
import { E6ConfirmModal } from "./e6-confirm-modal";
import { Button, Cell, ColumnPicker, Conclusion, Explain, Fact, Facts, FilterBar, IconButton, Input, IrreversibleTag, MoreMenu, Pager, Panel, RatioBar, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr, useTableColumns, type MoreMenuItem } from "@/app/components/rd";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { canActivateE5Device, canResumeE5UserDevicesFrom, fetchE5Devices, pausedReasonText, type E5Device } from "@/lib/admin/e5-client";
import type { EViewCtx } from "./types";
import { E6PendingNotice, useE6DraftEditor, useE6Mutations, type E6WriteReceipt } from "./e6-mutations";
import { e5StoppedNote } from "./e5-device-state";
import { e6AmountPrecision } from "@/lib/admin/e6-decimal";
import { E6Amount, E6OriginalValues } from "./e6-amount";
import { currentRecoveryActor } from "@/lib/admin/abe-recovery-access";
import { PROPOSAL_END } from "./e-command-check";
import { displayAdminError, formatAdminApiError } from "@/lib/admin/error-messages";
const STATES: Record<E5Device["state"],string>={active:"在线",busy:"任务中",offline:"离线",inventory:"待激活","pending-deactivate":"停用中",unbound:"已解绑 / 停用",abnormal:"异常",unknown:"状态未知"};
const STATE_STYLE = { active: {tone:"ok"}, busy: {tone:"progress",icon:Activity}, offline: {tone:"done",icon:WifiOff}, inventory: {tone:"neutral",icon:Power}, "pending-deactivate": {tone:"progress"}, unbound: {tone:"done",icon:CircleMinus}, abnormal: {tone:"warn",icon:AlertTriangle}, unknown: {tone:"neutral",icon:Info} } as const;
const LABELS={activate:"激活手机",deactivate:"取消激活",force:"强制激活",unbind:"解绑手机",pause:"暂停该用户",resume:"恢复该用户"};
type Action=keyof typeof LABELS;
// 主状态和后端的先后一致：停用、停用中排在运营暂停前面（暂停原因仍在问号里）。
const shownPaused=(d:E5Device)=>!!d.pausedReason&&d.state!=="unbound"&&d.state!=="pending-deactivate";
// 「已解绑 / 停用」合并了几种手机：显示时按归属和真实状态分开，叫法和 E5 一样（请求里的原状态仍用 STATES）。
// 手机行不看设备进度：读不到归属时只按原始状态说，和以前一样。
const stopped=(d:E5Device)=>e5StoppedNote({...d,simState:null});
// 取消激活、解绑、置换回收时后端写的停跑原因就是动作本身，标签已经说了；其余原因按 E5 的叫法翻译。
const pauseShown=(d:E5Device)=>!!d.pausedReason&&!(d.state==="unbound"&&["deactivate","unbind","recycle","replace"].includes(d.pausedReason.trim().toLowerCase()));
const stateLabel=(d:E5Device)=>shownPaused(d)?"已暂停":d.state==="unbound"?stopped(d).label:STATES[d.state];
// 表头写「电量和心跳」，第二行常显距上次心跳多久；完整遥测仍在电量的气泡里。
const heartbeatAge=(s:number|null)=>s==null?"心跳未采集":`心跳 ${s<60?`${Math.floor(s)} 秒`:s<3600?`${Math.floor(s/60)} 分钟`:s<86400?`${Math.floor(s/3600)} 小时`:`${Math.floor(s/86400)} 天`}前`;
export function E6PhoneDevices({ctx}:{ctx:EViewCtx}) {
  const m=useE6Mutations();
  const canAct=ctx.canWriteE5||m.canPropose&&(ctx.canForceActivateE5||ctx.canUnbindE5);
  const columns=useTableColumns("e6-user-phones",[{key:"device",label:"设备",locked:"设备不能隐藏"},{key:"user",label:"用户"},{key:"state",label:"状态",locked:"状态不能隐藏"},{key:"daily",label:"每日收益"},{key:"battery",label:"电量和心跳"},...(canAct?[{key:"action",label:"操作",locked:"操作不能隐藏"}]:[]),{key:"task",label:"当前任务",extra:true}]);
  const [confirm,setConfirm]=useState<{device:E5Device;action:Action}|null>(null);
  const confirmRef = useRef(confirm); confirmRef.current = confirm;
  const readBlock = m.phoneWriteBlock;
  const precision=e6AmountPrecision(ctx.e5Devices.flatMap(d=>d.dailyUsdt==null?[]:[d.dailyUsdtText??String(d.dailyUsdt)]));
  const query=(values:Record<string,string|number>)=>{const u=new URL(window.location.href);for(const [k,v]of Object.entries(values))u.searchParams.set(k,String(v));window.history.replaceState(window.history.state,"",`${u.pathname}${u.search}${u.hash}`);};
  useEffect(()=>{const u=new URLSearchParams(window.location.search),size=Number(u.get("phonePageSize")),page=Number(u.get("phonePage"));if([10,20,50].includes(size))ctx.setE5PageSize(size);if(u.has("phoneKeyword"))ctx.setE5Keyword(u.get("phoneKeyword")!);if(Number.isSafeInteger(page)&&page>0)ctx.setE5Page(page);},[]);
  const phoneScope=(d:E5Device)=>`phone:${d.deviceId}:${d.userId}`;
  const items=(d:E5Device):MoreMenuItem[]=>{
    // Use the same ownership evidence and allowed raw statuses as E5.
    const activatable=canActivateE5Device(d),forceActivatable=canActivateE5Device(d,true);
    const result:MoreMenuItem[]=[],deactivatable=["active","busy","offline","abnormal","unknown"].includes(d.state),full=d.activeDevicesForUser>=6;
    const add=(action:Action,blocked?:string,danger=false)=>result.push({key:action,label:LABELS[action],danger,disabledReason:readBlock??blocked??((m.locked(phoneScope(d))||m.legacyPhoneLocked(d.serial,d.deviceId,d.userId))?"这个手机或用户有结果未知的原操作":undefined),onSelect:()=>setConfirm({device:d,action})});
    if(activatable&&ctx.canWriteE5)add("activate",full?"已达 6 台上限，请先停用其他设备":undefined);
    if(forceActivatable&&ctx.canForceActivateE5&&m.canPropose)add("force",full?"已达 6 台上限，强制激活也不能绕过":undefined);
    if(deactivatable&&ctx.canWriteE5)add("deactivate");
    if(ctx.canWriteE5&&(d.pausedReason?canResumeE5UserDevicesFrom(d):deactivatable))add(d.pausedReason?"resume":"pause",m.locked(`user:${d.userId}`)?"这个用户有结果未知的原操作":undefined,!d.pausedReason);
    if(deactivatable&&ctx.canUnbindE5&&m.canPropose)add("unbind",undefined,true);
    return result;
  };
  useE6DraftEditor(["activate", "deactivate", "pause", "resume", "e5_device_force_activate", "e5_device_unbind"], !!confirm, async (record, stillAvailable) => {
    if (readBlock || !canAct || record.payload.kind === "risk") return false;
    const payload = record.payload;
    const action = payload.kind === "device" ? payload.input.action : payload.input.command.op === "e5_device_unbind" ? "unbind" : "force";
    const deviceId = payload.kind === "device" ? payload.input.deviceId : Number(payload.input.command.params.deviceId);
    const userId = payload.kind === "device" ? String(payload.input.userId) : /^phone:\d+:(\d+)$/.exec(record.scope)?.[1];
    const serial = payload.kind === "device" ? payload.input.serial : record.label.split(" · ").slice(1).join(" · ").trim();
    if (!Number.isSafeInteger(deviceId) || !userId || !/^\d+$/.test(userId)) return false;
    // Use a separate read, so recovering a device does not move the operator's current list.
    const latest = await fetchE5Devices({ userId, keyword: serial, pageNum: 1, pageSize: 10 }, true);
    if (!currentRecoveryActor(record.owner) || !stillAvailable() || confirmRef.current) return false;
    const device = latest.records.find(item => item.deviceId === deviceId && item.userId === userId
      && (!serial || item.serial === serial)
      && record.scope === (action === "pause" || action === "resume" ? `user:${item.userId}` : phoneScope(item)));
    if (!device || !items(device).some(item => item.key === action && !item.disabledReason)) return false;
    setConfirm({ device, action });
    return true;
  });
  const reportReceipt = (result?: E6WriteReceipt, action?: Action) => {
    if (result?.proposal) {
      const { ticketId, status } = result.proposal;
      const text = status === "pending" ? "等待审批，批准前手机状态不变" : PROPOSAL_END[status]?.text;
      ctx.toast(`审批单 ${ticketId} · ${text ?? "状态待核实"}${result.readbackFailed ? "；手机列表暂时读不到，请重试。" : ""}`,
        result.readbackFailed || status !== "pending" && status !== "approved" ? "warn" : undefined);
      return;
    }
    if (!result) return;
    if (result.pendingDeactivate) ctx.toast(`已申请，任务结算后停用。${result.readbackFailed ? "最新手机列表暂时读不到，请重试读取。" : ""}`, result.readbackFailed ? "warn" : undefined);
    else if (result.readbackFailed) ctx.toast("原操作已执行，最新手机列表暂时读不到，请重试读取。", "warn");
    else if (result.changedCount !== undefined && (action === "pause" || action === "resume")) ctx.toast(`${action === "pause" ? "已暂停" : "已恢复"} ${result.changedCount} 台设备`);
    else ctx.toast("原操作已执行，已重新读取手机列表。");
  };
  const scope=confirm?(confirm.action==="pause"||confirm.action==="resume"?`user:${confirm.device.userId}`:phoneScope(confirm.device)):"";
  const consequence=confirm?.action==="activate"?"激活后占用一个设备名额；每人最多 6 台，包含手机。":confirm?.action==="force"?"手机激活后占用一个名额；每人最多 6 台，包含手机。":confirm?.action==="deactivate"?"停用后不接新任务、不占名额，不退款；要再用可以申请强制激活。":confirm?.action==="unbind"?"手机不再归这位用户，后台不能再恢复；不退款，购入时间不变，解绑后没有收益。":confirm?.action==="pause"?"将暂停该用户全部设备（含手机）。停跑期间不计收益、不补发。":"只恢复运营手动暂停的设备；退款、注销、换机、离线、电量低等系统暂停保持不变。停跑期间收益不补发。";
  return <><E6PendingNotice section="phones" toast={ctx.toast} onRead={reportReceipt}/>
    <Conclusion state="neutral" icon={Smartphone}>{ctx.e5Loading?"正在查询用户手机":ctx.e5DeviceError?"等手机列表读取成功后可用":`当前查询共 ${ctx.e5Total} 台手机`}{ctx.e5Keyword&& !ctx.e5DeviceError?` · ${ctx.e5Keyword}`:""}</Conclusion>
    <Panel title="用户手机" className="e6-phone-panel" icon={Smartphone} tone="role-2" flush data-proof="e6-phone-devices" explain="每人最多 6 台设备，包含手机。这里显示手机心跳状态，没有商城 SIM 任务进度。" actions={<ColumnPicker columns={columns}/> }>
      <div className="e6-phone-tools"><FilterBar><Input className="rd-filter-grow" aria-label="搜索用户手机" placeholder="搜索用户 / 手机" value={ctx.e5Keyword} onChange={e=>{ctx.setE5Keyword(e.target.value);query({phoneKeyword:e.target.value,phonePage:1});}}/>{(!ctx.e5DeviceError||ctx.e5Loading)&&<Button disabled={ctx.e5Loading} onClick={()=>void ctx.refreshE5()}>刷新</Button>}</FilterBar></div>
      <Table label="用户手机" className="e6-phones-table" data-tight><thead><tr><Th>设备</Th>{columns.isVisible("user")&&<Th className="e6-pcol-user">用户</Th>}<Th className="e6-pcol-status">状态</Th>{columns.isVisible("daily")&&<Th className="e6-pcol-daily" align="right">每日收益</Th>}{columns.isVisible("battery")&&<Th className="e6-pcol-battery" align="right">电量和心跳</Th>}{columns.isVisible("task")&&<Th className="e6-pcol-task">当前任务</Th>}{canAct&&<Th className="e6-pcol-action" sticky="end">操作</Th>}</tr></thead><tbody>
      {ctx.e5Loading?<TableLoading columns={columns.all.filter(c=>columns.isVisible(c.key)).length}/>:ctx.e5DeviceError?<TableMessage columns={columns.all.filter(c=>columns.isVisible(c.key)).length} role="alert">{ctx.e5DeviceError}<Button size="sm" onClick={()=>void ctx.refreshE5()}>重试</Button></TableMessage>:!ctx.e5Devices.length?<TableMessage columns={columns.all.filter(c=>columns.isVisible(c.key)).length}>暂无符合条件的手机</TableMessage>:ctx.e5Devices.map(d=><Tr key={d.deviceId}>
        <Td className="e6-phone-device"><Cell main={<E6OriginalValues original={d.deviceName}><span className="e6-end-text">{d.deviceName}</span></E6OriginalValues>} sub={<E6OriginalValues original={d.serial}><span data-mono className="e6-middle-text"><span>{d.serial.slice(0,-8)}</span><span>{d.serial.slice(-8)}</span></span></E6OriginalValues>} title={d.deviceName}/></Td>
        {columns.isVisible("user")&&<Td className="e6-phone-user"><Cell main={d.nickname} sub={d.userNo} title={`${d.nickname} · ${d.userNo}`}/></Td>}
        <Td>{(()=>{const status=<span className="e6-phone-status"><StatusTag {...(shownPaused(d)?{tone:"done",icon:PauseCircle} as const:STATE_STYLE[d.state])}>{stateLabel(d)}</StatusTag>{(pauseShown(d)||d.state==="abnormal")&&<Explain label={`${d.serial}的状态原因`} rows={[...(pauseShown(d)?[{k:"暂停原因",v:pausedReasonText(d.pausedReason)}]:[]),...(d.state==="abnormal"?[{k:"异常状态",v:d.runtimeStatus}]:[])]}/>}</span>;return d.state==="unbound"?<Cell main={status} sub={stopped(d).sub}/>:status;})()}</Td>
        {columns.isVisible("daily")&&<Td align="right" data-num="">{d.dailyUsdt==null?"—":<><E6Amount raw={d.dailyUsdtText??String(d.dailyUsdt)} precision={precision} currency="USDT"/> USDT</>}</Td>}
        {columns.isVisible("battery")&&<Td align="right" data-num=""><Cell main={<Explain label={`${d.serial}的手机遥测`} align="end" rows={[{k:"原始状态",v:d.rawStatus},{k:"运行状态",v:d.runtimeStatus},{k:"电量",v:d.batteryLevel==null?"未采集":`${d.batteryLevel}%`},{k:"心跳",v:d.heartbeatAt&&d.heartbeatAt!=="—"?d.heartbeatAt:"未采集"},{k:"距心跳",v:d.heartbeatAgeSeconds==null?"未采集":`${d.heartbeatAgeSeconds} 秒`},{k:"充电",v:d.isCharging==null?"未采集":d.isCharging?"充电中":"未充电"},{k:"网络",v:d.isWifiConnected==null?"未采集":d.isWifiConnected?"网络可达":"网络断开"},{k:"温控",v:d.thermalState||"未采集"}]}>{d.batteryLevel==null?"未采集":`${d.batteryLevel}%`}</Explain>} sub={heartbeatAge(d.heartbeatAgeSeconds)}/></Td>}
        {columns.isVisible("task")&&<Td data-mono="" className="e6-phone-task">{d.activeTaskNo!=="—"?<E6OriginalValues original={d.activeTaskNo}><span className="e6-middle-text"><span>{d.activeTaskNo.slice(0,-8)}</span><span>{d.activeTaskNo.slice(-8)}</span></span></E6OriginalValues>:"—"}</Td>}
        {canAct&&<Td sticky="end">{items(d).length?<MoreMenu label={`操作 ${d.serial}`} items={items(d)}/>:d.state==="pending-deactivate"?<IconButton aria-label={`操作 ${d.serial}`} disabledReason="停用中，结算后自动停用，暂时没有可做的操作"><MoreHorizontal size={16} aria-hidden /></IconButton>:d.state==="unbound"?null:<span className="e6-no-action">当前状态无可用操作</span>}</Td>}
      </Tr>)}</tbody></Table>
      {!ctx.e5DeviceError&&ctx.e5Total>0&&<Pager label="用户手机" total={ctx.e5Total} page={ctx.e5Page} pageSize={ctx.e5PageSize} sizes={[10,20,50]} loading={ctx.e5Loading} onPage={p=>{ctx.setE5Page(p);query({phonePage:p});}} onPageSize={s=>{ctx.setE5PageSize(s);query({phonePage:1,phonePageSize:s});}}/>}
    </Panel>
    {confirm&&<E6ConfirmModal scope={scope} briefKind="record" statedBrief={{impact:consequence,check:"核对设备、用户、六台名额与处置后果，理由写明依据。"}} action={`${LABELS[confirm.action]} · ${confirm.device.serial}`} title={`${LABELS[confirm.action]} ${confirm.action==="pause"||confirm.action==="resume"?confirm.device.nickname:confirm.device.deviceName}`} reasonMin={8} reasonMax={200} confirmLabel={confirm.action==="force"||confirm.action==="unbind"?"确认提交":"确认执行"} confirmTone={confirm.action==="pause"||confirm.action==="unbind"?"danger":"primary"}
      detail={consequence}
      effect={confirm.action==="force"||confirm.action==="unbind"?<><StatusTag tone="progress" filled explain="另一位有审批权限和这项操作权限的管理员批准后执行，发起人不能自批；批准前手机状态不变。">批准后生效</StatusTag>{confirm.action==="unbind"&&<IrreversibleTag/>}</>:<StatusTag tone="progress" filled>立即生效</StatusTag>}
      completionCopy={confirm.action==="force"||confirm.action==="unbind"?"另一位管理员批准后执行，批准前手机状态不变。":"执行后读取手机列表核对真实状态。"}
      facts={<Facts><Fact k={confirm.action==="pause"||confirm.action==="resume"?"操作范围":"手机"}>{confirm.action==="pause"?"该用户全部设备，包含手机":confirm.action==="resume"?"该用户被运营暂停的设备，包含手机":confirm.device.deviceName}</Fact><Fact k="实例号"><span data-mono className="e6-serial">{confirm.device.serial}</span></Fact><Fact k="用户">{`${confirm.device.nickname} · ${confirm.device.userNo}`}</Fact><Fact k="原状态">{stateLabel(confirm.device)}</Fact>{confirm.action==="deactivate"&&<Fact k="什么时候停">有任务时这一单结算后停，没有任务立即停</Fact>}{(confirm.action==="activate"||confirm.action==="force")&&<Fact k="已占名额"><span className="e6-device-slots"><span>{confirm.device.activeDevicesForUser}/6 台</span><RatioBar label="设备名额" value={confirm.device.activeDevicesForUser} total={6} valueText={`${confirm.device.activeDevicesForUser}/6 台，含手机`} steps compact/></span></Fact>}</Facts>}
      blockedReason={readBlock} getPendingReason={()=>m.pendingReason(scope)} onClose={()=>setConfirm(null)}
      onRecovered={result=>{setConfirm(null);reportReceipt(result,confirm.action);}} onConfirm={async reason=>{
        if (readBlock) throw new Error(readBlock);
        let result: E6WriteReceipt | undefined;
        const d=confirm.device,action=confirm.action,original=m.pending.find(r=>r.scope===scope);
        if(original)result=await m.send(original,true);
        else if(action==="force"||action==="unbind") {if(action==="force"&&!canActivateE5Device(d,true))throw new Error(formatAdminApiError("INVALID_STATE_TRANSITION","INVALID_STATE_TRANSITION"));const def=findHighOp(action==="force"?"e5_device_force_activate":"e5_device_unbind")!,params={deviceId:d.deviceId};result=await m.proposal(scope,"phones",{action:`${LABELS[action]} · ${d.serial}`,obj:String(d.deviceId),beforeValue:stateLabel(d),afterValue:action==="force"?"激活":"解绑",type:def.type,amplifies:false,reason,sourceDomain:"E5",command:def.buildCommand(params),target:def.buildTarget(params)});}
        else {
          if(action==="activate"&&!canActivateE5Device(d))throw new Error(formatAdminApiError("INVALID_STATE_TRANSITION","INVALID_STATE_TRANSITION"));
          try{result=await m.device(scope,`${LABELS[action]} · ${d.serial}`,{before:`${STATES[d.state]}；已占 ${d.activeDevicesForUser}/6 台；暂停原因 ${d.pausedReason||"—"}`,serial:d.serial,deviceId:d.deviceId,userId:Number(d.userId),action,reason});}
          catch(failure){
            if(failure instanceof Error&&"backendMessage" in failure&&failure.backendMessage==="PAUSED_USER_DEVICES_NOT_FOUND"){
              await ctx.refreshE5();
              // Same as E5: nothing is left to resume, so close the dialog and say so once.
              if(!m.pendingReason(scope)){setConfirm(null);ctx.toast(displayAdminError(failure),"warn");return;}
            }
            throw failure;
          }
        }
        setConfirm(null); reportReceipt(result, action);
      }}/>}
  </>;
}
