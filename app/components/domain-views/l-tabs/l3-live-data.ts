export type L3LiveFact = {
  key: "totalBills" | "earningBills" | "teamCommissionBills" | "genesisDividendBills" | "refundBills";
  label: string;
  value: number;
  description: string;
  sourceLabel: string;
};

export type L3LiabilityAccount = { key: string; label: string; amount: number };
export type L3MaturityDay = { day: string; withdrawUsd?: number; interestUsd?: number };
export type L3FinanceSnapshot = {
  generatedAt?: string;
  reserveUsd?: number;
  liabilitiesUsd?: number;
  coverageRatio?: number;
  redlinePct?: number;
  netFlow24hUsd?: number;
  queueBacklogCount?: number;
  queueBacklogUsd?: number;
  avgRiskScore?: number;
  valuationReliable?: boolean;
  accounts: L3LiabilityAccount[];
  maturity7d: L3MaturityDay[];
};

const FACTS: ReadonlyArray<Omit<L3LiveFact, "value">> = [
  { key: "totalBills", label: "钱包账单总数", description: "当前钱包流水中已落账的全部账单数量。", sourceLabel: "钱包流水" },
  { key: "earningBills", label: "收益账单", description: "归类为用户收益的账单数量。", sourceLabel: "钱包流水" },
  { key: "teamCommissionBills", label: "团队佣金账单", description: "归类为团队佣金的账单数量。", sourceLabel: "钱包流水" },
  { key: "genesisDividendBills", label: "Genesis 排放账单", description: "归类为 Genesis 排放的账单数量。", sourceLabel: "钱包流水" },
  { key: "refundBills", label: "退款账单", description: "归类为退款的账单数量。", sourceLabel: "钱包流水" },
];

export function readL3LiveFacts(value: unknown): L3LiveFact[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const rawLedger = (value as Record<string, unknown>).ledgerLive;
  if (!rawLedger || typeof rawLedger !== "object" || Array.isArray(rawLedger)) return [];
  const ledger = rawLedger as Record<string, unknown>;

  return FACTS.flatMap((fact) => {
    if (!Object.prototype.hasOwnProperty.call(ledger, fact.key)) return [];
    const parsed = Number(ledger[fact.key]);
    if (!Number.isFinite(parsed) || parsed < 0) return [];
    return [{ ...fact, value: parsed }];
  });
}

const LIABILITY_LABELS: Record<string, string> = {
  withdrawable_balance: "可提余额",
  usdt_staking_principal: "USDT staking 本金",
  staking_interest: "staking 应付利息",
  genesis_daily_emission: "Genesis 排放承诺",
  nex_v2_future: "NEX v2 未来兑付",
  withdrawal_queue: "待提现 queue",
  commission_cooling: "佣金冷却未解锁",
  lock_other: "锁仓本息其他",
  // Compatibility aliases for snapshots created before D3 adopted the eight
  // canonical liability keys. New responses must use the keys above.
  balance: "可提现余额",
  stake_principal: "质押本金",
  stake_interest: "质押应计利息",
  nex_payable: "NEX 应付款",
  withdraw_queue: "提现队列",
  pending_withdraw: "钱包待提现金额",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function readL3FinanceSnapshot(value: unknown): L3FinanceSnapshot | null {
  const finance = record(record(value).financeLive);
  const snapshot = record(finance.snapshot);
  if (Object.keys(snapshot).length === 0) return null;

  const accounts = Array.isArray(finance.accounts) ? finance.accounts.flatMap((item) => {
    const row = record(item);
    const key = typeof row.key === "string" ? row.key : "";
    const amount = optionalNumber(row.amount);
    if (!key || amount === undefined) return [];
    return [{ key, label: LIABILITY_LABELS[key] ?? "其他负债", amount }];
  }) : [];

  const maturity7d = Array.isArray(finance.maturity7d) ? finance.maturity7d.flatMap((item) => {
    const row = record(item);
    const day = typeof row.day === "string" ? row.day : "";
    if (!day) return [];
    const withdrawUsd = optionalNumber(row.withdrawUsd);
    const interestUsd = optionalNumber(row.interestUsd);
    if (withdrawUsd === undefined && interestUsd === undefined) return [];
    return [{ day, withdrawUsd, interestUsd }];
  }) : [];

  return {
    generatedAt: typeof finance.generatedAt === "string" ? finance.generatedAt : undefined,
    reserveUsd: optionalNumber(snapshot.reserveUsd),
    liabilitiesUsd: optionalNumber(snapshot.liabilitiesUsd),
    coverageRatio: optionalNumber(snapshot.coverageRatio),
    redlinePct: optionalNumber(snapshot.redlinePct),
    netFlow24hUsd: optionalNumber(snapshot.netFlow24hUsd),
    queueBacklogCount: optionalNumber(snapshot.queueBacklogCount),
    queueBacklogUsd: optionalNumber(snapshot.queueBacklogUsd),
    avgRiskScore: optionalNumber(snapshot.avgRiskScore),
    valuationReliable: typeof snapshot.valuationReliable === "boolean" ? snapshot.valuationReliable : undefined,
    accounts,
    maturity7d,
  };
}
