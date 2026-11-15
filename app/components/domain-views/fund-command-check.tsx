"use client";
import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronRight, SearchCheck, X } from "lucide-react";
import { Button, Check, Explain, Fact, Facts, Field, IconButton, Input, IrreversibleTag, Modal, Notice, Segments, StatusTag, Textarea, type StateTone } from "@/app/components/rd";
import { displayAdminError } from "@/lib/admin/error-messages";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { fundInvestigationAccess, type FundCommandEvidence, type FundCommandInvestigation, type FundCommandRecord, type FundInvestigationOutcome } from "@/lib/admin/fund-command-investigation";

/**
 * 资金类「结果未知」记录的恢复面板：D2、D3、D5、D6、D7、J1、K1、L1、E4 共用一个样子。
 * 一个面板、每条一行（操作 · 状态 · 一句结论 · 固定在右侧的按钮），点开一行才看发出时间、详细说明和技术信息。
 * 查询原结果只读（GET by-command-key）；核查结案是另一个按钮、另一个确认框，只给有调查权限的超级管理员。
 * 资金操作系统证明不了「确实没执行」，所以没查到、仍未知都不写成没执行。
 */

export type FundCheckCopy = {
  /** 这条记录不支持查询时的一句话（找谁、去哪核对）。 */
  unsupported?: string;
  /** 页面上核对当前结果的地方，例如「操作记录与审批」。 */
  where?: string;
};
export type FundSettled = { key: string; label: string; status: FundCommandInvestigation["originalStatus"] };
export type FundRecoveryRow = {
  key: string;
  /** 操作和对象，一行写得下。 */
  title: ReactNode;
  /** 支持查询的原记录；页面自己判断的记录（直接保存、待审批）不传。 */
  record?: FundCommandRecord;
  outcome?: FundInvestigationOutcome;
  /** 发出时间；旧记录没有时不写。 */
  createdAt?: number;
  expired: boolean;
  /** 现在这个账号能不能按原请求重试。 */
  canRetry: boolean;
  /** 页面自己的状态（待审批、直接保存查不了等），优先于查询结果。 */
  status?: { tone: StateTone; label: string; line: string };
  actions: ReactNode;
  /** 展开后显示：这条记录特有的事实（金额、改动、页面的读回说明等）。 */
  detail?: ReactNode;
  tech?: string;
  copy?: FundCheckCopy;
};

type Shown = { tone: StateTone; label: string; line: string };
const INTRO = "这些操作发出后没收到明确结果，可能已经生效。先查询原结果；按原请求重试只会重发原内容，不会多做一次。有结果前，相关对象不能再操作。";

function shown(row: FundRecoveryRow): Shown {
  const where = row.copy?.where ?? "操作记录与审批";
  if (row.status) return row.status;
  const access = row.record ? fundInvestigationAccess(row.record) : null;
  if (access?.unavailableReason) return { tone: "neutral", label: "不能查询", line: access.unavailableReason === "MISSING_ORIGIN"
    ? `升级前的记录查不了原结果，到${where}核对。` : row.copy?.unsupported ?? `这类操作查不了原结果，到${where}核对。` };
  const outcome = row.outcome;
  if (!outcome) return row.expired
    ? { tone: "warn", label: "已过期", line: `超过 24 小时不能再重试，先查询原结果。` }
    : { tone: "warn", label: "结果未知", line: access && !access.canRead ? "只有原操作人或有调查权限的超级管理员能查询。" : "可能已经生效，先查询原结果。" };
  if ("error" in outcome) return /只有原操作人或有调查权限/.test(outcome.error)
    ? { tone: "danger", label: "没有查询权限", line: "请原操作人或有调查权限的超级管理员查询。" }
    : { tone: "danger", label: "查询失败", line: "这不代表没执行，记录保留，稍后再查。" };
  const receipt = outcome.receipt;
  if (!receipt) return { tone: "warn", label: "没有查到", line: `查不到不等于没执行，先到${where}核对，不要另做一次。` };
  if (receipt.originalStatus === "PROCESSING") return { tone: "progress", label: "还在执行", line: "稍后再查，执行完之前不要重试。" };
  if (receipt.originalStatus === "FAILED") return { tone: "neutral", label: "没有成功", line: row.canRetry && !row.expired
    ? "这次没有生效，可以按原请求重试。" : `这次没有生效，到${where}核对后再决定要不要重新发起。` };
  if (receipt.originalStatus === "UNKNOWN") return { tone: "warn", label: "仍未知", line: access?.canSubmit
    ? "系统也没有结果，重试也一样，请按证据核查结案。" : "系统也没有结果，请有调查权限的超级管理员核查结案。" };
  return { tone: "done", label: "已有结论", line: "刷新页面查看现在的结果。" };
}

