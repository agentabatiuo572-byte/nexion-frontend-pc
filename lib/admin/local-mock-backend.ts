/**
 * 本地预览 Mock 后端 —— LOCAL_PREVIEW(NEXT_PUBLIC_ADMIN_AUTH_BYPASS=1)时,
 * 数据 route handler(devices / e1 / platform [...path] + devices 裸 collection)短路调用本模块,
 * 返回本地 mock,不调真后端(8110)。协作者真后端取数代码保持不动;仅本地预览短路。
 *
 * 响应包络一律 { code: 0, data }(client 强制 code===0),Backend 形状(client 经 fromX 映射到 Ops)。
 * 注意:PageResult(tasks/orders/devices/skus/reviews) vs 裸数组(phone-tiers/datacenters)不可混。
 * 写端点(非 GET)统一回 { code:0, data:{} }(client 写后 re-fetch,故写不持久;预览演示可接受)。
 *
 * backend-replaceable:接真后端时 LOCAL_PREVIEW=0,本模块整体跳过,与生产零差异。
 */
import { E1_GENERATION_GATES } from "@/lib/mock/admin/design-data";

const LOCAL_PREVIEW = process.env.NEXT_PUBLIC_ADMIN_AUTH_BYPASS === "1";

export type MockResult = { code: 0; data: unknown };

// ─────────────────────────────── E2 任务引擎 ───────────────────────────────
const MOCK_TASKS = [
  { taskId: "TK-1001", name: "LLM 推理 · Llama-3 70B", price: 0.42, unit: "/job", requirement: "Pro+", saturation: 0.78, status: "active", taskClass: "llm-inference", model: "Llama-3-70B", minReward: 0.30, maxReward: 0.90, minVram: "48GB", killInit: "派发中" },
  { taskId: "TK-1002", name: "图像生成 · SDXL", price: 0.18, unit: "/job", requirement: "S1+", saturation: 0.64, status: "active", taskClass: "image-gen", model: "SDXL-1.0", minReward: 0.12, maxReward: 0.40, minVram: "16GB", killInit: "派发中" },
  { taskId: "TK-1003", name: "微调 · LoRA 7B", price: 1.20, unit: "/hr", requirement: "Pro+", saturation: 0.41, status: "active", taskClass: "fine-tune", model: "Llama-3-8B", minReward: 0.80, maxReward: 2.40, minVram: "24GB", killInit: "派发中" },
  { taskId: "TK-1004", name: "向量嵌入 · BGE-M3", price: 0.06, unit: "/1k", requirement: "Phone+", saturation: 0.88, status: "active", taskClass: "embedding", model: "BGE-M3", minReward: 0.04, maxReward: 0.12, minVram: "8GB", killInit: "派发中" },
  { taskId: "TK-1005", name: "训练 · RLHF 405B", price: 6.50, unit: "/hr", requirement: "Rack+", saturation: 0.23, status: "paused", taskClass: "training", model: "Custom-405B", minReward: 4.00, maxReward: 12.00, minVram: "320GB", killInit: "已暂停" },
];

const MOCK_PHONE_TIERS = [
  { tier: 1, name: "入门机(Phone S1)", note: "千元机基线", dailyUsdt: 0.05, dailyNex: 1.2, status: "active" },
  { tier: 2, name: "中端机(Phone P2)", note: "主流旗舰", dailyUsdt: 0.10, dailyNex: 2.5, status: "active" },
  { tier: 3, name: "高端机(Phone Pro)", note: "顶级 SoC", dailyUsdt: 0.19, dailyNex: 4.0, status: "active" },
  { tier: 4, name: "折叠/平板(Phone Max)", note: "大屏高算", dailyUsdt: 0.26, dailyNex: 5.5, status: "active" },
];

