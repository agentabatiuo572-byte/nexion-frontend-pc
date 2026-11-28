"use client";
import { useEffect, useState } from "react";
import { Activity, Clock3, ListTodo, Plus, Smartphone, Coins, Layers3 } from "lucide-react";
import { E6ConfirmModal } from "./e6-confirm-modal";
import { BlockState, Button, Cell, Change, Check, Conclusion, Decision, DiffList, Drawer, Explain, Fact, Facts, Field, Fold, Input, Notice, NumberInput, Pager, Panel, Select, Stat, StatBand, StatusTag, StepBar, Table, TableLoading, TableMessage, TaskClassTag, Td, Th, Tr } from "@/app/components/rd";
import { displayAdminReadError } from "@/lib/admin/error-messages";
import { explicitRejectionCode } from "@/lib/admin/explicit-rejection";
import { APP_VISIBLE_TEXT_HINT, appVisibleTextError } from "@/lib/admin/content-language-rules";
import { businessClock, businessZone } from "@/lib/admin/business-time";
import { fetchTaskPools, type TaskPool } from "@/lib/admin/task-pool-client";
import { TASK_CLASSES, TASK_CLASS_LABELS } from "@/lib/admin/task-classes";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { compareE6Decimal, e6AmountPrecision, formatE6Amount, prorateE6DailyReward } from "@/lib/admin/e6-decimal";
import { formatPhoneTaskDuration, validPhoneTaskDuration } from "@/lib/admin/phone-task-duration";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { OpsTask } from "@/lib/admin/platform-types";
import type { E2PhoneTier } from "@/lib/admin/e2-client";
import type { EViewCtx } from "./types";
import { E6PendingNotice, useE6DraftEditor, useE6Mutations } from "./e6-mutations";
import { E6OriginalValues } from "./e6-amount";
import { E6YieldComparisonPanel } from "./e6-yield-comparison";

type TaskClass = (typeof TASK_CLASSES)[number];
function replaceQuery(values: Record<string, string | number>) {
  const url = new URL(window.location.href);
  for (const [key,value] of Object.entries(values)) url.searchParams.set(key,String(value));
  window.history.replaceState(window.history.state,"",`${url.pathname}${url.search}${url.hash}`);
}
const positiveAmount = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
const initialTask = { n: "", taskClass: "EM", durationSeconds: "600", enabled: true, version: 0 };
const rewardExplanation = "按当前 T1 至 T5 档位估算。每种币各用该档日收益乘以任务秒数，再除以 86400，四舍五入到六位小数。实际金额在派单时锁定。";
const taskEffect = "批准后对新派任务生效。已派任务按派单时的金额完成。";
const emptyPoolBasis = "启用任务从 0 个变为 1 个，手机将恢复接单。";
const taskStatus = (enabled: boolean) => enabled ? "已启用" : "已停用";

function taskFormValues(task: OpsTask): typeof initialTask {
  const simulation = task.simulation!;
  return { n: task.n, taskClass: task.taskClass!, durationSeconds: String(simulation.durationSeconds),
    enabled: simulation.enabled, version: simulation.version };
}

function describeTask(form: typeof initialTask) {
  return [form.n.trim(), TASK_CLASS_LABELS[form.taskClass as TaskClass], formatPhoneTaskDuration(Number(form.durationSeconds)),
    taskStatus(form.enabled), "版本 " + (form.version || "待创建")].join(" · ");
}

function RewardRanges({ seconds, tiers }: { seconds: number; tiers: E2PhoneTier[] }) {
  if (!validPhoneTaskDuration(seconds) || tiers.length !== 5) return <>—</>;
  const first = tiers[0], last = tiers[4];
  const range = (low: string, high: string) =>
    [low, high].map(daily => formatE6Amount(prorateE6DailyReward(daily, seconds))).join("–");
  return <span className="e6-task-reward">
    <span>{range(first.dailyUsdtText, last.dailyUsdtText)} USDT</span>
    <span>{range(first.dailyNexText, last.dailyNexText)} UVT</span>
  </span>;
}

