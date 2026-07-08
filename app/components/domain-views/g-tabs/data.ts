/**
 * G 域(金融产品)专属 mock — design_handoff_g_domain port(2026-06-11)。
 * 口径单一源铁律:
 *  - 在锁本金/利息/到期应付 = LEDGER 科目体系(#2 USDT 质押本金 1.64M = G1 USDT 池 1.25M + G7 复投 0.39M;
 *    #3 应付利息 312K;#4 Genesis 排放承诺 268K(保底口径预提);#5 NEX v2 到期应付 0.88M;
 *    #8 其他/legacy 锁仓 0.25M — NEX 质押已下线,存量并入 legacy,不再作 G1 NEX 池框定);
 *  - 产品/池熔断 = J1 闸同键(J.killswitch.staking[USDT]|exchange|genesis 等),G 域是生效面;
 *  - 地域封锁 = GEOBLOCK(J2 权威,KP/IR/SY 制裁名单)只读引用;
 *  - Genesis 日排放 = $24/节点/日 产品权威档(基数 $24.2M × 0.1% ÷ 1,000 slot;保底预提 $10/节点/日 挂科目#4,
 *    超出部分当期交易抽成直接派发);派发流量与 MATURITY.genesis(20.3K/日 = 847 × $24)同源;
 *  - NEX 行情 = NEX_MARKET 单源(G2 兑换 / G7 复投定价引用,前端现状值 $0.171);
 *  - K5 累计实名线 $100:V1 权威在 K5(k-tabs K5_PARAMS cumulativeKycThresholdUsdt),G2 只读 + 真 Link。
 * 真写键沿用旧 g-view 契约(G.staking.* / G.exchange.* / G.genesis.* / G.market.* / G.repurchase.*),
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
  const interest = acct("stake_interest"); // 312K(科目#3,线性计提)
  const genesisAccrual = acct("genesis_div"); // 268K(科目#4,保底口径预提)
  return {
    usdtPool, repurchasePrincipal, interest, genesisAccrual,
    g1Locked: usdtPool, // G1(USDT 质押)在锁合计 $1.25M(NEX 质押已下线;原 NEX 池 #8 转 legacy)
  };
})();

/* ===================== G1 Staking(USDT · NEX 质押已下线) ===================== */

// USDT 4 档参数(前端权威源 lib/v3/staking.ts;tier slug 沿用 g-view 真写键 G.staking.*.<tier>)。
// 在锁本金 = 科目#2 USDT 池 $1.25M(NEX 质押已下线,原 NEX 池 #8 转 legacy/其他)。
export type PoolTier = { term: string; apy: number; pen: number; min: string; locked: string; tier: string };
export const USDT_TIERS: PoolTier[] = [
  { term: "30 天", apy: 12, pen: 5, min: "$100", locked: "$0.27M", tier: "usdt30d" },
  { term: "90 天", apy: 35, pen: 15, min: "$500", locked: "$0.43M", tier: "usdt90d" },
  { term: "180 天", apy: 80, pen: 30, min: "$1,000", locked: "$0.35M", tier: "usdt180d" },
  { term: "365 天", apy: 180, pen: 50, min: "$5,000", locked: "$0.20M", tier: "usdt365d" },
];

// position 状态计数(base 口径,G1 监控;在锁 3,412 = active 3,180 + 到期未领 232)
export const G1_POS = { pending: 18, active: 3180, mature: 232, earlyMonth: 41 };

