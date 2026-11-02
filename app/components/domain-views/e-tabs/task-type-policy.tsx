"use client";

import { useEffect, useState } from "react";
import { Btn, OperationConfirmModal } from "../design-kit";
import type { OpsTask } from "@/lib/admin/platform-types";
import { guardedFetch, formatAdminApiError } from "@/lib/admin/error-messages";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { createA2CommandKey } from "@/lib/admin/a2-client";

export function TaskTypeChoices({ tasks, selected, onChange, ready }: {
  tasks: Pick<OpsTask, "id" | "n" | "simulation">[]; selected: string[]; onChange: (ids: string[]) => void; ready: boolean;
}) {
  if (!ready) return <div className="tint warn tiny">任务类型尚未加载，请刷新任务列表后再提交。</div>;
  const options = tasks.filter((task) => task.simulation);
  return <div className="col" style={{ gap: 8 }}>
    {!options.length && <div className="tint tiny">请先在 E2 发布任务类型。</div>}
    {options.map((task) => <label key={task.id} className="row" style={{ gap: 8 }}>
      <input type="checkbox" checked={selected.includes(task.id)} disabled={!task.simulation!.enabled && !selected.includes(task.id)} onChange={(e) => onChange(e.target.checked ? [...selected, task.id] : selected.filter((id) => id !== task.id))} />
      <span>{task.n} · {task.simulation!.durationMinutes} 分钟 · {task.simulation!.baseReward} {task.simulation!.asset}{task.simulation!.enabled ? "" : " · 已停用"}</span>
    </label>)}
    {selected.filter((id) => !options.some((task) => task.id === id)).map((id) => <label key={id} className="row" style={{ gap: 8 }}><input type="checkbox" checked onChange={() => onChange(selected.filter((value) => value !== id))} />{id} · 当前不可用，请取消后重新选择</label>)}
  </div>;
}

interface PhonePolicy {
  policy: { allowedTaskTypeIds: string[]; productTaskPolicyVersion: number; productTaskPolicyEffectiveAt?: string };
  taskTypes: { taskTypeId: string; typeVersion: number; name: string; durationSeconds: number; baseReward: string | number; asset: "UVT" | "USDT"; enabled: boolean }[];
}

export async function fetchTaskTypePolicy(): Promise<PhonePolicy> {
  const response = await guardedFetch("/api/admin/devices/skus/phone/task-policy", { cache: "no-store" });
  const result = await response.json() as { code: number; message?: string; data: PhonePolicy };
  if (!response.ok || result.code !== 0) throw new Error(formatAdminApiError(result.message, "任务策略加载失败"));
  return result.data;
}
export function policyTaskChoices(data: PhonePolicy) {
  return data.taskTypes.map((type) => ({ id: type.taskTypeId, n: type.name, simulation: { ...type, version: type.typeVersion, durationMinutes: type.durationSeconds / 60 } }));
}

export function PhoneTaskPolicy({ canWrite, toast }: { canWrite: boolean; toast: (message: string) => void }) {
  const [data, setData] = useState<PhonePolicy | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{ ids: string[]; version: number; key: string } | null>(null);
  const propose = usePropose();
  async function refresh() {
    setError("");
    const next = await fetchTaskTypePolicy();
    setData(next); setSelected(next.policy.allowedTaskTypeIds);
  }
  useEffect(() => { void refresh().catch((failure: Error) => setError(failure.message)); }, []);
  const tasks = data ? policyTaskChoices(data) : [];
  return <section className="pane" style={{ padding: 18, marginBottom: 16 }}>
    <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}><strong>手机类别可跑任务</strong><Btn sm onClick={() => void refresh().catch((failure: Error) => setError(failure.message))}>刷新</Btn></div>
    {error && <div className="tint warn tiny" role="alert">{error}</div>}
    <TaskTypeChoices tasks={tasks ?? []} selected={selected} onChange={setSelected} ready={!!data && !error} />
    <p className="muted tiny">手机按已勾选类型等概率生成新任务；运行中的任务保留原配置。当前版本 {data?.policy.productTaskPolicyVersion ?? "—"}。</p>
    {canWrite && <Btn sm variant="primary" disabled={!data || !!error || !selected.length || JSON.stringify(selected) === JSON.stringify(data.policy.allowedTaskTypeIds)} onClick={() => setConfirmation({ ids: [...selected], version: data!.policy.productTaskPolicyVersion, key: createA2CommandKey("e1-phone-policy") })}>提交发布</Btn>}
    {confirmation && <OperationConfirmModal action="发布手机可跑任务" detail={`发布 ${confirmation.ids.join("、")}，仅影响之后的新任务。`} onClose={() => setConfirmation(null)} onConfirm={async (reason) => {
      const def = findHighOp("e1_phone_task_policy")!;
      await propose(toast, { action: def.action, obj: "phone", before: data!.policy.allowedTaskTypeIds.join("、") || "未配置", after: confirmation.ids.join("、"), type: def.type, amplifies: false, gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E1", command: def.buildCommand({ allowedTaskTypeIds: confirmation.ids, expectedVersion: confirmation.version }), target: def.buildTarget({}), commandKey: confirmation.key });
      setConfirmation(null);
    }} />}
  </section>;
}
