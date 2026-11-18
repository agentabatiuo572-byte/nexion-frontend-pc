/**
 * 提现状态的叫法，提现审核（D2）和用户详情（C1D）共用一份。
 * 筛选项和流转图用 WITHDRAWAL_STATUS_TABS、WITHDRAWAL_STATUS_CN；单条记录用 withdrawalRecordLabel，按链区分银行打款和 ERC20 丢失确认。
 * 后端的旧状态码（PENDING、SUCCESS 这些）和新码写同一个名字。颜色各页按用途自己定。
 */
export const WITHDRAWAL_STATUS_TABS = [
  ["", "全部"], ["SUBMITTED", "已提交"], ["REVIEW_PENDING", "待审核"], ["EXTENDED_HOLD", "冷却中，等待复查"], ["FROZEN", "冻结"],
  ["REVIEW_PASSED", "已放行"], ["PROCESSING", "处理中"], ["SENT", "银行处理中 / 已发出"], ["CONFIRMED", "已确认"],
  ["REVIEW_REJECTED", "审核拒绝"], ["ADDRESS_INVALID", "地址无效"], ["TX_FAILED", "打款失败"], ["TX_ORPHANED", "打款异常，需人工核对"], ["REFUNDED", "已退款"],
] as const;

export const WITHDRAWAL_STATUS_CN: Record<string, string> = Object.fromEntries(WITHDRAWAL_STATUS_TABS.filter(([code]) => code).map(([code, label]) => [code, label]));

export function withdrawalStatusLabel(status: string) {
  return ({
    SUBMITTED: "已提交", PENDING: "已提交",
    REVIEW_PENDING: "待审核", REVIEWING: "待审核",
    EXTENDED_HOLD: "冷却中，等待复查", DELAYED: "延迟复查", FROZEN: "冻结",
    REVIEW_PASSED: "已放行", PENDING_CHAIN: "已放行", PROCESSING: "处理中",
    SENT: "已发出", CHAIN_SUBMITTED: "已发出", CONFIRMED: "已到账", SUCCESS: "已到账",
    REVIEW_REJECTED: "审核拒绝", REJECTED: "审核拒绝", ADDRESS_INVALID: "地址无效",
    TX_FAILED: "打款失败", FAILED: "打款失败", TX_ORPHANED: "打款异常，需人工核对", DEAD: "打款异常，需人工核对",
    REFUNDED: "已退款",
  } as Record<string, string>)[status.toUpperCase()] ?? "未知状态";
}

export function erc20ConfirmationLost(row: { chain: string; status: string }) {
  return ["USDT-ERC20", "ERC20"].includes(row.chain) && ["TX_ORPHANED", "DEAD"].includes(row.status.toUpperCase());
}

/** 单条提现的状态：银行打款和 ERC20 丢失确认有自己的说法，其余同 withdrawalStatusLabel。 */
export function withdrawalRecordLabel(row: { chain: string; status: string }) {
  if (erc20ConfirmationLost(row)) return "冻结 · 仍占提现额度";
  if (row.chain !== "BANK-VND") return withdrawalStatusLabel(row.status);
  if (row.status === "SENT") return "银行处理中";
  if (row.status === "TX_ORPHANED") return "人工核对 · 未解冻";
  if (["FAILED", "TX_FAILED"].includes(row.status)) return "打款失败 · 已退回";
  return withdrawalStatusLabel(row.status);
}
