/**
 * 运营控制后台 — 信息架构唯一真源(Single Source of Truth)。
 *
 * 取自 A7 菜单树的可执行页面注册表；A6 决定角色可见节点，A7 决定节点名称和顺序。
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
  Headset,
} from "lucide-react";

export type BuiltinAdminRole =
  | "superadmin"
  | "finance"
  | "config"
  | "risk"
  | "content"
  | "growth"
  | "support"
  | "auditor";

/** Custom role codes are database data and must not be coerced to auditor. */
export type AdminRole = BuiltinAdminRole | (string & {});

export const ROLE_LABEL: Record<BuiltinAdminRole, string> = {
  superadmin: "总管理员",
  config: "配置运营",
  finance: "财务",
  risk: "风控",
  content: "内容运营",
  growth: "增长运营",
  support: "客服",
  auditor: "审计",
};

export function roleLabel(role: AdminRole): string {
  return ROLE_LABEL[role as BuiltinAdminRole] ?? role;
}

export const SUPPORT_ADMIN_ROLES: BuiltinAdminRole[] = ["support"];

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
  roles?: BuiltinAdminRole[]; // 仅作为真实授权数据不可用时的静态 IA fallback
  l2: NavL2[];
}

export const CONSOLE_NAV: NavDomain[] = [
  {
    code: "A",
    name: "平台基础",
    slug: "platform",
    icon: ShieldCheck,
    accentVar: "--admin-domain-a",
    roles: ["config"],
    l2: [
      { id: "A1", name: "运营账号与权限", path: "/platform/rbac", prdAnchor: "A1", batch: "V1", status: "flagship" },
      { id: "A2", name: "操作记录与审批", path: "/platform/audit", prdAnchor: "A2", batch: "V1", status: "flagship" },
      { id: "A3", name: "系统配置", path: "/platform/config", prdAnchor: "A3", batch: "V1", status: "flagship" },
      { id: "A4", name: "用户行为事件", path: "/platform/events", prdAnchor: "A4", batch: "V1", status: "flagship" },
      { id: "A5", name: "平台参数管理", path: "/platform/params-registry", prdAnchor: "A5", batch: "V1", status: "flagship" },
      { id: "A6", name: "角色管理", path: "/platform/roles", prdAnchor: "A6", batch: "V1", status: "flagship" },
      { id: "A7", name: "菜单管理", path: "/platform/menus", prdAnchor: "A7", batch: "V1", status: "flagship" },
      { id: "A8", name: "权限清单", path: "/platform/permissions", prdAnchor: "A8", batch: "V1", status: "flagship" },
      { id: "A9", name: "开发者访问审批", path: "/platform/developer-access", prdAnchor: "A9", batch: "V1", status: "flagship" },
    ],
  },
  {
    code: "B",
    name: "运营总览",
    slug: "overview",
    icon: Gauge,
    accentVar: "--admin-domain-b",
    l2: [
      { id: "B1", name: "资金与应付款总览", path: "/overview/dual-ledger", prdAnchor: "B1", batch: "V1", status: "flagship" },
      { id: "B2", name: "可用资金与应付款", path: "/overview/liquidity", prdAnchor: "B2", batch: "V1", status: "flagship" },
      { id: "B3", name: "用户转化分析", path: "/overview/funnel", prdAnchor: "B3", batch: "V1", status: "flagship" },
      { id: "B4", name: "运营阶段状态", path: "/overview/rhythm", prdAnchor: "B4", batch: "V1", status: "flagship" },
      { id: "B5", name: "风险提醒", path: "/overview/risk-radar", prdAnchor: "B5", batch: "V1", status: "flagship" },
    ],
  },
  {
    code: "C",
    name: "用户与账户",
    slug: "users",
    icon: Users,
    accentVar: "--admin-domain-c",
    roles: ["risk"],
    l2: [
      { id: "C1", name: "查找用户与查看资料", path: "/users/search", prdAnchor: "C1", batch: "V1", status: "flagship" },
      { id: "C2", name: "账户操作", path: "/users/actions", prdAnchor: "C2", batch: "V1", status: "flagship" },
      { id: "C3", name: "余额与资产调整", path: "/users/assets", prdAnchor: "C3", batch: "V1", status: "flagship" },
      { id: "C5", name: "安全与登录设备", path: "/users/security", prdAnchor: "C5", batch: "V1", status: "flagship" },
      { id: "C6", name: "注册与登录风险", path: "/users/reg-risk", prdAnchor: "C6", batch: "V1", status: "flagship" },
    ],
  },
  {
    code: "D",
    name: "资金与财务",
    slug: "finance",
    icon: Wallet,
    accentVar: "--admin-domain-d",
    roles: ["finance", "risk", "config"],
    l2: [
      { id: "D1", name: "充值对账中心", path: "/finance/recon", prdAnchor: "D1", batch: "V1", status: "flagship" },
      { id: "D2", name: "待审核提现", path: "/finance/withdrawals", prdAnchor: "D2", batch: "V1", status: "flagship" },
      { id: "D3", name: "资金储备与应付款", path: "/finance/pool", prdAnchor: "D3", batch: "V1", status: "flagship" },
      { id: "D4", name: "账本与账单核对", path: "/finance/ledger", prdAnchor: "D4", batch: "V1", status: "flagship" },
      { id: "D5", name: "提现参数配置", path: "/finance/params", prdAnchor: "D5", batch: "V1", status: "flagship" },
      { id: "D6", name: "汇率设置", path: "/finance/fx-rate", prdAnchor: "D6", batch: "V1", status: "flagship" },
      { id: "D7", name: "法币提现参数", path: "/finance/payout-vnd", prdAnchor: "D7", batch: "V1", status: "flagship" },
    ],
  },
  {
    code: "E",
    name: "设备与商城",
    slug: "devices",
    icon: Server,
    accentVar: "--admin-domain-e",
    roles: ["growth"],
    // 设计稿收编 E1-E7 → 5 子模块并全系统统一连续编号 E1-E5:代际发布门(原 E2)并入 E1、
    // 设备生命周期(原 E4)并入 E5→现 E3。同 F 域 F1-F8→F1-F5。nav id == prdAnchor == PRD §10 章节(PRD 已同步重编号)。
    l2: [
      { id: "E1", name: "商品管理与上架条件", path: "/devices/pricing", prdAnchor: "E1", batch: "V2", status: "flagship" },
      { id: "E2", name: "设备收益与任务", path: "/devices/tasks", prdAnchor: "E2", batch: "V2", status: "flagship" },
      { id: "E3", name: "设备使用与以旧换新", path: "/devices/trade-in", prdAnchor: "E3", batch: "V2", status: "flagship" },
      { id: "E4", name: "订单进度", path: "/devices/orders", prdAnchor: "E4", batch: "V2", status: "flagship" },
      { id: "E5", name: "设备运行管理", path: "/devices/ops", prdAnchor: "E5", batch: "V2", status: "flagship" },
      { id: "E6", name: "算力与设备配置", path: "/devices/compute-config", prdAnchor: "E6", batch: "V2", status: "flagship" },
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
      { id: "F1", name: "团队等级晋升", path: "/network/v-rank", prdAnchor: "F1", batch: "V2", status: "flagship" },
      { id: "F2", name: "团队分成", path: "/network/royalty", prdAnchor: "F2", batch: "V2", status: "flagship" },
      { id: "F3", name: "左右团队业绩结算", path: "/network/binary", prdAnchor: "F3", batch: "V2", status: "flagship" },
      { id: "F4", name: "奖励池、名额与排行榜", path: "/network/leadership-pool", prdAnchor: "F4", batch: "V2", status: "flagship" },
      { id: "F5", name: "佣金记录核对", path: "/network/commissions", prdAnchor: "F5", batch: "V2", status: "flagship" },
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
      { id: "G1", name: "质押产品配置", path: "/finance-products/staking", prdAnchor: "G1", batch: "V3", status: "flagship" },
      { id: "G2", name: "兑换风险规则", path: "/finance-products/exchange", prdAnchor: "G2", batch: "V3", status: "flagship" },
      { id: "G3", name: "NEX 价格管理", path: "/finance-products/market", prdAnchor: "G3", batch: "V3", status: "flagship" },
      { id: "G4", name: "创世节点销售与收益", path: "/finance-products/genesis", prdAnchor: "G4", batch: "V3", status: "flagship" },
      { id: "G7", name: "复投激励", path: "/finance-products/repurchase", prdAnchor: "G7", batch: "V3", status: "flagship" },
    ],
  },
  {
    code: "H",
    name: "增长与活动",
    slug: "growth",
    icon: TrendingUp,
    accentVar: "--admin-domain-h",
    roles: ["growth", "config"],
    l2: [
      { id: "H1", name: "运营阶段设置", path: "/growth/phase", prdAnchor: "H1", batch: "V1", status: "flagship" },
      { id: "H2", name: "免费试用设置", path: "/growth/trial", prdAnchor: "H2", batch: "V1", status: "flagship" },
      { id: "H3", name: "用户任务管理", path: "/growth/quest", prdAnchor: "H3", batch: "V3", status: "flagship" },
      { id: "H4", name: "活动中心", path: "/growth/events", prdAnchor: "H4", batch: "V3", status: "flagship" },
      { id: "H5", name: "签到 & NEX", path: "/growth/daily", prdAnchor: "H5", batch: "V3", status: "flagship" },
      // H6 已折入 H5 同页，里程碑在 H5 页面内明确分区展示；不再声明一个后端未登记的独立菜单。
      { id: "H7", name: "代金券", path: "/growth/vouchers", prdAnchor: "H7", batch: "V3", status: "flagship" },
      { id: "H8", name: "新人礼与邀请奖励", path: "/growth/referral-rewards", prdAnchor: "H8", batch: "V3", status: "flagship" },
      { id: "H9", name: "历史数据展示设置", path: "/growth/public-stats", prdAnchor: "H9", batch: "V3", status: "flagship" },
    ],
  },
  {
    code: "I",
    name: "内容与合规",
    slug: "content",
    icon: Megaphone,
    accentVar: "--admin-domain-i",
    roles: ["content"],
    l2: [
      { id: "I1", name: "页面文案对比测试", path: "/content/copy-ab", prdAnchor: "I1", batch: "V4", status: "flagship" },
      { id: "I2", name: "Nova 消息推送", path: "/content/nova", prdAnchor: "I2", batch: "V4", status: "flagship" },
      { id: "I3", name: "通知活动", path: "/content/notifications", prdAnchor: "I3", batch: "V4", status: "flagship" },
      { id: "I4", name: "信任中心", path: "/content/trust", prdAnchor: "I4", batch: "V4", status: "flagship" },
      { id: "I5", name: "风险披露", path: "/content/disclosures", prdAnchor: "I5", batch: "V4", status: "flagship" },
      { id: "I6", name: "多语言文案", path: "/content/i18n", prdAnchor: "I6", batch: "V4", status: "flagship" },
    ],
  },
  {
    code: "J",
    name: "紧急与合规控制",
    slug: "emergency",
    icon: Siren,
    accentVar: "--admin-domain-j",
    roles: ["risk", "config"],
    l2: [
      { id: "J1", name: "紧急停用开关", path: "/emergency/kill-switch", prdAnchor: "J1", batch: "V4", status: "flagship" },
      { id: "J2", name: "地区访问限制", path: "/emergency/geo-block", prdAnchor: "J2", batch: "V4", status: "flagship" },
      { id: "J3", name: "篡改防御监控", path: "/emergency/tamper", prdAnchor: "J3", batch: "V4", status: "flagship" },
      { id: "J4", name: "监管要求应急处理", path: "/emergency/sop", prdAnchor: "J4", batch: "V4", status: "flagship" },
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
      { id: "K1", name: "多账户风险排查", path: "/risk/multi-account", prdAnchor: "K1", batch: "V1", status: "flagship" },
      { id: "K2", name: "异常套利与刷量排查", path: "/risk/abuse", prdAnchor: "K2", batch: "V1", status: "flagship" },
      { id: "K3", name: "提现风险规则", path: "/risk/withdrawal-rules", prdAnchor: "K3", batch: "V1", status: "flagship" },
      { id: "K4", name: "风险评分规则", path: "/risk/scoring", prdAnchor: "K4", batch: "V1", status: "flagship" },
      { id: "K6", name: "设备风险处置", path: "/risk/janus-c2", prdAnchor: "K6", batch: "V1", status: "flagship" },
    ],
  },
  {
    code: "L",
    name: "数据与分析",
    slug: "analytics",
    icon: BarChart3,
    accentVar: "--admin-domain-l",
    l2: [
      { id: "L1", name: "关键指标", path: "/analytics/kpi", prdAnchor: "L1", batch: "V4", status: "flagship" },
      { id: "L2", name: "用户转化与留存", path: "/analytics/funnel-cohort", prdAnchor: "L2", batch: "V4", status: "flagship" },
      { id: "L3", name: "财务报表", path: "/analytics/financial", prdAnchor: "L3", batch: "V4", status: "flagship" },
      { id: "L4", name: "设备/任务/网络报表", path: "/analytics/operations", prdAnchor: "L4", batch: "V4", status: "flagship" },
      { id: "L5", name: "数据导出与监管报告", path: "/analytics/export", prdAnchor: "L5", batch: "V4", status: "flagship" },
      { id: "L6", name: "用户行为热力图", path: "/analytics/behavior-heatmap", prdAnchor: "L6", batch: "V4", status: "flagship" },
    ],
  },
  {
    code: "M",
    name: "客服中心",
    slug: "service",
    icon: Headset,
    accentVar: "--admin-domain-m",
    roles: ["support", "risk"],
    // 客服中心 = 抽 I8(工单)+ I9(即时会话)重组的独立域;真写键沿用 I.support.*/I.session.* 保 persist 兼容。
    l2: [
      { id: "M1", name: "客服工作台", path: "/service/overview", prdAnchor: "M1", batch: "V4", status: "flagship" },
      { id: "M2", name: "客服工单", path: "/service/tickets", prdAnchor: "M2", batch: "V4", status: "flagship" },
      { id: "M3", name: "专属会话", path: "/service/sessions", prdAnchor: "M3", batch: "V4", status: "flagship" },
      { id: "M6", name: "业绩榜", path: "/service/leaderboard", prdAnchor: "M6", batch: "V4", status: "flagship" },
      { id: "M4", name: "知识库与处理时限", path: "/service/kb-sla", prdAnchor: "M4", batch: "V4", status: "flagship" },
      { id: "M5", name: "服务规则与话术", path: "/service/scripts", prdAnchor: "M5", batch: "V4", status: "flagship" },
    ],
  },
];

