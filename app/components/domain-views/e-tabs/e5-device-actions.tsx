"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { MoreHorizontal, SearchCheck } from "lucide-react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { announcePermissionDenied } from "@/lib/admin/operation-confirm-error";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import { createA2CommandKey } from "@/lib/admin/a2-client";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { roleLabel } from "@/lib/nav/console-nav";
import { canResumeE5UserDevicesFrom, fetchLegacyUnknownCandidate, type E5Device } from "@/lib/admin/e5-client";
import { sameLegacyUnknownProof, type LegacyUnknownCandidate } from "@/lib/admin/legacy-unknown-resolution";
import { e5Commands, e5LegacyCommands, e5CommandBlocks, checkE5Command, queryE5Proposal, releaseMissingE5Proposal, sendE5Command, type E5Command, type E5Intent } from "@/lib/admin/e5-command";
import { canInvestigateECommand, eCommandSettled, type ECommandEvidence, type ECommandInvestigation } from "@/lib/admin/e-command-investigation";
import { e6Commands, type E6Pending } from "@/lib/admin/e6-command";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { BlockState, Button, Change, Check, Fact as RdFact, Facts, Fold, IconButton, IrreversibleTag, Modal, MoreMenu, Notice, RatioBar, ReleaseBody, StatusTag, type MoreMenuItem } from "@/app/components/rd";
import { OperationConfirmModal } from "../design-kit";
import { E5_STATES } from "./e5-device-state";
import { ClosureContact, CommandClosureModal, CommandOutcomeLine, MissingProposalReleaseModal, PROPOSAL_END, RECOVERY_LINE, RecoveryPanel, SettledLine, closureOpen, eReadError, recoveryTitle, type CommandOutcome, type RecoveryItem } from "./e-command-check";
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
  deactivate: "有运行中任务时，本单完成并结算后自动停用；停用期间不再接新任务。不退款。",
  pause: "将暂停该用户的全部设备（含手机）。停跑期间不计收益、不补发。",
  resume: "只恢复运营手动暂停的设备；退款、注销、换机、离线、电量低等系统暂停保持不变。停跑期间收益不补发。",
  "force-activate": "强制激活也不能绕过每人 6 台上限。批准前设备状态不变。",
  unbind: "设备将不再属于原用户，不退款，购入时间不变。",
  legacy: "仅取消这条未确认旧任务，不产生USDT/UVT收益。原请求、任务执行记录和恢复预算保留，不授予重放。",
};
interface ActionsState {
  records: E5Command[];
  phoneBlocks: (device: E5Device, intent?: E5Intent) => boolean;
  legacyBlocked: boolean;
  busy: string;
  execute: (record: E5Command, retry: boolean) => Promise<void>;
  check: (record: E5Command, evidence?: ECommandEvidence) => Promise<ECommandInvestigation | null>;
  canInvestigate: boolean;
  refresh: () => Promise<void>;
  toast: (message: string) => void;
}
const CommandsContext = createContext<ActionsState | null>(null);
const PROPOSALS: E5Intent[] = ["force-activate", "unbind", "legacy"];
const TICKET_UNREAD = "刚查过：还是没查到审批进度，稍后再查。";
const E5_UNKNOWN = "没有收到结果，原请求和理由已保留；可以查询原结果，或按原请求重试。";
/** Query failures of an approval request, in words an operator can act on. */
const proposalQueryError = (record: E5Command, cause: unknown) => record.receivedTicketId ? TICKET_UNREAD
  : cause instanceof Error && cause.message === "提案缺少有效票号" ? "查到的审批单和原请求对不上，记录保留；请到操作记录与审批核对。" : eReadError(cause);
export const useE5Commands = () => useContext(CommandsContext)!;

