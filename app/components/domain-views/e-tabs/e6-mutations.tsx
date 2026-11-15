"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { roleLabel } from "@/lib/nav/console-nav";
import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey } from "@/lib/admin/a2-client";
import { isRetryExpired, RETRY_EXPIRED_TEXT, hasPersistedPendingCommandOwner } from "@/lib/admin/pending-mutation-store";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { eDomainLegacyCommands as legacyCommands, e5LegacyCommands as legacyPhones } from "@/lib/admin/e-domain-commands";
import { e5Commands, type E5Command } from "@/lib/admin/e5-command";
import { e6Commands as commands, type E6DeviceInput as DeviceInput, type E6Payload as Payload, type E6Pending, type E6Proposal, type E6Section } from "@/lib/admin/e6-command";
import { displayAdminError } from "@/lib/admin/error-messages";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { activateE5Device, deactivateE5Device, setE5UserDevicesPaused, fetchE5Devices } from "@/lib/admin/e5-client";
import { savePhoneRisk, fetchPhoneRisk, fetchPhoneRiskReceipt, type PhoneRiskReceipt, type PhoneRiskOverview, type PhoneRiskUpdate } from "@/lib/admin/phone-risk-client";
import { canInvestigateECommand, discoverECommand, investigateECommand, eCommandSettled, type ECommandEvidence, type ECommandInvestigation } from "@/lib/admin/e-command-investigation";
import { Button, Notice, Fold, ReleaseModal, StatusTag, Fact } from "@/app/components/rd";
import { ClosureContact, CommandClosureModal, CommandOutcomeLine, SettledCommandNotices, closureOpen, type CommandOutcome, type SettledCommand } from "./e-command-check";

export type { E6Pending, E6Proposal, E6Section } from "@/lib/admin/e6-command";
export type E6WriteReceipt = { changedCount?: number; pendingDeactivate?: boolean; readbackFailed?: boolean; originalRiskResponse?: PhoneRiskOverview };
type ProposalDraft = Omit<E6Proposal, "operator" | "operatorRole" | "sos" | "roleGate">;
const Context = createContext<ReturnType<typeof useMutations> | null>(null);

