"use client";

import { useEffect, useState } from "react";
import { displayAdminError } from "@/lib/admin/error-messages";
import { supportClient, readFirstAssignmentCommand, readSupportPoolCustomer, type SupportAgentCandidate, type SupportBindingPoolItem } from "@/lib/admin/m-support-client";
import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";
import { useSupportManagementCommand, type SupportIntent } from "@/lib/admin/use-support-management-command";
import { Modal } from "../design-kit";
import { SupportAvatar, advisorAvatarPath } from "./support-avatar";

/** D-7: a routine first assignment gets a preset reason; it can still be edited. */
const FIRST_ASSIGNMENT_REASON = "新客户首次咨询分配";
type Assignment = { targetName: string; request: Parameters<typeof supportClient.transfer>[0] };
const assignmentCommands = createPendingMutationStore<SupportIntent<Assignment>>({
  storageKey: "nexion-m3-first-assignment-v1", retainExpiredRecords: true,
  isValidRecord: row => typeof row.payload?.targetName === "string" && row.payload.request?.customers?.length === 1,
});
const assignmentSlot = (adminId: number, customerId: string) => `first-assignment:${adminId}:${customerId}`;
export const hasPendingFirstAssignment = (adminId: number, customerId: string) => Boolean(assignmentCommands.get(assignmentSlot(adminId, customerId)));

/** Least load first: fewer bound customers, then fewer live sessions; busy advisors last. */
function byLoad(a: SupportAgentCandidate, b: SupportAgentCandidate): number {
  return Number(a.busy) - Number(b.busy) || a.assignedUserCount - b.assignedUserCount || (a.currentActiveSessions ?? 0) - (b.currentActiveSessions ?? 0);
}

