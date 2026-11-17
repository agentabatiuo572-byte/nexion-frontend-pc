"use client";
import { useState, type ReactNode } from "react";
import { SearchCheck, ShieldCheck } from "lucide-react";
import { Button, Check, Explain, Facts, Fact, Field, Input, IrreversibleTag, Modal, Notice, Select, StatusTag, Textarea, type StateTone, type Tone } from "@/app/components/rd";
import { ADMIN_ERROR_MESSAGES, displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { eCommandClosureOffer, eCommandResult, type ECommandEvidence, type ECommandInvestigation } from "@/lib/admin/e-command-investigation";
import { CLOSURE_ACK, CLOSURE_PLACEHOLDER, CLOSURE_PLACEHOLDER_BY, ROLLBACK_HELP, SETTLED_REJECTED, closureLine, offerNotice, type ClosureOffer, closureConflict, closureTime, receiptExplain, receiptRejected, type ClosureBasis } from "../recovery-panel";

/** The last authoritative lookup of one original command; `receipt: null` means the backend found no bound record. */
export type CommandOutcome = { receipt: ECommandInvestigation | null } | { error: string };
export type SettledCommand = { key: string; label: string; status: ECommandInvestigation["originalStatus"] };
type Conclusion = ECommandEvidence["conclusion"];

const CONCLUSION_TEXT: Partial<Record<ECommandEvidence["conclusion"], string>> = { SUCCEEDED: "已执行", NOT_EXECUTED: "未执行", STILL_UNKNOWN: "仍未知", REJECTED: "后台拒绝" };
const CONCLUSION_HELP: Record<Conclusion, string> = {
  REJECTED: "按后台当时的拒绝结案，记录解除。这不等于没有执行；要重做，请按现在的状态重新发起。",
  SUCCEEDED: "原操作有完成记录，或填的成功记录编号指向这次操作时才能确认；确认后解除锁定，不再重试。",
  NOT_EXECUTED: "原操作确认已整体撤销、没有生效时才能选；确认后解除锁定，可以重新发起。",
  STILL_UNKNOWN: "只留下这次核查记录，原操作继续锁定，之后可以再次核查。",
};
const SUCCEEDED_BY_RECEIPT = "后台按这次操作自己的处理记录核对，对得上才确认；确认后解除锁定，不再重试。";

/** Closure is offered after 24 hours or once the backend itself reports the result as unknown; never to an active writer. */
export function closureOpen(outcome: CommandOutcome | undefined, expired: boolean) {
  return eCommandClosureOffer(outcome, expired).conclusions.length > 0;
}

/**
 * 标签和资金页的面板同一组叫法（查询失败、没有查到、还在执行、记为失败、仍未知、后台拒绝、已处理）。
 * canClose：这个账号能不能核查结案；不能的，要结案的那几句改说找有调查权限的超级管理员。
 */
function view(outcome: CommandOutcome, expired: boolean, canClose = true): { tone: Tone & ("ok" | "warn" | "progress" | "neutral" | "done" | "danger"); title: string; text: string } {
  if ("error" in outcome) return { tone: "danger", title: "查询失败", text: outcome.error };
  const receipt = outcome.receipt;
  if (!receipt) return { tone: "warn", title: "没有查到", text: expired
    ? "原请求可能没送到，查不到不等于没执行。记录保留，请到操作记录与审批核对。"
    : "原请求可能没送到，查不到不等于没执行。记录保留，可以按原请求重试，不会重复执行。" };
  if (receipt.originalStatus === "PROCESSING") return { tone: "progress", title: "还在执行", text: expired ? "原操作还在执行，稍后再查；不要重复提交。" : "原操作还在执行，过一会儿再查询；现在重试不会重复执行，也拿不到新结果。" };
  if (receipt.originalStatus === "CONFIRMED_REJECTED") return { tone: "done", title: "已结案", text: "核查确认是后台拒绝，记录已解除。" };
  if (receiptRejected(receipt)) return { tone: "warn", title: "后台拒绝", text: expired
    ? canClose ? "后台拒绝了，不保证没有改动；已过 24 小时，可按「后台拒绝」结案。" : "后台拒绝了，不保证没有改动；请有调查权限的超级管理员核查结案。"
    : "后台拒绝了，不保证没有改动；按原请求重试可看原因，不会重复执行。" };
  // 过期的记为失败、仍未知：按结案框能选的结论说下一步（closureLine）。
  const step = closureLine(eCommandClosureOffer(outcome, expired), receipt, canClose);
  if (receipt.originalStatus === "FAILED") return { tone: "neutral", title: "记为失败", text: expired
    ? step!
    : "系统记录这次失败了；按原请求重试不会做两遍，已做成的直接拿回结果。" };
  // 后端把被业务规则拒绝的请求也记成处理完：这里看不出成没成，只有按原请求重试能拿到当时的结果。
  if (["BUSINESS_RESULT_UNAVAILABLE", "REJECTED", "BATCH_RESULT"].includes(eCommandResult(receipt)) || receipt.originalStatus === "SUCCEEDED") return { tone: "warn", title: "已处理", text: expired
    ? canClose ? "后台已处理，看不出成没成；已过 24 小时，需要核查结案。" : "后台已处理，看不出成没成；请有调查权限的超级管理员核查结案。"
    : "后台已处理，看不出成没成；按原请求重试可确认，不会重复执行。" };
  return { tone: "warn", title: "仍未知", text: (receipt.originalStatus === "UNKNOWN" ? step : undefined) ?? (!canClose ? "原操作处理到一半中断了；请有调查权限的超级管理员核查结案。"
    : expired ? "原操作处理到一半中断了；已过 24 小时，需要按证据核查结案。" : "原操作处理到一半中断了，重试也拿不到新结果；需要按证据核查结案。") };
}

/** The row's collapsed tag and sentence once the original has been looked up (RecoveryItem.result). */
export function commandOutcomeSummary(outcome: CommandOutcome | undefined, expired: boolean, canClose = true) {
  if (!outcome) return undefined;
  const shown = view(outcome, expired, canClose);
  return { tag: <StatusTag tone={shown.tone}>{shown.title}</StatusTag>, line: shown.text };
}

/**
 * One block under a pending notice: what the backend says about the original command.
 * `summarized` means the row already shows the tag and sentence (commandOutcomeSummary); only the longer notes stay here.
 */
export function CommandOutcomeLine({ outcome, expired, summarized, canClose = true }: { outcome?: CommandOutcome; expired: boolean; summarized?: boolean; canClose?: boolean }) {
  if (!outcome) return null;
  const shown = view(outcome, expired, canClose);
  const receipt = "receipt" in outcome ? outcome.receipt : null;
  const last = receipt?.investigation;
  const more = receiptExplain(receipt);
  if (summarized && !more && !last) return null;
  return <div className="e-check-outcome" role="status">
    {!summarized && <><StatusTag tone={shown.tone}>{shown.title}</StatusTag>
    <p>{shown.text}</p></>}
    {more && <p>{more}</p>}
    {last && <p className="e-check-last">最近一次核查 {formatBusinessTimeCompact(last.investigatedAt, "—")}：记为「{CONCLUSION_TEXT[last.conclusion] ?? "已有结论"}」{last.requestedConclusion !== last.conclusion && `，申请的「${CONCLUSION_TEXT[last.requestedConclusion as Conclusion] ?? last.requestedConclusion}」证据不足`}。</p>}
  </div>;
}

/** Someone without investigation rights is told who can close the original command. */
export function ClosureContact() {
  return <p className="e-check-contact">需要结案时，请把原请求编号发给有调查权限的超级管理员，由其按证据核查结案。</p>;
}

/** Settled commands leave the pending list; this keeps the authoritative outcome visible until dismissed. */
export function SettledCommandNotices({ items, onDismiss }: { items: SettledCommand[]; onDismiss: (key: string) => void }) {
  return <>{items.map(item => {
    const text = item.status === "CONFIRMED_REJECTED" ? { title: "核查确认是后台拒绝", body: SETTLED_REJECTED.replace(/^核查确认是后台拒绝，/, "") }
      : item.status === "CONFIRMED_NOT_EXECUTED" ? { title: "核查确认未执行", body: "原操作没有执行，记录已解除，可以重新发起。" }
      : item.status === "CONFIRMED_SUCCEEDED" ? { title: "核查确认已执行", body: "超级管理员按证据确认原操作已执行，记录已解除，不再重试。结果以刷新后的状态为准。" }
        : { title: "原操作已完成", body: "原操作已执行，记录已解除，不要再做一次。结果以刷新后的状态为准。" };
    return <Notice key={item.key} tone="done" title={<>{item.label} · <span className="rd-keep">{text.title}</span></>} action={<Button size="sm" onClick={() => onDismiss(item.key)}>知道了</Button>}>{text.body}</Notice>;
  })}</>;
}

/** Evidence form for a super administrator with investigation rights; the backend decides what the evidence proves. */
export function CommandClosureModal({ label, commandKey, createdAt, facts, known, offer, onClose, onSubmit }: {
  label: string;
  commandKey: string;
  createdAt: number;
  facts?: ReactNode;
  /** The lookup found SUCCEEDED or FAILED (closureKnown): the backend refuses STILL_UNKNOWN; the found result decides the rest. */
  known?: boolean | ClosureBasis;
  /** The caller's own list of conclusions (ClosureOffer); known is ignored then. Same wording as the fund dialog. */
  offer?: ClosureOffer;
  onClose: () => void;
  onSubmit: (evidence: ECommandEvidence) => Promise<void>;
}) {
  const basis: ClosureBasis | undefined = offer ? undefined : known === true ? { rejected: false, success: "audit" } : known || undefined;
  const choices: Conclusion[] = offer ? offer.conclusions : basis ? [...(basis.rejected ? ["REJECTED" as const] : []), ...(basis.success !== "never" ? ["SUCCEEDED" as const] : []), "NOT_EXECUTED"]
    : ["SUCCEEDED", "NOT_EXECUTED", "STILL_UNKNOWN"];
  // 只有一个结论可选时直接写明（和资金结案框一样），不出下拉。
  const fixed = choices.length === 1 ? choices[0] : undefined;
  const [conclusion, setConclusion] = useState<Conclusion | "">(fixed ?? "");
  const [reference, setReference] = useState("");
  const [auditId, setAuditId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const referenceLength = reference.trim().length;
  // 「已执行」凭原回包时不显示编号栏。
  const byReceipt = offer ? offer.success !== "audit" : basis?.success === "receipt";
  const withAudit = conclusion === "SUCCEEDED" && !byReceipt;
  const auditValid = !auditId.trim() || /^[1-9]\d{0,17}$/.test(auditId.trim());
  const help = conclusion === "SUCCEEDED" && byReceipt ? SUCCEEDED_BY_RECEIPT : conclusion === "NOT_EXECUTED" && offer ? ROLLBACK_HELP : conclusion ? CONCLUSION_HELP[conclusion] : undefined;
  const block = !conclusion ? "请选择核查结论" : !referenceLength ? "请写明核查依据" : referenceLength > 512 ? "核查依据最多 512 字"
    : !auditValid ? "成功记录编号须为正整数" : !acknowledged ? "请先勾选确认" : undefined;
  return <Modal title="核查结案" icon={SearchCheck} tone="danger" sub={<IrreversibleTag>确认后不能撤销</IrreversibleTag>} busy={busy} dirty={!fixed && !!conclusion || !!reference || !!auditId} onClose={onClose}
    footer={<><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="danger" loading={busy} loadingText="提交中…" disabledReason={block} onClick={async () => {
      setTouched(true);
      if (block || !conclusion) return;
      setBusy(true); setError("");
      try {
        await onSubmit({ conclusion, evidenceReference: reference.trim(), ...(withAudit && auditId.trim() ? { evidenceAuditId: Number(auditId.trim()) } : {}) });
      } catch (failure) {
        const shown = displayAdminError(failure);
        setError(shown === ADMIN_ERROR_MESSAGES.INVESTIGATION_KNOWN_RESULT_CONFLICT
          ? closureConflict(conclusion, { audit: withAudit && !!auditId.trim(), canAudit: withAudit, rollback: !!offer?.conclusions.includes("NOT_EXECUTED"), stillUnknown: !!offer?.conclusions.includes("STILL_UNKNOWN") }) : shown);
      }
      finally { setBusy(false); }
    }}>提交核查结论</Button></>}>
    <div className="rd-stack">
      <Facts>
        <Fact k="原操作">{label}</Fact>
        {facts}
        <Fact k="首次提交">{closureTime(createdAt)}<Explain label="技术信息" content={<>原请求编号 <span data-mono className="rd-keep">{commandKey}</span></>} /></Fact>
        {fixed && <Fact k="核查结论">{CONCLUSION_TEXT[fixed]}</Fact>}
      </Facts>
      <Notice tone="warn">{offer ? offerNotice(offer) : basis?.rejected ? "后台当时拒绝了这次操作，可以按「后台拒绝」结案；其他结论要证据对得上，对不上会退回，记录保留。"
        : basis ? "这次请求后台有处理记录：证据对得上才确认并解除锁定，对不上会退回，记录保留。" : "按证据核对：证据够才确认「已执行」或「未执行」并解除锁定；不够时记为「仍未知」，原操作继续锁定。"}</Notice>
      {fixed ? <p className="rd-note">{help}</p> : <Field label="核查结论" required help={help} error={touched && !conclusion ? "请选择核查结论" : undefined}>
        <Select aria-label="核查结论" required value={conclusion} placeholder="请选择核查结论" disabled={busy} onChange={value => setConclusion(value as Conclusion)}
          options={choices.map(value => ({ value, label: CONCLUSION_TEXT[value] }))} />
      </Field>}
      <Field label="核查依据" required hint="最多 512 字" error={touched && (!referenceLength || referenceLength > 512) ? referenceLength ? "核查依据最多 512 字" : "请写明核查依据" : undefined}>
        <Textarea rows={3} maxLength={512} count={`${referenceLength}/512`} disabled={busy} placeholder={conclusion ? CLOSURE_PLACEHOLDER_BY[conclusion] ?? CLOSURE_PLACEHOLDER : CLOSURE_PLACEHOLDER} value={reference} onChange={event => setReference(event.target.value)} />
      </Field>
      {withAudit && <Field label="成功记录编号" help="原操作没有完成记录时填写：操作记录里这次操作的成功记录编号。" error={touched && !auditValid ? "成功记录编号须为正整数" : undefined}>
        <Input aria-label="成功记录编号" className="e-check-audit" inputMode="numeric" autoComplete="off" placeholder="例如 88123" value={auditId} disabled={busy} onChange={event => setAuditId(event.target.value)} />
      </Field>}
      <Check label={CLOSURE_ACK} checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  </Modal>;
}

/** A read failure on a device page: never the write-side "操作未完成" fallback. */
export function eReadError(failure: unknown) {
  const shown = displayAdminReadError(failure);
  return shown.startsWith("操作未完成") ? "这次没有读到，请稍后重试；一直读不到请联系值班人员。" : shown;
}

/** Final status of an approval request, worded for the object it changed. */
export const PROPOSAL_END: Record<string, { tag: string; tone: StateTone; text: string }> = {
  approved: { tag: "已批准", tone: "done", text: "批准后按原内容执行；结果以重新读取的当前值为准。" },
  rejected: { tag: "已驳回", tone: "neutral", text: "原内容没有生效；需要时重新提交。" },
  withdrawn: { tag: "已撤回", tone: "neutral", text: "原内容没有生效。" },
  expired: { tag: "已过期", tone: "neutral", text: "过期没人处理，原内容没有生效；需要时重新提交。" },
};

/** One-line conclusions for recovery rows; the longer wording sits in the row details. */
export const RECOVERY_LINE = {
  unknown: "不知道审批单建没建成；先查询，重试不会重复建单。",
  absent: "现在查不到这张审批单，可以按原请求重试。",
  expired: "超过 24 小时不能重试，先查询原结果。",
  created: "审批单已建，进度没查到；只查询，不会再建。",
  missing: "按原请求查不到，说明没建成；核对后可以解除。",
  refused: "重试被明确拒绝；核对原因后可以解除。",
  pending: "等另一位管理员批准，批准前不生效。",
  direct: "现在的状态不代表原操作的结果，先查询原结果。",
} as const;

/** Device pages use the shared recovery panel, so their rows look exactly like the fund pages' rows. */
export { RecoveryPanel, SettledLine, closureKnown, recoveryTitle, type RecoveryItem } from "../recovery-panel";

/**
 * Release of an approval request the backend has no record of (expired, never created).
 * The confirm re-queries by the original request; a ticket found then keeps the record.
 */
export function MissingProposalReleaseModal({ label, createdAt, onCancel, onConfirm }: { label: ReactNode; createdAt: number; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Modal title="解除原操作记录" icon={ShieldCheck} busy={busy} onClose={onCancel} footer={<>
    <Button disabled={busy} onClick={onCancel}>取消</Button>
    <Button variant="primary" loading={busy} loadingText="正在再查一次…" onClick={async () => {
      setBusy(true); setError("");
      try { await onConfirm(); }
      catch (failure) { setError(eReadError(failure)); }
      finally { setBusy(false); }
    }}>确认解除</Button>
  </>}>
    <div className="rd-stack">
      <Facts><Fact k="原操作">{label}</Fact><Fact k="提交时间">{formatBusinessTimeCompact(new Date(createdAt).toISOString(), "—")}</Fact></Facts>
      <p>按原请求查不到这张审批单，说明没建成。解除后这条记录清掉，可以重新提交。</p>
      <p className="rd-note">确认时会再查一次；这次查到了审批单就不解除。</p>
      {error && <Notice tone="warn" title="这次没有解除">{error}</Notice>}
    </div>
  </Modal>;
}