function useMutations() {
  const session = useAdminAuth(s => s.session), epoch = useAdminAuth(s => s.authEpoch);
  const owner = session!.adminId, rights = session!.authorities;
  const [pending, setPending] = useState<E6Pending[]>([]);
  const [devicePending, setDevicePending] = useState<E5Command[]>([]);
  const [legacy, setLegacy] = useState<ReturnType<typeof legacyCommands.list>>([]);
  const [busy, setBusy] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [technicalErrors, setTechnicalErrors] = useState<Record<string, string>>({});
  const [rejected, setRejected] = useState<string[]>([]);
  const [release, setRelease] = useState<E6Pending | null>(null);
  const active = useRef(true), sending = useRef(false);
  const sync = () => {
    setPending(commands.list().filter(r => r.owner === owner));
    setDevicePending(e5Commands.list().filter(r => r.actorId === String(owner)));
  };
  const canPropose = rights.some(r => ["platform_a2_write", "platform_a2_proposal_create"].includes(r));
  const canAudit = rights.includes("platform_a2_read");
  const visible = (section: E6Section) => rights.includes(section === "tasks" || section === "tiers" ? "device_e2_read" : section === "phones" ? "device_e5_read" : "device_e6_read");
  useEffect(() => {
    active.current = true; sync();
    if (hasPersistedPendingCommandOwner(String(owner))) setLegacy([...legacyCommands.list().filter(r => /^(e2_task_|e2_phone_tier|e6_compute_config|e6_phone_calibration|e5_device_)/.test(r.fingerprint)), ...legacyPhones.list()]);
    return () => { active.current = false; };
  }, [owner, epoch]);
  const locked = (scope: string) => pending.some(r => r.scope === scope || scope.startsWith("phone:") && r.scope === `user:${scope.split(":")[2]}` || scope.startsWith("user:") && r.scope.startsWith("phone:") && r.scope.split(":")[2] === scope.slice(5))
    || legacy.some(r => { const [op,obj] = r.fingerprint.split("|"); return scope === "task:create" ? op === "e2_task_create" : scope.startsWith("task:") ? op.startsWith("e2_task_") && obj === scope.slice(5) : scope.startsWith("tier:") ? op === "e2_phone_tier" && obj === scope.slice(5) : scope === "calibration" ? op === "e6_phone_calibration" : scope.startsWith("param:") && op === "e6_compute_config" && obj === scope.slice(6); })
    || devicePending.some(r => scope.startsWith("user:") ? r.device.userId === scope.slice(5)
      : scope.startsWith("phone:") && (String(r.device.deviceId) === scope.split(":")[1]
        || r.device.userId === scope.split(":")[2] && ["pause", "resume"].includes(r.intent)));
  function allowed(record: E6Pending) {
    if (!visible(record.section)) return false;
    if (record.payload.kind === "risk") return rights.includes("device_e6_write");
    if (record.payload.kind === "device") return rights.includes("device_e5_write");
    const op = record.payload.input.command.op;
    if (!canPropose) return false;
    if (op.startsWith("e2_task_")) return rights.includes("device_e2_write");
    if (op === "e2_phone_tier") {
      const params = record.payload.input.command.params;
      return rights.includes("device_e2_write") && (params.dailyUsdt === undefined || rights.includes("device_e2_phone_tier_usdt"))
        && (params.dailyNex === undefined || rights.includes("device_e2_phone_tier_nex"));
    }
    if (op === "e5_device_force_activate" || op === "e5_device_unbind") return rights.includes(op === "e5_device_unbind" ? "device_e5_device_unbind" : "device_e5_device_force_activate") || session!.role === "growth" && rights.includes("platform_a2_proposal_create");
    return rights.includes("device_e6_write");
  }
  const canRetry = (record?: E6Pending) => !!record && record.owner === owner && allowed(record) && !isRetryExpired(record)
    && (record.payload.kind !== "risk" || record.payload.receiptVersion === 1);
  async function send(record: E6Pending, retry: boolean) {
    if (sending.current || !allowed(record)) throw new Error("当前没有这项操作的提交权限。");
    if (retry && !canRetry(record)) throw new Error("原操作仅可核查，不能重新发送。");
    sending.current = true; setBusy(record.commandKey);
    try {
      if (retry && record.payload.kind === "proposal") {
        const ticket = await fetchA2ProposalByKey(record.commandKey);
        if (ticket) {
          if (!ticket.mine) throw new Error("原提案归属无法核实，请到操作记录核对。");
          commands.remember(record.fingerprint, record.commandKey, { ...record, ticketId: ticket.id, proposalReceipt: { type: ticket.type, amplifies: ticket.amplifies }, terminal: ["approved", "rejected", "withdrawn", "expired"].includes(ticket.status) ? ticket.status : undefined });
          if (active.current) sync();
          return;
        }
      }
      let writeResult: E6WriteReceipt | undefined;
      if (record.payload.kind === "proposal") {
        const ticket = await createA2OperationProposal(record.payload.input, record.commandKey, true);
        commands.remember(record.fingerprint, record.commandKey, { ...record, ticketId: ticket.id, proposalReceipt: { type: ticket.type, amplifies: ticket.amplifies } });
      } else if (record.payload.kind === "device") {
        const i = record.payload.input;
        if (i.action === "activate") { const result = await activateE5Device(i.deviceId, false, i.reason, i.operator, record.commandKey); writeResult = { pendingDeactivate: result.pendingDeactivate }; }
        else if (i.action === "deactivate") { const result = await deactivateE5Device(i.deviceId, false, i.reason, i.operator, record.commandKey); writeResult = { pendingDeactivate: result.pendingDeactivate }; }
        else { const result = await setE5UserDevicesPaused(i.userId, i.action === "pause", i.reason, i.operator, record.commandKey); writeResult = { changedCount: result.changedCount }; }
        commands.forget(record.fingerprint, record.commandKey);
      } else {
        const originalRiskResponse = await savePhoneRisk(record.payload.revision, record.payload.input, record.commandKey);
        writeResult = { originalRiskResponse };
        commands.forget(record.fingerprint, record.commandKey);
      }
      if (record.payload.kind !== "proposal") {
        // The write receipt settles this command before any independent readback.
        if (active.current) { sync(); setRejected(keys => keys.filter(key => key !== record.commandKey)); }
        try {
          if (record.payload.kind === "device") await fetchE5Devices({ pageNum: 1, pageSize: 10, keyword: record.payload.input.serial }, true);
          else await fetchPhoneRisk();
        } catch {
          writeResult = { ...writeResult, readbackFailed: true };
        }
      }
      if (active.current) { sync(); setNotes(n => ({ ...n, [record.commandKey]: record.payload.kind === "proposal" ? "已提交，等待审批后执行。" : "已取得操作回执，请刷新核对当前值。" })); }
      return writeResult;
    } catch (failure) {
      if (!retry && isExplicitRejection(failure)) commands.forget(record.fingerprint, record.commandKey);
      if (active.current) {
        sync();
        if (retry && isExplicitRejection(failure)) setRejected(r => [...r, record.commandKey]);
        setNotes(n => ({ ...n, [record.commandKey]: isExplicitRejection(failure) ? "原操作重试已被明确拒绝，可核对后解除待确认。" : "原请求已保留，结果仍待核实。" }));
        setTechnicalErrors(n => ({ ...n, [record.commandKey]: JSON.stringify(failure instanceof Error ? { ...failure, name: failure.name, message: failure.message } : failure, null, 2) }));
      }
      throw failure;
    } finally { sending.current = false; if (active.current) setBusy(""); }
  }
  async function start(scope: string, section: E6Section, label: string, payload: Payload) {
    if (sending.current) throw new Error("正在提交原操作，请等待回执。");
    if (locked(scope)) throw new Error("这个对象有原操作待确认，请先核对原操作。");
    const commandKey = createA2CommandKey("e6"), fingerprint = `${owner}|${scope}`;
    const body = JSON.stringify(payload.kind === "risk" ? { ...payload.input, expectedRevision: payload.revision, confirmed: true } : payload.kind === "device" ? payload.input.action === "pause" || payload.input.action === "resume" ? { userId: payload.input.userId, reason: payload.input.reason, operator: payload.input.operator } : { reason: payload.input.reason, operator: payload.input.operator } : payload.input);
    commands.remember(fingerprint, commandKey, { owner, epoch, scope, section, label, payload: JSON.parse(JSON.stringify(payload)), body });
    if (!commands.isDurablyStored(fingerprint, commandKey)) { commands.forget(fingerprint, commandKey); throw new Error("浏览器无法保存原操作，本次未提交。请允许会话存储后重试。"); }
    const saved = commands.list().find(r => r.commandKey === commandKey)!;
    sync(); return await send(saved, false);
  }
  async function proposal(scope: string, section: E6Section, input: ProposalDraft, evidence?: unknown) {
    return start(scope, section, input.action, { kind: "proposal", evidence, input: { ...input, operator: session!.operator || session!.username,
      operatorRole: roleLabel(session!.role), sos: false, roleGate: section === "tasks" ? "另一位有批准权限和任务池修改权限的管理员" : section === "tiers" ? "另一位有批准权限和对应手机收益权限的管理员" : section === "phones" ? "另一位有批准权限和对应设备处置权限的管理员" : "另一位有批准权限和手机配置读取权限的管理员" } });
  }
  async function check(record: E6Pending) {
    setBusy(record.commandKey);
    try {
      const ticket = await fetchA2ProposalByKey(record.commandKey);
      if (!active.current) return;
      if (!ticket || !ticket.mine) { setNotes(n => ({ ...n, [record.commandKey]: "暂未查到原审批单，结果仍未确认；原请求继续保留。" })); return; }
      const terminal = ["approved", "rejected", "withdrawn", "expired"].includes(ticket.status) ? ticket.status : undefined;
      commands.remember(record.fingerprint, record.commandKey, { ...record, ticketId: ticket.id, proposalReceipt: { type: ticket.type, amplifies: ticket.amplifies }, terminal }); sync();
      setNotes(n => ({ ...n, [record.commandKey]: `原提案 ${ticket.id}：${({ pending: "待审批", approved: "已批准，请刷新业务当前值", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" } as Record<string,string>)[ticket.status] ?? ticket.status}` }));
    } catch (failure) { if (active.current) setNotes(n => ({ ...n, [record.commandKey]: displayAdminError(failure) })); }
    finally { if (active.current) setBusy(""); }
  }
  async function checkDirect(record: E6Pending, evidence?: ECommandEvidence) {
    if (!visible(record.section)) throw new Error("COMMAND_INVESTIGATION_FORBIDDEN");
    setBusy(record.commandKey);
    try {
      if (record.payload.kind === "risk") {
        // Records from before bound idempotency have no durable receipt; retain their readback-only policy.
        if (record.payload.receiptVersion !== 1) return null;
        if (evidence) {
          const receipt = await investigateECommand(record, { commandKey: record.commandKey, originalMethod: "PUT",
            originalPath: "/api/admin/config/phone-calibration/risk", originalAdminId: String(record.owner) }, evidence);
          if (eCommandSettled(receipt)) commands.forget(record.fingerprint, record.commandKey);
          return receipt;
        }
        const receipt = await fetchPhoneRiskReceipt(record.commandKey, record.owner);
        if (["SUCCEEDED", "CONFIRMED_SUCCEEDED", "CONFIRMED_NOT_EXECUTED"].includes(receipt.status))
          commands.forget(record.fingerprint, record.commandKey);
        return receipt;
      }
      if (record.payload.kind !== "device") return null;
      const input = record.payload.input;
      const originalPath = input.action === "pause" || input.action === "resume"
        ? `/api/admin/devices/batch/${input.action}` : `/api/admin/devices/${input.deviceId}/${input.action}`;
      const locator = { commandKey: record.commandKey, originalMethod: "POST" as const, originalPath, originalAdminId: String(record.owner) };
      const receipt = evidence ? await investigateECommand(record, locator, evidence) : await discoverECommand(locator);
      if (eCommandSettled(receipt)) commands.forget(record.fingerprint, record.commandKey);
      return receipt;
    } catch (failure) {
      if (active.current) setNotes(n => ({ ...n, [record.commandKey]: displayAdminError(failure) }));
      throw failure;
    } finally { if (active.current) { sync(); setBusy(""); } }
  }
  return { pending, devicePending, legacy, busy, notes, technicalErrors, rejected, release, setRelease, sync, locked, visible, allowed, canRetry, canPropose, canAudit, proposal, start, check, checkDirect, send,
    canInvestigate: canInvestigateECommand("device_e5_read"),
    canInvestigateRisk: canInvestigateECommand("device_e6_read"),
    device: (scope: string, label: string, input: Omit<DeviceInput, "operator">) => start(scope, "phones", label, { kind: "device", input: { ...input, operator: session!.operator || session!.username } }),
    risk: (revision: number, input: PhoneRiskUpdate) => start("risk", "calibration", "保存机型风控设置", { kind: "risk", revision, input: { ...input, reason: input.reason.trim() }, receiptVersion: 1 }),
    legacyPhoneLocked: (serial: string, deviceId: number, userId: string) => legacy.some(r => r.fingerprint.startsWith(`e5-device:${deviceId}:`) || r.fingerprint.startsWith(`e5-user:${userId}:`) || r.fingerprint.startsWith("e5_device_") && r.fingerprint.endsWith(`|${serial}`)),
    pendingReason: (scope: string) => commands.list().find(r => r.owner === owner && r.scope === scope)?.payload.input.reason,
    forget: (record: E6Pending) => { commands.forget(record.fingerprint, record.commandKey); sync(); },
  };
}
export function E6MutationProvider({ children }: { children: ReactNode }) {
  const mutations = useMutations();
  return <Context.Provider value={mutations}>{children}</Context.Provider>;
}
export function useE6Mutations() { return useContext(Context)!; }
const TICKET_TYPE: Record<string, string> = { sos: "应急", fund: "资金类", param: "参数类", acct: "账号/处置" };
/** The backend recomputes the ticket type and amplification; the local preview is not shown as the ticket's verdict. */
function TicketVerdict({ record }: { record: E6Pending }) {
  const receipt = record.proposalReceipt;
  if (!receipt) return null;
  return <span className="e6-ticket-verdict">后端判定：{TICKET_TYPE[receipt.type] ?? receipt.type} · {receipt.amplifies ? "会让平台多付钱，执行时检查兑付覆盖率" : "不会让平台多付钱"}</span>;
}
const RISK_STATUS: Partial<Record<PhoneRiskReceipt["status"], { tone: "progress" | "warn" | "neutral"; title: string; text: string }>> = {
  PROCESSING: { tone: "progress", title: "原保存仍在处理", text: "后端还在保存，稍后再查；不要重复保存。" },
  UNKNOWN: { tone: "warn", title: "后端结果仍未知", text: "原操作的处理过程中断，按原操作重试只会得到同样的结果；需要按证据核查结案。" },
  FAILED: { tone: "neutral", title: "原保存以失败结束", text: "后端记录了这次失败。24 小时内可以按原操作重试，后端会用原命令号再执行一次。" },
};
type RiskDone = { key: string; status: PhoneRiskReceipt["status"] | "RETRIED"; revision?: number };
export function E6PendingNotice({ section, onRead }: { section: E6Section; onRead?: (result?: E6WriteReceipt) => void }) {
  const m = useE6Mutations();
  const records = m.pending.filter(r => r.section === section && m.visible(section));
  const waiting = records.filter(r => r.ticketId && !r.terminal);
  const [outcomes, setOutcomes] = useState<Record<string, CommandOutcome>>({});
  const [riskReceipts, setRiskReceipts] = useState<Record<string, PhoneRiskReceipt>>({});
  const [settled, setSettled] = useState<SettledCommand[]>([]);
  const [riskDone, setRiskDone] = useState<RiskDone[]>([]);
  const [closing, setClosing] = useState<E6Pending | null>(null);
  // A later successful lookup supersedes the failure note an earlier lookup left on the same record.
  const [answered, setAnswered] = useState<Record<string, string | undefined>>({});
  const showDevice = (record: E6Pending, receipt: ECommandInvestigation | null) => {
    setAnswered(values => ({ ...values, [record.commandKey]: m.notes[record.commandKey] }));
    if (receipt && eCommandSettled(receipt)) {
      const status = receipt.originalStatus;
      setSettled(rows => [...rows.filter(row => row.key !== record.commandKey), { key: record.commandKey, label: record.label, status }]);
    } else setOutcomes(values => ({ ...values, [record.commandKey]: { receipt } }));
  };
  const showRisk = (record: E6Pending, receipt: PhoneRiskReceipt | null) => {
    if (!receipt) return;
    setAnswered(values => ({ ...values, [record.commandKey]: m.notes[record.commandKey] }));
    if (["SUCCEEDED", "CONFIRMED_SUCCEEDED", "CONFIRMED_NOT_EXECUTED"].includes(receipt.status))
      setRiskDone(rows => [...rows.filter(row => row.key !== record.commandKey), { key: record.commandKey, status: receipt.status, revision: receipt.originalResponse?.settings.revision }]);
    else setRiskReceipts(values => ({ ...values, [record.commandKey]: receipt }));
  };
  return <>
    <SettledCommandNotices items={settled} onDismiss={key => setSettled(rows => rows.filter(row => row.key !== key))} />
    {riskDone.map(done => <Notice key={done.key} tone="done" title={<>保存机型风控设置 · <span className="rd-keep">{done.status === "CONFIRMED_NOT_EXECUTED" ? "核查确认原保存没有执行" : "原保存已完成"}</span></>} action={<Button size="sm" onClick={() => setRiskDone(rows => rows.filter(row => row.key !== done.key))}>知道了</Button>}>
      {done.status === "CONFIRMED_NOT_EXECUTED" ? <p>本页待确认已解除，可以重新修改风控设置。</p> : <>
        {done.revision !== undefined ? <p>原保存完成后的版本是 {done.revision}。</p> : done.status !== "RETRIED" && <p>原回执没有带回保存后的设置。</p>}
        <p>当前设置已重新读取，以下方「机型风控」显示的版本和设置为准；这期间可能有人改过。</p>
      </>}
    </Notice>)}
    {section === "phones" && m.devicePending.map(r => <Notice key={r.commandKey} tone="warn" title={`${r.label} · 设备管理有原操作待核对`}><p>原对象、内容、理由和命令号在设备管理保留，请回原页面核对。相关设备或整用户的新操作继续暂停。</p><Link className="rd-link" href="/devices/ops">设备管理</Link></Notice>)}
    {waiting.length === 1 && <Notice tone="progress" action={<Button size="sm" disabled={!!m.busy} onClick={() => void m.check(waiting[0])}>查审批结果</Button>}><p>{waiting[0].label}的变更已提交，等待审批 · <span data-mono>{waiting[0].ticketId}</span></p><TicketVerdict record={waiting[0]} /></Notice>}
    {waiting.length > 1 && <Notice tone="progress"><Fold title={`${waiting.length} 项变更等待审批`} summary="展开查看审批单" inset><div className="e6-pending-list">{waiting.map(r => <div key={r.commandKey} className="e6-pending-row"><span className="e6-pending-ticket"><span>{r.label} · <span data-mono>{r.ticketId}</span></span><TicketVerdict record={r} /></span><Button size="sm" disabled={!!m.busy} onClick={() => void m.check(r)}>查审批结果</Button></div>)}</div></Fold></Notice>}
    {records.filter(r => !r.ticketId || r.terminal).map(r => <Notice key={r.commandKey} tone={r.terminal ? "done" : "warn"} title={<>{r.label} · <span className="rd-keep">{r.terminal ? "原提案已结束" : m.rejected.includes(r.commandKey) ? "原操作重试已被明确拒绝" : "结果未确认，请先核对原操作"}</span></>} actionBelow action={<>
      {r.payload.kind === "proposal" && <Button size="sm" disabled={!!m.busy} onClick={() => void m.check(r)}>查审批结果</Button>}
      {r.payload.kind === "device" && <Button size="sm" disabled={!!m.busy} onClick={() => { void m.checkDirect(r).then(receipt => showDevice(r, receipt as ECommandInvestigation | null), () => { /* checkDirect keeps the query failure in the notice. */ }).finally(() => onRead?.()); }}>查原操作结果</Button>}
      {r.payload.kind !== "risk" && !r.ticketId && !isRetryExpired(r) && !m.rejected.includes(r.commandKey) && <Button size="sm" disabled={!m.allowed(r) || !!m.busy} onClick={() => { void m.send(r, true).then(onRead).catch(() => { /* send has recorded the failure in the persistent notice. */ }); }}>按原操作重试</Button>}
      {r.payload.kind === "risk" && <Button size="sm" disabled={!!m.busy} onClick={() => { void m.checkDirect(r).then(receipt => showRisk(r, receipt as PhoneRiskReceipt | null), () => { /* The original notice retains the query failure. */ }).finally(() => window.dispatchEvent(new Event("e6-read-risk"))); }}>{r.payload.receiptVersion === 1 ? "查原保存结果" : "读取当前风控设置"}</Button>}
      {r.payload.kind === "risk" && m.canRetry(r) && !m.rejected.includes(r.commandKey) && <Button size="sm" disabled={!!m.busy} onClick={() => { void m.send(r, true).then(result => { setRiskDone(rows => [...rows.filter(row => row.key !== r.commandKey), { key: r.commandKey, status: "RETRIED", revision: result?.originalRiskResponse?.settings.revision }]); window.dispatchEvent(new Event("e6-read-risk")); onRead?.(result); }).catch(() => { /* send has recorded the failure in the persistent notice. */ }); }}>按原操作重试</Button>}
      {r.payload.kind === "risk" && r.payload.receiptVersion === 1 && m.canInvestigateRisk && riskReceipts[r.commandKey]?.status !== "PROCESSING" && (closureOpen(outcomes[r.commandKey], isRetryExpired(r)) || riskReceipts[r.commandKey]?.status === "UNKNOWN") && <Button size="sm" variant="danger-outline" disabled={!!m.busy} onClick={() => setClosing(r)}>核查结案</Button>}
      {r.payload.kind === "device" && m.canInvestigate && closureOpen(outcomes[r.commandKey], isRetryExpired(r)) && <Button size="sm" variant="danger-outline" disabled={!!m.busy} onClick={() => setClosing(r)}>核查结案</Button>}
      {r.terminal && <Button size="sm" onClick={() => { m.forget(r); onRead?.(); }}>原提案已结束，准备新变更</Button>}
      {m.rejected.includes(r.commandKey) && <Button variant="primary" size="sm" onClick={() => m.setRelease(r)}>解除待确认</Button>}
      {m.canAudit && <Link href="/platform/audit?domain=E">核对操作记录与审批</Link>}
    </>}>
      {!r.terminal && <p>原内容、理由和命令号已保存，这个对象暂不能提交新变更。{r.payload.kind === "risk" ? r.payload.receiptVersion === 1 ? isRetryExpired(r) ? "后端按命令号保留原保存结果，请先查原保存结果。当前设置相同不能证明原保存成功。" : "后端按命令号去重：先查原保存结果，也可以按原操作重试，不会重复保存。当前设置相同不能证明原保存成功。" : "这是升级前的记录，后端没有它的回执，只能读取当前设置核对；当前设置相同不能证明原保存成功。" : m.rejected.includes(r.commandKey) ? "请核对拒绝结果，再解除这条原操作。" : r.payload.kind === "device" ? "先查原操作结果；重试只能使用原内容、原理由和原命令号。" : "重试只能使用原内容、原理由和原命令号。"}</p>}
      {isRetryExpired(r) && <p>{RETRY_EXPIRED_TEXT}</p>}{m.notes[r.commandKey] && m.notes[r.commandKey] !== answered[r.commandKey] && !["原请求已保留，结果仍待核实。","原操作重试已被明确拒绝，可核对后解除待确认。"].includes(m.notes[r.commandKey]) && <p>{m.notes[r.commandKey]}</p>}
      {r.payload.kind === "device" && <CommandOutcomeLine outcome={outcomes[r.commandKey]} expired={isRetryExpired(r)} />}
      {r.payload.kind === "device" && !m.canInvestigate && closureOpen(outcomes[r.commandKey], isRetryExpired(r)) && <ClosureContact />}
      {r.payload.kind === "risk" && !outcomes[r.commandKey] && riskReceipts[r.commandKey] && RISK_STATUS[riskReceipts[r.commandKey].status] && <div className="e-check-outcome" role="status"><StatusTag tone={RISK_STATUS[riskReceipts[r.commandKey].status]!.tone}>{RISK_STATUS[riskReceipts[r.commandKey].status]!.title}</StatusTag><p>{RISK_STATUS[riskReceipts[r.commandKey].status]!.text}</p></div>}
      {r.payload.kind === "risk" && outcomes[r.commandKey] && <CommandOutcomeLine outcome={outcomes[r.commandKey]} expired={isRetryExpired(r)} />}
      {r.payload.kind === "risk" && r.payload.receiptVersion === 1 && !m.canInvestigateRisk && (closureOpen(outcomes[r.commandKey], isRetryExpired(r)) || riskReceipts[r.commandKey]?.status === "UNKNOWN") && <ClosureContact />}
      <Fold title="原操作与技术信息" summary={r.commandKey} inset><div className="e6-fold-content"><p>命令号：<code>{r.commandKey}</code></p><p>发起：{formatBusinessTimeCompact(new Date(r.createdAt).toISOString(), "—")}（北京时间）</p><p>原对象：{r.label}</p>{r.payload.kind === "device" && <p>原状态：{r.payload.input.before}</p>}<p>理由：{r.payload.input.reason}</p><pre className="e6-json">{JSON.stringify({ scope: r.scope, request: JSON.parse(r.body) }, null, 2)}</pre>{m.technicalErrors[r.commandKey] && <pre className="e6-json">{m.technicalErrors[r.commandKey]}</pre>}</div></Fold>
    </Notice>)}
    {m.legacy.filter(r => section === "tasks" ? r.fingerprint.startsWith("e2_task_") : section === "tiers" ? r.fingerprint.startsWith("e2_phone_tier") : section === "phones" ? r.fingerprint.startsWith("e5") : r.fingerprint.startsWith("e6_")).map(r => <Notice key={r.commandKey} tone="warn" title="升级前的原提案待核查"><p>旧记录缺少完整内容与理由，只能凭原命令号到操作记录与审批核对，不能重试或解除。原命令号：{r.commandKey}</p></Notice>)}
    {closing && (closing.payload.kind === "device" || closing.payload.kind === "risk") && <CommandClosureModal label={closing.label} commandKey={closing.commandKey} createdAt={closing.createdAt}
      facts={<>{closing.payload.kind === "device" && <Fact k="原状态">{closing.payload.input.before}</Fact>}<Fact k="原理由">{closing.payload.input.reason}</Fact></>}
      onClose={() => setClosing(null)} onSubmit={async evidence => {
        const receipt = await m.checkDirect(closing, evidence) as ECommandInvestigation | null;
        showDevice(closing, receipt);
        if (closing.payload.kind === "risk") {
          window.dispatchEvent(new Event("e6-read-risk"));
        }
        setClosing(null); onRead?.();
      }} />}
    {m.release?.section === section && <ReleaseModal label={m.release.label} onCancel={() => m.setRelease(null)} onConfirm={() => { m.forget(m.release!); m.setRelease(null); onRead?.(); }} />}
  </>;
}
