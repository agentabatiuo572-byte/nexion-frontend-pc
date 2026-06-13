/**
 * H 域(增长与运营节奏)页面级数据 —— design_handoff_h_domain port。
 * 单源纪律(权威数值零复制,全部 join 或同源派生):
 *  - DIAL_MATRIX 12 月 × 10 旋钮(H1 矩阵权威;设计稿 M[12][10] 原样移植 + DIAL_LABELS/LOOSEN/NEWONLY);
 *  - TRIAL_CONFIG 19 参数(H2;敏感 🔥 操作确认 / 其余增长直改必填原因)+ 4 道前置闸 + 7 态会话 + 4 行 sessions;
 *  - DAY_ONE_TASKS 6 + WEEKLY_T1 9 + WEEKLY_T2 8 + WEEKLY_MULT 6 档 + MONTHLY 5 主题(H3);
 *  - EVENTS_CMS 8 玩法 + WHEEL 8 档 + WHEEL_GUARDS 3 行(H4)+ TRACKABLES 4 行;
 *  - CHECKIN_RULES + STREAK_MS 7 阶 + POWER_UPS 4 档 + EARN_MS 5 档(H5+H6);
 *  - 阶段 = design-data.PHASE 单源(P3 · 月 7 — 与本域旧 h-view PHASE_RO 同源);旧 d-view PHASE_RO 已上收 design-data。
 *  - 覆盖率 = LEDGER 单源(放松方向 dial / 升奖励 / 升概率 / 升 NEX 奖励 / 降门槛 amplifies B1 红线核验)。
 * **H 域三铁律 server-canonical 承诺**(SPEC §4 + 设计稿 f-foot):
 *  ① 概率公开 + 抽签平台掌(server RNG + NODE_ENV guard,客户端裁决永不外泄);
 *  ② 升奖励 / 升概率 / 升增益 / 降门槛 = 放大流出 → 提交即过 B1 红线(422),audit 带 coverageAtSubmit;
 *  ③ in-flight 按入窗 / 入周 / 跨档快照结算(改窗 A/B 方案二选一,不追溯);
 *  ④ H2 failRate 永不下发前端;auto-push 急停实时;
 *  ⑤ H4 转盘三护栏(概率 = 100 / 档位 ∈ [2,12] / 真实奖过 B1)+ B1 自动降级(< 100% 真钱档暂停);
 *  ⑥ H5 幸运两档和 ≤ 100% / H6 门槛严格保序 / cascade 快照串行;
 *  ⑦ 转盘日桶 `eventId × userId × spinDate` 409;featured 唯一 422;ended 优先 409。
 * 真写键 18 类(H.*):
 *  H.phase.dial.<k>(H1 矩阵 + 旧 h-view 同源)/ H1.dial.<k>.m<N>(H1 逐月 cell)/ H1.ctl.{schedule,pin,override}(H1 切换)/
 *  H1.override.<id>.disabled(override 撤销)/ H.phase.{pin,cohortOverride}(沿用旧)/
 *  H2.<key>(19 参数 · key = days/price/shadow/offsetCap/disc/hq/failRate/trialCooldown/push/autoCharge)/
 *  H2.cancel.<sid> / H2.charge.<sid> / H2.autoPushKilled /
 *  H3.dayOne.{windowMs,triReward,<id>.reward,tasks} · H3.weekly.{t1.<idx>,t2.<idx>,champBonus,mult.<P>} · H3.monthly.<id>.reward /
 *  H4.event.<id>.{status,reward,featured,geo,timeWindow} /
 *  H4.wheel(奖池签名)/ H4.guard.{budget,cap,kill}/ H5.{baseline,bonus7,p15,p2,broken,saver,ms.<i>,pu.<i>} /
 *  H6.<i>(收益里程碑)/ H6.tick(触发间隔)。
 */
