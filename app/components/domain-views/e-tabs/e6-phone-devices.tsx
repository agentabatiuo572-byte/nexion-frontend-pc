"use client";
import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Battery, CircleHelp, CircleMinus, PauseCircle, Power, Smartphone, Users, WifiOff } from "lucide-react";
import { OperationConfirmModal } from "../design-kit";
import { Button, Cell, ColumnPicker, Conclusion, Explain, Fact, Facts, FilterBar, Input, MoreMenu, Pager, Panel, RatioBar, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr, useTableColumns, type MoreMenuItem } from "@/app/components/rd";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { type E5Device } from "@/lib/admin/e5-client";
import type { EViewCtx } from "./types";
import { E6PendingNotice, useE6Mutations } from "./e6-mutations";
import { e6AmountPrecision } from "@/lib/admin/e6-decimal";
import { E6Amount, E6OriginalValues } from "./e6-amount";
const STATES: Record<E5Device["state"],string>={active:"在线",busy:"任务中",offline:"离线",inventory:"待激活","pending-deactivate":"停用中",unbound:"已解绑 / 停用",abnormal:"异常",unknown:"状态未知"};
const STATE_STYLE = { active: {tone:"ok"}, busy: {tone:"progress",icon:Activity}, offline: {tone:"done",icon:WifiOff}, inventory: {tone:"neutral",icon:Power}, "pending-deactivate": {tone:"progress"}, unbound: {tone:"done",icon:CircleMinus}, abnormal: {tone:"warn",icon:AlertTriangle}, unknown: {tone:"neutral",icon:CircleHelp} } as const;
const LABELS={activate:"激活手机",deactivate:"取消激活",force:"强制激活",unbind:"解绑手机",pause:"暂停该用户",resume:"恢复该用户"};
type Action=keyof typeof LABELS;
export function E6PhoneDevices({ctx}:{ctx:EViewCtx}) {
  const m=useE6Mutations();
  const columns=useTableColumns("e6-user-phones",[{key:"device",label:"设备",locked:"设备不能隐藏"},{key:"user",label:"用户"},{key:"state",label:"状态",locked:"状态不能隐藏"},{key:"daily",label:"每日收益"},{key:"battery",label:"电量"},{key:"action",label:"操作",locked:"操作不能隐藏"},{key:"task",label:"当前任务",extra:true}]);
  const [confirm,setConfirm]=useState<{device:E5Device;action:Action}|null>(null);
  const precision=e6AmountPrecision(ctx.e5Devices.flatMap(d=>d.dailyUsdt==null?[]:[d.dailyUsdtText??String(d.dailyUsdt)]));
  const query=(values:Record<string,string|number>)=>{const u=new URL(window.location.href);for(const [k,v]of Object.entries(values))u.searchParams.set(k,String(v));window.history.replaceState(window.history.state,"",`${u.pathname}${u.search}${u.hash}`);};
  useEffect(()=>{const u=new URLSearchParams(window.location.search),size=Number(u.get("phonePageSize")),page=Number(u.get("phonePage"));if([10,20,50].includes(size))ctx.setE5PageSize(size);if(u.has("phoneKeyword"))ctx.setE5Keyword(u.get("phoneKeyword")!);if(Number.isSafeInteger(page)&&page>0)ctx.setE5Page(page);},[]);
  const phoneScope=(d:E5Device)=>`phone:${d.deviceId}:${d.userId}`;
  const items=(d:E5Device):MoreMenuItem[]=>{
    const result:MoreMenuItem[]=[],activatable=d.state==="inventory"||d.state==="unbound",deactivatable=["active","busy","offline","abnormal","unknown"].includes(d.state),full=d.activeDevicesForUser>=6;
    const add=(action:Action,blocked?:string,danger=false)=>result.push({key:action,label:LABELS[action],danger,disabledReason:blocked??((m.locked(phoneScope(d))||m.legacyPhoneLocked(d.serial,d.deviceId,d.userId))?"这个手机或用户有原操作待确认":undefined),onSelect:()=>setConfirm({device:d,action})});
    if(activatable&&ctx.canWriteE5&&d.state==="inventory")add("activate",full?"已达 6 台上限，请先停用其他设备":undefined);
    if(activatable&&ctx.canForceActivateE5&&m.canPropose)add("force",full?"已达 6 台上限，强制激活也不能绕过":undefined);
    if(deactivatable&&ctx.canWriteE5)add("deactivate");
    if(deactivatable&&ctx.canWriteE5)add(d.pausedReason?"resume":"pause",m.locked(`user:${d.userId}`)?"这个用户有原操作待确认":undefined,!d.pausedReason);
    if(deactivatable&&ctx.canUnbindE5&&m.canPropose)add("unbind",undefined,true);
    return result;
  };
  const scope=confirm?(confirm.action==="pause"||confirm.action==="resume"?`user:${confirm.device.userId}`:phoneScope(confirm.device)):"";
  return <><E6PendingNotice section="phones" onRead={()=>void ctx.refreshE5()}/>
    <Conclusion state={ctx.e5DeviceError?"warn":"neutral"} icon={Smartphone}>{ctx.e5Loading?"正在查询用户手机":ctx.e5DeviceError?"手机列表读取失败，暂不能操作":`当前查询共 ${ctx.e5Total} 台手机`}{ctx.e5Keyword&& !ctx.e5DeviceError?` · ${ctx.e5Keyword}`:""}</Conclusion>
    <Panel title="用户手机" icon={Smartphone} tone="role-2" flush data-proof="e6-phone-devices" explain="每人最多 6 台设备，包含手机。这里显示手机心跳状态，没有商城 SIM 任务进度。" actions={<ColumnPicker columns={columns}/> }>
      <div className="e6-phone-tools"><FilterBar><Input className="rd-filter-grow" aria-label="搜索用户手机" placeholder="搜索用户 / 手机" value={ctx.e5Keyword} onChange={e=>{ctx.setE5Keyword(e.target.value);query({phoneKeyword:e.target.value,phonePage:1});}}/><Button disabled={ctx.e5Loading} onClick={()=>void ctx.refreshE5()}>刷新</Button></FilterBar></div>
      <Table label="用户手机" className="e6-phones-table" data-tight><thead><tr><Th icon={Smartphone} tone="devices">设备</Th>{columns.isVisible("user")&&<Th icon={Users} tone="users">用户</Th>}<Th>状态</Th>{columns.isVisible("daily")&&<Th align="right">每日收益</Th>}{columns.isVisible("battery")&&<Th align="right" icon={Battery} tone="devices">电量</Th>}{columns.isVisible("task")&&<Th>当前任务</Th>}<Th sticky="end">操作</Th></tr></thead><tbody>
      {ctx.e5Loading?<TableLoading columns={columns.all.filter(c=>columns.isVisible(c.key)).length}/>:ctx.e5DeviceError?<TableMessage columns={columns.all.filter(c=>columns.isVisible(c.key)).length} role="alert">{ctx.e5DeviceError}<Button size="sm" onClick={()=>void ctx.refreshE5()}>重试</Button></TableMessage>:!ctx.e5Devices.length?<TableMessage columns={columns.all.filter(c=>columns.isVisible(c.key)).length}>暂无符合条件的手机</TableMessage>:ctx.e5Devices.map(d=><Tr key={d.deviceId}>
        <Td className="e6-phone-device"><Cell main={d.deviceName} sub={<E6OriginalValues original={d.serial}><span data-mono className="e6-middle-text"><span>{d.serial.slice(0,-8)}</span><span>{d.serial.slice(-8)}</span></span></E6OriginalValues>} title={d.deviceName}/></Td>
        {columns.isVisible("user")&&<Td className="e6-phone-user"><Cell main={d.nickname} sub={d.userNo} title={`${d.nickname} · ${d.userNo}`}/></Td>}
        <Td><span className="e6-phone-status"><StatusTag {...(d.pausedReason?{tone:"done",icon:PauseCircle} as const:STATE_STYLE[d.state])}>{d.pausedReason?"已暂停":STATES[d.state]}</StatusTag><Explain label={`${d.serial}的原始状态`} content={<>原始状态：{d.rawStatus} · 运行状态：{d.runtimeStatus}<br/>暂停原因：{d.pausedReason||"—"}</>}/></span></Td>
        {columns.isVisible("daily")&&<Td align="right" data-num="">{d.dailyUsdt==null?"—":<><E6Amount raw={d.dailyUsdtText??String(d.dailyUsdt)} precision={precision} currency="USDT"/> USDT</>}</Td>}
        {columns.isVisible("battery")&&<Td align="right" data-num=""><span className="e6-phone-telemetry">{d.batteryLevel==null?"—":`${d.batteryLevel}%`}<Explain label={`${d.serial}的遥测`} rows={[{k:"心跳",v:d.heartbeatAt||"未采集"},{k:"距心跳",v:d.heartbeatAgeSeconds==null?"未采集":`${d.heartbeatAgeSeconds} 秒`},{k:"充电",v:d.isCharging==null?"未采集":d.isCharging?"充电中":"未充电"},{k:"网络",v:d.isWifiConnected==null?"未采集":d.isWifiConnected?"网络可达":"网络断开"},{k:"温控",v:d.thermalState||"未采集"}]}/></span></Td>}
        {columns.isVisible("task")&&<Td data-mono="" className="e6-phone-task">{d.activeTaskNo?<E6OriginalValues original={d.activeTaskNo}><span className="e6-middle-text"><span>{d.activeTaskNo.slice(0,-8)}</span><span>{d.activeTaskNo.slice(-8)}</span></span></E6OriginalValues>:"—"}</Td>}
        <Td sticky="end">{items(d).length?<MoreMenu label={`操作 ${d.serial}`} items={items(d)}/>:"只读"}</Td>
      </Tr>)}</tbody></Table>
      {!ctx.e5DeviceError&&ctx.e5Total>0&&<Pager label="用户手机" total={ctx.e5Total} page={ctx.e5Page} pageSize={ctx.e5PageSize} sizes={[10,20,50]} loading={ctx.e5Loading} onPage={p=>{ctx.setE5Page(p);query({phonePage:p});}} onPageSize={s=>{ctx.setE5PageSize(s);query({phonePage:1,phonePageSize:s});}}/>}
    </Panel>
    {confirm&&<OperationConfirmModal briefKind="record" statedBrief={{impact:confirm.action==="force"||confirm.action==="unbind"?"仅创建审批提案，批准后执行对应设备处置。":"按确认的手机或整用户范围执行，读回列表核对真实状态。",check:"核对设备、用户、六台名额与处置后果，理由写明依据。"}} action={`${LABELS[confirm.action]} · ${confirm.device.serial}`} title={LABELS[confirm.action]} reasonMin={8} reasonMax={200} confirmLabel={confirm.action==="force"||confirm.action==="unbind"?"确认提交":"确认执行"} confirmTone={confirm.action==="pause"||confirm.action==="unbind"?"danger":"primary"}
      detail={confirm.action==="activate"||confirm.action==="force"?"每人最多 6 台设备，包含手机。激活后占用一个设备名额，强制激活也不能绕过上限。":confirm.action==="deactivate"?"有运行中任务时，本单完成并结算后自动停用，不再接新任务。":confirm.action==="unbind"?"设备将不再属于该用户。不退款，购入时间不变；批准后解绑，不能撤销。":confirm.action==="pause"?"将暂停该用户全部设备（含手机）。停跑期间不计收益、不补发。":"将恢复该用户设备派单；停跑期间收益不补发。"}
      completionCopy={confirm.action==="force"||confirm.action==="unbind"?"由另一位具备批准权和设备处置权限的管理员复核。":"执行后读取手机列表核对真实状态。"}
      facts={<Facts><Fact k="手机">{confirm.device.deviceName}</Fact><Fact k="实例号"><span data-mono>{confirm.device.serial}</span></Fact><Fact k="用户">{`${confirm.device.nickname} · ${confirm.device.userNo}`}</Fact><Fact k="原状态">{confirm.device.pausedReason?"已暂停":STATES[confirm.device.state]}</Fact>{(confirm.action==="activate"||confirm.action==="force")&&<Fact k="已占名额">{<><span>{confirm.device.activeDevicesForUser}/6 台</span><RatioBar label="设备名额" value={confirm.device.activeDevicesForUser} total={6} valueText={`${confirm.device.activeDevicesForUser}/6 台，含手机`} steps compact/></>}</Fact>}</Facts>}
      getPendingReason={()=>m.pendingReason(scope)} onClose={()=>setConfirm(null)} onConfirm={async reason=>{
        let result: { changedCount?: number; pendingDeactivate?: boolean } | undefined;
        const d=confirm.device,action=confirm.action,original=m.pending.find(r=>r.scope===scope);
        if(original)result=await m.send(original,true);
        else if(action==="force"||action==="unbind") {const def=findHighOp(action==="force"?"e5_device_force_activate":"e5_device_unbind")!,params={deviceId:d.deviceId};await m.proposal(scope,"phones",{action:`${LABELS[action]} · ${d.serial}`,obj:d.serial,beforeValue:STATES[d.state],afterValue:action==="force"?"激活":"解绑",type:def.type,amplifies:false,reason,sourceDomain:"E5",command:def.buildCommand(params),target:def.buildTarget(params)});}
        else result=await m.device(scope,`${LABELS[action]} · ${d.serial}`,{before:`${STATES[d.state]}；已占 ${d.activeDevicesForUser}/6 台；暂停原因 ${d.pausedReason||"—"}`,serial:d.serial,deviceId:d.deviceId,userId:Number(d.userId),action,reason});
        await ctx.refreshE5();setConfirm(null);ctx.toast(action==="force"||action==="unbind"?"已提交，等待审批后执行":action==="pause"||action==="resume"?result?.changedCount===undefined?"已取得用户设备操作回执，请核对列表":`${action==="pause"?"暂停":"恢复"}成功 · ${result.changedCount} 台设备`:action==="deactivate"&&result?.pendingDeactivate?"已申请停用，等待当前任务结算后自动停用":"已取得操作回执并读取手机列表，请核对当前状态");
      }}/>}
  </>;
}
