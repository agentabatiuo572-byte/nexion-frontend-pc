"use client";
import { useEffect, useState } from "react";
import { Activity, Clock3, ListTodo, Plus, Smartphone, Coins, Layers3 } from "lucide-react";
import { E6ConfirmModal } from "./e6-confirm-modal";
import { BlockState, Button, Cell, Check, Conclusion, Decision, DiffList, Drawer, Explain, Fact, Facts, Field, Input, MoreMenu, Notice, NumberInput, Pager, Panel, Select, Stat, StatBand, StatusTag, StepBar, Table, TableLoading, TableMessage, TaskClassTag, Td, Th, Tr } from "@/app/components/rd";
import { displayAdminError } from "@/lib/admin/error-messages";
import { fetchTaskPools, type TaskPool } from "@/lib/admin/task-pool-client";
import { TASK_CLASSES, TASK_CLASS_LABELS } from "@/lib/admin/task-classes";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { compareE6Decimal, e6AmountPrecision, formatE6Amount } from "@/lib/admin/e6-decimal";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { OpsTask } from "@/lib/admin/platform-types";
import type { E2PhoneTier } from "@/lib/admin/e2-client";
import type { EViewCtx } from "./types";
import { E6PendingNotice, useE6Mutations } from "./e6-mutations";
import { E6Amount, E6OriginalValues } from "./e6-amount";

type TaskClass = (typeof TASK_CLASSES)[number];
function replaceQuery(values: Record<string, string | number>) {
  const url = new URL(window.location.href);
  for (const [key,value] of Object.entries(values)) url.searchParams.set(key,String(value));
  window.history.replaceState(window.history.state,"",`${url.pathname}${url.search}${url.hash}`);
}
const positiveAmount = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
const initialTask = { n: "", taskClass: "EM", durationMinutes: "10", baseReward: "", asset: "USDT", enabled: true, version: 0 };

