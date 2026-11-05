"use client";

import { useEffect, useState } from "react";
import { displayAdminError } from "@/lib/admin/error-messages";
import { supportClient, readFirstAssignmentCommand, readSupportPoolCustomer, type SupportAgentCandidate, type SupportBindingPoolItem } from "@/lib/admin/m-support-client";
import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";
import { useSupportManagementCommand, type SupportIntent } from "@/lib/admin/use-support-management-command";
import { Button, Fact, Facts, Field, Notice, StatusTag, Textarea } from "@/app/components/rd";
import { visibleReasonLength } from "@/lib/admin/a2-client";
import { useReasonRule } from "@/lib/admin/use-reason-rule";
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
  const rule = useReasonRule(canWrite && !pending);
  const reasonOk = rule.ok(reason);

  function assign() {
    if (!item || !chosen || !reasonOk || saving || !canWrite) return;
    void command.run("submit", { targetName: chosen.name, request: {
      targetAgentAdminId: chosen.adminId, customers: [{ id: customerId, expectedAssignmentId: null, expectedVersion: item.version }], reason: reason.trim(),
    } });
  }

  if (pending) return <Modal title="核对上次分配" icon="users" busy={saving} onClose={onClose} footer={<>
    <Button disabled={saving} onClick={onClose}>关闭</Button>
    <Button variant={command.canReplay ? "secondary" : "primary"} disabled={saving} onClick={() => void command.run("query")}>查询原操作</Button>
    {canWrite && <Button variant={command.canReplay ? "primary" : "secondary"} disabled={saving} disabledReason={command.canReplay ? undefined : "先查询原操作，查不到才能按原操作重试"} onClick={() => void command.run("replay")}>按原操作重试</Button>}
  </>}>
    <div className="m3s-assign">
      <Notice tone="warn">{saving ? "正在核对原操作…" : error || "上次分配结果待确认，请先查询原操作。"}</Notice>
      {!command.denied && <Facts>
        <Fact k="客户">{customerName}</Fact>
        <Fact k="原分配目标客服">{pending.payload.targetName} · 客服编号 {pending.payload.request.targetAgentAdminId}</Fact>
        <Fact k="客户编号">{customerId}</Fact>
        <Fact k="原待分配版本">{pending.payload.request.customers[0].expectedVersion}</Fact>
        <Fact k="原分配原因">{pending.payload.request.reason}</Fact>
        <Fact k="原操作编号"><span data-mono="">{pending.commandKey}</span></Fact>
      </Facts>}
    </div>
  </Modal>;

  return <Modal title="分配专属客服" icon="users" sub={<StatusTag tone="progress" filled>立即生效</StatusTag>} busy={saving} onClose={onClose} footer={<>
    <Button disabled={saving} onClick={onClose}>取消</Button>
    <Button variant="primary" loading={saving} loadingText="分配中…" disabled={!canWrite || !chosen || !reasonOk} onClick={assign}>{chosen ? `分配给 ${chosen.name}` : "选择专属客服"}</Button>
  </>}>
    <div className="m3s-assign">
      <Facts><Fact k="客户">{customerName}</Fact></Facts>
      {loadError ? <Notice tone="danger" action={<Button size="sm" onClick={() => setRetry((value) => value + 1)}>重试</Button>}>{loadError}</Notice>
        : !agents ? <p className="m3s-aux" role="status">正在加载可分配的专属客服…</p>
        : agents.length === 0 ? <Notice tone="warn">该客户所在组暂无可接待的专属客服。请先在「客服资格」里启用接待资格，或调整客户分组。</Notice>
        : <div className="m3-assign-list" role="radiogroup" aria-label="选择专属客服">
          {agents.map((agent, index) => <label key={agent.adminId} className={`m3-assign-card${target === agent.adminId ? " on" : ""}`}>
            <input type="radio" name="m3-assign-target" checked={target === agent.adminId} disabled={saving} onChange={() => setTarget(agent.adminId)} />
            <SupportAvatar name={agent.name} path={agent.avatarAssetId ? advisorAvatarPath(agent.adminId) : undefined} version={agent.avatarVersion} size={32} />
            <span className="m3-assign-name"><strong>{agent.name}</strong>{index === 0 && <span className="m3-assign-tag">推荐</span>}{agent.busy && <span className="m3-assign-busy">忙碌</span>}</span>
            <span className="m3-assign-load">绑定客户 {agent.assignedUserCount}{agent.currentActiveSessions !== undefined ? ` · 进行中会话 ${agent.currentActiveSessions}` : ""}</span>
          </label>)}
        </div>}
      {Boolean(agents?.length) && <Field label="分配原因" required hint="已预填，可修改" explain="这位客户归所选专属客服。之后要换人走「正式转绑客户」。" error={reasonOk || !(rule.ready || rule.error) ? undefined : rule.error || `原因需 ${rule.min}–${rule.max} 字。`}>{(control) => <Textarea {...control} value={reason} maxLength={200} count={`${visibleReasonLength(reason)}/${rule.max}`} disabled={saving} onChange={(event) => setReason(event.target.value)} />}</Field>}
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  </Modal>;
}
