"use client";
/**
 * 客服业绩额（客户入金 − 客户提现，只算 USDT）的显示形状和小件。
 * 显示件只认「有哪些东西、什么状态」，不认后端字段名：接线（perf-wiring.ts）把后端合同映射成这里的形状；
 */
import { amountDisplay } from "@/lib/format";

/** 一个业绩金额：核完了写数；没核完写已核小计和缺什么；读不到、不可用写「—」和原因。 */
export type PerfValue =
  | { state: "complete"; value: string }
  | { state: "partial"; observed: string | null; missing: string }
  | { state: "unavailable"; reason: string };
/** 一个人数，状态同上。 */
export type PerfCount =
  | { state: "complete"; value: number }
  | { state: "partial"; observed: number | null; missing: string }
  | { state: "unavailable"; reason: string };

/** 新口径还没有能用的数据时（接线前、后端回滚、还没发布新的一版）写这一句，不拿旧的「净贡献」顶替。 */
export const PERF_UNAVAILABLE = "业绩数据暂不可用";
export const PERF_UNAVAILABLE_VALUE: Extract<PerfValue, { state: "unavailable" }> = { state: "unavailable", reason: PERF_UNAVAILABLE };

/** 公开榜和各处汇总共用的三项：业绩额、入金合计、提现合计。 */
export type PerfTotals = { amount: PerfValue; inflow: PerfValue; withdrawal: PerfValue };

export function perfText(value: PerfValue): string {
  return value.state === "complete" ? amountDisplay(value.value) : "—";
}
export function perfCountText(value: PerfCount): string {
  return value.state === "complete" ? value.value.toLocaleString("en-US") : "—";
}
/** 没核完时第二行写的已核小计；没有已核小计时只写缺什么。 */
export function perfObservedText(value: PerfValue, unit = ""): string | undefined {
  if (value.state !== "partial") return undefined;
  return value.observed === null ? value.missing : `已核 ${amountDisplay(value.observed)}${unit} · ${value.missing}`;
}
/** 表格金额格第二行：入金和提现合计；没核完写已核小计；不可用写原因。 */
export function perfFlowText(totals: PerfTotals): string {
  const { amount, inflow, withdrawal } = totals;
  // 「没核完」全页一个说法：「待核」；「暂不可用」只留给旧后端（新口径还没有能用的数据）。
  if (amount.state === "unavailable") return amount.reason === PERF_UNAVAILABLE ? "暂不可用" : amount.reason === "数据正在升级" ? amount.reason : "待核";
  if (amount.state === "partial") return amount.observed === null ? "待核" : `已核 ${amountDisplay(amount.observed)} · 待核`;
  return `入金 ${perfText(inflow)} · 提现 ${perfText(withdrawal)}`;
}
/** 读屏和悬停用的完整说法。 */
export function perfNote(value: PerfValue): string | undefined {
  return value.state === "complete" ? undefined : value.state === "partial" ? perfObservedText(value) : value.reason;
}

/* ---------------- 客服工作台 ---------------- */