export function PhoneTasksSection({ ctx }: { ctx: EViewCtx }) {
  const m = useE6Mutations();
  const [pool, setPool] = useState<TaskPool | null>(null), [poolError, setPoolError] = useState(""), [poolLoading,setPoolLoading] = useState(true);
  const [page,setPage] = useState(1), [size,setSize] = useState(10);
  const [form,setForm] = useState<typeof initialTask | null>(null), [task,setTask] = useState<OpsTask | null>(null), [formError,setFormError] = useState("");
  const [confirm,setConfirm] = useState<{ scope:string; action:string; op:string; params:Record<string,unknown>; before:string; after:string; version:number; diff:{key:string;label:string;before:string;after:string}[]; basis:string; amplifies:boolean; target: {domain:string;type:string;id:string} } | null>(null);
  const [readAt,setReadAt] = useState<string>();
  const ready = !ctx.e2Loading && ctx.e2TaskCatalogReady;
  const canWrite = ctx.canWriteE2 && m.canPropose;
  const rewardPrecision = e6AmountPrecision(ctx.tasks.map(t=>String(t.simulation!.baseReward)));
  const currentPage = Math.min(page,Math.max(1,Math.ceil(ctx.tasks.length / size)));
  useEffect(()=>{if(ready&&page!==currentPage){setPage(currentPage);replaceQuery({taskPage:currentPage});}},[ready,page,currentPage]);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const p = Number(query.get("taskPage")), s = Number(query.get("taskPageSize"));
    setPage(Number.isSafeInteger(p) && p > 0 ? p : 1); setSize([10,20,50].includes(s) ? s : 10);
  },[]);
  useEffect(() => {
    let live = true; setPoolLoading(true); setPool(null); setPoolError("");
    void fetchTaskPools("PHONE").then(rows => { if (live) { const next=rows.find(row=>row.code === "PHONE"); if (!next) throw new Error("手机任务池元数据缺失"); setPool(next); setReadAt(new Date().toLocaleTimeString("zh-CN",{hour12:false})); } }).catch(cause=>{ if(live) setPoolError(displayAdminError(cause)); }).finally(()=>{if(live)setPoolLoading(false);});
    return ()=>{live=false;};
  },[ctx.tasks]);
  useEffect(()=>{ if(!ready) {setForm(null); if(!confirm || !m.locked(confirm.scope))setConfirm(null);} },[ready]);
  useEffect(()=>{if(!m.busy&&m.locked(task?`task:${task.id}`:"task:create"))setForm(null);},[m.pending,m.legacy,m.busy,task]);
  const open = (current: OpsTask | null) => {
    setTask(current); setFormError("");
    setForm(current ? { n:current.n, taskClass:current.taskClass!,durationMinutes:String(current.simulation!.durationMinutes),baseReward:String(current.simulation!.baseReward),asset:current.simulation!.asset,enabled:current.simulation!.enabled,version:current.simulation!.version } : {...initialTask});
  };
  const describe = (f: typeof initialTask) => `${f.n} · ${TASK_CLASS_LABELS[f.taskClass as TaskClass]} · ${f.durationMinutes} 分钟 · ${f.baseReward} ${f.asset}/任务 · ${f.enabled ? "已启用" : "已停用"} · 版本 ${f.version || "待创建"}`;
  const formUnchanged = !!form && !!task && form.n.trim() === task.n && form.taskClass === task.taskClass && Number(form.durationMinutes) === task.simulation!.durationMinutes && form.asset === task.simulation!.asset && positiveAmount.test(form.baseReward.trim()) && compareE6Decimal(form.baseReward.trim(), String(task.simulation!.baseReward)) === 0;
  function submitForm() {
    if(!form || !ready || formUnchanged) return;
    if(!form.n.trim()) return setFormError("请填写任务名称");
    if(!/^[1-9]\d*$/.test(form.durationMinutes) || Number(form.durationMinutes)>1440) return setFormError("固定时长须为 1–1440 的整数分钟");
    if(!positiveAmount.test(form.baseReward.trim())) return setFormError("固定奖励须为非负数，最多 12 位整数、6 位小数");
    const amplifies = task ? compareE6Decimal(form.baseReward,String(task.simulation!.baseReward))>0 || task.simulation!.enabled && Number(form.durationMinutes)<task.simulation!.durationMinutes : form.enabled && compareE6Decimal(form.baseReward,"0")>0;
    const def = findHighOp(task ? "e2_task_update" : "e2_task_create")!;
    const params = {taskId:task?.id ?? "",name:form.n.trim(),taskClass:form.taskClass,simulation:{durationMinutes:Number(form.durationMinutes),baseReward:form.baseReward.trim(),asset:form.asset,enabled:task ? task.simulation!.enabled : form.enabled,expectedVersion:form.version}};
    const precision = e6AmountPrecision([form.baseReward, ...(task ? [String(task.simulation!.baseReward)] : [])]);
    const rows = [
      {key:"name",label:"任务名称",before:task?.n??"未创建",after:form.n.trim()},
      {key:"class",label:"任务类型",before:task?TASK_CLASS_LABELS[task.taskClass as TaskClass]:"未创建",after:TASK_CLASS_LABELS[form.taskClass as TaskClass]},
      {key:"duration",label:"固定时长",before:task?`${task.simulation!.durationMinutes} 分钟`:"未创建",after:`${Number(form.durationMinutes)} 分钟`},
      {key:"reward",label:"每任务奖励",before:task?`${formatE6Amount(String(task.simulation!.baseReward),precision)} ${task.simulation!.asset}/任务`:"未创建",after:`${formatE6Amount(form.baseReward,precision)} ${form.asset}/任务`},
      ...(!task?[{key:"state",label:"状态",before:"未创建",after:form.enabled?"已启用":"已停用"}]:[]),
    ].filter(row=>row.before!==row.after);
    const basis = task ? [compareE6Decimal(form.baseReward,String(task.simulation!.baseReward))>0?`每任务奖励由 ${formatE6Amount(String(task.simulation!.baseReward),precision)} ${task.simulation!.asset} 增加至 ${formatE6Amount(form.baseReward,precision)} ${form.asset}。`:"",task.simulation!.enabled&&Number(form.durationMinutes)<task.simulation!.durationMinutes?`已启用任务的时长由 ${task.simulation!.durationMinutes} 分钟缩短至 ${Number(form.durationMinutes)} 分钟，可派任务数增加。`:""].filter(Boolean).join(" ") : `新建任务已启用，每任务奖励为 ${formatE6Amount(form.baseReward,precision)} ${form.asset}，大于 0。`;
    setConfirm({scope:task ? `task:${task.id}` : "task:create",action:`${task?"编辑":"新增"}手机任务 · ${form.n.trim()}`,op:def.op,params,before:task?describe({n:task.n,taskClass:task.taskClass!,durationMinutes:String(task.simulation!.durationMinutes),baseReward:String(task.simulation!.baseReward),asset:task.simulation!.asset,enabled:task.simulation!.enabled,version:task.simulation!.version}):"未创建",after:describe(form),version:form.version,diff:rows,basis,amplifies,target:def.buildTarget(params)});
  }
  return <>
    <E6PendingNotice section="tasks" onRead={()=>void ctx.refreshE2()} />
    <Conclusion state={ctx.e2Loading || poolLoading ? "neutral" : !ready || poolError ? "neutral" : pool?.enabledCount === 0 ? "warn" : "ok"} icon={Smartphone}>{ctx.e2Loading || poolLoading ? "正在读取手机任务" : !ready || poolError ? "等手机任务读取成功后可用" : pool?.enabledCount === 0 ? "还没有启用的手机任务" : canWrite ? "手机任务已启用，可编辑或新增" : "手机任务已启用，当前可查看配置"}</Conclusion>
    <Panel title="任务节奏" icon={Activity} tone="role-2" sub={readAt ? `读取于 ${readAt}` : undefined}>
      {poolError ? <BlockState state="error" title="任务节奏暂不可读" detail={poolError} onRetry={()=>void ctx.refreshE2()} /> : <StatBand fit>
        <Stat label="启用任务" icon={ListTodo} tone="role-2" lead value={poolLoading ? "—" : pool?.enabledCount ?? "—"} unit="个" sub={pool ? `共 ${pool.taskCount} 个` : undefined} />
        <Stat label="平均时长" icon={Clock3} tone="role-3" value={poolLoading || !pool?.enabledCount ? "—" : pool.avgDurationMinutes ?? "—"} unit="分钟" explain={!pool?.enabledCount?"没有启用任务，无法估算。":"服务端启用任务的平均时长，原样显示。"}/>
        <Stat label="约每天单数" icon={Activity} tone="role-2" value={poolLoading || !pool?.enabledCount ? "—" : pool.estTasksPerDevicePerDay ?? "—"} unit="单/台/天" explain={!pool?.enabledCount?"没有启用任务，无法估算。":"1440 分钟除以启用任务的平均时长，不保证实际完成量。"}/>
      </StatBand>}
    </Panel>
    <Panel title="手机任务池" icon={ListTodo} tone="role-2" sub={pool?.name!=="手机任务池"?pool?.name:undefined} flush explain="仅手机可接，按每任务奖励结算。在线有效期为 1 小时。新增、编辑和启停须双人审批；已派出的任务按原版本完成。" actions={<><Button size="sm" disabled={ctx.e2Loading} onClick={()=>void ctx.refreshE2()}>刷新</Button>{canWrite && <Button size="sm" variant="primary" disabledReason={!ready ? "任务目录未就绪，请刷新" : m.locked("task:create") ? "有新增任务待确认，请先核对原操作" : undefined} onClick={()=>open(null)}>+ 新增手机任务</Button>}</>}>
      <Table label="手机任务" className="e6-tasks-table" data-tight><thead><tr><Th>任务名称</Th><Th>类型</Th><Th align="right">时长</Th><Th align="right">每任务奖励</Th><Th>状态</Th>{canWrite&&<Th sticky="end">操作</Th>}</tr></thead><tbody>
        {ctx.e2Loading ? <TableLoading columns={canWrite?6:5}/> : !ready ? <TableMessage columns={canWrite?6:5} role="alert">手机任务加载失败 <Button size="sm" onClick={()=>void ctx.refreshE2()}>重试</Button></TableMessage> : !ctx.tasks.length ? <TableMessage columns={canWrite?6:5}>暂无手机任务</TableMessage> : ctx.tasks.slice((currentPage-1)*size,currentPage*size).map(t=><Tr key={t.id}>
          <Td grow><Cell main={<E6OriginalValues original={t.n}><span className="e6-middle-text"><span>{t.n.slice(0,-8)}</span><span>{t.n.slice(-8)}</span></span></E6OriginalValues>} sub={`版本 ${t.simulation!.version}`}/></Td><Td><TaskClassTag taskClass={t.taskClass as TaskClass}/></Td><Td align="right" data-num="">{t.simulation!.durationMinutes} 分钟</Td><Td align="right" data-num=""><strong><E6Amount raw={String(t.simulation!.baseReward)} precision={rewardPrecision} currency={t.simulation!.asset}/></strong> {t.simulation!.asset}</Td><Td><StatusTag tone={t.simulation!.enabled?"ok":"done"}>{t.simulation!.enabled?"已启用":"已停用"}</StatusTag></Td>
          {canWrite&&<Td sticky="end"><MoreMenu label={`操作 ${t.n}`} items={[{key:"edit",label:"编辑",disabledReason:m.locked(`task:${t.id}`)?"这个任务有原提案待确认":undefined,onSelect:()=>open(t)},{key:"status",label:t.simulation!.enabled?"停用":"启用",danger:t.simulation!.enabled,disabledReason:m.locked(`task:${t.id}`)?"这个任务有原提案待确认":undefined,onSelect:()=>{const def=findHighOp("e2_task_status")!,params={taskId:t.id,status:t.simulation!.enabled?"inactive":"active"};setConfirm({scope:`task:${t.id}`,action:`${t.simulation!.enabled?"停用":"启用"}手机任务 · ${t.n}`,op:def.op,params,before:`${t.simulation!.enabled?"已启用":"已停用"} · ${t.simulation!.durationMinutes} 分钟 · ${t.simulation!.baseReward} ${t.simulation!.asset}/任务`,after:!t.simulation!.enabled?"已启用":"已停用",version:t.simulation!.version,diff:[{key:"state",label:"状态",before:t.simulation!.enabled?"已启用":"已停用",after:t.simulation!.enabled?"已停用":"已启用"}],basis:`任务由已停用改为已启用；每任务奖励 ${t.simulation!.baseReward} ${t.simulation!.asset}，固定时长 ${t.simulation!.durationMinutes} 分钟。`,amplifies:!t.simulation!.enabled,target:def.buildTarget(params)});}}]}/></Td>}
        </Tr>)}
      </tbody></Table>
      {!!ctx.tasks.length && ready && <Pager label="手机任务" page={currentPage} pageSize={size} total={ctx.tasks.length} sizes={[10,20,50]} onPage={p=>{setPage(p);replaceQuery({taskPage:p});}} onPageSize={s=>{setSize(s);setPage(1);replaceQuery({taskPage:1,taskPageSize:s});}}/>}
    </Panel>
    {form && <Drawer open title={task?"编辑手机任务":"新增手机任务"} icon={Smartphone} tone="role-2" onClose={()=>setForm(null)} footer={<Decision primary={<Button variant="primary" disabledReason={!ready?"任务目录未就绪":formUnchanged?"没有修改":undefined} onClick={submitForm}>提交审批</Button>} others={<Button onClick={()=>setForm(null)}>取消</Button>}/>}>
      <Facts><Fact k="当前版本">{task?String(form.version):"待创建"}</Fact><Fact k="生效方式">另一位管理员批准后，对新派任务生效</Fact></Facts>
      <div className="e6-form-grid"><Field label="任务名称" required error={formError&&!form.n.trim()?formError:undefined}><Input value={form.n} onChange={e=>{setFormError("");setForm({...form,n:e.target.value});}}/></Field>
        <Field label="任务类型" explain="六类业务任务，批准后用于新派任务。"><Select aria-label="任务类型" value={form.taskClass} onChange={taskClass=>setForm({...form,taskClass})} options={TASK_CLASSES.map(value=>({value,label:TASK_CLASS_LABELS[value]}))}/></Field>
        <Field label="固定时长" error={formError.startsWith("固定时长")?formError:undefined} help="1–1440 整数分钟。" explain="缩短启用任务时长须检查兑付覆盖率。"><NumberInput value={form.durationMinutes} min={1} max={1440} step={1} unit="分钟" onChange={e=>{setFormError("");setForm({...form,durationMinutes:e.target.value});}}/></Field>
        <Field label="每任务奖励" error={formError.startsWith("固定奖励")?formError:undefined} help={<><span className="rd-keep">非负，整数最多 12 位。</span>{" "}<span className="rd-keep">小数最多 6 位。</span></>} explain="一次任务完成的固定奖励；增加奖励或启用正奖励任务会增加支出。"><NumberInput value={form.baseReward} min={0} step={0.000001} unit={form.asset} onChange={e=>{setFormError("");setForm({...form,baseReward:e.target.value});}}/></Field>
        <Field label="奖励资产" help="币种切换不自动换汇。"><Select aria-label="奖励资产" value={form.asset} onChange={asset=>setForm({...form,asset})} options={[{value:"USDT",label:"USDT"},{value:"UVT",label:"UVT"}]}/></Field>
      </div>
      {task ? <Notice tone="neutral" title={`当前${form.enabled?"已启用":"已停用"} · 只读`}>启停请用任务行的「启用 / 停用」操作。</Notice> : <Check label="启用任务" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})} explain="新建默认启用，批准后生效。已有任务通过行上动作启停。"/>}
    </Drawer>}
    {confirm && <E6ConfirmModal scope={confirm.scope} amplificationBasis={confirm.basis} briefKind="config" statedBrief={{impact:"只创建审批提案，批准后对新派任务生效；已派任务按原版本完成。",check:"核对原任务、固定时长、每任务奖励与理由；批准时检查兑付覆盖率。"}} action={confirm.action} amplifies={confirm.amplifies} coverageCheck="批准时检查兑付覆盖率，未达标不会执行。" reasonMin={8} reasonMax={200}
      detail="批准后对新任务生效；已派出的任务按原版本完成。" completionCopy="提交后请另一位有批准权限和任务池修改权限的管理员在「操作记录与审批」中批准。"
      facts={<Facts><Fact k="原版本">{confirm.version||"待创建"}</Fact>{confirm.diff.map(row=><Fact key={row.key} k={row.label}><DiffList rows={[row]}/></Fact>)}</Facts>}
      getPendingReason={()=>m.pendingReason(confirm.scope)} blockedReason={m.pending.find(r=>r.scope===confirm.scope)?.ticketId?"已提交，请查询原审批单":undefined}
      onClose={()=>setConfirm(null)} onConfirm={async reason=>{
        const original=m.pending.find(r=>r.scope===confirm.scope);
        if(original) await m.send(original,true);
        else {const def=findHighOp(confirm.op)!;await m.proposal(confirm.scope,"tasks",{action:confirm.action,obj:confirm.params.taskId?String(confirm.params.taskId):String(confirm.params.name),beforeValue:confirm.before,afterValue:confirm.after,type:def.type,amplifies:confirm.amplifies,reason,sourceDomain:"E6",command:def.buildCommand(confirm.params),target:confirm.target});}
        setConfirm(null);setForm(null);ctx.toast("已提交，等待审批后执行");await ctx.refreshE2();
      }}/>}
  </>;
}

