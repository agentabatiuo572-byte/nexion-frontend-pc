import { RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "./pending-mutation-store";
import { displayAdminError } from "./error-messages";

/** 重试被明确拒绝的状态名：恢复行标签、原框标题全站同一个叫法（DT-14）。 */
export const RETRY_REJECTED_LABEL = "重试被拒绝";
/** 重试被明确拒绝后的下一步（OP-93 第 8 条、OP-152）：恢复行写后半句，原框和禁用原因写整句，指的是恢复行上的「核实后解除」。 */
export const RETRY_REJECTED_NEXT = "先核实原操作的结果，再点「核实后解除」。";
export const RETRY_REJECTED_TEXT = `${RETRY_REJECTED_LABEL}。${RETRY_REJECTED_NEXT}`;
/** 原框里冻结的原请求：标题和行上的标签同名，下一步和行上同一句；过期写过期那一句，其余写先查询（能按原号查回执的页用）。 */
export const frozenTitle = (blocked: string | undefined, unknown: string) => blocked === RETRY_REJECTED_TEXT ? RETRY_REJECTED_LABEL : unknown;
export const frozenNextStep = (blocked: string | undefined, query = "先查询原操作") =>
  blocked === RETRY_REJECTED_TEXT ? RETRY_REJECTED_NEXT : blocked === RETRY_EXPIRED_TEXT ? blocked : `${query}；明确查不到、没过 24 小时，才能按原操作重试，不会重复执行。`;
/** 共用恢复面板上这一行的标签和那句话；查到了原结果或查询失败时，用查到的。 */
export const RETRY_REJECTED_STATUS = { tone: "danger" as const, label: RETRY_REJECTED_LABEL, line: RETRY_REJECTED_NEXT };

export function replayRejectionText(record: Pick<PendingMutationRecord, "replayRejection">) {
  return record.replayRejection
    ? `${RETRY_REJECTED_LABEL}：${displayAdminError(record.replayRejection)} ${RETRY_REJECTED_NEXT}`
    : undefined;
}