import { PHASE, fmtUsd } from "@/lib/mock/admin/design-data";
import { LEDGER } from "@/lib/mock/admin/ledger";

/* ============ H1 Phase 调度器 ============ */

export const H1_STATS = {
  currentMonth: PHASE.month, // 7
  currentPhase: PHASE.current, // "P3"
  globalRatio: "96.8%",
  overrideRatio: "3.2%",
  coverageRatio: LEDGER.coverageRatio.toFixed(1),
  redlinePct: LEDGER.redlinePct,
  pendingProposals: 2,
};

/** 10 旋钮 key(列序权威 = 设计稿 DIALS 顺序)。 */
export const DIAL_KEYS = [
  "newUser", "invite", "reinvest", "points", "cooldown",
  "binaryCap", "premium", "nexv2", "quest", "compliance",
] as const;
export type DialKey = typeof DIAL_KEYS[number];

/** 10 旋钮 label(设计稿 NAMES 列头)。 */
export const DIAL_LABELS: Record<DialKey, { name: string; unit: string }> = {
  newUser: { name: "新用户加成¹", unit: "×" },
  invite: { name: "邀请加成¹", unit: "×" },
  reinvest: { name: "复投加成", unit: "×" },
  points: { name: "提现积分比", unit: "分/$100" },
  cooldown: { name: "提现冷却", unit: "天" },
  binaryCap: { name: "双轨日封顶", unit: "$" },
  premium: { name: "Premium 可用", unit: "" },
  nexv2: { name: "NEXv2 可用", unit: "" },
  quest: { name: "任务加成", unit: "×" },
  compliance: { name: "合规留存", unit: "" },
};

/** 放松方向(降冷却 / 降积分门 / 升封顶)= 放大流出,过 B1 红线 422。 */
export const LOOSEN_DIR: Partial<Record<DialKey, "down" | "up">> = {
  points: "down",
  cooldown: "down",
  binaryCap: "up",
};

/** 仅新用户(存量锁定基数不回溯);其余 8 项实时全量生效。 */
export const NEW_USER_ONLY: DialKey[] = ["newUser", "invite"];

/** 12 月 × 10 旋钮值矩阵(设计稿 M 原样,行 = 月 1..12,列 = DIAL_KEYS)。 */
export const DIAL_MATRIX: (number | string)[][] = [
  /* M1 */ [2, 2, 1, 10, 30, 5000, "否", "否", 4, "否"],
  /* M2 */ [2, 2, 1, 10, 30, 5000, "否", "否", 4, "否"],
  /* M3 */ [1.5, 1.5, 1, 10, 30, 5000, "否", "否", 1, "否"],
  /* M4 */ [1.5, 1.5, 1, 10, 30, 5000, "否", "否", 1, "否"],
  /* M5 */ [1, 1, 2, 10, 30, 5000, "否", "否", 1, "否"],
  /* M6 */ [1, 1, 2, 10, 30, 5000, "否", "否", 1, "否"],
  /* M7 */ [1, 1, 1, 10, 30, 2000, "是", "否", 1, "否"],
  /* M8 */ [1, 1, 1, 10, 35, 2000, "是", "否", 1, "是"],
  /* M9 */ [1, 1, 1, 20, 45, 2000, "是", "否", 1, "是"],
  /* M10 */ [1, 1, 1, 20, 45, 2000, "是", "否", 1, "是"],
  /* M11 */ [1, 1, 1, 20, 45, 2000, "是", "是", 1, "是"],
  /* M12 */ [1, 1, 1, 20, 45, 2000, "是", "是", 1, "是"],
];

/** 月 → 阶段映射桶(P3 收紧期持续 3 月,与 design-data.PHASE.month=7 + PHASE.current="P3" 单源一致;
 *  曾用 `Math.ceil(m/2)` 机械公式会把月 7 算成 P4,与全站 PHASE.current="P3" 矛盾,2026-06-12 H 域 port audit 拍定查表。 */
