/**
 * E 域核心数据 & 派生口径(从 e-view.tsx 移出,口径不改)。
 * server-canonical:E1/E2/E3/E4 展示值来自后端接口;E5 设备运维与数据中心来自设备接口。
 * 视图局部的纯设计数组(timeline / 热力图 / DC / feed / tx 监控 等)放各子视图文件内,保持本文件聚焦逻辑。
 */
import type { OpsSku, PurchaseGate } from "@/lib/store/admin/platform-config-store";

// 全系统统一连续编号 E1-E5(上架门原 E2 并入 E1、设备生命周期原 E4 并入 E5→现 E3);E6 算力与设备配置为三端改造 SPEC-0 新增。
// nav id == 视图 key == 组件名 == prdAnchor == PRD §10 章节,FOLD 恒等映射。
export const FOLD: Record<string, string> = { E1: "E1", E2: "E2", E3: "E3", E4: "E4", E5: "E5", E6: "E6" };

export const ORDER_FLOW = ["created", "paid", "allocating", "active"];
// design-kit Badge tone 映射(订单状态)。
export const ostate: Record<string, string> = { created: "neutral", paid: "info", allocating: "cyan", active: "ok", failed: "err", refunded: "warn", cancelled: "neutral", payment_failed: "err", expired: "warn", provisioning_failed: "err" };
// 终态中文标签。
const STATE_LABEL: Record<string, string> = { created: "已创建", paid: "已支付", allocating: "分配中", active: "运行中", failed: "失败", cancelled: "已取消", payment_failed: "支付失败", expired: "已过期", refunded: "已退款", provisioning_failed: "开通失败" };
export const stateLabel = (s: string): string => STATE_LABEL[s] ?? s;

// E-13 补建终态可选值(为缺失终态的订单手动落定;真后台由订单状态机校验后写入)。
export const TERMINAL_STATES = ["payment_failed", "expired", "refunded", "provisioning_failed"] as const;
// 非终态(仍流转,允许补建终态);created/paid 另允许「取消订单」。
export const NON_TERMINAL = new Set(["created", "paid", "allocating"]);

// E-11 产能节奏/置换调参种子参考;运行时由 GET /api/admin/devices/e3/overview 下发。
// FEAT-DEV01 任务产能节奏(等效换皮):数值 = 原三段曲线原样保留,键名/叙事改「任务产能」。
// 种子值镜像产品源码 device-lifecycle.ts TASK_CAPACITY_BANDS:−4/−6/−23.7%·floor 22%(canon 哨兵三端对账)。
export const E_PARAM_DEFAULTS: Record<string, string> = {
  "E.device.capacity.floorPct": "22",        // 产能下限 · 源码 CAPACITY_FLOOR = 0.22
  "E.device.capacity.band1DeltaPct": "-4",   // 月 1-3 每月产能变化 %
  "E.device.capacity.band2DeltaPct": "-6",   // 月 4-8 每月产能变化 %
  "E.device.capacity.band3DeltaPct": "-23.7",// 月 9 起每月产能变化 %(末段开区间,floor 触底)
  "E.device.stageEarlyEnd": "3",             // 段1 末月
  "E.device.stageMidEnd": "8",               // 段2 末月
  "E.device.cycleMonths": "12",              // 曲线视窗月数
  "E.device.capacity.subsidyDays": "30",     // 新机任务补贴天数 · 纯展示层,禁入结算(FEAT-DEV01B)
  // 参与任务递减(每 SKU 开关;值=参与递减/免递减;默认镜像 uniapp CAPACITY_EXEMPT_KINDS)
  "E.device.capacity.applyTo.phone": "免递减",
  "E.device.capacity.applyTo.cloud-share": "免递减",
  "E.device.capacity.applyTo.pc-gpu": "免递减",
  "E.device.capacity.applyTo.stellarbox-s1": "参与递减",
  "E.device.capacity.applyTo.stellarbox-pro": "参与递减",
  "E.device.capacity.applyTo.stellarbox-pro-v2": "参与递减",
  "E.device.capacity.applyTo.stellarrack-p1": "参与递减",
  "E.device.capacity.applyTo.stellarrack-p2": "参与递减",
  // E3 任务锁定月度损失阈值(S1/Pro/Rack 三阶 · USDT · 各值独立可调,backend-replaceable)
  "E.device.taskLock.s1": "40",
  "E.device.taskLock.pro": "140",
  "E.device.taskLock.rack": "450",
  // FEAT-DEV02 升级置换阶梯(激进档):抵扣率按「累计产出 ÷ 实付价」落档,产出越多抵扣越小。
  // 界点 4 值 + 各档抵扣率 5 值分开配置,区间连续由构造保证;与 uniapp TRADEIN_CREDIT_LADDER、
  // canon-numbers.json tradeInLadder 三端对账。旧 salvagePct/minHoldingMonths 已删(随时下架,阶梯天然抗套利)。
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
  "E.tradein.eligibility": "L4+ 持有者",  // 置换资格门槛(持有等级)· 运营可调
  "E.tradein.promoMult": "1.0",
  // 置换弹窗节奏 5 参(各值独立可调):冷却天 / 每会话上限 / 延迟秒 / 设备最低龄天 / 入口路由
  "E.tradein.promo.cooldownDays": "14",
  "E.tradein.promo.maxPerSession": "1",
  "E.tradein.promo.delaySec": "6",
  "E.tradein.promo.minAgeDays": "30",
  "E.tradein.promo.routes": "/me/devices",
  "E.tradein.inventorySoftMax": "0",
};

