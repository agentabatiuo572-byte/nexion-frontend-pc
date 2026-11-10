"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { roleLabel } from "@/lib/nav/console-nav";
import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey } from "@/lib/admin/a2-client";
import { createPendingMutationStore, isRetryExpired, RETRY_EXPIRED_TEXT, hasPersistedPendingCommandOwner, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { displayAdminError } from "@/lib/admin/error-messages";
import { activateE5Device, deactivateE5Device, setE5UserDevicesPaused, fetchE5Devices } from "@/lib/admin/e5-client";
import { savePhoneRisk, fetchPhoneRisk, type PhoneRiskUpdate } from "@/lib/admin/phone-risk-client";
import { Button, Notice, Fold, ReleaseModal } from "@/app/components/rd";

export type E6Section = "tasks" | "tiers" | "phones" | "calibration";
/** These legacy actions belong to E6; other E pages keep their existing expiry policy. */
export const isE6LegacyCommand = (record: Pick<PendingMutationRecord, "fingerprint">) => /^(e6_[^|]+|e2_phone_tier|e2_task_(create|update|status))\|/.test(record.fingerprint);
export type E6Proposal = Parameters<typeof createA2OperationProposal>[0];
type ProposalDraft = Omit<E6Proposal, "operator" | "operatorRole" | "sos" | "roleGate">;
type DeviceInput = { before: string; serial: string; deviceId: number; userId: number; action: "activate" | "deactivate" | "pause" | "resume"; reason: string; operator: string };
type Payload = { kind: "proposal"; input: E6Proposal; evidence?: unknown } | { kind: "device"; input: DeviceInput } | { kind: "risk"; revision: number; input: PhoneRiskUpdate };
export type E6Pending = PendingMutationRecord & { owner: number; epoch: number; label: string; section: E6Section; scope: string; payload: Payload; body: string; ticketId?: string; terminal?: string };
const commands = createPendingMutationStore<E6Pending>({ storageKey: "nexion-admin-e6-commands-v2", retainExpiredRecords: true,
  isValidRecord: r => Number.isSafeInteger(r.owner) && typeof r.scope === "string" && typeof r.label === "string" && typeof r.body === "string"
    && !!r.payload && ["proposal", "device", "risk"].includes(r.payload.kind) && !!r.payload.input && typeof r.payload.input.reason === "string" });
const legacyCommands = createPendingMutationStore<PendingMutationRecord & { inputFingerprint: string }>({ storageKey: "nexion-admin-e-domain-commands-v1", retainExpiredRecords: isE6LegacyCommand,
  isValidRecord: r => typeof r.inputFingerprint === "string" });
const legacyPhones = createPendingMutationStore<PendingMutationRecord & { inputFingerprint: string }>({ storageKey: "nexion-admin-e5-device-commands-v1", retainExpiredRecords: true, isValidRecord: r => typeof r.inputFingerprint === "string" });
const Context = createContext<ReturnType<typeof useMutations> | null>(null);

function useMutations() {
  const session = useAdminAuth(s => s.session), epoch = useAdminAuth(s => s.authEpoch);
  const owner = session!.adminId, rights = session!.authorities;
  const [pending, setPending] = useState<E6Pending[]>([]);
  const [legacy, setLegacy] = useState<ReturnType<typeof legacyCommands.list>>([]);
  const [busy, setBusy] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rejected, setRejected] = useState<string[]>([]);
  const [release, setRelease] = useState<E6Pending | null>(null);
  const active = useRef(true), sending = useRef(false);
  const sync = () => setPending(commands.list().filter(r => r.owner === owner));
  const canPropose = rights.some(r => ["platform_a2_write", "platform_a2_proposal_create"].includes(r));
  const canAudit = rights.includes("platform_a2_read");
  const visible = (section: E6Section) => rights.includes(section === "tasks" || section === "tiers" ? "device_e2_read" : section === "phones" ? "device_e5_read" : "device_e6_read");
  useEffect(() => {
    active.current = true; sync();
    if (hasPersistedPendingCommandOwner(String(owner))) setLegacy([...legacyCommands.list().filter(r => /^(e2_task_|e2_phone_tier|e6_compute_config|e6_phone_calibration|e5_device_)/.test(r.fingerprint)), ...legacyPhones.list()]);
    return () => { active.current = false; };
  }, [owner, epoch]);
  const locked = (scope: string) => pending.some(r => r.scope === scope || scope.startsWith("phone:") && r.scope === `user:${scope.split(":")[2]}` || scope.startsWith("user:") && r.scope.startsWith("phone:") && r.scope.split(":")[2] === scope.slice(5))
    || legacy.some(r => { const [op,obj] = r.fingerprint.split("|"); return scope === "task:create" ? op === "e2_task_create" : scope.startsWith("task:") ? op.startsWith("e2_task_") && obj === scope.slice(5) : scope.startsWith("tier:") ? op === "e2_phone_tier" && obj === scope.slice(5) : scope === "calibration" ? op === "e6_phone_calibration" : scope.startsWith("param:") && op === "e6_compute_config" && obj === scope.slice(6); });
  function allowed(record: E6Pending) {
    if (!visible(record.section)) return false;
    if (record.payload.kind === "risk") return rights.includes("device_e6_write");
    if (record.payload.kind === "device") return rights.includes("device_e5_write");
    const op = record.payload.input.command.op;
    if (!canPropose) return false;
    if (op.startsWith("e2_task_")) return rights.includes("device_e2_write");
    if (op === "e2_phone_tier") return rights.includes("device_e2_write") && rights.includes(record.payload.input.command.params.dailyUsdt !== undefined ? "device_e2_phone_tier_usdt" : "device_e2_phone_tier_nex");
    if (op === "e5_device_force_activate" || op === "e5_device_unbind") return rights.includes(op === "e5_device_unbind" ? "device_e5_device_unbind" : "device_e5_device_force_activate") || session!.role === "growth" && rights.includes("platform_a2_proposal_create");
    return rights.includes("device_e6_write");
  }
  async function send(record: E6Pending, retry: boolean) {
    if (sending.current || !allowed(record)) throw new Error("当前没有这项操作的提交权限。");
    if (retry && (isRetryExpired(record) || record.payload.kind === "risk")) throw new Error("原操作仅可核查，不能重新发送。");
    sending.current = true; setBusy(record.commandKey);
    try {
      if (retry && record.payload.kind === "proposal") {
        const ticket = await fetchA2ProposalByKey(record.commandKey);
        if (ticket) {
          if (!ticket.mine) throw new Error("原提案归属无法核实，请到操作记录核对。");
          commands.remember(record.fingerprint, record.commandKey, { ...record, ticketId: ticket.id, terminal: ["approved", "rejected", "withdrawn", "expired"].includes(ticket.status) ? ticket.status : undefined });
          if (active.current) sync();
          return;
        }
      }
      let deviceResult: { changedCount?: number; pendingDeactivate?: boolean } | undefined;
      if (record.payload.kind === "proposal") {
        const ticket = await createA2OperationProposal(record.payload.input, record.commandKey, true);
        commands.remember(record.fingerprint, record.commandKey, { ...record, ticketId: ticket.id });
      } else if (record.payload.kind === "device") {
        const i = record.payload.input;
        if (i.action === "activate") { const result = await activateE5Device(i.deviceId, false, i.reason, i.operator, record.commandKey); deviceResult = { pendingDeactivate: result.pendingDeactivate }; }
        else if (i.action === "deactivate") { const result = await deactivateE5Device(i.deviceId, false, i.reason, i.operator, record.commandKey); deviceResult = { pendingDeactivate: result.pendingDeactivate }; }
        else { const result = await setE5UserDevicesPaused(i.userId, i.action === "pause", i.reason, i.operator, record.commandKey); deviceResult = { changedCount: result.changedCount }; }
        await fetchE5Devices({ pageNum: 1, pageSize: 10, keyword: i.serial }, true);
        commands.forget(record.fingerprint, record.commandKey);
      } else {
        await savePhoneRisk(record.payload.revision, record.payload.input, record.commandKey);
        await fetchPhoneRisk();
        commands.forget(record.fingerprint, record.commandKey);
      }
      if (active.current) { sync(); setNotes(n => ({ ...n, [record.commandKey]: record.payload.kind === "proposal" ? "已提交，等待审批后执行。" : "已取得操作回执，请刷新核对当前值。" })); }
      return deviceResult;
    } catch (failure) {
      if (!retry && isExplicitRejection(failure)) commands.forget(record.fingerprint, record.commandKey);
      if (active.current) {
        sync();
        if (retry && isExplicitRejection(failure)) setRejected(r => [...r, record.commandKey]);
        setNotes(n => ({ ...n, [record.commandKey]: displayAdminError(failure) }));
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
      commands.remember(record.fingerprint, record.commandKey, { ...record, ticketId: ticket.id, terminal }); sync();
      setNotes(n => ({ ...n, [record.commandKey]: `原提案 ${ticket.id}：${({ pending: "待审批", approved: "已批准，请刷新业务当前值", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" } as Record<string,string>)[ticket.status] ?? ticket.status}` }));
    } catch (failure) { if (active.current) setNotes(n => ({ ...n, [record.commandKey]: displayAdminError(failure) })); }
    finally { if (active.current) setBusy(""); }
  }
  return { pending, legacy, busy, notes, rejected, release, setRelease, sync, locked, visible, allowed, canPropose, canAudit, proposal, start, check, send,
    device: (scope: string, label: string, input: Omit<DeviceInput, "operator">) => start(scope, "phones", label, { kind: "device", input: { ...input, operator: session!.operator || session!.username } }),
    risk: (revision: number, input: PhoneRiskUpdate) => start("risk", "calibration", "保存机型风控设置", { kind: "risk", revision, input }),
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
export function E6PendingNotice({ section, onRead }: { section: E6Section; onRead?: (result?: { changedCount?: number; pendingDeactivate?: boolean }) => void }) {
  const m = useE6Mutations();
  return <>
    {m.pending.filter(r => r.section === section && m.visible(section)).map(r => <Notice key={r.commandKey} tone="warn" title={`${r.label} · ${r.ticketId ? "待核对审批结果" : "结果未确认，请先核对原操作"}`} actionBelow action={<>
      {r.payload.kind === "proposal" && <Button size="sm" disabled={!!m.busy} onClick={() => void m.check(r)}>只读查询审批结果</Button>}
      {r.payload.kind !== "risk" && !r.ticketId && !isRetryExpired(r) && <Button size="sm" disabled={!m.allowed(r) || !!m.busy} onClick={() => { void m.send(r, true).then(onRead).catch(() => { /* send has recorded the failure in the persistent notice. */ }); }}>按原操作重试</Button>}
      {r.payload.kind === "risk" && <Button size="sm" onClick={() => window.dispatchEvent(new Event("e6-read-risk"))}>读取当前风控设置</Button>}
      {r.terminal && <Button size="sm" onClick={() => { m.forget(r); onRead?.(); }}>原提案已结束，准备新变更</Button>}
      {m.rejected.includes(r.commandKey) && <Button size="sm" onClick={() => m.setRelease(r)}>解除待确认</Button>}
      {m.canAudit && <Link href="/platform/audit?domain=E">核对操作记录与审批</Link>}
    </>}>
      <p>原对象、内容、理由和命令号已保存，这个对象暂不能提交新变更。{r.payload.kind === "risk" ? "此接口不按命令号去重，只能读回核对；当前值相同不能证明原请求成功。" : "重试只能使用原内容、原理由和原命令号。"}</p>
      {isRetryExpired(r) && <p>{RETRY_EXPIRED_TEXT}</p>}{m.notes[r.commandKey] && <p>{m.notes[r.commandKey]}</p>}
      <Fold title="原操作与技术信息" summary={r.commandKey} inset><p>命令号：{r.commandKey}</p><p>发起：{new Date(r.createdAt).toLocaleString("zh-CN")}</p><p>原对象：{r.scope}</p>{r.payload.kind === "device" && <p>原状态：{r.payload.input.before}</p>}<p>理由：{r.payload.input.reason}</p><pre className="e6-json">{r.body}</pre></Fold>
    </Notice>)}
    {m.legacy.filter(r => section === "tasks" ? r.fingerprint.startsWith("e2_task_") : section === "tiers" ? r.fingerprint.startsWith("e2_phone_tier") : section === "phones" ? r.fingerprint.startsWith("e5") : r.fingerprint.startsWith("e6_")).map(r => <Notice key={r.commandKey} tone="warn" title="升级前的原提案待核查"><p>旧记录缺少完整内容与理由，只能凭原命令号到操作记录与审批核对，不能重试或解除。原命令号：{r.commandKey}</p></Notice>)}
    {m.release?.section === section && <ReleaseModal label={m.release.label} onCancel={() => m.setRelease(null)} onConfirm={() => { m.forget(m.release!); m.setRelease(null); onRead?.(); }} />}
  </>;
}
