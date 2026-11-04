"use client";

import { useEffect, useState } from "react";
import { displayAdminError } from "@/lib/admin/error-messages";
import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import { supportClient, verifySupportTransfer, isDefiniteSupportRefusal, SupportClientError, type SupportAgentCandidate, type SupportCustomerDetail } from "@/lib/admin/m-support-client";
import { supportGroupClient } from "@/lib/admin/support-group-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { Modal } from "../design-kit";
import { SupportAvatar, advisorAvatarPath } from "./support-avatar";
import "./m-support-workbench.css";

type TransferPayload = Parameters<typeof supportClient.transfer>[0];
type TransferRecord = { fingerprint: string; commandKey: string; createdAt: number; expiresAt: number; actorId: number; payload: TransferPayload; customerName?: string; fromName?: string; targetName?: string };
// Records from before this file existed have no names; the same storage key keeps them recoverable.
const transferCommands = createPendingMutationStore<TransferRecord>({ storageKey: "nexion-admin-m-transfer-v1", ttlMs: Math.floor(Number.MAX_SAFE_INTEGER / 2), retainExpiredRecords: true, isValidRecord: (row) => Boolean(Number.isSafeInteger(row.actorId) && row.payload && Array.isArray(row.payload.customers)) });
const actorStamp = () => { const auth = useAdminAuth.getState(); return adminShellSessionKey(auth.session, auth.authEpoch); };

async function allAgents(groupId: number | undefined, signal?: AbortSignal): Promise<SupportAgentCandidate[]> {
  const first = await supportClient.agents({ pageNum: 1, pageSize: 100, groupId, signal });
  const pages = [first];
  for (let pageNum = 2; (pageNum - 1) * 100 < first.total; pageNum++) pages.push(await supportClient.agents({ pageNum, pageSize: 100, groupId, signal }));
  return pages.flatMap((page) => page.records);
}
/**
 * Who may receive this customer. The super admin picks from everyone; a supervisor only inside the group of the customer's
 * current advisor, which is also what the server enforces. null = that advisor is in no group this supervisor manages.
 */
export async function readTransferTargets(agentAdminId: number, mode: "ALL" | "MANAGED", signal?: AbortSignal): Promise<SupportAgentCandidate[] | null> {
  if (mode === "ALL") return allAgents(undefined, signal);
  for (const group of await supportGroupClient.groups(signal)) {
    const members = await allAgents(Number(group.id), signal);
    if (members.some((agent) => agent.adminId === agentAdminId)) return members;
  }
  return null;
}

/** Unconfirmed transfers of this operator; each row reopens the dialog on the original command. */
export function TransferPendingNotes({ onOpen }: { onOpen: (customerId: string) => void }) {
  const adminId = useAdminAuth((state) => state.session?.adminId);
  return <>{transferCommands.list().filter((record) => record.actorId === adminId).map((record, index) => <p className="s5a-note" key={record.commandKey}>存在结果尚未确认的转绑。<button type="button" onClick={() => onOpen(record.payload.customers[0].id)}>查询转绑结果 {index + 1}</button></p>)}</>;
}

