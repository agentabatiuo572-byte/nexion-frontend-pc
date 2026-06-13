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

// 八项 KPI 唯一权威源(口径 §2.4.6 / 目标 §18.2)。首页 KpiWall(command-center 派生)与 L1 看板均由本表派生,绝不另立数值。
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

/** KPI 状态灯三态(g 达标 / y 预警:距目标 −offset% 区间内,band 型带内但低于 target 也记预警 / r 未达)。
 * 首页与 L1 共用本判定(首页 pass = g),offset 默认 10(L1 视图参数可调)。 */
export function kpiState(k: (typeof KPIS)[number], ylOffset = 10): "g" | "y" | "r" {
  const band = "band" in k ? k.band : undefined;
  if (band && k.dir === "band") {
    if (k.value < band[0] * (1 - ylOffset / 100)) return "r";
    if (k.value < band[0] || k.value > band[1]) return "y";
    return k.value < k.target ? "y" : "g"; // 带内但低于 target = 带内偏低段,记预警
  }
  const pass = k.dir === "gte" ? k.value >= k.target : k.value <= k.target;
  if (pass) return "g";
  const near = k.dir === "gte" ? k.value >= k.target * (1 - ylOffset / 100) : k.value <= k.target * (1 + ylOffset / 100);
  return near ? "y" : "r";
}

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
  injectedCumulative: 300_000, // 手动注入登记累计(D3 储备明细行同源;旧 12.4M 超储备总额 6.34M,不自洽已修)
};

// 8 类负债 = LEDGER.accounts(单源);色用 --admin-cat-* token(不硬编码 hex)。
export const LIABILITIES = LEDGER.accounts.map((a, i) => ({
  id: i + 1,
  name: a.label,
  amount: a.amount,
  color: `var(${a.catVar})`,
}));

// 到期负债预测(未来 7 天,今天=06-11 起含当日;D3 权威源,B2 卡 / L3 报表同数)。
// 量级与 LEDGER 闭合:7 日提现解锁 $348K ≪ 科目#1 可提 $1.18M;7 日利息 $78K < 科目#3 存量 $312K;
// Genesis 日分红 ≈ $20.3K/日 = 已售 847 节点 × $24/节点/日(基数口径:平台日交易量 $24.2M × 0.1% ÷ 1,000 slot;
//   G4 权威调和:科目#4 $268K 按保底口径预提(节点价 × 0.1% = $10/节点/日 × ~31 日),基数口径高出保底的部分
//   从当期交易抽成直接派发不占预提 —— $24/节点/日为产品权威档(14 月回本),与 G4 派发监控同源)。
// (旧值 7 日到期 $4.0M 超科目存量数倍且日期落在过去,2026-06-10 D 域 port 修正;genesis 列 2026-06-11 G 域 port 对齐 $24 档。)
export const MATURITY = [
  { d: "06-11", withdraw: 52000, interest: 11000, genesis: 20300 },
  { d: "06-12", withdraw: 47000, interest: 12000, genesis: 20300 },
  { d: "06-13", withdraw: 63000, interest: 10000, genesis: 20400 },
  { d: "06-14", withdraw: 41000, interest: 13000, genesis: 20400 },
  { d: "06-15", withdraw: 58000, interest: 9000, genesis: 20500 },
  { d: "06-16", withdraw: 38000, interest: 12000, genesis: 20500 },
  { d: "06-17", withdraw: 49000, interest: 11000, genesis: 20600 },
];
// 7 日到期聚合 + 储备可覆盖天数(单源派生;L3 报表 / D3 仪表盘共用,勿另算)。
export const MAT_7D = MATURITY.reduce(
  (s, m) => ({ withdraw: s.withdraw + m.withdraw, interest: s.interest + m.interest, genesis: s.genesis + m.genesis }),
  { withdraw: 0, interest: 0, genesis: 0 },
);
export const RESERVE_COVER_DAYS = Math.round(LEDGER.reserveUsd / ((MAT_7D.withdraw + MAT_7D.interest + MAT_7D.genesis) / 7));

