/**
 * E 域核心数据 & 派生口径(从 e-view.tsx 移出,口径不改)。
 * server-canonical:展示值优先 pget(key) ?? mock;订单状态走 orderState 派生(取消 > 退款 > 补建终态 > 原始)。
 * 视图局部的纯设计数组(timeline / 热力图 / DC / feed / tx 监控 等)放各子视图文件内,保持本文件聚焦逻辑。
 */
import type { OpsSku, OpsTask } from "@/lib/store/admin/platform-config-store";
import type { EOrder } from "./types";

// 全系统统一连续编号 E1-E5(代际门原 E2 并入 E1、设备生命周期原 E4 并入 E5→现 E3)。
// nav id == 视图 key == 组件名 == prdAnchor == PRD §10 章节,FOLD 恒等映射。
export const FOLD: Record<string, string> = { E1: "E1", E2: "E2", E3: "E3", E4: "E4", E5: "E5" };

// E3 任务池种子(/earn 任务池映射;真后台由任务引擎下发,本处为 seed)。
export const TASKS: Omit<OpsTask, "id">[] = [
  { n: "LLM 推理 405B", price: 1.2, unit: "/job", req: "需 NexionBox Pro", sat: 0.82 },
  { n: "LLM 推理 70B", price: 0.46, unit: "/job", req: "S1+", sat: 0.61 },
  { n: "图像生成 SDXL", price: 0.34, unit: "/job", req: "S1+", sat: 0.55 },
  { n: "视频渲染", price: 2.8, unit: "/job", req: "需 NexionRack", sat: 0.74 },
  { n: "微调 / LoRA", price: 5.1, unit: "/job", req: "需 NexionRack", sat: 0.48 },
  { n: "Embedding 批处理", price: 0.12, unit: "/1k", req: "S1+", sat: 0.39 },
];

export const ORDERS: EOrder[] = [
  { id: "OD-55012", user: "usr_19C7", sku: "NexionBox Pro v2", amt: 2639, state: "active", dc: "us-east-2", age: "2m" },
  { id: "OD-55011", user: "usr_84F2", sku: "NexionBox S1", amt: 1299, state: "allocating", dc: "—", age: "7m" },
  { id: "OD-55009", user: "usr_31E8", sku: "NexionRack P2", amt: 14999, state: "paid", dc: "—", age: "15m" },
  { id: "OD-55006", user: "usr_02A9", sku: "Genesis 节点", amt: 9999, state: "active", dc: "eu-west-1", age: "31m" },
  { id: "OD-55001", user: "usr_55B1", sku: "NexionBox Pro v2", amt: 2639, state: "failed", dc: "—", age: "1h" },
  { id: "OD-54998", user: "usr_77D4", sku: "NexionBox S1", amt: 1299, state: "refunded", dc: "—", age: "2h" },
];

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

// E-11 生命周期/置换调参默认值(pget 无记录时回退;真后台由配置端点下发)。
// 衰减默认值镜像产品源码 device-lifecycle.ts:三段非线性 −4/−6/−23.7%·12 月·floor 22%。
export const E_PARAM_DEFAULTS: Record<string, string> = {
  "E.device.minEfficiency": "22",       // 源码 MIN_EFFICIENCY = 0.22
  "E.device.degradeEarly": "-4",        // 月 1-3 %/月
  "E.device.degradeMid": "-6",          // 月 4-8 %/月
  "E.device.degradeLate": "-23.7",      // 月 9-12 %/月(断崖)
  "E.device.stageEarlyEnd": "3",        // 早期段末月
  "E.device.stageMidEnd": "8",          // 中期段末月
  "E.device.cycleMonths": "12",         // 生命周期月数
  "E.device.taskLockThresholds": "$40 / $140 / $450", // E4 任务锁定月度损失阈值(S1/Pro/Rack)
  "E.tradein.salvagePct": "30",
  "E.tradein.minHoldingMonths": "6",
  "E.tradein.promoMult": "1.0",
  "E.tradein.promo.rhythm": "cooldown 14d · max/sess 1 · delay 6s · minAge 30d · /me/devices",
  "E.tradein.inventorySoftMax": "0",
};

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
  name: "", id: "", tier: "Entry", tagline: "", badge: "",
  gpu: "", vram: "", hashRate: "", power: "", datacenter: "Singapore DC",
  price: "",
  dailyEarn: "", dailyEarnNEX: "", shareYieldMin: "", shareYieldMax: "",
  sold: "", stock: "", rating: "", reviews: "",
  aiImageGenPerMin: "", aiLlmTokensPerSec: "", aiVideoMinPerHour: "", aiFineTuneMins: "", aiUnlocks: "",
  features: "",
  generation: "1", lifecycle: "active", supersededBy: "", tradeinDiscount: "", unlock: "P1", tag: "",
};
export type SkuForm = typeof EMPTY_SKU_FORM;

export const skuNum = (s: string): number => { const n = Number(String(s).replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : 0; };
export const skuNumU = (s: string): number | undefined => { const t = String(s).trim(); if (!t) return undefined; const n = Number(t.replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : undefined; };

// OpsSku → 表单(编辑回填:数字转 string,features 数组转换行文本)。
export function skuToForm(s: OpsSku): SkuForm {
  const str = (v: number | string | undefined): string => (v === undefined || v === null ? "" : String(v));
  return {
    name: s.name ?? "", id: s.id ?? "", tier: s.tier ?? "Entry", tagline: s.tagline ?? "", badge: s.badge ?? "",
    gpu: s.gpu ?? "", vram: s.vram ?? "", hashRate: s.hashRate ?? "", power: s.power ?? "", datacenter: s.datacenter ?? "",
    price: str(s.price),
    dailyEarn: str(s.dailyEarn), dailyEarnNEX: str(s.dailyEarnNEX), shareYieldMin: str(s.shareYieldMin), shareYieldMax: str(s.shareYieldMax),
    sold: str(s.sold), stock: str(s.stock), rating: str(s.rating), reviews: str(s.reviews),
    aiImageGenPerMin: str(s.aiImageGenPerMin), aiLlmTokensPerSec: str(s.aiLlmTokensPerSec), aiVideoMinPerHour: str(s.aiVideoMinPerHour), aiFineTuneMins: str(s.aiFineTuneMins), aiUnlocks: s.aiUnlocks ?? "",
    features: (s.features ?? []).join("\n"),
    generation: str(s.generation) || "1", lifecycle: s.lifecycle ?? "active", supersededBy: s.supersededBy ?? "", tradeinDiscount: str(s.tradeinDiscount), unlock: s.unlock ?? "P1", tag: s.tag ?? "",
  };
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
    generation: skuNumU(f.generation), lifecycle: f.lifecycle, supersededBy: f.supersededBy.trim() || undefined, tradeinDiscount: skuNumU(f.tradeinDiscount),
    unlock: f.unlock, tag: f.tag.trim() || existing?.tag || "", status: existing?.status ?? "pending",
  };
}
