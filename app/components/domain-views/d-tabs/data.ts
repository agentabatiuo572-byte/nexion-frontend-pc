/**
 * D 域(资金管理)专属 mock — design_handoff_d_domain port(2026-06-10)。
 * 口径单一源铁律:
 *  - 储备/负债/覆盖率/红黄线 = LEDGER(B1 同源);8 科目 = LIABILITIES(LEDGER.accounts 派生);
 *  - 到期预测 = MATURITY / MAT_7D / RESERVE_COVER_DAYS(B2 卡 / L3 报表同数);
 *  - 提现队列 = design-data.WITHDRAWALS(全平台唯一源;单号/规则/时刻对齐 K3_HITS,K5 工单同单同人);
 *  - 充值流水 = design-data.TOPUPS;聚合统计 = D_FUND(base+样本窗,base 已逐条过筛)。
 * 本文件只放 D 域页面级扩展(渠道表/对账面/BIN/拒付/账本样例/参数表),不复制权威数值。
 */
import { LEDGER } from "@/lib/mock/admin/ledger";
import { D_FUND, TOPUPS, TREASURY, WITHDRAWALS } from "@/lib/mock/admin/design-data";

/* ============================ D1 充值对账中心 ============================ */

// 五渠道费率/最小充值(PRD D1③:费率仅新对象;MIN_TOPUP per-channel,不可设单一全局值)。
// 启停实时态 = pget("D.channel.<id>"),费率 = pget("D.fee.<id>")。
export const CHANNELS: { id: string; fee: string; min: string; on: boolean }[] = [
  { id: "USDT-TRC20", fee: "1 USDT 固定", min: "$10", on: true },
  { id: "USDT-ERC20", fee: "5 USDT 固定", min: "$10", on: true },
  { id: "BTC", fee: "0.5%", min: "$20", on: true },
  { id: "ETH", fee: "0.5%", min: "$20", on: true },
  { id: "Card", fee: "3.5% · 进风控备付金", min: "$10", on: true },
];

// 卡渠道三参数(PRD D1③:实时生效;3DS 线对齐前端 topup 页「3D Secure enforced over $50」)。
export const CARD_PARAMS: { key: string; name: string; cur: string; note: string }[] = [
  { key: "threeDsThreshold", name: "3DS 强验线", cur: "$50", note: "刷卡 ≥ $50 强制走银行验证 · 范围 $0–$500 · 实时生效" },
  { key: "cardRetryLimit", name: "同卡 24h 重试上限", cur: "5 次", note: "24h 失败 5 次自动锁卡 · 范围 3–10 次 · 实时生效" },
  { key: "cardLockHours", name: "锁卡时长", cur: "24h", note: "触发后锁 24 小时 · 范围 1–72h · 实时生效" },
];

// 支付商报表 vs 平台入账(差异 = 3 笔 $1,420,与 D_FUND.recon* 闭合:420+800+200)。
export type ReconRow = { ch: string; pspCnt: number; pspAmt: number; ledCnt: number; ledAmt: number; diff: string | null };
export const RECON: ReconRow[] = [
  { ch: "Card", pspCnt: 188, pspAmt: 92140, ledCnt: 188, ledAmt: 92140, diff: null },
  { ch: "USDT-TRC20", pspCnt: 142, pspAmt: 61300, ledCnt: 141, ledAmt: 60880, diff: "单边挂账 $420 · 链上已到、平台未入(TP-77095)" },
  { ch: "USDT-ERC20", pspCnt: 38, pspAmt: 18200, ledCnt: 38, ledAmt: 18200, diff: null },
  { ch: "BTC", pspCnt: 24, pspAmt: 8940, ledCnt: 24, ledAmt: 8140, diff: "金额差 $800 · 汇率快照待核" },
  { ch: "ETH", pspCnt: 20, pspAmt: 3820, ledCnt: 19, ledAmt: 3620, diff: "单边挂账 $200" },
];
// 今日已确认入账 = 平台入账侧合计(派生,勿手写)。差异统计在 d1 视图内按 pget 实时派生(核销后即时变化),不在此静态导出。
export const RECON_LEDGER_TOTAL = RECON.reduce((s, r) => s + r.ledAmt, 0); // $182,980
export const RECON_LEDGER_CNT = RECON.reduce((s, r) => s + r.ledCnt, 0); // 410 笔

// BIN attack 热力(实时锁态 = pget("D.bin.<i>"));锁定中 = 样本 3 + base 1 = 4。
export type BinRow = { name: string; meta: string; fails: number; locked: boolean; note: string };
export const BINS: BinRow[] = [
  { name: "BIN 4539 88··", meta: "fp_22ab… · 3 IP", fails: 9, locked: true, note: "已自动锁 · 剩 16h" },
  { name: "BIN 5412 67··", meta: "fp_8a3f…(CL-318)", fails: 7, locked: true, note: "已自动锁 · 剩 4h" },
  { name: "IP 45.142.··", meta: "6 张卡轮试", fails: 5, locked: true, note: "已自动锁" },
  { name: "BIN 4716 02··", meta: "单卡", fails: 3, locked: false, note: "观察中" },
];
// BIN 锁卡计数在 d1 视图内按 pget 实时派生(锁/解锁即时变化),不在此静态导出。

