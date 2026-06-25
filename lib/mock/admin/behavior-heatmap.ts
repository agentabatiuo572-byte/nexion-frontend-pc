/**
 * L6 用户行为热力图 — 数据源(mock,但 100% backend-replaceable)。
 *
 * 真后台会提供两个接口,本模块是它们的 mock:
 *   1. 页面目录(catalog):前端各页的 UX 层级 + 上卷父子关系 + 是否纳入行为统计。
 *      → PAGE_TREE。真实现由后台「页面注册表」返回(前端发版时同步)。
 *   2. 行为聚合(aggregation):某时间窗内每页的 PV/UV/点击/停留/跳出,以及单页点击坐标分布。
 *      → buildPageActivity() / buildPageClickHeat()。真实现由 A4 事件流经 BI 聚合返回。
 *
 * 口径对齐 A4 事件流(schema v3.7):PV=page_view 计数,UV=去重 user,clicks=tap/click 事件,
 * dwellMs=会话内该页平均停留,bounceRate=进入即离开(无下一跳)占比。
 *
 * 全部数值由「route 字符串 hash」确定性派生(不用 Math.random / Date.now),
 * 避免 SSR/CSR hydration 不一致(本工程约定:mock 用确定性种子)。
 * 接真后台时:把 buildPageActivity / buildPageClickHeat 换成 fetch,UI 与聚合逻辑零改。
 */

export type PageLevel = 1 | 2 | 3;
export type DepthFilter = "all" | "L1" | "L2" | "L3";
export type TimeWindow = "24h" | "7d" | "30d";

/** 页面目录节点 —— 真后台「页面 catalog」接口的 mock 形状。 */
export interface UxPageNode {
  route: string; // 物理路由 "pages/me/wallet-topup"
  titleZh: string; // 运营可读中文页名(取自前端 headerTitles 镜像)
  level: PageLevel; // UX 层级:1=tab/顶级入口 · 2=板块子页 · 3=详情/指南叶子
  parentL1: string; // 一级祖先 route(L1 节点指向自身)
  parentL2: string; // 二级祖先 route(L1/L2 节点指向自身)
  tracked: boolean; // false=纯系统/会话页,不纳入行为统计
}

/** 页面活跃聚合 —— 真后台 BI 聚合结果的 mock(单页粒度)。 */
export interface PageActivityStat {
  route: string;
  pv: number;
  uv: number;
  clicks: number;
  dwellMs: number; // 平均停留(毫秒)
  bounceRate: number; // 0–1
}

/** 聚合后的一行(按所选层级上卷;含折叠了多少页)。 */
export interface HeatRow {
  key: string; // 该行的代表 route
  titleZh: string;
  level: PageLevel;
  pv: number;
  uv: number;
  clicks: number;
  dwellMs: number;
  bounceRate: number;
  pageCount: number; // 折叠进本行的被追踪页数
}

/** 单页坐标热力 —— 真后台按 route 返回的点击分布。x/y 归一化 0–1(0,0=左上)。 */
export interface ClickHeatPoint {
  x: number;
  y: number;
  weight: number; // 0–1 相对强度
}
export interface ClickHeatZone {
  label: string; // 区域名(运营可读)
  cx: number; // 区域中心 x(0–1)
  cy: number; // 区域中心 y(0–1)
  share: number; // 该区域点击占比 0–1
}
export interface PageClickHeat {
  route: string;
  titleZh: string;
  zones: ClickHeatZone[];
  points: ClickHeatPoint[];
}

/* ============================================================
   页面目录(PAGE_TREE)—— 83 路由,显式编码 UX 层级与上卷关系。
   来源:Nexion-uniapp/src/pages.json + src/i18n/messages/zh.ts headerTitles。
   ============================================================ */

type Seed = [route: string, titleZh: string, level: PageLevel, parentL1: string, parentL2: string, tracked?: boolean];

const R_INDEX = "pages/index/index";
const R_EARN = "pages/earn/earn";
const R_STORE = "pages/store/store";
const R_TEAM = "pages/team/team";
const R_ME = "pages/me/me";