export function PhoneTasksSection({ ctx }: { ctx: EViewCtx }) {
  const m = useE6Mutations();
  const canSubmitApproval = useAdminAuth(s => s.session!.authorities.includes("platform_a2_write"));
  const [pool, setPool] = useState<TaskPool | null>(null), [poolError, setPoolError] = useState(""), [poolLoading,setPoolLoading] = useState(true);
  const [page,setPage] = useState(1), [size,setSize] = useState(10);
  const [form,setForm] = useState<typeof initialTask | null>(null), [task,setTask] = useState<OpsTask | null>(null), [formError,setFormError] = useState("");
  const [confirm,setConfirm] = useState<{ scope:string; action:string; op:string; params:Record<string,unknown>; before:string; after:string; name:string; version:number; beforeSeconds?:number; afterSeconds:number; diff:{key:string;label:string;before:string;after:string}[]; amplifies:boolean; target: {domain:string;type:string;id:string} } | null>(null);
  const [readAt,setReadAt] = useState<string>();
  const ready = !ctx.e2Loading && ctx.e2TaskCatalogReady;
  const canWrite = ctx.canWriteE2 && canSubmitApproval;
  const enabledCount = ctx.tasks.filter(item => item.simulation!.enabled).length;
  const rewardHint = ctx.phoneTiers.length === 5 ? rewardExplanation : "五档收益暂未读全，请刷新后查看奖励区间。";
  const currentPage = Math.min(page,Math.max(1,Math.ceil(ctx.tasks.length / size)));
  useEffect(()=>{if(ready&&page!==currentPage){setPage(currentPage);replaceQuery({taskPage:currentPage});}},[ready,page,currentPage]);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const p = Number(query.get("taskPage")), s = Number(query.get("taskPageSize"));
    setPage(Number.isSafeInteger(p) && p > 0 ? p : 1); setSize([10,20,50].includes(s) ? s : 10);
  },[]);
  useEffect(() => {
    let live = true; setPoolLoading(true); setPool(null); setPoolError("");
    void fetchTaskPools("PHONE").then(rows => { if (live) { const next=rows.find(row=>row.code === "PHONE"); if (!next) throw new Error("手机任务池元数据缺失"); setPool(next); setReadAt(businessClock(Date.now()) + "（" + businessZone().label + "）"); } }).catch(cause=>{ if(live) setPoolError(displayAdminReadError(cause)); }).finally(()=>{if(live)setPoolLoading(false);});
    return ()=>{live=false;};
  },[ctx.tasks]);
  useEffect(()=>{ if(!ready) {setForm(null); if(!confirm || !m.locked(confirm.scope))setConfirm(null);} },[ready]);
  useEffect(()=>{if(!m.busy&&m.locked(task ? "task:" + task.id : "task:create"))setForm(null);},[m.pending,m.legacy,m.busy,task]);
  const open = (current: OpsTask | null, saved?: Partial<typeof initialTask>) => {
    setTask(current); setFormError("");
    setForm({ ...(current ? taskFormValues(current) : initialTask), ...saved });
  };
  const openStatus = (t: OpsTask) => {
    const def = findHighOp("e2_task_status")!;
    const current = taskFormValues(t), enabled = !current.enabled;
    const params = { taskId: t.id, status: enabled ? "active" : "inactive" };
    setConfirm({ scope: "task:" + t.id, action: (enabled ? "启用" : "停用") + "手机任务 · " + t.n, op: def.op, params,
      name: t.n, before: describeTask(current), after: describeTask({ ...current, enabled }), version: current.version,
      afterSeconds: Number(current.durationSeconds),
      diff: [{ key: "state", label: "状态", before: taskStatus(current.enabled), after: taskStatus(enabled) }],
      amplifies: enabled && enabledCount === 0, target: def.buildTarget(params) });
  };
  useE6DraftEditor(["e2_task_create", "e2_task_update", "e2_task_status"], !!form || !!confirm, record => {
    if (!ready || !canWrite || record.payload.kind !== "proposal") return false;
    const { op, params } = record.payload.input.command;
    const current = op === "e2_task_create" ? null : ctx.tasks.find(item => item.id === params.taskId);
    if (current === undefined || record.scope !== (current ? "task:" + current.id : "task:create")) return false;
    if (op === "e2_task_status") {
      if (!current || params.status !== (current.simulation!.enabled ? "inactive" : "active")) return false;
      openStatus(current);
      return true;
    }
    const simulation = params.simulation as { durationSeconds?: number; durationMinutes?: number; enabled?: boolean } | undefined;
    const seconds = simulation?.durationSeconds ?? Number(simulation?.durationMinutes) * 60;
    if (typeof params.name !== "string" || typeof params.taskClass !== "string"
      || !validPhoneTaskDuration(seconds) || typeof simulation?.enabled !== "boolean") return false;
    open(current, { n: params.name, taskClass: params.taskClass, durationSeconds: String(seconds),
      enabled: current?.simulation?.enabled ?? simulation.enabled });
    return true;
  });
  const durationSeconds = form && /^[0-9]+$/.test(form.durationSeconds) ? Number(form.durationSeconds) : Number.NaN;
  const formUnchanged = !!form && !!task && form.n.trim() === task.n && form.taskClass === task.taskClass
    && durationSeconds === task.simulation!.durationSeconds;
  function submitForm() {
    if (!form || !ready || formUnchanged) return;
    if (!form.n.trim()) return setFormError("请填写任务名称");
    const nameError = appVisibleTextError(form.n, "任务名称");
    if (nameError) return setFormError(nameError);
    if (!validPhoneTaskDuration(durationSeconds)) {
      return setFormError("固定时长须为 60–86400 的整数秒");
    }
    const previous = task ? taskFormValues(task) : null;
    const def = findHighOp(task ? "e2_task_update" : "e2_task_create")!;
    const params = { taskId: task?.id ?? "", name: form.n.trim(), taskClass: form.taskClass,
      simulation: { durationSeconds, enabled: previous?.enabled ?? form.enabled, expectedVersion: form.version } };
    const rows = [
      { key: "name", label: "任务名称", before: task?.n ?? "未创建", after: params.name },
      { key: "class", label: "任务类型", before: task ? TASK_CLASS_LABELS[task.taskClass as TaskClass] : "未创建", after: TASK_CLASS_LABELS[form.taskClass as TaskClass] },
      { key: "duration", label: "固定时长", before: previous ? formatPhoneTaskDuration(Number(previous.durationSeconds)) : "未创建", after: formatPhoneTaskDuration(durationSeconds) },
      { key: "state", label: "状态", before: previous ? taskStatus(previous.enabled) : "未创建", after: taskStatus(params.simulation.enabled) },
    ];
    setConfirm({ scope: task ? "task:" + task.id : "task:create", action: (task ? "编辑" : "新增") + "手机任务 · " + params.name,
      op: def.op, params, name: params.name, before: previous ? describeTask(previous) : "未创建", after: describeTask(form),
      version: form.version, beforeSeconds: previous ? Number(previous.durationSeconds) : undefined,
      afterSeconds: durationSeconds, diff: rows, amplifies: !task && form.enabled && enabledCount === 0, target: def.buildTarget(params) });
  }
  return <>
    <E6PendingNotice section="tasks" toast={ctx.toast} onRead={()=>void ctx.refreshE2()} />
    <Conclusion state={ctx.e2Loading || poolLoading || !ready || poolError ? "neutral" : enabledCount === 0 ? "warn" : "ok"} icon={Smartphone}>{ctx.e2Loading || poolLoading ? "正在加载手机任务" : !ready ? "手机任务读取失败，暂不能修改" : poolError ? "任务节奏暂不可读" : enabledCount === 0 ? "还没有启用的手机任务" : enabledCount + " 个手机任务启用中"}</Conclusion>
    <Panel className="e6-rhythm" title="任务节奏" icon={Activity} tone="role-2" sub={readAt ? "读取于 " + readAt : undefined}>
      {poolError ? <BlockState state="error" title="任务节奏暂不可读" detail={poolError} onRetry={()=>void ctx.refreshE2()} /> : <StatBand fit>
        <Stat label="启用任务" icon={ListTodo} tone="role-2" lead value={poolLoading ? "—" : pool?.enabledCount ?? "—"} unit="个" sub={pool ? "共 " + pool.taskCount + " 个" : undefined} />
        <Stat label="平均时长" icon={Clock3} tone="role-3" value={poolLoading || !pool?.enabledCount ? "—" : pool.avgDurationMinutes ?? "—"} unit="分钟" explain={!pool?.enabledCount?"没有启用任务，无法估算。":"已启用任务的平均时长，原样显示。"}/>
        <Stat label="约每天单数" icon={Activity} tone="role-2" value={poolLoading || !pool?.enabledCount ? "—" : pool.estTasksPerDevicePerDay ?? "—"} unit="单/台/天" explain={!pool?.enabledCount?"没有启用任务，无法估算。":"1440 分钟除以启用任务的平均时长，不保证实际完成量。"}/>
      </StatBand>}
    </Panel>
    <Panel title="手机任务池" icon={ListTodo} tone="role-2" sub={pool?.name!=="手机任务池"?pool?.name:undefined} flush explain="仅手机可接。每单按档位和任务时长分别结算 USDT 与 UVT，在线有效期为 1 小时。新增、编辑和启停提交审批，批准后对新派任务生效。"
      actions={<><Button size="sm" disabled={ctx.e2Loading} onClick={()=>void ctx.refreshE2()}>刷新</Button>{canWrite && <Button size="sm" variant="primary" disabledReason={!ready ? "任务目录未就绪，请刷新" : m.locked("task:create") ? "有新增任务结果未知，请先核对原操作" : undefined} onClick={()=>open(null)}>+ 新增手机任务</Button>}</>}>
      <Table label="手机任务" className="e6-tasks-table" data-tight><thead><tr><Th>任务名称</Th><Th>类型</Th><Th align="right">时长</Th>
        <Th align="right">每任务奖励 <Explain label="每任务奖励的说明" content={rewardHint}/></Th><Th>状态</Th>{canWrite && <Th align="right" sticky="end">操作</Th>}</tr></thead><tbody>
        {ctx.e2Loading ? <TableLoading columns={canWrite?6:5}/> : !ready ? <TableMessage columns={canWrite?6:5} role="alert">手机任务加载失败 <Button size="sm" onClick={()=>void ctx.refreshE2()}>重试</Button></TableMessage> : !ctx.tasks.length ? <TableMessage columns={canWrite?6:5}>暂无手机任务</TableMessage> : ctx.tasks.slice((currentPage-1)*size,currentPage*size).map(t => {
          const { durationSeconds, version, enabled } = t.simulation!;
          const blocked = m.locked("task:" + t.id) ? "这个任务有结果未知的原提案，请先核对" : undefined;
          const statusAction = enabled ? "停用" : "启用";
          return <Tr key={t.id} selected={task?.id === t.id && !!form}>
            <Td grow><Cell main={<E6OriginalValues original={t.n}><span className="e6-end-text">{t.n}</span></E6OriginalValues>} sub={"版本 " + version}/></Td>
            <Td><TaskClassTag taskClass={t.taskClass as TaskClass}/></Td>
            <Td align="right" data-num="">{formatPhoneTaskDuration(durationSeconds!)}</Td>
            <Td align="right" data-num=""><RewardRanges seconds={durationSeconds!} tiers={ctx.phoneTiers}/></Td>
            <Td><StatusTag tone={enabled?"ok":"done"}>{taskStatus(enabled)}</StatusTag></Td>
            {canWrite && <Td align="right" sticky="end"><span className="rd-row-actions">
              <Button size="sm" aria-label={"编辑 " + t.n} disabledReason={blocked} onClick={()=>open(t)}>编辑</Button>
              <Button size="sm" aria-label={statusAction + " " + t.n} variant={enabled ? "danger-outline" : "secondary"} disabledReason={blocked} onClick={()=>openStatus(t)}>{statusAction}</Button>
            </span></Td>}
          </Tr>;
        })}
      </tbody></Table>
      {!!ctx.tasks.length && ready && <Pager label="手机任务" page={currentPage} pageSize={size} total={ctx.tasks.length} sizes={[10,20,50]} onPage={p=>{setPage(p);replaceQuery({taskPage:p});}} onPageSize={s=>{setSize(s);setPage(1);replaceQuery({taskPage:1,taskPageSize:s});}}/>}
    </Panel>
    {form && <Drawer open title={task?"编辑手机任务":"新增手机任务"} icon={Smartphone} tone="role-2" onClose={()=>setForm(null)} footer={<Decision primary={<Button variant="primary" disabledReason={!ready?"任务目录未就绪":formUnchanged?"没有修改":undefined} onClick={submitForm}>提交审批</Button>} others={<Button onClick={()=>setForm(null)}>取消</Button>}/>}>
      <Facts><Fact k="当前版本">{task?String(form.version):"待创建"}</Fact><Fact k="生效方式">{taskEffect}</Fact></Facts>
      <div className="e6-form-grid">
        <Field label="任务名称" required help={APP_VISIBLE_TEXT_HINT} error={appVisibleTextError(form.n,"任务名称") ?? (formError.includes("任务名称")?formError:undefined)}><Input value={form.n} onChange={e=>{setFormError("");setForm({...form,n:e.target.value});}}/></Field>
        <Field label="任务类型" explain="六类业务任务，批准后用于新派任务。"><Select aria-label="任务类型" value={form.taskClass} onChange={taskClass=>setForm({...form,taskClass})} options={TASK_CLASSES.map(value=>({value,label:TASK_CLASS_LABELS[value]}))}/></Field>
        <Field label="固定时长" required error={formError.startsWith("固定时长")?formError:undefined} help="60–86400 整数秒，建议不超过 1200 秒。" explain="手机 App 在后台的在线有效期为 1 小时，时长越长，这段时间内能完成的任务越少。"><NumberInput value={form.durationSeconds} min={60} max={86400} step={1} unit="秒" onChange={e=>{setFormError("");setForm({...form,durationSeconds:e.target.value});}}/></Field>
      </div>
      <Facts><Fact k="每单奖励预估">
        <RewardRanges seconds={durationSeconds} tiers={ctx.phoneTiers}/> <Explain label="每单奖励预估的说明" content={rewardHint}/>
      </Fact></Facts>
      {task ? <Notice tone="neutral" title={"当前" + taskStatus(form.enabled) + " · 只读"}>启停请用任务行的「启用 / 停用」操作。</Notice> : <Check label="启用任务" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})} explain="新建默认启用，批准后生效。"/>}
    </Drawer>}
    {confirm && <E6ConfirmModal scope={confirm.scope} amplificationBasis={emptyPoolBasis} briefKind="config"
      statedBrief={{impact:taskEffect,check:confirm.amplifies ? "核对任务配置、理由和兑付覆盖率。" : "核对任务配置和操作理由。"}}
      action={confirm.action} amplifies={confirm.amplifies} coverageCheck="批准时检查兑付覆盖率，未达标不会执行。" reasonMin={8} reasonMax={200}
      detail={taskEffect} confirmLabel="提交审批" cancelLabel={form ? "返回修改" : undefined}
      effect={<StatusTag tone="progress" filled explain="另一位有任务池修改和审批批准权限的管理员批准后生效。">批准后生效</StatusTag>}
      completionCopy="发起人不能批准自己的申请。"
      facts={<>
        <Facts><Fact k="原版本">{confirm.version||"待创建"}</Fact>
          {confirm.op === "e2_task_status" && <><Fact k="任务名称">{confirm.name}</Fact><Fact k="任务编号">{String(confirm.params.taskId)}</Fact><Fact k="固定时长">{formatPhoneTaskDuration(confirm.afterSeconds)}</Fact><Fact k="状态"><Change from={confirm.diff[0].before} to={confirm.diff[0].after}/></Fact></>}
          {confirm.beforeSeconds !== undefined && confirm.beforeSeconds !== confirm.afterSeconds && <Fact k="原时长奖励预估"><RewardRanges seconds={confirm.beforeSeconds} tiers={ctx.phoneTiers}/></Fact>}
          <Fact k="每单奖励预估"><RewardRanges seconds={confirm.afterSeconds} tiers={ctx.phoneTiers}/> <Explain label="确认中的奖励预估说明" content={rewardHint}/></Fact>
        </Facts>
        {confirm.op !== "e2_task_status" && <DiffList rows={confirm.diff} named/>}
      </>}
      getPendingReason={()=>m.pendingReason(confirm.scope)} blockedReason={m.pending.find(r=>r.scope===confirm.scope)?.ticketId?"已提交，请查询原审批单":undefined}
      onBack={form ? ()=>setConfirm(null) : undefined} onClose={()=>setConfirm(null)} onConfirm={async reason=>{
        const original=m.pending.find(r=>r.scope===confirm.scope);
        if(original) await m.send(original,true);
        else {
          const def=findHighOp(confirm.op)!;
          try {
            await m.proposal(confirm.scope,"tasks",{action:confirm.action,obj:confirm.name,beforeValue:confirm.before,afterValue:confirm.after,type:confirm.amplifies?"fund":def.type,amplifies:confirm.amplifies,reason,sourceDomain:"E6",command:def.buildCommand(confirm.params),target:confirm.target});
          } catch (error) {
            if (explicitRejectionCode(error) !== "SIMULATED_TASK_POLICY_VERSION_CONFLICT") throw error;
            setConfirm(null);setForm(null);
            const { taskCatalogReady } = await ctx.refreshE2();
            ctx.toast(taskCatalogReady ? "任务已更新，请从列表重新编辑。" : "任务已更新，读取最新值失败，请刷新后重新编辑。");
            return;
          }
        }
        setConfirm(null);setForm(null);ctx.toast("已提交，等待审批后执行");await ctx.refreshE2();
      }}/>}
  </>;
}

