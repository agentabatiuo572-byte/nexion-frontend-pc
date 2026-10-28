/**
 * E 域核心数据 & 派生口径(从 e-view.tsx 移出,口径不改)。
 * server-canonical:E1/E2/E3/E4 展示值来自后端接口;E5 设备运维与数据中心来自设备接口。
 * 视图局部的纯设计数组(timeline / 热力图 / DC / feed / tx 监控 等)放各子视图文件内,保持本文件聚焦逻辑。
 */
import type { OpsSku, PurchaseGate } from "@/lib/admin/platform-types";

// 全系统统一连续编号 E1-E5(上架节奏门并入 E1、设备生命周期归 E3)。
// nav id == 视图 key == 组件名 == prdAnchor == PRD §10 章节,FOLD 恒等映射。
export const FOLD: Record<string, string> = { E1: "E1", E2: "E2", E3: "E3", E4: "E4", E5: "E5", E6: "E6" };

export const ORDER_FLOW = ["placed", "paid", "provisioning", "activated"];
// design-kit Badge tone 映射(订单状态)。
export const ostate: Record<string, string> = { placed: "neutral", paid: "info", provisioning: "cyan", activated: "ok", refunded: "warn", cancelled: "neutral", payment_failed: "err", expired: "warn", provisioning_failed: "err", chargeback: "err" };
// 终态中文标签。
const STATE_LABEL: Record<string, string> = { placed: "已下单", paid: "已支付", provisioning: "开通中", activated: "已激活", cancelled: "已取消", payment_failed: "支付失败", expired: "已过期", refunded: "已退款", provisioning_failed: "开通失败", chargeback: "拒付" };
export const stateLabel = (s: string): string => STATE_LABEL[s] ?? "状态未知";

// E-13 补建终态可选值(为缺失终态的订单手动落定;真后台由订单状态机校验后写入)。
export const TERMINAL_STATES = ["payment_failed", "expired", "provisioning_failed", "chargeback"] as const;
// 非终态(仍流转,允许按状态机落定失败终态);placed 另允许「取消订单」。
export const NON_TERMINAL = new Set(["placed", "paid", "provisioning"]);

// E3 衰减曲线引擎 — 镜像产品 device-lifecycle.ts getEfficiency(三段复利 + floor)。
// 参数从后台配置(pE)读,使后台为 server-canonical 配置源、曲线真实反映产品衰减。
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

// ── SKU 表单 = 前端 Product 全字段镜像。input 一律 string,提交时 formToSku 转结构化 OpsSku ──
export const EMPTY_SKU_FORM = {
  name: "", id: "", tier: "", tagline: "", badge: "",
  gpuCount: "", specDocumentTitle: "", specDocumentUrl: "",
  gpu: "", vram: "", hashRate: "", power: "", datacenter: "", uptime: "", warranty: "", phoneDailyEarn: "", phoneDailyEarnNEX: "",
  price: "", computePoints: "",
  dailyEarn: "", dailyEarnNEX: "", shareYieldMin: "", shareYieldMax: "",
  inventoryMode: "FINITE", stock: "", trialEligible: "false",
  aiImageGenPerMin: "", aiLlmTokensPerSec: "", aiVideoMinPerHour: "", aiFineTuneMins: "", aiUnlocks: "",
  features: "",
  lifecycle: "", unlock: "", tag: "",
  // ⑦ 购买限制(扁平表单字段 → formToSku 组装为结构化 OpsSku.purchaseGate)。
  // gateType = 条件门形态:none(无门)/ activeDirect(单活跃直推)/ rank(单 V 级)/ combo(组合)。
  // 锁额(quota)与条件门正交,任意门类型下均可设。
  gateType: "none", gateRankMin: "", gateActiveDirectMin: "", gateTeamComputePointsMin: "", gateMode: "all",
  gateQuotaCap: "", gateQuotaSold: "", gateQuotaPeriod: "lifetime", gateEnforce: "true",
};
export type SkuForm = typeof EMPTY_SKU_FORM;

// purchaseGate → 表单门类型:条件门形态由「设了哪几个条件」反推。
// 单 activeDirect → activeDirect;单 rank → rank;其余(含团队算力点或多条件)→ combo;无条件 → none(可能仍有锁额)。
export function gateToType(g?: PurchaseGate): SkuForm["gateType"] {
  if (!g) return "none";
  const hasRank = g.rankMin != null, hasDirect = g.activeDirectMin != null, hasPoints = g.teamComputePointsMin != null;
  const n = (hasRank ? 1 : 0) + (hasDirect ? 1 : 0) + (hasPoints ? 1 : 0);
  if (n === 0) return "none";
  if (n === 1 && hasDirect) return "activeDirect";
  if (n === 1 && hasRank) return "rank";
  return "combo";
}