// ─────────────────────────────── E4 订单状态机 ───────────────────────────────
const MOCK_ORDERS = [
  { orderNo: "ORD-24061001", userNo: "U00001842", skuId: "stellarbox-s1", skuName: "NexionBox S1", amount: 199, state: "active", dcLocation: "Singapore DC", ageText: "在网 38 天", orderedAt: "2026-05-17", updatedAt: "2026-06-24" },
  { orderNo: "ORD-24061002", userNo: "U00002317", skuId: "stellarbox-pro", skuName: "NexionBox Pro", amount: 899, state: "allocating", dcLocation: "Dublin DC", ageText: "—", orderedAt: "2026-06-23", updatedAt: "2026-06-24" },
  { orderNo: "ORD-24061003", userNo: "U00000934", skuId: "stellarrack-p1", skuName: "NexionRack P1", amount: 4999, state: "paid", dcLocation: "Virginia DC", ageText: "—", orderedAt: "2026-06-24", updatedAt: "2026-06-24" },
  { orderNo: "ORD-24061004", userNo: "U00003120", skuId: "cloud-share", skuName: "Cloud Share", amount: 19.9, state: "created", dcLocation: "—", ageText: "—", orderedAt: "2026-06-24", updatedAt: "2026-06-24" },
  { orderNo: "ORD-24060087", userNo: "U00001188", skuId: "stellarbox-s1", skuName: "NexionBox S1", amount: 199, state: "refunded", dcLocation: "Singapore DC", ageText: "—", orderedAt: "2026-06-09", updatedAt: "2026-06-12" },
  { orderNo: "ORD-24060042", userNo: "U00002901", skuId: "stellarbox-pro", skuName: "NexionBox Pro", amount: 899, state: "payment_failed", dcLocation: "—", ageText: "—", orderedAt: "2026-06-04", updatedAt: "2026-06-04" },
];

// ─────────────────────────────── E5 设备运维 / 数据中心 ───────────────────────────────
const MOCK_DATACENTERS = [
  { dcLocation: "Singapore DC", regionLabel: "亚太 · 新加坡", status: "active", sortOrder: 1, totalDevices: 480, onlineDevices: 452, pendingRecycleDevices: 6, abnormalDevices: 3, avgGpuUsage: 71, avgGpuTempC: 64, avgGpuPowerW: 310, dispatchPaused: false, pausedReason: "" },
  { dcLocation: "Dublin DC", regionLabel: "欧洲 · 都柏林", status: "active", sortOrder: 2, totalDevices: 360, onlineDevices: 338, pendingRecycleDevices: 4, abnormalDevices: 2, avgGpuUsage: 66, avgGpuTempC: 61, avgGpuPowerW: 298, dispatchPaused: false, pausedReason: "" },
  { dcLocation: "Virginia DC", regionLabel: "美国 · 弗吉尼亚", status: "maintenance", sortOrder: 3, totalDevices: 400, onlineDevices: 372, pendingRecycleDevices: 5, abnormalDevices: 4, avgGpuUsage: 58, avgGpuTempC: 59, avgGpuPowerW: 285, dispatchPaused: true, pausedReason: "区域维护窗口" },
];

const MOCK_E5_OVERVIEW = {
  totalDevices: 1240,
  onlineDevices: 1162,
  offlineDevices: 60,
  recycledDevices: 18,
  pendingRecycleDevices: 15,
  abnormalDevices: 9,
  datacenters: MOCK_DATACENTERS,
};