// 状态下钻样例(Drawer;uid 用 USERS 体系)
export const G1_POS_DETAIL: Record<string, { label: string; note: string; rows: [string, string, string, string, string][] }> = {
  pending_lock: { label: "待确认(pending_lock)", note: "入账未确认前的锁仓申请。服务器确认后转 active;超时未确认自动 refunded 退本。", rows: [["POS-8841", "usr_31E8", "USDT 90天", "$5,000", "2 小时前"]] },
  active: { label: "计息中(active)", note: "正常计息的在锁本金。应付利息按已锁天数线性派生,进负债账本(D3 科目 #3)。", rows: [["POS-8201", "usr_31E8", "USDT 365天", "$20,000", "剩 290 天"], ["POS-8150", "usr_19C7", "USDT 180天", "$8,000", "剩 120 天"]] },
  mature_unclaimed: { label: "到期未领(mature_unclaimed)", note: "已到期但用户还没领本息。本息挂在负债里直到领取;领取记一条账单(D4)。运营可提醒用户,不代领。", rows: [["POS-7720", "usr_5102", "USDT 90天", "$3,000 + 息 $221", "到期 3 天"], ["POS-7698", "usr_2208", "USDT 30天", "$1,500 + 息 $14", "到期 1 天"]] },
  early_withdrawn: { label: "提前赎回(early_withdrawn)", note: "本月提前赎回的单子。服务器扣罚金 + forfeit 全部利息,只退本金净额。", rows: [["POS-7401", "usr_8807", "USDT 180天", "本 $2,000 · 罚 30%", "已处置"]] },
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

/* ============================ G3 行情周曲线排程器 ============================ */
// 7 天关键帧曲线(行 = D1..D7,列 = CURVE_FIELDS):每日预设 目标价/上行概率/波动,
// 保存后由 server cron 每日 00:00 UTC 自动推进到下一关键帧并更新全站现价 G.market.price。
// 写键 G.market.curve.d<N>.<field>(逐日帧)/ G.market.curve.ctl.<schedule|pin|loop>(排程开关)。
// 向后兼容:G.market.price 仍是全站 NEX 现价单源,推进当日 = 把它更新为当日 targetPrice,下游(G2/G7)零改。
// PRODUCTION: GET /api/admin/market/curve(拉全曲线) · PUT /api/admin/market/curve/d/:n(改帧,过 B1)
//   · PUT /api/admin/market/curve/ctl/:key · POST /api/admin/market/curve/advance(cron 每日 currentDay+1 + 置现价)。
export const CURVE_FIELDS = ["targetPrice", "upProb", "volatility"] as const;
export type CurveField = typeof CURVE_FIELDS[number];
export const CURVE_LABELS: Record<CurveField, { name: string; unit: string }> = {
  targetPrice: { name: "目标价", unit: "$" },
  upProb: { name: "上行概率", unit: "0–1" },
  volatility: { name: "波动", unit: "±%" },
};
// 放松方向(升目标价 / 升上行概率 = 拉升预期 = 放大流出,过 B1 红线);波动不直接放大流出。
export const CURVE_LOOSEN_DIR: Partial<Record<CurveField, "up">> = { targetPrice: "up", upProb: "up" };
// 7 天关键帧值(行 = D1..D7,列序 = CURVE_FIELDS)。
export const MARKET_CURVE: number[][] = [
  /* D1 */ [0.171, 0.55, 3],
  /* D2 */ [0.174, 0.58, 3],
  /* D3 */ [0.178, 0.60, 4],
  /* D4 */ [0.181, 0.62, 4],
  /* D5 */ [0.184, 0.60, 5],
  /* D6 */ [0.182, 0.55, 4],
  /* D7 */ [0.179, 0.52, 3],
];
export const CURVE_STATE = {
  currentDay: 3, // 当前生效日(演示态;server cron 每日 00:00 UTC +1)
  peakPrice: Math.max(...MARKET_CURVE.map((r) => r[0])), // $0.184 = B1 重估的悲观口径(以周峰值价重估 NEX 计价负债)
};
// 排程控制 3 类(schedule 自动按日推进 / pin 钉住某日 / loop 跑完循环或停末值)。写键 G.market.curve.ctl.<key>。
export const CURVE_CONTROLS = [
  { key: "schedule", name: "自动按日推进", sub: "每日 00:00 UTC server cron 推进到下一关键帧,产 market.curve_advanced 事件", current: "每日 00:00 自动推进" },
  { key: "pin", name: "钉住某日(pin)", sub: "钉在指定日做演示 / 应急冻结,自动推进暂停", current: "未钉住" },
  { key: "loop", name: "跑完循环 / 停末值(loop)", sub: "D7 之后回到 D1 循环,或停在末日值", current: "循环" },
];

/* ============================ G4 Genesis ============================ */

export const GENESIS = {
  totalSlots: 1000, sold: 847, unitPrice: 9999, royaltyPct: 2.5,
  dividendSharePct: 0.1, // 0.1%/日(PM 2026-06-01 裁定)
  // 双口径调和(权威):展示口径 + 保底口径预提。分红延期改造:两口径都随 genesisDivOpen(M7 上所)开阀,上所前不派发/不计提。
  dailyVolumeBase: 24_200_000, // 平台日交易量基数(今日)
  perSlotPerDay: 24, // 上所后排放等值展示口径 ≈ $24/节点/日(NEX 计价的 ≈$24 等值,非上所前每日现金)
  floorPerNodePerDay: 10, // 保底 = 节点价 × 0.1% ≈ $10/节点/日 → 科目#4 预提口径(计提起点随 genesisDivOpen M7)
  todayBatch: "GD-0611",
  secondary: { floor: 13_400, vol24h: 186_000, listed: 38, owners: 612 }, // 地板价对齐前端(尾盘档+溢价 $13.4K,去旧 $12.4K 漂移)

};
export const GENESIS_POOL_TODAY = Math.round(GENESIS.dailyVolumeBase * 0.001); // $24.2K(基数 × 0.1%)
export const GENESIS_PAYOUT_TODAY = MATURITY[0].genesis; // $20.3K = 847 × $24(MATURITY 同源)

// 节点持有台账(lifetime 排放按 $24/日 闭合:#0042 一级 160 天 ≈ $3,840;#0117 转入 29 天 $696;#0233 125 天 $3,000)
export const GENESIS_NODES: [id: string, owner: string, src: string, lifetime: string, st: string, tone: string][] = [
  ["#0042", "usr_31E8", "一级", "$3,840", "持有计排放", "ok"],
  ["#0117", "usr_19C7", "二级(5/12 转入)", "$696", "持有计排放", "ok"],
  ["#0233", "usr_84F2", "一级", "$3,000", "二级挂单中", "dim"],
];
export const GENESIS_NODE_DETAIL: Record<string, { buy: string; div: [string, string][]; xfer: [string, string, string][] }> = {
  "#0042": { buy: "2026-01 一级 $9,999", div: [["累计 lifetime 排放", "$3,840(160 天 × $24)"], ["日排放(基数口径)", "$24 / 日"], ["保底预提口径", "$10 / 日(科目 #4)"], ["上次派发", "今天 00:00 批次"]], xfer: [["—", "一级原始持有,无转让记录", "—"]] },
  "#0117": { buy: "2026-01 一级(原 usr_3990)", div: [["累计 lifetime 排放", "$696(转入后 29 天 × $24)"], ["日排放(基数口径)", "$24 / 日"], ["转让规则", "排放跟随 NFT,不跟旧持有者"]], xfer: [["5/12", "usr_3990 → usr_19C7 二级成交 $11,200", "版税 2.5% 已扣"]] },
  "#0233": { buy: "2026-02 一级 $9,999", div: [["累计 lifetime 排放", "$3,000(125 天 × $24)"], ["日排放", "挂单中仍计 $24 / 日"], ["挂单价", "$12,800(二级)"]], xfer: [["5/28", "usr_84F2 挂二级单 $12,800", "待成交"]] },
};

/* ============================ G7 复投 ============================ */

// G7 复投:本金 $390K(科目#2 拆分)= 1,840 单 × 均 $212;90 天到期本息 ≈ ×(1+35%×90/365)≈ $424K
export const G7_REPURCHASE = {
  apy: 35, lockDays: 90, cultivation: 1.5, lotteryPerOrder: 1,
  presets: "$100 / 200 / 500 / 1,000", earlyPenaltyPct: 15,
  ordersMonth: 1840,
  principalUsd: G_FIN.repurchasePrincipal, // $390K
  matureUsd: Math.round(G_FIN.repurchasePrincipal * (1 + 0.35 * 90 / 365)), // ≈ $424K
  ticketsMonth: 1840,
  reinvestRate: 26.9, // 漏斗复投级(FUNNEL 复投 26.9% 同源)
  dist: "$100 档 62% · $200 档 21% · $500 档 12% · $1,000 档 5%",
  multiplierLabel: "当前 1×(月 5–6 限时 2× 窗口已过)",
};