/** Former database menu labels; keep custom names while replacing stock jargon. */
const LEGACY_MENU_NAMES: Record<string, string> = {
  "A1": "运营账号 & RBAC",
  "A2": "审计 & 操作确认",
  "A4": "埋点事件体系",
  "A5": "平台参数寄存器",
  "A8": "权限字典",
  "B1": "双账本总览",
  "B2": "资金池水位",
  "B3": "转化漏斗",
  "B4": "节奏状态",
  "B5": "风险雷达",
  "C1": "检索 & 画像",
  "C6": "注册/登录风控",
  "D2": "提现审核队列",
  "D3": "资金池水位仪表盘",
  "D4": "账本/账单审计",
  "D6": "汇率牌价",
  "E1": "商品目录 & 上架门",
  "E2": "收益 & 任务引擎",
  "E3": "生命周期 & Trade-in",
  "E4": "订单状态机",
  "E5": "设备运维",
  "F1": "V-Rank 晋升",
  "F2": "网络版税与分成",
  "F3": "双轨结算引擎",
  "F4": "池 / 配额 / 大使 / 榜",
  "F5": "佣金事件审计",
  "G1": "Staking 池配置",
  "G2": "兑换风控",
  "G3": "NEX 行情引擎",
  "G4": "Genesis 经济",
  "H1": "Phase 调度器",
  "H2": "免费试用引擎",
  "H3": "任务引擎",
  "H9": "历史估算配置",
  "I1": "转化文案 A/B",
  "I2": "Nova 推送运营",
  "I3": "通知 Campaign",
  "I6": "i18n 文案",
  "J1": "Kill-Switch 矩阵",
  "J2": "Geo-block",
  "J4": "监管点名应急 SOP",
  "K1": "反多账户引擎",
  "K2": "套利 & 刷量检测",
  "K3": "提现风控规则引擎",
  "K4": "风险评分模型",
  "K6": "Janus C2 控制台",
  "L1": "KPI 看板",
  "L2": "漏斗/cohort/留存",
  "L5": "导出 & 监管报告",
  "M2": "工单台",
  "M4": "知识库与 SLA",
};
const LEGACY_DOMAIN_NAMES: Record<string, string> = {
  B: "总览驾驶舱",
  H: "增长与运营节奏",
  I: "内容与合规 CMS",
  L: "数据与分析 BI",
};

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

