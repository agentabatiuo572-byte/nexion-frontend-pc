"use client";
import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronRight, SearchCheck, X } from "lucide-react";
import { Button, Check, Explain, Fact, Facts, Field, IconButton, Input, IrreversibleTag, KeepText, Modal, Notice, Segments, StatusTag, Textarea, type StateTone } from "@/app/components/rd";
import { ADMIN_ERROR_MESSAGES, displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { CLOSURE_ACK, CLOSURE_PLACEHOLDER, CLOSURE_PLACEHOLDER_BY, ROLLBACK_HELP, SETTLED_REJECTED, closureLine, offerNotice, type ClosureOffer, SettledLine, closureConflict, closureTime, fullTitle, receiptCodeTech, receiptExplain, receiptRejected, recoveryTitle, rejectedStatus, sentLine, useFreshFirst, type ClosureBasis } from "./recovery-panel";
import { fundCommandResult, fundInvestigationAccess, type FundCommandBatch, type FundCommandEvidence, type FundCommandInvestigation, type FundCommandRecord, type FundInvestigationOutcome } from "@/lib/admin/fund-command-investigation";
import { eCommandClosureOffer, eCommandClosureRequests } from "@/lib/admin/e-command-investigation";
export { FAILED_EXPIRED_LINE, closureKnown, closureConflict } from "./recovery-panel";

/**
 * 资金类「结果未知」记录的恢复面板：D2、D3、D5、D6、D7、J1、K1、L1、E4 共用一个样子。
 * 一个面板、每条一行（操作 · 状态 · 提交时间和一句结论 · 固定在右侧的按钮），和共用恢复条同一个样子；点开一行看查询时间、详细说明和技术信息。
 * 查询原操作只读（GET by-command-key）；核查结案是另一个按钮、另一个确认框，只给有调查权限的超级管理员。
 * 资金操作系统证明不了「确实没执行」，所以没查到、仍未知都不写成没执行。
 */

export type FundCheckCopy = {
  /** 这条记录不支持查询时的一句话（找谁、去哪核对）。 */
  unsupported?: string;
  /** 页面上核对当前结果的地方，例如「操作记录与审批」。 */
  where?: string;
  /** 没有记下原请求出处的旧记录，页面还能查什么（例如只能查审批单）。 */
  missingOrigin?: string;
};
/** proposal：原请求是提交审批申请，查到已执行只说明审批单建成了。 */
export type FundSettled = { key: string; label: string; status: FundCommandInvestigation["originalStatus"]; proposal?: boolean; proposalConclusion?: string; batch?: FundCommandBatch };
export type FundRecoveryRow = {
  key: string;
  /** 操作和对象，一行写得下。 */
  title: ReactNode;
  /** 支持查询的原记录；页面自己判断的记录（直接保存、待审批）不传。 */
  record?: FundCommandRecord;
  outcome?: FundInvestigationOutcome;
  /** 发出时间；旧记录没有时行上写「—」（TX-26）。 */
  createdAt?: number;
  expired: boolean;
  /** 现在这个账号能不能按原操作重试。 */
  canRetry: boolean;
  /** 这一行有没有「查询原操作」按钮；不传时按记录本身能不能查判断。 */
  canQuery?: boolean;
  /** 这个账号能不能核查结案；不传时按记录本身（fundInvestigationAccess）判断。没有资金原记录的页面自己传。 */
  canClose?: boolean;
  /** 页面自己的状态（待审批、直接保存查不了等），优先于查询结果；more 是展开后的说明（同一档和共用的一样，见 processedStatus）。 */
  status?: { tone: StateTone; label: string; line: string; more?: string };
  actions: ReactNode;
  /** 展开后显示：这条记录特有的事实（金额、改动、页面的读回说明等）。 */
  detail?: ReactNode;
  tech?: string;
  copy?: FundCheckCopy;
};

type Shown = { tone: StateTone; label: string; line: string; more?: string };
/** 24 小时内按原操作重试：后台对还在执行的返回「处理中」、对结果未知的返回「结果未知」，都不会再执行一次，也拿不到新结果。 */
export const PROCESSING_LINE = "过一会儿再查询；现在重试不会重复执行，也拿不到新结果。";
export const UNKNOWN_LINE = "系统也没有结果，重试也拿不到新结果；请按证据核查结案。";
function lookupStatus(expired: boolean, result: Shown): Shown {
  if (!expired) return result;
  return { ...result, label: "已过期", line: `已超过 24 小时，不能再重试。${result.label}。${result.line}` };
}
export function unsettledLookupStatus(state: "NOT_FOUND" | "PROCESSING", expired: boolean, where = "操作记录与审批"): Shown {
  return lookupStatus(expired, state === "NOT_FOUND"
    ? { tone: "warn", label: "没有查到", line: `查不到不等于没执行，先到${where}核对，不要另做一次。` }
    : { tone: "progress", label: "还在执行", line: expired ? "稍后再查，执行完才有结论。" : PROCESSING_LINE });
}
const INTRO = "这些操作发出后没收到明确结果：直接生效的可能已经生效，走审批的可能已经提交了申请。先查询原操作；按原操作重试只会重发原内容，不会多做一次。有结果前，相关对象不能再操作。";

/** 原请求是提交到「操作记录与审批」的申请：批准前什么都不生效，结果未知时只能说「可能已经提交」。 */
function isProposal(record?: FundCommandRecord) {
  return record?.commandOrigin?.originalPath === "/api/admin/platform/audit/operations";
}

/** 查不了时缺的是什么：这页的查看权限、操作记录与审批的查看权限，还是不是原操作人。 */
export function fundReadBlock(record: FundCommandRecord) {
  const access = fundInvestigationAccess(record);
  if (access.unavailableReason || access.canRead) return undefined;
  const authorities = useAdminAuth.getState().session?.authorities ?? [];
  if (record.commandOrigin && !authorities.includes(record.commandOrigin.readAuthority)) return "这个账号没有这页的查看权限，查不了原结果";
  if (access.proposalReadAnyOf && !access.proposalReadAnyOf.some(code => authorities.includes(code))) return "这个账号没有「操作记录与审批」的查看权限，查不了原结果";
  return "只有原操作人或有调查权限的超级管理员能查询";
}

/** 一条记录现在的标签和那句话；没有用这个面板的页面（A3）也用它，同一个状态一个说法。 */
export function fundRecoveryStatus(row: Pick<FundRecoveryRow, "record" | "outcome" | "expired" | "canRetry" | "canQuery" | "canClose" | "status" | "copy">): Shown {
  return shown(row);
}

function shown(row: Pick<FundRecoveryRow, "record" | "outcome" | "expired" | "canRetry" | "canQuery" | "canClose" | "status" | "copy">): Shown {
  const where = row.copy?.where ?? "操作记录与审批";
  if (row.status) return row.status;
  const access = row.record ? fundInvestigationAccess(row.record) : null;
  if (access?.unavailableReason) return access.unavailableReason === "MISSING_ORIGIN" && row.copy?.missingOrigin
    ? { tone: "warn", label: row.expired ? "已过期" : "结果未知", line: row.copy.missingOrigin }
    : { tone: "neutral", label: "不能查询", line: access.unavailableReason === "MISSING_ORIGIN"
      ? `升级前的记录查不了原结果，到${where}核对。` : row.copy?.unsupported ?? `这类操作查不了原结果，到${where}核对。` };
  const outcome = row.outcome;
  const block = row.record ? fundReadBlock(row.record) : undefined;
  const canQuery = row.canQuery ?? !block;
  const maybe = isProposal(row.record) ? "可能已经提交" : "可能已经生效";
  if (!outcome) return row.expired
    ? { tone: "warn", label: "已过期", line: canQuery ? "超过 24 小时不能再重试，先查询原操作。" : `超过 24 小时不能再重试，到${where}核对。` }
    : { tone: "warn", label: "结果未知", line: canQuery ? `${maybe}，先查询原操作。` : block ? `${block}。` : `${maybe}，这个账号查不了原结果，到${where}核对。` };
  if ("error" in outcome) return lookupStatus(row.expired, /只有原操作人或有调查权限/.test(outcome.error)
    ? { tone: "danger", label: "没有查询权限", line: "请原操作人或有调查权限的超级管理员查询。" }
    : { tone: "danger", label: "查询失败", line: "这不代表没执行，记录保留，稍后再查。" });
  const receipt = outcome.receipt;
  if (!receipt) return unsettledLookupStatus("NOT_FOUND", row.expired, where);
  if (receipt.originalStatus === "PROCESSING") return unsettledLookupStatus("PROCESSING", row.expired, where);
  // 过了 24 小时不能重试：有调查权限的给核查结案，没有的写清找谁。
  const canClose = row.canClose ?? !!access?.canSubmit;
  const closure = canClose ? "已过 24 小时，请核查结案。" : "请有调查权限的超级管理员核查结案。";
  const more = receiptExplain(receipt, where);
  if (receipt.originalStatus === "CONFIRMED_REJECTED") return { tone: "done", label: "已结案", line: "核查确认是后台拒绝，记录已解除。" };
  if (receiptRejected(receipt)) return { ...rejectedStatus({ expired: row.expired, canRetry: row.canRetry, canClose }), more };
  // 过期的记为失败、仍未知：按结案框能选的结论说下一步（closureLine；记为失败过期时总有一句），说不了的沿用原句。
  const step = closureLine(eCommandClosureOffer(outcome, row.expired), receipt, canClose);
  if (receipt.originalStatus === "FAILED") return { tone: "neutral", label: "记为失败", line: row.expired ? step!
    : row.canRetry ? "系统记录这次失败了；按原操作重试不会做两遍，已做成的直接拿回结果。" : `系统记录这次失败了，到${where}核对后再决定要不要重新发起。` };
  if (receipt.originalStatus === "UNKNOWN") return { tone: "warn", label: "仍未知", line: step ?? (!canClose ? "系统也没有结果，请有调查权限的超级管理员核查结案。"
    : row.expired ? "系统也没有结果；已过 24 小时，请核查结案。" : UNKNOWN_LINE) };
  // 后端把被业务规则拒绝的请求也记成处理完：这里看不出成没成，只有按原操作重试能拿到当时的结果。
  if (["BUSINESS_RESULT_UNAVAILABLE", "REJECTED", "BATCH_RESULT"].includes(fundCommandResult(receipt)) || receipt.originalStatus === "SUCCEEDED") return { tone: "warn", label: "已处理", more, line: row.expired ? `后台已处理，看不出成没成；${closure}`
    : row.canRetry ? "后台已处理，看不出成没成；按原操作重试可确认，不会重复执行。" : "后台已处理，看不出成没成；请有操作权限的人按原操作重试确认。" };
  return { tone: "done", label: "已有结论", line: "刷新页面查看现在的结果。" };
}

/** 选「后台拒绝」时的说明：按原记录自己的回包结案，不用填编号；记录解除不等于没执行，也不能重发原来那一次。 */
export const REJECTED_HELP = "按后台当时的拒绝结案，记录解除。这不等于没有执行；要重做，请按现在的状态重新发起。";

const CONCLUSION_TEXT: Partial<Record<FundCommandEvidence["conclusion"], string>> = { SUCCEEDED: "已执行", NOT_EXECUTED: "未执行", STILL_UNKNOWN: "仍未知", REJECTED: "后台拒绝" };

/** zoned：面板标题旁已经写了时区，展开后的查询时间不再写。 */
function RecoveryRow({ row, zoned }: { row: FundRecoveryRow; zoned: boolean }) {
  const [open, setOpen] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number>();
  useEffect(() => { if (row.outcome) setCheckedAt(Date.now()); }, [row.outcome]);
  const view = shown(row);
  const receipt = row.outcome && "receipt" in row.outcome ? row.outcome.receipt : null;
  const error = row.outcome && "error" in row.outcome ? row.outcome.error : "";
  const last = receipt?.investigation;
  const origin = row.record?.commandOrigin;
  const tech = [row.record ? `操作编号 ${row.record.commandKey}` : "", origin ? `${origin.originalMethod} ${origin.originalPath}` : "", receiptCodeTech(receipt), row.tech ?? ""].filter(Boolean).join(" ｜ ");
  const id = `fund-row-${row.key.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  return <li className="fund-row">
    <div className="fund-row-line">
      <button type="button" className="fund-row-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
        <ChevronRight className="fund-row-chevron" size={14} aria-hidden /><span className="fund-row-title" ref={fullTitle}>{row.title}</span>
      </button>
      <StatusTag tone={view.tone}>{view.label}</StatusTag>
      {/* 提交时间常显在结论句前面（OP-93 第 1 项），写法同共用恢复条；一个分句整段换行，不折出孤字。 */}
      <span className="fund-row-text"><KeepText text={sentLine(row.createdAt, view.line)} /></span>
      <span className="fund-row-actions">{row.actions}</span>
    </div>
    {open && <div className="fund-row-detail" id={id}>
      <p className="fund-row-full">{row.title}</p>
      {checkedAt && <p>{formatBusinessTimeCompact(new Date(checkedAt).toISOString(), "—")} 查询{zoned ? "" : `（${businessZone().label}）`}。</p>}
      {row.detail}
      {view.more && <p>{view.more}</p>}
      {error && <p>{error}</p>}
      {last && <p>上次核查 {formatBusinessTimeCompact(last.investigatedAt, "—")}：结论「{CONCLUSION_TEXT[last.conclusion] ?? "已有结论"}」{last.requestedConclusion !== last.conclusion && `（申请的是「${CONCLUSION_TEXT[last.requestedConclusion as FundCommandEvidence["conclusion"]] ?? last.requestedConclusion}」，证据不够）`}。</p>}
      {tech && <p className="fund-row-tech"><Explain label="技术信息" content={tech}>技术信息</Explain></p>}
    </div>}
  </li>;
}

/** 查到了结果、记录还留着（还要重试或核查结案）的几档：标题里叫「还没结案」。 */
const OPEN_LABELS = ["后台拒绝", "已处理", "记为失败"];

/** 一个面板列出这页所有结果未知的操作；默认露三条，其余点开。 */
/** 查到整批的逐笔结果、记录解除后的一句：只写有的几组；一笔都没成功时不说「已执行」。 */
function batchSettledText(batch: FundCommandBatch) {
  const groups = [batch.rejected.length ? `${batch.rejected.length} 笔大额转人工` : "", batch.conflicts.length ? `${batch.conflicts.length} 笔未执行` : ""].filter(Boolean).join("，");
  return batch.accepted.length ? `这批已有结果，记录已解除：${batch.accepted.length} 笔成功${groups ? `，${groups}` : ""}。` : `这批已有结果，记录已解除：没有一笔成功${groups ? `，${groups}` : ""}。`;
}

/** 查到结果、记录解除后的一句；页面用轻提示（toast）说时也用它。 */
export function settledText(item: Pick<FundSettled, "status" | "proposal" | "proposalConclusion" | "batch">) {
  if (item.status === "CONFIRMED_REJECTED") return SETTLED_REJECTED;
  if (item.status === "CONFIRMED_NOT_EXECUTED") return "核查确认没有执行，记录已解除，可以重新发起。";
  // 核查确认的整批不看逐笔：受控结论不要求逐笔齐全，残缺的逐笔不当成这批的结果。
  if (item.batch && item.status !== "CONFIRMED_SUCCEEDED") return batchSettledText(item.batch);
  if (item.proposal) return item.proposalConclusion ?? "审批申请已提交，记录已解除；到操作记录与审批看审批进度，不要再提交一次。";
  return item.status === "CONFIRMED_SUCCEEDED" ? "核查确认已执行，记录已解除，不要再做一次。" : "原操作已执行，记录已解除，不要再做一次。";
}

export function FundRecoveryPanel({ rows, link, settled, onDismissSettled, settledAction, heading }: {
  rows: readonly FundRecoveryRow[];
  /** 「到操作记录与审批核对」这类去处，整块只放一次。 */
  link?: ReactNode;
  settled?: readonly FundSettled[];
  onDismissSettled?: (key: string) => void;
  /** 已解除的提示行末尾的按钮，例如「查看逐笔结果」。 */
  settledAction?: (item: FundSettled) => ReactNode;
  /** 默认按每行的标签数：「N 项操作结果未知」「N 项操作还没结案」「N 项在等审批」「N 项已有结论」，只写有的几种。 */
  heading?: string;
}) {
  const [all, setAll] = useState(false);
  const { ordered, box } = useFreshFirst(rows);
  const visible = all ? ordered : ordered.slice(0, 3);
  const labels = rows.map(row => shown(row).label);
  const open = labels.filter(label => OPEN_LABELS.includes(label)).length;
  const waiting = labels.filter(label => label === "待审批").length;
  const ended = labels.filter(label => label === "没有建成").length;
  const timed = rows.some(row => row.createdAt !== undefined);
  return <>
    {settled?.map(item => <SettledLine key={item.key} label={item.label} text={settledText(item)} action={settledAction?.(item)}
      onDismiss={onDismissSettled && (() => onDismissSettled(item.key))} />)}
    {rows.length > 0 && <div ref={box}><Notice tone="warn" title={<>{heading ?? recoveryTitle(rows.length - open - waiting - ended, waiting, ended, open)}<Explain label="结果未知怎么处理" content={INTRO} />{timed && <span className="fund-rows-zone">时间为{businessZone().label}</span>}</>}>
      <ul className="fund-rows" aria-label="结果未知的操作">{visible.map(row => <RecoveryRow key={row.key} row={row} zoned={timed} />)}</ul>
      {(rows.length > 3 || link) && <div className="fund-rows-foot">
        {rows.length > 3 && <Button size="sm" variant="ghost" onClick={() => setAll(value => !value)}>{all ? "只看前 3 条" : `展开全部 ${rows.length} 条`}</Button>}
        {link}
      </div>}
    </Notice></div>}
  </>;
}

/** 每行右侧的查询类按钮：查询原操作（只读）、核查结案（单独确认框）。按原操作重试由页面自己放在后面。 */
export function FundCheckButtons({ record, outcome, expired, busy, checking, onCheck, onClose, lookupWithoutOrigin, canLookupOwnProposal }: {
  record: FundCommandRecord;
  /** 超过 24 小时：查到已处理完或记为失败也给核查结案（不能再重试，这是唯一的出路）。不传时只在仍未知时给。 */
  expired?: boolean;
  /** 没有原请求出处的旧审批记录：仍给「查询原操作」，页面只调查审批单的读取。 */
  lookupWithoutOrigin?: boolean;
  /** 原发起人查票用该票种的原号查询权限。 */
  canLookupOwnProposal?: boolean;
  outcome?: FundInvestigationOutcome;
  busy?: boolean;
  checking?: boolean;
  onCheck: () => void;
  onClose: () => void;
}) {
  const access = fundInvestigationAccess(record);
  const receipt = outcome && "receipt" in outcome ? outcome.receipt : null;
  return <>
    {(canLookupOwnProposal || !access.unavailableReason || access.unavailableReason === "MISSING_ORIGIN" && lookupWithoutOrigin) && <Button size="sm" icon={<SearchCheck size={14} aria-hidden />} loading={checking} disabled={busy}
      disabledReason={canLookupOwnProposal || access.unavailableReason ? undefined : fundReadBlock(record)} onClick={onCheck}>查询原操作</Button>}
    {access.canSubmit && eCommandClosureRequests(receipt, !!expired).conclusions.length > 0 && <Button size="sm" variant="danger-outline" disabled={busy} onClick={onClose}>核查结案</Button>}
  </>;
}

/** 结案框里能选的结论：查到的原结果决定（见 closureKnown）；后端给不出的不列。 */
type Closable = "SUCCEEDED" | "STILL_UNKNOWN" | "REJECTED" | "NOT_EXECUTED";
const CHOICE_LABEL: Record<Closable, string> = { REJECTED: "后台拒绝", SUCCEEDED: "已执行", NOT_EXECUTED: "未执行", STILL_UNKNOWN: "仍未知" };

/**
 * 核查结案：没有确定结果时只能按证据确认「已执行」，或留下「仍未知」的核查记录；
 * 查到后台拒绝的，可以按「后台拒绝」结案（后端只看原记录自己的回包，不要编号）。后端决定证据够不够。
 */
export function FundClosureModal({ label, createdAt, facts, known, offer, blockedReason, onClose, onSubmit }: {
  label: string;
  createdAt: number;
  facts?: ReactNode;
  /** 查到已处理完或记为失败（closureKnown）：后端不收「仍未知」，按查到的原结果给结论。 */
  known?: boolean | ClosureBasis;
  /** 调用方直接给结论列表时用它，known 不再起作用（见 ClosureOffer）。 */
  offer?: ClosureOffer;
  blockedReason?: string;
  onClose: () => void;
  onSubmit: (evidence: FundCommandEvidence) => Promise<void>;
}) {
  const basis: ClosureBasis | undefined = offer ? undefined : known === true ? { rejected: false, success: "audit" } : known || undefined;
  const choices: Closable[] = offer ? offer.conclusions
    : basis ? [...(basis.rejected ? ["REJECTED" as const] : []), ...(basis.success !== "never" ? ["SUCCEEDED" as const] : [])] : ["SUCCEEDED", "STILL_UNKNOWN"];
  const fixed = choices.length === 1 ? choices[0] : undefined;
  const [conclusion, setConclusion] = useState<Closable | "">(fixed ?? "");
  const [reference, setReference] = useState("");
  const [auditId, setAuditId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const length = reference.trim().length;
  // 原回包本身能证明做成的（receipt），后端不看编号；只有要靠成功记录的才填。
  const needsAudit = conclusion === "SUCCEEDED" && (offer ? offer.success === "audit" : basis?.success !== "receipt");
  const auditValid = !auditId.trim() || /^[1-9]\d{0,17}$/.test(auditId.trim());
  const block = !choices.length ? "这条现在结不了案" : !conclusion ? "请选择核查结论" : !length ? "请写明核查依据" : length > 512 ? "核查依据最多 512 字"
    : needsAudit && !auditId.trim() ? "选「已执行」要填成功记录编号" : needsAudit && !auditValid ? "成功记录编号须为正整数" : !acknowledged ? "请先勾选确认" : undefined;
  const notice = offer ? offerNotice(offer) : !basis ? "系统按你给的依据核对：证据够才记为「已执行」并解除这条记录；不够时记为「仍未知」，继续锁着。这类操作现在不能按「没有执行」结案。"
    : !choices.length ? "这条现在结不了案：后台没有能对上的结论，记录继续保留。请把操作编号交给技术同事核对。"
    : basis.rejected ? choices.length > 1 ? "后台当时拒绝了这次操作，按「后台拒绝」结案即可解除。操作记录里确有这次的成功记录时，才选「已执行」。" : "后台当时拒绝了这次操作，可以按「后台拒绝」结案。"
    : basis.success === "receipt" ? "后台按这次操作自己的处理记录核对：对得上才解除，对不上会退回，记录保留。"
    : "成功记录对得上才解除，对不上会退回，记录保留。操作记录里没有这次成功记录的，现在结不了案。";
  const help = conclusion === "REJECTED" ? REJECTED_HELP : conclusion === "NOT_EXECUTED" ? ROLLBACK_HELP : conclusion === "STILL_UNKNOWN" ? "只留下这次核查记录，继续锁着，之后可以再核查。"
    : conclusion === "SUCCEEDED" && !fixed ? "操作记录里有这次请求的成功记录时选。确认后解除，不会再执行。" : undefined;
  return <Modal title="核查结案" icon={SearchCheck} tone="danger" sub={<IrreversibleTag>确认后不能撤销</IrreversibleTag>} busy={busy} dirty={!fixed && !!conclusion || !!reference || !!auditId} onClose={onClose}
    footer={<><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="danger" loading={busy} loadingText="提交中…" disabledReason={block ?? blockedReason} onClick={async () => {
      setTouched(true);
      if (block || blockedReason || !conclusion) return;
      setBusy(true); setError("");
      try {
        await onSubmit({ conclusion, evidenceReference: reference.trim(), ...(needsAudit && auditId.trim() ? { evidenceAuditId: Number(auditId.trim()) } : {}) });
      } catch (failure) {
        const shown = displayAdminError(failure);
        // 其余退回码的中文都已写明原因和记录保留（error-messages），和设备结案框一样原样显示。
        setError(shown === ADMIN_ERROR_MESSAGES.INVESTIGATION_KNOWN_RESULT_CONFLICT ? closureConflict(conclusion, { audit: needsAudit && !!auditId.trim(), canAudit: needsAudit, rollback: !!offer?.conclusions.includes("NOT_EXECUTED"), stillUnknown: !!offer?.conclusions.includes("STILL_UNKNOWN") }) : shown);
      }
      finally { setBusy(false); }
    }}>提交核查结论</Button></>}>
    <div className="rd-stack">
      <Facts>
        <Fact k="原操作">{label}</Fact>
        {facts}
        <Fact k="首次提交">{closureTime(createdAt)}</Fact>
        {fixed && (basis || offer) && <Fact k="核查结论">{CHOICE_LABEL[fixed]}</Fact>}
      </Facts>
      <Notice tone="warn">{notice}</Notice>
      {fixed && (basis || offer) ? help && <p className="rd-note">{help}</p>
        : choices.length > 1 && <Field label="核查结论" required error={touched && !conclusion ? "请选择核查结论" : undefined} help={help}>
          <Segments label="核查结论" value={conclusion} onChange={value => setConclusion(value as Closable)} items={choices.map(value => ({ value, label: CHOICE_LABEL[value] }))} />
        </Field>}
      {choices.length > 0 && <Field label="核查依据" required hint="最多 512 字" error={touched && (!length || length > 512) ? length ? "核查依据最多 512 字" : "请写明核查依据" : undefined}>
        <Textarea rows={3} maxLength={512} count={`${length}/512`} disabled={busy} placeholder={conclusion ? CLOSURE_PLACEHOLDER_BY[conclusion] ?? CLOSURE_PLACEHOLDER : CLOSURE_PLACEHOLDER} value={reference} onChange={event => setReference(event.target.value)} />
      </Field>}
      {needsAudit && <Field label="成功记录编号" required help={basis || offer ? "到「操作记录与审批」找这次请求成功的那条记录，填它的编号。" : "到「操作记录与审批」找这次请求成功的那条记录，填它的编号。没有这个编号，系统只会记为「仍未知」。"} error={touched && (!auditId.trim() || !auditValid) ? auditId.trim() ? "成功记录编号须为正整数" : "选「已执行」要填成功记录编号" : undefined}>
        <Input aria-label="成功记录编号" className="fund-check-audit" inputMode="numeric" autoComplete="off" placeholder="例如 88123" value={auditId} disabled={busy} onChange={event => setAuditId(event.target.value)} />
      </Field>}
      {choices.length > 0 && <Check label={CLOSURE_ACK} checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />}
      {blockedReason && <p className="rd-toolbar-note">{blockedReason}</p>}
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  </Modal>;
}