export function PhoneTiersSection({ctx}:{ctx:EViewCtx}) {
  const m=useE6Mutations(), rights=useAdminAuth(s=>s.session!.authorities);
  const [edit,setEdit]=useState<{tier:E2PhoneTier;field:"dailyUsdt"|"dailyNex"}|null>(null);
  const ready=!ctx.e2Loading && ctx.phoneTiers.length===5;
  const text=(tier:E2PhoneTier,field:"dailyUsdt"|"dailyNex")=>tier[field==="dailyUsdt"?"dailyUsdtText":"dailyNexText"];
  const tierUsdtPrecision=e6AmountPrecision(ctx.phoneTiers.map(t=>text(t,"dailyUsdt"))), tierUvtPrecision=e6AmountPrecision(ctx.phoneTiers.map(t=>text(t,"dailyNex")));
  const comparisonUsdtPrecision=e6AmountPrecision(ctx.yieldComparisons.map(r=>r.dailyUsdtText)), comparisonUvtPrecision=e6AmountPrecision(ctx.yieldComparisons.map(r=>r.dailyNexText));
  const canEdit=(field:"dailyUsdt"|"dailyNex")=>ctx.canWriteE2&&m.canPropose&&rights.includes(field==="dailyUsdt"?"device_e2_phone_tier_usdt":"device_e2_phone_tier_nex");
  const currency=edit?.field==="dailyUsdt"?"USDT":"UVT", scope=edit?`tier:${edit.tier.tier}`:"";
  const index=edit?ctx.phoneTiers.findIndex(t=>t.tier===edit.tier.tier):-1;
  const lower=index>0?ctx.phoneTiers[index-1]:undefined, upper=index>=0?ctx.phoneTiers[index+1]:undefined;
  const range=edit?`${lower?`不低于 T${lower.tier} 的 ${text(lower,edit.field)}`:"大于 0"}${upper?`，不高于 T${upper.tier} 的 ${text(upper,edit.field)}`:""} ${currency}/天。`:"";
  return <><E6PendingNotice section="tiers" onRead={()=>void ctx.refreshE2()}/>
    <Conclusion state={ready?"ok":"neutral"} icon={Layers3}>{ctx.e2Loading?"正在读取档位收益":ready?"五档收益已配置，引导使用 T3 档":"等档位收益读取成功后可用"}</Conclusion>
    <Panel className={ctx.phoneTiers.some(t=>formatE6Amount(text(t,"dailyUsdt"),tierUsdtPrecision).length>12||formatE6Amount(text(t,"dailyNex"),tierUvtPrecision).length>12)?"e6-tier-long":undefined} title="手机 5 档收益" icon={Coins} tone="role-4" explain="柱高只比较 USDT 日收益；UVT 独立显示。批准后更新档位配置，供后续校准与引导展示使用；不改变已派任务的奖励快照。" actions={<Button size="sm" disabled={ctx.e2Loading} onClick={()=>void ctx.refreshE2()}>刷新</Button>}>
      {ctx.e2Loading?<StepBar label="手机五档收益" items={[]} unit="USDT/天" max={1} state="loading"/>:!ready?<BlockState state="error" title={ctx.e2Error?"档位收益读取失败":"档位收益数据不完整，暂不能调整"} detail={ctx.e2Error} onRetry={()=>void ctx.refreshE2()}/>:<E6OriginalValues group original={<table className="e6-original-tiers"><thead><tr><th>档位</th><th>USDT/天</th><th>UVT/天</th></tr></thead><tbody>{ctx.phoneTiers.map(t=><tr key={t.tier}><td>T{t.tier}</td><td>{text(t,"dailyUsdt")}</td><td>{text(t,"dailyNex")}</td></tr>)}</tbody></table>}><StepBar label="手机五档 USDT 日收益" unit="USDT/天" max={Math.max(...ctx.phoneTiers.map(t=>t.dailyUsdt))} items={ctx.phoneTiers.map(t=>({key:String(t.tier),label:`T${t.tier}`,name:operatorCopyText(t.name).replace(/\s/g,"")===`第${t.tier}档`?undefined:operatorCopyText(t.name),value:t.dailyUsdt,valueText:formatE6Amount(text(t,"dailyUsdt"),tierUsdtPrecision),secondary:<>{formatE6Amount(text(t,"dailyNex"),tierUvtPrecision)} UVT/天 {t.note&&<Explain label={`T${t.tier}的说明`} content={operatorCopyText(t.note)}/>}</>,mark:t.tier===3?"当前引导档":undefined,actions:<>{(["dailyUsdt","dailyNex"] as const).filter(canEdit).map(field=><Button key={field} size="sm" disabledReason={m.locked(`tier:${t.tier}`)?"这个档位有原提案待确认":undefined} onClick={()=>setEdit({tier:t,field})}>调 {field==="dailyUsdt"?"USDT":"UVT"}</Button>)}</>}))}/></E6OriginalValues>}
    </Panel>
    <Panel title="新用户引导收益对比" icon={Smartphone} tone="role-2" flush explain="手机行来自 T3；其他来自在售商品。实际校准结果优先使用用户当前档位，不代表所有用户都领取 T3 收益。">
      {ready&&ctx.yieldComparisons.length!==4&&<Notice tone="warn">数据不全，请核对在售商品与手机 T3 档位。</Notice>}
      <Table label="新用户引导收益对比"><thead><tr><Th>名称</Th><Th align="right">USDT/天</Th><Th align="right">UVT/天</Th><Th>来源</Th></tr></thead><tbody>{ctx.e2Loading?<TableLoading columns={4}/>:!ready?<TableMessage columns={4}>等档位收益读取成功后可用</TableMessage>:[...ctx.yieldComparisons].sort((a,b)=>Number(b.configKey==="phone")-Number(a.configKey==="phone")||a.sortOrder-b.sortOrder).map(r=><Tr key={r.configKey}><Td><Cell full main={nexGridBrandText(r.label)} sub={r.configKey==="phone"?"当前引导档":undefined}/></Td><Td align="right" data-num=""><E6Amount raw={r.dailyUsdtText} precision={comparisonUsdtPrecision} currency="USDT"/></Td><Td align="right" data-num=""><E6Amount raw={r.dailyNexText} precision={comparisonUvtPrecision} currency="UVT"/></Td><Td>{r.configKey==="phone"?"手机 T3 档位":"商品管理"}</Td></Tr>)}</tbody></Table>
    </Panel>
    {edit&&<E6ConfirmModal scope={scope} amplificationBasis={value=>`T${edit.tier.tier} ${currency} 日收益由 ${text(edit.tier,edit.field)} 增加至 ${value} ${currency}/天。`} briefKind="config" statedBrief={{impact:"只调整当前档位的一个币种，批准后更新配置；已发收益不变。",check:"核对原修订号、单币金额与相邻档位，批准时检查兑付覆盖率。"}} action={`调整手机 T${edit.tier.tier} 每日收益（${currency}）`} reasonMin={8} reasonMax={200} detail="只调整这个币种；五档同币种收益须非递减。批准后更新档位配置，供后续校准与引导展示使用；不改变已派任务的奖励快照。" completionCopy="由另一位具备批准权和对应业务权限的管理员复核。" coverageCheck="批准时检查兑付覆盖率。" edit={{kind:"number",current:text(edit.tier,edit.field),unit:`${currency}/天`,min:0.00001,step:0.00001,maxDecimals:6,disallowCurrent:true,amplifiesWhen:"increase",hint:range,validate:value=>!positiveAmount.test(value)?"收益最多 12 位整数、6 位小数。":lower&&compareE6Decimal(value,text(lower,edit.field))<0||upper&&compareE6Decimal(value,text(upper,edit.field))>0?`五档同币种收益须非递减：${range}`:undefined}}
      facts={<Facts><Fact k="档位">{`T${edit.tier.tier} · ${operatorCopyText(edit.tier.name)}`}</Fact><Fact k="原修订号">{String(edit.tier.revision)}</Fact></Facts>} getPendingReason={()=>m.pendingReason(scope)} onClose={()=>setEdit(null)} onConfirm={async(reason,value)=>{
        const original=m.pending.find(r=>r.scope===scope);if(original) await m.send(original,true);else {
          if(!value||!positiveAmount.test(value)||compareE6Decimal(value,"0")<=0)throw new Error("收益须为正数，最多 12 位整数、6 位小数。");
          const index=ctx.phoneTiers.findIndex(t=>t.tier===edit.tier.tier),before=ctx.phoneTiers[index-1],after=ctx.phoneTiers[index+1];
          if(before&&compareE6Decimal(value,text(before,edit.field))<0||after&&compareE6Decimal(value,text(after,edit.field))>0)throw new Error("五档同币种收益须非递减，请核对相邻档位。");
          const def=findHighOp("e2_phone_tier")!,params={tier:edit.tier.tier,expectedRevision:edit.tier.revision,[edit.field]:value};
          await m.proposal(scope,"tiers",{action:`调整手机 T${edit.tier.tier} 每日收益（${currency}）`,obj:String(edit.tier.tier),beforeValue:`${text(edit.tier,edit.field)} ${currency}/天`,afterValue:`${value} ${currency}/天`,type:def.type,amplifies:compareE6Decimal(value,text(edit.tier,edit.field))>0,reason,sourceDomain:"E2",command:def.buildCommand(params),target:def.buildTarget(params)});
        }setEdit(null);ctx.toast("已提交，等待审批后执行");await ctx.refreshE2();
      }}/>}
  </>;
}