const MOCK_DEVICES = [
  { id: 90101, instanceNo: "NX-SG-90101", userId: 1842, userNo: "U00001842", nickname: "用户-1842", name: "NX-SG-90101", productTier: "S1", productCode: "stellarbox-s1", status: "ONLINE", runtimeStatus: "OK", dcLocation: "Singapore DC", hashrate: 1280, dailyUsdt: 0.66, dailyNex: 14, pendingDeactivate: false, activeTaskNo: "TK-1001", heartbeatAt: "2026-06-24 03:28", lastSeenAt: "2026-06-24 03:28", activatedAt: "2026-05-17", deactivatedAt: null },
  { id: 90102, instanceNo: "NX-SG-90102", userId: 2317, userNo: "U00002317", nickname: "用户-2317", name: "NX-SG-90102", productTier: "Pro", productCode: "stellarbox-pro", status: "BUSY", runtimeStatus: "OK", dcLocation: "Singapore DC", hashrate: 5120, dailyUsdt: 2.40, dailyNex: 48, pendingDeactivate: false, activeTaskNo: "TK-1003", heartbeatAt: "2026-06-24 03:27", lastSeenAt: "2026-06-24 03:27", activatedAt: "2026-04-30", deactivatedAt: null },
  { id: 90201, instanceNo: "NX-DB-90201", userId: 934, userNo: "U00000934", nickname: "用户-0934", name: "NX-DB-90201", productTier: "Rack-P1", productCode: "stellarrack-p1", status: "ONLINE", runtimeStatus: "OK", dcLocation: "Dublin DC", hashrate: 20480, dailyUsdt: 9.80, dailyNex: 196, pendingDeactivate: false, activeTaskNo: "TK-1005", heartbeatAt: "2026-06-24 03:28", lastSeenAt: "2026-06-24 03:28", activatedAt: "2026-03-12", deactivatedAt: null },
  { id: 90202, instanceNo: "NX-DB-90202", userId: 1188, userNo: "U00001188", nickname: "用户-1188", name: "NX-DB-90202", productTier: "S1", productCode: "stellarbox-s1", status: "OFFLINE", runtimeStatus: "LOST", dcLocation: "Dublin DC", hashrate: 0, dailyUsdt: 0, dailyNex: 0, pendingDeactivate: false, activeTaskNo: "—", heartbeatAt: "2026-06-22 19:04", lastSeenAt: "2026-06-22 19:04", activatedAt: "2026-05-01", deactivatedAt: null },
  { id: 90301, instanceNo: "NX-VA-90301", userId: 2901, userNo: "U00002901", nickname: "用户-2901", name: "NX-VA-90301", productTier: "Pro", productCode: "stellarbox-pro", status: "ABNORMAL", runtimeStatus: "ERROR", dcLocation: "Virginia DC", hashrate: 4800, dailyUsdt: 2.10, dailyNex: 42, pendingDeactivate: true, activeTaskNo: "—", heartbeatAt: "2026-06-24 02:51", lastSeenAt: "2026-06-24 02:51", activatedAt: "2026-04-18", deactivatedAt: null },
  { id: 90302, instanceNo: "NX-VA-90302", userId: 3120, userNo: "U00003120", nickname: "用户-3120", name: "NX-VA-90302", productTier: "Cloud", productCode: "cloud-share", status: "INVENTORY", runtimeStatus: "OK", dcLocation: "Virginia DC", hashrate: 320, dailyUsdt: 0.19, dailyNex: 3, pendingDeactivate: false, activeTaskNo: "—", heartbeatAt: "2026-06-24 03:20", lastSeenAt: "2026-06-24 03:20", activatedAt: "2026-06-20", deactivatedAt: null },
  { id: 90103, instanceNo: "NX-SG-90103", userId: 4501, userNo: "U00004501", nickname: "用户-4501", name: "NX-SG-90103", productTier: "S1", productCode: "stellarbox-s1", status: "RECYCLED", runtimeStatus: "OK", dcLocation: "Singapore DC", hashrate: 0, dailyUsdt: 0, dailyNex: 0, pendingDeactivate: false, activeTaskNo: "—", heartbeatAt: "2026-06-10 11:00", lastSeenAt: "2026-06-10 11:00", activatedAt: "2026-01-15", deactivatedAt: "2026-06-10" },
];

