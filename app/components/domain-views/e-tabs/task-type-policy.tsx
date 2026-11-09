import type { TaskPool } from "@/lib/admin/task-pool-client";
import { OpsHint } from "./ops-hint";

export const FIXED_DEVICE_LEVELS = [
  { code: "L1", name: "初级" }, { code: "L2", name: "中级" },
  { code: "L3", name: "高级" }, { code: "L4", name: "旗舰" },
];

export function DevicePoolChoices({ pools, selected, onChange }: { pools: TaskPool[]; selected: string[]; onChange: (codes: string[]) => void }) {
  const selectedNames = FIXED_DEVICE_LEVELS.filter(pool => selected.includes(pool.code)).map(pool => pool.name);
  const appPreview = selectedNames.length ? `可运行${selectedNames.join(" / ")} AI 算力任务` : "请选择任务等级后预览";
  return <section className="e1-sku-task-policy col" style={{ gap: 14 }} aria-label="任务等级">
    <header className="row" style={{ gap: 8 }}><h3 style={{ margin: 0 }}>任务等级</h3><span className="muted">已选 {selected.length} 个</span><OpsHint label="任务等级在 App 中如何展示">App 商城的商品介绍会展示「可运行初级 / 中级 AI 算力任务」这类文案，使用商品已发布的等级。此处预览当前选择，审批发布后才更新 App。<br />等级只决定设备运行哪些任务，不决定赚多少钱；收益由月收益目标配平。App 不展示具体任务名、时长或数量。</OpsHint></header>
    <div className="tp-choices">{FIXED_DEVICE_LEVELS.map(level => {
      const pool = pools.find(pool => pool.code === level.code);
      return <label key={level.code}><input type="checkbox" checked={selected.includes(level.code)} onChange={event => onChange(event.target.checked ? [...selected, level.code] : selected.filter(code => code !== level.code))} /><span><b>{level.code} {level.name}</b>{pool && <small style={{ display: "block", marginTop: 4, color: "var(--ink-3)" }}>{pool.enabledCount} 个启用任务</small>}</span></label>;
    })}</div>
    <div className="tint" style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 14px" }}><span className="muted" style={{ fontSize: 12 }}>App 展示预览</span><output aria-label="App 任务等级文案预览" style={{ fontSize: 14 }}>{appPreview}</output></div>
  </section>;
}