const SEEDS: Seed[] = [
  // ── 一级:5 tab 根 ──
  [R_INDEX, "首页", 1, R_INDEX, R_INDEX],
  [R_EARN, "赚取", 1, R_EARN, R_EARN],
  [R_STORE, "商城", 1, R_STORE, R_STORE],
  [R_TEAM, "团队", 1, R_TEAM, R_TEAM],
  [R_ME, "我的", 1, R_ME, R_ME],

  // ── 一级:11 顶级入口页 ──
  ["pages/market/market", "行情", 1, "pages/market/market", "pages/market/market"],
  ["pages/missions/missions", "任务中心", 1, "pages/missions/missions", "pages/missions/missions"],
  ["pages/events/events", "活动", 1, "pages/events/events", "pages/events/events"],
  ["pages/learn/learn", "学习", 1, "pages/learn/learn", "pages/learn/learn"],
  ["pages/genesis/genesis", "创世节点", 1, "pages/genesis/genesis", "pages/genesis/genesis"],
  ["pages/staking/staking", "质押", 1, "pages/staking/staking", "pages/staking/staking"],
  ["pages/daily/daily", "每日签到", 1, "pages/daily/daily", "pages/daily/daily"],
  ["pages/globe/globe", "全球网络", 1, "pages/globe/globe", "pages/globe/globe"],
  ["pages/developer/developer", "开发者", 1, "pages/developer/developer", "pages/developer/developer"],
  ["pages/trust/trust", "信任中心", 1, "pages/trust/trust", "pages/trust/trust"],
  ["pages/search/search", "搜索", 1, "pages/search/search", "pages/search/search"],

  // ── 商城板块(parentL1=store)──
  ["pages/store/detail", "商品详情", 2, R_STORE, "pages/store/detail"],
  ["pages/store/checkout", "结算", 2, R_STORE, "pages/store/checkout"],
  ["pages/store/orders", "我的订单", 2, R_STORE, "pages/store/orders"],
  ["pages/store/order-detail", "订单详情", 3, R_STORE, "pages/store/orders"],
  ["pages/store/bundle", "组合套餐", 2, R_STORE, "pages/store/bundle"],

  // ── 我的板块(parentL1=me)──
  ["pages/me/wallet", "钱包", 2, R_ME, "pages/me/wallet"],
  ["pages/me/wallet-topup", "充值", 3, R_ME, "pages/me/wallet"],
  ["pages/me/wallet-withdraw", "提现", 3, R_ME, "pages/me/wallet"],
  ["pages/me/wallet-withdraw-tracking", "提现状态", 3, R_ME, "pages/me/wallet"],
  ["pages/me/wallet-exchange", "兑换", 3, R_ME, "pages/me/wallet"],
  ["pages/me/wallet-exchange-how", "兑换 · 玩法说明", 3, R_ME, "pages/me/wallet"],
  ["pages/me/wallet-bills", "账单", 3, R_ME, "pages/me/wallet"],
  ["pages/me/wallet-nex", "NEX 钱包", 3, R_ME, "pages/me/wallet"],
  ["pages/me/wallet-cards", "支付卡", 3, R_ME, "pages/me/wallet"],
  ["pages/me/wallet-cards-new", "添加支付卡", 3, R_ME, "pages/me/wallet"],
  ["pages/me/wallet-repurchase", "复投", 3, R_ME, "pages/me/wallet"],
  ["pages/me/wallet-repurchase-how", "复投 · 玩法说明", 3, R_ME, "pages/me/wallet"],
  ["pages/me/devices", "我的设备", 2, R_ME, "pages/me/devices"],
  ["pages/me/profile", "个人资料", 2, R_ME, "pages/me/profile"],
  ["pages/me/security", "安全", 2, R_ME, "pages/me/security"],
  ["pages/me/kyc", "KYC 认证", 2, R_ME, "pages/me/security"],
  ["pages/me/goals", "目标", 2, R_ME, "pages/me/goals"],
  ["pages/me/achievements", "成就", 2, R_ME, "pages/me/achievements"],
  ["pages/me/proof", "贡献凭证", 2, R_ME, "pages/me/proof"],
  ["pages/me/wrapped", "年度回顾", 2, R_ME, "pages/me/wrapped"],
  ["pages/me/receipts", "收据", 2, R_ME, "pages/me/receipts"],
  ["pages/me/rewards", "奖励记录", 2, R_ME, "pages/me/rewards"],
  ["pages/me/help", "帮助中心", 2, R_ME, "pages/me/help"],
  ["pages/me/support", "客服", 2, R_ME, "pages/me/support"],
  ["pages/me/support-tickets", "工单", 3, R_ME, "pages/me/support"],
  ["pages/support/messages", "客服消息", 3, R_ME, "pages/me/support"],
  ["pages/support/chat", "客服会话", 3, R_ME, "pages/me/support"],
  ["pages/me/notifications", "消息", 2, R_ME, "pages/me/notifications"],
  ["pages/me/preferences", "偏好设置", 2, R_ME, "pages/me/preferences"],
  ["pages/me/language", "语言", 2, R_ME, "pages/me/preferences"],
  ["pages/me/replay-tour", "重播引导", 2, R_ME, "pages/me/replay-tour"],
  ["pages/me/risk-disclosure", "风险披露", 2, R_ME, "pages/me/risk-disclosure"],
  ["pages/me/trial", "试用", 2, R_ME, "pages/me/trial"],

  // ── 团队板块(parentL1=team)──
  ["pages/team/commissions", "佣金", 2, R_TEAM, "pages/team/commissions"],
  ["pages/team/commissions-how", "佣金 · 玩法说明", 3, R_TEAM, "pages/team/commissions"],
  ["pages/team/binary", "平衡匹配", 2, R_TEAM, "pages/team/binary"],
  ["pages/team/binary-how", "平衡匹配 · 玩法说明", 3, R_TEAM, "pages/team/binary"],
  ["pages/team/unilevel", "影响力网络版税", 2, R_TEAM, "pages/team/unilevel"],
  ["pages/team/unilevel-how", "网络版税 · 玩法说明", 3, R_TEAM, "pages/team/unilevel"],
  ["pages/team/agent", "区域大使", 2, R_TEAM, "pages/team/agent"],
  ["pages/team/rank", "V 级头衔", 2, R_TEAM, "pages/team/rank"],
  ["pages/team/rank-how", "V 级 · 玩法说明", 3, R_TEAM, "pages/team/rank"],
  ["pages/team/leaderboard", "邀请榜", 2, R_TEAM, "pages/team/leaderboard"],
  ["pages/team/leadership-pool", "领导池", 2, R_TEAM, "pages/team/leadership-pool"],
  ["pages/team/leadership-pool-how", "领导池 · 玩法说明", 3, R_TEAM, "pages/team/leadership-pool"],
  ["pages/team/network", "影响力网络", 2, R_TEAM, "pages/team/network"],
  ["pages/team/quota", "硬件配额", 2, R_TEAM, "pages/team/quota"],
  ["pages/team/tree", "族谱", 2, R_TEAM, "pages/team/tree"],

  // ── 创世节点板块(parentL1=genesis)──
  ["pages/genesis/holder", "创世持有", 2, "pages/genesis/genesis", "pages/genesis/holder"],
  ["pages/genesis/marketplace", "二级市场", 2, "pages/genesis/genesis", "pages/genesis/marketplace"],
  ["pages/genesis/how-it-works", "创世 · 玩法说明", 3, "pages/genesis/genesis", "pages/genesis/genesis"],

  // ── 质押板块(parentL1=staking)──
  ["pages/staking/how-it-works", "质押 · 玩法说明", 3, "pages/staking/staking", "pages/staking/staking"],

  // ── 信任中心板块(parentL1=trust)──
  ["pages/trust/nex", "NEX 信任", 2, "pages/trust/trust", "pages/trust/nex"],

  // ── 获客漏斗:引导 / 注册 / 登录(parentL1=index,纳入统计)──
  ["pages/onboarding/intro", "引导 · 介绍", 2, R_INDEX, "pages/onboarding/intro"],
  ["pages/onboarding/estimator", "引导 · 收益估算", 2, R_INDEX, "pages/onboarding/estimator"],
  ["pages/onboarding/connect", "引导 · 设备连接", 2, R_INDEX, "pages/onboarding/connect"],
  ["pages/onboarding/terms", "引导 · 条款", 2, R_INDEX, "pages/onboarding/terms"],
  ["pages/register/register", "注册", 2, R_INDEX, "pages/register/register"],
  ["pages/login/login", "登录", 2, R_INDEX, "pages/login/login"],

  // ── 纯系统/会话/工具页:不纳入行为统计(tracked=false)──
  ["pages/session/kicked", "会话被踢出", 3, R_ME, "pages/session/kicked", false],
  ["pages/ref/code", "邀请码", 3, R_TEAM, "pages/ref/code", false],
  ["pages/tx/hash", "交易详情", 3, R_ME, "pages/tx/hash", false],
];

