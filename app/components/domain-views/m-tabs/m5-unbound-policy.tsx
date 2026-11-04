"use client";

import { useEffect, useRef, useState } from "react";
import { displayAdminError } from "@/lib/admin/error-messages";
import { supportUnboundPolicyClient, type SupportUnboundPolicy, type SupportUnboundPolicyUpdate } from "@/lib/admin/m-support-client";
import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";
import { useSupportManagementCommand, type SupportIntent } from "@/lib/admin/use-support-management-command";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { supportGroupClient, type SupportGroupDirectory } from "@/lib/admin/support-group-client";
import { HDSelect } from "./hd-ui";
import type { MSupportPermission } from "./m5-service-rules";

const policyCommands = createPendingMutationStore<SupportIntent<SupportUnboundPolicyUpdate>>({
  storageKey: "nexion-m5-unbound-policy-v1", retainExpiredRecords: true,
  isValidRecord: row => Number.isSafeInteger(row.payload?.expectedVersion) && typeof row.payload.reason === "string",
});
const draftOf = (row: Pick<SupportUnboundPolicy, "alertMinutes" | "fallbackMinutes" | "defaultGroupId">) => ({
  alert: String(row.alertMinutes), fallback: String(row.fallbackMinutes), group: row.defaultGroupId == null ? "" : String(row.defaultGroupId),
});

