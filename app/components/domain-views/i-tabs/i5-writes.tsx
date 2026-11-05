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
type I5Pending = PendingMutationRecord & I5Write;

const pendingWrites = createPendingMutationStore<I5Pending>({
  storageKey: "nexion-admin-i5-disclosure-commands-v1",
  isValidRecord: (record) => typeof record.target === "string" && typeof record.label === "string" && typeof record.op === "object" && record.op !== null,
});

export const WRITE_LOCKED = "这个对象有结果未确认的操作，先处理页面上方的待确认";

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

/** 待确认条写这条操作能怎么恢复，只写接口真有的（OP-95）。 */
function recoveryText(op: I5Op, canQuery: boolean): string {
  if (op.kind === "a2") return canQuery ? "审批单可能已经生成，批准前不会执行。先查原提案，查不到再按原操作重试。" : "审批单可能已经生成，批准前不会执行。这个账号查不了原提案，按原操作重试，或请能看操作记录的同事核查。";
  if (op.kind === "content") return "可能已经保存。按原操作重试会用同一命令号重新发送，后端不会重复执行。";
  return "可能已经生效。先读回核对；按原操作重试时，如果原操作已生效，后端会按改动冲突拒绝，不会写两次。";
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
  const [rejected, setRejected] = useState<string[]>([]);
  const [recovering, setRecovering] = useState("");
  const [releasing, setReleasing] = useState<I5Pending | null>(null);
  const sync = useCallback(() => setPending(pendingWrites.list()), []);
  useEffect(() => sync(), [sync]);

  const note = (record: I5Pending, text: string) => setNotes((current) => ({ ...current, [record.commandKey]: text }));
  /** "done" 已成功；"unknown" 已转成待确认；确定失败抛出，留在确认框。 */
  const send = async (write: I5Write): Promise<"done" | "unknown"> => {
    const scope = `${write.target}|${write.label}`;
    const retained = pendingWrites.get(scope);
    const key = retained ?? createA2CommandKey("i5");
    pendingWrites.remember(scope, key, write);
    if (!pendingWrites.isDurablyStored(scope, key)) {
      if (!retained) pendingWrites.forget(scope, key);
      throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
    }
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

  const retry = async (record: I5Pending) => {
    // 要在 list() 之前查：list() 会从内存副本恢复已删除的记录，那样就成了换号重发。
    if (!pendingWrites.isDurablyStored(record.fingerprint, record.commandKey)) {
      pendingWrites.forget(record.fingerprint, record.commandKey);
      sync();
      toast("原操作已结束或过期，本次未再次发送。请先核对记录，再决定如何处理。");
      return;
    }
    setRejected((current) => current.filter((key) => key !== record.commandKey));
    note(record, "");
    setRecovering(record.commandKey);
    try {
      if (await send({ target: record.target, label: record.label, op: record.op }) === "done") toast("原操作已完成，请核对最新内容");
    } catch (cause) {
      note(record, `重试没有成功：${displayAdminError(cause)} 这说明不了原操作的结果，原操作继续保留。`);
      setRejected((current) => [...current, record.commandKey]);
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
  const notices: ReactNode = pending.map((record) => (
    <Notice key={record.fingerprint} tone="warn" title={`${record.label} · 结果未确认`} action={<>
      {record.op.kind === "a2" && canQuery && <Button size="sm" disabled={!!recovering} onClick={() => void check(record)}>查询原提案</Button>}
      {(record.op.kind === "legal-save" || record.op.kind === "legal-transition" || record.op.kind === "privacy") && <Button size="sm" disabled={!!recovering} onClick={() => onReadBack(record)}>读回核对</Button>}
      <Button size="sm" disabled={!!recovering} onClick={() => void retry(record)}>按原操作重试</Button>
      {rejected.includes(record.commandKey) && <Button size="sm" disabled={!!recovering} onClick={() => setReleasing(record)}>解除待确认</Button>}
    </>}>
      {formatBusinessTimeFull(new Date(record.createdAt).toISOString(), "—")}（{businessZone().label}）发出。{recoveryText(record.op, canQuery)}
      {reach(auditHref, "platform_a2_read") && <> <Link className="rd-link" href={auditHref} prefetch={false}>到操作记录核查</Link></>}
      <Explain label="技术信息" content={`命令号 ${record.commandKey}`} />
      {notes[record.commandKey] && <div>{notes[record.commandKey]}</div>}
    </Notice>
  ));

  const releaseModal = releasing && (
    <Modal title="解除待确认" onClose={() => setReleasing(null)} footer={<>
      <Button onClick={() => setReleasing(null)}>取消</Button>
      <Button variant="primary" onClick={() => release(releasing)}>确认解除</Button>
    </>}>
      <p><b>{releasing.label}</b></p>
      <p>重试被拒说明不了原操作的结果。先到操作记录或读回内容，确认原操作有没有生效，再解除。</p>
      <p>解除后这个对象可以重新操作，原操作不再重试。这一步只放开本页的锁，不发请求，不写操作记录。</p>
    </Modal>
  );

  const lockedTargets = new Set(pending.map((record) => record.target));
  return { send, notices, releaseModal, isLocked: (target: string) => lockedTargets.has(target) };
}

export type I5Writes = ReturnType<typeof useI5Writes>;
