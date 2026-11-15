"use client";
import { useState, type ReactNode } from "react";
import { SearchCheck, ShieldCheck } from "lucide-react";
import { Button, Check, Facts, Fact, Field, Input, IrreversibleTag, Modal, Notice, Select, StatusTag, Textarea, type StateTone, type Tone } from "@/app/components/rd";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import type { ECommandEvidence, ECommandInvestigation } from "@/lib/admin/e-command-investigation";

/** The last authoritative lookup of one original command; `receipt: null` means the backend found no bound record. */
export type CommandOutcome = { receipt: ECommandInvestigation | null } | { error: string };
export type SettledCommand = { key: string; label: string; status: ECommandInvestigation["originalStatus"] };
type Conclusion = ECommandEvidence["conclusion"];

const CONCLUSION_TEXT: Record<Conclusion, string> = { SUCCEEDED: "已执行", NOT_EXECUTED: "未执行", STILL_UNKNOWN: "仍未知" };
const CONCLUSION_HELP: Record<Conclusion, string> = {
  SUCCEEDED: "原操作留有完成回执，或审计编号指向这条命令的成功记录时才能确认；确认后解除锁定，不再重试。",
  NOT_EXECUTED: "原操作的事务已确认回滚时才能确认；确认后解除锁定，可以重新发起。",
  STILL_UNKNOWN: "只留下这次核查记录，原操作继续锁定，之后可以再次核查。",
};

/** Closure is offered after 24 hours or once the backend itself reports the result as unknown; never to an active writer. */
export function closureOpen(outcome: CommandOutcome | undefined, expired: boolean) {
  const status = outcome && "receipt" in outcome ? outcome.receipt?.originalStatus : undefined;
  return status !== "PROCESSING" && (expired || status === "UNKNOWN");
}

function view(outcome: CommandOutcome, expired: boolean): { tone: Tone & ("ok" | "warn" | "progress" | "neutral" | "done"); title: string; text: string } {
  if ("error" in outcome) return { tone: "warn", title: "查询没有完成", text: outcome.error };
  const receipt = outcome.receipt;
  if (!receipt) return { tone: "neutral", title: "查不到这条原操作", text: expired
    ? "原请求可能没送到，查不到不等于没执行。记录保留，请到操作记录与审批核对。"
    : "原请求可能没送到，查不到不等于没执行。记录保留，可以按原请求重试，不会重复执行。" };
  if (receipt.originalStatus === "PROCESSING") return { tone: "progress", title: "还在处理", text: "原操作还在执行，稍后再查；不要重复提交。" };
  if (receipt.originalStatus === "FAILED") return { tone: "neutral", title: "原操作以失败结束", text: expired
    ? "这次操作记为失败。记录继续保留，请到操作记录与审批核对。"
    : "这次操作记为失败。可以按原请求重试，会按原内容再执行一次。" };
  return { tone: "warn", title: "结果仍未知", text: "原操作处理到一半中断了，按原请求重试也是同样结果；需要按证据核查结案。" };
}

/** One line under a pending notice: what the backend says about the original command. */
export function CommandOutcomeLine({ outcome, expired }: { outcome?: CommandOutcome; expired: boolean }) {
  if (!outcome) return null;
  const shown = view(outcome, expired);
  const last = "receipt" in outcome ? outcome.receipt?.investigation : null;
  return <div className="e-check-outcome" role="status">
    <StatusTag tone={shown.tone}>{shown.title}</StatusTag>
    <p>{shown.text}</p>
    {last && <p className="e-check-last">最近一次核查 {formatBusinessTimeCompact(last.investigatedAt, "—")}：记为「{CONCLUSION_TEXT[last.conclusion]}」{last.requestedConclusion !== last.conclusion && `，申请的「${CONCLUSION_TEXT[last.requestedConclusion as Conclusion] ?? last.requestedConclusion}」证据不足`}。</p>}
  </div>;
}

/** Someone without investigation rights is told who can close the original command. */
export function ClosureContact() {
  return <p className="e-check-contact">需要结案时，请把原请求编号发给有调查权限的超级管理员，由其按证据核查结案。</p>;
}

/** Settled commands leave the pending list; this keeps the authoritative outcome visible until dismissed. */
export function SettledCommandNotices({ items, onDismiss }: { items: SettledCommand[]; onDismiss: (key: string) => void }) {
  return <>{items.map(item => {
    const text = item.status === "CONFIRMED_NOT_EXECUTED" ? { title: "核查确认未执行", body: "原操作没有执行，本页待确认已解除，可以重新发起。" }
      : item.status === "CONFIRMED_SUCCEEDED" ? { title: "核查确认已执行", body: "超级管理员按证据确认原操作已执行，本页待确认已解除，原操作不再重试。业务结果以刷新后的当前状态为准。" }
        : { title: "原操作已完成", body: "原操作留有完成回执，本页待确认已解除。业务结果以刷新后的当前状态为准。" };
    return <Notice key={item.key} tone="done" title={<>{item.label} · <span className="rd-keep">{text.title}</span></>} action={<Button size="sm" onClick={() => onDismiss(item.key)}>知道了</Button>}>{text.body}</Notice>;
  })}</>;
}