export function PhoneTiersSection({ctx}:{ctx:EViewCtx}) {
  const m=useE6Mutations(), rights=useAdminAuth(s=>s.session!.authorities);
  const [edit,setEdit]=useState<{tier:E2PhoneTier;field:"dailyUsdt"|"dailyNex";initialValue?:string}|null>(null);
  const ready=!ctx.e2Loading && ctx.phoneTiers.length===5;
  const text=(tier:E2PhoneTier,field:"dailyUsdt"|"dailyNex")=>tier[field==="dailyUsdt"?"dailyUsdtText":"dailyNexText"];
  const tierUsdtPrecision=e6AmountPrecision(ctx.phoneTiers.map(t=>text(t,"dailyUsdt"))), tierUvtPrecision=e6AmountPrecision(ctx.phoneTiers.map(t=>text(t,"dailyNex")));
  const canEdit=(field:"dailyUsdt"|"dailyNex")=>ctx.canWriteE2&&rights.includes("platform_a2_write")&&rights.includes(field==="dailyUsdt"?"device_e2_phone_tier_usdt":"device_e2_phone_tier_nex");
  useE6DraftEditor(["e2_phone_tier"], !!edit, record => {
    if (!ready || record.payload.kind !== "proposal") return false;
    const params = record.payload.input.command.params;
    const tier = ctx.phoneTiers.find(item => String(item.tier) === String(params.tier) && record.scope === `tier:${item.tier}`);
    const fields = (["dailyUsdt", "dailyNex"] as const).filter(field => params[field] != null);
    if (!tier || fields.length !== 1 || !canEdit(fields[0])) return false;
    const field = fields[0];
    setEdit({ tier, field, initialValue: String(params[field]) });
    return true;
  });
  const currency=edit?.field==="dailyUsdt"?"USDT":"UVT", scope=edit?`tier:${edit.tier.tier}`:"";
  const index=edit?ctx.phoneTiers.findIndex(t=>t.tier===edit.tier.tier):-1;
  const lower=index>0?ctx.phoneTiers[index-1]:undefined, upper=index>=0?ctx.phoneTiers[index+1]:undefined;
  const range=edit?`${lower?`不低于 T${lower.tier} 的 ${text(lower,edit.field)}`:"大于 0"}${upper?`，不高于 T${upper.tier} 的 ${text(upper,edit.field)}`:""} ${currency}/天。`:"";
  return <><E6PendingNotice section="tiers" toast={ctx.toast} onRead={()=>void ctx.refreshE2()}/>
    <Conclusion state={ready?"ok":"neutral"} icon={Layers3}>{ctx.e2Loading?"正在加载档位收益":ready?"五档收益已配置，引导使用 T3 档":"等档位收益读取成功后可用"}</Conclusion>
    <Panel className={ctx.phoneTiers.some(t=>formatE6Amount(text(t,"dailyUsdt"),tierUsdtPrecision).length>12||formatE6Amount(text(t,"dailyNex"),tierUvtPrecision).length>12)?"e6-tier-long":undefined} title="手机 5 档收益" icon={Coins} tone="role-4" explain="柱高只比较 USDT 日收益；UVT 独立显示。批准后用于新派手机任务，也用于校准和展示。已派任务按派单时的金额完成。" actions={(ctx.e2Loading||ready)?<Button size="sm" disabled={ctx.e2Loading} onClick={()=>void ctx.refreshE2()}>刷新</Button>:undefined}>
      {ctx.e2Loading?<StepBar label="手机五档收益" items={[]} unit="USDT/天" max={1} state="loading"/>:!ready?<BlockState state="error" title={ctx.e2Error?"档位收益读取失败":"档位收益数据不完整，暂不能调整"} detail={ctx.e2Error} onRetry={()=>void ctx.refreshE2()}/>:<E6OriginalValues group original={<table className="e6-original-tiers"><thead><tr><th>档位</th><th>USDT/天</th><th>UVT/天</th></tr></thead><tbody>{ctx.phoneTiers.map(t=><tr key={t.tier}><td>T{t.tier}</td><td>{text(t,"dailyUsdt")}</td><td>{text(t,"dailyNex")}</td></tr>)}</tbody></table>}><StepBar label="手机五档 USDT 日收益" unit="USDT/天" max={Math.max(...ctx.phoneTiers.map(t=>t.dailyUsdt))} items={ctx.phoneTiers.map(t=>({key:String(t.tier),label:`T${t.tier}`,name:operatorCopyText(t.name).replace(/\s/g,"")===`第${t.tier}档`?undefined:operatorCopyText(t.name),value:t.dailyUsdt,valueText:formatE6Amount(text(t,"dailyUsdt"),tierUsdtPrecision),secondary:<>{formatE6Amount(text(t,"dailyNex"),tierUvtPrecision)} UVT/天 {t.note&&<Explain label={`T${t.tier}的说明`} content={operatorCopyText(t.note)}/>}</>,mark:t.tier===3?"当前引导档":undefined,actions:<>{(["dailyUsdt","dailyNex"] as const).filter(canEdit).map(field=><Button key={field} size="sm" disabledReason={m.locked(`tier:${t.tier}`)?"这个档位有结果未知的原提案":undefined} onClick={()=>setEdit({tier:t,field})}>调 {field==="dailyUsdt"?"USDT":"UVT"}</Button>)}</>}))}/></E6OriginalValues>}
    </Panel>
    <E6YieldComparisonPanel ctx={ctx} ready={ready} />
    {edit&&<E6ConfirmModal scope={scope} amplificationBasis={value=>`T${edit.tier.tier} ${currency} 日收益由 ${text(edit.tier,edit.field)} 增加至 ${value} ${currency}/天。`} briefKind="config" statedBrief={{impact:"只调整当前档位的一个币种，批准后用于新派手机任务。已派任务按派单时的金额完成。",check:"核对该币种金额和相邻档位。调高时，批准环节检查兑付覆盖率。"}} action={`调整手机 T${edit.tier.tier} 每日收益（${currency}）`} reasonMin={8} reasonMax={200} detail="只调整这个币种；五档同币种收益须非递减。批准后用于新派手机任务，也用于校准和展示。已派任务按派单时的金额完成。" completionCopy="由另一位超级管理员（需有对应业务权限和审批批准权限）批准。" coverageCheck="批准时检查兑付覆盖率。" edit={{kind:"number",current:text(edit.tier,edit.field),initialValue:edit.initialValue,unit:`${currency}/天`,min:0.000001,step:0.000001,maxDecimals:6,disallowCurrent:true,amplifiesWhen:"increase",hint:range,validate:value=>!positiveAmount.test(value)?"收益最多 12 位整数、6 位小数。":lower&&compareE6Decimal(value,text(lower,edit.field))<0||upper&&compareE6Decimal(value,text(upper,edit.field))>0?`五档同币种收益须非递减：${range}`:undefined}}
      effect={<StatusTag tone="progress" filled explain="另一位有对应币种修改和审批批准权限的管理员批准后生效。">批准后生效</StatusTag>}
      facts={<Facts><Fact k="档位">{`T${edit.tier.tier} · ${operatorCopyText(edit.tier.name)}`}</Fact></Facts>} content={<Fold inset title="技术信息" summary="提交时核对有没有被别人改过"><Facts><Fact k="修改序号">{String(edit.tier.revision)}</Fact></Facts></Fold>} getPendingReason={()=>m.pendingReason(scope)} onClose={()=>setEdit(null)} onConfirm={async(reason,value)=>{
        const original=m.pending.find(r=>r.scope===scope);if(original) await m.send(original,true);else {
          if(!value||!positiveAmount.test(value)||compareE6Decimal(value,"0")<=0)throw new Error("收益须为正数，最多 12 位整数、6 位小数。");
          const index=ctx.phoneTiers.findIndex(t=>t.tier===edit.tier.tier),before=ctx.phoneTiers[index-1],after=ctx.phoneTiers[index+1];
          if(before&&compareE6Decimal(value,text(before,edit.field))<0||after&&compareE6Decimal(value,text(after,edit.field))>0)throw new Error("五档同币种收益须非递减，请核对相邻档位。");
          const def=findHighOp("e2_phone_tier")!,params={tier:edit.tier.tier,expectedRevision:edit.tier.revision,[edit.field]:value};
          await m.proposal(scope,"tiers",{action:`调整手机 T${edit.tier.tier} 每日收益（${currency}）`,obj:`T${edit.tier.tier}`,beforeValue:`${text(edit.tier,edit.field)} ${currency}/天`,afterValue:`${value} ${currency}/天`,type:def.type,amplifies:compareE6Decimal(value,text(edit.tier,edit.field))>0,reason,sourceDomain:"E2",command:def.buildCommand(params),target:def.buildTarget(params)});
        }setEdit(null);ctx.toast("已提交，等待审批后执行");await ctx.refreshE2();
      }}/>}
  </>;
}
