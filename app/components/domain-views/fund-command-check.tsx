"use client";
import "./fund-command-check.css";
import { useEffect, useState, type ReactNode } from "react";
import { SearchCheck } from "lucide-react";
import { Button, Check, Explain, Fact, Facts, Field, Input, IrreversibleTag, Modal, Notice, Segments, StatusTag, Textarea, type StateTone } from "@/app/components/rd";
import { displayAdminError } from "@/lib/admin/error-messages";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { fundInvestigationAccess, type FundCommandEvidence, type FundCommandInvestigation, type FundCommandRecord, type FundInvestigationOutcome } from "@/lib/admin/fund-command-investigation";

/**
 * 资金类「结果未知」记录的查询原结果：D2、D3、D5、D6、D7、J1、K1、L1、E4 共用一个样子。
 * 查询只读（GET by-command-key）；核查结案是另一个按钮、另一个确认框，只给有调查权限的超级管理员。
 * 资金操作后端证明不了「确实没执行」，所以没查到、仍未知都不能写成没执行。
 */

type Tone = Extract<StateTone, "ok" | "warn" | "danger" | "progress" | "neutral" | "done">;
type Shown = { tone: Tone; title: string; text: string };
export type FundCheckCopy = {
  /** 这条记录不支持核查时找谁、去哪核对（CREGIS 恢复、银行查单等）。 */
  unsupported?: string;
  /** 页面上核对当前结果的地方，例如「到操作记录与审批核对」。 */
  where?: string;
};
export type FundSettled = { key: string; label: string; status: FundCommandInvestigation["originalStatus"] };

const CLOSE_NEEDED = "要结案，请把这条记录交给有调查权限的超级管理员，由对方按证据核查。";

function shown(outcome: FundInvestigationOutcome, expired: boolean, canRetry: boolean, where: string): Shown {
  if ("error" in outcome) {
    const forbidden = /只有原操作人或有调查权限/.test(outcome.error);
    return forbidden
      ? { tone: "danger", title: "没有查询权限", text: `${outcome.error}` }
      : { tone: "danger", title: "查询没有完成", text: `${outcome.error} 这不代表原操作没有执行，记录继续保留，请稍后再查。` };
  }
  const receipt = outcome.receipt;
  if (!receipt) return { tone: "warn", title: "没有查到这次请求", text: expired || !canRetry
    ? `后端没有这次请求的记录。查不到不等于没执行，记录继续保留；请${where}，不要另做一次。`
    : `后端没有这次请求的记录。查不到不等于没执行，先${where}；确认没有执行后再按原请求重试，重试用原请求，不会多做一次。` };
  if (receipt.originalStatus === "PROCESSING") return { tone: "progress", title: "原操作还在执行", text: "稍后再查。执行完之前不要重试，也不要另做一次。" };
  if (receipt.originalStatus === "FAILED") return { tone: "neutral", title: "原操作没有成功", text: expired || !canRetry
    ? `后端记为失败，这次请求没有生效。记录继续保留；请${where}后再决定要不要重新发起。`
    : "后端记为失败，这次请求没有生效。可以按原请求重试，会用原内容再执行一次。" };
  if (receipt.originalStatus === "UNKNOWN") return { tone: "warn", title: "后端也没有结果", text: "原操作中途中断，后端同样记为结果未知，相关对象继续锁着。重试只会得到同样的结果，需要按证据核查结案。" };
  // SUCCEEDED / CONFIRMED_* 已由页面清掉记录，这里只在页面没清（读回失败等）时兜底。
  return { tone: "done", title: "原操作已有结论", text: "刷新页面查看现在的结果。" };
}

const CONCLUSION_TEXT: Record<FundCommandEvidence["conclusion"], string> = { SUCCEEDED: "已执行", NOT_EXECUTED: "未执行", STILL_UNKNOWN: "仍未知" };