const PHASE_BUCKETS: ReadonlyArray<{ phase: string; months: readonly number[] }> = [
  { phase: "P1", months: [1, 2] },
  { phase: "P2", months: [3, 4] },
  { phase: "P3", months: [5, 6, 7] },
  { phase: "P4", months: [8] },
  { phase: "P5", months: [9, 10] },
  { phase: "P6", months: [11, 12] },
];
/** 月 → 阶段(查表)。月号超界回退 P1(理论不会发生,12 月节奏闭环)。 */
export const monthToPhase = (m1: number): string =>
  PHASE_BUCKETS.find((b) => b.months.includes(m1))?.phase ?? "P1";

/** Phase 切换控制 3 类(定时 / pin / override)。 */
export const PHASE_CONTROLS = [
  { key: "schedule", name: "定时按月推进", sub: "当前时间表:每月 1 日 00:00 UTC 自动 +1 月,产 phase.transitioned", current: "每月 1 日自动推进" },
  { key: "pin", name: "手动钉住(pin)", sub: "把全局或指定批次钉在某阶段——演示、应急冻结、活动对齐用", current: "未钉住" },
  { key: "override", name: "批次加速 / 延迟(override)", sub: "按注册周整体偏移其阶段进度(+N 月 / −N 月),分批放量或收紧", current: "无生效 override" },
];

/** 生效中的覆盖台账演示(2 行)。 */
export const PHASE_OVERRIDES = [
  { id: "2026-W18", desc: "加速 +1 月(测试 P4 转化)· 命中 24,880 人", cohort: "2026-W18 批次" },
  { id: "demo", desc: "钉在 P6(投资人演示)· 长期", cohort: "demo 批次(42 人)" },
];

/** Phase 效果归因 3 行(B4 节奏看板上游)。 */
export const PHASE_ATTRIBUTION = [
  { phase: "P1 引爆(月1-2)", first: "5.4%", reinvest: "18%", weekly: "$1.9M", d7: "64.1%", cur: false },
  { phase: "P2 扩张(月3-4)", first: "6.2%", reinvest: "21%", weekly: "$2.6M", d7: "61.0%", cur: false },
  { phase: "P3 收紧(月5-7)· 当前", first: "6.8%", reinvest: "26.9%", weekly: "$2.1M", d7: "58.2%", cur: true },
];

/* ============ H2 免费试用引擎 ============ */

export const H2_STATS = {
  activeSessions: 11_273,
  inTrial: 9_840,
  inGrace: 1_180,
  inExtended: 253,
  trialBuyRate: "22.4%",
  bindCardRate: "61.2%",
  // failRateDisplayed 已删(2026-06-12 audit R1):该字段是 server 端展示口径,前端 bundle 出现该数值
  // 与 SPEC §4「failRate 永不下发前端」字面冲突;UI 上扣款失败由 4 道前置闸 + status=failed 显示,
  // 不需要把 4.1% 数字预渲染。需要时直接读 server。
  earlyBuyRate: "38%",
  reviveRate: "9%",
  k2Blocked: 17,
};

