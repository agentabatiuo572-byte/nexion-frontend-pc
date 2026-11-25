"use client";

/**
 * 法律条款与风险披露的写入路：三个页签共用。做法同提现审核：先把原操作存好再发（OP-92）；确定失败丢号，留在确认框；
 * 结果未知保号，关框，转成页面上方的待确认，这个对象确认前不能再操作（OP-93）；重试只发存下来的原操作（OP-94）。
 *
 * 恢复能力按接口实际情况写（OP-95）：
 * - 审批类能按命令号查原提案；
 * - 披露草稿和地区只有幂等，重试用同一命令号，后端不重复执行；
 * - 法律条款和隐私政策接口不收命令号，只比对修订号：原操作已生效时，重试会被当成改动冲突拒绝，不会写两次。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Button, Fact, Modal, Notice, ReleaseModal, StatusTag, type StateTone } from "@/app/components/rd";
import { createA2CommandKey, fetchA2ProposalByKey, isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { displayAdminError } from "@/lib/admin/error-messages";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { checkDisclosureDraftReadback, DisclosureReadbackPending, type IContentActions } from "@/lib/admin/i-client";
import type { ToastKind } from "@/lib/store/ui";
import { saveLegalTermsDraft, transitionLegalTerms, type LegalTermsVersion } from "@/lib/admin/legal-terms-client";
import { isOutcomeUnknownError } from "@/lib/admin/outcome-classification";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import type { ProposeSpec } from "@/lib/admin/propose-or-execute";
import { updatePrivacyPolicyAdmin, type PublishedContentDocument } from "@/lib/admin/published-content-client";
import { usePropose } from "@/lib/admin/use-propose";
import { useReach } from "@/lib/nav/use-reach";
import type { ActionConfirmReq, ICtx } from "./types";
import { canInvestigateECommand, eCommandClosureOffer, eCommandSettled, type ECommandEvidence } from "@/lib/admin/e-command-investigation";
import type { FundInvestigationOutcome } from "@/lib/admin/fund-command-investigation";
import { queryOriginalCommand, type OriginalCommandRoute } from "@/lib/admin/original-command-query";
import { FundClosureModal, fundRecoveryStatus, settledText } from "../fund-command-check";
import { OPEN_RESULT_LABELS, RecoveryPanel, TechInfo, receiptFact, receiptOf, recoveryTitle, type RecoveryItem } from "../recovery-panel";
import { DIRECT_RECOVERY_INTRO, CLOSURE_KEPT_TEXT } from "../direct-recovery-copy";

type LegalDraftBody = Parameters<typeof saveLegalTermsDraft>[0];
type ContentCall =
  | { fn: "createI5Jurisdiction"; args: [{ code: string; name: string }, string] }
  | { fn: "updateI5Jurisdiction"; args: [string, { name: string; expectedRevision: number }, string] }
  | { fn: "createI5DisclosureVersion"; args: [string, Record<string, unknown>, string] }
  | { fn: "updateI5DisclosureVersion"; args: [string, string, Record<string, unknown>, string] }
  | { fn: "deleteI5DisclosureVersion"; args: [string, string, number, string, string] };

export type I5Op =
  | { kind: "a2"; spec: ProposeSpec }
  | { kind: "content"; call: ContentCall }
  | { kind: "legal-save"; body: LegalDraftBody }
  | { kind: "legal-transition"; action: "publish" | "revoke"; row: LegalTermsVersion; reason: string }
  | { kind: "privacy"; document: Pick<PublishedContentDocument, "version" | "status" | "locales" | "revision">; reason: string };

/** target 是这条操作锁住的对象：`jur:CN`、`gate`、`legal:en:GLOBAL`、`privacy`。 */
export type I5Write = { target: string; label: string; op: I5Op };
/** 保存明确拒绝的状态与原因；旧 rejected 布尔值不能证明原重试得到结论。 */
/** 后台已确认写入、页面还没读到同样的内容：说做成了什么、下一步点哪里，不写「写入」「读回」。 */
const readbackLine = (readback: DisclosureReadbackPending["readback"]) => "deleted" in readback
  ? `草稿已删除，列表里还没核对到 ${readback.version} 消失。点「查询原结果」再核对。`
  : `草稿已保存，还没核对到 ${readback.version} 的内容。点「查询原结果」再核对。`;