// ─────────────────────────────── E3 生命周期 & Trade-in ───────────────────────────────
// 前端 key 直接透传(client BACKEND_TO_FRONTEND_KEY 命中不到则原样保留)。镜像 device-lifecycle.ts。
const MOCK_E3_CONFIG: Record<string, string> = {
  // FEAT-DEV01 任务产能节奏(等效换皮:数值不变,键名改 capacity 口径,与 e-tabs/data.ts 种子镜像)
  "E.device.capacity.floorPct": "22",
  "E.device.capacity.band1DeltaPct": "-4",
  "E.device.capacity.band2DeltaPct": "-6",
  "E.device.capacity.band3DeltaPct": "-23.7",
  "E.device.stageEarlyEnd": "3",
  "E.device.stageMidEnd": "8",
  "E.device.cycleMonths": "12",
  "E.device.capacity.subsidyDays": "30",
  "E.device.capacity.applyTo.phone": "免递减",
  "E.device.capacity.applyTo.cloud-share": "免递减",
  "E.device.capacity.applyTo.pc-gpu": "免递减",
  "E.device.capacity.applyTo.stellarbox-s1": "参与递减",
  "E.device.capacity.applyTo.stellarbox-pro": "参与递减",
  "E.device.capacity.applyTo.stellarbox-pro-v2": "参与递减",
  "E.device.capacity.applyTo.stellarrack-p1": "参与递减",
  "E.device.capacity.applyTo.stellarrack-p2": "参与递减",
  "E.device.taskLock.s1": "40",
  "E.device.taskLock.pro": "140",
  "E.device.taskLock.rack": "450",
  "E.release.earlyAccess.enabled": "关",  // 置换侧抢先购(上架前置换可购)· 源码 TRADEIN_EARLY_ACCESS.enabled=false
  "E.release.earlyAccess.leadDays": "30", // 抢先购提前天数 · 档位 7/14/30/60/90
  "E.tradein.enabled": "开",
  "E.tradein.ladder.cut1": "25",
  "E.tradein.ladder.cut2": "50",
  "E.tradein.ladder.cut3": "75",
  "E.tradein.ladder.cut4": "100",
  "E.tradein.ladder.credit1": "75",
  "E.tradein.ladder.credit2": "60",
  "E.tradein.ladder.credit3": "45",
  "E.tradein.ladder.credit4": "30",
  "E.tradein.ladder.credit5": "15",
  "E.tradein.requireHigherPrice": "开",
  "E.tradein.maxDevicesPerOrder": "1",
  "E.tradein.eligibility": "L4+ 持有者",
  "E.tradein.promoMult": "1.0",
  "E.tradein.promo.cooldownDays": "14",
  "E.tradein.promo.maxPerSession": "1",
  "E.tradein.promo.delaySec": "6",
  "E.tradein.promo.minAgeDays": "30",
  "E.tradein.promo.routes": "/me/devices",
  "E.tradein.inventorySoftMax": "0",
};

const MOCK_TRADEIN = {
  averageAgeMonths: 5.2,
  cliffDeviceCount: 3184,
  tradeinMonthCount: 412,
  tradeinDiscountUsdt: 284000,
  k2ArbitrageHits: 12,
  txStats: [] as unknown[],
};

// ─────────────────────────────── E1 商品目录(E1 页有组件级旁路,通常不触发;留兜底) ───────────────────────────────
const MOCK_BACKEND_SKUS = [
  { skuId: "stellarbox-s1", id: "stellarbox-s1", name: "NexionBox S1", tier: "Entry", price: 199, gpu: "RTX 4060 Ti", vram: "16GB", hashRate: "1.28 TFLOPS", power: "120W", dailyEarnUsdt: 0.66, dailyEarnNex: 14, sold: 8420, stock: 1200, rating: 4.8, reviews: 312, status: "active", datacenter: "Singapore DC", unlockPhase: "P1" },
  { skuId: "stellarbox-pro", id: "stellarbox-pro", name: "NexionBox Pro", tier: "Pro", price: 899, gpu: "RTX 4090", vram: "24GB", hashRate: "5.12 TFLOPS", power: "320W", dailyEarnUsdt: 2.40, dailyEarnNex: 48, sold: 3140, stock: 600, rating: 4.9, reviews: 188, status: "active", datacenter: "Dublin DC", unlockPhase: "P1" },
  { skuId: "stellarrack-p1", id: "stellarrack-p1", name: "NexionRack P1", tier: "Rack", price: 4999, gpu: "8× A100", vram: "320GB", hashRate: "20.5 TFLOPS", power: "3200W", dailyEarnUsdt: 9.80, dailyEarnNex: 196, sold: 420, stock: 80, rating: 5.0, reviews: 47, status: "active", datacenter: "Virginia DC", unlockPhase: "P2" },
  { skuId: "cloud-share", id: "cloud-share", name: "Cloud Share", tier: "Entry", price: 19.9, gpu: "共享算力", vram: "—", hashRate: "0.32 TFLOPS", power: "—", dailyEarnUsdt: 0.19, dailyEarnNex: 3, sold: 15800, stock: 99999, rating: 4.6, reviews: 642, status: "active", datacenter: "Singapore DC", unlockPhase: "P1" },
];

