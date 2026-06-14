/**
 * G 域(金融产品)专属 mock — design_handoff_g_domain port(2026-06-11)。
 * 口径单一源铁律:
 *  - 在锁本金/利息/到期应付 = LEDGER 科目体系(#2 USDT 质押本金 1.64M = G1 USDT 池 1.25M + G7 复投 0.39M;
 *    #3 应付利息 312K;#4 Genesis 分红承诺 268K(保底口径预提);#5 NEX v2 到期应付 0.88M;#8 锁仓其他 0.25M = G1 NEX 池);
 *  - 产品/池熔断 = J1 七闸同键(J.killswitch.staking|exchange|genesis|nexv2|premium),G 域是生效面;
 *  - 地域封锁 = GEOBLOCK(J2 权威,KP/IR/SY 制裁名单)只读引用;
 *  - Genesis 日分红 = $24/节点/日 产品权威档(基数 $24.2M × 0.1% ÷ 1,000 slot;保底预提 $10/节点/日 挂科目#4,
 *    超出部分当期交易抽成直接派发);派发流量与 MATURITY.genesis(20.3K/日 = 847 × $24)同源;
 *  - NEX 行情 = NEX_MARKET 单源(G2 兑换 / G7 复投定价引用,前端现状值 $0.171);
 *  - K5 累计实名线 $100:V1 权威在 K5(k-tabs K5_PARAMS cumulativeKycThresholdUsdt),G2 只读 + 真 Link。
 * 真写键沿用旧 g-view 契约(G.staking.* / G.exchange.* / G.genesis.* / G.market.* / G.premium.* / G.repurchase.*),
 * 熔断类改写 J.killswitch.<key> 与 J1/首页/B5 真联动。
 */
import { LEDGER } from "@/lib/mock/admin/ledger";
import { MATURITY } from "@/lib/mock/admin/design-data";

const acct = (key: string) => LEDGER.accounts.find((a) => a.key === key)!.amount;

/* ============================ 跨页派生(科目闭合) ============================ */

export const G_FIN = (() => {
  const stakeUsdtAll = acct("stake_principal"); // 1.64M = USDT 池 + 复投
  const repurchasePrincipal = 390_000; // G7 复投在锁本金(90d 锁仓,USDT 计价归科目#2)
  const usdtPool = stakeUsdtAll - repurchasePrincipal; // 1.25M G1 USDT 池
  const nexPool = acct("lock_other"); // 0.25M G1 NEX 池折算(科目#8)
  const interest = acct("stake_interest"); // 312K(科目#3,线性计提)
  const nexv2Mature = acct("nexv2"); // 0.88M(科目#5,到期应付一次性登账)
  const genesisAccrual = acct("genesis_div"); // 268K(科目#4,保底口径预提)
  return {
    usdtPool, nexPool, repurchasePrincipal, interest, nexv2Mature, genesisAccrual,
    g1Locked: usdtPool + nexPool, // G1 口径在锁合计(不含复投)$1.50M
    nexv2Principal: Math.round(nexv2Mature / 6), // ×6 反推本金 ≈ $147K
  };
})();

/* ============================ G1 Staking ============================ */

// 4 档参数(前端权威源 lib/v3/staking.ts;tier slug 沿用旧 g-view 真写键 G.staking.*.<tier>)。
// 在锁本金按科目#2/#8 拆分等比分布(USDT 池 $1.25M / NEX 池 $0.25M)。
export type PoolTier = { term: string; apy: number; pen: number; min: string; locked: string; tier: string };
export const USDT_TIERS: PoolTier[] = [
  { term: "30 天", apy: 12, pen: 5, min: "$100", locked: "$0.27M", tier: "usdt30d" },
  { term: "90 天", apy: 35, pen: 15, min: "$500", locked: "$0.43M", tier: "usdt90d" },
  { term: "180 天", apy: 80, pen: 30, min: "$1,000", locked: "$0.35M", tier: "usdt180d" },
  { term: "365 天", apy: 180, pen: 50, min: "$5,000", locked: "$0.20M", tier: "usdt365d" },
];
export const NEX_TIERS: PoolTier[] = [
  { term: "30 天", apy: 5, pen: 5, min: "1,000", locked: "$0.08M", tier: "nex30d" },
  { term: "90 天", apy: 12, pen: 15, min: "5,000", locked: "$0.07M", tier: "nex90d" },
  { term: "180 天", apy: 20, pen: 30, min: "10,000", locked: "$0.06M", tier: "nex180d" },
  { term: "365 天", apy: 35, pen: 50, min: "20,000", locked: "$0.04M", tier: "nex365d" },
];

