import type { StateTone } from "@/app/components/rd";
import type { ECommandInvestigation } from "@/lib/admin/e-command-investigation";
import { SETTLED_REJECTED, receiptExplain, receiptRejected, rejectedStatus } from "../recovery-panel";

/**
 * J2、J3 结果未知记录查到结论后的说法。
 * 「已处理」看不出原修改生没生效；新后端带业务结果时，被拒的另算一档「后台拒绝」（不等于没执行）。
 * 两种都保留记录：24 小时内按原请求重试会原样返回当初的结果，过期后由有调查权限的超级管理员核查结案。
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
export function processedStatus({ expired, canRetry, canClose, legacy, receipt }: { expired: boolean; canRetry: boolean; canClose: boolean; legacy?: boolean; receipt?: ECommandInvestigation | null }): { tone: StateTone; label: string; line: string; more?: string } {
  const more = receiptExplain(receipt);
  if (receiptRejected(receipt)) return { ...rejectedStatus({ expired, canRetry, canClose, legacy }), more };
  const line = !expired && canRetry ? "后台已处理，看不出成没成；按原请求重试可确认，不会重复执行。"
    : expired ? canClose ? "后台已处理，看不出成没成；已过 24 小时，请核查结案。" : "后台已处理，看不出成没成；请有调查权限的超级管理员核查结案。"
      : legacy ? "后台已处理，看不出成没成；旧记录过 24 小时后可核查结案。"
        : "后台已处理，看不出成没成；请有操作权限的人按原请求重试确认。";
  return { tone: "warn", label: "已处理", line, more };
}

/** 修改框里查到「已处理」时的一句；后台拒绝的另说。 */
export const PROCESSED_IN_DIALOG = "后台已处理这次请求，看不出成没成；点「按原请求重试」会返回当初的结果，不会重复执行。";
export const REJECTED_IN_DIALOG = "后台当时拒绝了这次请求，不保证没有改动；点「按原请求重试」会返回当初的拒绝原因，不会重复执行。";
