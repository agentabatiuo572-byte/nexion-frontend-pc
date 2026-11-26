/**
 * B 聚合风险条目（riskRadar.feed）的读法，今日概览和铃铛共用。
 * 不能按严重度整批过滤：覆盖率结论行正常时也是 p2，而等待重新评分、中风险账户这类 p2 是要处理的事。
 * 结论行是唯一指向资金总览的一条，挤兑比率到黄线前它只是在报现状（后端 dynamicCoverageFeed）。
 */
export function isRiskConclusion(item: { sev: string; href: string }) {
  return item.href === "/overview/dual-ledger" && item.sev !== "p0" && item.sev !== "p1";
}

export const SIGNAL_CATEGORIES = [
  { value: "MULTI_ACCOUNT", label: "多账户风险" },
  { value: "ABUSE", label: "套利或刷量风险" },
  { value: "WITHDRAW", label: "提现风险" },
  { value: "TAMPER", label: "篡改风险" },
  { value: "USER_FROZEN", label: "账户冻结" },
  { value: "CHARGEBACK_SHORTFALL", label: "拒付追回有差额" },
  { value: "OTHER", label: "其他风险信号" },
] as const;

export type SignalCategory = typeof SIGNAL_CATEGORIES[number]["value"];
export function isSignalCategory(value: unknown): value is SignalCategory {
  return SIGNAL_CATEGORIES.some(category => category.value === value);
}

export const RISK_SEVERITIES = ["p0", "p1", "p2", "p3"] as const;
export type RiskSev = typeof RISK_SEVERITIES[number];
export const SCORE_BANDS = ["AUTO_REPORT", "HIGH_BELOW_AUTO", "MEDIUM", "STALE"] as const;
export type ScoreBand = typeof SCORE_BANDS[number];

type SignalFeedFields = {
  category: SignalCategory;
  categoryName: string;
  count: number;
  accountCount: number;
  latestAt: string;
  startAt: string;
  endAt: string;
  handlingStatus: "open";
};

export type RiskFeedItem = { sev: RiskSev; t: string; m: string; href: string } & (
  SignalFeedFields & { band?: never }
  | { category?: never; band: ScoreBand | "HIGH"; count: number }
  | { category?: never; band?: never; count?: number; accountCount?: number; latestAt?: string; startAt?: string; endAt?: string }
);

export const B5_PATH = "/overview/risk-radar";
export const B5_FROM_HOME = `${B5_PATH}?from=home&tab=signals#risk-signal-tabs`;

/** True for absolute API date-times. Keep the original offset for subsequent queries. */
export function isOffsetDateTime(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

/** 后端下发的「挤兑比率」就是页面上的「近 24 小时提现申请占储备」，同一个数用同一个名字。 */
export function riskFeedTitle(title: string) {
  const label = title.replace("挤兑比率", "近 24 小时提现申请占储备")
    .replace(/\s*·\s*当前评分规则\s*$/, "");
  if (!/\bk4-v\d+\b/i.test(label)) return label;
  return label.split("·")
    .map((part) => part.replace(/(?:当前评分规则\s+)?\bk4-v\d+\b/gi, "").trim())
    .filter(Boolean)
    .join(" · ");
}
