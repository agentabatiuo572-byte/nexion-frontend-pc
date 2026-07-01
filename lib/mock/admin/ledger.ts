/**
 * B1 双账本总览 mock 数据(确定性)。
 * 内部真实视角:储备 vs 应付负债 → 兑付覆盖率(红线 100% / 健康线 110%)+ 出金压力比 e(t)(模型 §5.3 原生庞氏度量,<0.7 红线)。
 * 当前 = 越南基准 P3 扩张期(m7):压力比 0.32 远低红线、覆盖率 118% 绿区、净流入、储备累积、维持放量。
 * (原型数据,非真实财务;体现「内部真账本」与用户端叙事的差距。)
 */
export interface LiabilityAccount {
  key: string;
  label: string;
  amount: number;
  catVar: string; // --admin-cat-N
}

export interface LedgerSnapshot {
  reserveUsd: number; // 平台真实储备
  liabilitiesUsd: number; // 应付负债总额
  coverageRatio: number; // reserve / liabilities (%)
  redlinePct: number; // 红线(低于即冻结放大流出)
  healthyPct: number; // 健康线
  accounts: LiabilityAccount[];
  netFlow24hUsd: number; // 24h 净流(正=净流入 / 负=净流出)
  pressureRatio: number; // 出金压力比 e(t)=(payout+佣金)/毛流入(模型 §5.3),<0.7 红线
  queueBacklogCount: number;
  queueBacklogUsd: number;
  avgRiskScore: number;
  /** 近 8 个统计窗口的覆盖率(%),用于 hero sparkline + 触红线预测。 */
  coverageSeries: number[];
  /** 上一统计窗口快照,用于真实环比(替代硬编码 delta)。 */
  prev: {
    reserveUsd: number;
    netFlow24hUsd: number;
    queueBacklogCount: number;
    avgRiskScore: number;
  };
}

const accounts: LiabilityAccount[] = [
  { key: "balance", label: "可提余额", amount: 1_180_000, catVar: "--admin-cat-1" },
  { key: "stake_principal", label: "USDT 质押本金", amount: 1_640_000, catVar: "--admin-cat-2" },
  { key: "stake_interest", label: "质押应付利息", amount: 312_000, catVar: "--admin-cat-3" },
  { key: "genesis_div", label: "Genesis 日分红承诺", amount: 268_000, catVar: "--admin-cat-4" },
  { key: "nexv2", label: "NEX v2 未来兑付", amount: 880_000, catVar: "--admin-cat-5" },
  { key: "withdraw_queue", label: "待提现队列", amount: 430_000, catVar: "--admin-cat-6" },
  { key: "commission_cool", label: "佣金冷却未解锁", amount: 410_000, catVar: "--admin-cat-7" },
  { key: "lock_other", label: "锁仓本息 / 其他", amount: 250_000, catVar: "--admin-cat-8" },
];

const reserveUsd = 6_340_000;
const liabilitiesUsd = accounts.reduce((s, a) => s + a.amount, 0); // 5,370,000

export const LEDGER: LedgerSnapshot = {
  reserveUsd,
  liabilitiesUsd,
  coverageRatio: (reserveUsd / liabilitiesUsd) * 100, // ≈ 118.1%(越南基准 m7 扩张:储备累积、覆盖率绿区高位)
  redlinePct: 100,   // 经济模型红线:覆盖率 <100% 即冻结放大流出
  healthyPct: 110,   // 经济模型黄线/健康线(≥110 绿区健康)
  accounts,
  netFlow24hUsd: 120_000, // 净流入(基准 m7:毛流入 $6.17M/月 ≫ payout,储备累积中)
  pressureRatio: 0.32, // 出金压力比 e(m7)=0.32(模型 §5.3),远低 0.7 红线 → 扩张健康
  queueBacklogCount: 88,
  queueBacklogUsd: 430_000,
  avgRiskScore: 31,
  // 越南基准 m7 扩张:覆盖率绿区高位、逐窗口缓升(储备增速压住应付累积)、远高于健康线 110
  coverageSeries: [113.0, 114.0, 115.0, 116.0, 116.5, 117.0, 117.5, 118.1],
  prev: {
    reserveUsd: 6_200_000, // 上一窗口储备略低(≈115%)→ 现累积上升
    netFlow24hUsd: 90_000, // 上一窗口净流入略小 → 现扩张加速
    queueBacklogCount: 95, // → 现 88(扩张期出金需求低、队列收窄)
    avgRiskScore: 33, // → 现 31
  },
};