/** 查询原结果只在拿到后端回执后才写结论；没有查过时不显示任何结论。 */
export function FundCheckResult({ record, outcome, expired, canRetry, copy, techFacts, hideTech }: {
  record: FundCommandRecord;
  outcome?: FundInvestigationOutcome;
  expired: boolean;
  /** 现在这个账号能不能按原请求重试（页面自己的判断）。 */
  canRetry: boolean;
  copy?: FundCheckCopy;
  /** 页面自己的技术信息（操作人、理由等），和原请求编号放在同一个折叠里。 */
  techFacts?: string;
  /** 页面已经有自己的原操作技术信息折叠时不再重复。 */
  hideTech?: boolean;
}) {
  const [checkedAt, setCheckedAt] = useState<number>();
  useEffect(() => { if (outcome) setCheckedAt(Date.now()); }, [outcome]);
  const access = fundInvestigationAccess(record);
  const where = copy?.where ?? "到操作记录与审批核对";
  const origin = record.commandOrigin;
  const tech = [`原请求编号 ${record.commandKey}`, origin ? `${origin.originalMethod} ${origin.originalPath}` : "", techFacts ?? ""].filter(Boolean).join(" ｜ ");
  if (access.unavailableReason) return <div className="fund-check" role="status">
    <div className="fund-check-head"><StatusTag tone="neutral">不能查询原结果</StatusTag>{!hideTech && <Explain label="技术信息" content={tech} />}</div>
    <p>{access.unavailableReason === "MISSING_ORIGIN"
      ? `这条记录是升级前留下的，缺少原请求的来源，系统查不到它的结果。请${where}；需要结案时找有调查权限的超级管理员。`
      : copy?.unsupported ?? `这类操作系统还不支持查询原结果。请${where}；需要结案时找有调查权限的超级管理员。`}</p>
  </div>;
  const result = outcome && shown(outcome, expired, canRetry, where);
  const receipt = outcome && "receipt" in outcome ? outcome.receipt : null;
  const last = receipt?.investigation;
  const needClose = receipt?.originalStatus === "UNKNOWN";
  // 还没查过：不画分隔线，技术信息跟在正文后面。
  if (!result) return <>
    {!access.canRead && <p className="fund-check-aux">只有原操作人或有调查权限的超级管理员能查询原结果。{CLOSE_NEEDED}</p>}
    {!hideTech && <>{" "}<Explain label="技术信息" content={tech} /></>}
  </>;
  return <div className="fund-check" role="status">
    <div className="fund-check-head">
      <StatusTag tone={result.tone}>{result.title}</StatusTag>
      {checkedAt && <span className="fund-check-time">{formatBusinessTimeCompact(new Date(checkedAt).toISOString(), "—")} 查询</span>}
      {!hideTech && <Explain label="技术信息" content={tech} />}
    </div>
    <p>{result.text}</p>
    {last && <p className="fund-check-aux">上次核查 {formatBusinessTimeCompact(last.investigatedAt, "—")}：结论「{CONCLUSION_TEXT[last.conclusion]}」{last.requestedConclusion !== last.conclusion && `（申请的是「${CONCLUSION_TEXT[last.requestedConclusion as FundCommandEvidence["conclusion"]] ?? last.requestedConclusion}」，证据不够）`}。</p>}
    {needClose && !access.canSubmit && <p className="fund-check-aux">{CLOSE_NEEDED}</p>}
  </div>;
}

/** 待处理条上的两个查询类按钮：查询原结果（只读）、核查结案（单独确认框）。按原请求重试由页面自己放。 */
export function FundCheckButtons({ record, outcome, busy, checking, onCheck, onClose }: {
  record: FundCommandRecord;
  outcome?: FundInvestigationOutcome;
  busy?: boolean;
  checking?: boolean;
  onCheck: () => void;
  onClose: () => void;
}) {
  const access = fundInvestigationAccess(record);
  const receipt = outcome && "receipt" in outcome ? outcome.receipt : null;
  return <>
    {!access.unavailableReason && <Button size="sm" icon={<SearchCheck size={14} aria-hidden />} loading={checking} disabled={busy}
      disabledReason={access.canRead ? undefined : "只有原操作人或有调查权限的超级管理员能查询"} onClick={onCheck}>查询原结果</Button>}
    {receipt?.originalStatus === "UNKNOWN" && access.canSubmit && <Button size="sm" variant="danger-outline" disabled={busy} onClick={onClose}>核查结案</Button>}
  </>;
}

