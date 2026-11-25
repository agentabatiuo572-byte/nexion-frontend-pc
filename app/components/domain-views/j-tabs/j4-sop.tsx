"use client";
import { eCommandClosureOffer } from "@/lib/admin/e-command-investigation";

/**
 * J4 监管要求应急处理（应急控制页）。出事时按事先写好的应急预案一步步止损；平时维护预案、做演练。
 * 首屏：结论、四个数、正在执行的执行（有才出现）、预案库（左边按场景挑预案，右边看这个预案按下去会依次发生什么）、执行记录。
 * 第二层：预案能用的动作和规则、通知活动候选（折叠）；追溯在抽屉里。
 * 写入口和改版前一样：新增、编辑、演练、取消、恢复核对、恢复开关直接写 /emergency/sop/*；正式执行（常规、应急）提交 A2 审批申请。
 * 新增、编辑和发起正式执行先在页面自己的框里填（PlaybookEditor、ExecutePrepare），再进共用确认框写理由提交；
 * 请求方法和业务内容沿用原合同；原请求和确认事实先存入 J 域共享存储，未知后只恢复原操作。
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { BookOpen, Clock3, FlaskConical, History, ListChecks, Megaphone, MinusCircle, Pencil, Plus, RefreshCw, RotateCcw, ScanSearch, ShieldCheck, Siren, Square, TriangleAlert, Undo2, Workflow } from "lucide-react";
import { BlockState, Button, Cell, Change, Conclusion, Explain, Fact, Facts, Fold, KeyValues, Notice, PageHeader, Panel, Segments, Stat, StatBand, StatusTag, Table, TableMessage, Td, Th, Tr } from "@/app/components/rd";
import { AutoGloss } from "@/app/components/kit/gloss";
import { businessClock, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { displayAdminError, formatAdminApiError } from "@/lib/admin/error-messages";
import {
  createJEmergencyCommandKey, getJ4PendingCommand, getJ4PendingProposal, isEmergencyOutcomeUncertain,
  j4ProposalSlot, listJ4LegacyCommands, listJ4PendingCommands, listJ4PendingProposals,
  queryJ4Command, queryJ4Proposal, j4CanWrite, J4_TARGET_AUTHORITY as TARGET_AUTHORITY, jEmergencyRecovery, jEmergencyRetryBlocked, retryJ4Command, retryJ4Proposal, submitJ4Proposal,
  type J4CommandContext, type J4PendingCommand, type J4PendingProposal, type J4PlaybookCreateInput, type Playbook, type SopExecution,
} from "@/lib/admin/j-client";
import { fetchA2Overview, isA2OutcomeUncertainError, type A2OperationRow } from "@/lib/admin/a2-client";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { fundCommandSettled, fundInvestigationAccess, type FundCommandEvidence, type FundCommandRecord, type FundInvestigationOutcome } from "@/lib/admin/fund-command-investigation";
import { isRetryExpired, RETRY_EXPIRED_TEXT, type SlotAttemptRecord } from "@/lib/admin/pending-mutation-store";
import { FundCheckButtons, FundClosureModal, FundRecoveryPanel, closureKnown, type FundRecoveryRow, type FundSettled } from "../fund-command-check";
import { replayRejectedStatus, useVerifiedRelease, VerifiedReleaseButton } from "../verified-release";
import { RETRY_REJECTED_STATUS } from "@/lib/admin/retry-rejected";
import { CommandClosureModal, RECOVERY_LINE } from "../e-tabs/e-command-check";
import { processedStatus } from "./j-recovery-copy";
import { receiptFact } from "../recovery-panel";
import { eCommandCanRequestResumeRollback } from "@/lib/admin/e-command-investigation";
import { useReach } from "@/lib/nav/use-reach";
import { isConfirmedNonExecution, rebaseTerminalDraft, useTerminalDrafts, type TerminalDraft } from "@/lib/admin/use-terminal-drafts";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  DOMAIN_PAGE, ExecutePrepare, PlaybookEditor, StepDots, StepTimeline, TraceDrawer, UndoTag,
  count, draftChanges, executionModeLabel, initialDraft, isActiveExecution, j4Time, lineStep, notifyLabelText, reversibleGates, rollbackStatusText, roleText, stepInfo, tierText, undoSummary,
  type EditorSpec, type ExecuteDraft, type PlaybookDraft,
} from "./j4-parts";
import type { ActionConfirmReq, JCtx } from "./types";

const READING = "正在加载最新状态，读完再操作";
const NOT_READY = "应急执行服务尚未就绪，请联系技术人员检查";
const REASON_HINT = "例如：监管来函编号、事件编号、工单号";
const NO_REAL = <StatusTag tone="neutral" icon={FlaskConical}>不动真实业务</StatusTag>;
const IMMEDIATE = <StatusTag tone="progress" filled>立即生效</StatusTag>;
const APPROVER = "另一位管理员在「操作记录与审批」批准；需有审批权和应急预案执行权，你不能批自己的申请";
/** 查询原操作查到执行申请已经结束：轻提示写结论（和 F2、J1 同一组说法）。批准回放只有执行完才成功（中途失败回 J4_EXECUTION_PARTIAL，单子留在待审批），执行完也可能有跳过的步骤。 */
const J4_PROPOSAL_END = {
  approved: "原执行申请已批准：预案已按顺序执行完；每一步是做了还是跳过，到「执行记录」看。",
  rejected: "原执行申请已驳回：预案没有执行；需要时重新发起。",
  withdrawn: "原执行申请已撤回：预案没有执行。",
  expired: "原执行申请已过期：没人处理，预案没有执行；需要时重新发起。",
} as const;
function playbookFormBody(bv: Record<string, string> | undefined, fallbackName: string): J4PlaybookCreateInput {
  return {
    name: bv?.name?.trim() || fallbackName,
    scene: bv?.scene,
    owner: bv?.owner,
    sla: bv?.sla,
    emergencyTrack: bv?.emergencyTrack === "true",
    actionSeq: bv?.actionSeq,
    notifyCampaignNo: bv?.notifyCampaignNo,
    notifyTemplate: bv?.notifyTemplate,
    rollback: bv?.rollback,
    drillRequired: true,
  };
}

/** 页面框里填好的预案，换成改版前共用表单交给 run 的那组值（键和取值一样）。 */
function draftValue(draft: PlaybookDraft): Record<string, string> {
  return {
    name: draft.name,
    scene: draft.scene,
    owner: draft.owner,
    sla: draft.sla,
    emergencyTrack: draft.emergencyTrack,
    actionSeq: draft.lines.join("\n"),
    notifyCampaignNo: draft.notifyCampaignNo,
    notifyTemplate: draft.notifyTemplate,
    rollback: draft.rollback,
    drillRequired: draft.drillRequired,
  };
}

function savedPlaybookDraft(fields: Record<string, string>): PlaybookDraft {
  return {
    name: fields.name, scene: fields.scene, owner: fields.owner, sla: fields.sla, slaLegacyValue: fields.sla,
    emergencyTrack: fields.emergencyTrack, lines: fields.actionSeq.split("\n"),
    notifyCampaignNo: fields.notifyCampaignNo, notifyTemplate: fields.notifyTemplate, notifySearch: fields.notifyTemplate,
    rollback: fields.rollback, rollbackTemplate: "", rollbackSearch: "", drillRequired: fields.drillRequired,
  };
}

function actionSeqText(p: Playbook) {
  return p.seq.map((s) => `${s.dom}·${s.ax.replace(/\*\*/g, "")}${s.ref ? `·${s.ref}` : ""}`).join("\n");
}
function playbookBaseline(p: Playbook): Record<string, string> {
  return { name: p.name, scene: p.scene, owner: p.owner, sla: p.sla, emergencyTrack: String(p.emer),
    actionSeq: actionSeqText(p), notifyCampaignNo: p.notifyCampaignNo ?? "", notifyTemplate: p.notifyTemplate ?? "",
    rollback: p.rollback ?? "", drillRequired: String(p.drillRequired === true) };
}