/** 期间业绩里的一行入金渠道；sub 是缩进、弱字的「其中本期更正」。 */
export type PerfChannel = { label: string; value: PerfValue; sub?: boolean };
/** 期间业绩里的一行提现网络。 */
export type PerfWithdrawal = { label: string; walletDebited: PerfValue; fee: PerfValue; received: PerfValue };
/** 所选月份本人（或所选范围）的期间业绩。 */
export type PeriodPerf = {
  totals: PerfTotals;
  first: PerfCount;
  /** 期间首充里充值、购机各几位。 */
  firstSplit?: { deposits: number; purchases: number };
  inflow: PerfChannel[];
  withdrawals: PerfWithdrawal[];
};
/** 业绩额明细里的一笔。业务金额带它自己的币种；原币不是 USDT 的写 null，类别第二行写清去导出里看。 */
export type PerfEvent = { id: string; at: string; customer: string; customerNo: string; kind: string; detail: string; business: string | null; delta: string | null };
/** 业绩额明细：合计、现在名下能看的、已转走只给小计。 */
export type PerfEvents = {
  from: string; to: string;
  total: { amount: PerfValue; count: PerfCount; customers: PerfCount };
  visible: { amount: PerfValue; count: PerfCount; customers: PerfCount };
  restricted: { amount: PerfValue; count: PerfCount; customers: PerfCount };
  rows: PerfEvent[];
};
/** 客服工作台一次读取里各处要用的业绩额。缺哪项写哪项的不可用，不拿旧的「净贡献」顶替。 */
export type AnalyticsPerf = {
  /** 我的数据：期间业绩。 */
  period: PeriodPerf | { unavailable: string };
  /** 我的数据：业绩额明细。 */
  /** 客户表：这位客户自起算点以来的累计业绩额（跟着客户走）。 */
  customers: Record<string, PerfValue>;
  /** 客服表：这位客服现在的客户的累计业绩额。 */
  agents: Record<string, PerfValue>;
  /** 「查看统计」抽屉：这位客服所选月份的期间业绩额（按发生时归属）。接口给出按客服的期间业绩额后由 analyticsPerf 填；缺时抽屉写「—」和原因。 */
  agentPeriods?: Record<string, PerfValue>;
  /** 组卡：这个月按发生时所在组算的业绩额，和组里现在的客户的累计。 */
  groups: Record<string, { period: PerfValue; current: PerfValue }>;
  /** 经营概况：所选范围这个月的三项合计和现在的客户的累计。 */
  scope: { period: PerfTotals; current: PerfValue };
  /** 只有超级管理员才有：不在负责组里的业绩。 */
  attribution?: { unassigned: PerfValue; unknown: PerfValue };
};

/* ───────── 导出（第二批）：导出确认框、导出记录、审批 ───────── */

export type ExportType = "SUMMARY" | "CUSTOMER_DETAIL" | "TRANSACTION_DETAIL";
export const EXPORT_LABEL: Record<ExportType, string> = { SUMMARY: "业绩汇总", CUSTOMER_DETAIL: "客户明细", TRANSACTION_DETAIL: "逐笔记录" };
export const EXPORT_TYPES: readonly ExportType[] = ["SUMMARY", "CUSTOMER_DETAIL", "TRANSACTION_DETAIL"];
/** 一份文件的列：总数、问号里的分组列数、展开看的真实列名（预检回来的，或提交时冻结的）。 */
export type ExportColumns = { total: number; summary: string; groups: { name: string; columns: string[] }[] };
/** 一项这次检查的结果。只有 ok 能勾；其余打不了勾，原因写在这一项下面。 */
export type ExportCheck =
  /** rows 为 null：新的一版没核完，不写行数。note：部分覆盖时缺什么、文件里怎么写（灰字）。 */
  | { state: "ok"; rows: number | null; note?: string }
  | { state: "checking" }
  /** 这个月没有记录（灰字，不是警告）。 */
  | { state: "empty"; text: string }
  /** 没加载出来（红字，旁边「重试」只重查这一项）。 */
  | { state: "failed"; text: string }
  /** 行数或导出文件过大。后端两种情况用同一原因码。 */
  | { state: "over"; limitKind: "rows" | "file"; rows: number; text: string }
  /** 页面那一版刷新没成功：照写那一版检查过的行数，但不能选。 */
  | { state: "stale"; rows: number | null }
  /** 这一版这一项不能导出（新的一版没核完、数据升级中）：灰字写原因，不给重试；只有真读取失败才是 failed。 */
  | { state: "unavailable"; text: string };