// position 状态计数(base 口径,G1 监控;在锁 3,412 = active 3,180 + 到期未领 232)
export const G1_POS = { pending: 18, active: 3180, mature: 232, earlyMonth: 41 };

// 状态下钻样例(Drawer;uid 用 USERS 体系)
export const G1_POS_DETAIL: Record<string, { label: string; note: string; rows: [string, string, string, string, string][] }> = {
  pending_lock: { label: "待确认(pending_lock)", note: "入账未确认前的锁仓申请。服务器确认后转 active;超时未确认自动 refunded 退本。", rows: [["POS-8841", "usr_31E8", "USDT 90天", "$5,000", "2 小时前"], ["POS-8839", "usr_77D4", "NEX 30天", "2,000 NEX", "5 小时前"]] },
  active: { label: "计息中(active)", note: "正常计息的在锁本金。应付利息按已锁天数线性派生,进负债账本(D3 科目 #3)。", rows: [["POS-8201", "usr_31E8", "USDT 365天", "$20,000", "剩 290 天"], ["POS-8150", "usr_19C7", "USDT 180天", "$8,000", "剩 120 天"], ["POS-8042", "usr_84F2", "NEX 90天", "5,000 NEX", "剩 40 天"]] },
  mature_unclaimed: { label: "到期未领(mature_unclaimed)", note: "已到期但用户还没领本息。本息挂在负债里直到领取;领取记一条账单(D4)。运营可提醒用户,不代领。", rows: [["POS-7720", "usr_5102", "USDT 90天", "$3,000 + 息 $221", "到期 3 天"], ["POS-7698", "usr_2208", "USDT 30天", "$1,500 + 息 $14", "到期 1 天"]] },
  early_withdrawn: { label: "提前赎回(early_withdrawn)", note: "本月提前赎回的单子。服务器扣罚金 + forfeit 全部利息,只退本金净额。", rows: [["POS-7401", "usr_8807", "USDT 180天", "本 $2,000 · 罚 30%", "已处置"], ["POS-7388", "usr_9921", "NEX 90天", "本 1,000 · 罚 15%", "已处置"]] },
};

/* ============================ G2 兑换风控 ============================ */

// 三阈值 + 费率(前端现状:兑换免手续费(feeFree),费率参数保留作运营杠杆、当前 0%)。
// queueMode 是 PRD G2③ 列的可控参数(超 cap 排队 vs 直接拒绝),audit 补齐入口。
export const G2_CAPS: { key: string; name: string; sub: string; cur: string; note: string; loosen: boolean; meterPct?: number }[] = [
  { key: "userDailyCap", name: "单用户日额度", sub: "每人每天最多换出多少 USDT", cur: "$50", note: "范围 $0–10,000 · 放宽过红线", loosen: true },
  { key: "platformDailyCap", name: "平台日额度", sub: "全平台每天兑换总池", cur: "$20,000", note: "范围 $0–1,000 万 · 放宽过红线", loosen: true, meterPct: 71 },
  { key: "fee", name: "兑换手续费率", sub: "每笔 NEX→USDT 抽成 · 当前免费推广期;开费后 30% 进回购销毁池、70% 进 fee_buffer", cur: "0%(免费)", note: "范围 0%–10% · 降费=放大流出过红线;只对新单", loosen: true },
  { key: "feeMin", name: "最低手续费", sub: "开费后小额兑换的保底费 · 单笔费 = max(金额 × 费率, 最低费)", cur: "$0.50(未启用)", note: "范围 $0–5 · 随费率启用生效", loosen: false },
  { key: "queueMode", name: "超 cap 处置策略", sub: "用户超 cap 时进次日队列(默认 · 可取消)还是直接拒绝", cur: "排队", note: "枚举:排队 / 拒绝 · 改为「拒绝」= 收紧方向,不受红线约束", loosen: false },
];

