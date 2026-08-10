import type { B5Radar } from "@/lib/admin/b5-client";

type B5RiskLight = B5Radar["bankrun"]["light"] | "unavailable";
type B5WithdrawalState = B5Radar["withdrawBacklog"]["byState"][number]["state"];

const B5_RISK_LIGHT_LABELS = {
  green: "正常",
  yellow: "关注",
  red: "告警",
  unavailable: "不可计算",
} satisfies Record<B5RiskLight, string>;

const B5_WITHDRAWAL_STATE_LABELS = {
  submitted: "已提交",
  "review-passed": "审核通过",
  processing: "处理中",
} satisfies Record<B5WithdrawalState, string>;

function safeLabel<Key extends string>(
  labels: Record<Key, string>,
  value: unknown,
  fallback: string,
) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(labels, value)
    ? labels[value as Key]
    : fallback;
}

export function formatB5RiskLight(value: unknown) {
  return safeLabel(B5_RISK_LIGHT_LABELS, value, "未知");
}

export function formatB5WithdrawalState(value: unknown) {
  return safeLabel(B5_WITHDRAWAL_STATE_LABELS, value, "不可用");
}