const CONCLUSION_TEXT: Record<FundCommandEvidence["conclusion"], string> = { SUCCEEDED: "已执行", NOT_EXECUTED: "未执行", STILL_UNKNOWN: "仍未知" };

function RecoveryRow({ row }: { row: FundRecoveryRow }) {
  const [open, setOpen] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number>();
  useEffect(() => { if (row.outcome) setCheckedAt(Date.now()); }, [row.outcome]);
  const view = shown(row);
  const receipt = row.outcome && "receipt" in row.outcome ? row.outcome.receipt : null;
  const error = row.outcome && "error" in row.outcome ? row.outcome.error : "";
  const last = receipt?.investigation;
  const origin = row.record?.commandOrigin;
  const tech = [row.record ? `原请求编号 ${row.record.commandKey}` : "", origin ? `${origin.originalMethod} ${origin.originalPath}` : "", row.tech ?? ""].filter(Boolean).join(" ｜ ");
  const id = `fund-row-${row.key.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  return <li className="fund-row">
    <div className="fund-row-line">
      <button type="button" className="fund-row-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
        <ChevronRight className="fund-row-chevron" size={14} aria-hidden /><span className="fund-row-title">{row.title}</span>
      </button>
      <StatusTag tone={view.tone}>{view.label}</StatusTag>
      <span className="fund-row-text">{view.line}</span>
      <span className="fund-row-actions">{row.actions}</span>
    </div>
    {open && <div className="fund-row-detail" id={id}>
      {(row.createdAt !== undefined || checkedAt) && <p>{[row.createdAt !== undefined ? `${formatBusinessTimeCompact(new Date(row.createdAt).toISOString(), "—")} 发出` : "", checkedAt ? `${formatBusinessTimeCompact(new Date(checkedAt).toISOString(), "—")} 查询` : ""].filter(Boolean).join("，")}（{businessZone().label}）。</p>}
      {row.detail}
      {error && <p>{error}</p>}
      {last && <p>上次核查 {formatBusinessTimeCompact(last.investigatedAt, "—")}：结论「{CONCLUSION_TEXT[last.conclusion]}」{last.requestedConclusion !== last.conclusion && `（申请的是「${CONCLUSION_TEXT[last.requestedConclusion as FundCommandEvidence["conclusion"]] ?? last.requestedConclusion}」，证据不够）`}。</p>}
      {tech && <p className="fund-row-tech"><Explain label="技术信息" content={tech}>技术信息</Explain></p>}
    </div>}
  </li>;
}

/** 一个面板列出这页所有结果未知的操作；默认露三条，其余点开。 */
export function FundRecoveryPanel({ rows, link, settled, onDismissSettled, heading }: {
  rows: readonly FundRecoveryRow[];
  /** 「到操作记录与审批核对」这类去处，整块只放一次。 */
  link?: ReactNode;
  settled?: readonly FundSettled[];
  onDismissSettled?: (key: string) => void;
  /** 默认「N 项操作结果未知」；有待审批等别的状态时页面自己写。 */
  heading?: string;
}) {
  const [all, setAll] = useState(false);
  const visible = all ? rows : rows.slice(0, 3);
  return <>
    {settled?.map(item => <p key={item.key} className="fund-settled" role="status">
      <CheckCircle2 size={14} aria-hidden />
      <span><b>{item.label}</b>{item.status === "CONFIRMED_NOT_EXECUTED" ? " 核查确认没有执行，记录已解除，可以重新发起。" : " 原操作已执行，记录已解除，不要再做一次。"}</span>
      {onDismissSettled && <IconButton aria-label="关闭这条提示" onClick={() => onDismissSettled(item.key)}><X size={14} aria-hidden /></IconButton>}
    </p>)}
    {rows.length > 0 && <Notice tone="warn" title={<>{heading ?? `${rows.length} 项操作结果未知`}<Explain label="结果未知怎么处理" content={INTRO} /></>}>
      <ul className="fund-rows" aria-label="结果未知的操作">{visible.map(row => <RecoveryRow key={row.key} row={row} />)}</ul>
      {(rows.length > 3 || link) && <div className="fund-rows-foot">
        {rows.length > 3 && <Button size="sm" variant="ghost" onClick={() => setAll(value => !value)}>{all ? "只看前 3 条" : `展开全部 ${rows.length} 条`}</Button>}
        {link}
      </div>}
    </Notice>}
  </>;
}

/** 每行右侧的查询类按钮：查询原结果（只读）、核查结案（单独确认框）。按原请求重试由页面自己放在后面。 */
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
      <Notice tone="warn">系统按你给的依据核对：证据够才记为「已执行」并解除这条记录；不够时记为「仍未知」，继续锁着。资金操作现在不能按「没有执行」结案。<span className="rd-keep">提交后不能撤销或改结论。</span></Notice>
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
