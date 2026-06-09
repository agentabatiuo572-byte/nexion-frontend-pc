/**
 * 设计稿内容层 mock 数据(从设计稿 admin-data.js 原样移植,PRD 口径)。
 * 仅供 app/components/domain-views/* 复刻设计稿内容页使用。
 * 资金/兑付口径统一从 LEDGER(单一权威源)派生,杜绝双账本矛盾。
 */
import { LEDGER } from "./ledger";

export const fmtUsd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
export const fmtM = (n: number) => "$" + (n / 1e6).toFixed(2) + "M";
export const fmtK = (n: number) => (n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : "$" + (n / 1e3).toFixed(0) + "K");

export const ROLES: Record<string, { id: string; name: string; short: string; av: string; color: string }> = {
  super: { id: "super", name: "超级管理员", short: "超管", av: "超", color: "#9EDC1D" },
  finance: { id: "finance", name: "财务", short: "财务", av: "财", color: "#29D27F" },
  risk: { id: "risk", name: "风控", short: "风控", av: "风", color: "#DD6F5C" },
  content: { id: "content", name: "内容", short: "内容", av: "内", color: "#FFBE3D" },
  growth: { id: "growth", name: "增长", short: "增长", av: "增", color: "#FF6B35" },
  support: { id: "support", name: "客服", short: "客服", av: "客", color: "#9B89E0" },
  audit: { id: "audit", name: "只读审计", short: "审计", av: "审", color: "#5F6A7E" },
};

export const KPIS = [
  { n: 1, name: "Day 0 自动接入率", value: 96.4, target: 95, unit: "%", dir: "gte", cohort: "注册→90s 内首笔 receipt", vis: "V1", spark: [94, 95, 93, 96, 95, 96, 96.4] },
  { n: 2, name: "Day 7 留存", value: 58.2, target: 60, unit: "%", dir: "gte", cohort: "7 天后仍开过 app", vis: "V1", spark: [61, 60, 59, 58, 57, 59, 58.2] },
  { n: 3, name: "L2→L3 转化(进 store)", value: 34.1, target: 30, unit: "%", dir: "gte", cohort: "主动浏览商城", vis: "V1", spark: [30, 31, 33, 32, 34, 33, 34.1] },
  { n: 4, name: "L3→L4 转化(下单)", value: 6.8, target: 7.5, unit: "%", dir: "band", band: [5, 10], cohort: "完成支付", vis: "V1", spark: [5.2, 5.8, 6.1, 6.5, 7.0, 6.6, 6.8] },
  { n: 5, name: "L4→L5 转化(推广)", value: 41.5, target: 40, unit: "%", dir: "gte", cohort: "设备持有者推荐 ≥1 人", vis: "V4", spark: [38, 39, 40, 41, 42, 41, 41.5] },
  { n: 6, name: "Nova push CTR", value: 27.3, target: 25, unit: "%", dir: "gte", cohort: "每条 CTA tap 率", vis: "V4", spark: [24, 25, 26, 27, 28, 27, 27.3] },
  { n: 7, name: "团队佣金触发率", value: 76.0, target: 80, unit: "%", dir: "gte", cohort: "L1 直推被推荐人首单", vis: "V2", spark: [72, 73, 74, 75, 76, 75, 76] },
  { n: 8, name: "Genesis 售罄速度", value: 11, target: 14, unit: "天", dir: "lte", cohort: "售罄 1,000 张", vis: "V2", spark: [16, 15, 14, 13, 12, 12, 11] },
] as const;

// 兑付/储备口径单一权威源 = LEDGER(指挥台 B1 同源);此处仅换算导出名,值不另立一套。
const _r1 = (n: number) => Math.round(n * 10) / 10;
export const TREASURY = {
  reserveTotal: LEDGER.reserveUsd,
  liabilityTotal: LEDGER.liabilitiesUsd,
  coverageRatio: _r1(LEDGER.coverageRatio),
  redLine: LEDGER.redlinePct,
  yellowLine: LEDGER.healthyPct,
  light: LEDGER.coverageRatio >= LEDGER.healthyPct ? "green" : LEDGER.coverageRatio >= LEDGER.redlinePct ? "amber" : "red",
  deltaPct: _r1(LEDGER.coverageSeries[LEDGER.coverageSeries.length - 1] - LEDGER.coverageSeries[0]),
  netExposure: LEDGER.reserveUsd - LEDGER.liabilitiesUsd, // 储备−应付;现为正=盈余(118% 覆盖·绿区,m7 扩张)
  exposureSeries: LEDGER.coverageSeries.map((c) => Math.round(LEDGER.liabilitiesUsd * (c / 100 - 1))),
  injectedCumulative: 12_400_000,
};