type I5Pending = PendingMutationRecord & I5Write & { readback?: DisclosureReadbackPending["readback"]; rejection?: { status: number; reasonCode?: string; backendMessage?: string } };

/** The saved call identifies the original HTTP route; the server supplies its scope and hash. */
function i5OriginalRoute(record: I5Pending): OriginalCommandRoute | undefined {
  if (record.op.kind === "a2") return { originalMethod: "POST", originalPath: "/api/admin/platform/audit/operations", readAuthority: "content_i5_read" };
  if (record.op.kind !== "content") return undefined;
  const { call } = record.op;
  const base = "/api/admin/content/trust-disclosure/disclosures";
  switch (call.fn) {
    case "createI5Jurisdiction": return { originalMethod: "POST", originalPath: `${base}/jurisdictions`, readAuthority: "content_i5_read" };
    case "updateI5Jurisdiction": return { originalMethod: "PATCH", originalPath: `${base}/jurisdictions/${encodeURIComponent(call.args[0])}`, readAuthority: "content_i5_read" };
    case "createI5DisclosureVersion": return { originalMethod: "POST", originalPath: `${base}/${encodeURIComponent(call.args[0])}/versions`, readAuthority: "content_i5_read" };
    case "updateI5DisclosureVersion": case "deleteI5DisclosureVersion": return {
      originalMethod: call.fn === "deleteI5DisclosureVersion" ? "DELETE" : "PATCH",
      originalPath: `${base}/${encodeURIComponent(call.args[0])}/versions/${encodeURIComponent(call.args[1])}`, readAuthority: "content_i5_read",
    };
  }
}

const pendingWrites = createPendingMutationStore<I5Pending>({
  storageKey: "nexion-admin-i5-disclosure-commands-v1",
  // 过期后不能再用原号重试，记录不删，对象继续锁住（OP-96）。
  retainExpiredRecords: true,
  isValidRecord: (record) => typeof record.target === "string" && typeof record.label === "string" && typeof record.op === "object" && record.op !== null,
});

export const WRITE_LOCKED = "这一项有一次操作结果未知，先到页面上方处理";
export const CONFLICT_TEXT = "这项刚被别人改过。";
/** 查询成功、记录还没了结时展开处的一句：记录还在，这一项先不能改；下一步写在行上。 */
const KEPT_NOTE = "已查询，记录继续保留；这一项暂时不能修改。";

