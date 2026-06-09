/**
 * 运营控制后台 — 信息架构唯一真源(Single Source of Truth)。
 *
 * 取自《Nexion 运营控制后台 PRD》Ch3 §3.2/§3.3 权威菜单树:12 域 × 69 个 L2 子模块。
 * 本文件驱动:侧边栏渲染 / 路由解析 / 面包屑 / 脚手架页 / verify 路由清单。
 * 改 IA 只改这一处。
 *
 * 路径用可读英文 slug(/finance/withdrawals),id(A1–L5)仅作展示 + verify 标签。
 * status: flagship=高保真已建 · scaffold=规格就绪待开发 · planned=规格撰写中。
 */
import type { LucideIcon } from "lucide-react";
import {
  ShieldCheck,
  Gauge,
  Users,
  Wallet,
  Server,
  Network,
  Landmark,
  TrendingUp,
  Megaphone,
  Siren,
  Radar,
  BarChart3,
} from "lucide-react";

export type AdminRole =
  | "superadmin"
  | "finance"
  | "risk"
  | "content"
  | "growth"
  | "support"
  | "auditor";

export const ROLE_LABEL: Record<AdminRole, string> = {
  superadmin: "总管理员",
  finance: "财务",
  risk: "风控",
  content: "内容运营",
  growth: "增长运营",
  support: "客服",
  auditor: "审计",
};

export type L2Status = "flagship" | "scaffold" | "planned";

export interface NavL2 {
  id: string; // "D2"
  name: string; // "提现审核队列"
  path: string; // "/finance/withdrawals"
  prdAnchor: string; // "D2" — 拼成「PRD §3.3 [D2]」可追溯
  batch: "V1" | "V2" | "V3" | "V4";
  status: L2Status;
}

export interface NavDomain {
  code: string; // "D"
  name: string; // "资金与财务"
  slug: string; // "finance"
  icon: LucideIcon;
  accentVar: string; // "--admin-domain-d"
  roles?: AdminRole[]; // 省略=所有角色可见;[]=仅 superadmin
  l2: NavL2[];
}

