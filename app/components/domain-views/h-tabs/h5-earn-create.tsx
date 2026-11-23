"use client";

/**
 * H5 收益里程碑「新建档位」的确认框内容。新建一档要另一位超级管理员批准，批准后才加进业务表；批准前 App 里没有这一档。
 */
import { Fact, Facts, StatusTag } from "@/app/components/rd";
import { h5Amount } from "@/lib/admin/h5-contract";
import { displayAdminError } from "@/lib/admin/error-messages";
import { APP_VISIBLE_TEXT_HINT, appVisibleTextError } from "@/lib/admin/content-language-rules";
import { amountText, proposalAmountText, type EarnMilestone } from "./h5-parts";
import type { ActionConfirmReq } from "./types";

import { EARN_CREATE_TARGET, type H5Change } from "@/lib/admin/use-h5-mutations";

export { EARN_CREATE_TARGET };
const KEY_RULE = /^[A-Za-z0-9_-]{1,64}$/;
const MIN_THRESHOLD = BigInt(1000000);
const MAX_AMOUNT = BigInt("100000000000000");

/** The read model follows the backend's order: sortOrder, then threshold. */
function placeOf(list: readonly EarnMilestone[], threshold: bigint) {
  let previousThreshold: bigint | undefined;
  let index = 0;
  for (const item of list) {
    const amount = h5Amount(item.threshold);
    if (item.sortOrder === undefined || amount === undefined || amount === threshold
        || (previousThreshold !== undefined && amount <= previousThreshold)) return undefined;
    if (amount < threshold) index++;
    previousThreshold = amount;
  }
  const prev = list[index - 1], next = list[index];
  // The threshold breaks ties, so either neighboring order may be shared.
  const sortOrder = Math.max(0, prev?.sortOrder ?? next?.sortOrder ?? 1);
  if (next?.sortOrder !== undefined && sortOrder > next.sortOrder) return undefined;
  return { index: index + 1, prev, next, sortOrder };
}

function placeText(place: NonNullable<ReturnType<typeof placeOf>>) {
  const between = place.prev && place.next ? `排在 ${amountText(place.prev.threshold)} 和 ${amountText(place.next.threshold)} USDT 之间`
    : place.prev ? `排在最后，上一档 ${amountText(place.prev.threshold)} USDT` : place.next ? `排在最前，下一档 ${amountText(place.next.threshold)} USDT` : "这是第一档";
  return `第 ${place.index} 档，${between}`;
}

type EarnCreatePlacement = { message: string; field: string } | NonNullable<ReturnType<typeof placeOf>>;

function assessEarnCreate(list: readonly EarnMilestone[], values: Record<string, string>): EarnCreatePlacement {
  const key = values.milestoneKey.trim();
  if (!KEY_RULE.test(key)) return { field: "milestoneKey", message: "编号只能用字母、数字、- 和 _，最多 64 个字符" };
  if (list.some(item => item.key.toLowerCase() === key.toLowerCase())) return { field: "milestoneKey", message: `编号 ${key} 已经有了，换一个` };
  const label = values.label.trim();
  if (!label) return { field: "label", message: "请填写名称" };
  const labelError = appVisibleTextError(label, "名称");
  if (labelError) return { field: "label", message: labelError };
  if (label.length > 128) return { field: "label", message: "名称最多 128 个字符" };
  const threshold = h5Amount(values.threshold), reward = h5Amount(values.nex);
  if (threshold === undefined || threshold < MIN_THRESHOLD || threshold > MAX_AMOUNT) return { field: "threshold", message: "门槛为 1–100,000,000 USDT，最多 6 位小数" };
  if (list.some(item => h5Amount(item.threshold) === threshold)) return { field: "threshold", message: `已有 ${amountText(values.threshold)} USDT 这一档，换一个` };
  if (reward === undefined || reward > MAX_AMOUNT) return { field: "nex", message: "奖励为 0–100,000,000 UVT，最多 6 位小数" };
  return placeOf(list, threshold) ?? { field: "threshold", message: displayAdminError("EARN_MILESTONE_THRESHOLD_ORDER_INVALID") };
}

export function earnCreateRequest({ snapshot, approver, rights, runChange }: { snapshot: H5Change["snapshot"]; approver: string; rights: string; runChange: (change: H5Change) => Promise<void> }): ActionConfirmReq & { target: string } {
  const list = snapshot.earnMilestones;
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
      const filled = h5Amount(values.threshold ?? "") !== undefined && h5Amount(values.nex ?? "") !== undefined;
      return {
        impact: filled
          ? `批准后累计收益满 ${amountText(values.threshold)} USDT 的用户可在 App 成就页领 ${amountText(values.nex)} UVT；已满门槛的用户也能领。`
          : "批准后加上这一档，累计收益满门槛的用户可在 App 成就页领奖励；已满门槛的用户也能领。",
        check: "核对编号、门槛和奖励；理由写清依据或工单号。",
      };
    },
    coverageLead: "加一档会让平台多付 UVT",
    coverageCheck: "提交审批时和批准时都检查兑付覆盖率，低于红线或读不到都会被拒。",
    amplifies: true,
    confirmLabel: "提交审批",
    reasonPlaceholder: "例如：活动方案或工单号",
    businessForm: {
      kind: "multi-field",
      amplifies: () => true,
      feedback: values => {
        const placement = assessEarnCreate(list, values);
        return "message" in placement ? { invalid: true, ...placement }
          : { invalid: false, message: placeText(placement), field: "threshold" };
      },
      fields: [
        { key: "milestoneKey", label: "档位编号", inputKind: "text", current: "", placeholder: "例如 M6", help: "字母、数字、- 或 _，建好后不能改", maxLength: 64 },
        { key: "label", label: "名称", inputKind: "text", current: "", placeholder: "例如 Earn 500 USDT", help: `${APP_VISIBLE_TEXT_HINT}，最多 128 字`, maxLength: 128 },
        { key: "threshold", label: "门槛（累计收益 USDT）", inputKind: "number", current: "", placeholder: "例如 500", help: "最多 6 位小数，不能和现有的档相同" },
        { key: "nex", label: "奖励（UVT）", inputKind: "number", current: "", placeholder: "例如 250", help: "最多 6 位小数，可以是 0" },
      ],
    },
    run: async (reason, _value, form) => {
      if (!form) throw new Error("EARN_MILESTONE_AMOUNTS_REQUIRED");
      const placement = assessEarnCreate(list, form);
      if ("message" in placement) throw new Error(placement.message);
      const milestoneKey = form.milestoneKey.trim(), label = form.label.trim();
      const threshold = form.threshold.trim(), nex = form.nex.trim();
      const { sortOrder } = placement;
      await runChange({
        target: EARN_CREATE_TARGET, action: "收益里程碑 · 新建档位", name: `收益里程碑 · ${milestoneKey}`,
        before: "还没有", after: `${proposalAmountText(threshold)} USDT · ${proposalAmountText(nex)} UVT`,
        reason, success: "已提交审批", approvalRequired: true, snapshot,
        businessValue: { milestoneKey, label, threshold, nex },
        earnCreate: { milestoneKey, label, thresholdUsd: threshold, rewardNex: nex, sortOrder },
      });
    },
  };
}