// 拒付处置(TP-77102 与 TOPUPS 异常 tab 同单;退款三连原子:追回入账 + fee_buffer 扣回 + 终身入金核减)。
export type CbRow = { id: string; user: string; amt: string; code: string; entered: string; st: "待处置" | "已退款追回" };
export const CBS: CbRow[] = [
  { id: "TP-77102", user: "usr_55B1", amt: "$800", code: "4837 · 疑似欺诈", entered: "已入账", st: "待处置" },
  { id: "TP-76981", user: "usr_2231", amt: "$350", code: "4853 · 商品争议", entered: "已入账", st: "待处置" },
  { id: "TP-76870", user: "usr_8807", amt: "$120", code: "4837", entered: "已入账", st: "已退款追回" },
];

export const TOPUP_TABS: { key: "pending" | "confirmed" | "abnormal"; label: string }[] = [
  { key: "pending", label: "待确认" },
  { key: "confirmed", label: "已确认" },
  { key: "abnormal", label: "异常" },
];
export const topupsByTab = (key: "pending" | "confirmed" | "abnormal") => TOPUPS.filter((t) => t.st === key);

/* ============================ D2 提现审核队列 ============================ */

export const WD_ST: Record<string, [label: string, tone: string]> = {
  "review-pending": ["待人工", "warn"],
  delayed: ["已延迟", "warn"],
  frozen: ["已冻结", "bad"],
  "review-passed": ["已批 → 出金中", "ok"],
  rejected: ["已拒绝", "bad"],
  refunded: ["已退回", "dim"],
};

export const LARGE_LINE = 1000; // D2 大额操作确认线(静态参数,与 K3 路由线 / K5 复审线三参数独立、目前碰巧同值)

// D2 stat 派生(base+样本窗;样本实时态由视图层用 pget 覆盖后再计)。
export const wdStats = (effSt: (id: string) => string) => {
  const pending = WITHDRAWALS.filter((w) => effSt(w.id) === "review-pending");
  const frozen = WITHDRAWALS.filter((w) => effSt(w.id) === "frozen");
  const largePending = pending.filter((w) => w.amount >= LARGE_LINE);
  const k5Hold = WITHDRAWALS.filter((w) => w.holdK5 && ["review-pending", "frozen", "delayed"].includes(effSt(w.id)));
  return {
    pendingTotal: D_FUND.wdPendingBase + pending.length,
    largeTotal: D_FUND.wdLargeBase + largePending.length,
    k5HoldCnt: k5Hold.length,
    frozenTotal: D_FUND.wdFrozenBase + frozen.length,
    frozenUsd: D_FUND.wdFrozenBaseUsd + frozen.reduce((s, w) => s + w.amount, 0),
  };
};

/* ============================ D3 资金池水位 ============================ */

// 真实储备明细(合计恒 = LEDGER.reserveUsd;在锁本金扣减额 = 负债科目 #2 同一笔,保证不双计)。
const STAKE_LOCKED = LEDGER.accounts.find((a) => a.key === "stake_principal")!.amount; // $1.64M
const INJECTED = TREASURY.injectedCumulative; // $300K 单源引用(曾两处硬编码同值,漂移风险已收敛)
const OTHER_LIQUID = 520_000;
const USDT_MAIN = LEDGER.reserveUsd - OTHER_LIQUID - INJECTED + STAKE_LOCKED; // 倒推主科目,合计闭合
export const RESERVE_ROWS: { nm: string; sub: string; v: number; neg?: boolean }[] = [
  { nm: "USDT 储备(主科目)", sub: "充值累计 − 已确认出金", v: USDT_MAIN },
  { nm: "其他可变现资产", sub: "已配置纳入口径的资产", v: OTHER_LIQUID },
  { nm: "手动注入累计", sub: "注资登记 · 附凭证 · 操作确认", v: INJECTED },
  { nm: "减:未到期在锁本金", sub: "锁仓本金不算可兑付,与负债科目 #2 同笔不双计", v: -STAKE_LOCKED, neg: true },
];

