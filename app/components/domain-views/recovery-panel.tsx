"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronRight, X } from "lucide-react";
import { Button, Explain, IconButton, Notice, type StateTone } from "@/app/components/rd";
import { eCommandCanConcludeRejected, eCommandResult, type ECommandEvidence, type ECommandInvestigation } from "@/lib/admin/e-command-investigation";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";

/** 两分钟内发出的才算运营刚做完操作产生的记录；页面分批读进来的旧记录不算。 */
const FRESH_MS = 2 * 60 * 1000;
/**
 * 运营刚做完操作产生的记录排在最前面，并把面板滚进视野：已经有记录时再多一条，新的不会藏在「展开全部」后面。
 * 面板原来是空的就不用排：新面板本身就出现在页面上方。没有发出时间的行不排。
 */
export function useFreshFirst<T extends { key: string; createdAt?: number }>(rows: readonly T[]) {
  const known = useRef<Set<string> | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const keys = rows.map(row => row.key);
  const signature = keys.join("\n");
  useEffect(() => {
    const before = known.current;
    known.current = new Set(keys);
    if (!before?.size) return;
    const now = Date.now();
    const added = rows.filter(row => !before.has(row.key) && row.createdAt !== undefined && now - row.createdAt < FRESH_MS).map(row => row.key);
    setFresh(list => [...added, ...list.filter(key => !added.includes(key) && keys.includes(key))]);
    if (added.length) box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  const ordered = [...fresh.flatMap(key => rows.filter(row => row.key === key)), ...rows.filter(row => !fresh.includes(row.key))];
  return { ordered, box };
}

/**
 * 结案框能给哪些结论（只在按原号查到已处理完或记为失败时有；后端对这两种不收「仍未知」）。
 * rejected：原回包是后台拒绝（数据层 eCommandCanConcludeRejected），可以按「后台拒绝」结案。
 * success：「已执行」靠什么——receipt 原回包本身就能证明（业务码 0 或没有业务码），不用填成功记录编号；
 * audit 要填这次操作的成功记录编号；never 这类操作后端不认成功记录、原回包又证明不了，不给这个选项。
 * J4 恢复核对只认原回包业务码 0，后端不认任何成功记录（AdminCommandInvestigationService.allowedFact 没有这一支）。
 * 旧后端没有业务结果字段：照旧，除 J4 恢复核对外「已执行」都要编号。
 */
export type ClosureBasis = { rejected: boolean; success: "receipt" | "audit" | "never" };
export function closureKnown(outcome?: { receipt: ECommandInvestigation | null } | { error: string }): ClosureBasis | false {
  const receipt = outcome && "receipt" in outcome ? outcome.receipt : null;
  if (receipt?.originalStatus !== "SUCCEEDED" && receipt?.originalStatus !== "FAILED") return false;
  const receiptOnly = receipt.scope.startsWith("J4_PLAYBOOK_RESUME:");
  const byReceipt = receipt.originalStatus === "SUCCEEDED" && (receipt.businessState === undefined ? receiptOnly : receipt.businessCode === 0 || receipt.businessCode === null);
  return { rejected: eCommandCanConcludeRejected(receipt), success: byReceipt ? "receipt" : receiptOnly ? "never" : "audit" };
}

/** 查到原回包是后台拒绝、记录还保留（不含核查结案后的「后台拒绝」）。 */
export function receiptRejected(receipt: ECommandInvestigation | null | undefined) {
  return receipt?.originalStatus === "SUCCEEDED" && eCommandResult(receipt) === "REJECTED";
}

/** 后台拒绝、记录还保留时这一行怎么说：后台当时拒绝了，但不保证没有改动；原因要按原请求重试拿回，过期后核查结案。 */
export function rejectedStatus({ expired, canRetry, canClose, legacy }: { expired: boolean; canRetry: boolean; canClose: boolean; legacy?: boolean }): { tone: StateTone; label: string; line: string } {
  return { tone: "warn", label: "后台拒绝", line: `后台拒绝了，不保证没有改动；${!expired && canRetry ? "按原请求重试可看原因，不会重复执行。"
    : expired ? canClose ? "已过 24 小时，可按「后台拒绝」结案。" : "请有调查权限的超级管理员核查结案。"
      : legacy ? "旧记录过 24 小时后可核查结案。" : "请有操作权限的人按原请求重试看原因。"}` };
}

/** 过期的「记为失败」能结案的唯一一种：要这次的成功记录。资金面板、设备面板、用户详情、H1 共用。 */
export const FAILED_EXPIRED_LINE = "有这次的成功记录才能结案；没有就把原请求编号交给技术同事。";

/**
 * 记为失败（过期）、仍未知这一行的下一步：按数据层给的可选结论（eCommandClosureRequests）选一句，和结案框的选项对得上。
 * 「未执行」：后台已确认撤销（localTransactionRollbackConfirmed）才说确定；旧后端没有这项、只能申请的，说「核实已撤销才收」。
 * none：一个结论都不能选时的那句（行上没有技术信息的页面换成看得到的东西）。返回 undefined 时沿用调用处原来的句子（仍未知还能按成功记录结案）。
 */
export function closureLine(offer: ClosureOffer, receipt: ECommandInvestigation | null | undefined, canClose: boolean, none = "这条结不了案；请把技术信息里的原请求编号交给技术同事。") {
  const has = (value: ECommandEvidence["conclusion"]) => offer.conclusions.includes(value);
  if (has("NOT_EXECUTED")) return receipt?.localTransactionRollbackConfirmed
    ? canClose ? "这次操作已确认没有生效，可按「未执行」结案后重新做。" : "这次操作已确认没有生效，请有调查权限的超级管理员按「未执行」结案。"
    : !canClose ? has("SUCCEEDED") ? "请有调查权限的超级管理员核查结案。" : "请有调查权限的超级管理员申请按「未执行」结案。"
      : has("SUCCEEDED") ? "可按成功记录结案，或申请「未执行」；后台核实已撤销才收。" : "可申请按「未执行」结案；后台核实已撤销才会收。";
  if (!offer.conclusions.length) return none;
  if (offer.conclusions.length === 1 && has("STILL_UNKNOWN")) return canClose ? "系统也没有结果，现在只能记为「仍未知」，记录继续保留。" : "系统也没有结果，记录继续保留；到操作记录与审批核对。";
  if (offer.conclusions.length === 1 && has("SUCCEEDED") && offer.success === "audit") return canClose ? FAILED_EXPIRED_LINE : "有这次的成功记录时，请有调查权限的超级管理员核查结案。";
  return undefined;
}

/**
 * 直接生效的操作（不走审批）结果未知时，面板问号里的一段：H9、I3、I4、I5、I6 和课程、M4 共用。
 * 过了 24 小时不能重试，还没结论的由有调查权限的超级管理员核查结案（eCommandClosureRequests 给得出结论时才有按钮）。
 */
export const DIRECT_RECOVERY_INTRO = "提交时没收到确定结果，可能已经生效。先「查询原结果」；24 小时内可以「按原请求重试」，不会重复执行。过了 24 小时还没结论的，由有调查权限的超级管理员核查结案。";

/** 查到了结果、记录还留着（还要重试或核查结案）的几档：标题里叫「还没结案」，不算结果未知。 */
export const OPEN_RESULT_LABELS = ["后台拒绝", "已处理", "记为失败"];

/** 资金动账的操作：被拒时单独提醒钱可能已经动过。 */
const MONEY_SCOPE = /^(?:D2|E4)[_:]|^D3_RESERVE_INJECTION$|^F5_COMMISSION_(?:REVERSE|REISSUE)$/;

export function businessResultUnavailableText(where = "操作记录与审批") {
  return `后台只记了处理完，没记成没成；先到${where}核对再决定。`;
}

/**
 * 展开后的说明：只补收起那一行没说的事。「后台拒绝」不等于没执行；「已处理」里看不出的原因。
 * 下一步（重试、核查结案）已经写在收起那一行，按时间换说法，这里不再说。旧后端返回 undefined，和原来一样。
 */
export function receiptExplain(receipt: ECommandInvestigation | null | undefined, where = "操作记录与审批") {
  if (!receipt || receipt.businessState === undefined || receipt.originalStatus !== "SUCCEEDED") return undefined;
  const result = eCommandResult(receipt);
  if (result === "REJECTED") return `${MONEY_SCOPE.test(receipt.scope) ? "被拒不等于资金没有变动" : "被拒不等于什么都没执行"}，先到${where}核对再决定。`;
  if (result !== "BUSINESS_RESULT_UNAVAILABLE") return undefined;
  return receipt.businessState === "SUCCEEDED"
    ? `这类操作逐项执行，后台只记了整体做完，看不出每一项成没成；先到${where}核对再决定。`
    : businessResultUnavailableText(where);
}

/** 原回包的业务码（后端只给数字，不给原因文字），只放技术信息；0 和没有码时不写。接受查询结果或回执本身。 */
export function businessCodeOf(value: { receipt: ECommandInvestigation | null } | { error: string } | ECommandInvestigation | null | undefined) {
  const receipt = value && "receipt" in value ? value.receipt : value && "originalStatus" in value ? value : null;
  return receipt?.businessCode != null && receipt.businessCode !== 0 ? receipt.businessCode : undefined;
}
export function receiptCodeTech(receipt: ECommandInvestigation | null | undefined) {
  const code = businessCodeOf(receipt);
  return code === undefined ? "" : `业务码 ${code}`;
}

/** 查询结果里的原记录回执；没查过、查询失败时是 null。 */
export function receiptOf(outcome: { receipt: ECommandInvestigation | null } | { error: string } | undefined) {
  return outcome && "receipt" in outcome ? outcome.receipt : null;
}

/**
 * 行上的「技术信息」：原请求编号（和查到的业务码），收在一个文字触发的气泡里。
 * 「结不了案」「没有就把原请求编号交给技术同事」这两句指向它，行上没有展开详情的页面放在那句话后面。
 */
export function TechInfo({ commandKey, receipt }: { commandKey: string; receipt?: ECommandInvestigation | null }) {
  const code = receiptCodeTech(receipt);
  return <Explain label="技术信息" content={<>原请求编号 <span data-mono className="rd-keep">{commandKey}</span>{code && ` ｜ ${code}`}</>}>技术信息</Explain>;
}

/** 结案框里「系统记录」一行：按查到的原结果写，held 是记录现在的样子（例如「原修改还锁着」）。 */
export function receiptFact(receipt: ECommandInvestigation | null | undefined, held: string) {
  return `${receiptRejected(receipt) ? "后台拒绝了" : receipt?.originalStatus === "SUCCEEDED" ? "已处理，看不出成没成" : receipt?.originalStatus === "FAILED" ? "记为失败" : "结果未知"}，${held}`;
}

/**
 * 后台退回（INVESTIGATION_KNOWN_RESULT_CONFLICT）时的一句：按提交的结论说为什么、下一步做什么。
 * 后端退回的几种情况（AdminCommandInvestigationService.investigate）：已有结果却选「仍未知」；证明不了没执行却选「未执行」；
 * 原回包不是带业务码的拒绝却选「后台拒绝」；选「已执行」但原回包和成功记录都证明不了。
 * audit：「已执行」时填了成功记录编号；canAudit：框里有这一栏但没填。
 * rollback：调用方给的结论里有「未执行」（回滚核查，见 ClosureOffer）；stillUnknown：框里还能改选「仍未知」。
 */
export function closureConflict(conclusion: ECommandEvidence["conclusion"], { audit, canAudit, rollback, stillUnknown }: { audit: boolean; canAudit: boolean; rollback?: boolean; stillUnknown?: boolean }) {
  if (conclusion === "NOT_EXECUTED" && rollback) return `没有结案：${ROLLBACK_REFUSED}${stillUnknown ? "可以改选「仍未知」，只留一条核查记录。" : "请到操作记录与审批核对。"}`;
  const why = conclusion === "SUCCEEDED" ? audit ? "成功记录编号对不上这次操作，记录继续保留。核对编号后再提交。"
    : canAudit ? "没有成功记录编号，证明不了已执行，记录继续保留。填上编号后再提交。" : "后台的处理记录证明不了已执行，记录继续保留。重新查询原结果后再处理。"
    : conclusion === "REJECTED" ? "后台的记录不支持「后台拒绝」，记录继续保留。重新查询原结果，按查到的结论再结案。"
      : conclusion === "NOT_EXECUTED" ? "后台证明不了这次没有执行，记录继续保留。换一个有证据的结论再提交。"
        : "这条原操作已经有结果，记录继续保留。重新查询原结果，按查到的结论再结案。";
  return `没有结案：${why}`;
}

/** 结案框里「首次提交」一栏的时间，带时区（和面板展开后的发出时间同一个写法）。 */
export function closureTime(createdAt: number) {
  return `${formatBusinessTimeCompact(new Date(createdAt).toISOString(), "—")}（${businessZone().label}）`;
}

/** 没选结论时的示例占位：不给某一个结论专用的例子。 */
export const CLOSURE_PLACEHOLDER = "写明核对了什么、在哪看到的";
export const CLOSURE_PLACEHOLDER_BY: Partial<Record<ECommandEvidence["conclusion"], string>> = {
  REJECTED: "写明核对了什么，例如：查询原结果是后台拒绝，操作记录里没有这次的成功记录",
  SUCCEEDED: "写明核对了什么、在哪看到的，例如：操作记录里 10:42 这次操作的成功记录",
};
export const CLOSURE_ACK = "我已核对依据，知道提交后不能撤销或改结论";

/**
 * 调用方直接给的结论列表，替代 closureKnown 推出的组合（A6、A7 回滚核查，J4 恢复核对等同类能力）。
 * success：「已执行」凭什么——receipt 原回包（不填编号）、audit 成功记录编号。
 * 「未执行」在这类范围只在后台核实整次修改已回滚时才收；回执看不出有没有回滚，收不收提交了才知道。
 */
export type ClosureOffer = import("@/lib/admin/e-command-investigation").ECommandClosureOffer;
const ROLLBACK_REFUSED = "后台没有核实到这次修改已整个回滚，记录继续保留。";
export const ROLLBACK_HELP = "收了记录解除，可以重新发起；不收时记录保留。";
/** 按调用方给的结论写结案框顶上那句；有「未执行」时不说成一定能结。 */
export function offerNotice(offer: ClosureOffer) {
  const has = (value: ECommandEvidence["conclusion"]) => offer.conclusions.includes(value);
  if (has("NOT_EXECUTED")) return `后台核实这次修改已整个回滚，才会按「未执行」结案；收不收提交后才知道。${has("STILL_UNKNOWN") ? "也可以选「仍未知」，只留一条核查记录。" : ""}`;
  if (has("REJECTED")) return "后台当时拒绝了这次操作，可以按「后台拒绝」结案。";
  if (has("SUCCEEDED")) return offer.success === "audit" ? "成功记录对得上才解除，对不上会退回，记录保留。" : "后台按这次操作自己的处理记录核对：对得上才解除，对不上会退回，记录保留。";
  return has("STILL_UNKNOWN") ? "后台没有能对上的结论，现在只能记为「仍未知」。" : "这条现在结不了案：后台没有能对上的结论，记录继续保留。请把原请求编号交给技术同事核对。";
}

/** 核查确认是后台拒绝之后的一句：记录解除了，但不等于没执行，也不能重发原来那一次。 */
export const SETTLED_REJECTED = "核查确认是后台拒绝，记录已解除；不等于没有执行，要重做请按现在的状态重新发起。";

/**
 * 面板标题：结果未知、在等审批、已有结论分开数，只写有的那几种。
 * open：查到了后台拒绝、已处理、记为失败，但记录还留着的（还要重试或核查结案），叫「还没结案」，不算结果未知。
 */
export function recoveryTitle(unknown: number, waiting = 0, ended = 0, open = 0) {
  return [unknown ? `${unknown} 项操作结果未知` : "", open ? `${open} 项${unknown ? "" : "操作"}还没结案` : "", waiting ? `${waiting} 项${unknown || open ? "" : "操作"}在等审批` : "",
    ended ? `${ended} 项${unknown || open || waiting ? "" : "操作"}已有结论` : ""].filter(Boolean).join("，");
}

/** 查到已解决的记录：一行轻提示，不占一张卡。 */
export function SettledLine({ label, text, action, onDismiss }: { label: ReactNode; text: string; action?: ReactNode; onDismiss?: () => void }) {
  return <p className="fund-settled" role="status">
    <CheckCircle2 size={14} aria-hidden />
    <span><b>{label}</b> {text}</span>
    {action}
    {onDismiss && <IconButton aria-label="关闭这条提示" onClick={onDismiss}><X size={14} aria-hidden /></IconButton>}
  </p>;
}

/** 标题列放不下时末尾是省略号：悬停看全文；被截断的，展开后第一行写全（.fund-row-full）。 */
export function fullTitle(element: HTMLSpanElement | null) {
  if (!element) return;
  element.title = element.textContent ?? "";
  element.toggleAttribute("data-truncated", element.scrollWidth > element.clientWidth);
}

export type RecoveryItem = {
  key: string;
  /** 操作和对象，一行写得下。 */
  object: ReactNode;
  /** 发出时间：两分钟内发出的新记录排到最前（见 useFreshFirst）。 */
  createdAt?: number;
  /** 状态标签（StatusTag），六个字以内。 */
  tag: ReactNode;
  /** 紧跟标签的一句结论：这条现在怎样、下一步做什么。 */
  line: string;
  /** 查询后的结论：有就替换收起时的标签和那句话，不用展开才看得到。 */
  result?: { tag: ReactNode; line: string };
  /** 最近一次查询的回答；回答变了这一行自动展开。 */
  note?: ReactNode;
  /** note 不是纯文字时用它判断回答变没变。 */
  noteKey?: string;
  actions?: ReactNode;
  /** 展开后显示：发出时间、较长的说明。 */
  detail?: ReactNode;
  /** 原请求和原请求编号，放在展开内容的最后。 */
  tech?: ReactNode;
};

/**
 * 结果未知、待审批这类记录的通用面板，和资金页的面板同一个样子（同一组 fund-* 类）：设备域、账户操作、客服组管理用它。
 * 一行标题加问号里的通用说明；每条一行（箭头和对象、状态标签、一句结论、右侧按钮），点行首箭头看细节；默认露三条。
 */
export function RecoveryPanel({ title, explain, explainLabel = "这些记录怎么处理", foot, items, tone = "warn", label = "结果未知的操作" }: {
  title: ReactNode; explain?: ReactNode; explainLabel?: string; foot?: ReactNode; items: readonly RecoveryItem[]; tone?: StateTone; label?: string;
}) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string[]>([]);
  const { ordered, box } = useFreshFirst(items);
  const seen = useRef<Record<string, string>>({});
  const answers = items.map(item => [item.key, typeof item.note === "string" ? item.note : item.noteKey ?? ""] as const);
  useEffect(() => {
    const fresh = answers.filter(([key, answer]) => answer && seen.current[key] !== undefined && seen.current[key] !== answer).map(([key]) => key);
    seen.current = Object.fromEntries(answers);
    if (fresh.length) setOpen(keys => [...new Set([...keys, ...fresh])]);
  });
  if (!items.length) return null;
  const shownItems = all ? ordered : ordered.slice(0, 3);
  return <div ref={box}><Notice tone={tone} title={<>{title}{explain && <Explain label={explainLabel} content={explain} />}</>}>
    <ul className="fund-rows" aria-label={label}>{shownItems.map(item => {
      const expanded = open.includes(item.key);
      const id = `recovery-row-${item.key.replace(/[^A-Za-z0-9_-]/g, "-")}`;
      return <li key={item.key} className="fund-row">
        <div className="fund-row-line">
          <button type="button" className="fund-row-toggle" aria-expanded={expanded} aria-controls={id}
            onClick={() => setOpen(keys => expanded ? keys.filter(key => key !== item.key) : [...keys, item.key])}>
            <ChevronRight className="fund-row-chevron" size={14} aria-hidden /><span className="fund-row-title" ref={fullTitle}>{item.object}</span>
          </button>
          {item.result?.tag ?? item.tag}
          <span className="fund-row-text">{item.result?.line ?? item.line}</span>
          <span className="fund-row-actions">{item.actions}</span>
        </div>
        {expanded && <div className="fund-row-detail" id={id}><p className="fund-row-full">{item.object}</p>{item.detail}{item.note && <div role="status">{item.note}</div>}{item.tech}</div>}
      </li>;
    })}</ul>
    {(items.length > 3 || foot) && <div className="fund-rows-foot">
      {items.length > 3 && <Button size="sm" variant="ghost" aria-expanded={all} onClick={() => setAll(value => !value)}>{all ? "只看前 3 条" : `展开全部 ${items.length} 条`}</Button>}
      {foot}
    </div>}
  </Notice></div>;
}