export function E5CommandScope({ children, refresh, readBack, toast }: { children: ReactNode; refresh: (successMessage?: string) => Promise<void>; readBack?: (record: E5Command) => Promise<string>; toast: (message: string) => void }) {
  const actorId = useAdminAuth(s => String(s.session?.adminId ?? ""));
  const authorities = useAdminAuth(s => s.session?.authorities ?? []);
  const role = useAdminAuth(s => s.session?.role);
  const epoch = useAdminAuth(s => s.authEpoch);
  const [records, setRecords] = useState<E5Command[]>([]);
  const [phonePending, setPhonePending] = useState<E6Pending[]>([]);
  const [old, setOld] = useState<{ commandKey: string; fingerprint: string }[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [readResults, setReadResults] = useState<Record<string, string>>({});
  const [rejected, setRejected] = useState<Record<string, string>>({});
  const [releaseChecked, setReleaseChecked] = useState(false);
  const [release, setRelease] = useState<E5Command | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, CommandOutcome>>({});
  /** Records the lookup found settled: one light line each above the panel until dismissed. */
  const [settled, setSettled] = useState<{ key: string; label: string; text: string }[]>([]);
  /** An approval that ended (approved, rejected, withdrawn, expired) stays as one light line until the operator dismisses it. */
  const settleEnd = (record: E5Command, id: string, status: string) => setSettled(list => [...list.filter(item => item.key !== record.commandKey),
    { key: record.commandKey, label: `${record.label} · ${record.device.serial}`, text: `审批单 ${id} ${PROPOSAL_END[status]?.tag ?? "状态待核实"}${PROPOSAL_END[status] ? `：${PROPOSAL_END[status].text}` : "。"}` }]);
  const [closing, setClosing] = useState<E5Command | null>(null);
  const [missing, setMissing] = useState<E5Command | null>(null);
  const [queryNotes, setQueryNotes] = useState<Record<string, string>>({});
  const [errorKey, setErrorKey] = useState("");
  const sync = useCallback(() => {
    const saved = e5Commands.list().filter(r => r.actorId === actorId);
    setRecords(saved);
    setRejected(Object.fromEntries(saved.filter(r => r.retryRejection).map(r => [r.commandKey, r.retryRejection!])));
    setPhonePending(e6Commands.list().filter(r => String(r.owner) === actorId && r.section === "phones"));
  }, [actorId]);
  const phoneBlocks = (device: E5Device, intent?: E5Intent) => phonePending.some(r => r.scope === `user:${device.userId}`
    || r.scope === `phone:${device.deviceId}:${device.userId}`
    || (intent === "pause" || intent === "resume") && r.scope.startsWith("phone:") && r.scope.split(":")[2] === device.userId);
  useEffect(() => {
    sync(); setRelease(null); setReadResults({}); setOutcomes({}); setSettled([]); setClosing(null); setMissing(null); setQueryNotes({});
    try { setOld(e5LegacyCommands()); } catch (cause) { setError(`旧操作记录无法读取：${displayAdminError(cause)}`); }
  }, [sync, epoch]);
  const allowed = (r: E5Command) => {
    const platform = authorities.some(a => ["platform_a2_write", "platform_a2_proposal_create"].includes(a));
    if (r.intent === "legacy") return authorities.includes("device_e5_write") && authorities.includes("platform_a2_proposal_create");
    if (r.intent === "force-activate" || r.intent === "unbind") return platform && (authorities.includes(`device_e5_device_${r.intent === "unbind" ? "unbind" : "force_activate"}`) || role === "growth" && authorities.includes("platform_a2_proposal_create"));
    return authorities.includes("device_e5_write");
  };
  const execute = async (record: E5Command, retry: boolean) => {
    if (busy) throw new Error("另一个设备操作正在提交，请稍后核对。");
    if (!allowed(record)) throw new Error("当前账号缺少原操作所需权限，请核对授权。");
    setBusy(record.commandKey); setError(""); setErrorKey(record.commandKey);
    setQueryNotes(values => ({ ...values, [record.commandKey]: "" })); sync();
    try {
      const result = await sendE5Command(record, retry);
      sync();
      const submitted = ["force-activate", "unbind", "legacy"].includes(record.intent);
      const message = submitted ? `已提交审批 · 审批单 ${result.id}，批准前设备状态不变` : record.intent === "deactivate"
        ? result.pendingDeactivate ? "已申请停用，等待当前任务结算后自动停用" : "设备已取消激活"
        : record.intent === "pause" ? `暂停成功 · ${result.changedCount} 台设备` : record.intent === "resume" ? `已恢复 ${result.changedCount} 台运营暂停的设备` : "设备已激活";
      if (!submitted || !retry || result.status === "pending") { toast(message); await refresh(message); }
      else { settleEnd(record, String(result.id), String(result.status)); await refresh(); }
    } catch (cause) {
      if (cause instanceof Error && "status" in cause && (cause.status === 401 || cause.status === 403)) announcePermissionDenied();
      sync();
      if (retry && !e5Commands.list().find(r => r.commandKey === record.commandKey)?.receivedTicketId && isExplicitRejection(cause)) setRejected(rows => ({ ...rows, [record.commandKey]: displayAdminError(cause) }));
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
        if (ticket && ticket.status !== "pending") { settleEnd(record, ticket.id, ticket.status); await refresh(); }
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
      setSettled(list => [...list.filter(item => item.key !== record.commandKey), { key: record.commandKey, label: `${record.label} · ${record.device.serial}`, text: status === "CONFIRMED_NOT_EXECUTED" ? "核查确认没有执行，记录已解除，可以重新发起。" : status === "CONFIRMED_SUCCEEDED" ? "核查确认已执行，记录已解除，不要再做一次。" : "原操作已执行，记录已解除，不要再做一次。" }]);
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
  const items: RecoveryItem[] = [
    ...phonePending.map(r => ({ key: r.commandKey, object: r.label, tag: <StatusTag tone="warn">待核对</StatusTag>,
      line: "原操作在手机算力配置，到那里查询和处理。",
      actions: <Link className="rd-link" href="/devices/compute-config?tab=phones">手机算力配置</Link>,
      detail: <p>原操作在手机算力配置保留；相关设备或整个用户先暂停新操作。</p> })),
    ...old.map(row => ({ key: row.commandKey, object: "升级前的设备操作", tag: <StatusTag tone="warn">缺完整原请求</StatusTag>,
      line: "旧记录缺原请求，不能重试；到操作记录与审批核对。",
      actions: <Button size="sm" disabled={!!busy} onClick={() => void refresh()}>刷新设备列表</Button>,
      detail: <Facts><Fact label="原请求编号" value={row.commandKey} mono copy /></Facts> })),
    ...records.map(record => {
      const expired = isRetryExpired(record), proposal = PROPOSALS.includes(record.intent), refused = rejected[record.commandKey];
      const state = refused ? { tag: "重试被拒绝", tone: "danger" as const, line: RECOVERY_LINE.refused, more: "按原请求重试被明确拒绝；核对原操作的结果后，可以解除这条记录。" }
        : proposal && record.proposalStatus === "pending" ? { tag: "待审批", tone: "progress" as const, line: RECOVERY_LINE.pending, more: `审批单 ${record.receivedTicketId ?? ""}；批准前设备状态不变。` }
          : proposal && record.receivedTicketId ? { tag: "进度没读到", tone: "warn" as const, line: RECOVERY_LINE.created, more: "审批单已经建了，批没批准还没查到；点「查询原结果」再查，不会再建一张。" }
            : proposal && record.proposalAbsent ? expired ? { tag: "没有建成", tone: "warn" as const, line: RECOVERY_LINE.missing, more: "按原请求查不到这张审批单，说明没建成；确认解除时会再查一次。" }
              : { tag: "结果未知", tone: "warn" as const, line: RECOVERY_LINE.absent, more: "按原请求查不到这张审批单，现在还没建成；按原请求重试不会重复建单。" }
              : expired ? { tag: "结果未知", tone: "warn" as const, line: RECOVERY_LINE.expired, more: proposal ? "已超过 24 小时，不能再重试；查不到这张审批单时可以确认解除。" : "已超过 24 小时，不能再重试；现在的设备状态不代表原操作的结果。" }
                : { tag: "结果未知", tone: "warn" as const, line: proposal ? RECOVERY_LINE.unknown : RECOVERY_LINE.direct, more: proposal ? "可以查询原结果，或按原请求重试；重试用原来的请求，不会重复建单。" : "可以查询原结果，或按原请求重试；重试用原来的请求，不会重复执行。" };
      const releasable = proposal && expired && record.proposalAbsent && !record.receivedTicketId && !record.proposalStatus;
      const retryable = !refused && !expired && !(proposal && record.receivedTicketId);
      const note = busy === record.commandKey && !retryable ? "正在查询…" : direct(record)
        ? <>{outcomes[record.commandKey] ? <CommandOutcomeLine outcome={outcomes[record.commandKey]} expired={expired} /> : readResults[record.commandKey]}{!canInvestigate && closureOpen(outcomes[record.commandKey], expired) && <ClosureContact />}{errorKey === record.commandKey && error && error !== E5_UNKNOWN && <span role="alert">{error}</span>}</>
        : errorKey === record.commandKey && error && error !== E5_UNKNOWN ? error : queryNotes[record.commandKey];
      return { key: proposal && record.proposalStatus === "pending" ? `waiting:${record.commandKey}` : record.commandKey, createdAt: record.createdAt,
        object: <span title={`${record.label} · ${record.device.serial}`}>{record.label} · {record.device.serial.slice(-8)}</span>, tag: <StatusTag tone={state.tone}>{state.tag}</StatusTag>, line: state.line, note,
        noteKey: [readResults[record.commandKey], outcomes[record.commandKey] ? JSON.stringify(outcomes[record.commandKey]) : "", errorKey === record.commandKey ? error : ""].join("|").replace(/^\|+$/, ""),
        actions: <>
          {<Button size="sm" icon={<SearchCheck size={14} aria-hidden />} disabled={!!busy} onClick={() => void queryRow(record)}>{proposal && record.proposalStatus === "pending" ? "查询审批结果" : "查询原结果"}</Button>}
          {direct(record) && canInvestigate && closureOpen(outcomes[record.commandKey], expired) && <Button size="sm" variant="danger-outline" disabled={!!busy} onClick={() => setClosing(record)}>核查结案</Button>}
          {!(proposal && record.proposalStatus === "pending") && <Button size="sm" loading={busy === record.commandKey} disabledReason={expired ? "超过 24 小时不能再重试" : proposal && record.receivedTicketId ? "审批单已经建了，只能查询" : !allowed(record) ? "当前账号缺少原操作所需权限" : busy ? "正在提交原操作" : undefined} onClick={() => { void execute(record, true).catch(() => { /* The record row displays this failure. */ }); }}>按原请求重试</Button>}
          {refused && <Button size="sm" disabled={!!busy} onClick={() => { setReleaseChecked(false); setRelease(record); }}>解除原操作记录</Button>}
          {releasable && <Button size="sm" disabled={!!busy} onClick={() => setMissing(record)}>解除原操作记录</Button>}
        </>,
        detail: <>
          <p>{formatBusinessTimeCompact(new Date(record.createdAt).toISOString())} 提交 · {record.device.user} · 理由：{record.reason}</p>
          <p>{state.more}</p></>, tech: <Fold inset title="技术信息" summary={record.commandKey}><Facts><Fact label="实例号" value={record.device.serial} mono /><Fact label="原请求编号" value={record.commandKey} mono copy /><Fact label="请求路径" value={record.path} mono /><Fact label="原请求内容" value={record.body} mono /></Facts></Fold> };
    }),
  ];
  return <CommandsContext.Provider value={{ records, phoneBlocks, legacyBlocked: old.length > 0 || !!error && !records.length && !old.length && error.includes("旧操作"), busy, execute, check, canInvestigate, refresh, toast }}>
    {settled.map(item => <SettledLine key={item.key} label={item.label} text={item.text} onDismiss={() => setSettled(list => list.filter(other => other.key !== item.key))} />)}
    <RecoveryPanel title={recoveryTitle(items.filter(item => !item.key.startsWith("waiting:")).length, items.filter(item => item.key.startsWith("waiting:")).length)} tone={items.every(item => item.key.startsWith("waiting:")) ? "progress" : "warn"}
      explain="有结论前，相关设备或用户不能做新操作。点行首的箭头看提交时间、说明和原请求。" items={items} />
    {error && !records.length && <Notice tone="warn" title={error} />}
    {closing && <CommandClosureModal label={closing.label} commandKey={closing.commandKey} createdAt={closing.createdAt}
      facts={<>{closing.intent === "pause" || closing.intent === "resume" ? <Fact label="用户" value={closing.device.user} /> : <><Fact label="设备" value={closing.device.deviceName} /><Fact label="实例号" value={closing.device.serial} mono /></>}<Fact label="原理由" value={closing.reason} /></>}
      onClose={() => setClosing(null)} onSubmit={async evidence => {
        const receipt = await check(closing, evidence);
        showOutcome(closing, { receipt });
        setClosing(null);
        if (eCommandSettled(receipt)) await refresh();
        else toast("核查结论已记录；原操作仍记为结果未知，继续锁定。");
      }} />}
    {missing && <MissingProposalReleaseModal label={`${missing.label} · ${missing.device.serial}`} createdAt={missing.createdAt} onCancel={() => setMissing(null)} onConfirm={async () => {
      setBusy(missing.commandKey);
      try {
        const ticket = await releaseMissingE5Proposal(missing);
        setMissing(null);
        if (!ticket) toast("已解除这条记录，可以重新提交");
        else if (ticket.status === "pending") { setQueryNotes(values => ({ ...values, [missing.commandKey]: `审批单 ${ticket.id} 还在等批准` })); toast(`查到了审批单 ${ticket.id}，还在等批准，没有解除`); }
        else { settleEnd(missing, ticket.id, ticket.status); await refresh(); }
      } catch (cause) { const shown = proposalQueryError(missing, cause); setQueryNotes(values => ({ ...values, [missing.commandKey]: shown })); throw new Error(shown); }
      finally { sync(); setBusy(""); }
    }} />}
    {release && <Modal title="解除原操作记录" onClose={() => setRelease(null)} footer={<><Button onClick={() => setRelease(null)}>取消</Button><Button variant="primary" disabledReason={!releaseChecked ? "请先核对原操作的结果并勾选确认" : undefined} onClick={() => {
      e5Commands.forget(release.fingerprint, release.commandKey); sync(); setRelease(null); setError(""); toast("已解除这条记录");
    }}>确认解除</Button></>}>
      <ReleaseBody label={`${release.label} · ${release.device.serial}`} />
      <Facts><Fact label="原操作时间" value={formatBusinessTimeCompact(new Date(release.createdAt).toISOString())} /><Fact label="原请求编号" value={release.commandKey} mono copy /></Facts>
      <Notice tone="danger" title="按原请求重试被拒绝">{rejected[release.commandKey]}</Notice>
      <Check label="已核对原操作的结果，确认只解除本页这条记录" checked={releaseChecked} onChange={event => setReleaseChecked(event.target.checked)} />
    </Modal>}
    {children}
  </CommandsContext.Provider>;
}

/** The same lock predicate used by actions also marks the affected E5 row. */
export function E5PendingMark({ device }: { device: E5Device }) {
  const state = useContext(CommandsContext);
  return state && (state.records.some(record => e5CommandBlocks(record, device)) || state.phoneBlocks(device)) ? <span className="e5-pending-mark" title="此设备有待确认操作，请核对页首原操作">待确认</span> : null;
}

export function E5Slots({ device: d, phones = false }: { device: E5Device; phones?: boolean }) {
  return <div className="e5-slots" data-phones={phones ? "" : undefined} data-full={d.activeDevicesForUser >= d.maxDevicesPerUser ? "" : undefined}><RatioBar label="激活名额（含手机）" value={d.activeDevicesForUser} tone={phones ? d.activeDevicesForUser >= d.maxDevicesPerUser ? "warn" : "role-2" : "neutral"} total={d.maxDevicesPerUser} valueText={`${d.activeDevicesForUser}/${d.maxDevicesPerUser} 台（含手机）`} steps invalidText={`${d.activeDevicesForUser}/${d.maxDevicesPerUser} 台（含手机），已超过上限，不能激活`} /></div>;
}

/** E5 rows, detail footer and E6 phone mode all use these same state/authority/command checks. */
export function E5DeviceActions({ device: d, ctx, phones = false, inline = false }: { device: E5Device; ctx: EViewCtx; phones?: boolean; inline?: boolean }) {
  const state = useContext(CommandsContext)!;
  const session = useAdminAuth(s => s.session);
  const epoch = useAdminAuth(s => s.authEpoch);
  const [action, setAction] = useState<E5Intent | null>(null);
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [candidate, setCandidate] = useState<LegacyUnknownCandidate | null>(null);
  const [candidateError, setCandidateError] = useState("");
  const [reading, setReading] = useState(false);
  useEffect(() => { setAction(null); setCandidateOpen(false); setCandidate(null); setCandidateError(""); }, [d.deviceId, d.userId, d.serial, epoch]);
  if (!session || !state) return null;
  const readOnly = !phones && d.simState === "SIM_OFF";
  const activatable = phones ? ["inventory", "unbound"].includes(d.state) : ["WAITING_ACTIVATION", "STOPPED", "UNBOUND"].includes(d.simState ?? "");
  const deactivatable = phones ? ["active", "busy", "offline", "abnormal", "unknown"].includes(d.state) : ["WAITING_INIT", "LEGACY_PENDING", "RUNNING", "WAITING_CONFIG", "PAUSED", "ERROR"].includes(d.simState ?? "");
  const platform = session.authorities.some(a => ["platform_a2_write", "platform_a2_proposal_create"].includes(a));
  const full = d.activeDevicesForUser >= d.maxDevicesPerUser;
  const locked = (intent: E5Intent) => state.legacyBlocked ? "旧操作缺少原请求，请先核查" : state.busy ? "设备操作正在提交" : state.records.some(r => e5CommandBlocks(r, d, intent)) || state.phoneBlocks(d, intent) ? "这个设备或用户有待确认操作，请先核对原操作" : undefined;
  const options: MoreMenuItem[] = [];
  const add = (intent: E5Intent, label: string, extra?: string) => options.push({ key: intent, label, danger: intent === "unbind" || intent === "pause", disabledReason: locked(intent) ?? extra, onSelect: () => setAction(intent) });
  if (!readOnly) {
    if (activatable && ctx.canWriteE5 && (phones ? d.state === "inventory" : d.simState === "WAITING_ACTIVATION")) add("activate", "激活", full ? "已达 6 台激活上限（含手机）" : undefined);
    if (activatable && ctx.canForceActivateE5) add("force-activate", "强制激活", !platform ? "还需审批发起权限，请联系管理员" : full ? "已达 6 台激活上限（含手机）" : undefined);
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
  const proposal = action === "force-activate" || action === "unbind" || action === "legacy";
  return <>
    {options.length ? inline ? <div className="rd-toolbar">{options.map(option => <Button key={option.key} size="sm" variant={option.danger ? "danger-outline" : "secondary"} disabledReason={option.disabledReason} onClick={option.onSelect}>{option.label}</Button>)}</div> : <MoreMenu label={`操作 ${d.serial}`} items={options} /> : phones ? <span className="rd-muted" title="当前权限或状态没有可执行的操作">{!ctx.canWriteE5 && !ctx.canForceActivateE5 && !ctx.canUnbindE5 ? "只读" : "—"}</span> : d.simState === "CLOSING" ? inline ? <span className="rd-muted">停用中，结算后自动停用，暂时没有可做的操作。</span> : <IconButton aria-label={`操作 ${d.serial}`} disabledReason="停用中，结算后自动停用，暂时没有可做的操作"><MoreHorizontal size={16} aria-hidden /></IconButton> : inline ? <span className="rd-muted">{readOnly ? "任务已关闭，仅可查看设备事实。" : "当前账号或设备状态没有可执行的操作。"}</span> : null}
    {candidateOpen && <Modal title="旧任务终结资格" onClose={() => setCandidateOpen(false)} busy={reading} footer={<Button onClick={() => setCandidateOpen(false)}>关闭</Button>}>
      <Facts><Fact label="设备" value={d.serial} /><Fact label="用户" value={d.user} /></Facts>
      {reading ? <BlockState state="loading" title="正在核对终结资格…" /> : candidateError ? <BlockState state="error" title="终结资格读取失败" detail={candidateError} onRetry={() => void readCandidate()} /> : candidate && <>
        <Notice tone={candidate.eligible ? "progress" : "neutral"} title={!candidate.caseId ? "无可终结的未确认旧任务" : candidate.resolution ? "已取消 · 不计收益" : candidate.status === "QUIESCENCE_REQUIRED" ? "等待有效退出证明" : candidate.eligible ? "可申请终结" : "终结条件未满足"}>{candidate.reason && <p>{displayAdminError(new Error(candidate.reason))}</p>}</Notice>
        {candidate.caseId && <Facts><Fact label="案件" value={candidate.caseId} copy mono /><Fact label="原任务" value={candidate.taskNo} copy mono /><Fact label="代际" value={candidate.requestGeneration} /><Fact label="退出证明" value={candidate.proofSha ?? "—"} copy mono /><Fact label="后端实例" value={candidate.backendInstanceId} copy mono />{candidate.resolution && <Fact label="结案审批单" value={candidate.resolution.a2OperationId} copy mono />}</Facts>}
        <Fold inset title="技术信息" summary="原请求与证据"><Facts><Fact label="请求键哈希" value={candidate.requestKeyHash ?? "—"} mono copy /><Fact label="请求体哈希" value={candidate.requestBodyHash ?? "—"} mono copy /><Fact label="案件集合哈希" value={candidate.caseSetSha256 ?? "—"} mono copy /></Facts></Fold>
        <div className="rd-toolbar"><Button onClick={() => void readCandidate()}>重新核对</Button>{candidate.eligible && <Button variant="danger" disabledReason={locked("legacy")} onClick={async () => {
          setReading(true); setCandidateError("");
          try { const fresh = await fetchLegacyUnknownCandidate(d.deviceId); if (!sameLegacyUnknownProof(candidate, fresh)) throw new Error("退出证据或设备状态已更新，请重新核对。"); setCandidate(fresh); setCandidateOpen(false); setAction("legacy"); }
          catch (cause) { setCandidate(null); setCandidateError(displayAdminReadError(cause)); }
          finally { setReading(false); }
        }}>结束未确认任务（不计收益）</Button>}</div>
      </>}
    </Modal>}
    {action && <OperationConfirmModal action={LABELS[action]} title={LABELS[action]} briefKind="record" confirmLabel={CONFIRMS[action]} reasonMin={8} reasonMax={200}
      confirmTone={action === "unbind" || action === "pause" || action === "legacy" ? "danger" : "primary"}
      effect={<><StatusTag tone="progress" filled explain={proposal ? "由另一位具备审批权限及对应业务权限的管理员复核后执行；发起人不能批准自己的申请，批准前设备状态不变。" : undefined}>{proposal ? "批准后生效" : "立即生效"}</StatusTag>{(action === "unbind" || action === "legacy") && <IrreversibleTag />}</>}
      statedBrief={{ impact: EFFECTS[action], check: "核对设备、归属用户、操作范围和理由，名额包含手机。" }}
      completionCopy={proposal ? "由另一位具备审批权限及对应业务权限的管理员复核后执行。" : undefined}
      facts={<><Facts>{action === "pause" || action === "resume" ? <><Fact label="用户" value={d.user} /><Fact label="影响范围" value={action === "pause" ? "这位用户的全部设备（含手机）" : "这位用户被运营暂停的设备（含手机）"} /><Fact label="从这台设备发起" value={<>{d.deviceName}<br /><span className="e5-instance" data-mono>{d.serial}</span></>} /><Fact label="发起设备状态" value={d.simState ? E5_STATES[d.simState].label : d.pausedReason ? "已暂停" : ({ active: "在线", busy: "任务中", offline: "离线", inventory: "待激活", "pending-deactivate": "停用中", unbound: "已解绑 / 停用", abnormal: "异常", unknown: "状态未知" }[d.state])} /></> : <><Fact label="设备" value={d.deviceName} /><Fact label="实例号" value={d.serial} mono /><Fact label="归属用户" value={d.user} /><Fact label="当前状态" value={d.simState ? E5_STATES[d.simState].label : d.pausedReason ? "已暂停" : ({ active: "在线", busy: "任务中", offline: "离线", inventory: "待激活", "pending-deactivate": "停用中", unbound: "已解绑 / 停用", abnormal: "异常", unknown: "状态未知" }[d.state])} /></>}
        {action === "legacy" && candidate && <><Fact label="原任务 / 代际" value={`${candidate.taskNo} / ${candidate.requestGeneration}`} /><Fact label="案件" value={candidate.caseId} /><Fact label="退出证明" value={candidate.proofSha} mono copy /><Fact label="后端实例" value={candidate.backendInstanceId} /></>}
      </Facts>{(action === "activate" || action === "force-activate") && <><E5Slots device={d} phones={phones} /><Facts><RdFact k="激活名额变化"><Change from={`${d.activeDevicesForUser}/${d.maxDevicesPerUser}`} to={`${d.activeDevicesForUser + 1}/${d.maxDevicesPerUser}`} /></RdFact></Facts></>}</>}
      blockedReason={locked(action) ?? ((action === "activate" || action === "force-activate") && full ? "已达 6 台激活上限（含手机）" : undefined)}
      detail={proposal ? "提案成功只代表申请已收录；批准前设备状态不变。请到操作记录与审批核对原申请。" : action === "resume" ? "实际恢复台数以服务端回执为准，单次最多 200 台。" : "操作结果以服务端回执为准。"}
      onClose={() => setAction(null)} onConfirm={async reason => {
        if (locked(action)) throw new Error(String(locked(action)));
        const auth = useAdminAuth.getState();
        if (auth.authEpoch !== epoch || auth.session?.adminId !== session.adminId) throw new Error("管理员会话已变化，请重新进入设备页面。");
        const normalized = reason.normalize("NFC").trim();
        let path: string; let body: object;
        if (action === "force-activate" || action === "unbind") {
          const def = findHighOp(action === "unbind" ? "e5_device_unbind" : "e5_device_force_activate")!;
          path = "/api/admin/platform/audit/operations";
          body = { action: `${LABELS[action]} · ${d.serial}`, obj: String(d.deviceId), beforeValue: d.simState ?? d.rawStatus, afterValue: action === "unbind" ? "已解绑" : "已激活", operator: session.operator || session.username, operatorRole: roleLabel(session.role), type: def.type, amplifies: false, sos: false, roleGate: def.gateLabel, reason: normalized, sourceDomain: "E5", command: def.buildCommand({ deviceId: d.deviceId }), target: def.buildTarget({ deviceId: d.deviceId }) };
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
        try { await state.execute(record, false); setAction(null); }
        catch (cause) {
          if (e5Commands.get(fingerprint)) setAction(null);
          // Nothing is left to resume: the list was reread, so close the dialog instead of offering the same 404 again.
          else if (cause instanceof Error && "backendMessage" in cause && cause.backendMessage === "PAUSED_USER_DEVICES_NOT_FOUND") { setAction(null); state.toast(displayAdminError(cause)); return; }
          throw cause;
        }
      }} />}
  </>;
}
