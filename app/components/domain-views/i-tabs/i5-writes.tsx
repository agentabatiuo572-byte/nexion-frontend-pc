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
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Explain, Modal, Notice } from "@/app/components/rd";
import { createA2CommandKey, fetchA2ProposalByKey, isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { businessZone, formatBusinessTimeFull } from "@/lib/admin/business-time";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { IContentActions } from "@/lib/admin/i-client";
import { saveLegalTermsDraft, transitionLegalTerms, type LegalTermsVersion } from "@/lib/admin/legal-terms-client";
import { isOutcomeUnknownError } from "@/lib/admin/outcome-classification";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import type { ProposeSpec } from "@/lib/admin/propose-or-execute";
import { updatePrivacyPolicyAdmin, type PublishedContentDocument } from "@/lib/admin/published-content-client";
import { usePropose } from "@/lib/admin/use-propose";
import { useReach } from "@/lib/nav/use-reach";
import type { ActionConfirmReq, ICtx } from "./types";

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
/** rejected：重试被后端明确拒绝过，只有这时才给「解除待确认」。 */
type I5Pending = PendingMutationRecord & I5Write & { rejected?: boolean };

const pendingWrites = createPendingMutationStore<I5Pending>({
  storageKey: "nexion-admin-i5-disclosure-commands-v1",
  // 过期后不能再用原号重试，记录不删，对象继续锁住（OP-96）。
  retainExpiredRecords: true,
  isValidRecord: (record) => typeof record.target === "string" && typeof record.label === "string" && typeof record.op === "object" && record.op !== null,
});

export const WRITE_LOCKED = "这个对象有结果未确认的操作，先处理页面上方的待确认";
export const CONFLICT_TEXT = "这项刚被别人改过。";
const EXPIRED_TEXT = "已超过 24 小时，不能再重试，请到操作记录与审批核对";

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
  if (op.kind === "a2") return canQuery ? "审批单可能已经生成，批准前不会执行。可以先查原提案。" : "审批单可能已经生成，批准前不会执行。这个账号查不了原提案，可以请能看操作记录的同事核查。";
  if (op.kind === "content") return "可能已经保存。重试用同一命令号，后端不会重复执行。";
  return "可能已经生效。这个接口没有命令号，原操作已生效时重试会按改动冲突被拒，不会写两次。";
}

/** 别人改过时，把自己改过的字段留下，其余取最新（OP-97）。base 是打开时读到的内容。 */
export function mergeEdits<T>(base: T, mine: T, latest: T): T {
  if (JSON.stringify(mine) === JSON.stringify(base)) return latest;
  if (Array.isArray(mine) && Array.isArray(base) && Array.isArray(latest)) {
    if (mine.length !== base.length || latest.length !== base.length) return mine;
    return mine.map((item, index) => mergeEdits(base[index], item, latest[index])) as T;
  }
  if (mine && base && latest && typeof mine === "object" && typeof base === "object" && typeof latest === "object") {
    const keys = new Set([...Object.keys(mine), ...Object.keys(latest)]);
    return Object.fromEntries([...keys].map((key) => [key, mergeEdits((base as Record<string, unknown>)[key], (mine as Record<string, unknown>)[key], (latest as Record<string, unknown>)[key])])) as T;
  }
  return mine;
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

/**
 * 有未保存内容时拦站内离开（OP-29）：侧栏、面包屑、命令面板都是链接，抓在捕获阶段；关窗口走浏览器提示。
 * 浏览器前进后退不拦，Next 没有可取消的入口。
 */
export function useLeaveGuard(dirty: boolean, close: () => void) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    const intercept = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.origin !== window.location.origin) return;
      if (link.pathname === window.location.pathname && link.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      setHref(`${link.pathname}${link.search}${link.hash}`);
      setAsking(true);
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", intercept, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", intercept, true);
    };
  }, [dirty]);
  const proceed = () => { if (href) router.push(href); };
  return {
    asking,
    askClose: () => { if (dirty) setAsking(true); else close(); },
    stay: () => { setAsking(false); setHref(null); },
    /** 去确认框保存：这个框先收起，取消保存时回到编辑。 */
    hide: () => setAsking(false),
    discard: () => { setAsking(false); close(); proceed(); },
    /** 保存成功后接着去原来要去的地方。 */
    saved: () => { setAsking(false); proceed(); },
  };
}

export function LeaveDialog({ guard, saveLabel, saveBlocked, onSave }: { guard: ReturnType<typeof useLeaveGuard>; saveLabel: string; saveBlocked?: string; onSave: () => void }) {
  if (!guard.asking) return null;
  return (
    <Modal title="有未保存的修改" onClose={guard.stay} footer={<>
      <Button onClick={guard.stay}>继续编辑</Button>
      <Button variant="danger-outline" onClick={guard.discard}>放弃改动</Button>
      <Button variant="primary" disabledReason={saveBlocked} onClick={() => { guard.hide(); onSave(); }}>{saveLabel}后继续</Button>
    </>}><p>离开后这次的修改不会保留。</p></Modal>
  );
}