export const CONSOLE_NAV: NavDomain[] = [
  {
    code: "A",
    name: "平台基础",
    slug: "platform",
    icon: ShieldCheck,
    accentVar: "--admin-domain-a",
    roles: [], // 仅 superadmin
    l2: [
      { id: "A1", name: "运营账号 & RBAC", path: "/platform/rbac", prdAnchor: "A1", batch: "V1", status: "flagship" },
      { id: "A2", name: "审计 & Maker-Checker", path: "/platform/audit", prdAnchor: "A2", batch: "V1", status: "flagship" },
      { id: "A3", name: "系统配置", path: "/platform/config", prdAnchor: "A3", batch: "V1", status: "flagship" },
      { id: "A4", name: "埋点事件体系", path: "/platform/events", prdAnchor: "A4", batch: "V1", status: "flagship" },
      { id: "A5", name: "平台参数寄存器", path: "/platform/params-registry", prdAnchor: "A5", batch: "V1", status: "flagship" },
    ],
  },
  {
    code: "B",
    name: "总览驾驶舱",
    slug: "overview",
    icon: Gauge,
    accentVar: "--admin-domain-b",
    l2: [
      { id: "B1", name: "双账本总览", path: "/overview/dual-ledger", prdAnchor: "B1", batch: "V1", status: "flagship" },
      { id: "B2", name: "资金池水位", path: "/overview/liquidity", prdAnchor: "B2", batch: "V1", status: "flagship" },
      { id: "B3", name: "转化漏斗", path: "/overview/funnel", prdAnchor: "B3", batch: "V1", status: "flagship" },
      { id: "B4", name: "节奏状态", path: "/overview/rhythm", prdAnchor: "B4", batch: "V1", status: "flagship" },
      { id: "B5", name: "风险雷达", path: "/overview/risk-radar", prdAnchor: "B5", batch: "V1", status: "flagship" },
    ],
  },
  {
    code: "C",
    name: "用户与账户",
    slug: "users",
    icon: Users,
    accentVar: "--admin-domain-c",
    roles: ["support", "risk"],
    l2: [
      { id: "C1", name: "检索 & 画像", path: "/users/search", prdAnchor: "C1", batch: "V1", status: "flagship" },
      { id: "C2", name: "账户操作", path: "/users/actions", prdAnchor: "C2", batch: "V1", status: "flagship" },
      { id: "C3", name: "余额 & 资产调整", path: "/users/assets", prdAnchor: "C3", batch: "V1", status: "flagship" },
      { id: "C4", name: "KYC 合规台账", path: "/users/kyc", prdAnchor: "C4", batch: "V1", status: "flagship" },
      { id: "C5", name: "安全 & 会话", path: "/users/security", prdAnchor: "C5", batch: "V1", status: "flagship" },
      { id: "C6", name: "注册/登录风控", path: "/users/reg-risk", prdAnchor: "C6", batch: "V1", status: "flagship" },
    ],
  },
  {
    code: "D",
    name: "资金与财务",
    slug: "finance",
    icon: Wallet,
    accentVar: "--admin-domain-d",
    roles: ["finance", "risk"],
    l2: [
      { id: "D1", name: "充值对账中心", path: "/finance/recon", prdAnchor: "D1", batch: "V1", status: "flagship" },
      { id: "D2", name: "提现审核队列", path: "/finance/withdrawals", prdAnchor: "D2", batch: "V1", status: "flagship" },
      { id: "D3", name: "资金池水位仪表盘", path: "/finance/pool", prdAnchor: "D3", batch: "V1", status: "flagship" },
      { id: "D4", name: "账本/账单审计", path: "/finance/ledger", prdAnchor: "D4", batch: "V1", status: "flagship" },
      { id: "D5", name: "提现参数配置", path: "/finance/params", prdAnchor: "D5", batch: "V1", status: "flagship" },
    ],
  },
  {
    code: "E",
    name: "设备与商城",
    slug: "devices",
    icon: Server,
    accentVar: "--admin-domain-e",
    roles: ["growth", "support"],
    l2: [
      { id: "E1", name: "商品目录 & 定价", path: "/devices/pricing", prdAnchor: "E1", batch: "V2", status: "flagship" },
      { id: "E2", name: "代际发布门", path: "/devices/generation", prdAnchor: "E2", batch: "V2", status: "flagship" },
      { id: "E3", name: "收益 & 任务引擎", path: "/devices/tasks", prdAnchor: "E3", batch: "V2", status: "flagship" },
      { id: "E4", name: "设备生命周期", path: "/devices/lifecycle", prdAnchor: "E4", batch: "V2", status: "flagship" },
      { id: "E5", name: "Trade-in 配置", path: "/devices/trade-in", prdAnchor: "E5", batch: "V2", status: "flagship" },
      { id: "E6", name: "订单状态机", path: "/devices/orders", prdAnchor: "E6", batch: "V2", status: "flagship" },
      { id: "E7", name: "设备运维", path: "/devices/ops", prdAnchor: "E7", batch: "V2", status: "flagship" },
    ],
  },
  {
    code: "F",
    name: "分销与团队",
    slug: "network",
    icon: Network,
    accentVar: "--admin-domain-f",
    roles: ["growth"],
    l2: [
      { id: "F1", name: "V-Rank 晋升", path: "/network/v-rank", prdAnchor: "F1", batch: "V2", status: "flagship" },
      { id: "F2", name: "网络版税费率", path: "/network/royalty", prdAnchor: "F2", batch: "V2", status: "flagship" },
      { id: "F3", name: "双轨结算引擎", path: "/network/binary", prdAnchor: "F3", batch: "V2", status: "flagship" },
      { id: "F4", name: "领导奖池", path: "/network/leadership-pool", prdAnchor: "F4", batch: "V2", status: "flagship" },
      { id: "F5", name: "佣金事件审计", path: "/network/commissions", prdAnchor: "F5", batch: "V2", status: "flagship" },
      { id: "F6", name: "硬件配额", path: "/network/quota", prdAnchor: "F6", batch: "V2", status: "flagship" },
      { id: "F7", name: "区域大使审批", path: "/network/ambassador", prdAnchor: "F7", batch: "V2", status: "flagship" },
      { id: "F8", name: "排行榜 & 反欺诈", path: "/network/leaderboard", prdAnchor: "F8", batch: "V2", status: "flagship" },
    ],
  },
  {
    code: "G",
    name: "金融产品",
    slug: "finance-products",
    icon: Landmark,
    accentVar: "--admin-domain-g",
    roles: ["finance", "growth"],
    l2: [
      { id: "G1", name: "Staking 池配置", path: "/finance-products/staking", prdAnchor: "G1", batch: "V3", status: "flagship" },
      { id: "G2", name: "兑换风控", path: "/finance-products/exchange", prdAnchor: "G2", batch: "V3", status: "flagship" },
      { id: "G3", name: "NEX 行情引擎", path: "/finance-products/market", prdAnchor: "G3", batch: "V3", status: "flagship" },
      { id: "G4", name: "Genesis 经济", path: "/finance-products/genesis", prdAnchor: "G4", batch: "V3", status: "flagship" },
      { id: "G5", name: "Premium 订阅", path: "/finance-products/premium", prdAnchor: "G5", batch: "V3", status: "flagship" },
      { id: "G6", name: "NEX v2 Founders Vault", path: "/finance-products/nex-v2", prdAnchor: "G6", batch: "V3", status: "flagship" },
      { id: "G7", name: "复投激励", path: "/finance-products/repurchase", prdAnchor: "G7", batch: "V3", status: "flagship" },
    ],
  },
  {
    code: "H",
    name: "增长与运营节奏",
    slug: "growth",
    icon: TrendingUp,
    accentVar: "--admin-domain-h",
    roles: ["growth"],
    l2: [
      { id: "H1", name: "Phase 调度器", path: "/growth/phase", prdAnchor: "H1", batch: "V1", status: "flagship" },
      { id: "H2", name: "免费试用引擎", path: "/growth/trial", prdAnchor: "H2", batch: "V1", status: "flagship" },
      { id: "H3", name: "Quest 引擎", path: "/growth/quest", prdAnchor: "H3", batch: "V3", status: "flagship" },
      { id: "H4", name: "活动中心 CMS", path: "/growth/events", prdAnchor: "H4", batch: "V3", status: "flagship" },
      { id: "H5", name: "签到 & 积分", path: "/growth/daily", prdAnchor: "H5", batch: "V3", status: "flagship" },
      { id: "H6", name: "里程碑庆祝", path: "/growth/milestones", prdAnchor: "H6", batch: "V3", status: "flagship" },
    ],
  },
  {
    code: "I",
    name: "内容与合规 CMS",
    slug: "content",
    icon: Megaphone,
    accentVar: "--admin-domain-i",
    roles: ["content"],
    l2: [
      { id: "I1", name: "转化文案 A/B", path: "/content/copy-ab", prdAnchor: "I1", batch: "V4", status: "flagship" },
      { id: "I2", name: "Nova 推送运营", path: "/content/nova", prdAnchor: "I2", batch: "V4", status: "flagship" },
      { id: "I3", name: "通知 Campaign", path: "/content/notifications", prdAnchor: "I3", batch: "V4", status: "flagship" },
      { id: "I4", name: "信任中心 CMS", path: "/content/trust", prdAnchor: "I4", batch: "V4", status: "flagship" },
      { id: "I5", name: "风险披露版本", path: "/content/disclosure", prdAnchor: "I5", batch: "V4", status: "flagship" },
      { id: "I6", name: "i18n 文案管理", path: "/content/i18n", prdAnchor: "I6", batch: "V4", status: "flagship" },
      { id: "I7", name: "教程中心", path: "/content/learn", prdAnchor: "I7", batch: "V4", status: "flagship" },
    ],
  },
  {
    code: "J",
    name: "紧急与合规控制",
    slug: "emergency",
    icon: Siren,
    accentVar: "--admin-domain-j",
    roles: ["risk"],
    l2: [
      { id: "J1", name: "Kill-Switch 矩阵", path: "/emergency/kill-switch", prdAnchor: "J1", batch: "V4", status: "flagship" },
      { id: "J2", name: "Geo-block", path: "/emergency/geo-block", prdAnchor: "J2", batch: "V4", status: "flagship" },
      { id: "J3", name: "篡改防御监控", path: "/emergency/tamper", prdAnchor: "J3", batch: "V4", status: "flagship" },
      { id: "J4", name: "监管点名应急 SOP", path: "/emergency/sop", prdAnchor: "J4", batch: "V4", status: "flagship" },
    ],
  },
  {
    code: "K",
    name: "风控与反作弊",
    slug: "risk",
    icon: Radar,
    accentVar: "--admin-domain-k",
    roles: ["risk"],
    l2: [
      { id: "K1", name: "反多账户引擎", path: "/risk/multi-account", prdAnchor: "K1", batch: "V1", status: "flagship" },
      { id: "K2", name: "套利 & 刷量检测", path: "/risk/abuse", prdAnchor: "K2", batch: "V1", status: "flagship" },
      { id: "K3", name: "提现风控规则引擎", path: "/risk/withdrawal-rules", prdAnchor: "K3", batch: "V1", status: "flagship" },
      { id: "K4", name: "风险评分模型", path: "/risk/scoring", prdAnchor: "K4", batch: "V1", status: "flagship" },
      { id: "K5", name: "大额 KYC 复审 & 告警", path: "/risk/kyc-review", prdAnchor: "K5", batch: "V1", status: "flagship" },
    ],
  },
  {
    code: "L",
    name: "数据与分析 BI",
    slug: "analytics",
    icon: BarChart3,
    accentVar: "--admin-domain-l",
    l2: [
      { id: "L1", name: "KPI 看板", path: "/analytics/kpi", prdAnchor: "L1", batch: "V4", status: "flagship" },
      { id: "L2", name: "漏斗/cohort/留存", path: "/analytics/funnel-cohort", prdAnchor: "L2", batch: "V4", status: "flagship" },
      { id: "L3", name: "财务报表", path: "/analytics/financial", prdAnchor: "L3", batch: "V4", status: "flagship" },
      { id: "L4", name: "设备/任务/网络报表", path: "/analytics/operations", prdAnchor: "L4", batch: "V4", status: "flagship" },
      { id: "L5", name: "导出 & 监管报告", path: "/analytics/export", prdAnchor: "L5", batch: "V4", status: "flagship" },
    ],
  },
];