const PROPOSAL_STATUS: Record<string, string> = { pending: "待审批", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" };

function dispatch(write: I5Write, key: string, actions: IContentActions, propose: (spec: ProposeSpec) => Promise<unknown>): Promise<unknown> {
  const { op } = write;
  if (op.kind === "a2") return propose({ ...op.spec, commandKey: key });
  if (op.kind === "legal-save") return saveLegalTermsDraft(op.body);
  if (op.kind === "legal-transition") return transitionLegalTerms(op.action, op.row, op.reason);
  if (op.kind === "privacy") return updatePrivacyPolicyAdmin(op.document, op.reason);
  const { call } = op;
  switch (call.fn) {
    case "createI5Jurisdiction": return actions.createI5Jurisdiction(...call.args, key);
    case "updateI5Jurisdiction": return actions.updateI5Jurisdiction(...call.args, key);
    case "createI5DisclosureVersion": return actions.createI5DisclosureVersion(...call.args, key);
    case "updateI5DisclosureVersion": return actions.updateI5DisclosureVersion(...call.args, key);
    case "deleteI5DisclosureVersion": return actions.deleteI5DisclosureVersion(...call.args, key);
  }
}

/** 这条操作能怎么恢复，只写接口真有的（OP-95）。放进提示图标。 */
function recoveryText(op: I5Op, canQuery: boolean): string {
  if (op.kind === "a2") return canQuery ? "审批单可能已经建好，批准前不会执行。可以先查询原结果。" : "审批单可能已经建好，批准前不会执行。这个账号查不了原审批单，请能看操作记录的同事核查。";
  if (op.kind === "content") return "可能已经保存。按原请求重试，系统认得出是同一次提交，不会重复执行。";
  return "可能已经生效。按原请求重试不会写两次：已生效的话，重试会被拒。";
}

/** 合并结果里要给人看的两类位置（路径）：别人改了的、两边都改了留下自己的。 */
export type MergeReport = { theirs: string[][]; clashes: string[][] };
export type Merged<T> = { value: T; report: MergeReport };

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
/** 段落和章节按自己的编号对齐：增删段落后下标不再对应同一段。 */
const itemId = (item: unknown) => isRecord(item) ? String(item.id ?? item.key ?? item.no ?? "") : "";
const byItemId = (list: unknown[]) => new Map(list.map((item) => [itemId(item), item]));
const distinctIds = (list: unknown[]) => list.every(itemId) && byItemId(list).size === list.length;

function merge(base: unknown, mine: unknown, latest: unknown, path: string[], report: MergeReport): unknown {
  if (sameJson(mine, latest)) return mine;
  if (sameJson(mine, base)) { report.theirs.push(path); return latest; }
  if (sameJson(latest, base)) return mine;
  const baseList = Array.isArray(base) ? base : [];
  if (Array.isArray(mine) && Array.isArray(latest) && [baseList, mine, latest].every(distinctIds)) {
    const [baseItems, mineItems, latestItems] = [byItemId(baseList), byItemId(mine), byItemId(latest)];
    const ids = [...latestItems.keys(), ...[...mineItems.keys()].filter((id) => !latestItems.has(id))];
    return ids.map((id) => merge(baseItems.get(id), mineItems.get(id), latestItems.get(id), [...path, id], report)).filter((item) => item !== undefined);
  }
  if (isRecord(mine) && isRecord(latest)) {
    const baseRecord = isRecord(base) ? base : {};
    const keys = new Set([...Object.keys(latest), ...Object.keys(mine)]);
    return Object.fromEntries([...keys].flatMap((key) => {
      const value = merge(baseRecord[key], mine[key], latest[key], [...path, key], report);
      return value === undefined ? [] : [[key, value]];
    }));
  }
  report.clashes.push(path);
  return mine;
}

/**
 * 别人改过时三方合并（OP-97）：base 是打开时读到的，mine 是表单，latest 是刚读到的。
 * 只有自己改了的留自己的，只有别人改了的取最新；同一处两边都改了留自己的，写进 clashes 让人核对，不悄悄盖掉别人的。
 */
export function mergeEdits<T>(base: T, mine: T, latest: T): Merged<T> {
  const report: MergeReport = { theirs: [], clashes: [] };
  return { value: merge(base, mine, latest, [], report) as T, report };
}

/** 「读取最新」之后写在编辑器最上面：别人改了哪、哪里两边都改了要核对（OP-97 第 2 步）。name 把路径换成人话，内部字段返回空。 */
export function MergeNotice({ report, name }: { report: MergeReport | null; name: (path: string[]) => string | null }) {
  if (!report) return null;
  const names = (paths: string[][]) => [...new Set(paths.flatMap((path) => name(path) ?? []))].join("、");
  const theirs = names(report.theirs);
  const clashes = names(report.clashes);
  return (
    <Notice tone="warn" title="已读取最新内容，你的修改还在">
      {theirs ? `别人改了：${theirs}，已换成最新。` : clashes ? "" : "别人这次没有改这里的内容。"}
      {clashes && ` 这几处你和别人都改了，现在是你的版本，请核对：${clashes}。`}
    </Notice>
  );
}

/** 确认框里被冲突拒绝时框不关、理由留着，写「这项刚被别人改过。」和「读取最新」。 */
export function withConflict(ctx: Pick<ICtx, "openActionConfirm" | "closeActionConfirm">, request: ActionConfirmReq, readLatest: () => void): ActionConfirmReq {
  const wrapped: ActionConfirmReq = {
    ...request,
    run: async (...args) => {
      try {
        return await request.run(...args);
      } catch (cause) {
        if (displayAdminError(cause) !== CONFLICT_TEXT) throw cause;
        ctx.openActionConfirm({ ...wrapped, blockedReason: <>{CONFLICT_TEXT} <Button size="sm" onClick={() => { ctx.closeActionConfirm(); readLatest(); }}>读取最新</Button></> });
        return false;
      }
    },
  };
  return wrapped;
}

/** 列表和详情的入口通过它换编辑对象，先过编辑器的未保存保护。 */
export type EditorSwitch = { attempt: (next: () => void) => void };

/**
 * 有未保存内容时拦离开（OP-29）：侧栏、面包屑、命令面板都是链接，抓在捕获阶段；关窗口走浏览器提示；
 * 抽屉不挡列表，换草稿、新建、看别的版本要走 switcher，不能绕过这个框。
 * 有草稿时加一条同地址历史记录，后退先回到编辑器再询问；离开前退回原记录，继续原导航。
 */
export function useLeaveGuard(dirty: boolean, close: () => void, switcher: RefObject<EditorSwitch | null>) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const nextAction = useRef<(() => void) | null>(null);
  const releaseHistory = useRef<((next?: () => void) => void) | null>(null);
  useEffect(() => {
    switcher.current = { attempt: (next) => {
      if (dirty) { nextAction.current = next; setAsking(true); }
      else { close(); next(); }
    } };
    return () => { switcher.current = null; };
  }, [dirty, close, switcher]);
  useEffect(() => {
    if (!dirty) return;
    let phase: "armed" | "restoring" | "releasing" = "armed";
    let afterRelease: (() => void) | undefined;
    // 保留 Next 的路由状态；副本只用来先拦住后退，不改 URL 和编辑器内容。
    window.history.pushState(window.history.state, "", window.location.href);
    const release = (next?: () => void) => {
      if (next) afterRelease = next;
      if (phase === "releasing") return;
      phase = "releasing";
      window.history.back();
    };
    releaseHistory.current = release;
    const back = (event: PopStateEvent) => {
      // Next 的 popstate 在冒泡阶段恢复路由；先截住，避免编辑器被卸载。
      event.stopImmediatePropagation();
      if (phase === "releasing") {
        window.removeEventListener("popstate", back, true);
        if (releaseHistory.current === release) releaseHistory.current = null;
        afterRelease?.();
      } else if (phase === "restoring") {
        phase = "armed";
        // 上面还开着确认框（填理由、提交中）或离开框：后退先留在这里，由那个框处理完再走。
        if (document.querySelector('.rd-modal[data-state="open"]')) return;
        nextAction.current = () => window.history.back();
        setAsking(true);
      } else {
        phase = "restoring";
        window.history.forward();
      }
    };
    window.addEventListener("popstate", back, true);
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    const intercept = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.origin !== window.location.origin) return;
      if (link.pathname === window.location.pathname && link.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      nextAction.current = () => router.push(`${link.pathname}${link.search}${link.hash}`);
      setAsking(true);
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", intercept, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", intercept, true);
      release();
    };
  }, [dirty, router]);
  const leave = (next: (() => void) | null, discard: boolean) => {
    nextAction.current = null;
    setAsking(false);
    const go = () => { if (discard) close(); next?.(); };
    if (releaseHistory.current) releaseHistory.current(go);
    else go();
  };
  return {
    asking,
    /** 普通关闭：只关这个编辑器，不带上次要去的地方。 */
    askClose: () => { nextAction.current = null; if (dirty) setAsking(true); else close(); },
    stay: () => { setAsking(false); nextAction.current = null; },
    discard: () => leave(nextAction.current, true),
    /**
     * 去确认框保存：这个框先收起。要去的地方只属于这一次保存，返回的函数在这次保存成功后调，接着去那里；
     * 理由框取消、被拒、结果未知都不调，去处作废。
     */
    startSave: () => {
      const next = nextAction.current;
      nextAction.current = null;
      setAsking(false);
      return () => leave(next, false);
    },
  };
}

