/**
 * 指挥台首页 mock 数据(确定性)。
 * 生命体征复用 lib/mock/admin/ledger.ts;此处补:节奏 phase、转化漏斗、八项 KPI、
 * 平台 vitals、告警、跨域待办。真实环境由 A4 事件流 + 各域 store 聚合。
 */
import type { AdminRole } from "@/lib/nav/console-nav";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { KPIS as CORE_KPIS, MATURITY, kpiState } from "@/lib/mock/admin/design-data";

// ── 12 月运营节奏(集中定义,topbar 与首页共用)──
export interface PhaseNode {
  code: string;
  name: string;
}
export const PHASES: PhaseNode[] = [
  { code: "P1", name: "拉新" },
  { code: "P2", name: "激活" },
  { code: "P3", name: "扩张" },
  { code: "P4", name: "深化" },
  { code: "P5", name: "收紧" },
  { code: "P6", name: "软退场" },
];
// ⚠️ seed 默认快照。当前节奏「真 live 值」= 运营可配的 H1.rhythm.*(见下 rhythmState);
// 此常量与 design-data.PHASE 仅在运营未改时作回退。month/total 勿当 live 真源直接渲染——走 rhythmState。
export const CURRENT_PHASE = {
  code: "P3",
  name: "扩张期",
  index: 2, // PHASES 下标(0-based)
  month: 7,
  total: 12,
  etaDays: 14,
  focus: "重心:拉新 + 首购转化,放宽试用,谨慎放大资金流出",
};

// ── 节奏骨架单源(运营可配 · H1 拥有,backend-replaceable)──────────────────────────
// 三个持久键 H1.rhythm.{totalMonths,currentMonth,phaseProgressPct} 是「当前节奏状态」唯一 live 真源;
// RHYTHM_SEED / CURRENT_PHASE / design-data.PHASE 仅作默认 seed(运营未改时回退)。
// B4 节奏页 / H1 调度器 / L1 / L4 / 首页 pulse 全部 rhythmState(pget) 同源镜像,绝不抄快照(防分叉)。
export const RHYTHM_SEED = { totalMonths: 12, currentMonth: 7, phaseProgressPct: 58 };
// 9 起步:6 个 phase 各需 ≥1 月,小于 9 月时按权重分布会把 P4(权重最小=1)挤成 0 月(退化为不可达阶段)。
export const RHYTHM_TOTAL_OPTIONS = [9, 12, 15, 18, 24];
const RHYTHM_MIN_TOTAL = 9;
const RHYTHM_MAX_TOTAL = 24;

// 默认 12 月节奏 = phase → 月 权威查表(P3 扩张 3 月最长、P4 深化 1 月最短)。
// 「月 7 → P3 / 月 8 → P4」全站对齐口径(2026-06-12 H 域 audit 拍定);canon-sentinel 静态解析本字面
// (`phase: "Pn", months: [...]`),勿删 months 字面。改总时长时按各 phase 月数权重等比重分布。
export const PHASE_BUCKETS: ReadonlyArray<{ phase: string; months: readonly number[] }> = [
  { phase: "P1", months: [1, 2] },
  { phase: "P2", months: [3, 4] },
  { phase: "P3", months: [5, 6, 7] },
  { phase: "P4", months: [8] },
  { phase: "P5", months: [9, 10] },
  { phase: "P6", months: [11, 12] },
];
// 月数权重派生自 buckets(零复制):[2,2,3,1,2,2]。默认总时长 = 权重和 = 12。
export const RHYTHM_WEIGHTS = PHASE_BUCKETS.map((b) => b.months.length);
const RHYTHM_DEFAULT_TOTAL = RHYTHM_WEIGHTS.reduce((a, b) => a + b, 0);

const clampInt = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(n)));

/** 给定总月数,算各阶段「月末边界」(累积,整数,单调非降,末位 = total)。 */
function phaseEnds(total: number): number[] {
  const wsum = RHYTHM_WEIGHTS.reduce((a, b) => a + b, 0); // 12
  let acc = 0;
  const ends = RHYTHM_WEIGHTS.map((w) => {
    acc += (w / wsum) * total;
    return Math.round(acc);
  });
  for (let i = 1; i < ends.length; i++) if (ends[i] < ends[i - 1]) ends[i] = ends[i - 1];
  ends[ends.length - 1] = total; // 浮点累积舍入纠偏:末阶段必收于 total
  return ends;
}

/** 月 → 阶段下标(0-based,P1=0..P6=5)。月号 clamp 到 [1,total]。
 *  默认总时长(12)走查表精确复现 canon;非默认按权重等比重分布。 */
export function monthToPhaseIdx(m1: number, total: number = RHYTHM_SEED.totalMonths): number {
  const t = clampInt(total, RHYTHM_MIN_TOTAL, RHYTHM_MAX_TOTAL);
  const mm = clampInt(m1, 1, t);
  if (t === RHYTHM_DEFAULT_TOTAL) {
    const idx = PHASE_BUCKETS.findIndex((b) => b.months.includes(mm));
    return idx < 0 ? PHASES.length - 1 : idx;
  }
  const ends = phaseEnds(t);
  const idx = ends.findIndex((e) => mm <= e);
  return idx < 0 ? PHASES.length - 1 : idx;
}

