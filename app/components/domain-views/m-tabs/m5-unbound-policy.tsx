"use client";

import { useEffect, useRef, useState } from "react";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { supportUnboundPolicyClient, type SupportUnboundPolicy, type SupportUnboundPolicyUpdate } from "@/lib/admin/m-support-client";
import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";
import { useM5ManagementCommand, type M5ManagementRecord } from "@/lib/admin/use-m5-management-command";
import { isM5ManagementPayload } from "@/lib/admin/m5-management-record";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { supportGroupClient, type SupportGroupDirectory } from "@/lib/admin/support-group-client";
import { Timer, Save } from "lucide-react";
import { BlockState, Button, DiffList, Fact, Facts, Field, Modal, Notice, NumberInput, Panel, Select, StatusTag, Textarea } from "@/app/components/rd";
import { M5PendingWrites, type M5PolicySummary } from "./m5-views";
import type { MSupportPermission } from "./m5-service-rules";

const policyCommands = createPendingMutationStore<M5ManagementRecord<SupportUnboundPolicyUpdate, SupportUnboundPolicy>>({
  storageKey: "nexion-m5-unbound-policy-v1", retainExpiredRecords: true,
  isValidRecord: row => isM5ManagementPayload("policy", row.payload) && (row.before === undefined || isM5ManagementPayload("policy", row.before, true)),
});
const draftOf = (row: Pick<SupportUnboundPolicy, "alertMinutes" | "fallbackMinutes" | "defaultGroupId">) => ({
  alert: String(row.alertMinutes), fallback: String(row.fallbackMinutes), group: row.defaultGroupId == null ? "" : String(row.defaultGroupId),
});