/** saveName 是保存按钮的完整名字（「保存并立即生效」这类不带「后继续」的，OP-29）；不传时是「{saveLabel}后继续」。 */
export function LeaveDialog({ guard, saveLabel, saveName = `${saveLabel}后继续`, saveBlocked, onSave }: {
  guard: Pick<ReturnType<typeof useLeaveGuard>, "asking" | "stay" | "discard" | "startSave">;
  saveLabel?: string; saveName?: string; saveBlocked?: string; onSave: (saved: () => void) => void;
}) {
  const stayButton = useRef<HTMLButtonElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  // 弹窗先聚焦外框，等它聚焦完再落到保存按钮；现在不能保存时落到「继续编辑」（CP-69）。
  useEffect(() => {
    if (!guard.asking) return;
    const timer = window.setTimeout(() => (saveBlocked ? stayButton : saveButton).current?.focus(), 0);
    return () => window.clearTimeout(timer);
    // 只在打开时定一次，之后焦点归操作人。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.asking]);
  if (!guard.asking) return null;
  return (
    <Modal title="有未保存的修改" icon={ShieldCheck} onClose={guard.stay} footer={<>
      <Button ref={stayButton} onClick={guard.stay}>继续编辑</Button>
      <Button variant="danger-outline" onClick={guard.discard}>放弃改动并返回</Button>
      <Button ref={saveButton} variant="primary" disabledReason={saveBlocked} onClick={() => onSave(guard.startSave())}>{saveName}</Button>
    </>}><p>离开后这次的修改不会保留。</p>
      {/* 保存按钮不能点时原因常显，不只放在悬停提示里（OP-126）。 */}
      {saveBlocked && <Notice tone="warn">现在不能保存：{saveBlocked.replace(/[。.]$/, "")}。</Notice>}</Modal>
  );
}

export function useI5Writes({ actions, toast, canQuery, onSettled, onReadBack }: {
  actions: IContentActions;
  toast: (message: string, kind?: ToastKind) => void;
  canQuery: boolean;
  /** 一次写入有了结果（成功或转成待确认）后，读回对应的数据。 */
  onSettled: (write: I5Write) => Promise<unknown> | void;
  /** 读回原操作的对象，返回写在待确认条上的一句话。 */
  onReadBack: (write: I5Write) => Promise<string>;
}) {
  const propose = usePropose();
  const reach = useReach();
  const [pending, setPending] = useState<I5Pending[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [recovering, setRecovering] = useState("");
  const [releasing, setReleasing] = useState<I5Pending | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, FundInvestigationOutcome>>({});
  const [closing, setClosing] = useState<I5Pending | null>(null);
  const sync = useCallback(() => setPending(pendingWrites.list()), []);
  useEffect(() => sync(), [sync]);

  const note = (record: I5Pending, text: string) => setNotes((current) => ({ ...current, [record.commandKey]: text }));
  /** 发一条已存好的操作。"done" 已成功；"unknown" 已转成待确认；确定失败抛出。 */
  const execute = async (write: I5Write, scope: string, key: string, retained: boolean): Promise<"done" | "unknown"> => {
    try {
      await dispatch(write, key, actions, async (spec) => {
        // 失败写在确认框里，结果未知转成待确认条，都不再弹同一句；只有提交成功才提示。
        await propose(() => undefined, spec);
        toast("已提交审批，另一位管理员批准后执行", "success");
      });
    } catch (cause) {
      const unknown = isA2OutcomeUncertainError(cause) || isOutcomeUnknownError(cause);
      if (!unknown && !retained) pendingWrites.forget(scope);
      if (cause instanceof DisclosureReadbackPending) pendingWrites.remember(scope, key, { ...write, readback: cause.readback });
      sync();
      if (!unknown) throw cause;
      toast(cause instanceof DisclosureReadbackPending ? readbackLine(cause.readback) : "结果未知，不要重复操作。到页面上方查询原结果或按原请求重试。", "warn");
      await onSettled(write);
      return "unknown";
    }
    pendingWrites.forget(scope);
    sync();
    await onSettled(write);
    return "done";
  };

  /** 新操作。对象有待确认时不发，也不碰存下的原操作（OP-93、OP-94）。 */
  const send = async (write: I5Write) => {
    if (pendingWrites.list().some((record) => record.target === write.target)) throw new Error(WRITE_LOCKED);
    const scope = `${write.target}|${write.label}`;
    const key = createA2CommandKey("i5");
    pendingWrites.remember(scope, key, write);
    if (!pendingWrites.isDurablyStored(scope, key)) {
      pendingWrites.forget(scope, key);
      throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
    }
    return execute(write, scope, key, false);
  };

  /** 只发存下的原操作：同命令号、同内容（OP-94）。过期不发，记录留着。 */
  const retry = async (record: I5Pending) => {
    if (record.readback || record.expiresAt <= Date.now()) return;
    if (!pendingWrites.isDurablyStored(record.fingerprint, record.commandKey)) {
      note(record, "这次操作的记录没存住，不能再重试，请到操作记录与审批核对。");
      return;
    }
    note(record, "");
    pendingWrites.remember(record.fingerprint, record.commandKey, { target: record.target, label: record.label, op: record.op, rejection: undefined });
    sync();
    setRecovering(record.commandKey);
    try {
      if (record.op.kind === "a2") {
        if (!canQuery) {
          note(record, "这个账号查不了原审批单，请能看操作记录的同事核查。记录继续保留。");
          return;
        }
        let original;
        try { original = await fetchA2ProposalByKey(record.commandKey); }
        catch (cause) {
          note(record, `查询没有成功：${displayAdminError(cause)} 记录继续保留，这次没有重试。`);
          return;
        }
        if (original) {
          pendingWrites.forget(record.fingerprint, record.commandKey);
          sync();
          toast(`查到原审批单，${PROPOSAL_STATUS[original.status]}。进度到「操作记录与审批」看。`, "info");
          await onSettled(record);
          return;
        }
      }
      if (await execute({ target: record.target, label: record.label, op: record.op }, record.fingerprint, record.commandKey, true) === "done") toast("原操作已完成，请核对最新内容", "success");
    } catch (cause) {
      note(record, `重试没有成功：${displayAdminError(cause)} 原操作结果仍未知，记录继续保留。`);
      const refusal = isExplicitRejection(cause) ? cause as { status: number; reasonCode?: string; backendMessage?: string } : undefined;
      pendingWrites.remember(record.fingerprint, record.commandKey, { target: record.target, label: record.label, op: record.op,
        rejection: refusal && { status: refusal.status, reasonCode: refusal.reasonCode, backendMessage: refusal.backendMessage } });
      sync();
    } finally {
      setRecovering("");
    }
  };

  const queryInvestigation = async (saved: I5Pending, evidence?: ECommandEvidence) => {
    const record = pendingWrites.list().find(row => row.commandKey === saved.commandKey);
    const route = record && i5OriginalRoute(record);
    if (!record || !route) throw new Error("INVESTIGATION_ORIGINAL_LOCATOR_INVALID");
    const receipt = await queryOriginalCommand(record, route, String(record.commandOwnerId), evidence);
    setOutcomes(all => ({ ...all, [record.commandKey]: { receipt } }));
    return receipt;
  };
  const queryContent = async (record: I5Pending) => {
    setRecovering(record.commandKey);
    try {
      if (record.readback && "deleted" in record.readback) {
        await checkDisclosureDraftReadback(record.readback);
        pendingWrites.forget(record.fingerprint, record.commandKey);
        sync();
        await onSettled(record);
        toast("原操作已完成，请核对最新内容", "success");
        return;
      }
      const receipt = await queryInvestigation(record);
      if (eCommandSettled(receipt)) {
        toast(settledText({ status: receipt!.originalStatus }), "success");
        pendingWrites.forget(record.fingerprint, record.commandKey); sync();
        await onSettled(record);
        return;
      }
      // 查到了但还没了结（仍未知、没有查到、记为失败等）：行上的标签和句子已按查到的换掉；这里换掉上一次「查询没有成功」的话。
      note(record, KEPT_NOTE);
      const expired = record.expiresAt <= Date.now();
      const shown = fundRecoveryStatus({ outcome: { receipt }, expired, canRetry: !expired && !record.readback, canQuery: true, canClose: canInvestigateECommand("content_i5_read") });
      toast(`${shown.label}：${shown.line}`, "warn");
    } catch (cause) {
      setOutcomes(all => ({ ...all, [record.commandKey]: { error: displayAdminError(cause) } }));
      note(record, `查询没有成功：${displayAdminError(cause)} 记录继续保留。`);
    } finally { setRecovering(""); }
  };

  /** 按命令号查原提案。查到就有了结果，可以解除；查不到说明不了没提交，继续保留（OP-95）。 */
  const check = async (record: I5Pending) => {
    setRecovering(record.commandKey);
    try {
      const original = await fetchA2ProposalByKey(record.commandKey);
      if (!original) {
        try {
          const receipt = await queryInvestigation(record);
          if (eCommandSettled(receipt)) {
            toast(settledText({ status: receipt!.originalStatus }), "success");
            pendingWrites.forget(record.fingerprint, record.commandKey); sync();
            await onSettled(record);
            return;
          }
        } catch (cause) {
          setOutcomes(all => ({ ...all, [record.commandKey]: { error: displayAdminError(cause) } }));
        }
        note(record, "没查到原审批单，记录继续保留。");
        return;
      }
      pendingWrites.forget(record.fingerprint, record.commandKey);
      sync();
      toast(`查到原审批单，${PROPOSAL_STATUS[original.status]}。进度到「操作记录与审批」看。`, "info");
      await onSettled(record);
    } catch (cause) {
      note(record, `查询没有成功：${displayAdminError(cause)} 记录继续保留。`);
    } finally {
      setRecovering("");
    }
  };

  /** 读回只给现在的事实，状态可能是别人改的，不算原操作的回执，待确认继续保留（OP-95）。 */
  const readBack = async (record: I5Pending) => {
    setRecovering(record.commandKey);
    try {
      note(record, `${await onReadBack(record)} 也可能是别人改的，记录继续保留。`);
    } catch (cause) {
      note(record, `查询没有成功：${displayAdminError(cause)} 记录继续保留。`);
    } finally {
      setRecovering("");
    }
  };

  const release = (record: I5Pending) => {
    pendingWrites.forget(record.fingerprint, record.commandKey);
    sync();
    setReleasing(null);
    toast("已解除原操作记录，后台的结果和锁定不变", "success");
  };

  const auditHref = "/platform/audit?domain=I";
  /** 这一行的标签和结论：查过原结果的用共用面板的叫法；走审批的没查过说「可能已经提交」；重试被明确拒绝的说可以解除。 */
  const statusOf = (record: I5Pending, expired: boolean): { tone: StateTone; label: string; line: string; more?: string } => {
    const outcome = outcomes[record.commandKey];
    if (record.readback) return { tone: "warn", label: "deleted" in record.readback ? "已删除" : "已保存", line: readbackLine(record.readback) };
    // 和设备页恢复行（RECOVERY_LINE.refused）同一句；不引设备页的文件。
    if (isExplicitRejection(record.rejection)) return { tone: "warn" as const, label: "重试被拒", line: "重试被明确拒绝；核对原因后可以解除。" };
    if (record.op.kind === "a2" && !outcome) return { tone: "warn" as const, label: expired ? "已过期" : "结果未知",
      line: expired ? "超过 24 小时不能再重试，先查询原结果。" : canQuery ? "可能已经提交，先查询原结果。" : "可能已经提交，这个账号查不了原结果，到操作记录与审批核对。" };
    const shown = fundRecoveryStatus({ outcome, expired, canRetry: !expired, canQuery: true, canClose: canInvestigateECommand("content_i5_read") });
    return { ...shown, more: shown.more ?? (outcome && "error" in outcome ? outcome.error : undefined) };
  };
  const items: RecoveryItem[] = pending.map((record) => {
    const expired = record.expiresAt <= Date.now();
    const shown = statusOf(record, expired);
    return { key: record.commandKey, createdAt: record.createdAt, object: record.label,
      tag: <StatusTag tone={shown.tone} explain={shown.more}>{shown.label}</StatusTag>, line: shown.line,
      note: notes[record.commandKey] || undefined,
      actions: <>
        {record.op.kind === "a2" && canQuery && <Button size="sm" disabled={!!recovering} onClick={() => void check(record)}>查询原结果</Button>}
        {record.op.kind === "content" && <Button size="sm" disabled={!!recovering} onClick={() => void queryContent(record)}>查询原结果</Button>}
        {canInvestigateECommand("content_i5_read") && eCommandClosureOffer(outcomes[record.commandKey], expired).conclusions.length > 0 && <Button size="sm" variant="danger-outline" disabled={!!recovering} onClick={() => setClosing(record)}>核查结案</Button>}
        {(record.op.kind === "legal-save" || record.op.kind === "legal-transition" || record.op.kind === "privacy") && <Button size="sm" disabled={!!recovering} onClick={() => void readBack(record)}>查询原结果</Button>}
        {!expired && !record.readback && <Button size="sm" disabled={!!recovering} disabledReason={record.op.kind === "a2" && !canQuery ? "这个账号查不了原审批单，请能看操作记录的同事核查" : undefined} onClick={() => void retry(record)}>按原请求重试</Button>}
        {isExplicitRejection(record.rejection) && <Button size="sm" disabled={!!recovering} onClick={() => setReleasing(record)}>解除原操作记录</Button>}
      </>,
      detail: <p>{formatBusinessTimeCompact(new Date(record.createdAt).toISOString(), "—")}（{businessZone().label}）发出。{!expired && !record.readback && recoveryText(record.op, canQuery)}</p>,
      tech: <p className="fund-row-tech"><TechInfo commandKey={record.commandKey} receipt={receiptOf(outcomes[record.commandKey])} /></p> };
  });
  const open = pending.filter((record) => OPEN_RESULT_LABELS.includes(statusOf(record, record.expiresAt <= Date.now()).label)).length;
  const notices: ReactNode = <RecoveryPanel items={items} title={recoveryTitle(pending.length - open, 0, 0, open)} explainLabel="结果未知怎么处理" explain={DIRECT_RECOVERY_INTRO}
    foot={reach(auditHref, "platform_a2_read") ? <Link className="rd-link" href={auditHref} prefetch={false}>到操作记录与审批核对</Link> : undefined} />;

  const releaseModal = <>
    {closing && <FundClosureModal label={closing.label} createdAt={closing.createdAt}
      offer={eCommandClosureOffer(outcomes[closing.commandKey], closing.expiresAt <= Date.now())}
      facts={<Fact k="系统记录">{receiptFact(((outcome) => outcome && "receipt" in outcome ? outcome.receipt : null)(outcomes[closing.commandKey]), "记录保留")}</Fact>}
      onClose={() => setClosing(null)} onSubmit={async evidence => {
        const record = closing;
        const receipt = await queryInvestigation(record, evidence);
        setClosing(null);
        if (eCommandSettled(receipt)) {
          toast(settledText({ status: receipt!.originalStatus }), "success");
          pendingWrites.forget(record.fingerprint, record.commandKey); sync();
          await onSettled(record);
        } else toast(CLOSURE_KEPT_TEXT, "warn");
      }} />}
    {releasing && <ReleaseModal label={releasing.label} onCancel={() => setReleasing(null)} onConfirm={() => release(releasing)} />}
  </>;

  const lockedTargets = new Set(pending.map((record) => record.target));
  return { send, notices, releaseModal, isLocked: (target: string) => lockedTargets.has(target), unconfirmed: (match: (target: string) => boolean) => pending.filter((record) => match(record.target)).length };
}

export type I5Writes = ReturnType<typeof useI5Writes>;