/** 19 试用参数(只影响新开 / 实时生效 两段)。hot = 敏感操作确认(机价 / 失败概率 / 自动扣款)。 */
export type TrialParam = {
  key: string;
  name: string;
  sub?: string;
  cur: string;
  hot: boolean;
  section: "newonly" | "live";
  /** failRate 仅 server 可见,UI 上隐藏数值(SPEC §4)。 */
  serverOnly?: boolean;
};
export const TRIAL_CONFIG: TrialParam[] = [
  /* 只影响新开试用(进行中按开始时锁定) */
  { key: "days", name: "试用天数 / 宽限期 / 延长天数", cur: "3 / 7 / 3 天", hot: false, section: "newonly" },
  { key: "price", name: "试用机价 🔥", sub: "对应机型 stellarbox-s1(改机型走治理)", cur: "$1,299", hot: true, section: "newonly" },
  { key: "shadow", name: "每日影子收益", cur: "$38.52 + 65 NEX", hot: false, section: "newonly" },
  /* 实时生效(每次结算/渲染读最新值) */
  { key: "offsetCap", name: "收益抵扣购机款上限", sub: "抵扣是折扣不是负债;超出部分购后才入余额", cur: "$50", hot: false, section: "live" },
  { key: "disc", name: "提前购买折扣 / 折扣上限", cur: "15% / $20", hot: false, section: "live" },
  { key: "hq", name: "高质量延长触发线", cur: "$100", hot: false, section: "live" },
  { key: "failRate", name: "扣款失败概率 🔥", sub: "平台内部参数,不外泄到用户界面", cur: "•••(server only)", hot: true, section: "live", serverOnly: true },
  // trialCooldown(2026-06-12 audit R1 改名):原 key="cooldown" 与 H1.dial.cooldown(提现冷却)命名空间冲突,
  // grep 跨域消费时极易串口径(H1 提现冷却挂 B1,H2 再试用冷却不挂)。改 trialCooldown 显式区分。
  { key: "trialCooldown", name: "再试用冷却 / 本阶段开放", sub: "开放与否随 H1 阶段调度", cur: "30 天 / 开放", hot: false, section: "live" },
  { key: "push", name: "auto-push(延迟 / 冷却 / 单会话上限)", cur: "1.5s / 24h / 1 次", hot: false, section: "live" },
  { key: "autoCharge", name: "期末自动扣款 🔥", sub: "关掉=停止自动扣款,直接影响资金——按敏感项操作确认;生效时机待 PM 确认", cur: "开", hot: true, section: "live" },
];

/** 4 行会话演示 + 7 态状态机。 */
export const SS_STATE = {
  idle: ["待启动", "dim"],
  active: ["试用中", "ok"],
  grace: ["宽限中", "warn"],
  extended: ["已延长", "warn"],
  cancelled: ["已取消", "dim"],
  redeemed: ["已购买", "ok"],
  failed: ["扣款失败", "bad"],
} as const;
export type SsState = keyof typeof SS_STATE;

export const TRIAL_SESSIONS: { sid: string; state: SsState; shadow: string; cardTok: string }[] = [
  { sid: "usr_9921", state: "active", shadow: "$115 + 195 NEX", cardTok: "tok_88a2" },
  { sid: "usr_2231", state: "grace", shadow: "$231 + 390 NEX", cardTok: "tok_71f0" },
  { sid: "usr_8807", state: "extended", shadow: "$308 + 520 NEX", cardTok: "tok_8a3f(CL-318)" },
  { sid: "usr_77D4", state: "cancelled", shadow: "归零", cardTok: "tok_9912" },
];

/** 4 道前置闸(SPEC §4 H2)。 */
export const TRIAL_GATES = [
  { gate: "资格统一裁决", note: "冷却/阶段未开/养号都开不了" },
  { gate: "30 天冷却", note: "K2 簇命中跨号生效,绕不过" },
  { gate: "K2 循环阻断", note: "养号信号实时关闭资格" },
  { gate: "扣款幂等", note: "Idempotency-Key 24h dedup · 重复请求只生效一次" },
];

/* ============ H3 任务引擎 + H4 活动 ============ */

/** 当前 Phase 的周倍率(派生 WEEKLY_MULT,2026-06-12 audit R1):
 *  原 H3_STATS.phaseBonusP3 = "×1.1(P3)" 死编码,改任一处倍率另一处不动。
 *  改派生 = 改 WEEKLY_MULT 当前 Phase 行 mult 后,KPI 自动跟随。 */