// 8 类负债 = LEDGER.accounts(单源);色用 --admin-cat-* token(不硬编码 hex)。
export const LIABILITIES = LEDGER.accounts.map((a, i) => ({
  id: i + 1,
  name: a.label,
  amount: a.amount,
  color: `var(${a.catVar})`,
}));

export const MATURITY = [
  { d: "06-02", withdraw: 420000, interest: 88000, genesis: 39000 },
  { d: "06-03", withdraw: 380000, interest: 91000, genesis: 39000 },
  { d: "06-04", withdraw: 510000, interest: 86000, genesis: 40000 },
  { d: "06-05", withdraw: 340000, interest: 90000, genesis: 40000 },
  { d: "06-06", withdraw: 610000, interest: 84000, genesis: 41000 },
  { d: "06-07", withdraw: 290000, interest: 93000, genesis: 41000 },
  { d: "06-08", withdraw: 470000, interest: 89000, genesis: 42000 },
];

export const FUNNEL = [
  { stage: "注册", ev: "auth.register_completed", users: 128400, cvr: null as number | null, lc: "L1", color: "#9EDC1D", target: undefined as string | undefined },
  { stage: "绑卡 $1 KYC", ev: "kyc.express_verified", users: 97300, cvr: 75.8, lc: "L2", color: "#B6E84A", target: undefined },
  { stage: "首购", ev: "checkout.completed", users: 33180, cvr: 34.1, lc: "L3→L4", target: ">30%", color: "#9B89E0" },
  { stage: "复投", ev: "wallet.reinvest", users: 8920, cvr: 26.9, lc: "L5", color: "#B6A4FF", target: undefined },
  { stage: "提现", ev: "withdraw.submitted", users: 21640, cvr: 65.2, lc: "L5", color: "#29D27F", target: undefined },
];

export const PHASE = {
  current: "P3",
  month: 6,
  label: "月 6 · 拉新加速期",
  dials: [
    { key: "withdrawCooldownDays", name: "提现冷却(天)", val: 30, unit: "d", trend: "↑" },
    { key: "withdrawDailyCapUSD", name: "提现日限", val: "$2,000", trend: "—" },
    { key: "withdrawPointsRatio", name: "提现积分门槛 /$100", val: "10", trend: "↑" },
    { key: "binaryDailyCapUSD", name: "双轨日封顶", val: "$2,000", trend: "—" },
    { key: "stakingApyBoost", name: "Staking APY 加成", val: "1.0×", trend: "—" },
    { key: "novaCadenceMult", name: "Nova 节奏乘数", val: "1.2×", trend: "↑" },
    { key: "questRewardMult", name: "Quest 奖励乘数", val: "1.5×", trend: "↑" },
    { key: "trialOffsetCapUSD", name: "试用抵扣上限", val: "$50", trend: "—" },
    { key: "storeDiscountLadder", name: "商城折扣 ladder", val: "T2", trend: "—" },
    { key: "genesisDividendRate", name: "Genesis 日分红率", val: "0.1%", trend: "—" },
  ],
  timeline: ["P1", "P2", "P3", "P4", "P5", "P6"],
};

export const RISK = {
  bankRunRatio: 7.9,
  flaggedAccounts: 342,
  // kill 闸状态单一源 = KILLSWITCH(本文件 export);此处不再镜像(曾 stale 漏 withdraw,易成陷阱)。
  alerts: [
    { sev: "warn", t: "Day7 留存 58.2% < 60% 目标", src: "B3 漏斗", age: "14m" },
    { sev: "info", t: "团队佣金触发率 76% < 80%", src: "F5 佣金审计", age: "1h" },
    { sev: "warn", t: "K2 检出 12 个 trade-in 套利簇", src: "K2 套利检测", age: "2h" },
  ],
};