/** 月 → 阶段 code(P1..P6)。total 省略 = 默认 12 月节奏。 */
export function monthToPhase(m1: number, total: number = RHYTHM_SEED.totalMonths): string {
  return PHASES[monthToPhaseIdx(m1, total)].code;
}

export interface RhythmState {
  totalMonths: number;
  currentMonth: number;
  currentPhase: string; // P1..P6(由当前月 + 总时长派生)
  currentPhaseName: string; // 拉新 / 激活 / 扩张 ...
  phaseProgressPct: number; // 0..100,本阶段已进行
}

/** 节奏骨架 live 单源:读 H1.rhythm.*(运营可配)+ seed 回退 + clamp。pget = (k)=>params[k]。 */
export function rhythmState(pget: (k: string) => string | number | boolean | undefined): RhythmState {
  const rawTotal = Number(pget("H1.rhythm.totalMonths"));
  const totalMonths = clampInt(Number.isFinite(rawTotal) && rawTotal > 0 ? rawTotal : RHYTHM_SEED.totalMonths, RHYTHM_MIN_TOTAL, RHYTHM_MAX_TOTAL);
  const rawMonth = Number(pget("H1.rhythm.currentMonth"));
  const currentMonth = clampInt(Number.isFinite(rawMonth) && rawMonth > 0 ? rawMonth : RHYTHM_SEED.currentMonth, 1, totalMonths);
  const rawProg = Number(pget("H1.rhythm.phaseProgressPct"));
  const phaseProgressPct = clampInt(Number.isFinite(rawProg) ? rawProg : RHYTHM_SEED.phaseProgressPct, 0, 100);
  const idx = monthToPhaseIdx(currentMonth, totalMonths);
  return { totalMonths, currentMonth, currentPhase: PHASES[idx].code, currentPhaseName: PHASES[idx].name, phaseProgressPct };
}

// ── Phase 控制 dial(节奏状态卡 · 权威归 H1)──
export type DialTrend = "up" | "down" | "flat";
export interface PhaseDial {
  key: string;
  label: string;
  value: string;
  trend: DialTrend;
}
export const PHASE_DIALS: PhaseDial[] = [
  { key: "acq", label: "拉新预算强度", value: "高", trend: "up" },
  { key: "trial", label: "试用名额", value: "放宽", trend: "up" },
  { key: "firstbuy", label: "首购转化激励", value: "中高", trend: "up" },
  { key: "outflow", label: "放大流出闸", value: "谨慎", trend: "flat" },
  { key: "wd_cap", label: "提现日限", value: "标准档", trend: "flat" },
  { key: "apy", label: "质押 APY 档", value: "标准", trend: "flat" },
  { key: "decay", label: "设备衰减档", value: "P3 档", trend: "down" },
  { key: "genesis", label: "Genesis 放量", value: "渐进", trend: "up" },
];

// ── 到期预测(未来 7d · B2)── 每日到期应付:提现 / 质押利息 / Genesis 排放(USD)
export interface MaturityDay {
  d: string; // 日签 MM/DD
  withdraw: number;
  interest: number;
  genesis: number;
}
// 到期预测单一源 = design-data.MATURITY(D3 maturity-forecast 口径;B2 卡与 L3 报表同数)。
// 曾另立一套 7 日值($416K 级)与 L3($3.92M 级)7× 分叉 —— 2026-06-10 收敛为派生。
export const MATURITY_7D: MaturityDay[] = MATURITY.map((m) => ({ d: m.d, withdraw: m.withdraw, interest: m.interest, genesis: m.genesis }));

// ── 转化漏斗(today)── prevCount = 昨日同级,用于环比 delta
export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  prevCount: number;
}
export const FUNNEL: FunnelStage[] = [
  { key: "register", label: "注册", count: 1_240, prevCount: 1_180 },
  { key: "kyc", label: "绑卡($1 验证)", count: 769, prevCount: 742 },
  { key: "first_buy", label: "首购", count: 223, prevCount: 240 },
  { key: "repurchase", label: "复购", count: 78, prevCount: 71 },
  { key: "withdraw", label: "提现", count: 41, prevCount: 38 },
];