const _currentPhaseMult = (): string => {
  // WEEKLY_MULT 中 "P3 当前" 命中 PHASE.current(此处不能 import WEEKLY_MULT 因还没声明,
  // 用闭包延迟读;实际 runtime 时 WEEKLY_MULT 已初始化)。
  // 在 phaseBonusP3 getter 处取真值。
  return "×1.1"; // 仅作占位,实际值由 phaseBonusP3 getter 派生
};
void _currentPhaseMult; // 占位,getter 在 H3_STATS 中按 PHASE 派生

export const H3_STATS = {
  dayOneRate24h: "71%",
  dayOneRateGrace: "18%",
  weeklyDone: "184K",
  t1Done: "38K",
  t2Done: "146K",
  weeklyNex: "2.4M NEX",
  // phaseBonusP3 派生 WEEKLY_MULT + design-data.PHASE 单源:
  //   .find(m => m.p.startsWith(PHASE.current))?.mult + "(" + PHASE.current + ")"
  // 因 WEEKLY_MULT 在下方声明,这里用 getter 延迟求值。
  get phaseBonusP3(): string {
    const row = WEEKLY_MULT.find((m) => m.p.startsWith(PHASE.current));
    return row ? `${row.mult}(${PHASE.current})` : `×1(${PHASE.current})`;
  },
  monthlyInflight: 31_240,
};

export const H4_STATS = {
  ongoing: 6,
  featuredEv: "Pro 限时升级",
  trackJoin: "12.4K",
  trackDone: "3.1K",
  trackClaim: "2.8K",
  wheelToday: "$642 / $2,000",
  geoBlocked: 2,
};

/** 6 首日任务(NEX/USDT)。 */
export const DAY_ONE_TASKS = [
  { task: "绑卡", href: "topup?kyc=1", reward: "50 NEX" },
  { task: "逛收益页", href: "/earn", reward: "30 NEX" },
  { task: "逛商城", href: "/store", reward: "50 NEX" },
  { task: "看回报率", href: "/store/roi", reward: "100 NEX" },
  { task: "设资料", href: "/me/profile", reward: "80 NEX" },
  { task: "邀请好友", href: "/team/invite", reward: "200 NEX + $1" },
];

/** 三相状态机(首日)。 */
export const DAY_ONE_STATES = [
  { st: "active", label: "24h 内 6 项完成领 500", tone: "ok" },
  { st: "grace", label: "72h 内 200", tone: "warn" },
  { st: "expired", label: "0,首页让位", tone: "dim" },
];

/** 周一档 9 条(优先级派发,从上到下)。 */
export const WEEKLY_T1 = [
  { cond: "NEXv2 锁仓", reward: "3,000" },
  { cond: "买 Genesis", reward: "2,500" },
  { cond: "加购硬件", reward: "2,000" },
  { cond: "换新升级", reward: "1,800" },
  { cond: "S1→Pro v2", reward: "1,500" },
  { cond: "订阅会员", reward: "800" },
  { cond: "首购设备", reward: "1,000 + $10" },
  { cond: "充值", reward: "100" },
  { cond: "兑底质押", reward: "250" },
];

/** 周二档 8 条(完成池)。 */
export const WEEKLY_T2 = [
  { cond: "邀请好友", reward: "200 + $2" },
  { cond: "复投", reward: "120" },
  { cond: "小额质押", reward: "150" },
  { cond: "兑换", reward: "80" },
  { cond: "小充", reward: "100" },
  { cond: "逛商城", reward: "50" },
  { cond: "跑单 50 次", reward: "80" },
  { cond: "看 Genesis", reward: "60" },
];

/** 6 阶段倍率曲线(P3 = 当前,加成 ×1.1)。 */
export const WEEKLY_MULT = [
  { p: "P1", mult: "1.0×" },
  { p: "P2", mult: "1.0×" },
  { p: "P3 当前", mult: "1.1×" },
  { p: "P4", mult: "1.2×" },
  { p: "P5", mult: "1.3×" },
  { p: "P6", mult: "1.5×" },
];

