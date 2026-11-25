"use client";
import { nextRecoveryDeadline, sendRecoveredDraft } from "@/lib/admin/abe-recovery-access";
import { eCommandClosureOffer } from "@/lib/admin/e-command-investigation";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { MoreHorizontal, SearchCheck } from "lucide-react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { displayAdminError, displayAdminReadError, formatAdminApiError } from "@/lib/admin/error-messages";
import { announcePermissionDenied } from "@/lib/admin/operation-confirm-error";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { RETRY_EXPIRED_TEXT, isRetryExpired } from "@/lib/admin/pending-mutation-store";
import { createA2CommandKey } from "@/lib/admin/a2-client";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { roleLabel } from "@/lib/nav/console-nav";
import { canActivateE5Device, canResumeE5UserDevicesFrom, fetchE5Devices, fetchLegacyUnknownCandidate, type E5Device } from "@/lib/admin/e5-client";
import { sameLegacyUnknownProof, type LegacyUnknownCandidate } from "@/lib/admin/legacy-unknown-resolution";
import { canSendE5Command, e5Commands, e5Recovery, e5LegacyCommands, e5CommandBlocks, checkE5Command, queryE5Proposal, sendE5Command, type E5Command, type E5Intent } from "@/lib/admin/e5-command";
import { canInvestigateECommand, eCommandSettled, type ECommandEvidence, type ECommandInvestigation } from "@/lib/admin/e-command-investigation";
import { e6Commands, isE6ActiveRecord, type E6Pending } from "@/lib/admin/e6-command";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { BlockState, Button, Change, Check, Decision, Fact as RdFact, Facts, Fold, IconButton, IrreversibleTag, Modal, MoreMenu, Notice, RatioBar, ReleaseBody, StatusTag, type MoreMenuItem } from "@/app/components/rd";
import { useRecoveryDraftDiscard } from "../recovery-draft-discard";
import { usePendingReplayDeadline, OperationConfirmModal } from "../design-kit";
import { E5_STATES, e5StateNote } from "./e5-device-state";
import { CommandClosureModal, CommandOutcomeLine, commandOutcomeSummary, PROPOSAL_END, RECOVERY_LINE, RecoveryPanel, SettledLine, closureOpen, eReadError, recoveryTitle, type CommandOutcome, type RecoveryItem } from "./e-command-check";
import { SETTLED_REJECTED, businessCodeOf } from "../recovery-panel";
import type { EViewCtx } from "./types";

function Fact({ label, value, mono, copy }: { label: string; value?: ReactNode; mono?: boolean; copy?: boolean }) {
  const [feedback, setFeedback] = useState("");
  return <RdFact k={label}><span className={mono ? "e5-instance" : undefined} data-mono={mono ? "" : undefined}>{value ?? "—"}</span>{copy && value && <Button size="sm" variant="ghost" aria-label={`复制${label}`} onClick={() => {
    const failed = () => setFeedback("复制失败，请手动选择");
    if (!navigator.clipboard) { failed(); return; }
    void navigator.clipboard.writeText(String(value)).then(() => setFeedback("已复制"), failed);
  }}>复制</Button>}{feedback && <span className="e5-sub" role="status">{feedback}</span>}</RdFact>;
}

const LABELS: Record<E5Intent, string> = { activate: "激活设备", deactivate: "取消激活", pause: "暂停该用户", resume: "恢复该用户", "force-activate": "强制激活", unbind: "解绑设备", legacy: "结束未确认任务（不计收益）" };
const CONFIRMS: Record<E5Intent, string> = { activate: "确认激活", deactivate: "确认取消激活", pause: "确认暂停该用户", resume: "确认恢复该用户", "force-activate": "提交强制激活审批", unbind: "提交解绑审批", legacy: "提交终结审批" };
const EFFECTS: Record<E5Intent, string> = {
  activate: "激活后占用一个设备名额。每人最多 6 台，包含手机。",
  deactivate: "停用后不接新任务、不占名额，不退款；之后用户能在 App 里重新激活，后台也能申请强制激活。",
  pause: "暂停这位用户的全部设备（含手机），停跑期间不计收益、不补发。之后可以点「恢复该用户」。",
  resume: "只恢复运营手动暂停的设备；退款、注销、换机、离线、电量低等系统暂停保持不变。停跑期间收益不补发。",
  "force-activate": "设备激活后占用一个名额；每人最多 6 台，包含手机。",
  unbind: "设备不再归原用户，后台不能再恢复；不退款，购入时间不变，解绑后没有收益。",
  legacy: "只取消这条结果不明的旧任务，不发 USDT 或 UVT 收益；任务记录保留，这条任务不会再执行。",
};
interface ActionsState {
  records: E5Command[];
  phoneBlocks: (device: E5Device, intent?: E5Intent) => boolean;
  legacyBlocked: boolean;
  busy: string;
  execute: (record: E5Command, retry: boolean) => Promise<void>;
  check: (record: E5Command, evidence?: ECommandEvidence) => Promise<ECommandInvestigation | null>;
  canInvestigate: boolean;
  setEditorOpen: (editor: symbol, open: boolean) => void;
  forgetDraft: (record: E5Command) => void;
  writeBlock?: string;
  refresh: () => Promise<void>;
  toast: (message: string) => void;
}
const CommandsContext = createContext<ActionsState | null>(null);
/** 结束旧任务时设备在「停用中」：批准会顺带把它停用（LegacyUnknownZeroCreditService.approve 的 pendingDeactivate 分支）。 */
const LEGACY_CLOSING = "这台设备已申请停用，批准时会一并停用。";
const PROPOSALS: E5Intent[] = ["force-activate", "unbind", "legacy"];
const TICKET_UNREAD = "刚查过：还是没查到审批进度，稍后再查。";
const E5_UNKNOWN = "没有收到结果，原请求和理由已保留；可以查询原结果，或按原操作重试。";
/** Query failures of an approval request, in words an operator can act on. */
const proposalQueryError = (record: E5Command, cause: unknown) => record.receivedTicketId ? TICKET_UNREAD
  : cause instanceof Error && cause.message === "提案缺少有效票号" ? "查到的审批单和原请求对不上，记录保留；请到操作记录与审批核对。" : eReadError(cause);
