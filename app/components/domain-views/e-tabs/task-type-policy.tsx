"use client";

import { useEffect, useState } from "react";
import { Btn, OperationConfirmModal } from "../design-kit";
import { TASK_CLASSES, TASK_CLASS_LABELS, taskClassNames } from "@/lib/admin/task-classes";
import { guardedFetch, formatAdminApiError } from "@/lib/admin/error-messages";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { createA2CommandKey } from "@/lib/admin/a2-client";

export function TaskClassChoices({ selected, onChange, ready, readOnly = false }: {
  selected: string[]; onChange: (classes: string[]) => void; ready: boolean; readOnly?: boolean;
}) {
  if (!ready) return <div className="tint warn tiny">可跑任务大类尚未加载，请刷新后再提交。</div>;
  return <div className="col" style={{ gap: 8 }}>
    {TASK_CLASSES.map((key) => <label key={key} className="row" style={{ gap: 8 }}>
      <input type="checkbox" checked={selected.includes(key)} disabled={readOnly}
        onChange={(e) => onChange(TASK_CLASSES.filter((c) => c === key ? e.target.checked : selected.includes(c)))} />
      <span>{TASK_CLASS_LABELS[key]}</span>
    </label>)}
  </div>;
}

interface PhonePolicy {
  policy: { allowedTaskClasses: string[]; productTaskPolicyVersion: number; productTaskPolicyEffectiveAt?: string };
}

async function fetchTaskClassPolicy(): Promise<PhonePolicy> {
  const response = await guardedFetch("/api/admin/e1/skus/phone/task-policy?classesOnly=true", { cache: "no-store" });
  const result = await response.json() as { code: number; message?: string; data: PhonePolicy };
  if (!response.ok || result.code !== 0) throw new Error(formatAdminApiError(result.message, "任务策略加载失败"));
  if (!Array.isArray(result.data?.policy?.allowedTaskClasses)) throw new Error("手机任务大类尚未加载，请刷新后重试。");
  return result.data;
}

export function PhoneTaskPolicy({ canWrite, toast }: { canWrite: boolean; toast: (message: string) => void }) {
  const [data, setData] = useState<PhonePolicy | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{ classes: string[]; version: number; key: string } | null>(null);
  const propose = usePropose();
  async function refresh() {
    setError("");
    const next = await fetchTaskClassPolicy();
    setData(next); setSelected(next.policy.allowedTaskClasses);
  }
  useEffect(() => { void refresh().catch(() => setError("任务策略加载失败")); }, []);
  return <section className="pane e1-phone-task-policy">
    <header>
      <div className="row">
        <strong>手机类别可跑任务</strong>
        <span className="badge-s neutral">当前版本 {data?.policy.productTaskPolicyVersion ?? "—"}</span>
      </div>
      <Btn sm onClick={() => void refresh().catch(() => setError("任务策略加载失败"))}>刷新</Btn>
    </header>
    {error && <div className="tint warn tiny" role="alert">{error}</div>}
    <TaskClassChoices selected={selected} onChange={setSelected} ready={!!data && !error} readOnly={!canWrite} />
    <footer>
      <p className="muted tiny">手机从已选大类的启用任务中随机接单。同类新任务启用后自动加入。</p>
      {canWrite && <Btn sm variant="primary" disabled={!data || !!error || !selected.length || taskClassNames(selected) === taskClassNames(data.policy.allowedTaskClasses)} onClick={() => setConfirmation({ classes: [...selected], version: data!.policy.productTaskPolicyVersion, key: createA2CommandKey("e1-phone-policy") })}>提交发布</Btn>}
    </footer>
    {confirmation && <OperationConfirmModal briefKind={"content"} action="发布手机可跑任务" detail={`发布 ${taskClassNames(confirmation.classes)}，同类新任务启用后自动可派。`} onClose={() => setConfirmation(null)} onConfirm={async (reason) => {
      const def = findHighOp("e1_phone_task_policy")!;
      await propose(toast, { action: def.action, obj: "phone", before: taskClassNames(data!.policy.allowedTaskClasses), after: taskClassNames(confirmation.classes), type: def.type, amplifies: false, gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "E1", command: def.buildCommand({ allowedTaskClasses: confirmation.classes, expectedVersion: confirmation.version }), target: def.buildTarget({}), commandKey: confirmation.key });
      setConfirmation(null);
    }} />}
  </section>;
}
