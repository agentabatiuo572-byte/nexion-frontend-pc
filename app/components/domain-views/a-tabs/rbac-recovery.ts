import type { StateTone } from "@/app/components/rd";
import type { DirectCommandReceiptState } from "@/lib/admin/direct-command-receipt";
import { eCommandCanConcludeRejected, eCommandClosureRequests, type ECommandEvidence, type ECommandInvestigation } from "@/lib/admin/e-command-investigation";
import { SETTLED_REJECTED, closureLine, receiptExplain, rejectedStatus } from "../recovery-panel";

/**
 * A6、A7 直写记录「查询原结果」后留在这一行的结论（记录还保留时）。
 * state 是最小状态（ERROR＝这次没查成）；receipt 是被拒时再读的详细结果，没读到是 undefined。
 */
export type RbacOutcome = { state: DirectCommandReceiptState | "ERROR"; receipt?: ECommandInvestigation | null };

/** Available requests, not a guarantee of closure: only the server can verify the rollback marker. */
export function rbacClosureConclusions(outcome: RbacOutcome | undefined, expired: boolean): ECommandEvidence["conclusion"][] {
  return eCommandClosureRequests(outcome?.receipt, expired).conclusions;
}

/** 这一行的标签和一句话。句子沿用共用恢复面板定稿的说法（rejectedStatus、A4 同类行）。 */
export function rbacOutcomeView(outcome: RbacOutcome, { expired, canRetry, canClose }: { expired: boolean; canRetry: boolean; canClose: boolean }): { tone: StateTone; label: string; line: string; more?: string } {
  const { state, receipt } = outcome;
  if (state === "REJECTED") {
    // 只有原回包是后台拒绝的（eCommandCanConcludeRejected）过期后能按「后台拒绝」结案；别的被拒没有结案这条路。
    const closable = !!receipt && eCommandCanConcludeRejected(receipt);
    if (!expired || closable) return { ...rejectedStatus({ expired, canRetry, canClose }), more: receiptExplain(receipt) };
    return { tone: "warn", label: "后台拒绝", line: receipt ? "后台拒绝了，不保证没有改动；已过 24 小时，到操作记录与审批核对。" : "后台拒绝了，不保证没有改动；详细结果没读到，稍后再查询。" };
  }
  if (state === "PROCESSING") return { tone: "progress", label: "还在执行", line: "稍后再查，执行完之前不要重试。" };
  // 仍未知、过期的记为失败：读到详细结果时按结案框能选的结论说（这一行没有技术信息，结不了案时交操作和提交时间）。
  const step = receipt ? closureLine(eCommandClosureRequests(receipt, expired), receipt, canClose, "这条的操作和提交时间") : undefined;
  if (state === "UNKNOWN") return { tone: "warn", label: "仍未知", line: step ?? (expired ? "系统也没有结果；已过 24 小时，到操作记录与审批核对。" : "系统也没有结果；24 小时内可以按原请求重试。") };
  // 查询成功、原操作记为失败：只有过期的会留在这里（24 小时内的查到失败即解除）。
  if (state === "FAILED" && expired && step) return { tone: "neutral", label: "记为失败", line: step };
  if (state === "NOT_FOUND") return { tone: "warn", label: "没有查到", line: expired ? "查不到不等于没执行，到操作记录与审批核对，不要另做一次。" : "查不到不等于没执行；按原请求重试不会重复执行。" };
  return { tone: "danger", label: "查询失败", line: "这不代表没执行，记录保留，稍后再查。" };
}

/** 按详细结果解除记录后的一句轻提示。A6 新建、改资料、启停被拒时后端证明整次修改已回滚，才说「没有生效」。 */
export function rbacSettledText(receipt: ECommandInvestigation) {
  if (receipt.originalStatus === "CONFIRMED_REJECTED") return SETTLED_REJECTED;
  if (receipt.originalStatus === "CONFIRMED_SUCCEEDED") return "核查确认已执行，记录已解除，不要再做一次。";
  if (receipt.originalStatus === "CONFIRMED_NOT_EXECUTED") return "查到原结果：没有执行，记录已解除。";
  if (receipt.originalStatus === "FAILED") return "查到原结果：后台拒绝了，没有生效，记录已解除。";
  return "原操作已执行，记录已解除，不要再做一次。";
}