export const useE5Commands = () => useContext(CommandsContext)!;

export function E5CommandScope({ children, ctx, refresh, readBack, toast, writeBlock }: { children: ReactNode; ctx: EViewCtx; refresh: (successMessage?: string) => Promise<void>; readBack?: (record: E5Command) => Promise<string>; toast: (message: string) => void; writeBlock?: string }) {
  const actorId = useAdminAuth(s => String(s.session?.adminId ?? ""));
  const authorities = useAdminAuth(s => s.session?.authorities ?? []);
  const role = useAdminAuth(s => s.session?.role);
  const epoch = useAdminAuth(s => s.authEpoch);
  const [records, setRecords] = useState<E5Command[]>([]);
  const [drafts, setDrafts] = useState<E5Command[]>([]);
  const discardRecovery = useRecoveryDraftDiscard();
  const [restoring, setRestoring] = useState<{ record: E5Command; device: E5Device } | null>(null);
  const openEditors = useRef(new Set<symbol>());
  const setEditorOpen = useCallback((editor: symbol, open: boolean) => {
    if (open) openEditors.current.add(editor);
    else openEditors.current.delete(editor);
  }, []);
  usePendingReplayDeadline(nextRecoveryDeadline(records));
  const [phonePending, setPhonePending] = useState<E6Pending[]>([]);
  const [old, setOld] = useState<{ commandKey: string; fingerprint: string }[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [readResults, setReadResults] = useState<Record<string, string>>({});
  useSyncExternalStore(e5Recovery.subscribe, e5Recovery.getRevision, () => 0);
  const [releaseChecked, setReleaseChecked] = useState(false);
  const [release, setRelease] = useState<E5Command | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, CommandOutcome>>({});
  /** Records the lookup found settled: one light line each above the panel until dismissed. */
  const [settled, setSettled] = useState<{ key: string; label: string; text: string }[]>([]);
  /** An approval that ended (approved, rejected, withdrawn, expired) stays as one light line until the operator dismisses it. */
  const settleEnd = (record: E5Command, id: string, status: string) => setSettled(list => [...list.filter(item => item.key !== record.commandKey),
    { key: record.commandKey, label: `${record.label} · ${record.device.serial}`, text: `审批单 ${id} ${PROPOSAL_END[status]?.tag ?? "状态待核实"}${PROPOSAL_END[status] ? `：${PROPOSAL_END[status].text}` : "。"}` }]);
  const [closing, setClosing] = useState<E5Command | null>(null);
  const [queryNotes, setQueryNotes] = useState<Record<string, string>>({});
  const [errorKey, setErrorKey] = useState("");
  const sync = useCallback(() => {
    const saved = e5Commands.list().filter(r => r.actorId === actorId);
    setRecords(saved.filter(record => !record.verifiedNotExecuted));
    setDrafts(saved.filter(record => record.verifiedNotExecuted));
    setPhonePending(e6Commands.list().filter(r => String(r.owner) === actorId && r.section === "phones" && isE6ActiveRecord(r)));
  }, [actorId]);
  const phoneBlocks = (device: E5Device, intent?: E5Intent) => phonePending.some(r => r.scope === `user:${device.userId}`
    || r.scope === `phone:${device.deviceId}:${device.userId}`
    || (intent === "pause" || intent === "resume") && r.scope.startsWith("phone:") && r.scope.split(":")[2] === device.userId);
  useEffect(() => {
    sync(); setRestoring(null); setRelease(null); setReadResults({}); setOutcomes({}); setSettled([]); setClosing(null); setQueryNotes({});
    try { setOld(e5LegacyCommands()); } catch (cause) { setError(`旧操作记录无法读取：${displayAdminError(cause)}`); }
  }, [sync, epoch]);
  const allowed = canSendE5Command;
  const execute = async (record: E5Command, retry: boolean) => {
    if (writeBlock) throw new Error(writeBlock);
    if (busy) throw new Error("另一个设备操作正在提交，请稍后核对。");
    if (!allowed(record)) throw new Error("当前账号缺少原操作所需权限，请核对授权。");
    setBusy(record.commandKey); setError(""); setErrorKey(record.commandKey);
    setQueryNotes(values => ({ ...values, [record.commandKey]: "" })); sync();
    try {
      const result = await sendE5Command(record, retry);
      sync();
      const submitted = ["force-activate", "unbind", "legacy"].includes(record.intent);
      const message = submitted ? `已提交审批 · 审批单 ${result.id}，批准前设备状态不变` : record.intent === "deactivate"
        ? result.pendingDeactivate ? "已申请停用，当前任务结束后自动停用" : "设备已取消激活"
        : record.intent === "pause" ? `暂停成功 · ${result.changedCount} 台设备` : record.intent === "resume" ? `已恢复 ${result.changedCount} 台运营暂停的设备` : "设备已激活";
      if (!submitted || !retry || result.status === "pending") { toast(message); await refresh(message); }
      else { settleEnd(record, String(result.id), String(result.status)); await refresh(message); }
    } catch (cause) {
      if (cause instanceof Error && "status" in cause && (cause.status === 401 || cause.status === 403)) announcePermissionDenied();
      sync();
      const pausedGone = cause instanceof Error && "backendMessage" in cause && cause.backendMessage === "PAUSED_USER_DEVICES_NOT_FOUND" && !retry && !e5Commands.get(record.fingerprint);
      const saved = e5Commands.list().find(r => r.commandKey === record.commandKey);
      // A first-submit "nothing to resume" closes the dialog and is told by a toast, so it leaves no notice behind.
      if (!pausedGone) setError((!retry && !e5Commands.get(record.fingerprint) || isExplicitRejection(cause)) ? displayAdminError(cause) : saved?.receivedTicketId ? TICKET_UNREAD : cause instanceof Error && cause.message === "提案缺少有效票号" ? "查到的审批单和原请求对不上，记录保留；请到操作记录与审批核对。" : E5_UNKNOWN);
      if (cause instanceof Error && "backendMessage" in cause && cause.backendMessage === "PAUSED_USER_DEVICES_NOT_FOUND") await refresh();
      throw cause;
    } finally { setBusy(""); }
  };
  const check = async (record: E5Command, evidence?: ECommandEvidence) => {
    setBusy(record.commandKey);
    try {
      if (["force-activate", "unbind", "legacy"].includes(record.intent)) {
        let ticket;
        if (errorKey === record.commandKey) setError("");
        try { ticket = await queryE5Proposal(record); }
        catch (cause) { setQueryNotes(values => ({ ...values, [record.commandKey]: proposalQueryError(record, cause) })); throw cause; }
        setQueryNotes(values => ({ ...values, [record.commandKey]: !ticket ? "刚查过：没有这张审批单。" : "刚查过：还在等批准。" }));
        if (ticket && ticket.status !== "pending") settleEnd(record, ticket.id, ticket.status);
        return null;
      }
      return await checkE5Command(record, evidence);
    }
    finally { sync(); setBusy(""); }
  };
  const direct = (record: E5Command) => ["activate", "deactivate", "pause", "resume"].includes(record.intent);
  /** Keeps the authoritative answer on screen: a settled command leaves the list, anything else stays under its notice. */
  const showOutcome = (record: E5Command, outcome: CommandOutcome) => {
    if ("receipt" in outcome && outcome.receipt && eCommandSettled(outcome.receipt)) {
      const status = outcome.receipt.originalStatus;
      setSettled(list => [...list.filter(item => item.key !== record.commandKey), { key: record.commandKey, label: `${record.label} · ${record.device.serial}`, text: status === "CONFIRMED_REJECTED" ? SETTLED_REJECTED : status === "CONFIRMED_NOT_EXECUTED" ? "核查确认没有执行，记录已解除，可以重新发起。" : status === "CONFIRMED_SUCCEEDED" ? "核查确认已执行，记录已解除，不要再做一次。" : "原操作已执行，记录已解除，不要再做一次。" }]);
    } else setOutcomes(values => ({ ...values, [record.commandKey]: outcome }));
  };
  const canInvestigate = canInvestigateECommand("device_e5_read");
  const queryRow = async (record: E5Command) => {
    setReadResults(values => ({ ...values, [record.commandKey]: "正在查询…" }));
    try {
      const outcome: CommandOutcome | null = await check(record).then(receipt => direct(record) ? { receipt } : null, cause => direct(record) ? { error: displayAdminReadError(cause) } : null);
      if (outcome) showOutcome(record, outcome);
      const result = readBack ? await readBack(record) : (await refresh(), "已刷新设备列表；现在的状态不代表原操作的结果。");
      setReadResults(values => ({ ...values, [record.commandKey]: result }));
    } catch (cause) { setReadResults(values => ({ ...values, [record.commandKey]: displayAdminReadError(cause) })); }
  };
  const prepareDraft = async (record: E5Command) => {
    if (writeBlock || busy || openEditors.current.size || !allowed(record)) return;
    try {
      const list = await fetchE5Devices({ keyword: record.device.serial, userId: record.device.userId, pageNum: 1, pageSize: 10 });
      if (openEditors.current.size || !allowed(record)) return;
      const device = list.records.find(row => row.deviceId === record.device.deviceId && row.userId === record.device.userId && row.serial === record.device.serial);
      if (!device) throw new Error("原设备状态或归属已变化，请重新核对。");
      setRestoring({ record, device });
    } catch (error) { toast(displayAdminReadError(error)); }
  };
  const forgetDraft = (record: E5Command) => { e5Commands.forget(record.fingerprint, record.commandKey); sync(); };
  const items: RecoveryItem[] = [
    ...phonePending.map(r => ({ key: r.commandKey, object: r.label, tag: <StatusTag tone="warn">待核对</StatusTag>,
      line: "原操作在手机算力配置，到那里查询和处理。",
      actions: <Link className="rd-link" href="/devices/compute-config?tab=phones">手机算力配置</Link>,
      detail: <p>原操作在手机算力配置保留；相关设备或整个用户先暂停新操作。</p> })),
    ...old.map(row => ({ key: row.commandKey, object: "升级前的设备操作", tag: <StatusTag tone="warn">缺完整原请求</StatusTag>,
      line: "旧记录缺原请求，不能重试；到操作记录与审批核对。",
      actions: <Button size="sm" disabled={!!busy} onClick={() => void refresh()}>刷新设备列表</Button>,
      detail: <Facts><Fact label="操作编号" value={row.commandKey} mono copy /></Facts> })),
    ...drafts.map(record => ({
      key: record.commandKey, object: `${record.label} · ${record.device.serial}`, createdAt: record.createdAt,
      tag: <StatusTag tone="neutral">未执行</StatusTag>, line: "可以重新确认原操作。",
      actions: <>{allowed(record) && <Button size="sm" disabledReason={writeBlock} disabled={!!busy} onClick={() => void prepareDraft(record)}>重新确认</Button>}
        <Button size="sm" onClick={() => discardRecovery.ask(() => forgetDraft(record))}>放弃这份草稿</Button></>,
    })),
    ...records.map(record => {
      const recovery = e5Recovery.state(record);
      const expired = recovery.expired, proposal = PROPOSALS.includes(record.intent), refused = recovery.replayRejection;
      const state = refused ? { tag: "重试被拒绝", tone: "danger" as const, line: RECOVERY_LINE.refused, more: "按原操作重试被明确拒绝；核对原操作的结果后，可以解除这条记录。" }
        : proposal && record.proposalStatus === "pending" ? { tag: "待审批", tone: "warn" as const, line: RECOVERY_LINE.pending, more: `审批单 ${record.receivedTicketId ?? ""}；批准前设备状态不变。` }
          : proposal && record.receivedTicketId ? { tag: "进度没读到", tone: "warn" as const, line: RECOVERY_LINE.created, more: "审批单已经建了，批没批准还没查到；点「查询原结果」再查，不会再建一张。" }
            : expired ? { tag: "结果未知", tone: "warn" as const, line: RETRY_EXPIRED_TEXT, more: "原记录继续保留。" }
              : { tag: "结果未知", tone: "warn" as const, line: recovery.conclusion === "not-found" ? RECOVERY_LINE.absent : proposal ? RECOVERY_LINE.unknown : RECOVERY_LINE.direct,
                more: "重试用原来的请求。" };
      const retryable = !recovery.replayBlock;
      const note = busy === record.commandKey && !retryable ? "正在查询…" : direct(record)
        ? <>{outcomes[record.commandKey] ? <CommandOutcomeLine outcome={outcomes[record.commandKey]} expired={expired} summarized={!refused} canClose={canInvestigate} /> : readResults[record.commandKey]}{errorKey === record.commandKey && error && error !== E5_UNKNOWN && <span role="alert">{error}</span>}</>
        : errorKey === record.commandKey && error && error !== E5_UNKNOWN ? error : queryNotes[record.commandKey];
      return { key: proposal && record.proposalStatus === "pending" ? `waiting:${record.commandKey}` : record.commandKey, createdAt: record.createdAt,
        object: <span title={`${record.label} · ${record.device.serial}`}>{record.label} · {record.device.serial.slice(-8)}</span>, tag: <StatusTag tone={state.tone}>{state.tag}</StatusTag>, line: state.line, note,
        result: direct(record) && !refused ? commandOutcomeSummary(outcomes[record.commandKey], expired, canInvestigate) : undefined,
        noteKey: [readResults[record.commandKey], outcomes[record.commandKey] ? JSON.stringify(outcomes[record.commandKey]) : "", errorKey === record.commandKey ? error : ""].join("|").replace(/^\|+$/, ""),
        actions: <>
          {<Button size="sm" icon={<SearchCheck size={14} aria-hidden />} disabled={!!busy} onClick={() => void queryRow(record)}>{proposal && record.proposalStatus === "pending" ? "查询审批结果" : "查询原结果"}</Button>}
          {direct(record) && canInvestigate && closureOpen(outcomes[record.commandKey], expired) && <Button size="sm" variant="danger-outline" disabled={!!busy} onClick={() => setClosing(record)}>核查结案</Button>}
          {!(proposal && record.proposalStatus === "pending") && <Button size="sm" loading={busy === record.commandKey} disabledReason={writeBlock ?? (expired ? RETRY_EXPIRED_TEXT : proposal && record.receivedTicketId ? "审批单已经建了，只能查询" : !allowed(record) ? "当前账号缺少原操作所需权限" : busy ? "正在提交原操作" : recovery.replayBlock ? "先查询原结果，查不到才能重试" : undefined)} onClick={() => { void execute(record, true).catch(() => { /* The record row displays this failure. */ }); }}>按原操作重试</Button>}
          {refused && !record.receivedTicketId && <Button size="sm" disabled={!!busy} onClick={() => { setReleaseChecked(false); setRelease(record); }}>解除原操作记录</Button>}
        </>,
        detail: <>
          <p>{formatBusinessTimeCompact(new Date(record.createdAt).toISOString())} 提交 · {record.device.user} · 理由：{record.reason}</p>
          <p>{state.more}</p></>, tech: <Fold inset title="技术信息" summary={record.commandKey}><Facts><Fact label="实例号" value={record.device.serial} mono /><Fact label="操作编号" value={record.commandKey} mono copy /><Fact label="请求路径" value={record.path} mono /><Fact label="原请求内容" value={record.body} mono />{businessCodeOf(outcomes[record.commandKey]) !== undefined && <Fact label="业务码" value={String(businessCodeOf(outcomes[record.commandKey]))} mono />}</Facts></Fold> };
    }),
  ];
  return <CommandsContext.Provider value={{ records, phoneBlocks, legacyBlocked: old.length > 0 || !!error && !records.length && !old.length && error.includes("旧操作"), busy, execute, check, canInvestigate, setEditorOpen, forgetDraft, refresh, toast, writeBlock }}>
    {discardRecovery.dialog}
    {settled.map(item => <SettledLine key={item.key} label={item.label} text={item.text} onDismiss={() => setSettled(list => list.filter(other => other.key !== item.key))} />)}
    <RecoveryPanel title={recoveryTitle(items.filter(item => !item.key.startsWith("waiting:")).length, items.filter(item => item.key.startsWith("waiting:")).length)} tone="warn"
      explain="有结论前，相关设备或用户不能做新操作。点行首的箭头看提交时间、说明和原请求。" items={items} />
    {error && !records.length && <Notice tone="warn" title={error} />}
    {closing && <CommandClosureModal label={closing.label} commandKey={closing.commandKey} createdAt={closing.createdAt} offer={eCommandClosureOffer(outcomes[closing.commandKey], isRetryExpired(closing))}
      facts={<>{closing.intent === "pause" || closing.intent === "resume" ? <Fact label="用户" value={closing.device.user} /> : <><Fact label="设备" value={closing.device.deviceName} /><Fact label="实例号" value={closing.device.serial} mono /></>}<Fact label="原理由" value={closing.reason} /></>}
      onClose={() => setClosing(null)} onSubmit={async evidence => {
        const receipt = await check(closing, evidence);
        showOutcome(closing, { receipt });
        setClosing(null);
        if (eCommandSettled(receipt)) await refresh();
        else toast("核查结论已记录；原操作仍记为结果未知，继续锁定。");
      }} />}
    {release && <Modal title="解除原操作记录" onClose={() => setRelease(null)} footer={<><Button onClick={() => setRelease(null)}>取消</Button><Button variant="primary" disabledReason={!releaseChecked ? "请先核对原操作的结果并勾选确认" : undefined} onClick={() => {
      if (releaseChecked && e5Recovery.releaseRejectedReplay(release)) { sync(); setRestoring(null); setRelease(null); setError(""); toast("已解除这条记录"); }
    }}>确认解除</Button></>}>
      <ReleaseBody label={`${release.label} · ${release.device.serial}`} />
      <Facts><Fact label="原操作时间" value={formatBusinessTimeCompact(new Date(release.createdAt).toISOString())} /><Fact label="操作编号" value={release.commandKey} mono copy /></Facts>
      <Notice tone="danger" title="按原操作重试被拒绝">{e5Recovery.state(release).replayRejection}</Notice>
      <Check label="已核对原操作的结果，确认只解除本页这条记录" checked={releaseChecked} onChange={event => setReleaseChecked(event.target.checked)} />
    </Modal>}
    {children}
    {restoring && <E5DeviceActions key={restoring.record.commandKey} device={restoring.device} ctx={ctx}
      recovered={restoring.record} onRecoveryClose={() => setRestoring(null)} />}
  </CommandsContext.Provider>;
}

/** The same lock predicate used by actions also marks the affected E5 row. */
export function E5PendingMark({ device }: { device: E5Device }) {
  const state = useContext(CommandsContext);
  return state && (state.records.some(record => e5CommandBlocks(record, device)) || state.phoneBlocks(device)) ? <span className="e5-pending-mark" title="此设备有结果未知的操作，请核对页首原操作">结果未知</span> : null;
}

export function E5Slots({ device: d, phones = false }: { device: E5Device; phones?: boolean }) {
  return <div className="e5-slots" data-phones={phones ? "" : undefined} data-full={d.activeDevicesForUser >= d.maxDevicesPerUser ? "" : undefined}><RatioBar label="激活名额（含手机）" value={d.activeDevicesForUser} tone={phones ? d.activeDevicesForUser >= d.maxDevicesPerUser ? "warn" : "role-2" : "neutral"} total={d.maxDevicesPerUser} valueText={`${d.activeDevicesForUser}/${d.maxDevicesPerUser} 台（含手机）`} steps invalidText={`${d.activeDevicesForUser}/${d.maxDevicesPerUser} 台（含手机），已超过上限，不能激活`} /></div>;
}

/** E5 rows, detail footer and E6 phone mode all use these same state/authority/command checks. */
export function E5DeviceActions({ device: d, ctx, phones = false, inline = false, recovered, onRecoveryClose }: {
  device: E5Device; ctx: EViewCtx; phones?: boolean; inline?: boolean; recovered?: E5Command; onRecoveryClose?: () => void;
}) {
  const state = useContext(CommandsContext)!;
  const session = useAdminAuth(s => s.session);
  const epoch = useAdminAuth(s => s.authEpoch);
  const [action, setAction] = useState<E5Intent | null>(null);
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [candidate, setCandidate] = useState<LegacyUnknownCandidate | null>(null);
  const [candidateError, setCandidateError] = useState("");
  const [reading, setReading] = useState(false);
  const editor = useRef(Symbol("device editor"));
  const restoreAction = useRef<() => void>(() => {});
  const registerEditor = state?.setEditorOpen;
  useEffect(() => {
    const token = editor.current;
    registerEditor?.(token, !!action || candidateOpen);
    return () => registerEditor?.(token, false);
  }, [registerEditor, action, candidateOpen]);
  useEffect(() => {
    setAction(null); setCandidateOpen(false); setCandidate(null); setCandidateError("");
    if (recovered) restoreAction.current();
  }, [d.deviceId, d.userId, d.serial, epoch, recovered?.commandKey]);
  if (!session || !state) return null;
  const readOnly = !phones && d.simState === "SIM_OFF";
  // Shared by rows and the detail footer; do not infer ownership from raw status alone.
  const activatable = canActivateE5Device(d);
  const forceActivatable = canActivateE5Device(d, true);
  const deactivatable = phones ? ["active", "busy", "offline", "abnormal", "unknown"].includes(d.state) : ["WAITING_INIT", "LEGACY_PENDING", "RUNNING", "WAITING_CONFIG", "PAUSED", "ERROR"].includes(d.simState ?? "");
  const platform = session.authorities.some(a => ["platform_a2_write", "platform_a2_proposal_create"].includes(a));
  const full = d.activeDevicesForUser >= d.maxDevicesPerUser;
  const locked = (intent: E5Intent) => state.writeBlock ?? (state.legacyBlocked ? "旧操作缺少原请求，请先核查" : state.busy ? "设备操作正在提交" : state.records.some(r => e5CommandBlocks(r, d, intent)) || state.phoneBlocks(d, intent) ? "这个设备或用户有结果未知的操作，请先核对原操作" : intent === "activate" && !activatable || intent === "force-activate" && !forceActivatable ? formatAdminApiError("INVALID_STATE_TRANSITION", "INVALID_STATE_TRANSITION") : undefined);
  const options: MoreMenuItem[] = [];
  const add = (intent: E5Intent, label: string, extra?: string) => options.push({ key: intent, label, danger: intent === "unbind" || intent === "pause", disabledReason: locked(intent) ?? extra, onSelect: () => setAction(intent) });
  if (!readOnly) {
    if (activatable && ctx.canWriteE5) add("activate", "激活", full ? "已达 6 台激活上限（含手机）" : undefined);
    if (forceActivatable && ctx.canForceActivateE5) add("force-activate", "强制激活", !platform ? "还需审批发起权限，请联系管理员" : full ? "已达 6 台激活上限（含手机）" : undefined);
    if (deactivatable && ctx.canWriteE5) add("deactivate", "取消激活");
    if (deactivatable && ctx.canUnbindE5) add("unbind", "解绑", !platform ? "还需审批发起权限，请联系管理员" : undefined);
    if (ctx.canWriteE5 && (d.pausedReason ? canResumeE5UserDevicesFrom(d) : deactivatable)) add(d.pausedReason ? "resume" : "pause", d.pausedReason ? "恢复该用户" : "暂停该用户");
    if (!phones && d.simState === "LEGACY_PENDING" && ctx.canWriteE5 && session.authorities.includes("platform_a2_proposal_create")) options.push({ key: "legacy-check", label: "终结资格", disabledReason: locked("legacy"), onSelect: () => { setCandidateOpen(true); void readCandidate(); } });
  }
  async function readCandidate() {
    setReading(true); setCandidateError(""); setCandidate(null);
    try {
      const fresh = await fetchLegacyUnknownCandidate(d.deviceId);
      const auth = useAdminAuth.getState();
      if (auth.authEpoch !== epoch || auth.session?.adminId !== session?.adminId) return;
      if (fresh.caseId && (fresh.ownerId !== d.userId || fresh.instanceNo !== d.serial)) throw new Error("旧任务身份已变化，请重新核对。");
      setCandidate(fresh);
    } catch (cause) { setCandidateError(displayAdminReadError(cause)); }
    finally { setReading(false); }
  }
  restoreAction.current = () => {
    if (!recovered) return;
    const option = options.find(item => item.key === (recovered.intent === "legacy" ? "legacy-check" : recovered.intent));
    if (!option || option.disabledReason) {
      state.toast(typeof option?.disabledReason === "string" ? option.disabledReason : "当前设备状态不能继续原操作。");
      onRecoveryClose?.();
    } else option.onSelect?.();
  };
  const proposal = action === "force-activate" || action === "unbind" || action === "legacy";
  return <>
    {!recovered && (options.length ? inline ? <div className="rd-toolbar">{options.map(option => <Button key={option.key} size="sm" variant={option.danger ? "danger-outline" : "secondary"} disabledReason={option.disabledReason} onClick={option.onSelect}>{option.label}</Button>)}</div> : <MoreMenu label={`操作 ${d.serial}`} items={options} /> : phones ? <span className="rd-muted" title="当前权限或状态没有可执行的操作">{!ctx.canWriteE5 && !ctx.canForceActivateE5 && !ctx.canUnbindE5 ? "只读" : "—"}</span> : d.simState === "CLOSING" ? inline ? <span className="rd-muted">停用中，当前任务结束后自动停用，暂时没有可做的操作。</span> : <IconButton aria-label={`操作 ${d.serial}`} disabledReason="停用中，结算后自动停用，暂时没有可做的操作"><MoreHorizontal size={16} aria-hidden /></IconButton> : inline ? <span className="rd-muted">{readOnly ? "任务已关闭，仅可查看设备事实。" : "当前账号或设备状态没有可执行的操作。"}</span> : null)}
    {candidateOpen && <Modal title="旧任务终结资格" onClose={() => { setCandidateOpen(false); onRecoveryClose?.(); }} busy={reading} footer={<Decision
      danger={candidate?.eligible && !reading && <Button variant="danger" disabledReason={locked("legacy")} onClick={async () => {
          setReading(true); setCandidateError("");
          try { const fresh = await fetchLegacyUnknownCandidate(d.deviceId); if (!sameLegacyUnknownProof(candidate, fresh)) throw new Error("退出证据或设备状态已更新，请重新核对。"); setCandidate(fresh); setCandidateOpen(false); setAction("legacy"); }
          catch (cause) { setCandidate(null); setCandidateError(displayAdminReadError(cause)); }
          finally { setReading(false); }
        }}>结束未确认任务（不计收益）</Button>}
      others={<>{candidate && !reading && <Button onClick={() => void readCandidate()}>重新核对</Button>}<Button onClick={() => { setCandidateOpen(false); onRecoveryClose?.(); }}>关闭</Button></>} />}>
      <Facts><Fact label="设备" value={d.serial} /><Fact label="用户" value={d.user} /></Facts>
      {reading ? <BlockState state="loading" title="正在核对终结资格…" /> : candidateError ? <BlockState state="error" title="终结资格读取失败" detail={candidateError} onRetry={() => void readCandidate()} /> : candidate && <>
        <Notice tone={candidate.eligible ? "progress" : "neutral"} title={!candidate.caseId ? "无可终结的未确认旧任务" : candidate.resolution ? "已取消 · 不计收益" : candidate.status === "QUIESCENCE_REQUIRED" ? "等待有效退出证明" : candidate.eligible ? "可申请终结" : "终结条件未满足"}>{candidate.reason && <p>{displayAdminError(new Error(candidate.reason))}</p>}</Notice>
        {candidate.caseId && <Facts><Fact label="案件" value={candidate.caseId} copy mono /><Fact label="原任务" value={candidate.taskNo} copy mono />{candidate.resolution && <Fact label="结案审批单" value={candidate.resolution.a2OperationId} copy mono />}</Facts>}
        <Fold inset title="技术信息" summary="原请求与证据"><Facts><Fact label="代际" value={candidate.requestGeneration} /><Fact label="退出证明" value={candidate.proofSha ?? "—"} copy mono /><Fact label="后端实例" value={candidate.backendInstanceId} copy mono /><Fact label="请求键哈希" value={candidate.requestKeyHash ?? "—"} mono copy /><Fact label="请求体哈希" value={candidate.requestBodyHash ?? "—"} mono copy /><Fact label="案件集合哈希" value={candidate.caseSetSha256 ?? "—"} mono copy /></Facts></Fold>      </>}
    </Modal>}
    {action && <OperationConfirmModal action={LABELS[action]} title={LABELS[action]} briefKind="record" confirmLabel={CONFIRMS[action]} reasonMin={8} reasonMax={200}
      confirmTone={action === "unbind" || action === "pause" || action === "legacy" ? "danger" : "primary"}
      effect={<><StatusTag tone="progress" filled explain={proposal ? "另一位有审批权限和这项操作权限的管理员批准后执行，发起人不能自批；批准前设备状态不变。" : undefined}>{proposal ? "批准后生效" : "立即生效"}</StatusTag>{(action === "legacy" || action === "unbind") && <IrreversibleTag />}</>}
      statedBrief={{ impact: action === "legacy" && d.pendingDeactivate ? `${EFFECTS.legacy}${LEGACY_CLOSING}` : EFFECTS[action], check: "核对设备、归属用户、操作范围和理由，名额包含手机。" }}
      completionCopy={proposal ? "另一位管理员批准后执行，批准前设备状态不变。" : undefined}
      facts={<><Facts>{action === "pause" || action === "resume" ? <><Fact label="用户" value={d.user} /><Fact label="影响范围" value={action === "pause" ? "这位用户的全部设备（含手机）" : "这位用户被运营暂停的设备（含手机）"} /><Fact label="从这台设备发起" value={<>{d.deviceName}<br /><span className="e5-instance" data-mono>{d.serial}</span></>} /><Fact label="发起设备状态" value={d.simState ? e5StateNote(d).label ?? E5_STATES[d.simState].label : d.pausedReason ? "已暂停" : ({ active: "在线", busy: "任务中", offline: "离线", inventory: "待激活", "pending-deactivate": "停用中", unbound: "已解绑 / 停用", abnormal: "异常", unknown: "状态未知" }[d.state])} /></> : <><Fact label="设备" value={d.deviceName} /><Fact label="实例号" value={d.serial} mono /><Fact label="归属用户" value={d.user} /><Fact label="当前状态" value={d.simState ? e5StateNote(d).label ?? E5_STATES[d.simState].label : d.pausedReason ? "已暂停" : ({ active: "在线", busy: "任务中", offline: "离线", inventory: "待激活", "pending-deactivate": "停用中", unbound: "已解绑 / 停用", abnormal: "异常", unknown: "状态未知" }[d.state])} />{action === "deactivate" && <><Fact label="什么时候停" value="有任务时这一单结算后停，没有任务立即停" /><Fact label="旧任务" value="还没入账的直接取消，不结算" /></>}</>}
        {action === "legacy" && candidate && <><Fact label="原任务" value={candidate.taskNo} /><Fact label="案件" value={candidate.caseId} /></>}
        {(action === "activate" || action === "force-activate") && <RdFact k="激活名额变化"><span className="e5-slot-change"><E5Slots device={d} phones={phones} /><Change from={`${d.activeDevicesForUser}/${d.maxDevicesPerUser}`} to={`${d.activeDevicesForUser + 1}/${d.maxDevicesPerUser}`} /></span></RdFact>}
      </Facts></>}
      blockedReason={locked(action) ?? ((action === "activate" || action === "force-activate") && full ? "已达 6 台激活上限（含手机）" : undefined)}
      detail={proposal ? "审批进度到「操作记录与审批」看。" : action === "resume" ? "一次最多恢复 200 台，实际恢复几台看提交结果。" : "提交后页面会显示结果。"}
      onClose={() => { setAction(null); onRecoveryClose?.(); }} onConfirm={async reason => {
        if (locked(action)) throw new Error(String(locked(action)));
        const auth = useAdminAuth.getState();
        if (auth.authEpoch !== epoch || auth.session?.adminId !== session.adminId) throw new Error("管理员会话已变化，请重新进入设备页面。");
        const normalized = reason.normalize("NFC").trim();
        let path: string; let body: object;
        if (action === "force-activate" || action === "unbind") {
          const def = findHighOp(action === "unbind" ? "e5_device_unbind" : "e5_device_force_activate")!;
          path = "/api/admin/platform/audit/operations";
          body = { action: `${LABELS[action]} · ${d.serial}`, obj: String(d.deviceId), beforeValue: e5StateNote(d).label ?? (d.simState ? E5_STATES[d.simState].label : d.rawStatus), afterValue: action === "unbind" ? "已解绑" : "已激活", operator: session.operator || session.username, operatorRole: roleLabel(session.role), type: def.type, amplifies: false, sos: false, roleGate: def.gateLabel, reason: normalized, sourceDomain: "E5", command: def.buildCommand({ deviceId: d.deviceId }), target: def.buildTarget({ deviceId: d.deviceId }) };
        } else if (action === "legacy") {
          if (!candidate?.eligible) throw new Error("请重新核对旧任务资格。");
          const fresh = await fetchLegacyUnknownCandidate(d.deviceId);
          if (!sameLegacyUnknownProof(candidate, fresh)) throw new Error("退出证据或设备状态已更新，请重新核对。");
          path = `/api/admin/devices/legacy-unknown-resolutions/${d.deviceId}/proposals`; body = { reason: normalized, proofSha: candidate.proofSha };
        } else {
          path = action === "pause" || action === "resume" ? `/api/admin/devices/batch/${action}` : `/api/admin/devices/${d.deviceId}/${action}`;
          body = { ...(action === "pause" || action === "resume" ? { userId: Number(d.userId) } : {}), reason: normalized, operator: session.operator || session.username };
        }
        const fingerprint = `${session.adminId}|${action === "pause" || action === "resume" ? `user:${d.userId}` : `device:${d.deviceId}`}`;
        const commandKey = createA2CommandKey("e5");
        e5Commands.remember(fingerprint, commandKey, { actorId: String(session.adminId), authEpoch: epoch, intent: action, label: LABELS[action], device: d, reason: normalized, path, method: "POST", body: JSON.stringify(body), ...(action === "legacy" && candidate ? { proof: candidate } : {}) });
        if (!e5Commands.isDurablyStored(fingerprint, commandKey)) { e5Commands.forget(fingerprint, commandKey); throw new Error("原操作无法保存，暂不能提交。"); }
        const record = e5Commands.list().find(row => row.commandKey === commandKey)!;
        try {
          await sendRecoveredDraft(() => state.execute(record, false),
            () => e5Commands.isDurablyStored(fingerprint, commandKey), recovered && (() => state.forgetDraft(recovered)));
          setAction(null); onRecoveryClose?.();
        }
        catch (cause) {
          if (e5Commands.isDurablyStored(fingerprint, commandKey)) { setAction(null); onRecoveryClose?.(); }
          // Nothing is left to resume: the list was reread, so close the dialog instead of offering the same 404 again.
          else if (cause instanceof Error && "backendMessage" in cause && cause.backendMessage === "PAUSED_USER_DEVICES_NOT_FOUND") { setAction(null); state.toast(displayAdminError(cause)); return; }
          throw cause;
        }
      }} />}
  </>;
}