export const WITHDRAWALS = [
  { id: "WD-9F3A21", user: "usr_84F2", amount: 4200, status: "review", risk: 72, route: "转人工", kyc: "verified", age: "8m", chain: "TRC20", addr: "TJ9k...4aF2", cooldown: "已解锁" },
  { id: "WD-9F3A18", user: "usr_19C7", amount: 980, status: "auto", risk: 18, route: "自动放行", kyc: "verified", age: "12m", chain: "TRC20", addr: "TQa3...9dE1", cooldown: "已解锁" },
  { id: "WD-9F3A0E", user: "usr_55B1", amount: 12500, status: "frozen", risk: 91, route: "freeze", kyc: "pending", age: "21m", chain: "ERC20", addr: "0x7a...c4b8", cooldown: "冷却中 2d" },
  { id: "WD-9F39FC", user: "usr_02A9", amount: 2300, status: "delay", risk: 54, route: "delay 24h", kyc: "verified", age: "33m", chain: "TRC20", addr: "TKm2...8xQ4", cooldown: "已解锁" },
  { id: "WD-9F39E0", user: "usr_77D4", amount: 760, status: "auto", risk: 11, route: "自动放行", kyc: "verified", age: "40m", chain: "TRC20", addr: "TBn8...1pL9", cooldown: "已解锁" },
  { id: "WD-9F39C2", user: "usr_31E8", amount: 8800, status: "review", risk: 68, route: "转人工", kyc: "verified", age: "55m", chain: "ERC20", addr: "0x2f...9a01", cooldown: "已解锁" },
  { id: "WD-9F3990", user: "usr_90F0", amount: 340, status: "processing", risk: 9, route: "处理中", kyc: "verified", age: "1h", chain: "TRC20", addr: "TVc4...6rT2", cooldown: "已解锁" },
];

export const APPROVALS = [
  { id: "MC-2041", action: "提现批量放行", obj: "WD queue · 14 笔", maker: "finance·李", domain: "D2", risk: "高", amount: "$38,400", ts: "2m", reason: "SLA 临近,批量复核", covCheck: false },
  { id: "MC-2039", action: "提现参数:日限上调", obj: "withdrawDailyCapUSD $2,000→$2,500", maker: "growth·王", domain: "D5", risk: "高·放大流出", amount: "—", ts: "18m", reason: "P3 拉新期提升体验", covCheck: true },
  { id: "MC-2037", action: "余额调整", obj: "usr_84F2 +$1,200 NEX", maker: "support·张", domain: "C3", risk: "中", amount: "$1,200", ts: "34m", reason: "客诉补偿(工单 #88213)", covCheck: false },
  { id: "MC-2034", action: "Kill-Switch 解除", obj: "nexv2 disable→enable", maker: "risk·陈", domain: "J1", risk: "高·放大流出", amount: "—", ts: "1h", reason: "监管核查完毕,恢复 NEX v2", covCheck: true },
];

export const TOPUPS = [
  { id: "TP-77120", user: "usr_22A1", amount: 500, psp: "MoonPay", method: "card", status: "confirmed", bin: "低风险", fee: 14.5 },
  { id: "TP-77119", user: "usr_61C2", amount: 1299, psp: "Banxa", method: "card", status: "confirmed", bin: "低风险", fee: 32.1 },
  { id: "TP-77118", user: "usr_09F4", amount: 200, psp: "OnChain", method: "usdt", status: "pending", bin: "—", fee: 0 },
  { id: "TP-77117", user: "usr_43B8", amount: 3499, psp: "MoonPay", method: "card", status: "review", bin: "高风险 BIN", fee: 96.2 },
  { id: "TP-77116", user: "usr_88E0", amount: 99, psp: "Banxa", method: "card", status: "confirmed", bin: "低风险", fee: 3.4 },
];