export const skuNum = (s: string): number => { const n = Number(String(s).replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : 0; };
export const skuNumU = (s: string): number | undefined => { const t = String(s).trim(); if (!t) return undefined; const n = Number(t.replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : undefined; };

// OpsSku → 表单(编辑回填:数字转 string,features 数组转换行文本,purchaseGate 扁平回填)。
// Keep the existing canonical GPU specification while exposing quantity separately.
export function splitGpu(value?: string) {
  const model = value?.trim() ?? "";
  const match = model.match(/^(\d+)\s*[×xX*]\s*(.+)$/u);
  return match ? { count: match[1], model: match[2] } : { count: "", model };
}
export function joinGpu(model: string, count: string): string | undefined {
  const value = model.trim();
  return value ? count.trim() ? `${Number(count)}× ${value}` : value : undefined;
}
export function validateSkuSpecs(f: SkuForm): string | null {
  if (f.gpuCount.trim() && (!/^[1-9]\d*$/.test(f.gpuCount.trim()) || Number(f.gpuCount) > 1024 || !f.gpu.trim())) return "GPU 数量须为 1–1024 的整数，并填写单卡型号";
  if (f.gpuCount.trim() && /^\d+\s*[×xX*]/u.test(f.gpu.trim())) return "GPU 型号请只填单卡型号，数量填写在 GPU 数量中";
  if (f.computePoints.trim() && !/^(?:0|[1-9]\d{0,17})$/.test(f.computePoints.trim())) return "每件算力点须为不小于 0 的整数";
  if (f.specDocumentTitle.trim() || f.specDocumentUrl.trim()) {
    if (!f.specDocumentTitle.trim() || f.specDocumentTitle.trim().length > 200 || f.specDocumentUrl.trim().length > 2048) return "请填写资料名称和有效的 HTTPS 链接";
    try { const url = new URL(f.specDocumentUrl.trim()); if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return "资料链接须为不含账号密码的 HTTPS 地址"; }
    catch { return "请填写有效的 HTTPS 资料链接"; }
  }
  return null;
}

export function skuToForm(s: OpsSku): SkuForm {
  const str = (v: number | string | undefined): string => (v === undefined || v === null ? "" : String(v));
  const g = s.purchaseGate;
  const gpuParts = splitGpu(s.gpu);
  return {
    name: s.name ?? "", id: s.id ?? "", tier: s.tier ?? "", tagline: s.tagline ?? "", badge: s.badge ?? "",
    gpuCount: gpuParts.count, specDocumentTitle: s.specDocumentTitle ?? "", specDocumentUrl: s.specDocumentUrl ?? "",
    gpu: gpuParts.model, vram: s.vram ?? "", hashRate: s.hashRate ?? "", power: s.power ?? "", datacenter: s.datacenter ?? "", uptime: s.uptime ?? "", warranty: s.warranty ?? "", phoneDailyEarn: str(s.phoneDailyEarn), phoneDailyEarnNEX: str(s.phoneDailyEarnNEX),
    price: str(s.price), computePoints: str(s.computePoints),
    dailyEarn: str(s.dailyEarn), dailyEarnNEX: str(s.dailyEarnNEX), shareYieldMin: str(s.shareYieldMin), shareYieldMax: str(s.shareYieldMax),
    inventoryMode: s.inventoryMode === "UNLIMITED" ? "UNLIMITED" : "FINITE", stock: s.inventoryMode === "UNLIMITED" ? "" : str(s.stock), trialEligible: s.trialEligible ? "true" : "false",
    aiImageGenPerMin: str(s.aiImageGenPerMin), aiLlmTokensPerSec: str(s.aiLlmTokensPerSec), aiVideoMinPerHour: str(s.aiVideoMinPerHour), aiFineTuneMins: str(s.aiFineTuneMins), aiUnlocks: s.aiUnlocks ?? "",
    features: (s.features ?? []).join("\n"),
    lifecycle: s.lifecycle ?? "", unlock: s.unlock ?? "", tag: s.tag ?? "",
    gateType: gateToType(g),
    gateRankMin: str(g?.rankMin), gateActiveDirectMin: str(g?.activeDirectMin), gateTeamComputePointsMin: str(g?.teamComputePointsMin),
    gateMode: g?.mode === "either" ? "either" : "all",
    gateQuotaCap: str(g?.quotaCap), gateQuotaSold: str(g?.quotaSold),
    gateQuotaPeriod: g?.quotaPeriod === "month" ? "month" : "lifetime",
    gateEnforce: g ? (g.enforce ? "true" : "false") : "true",
  };
}

// 表单 → purchaseGate(无条件且无锁额 → undefined = 无门)。条件门按 gateType 取相应阈值;锁额正交。
export function formToGate(f: SkuForm): PurchaseGate | undefined {
  let rankMin: number | undefined, activeDirectMin: number | undefined, teamComputePointsMin: number | undefined;
  if (f.gateType === "activeDirect") activeDirectMin = skuNumU(f.gateActiveDirectMin);
  else if (f.gateType === "rank") rankMin = skuNumU(f.gateRankMin);
  else if (f.gateType === "combo") {
    rankMin = skuNumU(f.gateRankMin); activeDirectMin = skuNumU(f.gateActiveDirectMin); teamComputePointsMin = skuNumU(f.gateTeamComputePointsMin);
  }
  const cap = skuNumU(f.gateQuotaCap);
  const hasCond = rankMin != null || activeDirectMin != null || teamComputePointsMin != null;
  const hasQuota = cap != null;
  if (!hasCond && !hasQuota) return undefined;
  return {
    rankMin, activeDirectMin, teamComputePointsMin,
    mode: f.gateMode === "either" ? "either" : "all",
    quotaCap: cap,
    quotaSold: hasQuota ? Math.max(0, skuNumU(f.gateQuotaSold) ?? 0) : undefined, // 防御:已售下限 0(校验已拦负数,store 层再兜底)
    quotaPeriod: hasQuota ? "lifetime" : undefined,
    enforce: f.gateEnforce !== "false",
  };
}

// 锁额余量单源(remaining = cap − sold,下限 0)。抽屉派生提示 + E1 卡 chip 共用此函数,
// 杜绝公式在多处重复(对齐前端 evaluatePurchaseGate 的 remaining 口径)。无 cap = null(不限量)。
export function gateRemaining(g: PurchaseGate): number | null {
  return g.quotaCap != null ? Math.max(0, g.quotaCap - (g.quotaSold ?? 0)) : null;
}

export const effectiveReleaseMonth = (releaseMonth: number, phaseOffset = 0): number => releaseMonth + phaseOffset;

/**
 * 上架门判定结果。`declaredPhase` 来自商品的服务端解锁阶段;
 * `phaseConflict` = 上架门引用的阶段与商品不一致。
 */
export interface E1GateReadiness {
  effectiveMonth: number;
  eligibilityReady: boolean;
  forceMonthOpen: boolean;
  gatePhaseIdx: number;
  monthReached: boolean;
  phaseReached: boolean;
  declaredPhase: string;
  phaseConflict: boolean;
  unlocked: boolean;
  blockers: string[];
}

export interface E1GateReadinessInput {
  release: { id: string; phase: string; releaseMonth: number; phaseOffset?: number; eligibility?: boolean; forceUnlock?: boolean };
  phaseOrder: string[];
  /** 阶段配置行:skus 是运营展示标签,不参与发布判定。 */
  phases: Array<{ p: string; label?: string; skus: string }>;
  /** 该门上挂的 SKU;unlock 是商品服务端解锁阶段。 */
  sku?: { id: string; unlock: string } | null;
  currentPhase: string;
  platformMonth: number;
}

const phaseLabelOf = (phases: Array<{ p: string; label?: string; skus: string }>, phaseId: string): string =>
  !phaseId ? "未配置" : (phases.find((item) => item.p === phaseId)?.label || phaseId);

export const resolveE1PhaseId = (phases: Array<{ p: string; label?: string }>, value: string): string =>
  phases.find((phase) => phase.p === value)?.p ?? phases.find((phase) => phase.label === value)?.p ?? value;

/**
 * 商品解锁阶段来自 nx_product.unlock_phase,与服务端发布判定同源。
 */
export function declaredPhaseForSku(
  sku: { unlock: string } | null | undefined,
): string {
  return sku?.unlock?.trim() ?? "";
}

/**
 * 上架门「是否解锁」单一判定源:阶段已到达 + 设备资格已补齐 + 平台月龄已到。
 * forceUnlock 仅绕过月龄门,不能绕过阶段或设备资格,也不能掩盖阶段映射冲突。
 */
export function e1GateReadiness(input: E1GateReadinessInput): E1GateReadiness {
  const { release, phaseOrder, phases, sku, currentPhase, platformMonth } = input;
  const phaseId = (value: string): string => resolveE1PhaseId(phases, value);
  const gatePhase = phaseId(release.phase);
  const gatePhaseIdx = phaseOrder.indexOf(gatePhase);
  const curIdx = phaseOrder.indexOf(phaseId(currentPhase));
  const hasPhaseConfig = phaseOrder.length > 0 && phases.length > 0 && curIdx >= 0;
  const declaredPhase = phaseId(declaredPhaseForSku(sku));
  const phaseConflict = !!declaredPhase && !!gatePhase && declaredPhase !== gatePhase;
  const eligibilityReady = !!release.eligibility;
  const phaseReached = hasPhaseConfig && gatePhaseIdx >= 0 && curIdx >= gatePhaseIdx;
  const effectiveMonth = effectiveReleaseMonth(release.releaseMonth, release.phaseOffset ?? 0);
  const monthReached = platformMonth >= effectiveMonth;
  const forceMonthOpen = !!release.forceUnlock;
  const blockers: string[] = [];

  if (!sku) blockers.push("商品不存在");
  else if (!declaredPhase) blockers.push("商品没有设置开放阶段");
  else if (phaseConflict) blockers.push(`阶段不一致 · 商品的开放阶段是${phaseLabelOf(phases, declaredPhase)}`);
  if (!eligibilityReady) blockers.push("待补设备资格");
  if (!phaseReached) blockers.push(gatePhaseIdx >= 0 ? `待${phaseLabelOf(phases, release.phase)}` : "阶段未匹配");
  if (!monthReached && !forceMonthOpen) blockers.push(`待第 ${effectiveMonth} 个月`);

  return {
    effectiveMonth, eligibilityReady, forceMonthOpen, gatePhaseIdx, monthReached, phaseReached,
    declaredPhase, phaseConflict,
    unlocked: !!declaredPhase && !phaseConflict && eligibilityReady && phaseReached && (monthReached || forceMonthOpen),
    blockers,
  };
}

export function releaseMonthPresentation(releaseMonth: number, phaseOffset = 0): {
  effectiveLabel: string;
  adjustmentLabel: string;
} {
  const effectiveMonth = effectiveReleaseMonth(releaseMonth, phaseOffset);
  const adjustmentLabel = phaseOffset === 0
    ? "按原计划"
    : `原定第 ${releaseMonth} 个月 · ${phaseOffset > 0 ? "推迟" : "提前"} ${Math.abs(phaseOffset)} 个月`;
  return { effectiveLabel: `第 ${effectiveMonth} 个月`, adjustmentLabel };
}

// 购买门表单校验(提交前调;返回错误串 = 拦截,null = 通过)。
// 注:这是输入完整性/取值范围校验,非「锁死业务值」——阈值/开关本身全运营可调(铁律)。
export function validateGateForm(f: SkuForm): string | null {
  if (f.tier !== "Share" && !f.unlock.trim()) return "请先选择开放阶段";
  if (f.gateType === "activeDirect" && skuNumU(f.gateActiveDirectMin) == null) return "购买条件：请填写活跃直接邀请人数";
  if (f.gateType === "rank" && skuNumU(f.gateRankMin) == null) return "购买条件：请填写最低会员等级";
  if (f.gateType === "combo" && skuNumU(f.gateRankMin) == null && skuNumU(f.gateActiveDirectMin) == null && skuNumU(f.gateTeamComputePointsMin) == null)
    return "购买条件：组合条件至少填一项";
  const rank = skuNumU(f.gateRankMin);
  if (rank != null && (rank < 0 || rank > 8)) return "购买条件：会员等级须在 0–8 之间";
  const direct = skuNumU(f.gateActiveDirectMin);
  if (direct != null && (direct < 0 || direct > 1_000_000)) return "购买条件：活跃直接邀请人数须在 0–1000000 之间";
  const vol = skuNumU(f.gateTeamComputePointsMin);
  if (vol != null && (vol < 0 || !Number.isInteger(vol))) return "购买条件：团队算力点须为不小于 0 的整数";
  const cap = skuNumU(f.gateQuotaCap), sold = skuNumU(f.gateQuotaSold);
  if (cap == null && sold != null) return "购买条件：已售数量和可售上限要一起填写";
  if (cap != null && cap <= 0) return "购买条件：可售上限须大于 0（留空为不限量）";
  if (sold != null && sold < 0) return "购买条件：已售数量不能为负数";
  if (cap != null && sold != null && sold > cap) return "购买条件：已售数量不能超过可售上限";
  if (f.gateQuotaPeriod !== "lifetime") return "购买条件：按月统计已停用，请改为「不分周期」后保存";
  return null;
}

// 表单 → OpsSku(提交:string 转结构化双币 + 合成 baseRate 兼容串;上下架 status 沿用既有/新建 pending)。
export function formToSku(f: SkuForm, existing?: OpsSku): OpsSku {
  const dailyEarn = skuNum(f.dailyEarn);
  const dailyEarnNEX = skuNum(f.dailyEarnNEX);
  const isShare = f.tier === "Share";
  const shareYieldMin = skuNumU(f.shareYieldMin);
  const shareYieldMax = skuNumU(f.shareYieldMax);
  const derivedBaseRate = isShare
    ? `${shareYieldMin != null && shareYieldMax != null && shareYieldMin > 0 && shareYieldMax >= shareYieldMin ? `参考年化 ${shareYieldMin}–${shareYieldMax}%` : "年化区间暂不可用"} · ${dailyEarnNEX.toLocaleString()} NEX/天`
    : `$${dailyEarn.toFixed(2)}/d · ${dailyEarnNEX.toLocaleString()} NEX`;
  const earningsUnchanged = existing
    && existing.tier === f.tier
    && Number(existing.dailyEarn) === dailyEarn
    && Number(existing.dailyEarnNEX) === dailyEarnNEX
    && (existing.shareYieldMin == null ? shareYieldMin == null : Number(existing.shareYieldMin) === shareYieldMin)
    && (existing.shareYieldMax == null ? shareYieldMax == null : Number(existing.shareYieldMax) === shareYieldMax);
  // Share 的旧美元日产展示串即使在编辑其他字段时也不能继续透传。
  const baseRate = isShare ? derivedBaseRate : earningsUnchanged ? existing.baseRate : derivedBaseRate;
  const features = f.features.split("\n").map((x) => x.trim()).filter(Boolean);
  const inventoryMode = f.inventoryMode === "UNLIMITED" ? "UNLIMITED" : "FINITE";
  const productType = existing?.productType ?? (isShare ? "SHARE" : "DEVICE");
  const stockTrim = f.stock.trim();
  return {
    name: f.name.trim(), id: f.id.trim() || existing?.id || f.name.trim(),
    tier: f.tier, tagline: f.tagline.trim() || undefined, badge: f.badge.trim() || undefined,
    specDocumentTitle: f.specDocumentTitle.trim() || undefined, specDocumentUrl: f.specDocumentUrl.trim() || undefined,
    gpu: joinGpu(f.gpu, f.gpuCount), vram: f.vram.trim() || undefined, hashRate: f.hashRate.trim() || undefined, power: f.power.trim() || undefined, datacenter: f.datacenter.trim() || undefined, uptime: f.uptime.trim() || undefined, warranty: f.warranty.trim() || undefined, phoneDailyEarn: skuNumU(f.phoneDailyEarn), phoneDailyEarnNEX: skuNumU(f.phoneDailyEarnNEX),
    price: skuNum(f.price), computePoints: skuNumU(f.computePoints),
    dailyEarn, dailyEarnNEX, shareYieldMin, shareYieldMax, baseRate,
    // Sales remains display-only; write payloads omit it and Java retains the live counter.
    sold: existing?.sold ?? 0, productType, inventoryMode,
    rating: existing?.rating, reviews: existing?.reviews, generation: existing?.generation,
    supersededBy: existing?.supersededBy, tradeinDiscount: existing?.tradeinDiscount,
    stock: inventoryMode === "UNLIMITED" ? undefined : (skuNumU(stockTrim) ?? stockTrim),
    trialEligible: f.trialEligible === "true",
    aiImageGenPerMin: skuNumU(f.aiImageGenPerMin), aiLlmTokensPerSec: skuNumU(f.aiLlmTokensPerSec), aiVideoMinPerHour: skuNumU(f.aiVideoMinPerHour), aiFineTuneMins: skuNumU(f.aiFineTuneMins), aiUnlocks: f.aiUnlocks.trim() || undefined,
    features: features.length ? features : undefined,
    lifecycle: f.lifecycle,
    unlock: f.unlock, purchaseGate: formToGate(f), tag: f.tag.trim() || existing?.tag || "", status: existing?.status ?? "pending",
    updatedAt: existing?.updatedAt,
  };
}