export function useI5Writes({ actions, toast, canQuery, onSettled, onReadBack }: {
  actions: IContentActions;
  toast: (message: string) => void;
  canQuery: boolean;
  /** 一次写入有了结果（成功或转成待确认）后，读回对应的数据。 */
  onSettled: (write: I5Write) => Promise<unknown> | void;
  onReadBack: (write: I5Write) => void;
}) {
  const propose = usePropose();
  const reach = useReach();
  const [pending, setPending] = useState<I5Pending[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [recovering, setRecovering] = useState("");
  const [releasing, setReleasing] = useState<I5Pending | null>(null);
  const sync = useCallback(() => setPending(pendingWrites.list()), []);
  useEffect(() => sync(), [sync]);

  const note = (record: I5Pending, text: string) => setNotes((current) => ({ ...current, [record.commandKey]: text }));
  /** 发一条已存好的操作。"done" 已成功；"unknown" 已转成待确认；确定失败抛出。 */
  const execute = async (write: I5Write, scope: string, key: string, retained: boolean): Promise<"done" | "unknown"> => {
    try {
      await dispatch(write, key, actions, (spec) => propose(toast, spec));
    } catch (cause) {
      const unknown = isA2OutcomeUncertainError(cause) || isOutcomeUnknownError(cause);
      if (!unknown && !retained) pendingWrites.forget(scope);
      sync();
      if (!unknown) throw cause;
      toast("结果未确认，不要重复操作。到页面上方核对或按原操作重试。");
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
    if (record.expiresAt <= Date.now()) return;
    if (!pendingWrites.isDurablyStored(record.fingerprint, record.commandKey)) {
      note(record, "这次操作的记录没存住，不能再重试，请到操作记录与审批核对。");
      return;
    }
    note(record, "");
    setRecovering(record.commandKey);
    try {
      if (await execute({ target: record.target, label: record.label, op: record.op }, record.fingerprint, record.commandKey, true) === "done") toast("原操作已完成，请核对最新内容");
    } catch (cause) {
      note(record, `重试没有成功：${displayAdminError(cause)} 这说明不了原操作的结果，原操作继续保留。`);
      pendingWrites.remember(record.fingerprint, record.commandKey, { target: record.target, label: record.label, op: record.op, rejected: true });
      sync();
    } finally {
      setRecovering("");
    }
  };

  /** 按命令号查原提案。查到就有了结果，可以解除；查不到说明不了没提交，继续保留（OP-95）。 */
  const check = async (record: I5Pending) => {
    setRecovering(record.commandKey);
    try {
      const original = await fetchA2ProposalByKey(record.commandKey);
      if (!original) {
        note(record, "暂未查到原提案，结果仍待核实。原操作继续保留，不会重新提交。");
        return;
      }
      pendingWrites.forget(record.fingerprint, record.commandKey);
      sync();
      toast(`查到原提案，${PROPOSAL_STATUS[original.status]}。结果到「操作记录与审批」看。`);
      await onSettled(record);
    } catch (cause) {
      note(record, `查询没有成功：${displayAdminError(cause)} 原操作继续保留。`);
    } finally {
      setRecovering("");
    }
  };

  const release = (record: I5Pending) => {
    pendingWrites.forget(record.fingerprint, record.commandKey);
    sync();
    setReleasing(null);
    toast("已解除待确认，这个对象可以重新操作");
  };

  const auditHref = "/platform/audit?domain=I";
  const notices: ReactNode = pending.map((record) => {
    const expired = record.expiresAt <= Date.now();
    return (
      <Notice key={record.fingerprint} tone="warn" title={`${record.label} · 结果未确认`} action={<>
        {record.op.kind === "a2" && canQuery && <Button size="sm" disabled={!!recovering} onClick={() => void check(record)}>查询原提案</Button>}
        {(record.op.kind === "legal-save" || record.op.kind === "legal-transition" || record.op.kind === "privacy") && <Button size="sm" disabled={!!recovering} onClick={() => onReadBack(record)}>读回核对</Button>}
        <Button size="sm" disabled={!!recovering} disabledReason={expired ? EXPIRED_TEXT : undefined} onClick={() => void retry(record)}>按原操作重试</Button>
        {record.rejected && <Button size="sm" disabled={!!recovering} onClick={() => setReleasing(record)}>解除待确认</Button>}
      </>}>
        {formatBusinessTimeFull(new Date(record.createdAt).toISOString(), "—")}（{businessZone().label}）发出。{expired ? EXPIRED_TEXT : "重发原内容，已成功的不会重复执行。"}
        {reach(auditHref, "platform_a2_read") && <> <Link className="rd-link" href={auditHref} prefetch={false}>到操作记录核查</Link></>}
        <Explain label="这条操作怎么恢复" rows={[{ k: "恢复", v: recoveryText(record.op, canQuery) }, { k: "命令号", v: record.commandKey }]} />
        {notes[record.commandKey] && <div>{notes[record.commandKey]}</div>}
      </Notice>
    );
  });

  const releaseModal = releasing && (
    <Modal title="解除待确认" onClose={() => setReleasing(null)} footer={<>
      <Button onClick={() => setReleasing(null)}>取消</Button>
      <Button variant="primary" onClick={() => release(releasing)}>确认解除</Button>
    </>}>
      <p><b>{releasing.label}</b></p>
      <p>确认这次操作没有生效后再解除。解除后可以重新操作，这一步不发请求，不写操作记录。</p>
    </Modal>
  );

  const lockedTargets = new Set(pending.map((record) => record.target));
  return { send, notices, releaseModal, isLocked: (target: string) => lockedTargets.has(target) };
}

export type I5Writes = ReturnType<typeof useI5Writes>;