/** 查到原操作已有结论后记录会从待处理里消失；这条一直留到运营点「知道了」。 */
export function FundSettledNotices({ items, onDismiss }: { items: readonly FundSettled[]; onDismiss: (key: string) => void }) {
  return <>{items.map(item => {
    const text = item.status === "CONFIRMED_NOT_EXECUTED"
      ? { title: "核查确认没有执行", body: "原操作没有执行，这条记录已解除。重新核对现在的情况后，可以重新发起。" }
      : item.status === "CONFIRMED_SUCCEEDED"
        ? { title: "核查确认已执行", body: "超级管理员按证据确认原操作已经执行，这条记录已解除。不要再做一次；现在的结果看刷新后的页面。" }
        : { title: "原操作已执行", body: "后端有原操作的完成记录，这条记录已解除。不要再做一次；现在的结果看刷新后的页面。" };
    return <Notice key={item.key} tone="ok" title={<>{item.label} · <span className="rd-keep">{text.title}</span></>}
      action={<Button size="sm" onClick={() => onDismiss(item.key)}>知道了</Button>}>{text.body}</Notice>;
  })}</>;
}

/** 核查结案：资金操作只能按证据确认「已执行」，或留下「仍未知」的核查记录；后端决定证据够不够。 */
export function FundClosureModal({ label, createdAt, facts, onClose, onSubmit }: {
  label: string;
  createdAt: number;
  facts?: ReactNode;
  onClose: () => void;
  onSubmit: (evidence: FundCommandEvidence) => Promise<void>;
}) {
  const [conclusion, setConclusion] = useState<"SUCCEEDED" | "STILL_UNKNOWN" | "">("");
  const [reference, setReference] = useState("");
  const [auditId, setAuditId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const length = reference.trim().length;
  const auditValid = !auditId.trim() || /^[1-9]\d{0,17}$/.test(auditId.trim());
  const block = !conclusion ? "请选择核查结论" : !length ? "请写明核查依据" : length > 512 ? "核查依据最多 512 字"
    : !auditValid ? "成功记录编号须为正整数" : !acknowledged ? "请先勾选确认" : undefined;
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
      </Facts>
      <Notice tone="warn">后端按你给的依据核对：证据够才记为「已执行」并解除这条记录；不够时记为「仍未知」，继续锁着。资金操作现在不能按「没有执行」结案。<span className="rd-keep">提交后不能撤销或改结论。</span></Notice>
      <Field label="核查结论" required error={touched && !conclusion ? "请选择核查结论" : undefined}
        help={conclusion === "SUCCEEDED" ? "原操作有完成记录，或操作记录里有这次请求的成功记录时选。确认后解除，不会再执行。" : conclusion === "STILL_UNKNOWN" ? "只留下这次核查记录，继续锁着，之后可以再核查。" : undefined}>
        <Segments label="核查结论" value={conclusion} onChange={value => setConclusion(value as "SUCCEEDED" | "STILL_UNKNOWN")}
          items={[{ value: "SUCCEEDED", label: "已执行" }, { value: "STILL_UNKNOWN", label: "仍未知" }]} />
      </Field>
      <Field label="核查依据" required hint="最多 512 字" error={touched && (!length || length > 512) ? length ? "核查依据最多 512 字" : "请写明核查依据" : undefined}>
        <Textarea rows={3} maxLength={512} count={`${length}/512`} disabled={busy} placeholder="写明核对了什么、在哪看到的，例如：操作记录里 10:42 这次放行的成功记录" value={reference} onChange={event => setReference(event.target.value)} />
      </Field>
      {conclusion === "SUCCEEDED" && <Field label="成功记录编号" help="原操作没有完成记录时必填：操作记录里这次请求成功的那条记录的编号。" error={touched && !auditValid ? "成功记录编号须为正整数" : undefined}>
        <Input aria-label="成功记录编号" className="fund-check-audit" inputMode="numeric" autoComplete="off" placeholder="例如 88123" value={auditId} disabled={busy} onChange={event => setAuditId(event.target.value)} />
      </Field>}
      <Check label="我已核对依据，知道提交后不能撤销" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  </Modal>;
}