export const USERS = [
  { id: "usr_84F2", name: "Marcus Lee", lc: "L4", vrank: "V3", devices: 2, kyc: "verified", risk: 72, balance: 8420, nex: 12400, ref: "NX-8821", frozen: false, joined: "2026-03-12" },
  { id: "usr_19C7", name: "Aisha Khan", lc: "L5", vrank: "V6", devices: 5, kyc: "verified", risk: 18, balance: 24100, nex: 86300, ref: "NX-1190", frozen: false, joined: "2026-01-28" },
  { id: "usr_55B1", name: "Diego Torres", lc: "L3", vrank: "V1", devices: 1, kyc: "pending", risk: 91, balance: 1240, nex: 2150, ref: "NX-5512", frozen: true, joined: "2026-05-19" },
  { id: "usr_02A9", name: "Yuki Tanaka", lc: "L4", vrank: "V2", devices: 2, kyc: "verified", risk: 54, balance: 5630, nex: 9800, ref: "NX-0029", frozen: false, joined: "2026-04-02" },
  { id: "usr_77D4", name: "Omar Farouk", lc: "L2", vrank: "V0", devices: 1, kyc: "verified", risk: 11, balance: 310, nex: 540, ref: "NX-7741", frozen: false, joined: "2026-05-30" },
  { id: "usr_31E8", name: "Lena Brandt", lc: "L5", vrank: "V8", devices: 6, kyc: "verified", risk: 68, balance: 51200, nex: 154000, ref: "NX-3188", frozen: false, joined: "2025-12-11" },
  { id: "usr_90F0", name: "Sara Lindqvist", lc: "L3", vrank: "V1", devices: 1, kyc: "verified", risk: 9, balance: 890, nex: 1320, ref: "NX-9001", frozen: false, joined: "2026-05-22" },
];

export const CLUSTERS = [
  { id: "CL-318", type: "trade-in 套利", accounts: 12, signal: "minHoldingMonths 规避", score: 88, status: "待处置" },
  { id: "CL-291", type: "trial 循环养号", accounts: 8, signal: "同设备指纹 ×8", score: 81, status: "监控中" },
  { id: "CL-277", type: "welcome gift 刷量", accounts: 23, signal: "同 IP 段 + 支付工具", score: 76, status: "已冻结" },
  { id: "CL-260", type: "刷榜", accounts: 6, signal: "邀请图谱环路", score: 64, status: "监控中" },
];

export const KILLSWITCH = [
  { key: "withdraw", name: "提现", on: true, domain: "D2", desc: "全平台提现流出(应急一键冻结;后台应急新增闸,前端 §9.11d.1 之外)", lastChange: "—", amplifies: true },
  { key: "staking", name: "Staking 锁仓", on: true, domain: "G1", desc: "USDT + NEX 池锁仓产品", lastChange: "—", amplifies: true },
  { key: "genesis", name: "Genesis 经济", on: true, domain: "G4", desc: "创世节点一二级市场 + 分红", lastChange: "—", amplifies: true },
  { key: "exchange", name: "NEX 兑换", on: true, domain: "G2", desc: "NEX↔USDT 三阈值兑换", lastChange: "—", amplifies: true },
  { key: "trial", name: "免费试用", on: true, domain: "H2", desc: "试用配置 · 免费试用引擎", lastChange: "—", amplifies: false },
  { key: "nexv2", name: "NEX v2 Vault", on: true, domain: "G6", desc: "250% APY · 24 月锁仓(P6/m11 上线)", lastChange: "—", amplifies: true },
  { key: "premium", name: "Premium 订阅", on: true, domain: "G5", desc: "$99 月度订阅", lastChange: "—", amplifies: false },
];

export const GEOBLOCK = [
  { cc: "US", name: "United States", blocked: false, scope: "—", reason: "—" },
  { cc: "CN", name: "China", blocked: false, scope: "—", reason: "—(越南本土运营·基准空;监管点名才封)" },
  { cc: "KP", name: "North Korea", blocked: true, scope: "全 endpoint", reason: "制裁名单" },
  { cc: "IR", name: "Iran", blocked: true, scope: "全 endpoint", reason: "制裁名单" },
  { cc: "IN", name: "India", blocked: false, scope: "withdraw 限频", reason: "KYC 加强" },
  { cc: "BR", name: "Brazil", blocked: false, scope: "—", reason: "—" },
];

