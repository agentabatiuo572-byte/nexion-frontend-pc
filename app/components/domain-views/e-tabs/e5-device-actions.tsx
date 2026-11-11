"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { announcePermissionDenied } from "@/lib/admin/operation-confirm-error";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import { createA2CommandKey } from "@/lib/admin/a2-client";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { roleLabel } from "@/lib/nav/console-nav";
import { fetchLegacyUnknownCandidate, type E5Device } from "@/lib/admin/e5-client";
import { sameLegacyUnknownProof, type LegacyUnknownCandidate } from "@/lib/admin/legacy-unknown-resolution";
import { e5Commands, e5LegacyCommands, e5CommandBlocks, sendE5Command, type E5Command, type E5Intent } from "@/lib/admin/e5-command";
import { e6Commands, type E6Pending } from "@/lib/admin/e6-command";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { BlockState, Button, Change, Check, Fact as RdFact, Facts, Fold, IconButton, IrreversibleTag, Modal, MoreMenu, Notice, RatioBar, ReleaseBody, StatusTag, type MoreMenuItem } from "@/app/components/rd";
import { OperationConfirmModal } from "../design-kit";
import { E5_STATES } from "./e5-device-state";
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
  resume: "将恢复该用户的设备派单；停跑期间收益不补发。",
  "force-activate": "强制激活也不能绕过每人 6 台上限。批准前设备状态不变。",
  unbind: "设备将不再属于原用户，不退款，购入时间不变。",
  legacy: "仅取消这条未确认旧任务，不产生USDT/UVT收益。原请求、journal和恢复预算保留，不授予重放。",
};
interface ActionsState {
  records: E5Command[];
  phoneBlocks: (device: E5Device, intent?: E5Intent) => boolean;
  legacyBlocked: boolean;
  busy: string;
  execute: (record: E5Command, retry: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  toast: (message: string) => void;
}
const CommandsContext = createContext<ActionsState | null>(null);

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
  const sync = useCallback(() => {
    setRecords(e5Commands.list().filter(r => r.actorId === actorId));
    setPhonePending(e6Commands.list().filter(r => String(r.owner) === actorId && r.section === "phones"));
  }, [actorId]);
  const phoneBlocks = (device: E5Device, intent?: E5Intent) => phonePending.some(r => r.scope === `user:${device.userId}`
    || r.scope === `phone:${device.deviceId}:${device.userId}`
    || (intent === "pause" || intent === "resume") && r.scope.startsWith("phone:") && r.scope.split(":")[2] === device.userId);
  useEffect(() => {
    sync(); setRelease(null); setRejected({}); setReadResults({});
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
    setBusy(record.commandKey); setError(""); sync();
    try {
      const result = await sendE5Command(record, retry);
      sync();
      const submitted = ["force-activate", "unbind", "legacy"].includes(record.intent);
      const message = submitted ? `A2 ${result.id} 已提交，等待审批后执行` : record.intent === "deactivate"
        ? result.pendingDeactivate ? "已申请停用，等待当前任务结算后自动停用" : "设备已取消激活"
        : record.intent === "pause" || record.intent === "resume" ? `${record.intent === "pause" ? "暂停" : "恢复"}成功 · ${result.changedCount} 台设备` : "设备已激活";
      toast(message);
      await refresh(message);
    } catch (cause) {
      if (cause instanceof Error && "status" in cause && (cause.status === 401 || cause.status === 403)) announcePermissionDenied();
      sync();
      if (retry && isExplicitRejection(cause)) setRejected(rows => ({ ...rows, [record.commandKey]: displayAdminError(cause) }));
      setError(isExplicitRejection(cause) ? displayAdminError(cause) : cause instanceof Error && cause.message === "提案缺少有效票号" ? "申请回执未包含审批单号，请到操作记录与审批核对。原请求已保留。" : "没有收到可确认的操作回执，原对象、内容、理由和命令号已保留。");
      throw cause;
    } finally { setBusy(""); }
  };
  return <CommandsContext.Provider value={{ records, phoneBlocks, legacyBlocked: old.length > 0 || !!error && !records.length && !old.length && error.includes("旧操作"), busy, execute, refresh, toast }}>
    {phonePending.map(r => <Notice key={r.commandKey} tone="warn" title={`${r.label} · 手机页有原操作待核对`}><p>原对象、内容、理由和命令号在手机算力配置保留，请回原页面核对。相关设备或整用户的新操作继续暂停。</p><Link className="rd-link" href="/devices/compute-config?tab=phones">手机算力配置</Link></Notice>)}
    {old.map(row => <Notice key={row.commandKey} tone="warn" title="旧操作缺少原请求，不能原样重试" action={<Button size="sm" disabled={!!busy} onClick={() => void refresh()}>读回核对</Button>}><p>原命令号：<code>{row.commandKey}</code></p><p>请到操作记录与审批核对。原记录保留，不能用当前草稿补成原操作。</p></Notice>)}
    {records.map(record => <Notice key={record.commandKey} tone={rejected[record.commandKey] ? "danger" : "warn"} title={`${record.label} · ${rejected[record.commandKey] ? "原号重试已拒绝" : "结果待确认"}`} actionBelow action={<div className="rd-toolbar">
      <Button size="sm" disabled={!!busy} onClick={async () => {
        setReadResults(values => ({ ...values, [record.commandKey]: "正在读取最新设备状态…" }));
        const result = readBack ? await readBack(record) : (await refresh(), "已请求刷新，请核对列表与操作记录；原操作继续待确认。");
        setReadResults(values => ({ ...values, [record.commandKey]: result }));
      }}>读回核对</Button>
      <Button size="sm" variant={rejected[record.commandKey] ? "secondary" : "primary"} loading={busy === record.commandKey} disabledReason={isRetryExpired(record) ? "已超过 24 小时，只能读回核对" : !allowed(record) ? "当前账号缺少原操作所需权限" : busy ? "正在提交原操作" : undefined} onClick={() => { void execute(record, true).catch(() => { /* The persistent notice displays this failure. */ }); }}>按原操作重试</Button>
      {rejected[record.commandKey] && <Button size="sm" variant="primary" disabled={!!busy} onClick={() => { setReleaseChecked(false); setRelease(record); }}>解除待确认</Button>}
    </div>}>
      <p>{record.device.serial} · {record.device.user} · {formatBusinessTimeCompact(new Date(record.createdAt).toISOString())}</p>
      <p>{rejected[record.commandKey] ? "本次原号重试被明确拒绝。核对原操作结果后，可解除本页待确认。" : "当前状态不代表原操作结果。重试会重新发送保存的原请求，后端按原命令号去重。"}</p>
      {readResults[record.commandKey] && <p role="status">{readResults[record.commandKey]}</p>}
      {isRetryExpired(record) && <p>已超过 24 小时，原操作与对象锁继续保留，请到操作记录与审批核对。</p>}
      <Fold inset title="原操作与技术信息" summary="原对象、内容、理由和命令号已保留"><Facts>
        <Fact label="操作理由" value={record.reason} /><Fact label="命令号" value={record.commandKey} mono copy />
        <Fact label="请求路径" value={record.path} mono /><Fact label="原请求内容" value={record.body} mono />
      </Facts></Fold>
      {error && <p role="alert">{error}</p>}
    </Notice>)}
    {error && !records.length && <Notice tone="warn" title={error} />}
    {release && <Modal title="解除待确认" onClose={() => setRelease(null)} footer={<><Button onClick={() => setRelease(null)}>取消</Button><Button variant="primary" disabledReason={!releaseChecked ? "请先核对原操作的结果并勾选确认" : undefined} onClick={() => {
      e5Commands.forget(release.fingerprint, release.commandKey); sync(); setRelease(null); setError(""); toast("已解除本页待确认，后端结果和锁不变。");
    }}>确认解除</Button></>}>
      <ReleaseBody label={`${release.label} · ${release.device.serial}`} />
      <Facts><Fact label="原操作时间" value={formatBusinessTimeCompact(new Date(release.createdAt).toISOString())} /><Fact label="命令号" value={release.commandKey} mono copy /></Facts>
      <Notice tone="danger" title="本次原号重试被明确拒绝">{rejected[release.commandKey]}</Notice>
      <Check label="已核对原操作的结果，确认只解除本页待确认" checked={releaseChecked} onChange={event => setReleaseChecked(event.target.checked)} />
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
  return <div className="e5-slots" data-phones={phones ? "" : undefined} data-full={d.activeDevicesForUser >= d.maxDevicesPerUser ? "" : undefined}><RatioBar label="激活名额（含手机）" value={d.activeDevicesForUser} tone={phones ? d.activeDevicesForUser >= d.maxDevicesPerUser ? "warn" : "role-2" : "neutral"} total={d.maxDevicesPerUser} valueText={`${d.activeDevicesForUser}/${d.maxDevicesPerUser} 台（含手机）`} steps quiet invalidText="已超过上限，不能激活" />
    <span>{d.activeDevicesForUser}/{d.maxDevicesPerUser} 台（含手机）</span></div>;
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
    if (deactivatable && ctx.canWriteE5) add(d.pausedReason ? "resume" : "pause", d.pausedReason ? "恢复该用户" : "暂停该用户");
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
      facts={<><Facts>{action === "pause" || action === "resume" ? <><Fact label="用户" value={d.user} /><Fact label="影响范围" value="这位用户的全部设备（含手机）" /><Fact label="从这台设备发起" value={<>{d.deviceName}<br /><span className="e5-instance" data-mono>{d.serial}</span></>} /><Fact label="发起设备状态" value={d.simState ? E5_STATES[d.simState].label : d.pausedReason ? "已暂停" : ({ active: "在线", busy: "任务中", offline: "离线", inventory: "待激活", "pending-deactivate": "停用中", unbound: "已解绑 / 停用", abnormal: "异常", unknown: "状态未知" }[d.state])} /></> : <><Fact label="设备" value={d.deviceName} /><Fact label="实例号" value={d.serial} mono /><Fact label="归属用户" value={d.user} /><Fact label="当前状态" value={d.simState ? E5_STATES[d.simState].label : d.pausedReason ? "已暂停" : ({ active: "在线", busy: "任务中", offline: "离线", inventory: "待激活", "pending-deactivate": "停用中", unbound: "已解绑 / 停用", abnormal: "异常", unknown: "状态未知" }[d.state])} /></>}
        {action === "legacy" && candidate && <><Fact label="原任务 / 代际" value={`${candidate.taskNo} / ${candidate.requestGeneration}`} /><Fact label="案件" value={candidate.caseId} /><Fact label="退出证明" value={candidate.proofSha} mono copy /><Fact label="后端实例" value={candidate.backendInstanceId} /></>}
      </Facts>{(action === "activate" || action === "force-activate") && <><E5Slots device={d} phones={phones} /><Facts><RdFact k="激活名额变化"><Change from={`${d.activeDevicesForUser}/${d.maxDevicesPerUser}`} to={`${d.activeDevicesForUser + 1}/${d.maxDevicesPerUser}`} /></RdFact></Facts></>}</>}
      blockedReason={locked(action) ?? ((action === "activate" || action === "force-activate") && full ? "已达 6 台激活上限（含手机）" : undefined)}
      detail={proposal ? "提案成功只代表申请已收录；批准前设备状态不变。请到操作记录与审批核对原申请。" : "操作结果以服务端回执为准。"}
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
        catch (cause) { if (e5Commands.get(fingerprint)) setAction(null); throw cause; }
      }} />}
  </>;
}
