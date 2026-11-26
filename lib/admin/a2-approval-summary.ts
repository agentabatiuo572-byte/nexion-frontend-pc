import type { A2OperationRow } from "./a2-client";
import { approvalQueueChange, approvalTitleParts } from "./a2-approval-text";

/** 首页和消息中心沿用队列的两行文字，对象在动作或变更中已明确时只写一次。 */
export function approvalChangeSummary(ticket: A2OperationRow) {
  const { main, sub, objectId } = approvalQueueChange(ticket);
  const { object, objectInAction } = approvalTitleParts(ticket);
  const change = sub ? `${main}（${sub}）` : main;
  return object && object !== "—" && !objectInAction && object !== objectId ? `${object} · ${change}` : change;
}