// 今日成交 $14.2K = 平台日池 $20K × 71%(meter 同源)
export const G2_STATS = { todayUsd: 14_200, poolPct: 71, queueDepth: 38, gateKyc: 88, gateUser: 41, gatePlatform: 13 };

export const G2_QUEUE: [user: string, dir: string, amt: string, reason: string, eta: string][] = [
  ["usr_8807", "NEX→USDT", "$45", "超单用户日额度", "明天 00:00"],
  ["usr_2231", "NEX→USDT", "$1,200", "超平台日额度", "明天 00:00"],
  ["usr_77D4", "NEX→USDT", "$38", "超单用户日额度", "明天 00:00"],
];

export const G2_GATE_DETAIL: Record<string, { t: string; n: string; r: [string, string, string][] }> = {
  kyc: { t: "需实名(kyc-required)", n: "累计兑换过线、还没完成实名的拦截。过实名(C4)后自动放行。", r: [["usr_55B1", "$112", "累计过 $100"], ["usr_2208", "$104", "累计过 $100"]] },
  user: { t: "单用户超限(user-cap)", n: "超过单用户日额度($50)的拦截。进次日队列或拒绝。", r: [["usr_8807", "$45", "当日已换 $20"], ["usr_77D4", "$38", "当日已换 $30"]] },
  platform: { t: "平台超限(platform-cap)", n: "全平台日总池见底的拦截。全部转次日队列。", r: [["usr_2231", "$1,200", "平台池 71% 已用"], ["usr_4410", "$880", "平台池见底"]] },
};

/* ============================ G3 NEX 行情引擎 ============================ */

// NEX 行情单源(前端现状值;G2 兑换 / G7 复投定价引用此,不另立价)。
// costBasis = 成本基准锚(PnL 基准,前端 me/wallet NEX 详情 day-0 锚,PRD G3③ 行)。
export const NEX_MARKET = {
  price: 0.171, change24h: 20.4, ath: 0.184,
  pump: 0.08, volatility: 3, // 价格上行概率 / 做市波动 ±%
  oracle: "内部做市", deviationPct: 5, deviationNow: 0.3,
  costBasis: 0.085, // PnL 基准锚(只展示锚,非价格曲线参数)
};

// 24h kline(48 点确定性序列,收于现价;ATH 虚线)
export const NEX_KLINE: number[] = (() => {
  const pts: number[] = [];
  let v = 0.142;
  for (let i = 0; i < 48; i++) {
    v += Math.sin(i * 1.7) * 0.0022 + 0.0007; // 确定性缓升 + 波动
    v = Math.max(0.138, Math.min(0.1815, v));
    pts.push(Math.round(v * 1000) / 1000);
  }
  pts[47] = NEX_MARKET.price;
  return pts;
})();

/* ============================ G4 Genesis ============================ */

export const GENESIS = {
  totalSlots: 1000, sold: 847, unitPrice: 9999, royaltyPct: 2.5,
  dividendSharePct: 0.1, // 0.1%/日(PM 2026-06-01 裁定;前端 1.5% 笔误待 V4 订正)
  // 双口径调和(权威):基数口径派发 + 保底口径预提
  dailyVolumeBase: 24_200_000, // 平台日交易量基数(今日)
  perSlotPerDay: 24, // = 24.2M × 0.1% ÷ 1,000 slot(产品权威档:$24/节点/日 · 14 月回本)
  floorPerNodePerDay: 10, // 保底 = 节点价 × 0.1% ≈ $10/节点/日 → 科目#4 预提口径
  todayBatch: "GD-0611",
  secondary: { floor: 12_400, vol24h: 186_000, listed: 38, owners: 612 },
};
export const GENESIS_POOL_TODAY = Math.round(GENESIS.dailyVolumeBase * 0.001); // $24.2K(基数 × 0.1%)
export const GENESIS_PAYOUT_TODAY = MATURITY[0].genesis; // $20.3K = 847 × $24(MATURITY 同源)