const MOCK_BACKEND_REVIEWS = [
  { reviewId: "RV-001", skuId: "stellarbox-s1", author: "李**", rating: 5, content: "第一周就回了不少电费,稳定。", dateText: "2026-06-18", status: "published" },
  { reviewId: "RV-002", skuId: "stellarbox-pro", author: "王**", rating: 5, content: "Pro 算力明显,任务派发快。", dateText: "2026-06-15", status: "published" },
  { reviewId: "RV-003", skuId: "cloud-share", author: "陈**", rating: 4, content: "入门体验不错,准备升级 S1。", dateText: "2026-06-12", status: "published" },
];

// ─────────────────────────────── A1 账户与权限 ───────────────────────────────
const MOCK_A1_OVERVIEW = {
  stats: {
    totalAccounts: 24,
    activeAccounts: 21,
    disabledAccounts: 3,
    activeSessions: 9,
    effectiveSupers: 2,
    pendingAcctTickets: 1,
  },
  roles: [
    { key: "superadmin", name: "超级管理员", av: "超", color: "var(--admin-domain-a)", desc: "全域读写 + 账号治理 + kill-switch", scope: "全平台" },
    { key: "finance", name: "财务运营", av: "财", color: "var(--data-2)", desc: "资金审核 / 提现放行 / 对账", scope: "D 资金域" },
    { key: "risk", name: "风控运营", av: "风", color: "var(--data-5)", desc: "风控处置 / 反作弊 / 应急止血", scope: "C/K/J" },
    { key: "growth", name: "增长运营", av: "增", color: "var(--data-3)", desc: "活动 / 佣金 / phase 调度", scope: "F/G/H" },
    { key: "content", name: "内容运营", av: "内", color: "var(--data-4)", desc: "CMS / 文案 / 合规内容", scope: "I 内容域" },
    { key: "support", name: "客服", av: "客", color: "var(--data-6)", desc: "工单 / 会话 / 知识库", scope: "M 客服域" },
    { key: "auditor", name: "只读审计", av: "审", color: "var(--ink-3)", desc: "全域只读 + 审计日志", scope: "全平台只读" },
  ],
  operators: [
    { id: 1, name: "总管理员", email: "admin@nexion.local", role: "superadmin", tier: null, tfa: true, status: "enabled", lastLogin: "2026-06-24 03:20", sessions: 1 },
    { id: 2, name: "周·财务", email: "zhou.fin@nexion.local", role: "finance", tier: "lead", tfa: true, status: "enabled", lastLogin: "2026-06-24 01:42", sessions: 1 },
    { id: 3, name: "刘·风控", email: "liu.risk@nexion.local", role: "risk", tier: "lead", tfa: true, status: "enabled", lastLogin: "2026-06-23 22:11", sessions: 2 },
    { id: 4, name: "孙·增长", email: "sun.grow@nexion.local", role: "growth", tier: "member", tfa: false, status: "enabled", lastLogin: "2026-06-23 18:30", sessions: 1 },
    { id: 5, name: "赵·审计", email: "zhao.audit@nexion.local", role: "auditor", tier: null, tfa: true, status: "disabled", lastLogin: "2026-06-20 09:05", sessions: 0 },
  ],
  rbacMatrix: [
    { id: "rbac-fund", action: "资金放行 / 提现审核", domainGroup: "D 资金", grants: ["superadmin", "finance"] },
    { id: "rbac-risk", action: "风控处置 / 封禁", domainGroup: "C/K 风控", grants: ["superadmin", "risk"] },
    { id: "rbac-phase", action: "Phase 调度 / 参数批改", domainGroup: "H 节奏", grants: ["superadmin", "growth"] },
    { id: "rbac-kill", action: "Kill-Switch 止血", domainGroup: "J 应急", grants: ["superadmin"] },
    { id: "rbac-cms", action: "CMS 发布 / 文案", domainGroup: "I 内容", grants: ["superadmin", "content"] },
    { id: "rbac-audit", action: "审计日志只读", domainGroup: "A 平台", grants: ["superadmin", "auditor", "finance", "risk", "growth", "content", "support"] },
  ],
  securityBaselines: [
    { key: "tfa-required", name: "强制双因子(2FA)", sub: "lead 及以上必须开启", value: "已启用", locked: true },
    { key: "session-ttl", name: "会话有效期", sub: "空闲超时自动登出", value: "12 小时", locked: false },
    { key: "ip-allowlist", name: "登录 IP 白名单", sub: "超管登录限内网段", value: "已启用", locked: false },
    { key: "pwd-rotation", name: "密码轮换周期", sub: "到期强制改密", value: "90 天", locked: false },
  ],
};

