import type { A2OperationRow } from "./a2-client";
import { approvalQueueChange, approvalTitleParts } from "./a2-approval-text";

/** 首页、消息中心和审批页队列共用：对象只在动作和变更里都没写、也不是认不出的系统键（current、配置键）时才写。 */
export function approvalShownObject(ticket: A2OperationRow) {
  const { objectId } = approvalQueueChange(ticket);
  const { object, objectInAction } = approvalTitleParts(ticket);
  return object && object !== "—" && !objectInAction && object !== objectId && (object !== ticket.obj || !!ticket.objDisplayName) ? object : undefined;
}

/** 首页和消息中心沿用队列的两行文字，对象在动作或变更中已明确时只写一次。 */
export function approvalChangeSummary(ticket: A2OperationRow) {
  const { main, sub } = approvalQueueChange(ticket);
  const object = approvalShownObject(ticket);
  const change = sub ? `${main}（${sub}）` : main;
  return object ? `${object} · ${change}` : change;
}
