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
  { id: "al-newbig", level: "mid", text: "K5 复审 hold 提现单 ×3 · 复审未过不可放行", href: "/finance/withdrawals" },
  { id: "al-kill", level: "low", text: "Kill-Switch 7/7 在线 · 全闸正常营业", href: "/emergency/kill-switch" },
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
  J: "Kill 7/7 在线 · Geo 屏蔽 3 国(制裁名单)", // 对齐 GEOBLOCK 三态(KP/IR/SY)
  K: "高风险簇 9 · KYC 复审 14(1 超时)", // 对齐 K1 高风险簇 / K5 待复审口径(K_RISK + k-tabs 样本窗)
  L: "8 KPI · 达标 6 / 未达 2", // 静态回落值;首页实际由 page.tsx 按 KPIS 动态派生覆盖
};