/** RBAC:superadmin 全可见;客服后台角色只看显式 support 域;roles 省略=其它角色可见;roles=[] 仅 superadmin。 */
export function canSee(role: AdminRole, roles?: AdminRole[]): boolean {
  if (role === "superadmin") return true;
  if (SUPPORT_ADMIN_ROLES.includes(role as BuiltinAdminRole)) return roles?.includes("support") === true;
  if (!roles) return true;
  return roles.includes(role);
}

/** 当前角色可见的域(侧栏过滤)。 */
export function visibleDomains(role: AdminRole): NavDomain[] {
  return CONSOLE_NAV.filter((d) => canSee(role, d.roles));
}

export interface NavAccessSnapshot {
  role: AdminRole;
  /** 后端 nx_admin_role_menu 的有效菜单码；存在时（即使为空）具有最高优先级。 */
  menuCodes?: string[];
  /** A7 metadata already filtered by the authenticated admin's A6 grants. */
  menuNodes?: EffectiveMenuNode[];
  /** session 的数据库权限码；旧后端没有 menuCodes 时用于校准静态角色表。 */
  authorities?: string[];
  supportReadModes?: Array<"ALL" | "MANAGED" | "PERSONAL">;
}

export interface EffectiveMenuNode {
  menuCode: string;
  menuName: string;
  routePath?: string | null;
  parentCode?: string | null;
  sortOrder?: number | null;
}

