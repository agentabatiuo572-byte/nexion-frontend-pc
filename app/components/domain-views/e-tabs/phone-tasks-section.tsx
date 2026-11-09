import { useEffect, useState } from "react";
import { Badge, Btn, DataListPager } from "../design-kit";
import { displayAdminError } from "@/lib/admin/error-messages";
import { fetchTaskPools, type TaskPool } from "@/lib/admin/task-pool-client";
import { TASK_CLASS_LABELS } from "@/lib/admin/task-classes";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { OpsHint } from "./ops-hint";
import type { EViewCtx } from "./types";

export function PhoneTasksSection({ ctx }: { ctx: EViewCtx }) {
  const [pools, setPools] = useState<TaskPool[]>([]);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  useEffect(() => {
    let live = true;
    if (!ctx.canReadE2) return;
    void fetchTaskPools("PHONE").then(rows => { if (live) { setPools(rows); setError(""); } }).catch(cause => { if (live) setError(displayAdminError(cause)); });
    return () => { live = false; };
  }, [ctx.canReadE2, ctx.tasks]);
  const ready = !ctx.e2Loading && ctx.e2TaskCatalogReady;
  const canWriteTasks = ctx.canWriteE2 && ready;
  const canWriteTiers = ctx.canWriteE2 && !ctx.e2Loading && !ctx.e2Error;
  const currentPage = Math.min(page, Math.max(1, Math.ceil(ctx.tasks.length / pageSize)));
  return <div className="phone-sections">
    {ctx.canReadE2 && <section className="pane">
      <div className="pane-h"><span className="ttl">手机任务池</span><OpsHint>仅手机可接；按每任务奖励结算，在线有效期仍为 1 小时。新增、编辑和启停均沿用 A2 双人审批与覆盖率检查。</OpsHint><span className="r">{canWriteTasks && <Btn sm variant="primary" onClick={ctx.openAddTask}>+ 新增手机任务</Btn>}</span><Btn sm disabled={ctx.e2Loading} onClick={() => void ctx.refreshE2()}>刷新</Btn></div>
      {(error || ctx.e2Error) && <div className="tint warn" role="alert">{error || ctx.e2Error}</div>}
      <div style={{ padding: "16px 24px", display: "flex", gap: 12, alignItems: "center" }}><Badge tone="cyan">PHONE</Badge><strong>{pools[0]?.name || "手机任务池"}</strong><span className="muted">{pools[0]?.enabledCount ?? "—"} 个启用中</span></div>
      <div className="tp-table-wrap"><table className="tp-table"><thead><tr><th>任务名称</th><th>类型</th><th>时长</th><th>每任务奖励</th><th>状态</th><th>操作</th></tr></thead><tbody>
        {ctx.e2Loading ? <tr><td colSpan={6} className="empty">正在加载…</td></tr> : ctx.tasks.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(task => <tr key={task.id}><td><strong>{task.n}</strong></td><td><Badge tone="cyan">{TASK_CLASS_LABELS[task.taskClass as keyof typeof TASK_CLASS_LABELS]}</Badge></td><td>{task.simulation!.durationMinutes} 分钟</td><td className="tnum"><strong>{task.simulation!.baseReward} {task.simulation!.asset}</strong></td><td><Badge tone={task.simulation!.enabled ? "ok" : "neutral"}>{task.simulation!.enabled ? "启用" : "停用"}</Badge></td><td>{canWriteTasks && <div className="row" style={{ gap: 8 }}><Btn sm onClick={() => ctx.openEditTask(task)}>编辑</Btn><Btn sm onClick={() => ctx.openActionConfirm({ briefKind: "config", name: `${task.simulation!.enabled ? "停用" : "启用"}手机任务 · ${task.n}`, op: "task-status", taskId: task.id, fixedVal: task.simulation!.enabled ? "inactive" : "active", amplify: !task.simulation!.enabled && Number(task.simulation!.baseReward) > 0, detail: "另一位管理员批准后对新任务生效；已派出的任务按原版本完成。" })}>{task.simulation!.enabled ? "停用" : "启用"}</Btn></div>}</td></tr>)}
        {!ctx.e2Loading && !ctx.tasks.length && <tr><td colSpan={6} className="empty">{ctx.e2Error ? "手机任务加载失败" : "暂无手机任务"}</td></tr>}
      </tbody></table></div>
      <DataListPager label="手机任务" page={currentPage} pageSize={pageSize} total={ctx.tasks.length} onPageChange={setPage} onPageSizeChange={value => { setPageSize(value); setPage(1); }} pageSizeOptions={[10, 20, 50]} />
    </section>}
    {ctx.canReadE2 && <><section className="pane"><div className="pane-h"><span className="ttl">手机 5 档收益</span><OpsHint>App 手机算力卡片使用此每日收益快照。调整走原 A2 审批与覆盖率检查，从下个结算周期生效，已发收益不变。</OpsHint></div>
      <table className="tp-table"><thead><tr><th>档位</th><th>名称</th><th>USDT/天</th><th>UVT/天</th><th>操作</th></tr></thead><tbody>{ctx.phoneTiers.map(tier => <tr key={tier.tier}><td><Badge tone="cyan">T{tier.tier}</Badge></td><td><strong>{operatorCopyText(tier.name)}</strong> <OpsHint>{operatorCopyText(tier.note)}</OpsHint></td><td>{tier.dailyUsdt}</td><td>{tier.dailyNex}</td><td>{canWriteTiers && <div className="row" style={{ gap: 8 }}>{(["dailyUsdt", "dailyNex"] as const).map(field => <Btn sm key={field} onClick={() => ctx.openActionConfirm({ briefKind: "config", name: `调整手机 T${tier.tier} 每日收益（${field === "dailyUsdt" ? "USDT" : "UVT"}）`, op: "phone-tier", phoneTier: tier.tier, phoneField: field, amplify: true,
        edit: { kind: "number", current: String(tier[field]), unit: `${field === "dailyUsdt" ? "USDT" : "UVT"}/天`, min: 0.00001, step: 0.00001, disallowCurrent: true }, detail: "调整需另一位管理员批准；调高会增加平台支出，仍检查兑付覆盖率。从下个结算周期生效，已发收益不变。" })}>调 {field === "dailyUsdt" ? "USDT" : "UVT"}</Btn>)}</div>}</td></tr>)}</tbody></table>
    </section>
    <section className="pane"><div className="pane-h"><span className="ttl">新用户引导收益对比</span><OpsHint>与 App 校准结果共用数据。手机来自 T3 档位，其他来自在售商品；请到相应来源修改。</OpsHint></div>
      {!ctx.e2Loading && ctx.yieldComparisons.length !== 4 && <div className="tint warn">数据不全，请核对在售商品与手机 T3 档位。</div>}
      <table className="tp-table"><thead><tr><th>名称</th><th>USDT/天</th><th>UVT/天</th><th>来源</th></tr></thead><tbody>{ctx.yieldComparisons.map(row => <tr key={row.configKey}><td><strong>{nexGridBrandText(row.label)}</strong></td><td>{row.dailyUsdt}</td><td>{row.dailyNex}</td><td>{row.configKey === "phone" ? "手机 T3 档位" : "商品管理"}</td></tr>)}</tbody></table>
    </section></>}
  </div>;
}
