import type { A2OperationRow } from "./a2-client";
import { approvalQueueChange, objectText } from "./a2-approval-text";

/** 首页和消息中心沿用队列的两行文字，并省略变更主行中已出现的对象。 */
export function approvalChangeSummary(ticket: A2OperationRow) {
  const { main, sub } = approvalQueueChange(ticket);
  const object = objectText(ticket).trim();
  const change = sub ? `${main}（${sub}）` : main;
  return object && object !== "—" && !main.includes(object) ? `${object} · ${change}` : change;
}