// 8 科目含义 + 事件来源(PRD D3② 表;金额/占比由 LIABILITIES = LEDGER.accounts 派生,此处只补说明列)。
export const LIAB_META: { desc: string; src: string }[] = [
  { desc: "用户钱包里随时能提的钱", src: "earnings.credited / topup_confirmed − 已出金" },
  { desc: "在锁的定期本金", src: "staking.opened − staking.claimed" },
  { desc: "按已锁天数线性累计", src: "本金 × APY × 已锁天数派生" },
  { desc: "持有量 × 服务端 0.1%/日", src: "genesis.purchased × dailyDividendShare" },
  { desc: "到期一次性全额登账,不线性计", src: "staking.opened(NEX v2)" },
  { desc: "已提交还没到账的冻结额", src: "withdraw.submitted − confirmed(在途)" },
  { desc: "已计提还在冷却期的佣金", src: "commission.paid − 冷却期满可提" },
  { desc: "扩展位,按需启用", src: "预留(schema 治理)" },
];

// 压力测试层(trial shadow 潜在兑换,默认 OFF;只作观察,不进 B1 覆盖率分母)。
export const STRESS_DAILY_USD = 8_000;
// 单日兑付预警线(示意:储备 2%/日;当前柱峰 ~$80K 低于线,扩张期健康)。
export const DAILY_DUE_ALERT_USD = Math.round(LEDGER.reserveUsd * 0.02); // ≈ $127K

/* ============================ D4 账本 / 账单审计 ============================ */

// 8 类账单(PRD D4③:独立 bonus 类已为 V1 裁定;adjustment = C3 人工调整专类,SPEC C3 P0 收口
// 不复用 refund —— 退款专指提现失败退回,混用会污染储备/负债口径;类型清单锁定,新增走 A4 schema 治理)。
export const BILL_TYPES: { key: string; label: string; tone: string }[] = [
  { key: "topup", label: "充值", tone: "ok" },
  { key: "withdraw", label: "提现", tone: "warn" },
  { key: "earning", label: "收益", tone: "brand" },
  { key: "commission", label: "佣金", tone: "cyan" },
  { key: "swap", label: "兑换", tone: "dim" },
  { key: "refund", label: "退款", tone: "bad" },
  { key: "bonus", label: "bonus", tone: "warn" },
  { key: "adjustment", label: "人工调整", tone: "cyan" },
];

// 全平台账单流水样例(今日;与 D1/D2/K 联动:BL-99820 ↔ WD-90412(K5 复审 hold,不是出金中);
// BL-99812 ↔ usr_8812 今日第 3 笔被拒退回(D2 WD-90388 hist「前 3 笔已拒」同链);
// usr_55B1 的 WD-90377 退回发生在 5/28,属历史账,见 LEDGERS 滚动余额(同一事件单一时间线);
// BL-99819 = usr_19C7 全部设备日产合计 +$17/日(与其账本 5/28-5/30 行同量级);BL-99808 = 试用兑换终态 bonus。
export type BillRow = { id: string; user: string; type: string; amt: string; cur: string; st: string; memo: string; t: string };
export const BILLS: BillRow[] = [
  // C3 双事件演示位:发起层 ADJ-1183(c-tabs ADJUST_HIST 首行)↔ 记账层本行,账单号互链、报表按号去重。
  { id: "BL-99823", user: "usr_2231", type: "adjustment", amt: "+$120", cur: "USDT", st: "已入账", memo: "人工调整 · ADJ-1183 · 工单 T-8812(C3 发起)", t: "14:30" },
  { id: "BL-99821", user: "usr_22A1", type: "topup", amt: "+$500", cur: "USDT", st: "已入账", memo: "TP-77120 · Card", t: "14:08" },
  { id: "BL-99820", user: "usr_31E8", type: "withdraw", amt: "−$8,200", cur: "USDT", st: "复审 hold", memo: "WD-90412 · K5 复审 hold(KR-7741)", t: "14:02" },
  { id: "BL-99819", user: "usr_19C7", type: "earning", amt: "+$17", cur: "USDT", st: "已入账", memo: "设备日产 · 41 台", t: "14:00" },
  { id: "BL-99817", user: "usr_84F2", type: "commission", amt: "+$112", cur: "USDT", st: "冷却中", memo: "F 域计提 · 30d 冷却", t: "13:51" },
  { id: "BL-99815", user: "usr_02A9", type: "swap", amt: "−2,000 NEX", cur: "NEX→USDT", st: "已入账", memo: "EX-3321", t: "13:40" },
  { id: "BL-99812", user: "usr_8812", type: "refund", amt: "+$95", cur: "USDT", st: "已退回", memo: "WD-90387 拒绝退回(24h 第 3 笔)", t: "13:22" },
  { id: "BL-99808", user: "usr_77D4", type: "bonus", amt: "+$5", cur: "USDT", st: "已入账", memo: "试用兑换终态 · TR-8841", t: "12:55" },
  { id: "BL-99805", user: "usr_88E0", type: "topup", amt: "+$99", cur: "USDT", st: "已入账", memo: "TP-77116 · TRC20", t: "12:18" },
];