/** 5 主题月度挑战(按账龄派发)。 */
export const MONTHLY_MISSIONS = [
  { id: "mc0", theme: "地基建设者", age: "0–2 月", reward: "1,500", goals: "累计赚 200 · 绑卡 · 邀 1 人" },
  { id: "mc1", theme: "网络架构师", age: "2–4 月", reward: "2,500", goals: "累计 1,500 · 直推 3 · 周任务 ×4" },
  { id: "mc2", theme: "进阶之路", age: "4–6 月", reward: "4,000", goals: "累计 5,000 · 订阅 · 加购" },
  { id: "mc3", theme: "钻石段位", age: "6–9 月", reward: "6,000", goals: "累计 15,000 · V4 · 团队 GV" },
  { id: "mc4", theme: "创始人之约", age: "9+ 月", reward: "10,000 + 勋章", goals: "累计 40,000 · NEXv2 · Genesis" },
];

/** 完成 / 领取监控(服务器台账)。 */
export const TASK_MONITOR = [
  { label: "首日", note: "进窗 28,940 · 24h 领 71% · 宽限领 18% · 流失 11%" },
  { label: "每周", note: "派发 96K 人 · 一档完成 38K · 二档完成 146K 项" },
  { label: "月度", note: "在途 31,240 · 本月可领 4,120 · 已领 3,880" },
];

/** EventKind 闭集 8 种,当前 demo 数据 7 条(boost / seasonal 未展示)— 2026-06-12 audit R1 收敛口径:
 *  此前注释「8 玩法」与 demo 7 条不对账,改为「闭集 8 种 / 演示 N 条」分开陈述。
 *  upcoming/ongoing/ended 三态 + joined/done/claimed 三态(SPEC §0)。 */
export type EventKind = "discount" | "referral" | "wheel" | "regional" | "onboarding" | "boost" | "seasonal" | "holding";
export type EventState = "upcoming" | "ongoing" | "ended";
export const EVENT_STATE: Record<EventState, [label: string, tone: string]> = {
  upcoming: ["预告", "dim"],
  ongoing: ["进行中", "ok"],
  ended: ["已结束", "dim"],
};

export const EVENTS_CMS: { id: string; name: string; kind: EventKind; state: EventState; reward: string; featured: boolean; trackable: boolean; condition?: string; geo?: string }[] = [
  { id: "pro-7d", name: "Pro 限时升级 7 天", kind: "discount", state: "ongoing", reward: "2,000 NEX", featured: true, trackable: true, condition: "持有 Pro 或以上(设备域)", geo: "全区" },
  { id: "ref-5", name: "邀 5 人得 Pro", kind: "referral", state: "ongoing", reward: "5,000 NEX", featured: false, trackable: true, condition: "直推数 ≥ 5(团队域)", geo: "全区" },
  { id: "spring-wheel", name: "春日转盘(日重置)", kind: "wheel", state: "ongoing", reward: "见奖池", featured: false, trackable: false, condition: "—", geo: "全区" },
  { id: "onboard-7d", name: "新人 7 日引导", kind: "onboarding", state: "ongoing", reward: "200 NEX", featured: false, trackable: true, condition: "7 天内完成 4 项", geo: "全区" },
  { id: "regional-pk", name: "区域算力 PK", kind: "regional", state: "upcoming", reward: "—", featured: false, trackable: false, condition: "—", geo: "全区" },
  { id: "anniv-wheel", name: "周年转盘", kind: "wheel", state: "ended", reward: "见奖池", featured: false, trackable: false, condition: "—", geo: "全区" },
  { id: "nex-div", name: "NEX 持有者分红", kind: "holding", state: "ongoing", reward: "见奖池", featured: false, trackable: true, condition: "NEX 余额 ≥ 1,000(代币域)", geo: "2 国屏蔽" },
];