// E3 任务产能曲线引擎 — 镜像产品 device-lifecycle.ts getEfficiency(三段复利 + floor)。
// 参数从后台配置(pE)读,使后台为 server-canonical 配置源、曲线真实反映设备可接任务产能节奏。
export function effCurve(early: number, mid: number, late: number, stage1: number, stage2: number, months: number, floorPct: number): number[] {
  const pts: number[] = [100];
  let eff = 1;
  for (let m = 1; m <= months; m++) {
    const rate = m <= stage1 ? early : m <= stage2 ? mid : late;
    eff *= 1 + rate / 100;
    pts.push(Math.round(Math.max(floorPct / 100, eff) * 100));
  }
  return pts;
}

// 算力池预置(SKU「解锁算力池 unlocks」多选 — 取自现有 SKU seed 的算力池文案)。
// 运营勾选多个 + 仍可自定义;表单内以逗号串存 form.aiUnlocks(单值 string,前端零改、原样渲染逗号串 = 功能一致)。
// backend-replaceable:真后台对接时由 GET /api/admin/compute-pools 下发替换本地预置(同 DATA_CENTERS 模式)。
export const AI_COMPUTE_POOLS = [
  "LLM 70B inference pool",
  "Flagship compute pool (Fine-tune + 405B inference)",
  "Flagship AI + multi-tenant 405B",
  "Training pool (RLHF / from-scratch 8B)",
  "Training pool (RLHF / 70B from-scratch)",
  "Fractional access to network's IG + EM + SP pools",
] as const;

// 数据中心 seed(E5 运维可增删改的单源;SKU datacenter 下拉读 displayName)。
// { id 区域 id · location 所在地 · displayName 前端展示名称 };真后台对接 1:1 映射数据中心资源。
export const DATA_CENTERS_SEED: { id: string; location: string; displayName: string }[] = [
  { id: "ap-southeast-1", location: "亚太 · 新加坡", displayName: "Singapore DC" },
  { id: "eu-west-1", location: "欧洲 · 都柏林", displayName: "Dublin DC" },
  { id: "us-east-2", location: "美国 · 弗吉尼亚", displayName: "Virginia DC" },
];

// ── SKU 表单 = 前端 Product 全字段镜像。input 一律 string,提交时 formToSku 转结构化 OpsSku ──
export const EMPTY_SKU_FORM = {
  name: "", id: "", tier: "Entry", tagline: "", badge: "",
  gpu: "", vram: "", hashRate: "", power: "", datacenter: "Singapore DC",
  price: "",
  dailyEarn: "", dailyEarnNEX: "", shareYieldMin: "", shareYieldMax: "",
  sold: "", stock: "", rating: "", reviews: "",
  aiImageGenPerMin: "", aiLlmTokensPerSec: "", aiVideoMinPerHour: "", aiFineTuneMins: "", aiUnlocks: "",
  features: "",
  lifecycle: "active", unlock: "", tag: "",
  // ⑦ 购买限制(扁平表单字段 → formToSku 组装为结构化 OpsSku.purchaseGate)。
  // gateType = 条件门形态:none(无门)/ activeDirect(单活跃直推)/ rank(单 V 级)/ combo(组合)。
  // 锁额(quota)与条件门正交,任意门类型下均可设。
  gateType: "none", gateRankMin: "", gateActiveDirectMin: "", gateTeamVolumeMin: "", gateMode: "all",
  gateQuotaCap: "", gateQuotaSold: "", gateQuotaPeriod: "month", gateEnforce: "true",
};
export type SkuForm = typeof EMPTY_SKU_FORM;

