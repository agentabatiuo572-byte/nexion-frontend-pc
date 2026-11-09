import type { TaskPool } from "@/lib/admin/task-pool-client";
import { OpsHint } from "./ops-hint";

export function DevicePoolChoices({ pools, selected, ready, onChange }: { pools: TaskPool[]; selected: string[]; ready: boolean; onChange: (codes: string[]) => void }) {
  return <section className="e1-sku-task-policy col" style={{ gap: 14 }} aria-label="任务等级">
    <header className="row" style={{ gap: 8 }}><h3 style={{ margin: 0 }}>任务等级</h3><span className="muted">已选 {selected.length} 个</span><OpsHint>等级只决定跑什么任务，收益由月收益目标配平。上架至少选择一个等级；空池或全部停用时设备会等待配置，停跑期间不计收益、不补发。</OpsHint></header>
    {!ready ? <div className="muted">任务等级尚未加载，请刷新重试</div> : !pools.length ? <div className="muted">暂无等级，请先到任务池新增等级</div> : <div className="tp-choices">{pools.map(pool => <label key={pool.code}><input type="checkbox" checked={selected.includes(pool.code)} onChange={event => onChange(event.target.checked ? [...selected, pool.code] : selected.filter(code => code !== pool.code))} /><span><b>{pool.code} {pool.name}</b><small style={{ display: "block", marginTop: 4, color: "var(--ink-3)" }}>{pool.enabledCount} 个启用任务</small></span></label>)}</div>}
  </section>;
}