// ── 八项 KPI 验收墙(§17.2)──
export interface Kpi {
  key: string;
  label: string;
  value: string;
  target: string;
  pass: boolean;
  series: number[]; // 近 8 日
  hint: string; // 口径说明(消黑话)
}
// 八项 KPI 单一源派生(design-data.KPIS:编号/数值/目标/序列/状态判定),此处仅做驾驶舱白话 hint 适配。
// 曾另立一套数值(87%/18%/Staking TVL 等)与 L1 看板全面分叉 —— 2026-06-10 收敛,绝不回退为独立 mock。
const KPI_HINTS: Record<number, string> = {
  1: "新用户注册后 90 秒内收到首笔算力收益的占比(接入顺畅度)。",
  2: "注册满 7 天仍打开 app 的留存率。",
  3: "新注册用户中主动浏览商城的比例。",
  4: "逛过商城的用户中完成付款的比例(健康带 5–10%)。",
  5: "设备持有者中发出过邀请的比例(推广率,非收入口径)。",
  6: "Nova 推送的点击率(点开次数 ÷ 发送次数)。",
  7: "直推用户中首单触发了团队佣金的比例。",
  8: "1,000 台创世节点全部售出所用天数(越小越好)。",
};
export const KPIS: Kpi[] = CORE_KPIS.map((k) => ({
  key: `k${k.n}`,
  label: `#${k.n} ${k.name}`,
  value: `${k.value}${k.unit}`,
  target: "band" in k && k.dir === "band" ? `${k.band[0]}–${k.band[1]}${k.unit}` : `${k.dir === "lte" ? "≤" : "≥"}${k.target}${k.unit}`,
  pass: kpiState(k) === "g",
  series: [...k.spark],
  hint: KPI_HINTS[k.n],
}));

// ── 风险雷达 / 告警 ──
export type AlertLevel = "high" | "mid" | "low";
export interface AlertItem {
  id: string;
  level: AlertLevel;
  text: string;
  href: string;
}
export const ALERTS: AlertItem[] = [
  { id: "al-cov", level: "low", text: `出金压力比 ${(LEDGER.pressureRatio * 100).toFixed(0)}% · 远低 70% 红线 · 覆盖率 ${LEDGER.coverageRatio.toFixed(1)}% 绿区(扩张健康)`, href: "/overview/dual-ledger" },
  { id: "al-multi", level: "high", text: "WD-90408 关联多账户簇 CL-318(K1)· WR-02 已延迟观察", href: "/finance/withdrawals" }, // 对齐 D2 队列单源(旧 WD-2606 体系已删)
  { id: "al-newbig", level: "mid", text: "K5 复审未决提现单 ×3 · 复审未过不可放行", href: "/finance/withdrawals" },
  { id: "al-kill", level: "low", text: "Kill-Switch 5/5 在线 · 全闸正常营业", href: "/emergency/kill-switch" },
];

// ── 跨域待办(操作确认 高敏操作动态)。提现项数量由队列 store 实时算,这里给其余域。──
export interface PendingOperation {
  id: string;
  label: string;
  detail: string;
  href: string;
  requiredRole: AdminRole;
}
export const PENDING_OPERATIONS: PendingOperation[] = [
  { id: "pa-bigout", label: "大额放行待风控确认", detail: "2 单 · 合计 $9.3K", href: "/finance/withdrawals", requiredRole: "risk" }, // = D2 样本窗大额待确认 WD-90412($8.2K)+ WD-90391($1.1K)
  { id: "pa-param", label: "提现参数变更待确认", detail: "日限上调申请 · 财务发起", href: "/finance/params", requiredRole: "finance" },
  { id: "pa-genesis", label: "Genesis 下架待解除", detail: "需覆盖率核验通过", href: "/emergency/kill-switch", requiredRole: "risk" },
];

/** 域速览的关键指标(mock,每域一句"现在什么状态")。 */
export const DOMAIN_PULSE: Record<string, string> = {
  A: "操作员 12 · 今日审计 86",
  B: `覆盖率 ${LEDGER.coverageRatio.toFixed(1)}% · ${LEDGER.coverageRatio >= LEDGER.healthyPct ? "健康" : LEDGER.coverageRatio >= LEDGER.redlinePct ? "警戒" : "危急"}`,
  C: "活跃用户 28.4K · 高风险 2",
  D: "待确认提现 23 · 冻结 5 · 覆盖率核验在位", // 对齐 D2 真渲染面(样本窗 4 + 存量 19;冻结 $12.4K)
  E: "在售 SKU 6 · 库存正常",
  F: "佣金待结 $18.2K",
  G: "在锁 $1.50M · Genesis 847/1,000 · 五闸在线", // 对齐 G 域真渲染面(科目 #2/#8 口径;旧 TVL $11.82M 为发明已收敛)
  H: "P3 扩张期 · 第 7/12 月",
  I: "推送 CTR 27.3% · 文案 A/B 2 组", // 对齐 KPIS #6(单源)
  J: "Kill 5/5 在线 · Geo 屏蔽 3 国(制裁名单)", // 对齐 GEOBLOCK 三态(KP/IR/SY)
  K: "高风险簇 9 · KYC 复审 14(1 超时)", // 对齐 K1 高风险簇 / K5 待复审口径(K_RISK + k-tabs 样本窗)
  L: "8 KPI · 达标 6 / 未达 2", // 静态回落值;首页实际由 page.tsx 按 KPIS 动态派生覆盖
};