// purchaseGate → 表单门类型:条件门形态由「设了哪几个条件」反推。
// 单 activeDirect → activeDirect;单 rank → rank;其余(含 teamVolume 或多条件)→ combo;无条件 → none(可能仍有锁额)。
export function gateToType(g?: PurchaseGate): SkuForm["gateType"] {
  if (!g) return "none";
  const hasRank = g.rankMin != null, hasDirect = g.activeDirectMin != null, hasVol = g.teamVolumeMin != null;
  const n = (hasRank ? 1 : 0) + (hasDirect ? 1 : 0) + (hasVol ? 1 : 0);
  if (n === 0) return "none";
  if (n === 1 && hasDirect) return "activeDirect";
  if (n === 1 && hasRank) return "rank";
  return "combo";
}

export const skuNum = (s: string): number => { const n = Number(String(s).replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : 0; };
export const skuNumU = (s: string): number | undefined => { const t = String(s).trim(); if (!t) return undefined; const n = Number(t.replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : undefined; };

// OpsSku → 表单(编辑回填:数字转 string,features 数组转换行文本,purchaseGate 扁平回填)。
export function skuToForm(s: OpsSku): SkuForm {
  const str = (v: number | string | undefined): string => (v === undefined || v === null ? "" : String(v));
  const g = s.purchaseGate;
  return {
    name: s.name ?? "", id: s.id ?? "", tier: s.tier ?? "Entry", tagline: s.tagline ?? "", badge: s.badge ?? "",
    gpu: s.gpu ?? "", vram: s.vram ?? "", hashRate: s.hashRate ?? "", power: s.power ?? "", datacenter: s.datacenter ?? "",
    price: str(s.price),
    dailyEarn: str(s.dailyEarn), dailyEarnNEX: str(s.dailyEarnNEX), shareYieldMin: str(s.shareYieldMin), shareYieldMax: str(s.shareYieldMax),
    sold: str(s.sold), stock: str(s.stock), rating: str(s.rating), reviews: str(s.reviews),
    aiImageGenPerMin: str(s.aiImageGenPerMin), aiLlmTokensPerSec: str(s.aiLlmTokensPerSec), aiVideoMinPerHour: str(s.aiVideoMinPerHour), aiFineTuneMins: str(s.aiFineTuneMins), aiUnlocks: s.aiUnlocks ?? "",
    features: (s.features ?? []).join("\n"),
    lifecycle: s.lifecycle ?? "active", unlock: s.unlock ?? "", tag: s.tag ?? "",
    gateType: gateToType(g),
    gateRankMin: str(g?.rankMin), gateActiveDirectMin: str(g?.activeDirectMin), gateTeamVolumeMin: str(g?.teamVolumeMin),
    gateMode: g?.mode === "either" ? "either" : "all",
    gateQuotaCap: str(g?.quotaCap), gateQuotaSold: str(g?.quotaSold),
    gateQuotaPeriod: g?.quotaPeriod === "lifetime" ? "lifetime" : "month",
    gateEnforce: g ? (g.enforce ? "true" : "false") : "true",
  };
}

// 表单 → purchaseGate(无条件且无锁额 → undefined = 无门)。条件门按 gateType 取相应阈值;锁额正交。
export function formToGate(f: SkuForm): PurchaseGate | undefined {
  let rankMin: number | undefined, activeDirectMin: number | undefined, teamVolumeMin: number | undefined;
  if (f.gateType === "activeDirect") activeDirectMin = skuNumU(f.gateActiveDirectMin);
  else if (f.gateType === "rank") rankMin = skuNumU(f.gateRankMin);
  else if (f.gateType === "combo") {
    rankMin = skuNumU(f.gateRankMin); activeDirectMin = skuNumU(f.gateActiveDirectMin); teamVolumeMin = skuNumU(f.gateTeamVolumeMin);
  }
  const cap = skuNumU(f.gateQuotaCap);
  const hasCond = rankMin != null || activeDirectMin != null || teamVolumeMin != null;
  const hasQuota = cap != null;
  if (!hasCond && !hasQuota) return undefined;
  return {
    rankMin, activeDirectMin, teamVolumeMin,
    mode: f.gateMode === "either" ? "either" : "all",
    quotaCap: cap,
    quotaSold: hasQuota ? Math.max(0, skuNumU(f.gateQuotaSold) ?? 0) : undefined, // 防御:已售下限 0(校验已拦负数,store 层再兜底)
    quotaPeriod: hasQuota ? (f.gateQuotaPeriod === "lifetime" ? "lifetime" : "month") : undefined,
    enforce: f.gateEnforce !== "false",
  };
}

// 锁额余量单源(remaining = cap − sold,下限 0)。抽屉派生提示 + E1 卡 chip 共用此函数,
// 杜绝公式在多处重复(对齐前端 evaluatePurchaseGate 的 remaining 口径)。无 cap = null(不限量)。
export function gateRemaining(g: PurchaseGate): number | null {
  return g.quotaCap != null ? Math.max(0, g.quotaCap - (g.quotaSold ?? 0)) : null;
}

// 购买门表单校验(提交前调;返回错误串 = 拦截,null = 通过)。
// 注:这是输入完整性/取值范围校验,非「锁死业务值」——阈值/开关本身全运营可调(铁律)。
export function validateGateForm(f: SkuForm): string | null {
  if (f.tier !== "Share" && !f.unlock.trim()) return "请先配置并选择解锁 Phase";
  if (f.gateType === "activeDirect" && skuNumU(f.gateActiveDirectMin) == null) return "购买门:请填写活跃直推门槛";
  if (f.gateType === "rank" && skuNumU(f.gateRankMin) == null) return "购买门:请填写最低 V 级";
  if (f.gateType === "combo" && skuNumU(f.gateRankMin) == null && skuNumU(f.gateActiveDirectMin) == null && skuNumU(f.gateTeamVolumeMin) == null)
    return "购买门:组合门槛至少填一个条件";
  const rank = skuNumU(f.gateRankMin);
  if (rank != null && (rank < 0 || rank > 12)) return "购买门:V 级须在 0-12 之间";
  const direct = skuNumU(f.gateActiveDirectMin);
  if (direct != null && direct < 0) return "购买门:活跃直推门槛须为非负数";
  const vol = skuNumU(f.gateTeamVolumeMin);
  if (vol != null && vol < 0) return "购买门:团队业绩门槛须为非负数";
  const cap = skuNumU(f.gateQuotaCap), sold = skuNumU(f.gateQuotaSold);
  if (cap != null && cap <= 0) return "购买门:锁额上限须为正数(留空=不限量)";
  if (sold != null && sold < 0) return "购买门:已售数量不能为负数";
  if (cap != null && sold != null && sold > cap) return "购买门:已售不能超过锁额上限";
  return null;
}

// 表单 → OpsSku(提交:string 转结构化双币 + 合成 baseRate 兼容串;上下架 status 沿用既有/新建 pending)。
export function formToSku(f: SkuForm, existing?: OpsSku): OpsSku {
  const dailyEarn = skuNum(f.dailyEarn);
  const dailyEarnNEX = skuNum(f.dailyEarnNEX);
  const isShare = f.tier === "Share";
  const baseRate = isShare && (f.shareYieldMin || f.shareYieldMax)
    ? `${skuNum(f.shareYieldMin)}–${skuNum(f.shareYieldMax)}% 年化 · ${dailyEarnNEX} NEX`
    : `$${dailyEarn.toFixed(2)}/d · ${dailyEarnNEX.toLocaleString()} NEX`;
  const features = f.features.split("\n").map((x) => x.trim()).filter(Boolean);
  const stockTrim = f.stock.trim();
  return {
    name: f.name.trim(), id: f.id.trim() || existing?.id,
    tier: f.tier, tagline: f.tagline.trim() || undefined, badge: f.badge.trim() || undefined,
    gpu: f.gpu.trim() || undefined, vram: f.vram.trim() || undefined, hashRate: f.hashRate.trim() || undefined, power: f.power.trim() || undefined, datacenter: f.datacenter.trim() || undefined,
    price: skuNum(f.price),
    dailyEarn, dailyEarnNEX, shareYieldMin: skuNumU(f.shareYieldMin), shareYieldMax: skuNumU(f.shareYieldMax), baseRate,
    sold: skuNumU(f.sold), stock: stockTrim === "" ? "∞" : (skuNumU(stockTrim) ?? stockTrim), rating: skuNumU(f.rating), reviews: skuNumU(f.reviews),
    aiImageGenPerMin: skuNumU(f.aiImageGenPerMin), aiLlmTokensPerSec: skuNumU(f.aiLlmTokensPerSec), aiVideoMinPerHour: skuNumU(f.aiVideoMinPerHour), aiFineTuneMins: skuNumU(f.aiFineTuneMins), aiUnlocks: f.aiUnlocks.trim() || undefined,
    features: features.length ? features : undefined,
    lifecycle: f.lifecycle,
    unlock: f.unlock, purchaseGate: formToGate(f), tag: f.tag.trim() || existing?.tag || "", status: existing?.status ?? "pending",
  };
}