export const FUNNEL = [
  { stage: "注册", ev: "auth.register_completed", users: 128400, cvr: null as number | null, lc: "L1", color: "#9EDC1D", target: undefined as string | undefined },
  { stage: "绑卡 $1 KYC", ev: "kyc.express_verified", users: 97300, cvr: 75.8, lc: "L2", color: "#B6E84A", target: undefined },
  { stage: "首购", ev: "checkout.completed", users: 33180, cvr: 34.1, lc: "L3→L4", target: ">30%", color: "#9B89E0" },
  { stage: "复投", ev: "checkout.completed ×2", users: 8920, cvr: 26.9, lc: "L5", color: "#B6A4FF", target: undefined }, // V1 降级口径(wallet.reinvest 未注册,V3 后切双口径;与 B3/L2 一致)
  { stage: "提现", ev: "withdraw.submitted", users: 21640, cvr: 65.2, lc: "L5", color: "#29D27F", target: undefined },
];

// Phase 现状单一源对齐 command-center.CURRENT_PHASE(P3 扩张期 · 月 7;曾写「月 6 · 拉新加速期」分叉,2026-06-10 收敛)。
export const PHASE = {
  current: "P3",
  month: 7,
  label: "月 7 · 扩张期",
  dials: [
    { key: "withdrawCooldownDays", name: "提现冷却(天)", val: 30, unit: "d", trend: "↑" },
    { key: "complianceHoldEnabled", name: "增强合规审查", val: "未激活(P5 起)", trend: "—" }, // 提现日限非 Phase dial(D5 owns 次数制,PRD §6 D5),旧 withdrawDailyCapUSD 行已纠正
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

// 全平台总注册用户(C 域用户台账 / B3 累计漏斗 / K4 分布共用同一数;改这里 = 三处同步)。
export const REGISTERED_USERS = 128_400;

// ── K 域核心口径(design_handoff_k_domain port · 跨页消费:首页 DOMAIN_PULSE / 雷达 / K1-K5 视图)──
// 簇统计 = base(列表样本窗以外的存量)+ k-tabs 样本实时态;K4 分布以 REGISTERED_USERS 闭合求和。
export const K_RISK = {
  clusterBase: 44, // 监控中簇存量(不含 k1 样本窗 5 簇中的活跃 3 簇 → 合计 47)
  highBase: 7, // 高风险簇(强度≥0.7)存量 → 样本 CL-318(0.88)+CL-322(0.74)计入后 9
  frozenBase: 11, // 已冻结簇存量 → 样本 CL-301 计入后 12
  frozenAccountsBase: 80, // 已冻结账户存量 → +CL-301 6 账户 = 86
  giftBlockedUsd: 2_140, // 新人礼拦截金额(本月,K1/K2 同源)
  giftBlockedCnt: 428, // 新人礼拦截笔数(×200 NEX = 85,600 NEX)
  loopConfirmed: 4, // K2 闭环判定(3 层全中,本月;RISK.alerts K2 行同源)
  loopWarn: 17, // K2 预警转人工(≥2 层,30 天滑动窗)
  boardSignals: 3, // K2 刷榜信号(本期,处置归 F8)
  scoreMid: 9_502, // K4 中风险 40–69
  scoreHigh: 1_790, // K4 高风险 ≥70(低风险 = REGISTERED_USERS − mid − high = 117,108)
  overrideActive: 23, // K4 人工覆盖中
  reviewOpenBase: 10, // K5 待复审存量(样本窗 4 单计入后 14)
  reviewOverdue: 1, // K5 超时工单
  reviewDecidedMonth: 86, // K5 本月已裁决(通过 71 / 驳回 15)
  reviewDecidedPass: 71,
  reviewFrozenUsd: 31_200, // K5 复审期冻结金额(对应提现单在 D2 冻结中)
};

export const RISK = {
  // 挤兑比率 = 24h 提现申请额 ÷ 真实储备(B5 储备生存度量;黄线 20 / 红线 40=J1 R1 自动熔断引用线)。
  // 与 LEDGER.pressureRatio(出金压力比 e(t),流量健康,红线 0.7)两层防线,术语不混用。
  bankRunRatio: 7.9,
  // 异常账户口径 = K1 入簇账户总数(进入任一多账户关联簇的账户数;K4 高风险数是另一口径,见 K_RISK.scoreHigh)。
  flaggedAccounts: 342,
  // kill 闸状态单一源 = KILLSWITCH(本文件 export);此处不再镜像(曾 stale 漏 withdraw,易成陷阱)。
  alerts: [
    { sev: "warn", t: "Day7 留存 58.2% < 60% 目标", src: "B3 漏斗", age: "14m" },
    { sev: "info", t: "团队佣金触发率 76% < 80%", src: "F5 佣金审计", age: "1h" },
    { sev: "warn", t: `K2 闭环判定 ${K_RISK.loopConfirmed} 起(本月) · 预警转人工 ${K_RISK.loopWarn}`, src: "K2 套利检测", age: "2h" },
  ],
};

// ── 提现队列(D2 渲染面 · 全平台提现单唯一源,design_handoff_d_domain port 2026-06-10)──
// 单一时间线:单号/命中规则/时刻与 K3_HITS(k-tabs)逐条对齐;K5 工单(KR-7741/7702/7738/7729)引用同单同人;
// risk = K4 同分单源(USERS.risk 权威;USERS 外 uid 在本表定义,K 域 userRisk 回落本表);riskDims 贡献闭合求和 = risk。
// n24 = 24h 内提交第几笔(含被拒/退回的提交;D5 日限 1 次/日限的是「在途成功单」,被拒后重复提交正是 WR-02 速度信号)。
// st 为种子态,实时态 = pget("D.withdraw.<id>.st");三套旧源(WD-9F3A* / WD-2606-*)已收敛于此。
export type WithdrawalRow = {
  id: string; user: string; amount: number; chain: string; addr: string;
  risk: number; kyc: string; pts: boolean; n24: number; rules: string;
  st: "review-pending" | "delayed" | "frozen" | "review-passed" | "rejected" | "refunded";
  age: string;
  /** 在审的 K5 复审工单号 —— 复审未过禁放行(PRD D2⑦:复审未过维持待确认/延迟)。 */
  holdK5?: string;
  info: [k: string, v: string][];
  riskDims: [name: string, pt: number][];
  hist: string;
};
export const WITHDRAWALS: WithdrawalRow[] = [
  {
    id: "WD-90412", user: "usr_31E8", amount: 8200, chain: "TRC20", addr: "TR7N…f2", risk: 68,
    kyc: "已通过(复审中 K5)", pts: true, n24: 1, rules: "WR-01 大额→转人工", st: "review-pending", age: "24h", holdK5: "KR-7741",
    info: [["用户分层", "L5 · V8 · 设备 6 台"], ["注册", "2025-12-11 · 181 天"], ["推荐位", "NX-3188 主链"], ["冷却", "已到期(30d)"], ["可提余额", "$51,200"], ["KYC 复审(K5)", "KR-7741 进行中 · 剩 6 天"], ["本单放行水位影响", "储备 −$8,200 · 负债科目 #6 同步核减(覆盖率几乎不变)"]],
    riskDims: [["提现速度", 34], ["异常行为", 22], ["账户年龄", 6], ["多账户", 6]],
    hist: "41 笔历史 · 全部正常到账 · 24h 内第 1 笔 · 历史月均提现 $6.8K",
  },
  {
    id: "WD-90408", user: "usr_8807", amount: 240, chain: "ERC20", addr: "0x8a…4f", risk: 83,
    kyc: "待复审", pts: true, n24: 4, rules: "WR-02 提速超限→延迟", st: "delayed", age: "1h",
    info: [["用户分层", "L3 · V1 · 设备 1 台"], ["注册", "2026-05-12 · 29 天"], ["推荐位", "NX-8821(簇 CL-318)"], ["冷却", "已到期(30d)"], ["可提余额", "$340"], ["关联簇", "CL-318 · 已标可疑(K1)"]],
    riskDims: [["多账户", 38], ["套利信号", 24], ["实名状态", 12], ["提现速度", 9]],
    hist: "3 笔历史 · 24h 内第 4 次提交(前 3 笔已拒绝退回)· 全部小额快进快出",
  },
  {
    id: "WD-90402", user: "usr_9F31", amount: 310, chain: "TRC20", addr: "TQ2k…91", risk: 46,
    kyc: "快速实名", pts: true, n24: 1, rules: "WR-03 新账户→延迟", st: "delayed", age: "1h",
    info: [["用户分层", "L1 · V0"], ["注册", "2026-06-05 · 5 天(新)"], ["冷却", "首笔 · 不适用"], ["可提余额", "$340"], ["新账户保护期", "7 天线未过(第 5 天)"]],
    riskDims: [["账户年龄", 28], ["提现速度", 8], ["多账户", 10]],
    hist: "首笔提现 · 注册第 5 天踩 WR-03 新账户线(< 7 天)→ 自动延迟,到期回队列",
  },
  {
    id: "WD-90396", user: "usr_2231", amount: 1950, chain: "BTC", addr: "bc1q…7e", risk: 35,
    kyc: "已通过(复审超时 K5)", pts: true, n24: 1, rules: "WR-04 低信誉地址→冻结", st: "frozen", age: "21d", holdK5: "KR-7702",
    info: [["用户分层", "L4 · V3"], ["注册", "2025-11-20 · 203 天"], ["冻结原因", "目标地址命中链上黑名单(WR-04)"], ["评分备注", "88 → 35 人工覆盖(代理商收款,K4 台账)"], ["KYC 复审(K5)", "KR-7702 已超时 · 升级风控主管"]],
    riskDims: [["地址信誉", 27], ["提现速度", 8]],
    hist: "18 笔历史 · 16 正常 · 本单地址首次使用即命中黑名单(5/20 触发,与 K5 工单同刻)",
  },
  {
    id: "WD-90391", user: "usr_84F2", amount: 1120, chain: "TRC20", addr: "TY8w…c3", risk: 72,
    kyc: "已通过(兑换复审中 K5)", pts: true, n24: 5, rules: "WR-01 + WR-02(主路由转人工)", st: "review-pending", age: "3h",
    info: [["用户分层", "L4 · V3"], ["注册", "2026-03-12 · 89 天"], ["冷却", "已到期"], ["可提余额", "$8,420"], ["24h 提交", "$9,400(5 次,前 4 笔已延迟/拒绝)"], ["KYC 复审(K5)", "KR-7729 大额兑换触发 · 今日"]],
    riskDims: [["提现速度", 34], ["异常行为", 32], ["账户年龄", 6]],
    hist: "24h 内第 5 次提交、夜间集中——典型化整为零特征;按最严合成走 WR-01 转人工",
  },
  {
    id: "WD-90388", user: "usr_8812", amount: 95, chain: "TRC20", addr: "TM4u…b7", risk: 44,
    kyc: "已通过", pts: true, n24: 4, rules: "WR-02 提速超限→延迟", st: "delayed", age: "2h",
    info: [["用户分层", "L2 · V0"], ["注册", "2026-05-17 · 24 天"], ["冷却", "已到期"], ["可提余额", "$210"], ["提交节奏", "24h 第 4 次提交(前 3 笔被拒)"]],
    riskDims: [["提现速度", 30], ["异常行为", 8], ["账户年龄", 6]],
    hist: "小额高频试探 · 与 usr_8807 同模式不同簇 · WR-02 自动延迟观察",
  },
  {
    id: "WD-90385", user: "usr_19C7", amount: 420, chain: "TRC20", addr: "TN3p…a8", risk: 18,
    kyc: "已通过", pts: true, n24: 1, rules: "—", st: "review-pending", age: "12m",
    info: [["用户分层", "L5 · V6"], ["注册", "2026-01-28 · 134 天"], ["冷却", "已到期"], ["可提余额", "$24,100"]],
    riskDims: [["提现速度", 6], ["账户年龄", 2], ["异常行为", 10]],
    hist: "29 笔历史全部正常 · 小额低风险未命中任何规则 · 符合快速通道",
  },
  {
    id: "WD-90376", user: "usr_77D4", amount: 248, chain: "TRC20", addr: "TBn8…1p", risk: 11,
    kyc: "快速实名(升级复审中 K5)", pts: false, n24: 1, rules: "—", st: "review-pending", age: "2d", holdK5: "KR-7738",
    info: [["用户分层", "L2 · V0"], ["注册", "2026-05-30 · 11 天"], ["冷却", "首笔 · 不适用"], ["积分", "不足:5 / 25(每 $100 要 10 分)"], ["可提余额", "$310(本单 $248 = 80% 上限内)"], ["KYC 复审(K5)", "KR-7738 累计过线 · 剩 2 天"]],
    riskDims: [["账户年龄", 6], ["提现速度", 2], ["异常行为", 3]],
    hist: "首笔提现 · 提交时积分足额预扣,6/08 K1 拦截新人礼回收 −20 分 → 门槛不足挂起;非风控命中,等积分补足或人工裁定",
  },
];

export const SENSITIVE_OPERATIONS = [
  { id: "操作确认-2041", action: "提现批量放行", obj: "WD queue · 14 笔", operator: "finance·李", domain: "D2", risk: "高", amount: "$38,400", ts: "2m", reason: "SLA 临近,批量确认", covCheck: false },
  { id: "操作确认-2039", action: "提现参数:日限上调", obj: "dailyLimitCount 1→2 次/日", operator: "growth·王", domain: "D5", risk: "高·放大流出", amount: "—", ts: "18m", reason: "P3 拉新期提升体验", covCheck: true },
  // 与 C3 队列 ADJ-7741 / AUDIT 13:40(admin.balance_adjusted 发起层留痕)同一事件,单一叙事(币种 USDT 对齐 amount)。
  { id: "操作确认-2037", action: "余额调整", obj: "ADJ-7741 · usr_84F2 +$1,200 USDT", operator: "support·张", domain: "C3", risk: "中", amount: "$1,200", ts: "34m", reason: "客诉补偿(工单 #88213)", covCheck: false },
  { id: "操作确认-2034", action: "Kill-Switch 解除", obj: "nexv2 disable→enable", operator: "risk·陈", domain: "J1", risk: "高·放大流出", amount: "—", ts: "1h", reason: "监管核查完毕,恢复 NEX v2", covCheck: true },
];

// ── 充值流水(D1 渲染面;渠道枚举 = 前端 §9.2 五渠道,Card 由主 PSP Checkout.com 处理 · 备 Stripe)──
// 含费自洽:Card 3.5%(500→517.5 / 1299→1344 / 1200→1242 / 800→828);3DS ≥$50 强验(77121 $1,200 验证中)。
// (旧 MoonPay/Banxa/OnChain 为早期发明,与前端 topup 页「Card processed by Checkout.com」及 PRD D1 不符,已收敛。)
export type TopupRow = {
  id: string; user: string; channel: string; amount: number; recvLabel: string;
  proof: string; st: "pending" | "confirmed" | "abnormal"; stLabel: string; t: string;
};
export const TOPUPS: TopupRow[] = [
  { id: "TP-77118", user: "usr_09F4", channel: "USDT-TRC20", amount: 200, recvLabel: "200 USDT", proof: "tx 0x8a4f…", st: "pending", stLabel: "待链上确认 12/19", t: "14:08" },
  { id: "TP-77121", user: "usr_43B8", channel: "Card", amount: 1200, recvLabel: "$1,242 含费", proof: "3DS 验证中", st: "pending", stLabel: "银行验证中", t: "14:21" },
  { id: "TP-77120", user: "usr_22A1", channel: "Card", amount: 500, recvLabel: "$517.5 含费", proof: "psp ch_88a2…", st: "confirmed", stLabel: "已入账 · 已计终身入金", t: "13:55" },
  { id: "TP-77119", user: "usr_61C2", channel: "Card", amount: 1299, recvLabel: "$1,344 含费", proof: "psp ch_87f1…", st: "confirmed", stLabel: "已入账", t: "13:40" },
  { id: "TP-77116", user: "usr_88E0", channel: "USDT-TRC20", amount: 99, recvLabel: "99 USDT", proof: "tx 0x77be…", st: "confirmed", stLabel: "已入账", t: "12:18" },
  { id: "TP-77113", user: "usr_19C7", channel: "ETH", amount: 2400, recvLabel: "0.92 ETH", proof: "tx 0x2208…", st: "confirmed", stLabel: "已入账", t: "11:02" },
  { id: "TP-77117", user: "usr_43B8", channel: "Card", amount: 3499, recvLabel: "—", proof: "高风险卡段", st: "abnormal", stLabel: "银行拒绝 · 待人工", t: "13:21" },
  { id: "TP-77102", user: "usr_55B1", channel: "Card", amount: 800, recvLabel: "$828 含费", proof: "拒付 4837", st: "abnormal", stLabel: "已发生拒付 → 处置区", t: "昨天" },
  { id: "TP-77095", user: "usr_77D4", channel: "USDT-TRC20", amount: 420, recvLabel: "420 USDT", proof: "tx 0x9912…", st: "abnormal", stLabel: "超时未入账 · 对账差异", t: "昨天" },
];

// ── D 域聚合口径(D1-D5 stat 与首页/操作确认中心共用;base+样本窗模式,base 已逐条过筛)──
export const D_FUND = {
  feeBufferUsd: 96_400, // 风控备付金(Card 3.5% 累计,非利润口径)
  binLockedBase: 1, // BIN 锁卡存量(样本窗 3 条锁定计入后 = 4)
  payoutTodayUsd: 48_600, // 今日已放行(186 笔 · 平均 6.2h 到账)
  payoutTodayCnt: 186,
  payoutAvgHours: 6.2,
  applyTodayCnt: 212, // 今日提现申请笔数(D5 stat)
  wdPendingBase: 19, // 待人工存量(样本窗 review-pending 4 单计入后 = 23)
  wdLargeBase: 2, // 其中大额存量(样本窗大额待确认 90412/90391 计入后 = 4)
  wdBacklogBaseUsd: 31_000, // 在审积压金额存量(样本窗 review-pending 4 单 $9,988 计入后 ≈ $41.0K)
  wdFrozenBase: 4, // 冻结存量(样本窗 WD-90396 计入后 = 5)
  wdFrozenBaseUsd: 10_450, // 冻结金额存量(+$1,950 = $12.4K)
  billsTodayCnt: 38_412, // 今日落账笔数(8 类合计,D4 stat;adjustment = C3 人工调整专类)
  billBreakCnt: 2, // 账实不符告警户数(D4 断点)
  ledgerMatchPct: 99.998, // 账实相符率
  billRetentionMonths: 13, // 账单保留期(完整 12 月周期 + 1 月缓冲)
};

export const USERS = [
  { id: "usr_84F2", name: "Marcus Lee", lc: "L4", vrank: "V3", devices: 2, kyc: "verified", risk: 72, balance: 8420, nex: 12400, ref: "NX-8821", frozen: false, joined: "2026-03-12" },
  { id: "usr_19C7", name: "Aisha Khan", lc: "L5", vrank: "V6", devices: 5, kyc: "verified", risk: 18, balance: 24100, nex: 86300, ref: "NX-1190", frozen: false, joined: "2026-01-28" },
  { id: "usr_55B1", name: "Diego Torres", lc: "L3", vrank: "V1", devices: 1, kyc: "pending", risk: 91, balance: 1240, nex: 2150, ref: "NX-5512", frozen: true, joined: "2026-05-19" },
  { id: "usr_02A9", name: "Yuki Tanaka", lc: "L4", vrank: "V2", devices: 2, kyc: "verified", risk: 54, balance: 5630, nex: 9800, ref: "NX-0029", frozen: false, joined: "2026-04-02" },
  { id: "usr_77D4", name: "Omar Farouk", lc: "L2", vrank: "V0", devices: 1, kyc: "verified", risk: 11, balance: 310, nex: 540, ref: "NX-7741", frozen: false, joined: "2026-05-30" },
  { id: "usr_31E8", name: "Lena Brandt", lc: "L5", vrank: "V8", devices: 6, kyc: "verified", risk: 68, balance: 51200, nex: 154000, ref: "NX-3188", frozen: false, joined: "2025-12-11" },
  { id: "usr_90F0", name: "Sara Lindqvist", lc: "L3", vrank: "V1", devices: 1, kyc: "verified", risk: 9, balance: 890, nex: 1320, ref: "NX-9001", frozen: false, joined: "2026-05-22" },
];

// (旧 CLUSTERS 四行简表已随 K 域设计稿 port 移除 —— 簇明细唯一渲染面在 k-tabs/data.ts K1_CLUSTERS,
//  跨页只消费 K_RISK 聚合口径,避免簇数据双源。)

// Kill-Switch 7 闸(前端 §9.11d.1 的 6 + 后台应急新增 withdraw;主人 2026-06-05 拍板)。
// PRD §15.2 完整字段:coverageImpactCategory(资金语义)/ coveragePrecheckRequired(恢复前置 B1)/
// proposalStatus / operator / role_gate(操作确认角色)。B5 雷达与首页从本表 + store(J.killswitch.<key>)派生,单一源。
export const KILLSWITCH = [
  { key: "withdraw", name: "提现", on: true, domain: "D2", cap: "D2 全平台提现流出", desc: "熔断 → 全部提现暂停 · 在途请求冻结待恢复", lastChange: "2d 前 · risk@nexion / super@nexion", amplifies: true, coverageImpactCategory: "immediate", coveragePrecheckRequired: true, proposalStatus: "idle", operator: "risk", roleGate: "super" },
  { key: "staking", name: "Staking 锁仓", on: true, domain: "G1", cap: "G1 Staking 池整体", desc: "熔断 → 新增质押停止 · 存量产出按 R-A 衰减续算", lastChange: "5d 前 · ops@nexion / sec@nexion", amplifies: true, coverageImpactCategory: "delayed", coveragePrecheckRequired: true, proposalStatus: "idle", operator: "risk", roleGate: "super" },
  { key: "genesis", name: "Genesis 经济", on: true, domain: "G4", cap: "G4 Genesis 一二级 + 分红", desc: "熔断 → (a)分红派发暂停 · (b)一二级流转冻结", lastChange: "12d 前 · risk@nexion / super@nexion", amplifies: true, coverageImpactCategory: "immediate", coveragePrecheckRequired: true, proposalStatus: "idle", operator: "risk", roleGate: "super" },
  { key: "exchange", name: "NEX 兑换", on: true, domain: "G2", cap: "G2 NEX↔USDT swap", desc: "熔断 → NEX→USDT 即时流出停 · 联动 G2 价格快照", lastChange: "3d 前 · risk@nexion / super@nexion", amplifies: true, coverageImpactCategory: "immediate", coveragePrecheckRequired: true, proposalStatus: "idle", operator: "risk", roleGate: "super" },
  { key: "trial", name: "免费试用", on: true, domain: "H2", cap: "H2 free-trial entry", desc: "熔断 → 新试用领取关闭 · shadow earning 不入余额", lastChange: "21d 前 · ops@nexion / super@nexion", amplifies: false, coverageImpactCategory: "none", coveragePrecheckRequired: false, proposalStatus: "idle", operator: "ops", roleGate: "super" },
  { key: "nexv2", name: "NEX v2 Vault", on: true, domain: "G6", cap: "G6 NEX v2 Founders Vault", desc: "熔断 → NEX v2 锁仓新开停止 · 时滞流出", lastChange: "9d 前 · risk@nexion / super@nexion", amplifies: true, coverageImpactCategory: "delayed", coveragePrecheckRequired: true, proposalStatus: "idle", operator: "risk", roleGate: "super" },
  { key: "premium", name: "Premium 订阅", on: true, domain: "G5", cap: "G5 Premium 订阅", desc: "熔断 → Premium 订阅购买 / 续费关闭", lastChange: "18d 前 · ops@nexion / super@nexion", amplifies: false, coverageImpactCategory: "none", coveragePrecheckRequired: false, proposalStatus: "idle", operator: "ops", roleGate: "super" },
];

// Geo-block 三态名单(PRD §15.3):blocked 黑名单(全功能封禁)/ limited 受限只读(可登录浏览,禁新增资金操作)。
// activeCountries = status==="blocked" 集合;allowed 国家不入表。仅 J2 消费;变更经 风控 操作员 · 执行门槛:合规审计 (财务不参与)。
export const GEOBLOCK = [
  { cc: "KP", name: "North Korea", status: "blocked", reason: "OFAC 制裁名单" },
  { cc: "IR", name: "Iran", status: "blocked", reason: "OFAC + FATF 制裁名单" },
  { cc: "SY", name: "Syria", status: "blocked", reason: "OFAC 制裁名单" },
  { cc: "CN", name: "China Mainland", status: "limited", reason: "金融监管 · 证券类风险" },
  { cc: "US", name: "United States", status: "limited", reason: "SEC 合规未取得" },
  { cc: "RU", name: "Russia", status: "limited", reason: "OFAC 金融制裁" },
  { cc: "CU", name: "Cuba", status: "limited", reason: "OFAC 制裁名单" },
  { cc: "MM", name: "Myanmar", status: "limited", reason: "FATF 高风险地区" },
] as const;

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
  ROLES, KPIS, TREASURY, LIABILITIES, MATURITY, FUNNEL, PHASE, RISK, K_RISK,
  WITHDRAWALS, SENSITIVE_OPERATIONS, TOPUPS, USERS, KILLSWITCH, GEOBLOCK,
  SKUS, NOVA, AUDIT, REVENUE, fmtUsd, fmtM, fmtK,
};
