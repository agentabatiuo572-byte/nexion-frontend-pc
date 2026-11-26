import { E1_SKU_FIELDS, e1NumericReviewValue, e1ReviewValue } from "@/app/components/domain-views/e-tabs/e1-state";
import type { A2OperationRow } from "./a2-client";
import { a2ObjectText } from "./operator-copy";
import { D5_APPROVAL_OP } from "./trc20-closed";
import { withdrawalProposalChanges } from "./withdrawal-proposal-changes";

const SEE_APPROVAL_DETAIL = "请在审批详情核对";
const ACCOUNT_STATUS: Record<string, string> = { enabled: "启用", disabled: "停用" };
export const a2AccountStatusText = (value: string) => Object.hasOwn(ACCOUNT_STATUS, value) ? ACCOUNT_STATUS[value] : undefined;
const E1_APPROVAL_LABELS = new Map<string, string>(E1_SKU_FIELDS.map(({ key, label }) => [key, label]));
E1_APPROVAL_LABELS.set("dailyEarnNex", "日产 UVT");
E1_APPROVAL_LABELS.set("phoneDailyEarnNex", "手机每日收益 UVT");
E1_APPROVAL_LABELS.set("unlockPhase", "开放阶段");

function skuEditDetail(before: string, after: string) {
  try {
    const from: unknown = JSON.parse(before);
    const to: unknown = JSON.parse(after);
    if (!from || typeof from !== "object" || Array.isArray(from) || !to || typeof to !== "object" || Array.isArray(to)) return;
    const previous = from as Record<string, unknown>;
    const proposed = to as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(proposed), ...Object.keys(previous)])];
    const changes = keys.filter(key => E1_APPROVAL_LABELS.has(key)
      && JSON.stringify(e1ReviewValue(key, previous[key])) !== JSON.stringify(e1ReviewValue(key, proposed[key])));
    if (!changes.length) return;
    const key = changes[0];
    const label = E1_APPROVAL_LABELS.get(key);
    const oldValue = e1NumericReviewValue(key, previous[key]);
    const newValue = e1NumericReviewValue(key, proposed[key]);
    const summary = oldValue !== undefined && newValue !== undefined ? `${label} ${oldValue} → ${newValue}` : `${label}有变更`;
    return `${summary}${changes.length > 1 ? `，等 ${changes.length} 项` : ""}`;
  } catch {
    return undefined;
  }
}

// Keep short, readable business text on older cards. Structured data belongs in the approval detail.
const readableNote = (value: string) => value.length <= 120 && /[\u3400-\u9fff]/.test(value) && !/[\r\n{}]|^\[|\b\w+=/.test(value);

export function approvalChangeSummary(row: A2OperationRow) {
  if (row.operationCode === D5_APPROVAL_OP || (!row.operationCode && row.action === "放宽提现参数")) {
    const facts = withdrawalProposalChanges("D5", row)?.facts;
    if (!facts) return SEE_APPROVAL_DETAIL;
    const [first] = facts;
    return `${first.label} ${first.before} → ${first.after}${facts.length > 1 ? `，等 ${facts.length} 项` : ""}`;
  }
  if (row.operationCode === "e1_sku_update") return skuEditDetail(row.before, row.after) ?? SEE_APPROVAL_DETAIL;
  if (row.operationCode === "a1_account_status_update") {
    const before = a2AccountStatusText(row.before);
    const after = a2AccountStatusText(row.after);
    return before && after ? `${a2ObjectText(row)} · ${before} → ${after}` : SEE_APPROVAL_DETAIL;
  }
  if (readableNote(row.before) && readableNote(row.after)) return `${a2ObjectText(row)} · ${row.before} → ${row.after}`;
  if (row.before === "—" && row.after === "—" && readableNote(row.reason)) return `${a2ObjectText(row)} · ${row.reason}`;
  return SEE_APPROVAL_DETAIL;
}
