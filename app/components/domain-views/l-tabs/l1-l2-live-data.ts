type UnknownRecord = Record<string, unknown>;

export type L1LiveMetric = {
  key: string;
  label: string;
  value: number;
  source: string;
  sourceLabel: string;
  description: string;
};

export type L2LiveStage = {
  key: string;
  label: string;
  count: number;
  source: string;
  sourceLabel: string;
  description: string;
};

const L1_TOTALS = [
  ["users", "注册完成用户", "nx_event_outbox:auth.register_completed", "A4 统一事件流", "服务器权威注册完成事件去重人数"],
  ["orders", "支付完成人数", "nx_event_outbox:checkout.completed", "A4 统一事件流", "服务器权威支付完成事件去重人数"],
  ["withdrawals", "提现申请人数", "nx_event_outbox:withdraw.submitted", "A4 统一事件流", "服务器权威提现提交事件去重人数"],
  ["exchanges", "兑换完成人数", "nx_event_outbox:exchange.swapped", "A4 统一事件流", "服务器权威兑换完成事件去重人数"],
  ["stakingPositions", "质押开仓人数", "nx_event_outbox:staking.opened", "A4 统一事件流", "服务器权威质押开仓事件去重人数"],
  ["walletLedgerRows", "充值确认事件", "nx_event_outbox:wallet.topup_confirmed", "A4 统一事件流", "服务器权威充值确认事件数"],
  ["supportTickets", "客服建单事件", "nx_event_outbox:support.ticket_created", "A4 统一事件流", "服务器权威客服建单事件数"],
  ["auditLogs", "后台治理事件", "nx_event_outbox:phase_admin", "A4 统一事件流", "已注册的 phase/admin family 事件数"],
] as const;

const L2_STAGE_META: Record<string, { label: string; description: string }> = {
  registered: { label: "已注册", description: "当前注册账户数" },
  profileCompleted: { label: "已完善资料", description: "已生成用户资料的账户数" },
  kycSubmitted: { label: "已提交 KYC", description: "已提交 KYC 资料的账户数" },
  kycApproved: { label: "KYC 已通过", description: "KYC 状态为通过的账户数" },
  ordered: { label: "订单记录", description: "商城订单与后台设备订单累计数" },
  walletActivity: { label: "钱包活动", description: "钱包账本与账单累计记录数" },
};

const SOURCE_LABELS: Record<string, string> = {
  nx_user: "用户主数据",
  nx_user_profile: "用户资料",
  nx_kyc_profile: "身份认证记录",
  "nx_order/nx_admin_device_order": "订单主数据",
  "nx_wallet_ledger/nx_wallet_bill": "钱包活动记录",
};

export type AggregateExportOption = {
  label: string;
  reportType: "KPI_SERIES" | "FUNNEL_COHORT" | "FINANCE_AGG" | "OPERATIONS_AGG";
  permission: "bi_l1_write" | "bi_l2_write" | "bi_l3_write" | "bi_l4_write";
};

const AGGREGATE_EXPORT_OPTIONS: readonly AggregateExportOption[] = [
  { label: "KPI 序列", reportType: "KPI_SERIES", permission: "bi_l1_write" },
  { label: "漏斗序列", reportType: "FUNNEL_COHORT", permission: "bi_l2_write" },
  { label: "财务聚合", reportType: "FINANCE_AGG", permission: "bi_l3_write" },
  { label: "运营聚合", reportType: "OPERATIONS_AGG", permission: "bi_l4_write" },
];

export function allowedAggregateExportOptions(
  role: string | undefined,
  authorities: readonly string[],
): AggregateExportOption[] {
  if (role?.toLowerCase() === "superadmin") return [...AGGREGATE_EXPORT_OPTIONS];
  return AGGREGATE_EXPORT_OPTIONS.filter((option) => authorities.includes(option.permission));
}

export function canAccessBiReportType(
  role: string | undefined,
  authorities: readonly string[],
  reportType: string,
): boolean {
  const normalized = reportType.trim().toUpperCase();
  if (normalized === "KYC_REGULATORY") {
    return role?.toLowerCase() === "superadmin" || authorities.includes("user_c4_export");
  }
  if (normalized === "REGULATORY") {
    return role?.toLowerCase() === "superadmin" || authorities.includes("bi_l5_regulatory_generate");
  }
  if (normalized === "NETWORK_TREE") {
    return role?.toLowerCase() === "superadmin" || authorities.includes("bi_l4_export_tree");
  }
  const option = AGGREGATE_EXPORT_OPTIONS.find((candidate) => candidate.reportType === normalized);
  if (!option) return false;
  if (role?.toLowerCase() === "superadmin") return true;
  return option ? authorities.includes(option.permission) : false;
}

export function canExportBiReports(role: string | undefined, authorities: readonly string[], moduleCode = "L5"): boolean {
  if (role?.toLowerCase() === "superadmin") return true;
  if (moduleCode === "L5") return allowedAggregateExportOptions(role, authorities).length > 0;
  const required = ({
    L1: "bi_l1_write",
    L2: "bi_l2_write",
    L3: "bi_l3_write",
    L4: "bi_l4_write",
    L6: "bi_l6_export",
  } as Record<string, string>)[moduleCode] ?? "bi_l5_write";
  return authorities.includes(required);
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readL1LiveTotals(raw: unknown): L1LiveMetric[] {
  const totals = record(record(raw).totals);
  return L1_TOTALS.flatMap(([key, label, source, sourceLabel, description]) => {
    if (!Object.prototype.hasOwnProperty.call(totals, key)) return [];
    const value = finiteNumber(totals[key]);
    return value === null ? [] : [{ key, label, value, source, sourceLabel, description }];
  });
}

export function readL2LiveStages(raw: unknown): L2LiveStage[] {
  const stages = record(raw).stages;
  if (!Array.isArray(stages)) return [];
  return stages.flatMap((item) => {
    const row = record(item);
    const key = typeof row.key === "string" ? row.key.trim() : "";
    const source = typeof row.source === "string" ? row.source.trim() : "";
    const count = finiteNumber(row.count);
    if (!key || !source || count === null) return [];
    const meta = L2_STAGE_META[key] ?? { label: key, description: "后端返回的生命周期事实计数" };
    const sourceLabel = source.startsWith("nx_event_outbox:") ? "A4 统一事件流" : (SOURCE_LABELS[source] ?? "业务统计");
    return [{ key, label: meta.label, count, source, sourceLabel, description: meta.description }];
  });
}
