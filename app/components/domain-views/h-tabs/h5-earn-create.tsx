"use client";

/**
 * H5 收益里程碑「新建档位」的确认框内容。新建一档要另一位超级管理员批准，批准后才加进业务表；批准前 App 里没有这一档。
 * PLACEHOLDER(pc-wire)：后端新建命令还没做（hd-impl-x-lc-milestone），`run` 先拒绝，不发任何请求。
 * 接线时按后端契约补：命令名、请求体（编号、门槛、奖励，是否还要名称和排序）、审批单名称、原操作记录的恢复（restore 认 earn:new）。
 */
import { Fact, Facts, StatusTag } from "@/app/components/rd";
import { h5Amount } from "@/lib/admin/h5-contract";
import { amountText, type EarnMilestone } from "./h5-parts";
import type { ActionConfirmReq } from "./types";

export const EARN_CREATE_TARGET = "earn:new";
const KEY_RULE = /^[A-Za-z0-9_-]{1,64}$/;
const MIN_THRESHOLD = BigInt(1000000);
const MAX_AMOUNT = BigInt("100000000000000");

/** 新的一档排在第几档、夹在哪两档之间；门槛读不懂时返回 undefined。 */
function placeOf(list: readonly EarnMilestone[], threshold: string) {
  const value = h5Amount(threshold);
  if (value === undefined) return undefined;
  const after = list.filter(item => h5Amount(item.threshold)! < value);
  const prev = after.at(-1), next = list[after.length];
  return { index: after.length + 1, prev, next };
}

function placeText(list: readonly EarnMilestone[], threshold: string) {
  const place = placeOf(list, threshold);
  if (!place) return undefined;
  const between = place.prev && place.next ? `排在 ${amountText(place.prev.threshold)} 和 ${amountText(place.next.threshold)} USDT 之间`
    : place.prev ? `排在最后，上一档 ${amountText(place.prev.threshold)} USDT` : place.next ? `排在最前，下一档 ${amountText(place.next.threshold)} USDT` : "这是第一档";
  return `第 ${place.index} 档，${between}`;
}

export function earnCreateIssue(list: readonly EarnMilestone[], values: Record<string, string>): { message: string; field: string } | undefined {
  const key = values.milestoneKey.trim();
  if (!KEY_RULE.test(key)) return { field: "milestoneKey", message: "编号只能用字母、数字、- 和 _，最多 64 个字符" };
  if (list.some(item => item.key.toLowerCase() === key.toLowerCase())) return { field: "milestoneKey", message: `已经有编号 ${key} 的一档，换一个编号；要改它，到列表里点「调整」` };
  const threshold = h5Amount(values.threshold), reward = h5Amount(values.nex);
  if (threshold === undefined || threshold < MIN_THRESHOLD || threshold > MAX_AMOUNT) return { field: "threshold", message: "门槛为 1–100,000,000 USDT，最多 6 位小数" };
  if (list.some(item => h5Amount(item.threshold) === threshold)) return { field: "threshold", message: `已经有门槛 ${amountText(values.threshold)} USDT 的一档，门槛不能重复` };
  if (reward === undefined || reward > MAX_AMOUNT) return { field: "nex", message: "奖励为 0–100,000,000 UVT，最多 6 位小数" };
}

export function earnCreateRequest({ list, approver, rights }: { list: readonly EarnMilestone[]; approver: string; rights: string }): ActionConfirmReq & { target: string } {
  const existing = list.length ? `${list.length} 档：${list.map(item => amountText(item.threshold)).join("、")} USDT` : "还没有";
  return {
    target: EARN_CREATE_TARGET,
    briefKind: "config",
    action: "收益里程碑 · 新建档位",
    title: "新建收益里程碑",
    detail: <>新建一档要{approver}批准，批准后才加上。</>,
    effect: <StatusTag tone="progress" filled explain={`${approver}批准后才加上这一档，提交人不能批自己的；批准前 App 里没有这一档。`}>批准后生效</StatusTag>,
    facts: (
      <Facts>
        <Fact k="现有档位">{existing}</Fact>
        <Fact k="谁来批">{`${approver}，不能是提交人`}</Fact>
        <Fact k="需有权限">{rights}</Fact>
      </Facts>
    ),
    statedBrief: (values) => {
      const place = placeText(list, values.threshold ?? "");
      const threshold = h5Amount(values.threshold ?? "") !== undefined ? `${amountText(values.threshold)} USDT` : "门槛";
      const reward = h5Amount(values.nex ?? "") !== undefined ? `${amountText(values.nex)} UVT` : "奖励";
      return {
        impact: `批准后加一档：累计收益满 ${threshold} 的用户可以在 App 成就页领 ${reward}${place ? `；${place}` : ""}。已经满这个门槛的用户也能领。`,
        check: "核对编号、门槛和奖励；理由写清依据或工单号。",
      };
    },
    coverageLead: "加一档会让平台多付 UVT",
    coverageCheck: "批准时检查兑付覆盖率不低于红线，低于或算不准都拒绝。",
    amplifies: true,
    confirmLabel: "提交审批",
    reasonPlaceholder: "例如：活动方案或工单号",
    businessForm: {
      kind: "multi-field",
      amplifies: () => true,
      feedback: values => {
        const issue = earnCreateIssue(list, values);
        return issue ? { invalid: true, message: issue.message, field: issue.field } : { invalid: false, message: placeText(list, values.threshold) ?? "" , field: "threshold" };
      },
      fields: [
        { key: "milestoneKey", label: "档位编号", inputKind: "text", current: "", placeholder: "例如 M6", help: "字母、数字、- 或 _，建好后不能改", maxLength: 64 },
        { key: "threshold", label: "门槛（累计收益 USDT）", inputKind: "number", current: "", placeholder: "例如 500", help: "最多 6 位小数，不能和现有的档相同" },
        { key: "nex", label: "奖励（UVT）", inputKind: "number", current: "", placeholder: "例如 250", help: "最多 6 位小数，可以是 0" },
      ],
    },
    run: async () => {
      // PLACEHOLDER(pc-wire)：接后端新建命令，提交审批后写原操作记录、关框、重读。
      throw new Error("新建档位还没接上后台，这次没有提交。");
    },
  };
}