// 节点持有台账(lifetime 分红按 $24/日 闭合:#0042 一级 160 天 ≈ $3,840;#0117 转入 29 天 $696;#0233 125 天 $3,000)
export const GENESIS_NODES: [id: string, owner: string, src: string, lifetime: string, st: string, tone: string][] = [
  ["#0042", "usr_31E8", "一级", "$3,840", "持有计分红", "ok"],
  ["#0117", "usr_19C7", "二级(5/12 转入)", "$696", "持有计分红", "ok"],
  ["#0233", "usr_84F2", "一级", "$3,000", "二级挂单中", "dim"],
];
export const GENESIS_NODE_DETAIL: Record<string, { buy: string; div: [string, string][]; xfer: [string, string, string][] }> = {
  "#0042": { buy: "2026-01 一级 $9,999", div: [["累计 lifetime 分红", "$3,840(160 天 × $24)"], ["日分红(基数口径)", "$24 / 日"], ["保底预提口径", "$10 / 日(科目 #4)"], ["上次派发", "今天 00:00 批次"]], xfer: [["—", "一级原始持有,无转让记录", "—"]] },
  "#0117": { buy: "2026-01 一级(原 usr_3990)", div: [["累计 lifetime 分红", "$696(转入后 29 天 × $24)"], ["日分红(基数口径)", "$24 / 日"], ["转让规则", "分红跟随 NFT,不跟旧持有者"]], xfer: [["5/12", "usr_3990 → usr_19C7 二级成交 $11,200", "版税 2.5% 已扣"]] },
  "#0233": { buy: "2026-02 一级 $9,999", div: [["累计 lifetime 分红", "$3,000(125 天 × $24)"], ["日分红", "挂单中仍计 $24 / 日"], ["挂单价", "$12,800(二级)"]], xfer: [["5/28", "usr_84F2 挂二级单 $12,800", "待成交"]] },
};

/* ============================ G5/G6/G7 ============================ */

// G5 Premium:月 7(当前 PHASE)刚解锁 → 首月演示态(活跃 = 新增 312 − 退款窗取消 14 = 298;MRR 按首月折扣价 $50)
export const G5_PREMIUM = {
  price: 99, firstMonthDiscount: 0.5, yieldBonus: 2,
  active: 298, newMonth: 312, refundWindowCancel: 14,
  mrr: 298 * 50, // $14.9K(首月全在折扣期)
  gateLabel: "月 7+ = 开(当前月 7 · 已解锁)",
};

// G6 NEX v2:gate 月 11+ 未到 → 当前在锁为 Founders 邀请制预售批次(产品合法叙事);
// 到期应付 = 科目#5 $0.88M 一次性登账,本金 = ÷6 反推 ≈ $147K,position 64。
export const G6_NEXV2 = {
  apy: 250, lockMonths: 24, minLock: 1000, multiple: 6,
  lockedPrincipalUsd: G_FIN.nexv2Principal, // ≈ $147K
  positions: 64,
  matureValueUsd: G_FIN.nexv2Mature, // $0.88M(科目#5)
  gateLabel: "月 11+ 全量开放(当前邀请制预售)",
};

// G7 复投:本金 $390K(科目#2 拆分)= 1,840 单 × 均 $212;90 天到期本息 ≈ ×(1+35%×90/365)≈ $424K
export const G7_REPURCHASE = {
  apy: 35, lockDays: 90, pointsPer100: 50, cultivation: 1.5, lotteryPerOrder: 1,
  presets: "$100 / 200 / 500 / 1,000", earlyPenaltyPct: 15,
  ordersMonth: 1840,
  principalUsd: G_FIN.repurchasePrincipal, // $390K
  matureUsd: Math.round(G_FIN.repurchasePrincipal * (1 + 0.35 * 90 / 365)), // ≈ $424K
  ticketsMonth: 1840,
  reinvestRate: 26.9, // 漏斗复投级(FUNNEL 复投 26.9% 同源)
  dist: "$100 档 62% · $200 档 21% · $500 档 12% · $1,000 档 5%",
  multiplierLabel: "当前 1×(月 5–6 限时 2× 窗口已过)",
};
