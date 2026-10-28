"use client";

import { useEffect, useState } from "react";
import { displayAdminError } from "@/lib/admin/error-messages";
import { supportUnboundPolicyClient, type SupportUnboundPolicy } from "@/lib/admin/m-support-client";
import { supportGroupClient, type SupportGroupDirectory } from "@/lib/admin/support-group-client";
import { HDSelect } from "./hd-ui";
import type { MSupportPermission } from "./m5-service-rules";

/** D-3 / M-18: how long an unassigned inquiry may wait, and which group receives customers no one routed. */
export function M5UnboundPolicy({ permission }: { permission: MSupportPermission }) {
  const [policy, setPolicy] = useState<SupportUnboundPolicy | null>(null);
  const [groups, setGroups] = useState<SupportGroupDirectory[]>([]);
  const [draft, setDraft] = useState({ alert: "", fallback: "", group: "" });
  const [reason, setReason] = useState("");
  const [error, setError] = useState(""), [saving, setSaving] = useState(false), [saved, setSaved] = useState(false), [reload, setReload] = useState(0);
  const editable = permission === "superadmin";

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    Promise.all([supportUnboundPolicyClient.read(controller.signal), supportGroupClient.groups(controller.signal).catch(() => [])]).then(([row, list]) => {
      setPolicy(row); setGroups(list.filter((group) => group.status === "ENABLED"));
      setDraft({ alert: String(row.alertMinutes), fallback: String(row.fallbackMinutes), group: row.defaultGroupId ? String(row.defaultGroupId) : "" });
    }).catch((cause) => { if (!controller.signal.aborted) setError(displayAdminError(cause)); });
    return () => controller.abort();
  }, [reload]);

  const alert = Number(draft.alert), fallback = Number(draft.fallback);
  const valid = Number.isInteger(alert) && Number.isInteger(fallback) && alert >= 1 && alert <= 120 && fallback > alert && fallback <= 1440;
  const changed = policy && (alert !== policy.alertMinutes || fallback !== policy.fallbackMinutes || (draft.group || null) !== (policy.defaultGroupId ? String(policy.defaultGroupId) : null));
  const reasonOk = reason.trim().length >= 8 && reason.trim().length <= 200;

  async function save() {
    if (!policy || !valid || !changed || !reasonOk || saving) return;
    setSaving(true); setError(""); setSaved(false);
    try {
      const row = await supportUnboundPolicyClient.update({ alertMinutes: alert, fallbackMinutes: fallback, defaultGroupId: draft.group ? Number(draft.group) : null, expectedVersion: policy.version, reason: reason.trim() });
      setPolicy(row); setReason(""); setSaved(true);
    } catch (cause) { setError(displayAdminError(cause)); }
    finally { setSaving(false); }
  }

  return <div className="m-admin-panel m5-unbound-policy">
    <h2>待分配客户</h2>
    <div className="m-admin-muted">没有专属客服的客户发来消息后：先提醒主管，等待过久则按负载自动分配；没有分组的新客户进入默认接收组。</div>
    {!editable && <div className="m-admin-muted">仅超级管理员可修改；当前为只读视图。</div>}
    {error && <div className="m-admin-error" role="alert">{error} <button type="button" className="btn btn-sec btn-sm" onClick={() => setReload((n) => n + 1)}>重新加载</button></div>}
    {!policy ? !error && <div className="m-admin-muted" role="status">正在加载…</div> : <>
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
        <HDSelect id="m-unbound-group" value={draft.group} disabled={!editable || saving} options={[{ value: "", label: "不设置" }, ...groups.map((group) => ({ value: group.id, label: group.name }))]} onChange={(value) => setDraft((old) => ({ ...old, group: value }))} />
      </div>
      {!valid && <div className="m-admin-error" role="alert">提醒为 1–120 分钟，兜底须大于提醒且不超过 1440 分钟。</div>}
      {editable && changed && <label className="field"><span>修改理由（8–200 字）</span><textarea value={reason} maxLength={200} disabled={saving} onChange={(event) => setReason(event.target.value)} /></label>}
      <div className="m-admin-toolbar"><span className="m-admin-muted">当前版本 {policy.version}{saved ? " · 已保存" : ""}</span>{editable && <button type="button" className="btn btn-pri btn-sm" disabled={!valid || !changed || !reasonOk || saving} onClick={() => void save()}>{saving ? "保存中…" : "保存"}</button>}</div>
    </>}
  </div>;
}