/** anonymous：文件里有一行匿名小计（看不到明细的记录合在一起）。 */
export type ExportItem = { type: ExportType; grain: string; limit: number; columns: ExportColumns; check: ExportCheck; anonymous?: boolean };
export type ExportChoice = { value: string; label: string };
/** 导出确认框要的全部内容。月份、范围只有一个合法选项时写成只读值。 */
export type ExportDialogData = {
  months: ExportChoice[]; month: string; since: string;
  scopes: (ExportChoice & { types: ExportType[] })[]; scope: string;
  /** 统计截至，写到分钟（业务时区），时区由页面写。 */
  asOf: string;
  downloader: string;
  /** 这个账号能导出的几项；没有权限的不在里面（OP-124）。 */
  items: ExportItem[];
  /** 打开时默认勾的项。 */
  selected: ExportType[];
  /** 整框暂时不能申请的原因（页面那一版刷新没成功、数据升级中）。 */
  blocked?: string;
  minReasonChars: number; maxReasonChars: number;
};
export type ExportQuery = { month: string; scope: string; types: ExportType[] };
export type ExportSubmitted = Pick<ExportTask, "type" | "taskId" | "state" | "rows" | "canDownload" | "mine" | "decidedBy" | "decidedAt" | "failure">;

export type ExportTaskState = "PENDING_GENERATION" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "WITHDRAWN" | "READY" | "FAILED" | "EXPIRED";
/** 导出记录里的一条。scope、month、rows 为 null 时这些现在看不到（申请人已没有这个范围）。 */
export type ExportTask = {
  taskId: string; version: number; type: ExportType;
  /** 申请人姓名；requesterRole 是括号里的角色。mine：是不是当前账号提交的。 */
  requester: string; requesterRole: string; mine: boolean;
  scope: string | null; month: string | null; asOf: string | null;
  rows: number | null; columns: ExportColumns;
  coverage: string | null; requestReason: string; requestedAt: string;
  state: ExportTaskState;
  /** 批准或驳回的人、时间、理由。 */
  decidedBy?: string; decidedAt?: string; decisionReason?: string;
  /** 已生成但现在不能下载、批准后生成失败这类原因。 */
  failure?: "GENERATE_FAILED" | "SCOPE_LOST_BEFORE_GENERATE" | "SCOPE_HIDDEN";
  canDownload: boolean; canApprove: boolean; canReject: boolean; canWithdraw: boolean;
  /** 批准不了的原因（只管批准，驳回另判，6j）。 */
  approveBlocked?: string;
  /** 申请人已没有这个范围（6l）。 */
  scopeLost?: boolean;
};
/** 批准、驳回没收到结果时记下的原操作（OP-91–96）。 */
export type ExportOriginal = { operationId: string; createdAt: number; expiresAt: number };
export type ExportDraft = { reason: string; query: ExportQuery };
export type PendingSubmit = ExportDraft & ExportOriginal & { acceptedRequestId?: string };
export type PendingDecision = ExportOriginal & { taskId: string; decision: "APPROVE" | "REJECT" | "WITHDRAW"; reason?: string; at: string; objectHidden?: boolean };
/** 查询原操作的几种结果。 */
export type DecisionLookup =
  | { kind: "matched"; task: ExportTask; text: string }
  | { kind: "mismatch" | "pending" | "failed" | "expired" | "cleared" | "hidden"; text: string }
  | { kind: "not-received"; text: string };
/** 这个账号在导出上能做什么。views 只有一个时不画分段。 */
export type ExportPersona = { name: string; canExport: boolean; exportBlocked?: string; views: ("MINE" | "APPROVALS")[] };

export type SubmitLookup =
  | { kind: "matched"; rows: ExportSubmitted[] }
  | { kind: "partial"; requestId: string; rows: ExportSubmitted[] }
  | { kind: "pending"; expired: boolean }
  | { kind: "cleared"; draft: ExportDraft }
  | { kind: "missing" };

export type ExportDownload =
  | { kind: "downloaded" }
  | { kind: "expired" | "forbidden" | "retry" | "unconfirmed"; task?: ExportTask; permissionDenied?: boolean };

