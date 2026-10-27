"use client";

import { useEffect, useState } from "react";
import { displayAdminError } from "@/lib/admin/error-messages";
import { supportClient, isIndeterminateSupportError, readSupportPoolCustomer, type SupportAgentCandidate, type SupportBindingPoolItem } from "@/lib/admin/m-support-client";
import { Modal } from "../design-kit";
import { SupportAvatar, advisorAvatarPath } from "./support-avatar";

/** D-7: a routine first assignment gets a preset reason; it can still be edited. */
const FIRST_ASSIGNMENT_REASON = "新客户首次咨询分配";

/** Least load first: fewer bound customers, then fewer live sessions; busy advisors last. */
function byLoad(a: SupportAgentCandidate, b: SupportAgentCandidate): number {
  return Number(a.busy) - Number(b.busy) || a.assignedUserCount - b.assignedUserCount || (a.currentActiveSessions ?? 0) - (b.currentActiveSessions ?? 0);
}

/** M-13: assign a dedicated advisor from inside the conversation instead of the pool page. */
export function AssignAdvisorDialog({ customerId, customerName, onClose, onAssigned }: { customerId: string; customerName: string; onClose: () => void; onAssigned: (advisorName: string) => void }) {
  const [item, setItem] = useState<SupportBindingPoolItem | null>(null);
  const [agents, setAgents] = useState<SupportAgentCandidate[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [target, setTarget] = useState<number | null>(null);
  const [reason, setReason] = useState(FIRST_ASSIGNMENT_REASON);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // One key per attempt so a retry after an unknown result can never assign twice.
  const [commandKey, setCommandKey] = useState(() => `m3-assign-${crypto.randomUUID()}`);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(""); setItem(null); setAgents(null);
    void (async () => {
      const pool = await readSupportPoolCustomer(customerId);
      const groupId = pool.routeGroupId ? Number(pool.routeGroupId) : undefined;
      const page = await supportClient.agents({ pageNum: 1, pageSize: 100, groupId, signal: controller.signal });
      if (controller.signal.aborted) return;
      const eligible = page.records.filter((agent) => agent.assignmentEligible).sort(byLoad);
      setItem(pool); setAgents(eligible); setTarget(eligible[0]?.adminId ?? null);
    })().catch((cause: unknown) => { if (!controller.signal.aborted) setLoadError(cause instanceof Error && cause.message === "SUPPORT_RECOVERY_FACTS_UNAVAILABLE" ? "该客户已不在待分配池，可能已被分配。请刷新会话。" : displayAdminError(cause)); });
    return () => controller.abort();
  }, [customerId, retry]);

  const chosen = agents?.find((agent) => agent.adminId === target);
  const reasonOk = reason.trim().length >= 8 && reason.trim().length <= 200;

  async function assign() {
    if (!item || !chosen || !reasonOk || saving) return;
    setSaving(true); setError("");
    try {
      await supportClient.transfer({ targetAgentAdminId: chosen.adminId, customers: [{ id: customerId, expectedAssignmentId: null, expectedVersion: item.version }], reason: reason.trim() }, commandKey);
      onAssigned(chosen.name);
    } catch (cause) {
      if (isIndeterminateSupportError(cause)) setError("分配结果暂未确认。可以再点一次确认，不会重复分配。");
      else { setCommandKey(`m3-assign-${crypto.randomUUID()}`); setError(`分配未完成：${displayAdminError(cause)}`); }
    } finally { setSaving(false); }
  }

  return <Modal title={`分配专属客服 · ${customerName}`} icon="users" busy={saving} onClose={onClose} footer={<>
    <button type="button" className="l-btn sm" disabled={saving} onClick={onClose}>取消</button>
    <button type="button" className="l-btn sm primary" disabled={!chosen || !reasonOk || saving} onClick={() => void assign()}>{saving ? "分配中…" : chosen ? `分配给 ${chosen.name}` : "选择专属客服"}</button>
  </>}>
    {loadError ? <div className="itint danger" role="alert">{loadError} <button type="button" className="l-btn sm" onClick={() => setRetry((value) => value + 1)}>重试</button></div>
      : !agents ? <div className="itint" role="status">正在读取可分配的专属客服…</div>
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