/** M-13: assign a dedicated advisor from inside the conversation instead of the pool page. */
export function AssignAdvisorDialog({ adminId, customerId, customerName, canWrite, onClose, onAssigned }: { adminId: number; customerId: string; customerName: string; canWrite: boolean; onClose: () => void; onAssigned: (advisorName: string) => void }) {
  const [item, setItem] = useState<SupportBindingPoolItem | null>(null);
  const [agents, setAgents] = useState<SupportAgentCandidate[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [target, setTarget] = useState<number | null>(null);
  const [reason, setReason] = useState(FIRST_ASSIGNMENT_REASON);
  const command = useSupportManagementCommand({
    store: assignmentCommands, slot: assignmentSlot(adminId, customerId), canQuery: true, canWrite,
    write: async ({ request }, key) => (await supportClient.transfer(request, key)).assignments[0].assignmentId,
    query: (key, { request }) => readFirstAssignmentCommand(key, customerId, request.targetAgentAdminId),
    onSuccess: (_, payload) => onAssigned(payload.targetName),
    onFailure: ({ request }) => { setTarget(request.targetAgentAdminId); setReason(request.reason); setRetry(value => value + 1); },
  });
  const { busy: saving, pending, message: error } = command;

  useEffect(() => {
    if (pending || !canWrite) return;
    const controller = new AbortController();
    setLoadError(""); setItem(null); setAgents(null);
    void (async () => {
      const pool = await readSupportPoolCustomer(customerId);
      const groupId = pool.routeGroupId ? Number(pool.routeGroupId) : undefined;
      const page = await supportClient.agents({ pageNum: 1, pageSize: 100, groupId, signal: controller.signal });
      if (controller.signal.aborted) return;
      const eligible = page.records.filter((agent) => agent.assignmentEligible).sort(byLoad);
      setItem(pool); setAgents(eligible); setTarget(previous => eligible.some(agent => agent.adminId === previous) ? previous : eligible[0]?.adminId ?? null);
    })().catch((cause: unknown) => { if (!controller.signal.aborted) setLoadError(cause instanceof Error && cause.message === "SUPPORT_RECOVERY_FACTS_UNAVAILABLE" ? "该客户已不在待分配池，可能已被分配。请刷新会话。" : displayAdminError(cause)); });
    return () => controller.abort();
  }, [customerId, retry, pending, canWrite]);

  const chosen = agents?.find((agent) => agent.adminId === target);
  const reasonOk = reason.trim().length >= 8 && reason.trim().length <= 200;

  function assign() {
    if (!item || !chosen || !reasonOk || saving || !canWrite) return;
    void command.run("submit", { targetName: chosen.name, request: {
      targetAgentAdminId: chosen.adminId, customers: [{ id: customerId, expectedAssignmentId: null, expectedVersion: item.version }], reason: reason.trim(),
    } });
  }

  if (pending) return <Modal title={`核对上次分配 · ${customerName}`} icon="users" busy={saving} onClose={onClose} footer={<>
    <button type="button" className="l-btn sm" disabled={saving} onClick={onClose}>关闭</button>
    <button type="button" className={command.canReplay ? "l-btn sm" : "l-btn sm primary"} disabled={saving} onClick={() => void command.run("query")}>查询原操作</button>
    {canWrite && <button type="button" className={command.canReplay ? "l-btn sm primary" : "l-btn sm"} style={command.canReplay ? undefined : { opacity: .5, cursor: "not-allowed" }} disabled={saving || !command.canReplay} onClick={() => void command.run("replay")}>按原操作重试</button>}
  </>}>
    <div className="itint" role="status">{saving ? "正在核对原操作…" : error || "上次分配结果待确认，请先查询原操作。"}</div>
    {!command.denied && <>
      <p>原分配目标客服：{pending.payload.targetName} · 客服编号 {pending.payload.request.targetAgentAdminId}</p>
      <p>客户编号 {customerId} · 原待分配版本 {pending.payload.request.customers[0].expectedVersion}</p>
      <label className="field"><span>原分配原因</span><textarea value={pending.payload.request.reason} readOnly /></label>
      <p className="m-admin-muted">原操作编号 {pending.commandKey}</p>
    </>}
  </Modal>;

  return <Modal title={`分配专属客服 · ${customerName}`} icon="users" busy={saving} onClose={onClose} footer={<>
    <button type="button" className="l-btn sm" disabled={saving} onClick={onClose}>取消</button>
    <button type="button" className="l-btn sm primary" disabled={!canWrite || !chosen || !reasonOk || saving} onClick={assign}>{saving ? "分配中…" : chosen ? `分配给 ${chosen.name}` : "选择专属客服"}</button>
  </>}>
    {loadError ? <div className="itint danger" role="alert">{loadError} <button type="button" className="l-btn sm" onClick={() => setRetry((value) => value + 1)}>重试</button></div>
      : !agents ? <div className="itint" role="status">正在加载可分配的专属客服…</div>
      : agents.length === 0 ? <div className="itint warn">该客户所在组暂无可接待的专属客服。请先在「客服资格」里启用接待资格，或调整客户分组。</div>
      : <div className="m3-assign-list" role="radiogroup" aria-label="选择专属客服">
        {agents.map((agent, index) => <label key={agent.adminId} className={`m3-assign-card${target === agent.adminId ? " on" : ""}`}>
          <input type="radio" name="m3-assign-target" checked={target === agent.adminId} disabled={saving} onChange={() => setTarget(agent.adminId)} />
          <SupportAvatar name={agent.name} path={agent.avatarAssetId ? advisorAvatarPath(agent.adminId) : undefined} version={agent.avatarVersion} size={32} />
          <span className="m3-assign-name"><strong>{agent.name}</strong>{index === 0 && <span className="m3-assign-tag">推荐</span>}{agent.busy && <span className="m3-assign-busy">忙碌</span>}</span>
          <span className="m3-assign-load">绑定客户 {agent.assignedUserCount}{agent.currentActiveSessions !== undefined ? ` · 进行中会话 ${agent.currentActiveSessions}` : ""}</span>
        </label>)}
      </div>}
    <label className="field" style={{ marginTop: 12 }}><span>分配原因（已预填，可修改）</span><textarea value={reason} maxLength={200} disabled={saving} onChange={(event) => setReason(event.target.value)} /></label>
    {!reasonOk && <div className="m-admin-muted">原因需 8–200 字。</div>}
    {error && <div className="itint danger" role="alert">{error}</div>}
  </Modal>;
}
