"use client";
import { m1CustomerCode } from "./m1-customer-code";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { explicitRejectionCode } from "@/lib/admin/explicit-rejection";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { M_RECOVERY, M_RECOVERY_INTRO, M_RELEASED_TEXT, M_SUBMITTING_VIEW, mNoticeTone, mQueryFailedText, mRecoveryView, mRejectedReason, mUnknownText } from "@/lib/admin/m-recovery-copy";
import { createPendingMutationStore, createPendingRecovery } from "@/lib/admin/pending-mutation-store";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import { supportClient, verifySupportTransfer, isDefiniteSupportRefusal, SupportClientError, type SupportAgentCandidate, type SupportCustomerDetail } from "@/lib/admin/m-support-client";
import { supportGroupClient } from "@/lib/admin/support-group-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { Modal, usePendingReplayDeadline, useToast } from "../design-kit";
import { BlockState, Button, Change, Fact, Facts, Field, Fold, Notice, Select, StatusTag, Textarea } from "@/app/components/rd";
import { SearchCheck } from "lucide-react";
import { RecoveryPanel, pendingReplayReason, recoveryTitle, type RecoveryItem } from "../recovery-panel";
import { MAuditLink, mFocusTarget, MReleaseModal } from "./m-release";
import { SupportAvatar, advisorAvatarPath } from "./support-avatar";
import { useMOperationReason } from "./m-operation-reason";
import "./m-support-workbench.css";

type TransferPayload = Parameters<typeof supportClient.transfer>[0];
type TransferRecord = { fingerprint: string; commandKey: string; createdAt: number; expiresAt: number; actorId: number; payload: TransferPayload; customerName?: string; fromName?: string; targetName?: string };
// Records from before this file existed have no names; the same storage key keeps them recoverable.
export const transferCommands = createPendingMutationStore<TransferRecord>({ storageKey: "nexion-admin-m-transfer-v1", retainExpiredRecords: true, isValidRecord: (row) => Boolean(Number.isSafeInteger(row.actorId) && row.payload && Array.isArray(row.payload.customers)) });
const actorStamp = () => { const auth = useAdminAuth.getState(); return adminShellSessionKey(auth.session, auth.authEpoch); };

function transferActor(actorId?: number) {
  const auth = useAdminAuth.getState();
  const session = auth.session;
  return auth.isAuthenticated && !auth.logoutPending && !auth.logoutUnknown && session?.adminId === actorId
    && !session?.passwordChangeRequired ? session : null;
}

export const transferRecovery = createPendingRecovery(transferCommands, {
  capability: () => "receipt",
  canReplay: record => {
    const session = transferActor(record.actorId);
    return Boolean(session?.authorities.includes("service_m1_read") && session.authorities.includes("service_m1_write"));
  },
  explicitRejectionCode,
});

const transferNotes = new Map<string, string>();
const submittingTransfers = new Set<string>();
const noteSubscribers = new Set<() => void>();
let noteRevision = 0;
const noteSnapshot = () => noteRevision;
const subscribeToNotes = (listener: () => void) => {
  noteSubscribers.add(listener);
  return () => { noteSubscribers.delete(listener); };
};
function updateTransferNote(commandKey: string, note = "", submitting = false) {
  if (note) transferNotes.set(commandKey, note);
  else transferNotes.delete(commandKey);
  if (submitting) submittingTransfers.add(commandKey);
  else submittingTransfers.delete(commandKey);
  noteRevision++;
  for (const listener of noteSubscribers) listener();
}
function transferView(record: TransferRecord) {
  return submittingTransfers.has(record.commandKey) ? M_SUBMITTING_VIEW
    : mRecoveryView(transferRecovery.state(record), { last: transferNotes.get(record.commandKey) });
}

function transferReturnFocus(opener: HTMLElement | null, customerId: string) {
  const customer = Array.from(document.querySelectorAll<HTMLElement>("[data-transfer-customer]")).find(node => node.dataset.transferCustomer === customerId);
  return mFocusTarget(opener, customer, document.querySelector<HTMLElement>('.mdom [role="tab"][aria-selected="true"]'));
}