// 单用户账本(滚动余额;末态收敛 USERS.balance:usr_55B1=1,240 / usr_19C7=24,100;分类累计 Σ = 末态)。
export type UserLedger = { sums: [k: string, v: string][]; rows: [d: string, ev: string, amt: string, bal: string, brk?: boolean][] };
export const LEDGERS: Record<string, UserLedger> = {
  usr_55B1: {
    // 1,951 + 184 + 45 − 940 = 1,240(提现净 = 确认出金 − 退回冲销)
    sums: [["充值", "+$1,951"], ["收益", "+$184"], ["提现(净)", "−$940"], ["bonus", "+$45"]],
    rows: [
      ["5/30", "bonus · 试用兑换", "+$5", "$1,240.0"],
      ["5/29", "收益 · 设备日产", "+$3.4", "$1,235.0"],
      ["5/28", "提现 WD-90377 拒绝退回", "+$240", "$1,231.6"],
      ["5/26", "提现 WD-90377", "−$240", "$991.6", true],
      ["5/24", "充值 TP-76990", "+$200", "$1,231.6"],
    ],
  },
  usr_19C7: {
    // 24,400 + 2,180 − 2,480 + 0 = 24,100
    sums: [["充值", "+$24,400"], ["收益", "+$2,180"], ["提现(净)", "−$2,480"], ["佣金", "+$0"]],
    rows: [
      ["5/30", "收益 · 设备日产", "+$17", "$24,100"],
      ["5/29", "提现 WD-90233(已确认)", "−$420", "$24,083"],
      ["5/28", "收益 · 设备日产", "+$17", "$24,503"],
    ],
  },
};

// 账实不符告警(断点联动:usr_55B1 = 上表 5/26 断点行;usr_6201 = K1 冻结簇 CL-301 成员)。
export const BREAKS: [user: string, desc: string, st: string][] = [
  ["usr_55B1", "5/26 提现退回与账单时序错位 $240(滚动余额断点)", "已定位 · 待调账"],
  ["usr_6201", "冻结簇账户(CL-301)有一笔收益未落账 $12", "核查中"],
];

/* ============================ D5 提现参数配置 ============================ */

// D5 owns 三参数(PRD D5③:日限为「次数」非金额;操作确认 + 放松方向 B1 红线核验;实时态 = pget("D.<key>"))。
export const OWN_PARAMS: { key: string; name: string; cur: string; sub: string; range: string; dir: "loosen-up" | "loosen-down" }[] = [
  { key: "dailyLimitCount", name: "提现日限(次数)", cur: "1 次 / 日", sub: "每人每天最多提几次 · 上调 = 放松,要过覆盖率核验", range: "范围 1–10 次/日", dir: "loosen-up" },
  { key: "balanceMaxRatio", name: "余额上限(可提比例)", cur: "80%", sub: "单次最多提余额的多少 · 上调 = 放松", range: "范围 50%–100%", dir: "loosen-up" },
  { key: "networkFee", name: "网络费", cur: "2% · 最低 $1 / 最高 $20", sub: "提现手续费 · 下调 = 放松;改后只对新单,在途不变", range: "范围 0%–5%,min/max 可配", dir: "loosen-down" },
];

// H1 Phase 派发只读三项(权威 H1,/growth/phase;PUT 携带返 422 PHASE_PARAM_READONLY)。
// 当前 = P3 · 月 7(对齐 PHASE 单源;月 8=35d 为 12 月节奏表权威目标值,前端简化实现缺中间档须补)。
// 现值同源:H1 真写键 H.phase.dial.<h1Key>(h-view 同键),D5 视图 pget 同源镜像、seed 仅回落——
// H1 调 dial 后本页/stat 实时跟(曾硬编码快照,「同 X 展示必同源」audit 修正)。
export const PHASE_RO = {
  cooldown: { name: "冷却天数", h1Key: "withdrawCooldownDays", seed: "30", fmt: (v: string) => (/^\d+$/.test(v) ? `${v}d(当前)` : `${v}(当前)`), sub: "两次提现之间的间隔 · 随运营月份阶梯上调", segs: [["月 1–7", "30 天", true], ["月 8", "35 天", false], ["月 9+", "45 天", false]] as [string, string, boolean][] },
  points: { name: "积分门槛", h1Key: "withdrawPointsRatio", seed: "10", fmt: (v: string) => (/^\d+$/.test(v) ? `${v} 分(当前)` : `${v}(当前)`), sub: "每提 $100 要消耗的积分", segs: [["月 1–8", "10 分 / $100", true], ["月 9–12", "20 分 / $100", false]] as [string, string, boolean][] },
  hold: { name: "增强合规审查", h1Key: "complianceHoldEnabled", seed: "未激活(P5 起)", fmt: (v: string) => v, sub: "激活后大额提现进延长审查 · 月 8(P5 带)起整带开启,无月内拐点" },
};