/** 转盘 8 档(SPEC §0:概率合计 = 100%,EV ≈ $0.78/spin)。real = 真实流出。 */
export const WHEEL_TIERS = [
  { tier: "安慰奖", reward: "+5 NEX", prob: 38, real: false, kind: "平台内" },
  { tier: "小积分", reward: "+50 积分", prob: 24, real: false, kind: "平台内" },
  { tier: "小 NEX", reward: "+30 NEX", prob: 18, real: false, kind: "平台内" },
  { tier: "中 NEX", reward: "+150 NEX", prob: 11, real: false, kind: "平台内" },
  { tier: "小额现金", reward: "$1", prob: 5, real: true, kind: "真实流出" },
  { tier: "购机抵扣券", reward: "$50 券(只抵购机)", prob: 3, real: false, kind: "转化导向" },
  { tier: "中额现金", reward: "$20", prob: 0.9, real: true, kind: "真实流出" },
  { tier: "大奖", reward: "$500", prob: 0.1, real: true, kind: "真实流出" },
];

/** 转盘真实流出期望(EV)派生 helper(2026-06-12 audit R1):
 *  设计稿 README 写 ≈ $0.78/spin,WHEEL_TIERS 实算 $1×5% + $20×0.9% + $500×0.1% = $0.05+0.18+0.5 = $0.73。
 *  改派生避免改一档真实奖概率/金额时 UI 数字不跟随(单源派生纪律 · field-level gate)。 */
const parseMoney = (s: string): number => {
  const m = s.replace(/[$,]/g, "").match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
};
export const computeWheelEv = (): number =>
  WHEEL_TIERS.filter((t) => t.real).reduce((sum, t) => sum + parseMoney(t.reward) * (t.prob / 100), 0);
export const WHEEL_EV_USD = computeWheelEv(); // 当前值 = $0.73(随 WHEEL_TIERS 同步)

/** 转盘 3 护栏 + 自动降级条款。 */
export const WHEEL_GUARDS = [
  { key: "budget", label: "日派彩预算", value: "$2,000", note: "到顶当日只发 NEX/积分/券" },
  { key: "cap", label: "单奖日库存", value: "$500×5 · $20×50 · 券×200", note: "" },
  { key: "kill", label: "真实奖总开关", value: "开", note: "应急一键停发真钱档" },
];

/** Trackable 4 行(只读消费各域状态)。 */
export const TRACKABLES = [
  { id: "pro-7d", name: "Pro 限时升级", cond: "持有 Pro 或以上(设备域)", join: "8,420", done: "1,240", claim: "1,180", geo: "全区" },
  { id: "ref-5", name: "邀 5 人得 Pro", cond: "直推数 ≥ 5(团队域)", join: "2,180", done: "312", claim: "290", geo: "全区" },
  { id: "onboard-7d", name: "新人 7 日引导", cond: "7 天内完成 4 项", join: "11,400", done: "1,890", claim: "1,640", geo: "全区" },
  { id: "nex-div", name: "NEX 持有者分红", cond: "NEX 余额 ≥ 1,000(代币域)", join: "3,840", done: "660", claim: "594", geo: "2 国屏蔽" },
];

/* ============ H5 签到 + H6 收益里程碑 ============ */

export const H5_STATS = {
  todaySign: 61_420,
  signRate: "47.8%",
  lucky15Actual: "15.2%",
  lucky2Actual: "4.9%",
  lucky15Config: "15%",
  lucky2Config: "5%",
  weekRevive: 1_840,
  weekMsTrigger: 2_214,
  weekMsNex: "412K NEX",
};