// ─────────────────────────────── 分发器 ───────────────────────────────
function pageOf(records: unknown[], search: URLSearchParams): MockResult {
  const pageNum = Number(search.get("pageNum") ?? 1) || 1;
  const pageSize = Number(search.get("pageSize") ?? 100) || 100;
  const start = (pageNum - 1) * pageSize;
  return { code: 0, data: { total: records.length, pageNum, pageSize, records: records.slice(start, start + pageSize) } };
}

function filterOrders(search: URLSearchParams): unknown[] {
  const state = search.get("state");
  const keyword = (search.get("keyword") ?? "").trim().toLowerCase();
  let rows = MOCK_ORDERS as { state: string; orderNo: string; userNo: string }[];
  if (state && state !== "all") rows = rows.filter((o) => o.state === state);
  if (keyword) rows = rows.filter((o) => o.orderNo.toLowerCase().includes(keyword) || o.userNo.toLowerCase().includes(keyword));
  return rows;
}

/**
 * 本地预览 mock 分发。domain ∈ devices|e1|platform。pathParts = route 的 params.path(不含 domain 前缀);
 * devices 裸 collection(端点8)传 []。返回 null = 未命中 → 调用方继续走真后端(白名单外路径)。
 */
export function localMockResponse(
  domain: "devices" | "e1" | "platform",
  method: string,
  pathParts: string[],
  search: URLSearchParams,
): MockResult | null {
  if (!LOCAL_PREVIEW) return null;
  // 非 GET(写操作):统一成功无操作(client 写后 re-fetch,故不持久但页面不崩)。
  if (method !== "GET") {
    if (domain === "e1" && (pathParts[0] === "generation-gates" || pathParts[0] === "phases")) {
      return { code: 0, data: E1_GENERATION_GATES };
    }
    return { code: 0, data: {} };
  }

  const key = pathParts.join("/");

  if (domain === "devices") {
    if (key === "") return pageOf(MOCK_DEVICES, search); // 端点8 裸 collection
    if (key === "tasks") return pageOf(MOCK_TASKS, search);
    if (key === "phone-tiers") return { code: 0, data: MOCK_PHONE_TIERS };
    if (key === "orders") return pageOf(filterOrders(search), search);
    if (key === "overview") return { code: 0, data: MOCK_E5_OVERVIEW };
    if (key === "datacenters") return { code: 0, data: MOCK_DATACENTERS };
    if (key === "e3/overview") return { code: 0, data: { config: MOCK_E3_CONFIG } };
    if (key === "e3/tradein/overview") return { code: 0, data: MOCK_TRADEIN };
    return null;
  }

  if (domain === "e1") {
    if (key === "skus") return pageOf(MOCK_BACKEND_SKUS, search);
    if (key === "reviews") return pageOf(MOCK_BACKEND_REVIEWS, search);
    if (key === "generation-gates") return { code: 0, data: E1_GENERATION_GATES };
    return null;
  }

  if (domain === "platform") {
    if (key === "accounts/overview") return { code: 0, data: MOCK_A1_OVERVIEW };
    return null;
  }

  return null;
}
