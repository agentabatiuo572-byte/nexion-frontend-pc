import type { StateTone } from "@/app/components/rd";
import type { ECommandInvestigation } from "@/lib/admin/e-command-investigation";
import { SETTLED_REJECTED, receiptExplain, receiptRejected, rejectedStatus } from "../recovery-panel";
import { RETRY_REJECTED_NEXT } from "@/lib/admin/retry-rejected";

/**
 * J2、J3 结果未知记录查到结论后的说法。
 * 「已处理」看不出原修改生没生效；新后端带业务结果时，被拒的另算一档「后台拒绝」（不等于没执行）。
 * 两种都保留记录，下一步取决于该条记录当前可用的入口。
 */
export const SETTLED_TEXT: Record<string, string> = {
  CONFIRMED_NOT_EXECUTED: "核查确认原修改没有执行，记录已解除，可以重新修改。",
  CONFIRMED_SUCCEEDED: "核查确认原修改已生效，记录已解除；页面显示的是现在的设置。",
  CONFIRMED_REJECTED: SETTLED_REJECTED,
};
export const SETTLED_OTHER = "后台已处理原请求，记录已解除；页面显示的是现在的设置。";

/**
 * 回执是「已处理」、记录还没解除时这一行怎么说；查到的是后台拒绝（receipt）时换成「后台拒绝」那一档。
 * more 是展开后的说明，和资金页面板同一档的一样（receiptExplain）。
 */
export function processedStatus({ expired, canRetry, canClose, canRelease = false, canReachAudit, legacy, receipt }: {
  expired: boolean; canRetry: boolean; canClose: boolean; canRelease?: boolean; canReachAudit?: boolean; legacy?: boolean; receipt?: ECommandInvestigation | null;
}): { tone: StateTone; label: string; line: string; more?: string } {
  const more = receiptExplain(receipt);
  const rejected = receiptRejected(receipt);
  const label = rejected ? "后台拒绝" : "已处理";
  const result = rejected ? "后台拒绝了，不保证没有改动。" : "后台已处理，看不出成没成。";
  if (expired && canReachAudit !== undefined) {
    const next = canRelease ? RETRY_REJECTED_NEXT
      : canClose ? "可以核查结案。"
        : canReachAudit ? "请到操作记录与审批核对。" : "请有调查权限的超级管理员核查结案。";
    return { tone: "warn", label, line: `已超过 24 小时，不能再重试。${result}${next}`, more };
  }
  if (rejected && (legacy || canRetry && !expired)) return { ...rejectedStatus({ expired, canRetry, canClose, legacy }), more };
  if (legacy) {
    const next = expired ? canClose ? "已过 24 小时，请核查结案。" : "请有调查权限的超级管理员核查结案。"
      : "旧记录过 24 小时后可核查结案。";
    return { tone: "warn", label: "已处理", line: `后台已处理，看不出成没成；${next}`, more };
  }
  const next = canRelease ? RETRY_REJECTED_NEXT
    : canRetry && !expired ? "按原请求重试可确认，不会重复执行。"
      : canClose ? "可以核查结案。"
        : canReachAudit === false ? "请有调查权限的超级管理员核查结案。" : "请到操作记录与审批核对。";
  return { tone: "warn", label, line: `${result}${next}`, more };
}