/** Evidence form for a super administrator with investigation rights; the backend decides what the evidence proves. */
export function CommandClosureModal({ label, commandKey, createdAt, facts, onClose, onSubmit }: {
  label: string;
  commandKey: string;
  createdAt: number;
  facts?: ReactNode;
  onClose: () => void;
  onSubmit: (evidence: ECommandEvidence) => Promise<void>;
}) {
  const [conclusion, setConclusion] = useState<Conclusion | "">("");
  const [reference, setReference] = useState("");
  const [auditId, setAuditId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const referenceLength = reference.trim().length;
  const auditValid = !auditId.trim() || /^[1-9]\d{0,17}$/.test(auditId.trim());
  const block = !conclusion ? "请选择核查结论" : !referenceLength ? "请写明核查依据" : referenceLength > 512 ? "核查依据最多 512 字"
    : !auditValid ? "审计编号须为正整数" : !acknowledged ? "请先勾选确认" : undefined;
  return <Modal title="核查结案" icon={SearchCheck} tone="danger" sub={<IrreversibleTag>确认后不能撤销</IrreversibleTag>} busy={busy} dirty={!!conclusion || !!reference || !!auditId} onClose={onClose}
    footer={<><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="danger" loading={busy} loadingText="提交中…" disabledReason={block} onClick={async () => {
      setTouched(true);
      if (block || !conclusion) return;
      setBusy(true); setError("");
      try {
        await onSubmit({ conclusion, evidenceReference: reference.trim(), ...(conclusion === "SUCCEEDED" && auditId.trim() ? { evidenceAuditId: Number(auditId.trim()) } : {}) });
      } catch (failure) { setError(displayAdminError(failure)); }
      finally { setBusy(false); }
    }}>提交核查结论</Button></>}>
    <div className="rd-stack">
      <Facts>
        <Fact k="原操作">{label}</Fact>
        {facts}
        <Fact k="首次提交">{formatBusinessTimeCompact(new Date(createdAt).toISOString(), "—")}</Fact>
        <Fact k="原请求编号"><span data-mono>{commandKey}</span></Fact>
      </Facts>
      <Notice tone="warn">按证据核对：证据够才确认「已执行」或「未执行」并解除锁定；不够时记为「仍未知」，原操作继续锁定。<span className="rd-keep">确认后不能撤销或改结论。</span></Notice>
      <Field label="核查结论" required help={conclusion ? CONCLUSION_HELP[conclusion] : undefined} error={touched && !conclusion ? "请选择核查结论" : undefined}>
        <Select aria-label="核查结论" required value={conclusion} placeholder="请选择核查结论" disabled={busy} onChange={value => setConclusion(value as Conclusion)}
          options={(["SUCCEEDED", "NOT_EXECUTED", "STILL_UNKNOWN"] as const).map(value => ({ value, label: CONCLUSION_TEXT[value] }))} />
      </Field>
      <Field label="核查依据" required hint="最多 512 字" error={touched && (!referenceLength || referenceLength > 512) ? referenceLength ? "核查依据最多 512 字" : "请写明核查依据" : undefined}>
        <Textarea rows={3} maxLength={512} count={`${referenceLength}/512`} disabled={busy} placeholder="写明核对了什么、在哪里看到，例如：操作记录里这条命令 10:42 的成功记录" value={reference} onChange={event => setReference(event.target.value)} />
      </Field>
      {conclusion === "SUCCEEDED" && <Field label="成功审计编号" help="原操作没有完成回执时填写：操作记录里这条命令的成功记录编号。" error={touched && !auditValid ? "审计编号须为正整数" : undefined}>
        <Input aria-label="成功审计编号" className="e-check-audit" inputMode="numeric" autoComplete="off" placeholder="例如 88123" value={auditId} disabled={busy} onChange={event => setAuditId(event.target.value)} />
      </Field>}
      <Check label="我已核对证据，知道结论确认后不能撤销" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />
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

export type RecoveryItem = {
  key: string;
  object: ReactNode;
  tag: ReactNode;
  /** One sentence: where this record stands and what to do. */
  line: ReactNode;
  /** The answer of the last query on this record. */
  note?: ReactNode;
  actions?: ReactNode;
  /** Original request, reason and request number; opened on demand. */
  detail?: ReactNode;
};

/** All unsettled records of one page in one notice: one row each, three shown until the operator asks for all. */
export function RecoveryPanel({ title, lead, items, tone = "warn" }: { title: ReactNode; lead?: ReactNode; items: readonly RecoveryItem[]; tone?: StateTone }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string[]>([]);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, 3);
  return <Notice tone={tone} title={title}>
    {lead && <p>{lead}</p>}
    <ul className="e-recovery-list">{shown.map(item => {
      const expanded = open.includes(item.key);
      return <li key={item.key} className="e-recovery-row">
        <div className="e-recovery-main">
          <span className="e-recovery-head"><strong className="e-recovery-object">{item.object}</strong>{item.tag}</span>
          <span className="e-recovery-line">{item.line}</span>
          {item.note && <span className="e-recovery-note" role="status">{item.note}</span>}
        </div>
        <div className="e-recovery-actions">{item.actions}{item.detail && <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setOpen(keys => expanded ? keys.filter(key => key !== item.key) : [...keys, item.key])}>{expanded ? "收起" : "详情"}</Button>}</div>
        {item.detail && expanded && <div className="e-recovery-detail">{item.detail}</div>}
      </li>;
    })}</ul>
    {items.length > 3 && <Button size="sm" variant="ghost" className="e-recovery-more" aria-expanded={all} onClick={() => setAll(!all)}>{all ? "只看前 3 条" : `查看全部（${items.length} 条）`}</Button>}
  </Notice>;
}

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