/** BUG-114 / BUG-040: 正式转绑 for one customer, for every role that may do it. Authorization stays on the server; this only shows what it allows. */
export function CustomerTransferDialog({ customerId, mode, onClose, onDone, onOpenOwn }: { customerId: string; mode: "ALL" | "MANAGED"; onClose: () => void; onDone: (notice: string) => void; onOpenOwn?: () => void }) {
  const adminId = useAdminAuth((state) => state.session?.adminId);
  const canWrite = useAdminAuth((state) => state.session?.role === "super" || state.session?.role === "superadmin" || Boolean(state.session?.authorities.includes("service_m1_write")));
  const [pending, setPending] = useState<TransferRecord | null>(() => transferCommands.list().find((row) => row.actorId === adminId && row.payload.customers.some((item) => item.id === customerId)) ?? null);
  const [detail, setDetail] = useState<SupportCustomerDetail | null>(null);
  const [targets, setTargets] = useState<SupportAgentCandidate[] | null>(null);
  const [denied, setDenied] = useState(""), [loadError, setLoadError] = useState(""), [reload, setReload] = useState(0);
  const [target, setTarget] = useState<number | null>(null), [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false), [error, setError] = useState(""), [notReceived, setNotReceived] = useState(false);

  useEffect(() => {
    if (pending) return;
    const controller = new AbortController();
    setDetail(null); setTargets(null); setDenied(""); setLoadError(""); setTarget(null);
    if (!canWrite) { setDenied("当前账号没有办理转绑的权限。"); return () => controller.abort(); }
    void (async () => {
      const current = await supportClient.customerDetail(customerId, controller.signal);
      const members = await readTransferTargets(current.agentAdminId, mode, controller.signal);
      if (controller.signal.aborted) return;
      setDetail(current);
      if (members === null) setDenied("该客户不在你负责的组内，不能正式转绑。");
      else if (!current.assignmentId) setDenied("该客户当前没有专属客服，请到「待分配」处理。");
      else setTargets(members.filter((agent) => agent.assignmentEligible === true && agent.adminId !== current.agentAdminId));
    })().catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof SupportClientError && [403, 404].includes(cause.status)) setDenied("当前无权办理该客户的转绑，归属可能已经变更。");
      else setLoadError(displayAdminError(cause));
    });
    return () => controller.abort();
  }, [customerId, mode, reload, pending, canWrite]);

  const chosen = targets?.find((agent) => agent.adminId === target);
  const trimmed = reason.trim();
  const reasonOk = trimmed.length >= 8 && trimmed.length <= 200;

  async function send(record: TransferRecord, replay = false) {
    const actor = actorStamp();
    let written = false;
    setSaving(true); setError(""); setNotReceived(false);
    try {
      await supportClient.transfer(record.payload, record.commandKey);
      written = true;
      if (actor !== actorStamp()) return;
      await verifySupportTransfer(record.payload, "SUCCEEDED");
      if (actor !== actorStamp()) return;
      transferCommands.forget(record.fingerprint, record.commandKey);
      window.dispatchEvent(new Event("support-todo-changed"));
      onDone(`已转给 ${record.targetName ?? "新的专属客服"}，并核对了最新归属。`);
    } catch (cause) {
      if (actor !== actorStamp()) return;
      if (written || !isDefiniteSupportRefusal(cause)) { setPending(record); setError("转绑结果尚未确认，原操作已保留。请查询原操作，不要另发新的转绑。"); }
      // A replay is refused by today's scope and version, which says nothing about the earlier attempt: only a first write's refusal releases the command.
      else if (replay) setError(`重试被拒绝：${displayAdminError(cause)} 这不能说明原转绑没有成功，原操作已保留，请再查询原操作。`);
      else {
        transferCommands.forget(record.fingerprint, record.commandKey);
        setPending(null); setError(`转绑没有成功：${displayAdminError(cause)}`); setReload((value) => value + 1);
      }
    } finally { setSaving(false); }
  }
  async function submit() {
    if (!detail?.assignmentId || !chosen || !reasonOk || !adminId || saving || pending) return;
    const payload: TransferPayload = { targetAgentAdminId: chosen.adminId, customers: [{ id: detail.customerId, expectedAssignmentId: detail.assignmentId, expectedVersion: detail.assignmentVersion }], reason: trimmed };
    const fingerprint = `bound-transfer:${detail.customerId}:${detail.assignmentId}:${detail.assignmentVersion}`, commandKey = crypto.randomUUID();
    transferCommands.remember(fingerprint, commandKey, { actorId: adminId, payload, customerName: detail.displayName || detail.customerNo, fromName: detail.agentName, targetName: chosen.name });
    if (!transferCommands.isDurablyStored(fingerprint, commandKey)) { transferCommands.forget(fingerprint, commandKey); setError("暂时无法保存这次操作，未提交转绑。请恢复浏览器存储后重试。"); return; }
    await send(transferCommands.list().find((row) => row.commandKey === commandKey)!);
  }
  async function check() {
    if (!pending || saving) return;
    const actor = actorStamp();
    setSaving(true); setError(""); setNotReceived(false);
    try {
      const result = await supportClient.command(pending.commandKey);
      if (actor !== actorStamp()) return;
      if (result.status === "FAILED") {
        // The receipt settles it. The binding may well have moved on, which is what a version conflict means, so the form reloads the latest one for a fresh confirmation.
        transferCommands.forget(pending.fingerprint, pending.commandKey);
        setPending(null); setReason(pending.payload.reason); setError("原转绑没有成功。下面是最新归属，请重新确认后提交。");
        return;
      }
      if (result.status !== "SUCCEEDED") { setError("原转绑仍在处理，请稍后再查询。"); return; }
      await verifySupportTransfer(pending.payload, "SUCCEEDED");
      if (actor !== actorStamp()) return;
      transferCommands.forget(pending.fingerprint, pending.commandKey);
      window.dispatchEvent(new Event("support-todo-changed"));
      onDone("原转绑已完成，并核对了最新归属。");
    } catch (cause) {
      if (actor !== actorStamp()) return;
      // Only this code means there is no receipt. A 404 from the scope re-check or the read-back says nothing about the write.
      if (cause instanceof SupportClientError && cause.status === 404 && cause.backendMessage === "SUPPORT_COMMAND_NOT_FOUND") { setNotReceived(true); setError("系统没有这次转绑的记录，可以按原操作重试；编号和内容都不会变。"); }
      else setError("结果暂时无法核对，原操作和客户范围已保留。");
    } finally { setSaving(false); }
  }

  const footer = pending
    ? <><button type="button" className="l-btn sm" disabled={saving} onClick={onClose}>稍后再查</button>{notReceived && <button type="button" className="l-btn sm" disabled={saving} onClick={() => void send(pending, true)}>按原操作重试</button>}<button type="button" className="l-btn sm primary" disabled={saving} onClick={() => void check()}>{saving ? "查询中…" : "查询原操作"}</button></>
    : <><button type="button" className="l-btn sm" disabled={saving} onClick={onClose}>返回</button>{onOpenOwn && denied && detail?.agentAdminId === adminId && <button type="button" className="l-btn sm" onClick={onOpenOwn}>查看我的客户资料</button>}{targets && <button type="button" className="l-btn sm primary" disabled={!chosen || !reasonOk || saving} onClick={() => void submit()}>{saving ? "提交中…" : "确认正式转绑"}</button>}</>;

  return <Modal title="正式转绑客户" icon="users" busy={saving} onClose={onClose} footer={footer}><div className="s5a-confirm s5a-transfer">
    {pending ? <>
      <p role="status">这次转绑的结果尚未确认，原操作已锁定，不能修改。</p>
      <dl><div><dt>客户</dt><dd>{pending.customerName ?? customerId}</dd></div><div><dt>变更</dt><dd>{pending.fromName ?? "原专属客服"} → {pending.targetName ?? `专属客服 ${pending.payload.targetAgentAdminId}`}</dd></div><div><dt>绑定版本</dt><dd>{pending.payload.customers[0].expectedVersion}</dd></div><div><dt>理由</dt><dd>{pending.payload.reason}</dd></div><div><dt>原操作编号</dt><dd>{pending.commandKey}</dd></div></dl>
    </> : denied ? <p role="alert">{denied}</p>
      : loadError ? <p role="alert">{loadError}<button type="button" className="l-btn sm" onClick={() => setReload((value) => value + 1)}>重新加载</button></p>
      : !detail || !targets ? <p role="status">正在加载客户归属和可接待的专属客服…</p>
      : <>
        <p>仅变更当前客户的专属客服；提交后原专属客服立即失去私聊与图片权限。</p>
        <dl><div><dt>客户</dt><dd>{detail.displayName || detail.customerNo || detail.customerId}</dd></div><div><dt>当前专属客服</dt><dd>{detail.agentName ?? "资料未知"}</dd></div><div><dt>绑定版本</dt><dd>{detail.assignmentVersion}</dd></div></dl>
        {targets.length === 0 ? <p className="s5a-note">暂无可接待的其他专属客服。请到「运营账号与权限」核对接待资格。</p> : <label>目标专属客服<select value={target ?? ""} disabled={saving} onChange={(event) => setTarget(Number(event.target.value) || null)}><option value="">请选择专属客服</option>{targets.map((agent) => <option key={agent.adminId} value={agent.adminId}>{agent.name}{agent.busy ? " · 忙碌" : ""}</option>)}</select></label>}
        {chosen && <p className="s5a-transfer-effect"><SupportAvatar name={chosen.name} path={chosen.avatarAssetId ? advisorAvatarPath(chosen.adminId) : undefined} version={chosen.avatarVersion} size={28} />将从 {detail.agentName ?? "当前专属客服"} 转给 {chosen.name}</p>}
        <label>转绑理由（8–200 字）<textarea value={reason} maxLength={200} disabled={saving} onChange={(event) => setReason(event.target.value)} /></label><small>{trimmed.length}/200 字</small>
      </>}
    {error && <p role="alert">{error}</p>}
  </div></Modal>;
}