// SKU 目录 — 前端 Product(Nexion-prototype/lib/mock/products.ts)6 款的完整镜像。
// 数值逐字段对齐前端商品卡(S1 日产 $14.20 + 24 NEX · 可信档年化~400% / 库存 47 / 评分 4.8 …);baseRate 已拆 dailyEarn + dailyEarnNEX(双币真源),
// baseRate 仅留派生展示串。在售 4(on)+ 待发布 2(pending:Pro v2=P3 / Rack P2=P5 代际门未放行)= 6,对齐 metrics「4 / 6」。
// Genesis 属 G4 金融产品(非设备 SKU),已从本目录移除。
export const SKUS = [
  {
    name: "NexionBox S1", id: "stellarbox-s1", tier: "Entry",
    tagline: "Personal AI inference box · fully managed", badge: "Best Seller",
    gpu: "4× RTX 4090", vram: "96GB VRAM", hashRate: "1,240 MH/s", power: "1,200W TDP", datacenter: "Singapore DC",
    price: 1299,
    dailyEarn: 14.2, dailyEarnNEX: 24, baseRate: "$14.20/d · 24 NEX",
    sold: 4821, stock: 47, rating: 4.8, reviews: 2847,
    aiImageGenPerMin: 320, aiLlmTokensPerSec: 12400, aiVideoMinPerHour: 18, aiFineTuneMins: 6, aiUnlocks: "LLM 70B inference pool",
    features: ["Fully managed by Nexion", "99.9% uptime SLA", "Real-time remote monitoring", "Free shipping & installation"],
    generation: 1, lifecycle: "legacy", supersededBy: "stellarbox-pro-v2", tradeinDiscount: 0, unlock: "P1",
    tag: "legacy", status: "on",
  },
  {
    name: "NexionBox Pro", id: "stellarbox-pro", tier: "Pro",
    tagline: "Double the GPUs, double the earning power.", badge: "Trending",
    gpu: "8× RTX 4090", vram: "192GB VRAM", hashRate: "2,480 MH/s", power: "2,400W TDP", datacenter: "Singapore DC",
    price: 2399,
    dailyEarn: 26.3, dailyEarnNEX: 74, baseRate: "$26.30/d · 74 NEX",
    sold: 1842, stock: 23, rating: 4.9, reviews: 1124,
    aiImageGenPerMin: 720, aiLlmTokensPerSec: 38000, aiVideoMinPerHour: 12, aiFineTuneMins: 20, aiUnlocks: "AI Premium pool (Fine-tune + 405B inference)",
    features: ["8× RTX 4090 GPUs", "Priority task allocation", "99.9% uptime SLA", "Hardware insurance included"],
    generation: 1, lifecycle: "legacy", supersededBy: "stellarrack-p2", tradeinDiscount: 0, unlock: "P1",
    tag: "legacy", status: "on",
  },
  {
    name: "NexionBox Pro v2", id: "stellarbox-pro-v2", tier: "Pro",
    tagline: "2.5× S1 throughput — new generation silicon.", badge: "New Gen",
    gpu: "8× RTX 5090", vram: "256GB VRAM", hashRate: "5,120 MH/s", power: "2,200W TDP", datacenter: "Singapore DC",
    price: 2639,
    dailyEarn: 28.9, dailyEarnNEX: 84, baseRate: "$28.90/d · 84 NEX",
    sold: 412, stock: 38, rating: 4.9, reviews: 187,
    aiImageGenPerMin: 1080, aiLlmTokensPerSec: 56000, aiVideoMinPerHour: 24, aiFineTuneMins: 12, aiUnlocks: "AI Premium + multi-tenant 405B",
    features: ["8× RTX 5090 — new silicon generation", "2.5× S1 throughput on AI workloads", "Trade-in: $300 off when retiring a legacy NexionBox", "Hardware insurance + 5-year warranty"],
    generation: 2, lifecycle: "active", supersededBy: "", tradeinDiscount: 300, unlock: "P3",
    tag: "popular", status: "pending",
  },
  {
    name: "NexionRack P1", id: "stellarrack-p1", tier: "Flagship",
    tagline: "Datacenter-grade A100 rack for serious operators.", badge: "Flagship",
    gpu: "8× NVIDIA A100", vram: "640GB VRAM", hashRate: "3,840 MH/s", power: "3,200W TDP", datacenter: "Singapore DC",
    price: 8999,
    dailyEarn: 98.6, dailyEarnNEX: 650, baseRate: "$98.60/d · 650 NEX",
    sold: 287, stock: 8, rating: 4.9, reviews: 154,
    aiImageGenPerMin: 1800, aiLlmTokensPerSec: 128000, aiVideoMinPerHour: 60, aiFineTuneMins: 8, aiUnlocks: "Training pool (RLHF / from-scratch 8B)",
    features: ["Enterprise A100 GPUs", "Dedicated tier-3 datacenter slot", "VIP support · 24/7 hotline", "5-year extended warranty"],
    generation: 1, lifecycle: "legacy", supersededBy: "stellarrack-p2", tradeinDiscount: 0, unlock: "P1",
    tag: "pro", status: "on",
  },
  {
    name: "NexionRack P2", id: "stellarrack-p2", tier: "Flagship",
    tagline: "Datacenter H100 rack — final-tier upgrade window.", badge: "New Gen",
    gpu: "8× NVIDIA H100", vram: "1,024GB VRAM", hashRate: "9,600 MH/s", power: "4,000W TDP", datacenter: "Singapore DC",
    price: 14999,
    dailyEarn: 164.4, dailyEarnNEX: 1200, baseRate: "$164.40/d · 1,200 NEX",
    sold: 64, stock: 4, rating: 5.0, reviews: 41,
    aiImageGenPerMin: 3600, aiLlmTokensPerSec: 256000, aiVideoMinPerHour: 120, aiFineTuneMins: 4, aiUnlocks: "Training pool (RLHF / 70B from-scratch)",
    features: ["8× H100 SXM5 — datacenter-grade Hopper", "Trade-in: $800 off when retiring a legacy Rack", "Dedicated tier-3 DC slot · 24/7 VIP support", "10-year extended warranty + insurance"],
    generation: 2, lifecycle: "active", supersededBy: "", tradeinDiscount: 800, unlock: "P5",
    tag: "limited", status: "pending",
  },
  {
    name: "Cloud Share", id: "cloud-share", tier: "Share",
    tagline: "No hardware needed — buy a slice of the network.", badge: "Low Barrier",
    gpu: "Distributed", vram: "—", hashRate: "", power: "", datacenter: "全球分布式",
    price: 199,
    dailyEarn: 0.073, dailyEarnNEX: 30, shareYieldMin: 8, shareYieldMax: 15, baseRate: "8–15% 年化 · 30 NEX",
    sold: 12483, stock: "∞", rating: 4.6, reviews: 3812,
    aiUnlocks: "Fractional access to network's IG + EM + SP pools",
    features: ["Instant activation", "Buy as little as $199", "Fixed-income style returns", "Redeem any time after 30 days"],
    generation: 1, lifecycle: "active", supersededBy: "", tradeinDiscount: 0, unlock: "P1",
    tag: "", status: "on",
  },
];

