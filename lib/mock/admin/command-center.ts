/**
 * 指挥台首页 mock 数据(确定性)。
 * 生命体征复用 lib/mock/admin/ledger.ts;此处补:节奏 phase、转化漏斗、八项 KPI、
 * 平台 vitals、告警、跨域待办。真实环境由 A4 事件流 + 各域 store 聚合。
 */
import type { AdminRole } from "@/lib/nav/console-nav";
import { LEDGER } from "@/lib/mock/admin/ledger";

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
export const CURRENT_PHASE = {
  code: "P3",
  name: "扩张期",
  index: 2, // PHASES 下标(0-based)
  month: 7,
  total: 12,
  etaDays: 14,
  focus: "重心:拉新 + 首购转化,放宽试用,谨慎放大资金流出",
};

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

// ── 到期预测(未来 7d · B2)── 每日到期应付:提现 / 质押利息 / Genesis 分红(USD)
export interface MaturityDay {
  d: string; // 日签 MM/DD
  withdraw: number;
  interest: number;
  genesis: number;
}
export const MATURITY_7D: MaturityDay[] = [
  { d: "06/02", withdraw: 62_000, interest: 18_000, genesis: 9_000 },
  { d: "06/03", withdraw: 48_000, interest: 18_000, genesis: 9_000 },
  { d: "06/04", withdraw: 71_000, interest: 22_000, genesis: 9_000 },
  { d: "06/05", withdraw: 55_000, interest: 18_000, genesis: 9_000 },
  { d: "06/06", withdraw: 88_000, interest: 26_000, genesis: 9_000 },
  { d: "06/07", withdraw: 40_000, interest: 16_000, genesis: 9_000 },
  { d: "06/08", withdraw: 52_000, interest: 19_000, genesis: 9_000 },
];

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
export const KPIS: Kpi[] = [
  { key: "day0", label: "Day-0 接入率", value: "87%", target: "≥85%", pass: true, series: [82, 83, 85, 84, 86, 87, 87, 87], hint: "新用户设备首次产出 ≤90s 的占比(接入顺畅度)。近 8 日。" },
  { key: "day7", label: "Day-7 留存", value: "58%", target: "≥60%", pass: false, series: [63, 62, 61, 60, 59, 59, 58, 58], hint: "注册满 7 天仍活跃的留存率。近 8 日。" },
  { key: "l2l3", label: "L2→L3 首购转化", value: "18.0%", target: "≥16%", pass: true, series: [15, 15.5, 16, 16.8, 17.2, 17.6, 18, 18], hint: "已激活用户(L2)中完成首次购机(L3)的比例。近 8 日。" },
  { key: "l3l4", label: "L3→L4 复购率", value: "35%", target: "≥30%", pass: true, series: [29, 30, 31, 32, 33, 34, 35, 35], hint: "已购机用户(L3)中再次购机(L4)的比例。近 8 日。" },
  { key: "l4l5", label: "L4→L5 推广率", value: "22%", target: "≥25%", pass: false, series: [26, 25, 24, 24, 23, 23, 22, 22], hint: "复购用户(L4)中发展下线(L5)的比例。近 8 日。" },
  { key: "nova", label: "Nova 推送 CTR", value: "31%", target: "≥28%", pass: true, series: [27, 28, 29, 30, 30, 31, 31, 31], hint: "Nova(站内 AI 助手)推送的点击率。近 8 日。" },
  { key: "tvl", label: "Staking TVL", value: "$1.64M", target: "≥$1.5M", pass: true, series: [1.42, 1.48, 1.51, 1.55, 1.58, 1.6, 1.63, 1.64], hint: "Staking 锁仓总价值(TVL)。近 8 日,单位 $M。" },
  { key: "genesis", label: "Genesis 售罄", value: "84%", target: "≥80%", pass: true, series: [70, 73, 76, 78, 80, 82, 83, 84], hint: "Genesis 节点累计售罄比例。近 8 日。" },
];

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
  { id: "al-multi", level: "high", text: "WD-2606-0148 命中多账户关联 · 待合规核查", href: "/finance/withdrawals" },
  { id: "al-newbig", level: "mid", text: "新账户大额提现 ×3 待复核", href: "/finance/withdrawals" },
  { id: "al-kill", level: "low", text: "Kill-Switch 7/7 在线 · 全闸正常营业", href: "/emergency/kill-switch" },
];

// ── 跨域待办(Maker-Checker 待我处理)。提现项数量由队列 store 实时算,这里给其余域。──
export interface PendingApproval {
  id: string;
  label: string;
  detail: string;
  href: string;
  requiredRole: AdminRole;
}
export const PENDING_APPROVALS: PendingApproval[] = [
  { id: "pa-bigout", label: "大额放行待风控复核", detail: "2 单 · 合计 $52.3K", href: "/finance/withdrawals", requiredRole: "risk" },
  { id: "pa-param", label: "提现参数变更待复核", detail: "日限上调申请 · 财务发起", href: "/finance/params", requiredRole: "finance" },
  { id: "pa-genesis", label: "Genesis 下架待解除", detail: "需覆盖率核验通过", href: "/emergency/kill-switch", requiredRole: "risk" },
];

/** 域速览的关键指标(mock,每域一句"现在什么状态")。 */
export const DOMAIN_PULSE: Record<string, string> = {
  A: "操作员 12 · 今日审计 86",
  B: `覆盖率 ${LEDGER.coverageRatio.toFixed(1)}% · ${LEDGER.coverageRatio >= LEDGER.healthyPct ? "健康" : LEDGER.coverageRatio >= LEDGER.redlinePct ? "警戒" : "危急"}`,
  C: "活跃用户 28.4K · 高风险 2",
  D: "待审提现 9 · 积压 $89.4K",
  E: "在售 SKU 6 · 库存正常",
  F: "佣金待结 $18.2K",
  G: "Staking TVL $1.64M · APY 正常",
  H: "P3 扩张期 · 第 7/12 月",
  I: "推送 CTR 31% · 文案 A/B 2 组",
  J: "Kill 7/7 在线 · Geo 屏蔽 2 国(制裁名单)",
  K: "风险命中 14 · 待复核 5",
  L: "8 KPI · 达标 6 / 未达 2",
};
