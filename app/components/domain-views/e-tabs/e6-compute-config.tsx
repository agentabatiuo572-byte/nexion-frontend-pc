"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock3, FileClock, Settings2, SlidersHorizontal } from "lucide-react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { e6YieldKey } from "@/lib/admin/e6-client";
import { OperationConfirmModal } from "../design-kit";
import { BlockState, Button, ConfigList, ConfigRow, Fact, Facts, Fold, Notice, PageHeader, PageTabs, Panel, SectionNav, useSectionNav, useTabIds } from "@/app/components/rd";
import { PhoneTasksSection, PhoneTiersSection } from "./phone-tasks-section";
import { E5Ops } from "./e5-ops";
import { PhoneReplacementPolicyPanel } from "./phone-replacement-policy-panel";
import { PhoneCalibrationPanel } from "./phone-calibration-panel";
import { PhoneRiskSection } from "./phone-risk-section";
import { E6MutationProvider, E6PendingNotice, useE6Mutations, type E6Section } from "./e6-mutations";
import type { EViewCtx } from "./types";
const TABS:readonly {value:E6Section;label:string}[]=[{value:"tasks",label:"手机任务"},{value:"tiers",label:"档位与收益"},{value:"phones",label:"用户手机"},{value:"calibration",label:"校准与风控"}];
const SECTIONS=[{id:"rules",label:"档位分界"},{id:"hardware",label:"硬件规则"},{id:"pending",label:"待核验硬件"},{id:"trial",label:"试算与发布"},{id:"risk",label:"机型风控"},{id:"replacement",label:"换机规则"},{id:"estimate",label:"高级参数"},{id:"records",label:"记录与生效"}];
export function E6ComputeConfig({ctx}:{ctx:EViewCtx}) {
  const session=useAdminAuth(s=>s.session),epoch=useAdminAuth(s=>s.authEpoch);
  if(!session)return <BlockState state="denied" title="请重新登录后查看手机算力配置"/>;
  return <E6MutationProvider key={`${session.adminId}:${epoch}`}><E6Content ctx={ctx}/></E6MutationProvider>;
}
function E6Content({ctx}:{ctx:EViewCtx}) {
  const m=useE6Mutations(),ids=useTabIds();
  const visible=TABS.filter(t=>t.value==="tasks"||t.value==="tiers"?ctx.canReadE2:t.value==="phones"?ctx.canReadE5:ctx.canReadE6);
  const [tab,setTab]=useState<E6Section>(visible[0]?.value??"tasks"),[denied,setDenied]=useState(false);
  const [pendingCount,setPendingCount]=useState<number|null>(null);
  const sections=SECTIONS.map(s=>({...s,alert:s.id==="pending"&&!!pendingCount}));
  const [advanced,setAdvanced]=useState(false),[records,setRecords]=useState(false);
  const nav=useSectionNav(sections,{ready:tab==="calibration",onReveal:id=>{if(id==="estimate")setAdvanced(true);if(id==="records")setRecords(true);}});
  useEffect(()=>{
    const apply=()=>{const u=new URL(window.location.href),wanted=u.hash==="#phone-calibration"?"calibration":u.searchParams.get("tab"),known=TABS.some(t=>t.value===wanted),allowed=visible.some(t=>t.value===wanted);setDenied(known&&!allowed);const next=(allowed?wanted:visible[0]?.value) as E6Section;if(next){setTab(next);u.searchParams.set("tab",next);window.history.replaceState(window.history.state,"",`${u.pathname}${u.search}${u.hash}`);}};
    apply();window.addEventListener("popstate",apply);return()=>window.removeEventListener("popstate",apply);
  },[ctx.canReadE2,ctx.canReadE5,ctx.canReadE6]);
  const change=(next:E6Section)=>{setTab(next);setDenied(false);const u=new URL(window.location.href);u.searchParams.set("tab",next);if(u.hash==="#phone-calibration")u.hash="";window.history.replaceState(window.history.state,"",`${u.pathname}${u.search}${u.hash}`);};
  return <div className="e6-page">
    <PageHeader pageId="E6" title="手机算力配置" summary="管理手机任务、收益、设备与校准规则。"/>
    {!visible.length?<BlockState state="denied" title="你无权查看这个页面" detail={<Link href="/">返回首页</Link>}/>:<>
      {visible.length>1&&<PageTabs ids={ids} label="手机算力配置分区" value={tab} items={visible.map(t=>({...t,count:m.pending.filter(r=>r.section===t.value).length||undefined}))} onChange={change}/>}
      {denied&&<Notice tone="warn">你无权查看这个分区，已显示第一个可查看分区。</Notice>}
      {ctx.canReadE2&&<><div {...ids.panel("tasks")} hidden={tab!=="tasks"} className="e6-tab"><PhoneTasksSection ctx={ctx}/></div><div {...ids.panel("tiers")} hidden={tab!=="tiers"} className="e6-tab"><PhoneTiersSection ctx={ctx}/></div></>}
      {ctx.canReadE5&&<div {...ids.panel("phones")} hidden={tab!=="phones"} className="e6-tab"><E5Ops ctx={ctx} phones/></div>}
      {ctx.canReadE6&&<div {...ids.panel("calibration")} hidden={tab!=="calibration"} className="e6-tab">
        {ctx.e6Error&&<BlockState state="error" title="设备配置加载失败" detail={ctx.e6Error} retryLabel="重新加载" onRetry={()=>void ctx.refreshE6()}/>}
        <div className="rd-config-layout"><div className="rd-config-grid"><div className="rd-config-rail"><SectionNav label="校准与风控主题" items={sections} nav={nav}/></div><div className="rd-config-groups e6-config-groups">
          <div id="phone-calibration"><PhoneCalibrationPanel ctx={ctx} onPendingCount={setPendingCount}/></div>
          <div id="section-risk"><PhoneRiskSection canWrite={ctx.canWriteE6} toast={ctx.toast}/></div>
          <div id="section-replacement"><PhoneReplacementPolicyPanel/></div>
          <div id="section-estimate"><Fold title="高级参数" icon={SlidersHorizontal} tone="role-4" alert={!!ctx.e6Error} summary={ctx.e6Config?`${ctx.e6Config.yieldEstimate.length} 项估算参数 · 在线兼容值只读`:ctx.e6Error?"配置读取失败":"配置待读取"} open={advanced} onOpenChange={setAdvanced}><E6Estimates ctx={ctx}/></Fold></div>
          <div id="section-records"><Fold title="记录与生效" icon={FileClock} tone="role-other" summary="按各自发布方式生效，可查原记录" open={records} onOpenChange={setRecords}>
            <Panel plain title="修改记录与回滚" data-proof="e6-version-rollback"><p>每次修改记录改前、改后值和操作人。回滚时核对原值，再按最新版本提案。退役参数只读。</p>{m.canAudit?<Link href="/platform/audit?domain=E&object=E.compute">查看修改记录</Link>:<p>查看修改记录需要操作记录与审批读取权限。</p>}</Panel>
            <Panel plain title="什么时候生效" icon={Clock3} data-proof="e6-effective-boundary"><ConfigList label="生效边界"><ConfigRow name="手机任务" value="批准后对新派任务生效" note="已派任务保留原版本。"/><ConfigRow name="手机校准规则" value="批准后用于后续校准" note="预约还须到所选时间；批准时已过预约时间则批准后生效。"/><ConfigRow name="机型风控" value="保存后立即用于之后校准" note="已激活手机和历史结算不受影响。"/><ConfigRow name="手机换机策略" value="四项批准后同时生效" note="只约束后续换机。"/><ConfigRow name="收益估算参数" value="批准后发布公共配置" note="未证明直接参与现行手机结算。"/></ConfigList></Panel>
          </Fold></div>
        </div></div></div>
      </div>}
    </>}
  </div>;
}
function E6Estimates({ctx}:{ctx:EViewCtx}) {
  const m=useE6Mutations();
  const [edit,setEdit]=useState<{key:string;label:string;unit:string;value:string}|null>(null);
  const scope=edit?`param:${edit.key}`:"";
  const amplifiesWhen=edit?.key===e6YieldKey("topsBaseline")?"decrease":"increase";
  return <>
    {ctx.e6Loading?<BlockState state="loading" title="正在加载设备配置…"/>:ctx.e6Error||!ctx.e6Config?<BlockState state="error" title="设备配置加载失败" detail={ctx.e6Error} retryLabel="重新加载" onRetry={()=>void ctx.refreshE6()}/>:<>
      <Panel plain title="收益估算参数" icon={Settings2} tone="role-4" data-proof="e6-yield-estimate"><div data-proof="e6-yield-estimate-params"><ConfigList label="收益估算参数">{ctx.e6Config.yieldEstimate.map(p=><ConfigRow key={p.key} name={operatorCopyText(p.label)} what="公共收益估算使用的参数" when="批准后发布公共配置" note="未证明参与现行结算；App 具体位置待确认。" effect="不追溯历史已结收益。" value={`${p.value} ${operatorCopyText(p.unit)}`} action={ctx.canWriteE6&&m.canPropose?<Button size="sm" disabledReason={m.locked(`param:${e6YieldKey(p.key)}`)?"这个参数有原提案待确认":undefined} onClick={()=>setEdit({key:e6YieldKey(p.key),label:operatorCopyText(p.label),unit:operatorCopyText(p.unit),value:p.value})}>调整</Button>:undefined}/>)}</ConfigList></div></Panel>
      <Fold title="在线系数与兼容项" summary="历史兼容值 · 只读" inset><ConfigList label="在线历史兼容值">{ctx.e6Config.coefficients.filter(c=>c.key!=="h5BaseFactor").map(c=><ConfigRow key={c.key} name={operatorCopyText(c.label)} value={`${c.value} ${operatorCopyText(c.unit)}`} what="退役的在线历史兼容值" when="只读，不参与任务收益" note={operatorCopyText(c.desc)} action={<span>已退役 · 只读</span>}/>)}</ConfigList><p>连续在线满额时长保留历史兼容值，不可修改，不参与任务收益计算。</p></Fold>
    </>}
    {edit&&<OperationConfirmModal briefKind="config" statedBrief={{impact:"批准后发布公共配置，不承诺参与现行手机结算。",check:"核对参数、原值、单位和理由；批准时执行业务与资金保护。"}} action={`调整${edit.label}`} reasonMin={8} reasonMax={200} detail="批准后发布到公共配置，不改变历史已结收益；本页不承诺实际手机结算采用。" completionCopy="请另一位有批准权和手机配置读权的管理员批准。" edit={{kind:"number",current:edit.value,unit:edit.unit,min:Number.MIN_VALUE,disallowCurrent:true,amplifiesWhen}} facts={<Facts><Fact k="参数">{edit.label}</Fact><Fact k="当前值">{edit.value} {edit.unit}</Fact></Facts>} getPendingReason={()=>m.pendingReason(scope)} onClose={()=>setEdit(null)} onConfirm={async(reason,value)=>{
      const original=m.pending.find(r=>r.scope===scope);if(original)await m.send(original,true);else {if(!value||!Number.isFinite(Number(value))||Number(value)<=0||Number(value)===Number(edit.value))throw new Error("新值须大于 0 且不同于当前值。");const def=findHighOp("e6_compute_config")!,params={paramKey:edit.key,value};await m.proposal(scope,"calibration",{action:`调整${edit.label}`,obj:edit.key,beforeValue:`${edit.value} ${edit.unit}`,afterValue:`${value} ${edit.unit}`,type:def.type,amplifies:amplifiesWhen==="decrease"?Number(value)<Number(edit.value):Number(value)>Number(edit.value),reason,sourceDomain:"E6",command:def.buildCommand(params),target:def.buildTarget(params)});}setEdit(null);ctx.toast("已提交，等待审批后执行");await ctx.refreshE6();
    }}/>}
  </>;
}