/** Call only after the operator verifies the original result. No API request is made. */
export function releaseRejectedTransfer(record: TransferRecord) {
  if (!transferActor(record.actorId)?.authorities.includes("service_m1_read") || !transferRecovery.releaseRejectedReplay(record)) return false;
  updateTransferNote(record.commandKey);
  window.dispatchEvent(new Event("m1-pending-changed"));
  return true;
}

/** 「核实后解除」：面板的行和原框用同一个框。 */
function TransferRelease({ record, onCancel, onReleased, returnFocus }: { record: TransferRecord; onCancel: () => void; onReleased: () => void; returnFocus: () => HTMLElement | null }) {
  const [, toast] = useToast();
  return <MReleaseModal returnFocus={returnFocus} target={{ action: <>正式转绑，<Change from={record.fromName ?? "原专属客服"} to={record.targetName ?? `专属客服 ${record.payload.targetAgentAdminId}`} /></>,
    object: record.customerName ?? m1CustomerCode(record.payload.customers[0].id), createdAt: record.createdAt, rejection: transferRecovery.state(record).replayRejection }}
    where="被拒说明不了原转绑有没有生效，先核实，也看客户现在归哪位专属客服。" onCancel={onCancel} onConfirm={() => {
      const released = releaseRejectedTransfer(record);
      toast(released ? M_RELEASED_TEXT : "这条记录刚有变化，没有解除，请看最新状态。", released ? "success" : "warn");
      if (released) onReleased(); else onCancel();
    }} />;
}

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
  const canQuery = useAdminAuth(state => Boolean(state.session?.authorities.includes("service_m1_read")));
  const [releasing, setReleasing] = useState<TransferRecord | null>(null);
  const releaseOpener = useRef<HTMLElement | null>(null);
  useSyncExternalStore(transferRecovery.subscribe, transferRecovery.getRevision, () => 0);
  useSyncExternalStore(subscribeToNotes, noteSnapshot, () => 0);
  const records = transferCommands.list().filter(record => record.actorId === adminId);
  usePendingReplayDeadline(records.reduce<number | undefined>((first, row) =>
    !transferRecovery.state(row).expired && (first === undefined || row.expiresAt < first) ? row.expiresAt : first, undefined));
  const items: RecoveryItem[] = records.map((record) => {
    const state = transferRecovery.state(record), view = transferView(record);
    const submitting = submittingTransfers.has(record.commandKey);
    return { key: record.commandKey, createdAt: record.createdAt,
      object: `正式转绑 · ${record.customerName ?? m1CustomerCode(record.payload.customers[0].id)}`,
      tag: <StatusTag tone={view.tone}>{view.label}</StatusTag>,
      line: view.line,
      actions: !submitting && <>
        <Button type="button" size="sm" icon={<SearchCheck size={14} aria-hidden />} data-transfer-customer={record.payload.customers[0].id} onClick={() => onOpen(record.payload.customers[0].id)}>查询原结果</Button>
        {state.replayRejection && canQuery && <Button type="button" size="sm" variant="ghost" disabled={Boolean(state.busy)} onClick={event => { releaseOpener.current = event.currentTarget; setReleasing(record); }}>核实后解除</Button>}
      </>,
      detail: <>
        <p>{record.fromName ?? "原专属客服"} → {record.targetName ?? "目标专属客服"}；原理由已保留。</p>
        {(state.replayRejection || state.expired) && <p><MAuditLink /></p>}
      </> };
  });
  const submitting = records.filter(record => submittingTransfers.has(record.commandKey)).length;
  const title = [recoveryTitle(items.length - submitting), submitting ? "提交中…" : ""].filter(Boolean).join("，");
  return <>
    <RecoveryPanel title={title} explainLabel="结果未知怎么处理" explain={<><p>{M_RECOVERY_INTRO}</p><p>有结论前这位客户不能再转绑。</p></>} items={items} />
    {releasing && <TransferRelease record={releasing} returnFocus={() => transferReturnFocus(releaseOpener.current, releasing.payload.customers[0].id)} onCancel={() => setReleasing(null)} onReleased={() => setReleasing(null)} />}
  </>;
}