export interface PerfExportPorts {
  persona: ExportPersona;
  invalidateAccess(): void;
  open(initial?: { month?: string; scope?: string }): Promise<ExportDialogData>;
  check(query: ExportQuery): Promise<Pick<ExportDialogData, "items" | "asOf" | "blocked">>;
  submit(query: ExportQuery, reason: string): Promise<ExportSubmitted[]>;
  pendingSubmit(): PendingSubmit | undefined;
  recoveredSubmit(): ExportDraft | undefined;
  recoveredDecision(taskId: string, decision: PendingDecision["decision"]): string | undefined;
  subscribePending(update: () => void): () => void;
  lookupSubmit(): Promise<SubmitLookup>;
  tasks(view: "MINE" | "APPROVALS", page: number, pageSize: number, signal?: AbortSignal): Promise<{ rows: ExportTask[]; total: number }>;
  task(taskId: string): Promise<ExportTask>;
  decide(task: ExportTask, decision: "APPROVE" | "REJECT", reason: string): Promise<ExportTask>;
  lookupDecision(pending: PendingDecision): Promise<DecisionLookup>;
  withdraw(task: ExportTask, reason: string): Promise<ExportTask>;
  download(taskId: string): Promise<ExportDownload>;
  pendingDecisions(): PendingDecision[];
}

/** 两段状态：审批段和文件段。只有文件已生成且本人现在能取件时才写「可下载」。 */
export function exportStatus(task: ExportSubmitted): { tone: "ok" | "warn" | "progress" | "neutral" | "done" | "danger"; label: string; line: string } {
  switch (task.state) {
    case "PENDING_GENERATION": return { tone: "progress", label: "待生成", line: "文件还在等待生成" };
    case "PENDING_APPROVAL": return { tone: "warn", label: "待审批", line: task.mine ? "等另一位有审批权的管理员审批" : "等你审批" };
    case "APPROVED": return task.failure === "GENERATE_FAILED" ? { tone: "danger", label: "已批准，执行失败", line: `${task.decidedAt ? `${task.decidedAt} ` : ""}批准，文件没生成出来` }
      : { tone: "progress", label: "已批准", line: "文件生成中，生成好才能下载" };
    case "READY": return task.canDownload ? { tone: "ok", label: "可下载", line: "CSV 文件" } : { tone: "neutral", label: "已生成", line: "你现在不能下载" };
    case "REJECTED": return { tone: "neutral", label: "已驳回", line: "审批人驳回，理由见详情" };
    case "WITHDRAWN": return { tone: "done", label: "已撤回", line: task.mine ? "你撤回的" : "申请人撤回的" };
    case "EXPIRED": return { tone: "neutral", label: "已过期", line: "文件已过保留期，不能再下载" };
    case "FAILED": return { tone: "danger", label: task.decidedAt ? "已批准，执行失败" : "生成失败", line: "文件没生成出来" };
  }
}

export function exportReceiptSummary(rows: readonly ExportSubmitted[]) {
  return "已查到这次提交，" + rows.map(row => `${EXPORT_LABEL[row.type]}：${exportStatus(row).label}`).join("，") + "。";
}

/** 原批已受理但现在只看得到一部分结果：原批算未结案，原操作保留。 */
export const EXPORT_PARTIAL_RECEIPT = "这次提交已受理，还没核对完；原操作保留，可以再查询。";
export function exportVisibleReceiptSummary(rows: readonly ExportSubmitted[]) {
  return rows.length ? "你现在看得到的：" + rows.map(row => `${EXPORT_LABEL[row.type]}${exportStatus(row).label}`).join("、") + "。" : "你现在看不到这次提交的结果。";
}

export function exportDownloadMessage(kind: Exclude<ExportDownload["kind"], "downloaded">) {
  switch (kind) {
    case "expired": return "文件已过保留期，不能重新获取。";
    case "forbidden": return "你现在没有这份文件的下载权限。";
    case "retry": return "可重新获取同一份文件的下载链接。";
    case "unconfirmed": return "暂时无法确认文件状态，请重新读取导出记录。";
  }
}

/** 写操作没收到结果（断网、超时、回包读不出来）。名字以 OutcomeUnknownError 结尾，共用确认框按「结果未知」写橙黄、不当成失败。 */
export class ExportOutcomeUnknownError extends Error {
  constructor(message: string) { super(message); this.name = "ExportOutcomeUnknownError"; }
}