export const PAGE_TREE: UxPageNode[] = SEEDS.map(([route, titleZh, level, parentL1, parentL2, tracked = true]) => ({
  route,
  titleZh,
  level,
  parentL1,
  parentL2,
  tracked,
}));

const NODE_BY_ROUTE = new Map(PAGE_TREE.map((n) => [n.route, n]));

/** 被追踪页数(统计覆盖面)。 */
export const TRACKED_COUNT = PAGE_TREE.filter((n) => n.tracked).length;
/** 被排除的系统页(UI 透明展示,不静默截断)。 */
export const EXCLUDED_PAGES = PAGE_TREE.filter((n) => !n.tracked);

/* ============================================================
   确定性种子:由 route+salt 派生稳定伪随机,SSR/CSR 一致。
   ============================================================ */

function hash32(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
/** 0–1 之间的确定性伪随机。 */
function seeded(route: string, salt: string): number {
  return (hash32(route + "|" + salt) % 100000) / 100000;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 时间窗对「计数类」指标的倍率(率类:停留/跳出 不随窗缩放)。基准=7d。 */
const WINDOW_FACTOR: Record<TimeWindow, number> = { "24h": 0.15, "7d": 1, "30d": 4.1 };

/** 各层级 PV 基准区间(7d) —— 越浅流量越大。 */
const PV_BAND: Record<PageLevel, [number, number]> = {
  1: [7800, 21000],
  2: [820, 5200],
  3: [110, 1300],
};

/**
 * 构造某时间窗下全部「被追踪页」的单页活跃聚合(确定性 mock)。
 * 接真后台:替换为 GET /analytics/behavior?window=... 的 fetch,返回同形 PageActivityStat[]。
 */
export function buildPageActivity(window: TimeWindow): PageActivityStat[] {
  const wf = WINDOW_FACTOR[window];
  return PAGE_TREE.filter((n) => n.tracked).map((n) => {
    const [lo, hi] = PV_BAND[n.level];
    const pvBase = Math.round(lerp(lo, hi, seeded(n.route, "pv")));
    const pv = Math.max(1, Math.round(pvBase * wf));
    const uv = Math.round(pv * lerp(0.52, 0.74, seeded(n.route, "uv")));
    const clicks = Math.round(pv * lerp(1.4, 4.6, seeded(n.route, "clk")));
    const dwellMs = Math.round(lerp(14000, 175000, seeded(n.route, "dwell")));
    const bounceRate = +lerp(0.08, 0.66, seeded(n.route, "bounce")).toFixed(3);
    return { route: n.route, pv, uv, clicks, dwellMs, bounceRate };
  });
}

/* ============================================================
   按层级聚合/过滤(四档互不相同)。
   语义:
     「一级」→ 全部活跃上卷到 parentL1(16 节点);
     「二级」→ 上卷到 parentL2(L1 入口页保持自身,L2 板块吸收其 L3 子页);
     「三级」→ 只看三级叶子页(详情/指南页),逐页(过滤 level===3,不上卷);
     「全部」→ 全部被追踪页逐页(不过滤、不上卷)。
   计数(pv/uv/clicks)求和;率(dwell/bounce)按 pv 加权平均。
   注:uv 为页面级 UV 之和(跨页未去重,故聚合行 uv 偏高但恒 ≤ pv);
       真后台聚合时会对桶内做 distinct user 去重,UI 直接消费返回值、无需改动。
   返回不排序(插入序=SEEDS 主题序),排序方向由消费方(组件)决定。
   ============================================================ */

function rollupKey(node: UxPageNode, depth: DepthFilter): string {
  if (depth === "L1") return node.parentL1;
  if (depth === "L2") return node.parentL2;
  return node.route; // L3 / all:逐页
}

export function aggregateByDepth(stats: PageActivityStat[], depth: DepthFilter): HeatRow[] {
  type Acc = { pv: number; uv: number; clicks: number; dwellNum: number; bounceNum: number; pages: number };
  const buckets = new Map<string, Acc>();
  for (const st of stats) {
    const node = NODE_BY_ROUTE.get(st.route);
    if (!node || !node.tracked) continue;
    if (depth === "L3" && node.level !== 3) continue; // 「三级」= 仅三级叶子页
    const key = rollupKey(node, depth);
    const acc = buckets.get(key) ?? { pv: 0, uv: 0, clicks: 0, dwellNum: 0, bounceNum: 0, pages: 0 };
    acc.pv += st.pv;
    acc.uv += st.uv;
    acc.clicks += st.clicks;
    acc.dwellNum += st.dwellMs * st.pv; // pv 加权
    acc.bounceNum += st.bounceRate * st.pv;
    acc.pages += 1;
    buckets.set(key, acc);
  }
  const rows: HeatRow[] = [];
  for (const [key, acc] of buckets) {
    const rep = NODE_BY_ROUTE.get(key);
    rows.push({
      key,
      titleZh: rep?.titleZh ?? key,
      level: rep?.level ?? 3,
      pv: acc.pv,
      uv: acc.uv,
      clicks: acc.clicks,
      dwellMs: acc.pv ? Math.round(acc.dwellNum / acc.pv) : 0,
      bounceRate: acc.pv ? +(acc.bounceNum / acc.pv).toFixed(3) : 0,
      pageCount: acc.pages,
    });
  }
  return rows;
}

/** 顶部 stat strip 汇总(总量 + 加权率 + 覆盖页数)。 */
export interface HeatSummary {
  totalPv: number;
  totalClicks: number;
  avgDwellMs: number;
  avgBounceRate: number;
  coveredPages: number;
}
export function summarize(stats: PageActivityStat[]): HeatSummary {
  let pv = 0;
  let clicks = 0;
  let dwellNum = 0;
  let bounceNum = 0;
  for (const s of stats) {
    pv += s.pv;
    clicks += s.clicks;
    dwellNum += s.dwellMs * s.pv;
    bounceNum += s.bounceRate * s.pv;
  }
  return {
    totalPv: pv,
    totalClicks: clicks,
    avgDwellMs: pv ? Math.round(dwellNum / pv) : 0,
    avgBounceRate: pv ? +(bounceNum / pv).toFixed(3) : 0,
    coveredPages: stats.length,
  };
}

/* ============================================================
   单页坐标热力(下钻)。
   真后台:GET /analytics/behavior/click-heat?route=... 返回 zones + points。
   mock:每页按 route 种子生成 4 个语义区(顶栏/主 CTA/列表/底部导航)+ 簇状点集。
   ============================================================ */

const ZONE_TEMPLATE: { label: string; cx: number; cy: number; baseShare: number; spread: number }[] = [
  { label: "顶栏 / 返回", cx: 0.5, cy: 0.07, baseShare: 0.12, spread: 0.05 },
  { label: "主行动按钮", cx: 0.5, cy: 0.46, baseShare: 0.34, spread: 0.09 },
  { label: "内容列表 / 卡片", cx: 0.5, cy: 0.68, baseShare: 0.32, spread: 0.14 },
  { label: "底部导航", cx: 0.5, cy: 0.95, baseShare: 0.22, spread: 0.04 },
];

export function buildPageClickHeat(route: string): PageClickHeat {
  const node = NODE_BY_ROUTE.get(route);
  const titleZh = node?.titleZh ?? route;
  // 每页对 4 区做权重微调(确定性),再归一化。
  const raw = ZONE_TEMPLATE.map((z, i) => z.baseShare * lerp(0.55, 1.5, seeded(route, "zone" + i)));
  const sum = raw.reduce((a, b) => a + b, 0);
  const zones: ClickHeatZone[] = ZONE_TEMPLATE.map((z, i) => ({
    label: z.label,
    cx: z.cx,
    cy: z.cy,
    share: +(raw[i] / sum).toFixed(3),
  }));
  // 簇状点集:每区按其 share 派生点数,在区中心附近抖动。
  const points: ClickHeatPoint[] = [];
  zones.forEach((z, zi) => {
    const tmpl = ZONE_TEMPLATE[zi];
    const n = 2 + Math.round(z.share * 12); // 2–8 点
    for (let k = 0; k < n; k++) {
      const a = seeded(route, `px${zi}_${k}`);
      const b = seeded(route, `py${zi}_${k}`);
      const w = seeded(route, `pw${zi}_${k}`);
      points.push({
        x: clamp01(z.cx + (a - 0.5) * 2 * (tmpl.spread + 0.06)),
        y: clamp01(z.cy + (b - 0.5) * 2 * tmpl.spread),
        weight: +Math.min(1, lerp(0.35, 1, w * (0.6 + z.share))).toFixed(3),
      });
    }
  });
  return { route, titleZh, zones, points };
}

function clamp01(v: number): number {
  return v < 0.02 ? 0.02 : v > 0.98 ? 0.98 : v;
}