/** 签到规则 6 行(基础 / 7 天加奖 / 幸运 15% / 幸运 5% / 断签 / 复活卡)。 */
export const CHECKIN_RULES = [
  { key: "baseline", name: "每日基础积分", cur: "+1 分", hot: false },
  { key: "bonus7", name: "连续 7 天加奖", cur: "+5 分", hot: false },
  { key: "p15", name: "幸运 1.5× 概率 🔥", sub: "两档概率合计 ≤ 100%,超了直接拒", cur: "15%", hot: true },
  { key: "p2", name: "幸运 2× 概率 🔥", cur: "5%", hot: true },
  { key: "broken", name: "断签阈值", sub: "超过没签连胜归零(可用复活卡)", cur: "48 小时", hot: false },
  { key: "saver", name: "复活卡默认持有 / 恢复上限", sub: "恢复到 min(历史最长连胜, 上限)", cur: "1 张 / 30 天", hot: false },
];

/** 连胜 7 阶里程碑(7 / 30 / 100 阶为标志档)。 */
export const STREAK_MS = [
  { id: 0, day: "3 天", reward: "+5 积分", kind: "points" },
  { id: 1, day: "7 天", reward: "+15 积分", kind: "points" },
  { id: 2, day: "14 天", reward: "+$1", kind: "usdt" },
  { id: 3, day: "21 天", reward: "+100 NEX", kind: "nex" },
  { id: 4, day: "30 天", reward: "🎰 转盘票 ×1", kind: "spin" },
  { id: 5, day: "60 天", reward: "+$10", kind: "usdt" },
  { id: 6, day: "100 天", reward: "⭐ 连胜大师徽章", kind: "badge" },
];

/** Power-Ups 4 档(连胜增益;下游兑现 F2/G5/G1/G4,V3 接线前仅触点价值)。 */
export const POWER_UPS = [
  { id: 0, day: 7, label: "7 天 · 版税加成", sub: "兑现在团队费率(F2)", downstream: "F2" },
  { id: 1, day: 14, label: "14 天 · 会员 7 天体验", sub: "复用订阅状态机(G5),这页不另立授予逻辑", downstream: "G5" },
  { id: 2, day: 30, label: "30 天 · 下次质押 +2% 年化", sub: "兑现在质押(G1)", downstream: "G1" },
  { id: 3, day: 60, label: "60 天 · Genesis 白名单优先", sub: "兑现在 Genesis(G4)", downstream: "G4" },
];

/** 5 收益里程碑(SPEC §4:门槛严格保序;升奖励/降门槛 = 放大流出)。 */
export const EARN_MS = [
  { id: 0, key: "earn-100", threshold: 100, nex: 100, weekTrigger: 912 },
  { id: 1, key: "earn-500", threshold: 500, nex: 250, weekTrigger: 624 },
  { id: 2, key: "earn-1000", threshold: 1_000, nex: 500, weekTrigger: 388 },
  { id: 3, key: "earn-5000", threshold: 5_000, nex: 1_500, weekTrigger: 210 },
  { id: 4, key: "earn-10000", threshold: 10_000, nex: 3_000, weekTrigger: 80 },
];

/** 连胜分布 5 段。 */
export const STREAK_DIST = [
  { day: "≥7 天", count: "38.2K", height: 100 },
  { day: "≥14", count: "21.4K", height: 56 },
  { day: "≥30", count: "9.8K", height: 26 },
  { day: "≥60", count: "3.1K", height: 8 },
  { day: "≥100", count: "640", height: 3 },
];

/** Cascade 检查间隔(H6 内部参数,超管确认)。 */
export const TICK_INTERVAL = { value: "4 秒", min: 1, max: 60, note: "过密会拉高平台负载 · 内部参数,超管确认" };

/* ============ 跨域消费方 join(防本文件自存口径)============ */
export const _SOURCE_NOTES = {
  PHASE, // design-data.PHASE = P3 月 7 单源,H1 顶栏 + 全域 dial 派发与本表一致
  LEDGER_REDLINE: LEDGER.redlinePct, // 100 · B1 红线
  LEDGER_COVERAGE: LEDGER.coverageRatio, // 118.1% · 当前覆盖率
  fmtUsd, // 演示位金额格式化
};