/** BUG-114 / BUG-040: 正式转绑 for one customer, for every role that may do it. Authorization stays on the server; this only shows what it allows. */
export function CustomerTransferDialog({ customerId, mode, onClose, onDone, onOpenOwn }: { customerId: string; mode: "ALL" | "MANAGED"; onClose: () => void; onDone: (notice: string) => void; onOpenOwn?: () => void }) {
  const adminId = useAdminAuth((state) => state.session?.adminId);
  const canWrite = useAdminAuth(state => Boolean(state.session?.authorities.includes("service_m1_write")));
  const canQuery = useAdminAuth(state => Boolean(state.session?.authorities.includes("service_m1_read")));
  const [pending, setPending] = useState<TransferRecord | null>(() => transferCommands.list().find((row) => row.actorId === adminId && row.payload.customers.some((item) => item.id === customerId)) ?? null);
  const [detail, setDetail] = useState<SupportCustomerDetail | null>(null);
  const [targets, setTargets] = useState<SupportAgentCandidate[] | null>(null);
  const [denied, setDenied] = useState(""), [loadError, setLoadError] = useState(""), [reload, setReload] = useState(0);
  const [target, setTarget] = useState<number | null>(null), [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false), [error, setError] = useState(""), [releasing, setReleasing] = useState(false);
  const recoveryRevision = useSyncExternalStore(transferRecovery.subscribe, transferRecovery.getRevision, () => 0);
  const [opener] = useState(() => typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const returnFocus = () => transferReturnFocus(opener, customerId);
  useSyncExternalStore(subscribeToNotes, noteSnapshot, () => 0);
  const recoveryState = pending ? transferRecovery.state(pending) : undefined;
  usePendingReplayDeadline(pending?.expiresAt);
  useEffect(() => {
    if (pending && transferRecovery.state(pending).replayBlock === "missing") onClose();
  }, [pending, recoveryRevision, onClose]);

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
      else setTargets(members.filter((agent) => agent.assignmentEligible === true && !agent.busy && agent.adminId !== current.agentAdminId));
    })().catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof SupportClientError && [403, 404].includes(cause.status)) setDenied("当前无权办理该客户的转绑，归属可能已经变更。");
      else setLoadError(displayAdminError(cause));
    });
    return () => controller.abort();
  }, [customerId, mode, reload, pending, canWrite]);

  useEffect(() => { window.dispatchEvent(new Event("m1-pending-changed")); }, [pending]);
  const chosen = targets?.find((agent) => agent.adminId === target);
  const trimmed = reason.trim();
  const reasonRule = useMOperationReason(canWrite && !pending && Boolean(detail && targets), reason);

  async function send(record: TransferRecord, replay = false) {
    if (!transferActor(record.actorId)?.authorities.includes("service_m1_write")
      || replay && transferRecovery.state(record).replayBlock) return;
    const actor = actorStamp();
    let written = false;
    setSaving(true); setError("");
    updateTransferNote(record.commandKey, "", !replay);
    try {
      if (replay) await transferRecovery.replay(record, saved => supportClient.transfer(saved.payload, saved.commandKey));
      else await supportClient.transfer(record.payload, record.commandKey);
      written = true;
      if (actor !== actorStamp()) return;
      await verifySupportTransfer(record.payload, "SUCCEEDED");
      if (actor !== actorStamp()) return;
      transferRecovery.settleAcknowledged(record);
      updateTransferNote(record.commandKey);
      window.dispatchEvent(new Event("support-todo-changed"));
      onDone(`已转给 ${record.targetName ?? "新的专属客服"}，并核对了最新归属。`);
    } catch (cause) {
      if (actor !== actorStamp()) { updateTransferNote(record.commandKey); return; }
      if (replay || written || !isDefiniteSupportRefusal(cause)) {
        setPending(record);
        updateTransferNote(record.commandKey, transferRecovery.state(record).replayRejection ? mRejectedReason(displayAdminError(cause)) : mUnknownText(displayAdminError(cause)));
      } else {
        transferCommands.forget(record.fingerprint, record.commandKey);
        updateTransferNote(record.commandKey);
        setPending(null); setError(`转绑没有成功：${displayAdminError(cause)}`); setReload((value) => value + 1);
      }
    } finally {
      if (submittingTransfers.has(record.commandKey)) updateTransferNote(record.commandKey);
      setSaving(false);
    }
  }
  async function submit() {
    if (!detail?.assignmentId || !chosen || !reasonRule.ok || !adminId || saving || pending
      || !transferActor(adminId)?.authorities.includes("service_m1_write")
      || transferCommands.list().some(row => row.payload.customers.some(item => item.id === customerId))) return;
    const payload: TransferPayload = { targetAgentAdminId: chosen.adminId, customers: [{ id: detail.customerId, expectedAssignmentId: detail.assignmentId, expectedVersion: detail.assignmentVersion }], reason: trimmed };
    const fingerprint = `bound-transfer:${detail.customerId}:${detail.assignmentId}:${detail.assignmentVersion}`, commandKey = crypto.randomUUID();
    transferCommands.remember(fingerprint, commandKey, { actorId: adminId, payload, customerName: detail.displayName || detail.customerNo, fromName: detail.agentName, targetName: chosen.name });
    if (!transferCommands.isDurablyStored(fingerprint, commandKey)) { transferCommands.forget(fingerprint, commandKey); setError("浏览器存不下这次操作，没有提交转绑；请允许浏览器保存网站数据后重试。"); return; }
    await send(transferCommands.list().find((row) => row.commandKey === commandKey)!);
  }
  async function check() {
    if (!pending || saving || !canQuery || !transferActor(pending.actorId)) return;
    const actor = actorStamp();
    setSaving(true); setError("");
    updateTransferNote(pending.commandKey);
    try {
      const result = await transferRecovery.query(pending, async saved => {
        try {
          const receipt = await supportClient.command(saved.commandKey);
          if (receipt.status === "SUCCEEDED") {
            await verifySupportTransfer(saved.payload, "SUCCEEDED");
            return { conclusion: "succeeded" };
          }
          return { conclusion: "unknown" };
        } catch (cause) {
          if (cause instanceof SupportClientError && cause.status === 404 && cause.backendMessage === "SUPPORT_COMMAND_NOT_FOUND") return { conclusion: "not-found" };
          throw cause;
        }
      });
      if (actor !== actorStamp() || !result) return;
      if (result.conclusion === "succeeded" && transferRecovery.settleFromQuery(pending, "succeeded")) {
        updateTransferNote(pending.commandKey);
        window.dispatchEvent(new Event("support-todo-changed"));
        onDone("原转绑已完成，并核对了最新归属。");
      } else if (result.conclusion === "not-found") {
        const state = transferRecovery.state(pending);
        updateTransferNote(pending.commandKey, state.expired || state.replayRejection ? M_RECOVERY.notFoundShort : "");
      } else updateTransferNote(pending.commandKey, M_RECOVERY.unsettled);
    } catch (cause) {
      if (actor === actorStamp()) updateTransferNote(pending.commandKey, mQueryFailedText(displayAdminReadError(cause)));
    } finally { setSaving(false); }
  }

  const querying = recoveryState?.busy === "query";
  const view = pending && transferView(pending);
  const footer = pending && recoveryState
    ? <><Button type="button" disabled={saving} onClick={onClose}>取消</Button>
      <Button type="button" variant={recoveryState.replayBlock && !recoveryState.replayRejection ? "primary" : "secondary"} loading={querying} loadingText="查询中…" disabled={saving} disabledReason={canQuery ? undefined : "当前账号没有客服工作台查看权限"} onClick={() => void check()}>查询原结果</Button>
      {recoveryState.replayRejection ? canQuery && <Button type="button" disabled={saving} onClick={() => setReleasing(true)}>核实后解除</Button>
        : <Button type="button" variant={recoveryState.replayBlock ? "secondary" : "primary"} loading={recoveryState.busy === "replay"} loadingText="提交中…" disabled={saving} disabledReason={saving ? undefined : pendingReplayReason(recoveryState, "当前账号没有办理转绑的权限，不能重试。")} onClick={() => void send(pending, true)}>按原请求重试</Button>}</>
    : <><Button type="button" disabled={saving} onClick={onClose}>取消</Button>{onOpenOwn && denied && detail?.agentAdminId === adminId && <Button type="button" onClick={onOpenOwn}>查看我的客户资料</Button>}{targets && <Button type="button" variant="primary" disabled={saving} loading={saving} loadingText="提交中…" disabledReason={!chosen ? "请选择目标专属客服" : reasonRule.blocked} onClick={() => void submit()}>确认正式转绑</Button>}</>;

  if (releasing && pending) return <TransferRelease record={pending} returnFocus={returnFocus} onCancel={() => setReleasing(false)} onReleased={() => setReleasing(false)} />;
  return <Modal title="正式转绑客户" icon="users" busy={saving} returnFocus={returnFocus} onClose={onClose} footer={footer}><div className="m1-transfer-form">
    {pending ? <>
      {view && <Notice tone={mNoticeTone(view)} title={view.label} actionBelow action={recoveryState?.replayRejection || recoveryState?.expired ? <MAuditLink /> : undefined}><p>{view.line}</p><p>原转绑已锁定，不能修改。</p></Notice>}
      <Facts><Fact k="客户">{pending.customerName ?? customerId}</Fact><Fact k="专属客服变更"><Change from={pending.fromName ?? "原专属客服"} to={pending.targetName ?? `专属客服 ${pending.payload.targetAgentAdminId}`} /></Fact><Fact k="理由">{pending.payload.reason}</Fact></Facts><Fold inset title="技术信息" summary="原请求编号与绑定版本"><Facts><Fact k="原请求编号"><span data-mono>{pending.commandKey}</span></Fact><Fact k="绑定版本">{String(pending.payload.customers[0].expectedVersion)}</Fact></Facts></Fold>
    </> : denied ? <Notice tone="danger">{denied}</Notice>
      : loadError ? <BlockState state="error" title={loadError} onRetry={() => setReload((value) => value + 1)} />
      : !detail || !targets ? <BlockState state="loading" title="正在加载客户归属和可接待的专属客服…" />
      : <>
        <Facts><Fact k="客户">{detail.displayName || detail.customerNo || detail.customerId}</Fact><Fact k="用户编码"><span data-mono>{m1CustomerCode(detail.customerId)}</span></Fact><Fact k={chosen ? "专属客服变更" : "当前专属客服"}>{chosen ? <Change from={detail.agentName ?? "当前专属客服"} to={<span className="s5a-transfer-effect"><SupportAvatar name={chosen.name} path={chosen.avatarAssetId ? advisorAvatarPath(chosen.adminId) : undefined} version={chosen.avatarVersion} size={20} />{chosen.name}</span>} /> : detail.agentName ?? "资料未知"}</Fact></Facts>
        <Notice tone="warn">仅变更当前客户的专属客服；提交后原专属客服立即失去私聊与图片权限。</Notice>
        {targets.length === 0 ? <Notice tone="warn">暂无可接待的其他专属客服。请到「运营账号与权限」核对接待资格。</Notice> : <Field label="目标专属客服" required><Select aria-label="目标专属客服" value={String(target ?? "")} disabled={saving} onChange={value => setTarget(Number(value) || null)} options={[{ value: "", label: "请选择专属客服" }, ...targets.map(agent => ({ value: String(agent.adminId), label: `${agent.name}${agent.busy ? " · 忙碌" : ""}` }))]} /></Field>}
        {chosen && <Facts><Fact k="目标绑定人数">{chosen.assignedUserCount}</Fact><Fact k="当前会话负载">{chosen.currentActiveSessions ?? "—"}</Fact><Fact k="同时接待上限">{chosen.maxConcurrent ?? "不限"}</Fact></Facts>}
        <Field label="操作理由" required hint={reasonRule.hint} error={reason ? reasonRule.fieldError : undefined}><Textarea value={reason} disabled={saving} count={reasonRule.count} onChange={event => setReason(event.target.value)} /></Field>
        <Fold inset title="技术信息" summary="绑定版本"><Facts><Fact k="绑定版本">{String(detail.assignmentVersion)}</Fact></Facts></Fold>
      </>}
    {error && !pending && <Notice tone="danger">{error}</Notice>}
  </div></Modal>;
}