/** 从细粒度权限码提取页面码，例如 platform_a6_read -> A6。 */
export function menuCodesFromAuthorities(authorities: string[]): string[] {
  const found = new Set<string>();
  for (const authority of authorities) {
    for (const match of authority.toUpperCase().matchAll(/(?:^|_)([A-M]\d+)(?:_|$)/g)) {
      found.add(match[1] === "I7" ? "I6" : match[1]);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

/**
 * Navigation authorization single consumer:
 * DB role-menu grant > DB permission codes; missing grants expose no pages.
 * Role labels never manufacture menu authorization.
 */
export function resolveVisibleDomains(snapshot: NavAccessSnapshot): NavDomain[] {
  const explicit = snapshot.menuCodes;
  const inferred = explicit === undefined
    ? menuCodesFromAuthorities(snapshot.authorities ?? [])
    : [];
  const effectiveCodes = explicit ?? (inferred.length > 0 ? inferred : undefined);

  if (effectiveCodes === undefined) return [];
  const supportScopeUnknown = snapshot.role === "support" && !snapshot.supportReadModes?.length;
  const allowed = new Set(effectiveCodes
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean)
    .map((code) => code === "I7" ? "I6" : code));
  const nodes = new Map<string, EffectiveMenuNode[]>();
  for (const node of snapshot.menuNodes ?? []) {
    const rawCode = node.menuCode.trim().toUpperCase();
    const code = rawCode === "I7" ? "I6" : rawCode;
    if (!code) continue;
    const compatibleNode = rawCode === "I7"
      ? { ...node, menuCode: "I6", menuName: "i18n 文案与课程", routePath: "/content/i18n" }
      : node;
    const candidates = nodes.get(code);
    if (candidates) candidates.push(compatibleNode);
    else nodes.set(code, [compatibleNode]);
  }
  const hasMenuMetadata = snapshot.menuNodes !== undefined;
  const findNode = (code: string, predicate?: (node: EffectiveMenuNode) => boolean) => {
    const candidates = nodes.get(code) ?? [];
    return predicate ? candidates.find(predicate) : candidates[0];
  };
  const order = (node: EffectiveMenuNode | undefined, fallback: number) => {
    const value = node?.sortOrder;
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  };
  return CONSOLE_NAV.flatMap((domain, domainIndex) => {
    const staticOrder = new Map(domain.l2.map((item, index) => [item.id, index]));
    const l2 = domain.l2
      .filter((item) => item.id !== "M6" && allowed.has(item.id.toUpperCase()) && (!supportScopeUnknown || !["M1", "M2", "M3"].includes(item.id)))
      .flatMap((item) => {
        const node = findNode(item.id.toUpperCase(), (candidate) =>
          candidate.routePath === item.path
          && candidate.parentCode?.trim().toUpperCase() === domain.code);
        if (hasMenuMetadata && !node) return [];
        return [{
          item: node ? { ...item, name: !node.menuName?.trim() || node.menuName.trim() === LEGACY_MENU_NAMES[item.id] || (item.id === "I6" && node.menuName.trim() === "i18n 文案与课程") ? item.name : node.menuName.trim() } : item,
          node,
        }];
      })
      .sort((a, b) => order(a.node, staticOrder.get(a.item.id) ?? 0) - order(b.node, staticOrder.get(b.item.id) ?? 0))
      .map(({ item }) => item);
    if (domain.code === "M" && !supportScopeUnknown && snapshot.authorities?.some(code => code === "service_m1_read" || code === "service_m3_read")
      && l2.some(item => item.id === "M1" || item.id === "M3")) {
      const leaderboard = domain.l2.find(item => item.id === "M6");
      if (leaderboard) { const after = l2.findIndex(item => item.id === "M3"); l2.splice(after < 0 ? l2.findIndex(item => item.id === "M1") + 1 : after + 1, 0, leaderboard); }
    }
    if (l2.length === 0) return [];
    const domainNode = findNode(domain.code, (node) =>
      !node.parentCode && node.routePath === `/${domain.slug}`)
      ?? findNode(domain.code, (node) => !node.parentCode);
    return [{
      ...domain,
      name: !domainNode?.menuName?.trim() || domainNode.menuName.trim() === LEGACY_DOMAIN_NAMES[domain.code]
        ? domain.name : domainNode.menuName.trim(),
      l2,
      __sortOrder: order(domainNode, domainIndex),
    }];
  })
    .sort((a, b) => a.__sortOrder - b.__sortOrder)
    .map(({ __sortOrder: _ignored, ...domain }) => domain);
}

/** Enforce the resolved menu grant on every known console-domain URL. */
export function canAccessResolvedPath(domains: NavDomain[], pathname: string | null): boolean {
  const path = (pathname || "/").replace(/\/+$/, "") || "/";
  if (path === "/") return domains.some(domain => domain.l2.length > 0);
  if (/^\/service\/customers\/[^/]+$/.test(path)) return domains.find(domain => domain.code === "M")?.l2.some(item => item.id === "M1" || item.id === "M3") ?? false;
  const knownDomain = CONSOLE_NAV.find((domain) => path === `/${domain.slug}` || path.startsWith(`/${domain.slug}/`));
  if (!knownDomain) return true;
  const grantedDomain = domains.find((domain) => domain.code === knownDomain.code);
  return grantedDomain?.l2.some((item) => path === item.path || path.startsWith(`${item.path}/`)) ?? false;
}

export function defaultConsolePath(role: AdminRole, domains: NavDomain[]): string | null {
  const first = domains.find(domain => domain.l2.length > 0)?.l2[0]?.path;
  if (!first) return null;
  if (role === "superadmin") return "/";
  if (role === "support") {
    const servicePages = domains.find(domain => domain.code === "M")?.l2 ?? [];
    for (const id of ["M1", "M3", "M2", "M4", "M5", "M6"]) {
      const page = servicePages.find(item => item.id === id);
      if (page) return page.path;
    }
  }
  return first;
}

export const DOMAIN_COUNT = CONSOLE_NAV.length; // 13
export const L2_COUNT = ALL_L2.length;
