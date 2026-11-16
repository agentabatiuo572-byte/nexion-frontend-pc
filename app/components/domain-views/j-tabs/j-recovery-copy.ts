import type { StateTone } from "@/app/components/rd";

/**
 * J2、J3 结果未知记录查到结论后的说法。
 * 后端把正常返回的命令一律记成「已处理」（SUCCEEDED），业务拒绝也一样，所以「已处理」看不出原修改生没生效：
 * 记录保留，24 小时内按原请求重试会原样返回当初的结果，过期后由有调查权限的超级管理员核查结案。
 */
export const SETTLED_TEXT: Record<string, string> = {
  CONFIRMED_NOT_EXECUTED: "核查确认原修改没有执行，记录已解除，可以重新修改。",
  CONFIRMED_SUCCEEDED: "核查确认原修改已生效，记录已解除；页面显示的是现在的设置。",
};
export const SETTLED_OTHER = "后台已处理原请求，记录已解除；页面显示的是现在的设置。";

/** 回执是「已处理」、记录还没解除时这一行怎么说。 */
export function processedStatus({ expired, canRetry, canClose, legacy }: { expired: boolean; canRetry: boolean; canClose: boolean; legacy?: boolean }): { tone: StateTone; label: string; line: string } {
  const line = !expired && canRetry ? "后台已处理，看不出成没成；按原请求重试可确认，不会重复执行。"
    : expired ? canClose ? "后台已处理，看不出成没成；已过 24 小时，请核查结案。" : "后台已处理，看不出成没成；请有调查权限的超级管理员核查结案。"
      : legacy ? "后台已处理，看不出成没成；旧记录过 24 小时后可核查结案。"
        : "后台已处理，看不出成没成；请有操作权限的人按原请求重试确认。";
  return { tone: "warn", label: "已处理", line };
}

/** 修改框里查到「已处理」时的一句。 */
export const PROCESSED_IN_DIALOG = "后台已处理这次请求，看不出成没成；点「按原请求重试」会返回当初的结果，不会重复执行。";