// 商品用户评价 seed — 镜像前端 lib/mock/reviews.ts。运营后台 E1 可增删改查。
export const REVIEWS = [
  // 每条评价关联单个具体设备(productId = 设备 id),无通用("*")。镜像前端 reviews.ts。
  { id: "rv-001", productId: "stellarbox-s1", author: "Maya · ID", rating: 5, date: "2 days ago", content: "Paid back in 11 months. Withdrew $186 first month no questions.", status: "published" },
  { id: "rv-002", productId: "stellarbox-s1", author: "Tomás · BR", rating: 5, date: "5 days ago", content: "My first box — simplest passive income I've tried. Daily payout always lands on time.", status: "published" },
  { id: "rv-003", productId: "stellarbox-pro", author: "cypher.eth", rating: 5, date: "1 week ago", content: "Tax-deductible business expense, AI workloads are legitimate. Best ROI in my portfolio.", status: "published" },
  { id: "rv-004", productId: "stellarbox-pro", author: "Wei · SG", rating: 4, date: "2 weeks ago", content: "Doubled my S1's output. Priority task allocation means far fewer idle hours.", status: "published" },
  { id: "rv-005", productId: "stellarbox-pro-v2", author: "Hideo · JP", rating: 4, date: "2 weeks ago", content: "Stable yields. Customer service slow on the first activation. Now running fine.", status: "published" },
  { id: "rv-006", productId: "stellarbox-pro-v2", author: "Lena · DE", rating: 5, date: "3 days ago", content: "2.5x the throughput of my old S1. Trade-in credit made the upgrade painless.", status: "published" },
  { id: "rv-007", productId: "stellarrack-p1", author: "Marcus · US", rating: 5, date: "1 week ago", content: "Datacenter-grade A100s. Dedicated tier-3 slot, zero downtime so far.", status: "published" },
  { id: "rv-008", productId: "stellarrack-p1", author: "Priya · IN", rating: 4, date: "3 weeks ago", content: "Serious capital, but the daily numbers hold up. VIP support actually answers.", status: "published" },
  { id: "rv-009", productId: "stellarrack-p2", author: "Chen · HK", rating: 5, date: "4 days ago", content: "H100 tier, top of the line. Locked in the final upgrade window — no regrets.", status: "published" },
  { id: "rv-010", productId: "cloud-share", author: "Ana · MX", rating: 5, date: "1 week ago", content: "No hardware, started at $199. Fixed-income style returns, redeemed after 30 days fine.", status: "published" },
  { id: "rv-011", productId: "cloud-share", author: "Sam · UK", rating: 4, date: "2 weeks ago", content: "Lowest barrier to get in. Smaller yields but completely hands-off.", status: "published" },
];