/** D-3 / M-18: how long an unassigned inquiry may wait, and which group receives customers no one routed. */
export function M5UnboundPolicy({ permission, onSummary }: { permission: MSupportPermission; onSummary?: (summary: M5PolicySummary) => void }) {
  const session = useAdminAuth(state => state.session);
  const [policy, setPolicy] = useState<SupportUnboundPolicy | null>(null);
  const [groups, setGroups] = useState<SupportGroupDirectory[]>([]);
  const [draft, setDraft] = useState({ alert: "", fallback: "", group: "" });
  const [reason, setReason] = useState("");
  const [error, setError] = useState(""), [savedVersion, setSavedVersion] = useState<number>(), [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // BUG-122: a failed directory read is not an empty one; the saved group stays shown and stays the value saved.
  const [groupsFailed, setGroupsFailed] = useState(false);
  const preserveDraft = useRef(false);
  const awaitingSavedRead = useRef(false);
  const editable = permission === "superadmin" && Boolean(session?.authorities.includes("service_m1_write"));
  const command = useM5ManagementCommand<SupportUnboundPolicyUpdate, SupportUnboundPolicy, SupportUnboundPolicy>({
    store: policyCommands, legacySlot: `unbound-policy:${session?.adminId}`, fingerprint: () => `unbound-policy:${session?.adminId}`,
    canQuery: Boolean(session?.authorities.some(code => code === "service_m1_read" || code === "service_m3_read" || code === "service_m1_write")), canWrite: editable, requireMissingReceipt: true,
    write: supportUnboundPolicyClient.update,
    query: supportUnboundPolicyClient.command,
    onSuccess: () => {
      awaitingSavedRead.current = true;
      setSaved(true);
      setConfirming(false); setSavedVersion(undefined); setPolicy(null); setReason("");
      preserveDraft.current = false; setLoading(true); setReload(value => value + 1);
    },
    onRefusal: (_cause, recovered, payload) => {
      setDraft(draftOf(payload)); setReason(payload.reason);
      if (recovered) setConfirming(false);
      preserveDraft.current = true;
      setLoading(true); setReload(value => value + 1);
    },
  });
  const { busy: saving, pending } = command;
  const denied = pending?.denied === true;

  useEffect(() => {
    const controller = new AbortController();
    setError(""); setLoading(true);
    Promise.all([supportUnboundPolicyClient.read(controller.signal), supportGroupClient.groups(controller.signal).catch(() => null)]).then(([row, list]) => {
      if (controller.signal.aborted) return;
      setPolicy(row); setGroupsFailed(list === null); setGroups((list ?? []).filter((group) => group.status === "ENABLED"));
      if (awaitingSavedRead.current) { setSavedVersion(row.version); awaitingSavedRead.current = false; }
      if (!preserveDraft.current) setDraft(draftOf(row));
    }).catch((cause) => { if (!controller.signal.aborted) { setPolicy(null); setError(displayAdminReadError(cause)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  const alert = Number(draft.alert), fallback = Number(draft.fallback);
  const valid = Number.isInteger(alert) && Number.isInteger(fallback) && alert >= 1 && alert <= 120 && fallback > alert && fallback <= 1440;
  const savedGroup = policy?.defaultGroupId ? String(policy.defaultGroupId) : "";
  const changed = policy && (alert !== policy.alertMinutes || fallback !== policy.fallbackMinutes || draft.group !== savedGroup);
  // A choice cannot be checked without the directory, so it stays on screen and waits. A saved group that is unchanged does not hold up the durations.
  const groupBlocked = groupsFailed && draft.group !== savedGroup;
  const groupLabel = (id: string) => !id ? "不设置" : id === savedGroup ? policy?.defaultGroupName ?? `组编号 ${id}` : `组编号 ${id}`;
  const reasonOk = reason.trim().length >= 8 && reason.trim().length <= 200;

  function save() {
    if (!policy || !editable || !valid || !changed || !reasonOk || saving || loading || pending || groupBlocked) return;
    setSavedVersion(undefined);
    setSaved(false);
    void command.run("submit", { alertMinutes: alert, fallbackMinutes: fallback, defaultGroupId: draft.group ? Number(draft.group) : null, expectedVersion: policy.version, reason: reason.trim() }, policy);
  }

  useEffect(() => {
    onSummary?.({ state: policy ? "ready" : loading ? "loading" : "failed", alert: policy?.alertMinutes, fallback: policy?.fallbackMinutes, groupId: policy?.defaultGroupId ?? null, groupName: policy?.defaultGroupName ?? null, pending: Boolean(pending) });
  }, [onSummary, policy, loading, pending]);
  useEffect(() => { if (pending && !saving) setConfirming(false); }, [pending, saving]);
  // 只显示用：每个框自己的问题写在框下；能不能保存仍只看 valid（逻辑不变）。
  const alertProblem = draft.alert.trim() === "" || !Number.isInteger(alert) || alert < 1 || alert > 120 ? "要填 1–120 的整数" : "";
  const fallbackProblem = draft.fallback.trim() === "" || !Number.isInteger(fallback) || fallback > 1440 ? "要填不超过 1440 的整数" : !alertProblem && fallback <= alert ? `要比等待提醒（${alert} 分钟）长` : "";
  const groupName = (id: string | number | null | undefined) => id == null || id === "" ? "不设置" : groups.find((group) => String(group.id) === String(id))?.name ?? groupLabel(String(id));
  const diffRows = policy ? [
    { key: "alert", label: "等待提醒", before: `${policy.alertMinutes} 分钟`, after: `${draft.alert} 分钟` },
    { key: "fallback", label: "超时兜底", before: `${policy.fallbackMinutes} 分钟`, after: `${draft.fallback} 分钟` },
    { key: "group", label: "默认接收组", before: groupLabel(savedGroup), after: groupName(draft.group) },
  ].filter((row) => row.before !== row.after) : [];

  return <>
    {pending && <M5PendingWrites rows={[{
      key: pending.commandKey, name: "待分配设置", submittedAt: pending.createdAt, expired: !denied && Date.now() >= pending.expiresAt,
      change: denied ? "当前无权查看原内容" : `提醒 ${pending.payload.alertMinutes} 分钟 · 兜底 ${pending.payload.fallbackMinutes} 分钟 · 默认接收组 ${groupName(pending.payload.defaultGroupId)}`,
      actions: <>
        <Button size="sm" variant={command.canReplay ? "secondary" : "primary"} disabled={saving} onClick={() => void command.run("query")}>查询原操作</Button>
        <Button size="sm" variant={command.canReplay ? "primary" : "secondary"} disabled={saving || !command.canReplay} disabledReason={!saving && !command.canReplay ? "先查询原操作；查不到原结果、还在 24 小时内才能重试" : undefined} onClick={() => void command.run("replay")}>按原操作重试</Button>
      </>,
    }]} />}
    <Panel icon={Timer} tone="role-3" title="没人接的客户" sub={policy ? `第 ${policy.version} 版` : undefined}
      explain="客户发来消息后还没有专属客服时，按这里的时长提醒主管和自动兜底。保存后立即生效，正在等待的客户也按新时长算。">
      {!editable && <Notice tone="neutral">只有带客服管理修改权限的超级管理员能改。</Notice>}
      {pending && <Notice tone="warn" title="上次保存结果未知">
        <p>{saving ? "正在查询原操作…" : command.message || "先查询原操作；有结论前这里不能再改。"}</p>
        {!denied && <p className="m5-pending-reason">原理由：{pending.payload.reason}</p>}
      </Notice>}
      {editable && !pending && command.message && <Notice tone="warn">{command.message}</Notice>}
      {saved && <Notice tone="ok">{savedVersion !== undefined ? `已保存，现在是第 ${savedVersion} 版。` : "已保存。"}</Notice>}
      {error && <BlockState state="error" title="待分配设置加载失败" detail={`${error} 暂时不能查看和修改。`} onRetry={() => setReload((n) => n + 1)} />}
      {!policy ? !error && <BlockState state="loading" title="正在加载待分配设置…" /> : pending ? null : <div className="m5-form">
        <div className="m5-unbound-fields">
          <Field label="等待提醒" hint="1–120 分钟" error={alertProblem || undefined} explain="客户发消息后超过这么久还没分到客服，专属会话的待分配里标红提醒主管。">
            {(control) => <NumberInput {...control} id="m-unbound-alert" unit="分钟" min={1} max={120} step={1} value={draft.alert} disabled={!editable || saving} onChange={(event) => setDraft((old) => ({ ...old, alert: event.target.value }))} />}
          </Field>
          <Field label="超时兜底" hint="2–1440 分钟" error={fallbackProblem || undefined} explain="只在「客服主管分配」模式下用：等待超过这么久按负载自动分配，主管事后可以改派。">
            {(control) => <NumberInput {...control} id="m-unbound-fallback" unit="分钟" min={2} max={1440} step={1} value={draft.fallback} disabled={!editable || saving} onChange={(event) => setDraft((old) => ({ ...old, fallback: event.target.value }))} />}
          </Field>
          <Field label="默认接收组" explain="没有分组、也从没分过组的客户，自动分配或兜底时先进这个组。保存时只要求组启用着；分配时组里还要有负责人和能接的客服才分得进去。">
            {(control) => <Select {...control} id="m-unbound-group" aria-label="默认接收组" value={draft.group} disabled={!editable || saving || groupsFailed} onChange={(value) => setDraft((old) => ({ ...old, group: value }))}
              options={[{ value: "", label: "不设置" }, ...(groupsFailed ? [...new Set([savedGroup, draft.group])].filter(Boolean).map((id) => ({ value: id, label: groupLabel(id) })) : groups.map((group) => ({ value: String(group.id), label: group.name })))]} />}
          </Field>
        </div>
        {groupsFailed && <Notice tone="warn" action={<Button size="sm" onClick={() => { preserveDraft.current = true; setReload((n) => n + 1); }}>重新读取分组</Button>}>
          {groupBlocked ? `分组名单读不到，没法核对默认接收组。已保存：${groupLabel(savedGroup)}；要改成：${groupLabel(draft.group)}。名单读到后才能保存。` : "分组名单读不到，暂时不能改默认接收组；两个时长照常能改。"}
        </Notice>}
        {editable && <div className="rd-toolbar" data-end="">
          <span className="rd-toolbar-note">{changed ? `改了 ${diffRows.length} 项，还没保存` : "没有改动"}</span>
          <Button variant="primary" icon={<Save size={14} aria-hidden />} disabled={loading || !valid || !changed || saving || groupBlocked}
            disabledReason={!changed ? "还没有改动" : !valid ? "时长填得不对，先改正" : groupBlocked ? "分组名单读到后才能保存" : undefined}
            onClick={() => setConfirming(true)}>预览并保存</Button>
        </div>}
      </div>}
    </Panel>
    {confirming && policy && editable && (!pending || saving) && <Modal title={diffRows.length === 1 ? `修改${diffRows[0].label}` : "保存待分配设置"} icon={Timer} busy={saving} onClose={() => { if (!saving) setConfirming(false); }}
      sub={<><StatusTag tone="progress" filled>保存后立即生效</StatusTag><span className="m5-modal-id">第 {policy.version} 版</span></>}
      footer={<>
        <Button disabled={saving} onClick={() => setConfirming(false)}>返回</Button>
        <Button variant="primary" loading={saving} disabled={loading || !valid || !changed || !reasonOk || saving || groupBlocked} disabledReason={!saving && !reasonOk ? "操作理由要 8–200 字" : undefined} onClick={save}>确认保存</Button>
      </>}>
      <DiffList rows={diffRows} />
      {!saving && command.message && <Notice tone="warn">{command.message}</Notice>}
      <Facts>
        <Fact k="影响谁">之后的分配和兜底，也包括正在等待的客户</Fact>
        <Fact k="不变的">已经有专属客服的客户；主管调过组的客户</Fact>
      </Facts>
      <Field label="操作理由" required hint="8–200 字">
        {(control) => <Textarea {...control} rows={3} value={reason} maxLength={200} disabled={saving} count={`${reason.trim().length}/200`} placeholder="例如：晚班人手少，兜底时长放宽到 30 分钟" onChange={(event) => setReason(event.target.value)} />}
      </Field>
    </Modal>}
  </>;
}