export function J4Sop({ ctx }: { ctx: JCtx }) {
  const { toast, openActionConfirm, actions, emergency, contentLoading, contentError } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const canWrite = authorities.includes("emergency_j4_write");
  const canRun = authorities.includes("emergency_j4_playbook_execute");
  const canPropose = authorities.includes("platform_a2_write")
    || authorities.includes("platform_a2_proposal_create");
  const canRestore = authorities.includes("emergency_j1_gate_resume");
  const reach = useReach();
  const [scene, setScene] = useState("全部");
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [traceExecution, setTraceExecution] = useState<SopExecution | null>(null);
  const [editor, setEditor] = useState<EditorSpec | null>(null);
  const [prepare, setPrepare] = useState<{ playbook: Playbook; emergency: boolean; draft: ExecuteDraft; resumed?: Pick<ExecuteDraft, "triggerBasis" | "triggerContext"> } | null>(null);
  const [readAt, setReadAt] = useState("");
  const sceneLocationReady = useRef(false);
  useEffect(() => {
    if (!sceneLocationReady.current) {
      sceneLocationReady.current = true;
      const initial = new URL(window.location.href).searchParams.get("j4Scene");
      if (initial) setScene(initial);
      return;
    }
    const url = new URL(window.location.href);
    if (scene === "全部") url.searchParams.delete("j4Scene");
    else url.searchParams.set("j4Scene", scene);
    window.history.replaceState(window.history.state, "", url);
  }, [scene]);
  const data = emergency.sop;
  useEffect(() => {
    if (data) setReadAt(businessClock(Date.now()));
  }, [data]);

  const [pending, setPending] = useState<J4PendingCommand[]>([]);
  const [proposals, setProposals] = useState<J4PendingProposal[]>([]);
  const [legacy, setLegacy] = useState<ReturnType<typeof listJ4LegacyCommands>>([]);
  const release = useVerifiedRelease(toast);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [verifiedProposals, setVerifiedProposals] = useState<Record<string, A2OperationRow>>({});
  const [queue, setQueue] = useState<A2OperationRow[]>([]);
  const [queueFailed, setQueueFailed] = useState(false);
  useSyncExternalStore(jEmergencyRecovery.subscribe, jEmergencyRecovery.getRevision, jEmergencyRecovery.getRevision);
  /** 按原请求查到的结论只用来给运营看；解除与否由 queryJ4Command 按后端结论决定。 */
  const [outcomes, setOutcomes] = useState<Record<string, FundInvestigationOutcome>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ record: SlotAttemptRecord; label: string; kind: J4CommandContext["kind"]; change: ReactNode } | null>(null);
  const [settled, setSettled] = useState<FundSettled[]>([]);
  /** 按原操作重试后后端回了「中途失败」的记录：前面的步骤可能已生效，记录保留。 */
  const [partial, setPartial] = useState<Record<string, true>>({});
  const current = useRef({ data, contentLoading, contentError, authorities });
  current.current = { data, contentLoading, contentError, authorities };
  const activeConfirmation = useRef<{ slot: string; commandKey?: string } | null>(null);
  const closeOriginalConfirm = (record: SlotAttemptRecord) => {
    const active = activeConfirmation.current;
    if (active?.slot !== record.fingerprint || active.commandKey !== record.commandKey) return;
    activeConfirmation.current = null;
    openActionConfirm(null);
  };
  const authoringDrafts = useTerminalDrafts<TerminalDraft<Record<string, string>>>();
  const executionDrafts = useRef(new Map<string, Pick<ExecuteDraft, "triggerBasis" | "triggerContext">>());
  const executeDraftKey = (code: string, emergency: boolean) => `${session?.adminId}:${code}:${emergency}`;
  const formSequence = useRef(0);
  const syncPending = () => {
    setPending(listJ4PendingCommands());
    setProposals(listJ4PendingProposals());
    setLegacy(listJ4LegacyCommands());
  };
  const noteError = (key: string, error: unknown) => setNotes((previous) => ({ ...previous, [key]: displayAdminError(error) }));
  const forgetObservation = (key: string) => setVerifiedProposals((previous) => {
    const next = { ...previous };
    delete next[key];
    return next;
  });
  const observeProposal = (record: J4PendingProposal, row: A2OperationRow) => {
    setNotes(previous => { const next = { ...previous }; delete next[record.commandKey]; return next; });
    setVerifiedProposals(previous => ({ ...previous, [record.commandKey]: row }));
    setQueue(previous => previous.filter(ticket => ticket.id !== row.id));
    if (row.status !== "pending") {
      const { playbook, emergency, fields } = record.sopProposal.context;
      const key = executeDraftKey(playbook.code, emergency);
      if (row.status !== "approved") executionDrafts.current.set(key, { triggerBasis: fields.triggerBasis, triggerContext: fields.triggerContext });
      closeOriginalConfirm(record);
    }
  };
  const queryProposal = async (record: J4PendingProposal) => {
    forgetObservation(record.commandKey);
    try {
      const row = await queryJ4Proposal(record);
      if (row) {
        observeProposal(record, row);
        if (row.status !== "pending") {
          toast(J4_PROPOSAL_END[row.status], row.status === "approved" ? "success" : "warn");
          await actions.reloadJEmergency();
        }
      } else noteError(record.commandKey, new Error("A2_PROPOSAL_NOT_FOUND"));
      return row;
    } catch (error) {
      noteError(record.commandKey, error);
      return null;
    } finally { syncPending(); }
  };
  useEffect(() => {
    syncPending();
    // Exact maker queries also work without the A2 menu; the backend checks read eligibility.
    for (const record of listJ4PendingProposals()) void queryProposal(record);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.adminId]);
  useEffect(() => {
    setQueue([]);
    setQueueFailed(false);
    if (!data || contentLoading || contentError) return;
    setVerifiedProposals({});
    let active = true;
    for (const record of listJ4PendingProposals()) void queryProposal(record);
    if (authorities.includes("platform_a2_read")) {
      void fetchA2Overview({ domain: "J" }).then((overview) => {
        if (active) setQueue(overview.operationQueue.filter((row) => row.rawStatus === "pending" && row.operationCode === "j4_playbook_execute"));
      }).catch(() => { if (active) { setQueue([]); setQueueFailed(true); } });
    }
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, contentLoading, contentError, session?.authorities]);
  useEffect(() => {
    const expiry = Math.min(...[...pending, ...proposals, ...legacy].filter((record) => !isRetryExpired(record)).map((record) => record.expiresAt));
    if (!Number.isFinite(expiry)) return;
    const timer = window.setTimeout(() => {
      const confirmation = activeConfirmation.current;
      const saved = [...listJ4PendingCommands(), ...listJ4PendingProposals(), ...listJ4LegacyCommands()].find((record) => record.fingerprint === confirmation?.slot);
      if (saved && isRetryExpired(saved)) closeOriginalConfirm(saved);
      syncPending();
    }, Math.max(0, expiry - Date.now()));
    return () => window.clearTimeout(timer);
  }, [pending, proposals, legacy, openActionConfirm]);

  function retryReadReason(context: J4CommandContext) {
    const { data, contentLoading, contentError } = current.current;
    if (!data || contentLoading || contentError) return READING;
    if (data.contractVersion !== "J4_REAL_EXECUTION_V5") return NOT_READY;
    if ("playbook" in context && !data.playbooks.some(playbook => playbook.code === context.playbook.code)) return READING;
    if ("execution" in context && !data.executions.some(execution => execution.executionId === context.execution.executionId && execution.code === context.execution.code)) return READING;
  }
  function canRetry(context: J4CommandContext) {
    return !retryReadReason(context) && j4CanWrite(context, current.current.authorities);
  }
  /** 查询、结案都按原记录的出处定位；没存出处的旧记录按原槽位和当前账号查，和 queryJ4Command 一致。 */
  const investigationRecord = (record: SlotAttemptRecord & { sop?: J4PendingCommand["sop"] }): FundCommandRecord => {
    const [method, path] = record.fingerprint.split(" ");
    return { ...record, commandOrigin: record.sop?.commandOrigin
      ?? { originalMethod: method as "PUT" | "POST", originalPath: `/api/admin/emergency${path}`, readAuthority: "emergency_j4_read", originalAdminId: String(session?.adminId ?? "") } };
  };
  /** 查到确定结论（核查确认已执行／未执行）：关掉这条原操作的框，重读页面。 */
  const finishSettled = async (saved: SlotAttemptRecord, label: string, receipt: NonNullable<Awaited<ReturnType<typeof queryJ4Command>>>) => {
    setSettled((previous) => [...previous.filter((item) => item.key !== saved.commandKey), { key: saved.commandKey, label, status: receipt.originalStatus }]);
    closeOriginalConfirm(saved);
    const command = saved as Partial<J4PendingCommand>;
    const context = command.sop?.context;
    if (saved.commandOwnerId !== undefined && isConfirmedNonExecution(receipt)
      && (context?.kind === "create" || context?.kind === "update")) {
      authoringDrafts.remember(saved.commandOwnerId, saved.fingerprint, { desired: context.fields, before: context.kind === "update" ? playbookBaseline(context.playbook) : undefined });
    }
    syncPending();
    await actions.reloadJEmergency().catch(() => undefined);
  };
  const queryOriginal = async (record: { commandKey: string }, label: string) => {
    const saved = [...listJ4PendingCommands(), ...listJ4LegacyCommands()].find(row => row.commandKey === record.commandKey);
    // 查到回执时行内已写结论，「只能核对当前预案」那句附注就不再显示。
    let receiptFound = false;
    if (saved) {
      setChecking(saved.commandKey);
      try {
        const receipt = await queryJ4Command(saved);
        setOutcomes((previous) => ({ ...previous, [saved.commandKey]: { receipt } }));
        if (fundCommandSettled(receipt)) {
          await finishSettled(saved, label, receipt!);
          return;
        }
        receiptFound = !!receipt;
      } catch (error) {
        // No receipt conclusion: retain the original and continue the current-state read.
        setOutcomes((previous) => ({ ...previous, [saved.commandKey]: { error: displayAdminError(error) } }));
      } finally { setChecking(null); }
    }
    try {
      await actions.reloadJEmergency();
      if (receiptFound) setNotes((previous) => ({ ...previous, [record.commandKey]: "" }));
      else noteError(record.commandKey, new Error("J4_CURRENT_STATE_ONLY"));
    } catch (error) { noteError(record.commandKey, error); }
    syncPending();
  };
  const contextName = (context: J4CommandContext) => context.kind === "create" ? context.fields.name
    : "playbook" in context ? `${context.playbook.code} ${context.playbook.name}` : `${context.execution.code} ${context.execution.executionId}`;
  const operationNames = { create: "新增预案", update: "保存预案修改", drill: "演练预案", execute: "提交执行申请", cancel: "登记取消", resume: "恢复核对", rollback: "恢复本次关停的开关" };
  const legacyKind = (fingerprint: string) => fingerprint.endsWith("/drills") ? "drill" as const : fingerprint.endsWith("/cancel") ? "cancel" as const
    : fingerprint.endsWith("/resume") ? "resume" as const : fingerprint.endsWith("/rollback") ? "rollback" as const : fingerprint.startsWith("PUT") ? "update" as const : "create" as const;
  const busy = !!checking;
  /** 查询原操作、核查结案（共用按钮）；结案框按这类操作后端能给的结论选。 */
  const checkButtons = (record: SlotAttemptRecord & { sop?: J4PendingCommand["sop"] }, label: string, kind: J4CommandContext["kind"], change: ReactNode) => {
    const outcome = outcomes[record.commandKey];
    const receipt = outcome && "receipt" in outcome ? outcome.receipt : null;
    return <FundCheckButtons record={investigationRecord(record)} outcome={kind === "resume" && receipt?.originalStatus === "FAILED" && !eCommandCanRequestResumeRollback(receipt) ? undefined : outcome} expired={isRetryExpired(record)} busy={busy} checking={checking === record.commandKey}
      onCheck={() => void queryOriginal(record, label)} onClose={() => setClosing({ record, label, kind, change })} />;
  };
  const askRelease = (record: SlotAttemptRecord, operation: string, target: ReactNode) => release.ask({ operation, target, getSnapshot: jEmergencyRecovery.releaseSnapshot(record), createdAt: record.createdAt,
    release: () => { const released = jEmergencyRecovery.releaseRejectedReplay(record); if (released) closeOriginalConfirm(record); syncPending(); return released; } });
  const recoveryRows: FundRecoveryRow[] = pending.map((record) => {
    const context = record.sop.context;
    const label = `${operationNames[context.kind]} · ${contextName(context)}`;
    const change = context.kind === "create" || context.kind === "update"
      ? `${context.fields.scene} · ${context.fields.owner} · ${context.fields.actionSeq.split("\n").filter(Boolean).length} 步`
      : context.kind === "drill" ? `${context.playbook.seq.length} 步` : "execution" in context ? <span data-mono="">{context.execution.executionId}</span> : "";
    const expired = isRetryExpired(record);
    const retry = !expired && canRetry(context) && !jEmergencyRetryBlocked(record);
    const rejected = !!jEmergencyRecovery.state(record).replayRejection;
    return {
      key: record.commandKey, title: <span title={label}>{label}</span>, record: investigationRecord(record), outcome: outcomes[record.commandKey],
      createdAt: record.createdAt, expired, canRetry: retry, canQuery: true,
      // 记为失败、仍未知的那句由共用面板按结案框能选的结论说（含恢复核对结不了案、可按「未执行」结案）。
      status: partial[record.commandKey] ? { tone: "warn", label: "部分完成", line: "中途失败，前面的步骤可能已生效；先看执行追溯。" } : replayRejectedStatus(rejected, outcomes[record.commandKey]),
      actions: <>
        {checkButtons(record, label, context.kind, change)}
        {!expired && !rejected && <Button size="sm" disabled={busy} disabledReason={retryReadReason(context) ?? jEmergencyRetryBlocked(record)} onClick={() => restoreOriginal(record)}>按原操作重试</Button>}
        {rejected && <VerifiedReleaseButton disabled={busy || !!jEmergencyRecovery.state(record).busy} onClick={() => askRelease(record, operationNames[context.kind], contextName(context))} />}
      </>,
      detail: <>
        {change && <p>{"execution" in context ? <>执行 {change}</> : change}</p>}
        {(context.kind === "resume" || context.kind === "rollback") && <p>{context.kind === "resume" ? "恢复核对" : "恢复开关"}可能只做了一部分，以执行追溯里每一步的状态为准。</p>}
        {notes[record.commandKey] && <p>{notes[record.commandKey]}</p>}
      </>,
    };
  });
  recoveryRows.push(...proposals.filter((record) => verifiedProposals[record.commandKey]?.status !== "pending").map((record): FundRecoveryRow => {
    const label = `${operationNames.execute} · ${contextName(record.sopProposal.context)}`;
    const expired = isRetryExpired(record);
    const missing = jEmergencyRecovery.state(record).conclusion === "not-found";
    const rejected = !!jEmergencyRecovery.state(record).replayRejection;
    const retry = !expired && !record.sopProposal.accepted && canRetry(record.sopProposal.context) && !jEmergencyRetryBlocked(record);
    return {
      key: record.commandKey, title: <span title={label}>{label}</span>, createdAt: record.createdAt, expired, canRetry: retry,
      status: record.sopProposal.accepted ? { tone: "warn", label: "进度没读到", line: RECOVERY_LINE.created }
        : rejected ? RETRY_REJECTED_STATUS
        : expired ? { tone: "warn", label: "结果未知", line: RETRY_EXPIRED_TEXT }
          : missing ? { tone: "warn", label: "结果未知", line: RECOVERY_LINE.absent } : { tone: "warn", label: "结果未知", line: RECOVERY_LINE.unknown },
      actions: <>
        <Button size="sm" disabled={busy} onClick={() => void queryProposal(record)}>查询原操作</Button>
        {!expired && !record.sopProposal.accepted && !rejected && <Button size="sm" disabled={busy} disabledReason={retryReadReason(record.sopProposal.context) ?? jEmergencyRetryBlocked(record)} onClick={() => restoreProposal(record)}>按原操作重试</Button>}
        {rejected && !record.sopProposal.accepted && <VerifiedReleaseButton disabled={busy || !!jEmergencyRecovery.state(record).busy} onClick={() => askRelease(record, operationNames.execute, contextName(record.sopProposal.context))} />}
      </>,
      detail: <>
        <p>{`${record.sopProposal.context.emergency ? "应急通道" : "常规通道"} · ${record.sopProposal.context.fields.triggerBasis} · ${record.sopProposal.context.playbook.seq.length} 步`}</p>
        {!missing && notes[record.commandKey] && <p>{notes[record.commandKey]}</p>}
      </>,
    };
  }));
  recoveryRows.push(...legacy.map((record): FundRecoveryRow => {
    const kind = legacyKind(record.fingerprint);
    const code = record.fingerprint.split("/")[3];
    const label = `${operationNames[kind]}${code ? ` · ${decodeURIComponent(code)}` : ""}`;
    const expired = isRetryExpired(record);
    const outcome = outcomes[record.commandKey];
    const processed = outcome && "receipt" in outcome && outcome.receipt?.originalStatus === "SUCCEEDED" && !fundCommandSettled(outcome.receipt);
    return {
      key: record.commandKey, title: <span title={`${label} · 改版前的旧记录`}>{label} · 改版前的旧记录</span>, record: investigationRecord(record), outcome,
      createdAt: record.createdAt, expired, canRetry: false, canQuery: true,
      status: processed ? processedStatus({ expired, canRetry: false, canClose: fundInvestigationAccess(investigationRecord(record)).canSubmit, legacy: true, receipt: outcome.receipt })
        : outcome ? undefined : expired
          ? { tone: "neutral", label: "已过期", line: RETRY_EXPIRED_TEXT }
          : { tone: "warn", label: "结果未知", line: "改版前的旧记录没存原请求，不能重试，先查询原操作。" },
      actions: <>
        {checkButtons(record, label, kind, "改版前的旧记录，没存原请求")}
      </>,
      detail: notes[record.commandKey] ? <p>{notes[record.commandKey]}</p> : undefined,
    };
  }));
  const closingOutcome = closing ? outcomes[closing.record.commandKey] : undefined;
  const closingLast = closingOutcome && "receipt" in closingOutcome ? closingOutcome.receipt?.investigation : null;
  const closingBasis = closureKnown(closingOutcome);
  const closingResumeCanClose = closing?.kind === "resume" && eCommandCanRequestResumeRollback(closingOutcome && "receipt" in closingOutcome ? closingOutcome.receipt : null);
  const submitClosure = async (evidence: FundCommandEvidence) => {
    if (!closing) return;
    const { record, label } = closing;
    const next = await queryJ4Command(record, evidence);
    setOutcomes((previous) => ({ ...previous, [record.commandKey]: { receipt: next } }));
    setClosing(null);
    if (fundCommandSettled(next)) await finishSettled(record, label, next!);
  };
  const closureFacts = closing && <>
    {closing.change && <Fact k={closing.kind === "cancel" || closing.kind === "resume" || closing.kind === "rollback" ? "执行" : "内容"}>{closing.change}</Fact>}
    <Fact k="系统记录">{receiptFact(closingOutcome && "receipt" in closingOutcome ? closingOutcome.receipt : null, "原操作还锁着")}</Fact>
    {closingBasis && !closingBasis.rejected && closingBasis.success === "never" && !closingResumeCanClose && <Fact k="操作编号"><span data-mono="">{closing.record.commandKey}</span></Fact>}
    {closingLast && <Fact k="上次核查">{formatBusinessTimeCompact(closingLast.investigatedAt, "—")}，记为「{closingLast.conclusion === "SUCCEEDED" ? "已执行" : closingLast.conclusion === "NOT_EXECUTED" ? "未执行" : "仍未知"}」</Fact>}
  </>;
  const recovery = <>
    <FundRecoveryPanel rows={recoveryRows} settled={settled} onDismissSettled={(key) => setSettled((previous) => previous.filter((item) => item.key !== key))} />
    {/* 恢复核对只核本地持久事实；后端核 rollback_confirmed 才收未执行。恢复开关仍会动外部业务。 */}
    {closing && (closing.kind === "rollback" || closing.kind === "resume" && !eCommandCanRequestResumeRollback(closingOutcome && "receipt" in closingOutcome ? closingOutcome.receipt : null)
      ? <FundClosureModal label={closing.label} createdAt={closing.record.createdAt} offer={eCommandClosureOffer(closingOutcome, isRetryExpired(closing.record))} facts={closureFacts}
        onClose={() => setClosing(null)} onSubmit={submitClosure} />
      : <CommandClosureModal label={closing.label} commandKey={closing.record.commandKey} createdAt={closing.record.createdAt} offer={eCommandClosureOffer(closingOutcome, isRetryExpired(closing.record))} facts={closureFacts}
        onClose={() => setClosing(null)} onSubmit={submitClosure} />)}
    {release.dialog}
  </>;
  const proposalRows = new Map([...queue, ...Object.values(verifiedProposals).filter((row) => row.status === "pending")].map((row) => [row.id, row]));
  const pendingProposals = [...proposalRows.values()].map((row) => {
    const record = proposals.find((record) => verifiedProposals[record.commandKey]?.id === row.id);
    return { key: row.id, name: record ? contextName(record.sopProposal.context) : row.obj, meta: <>{row.operator} · {j4Time(row.rawTs)} · {row.id}</>,
      onQuery: record ? () => void queryProposal(record) : undefined };
  });
  const reload = () => void actions.reloadJEmergency().catch(() => undefined);
  const readOnly = !canWrite && !canRun;
  const contractReady = data?.contractVersion === "J4_REAL_EXECUTION_V5";

  const newPb = () => {
    if (!data || newBlockedReason("POST /sop/playbooks", { kind: "create", fields: {} })) return;
    setEditor({
      mode: "create",
      draft: (() => { const saved = authoringDrafts.get(session?.adminId, "POST /sop/playbooks"); return saved && savedPlaybookDraft(saved.desired); })(),
      scenes: (data.scenes ?? []).filter((item) => item !== "全部"),
      nameHint: "例如：监管点名快速止血",
      actionOptions: data?.actionOptions ?? [],
      rollbackOptions: data?.rollbackOptions ?? [],
      onNext: (draft) => { setEditor(null); confirmCreate(draft); },
    });
  };

  const header = (actionsSlot?: ReactNode) => (
    <PageHeader pageId="J4" title="监管要求应急处理"
      summary={<AutoGloss>出事时按预案一步步止损；平时维护预案和演练。</AutoGloss>}
      actions={actionsSlot}
      meta={<span className="rd-toolbar">
        {readAt && <span>{readAt} 读取（{businessZone().label}）<Explain label="数据时间说明" content="打开和点「刷新」时读取，不自动更新；操作成功后自动重读一次。审批通过后这页不会自己变，要点「刷新」。" /></span>}
        {!contentError && <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={contentLoading} onClick={reload}>刷新</Button>}
      </span>}
      readOnly={readOnly ? <>你只能查看 <Explain label="只读说明" content="新增、编辑和演练要预案维护权限；发起正式执行、取消和恢复核对要应急预案执行权限，请联系超级管理员。" /></> : undefined}
      guideExtra={<p>这个账号：{canWrite ? "能新增、编辑预案和演练" : "不能维护预案和演练"}，{canRun && canPropose ? "能发起正式执行（还要有每一步对应页面的处置权限）" : "不能发起正式执行"}，{canRun ? "能取消和恢复核对" : "不能取消和恢复核对"}，{canRun && canRestore ? "能恢复执行关停的开关" : "不能恢复执行关停的开关"}。</p>} />
  );
  const createAction = canWrite
    ? <Button variant="primary" icon={<Plus size={14} aria-hidden />} disabledReason={contentLoading ? READING : !contractReady ? NOT_READY : pending.some((row) => row.fingerprint === "POST /sop/playbooks") || legacy.some((row) => row.fingerprint === "POST /sop/playbooks") ? formatAdminApiError("J4_ORIGINAL_PENDING", "J4_ORIGINAL_PENDING") : undefined} onClick={newPb}>新增预案</Button>
    : undefined;

  const PLAYBOOKS = data?.playbooks ?? [];
  const EXECS = data?.executions ?? [];
  const isSupportedStep = (step: Playbook["seq"][number]) => (data?.actionOptions ?? []).some((option) => {
    if (option.domain !== step.dom || !option.ref || !step.ref) return false;
    if (!option.ref.includes("{target}")) return option.ref === step.ref;
    const [prefix] = option.ref.split("{target}");
    return step.ref.startsWith(prefix) && step.ref.length > prefix.length;
  });
  const unsupportedStepCount = (playbook: Playbook) => playbook.seq.filter((step) => !isSupportedStep(step)).length;
  const statNumber = (...keys: string[]) => {
    for (const key of keys) {
      const value = data?.stats[key];
      if (value == null || value === "" || typeof value === "string" && !value.trim()) continue;
      const parsed = typeof value === "number" || typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
      if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
    }
    return null;
  };
  // 近 90 天统计只取后端汇总；读不到时写「—」和原因，不当 0。
  const liveExecs = statNumber("liveExec90d");
  const drillExecs = statNumber("drill90d");
  const drillExecRows = statNumber("drillExecutionRows90d");

  const hasUnknown = (slot: string) => [...listJ4PendingCommands(), ...listJ4PendingProposals(), ...listJ4LegacyCommands()].some((record) => record.fingerprint === slot);
  const contextCode = (context: J4CommandContext) => "playbook" in context ? context.playbook.code : "execution" in context ? context.execution.code : undefined;
  const newBlockedReason = (slot: string, context: J4CommandContext) => {
    const state = current.current;
    if (!state.data || state.contentLoading || state.contentError) return READING;
    if (state.data.contractVersion !== "J4_REAL_EXECUTION_V5") return NOT_READY;
    if (!canRetry(context)) return formatAdminApiError("ACCESS_DENIED", "ACCESS_DENIED");
    if (hasUnknown(slot)) return formatAdminApiError("J4_ORIGINAL_PENDING", "J4_ORIGINAL_PENDING");
    const code = contextCode(context);
    if (code && listJ4LegacyCommands().some(record => {
      const match = /^PUT \/sop\/playbooks\/([^/]+)$/.exec(record.fingerprint);
      if (!match) return false;
      try { return decodeURIComponent(match[1]).toUpperCase() === code.toUpperCase(); }
      catch { return false; }
    })) return formatAdminApiError("J4_ORIGINAL_PENDING", "J4_ORIGINAL_PENDING");
    if (code && listJ4PendingCommands().some((record) => {
      const saved = record.sop.context;
      if ("playbook" in saved) return saved.playbook.code === code;
      return "execution" in saved && "execution" in context && saved.execution.executionId === context.execution.executionId;
    })) return formatAdminApiError("J4_ORIGINAL_PENDING", "J4_ORIGINAL_PENDING");
    if ("playbook" in context) {
      const latest = state.data.playbooks.find((row) => row.code === context.playbook.code);
      if (!latest || latest.version !== context.playbook.version) return READING;
      if (context.kind === "update" && !latest.version) return READING;
      if (context.kind === "execute" && (latest.executionReady !== true || latest.drillEvidence !== true || latest.state !== "active" || latest.draft)) return latest.readinessReason || "先完成演练";
      if (context.kind === "drill" || context.kind === "execute") {
        const supported = latest.seq.every((step) => state.data!.actionOptions.some((option) => option.domain === step.dom && !!step.ref && !!option.ref
          && (option.ref.includes("{target}") ? step.ref.startsWith(option.ref.split("{target}")[0]) && step.ref.length > option.ref.split("{target}")[0].length : option.ref === step.ref)));
        if (!supported) return "历史预案包含尚未接通的动作，请先编辑并替换后重新演练";
      }
    }
    if ("execution" in context) {
      const latest = state.data.executions.find((row) => row.executionId === context.execution.executionId && row.code === context.execution.code);
      if (!latest || latest.mode === "drill") return READING;
      const live = latest.steps.some((step) => step === "pending" || step === "running");
      if (context.kind === "rollback" ? live || latest.steps.includes("recovering") || !latest.reversible || latest.rollbackStatus === "ROLLED_BACK" : !live) return READING;
    }
    if (code && listJ4PendingProposals().some((record) => record.sopProposal.context.playbook.code === code && (context.kind === "execute" || !record.sopProposal.accepted))) return formatAdminApiError("J4_ORIGINAL_PENDING", "J4_ORIGINAL_PENDING");
    if (context.kind === "execute" && [...proposalRows.values()].some((row) => row.obj === context.playbook.code)) return formatAdminApiError("OBJECT_ALREADY_PENDING", "OBJECT_ALREADY_PENDING");
    return undefined;
  };
  const commandOptions = (slot: string, context: J4CommandContext, retained?: J4PendingCommand | J4PendingProposal): Partial<ActionConfirmReq> => {
    const frame = { slot, commandKey: retained?.commandKey };
    activeConfirmation.current = frame;
    return {
      formKey: ++formSequence.current,
      getPendingReason: () => {
        const record = listJ4PendingCommands().find(row => row.fingerprint === slot && row.commandKey === frame.commandKey);
        const proposal = listJ4PendingProposals().find(row => row.fingerprint === slot && row.commandKey === frame.commandKey);
        return record ? JSON.parse(record.sop.body).reason : proposal ? JSON.parse(proposal.sopProposal.body).reason : undefined;
      },
      getPendingRecovery: () => {
        const record = listJ4PendingCommands().find(row => row.fingerprint === slot && row.commandKey === frame.commandKey)
          ?? listJ4PendingProposals().find(row => row.fingerprint === slot && row.commandKey === frame.commandKey);
        if (!record) return;
        const state = jEmergencyRecovery.state(record);
        return { state, expiresAt: state.expiresAt, blockedReason: retryReadReason(context) ?? jEmergencyRetryBlocked(record),
          subscribe: jEmergencyRecovery.subscribe, getRevision: jEmergencyRecovery.getRevision,
          query: async () => {
            if ("sopProposal" in record) await queryProposal(record);
            else await queryOriginal(record, operationNames[context.kind]);
          } };
      },
    };
  };
  const runBackend = async (task: () => Promise<unknown>, ok: string, slot: string, context: J4CommandContext, retained?: J4PendingCommand | J4PendingProposal, consumeExecution?: () => void) => {
    const original = listJ4PendingCommands().find((row) => row.fingerprint === slot) ?? listJ4PendingProposals().find((row) => row.fingerprint === slot);
    if (retained && (!original || original.commandKey !== retained.commandKey)) {
      closeOriginalConfirm(retained);
      return;
    }
    const frame = activeConfirmation.current;
    if (original && frame?.commandKey !== original.commandKey) throw new Error("请先查询这项原操作的结果。");
    if (original && isRetryExpired(original)) throw new Error(RETRY_EXPIRED_TEXT);
    if (original && !canRetry(context)) throw new Error(retryReadReason(context) ?? "ACCESS_DENIED");
    if (!original) {
      const blocked = newBlockedReason(slot, context);
      if (blocked) throw new Error(blocked);
    }
    const owner = session?.adminId;
    const authoring = original ? undefined : authoringDrafts.get(owner, slot);
    let proposalResult: A2OperationRow | null | undefined;
    try {
      if (original && "sop" in original) await retryJ4Command(original);
      else if (original && "sopProposal" in original) {
        proposalResult = await retryJ4Proposal(original);
        if (proposalResult) observeProposal(original, proposalResult);
        else throw new Error("J4_PROPOSAL_STATUS_UNAVAILABLE");
      } else {
        const writing = task();
        if (frame?.slot === slot) frame.commandKey = context.kind === "execute" ? getJ4PendingProposal(context.playbook.code)?.commandKey : getJ4PendingCommand(slot)?.commandKey;
        const result = await writing;
        if (context.kind === "execute") {
          proposalResult = result as A2OperationRow | null;
          if (!proposalResult) throw new Error("J4_PROPOSAL_STATUS_UNAVAILABLE");
        }
      }
    } catch (error) {
      syncPending();
      const proposal = context.kind === "execute" ? getJ4PendingProposal(context.playbook.code) : undefined;
      if (!original && proposal) consumeExecution?.();
      if (!original && listJ4PendingCommands().some(row => row.fingerprint === slot)) authoringDrafts.consume(owner, slot, authoring);
      const accepted = proposal?.sopProposal.accepted;
      if (accepted) {
        closeOriginalConfirm(proposal);
        toast(formatAdminApiError("J4_PROPOSAL_STATUS_UNAVAILABLE", "J4_PROPOSAL_STATUS_UNAVAILABLE"), "warn");
        return;
      }
      if (original && isExplicitRejection(error)) {
        closeOriginalConfirm(original);
        toast(displayAdminError(error), "error");
        await actions.reloadJEmergency().catch(() => undefined);
      } else if (isEmergencyOutcomeUncertain(error) || isA2OutcomeUncertainError(error)) {
        // The original modal freezes through getPendingReason; no current data replaces its facts.
        const key = original?.commandKey ?? listJ4PendingCommands().find((row) => row.fingerprint === slot)?.commandKey ?? getJ4PendingProposal(contextCode(context) ?? "")?.commandKey ?? slot;
        noteError(key, error);
        if ((error as { reasonCode?: string }).reasonCode?.startsWith("J4_EXECUTION_PARTIAL:")) {
          setPartial((previous) => ({ ...previous, [key]: true }));
          await actions.reloadJEmergency().catch(() => undefined);
        }
      } else if (error instanceof Error && /J4_EXECUTION_PARTIAL/.test((error as { reasonCode?: string }).reasonCode ?? "")) {
        await actions.reloadJEmergency().catch(() => undefined);
      }
      throw error;
    }
    authoringDrafts.consume(owner, slot, authoring);
    if (!original) consumeExecution?.();
    syncPending();
    if (original) closeOriginalConfirm(original);
    else if (activeConfirmation.current === frame) activeConfirmation.current = null;
    const resultMessage = proposalResult && proposalResult.status !== "pending" ? J4_PROPOSAL_END[proposalResult.status] : ok;
    try {
      await actions.reloadJEmergency();
      toast(resultMessage, proposalResult && proposalResult.status !== "pending" && proposalResult.status !== "approved" ? "warn" : "success");
    } catch {
      toast(`${resultMessage}，但页面刷新失败，请手动刷新`, "warn");
    }
  };
  const effDrillState = (p: Playbook): "active" | "todo" | string => contractReady && unsupportedStepCount(p) === 0 && p.executionReady === true && p.drillEvidence === true && p.state === "active" && !p.draft ? "active" : "todo";
  const shown = PLAYBOOKS.filter((p) => scene === "全部" || p.scene === scene);
  const ready = PLAYBOOKS.filter((p) => effDrillState(p) === "active").length;
  const todo = PLAYBOOKS.length - ready;
  const missingDrillLedger = PLAYBOOKS.filter((p) => p.drillFresh === true && p.drillEvidence === false).length;
  const emerCount = PLAYBOOKS.filter((p) => p.emer).length;
  const active = EXECS.filter(isActiveExecution);
  const selected = shown.find((p) => p.code === selectedCode) ?? shown[0];
  const closeConfirm = () => openActionConfirm(null);

  const executionGate = (p: Playbook) => {
    const legacyStepCount = unsupportedStepCount(p);
    const hasTargetAuthorities = p.seq.every((step) => Boolean(TARGET_AUTHORITY[step.dom])
      && authorities.includes(TARGET_AUTHORITY[step.dom]));
    const missingPages = Array.from(new Set(p.seq.filter((step) => !TARGET_AUTHORITY[step.dom] || !authorities.includes(TARGET_AUTHORITY[step.dom])).map((step) => DOMAIN_PAGE[step.dom] ?? step.dom)));
    const state = effDrillState(p);
    const hasProposal = [...proposalRows.values()].some((row) => row.obj === p.code) || proposals.some((row) => row.sopProposal.context.playbook.code === p.code);
    const originalBlocked = newBlockedReason(j4ProposalSlot(p.code), { kind: "execute", playbook: p, emergency: p.emer, fields: {} });
    const canExecute = !originalBlocked && !hasProposal && contractReady && !contentLoading && canRun && canPropose && legacyStepCount === 0 && state === "active" && p.executionReady === true && hasTargetAuthorities;
    const hint = hasProposal ? formatAdminApiError("J4_ORIGINAL_PENDING", "J4_ORIGINAL_PENDING") : !contractReady ? NOT_READY : contentLoading ? READING : legacyStepCount > 0 ? "历史预案包含尚未接通的动作，请先编辑并替换后重新演练" : p.executionReady !== true || state !== "active" ? (p.readinessReason || "先完成演练") : !canRun ? "缺少应急预案执行权限" : !canPropose ? "缺少提交审批申请的权限" : !hasTargetAuthorities ? `缺少这些页面的处置权限：${missingPages.join("、")}` : originalBlocked;
    return { canExecute, hint, legacyStepCount, state };
  };

  // ---------- 写操作：新增、编辑（第二步：共用确认框） ----------
  const confirmCreate = (draft: PlaybookDraft, retained?: J4PendingCommand) => {
    const bv = draftValue(draft);
    const context: J4CommandContext = { kind: "create", fields: bv };
    const slot = "POST /sop/playbooks";
    openActionConfirm({ ...commandOptions(slot, context, retained), briefKind: "config",
      action: "新增应急预案",
      title: "新增预案",
      effect: <StatusTag tone="neutral" icon={FlaskConical}>保存后待演练</StatusTag>,
      facts: () => <div className="rd-stack">
        <Facts>
          <Fact k="预案">{draft.name.trim()}</Fact>
          <Fact k="场景和责任">{draft.scene} · {draft.owner} · 响应时限 {draft.sla}</Fact>
          <Fact k="通道">{draft.emergencyTrack === "true" ? "应急通道" : "常规"}</Fact>
          <Fact k="保存后" tone="warn">待演练：演练通过前不能正式执行，不动任何线上业务</Fact>
        </Facts>
        <StepTimeline steps={draft.lines.map(lineStep)} notify={{ campaignNo: draft.notifyCampaignNo, template: draft.notifyTemplate }} label="预案的步骤" />
        <div className="j4-back"><Button size="sm" variant="ghost" icon={<RotateCcw size={14} aria-hidden />} disabledReason={retained || hasUnknown(slot) ? formatAdminApiError("J4_ORIGINAL_PENDING", "J4_ORIGINAL_PENDING") : undefined} onClick={() => { if (hasUnknown(slot)) return; closeConfirm(); setEditor({ ...editorBase(), mode: "create", draft, onNext: (next) => { setEditor(null); confirmCreate(next); } }); }}>返回修改</Button></div>
      </div>,
      detail: <><b>设置应急预案</b>：名称、触发场景、负责角色、响应时限、是否走应急通道、执行动作、通知、回滚方案和演练要求。保存后进入预案库。</>,
      statedBrief: { impact: "保存后进入预案库，状态是待演练；演练通过前不能正式执行。", check: "核对步骤顺序和对象，理由写清依据或工单号。" },
      confirmLabel: "保存预案",
      reasonPlaceholder: REASON_HINT,
      run: (reason) => {
        const name = bv?.name || "未命名应急预案";
        return runBackend(() => actions.createJ4Playbook(playbookFormBody(bv, name), reason, createJEmergencyCommandKey(), context), `新预案「${name}」已创建${bv?.drillRequired === "true" ? "，请先完成演练" : "并可执行"}`, slot, context, retained);
      },
    });
  };
  const editorBase = (): Omit<EditorSpec, "mode" | "onNext"> => ({
    scenes: (data?.scenes ?? []).filter((item) => item !== "全部"),
    nameHint: "例如：监管点名快速止血",
    actionOptions: data?.actionOptions ?? [],
    rollbackOptions: data?.rollbackOptions ?? [],
  });
  const editSpec = (p: Playbook): EditorSpec => ({
    ...editorBase(),
    mode: "edit",
    playbook: p,
    nameHint: p.name,
    owners: Array.from(new Set([p.owner, "风控", "合规审计", "超管"])),
    current: { name: p.name, scene: p.scene, owner: p.owner, sla: p.sla, emergencyTrack: p.emer, actionSeq: actionSeqText(p), notifyCampaignNo: p.notifyCampaignNo, notifyTemplate: p.notifyTemplate, rollback: p.rollback, drillRequired: p.drillRequired },
    onNext: (draft) => { setEditor(null); confirmEdit(p, draft); },
  });
  const editPb = (p: Playbook) => {
    const slot = `PUT /sop/playbooks/${encodeURIComponent(p.code)}`;
    if (!p.version || newBlockedReason(slot, { kind: "update", playbook: p, fields: {} })) return;
    const saved = authoringDrafts.get(session?.adminId, slot);
    const latest = playbookBaseline(p);
    const merged = saved?.before ? rebaseTerminalDraft(saved.before, saved.desired, latest) : undefined;
    if (merged?.others.length && saved?.before) {
      const labels: Record<string, string> = { name: "名称", scene: "场景", owner: "负责角色", sla: "响应时限", emergencyTrack: "应急通道",
        actionSeq: "步骤", notifyCampaignNo: "通知活动", notifyTemplate: "通知模板", rollback: "回滚方案", drillRequired: "演练要求" };
      const linked = ["actionSeq", "notifyCampaignNo", "notifyTemplate", "rollback", "drillRequired", "emergencyTrack"];
      const reconfirm = merged.others.some(key => linked.includes(key))
        && linked.some(key => saved.before![key] !== saved.desired[key]);
      if (reconfirm) for (const key of linked) merged.value[key] = latest[key];
      const changed = merged.others.map(key => `${labels[key]} ${saved.before![key]} → ${latest[key]}`).join("、");
      const mine = Object.keys(saved.desired).filter(key => saved.before![key] !== saved.desired[key]).map(key => `${labels[key]} ${saved.desired[key]}`).join("、");
      toast(`别人改过：${changed}。原拟改：${mine || "无"}。${reconfirm ? "请重新选择联动的步骤和执行设置。" : "请核对最新预案。"}`, "warn");
    }
    setEditor({ ...editSpec(p), draft: merged && savedPlaybookDraft(merged.value) });
  };
  const confirmEdit = (p: Playbook, draft: PlaybookDraft, retained?: J4PendingCommand) => {
    const bv = draftValue(draft);
    const context: J4CommandContext = { kind: "update", playbook: p, fields: bv };
    const slot = `PUT /sop/playbooks/${encodeURIComponent(p.code)}`;
    const before = initialDraft(editSpec(p));
    const changes = draftChanges(before, draft);
    const stepsChanged = before.lines.join("\n") !== draft.lines.join("\n");
    openActionConfirm({ ...commandOptions(slot, context, retained), briefKind: "config",
      action: `编辑应急预案 · ${p.code} ${p.name}`,
      title: "保存预案修改",
      effect: <StatusTag tone="neutral" icon={FlaskConical}>保存后要重新演练</StatusTag>,
      facts: () => <div className="rd-stack">
        <Facts>
          <Fact k="预案">{p.name}<span className="j4-muted"> · <span data-mono="">{p.code}</span></span></Fact>
          {changes.map((row) => <Fact key={row.k} k={row.k}><Change from={row.from} to={row.to} /></Fact>)}
          {stepsChanged && <Fact k="步骤"><Change from={`${count(before.lines.length)} 步`} to={`${count(draft.lines.length)} 步`} /></Fact>}
          {changes.length === 0 && !stepsChanged && <Fact k="改动">没有改动；保存后仍会回到待演练</Fact>}
          <Fact k="保存后" tone="warn">回到待演练，要重新演练才能正式执行；已有的执行记录不变，等批准的申请批准时会因预案已改而被拒</Fact>
        </Facts>
        {stepsChanged && <StepTimeline steps={draft.lines.map(lineStep)} notify={{ campaignNo: draft.notifyCampaignNo, template: draft.notifyTemplate }} label="改后的步骤" />}
        <div className="j4-back"><Button size="sm" variant="ghost" icon={<RotateCcw size={14} aria-hidden />} disabledReason={retained || hasUnknown(slot) ? formatAdminApiError("J4_ORIGINAL_PENDING", "J4_ORIGINAL_PENDING") : undefined} onClick={() => { if (hasUnknown(slot)) return; closeConfirm(); setEditor({ ...editSpec(p), draft }); }}>返回修改</Button></div>
      </div>,
      detail: <><b>编辑预案</b>：调整 {p.name} 的执行步骤（当前 {p.seq.length} 步）、触发场景、负责角色、响应时限、是否走应急通道、通知和回滚方案。保存后会保留修改记录。</>,
      statedBrief: { impact: "只改以后用的预案定义；保存后回到待演练。", check: "核对改动，理由写清依据或工单号。" },
      confirmLabel: "保存修改",
      reasonPlaceholder: REASON_HINT,
      run: (reason) => {
        const steps = (bv?.actionSeq || "").split("\n").map((s) => s.trim()).filter(Boolean);
        const summary = steps.length ? steps.join(" | ") : `${bv?.name || p.name} · ${bv?.scene || p.scene} · ${bv?.owner || p.owner}`;
        return runBackend(() => actions.updateJ4Playbook(p.code, { ...playbookFormBody(bv, p.name), summary, version: p.version! }, reason, createJEmergencyCommandKey(), context), `${p.code} 预案变更已保存${bv?.drillRequired === "true" ? "，需重新演练" : ""}(${steps.length} 步)`, slot, context, retained);
      },
    });
  };

  const drillPb = (p: Playbook, retained?: J4PendingCommand) => {
    if (!retained && unsupportedStepCount(p) > 0) {
      toast("历史预案包含尚未接通的动作，请先编辑并替换后再演练");
      return;
    }
    const context: J4CommandContext = { kind: "drill", playbook: p };
    const slot = `POST /sop/playbooks/${encodeURIComponent(p.code)}/drills`;
    openActionConfirm({ ...commandOptions(slot, context, retained), briefKind: "record",
      action: `启动演练 · ${p.code} ${p.name}`,
      title: "演练预案",
      effect: NO_REAL,
      facts: <Facts>
        <Fact k="预案">{p.name}<span className="j4-muted"> · <span data-mono="">{p.code}</span></span></Fact>
        <Fact k="会检查">{count(p.seq.length)} 步的对象还在不在、能不能执行；{p.seq.some((step) => step.dom === "I3") ? "通知活动是不是已排期" : "没有通知步骤"}</Fact>
        <Fact k="不会做">不关停业务、不封锁国家、不冻结账户、不发通知、不发布披露</Fact>
        <Fact k="通过后">预案变成可执行，90 天内有效；不保证到时候对象还能执行</Fact>
      </Facts>,
      detail: <><b>演练</b>（不是真的执行）：逐步检查这 {p.seq.length} 步能不能执行、通知能不能发出，不会影响线上。全部通过后，预案变为「演练就绪」。</>,
      statedBrief: { impact: "只检查、写一条演练记录，不动任何真实业务。", check: "理由写清演练原因或工单号。" },
      confirmLabel: "开始演练",
      reasonPlaceholder: "例如：季度演练、预案修改后重新演练",
      run: (reason) => {
        return runBackend(() => actions.drillJ4Playbook(p.code, reason, createJEmergencyCommandKey(), context), `${p.code} 演练通过，预案已就绪`, slot, context, retained);
      },
    });
  };

  // ---------- 发起正式执行：第一步页面框，第二步共用确认框 ----------
  // 注:执行剧本不传 amplifies —— B1 前置只挂「恢复放大流出」方向;应急执行是止血方向(熔断/封锁/暂停),
  // 覆盖率低于红线时恰恰最需要执行(SOP-02 对账缺口/SOP-03 挤兑),不可被 B1 禁放行锁死(对齐 J1「熔断方向不前置 B1」)。
  const openExecute = (p: Playbook, isEmer: boolean, draft?: ExecuteDraft, resumed?: Pick<ExecuteDraft, "triggerBasis" | "triggerContext">) => {
    if (!executionGate(p).canExecute) return;
    const saved = executionDrafts.current.get(executeDraftKey(p.code, isEmer));
    setPrepare({
      playbook: p,
      emergency: isEmer,
      resumed: draft ? resumed : saved,
      draft: draft ?? {
        triggerBasis: saved?.triggerBasis ?? (p.scene === "监管点名" ? "监管点名" : (p.scene === "舆情挤兑" || p.scene === "资金异常" ? "挤兑风险" : "安全事件")),
        triggerContext: saved?.triggerContext ?? "",
        confirmed: p.seq.map(() => false),
      },
    });
  };
  const execPb = (p: Playbook, isEmer: boolean, draft: ExecuteDraft, retained?: J4PendingProposal, resumed?: Pick<ExecuteDraft, "triggerBasis" | "triggerContext">) => {
    const businessValue: Record<string, string> = {
      triggerBasis: draft.triggerBasis,
      triggerContext: draft.triggerContext,
      ...Object.fromEntries(p.seq.map((_, index) => [`stepConfirm.${index}`, draft.confirmed[index] ? "true" : "false"])),
    };
    const context: Extract<J4CommandContext, { kind: "execute" }> = { kind: "execute", playbook: p, emergency: isEmer, fields: businessValue };
    const slot = j4ProposalSlot(p.code);
    openActionConfirm({ ...commandOptions(slot, context, retained), briefKind: "emergency",
      action: `执行应急预案 · ${p.code}${isEmer ? "（应急通道）" : "（常规通道）"}`,
      title: "提交执行申请",
      effect: <>
        <StatusTag tone="warn" icon={Clock3}>批准后才执行</StatusTag>
        {isEmer ? <StatusTag tone="danger" icon={Siren}>应急通道</StatusTag> : <StatusTag tone="neutral" icon={Workflow}>常规通道</StatusTag>}
      </>,
      facts: () => <div className="rd-stack">
        <Facts>
          <Fact k="预案">{p.name}<span className="j4-muted"> · <span data-mono="">{p.code}</span></span></Fact>
          <Fact k="谁来批">{APPROVER}</Fact>
          <Fact k="批准前">什么都不会发生</Fact>
          <Fact k="批准后">自动按顺序执行 {count(p.seq.length)} 步，不再逐步等人确认；某一步失败就停下，前面做完的保持生效</Fact>
          <Fact k="收得回吗" tone="warn">{undoSummary(p.seq)}</Fact>
          {p.seq.some((step) => step.impact) && <Fact k="影响人数" tone="warn">系统算不出，不代表没有影响</Fact>}
          <Fact k="触发依据">{draft.triggerBasis}</Fact>
          <Fact k="触发说明">{draft.triggerContext.trim()}</Fact>
        </Facts>
        <div className="j4-back"><Button size="sm" variant="ghost" icon={<RotateCcw size={14} aria-hidden />} disabledReason={retained || hasUnknown(slot) ? formatAdminApiError("J4_ORIGINAL_PENDING", "J4_ORIGINAL_PENDING") : undefined} onClick={() => { if (hasUnknown(slot)) return; closeConfirm(); openExecute(p, isEmer, draft, resumed); }}>返回修改</Button></div>
      </div>,
      detail: (
        <>
          {isEmer
            ? <><b>应急通道</b>：执行记为应急执行，审批人、批准要求和执行顺序都和常规一样，不会加急；仍要填写原因，每一步都会记录。</>
            : <><b>常规通道</b>：按步骤依次执行。</>}
          <br />提交后需在「操作记录与审批」批准，批准后依次执行以下步骤
          <span className="j4-detail-steps">
            {p.seq.map((s, i) => <span key={i}>{i + 1}. {stepInfo(s).title}{stepInfo(s).target ? ` ${stepInfo(s).target}` : ""}</span>)}
          </span>
          <b>责任</b>：{p.owner} · <b>处理时限</b>：{p.sla}
        </>
      ),
      statedBrief: { impact: `提交后只建一张审批申请，批准前任何业务都不变；批准后自动按顺序执行 ${p.seq.length} 步。`, check: "核对预案、每一步和触发说明，理由写清监管来函、事件或工单编号。" },
      confirmTone: "danger",
      confirmLabel: "提交执行申请",
      reasonPlaceholder: REASON_HINT,
      run: async (reason) => {
        if (p.seq.some((_, index) => businessValue[`stepConfirm.${index}`] !== "true")) {
          throw new Error("请逐项确认全部动作后再提交执行");
        }
        const stepConfirmations = p.seq.map((step, index) => ({
          step: index + 1,
          domain: step.dom,
          ref: step.ref || "",
          confirmed: true as const,
        }));
        const triggerBasis = businessValue?.triggerBasis ?? "";
        const triggerContext = businessValue?.triggerContext ?? "";
        return runBackend(() => submitJ4Proposal({
          action: `执行应急预案 · ${p.code}`,
          obj: p.code,
          beforeValue: "演练就绪",
          afterValue: "批准后逐步执行",
          operator: session?.operator ?? session?.username ?? "",
          operatorRole: session?.role ?? "superadmin",
          type: "sos",
          amplifies: false,
          sos: true,
          roleGate: "审批确认",
          reason,
          sourceDomain: "J4",
          command: {
            domain: "J",
            op: "j4_playbook_execute",
            params: {
              code: p.code,
              emergency: isEmer,
              triggerBasis,
              triggerContext,
              stepConfirmations,
            },
          },
          target: { domain: "J", type: "playbook", id: p.code },
        }, createJEmergencyCommandKey(), context, observeProposal), `${p.code} 已提交，批准后才会依次执行`, slot, context, retained, () => {
          const key = executeDraftKey(p.code, isEmer);
          if (resumed && executionDrafts.current.get(key) === resumed) executionDrafts.current.delete(key);
        });
      },
    });
  };

  // ---------- 执行记录上的写操作 ----------
  // 回滚单次剧本执行:只恢复本次执行关停的 J1 开关 · 直接生效 · 不可应急加速。
  const rollbackPb = (exec: SopExecution, retained?: J4PendingCommand) => {
    const context: J4CommandContext = { kind: "rollback", execution: exec };
    const slot = `POST /sop/playbooks/${encodeURIComponent(exec.code)}/executions/${encodeURIComponent(exec.executionId!)}/rollback`;
    const gates = reversibleGates(exec);
    const others = exec.domainActions.filter((action) => String(action.domain ?? "").toUpperCase() !== "J1" && ["DONE", "RUNNING"].includes(String(action.status ?? "").toUpperCase())).map((action) => stepInfo({ dom: String(action.domain ?? ""), ax: String(action.action ?? ""), ref: action.ref ? String(action.ref) : String(action.domain) === "I3" ? "campaign-notify" : null }).title);
    openActionConfirm({ ...commandOptions(slot, context, retained), briefKind: "emergency",
      action: `回滚预案执行 · ${exec.executionId}`,
      title: "恢复本次关停的开关",
      effect: IMMEDIATE,
      facts: <Facts>
        <Fact k="执行">{exec.name}<span className="j4-muted"> · <span data-mono="">{exec.executionId}</span></span></Fact>
        <Fact k="会恢复">{gates.length ? `${gates.join("、")}开关，恢复后用户马上能用` : "这次执行关停的开关"}</Fact>
        <Fact k="不会恢复" tone="warn">{others.length ? `${Array.from(new Set(others)).join("、")}：这页收不回，到对应页面处理；已发出的通知撤不回` : "记录里没有其他做完的步骤；失败的步骤也可能已生效，到对应页面核对。已发出的通知撤不回"}</Fact>
        <Fact k="前提">开关后来被别人改过的不恢复；系统先查兑付覆盖率和估值，不达标整次不执行</Fact>
        <Fact k="和「紧急停用开关」">这里直接恢复、不走审批；在「紧急停用开关」页恢复要提交审批</Fact>
      </Facts>,
      detail: <><b>{exec.code}</b>(<span data-mono="">{exec.executionId}</span>)会把这次执行中关停的业务开关逐个恢复。已发出的通知撤不回，需要更正请另发通知。</>,
      statedBrief: { impact: "这次执行关停的开关马上恢复，其他步骤不受影响。", check: "确认风险已经解除，理由写清复核结论或工单号。" },
      confirmTone: "danger",
      confirmLabel: "确认恢复，立即生效",
      reasonPlaceholder: "例如：风险已解除的复核结论、工单号",
      run: (reason) => {
        return runBackend(() => actions.rollbackJ4Playbook(exec.code, exec.executionId!, reason, createJEmergencyCommandKey(), context), `${exec.executionId} 已回滚`, slot, context, retained);
      },
    });
  };

  const cancelExecution = (exec: SopExecution, retained?: J4PendingCommand) => {
    const context: J4CommandContext = { kind: "cancel", execution: exec };
    const slot = `POST /sop/playbooks/${encodeURIComponent(exec.code)}/executions/${encodeURIComponent(exec.executionId!)}/cancel`;
    const runningAt = exec.steps.findIndex((step) => step === "running" || step === "recovering");
    openActionConfirm({ ...commandOptions(slot, context, retained), briefKind: "record",
      action: `取消执行 · ${exec.executionId}`,
      title: "登记取消",
      effect: IMMEDIATE,
      facts: <Facts>
        <Fact k="执行">{exec.name}<span className="j4-muted"> · <span data-mono="">{exec.executionId}</span></span></Fact>
        <Fact k="现在">{runningAt >= 0 ? `第 ${runningAt + 1} 步${exec.steps[runningAt] === "running" ? "执行中" : "恢复核对中"}` : "还没开始执行"}，共 {count(exec.steps.length)} 步</Fact>
        <Fact k="会怎样">正在做的这一步做完才停；后面没开始的跳过；做完的保持生效，不撤回</Fact>
        <Fact k="之后">登记后刷新看最终逐步状态；如果已经做到最后一步，可能照常全部完成</Fact>
      </Facts>,
      detail: <>取消只是登记，正在执行的那一步不会被中断；最终结果以刷新后的逐步状态为准。</>,
      statedBrief: { impact: "只登记取消请求，下一步开始前生效。", check: "理由写清为什么要停。" },
      confirmLabel: "登记取消",
      reasonPlaceholder: "例如：监管要求变化、误发起",
      run: (reason) => runBackend(
        () => actions.cancelJ4Playbook(exec.code, exec.executionId!, reason, createJEmergencyCommandKey(), context),
        `${exec.executionId} 已登记取消请求，请刷新核对最终逐步状态`, slot, context, retained,
      ),
    });
  };

  const resumeExecution = (exec: SopExecution, retained?: J4PendingCommand) => {
    const context: J4CommandContext = { kind: "resume", execution: exec };
    const slot = `POST /sop/playbooks/${encodeURIComponent(exec.code)}/executions/${encodeURIComponent(exec.executionId!)}/resume`;
    const stuck = exec.steps.map((status, index) => ({ status, index, action: exec.domainActions.find((row) => Number(row.step) === index + 1) }))
      .filter((row) => row.status === "pending" || row.status === "running");
    openActionConfirm({ ...commandOptions(slot, context, retained), briefKind: "record",
      action: `恢复核对 · ${exec.executionId}`,
      title: "恢复核对",
      effect: <StatusTag tone="neutral" icon={ScanSearch}>不重新执行</StatusTag>,
      facts: <Facts>
        <Fact k="执行">{exec.name}<span className="j4-muted"> · <span data-mono="">{exec.executionId}</span></span></Fact>
        <Fact k="什么时候能核对">这次执行最后一次更新超过 2 分钟；没到时间会被拒绝，稍后再试</Fact>
        {stuck.map((row) => {
          const dom = String(row.action?.domain ?? "").toUpperCase();
          const outcome = row.status === "pending" ? "还没开始，记为跳过"
            : dom === "J1" || dom === "I3" ? "按系统记录核对：能证明做成的记成功，否则记失败"
            : "系统没有这一步的完成记录，会记为失败；实际可能已经生效，到对应页面核对";
          const title = row.action ? stepInfo({ dom, ax: String(row.action.action ?? ""), ref: row.action.ref ? String(row.action.ref) : dom === "J1" ? String(row.action.configKey ?? "").replace("killswitch.", "") : dom === "I3" ? "campaign-notify" : null }).title : "";
          return <Fact key={row.index} k={`第 ${row.index + 1} 步`} tone={row.status === "running" && dom !== "J1" && dom !== "I3" ? "warn" : undefined}>{title ? `${title}：` : ""}{outcome}</Fact>;
        })}
        <Fact k="之后">不会自动执行剩下的步骤；有失败或跳过时这次执行记为部分完成</Fact>
      </Facts>,
      detail: <>只对超时后仍卡在「待执行 / 执行中」的记录有效。系统会逐步核对：确认做成的记成功，无法确认的记失败并停止后续步骤，不会重复执行。</>,
      statedBrief: { impact: "只核对卡住的步骤并结束这次执行，不重新执行任何一步。", check: "理由写清为什么核对。" },
      confirmLabel: "开始核对",
      reasonPlaceholder: "例如：执行超过 2 分钟没有进展",
      run: (reason) => runBackend(
        () => actions.resumeJ4Playbook(exec.code, exec.executionId!, reason, createJEmergencyCommandKey(), context),
        `${exec.executionId} 已完成恢复核对`, slot, context, retained,
      ),
    });
  };

  function restoreOriginal(record: J4PendingCommand) {
    const context = record.sop.context;
    if (isRetryExpired(record) || !canRetry(context)) return;
    if (context.kind === "create" || context.kind === "update") {
      const draft = savedPlaybookDraft(context.fields);
      if (context.kind === "create") confirmCreate(draft, record);
      else confirmEdit(context.playbook, draft, record);
    } else if (context.kind === "drill") drillPb(context.playbook, record);
    else if (context.kind === "cancel") cancelExecution(context.execution, record);
    else if (context.kind === "resume") resumeExecution(context.execution, record);
    else if (context.kind === "rollback") rollbackPb(context.execution, record);
  }
  function restoreProposal(record: J4PendingProposal) {
    const context = record.sopProposal.context;
    if (isRetryExpired(record) || record.sopProposal.accepted || !canRetry(context)) return;
    execPb(context.playbook, context.emergency, {
      triggerBasis: context.fields.triggerBasis, triggerContext: context.fields.triggerContext,
      confirmed: context.playbook.seq.map((_, index) => context.fields[`stepConfirm.${index}`] === "true"),
    }, record);
  }

  const executionActions = (e: SopExecution, compact = false) => {
    const live = contractReady && canRun && Boolean(e.executionId) && e.mode !== "drill" && e.steps.some((step) => step === "pending" || step === "running");
    const restorable = contractReady && canRun && canRestore && Boolean(e.executionId) && e.reversible && !e.steps.some((step) => step === "pending" || step === "running" || step === "recovering") && e.mode !== "drill" && e.rollbackStatus !== "ROLLED_BACK";
    return <span className="j4-row-acts">
      {compact && <Button size="sm" icon={<ScanSearch size={14} aria-hidden />} onClick={() => setTraceExecution(e)}>追溯</Button>}
      {live && <Button size="sm" icon={<Square size={14} aria-hidden />} disabledReason={newBlockedReason(`POST /sop/playbooks/${encodeURIComponent(e.code)}/executions/${encodeURIComponent(e.executionId!)}/cancel`, { kind: "cancel", execution: e })} onClick={() => cancelExecution(e)}>取消</Button>}
      {live && <Button size="sm" disabledReason={newBlockedReason(`POST /sop/playbooks/${encodeURIComponent(e.code)}/executions/${encodeURIComponent(e.executionId!)}/resume`, { kind: "resume", execution: e })} onClick={() => resumeExecution(e)}>恢复核对</Button>}
      {restorable && <Button size="sm" variant="danger-outline" icon={<RotateCcw size={14} aria-hidden />} disabledReason={newBlockedReason(`POST /sop/playbooks/${encodeURIComponent(e.code)}/executions/${encodeURIComponent(e.executionId!)}/rollback`, { kind: "rollback", execution: e })} onClick={() => rollbackPb(e)}>恢复开关</Button>}
    </span>;
  };

  // ---------- 正在执行 ----------
  const overviewUnavailable = Boolean(contentError || contentLoading || !data);
  const visibleActive = overviewUnavailable ? [] : active;
  // 审批来源读不到时，等批准的申请不能显示成 0 张。
  const queueNotice = queueFailed && <Notice tone="warn" title="等批准的执行申请没读到">
    「操作记录与审批」暂时读不到，这里先不显示等批准的申请，不代表没有。{reach("/platform/audit", "platform_a2_read") && <> <Link className="rd-link" href="/platform/audit?domain=J" prefetch={false}>去操作记录与审批查看 →</Link></>}
  </Notice>;
  const activePanel = (visibleActive.length > 0 || pendingProposals.length > 0) && (
    <Panel title={overviewUnavailable ? "等批准的执行申请" : "正在执行"} icon={Workflow} tone="role-3"
      sub={overviewUnavailable ? `${count(pendingProposals.length)} 张 · 执行进度暂时读不到` : `${count(visibleActive.length)} 次${pendingProposals.length ? ` · ${count(pendingProposals.length)} 张申请等批准` : ""}`}
      explain={<>
        <p>批准后系统按顺序自动执行；每一步的状态在这里看。</p>
        <p>取消：正在做的这一步做完才停，后面跳过，做完的不撤回。</p>
        <p>恢复核对：最后一次更新超过 2 分钟还卡着时用，系统只核对、不重新执行；证明不了做成的记为失败。</p>
      </>}>
      <ul className="j4-live" aria-label="正在执行">
        {visibleActive.map((e) => {
          return (
            <li key={e.executionId || `${e.ts}-${e.code}`} className="j4-live-item" data-testid={e.executionId ? `j4-live-${e.executionId}` : undefined}>
              <div className="j4-live-head">
                <span className="j4-live-name">{e.name || e.code}</span>
                <StatusTag tone={e.mode === "emergency" ? "danger" : "neutral"} icon={e.mode === "emergency" ? Siren : Workflow}>{executionModeLabel(e.mode)}</StatusTag>
                {e.notificationDispatch.cancelRequested === true && <StatusTag tone="warn" icon={Square}>已登记取消</StatusTag>}
                <span className="j4-muted">{j4Time(e.ts)} 开始 · {e.operator || "—"} · <span data-mono="">{e.executionId || "执行编号缺失"}</span></span>
                {executionActions(e, true)}
              </div>
              <ol className="j4-live-steps" aria-label="逐步进度">
                {e.steps.map((status, index) => {
                  const action = e.domainActions.find((row) => row.step === index + 1);
                  const step = action ? { dom: String(action.domain ?? ""), ax: String(action.action ?? ""),
                    ref: action.ref ? String(action.ref) : action.domain === "J1" ? String(action.configKey ?? "").replace("killswitch.", "") : action.domain === "I3" ? "campaign-notify" : null } : undefined;
                  const info = step ? stepInfo(step, { campaignNo: action?.campaignNo ? String(action.campaignNo) : undefined }) : undefined;
                  return <li key={index} data-state={status}>
                    <span className="j4-live-n">{index + 1}</span>
                    <span className="j4-live-label">{info ? info.title : `第 ${index + 1} 步`}{info?.target && <span className="j4-step-target" data-mono="">{info.target}</span>}</span>
                    <span className="j4-live-state">{({ pending: "待执行", running: "执行中", recovering: "恢复核对中", done: "成功", failed: "失败", skipped: "已跳过", rolled_back: "已恢复" } as Record<string, string>)[status] ?? "状态未知"}</span>
                  </li>;
                })}
              </ol>
            </li>
          );
        })}
        {pendingProposals.map((row) => <li key={row.key} className="j4-live-item"><div className="j4-live-head"><span className="j4-live-name">{row.name}</span><StatusTag tone="warn" icon={Clock3}>等批准</StatusTag><span className="j4-muted">{row.meta}</span>{overviewUnavailable && row.onQuery && <Button size="sm" onClick={row.onQuery}>查询原操作</Button>}</div></li>)}
      </ul>
      <p className="j4-note">时间为{businessZone().label}</p>
    </Panel>
  );

  const editorReadProblem = contentError || contentLoading || !data ? READING : !contractReady ? NOT_READY : undefined;
  const renderPage = (body: ReactNode, trace?: ReactNode) => <div className="j4-page">
    {body}
    {editor && <PlaybookEditor spec={editor} onClose={() => setEditor(null)} blockedReason={editorReadProblem}
      notifyTemplates={emergency.notifyTemplates ?? []} notifyTemplatesError={emergency.notifyTemplatesError}
      notifyTemplatesLoading={ctx.notifyTemplatesLoading} />}
    {prepare && <ExecutePrepare playbook={prepare.playbook} emergency={prepare.emergency} draft={prepare.draft} blockedReason={editorReadProblem}
      onClose={() => setPrepare(null)}
      onNext={(draft) => {
        const { playbook, emergency, resumed } = prepare;
        setPrepare(null);
        execPb(playbook, emergency, draft, undefined, resumed);
      }} />}
    {trace}
  </div>;
  if (contentError) {
    return renderPage(<>
      {header()}
      {recovery}
      {activePanel}
      <BlockState retryKey="j4-sop-1051" state="error" title="应急预案加载失败" detail={`${contentError} 为避免误操作，控制项已隐藏。`} onRetry={ctx.retryJ4Playbooks} retrying={contentLoading} />
    </>);
  }
  if (!data) {
    return renderPage(<>
      {header()}
      {recovery}
      {activePanel}
      {contentLoading
        ? <BlockState state="loading" title="应急预案数据加载中" detail="正在加载预案和执行记录" />
        : <BlockState state="empty" title="暂无 应急预案数据" detail="点右上角「刷新」重新读取。" />}
    </>);
  }

  // ---------- 结论 ----------
  const conclusion = !contractReady ? (
    <Conclusion state="danger" hint="请联系技术人员检查后再进行操作。">应急执行服务尚未就绪，当前仅可查看</Conclusion>
  ) : active.length > 0 ? (
    <Conclusion state="warn" lead hint={canRun ? "在下面「正在执行」看做到哪一步；卡住时可以恢复核对，能不能核对由系统按最后一次更新判断。" : "在下面「正在执行」看做到哪一步；取消和恢复核对请找有执行权限的同事。"}>{count(active.length)} 次正式执行进行中</Conclusion>
  ) : PLAYBOOKS.length === 0 ? (
    <Conclusion state="warn" hint={canWrite ? "点右上角「新增预案」，保存后演练通过才能用。" : "请有预案维护权限的同事新增。"}>还没有应急预案，出事时没有可用的预案</Conclusion>
  ) : ready === 0 ? (
    <Conclusion state="warn" hint={canWrite ? "在「预案库」选预案点「演练」，演练通过才能正式执行。" : "请有预案维护权限的同事演练。"}>{count(PLAYBOOKS.length)} 个预案都还不能正式执行</Conclusion>
  ) : (
    <Conclusion state="ok" hint="出事时在「预案库」按场景选预案，看清步骤后点「发起正式执行」。">{count(ready)} 个预案可执行，没有进行中的执行</Conclusion>
  );

  // ---------- 预案库 ----------
  const sceneCounts = (s: string) => s === "全部" ? PLAYBOOKS.length : PLAYBOOKS.filter((p) => p.scene === s).length;
  const statusTag = (p: Playbook) => {
    const gate = executionGate(p);
    if (gate.legacyStepCount > 0) return <StatusTag tone="warn" icon={TriangleAlert} explain={`历史预案：${gate.hint}`}>需迁移</StatusTag>;
    if (gate.state === "active") return <StatusTag tone="ok" icon={ShieldCheck}>可执行</StatusTag>;
    if (!contractReady) return <StatusTag tone="neutral" icon={TriangleAlert} explain={NOT_READY}>服务未就绪</StatusTag>;
    return <StatusTag tone="warn" explain={p.readinessReason || undefined}>{p.readinessReason ? (p.readinessReason.length > 12 ? "待演练" : p.readinessReason) : "草稿 · 待演练"}</StatusTag>;
  };
  const libraryPanel = (
    <Panel title="预案库" icon={BookOpen} tone="role-3" flush sub={`${count(PLAYBOOKS.length)} 个`}
      explain="按场景挑预案，点一行在右边看它会依次做什么。演练通过、90 天内有效的才能正式执行。">
      <div className="j4-lib-filter">
        <Segments label="按触发场景筛预案" value={scene} onChange={setScene}
          items={(data.scenes.includes(scene) ? data.scenes : [...data.scenes, scene]).map((s) => ({ value: s, label: s, count: sceneCounts(s) }))} />
      </div>
      <Table label="预案库" className="j4-lib-table" rowFocus>
        <thead><tr><Th>预案</Th><Th>场景</Th><Th align="right">步骤</Th><Th>状态</Th></tr></thead>
        <tbody>
          {shown.length === 0
            ? <TableMessage columns={4}>{PLAYBOOKS.length === 0
              ? (canWrite ? "还没有预案。点右上角「新增预案」。" : "还没有预案。如需新增，请联系有预案维护权限的同事。")
              : (canWrite ? "这个场景没有预案。可以切到「全部」看其他预案，或点右上角「新增预案」。" : "这个场景没有预案。可以切到「全部」看其他预案；如需新增，请联系有预案维护权限的同事。")}</TableMessage>
            : shown.map((p) => (
              <Tr key={p.code} selected={selected?.code === p.code} onOpen={() => { setSelectedCode(p.code); window.requestAnimationFrame(() => document.getElementById("j4-detail")?.scrollIntoView({ block: "nearest" })); }}
                data-testid={`j4-playbook-${p.code}`} aria-label={`${p.code} ${p.name}`}>
                <Td><Cell main={<>{p.name}{p.emer && <> <StatusTag tone="danger" icon={Siren}>应急通道</StatusTag></>}</>} sub={<span data-mono="">{p.code}</span>} title={p.name} /></Td>
                <Td>{p.scene || "—"}</Td>
                <Td align="right"><span className="j4-num">{count(p.seq.length)}</span></Td>
                <Td>{statusTag(p)}</Td>
              </Tr>
            ))}
        </tbody>
      </Table>
    </Panel>
  );

  const detailPanel = selected ? (() => {
    const p = selected;
    const gate = executionGate(p);
    const supported = p.seq.filter(isSupportedStep);
    return (
      <Panel id="j4-detail" title={p.name} icon={ListChecks} tone="role-3" sub={<span data-mono="">{p.code}</span>}
        explain={`批准后系统按下面的顺序自动执行；每一步写着做什么、对象、影响和收不收得回。${p.seq.some((step) => step.impact) ? "影响人数系统算不出，不代表没有影响。" : ""}`}
        actions={<>{p.emer ? <StatusTag tone="danger" icon={Siren} explain="执行记为「应急执行」。审批人、批准要求和执行顺序都和常规一样，不会加急。">应急通道</StatusTag> : <StatusTag tone="neutral" icon={Workflow}>常规</StatusTag>}{statusTag(p)}</>}
        data-testid={`j4-playbook-detail-${p.code}`}>
        <KeyValues rows={[
          { key: "scene", label: "触发场景", value: <AutoGloss>{p.scene || "—"}</AutoGloss> },
          { key: "owner", label: "责任", value: <AutoGloss>{p.owner || "—"}</AutoGloss> },
          { key: "sla", label: "响应时限", value: p.sla || "—" },
          { key: "drill", label: "最近演练", value: p.lastDrill ? (p.lastDrill === "未演练" ? "未演练" : j4Time(p.lastDrill, p.lastDrill)) : "—" },
        ]} />
        {gate.state !== "active" && (gate.legacyStepCount > 0
          ? <Notice tone="warn">{gate.legacyStepCount} 个动作已经不能执行，先编辑预案换掉，再重新演练。</Notice>
          : !contractReady ? <Notice tone="danger">{NOT_READY}。</Notice>
          : <Notice tone="warn">{p.readinessReason || "待演练"}。演练通过才能正式执行。</Notice>)}
        <h3 className="j4-sub-title">按下去会依次发生 <span className="j4-muted">{count(p.seq.length)} 步 · {undoSummary(supported)}</span></h3>
        {p.seq.length === 0 ? <p className="j4-muted">这个预案没有步骤。</p> : <StepTimeline steps={p.seq} notify={{ campaignNo: p.notifyCampaignNo, template: p.notifyTemplate }} />}
        <KeyValues rows={[
          { key: "notify", label: "通知活动", value: (p.notifyTemplate && notifyLabelText(p.notifyTemplate)) || p.notifyCampaignNo || "未绑定" },
          { key: "rollback", label: "回滚方案", value: p.rollback || "—" },
        ]} />
        <div className="j4-detail-foot">
          {canWrite && <div className="j4-routine" role="group" aria-label="平时：维护和演练">
            <Button icon={<FlaskConical size={14} aria-hidden />} disabledReason={!contractReady ? NOT_READY : contentLoading ? READING : gate.legacyStepCount > 0 ? "历史预案包含尚未接通的动作，请先编辑并替换" : newBlockedReason(`POST /sop/playbooks/${encodeURIComponent(p.code)}/drills`, { kind: "drill", playbook: p })} onClick={() => drillPb(p)}>演练</Button>
            <Button variant="ghost" icon={<Pencil size={14} aria-hidden />} disabledReason={!contractReady || !p.version ? "系统版本较旧，升级后才能编辑" : contentLoading ? READING : newBlockedReason(`PUT /sop/playbooks/${encodeURIComponent(p.code)}`, { kind: "update", playbook: p, fields: {} })} onClick={() => editPb(p)}>编辑</Button>
            <span className="j4-routine-note"><FlaskConical size={14} aria-hidden />演练只检查，不动真实业务</span>
          </div>}
          <div className="j4-real" role="group" aria-label="出事时：正式执行">
            <Button variant="danger-outline" icon={<Siren size={14} aria-hidden />} disabledReason={gate.canExecute ? undefined : gate.hint} onClick={() => openExecute(p, p.emer)}>
              {p.emer ? "发起应急执行" : "发起正式执行"}
            </Button>
          </div>
        </div>
      </Panel>
    );
  })() : (
    <Panel id="j4-detail" title="预案详情" icon={ListChecks} tone="role-3">
      <BlockState state="empty" compact title={PLAYBOOKS.length === 0 ? "还没有预案" : "这个场景没有预案"} detail={PLAYBOOKS.length === 0 ? "新增预案并演练通过后，在这里看它会依次做什么。" : "切到「全部」看其他预案。"} />
    </Panel>
  );

  // ---------- 执行记录 ----------
  const historyPanel = (
    <Panel title="执行记录" icon={History} tone="role-other" flush sub={EXECS.length >= 20 ? "最近 20 次" : `${count(EXECS.length)} 次`}
      explain="正式执行和演练都在这里，最近的在上，最多列 20 次；点一行看逐步追溯。更早的到「操作记录与审批」查。等批准的申请批准前不在这里。失败前已完成的步骤保持生效。"
      actions={reach("/platform/audit", "platform_a2_read") ? <Link className="rd-link" href="/platform/audit?domain=J" prefetch={false}>查看操作记录与审批</Link> : undefined}>
      <Table label="执行记录" className="j4-exec-table" rowFocus>
        <thead><tr><Th>开始时间</Th><Th>预案</Th><Th>方式</Th><Th>进度</Th><Th>执行人</Th><Th>恢复情况</Th><Th align="right">操作</Th></tr></thead>
        <tbody>
          {EXECS.length === 0
            ? <TableMessage columns={7}>尚无执行记录。{canRun ? "请先完成预案演练，再从可执行的预案发起执行。" : "如需执行，请联系有预案执行权限的同事。"}</TableMessage>
            : EXECS.map((e) => {
              const live = isActiveExecution(e);
              return (
                <Tr key={e.executionId || `${e.ts}-${e.code}-${e.trig}`} data-testid={e.executionId ? `j4-execution-${e.executionId}` : undefined} mark={live ? "hit" : undefined}
                  selected={traceExecution === e} onOpen={() => setTraceExecution(e)} aria-label={`查看追溯：${e.name || e.code} ${e.executionId || ""}`}>
                  <Td><Cell num main={j4Time(e.ts)} /></Td>
                  <Td><Cell main={e.name || "—"} sub={<span data-mono="">{e.executionId || e.code}</span>} title={e.trig ? `业务原因：${e.trig}` : undefined} /></Td>
                  <Td>{e.mode === "drill"
                    ? <StatusTag tone="neutral" icon={FlaskConical} explain="演练只检查，没动真实业务。">演练</StatusTag>
                    : <StatusTag tone={e.mode === "emergency" ? "danger" : "neutral"} icon={e.mode === "emergency" ? Siren : Workflow}>{executionModeLabel(e.mode)}</StatusTag>}</Td>
                  <Td><StepDots steps={e.steps} drill={e.mode === "drill"} />{e.notificationDispatch.cancelRequested === true && <span className="j4-muted"> · 已登记取消</span>}</Td>
                  <Td><Cell main={e.operator || "—"} sub={`责任 ${roleText(e.roleGate)}`} /></Td>
                  <Td>{e.rollbackStatus === "NOT_REQUIRED"
                    ? <StatusTag tone="neutral" icon={MinusCircle} explain="演练仅校验，未执行生产动作，无需回滚">无需恢复</StatusTag>
                    : e.rollbackStatus === "ROLLED_BACK"
                      ? <StatusTag tone="done" icon={RotateCcw} explain="只恢复了这次执行关停的业务开关；已发的通知不受影响">已恢复开关</StatusTag>
                      : e.reversible ? <StatusTag tone="neutral" icon={Undo2} explain={`可以恢复：${reversibleGates(e).join("、")}开关`}>开关可恢复</StatusTag>
                        : <span className="j4-muted">{e.rollbackStatus ? rollbackStatusText(e.rollbackStatus) : "—"}</span>}</Td>
                  <Td align="right" data-fit="">{executionActions(e)}</Td>
                </Tr>
              );
            })}
        </tbody>
      </Table>
      {EXECS.length > 0 && <p className="j4-note j4-note-pad">时间为{businessZone().label}</p>}
    </Panel>
  );

  // ---------- 第二层：能用的动作和规则、通知活动候选 ----------
  const rulesFold = (
    <Fold title="预案能用的动作和规则" icon={ListChecks} tone="role-other"
      summary={`${count((data?.actionOptions ?? []).length)} 种动作 · 只能关停、暂停、冻结、封锁和发布，不能恢复`}
      explain="新增和编辑预案时只能从这些动作里选；保存和执行时还会再检查一次。">
      {(data?.actionOptions ?? []).length === 0
        ? <BlockState state="empty" compact title="没有可用的动作" detail="请刷新；仍然没有请联系值班人员。" />
        : <Table label="预案能用的动作" className="j4-action-table">
          <thead><tr><Th>动作</Th><Th>在哪个页面</Th><Th>对象</Th><Th align="right">收得回吗</Th></tr></thead>
          <tbody>
            {(data?.actionOptions ?? []).map((item) => {
              const info = stepInfo({ dom: item.domain, ax: item.action, ref: item.ref?.replace("{target}", "") ?? null });
              return <Tr key={item.value}>
                <Td><Cell main={info.title} sub={info.impact} title={info.impact} /></Td>
                <Td>{info.page}</Td>
                <Td>{item.parameterLabel ? item.parameterLabel.replace("ISO 两位国家码", "两位国家代码").replace("用户数字 ID", "用户数字编号").replace("账户簇 ID", "账户组编号") : item.domain === "I3" ? "预案绑定的通知活动" : "整个业务"}</Td>
                <Td align="right"><UndoTag info={info} /></Td>
              </Tr>;
            })}
          </tbody>
        </Table>}
      <KeyValues rows={[
        { key: "dir", label: "不能放的动作", value: "恢复、解封、放行、开启、启用这类动作，所有预案都不能放；风险解除后到对应页面操作" },
        { key: "pre", label: "正式执行前提", value: "预案已保存、90 天内演练通过且有演练记录；绑定了通知活动的，活动还要是已排期" },
        { key: "approve", label: "审批", value: "常规和应急通道都要另一位管理员批准；应急通道不会加急" },
        { key: "reason", label: "操作理由", value: "必填；字数要求以提交时理由框的提示为准" },
        { key: "record", label: "执行记录", value: "每一步都记录；失败如实显示，前面做完的保持生效" },
      ]} />
    </Fold>
  );
  const notify = emergency.notifyTemplates ?? [];
  const notifyFold = (
    <Fold title="通知活动候选" icon={Megaphone} tone="role-other"
      summary={emergency.notifyTemplatesError ? "读不到" : ctx.notifyTemplatesLoading ? notify.length ? `${count(notify.length)} 个已排期 · 正在刷新…` : "正在加载…" : notify.length === 0 ? "没有已排期的通知活动" : `${count(notify.length)} 个已排期`}
      alert={Boolean(emergency.notifyTemplatesError)}
      explain="预案的「发送通知活动」这一步只能选已排期的通知活动。这里只列候选，不能新建通知；新建和排期在「通知活动」页。">
      {emergency.notifyTemplatesError
        ? <BlockState retryKey="j4-sop-1235" state="error" compact title="通知活动读不到" detail={`${emergency.notifyTemplatesError} 预案和执行记录不受影响。`} onRetry={() => void ctx.reloadJ4NotifyTemplates()} retrying={ctx.notifyTemplatesLoading} />
        // 刷新时保留已读到的候选表，只在还没有结果时显示加载占位（ST-32）。
        : ctx.notifyTemplatesLoading && notify.length === 0
          ? <BlockState state="loading" compact title="正在加载通知活动候选…" />
        : notify.length === 0
          ? <BlockState state="empty" compact title="没有已排期的通知活动" detail="要在预案里发通知，先到「通知活动」安排。" />
          : <Table label="通知活动候选" className="j4-notify-table">
            <thead><tr><Th>名称</Th><Th>优先级</Th><Th>受众</Th><Th>排期</Th></tr></thead>
            <tbody>
              {notify.map((item) => <Tr key={item.value}>
                <Td><Cell main={item.name} sub={<span data-mono="">{item.campaignNo}</span>} title={item.name} /></Td>
                <Td>{item.tier ? tierText(item.tier) : "—"}</Td>
                <Td><Cell main={item.audience || "—"} title={item.audience || undefined} /></Td>
                <Td>{item.meta.split(" · ").slice(2).join(" · ") || "—"}</Td>
              </Tr>)}
            </tbody>
          </Table>}
    </Fold>
  );

  return renderPage(
    <>
      {header(createAction)}
      {recovery}
      {conclusion}
      {missingDrillLedger > 0 && <Notice tone="warn">{count(missingDrillLedger)} 个预案有演练时间，但找不到演练成功的记录，已暂停执行，请重新演练。</Notice>}
      <StatBand label="应急预案摘要">
        <Stat icon={ShieldCheck} tone="role-3" label="可执行预案" value={count(ready)} unit="个" sub={`共 ${count(PLAYBOOKS.length)} 个`}
          explain="演练通过（90 天内、有演练记录）、绑定的通知活动可用、步骤都能执行的预案。" />
        <Stat icon={FlaskConical} tone="role-3" label="待演练" value={count(todo)} unit="个"
          explain="演练过期或缺记录、编辑后没重新演练、通知活动不可用或有历史动作的预案，暂不能执行。" />
        <Stat icon={Siren} tone="role-3" label="应急通道预案" value={count(emerCount)} unit="个"
          explain="标了应急通道的预案数，不管能不能执行；也不是执行次数。应急通道只影响记录，审批和执行速度和常规一样。" />
        <Stat icon={History} tone="role-other" label="近 90 天正式执行" value={liveExecs == null ? "—" : count(liveExecs)} unit={liveExecs == null ? undefined : "次"}
          sub={liveExecs == null ? "未提供" : `演练记录 ${drillExecRows == null ? "未提供" : `${count(drillExecRows)} 条`} · 演练就绪 ${!contractReady ? "暂无法统计" : drillExecs == null ? "未提供" : `${count(drillExecs)} 个`}`}
          explain="正式执行按开始时间算，部分失败、已取消和还在执行的都算；演练记录是近 90 天演练的条数，同一个预案可以有多条；演练就绪是现在能执行的预案数。不受场景筛选影响。" />
      </StatBand>
      {queueNotice}
      {activePanel}
      <div className="rd-split j4-lib" data-detail="">
        {libraryPanel}
        {detailPanel}
      </div>
      {historyPanel}
      {rulesFold}
      {notifyFold}
    </>,
    <TraceDrawer execution={traceExecution} onClose={() => setTraceExecution(null)} />
  );
}
