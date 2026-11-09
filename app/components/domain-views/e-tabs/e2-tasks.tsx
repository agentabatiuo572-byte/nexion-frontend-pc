import { useCallback, useEffect, useState } from "react";
import { Btn, Badge, Drawer, DataListPager } from "../design-kit";
import { displayAdminError } from "@/lib/admin/error-messages";
import { TASK_CLASSES, TASK_CLASS_LABELS } from "@/lib/admin/task-classes";
import { deleteTaskPool, fetchDisableImpact, fetchPoolTasks, fetchTaskPools, randomPoolTasks, saveTaskPool, setPoolTaskStatus,
  type DisableImpact, type PoolTask, type TaskClass, type TaskPool } from "@/lib/admin/task-pool-client";
import type { EViewCtx } from "./types";
import { OpsHint } from "./ops-hint";

type PoolDialog = { kind: "add" | "rename" | "delete" | "random" | "status"; key: string; pool?: TaskPool; enabled?: boolean; ids?: string[] };
export function E2Tasks({ ctx }: { ctx: EViewCtx }) {
  const [pools, setPools] = useState<TaskPool[]>([]);
  const [code, setCode] = useState("");
  const [rows, setRows] = useState<PoolTask[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [taskClass, setTaskClass] = useState("");
  const [enabledFilter, setEnabledFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<PoolDialog | null>(null);
  const [name, setName] = useState("");
  const [count, setCount] = useState("10");
  const [classes, setClasses] = useState<TaskClass[]>([]);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [impact, setImpact] = useState<DisableImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const pool = pools.find(row => row.code === code);
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const levels = await fetchTaskPools(); setPools(levels);
      const current = levels.some(row => row.code === code) ? code : levels[0]?.code ?? "";
      if (current !== code) { setCode(current); setPage(1); }
      if (current) {
        const tasks = await fetchPoolTasks(current, { taskClass, enabled: enabledFilter, pageNum: current === code ? page : 1, pageSize });
        setRows(tasks.records); setTotal(tasks.total);
      } else { setRows([]); setTotal(0); }
      setSelected([]);
    } catch (cause) { setError(displayAdminError(cause)); setRows([]); setTotal(0); setSelected([]); }
    finally { setLoading(false); }
  }, [code, page, pageSize, taskClass, enabledFilter]);
  useEffect(() => { void refresh(); }, [refresh]);

  function open(kind: PoolDialog["kind"], status?: boolean) {
    setName(kind === "rename" ? pool?.name ?? "" : ""); setCount("10"); setClasses([]); setReason(""); setDialogError(""); setImpact(null);
    const ids = rows.filter(row => selected.includes(row.taskTypeId) && row.enabled !== status).map(row => row.taskTypeId);
    setDialog({ kind, pool, enabled: status, ids, key: crypto.randomUUID() });
    if (kind === "status" && status === false && pool) {
      setImpactLoading(true);
      void fetchDisableImpact(pool.code, ids).then(setImpact).catch(cause => setDialogError(displayAdminError(cause))).finally(() => setImpactLoading(false));
    }
  }
  const refusal = dialog?.kind === "delete" && dialog.pool
    ? dialog.pool.taskCount > 0 ? `不能删除：还有 ${dialog.pool.taskCount} 个任务（含停用任务）。`
      : dialog.pool.referencedBy.length ? `不能删除：仍被 ${dialog.pool.referencedBy.map(row => row.productName).join("、")} 引用（含草稿、已发布和下架商品）。` : "" : "";
  const reasonReady = reason.trim().length >= 8 && reason.trim().length <= 200;
  const formReady = reasonReady && !refusal && !impactLoading && (dialog?.kind !== "status" || dialog.enabled || impact !== null)
    && (!["add", "rename"].includes(dialog?.kind ?? "") || !!name.trim())
    && (dialog?.kind !== "random" || /^\d+$/.test(count) && Number(count) >= 1 && Number(count) <= 50);
  async function submit() {
    if (!dialog || !formReady || saving) return;
    setSaving(true); setDialogError("");
    try {
      if (dialog.kind === "add" || dialog.kind === "rename") await saveTaskPool(dialog.kind === "add" ? null : dialog.pool!.code, name.trim(), reason.trim());
      if (dialog.kind === "delete") await deleteTaskPool(dialog.pool!.code, reason.trim());
      if (dialog.kind === "random") await randomPoolTasks(dialog.pool!.code, { count: Number(count), taskClasses: classes.length ? classes : undefined, idempotencyKey: dialog.key, reason: reason.trim() });
      if (dialog.kind === "status") await setPoolTaskStatus(dialog.pool!.code, { taskTypeIds: dialog.ids!, enabled: dialog.enabled!, idempotencyKey: dialog.key, reason: reason.trim() });
      setDialog(null); ctx.toast("已生效"); await refresh();
    } catch (cause) { setDialogError(displayAdminError(cause)); }
    finally { setSaving(false); }
  }
  const selectedRows = rows.filter(row => selected.includes(row.taskTypeId));
  return <div className="task-pools">
    <div className="row tp-levels" role="tablist" aria-label="任务等级">
      {pools.map(level => <button type="button" role="tab" aria-selected={level.code === code} className={`tp-level${level.code === code ? " on" : ""}`} key={level.code} onClick={() => { setCode(level.code); setPage(1); setSelected([]); }}>
        <b>{level.code} {level.name}</b><span>{level.taskCount}</span>
      </button>)}
      {ctx.canWriteE2 && <Btn onClick={() => open("add")}>+ 新增等级</Btn>}
      <span style={{ marginLeft: "auto" }}><Btn sm disabled={loading} onClick={() => void refresh()}>刷新</Btn></span>
    </div>
    {error && <div className="tint danger" role="alert">{error}</div>}
    {pool && <section className="pane">
      <div className="tp-pool-head">
        <div><h2>{pool.code} {pool.name}</h2><div className="row" style={{ gap: 7, marginTop: 8 }}>
          <span className="muted">被 {pool.referencedBy.length} 个商品使用{pool.referencedBy.length ? `：${pool.referencedBy.slice(0, 3).map(row => row.productName).join("、")}${pool.referencedBy.length > 3 ? "…" : ""}` : ""}</span><OpsHint label="查看使用此等级的商品">{pool.referencedBy.length ? pool.referencedBy.map(row => <div key={row.productKey}>{row.productName} · {{ PUBLISHED: "已发布", DRAFT: "草稿", DELISTED_WITH_DEVICES: "已下架，仍有设备" }[row.state]}</div>) : "暂无商品引用"}</OpsHint>
        </div></div>
        <div className="tp-load"><strong>{pool.avgDurationMinutes == null ? "平均时长 —" : `平均时长 ${Number(pool.avgDurationMinutes).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} 分钟`}</strong><span>约 {pool.estTasksPerDevicePerDay == null ? "—" : Number(pool.estTasksPerDevicePerDay).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} 单/台/天</span></div>
        {ctx.canWriteE2 && <div className="row" style={{ gap: 8 }}><Btn sm onClick={() => open("rename")}>改名</Btn><Btn sm onClick={() => open("delete")}>删除等级</Btn></div>}
      </div>
      <div className="tp-toolbar">
        {ctx.canWriteE2 && <><Btn variant="primary" disabled={loading} onClick={() => open("random")}>随机添加任务</Btn>
          <Btn disabled={loading || !selectedRows.some(row => row.enabled)} onClick={() => open("status", false)}>批量停用</Btn>
          <Btn disabled={loading || !selectedRows.some(row => !row.enabled)} onClick={() => open("status", true)}>批量启用</Btn></>}
        <span className="muted">{selected.length ? `已选 ${selected.length} 项` : `${pool.enabledCount} 个启用中`}</span>
        <OpsHint>等级只决定跑什么任务，收益由商品的月收益目标决定。当前任务保持原配置，修改只影响之后的新任务。每级最多 200 个启用任务、300 个任务（含停用）。</OpsHint>
        <select className="fld" aria-label="任务类型筛选" value={taskClass} onChange={event => { setTaskClass(event.target.value); setPage(1); }}><option value="">全部类型</option>{TASK_CLASSES.map(c => <option key={c} value={c}>{TASK_CLASS_LABELS[c]}</option>)}</select>
        <select className="fld" aria-label="任务启用状态筛选" value={enabledFilter} onChange={event => { setEnabledFilter(event.target.value); setPage(1); }}><option value="">全部状态</option><option value="true">启用中</option><option value="false">已停用</option></select>
      </div>
      <div className="tp-table-wrap"><table className="tp-table"><thead><tr>
        <th><input type="checkbox" aria-label="选择本页全部任务" disabled={!ctx.canWriteE2 || !rows.length || loading} checked={!!rows.length && rows.every(row => selected.includes(row.taskTypeId))} onChange={event => setSelected(event.target.checked ? rows.map(row => row.taskTypeId) : [])} /></th>
        <th>任务名称</th><th>类型</th><th>时长</th><th>状态</th>
      </tr></thead><tbody>{loading ? <tr><td colSpan={5} className="empty">正在加载…</td></tr> : rows.length ? rows.map(row => <tr key={row.taskTypeId}>
        <td><input type="checkbox" aria-label={`选择 ${row.name}`} disabled={!ctx.canWriteE2} checked={selected.includes(row.taskTypeId)} onChange={event => setSelected(event.target.checked ? [...selected, row.taskTypeId] : selected.filter(id => id !== row.taskTypeId))} /></td>
        <td><strong>{row.name}</strong></td><td><Badge tone="cyan">{TASK_CLASS_LABELS[row.taskClass]}</Badge></td><td className="tnum">{row.durationMinutes} 分钟</td><td><Badge tone={row.enabled ? "ok" : "neutral"}>{row.enabled ? "启用" : "停用"}</Badge></td>
      </tr>) : <tr><td colSpan={5} className="empty">{error ? "任务读取失败" : "暂无任务，可随机添加"}</td></tr>}</tbody></table></div>
      <DataListPager total={total} page={page} pageSize={pageSize} label="任务" onPageChange={setPage} onPageSizeChange={value => { setPageSize(value); setPage(1); }} pageSizeOptions={[10, 20, 50]} />
    </section>}
    {!pool && !loading && !error && <div className="empty">暂无任务等级，请新增等级。</div>}
    {dialog && <Drawer title={{ add: "新增等级", rename: "修改等级名称", delete: "删除等级", random: "随机添加任务", status: dialog.enabled ? "批量启用任务" : "批量停用任务" }[dialog.kind]}
      sub={dialog.pool ? `${dialog.pool.code} ${dialog.pool.name}` : "编号由系统按顺序生成"} onClose={() => { if (!saving) setDialog(null); }}
      footer={<><Btn disabled={saving} onClick={() => setDialog(null)}>取消</Btn>{!refusal && <Btn variant={dialog.kind === "delete" || dialog.kind === "status" && !dialog.enabled ? "danger" : "primary"} disabled={!formReady || saving} onClick={() => void submit()}>{saving ? "提交中…" : "确认并生效"}</Btn>}</>}>
      <div className="tp-dialog">
        {refusal ? <div className="tint warn" role="alert">{refusal}</div> : <>
          <div className="tp-key-info">{dialog.kind === "random" ? "生成后立即加入当前等级" : dialog.kind === "status" ? `本次${dialog.enabled ? "启用" : "停用"} ${dialog.ids?.length} 个任务` : dialog.kind === "delete" ? "删除后，此等级将从列表中移除" : "只修改展示名称，等级编号和类别固定"}</div>
          {(["add", "rename"].includes(dialog.kind)) && <label className="col">等级名称<input className="fld" autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="如 标准" /></label>}
          {dialog.kind === "random" && <><label className="col">任务数量<input className="fld" type="number" min={1} max={50} step={1} value={count} onChange={event => setCount(event.target.value)} /><span className="muted">1–50 个</span></label>
            <fieldset><legend>限定类型 <span className="muted">（可选，不选则全部类型）</span></legend><div className="tp-choices">{TASK_CLASSES.map(c => <label key={c}><input type="checkbox" checked={classes.includes(c)} onChange={event => setClasses(event.target.checked ? [...classes, c] : classes.filter(item => item !== c))} />{TASK_CLASS_LABELS[c]}</label>)}</div></fieldset>
            <div className="row"><span className="muted">仅影响之后新派的任务</span><OpsHint>时长为 30–120 分钟、5 分钟整数倍，按类型生成。名称由服务端生成，同一等级内不重名。重复点击本次提交不会重复添加。</OpsHint></div></>}
          {dialog.kind === "status" && !dialog.enabled && <>{impactLoading ? <div role="status">正在计算停用影响…</div> : impact && (impact.productsLosingAllTasks.length ? <div className="tint warn" role="alert"><strong>以下商品将没有可用任务</strong><ul>{impact.productsLosingAllTasks.map(row => <li key={row.productKey}>{row.productName}</li>)}</ul><b>影响 {impact.devicesAffected} 台设备</b><p>当前单照常完成，之后等待配置；停跑期间不计收益、不补发。</p></div> : <div className="muted">没有商品会失去全部可用任务。</div>)}</>}
          <label className="col">操作理由<textarea className="fld" rows={3} minLength={8} maxLength={200} value={reason} onChange={event => setReason(event.target.value)} placeholder="请填写本次调整的原因（8–200 字）" /><span className="muted">{reason.trim().length}/200</span></label>
        </>}
        {dialogError && <div className="tint danger" role="alert">{dialogError}</div>}
      </div>
    </Drawer>}
  </div>;
}
