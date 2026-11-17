"use client";
import { eCommandClosureOffer } from "@/lib/admin/e-command-investigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { SearchCheck } from "lucide-react";
import Link from "next/link";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { roleLabel } from "@/lib/nav/console-nav";
import { A2OutcomeUncertainError, createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { isRetryExpired, RETRY_EXPIRED_TEXT, hasPersistedPendingCommandOwner } from "@/lib/admin/pending-mutation-store";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isDeterministicRejection, isIdempotencyOutcomeOpen } from "@/lib/admin/outcome-classification";
import { eDomainLegacyCommands as legacyCommands, e5LegacyCommands as legacyPhones } from "@/lib/admin/e-domain-commands";
import { e5Commands, type E5Command } from "@/lib/admin/e5-command";
import { e6Commands as commands, type E6DeviceInput as DeviceInput, type E6Payload as Payload, type E6Pending, type E6Proposal, type E6Section } from "@/lib/admin/e6-command";
import { displayAdminError } from "@/lib/admin/error-messages";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { activateE5Device, deactivateE5Device, setE5UserDevicesPaused, fetchE5Devices } from "@/lib/admin/e5-client";
import { savePhoneRisk, fetchPhoneRisk, fetchPhoneRiskReceipt, type PhoneRiskReceipt, type PhoneRiskOverview, type PhoneRiskUpdate } from "@/lib/admin/phone-risk-client";
import { canInvestigateECommand, discoverECommand, investigateECommand, eCommandSettled, type ECommandEvidence, type ECommandInvestigation } from "@/lib/admin/e-command-investigation";
import { Button, Explain, Notice, Fold, ReleaseModal, StatusTag, Fact } from "@/app/components/rd";
import { ClosureContact, CommandClosureModal, CommandOutcomeLine, commandOutcomeSummary, MissingProposalReleaseModal, PROPOSAL_END, RECOVERY_LINE, RecoveryPanel, SettledLine, closureOpen, eReadError, recoveryTitle, type CommandOutcome, type RecoveryItem } from "./e-command-check";
import { SETTLED_REJECTED, businessCodeOf } from "../recovery-panel";
import type { ToastKind } from "@/lib/store/ui";

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
    const saved = commands.list().filter(r => r.owner === owner);
    setPending(saved);
    setRejected(saved.filter(r => r.retryRejection).map(r => r.commandKey));
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
    record = { ...record, retryRejection: undefined, absent: false };
    commands.remember(record.fingerprint, record.commandKey, record);
    if (!commands.isDurablyStored(record.fingerprint, record.commandKey)) throw new Error(retry ? "浏览器没能记下这次操作，这次没有发出；之前发出的原操作结果仍未知，请先查询原结果。" : "浏览器没能记下这次操作，这次没有发出；请关闭无痕模式或允许本站保存数据后再试。");
    sending.current = true; setBusy(record.commandKey);
    let checkingProposal = retry && record.payload.kind === "proposal";
    try {
      if (retry && record.payload.kind === "proposal") {
        const ticket = await fetchA2ProposalByKey(record.commandKey, true, "f");
        if (ticket) {
          if (!ticket.mine || ticket.obj !== record.payload.input.obj) throw new Error("原提案归属无法核实，请到操作记录核对。");
          commands.remember(record.fingerprint, record.commandKey, { ...record, absent: false, retryRejection: undefined, ticketId: ticket.id, proposalReceipt: { type: ticket.type, amplifies: ticket.amplifies }, terminal: ["approved", "rejected", "withdrawn", "expired"].includes(ticket.status) ? ticket.status : undefined });
          if (active.current) sync();
          return;
        }
      }
      checkingProposal = false;
      let writeResult: E6WriteReceipt | undefined;
      if (record.payload.kind === "proposal") {
        const ticket = await createA2OperationProposal(record.payload.input, record.commandKey, true);
        commands.remember(record.fingerprint, record.commandKey, { ...record, absent: false, retryRejection: undefined, ticketId: ticket.id, proposalReceipt: { type: ticket.type, amplifies: ticket.amplifies } });
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
      if (active.current) { sync(); setNotes(n => ({ ...n, [record.commandKey]: record.payload.kind === "proposal" ? "已提交，等待审批后执行。" : "已提交成功，请刷新核对当前值。" })); }
      return writeResult;
    } catch (failure) {
      const response = failure as { status?: number; httpStatus?: number; apiCode?: number; backendMessage?: string };
      const firstRejection = !retry && !isA2OutcomeUncertainError(failure) && !!response.backendMessage
        && !isIdempotencyOutcomeOpen(response.backendMessage) && Number.isInteger(response.apiCode)
        && response.apiCode! < 500 && response.status !== undefined
        && isDeterministicRejection(response.httpStatus ?? response.status, response.apiCode);
      if (firstRejection) commands.forget(record.fingerprint, record.commandKey);
      else if (!checkingProposal && retry && isExplicitRejection(failure)) commands.remember(record.fingerprint, record.commandKey, {
        ...record, retryRejection: displayAdminError(failure),
      });
      if (active.current) {
        sync();
        if (!checkingProposal && retry && isExplicitRejection(failure)) setRejected(r => [...r, record.commandKey]);
        setNotes(n => ({ ...n, [record.commandKey]: !checkingProposal && isExplicitRejection(failure) ? "按原请求重试被明确拒绝，核对后可以解除这条记录。" : "原请求已保留，结果仍待核实。" }));
        setTechnicalErrors(n => ({ ...n, [record.commandKey]: JSON.stringify(failure instanceof Error ? { ...failure, name: failure.name, message: failure.message } : failure, null, 2) }));
      }
      throw failure;
    } finally { sending.current = false; if (active.current) setBusy(""); }
  }
  async function start(scope: string, section: E6Section, label: string, payload: Payload) {
    if (sending.current) throw new Error("正在提交原操作，请等结果。");
    if (locked(scope)) throw new Error("这个对象有结果未知的原操作，请先核对原操作。");
    const commandKey = createA2CommandKey("e6"), fingerprint = `${owner}|${scope}`;
    const body = JSON.stringify(payload.kind === "risk" ? { ...payload.input, expectedRevision: payload.revision, confirmed: true } : payload.kind === "device" ? payload.input.action === "pause" || payload.input.action === "resume" ? { userId: payload.input.userId, reason: payload.input.reason, operator: payload.input.operator } : { reason: payload.input.reason, operator: payload.input.operator } : payload.input);
    commands.remember(fingerprint, commandKey, { owner, epoch, scope, section, label, payload: JSON.parse(JSON.stringify(payload)), body });
    if (!commands.isDurablyStored(fingerprint, commandKey)) { commands.forget(fingerprint, commandKey); throw new Error("浏览器没能记下这次操作，这次没有发出；请关闭无痕模式或允许本站保存数据后再试。"); }
    const saved = commands.list().find(r => r.commandKey === commandKey)!;
    sync(); return await send(saved, false);
  }
  async function proposal(scope: string, section: E6Section, input: ProposalDraft, evidence?: unknown) {
    return start(scope, section, input.action, { kind: "proposal", evidence, input: { ...input, operator: session!.operator || session!.username,
      operatorRole: roleLabel(session!.role), sos: false, roleGate: section === "tasks" ? "另一位有批准权限和任务池修改权限的管理员" : section === "tiers" ? "另一位有批准权限和对应手机收益权限的管理员" : section === "phones" ? "另一位有批准权限和对应设备处置权限的管理员" : "另一位有批准权限和手机配置读取权限的管理员" } });
  }
  async function check(record: E6Pending, propagate = false) {
    if (record.owner !== useAdminAuth.getState().session?.adminId || record.payload.kind !== "proposal") throw new Error("原提案归属无法核实，请到操作记录核对。");
    commands.remember(record.fingerprint, record.commandKey, { ...record, absent: false }); sync();
    setBusy(record.commandKey);
    try {
      const ticket = await fetchA2ProposalByKey(record.commandKey, true, "f");
      if (!active.current) return;
      if (!ticket && record.ticketId) throw new A2OutcomeUncertainError("原提案归属无法核实，请到操作记录核对。", record.commandKey);
      if (ticket && (!ticket.mine || ticket.obj !== record.payload.input.obj || record.ticketId && ticket.id !== record.ticketId)) throw new A2OutcomeUncertainError("原提案归属无法核实，请到操作记录核对。", record.commandKey);
      if (!ticket) { commands.remember(record.fingerprint, record.commandKey, { ...record, absent: true }); sync(); setNotes(n => ({ ...n, [record.commandKey]: "刚查过：没有这张审批单。" })); return; }
      const terminal = ["approved", "rejected", "withdrawn", "expired"].includes(ticket.status) ? ticket.status : undefined;
      commands.remember(record.fingerprint, record.commandKey, { ...record, absent: false, retryRejection: undefined, ticketId: ticket.id, proposalReceipt: { type: ticket.type, amplifies: ticket.amplifies }, terminal }); sync();
      setNotes(n => ({ ...n, [record.commandKey]: `审批单 ${ticket.id} ${({ pending: "还在等批准", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" } as Record<string,string>)[ticket.status] ?? "状态待核实"}` }));
    } catch (failure) { if (active.current) setNotes(n => ({ ...n, [record.commandKey]: record.ticketId ? TICKET_UNREAD : eReadError(failure) })); if (propagate) throw failure; }
    finally { if (active.current) setBusy(""); }
  }
  async function releaseMissing(record: E6Pending) {
    if (record.payload.kind !== "proposal" || !isRetryExpired(record) || record.ticketId) throw new Error("原操作仅可核查，不能重新发送。");
    await check(record, true);
    const current = commands.list().find(r => r.commandKey === record.commandKey && r.owner === owner);
    if (current?.absent && !current.ticketId) { commands.forget(current.fingerprint, current.commandKey); sync(); return true; }
    return false;
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
      if (active.current) setNotes(n => ({ ...n, [record.commandKey]: eReadError(failure) }));
      throw failure;
    } finally { if (active.current) { sync(); setBusy(""); } }
  }
  return { pending, devicePending, legacy, busy, notes, technicalErrors, rejected, release, setRelease, sync, locked, visible, allowed, canRetry, canPropose, canAudit, proposal, start, check, releaseMissing, checkDirect, send,
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
const TICKET_UNREAD = "这次没查到审批进度；审批单已经建了，稍后再查，不会再建一张。";
const TICKET_TYPE: Record<string, string> = { sos: "应急", fund: "资金类", param: "参数类", acct: "账号/处置" };
/** The backend recomputes the ticket type and amplification; the local preview is not shown as the ticket's verdict. */
function TicketVerdict({ record }: { record: E6Pending }) {
  const receipt = record.proposalReceipt;
  if (!receipt) return null;
  return <span className="e6-ticket-verdict">系统判定：{TICKET_TYPE[receipt.type] ?? receipt.type} · {receipt.amplifies ? "会让平台多付钱，执行时检查兑付覆盖率" : "不会让平台多付钱"}</span>;
}
const RISK_STATUS: Partial<Record<PhoneRiskReceipt["status"], { tone: "progress" | "warn" | "neutral"; title: string; text: string }>> = {
  PROCESSING: { tone: "progress", title: "原保存仍在处理", text: "还在保存，稍后再查；不要重复保存。" },
  UNKNOWN: { tone: "warn", title: "结果仍未知", text: "原保存中途中断，再按原请求重试也是同样结果，需要按证据核查结案。" },
  FAILED: { tone: "neutral", title: "原保存以失败结束", text: "原保存没有成功。24 小时内可以按原请求重试，会按原内容再执行一次。" },
};
const GENERIC_NOTES = ["原请求已保留，结果仍待核实。", "按原请求重试被明确拒绝，核对后可以解除这条记录。", "已提交，等待审批后执行。"];
export function E6PendingNotice({ section, onRead, toast }: { section: E6Section; onRead?: (result?: E6WriteReceipt) => void; toast: (message: string, kind?: ToastKind) => void }) {
  const m = useE6Mutations();
  const records = m.pending.filter(r => r.section === section && m.visible(section));
  const [outcomes, setOutcomes] = useState<Record<string, CommandOutcome>>({});
  /** Records the lookup found settled: one light line each above the panel until dismissed. */
  const [settled, setSettled] = useState<{ key: string; label: string; text: string }[]>([]);
  const settle = (record: E6Pending, text: string) => setSettled(list => [...list.filter(item => item.key !== record.commandKey), { key: record.commandKey, label: record.label, text }]);
  // Another operator signing in on the same mount must not see the previous operator's settled lines.
  const operator = useAdminAuth(s => `${s.session?.adminId ?? ""}|${s.authEpoch}`);
  useEffect(() => { setSettled([]); }, [operator]);
  const [riskReceipts, setRiskReceipts] = useState<Record<string, PhoneRiskReceipt>>({});
  const [closing, setClosing] = useState<E6Pending | null>(null);
  // A later successful lookup supersedes the failure note an earlier lookup left on the same record.
  const [answered, setAnswered] = useState<Record<string, string | undefined>>({});
  const showDevice = (record: E6Pending, receipt: ECommandInvestigation | null) => {
    setAnswered(values => ({ ...values, [record.commandKey]: m.notes[record.commandKey] }));
    if (receipt && eCommandSettled(receipt)) {
      const status = receipt.originalStatus;
      settle(record, status === "CONFIRMED_REJECTED" ? SETTLED_REJECTED : status === "CONFIRMED_NOT_EXECUTED" ? "核查确认没有执行，记录已解除，可以重新发起。" : status === "CONFIRMED_SUCCEEDED" ? "核查确认已执行，记录已解除，不要再做一次。" : "原操作已执行，记录已解除，不要再做一次。");
    } else setOutcomes(values => ({ ...values, [record.commandKey]: { receipt } }));
  };
  const riskDone = (status: PhoneRiskReceipt["status"] | "RETRIED") => toast(status === "CONFIRMED_NOT_EXECUTED"
    ? "核查确认原保存没有执行，可以重新修改风控设置。" : "原保存已完成；设置已重新读取，以「机型风控」显示的为准。", "success");
  const showRisk = (record: E6Pending, receipt: PhoneRiskReceipt | null) => {
    if (!receipt) return;
    setAnswered(values => ({ ...values, [record.commandKey]: m.notes[record.commandKey] }));
    if (["SUCCEEDED", "CONFIRMED_SUCCEEDED", "CONFIRMED_NOT_EXECUTED"].includes(receipt.status)) settle(record, receipt.status === "CONFIRMED_NOT_EXECUTED" ? "核查确认原保存没有执行，记录已解除，可以重新修改风控设置。" : "原保存已完成，记录已解除；设置以「机型风控」显示的为准。");
    else setRiskReceipts(values => ({ ...values, [record.commandKey]: receipt }));
  };
  const noteOf = (r: E6Pending) => m.notes[r.commandKey] && m.notes[r.commandKey] !== answered[r.commandKey] && !GENERIC_NOTES.includes(m.notes[r.commandKey]) ? m.notes[r.commandKey]
    : m.rejected.includes(r.commandKey) ? r.retryRejection : undefined;
  const technical = (r: E6Pending) => <div className="e6-fold-content"><p>原请求编号：<code>{r.commandKey}</code></p><p>原对象：{r.label}</p>{r.payload.kind === "device" && <p>原状态：{r.payload.input.before}</p>}{businessCodeOf(outcomes[r.commandKey]) !== undefined && <p>业务码：<code>{businessCodeOf(outcomes[r.commandKey])}</code></p>}<pre className="e6-json">{JSON.stringify({ scope: r.scope, request: JSON.parse(r.body) }, null, 2)}</pre>{m.technicalErrors[r.commandKey] && <pre className="e6-json">{m.technicalErrors[r.commandKey]}</pre>}</div>;
  const items: RecoveryItem[] = [
    ...(section === "phones" ? m.devicePending.map(r => ({ key: r.commandKey, object: r.label, tag: <StatusTag tone="warn">待核对</StatusTag>,
      line: "原操作在设备管理，到那里查询和处理。", actions: <Link className="rd-link" href="/devices/ops">设备管理</Link>,
      detail: <p>原操作在设备管理保留；相关设备或用户先暂停新操作。</p> })) : []),
    ...records.map(r => {
      const expired = isRetryExpired(r), refused = m.rejected.includes(r.commandKey), waiting = !!r.ticketId && !r.terminal, end = r.terminal ? PROPOSAL_END[r.terminal] : undefined;
      const state = end ? { tag: end.tag, tone: end.tone, line: end.text, more: "按「准备新变更」清掉这条后，这一项可以重新提交。" }
        : waiting ? m.notes[r.commandKey] === TICKET_UNREAD ? { tag: "进度没读到", tone: "warn" as const, line: RECOVERY_LINE.created, more: `审批单 ${r.ticketId} 已经建了，批没批准还没查到；点「查询审批结果」再查，不会再建一张。` }
          : { tag: "待审批", tone: "warn" as const, line: RECOVERY_LINE.pending, more: `审批单 ${r.ticketId}。` }
          : refused ? { tag: "重试被拒绝", tone: "danger" as const, line: RECOVERY_LINE.refused, more: "按原请求重试被明确拒绝；核对拒绝原因后，可以解除这条记录。" }
            : r.payload.kind === "proposal" ? r.absent ? expired ? { tag: "没有建成", tone: "warn" as const, line: RECOVERY_LINE.missing, more: "按原请求查不到这张审批单，说明没建成；确认解除时会再查一次。" }
              : { tag: "结果未知", tone: "warn" as const, line: RECOVERY_LINE.absent, more: "按原请求查不到这张审批单，现在还没建成；按原请求重试不会重复建单。" }
              : { tag: "结果未知", tone: "warn" as const, line: expired ? RECOVERY_LINE.expired : RECOVERY_LINE.unknown, more: expired ? "已超过 24 小时，不能再重试；查不到这张审批单时可以确认解除。" : "可以查询原结果，或按原请求重试；重试只发原内容和原理由，不会重复建单。" }
              : r.payload.kind === "risk" ? { tag: "结果未知", tone: "warn" as const, line: r.payload.receiptVersion !== 1 ? "旧记录查不到原结果，只能读取现在的设置。" : expired ? RECOVERY_LINE.expired : "先查询原结果；重试不会重复保存。",
                more: "现在的设置一样，也不代表原保存成功了。" }
                : { tag: "结果未知", tone: "warn" as const, line: expired ? RECOVERY_LINE.expired : RECOVERY_LINE.direct, more: expired ? "已超过 24 小时，不能再重试；现在的状态不代表原操作的结果。" : "可以查询原结果，或按原请求重试；重试只发原内容和原理由。" };
      const riskShown = r.payload.kind === "risk" && !outcomes[r.commandKey] && riskReceipts[r.commandKey] ? RISK_STATUS[riskReceipts[r.commandKey].status] : undefined;
      const note = <>
        {noteOf(r) && <span>{noteOf(r)}</span>}
        {(r.payload.kind === "device" || r.payload.kind === "risk" && outcomes[r.commandKey]) && <CommandOutcomeLine outcome={outcomes[r.commandKey]} expired={expired} summarized={!refused} />}
        {riskShown && <div className="e-check-outcome"><StatusTag tone={riskShown.tone}>{riskShown.title}</StatusTag><p>{riskShown.text}</p></div>}
        {r.payload.kind === "device" && !m.canInvestigate && closureOpen(outcomes[r.commandKey], expired) && <ClosureContact />}
        {r.payload.kind === "risk" && r.payload.receiptVersion === 1 && !m.canInvestigateRisk && closureOpen(outcomes[r.commandKey], expired) && <ClosureContact />}
      </>;
      return { key: waiting ? `waiting:${r.commandKey}` : r.commandKey, object: r.label, createdAt: r.createdAt, tag: <StatusTag tone={state.tone}>{state.tag}</StatusTag>, line: state.line,
        result: (r.payload.kind === "device" || r.payload.kind === "risk") && !refused ? commandOutcomeSummary(outcomes[r.commandKey], expired) : undefined,
        note: noteOf(r) || outcomes[r.commandKey] || riskShown || closureOpen(outcomes[r.commandKey], expired) ? note : undefined,
        noteKey: [noteOf(r) ?? "", outcomes[r.commandKey] ? JSON.stringify(outcomes[r.commandKey]) : "", riskReceipts[r.commandKey]?.status ?? ""].join("|").replace(/^\|+$/, ""),
        actions: <>
          {r.payload.kind === "proposal" && <Button size="sm" icon={<SearchCheck size={14} aria-hidden />} disabled={!!m.busy} onClick={() => void m.check(r)}>{waiting ? "查询审批结果" : "查询原结果"}</Button>}
          {r.payload.kind === "device" && <Button size="sm" icon={<SearchCheck size={14} aria-hidden />} disabled={!!m.busy} onClick={() => { void m.checkDirect(r).then(receipt => showDevice(r, receipt as ECommandInvestigation | null), () => { /* checkDirect keeps the query failure on the row. */ }).finally(() => onRead?.()); }}>查询原结果</Button>}
          {r.payload.kind === "risk" && <Button size="sm" icon={<SearchCheck size={14} aria-hidden />} disabled={!!m.busy} onClick={() => { void m.checkDirect(r).then(async receipt => {
            showRisk(r, receipt as PhoneRiskReceipt | null);
            if (r.payload.kind !== "risk" || r.payload.receiptVersion !== 1 || !receipt || ["SUCCEEDED", "CONFIRMED_SUCCEEDED", "CONFIRMED_NOT_EXECUTED"].includes((receipt as PhoneRiskReceipt).status)) return;
            try {
              const original = await discoverECommand({ commandKey: r.commandKey, originalMethod: "PUT", originalPath: "/api/admin/config/phone-calibration/risk", originalAdminId: String(r.owner) });
              showDevice(r, original);
            } catch (failure) { setOutcomes(values => ({ ...values, [r.commandKey]: { error: eReadError(failure) } })); }
          }, () => { /* The row retains the query failure. */ }).finally(() => window.dispatchEvent(new Event("e6-read-risk"))); }}>{r.payload.receiptVersion === 1 ? "查询原结果" : "读取当前风控设置"}</Button>}
          {r.payload.kind === "device" && m.canInvestigate && closureOpen(outcomes[r.commandKey], expired) && <Button size="sm" variant="danger-outline" disabled={!!m.busy} onClick={() => setClosing(r)}>核查结案</Button>}
          {r.payload.kind === "risk" && r.payload.receiptVersion === 1 && m.canInvestigateRisk && closureOpen(outcomes[r.commandKey], expired) && <Button size="sm" variant="danger-outline" disabled={!!m.busy} onClick={() => setClosing(r)}>核查结案</Button>}
          {r.payload.kind !== "risk" && !r.ticketId && !expired && !refused && <Button size="sm" disabled={!m.allowed(r) || !!m.busy} onClick={() => { void m.send(r, true).then(onRead).catch(() => { /* send has recorded the failure on the row. */ }); }}>按原请求重试</Button>}
          {r.payload.kind === "risk" && m.canRetry(r) && !refused && <Button size="sm" disabled={!!m.busy} onClick={() => { void m.send(r, true).then(result => { riskDone("RETRIED"); window.dispatchEvent(new Event("e6-read-risk")); onRead?.(result); }).catch(() => { /* send has recorded the failure on the row. */ }); }}>按原请求重试</Button>}
          {r.terminal && <Button size="sm" onClick={() => { m.forget(r); onRead?.(); }}>准备新变更</Button>}
          {(refused || r.payload.kind === "proposal" && r.absent && !r.ticketId && expired) && <Button size="sm" onClick={() => m.setRelease(r)}>解除原操作记录</Button>}
        </>,
        detail: <><p>{formatBusinessTimeCompact(new Date(r.createdAt).toISOString(), "—")} 提交，理由：{r.payload.input.reason}</p><p>{state.more}</p><TicketVerdict record={r} /></>, tech: <Fold inset title="技术信息" summary={r.commandKey}>{technical(r)}</Fold> };
    }),
    ...m.legacy.filter(r => section === "tasks" ? r.fingerprint.startsWith("e2_task_") : section === "tiers" ? r.fingerprint.startsWith("e2_phone_tier") : section === "phones" ? r.fingerprint.startsWith("e5") : r.fingerprint.startsWith("e6_")).map(r => ({
      key: r.commandKey, object: "升级前的原提案", tag: <StatusTag tone="warn">缺完整原请求</StatusTag>,
      line: "旧记录缺原请求，不能重试或解除；到操作记录与审批核对。",
      detail: <p>原请求编号：<code>{r.commandKey}</code></p> })),
  ];
  const release = m.release?.section === section ? m.release : null;
  return <>
    {settled.map(item => <SettledLine key={item.key} label={item.label} text={item.text} onDismiss={() => setSettled(list => list.filter(other => other.key !== item.key))} />)}
    <RecoveryPanel title={recoveryTitle(items.length - items.filter(item => item.key.startsWith("waiting:")).length - records.filter(r => r.terminal).length, items.filter(item => item.key.startsWith("waiting:")).length, records.filter(r => r.terminal).length)} tone="warn"
      explain="原内容和理由都已保存；有结论前，这些对象不能提交新修改。点行首的箭头看提交时间、说明和原请求。" foot={m.canAudit ? <Link className="rd-link" href="/platform/audit?domain=E">到操作记录与审批核对</Link> : undefined} items={items} />
    {closing && (closing.payload.kind === "device" || closing.payload.kind === "risk") && <CommandClosureModal label={closing.label} commandKey={closing.commandKey} createdAt={closing.createdAt}
      offer={eCommandClosureOffer(outcomes[closing.commandKey], isRetryExpired(closing))}
      facts={<>{closing.payload.kind === "device" && <Fact k="原状态">{closing.payload.input.before}</Fact>}<Fact k="原理由">{closing.payload.input.reason}</Fact></>}
      onClose={() => setClosing(null)} onSubmit={async evidence => {
        const receipt = await m.checkDirect(closing, evidence) as ECommandInvestigation | null;
        showDevice(closing, receipt);
        if (closing.payload.kind === "risk") {
          window.dispatchEvent(new Event("e6-read-risk"));
        }
        setClosing(null); onRead?.();
      }} />}
    {release && (release.payload.kind === "proposal" && isRetryExpired(release) && release.absent
      ? <MissingProposalReleaseModal label={release.label} createdAt={release.createdAt} onCancel={() => m.setRelease(null)} onConfirm={async () => {
        try { const released = await m.releaseMissing(release); m.setRelease(null); onRead?.(); toast(released ? "已解除这条记录，可以重新提交" : "查到了这张审批单，没有解除", released ? "success" : "warn"); }
        catch (failure) { throw new Error(release.ticketId ? TICKET_UNREAD : eReadError(failure)); }
      }} />
      : <ReleaseModal label={release.label} onCancel={() => m.setRelease(null)} onConfirm={() => { m.forget(release); m.setRelease(null); onRead?.(); toast("已解除这条记录", "success"); }} />)}
  </>;
}