// I2 Nova 推送通道 seed(镜像 OpsNova;后台支持增删改查 + kill 启停,真写 platform-config-store.novas + persist + 审计)。
export const NOVA = [
  { key: "welcome", name: "welcome", tick: "注册 8s", cd: "24h", on: true, ctr: 31.2 },
  { key: "market", name: "market-event", tick: "12 min", cd: "30 min", on: true, ctr: 22.4 },
  { key: "upgrade", name: "upgrade-nudge", tick: "15 min", cd: "60 min", on: true, ctr: 28.9 },
  { key: "dailySummary", name: "daily-summary", tick: "每 25 任务", cd: "25 min", on: true, ctr: 34.1 },
  { key: "tradein", name: "tradein-nudge", tick: "15 min", cd: "P3-4 60m", on: true, ctr: 19.8 },
  { key: "social", name: "social-event", tick: "20 min", cd: "30 min", on: true, ctr: 26.5 },
  { key: "eventClaim", name: "event-claimable", tick: "15 min", cd: "60 min", on: true, ctr: 41.3 },
  { key: "wrapped", name: "wrapped", tick: "30d", cd: "one-shot", on: true, ctr: 38.0 },
  { key: "taskLockMonthly", name: "monthly-task-lock", tick: "30 min", cd: "P1-2 30d", on: true, ctr: 24.7 },
  { key: "quest", name: "quest-grace", tick: "5 min", cd: "7d", on: true, ctr: 29.2 },
];

export const AUDIT = [
  { ts: "14:32:08", op: "finance·李", role: "财务", action: "admin.treasury_threshold_changed", obj: "redLine 100%→100%", mc: "李→超管·赵", ip: "10.2.x" },
  { ts: "14:18:44", op: "risk·陈", role: "风控", action: "admin.nova_channel_killed", obj: "quest disable", mc: "陈→内容·周", ip: "10.2.x" },
  { ts: "13:59:01", op: "super·赵", role: "超管", action: "admin.kill_switch_toggled", obj: "nexv2 enable→disable", mc: "风控·陈→赵", ip: "10.1.x" },
  { ts: "13:40:22", op: "support·张", role: "客服", action: "admin.balance_adjusted", obj: "usr_84F2 +$1,200", mc: "张→财务·李", ip: "10.4.x" },
  { ts: "13:12:09", op: "audit·孙", role: "审计", action: "admin.user_list_exported", obj: "row_count=3,204", mc: "—", ip: "10.9.x" },
];

export const REVENUE = { gmv: 4_280_000, commission: 1_140_000, token: 980_000, marketFee: 312_000 };

export const DATA = {
  ROLES, KPIS, TREASURY, LIABILITIES, MATURITY, FUNNEL, PHASE, RISK,
  WITHDRAWALS, APPROVALS, TOPUPS, USERS, CLUSTERS, KILLSWITCH, GEOBLOCK,
  SKUS, NOVA, AUDIT, REVENUE, fmtUsd, fmtM, fmtK,
};