/** D-3 / M-18: how long an unassigned inquiry may wait, and which group receives customers no one routed. */
export function M5UnboundPolicy({ permission }: { permission: MSupportPermission }) {
  const session = useAdminAuth(state => state.session);
  const [policy, setPolicy] = useState<SupportUnboundPolicy | null>(null);
  const [groups, setGroups] = useState<SupportGroupDirectory[]>([]);
  const [draft, setDraft] = useState({ alert: "", fallback: "", group: "" });
  const [reason, setReason] = useState("");
  const [error, setError] = useState(""), [savedVersion, setSavedVersion] = useState<number>(), [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  // BUG-122: a failed directory read is not an empty one; the saved group stays shown and stays the value saved.
  const [groupsFailed, setGroupsFailed] = useState(false);
  const preserveDraft = useRef(false);
  const editable = permission === "superadmin" && Boolean(session?.authorities.includes("service_m1_write"));
  const command = useSupportManagementCommand<SupportUnboundPolicyUpdate, SupportUnboundPolicy>({
    store: policyCommands, slot: `unbound-policy:${session?.adminId}`, canQuery: editable, canWrite: editable,
    write: supportUnboundPolicyClient.update,
    query: supportUnboundPolicyClient.command,
    onSuccess: row => {
      setSavedVersion(row.version); setPolicy(row); setDraft(draftOf(row)); setReason("");
      preserveDraft.current = false; setLoading(true); setReload(value => value + 1);
    },
    onFailure: payload => {
      setDraft(draftOf(payload)); setReason(payload.reason); preserveDraft.current = true;
      setLoading(true); setReload(value => value + 1);
    },
  });
  const { busy: saving, pending } = command;

  useEffect(() => {
    const controller = new AbortController();
    setError(""); setLoading(true);
    Promise.all([supportUnboundPolicyClient.read(controller.signal), supportGroupClient.groups(controller.signal).catch(() => null)]).then(([row, list]) => {
      if (controller.signal.aborted) return;
      setPolicy(row); setGroupsFailed(list === null); setGroups((list ?? []).filter((group) => group.status === "ENABLED"));
      if (!preserveDraft.current) setDraft(draftOf(row));
    }).catch((cause) => { if (!controller.signal.aborted) { setPolicy(null); setError(displayAdminError(cause)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  const alert = Number(draft.alert), fallback = Number(draft.fallback);
  const valid = Number.isInteger(alert) && Number.isInteger(fallback) && alert >= 1 && alert <= 120 && fallback > alert && fallback <= 1440;
  const changed = policy && (alert !== policy.alertMinutes || fallback !== policy.fallbackMinutes || (draft.group || null) !== (policy.defaultGroupId ? String(policy.defaultGroupId) : null));
  const reasonOk = reason.trim().length >= 8 && reason.trim().length <= 200;

  function save() {
    if (!policy || !editable || !valid || !changed || !reasonOk || saving || loading || pending) return;
    setSavedVersion(undefined);
    void command.run("submit", { alertMinutes: alert, fallbackMinutes: fallback, defaultGroupId: draft.group ? Number(draft.group) : null, expectedVersion: policy.version, reason: reason.trim() });
  }

  return <div className="m-admin-panel m5-unbound-policy">
    <h2>待分配客户</h2>
    <div className="m-admin-muted">没有专属客服的客户发来消息后：先提醒主管，等待过久则按负载自动分配；没有分组的新客户进入默认接收组。</div>
    {!editable && <div className="m-admin-muted">需超级管理员身份和客服管理写权限，当前为只读视图。</div>}
    {editable && !pending && command.message && <div className="m-admin-error" role="status">{command.message}</div>}
    {savedVersion !== undefined && <div className="m-admin-muted" role="status">原操作已保存，策略版本 {savedVersion}。</div>}
    {error && <div className="m-admin-error" role="alert">{error} <button type="button" className="btn btn-sec btn-sm" onClick={() => setReload((n) => n + 1)}>重新加载</button></div>}
    {pending && editable ? <>
      <div className="m-admin-error" role="status"><strong>上次保存结果待确认</strong><p>{saving ? "正在确认原操作…" : command.message || "请先查询原操作。"}</p></div>
      {!command.denied && <>
        <p>原策略版本 {pending.payload.expectedVersion} · 提醒主管 {pending.payload.alertMinutes} 分钟 · 自动兜底 {pending.payload.fallbackMinutes} 分钟</p>
        <p>默认接收组：{pending.payload.defaultGroupId == null ? "不设置" : groups.find(group => String(group.id) === String(pending.payload.defaultGroupId))?.name ?? `组编号 ${pending.payload.defaultGroupId}`}</p>
        <label className="field"><span>原修改理由</span><textarea readOnly value={pending.payload.reason} /></label>
        <p className="m-admin-muted">原操作编号 {pending.commandKey}</p>
      </>}
      <div className="m-admin-toolbar">
        <button type="button" className={command.canReplay ? "btn btn-sec btn-sm" : "btn btn-pri btn-sm"} disabled={saving} onClick={() => void command.run("query")}>查询原操作</button>
        <button type="button" className={command.canReplay ? "btn btn-pri btn-sm" : "btn btn-sec btn-sm"} disabled={saving || !command.canReplay} onClick={() => void command.run("replay")}>按原操作重试</button>
      </div>
    </> : !policy ? !error && <div className="m-admin-muted" role="status">正在加载…</div> : <>
      <div className="m-admin-row">
        <div><label htmlFor="m-unbound-alert">提醒主管（分钟）</label><p>客户留言后超过该时长仍未分配，收件箱标红并提醒主管。</p></div>
        <input id="m-unbound-alert" type="number" min="1" max="120" step="1" value={draft.alert} disabled={!editable || saving} onChange={(event) => setDraft((old) => ({ ...old, alert: event.target.value }))} />
      </div>
      <div className="m-admin-row">
        <div><label htmlFor="m-unbound-fallback">自动兜底分配（分钟）</label><p>客服主管分配模式下，超过该时长按负载自动分配，主管事后可改派。须大于提醒时长。</p></div>
        <input id="m-unbound-fallback" type="number" min="2" max="1440" step="1" value={draft.fallback} disabled={!editable || saving} onChange={(event) => setDraft((old) => ({ ...old, fallback: event.target.value }))} />
      </div>
      <div className="m-admin-row">
        <div><label htmlFor="m-unbound-group">默认接收组</label><p>从未分组的新客户在自动分配或兜底时进入该组；主管手动调整过分组的客户不受影响。</p></div>
        <HDSelect id="m-unbound-group" value={draft.group} disabled={!editable || saving || groupsFailed} options={[{ value: "", label: "不设置" }, ...(groupsFailed && policy.defaultGroupId ? [{ value: String(policy.defaultGroupId), label: policy.defaultGroupName ?? `组 ${policy.defaultGroupId}` }] : groups.map((group) => ({ value: group.id, label: group.name })))]} onChange={(value) => setDraft((old) => ({ ...old, group: value }))} />
      </div>
      {groupsFailed && <div className="m-admin-error" role="alert">分组名单加载失败，暂时不能改默认接收组；当前设置保持不变。<button type="button" className="btn btn-sec btn-sm" onClick={() => { preserveDraft.current = true; setReload((n) => n + 1); }}>重试加载分组</button></div>}
      {!valid && <div className="m-admin-error" role="alert">提醒为 1–120 分钟，兜底须大于提醒且不超过 1440 分钟。</div>}
      {editable && changed && <label className="field"><span>修改理由（8–200 字）</span><textarea value={reason} maxLength={200} disabled={saving} onChange={(event) => setReason(event.target.value)} /></label>}
      <div className="m-admin-toolbar"><span className="m-admin-muted">当前版本 {policy.version}</span>{editable && <button type="button" className="btn btn-pri btn-sm" disabled={loading || !valid || !changed || !reasonOk || saving} onClick={save}>{saving ? "保存中…" : "保存"}</button>}</div>
    </>}
  </div>;
}