/** 扁平化的全部 L2(verify 路由清单 / 全局检索用)。 */
export const ALL_L2: NavL2[] = CONSOLE_NAV.flatMap((d) => d.l2);

/** 按路径解析 {domain, l2}。匹配不到返回 null(catch-all → notFound)。 */
export function findByPath(path: string): { domain: NavDomain; l2: NavL2 } | null {
  const clean = path.replace(/\/+$/, "") || "/";
  for (const domain of CONSOLE_NAV) {
    for (const l2 of domain.l2) {
      if (l2.path === clean) return { domain, l2 };
    }
  }
  return null;
}

/** 按 domain slug + module slug 解析(catch-all 用)。 */
export function findBySlugs(domainSlug: string, moduleSlug: string): { domain: NavDomain; l2: NavL2 } | null {
  return findByPath(`/${domainSlug}/${moduleSlug}`);
}

/** RBAC:superadmin 全可见;roles 省略=全可见;roles=[] 仅 superadmin;否则按包含判定。 */
export function canSee(role: AdminRole, roles?: AdminRole[]): boolean {
  if (role === "superadmin") return true;
  if (!roles) return true;
  return roles.includes(role);
}

/** 当前角色可见的域(侧栏过滤)。 */
export function visibleDomains(role: AdminRole): NavDomain[] {
  return CONSOLE_NAV.filter((d) => canSee(role, d.roles));
}

export const DOMAIN_COUNT = CONSOLE_NAV.length; // 12
export const L2_COUNT = ALL_L2.length; // 69
