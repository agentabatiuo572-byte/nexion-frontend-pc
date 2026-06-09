"use client";

/**
 * E 设备与商城 — 设计稿 Store 内容视图(从 page-revenue.jsx 移植)。
 * 标签:E1 商品目录&代际门 / E3 收益&任务引擎 / E6 订单状态机 / E5 生命周期&Trade-in / E7 设备运维。
 * 路由 l2.id 折叠:E2→E1(代际门在 E1 内)、E4→E5(生命周期在 E5 内)。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon, Card, CardH, CodeTag, Chip, Badge, Btn, Meter, Sparkline, Drawer, KV, MakerCheckerModal, useToast } from "./design-kit";
import { AutoGloss, Gloss } from "@/app/components/kit/gloss";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { SKUS, REVIEWS, REVENUE, fmtUsd, fmtM } from "@/lib/mock/admin/design-data";
import { confirm } from "@/lib/store/ui";
import { usePlatformConfig, type OpsSku, type OpsReview } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";

let TASK_SEQ = 100; // 客户端新增任务 id 计数(避免 Date.now/Math.random,SSR 安全)
let REVIEW_SEQ = 100; // 客户端新增评价 id 计数(SSR 安全)

const TASKS = [
  { n: "LLM 推理 405B", price: 1.2, unit: "/job", req: "需 NexionBox Pro", sat: 0.82 },
  { n: "LLM 推理 70B", price: 0.46, unit: "/job", req: "S1+", sat: 0.61 },
  { n: "图像生成 SDXL", price: 0.34, unit: "/job", req: "S1+", sat: 0.55 },
  { n: "视频渲染", price: 2.8, unit: "/job", req: "需 NexionRack", sat: 0.74 },
  { n: "微调 / LoRA", price: 5.1, unit: "/job", req: "需 NexionRack", sat: 0.48 },
  { n: "Embedding 批处理", price: 0.12, unit: "/1k", req: "S1+", sat: 0.39 },
];
const ORDERS = [
  { id: "OD-55012", user: "usr_19C7", sku: "NexionBox Pro v2", amt: 2639, state: "active", dc: "us-east-2", age: "2m" },
  { id: "OD-55011", user: "usr_84F2", sku: "NexionBox S1", amt: 1299, state: "allocating", dc: "—", age: "7m" },
  { id: "OD-55009", user: "usr_31E8", sku: "NexionRack P2", amt: 14999, state: "paid", dc: "—", age: "15m" },
  { id: "OD-55006", user: "usr_02A9", sku: "Genesis 节点", amt: 9999, state: "active", dc: "eu-west-1", age: "31m" },
  { id: "OD-55001", user: "usr_55B1", sku: "NexionBox Pro v2", amt: 2639, state: "failed", dc: "—", age: "1h" },
  { id: "OD-54998", user: "usr_77D4", sku: "NexionBox S1", amt: 1299, state: "refunded", dc: "—", age: "2h" },
];
const ORDER_FLOW = ["created", "paid", "allocating", "active"];
const ostate: Record<string, string> = { created: "neutral", paid: "info", allocating: "cyan", active: "ok", failed: "err", refunded: "warn", cancelled: "neutral", payment_failed: "err", expired: "warn", provisioning_failed: "err" };
// 终态中文标签(订单队列 / drawer 统一显示)。
const STATE_LABEL: Record<string, string> = { cancelled: "已取消", payment_failed: "支付失败", expired: "已过期", refunded: "已退款", provisioning_failed: "开通失败" };
const stateLabel = (s: string): string => STATE_LABEL[s] ?? s;

const FOLD: Record<string, string> = { E1: "E1", E2: "E1", E3: "E3", E4: "E5", E5: "E5", E6: "E6", E7: "E7" };

type SkuImg = { src: string; w: number; h: number } | null;
type Mc = {
  name: string;
  price?: number | string;
  refund?: boolean;
  isNew?: boolean;
  hasImg?: boolean;
  op?: "sku-save" | "sku-status" | "param" | "order-refund" | "ops-pause" | "order-cancel" | "order-terminal";
  status?: string;
  paramKey?: string;
  paramVal?: string;
  unit?: string;        // 目标新值输入框单位(% / × / 月)
  current?: string;     // 当前值(展示 before→after)
  detail?: string;      // 复核弹窗副文案(覆盖默认)
  orderId?: string;     // E-12 退款 / E-13 取消·补建终态 目标订单
  dc?: string;          // E-14 运维处置目标数据中心
  termOpts?: string[];  // E-13 补建终态可选值
} | null;

// E-13 订单补建终态可选值(为缺失终态的订单手动落定;真后台由订单状态机校验后写入)。
const TERMINAL_STATES = ["payment_failed", "expired", "refunded", "provisioning_failed"] as const;
// 状态机非终态(仍在流转,允许补建终态);created/paid 另允许「取消订单」。
const NON_TERMINAL = new Set(["created", "paid", "allocating"]);

// E-11 生命周期/置换调参默认值(pget 无记录时回退;真后台由配置端点下发)。
// 衰减默认值镜像产品源码 device-lifecycle.ts:三段非线性 −4/−6/−23.7%·12 月·floor 22%。
const E_PARAM_DEFAULTS: Record<string, string> = {
  "E.device.minEfficiency": "22",       // 源码 MIN_EFFICIENCY = 0.22
  "E.device.degradeEarly": "-4",        // 月 1-3 %/月
  "E.device.degradeMid": "-6",          // 月 4-8 %/月
  "E.device.degradeLate": "-23.7",      // 月 9-12 %/月(断崖)
  "E.device.stageEarlyEnd": "3",        // 早期段末月
  "E.device.stageMidEnd": "8",          // 中期段末月
  "E.device.cycleMonths": "12",         // 生命周期月数
  "E.tradein.salvagePct": "30",
  "E.tradein.minHoldingMonths": "6",
  "E.tradein.promoMult": "1.0",
};

// E5 衰减曲线引擎 — 镜像产品 device-lifecycle.ts getEfficiency(三段复利 + floor)。
// 参数从后台配置(pE)读,使后台为 server-canonical 配置源、曲线真实反映产品衰减。
function effCurve(early: number, mid: number, late: number, stage1: number, stage2: number, months: number, floorPct: number): number[] {
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
const EMPTY_SKU_FORM = {
  name: "", id: "", tier: "Entry", tagline: "", badge: "",
  gpu: "", vram: "", hashRate: "", power: "", datacenter: "Singapore DC",
  price: "",
  dailyEarn: "", dailyEarnNEX: "", shareYieldMin: "", shareYieldMax: "",
  sold: "", stock: "", rating: "", reviews: "",
  aiImageGenPerMin: "", aiLlmTokensPerSec: "", aiVideoMinPerHour: "", aiFineTuneMins: "", aiUnlocks: "",
  features: "",
  generation: "1", lifecycle: "active", supersededBy: "", tradeinDiscount: "", unlock: "P1", tag: "",
};
type SkuForm = typeof EMPTY_SKU_FORM;

const skuNum = (s: string): number => { const n = Number(String(s).replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : 0; };
const skuNumU = (s: string): number | undefined => { const t = String(s).trim(); if (!t) return undefined; const n = Number(t.replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : undefined; };

// OpsSku → 表单(编辑回填:数字转 string,features 数组转换行文本)。
function skuToForm(s: OpsSku): SkuForm {
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
function formToSku(f: SkuForm, existing?: OpsSku): OpsSku {
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

// 表单分组标题(后台无 i18n,直接中文标签)。
function SkuFieldGroup({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8, alignItems: "center", marginTop: 2 }}>
        <span style={{ width: 18, height: 18, borderRadius: 5, background: "var(--surface-3)", color: "var(--ink-3)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600 }}>{n}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)", letterSpacing: "0.01em" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}
function SkuFld({ label, value, onChange, placeholder, type = "text", hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; hint?: string }) {
  return (
    <label className="col" style={{ gap: 5 }}>
      <span className="muted tiny">{label}{hint ? <span style={{ color: "var(--ink-4)" }}> · {hint}</span> : null}</span>
      <input className="fld" type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

export function EDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const [tab] = useState(FOLD[meta.l2Id] ?? "E1");
  const [mc, setMc] = useState<Mc>(null);
  const [selOrder, setSelOrder] = useState<(typeof ORDERS)[number] | null>(null);
  const [addSku, setAddSku] = useState(false);
  const [form, setForm] = useState<SkuForm>(EMPTY_SKU_FORM);
  const [skuImg, setSkuImg] = useState<SkuImg>(null);
  const [dragOver, setDragOver] = useState(false);
  // E3 任务引擎:真增删改查(平台级配置,持久化 store + persist,刷新不丢)。
  const hydrated = useOpsHydrated();
  const seedTasks = useMemo(() => TASKS.map((t, i) => ({ ...t, id: "TK-" + (i + 1) })), []);
  const ensureTasks = usePlatformConfig((s) => s.ensureTasks);
  const storeTasks = usePlatformConfig((s) => s.tasks);
  const addTaskStore = usePlatformConfig((s) => s.addTask);
  const updateTaskStore = usePlatformConfig((s) => s.updateTask);
  const removeTaskStore = usePlatformConfig((s) => s.removeTask);
  useEffect(() => { if (hydrated) ensureTasks(seedTasks); }, [hydrated, seedTasks, ensureTasks]);
  const tasks = hydrated && storeTasks ? storeTasks : seedTasks;
  // E1 商品 SKU:真增删改 + 上下架(平台级 persist);E2/E5/baseRate 调参用 setParam(含审计)。
  const setParam = usePlatformConfig((s) => s.setParam);
  const logAudit = usePlatformConfig((s) => s.logAudit);
  const params = usePlatformConfig((s) => s.params);
  const pget = (k: string): string | undefined => (hydrated ? (params?.[k] as string | undefined) : undefined);
  // 参数有效值:store 已写则取 store,否则回退默认(SSR/未水合一致用默认,避免 hydration 抖动)。
  const pE = (k: string): string => pget(k) ?? E_PARAM_DEFAULTS[k] ?? "—";
  const isRefunded = (id: string): boolean => pget(`E.order.${id}.refunded`) === "true";
  const isCancelled = (id: string): boolean => pget(`E.order.${id}.cancelled`) === "true"; // E-13 取消态
  const terminalOf = (id: string): string | undefined => pget(`E.order.${id}.terminalState`); // E-13 补建终态
  const isDcPaused = (dc: string): boolean => pget(`E.ops.${dc}.paused`) === "true";
  // E-13 订单有效状态:取消 > 退款 > 补建终态 > 原始状态(优先级从高到低)。
  const orderState = (o: { id: string; state: string }): string =>
    isCancelled(o.id) ? "cancelled" : isRefunded(o.id) ? "refunded" : terminalOf(o.id) ?? o.state;
  const seedSkus = useMemo<OpsSku[]>(() => SKUS as OpsSku[], []);
  const ensureSkus = usePlatformConfig((s) => s.ensureSkus);
  const storeSkus = usePlatformConfig((s) => s.skus);
  const addSkuStore = usePlatformConfig((s) => s.addSku);
  const updateSku = usePlatformConfig((s) => s.updateSku);
  const setSkuStatus = usePlatformConfig((s) => s.setSkuStatus);
  const removeSkuStore = usePlatformConfig((s) => s.removeSku);
  useEffect(() => { if (hydrated) ensureSkus(seedSkus); }, [hydrated, seedSkus, ensureSkus]);
  const skus = hydrated && storeSkus ? storeSkus : seedSkus;
  const [editName, setEditName] = useState<string | null>(null);
  const delSku = async (name: string) => {
    const ok = await confirm({ title: "下架并删除 SKU?", message: `删除「${name}」:从商品目录移除(不影响已售设备)。需第二角色复核 + 审计留痕。`, confirmLabel: "确认删除", danger: true });
    if (ok) { removeSkuStore(name); logAudit({ actor: "总管理员", action: "删除 SKU " + name, target: name }); setToast("SKU 已删除:" + name); }
  };
  // E1 用户评价:真增删改查(平台级 persist)+ 隐藏切换(对前端商品详情页生效)。
  const seedReviews = useMemo<OpsReview[]>(() => REVIEWS as OpsReview[], []);
  const ensureReviews = usePlatformConfig((s) => s.ensureReviews);
  const storeReviews = usePlatformConfig((s) => s.reviews);
  const addReviewStore = usePlatformConfig((s) => s.addReview);
  const updateReviewStore = usePlatformConfig((s) => s.updateReview);
  const removeReviewStore = usePlatformConfig((s) => s.removeReview);
  useEffect(() => { if (hydrated) ensureReviews(seedReviews); }, [hydrated, seedReviews, ensureReviews]);
  const reviews = hydrated && storeReviews ? storeReviews : seedReviews;
  const [reviewDrawer, setReviewDrawer] = useState(false);
  const [editReviewId, setEditReviewId] = useState<string | null>(null);
  const [reviewForm, setReviewForm] = useState({ productId: "", author: "", rating: "5", content: "", date: "刚刚", status: "published" });
  const openAddReview = () => { const firstSku = skus.find((s) => (s.status || "on") !== "off"); setReviewForm({ productId: firstSku?.id || firstSku?.name || "", author: "", rating: "5", content: "", date: "刚刚", status: "published" }); setEditReviewId(null); setReviewDrawer(true); };
  const openEditReview = (r: OpsReview) => { setReviewForm({ productId: r.productId, author: r.author, rating: String(r.rating), content: r.content, date: r.date, status: r.status }); setEditReviewId(r.id); setReviewDrawer(true); };
  const submitReview = () => {
    if (!reviewForm.author.trim() || !reviewForm.content.trim()) { setToast("请填写评价人 + 内容"); return; }
    const r: OpsReview = { id: editReviewId ?? ("rv-" + ++REVIEW_SEQ), productId: reviewForm.productId.trim(), author: reviewForm.author.trim(), rating: Number(reviewForm.rating) || 5, content: reviewForm.content.trim(), date: reviewForm.date.trim() || "刚刚", status: reviewForm.status };
    if (editReviewId) { updateReviewStore(editReviewId, r); logAudit({ actor: "总管理员", action: "编辑评价 " + r.author, target: r.id }); setToast("评价已更新:" + r.author); }
    else { addReviewStore(r); logAudit({ actor: "总管理员", action: "新增评价 " + r.author, target: r.id }); setToast("评价已新增:" + r.author); }
    setReviewDrawer(false); setEditReviewId(null);
  };
  const delReview = async (r: OpsReview) => {
    const ok = await confirm({ title: "删除评价?", message: `删除「${r.author}」的评价?需审计留痕。`, confirmLabel: "确认删除", danger: true });
    if (ok) { removeReviewStore(r.id); logAudit({ actor: "总管理员", action: "删除评价 " + r.author, target: r.id }); setToast("评价已删除:" + r.author); }
  };
  const toggleReview = (r: OpsReview) => { const ns = r.status === "published" ? "hidden" : "published"; updateReviewStore(r.id, { status: ns }); logAudit({ actor: "总管理员", action: (ns === "hidden" ? "隐藏" : "恢复") + "评价 " + r.author, target: r.id, after: ns }); setToast("评价已" + (ns === "hidden" ? "隐藏" : "恢复")); };
  const [taskDrawer, setTaskDrawer] = useState(false);
  const [taskForm, setTaskForm] = useState<{ id?: string; n: string; price: string; req: string; unit: string }>({ n: "", price: "", req: "S1+", unit: "/job" });
  const openAddTask = () => { setTaskForm({ n: "", price: "", req: "S1+", unit: "/job" }); setTaskDrawer(true); };
  const openEditTask = (t: { id: string; n: string; price: number; req: string; unit: string }) => { setTaskForm({ id: t.id, n: t.n, price: String(t.price), req: t.req, unit: t.unit }); setTaskDrawer(true); };
  const submitTask = () => {
    const price = Number(taskForm.price) || 0;
    if (!taskForm.n.trim() || !price) { setToast("请填写任务名称 + 单价"); return; }
    if (taskForm.id) {
      updateTaskStore(taskForm.id, { n: taskForm.n.trim(), price, req: taskForm.req, unit: taskForm.unit });
      setToast("任务已更新:" + taskForm.n + " · server-canonical,改后对新派单生效");
    } else {
      addTaskStore({ id: "TK-" + ++TASK_SEQ, n: taskForm.n.trim(), price, unit: taskForm.unit, req: taskForm.req, sat: 0 });
      setToast("已新增任务:" + taskForm.n + " · 待上线(server 校验后对 /earn 任务池可见)");
    }
    setTaskDrawer(false);
  };
  const delTask = async (t: { id: string; n: string }) => {
    const ok = await confirm({ title: "下架任务?", message: `下架「${t.n}」:停止派单并从 /earn 任务池移除。需第二角色复核 + 审计留痕。`, confirmLabel: "确认下架", danger: true });
    if (ok) { removeTaskStore(t.id); setToast("任务已下架:" + t.n); }
  };

  const onPickImg = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setToast("请上传图片文件(PNG / JPG)"); return; }
    if (file.size > 2 * 1024 * 1024) { setToast("图片超过 2MB,请压缩后再传"); return; }
    const r = new FileReader();
    r.onload = () => { const im = new Image(); im.onload = () => setSkuImg({ src: r.result as string, w: im.width, h: im.height }); im.src = r.result as string; };
    r.readAsDataURL(file);
  };
  const cropSquare = () => {
    if (!skuImg) return;
    const im = new Image();
    im.onload = () => {
      const s = Math.min(im.width, im.height);
      const c = document.createElement("canvas");
      c.width = c.height = s;
      const x = (im.width - s) / 2, y = (im.height - s) / 2;
      c.getContext("2d")!.drawImage(im, x, y, s, s, 0, 0, s, s);
      setSkuImg({ src: c.toDataURL("image/png"), w: s, h: s });
      setToast("已居中裁剪为 1:1");
    };
    im.src = skuImg.src;
  };
  const isSquare = skuImg && Math.abs(skuImg.w - skuImg.h) <= Math.max(skuImg.w, skuImg.h) * 0.02;

  return (
    <div className="dkpage">
      <DomainHeader {...meta} right={
        tab === "E1" ? <Btn variant="primary" onClick={() => { setForm(EMPTY_SKU_FORM); setSkuImg(null); setEditName(null); setAddSku(true); }}><Icon name="plus" size={15} /> 新增 SKU</Btn>
          : tab === "E3" ? <Btn variant="primary" onClick={openAddTask}><Icon name="plus" size={15} /> 新增任务</Btn>
            : undefined
      } />

      <div className="grid g-4" style={{ marginBottom: 16 }}>
        {[["硬件 GMV(月)", fmtM(REVENUE.gmv), ""], ["在售 SKU", "4", ""], ["在线设备", "41,208", "heartbeat 活跃"], ["订单失败 / 退款", "2", "近 24h", "var(--warning)"]].map(([k, v, sub, col]) => (
          <Card key={k} style={{ padding: "15px 16px" }}>
            <div className="muted tiny">{k}</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: col || "var(--ink)" }} className="tnum">{v}</div>
            {sub && <div className="muted tiny"><AutoGloss>{sub}</AutoGloss></div>}
          </Card>
        ))}
      </div>

      {tab === "E1" && <Card className="pad-0">
        <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">商品目录 & 定价</span><CodeTag>商品目录</CodeTag><div className="spacer" /><CodeTag tone="electric"><AutoGloss>E2 代际发布门 · 解锁阶段</AutoGloss></CodeTag></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>型号</th><th>代际</th><th className="num">售价</th><th><AutoGloss>日产(USDT + NEX)</AutoGloss></th><th>GPU</th><th className="num">评分</th><th className="num">销量</th><th>解锁 Phase(E2)</th><th className="num">库存</th><th>角标</th><th>状态</th><th /></tr></thead>
          <tbody>{skus.map((s) => { const st = s.status || "on"; const isShareRow = s.tier === "Share"; return (
            <tr key={s.name} style={st === "off" ? { opacity: 0.5 } : undefined}>
              <td className="t-strong">{s.name}{s.tagline ? <div className="muted tiny" style={{ fontWeight: 400, maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.tagline}</div> : null}</td>
              <td><span className="row" style={{ gap: 6 }}>{s.generation ? <CodeTag>{"Gen " + s.generation}</CodeTag> : <span className="muted tiny">—</span>}{s.lifecycle === "legacy" ? <span className="muted tiny">legacy</span> : null}</span></td>
              <td className="num t-strong tnum">{fmtUsd(s.price)}</td>
              <td className="mono tiny">{isShareRow && s.shareYieldMin != null ? `${s.shareYieldMin}–${s.shareYieldMax}% · ${(s.dailyEarnNEX ?? 0).toLocaleString()} NEX` : `$${(s.dailyEarn ?? 0).toFixed(2)}/d · ${(s.dailyEarnNEX ?? 0).toLocaleString()} NEX`}</td>
              <td className="mono tiny">{s.gpu || "—"}</td>
              <td className="num tnum">{s.rating != null ? "★ " + s.rating.toFixed(1) : "—"}</td>
              <td className="num tnum">{s.sold != null ? s.sold.toLocaleString() : "—"}</td>
              <td><span className="row" style={{ gap: 6 }}><CodeTag tone="electric">{s.unlock}</CodeTag><span className="muted tiny">{s.unlock === "P1" ? "已开放" : "门控"}</span></span></td>
              <td className="tnum">{s.stock}</td>
              <td><CodeTag tone={s.tag === "popular" ? "orange" : s.tag === "limited" ? "danger" : ""}>{s.badge || s.tag || "—"}</CodeTag></td>
              <td><Badge tone={st === "on" ? "ok" : st === "pending" ? "warn" : "neutral"}>{st === "on" ? "在售" : st === "pending" ? "待上架" : "已下架"}</Badge></td>
              <td><span className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                <Btn sm onClick={() => { setForm(skuToForm(s)); setSkuImg(null); setEditName(s.name); setAddSku(true); }}>改价/编辑</Btn>
                <Btn sm onClick={() => setMc({ name: s.name, op: "sku-status", status: st === "on" ? "off" : "on" })}>{st === "on" ? "下架" : "上架"}</Btn>
                <Btn sm onClick={() => delSku(s.name)}>删除</Btn>
              </span></td></tr>
          ); })}</tbody>
        </table></div>
        <div style={{ padding: "0 18px 16px" }}><div className="tint cyan tiny"><AutoGloss>代际发布门(E2):Pro v2 = P3 / Rack P2 = P5 解锁 · 门控随 H1 Phase 推进自动开放</AutoGloss></div></div>
      </Card>}

      {tab === "E1" && <Card className="pad-0" style={{ marginTop: 16 }}>
        <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">用户评价 · {reviews.length} 条</span><CodeTag>评价 CRUD</CodeTag><div className="spacer" /><Btn sm variant="primary" onClick={openAddReview}><Icon name="plus" size={13} /> 新增评价</Btn></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>商品</th><th>评价人</th><th className="num">评分</th><th>内容</th><th>时间</th><th>状态</th><th /></tr></thead>
          <tbody>{reviews.map((r) => (
            <tr key={r.id} style={r.status === "hidden" ? { opacity: 0.5 } : undefined}>
              <td className="mono tiny">{r.productId === "*" ? "通用" : (skus.find((x) => (x.id || x.name) === r.productId)?.name ?? r.productId)}</td>
              <td className="t-strong">{r.author}</td>
              <td className="num tnum" style={{ color: "var(--warning)" }}>{"★".repeat(r.rating)}<span style={{ color: "var(--ink-4)" }}>{"★".repeat(Math.max(0, 5 - r.rating))}</span></td>
              <td className="tiny" style={{ maxWidth: 280, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.content}</td>
              <td className="mono tiny t-mut">{r.date}</td>
              <td><Badge tone={r.status === "published" ? "ok" : "neutral"}>{r.status === "published" ? "展示中" : "已隐藏"}</Badge></td>
              <td><span className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                <Btn sm onClick={() => openEditReview(r)}>编辑</Btn>
                <Btn sm onClick={() => toggleReview(r)}>{r.status === "published" ? "隐藏" : "恢复"}</Btn>
                <Btn sm onClick={() => delReview(r)}>删除</Btn>
              </span></td>
            </tr>
          ))}</tbody>
        </table></div>
        <div style={{ padding: "0 18px 16px" }}><div className="tint tiny"><AutoGloss>每条评价关联单个具体设备(productId = 设备 id)· 对应商品详情页可见 · 增删改 + 隐藏均写审计 A2</AutoGloss></div></div>
      </Card>}

      {tab === "E3" && <div className="grid g-3">
        <Card className="span-2 pad-0">
          <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">收益 & 任务引擎 · {tasks.length} 类任务</span><CodeTag title="任务类型 / 单价 / 门槛 · 增删改查">任务引擎</CodeTag><div className="spacer" /><Btn sm variant="primary" onClick={openAddTask}><Icon name="plus" size={13} /> 新增任务</Btn></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>任务类型</th><th className="num">单价</th><th>资格门槛</th><th>队列饱和度</th><th /></tr></thead>
            <tbody>{tasks.map((t) => (
              <tr key={t.id}><td className="t-strong">{t.n}</td><td className="num t-strong tnum mono">${t.price.toFixed(2)}<span className="muted">{t.unit}</span></td>
                <td>{t.req.includes("需") ? <CodeTag tone="orange">{t.req}</CodeTag> : <span className="muted tiny">{t.req}</span>}</td>
                <td style={{ width: 160 }}><div className="row" style={{ gap: 8 }}><div style={{ flex: 1 }}><Meter pct={t.sat * 100} color={t.sat > 0.75 ? "var(--warning)" : "var(--success)"} /></div><span className="mono tiny">{(t.sat * 100).toFixed(0)}%</span></div></td>
                <td><span className="row" style={{ gap: 6 }}><Btn sm onClick={() => openEditTask(t)}>编辑</Btn><Btn sm onClick={() => delTask(t)}>下架</Btn></span></td></tr>
            ))}</tbody>
          </table></div>
        </Card>
        <Card><CardH title="队列饱和度" sub="动态调度" />
          <div style={{ textAlign: "center", padding: "8px 0" }}><div style={{ fontSize: 40, fontWeight: 600, color: "var(--warning)" }} className="tnum">63%</div><div className="muted tiny">全网平均饱和度</div></div>
          <hr className="section-divider" />
          <div className="tint cyan tiny"><AutoGloss>锁定任务预览驱动升级转化:高单价任务标注「requires NexionBox Pro / Rack」,在 /earn 展示锁定态钩子。</AutoGloss></div>
        </Card>
      </div>}

      {tab === "E6" && <>
        <Card style={{ marginBottom: 16 }}>
          <CardH title="订单状态机" sub="created → paid → allocating(DC 分配) → active · 失败/退款分支" right={<CodeTag>订单状态机</CodeTag>} />
          <div className="row wrap" style={{ gap: 0, alignItems: "center" }}>
            {ORDER_FLOW.map((s, i) => (<span key={s} className="row" style={{ gap: 0 }}>
              <span className="badge-s" style={{ background: "var(--surface-3)", color: "var(--ink-2)", padding: "6px 12px" }}>{s}</span>
              {i < ORDER_FLOW.length - 1 && <span style={{ margin: "0 6px", color: "var(--ink-4)" }}><Icon name="arrow" size={15} /></span>}
            </span>))}
            <span style={{ margin: "0 10px", color: "var(--ink-4)" }}>分支:</span>
            <Badge tone="err">failed</Badge><span style={{ margin: "0 6px" }} /><Badge tone="warn">refunded</Badge>
          </div>
        </Card>
        <Card className="pad-0">
          <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">订单队列</span><CodeTag>订单队列</CodeTag></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>订单 ID</th><th>用户</th><th>SKU</th><th className="num">金额</th><th>DC 分配</th><th>状态</th><th>时长</th><th /></tr></thead>
            <tbody>{ORDERS.map((o) => { const st = orderState(o); return (
              <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => setSelOrder(o)}><td className="mono t-strong">{o.id}</td><td className="mono t-mut">{o.user}</td><td>{o.sku}</td>
                <td className="num t-strong tnum">{fmtUsd(o.amt)}</td><td className="mono tiny">{o.dc}</td>
                <td><Badge tone={ostate[st] ?? "neutral"}>{stateLabel(st)}</Badge></td><td className="mono tiny t-mut">{o.age}</td><td><Icon name="chevron" size={15} /></td></tr>
            ); })}</tbody>
          </table></div>
        </Card>
        {selOrder && (() => {
          const eff = orderState(selOrder);                          // 有效状态(含取消/退款/补建终态)
          // 已落终态(人工取消/退款/补建,或种子本就 active/refunded)→ 仅可关闭,不再暴露任何处置控件
          const finalized = isCancelled(selOrder.id) || isRefunded(selOrder.id) || !!terminalOf(selOrder.id) || selOrder.state === "active" || selOrder.state === "refunded";
          const canCancel = !finalized && (selOrder.state === "created" || selOrder.state === "paid"); // E-13:placed/paid 前可取消
          const canTerminal = !finalized && NON_TERMINAL.has(selOrder.state); // E-13:仍流转中(created/paid/allocating)可补建终态
          return <Drawer title={selOrder.id} sub={`${selOrder.sku} · ${selOrder.user}`} onClose={() => setSelOrder(null)}
            footer={finalized
              ? <Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => setSelOrder(null)}>关闭</Btn>
              : <>
                  {selOrder.state === "failed" && <Btn onClick={() => { setToast("已重试 DC 分配 " + selOrder.id); setSelOrder(null); }}>重试分配</Btn>}
                  {canCancel && <Btn onClick={() => setMc({ name: "取消订单 " + selOrder.id, op: "order-cancel", orderId: selOrder.id, detail: `订单 ${selOrder.id}(${stateLabel(eff)})置「已取消」· 终止后续分配/扣费,资产/额度回退联动 D4/C3 · 须双人复核 + 审计留痕` })}>取消订单</Btn>}
                  {canTerminal && <Btn onClick={() => setMc({ name: "补建订单终态 " + selOrder.id, op: "order-terminal", orderId: selOrder.id, termOpts: [...TERMINAL_STATES], detail: `为缺失终态的订单 ${selOrder.id} 手动落定终态(支付失败/过期/退款/开通失败)· 状态机对账兜底 · 须双人复核 + 审计留痕` })}>补建终态</Btn>}
                  {selOrder.state === "failed"
                    ? <Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => setMc({ name: "退款 " + selOrder.id, op: "order-refund", orderId: selOrder.id })}><AutoGloss>退款(Maker-Checker)</AutoGloss></Btn>
                    : <Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => setSelOrder(null)}>关闭</Btn>}
                </>}>
            <div className="tint" style={{ marginBottom: 14, textAlign: "center" }}><div className="muted tiny">订单金额</div><div style={{ fontSize: 30, fontWeight: 600, color: "var(--ink)" }} className="tnum">{fmtUsd(selOrder.amt)}</div></div>
            <KV k="状态" v={<Badge tone={ostate[eff] ?? "neutral"}>{stateLabel(eff)}</Badge>} />
            <KV k="DC 分配" v={selOrder.dc} />
            {isCancelled(selOrder.id) && <KV k="取消" v={<span style={{ color: "var(--ink-3)" }}>已取消 · 后续分配/扣费已终止,资产回退联动 D4/C3</span>} />}
            {isRefunded(selOrder.id) && <KV k="退款" v={<span style={{ color: "var(--warning)" }}>已退款 · 资产回退已联动 D4/C3</span>} />}
            {!isCancelled(selOrder.id) && !isRefunded(selOrder.id) && terminalOf(selOrder.id) && <KV k="补建终态" v={<span style={{ color: "var(--warning)" }}>{stateLabel(terminalOf(selOrder.id)!)} · 人工补建,已写入 A2 审计</span>} />}
            <div style={{ fontSize: 12.5, fontWeight: 600, margin: "14px 0 8px", color: "var(--ink)" }}>状态轨迹</div>
            <div className="col" style={{ gap: 6 }}>
              {ORDER_FLOW.map((s) => { const idx = ORDER_FLOW.indexOf(selOrder.state); const done = idx >= 0 && ORDER_FLOW.indexOf(s) <= idx; return <div key={s} className="row" style={{ gap: 8 }}><span className={"dot " + (done ? "green" : "grey")} /><span className={done ? "" : "muted"}>{s}</span></div>; })}
              {selOrder.state === "failed" && <div className="row" style={{ gap: 8 }}><span className="dot red" /><span style={{ color: "var(--danger)" }}>failed · DC 分配超时</span></div>}
              {isCancelled(selOrder.id) && <div className="row" style={{ gap: 8 }}><span className="dot grey" /><span style={{ color: "var(--ink-3)" }}>cancelled · 人工取消</span></div>}
              {!isCancelled(selOrder.id) && terminalOf(selOrder.id) && <div className="row" style={{ gap: 8 }}><span className="dot red" /><span style={{ color: "var(--warning)" }}>{terminalOf(selOrder.id)} · 人工补建终态</span></div>}
            </div>
          </Drawer>;
        })()}
      </>}

      {tab === "E5" && (() => {
        const early = parseFloat(pE("E.device.degradeEarly")), mid = parseFloat(pE("E.device.degradeMid")), late = parseFloat(pE("E.device.degradeLate"));
        const s1 = parseInt(pE("E.device.stageEarlyEnd")), s2 = parseInt(pE("E.device.stageMidEnd")), cyc = parseInt(pE("E.device.cycleMonths")), floorPct = parseFloat(pE("E.device.minEfficiency"));
        const curve = effCurve(early, mid, late, s1, s2, cyc, floorPct);
        const adj = (label: string, key: string, unit: string, detail: string) =>
          <span className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}><span className="mono">{pE(key)}{unit}</span><Btn sm onClick={() => setMc({ name: label + " 调整", op: "param", paramKey: key, unit, current: pE(key) + unit, detail })}>调整</Btn></span>;
        return <div className="grid g-2">
        <Card><CardH title="设备生命周期" sub="三段非线性衰减曲线 · server 权威" right={<CodeTag>设备生命周期</CodeTag>} />
          <Sparkline data={curve} color="var(--brand)" fill h={70} />
          <div className="row tiny muted" style={{ justifyContent: "space-between", marginTop: 6 }}><span>新机 100%</span><span>{cyc} 月 → MIN {floorPct}%</span></div>
          <hr className="section-divider" />
          <KV k="衰减模型" v={`三段非线性 · ${cyc} 月`} />
          <KV k={`早期(月1–${s1})衰减/月`} v={adj("早期衰减率", "E.device.degradeEarly", "%", "早期段每月效率衰减 · server-canonical,改后对全网衰减曲线生效")} />
          <KV k={`中期(月${s1 + 1}–${s2})衰减/月`} v={adj("中期衰减率", "E.device.degradeMid", "%", "中期段每月效率衰减 · server-canonical,改后对全网衰减曲线生效")} />
          <KV k={`晚期(月${s2 + 1}–${cyc})衰减/月`} v={adj("晚期衰减率", "E.device.degradeLate", "%", "晚期段(断崖)每月效率衰减 · 驱动 m9-12 收益暴跌 · server-canonical")} />
          <KV k="最低效能下限" v={adj("最低效能下限", "E.device.minEfficiency", "%", "效率衰减 floor · server-canonical,改后对全网衰减曲线生效")} />
          <KV k="衰减周期" v={adj("衰减周期", "E.device.cycleMonths", " 月", "生命周期月数(达 floor 的月份)· 须对齐平台 12 月生命周期")} />
          <KV k="段边界(早末/中末月)" v={<span className="row" style={{ gap: 6, justifyContent: "flex-end" }}>{adj("早期段末月", "E.device.stageEarlyEnd", "", "早期段结束月")}{adj("中期段末月", "E.device.stageMidEnd", "", "中期段结束月")}</span>} />
          <KV k="豁免规则" v="手机算力 + Cloud Share 免衰减" />
        </Card>
        <Card><CardH title="Trade-in 配置" sub="折旧定价" right={<CodeTag>置换配置</CodeTag>} />
          <KV k="salvage 残值率" v={adj("Trade-in salvage 残值率", "E.tradein.salvagePct", "%", "置换折抵残值率 · server-canonical,改后对新置换报价生效")} /><KV k="decay 衰减" v={`随设备三段 · ${cyc} 月`} />
          <KV k="minHoldingMonths" v={adj("Trade-in minHoldingMonths", "E.tradein.minHoldingMonths", " 月", "最短持有月数门槛 · 调高可收紧套利窗口")} /><KV k="eligibility" v="L4+ 持有者" />
          <KV k="promo 倍率" v={adj("Trade-in promo 倍率", "E.tradein.promoMult", "×", "置换活动倍率 · server-canonical,改后对新置换报价生效")} />
          <div className="tint warn tiny" style={{ marginTop: 10 }}><AutoGloss>K2 监控:minHoldingMonths 规避套利簇 CL-318(12 账户)</AutoGloss></div>
        </Card>
      </div>;
      })()}

      {tab === "E7" && <>
        <div className="grid g-4" style={{ marginBottom: 16 }}>
          {[["在线设备", "41,208", "heartbeat"], ["离线 / 异常", "312", "需排查", "var(--warning)"], ["单户设备上限", "6", "每户上限"], ["平均 NPU", "~28 TOPS", ""]].map(([k, v, sub, col]) => (
            <Card key={k} style={{ padding: "15px 16px" }}><div className="muted tiny">{k}</div><div style={{ fontSize: 22, fontWeight: 600, color: col || "var(--ink)" }} className="tnum">{v}</div>{sub && <div className="muted tiny"><AutoGloss>{sub}</AutoGloss></div>}</Card>
          ))}
        </div>
        <Card><CardH title="设备运维 · 车队" sub="heartbeat / 批量 pause" right={<CodeTag>设备运维</CodeTag>} />
          <div className="grid g-3" style={{ gap: 12 }}>
            {([["us-east-2", 18420, "var(--success)"], ["eu-west-1", 12880, "var(--success)"], ["ap-southeast-1", 9908, "var(--warning)"]] as const).map(([dc, n, c]) => { const paused = isDcPaused(dc); return (
              <div key={dc} className="tint">
                <div className="row" style={{ justifyContent: "space-between" }}><span className="row"><span className="dot" style={{ background: paused ? "var(--ink-4)" : c, marginRight: 6 }} /><b className="mono tiny">{dc}</b></span>{paused && <Badge tone="warn">已暂停</Badge>}</div>
                <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4, color: paused ? "var(--ink-3)" : "var(--ink)" }} className="tnum">{n.toLocaleString()}</div>
                <div className="muted tiny">在线设备</div>
                <div className="row" style={{ marginTop: 8 }}><Btn sm onClick={() => setMc({ name: (paused ? "恢复" : "批量 pause") + " · " + dc, op: "ops-pause", dc, status: paused ? "off" : "on", detail: paused ? "恢复 " + dc + " 派单 · heartbeat 重新接入调度" : "暂停 " + dc + " 全节点派单 · 仅运维窗口,不影响已售设备结算" })}><Icon name="power" size={13} />{paused ? "恢复派单" : "批量 pause"}</Btn></div>
              </div>
            ); })}
          </div>
          <div className="tint warn tiny" style={{ marginTop: 12 }}><AutoGloss>批量 pause / 恢复为运维级动作 · 须 Maker-Checker 双人复核 + 审计留痕,处置范围限单数据中心</AutoGloss></div>
        </Card>
      </>}

      {addSku && <Drawer title={editName ? "编辑 SKU" : "新增 SKU"} sub={<AutoGloss>{editName ? "改价 / 库存 / 日产基准 / 上架 Phase · 改后走双人复核" : "填写商品规格 · 提交后走双人复核"}</AutoGloss>} onClose={() => { setAddSku(false); setEditName(null); }}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => { setAddSku(false); setEditName(null); }}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!form.name || !form.price} onClick={() => { setMc({ name: form.name || "未命名", op: "sku-save", isNew: !editName, hasImg: !!skuImg }); setAddSku(false); }}>{editName ? "保存修改" : "提交复核"}</Btn></>}>
        <div className="col" style={{ gap: 12 }}>
          <div className="col" style={{ gap: 5 }}><span className="muted tiny">产品图</span>
            <label className={"sku-drop" + (dragOver ? " drag" : "")} style={skuImg ? { padding: 0, borderStyle: "solid" } : {}}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); onPickImg(e.dataTransfer.files[0]); }}>
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => onPickImg(e.target.files?.[0])} />
              {skuImg
                ? <img src={skuImg.src} alt="" style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 9, display: "block" }} />
                : <div className="col" style={{ alignItems: "center", gap: 6, padding: "22px 0", color: dragOver ? "var(--brand)" : "var(--ink-3)" }}><Icon name="image" size={26} /><span className="tiny">{dragOver ? "松开即上传" : "点击或拖拽图片到此"}</span><span className="muted tiny">建议 1:1 / ≤ 2MB · PNG、JPG</span></div>}
            </label>
            {skuImg && <div className="row" style={{ gap: 8 }}>
              <span className="muted tiny" style={{ flex: 1 }}>{skuImg.w}×{skuImg.h}px {isSquare ? <span style={{ color: "var(--success)" }}>· 1:1 ✓</span> : <span style={{ color: "var(--warning)" }}>· 非 1:1,建议裁剪</span>}</span>
              {!isSquare && <Btn sm onClick={cropSquare}>裁剪为 1:1</Btn>}
              <Btn sm onClick={() => setSkuImg(null)}>移除</Btn>
            </div>}
          </div>
          <SkuFieldGroup n="①" title="基本信息">
            <SkuFld label="型号名称" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="如 NexionBox Pro v3" />
            <div className="grid g-2" style={{ gap: 12 }}>
              <label className="col" style={{ gap: 5 }}><span className="muted tiny">档位 tier</span><select className="fld" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>{["Entry", "Pro", "Flagship", "Share"].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
              <SkuFld label="营销角标 badge" value={form.badge} onChange={(v) => setForm({ ...form, badge: v })} placeholder="Best Seller / New Gen / Trending" />
            </div>
            <SkuFld label="标语 tagline" value={form.tagline} onChange={(v) => setForm({ ...form, tagline: v })} placeholder="Personal AI inference box · fully managed" />
            <SkuFld label="售价(USD)" type="number" value={form.price} onChange={(v) => setForm({ ...form, price: v })} placeholder="2639" />
          </SkuFieldGroup>

          <SkuFieldGroup n="②" title="硬件规格">
            <div className="grid g-2" style={{ gap: 12 }}>
              <SkuFld label="GPU" value={form.gpu} onChange={(v) => setForm({ ...form, gpu: v })} placeholder="4× RTX 4090" />
              <SkuFld label="显存 VRAM" value={form.vram} onChange={(v) => setForm({ ...form, vram: v })} placeholder="96GB VRAM" />
            </div>
            {form.tier !== "Share" && <div className="grid g-2" style={{ gap: 12 }}>
              <SkuFld label="算力 hashRate" value={form.hashRate} onChange={(v) => setForm({ ...form, hashRate: v })} placeholder="1,240 MH/s" />
              <SkuFld label="功率 power" value={form.power} onChange={(v) => setForm({ ...form, power: v })} placeholder="1,200W TDP" />
            </div>}
            <SkuFld label="数据中心 datacenter" value={form.datacenter} onChange={(v) => setForm({ ...form, datacenter: v })} placeholder="Singapore DC" />
          </SkuFieldGroup>

          <SkuFieldGroup n="③" title={form.tier === "Share" ? "收益参数(年化 + NEX)" : "收益参数(双币)"}>
            {form.tier !== "Share" ? (
              <div className="grid g-2" style={{ gap: 12 }}>
                <SkuFld label="日产 USDT" type="number" value={form.dailyEarn} onChange={(v) => setForm({ ...form, dailyEarn: v })} placeholder="38.50" />
                <SkuFld label="日产 NEX" type="number" value={form.dailyEarnNEX} onChange={(v) => setForm({ ...form, dailyEarnNEX: v })} placeholder="65" />
              </div>
            ) : (
              <>
                <div className="grid g-2" style={{ gap: 12 }}>
                  <SkuFld label="Share 年化下限 %" type="number" value={form.shareYieldMin} onChange={(v) => setForm({ ...form, shareYieldMin: v })} placeholder="8" />
                  <SkuFld label="Share 年化上限 %" type="number" value={form.shareYieldMax} onChange={(v) => setForm({ ...form, shareYieldMax: v })} placeholder="15" />
                </div>
                <SkuFld label="日产 NEX(份额每日额外发放)" type="number" value={form.dailyEarnNEX} onChange={(v) => setForm({ ...form, dailyEarnNEX: v })} placeholder="30" />
              </>
            )}
          </SkuFieldGroup>

          <SkuFieldGroup n="④" title="AI 性能">
            {form.tier !== "Share" && <>
            <div className="grid g-2" style={{ gap: 12 }}>
              <SkuFld label="图像生成 张/min" type="number" value={form.aiImageGenPerMin} onChange={(v) => setForm({ ...form, aiImageGenPerMin: v })} placeholder="320" />
              <SkuFld label="LLM 推理 tok/s" type="number" value={form.aiLlmTokensPerSec} onChange={(v) => setForm({ ...form, aiLlmTokensPerSec: v })} placeholder="12400" />
            </div>
            <div className="grid g-2" style={{ gap: 12 }}>
              <SkuFld label="视频渲染 s/min" type="number" value={form.aiVideoMinPerHour} onChange={(v) => setForm({ ...form, aiVideoMinPerHour: v })} placeholder="18" />
              <SkuFld label="LoRA 微调 min" type="number" value={form.aiFineTuneMins} onChange={(v) => setForm({ ...form, aiFineTuneMins: v })} placeholder="6" />
            </div>
            </>}
            <SkuFld label={form.tier === "Share" ? "解锁算力池 unlocks(份额可访问的池)" : "解锁算力池 unlocks"} value={form.aiUnlocks} onChange={(v) => setForm({ ...form, aiUnlocks: v })} placeholder="LLM 70B inference pool" />
          </SkuFieldGroup>

          <SkuFieldGroup n="⑤" title="营销 & 社会证明">
            {form.tier !== "Share" ? (
              <div className="grid g-2" style={{ gap: 12 }}>
                <SkuFld label="累计销量 sold" type="number" value={form.sold} onChange={(v) => setForm({ ...form, sold: v })} placeholder="4821" />
                <SkuFld label="库存 stock" value={form.stock} onChange={(v) => setForm({ ...form, stock: v })} placeholder="47" hint="留空=∞" />
              </div>
            ) : (
              <SkuFld label="累计销量 sold" type="number" value={form.sold} onChange={(v) => setForm({ ...form, sold: v })} placeholder="12483" hint="份额无限量,不设库存" />
            )}
            <div className="grid g-2" style={{ gap: 12 }}>
              <SkuFld label="评分 rating" type="number" value={form.rating} onChange={(v) => setForm({ ...form, rating: v })} placeholder="4.8" />
              <SkuFld label="评论数 reviews" type="number" value={form.reviews} onChange={(v) => setForm({ ...form, reviews: v })} placeholder="2847" />
            </div>
          </SkuFieldGroup>

          <SkuFieldGroup n="⑥" title="代际 & 生命周期">
            <div className="grid g-2" style={{ gap: 12 }}>
              <label className="col" style={{ gap: 5 }}><span className="muted tiny">代际 generation</span><select className="fld" value={form.generation} onChange={(e) => setForm({ ...form, generation: e.target.value })}>{["1", "2", "3"].map((x) => <option key={x} value={x}>Gen {x}</option>)}</select></label>
              <label className="col" style={{ gap: 5 }}><span className="muted tiny">生命周期 lifecycle</span><select className="fld" value={form.lifecycle} onChange={(e) => setForm({ ...form, lifecycle: e.target.value })}><option value="active">active(在产)</option><option value="legacy">legacy(停代)</option></select></label>
            </div>
            {form.tier !== "Share" && <>
            <div className="grid g-2" style={{ gap: 12 }}>
              <label className="col" style={{ gap: 5 }}><span className="muted tiny"><AutoGloss>解锁 Phase（代际发布门）</AutoGloss></span><select className="fld" value={form.unlock} onChange={(e) => setForm({ ...form, unlock: e.target.value })}>{["P1", "P2", "P3", "P4", "P5", "P6"].map((p) => <option key={p} value={p}>{p}{p === "P1" ? "（立即开放）" : "（门控）"}</option>)}</select></label>
              <SkuFld label="以旧换新折扣 USD" type="number" value={form.tradeinDiscount} onChange={(v) => setForm({ ...form, tradeinDiscount: v })} placeholder="300" hint="可空" />
            </div>
            <SkuFld label="被替代为 supersededBy" value={form.supersededBy} onChange={(v) => setForm({ ...form, supersededBy: v })} placeholder="stellarbox-pro-v2(下一代 id)" hint="可空" />
            </>}
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">特性清单 features · 每行一条</span><textarea className="fld" style={{ minHeight: 72, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} placeholder={"Fully managed by Nexion\n99.9% uptime SLA\nFree shipping & installation"} /></label>
          </SkuFieldGroup>

          {(() => {
            if (form.tier === "Share") {
              const lo = skuNum(form.shareYieldMin); const hi = skuNum(form.shareYieldMax); const nex = skuNum(form.dailyEarnNEX); const pr = skuNum(form.price);
              return (lo > 0 || hi > 0) ? <div className="tint cyan tiny">派生 · 年化 {lo}–{hi}% · 日产 {nex.toLocaleString()} NEX{pr > 0 ? ` · 起投 $${pr.toLocaleString()}` : ""}</div> : null;
            }
            const p = skuNum(form.price); const d = skuNum(form.dailyEarn);
            return p > 0 && d > 0 ? <div className="tint cyan tiny">派生 · 回本 ≈ {Math.round(p / d)} 天 · 首年净 ≈ ${(d * 365 - p).toLocaleString()} · 年化 ≈ {Math.round((d * 365 / p) * 100)}% · vs 手机 ≈ {Math.round(d / 0.08).toLocaleString()}×</div> : null;
          })()}
          <div className="tint warn tiny"><AutoGloss>定价 / 日产基准 / 状态为高敏字段 · 新增 SKU 需双人复核后才上架</AutoGloss></div>
        </div>
      </Drawer>}

      {taskDrawer && <Drawer title={taskForm.id ? "编辑任务" : "新增任务"} sub={<AutoGloss>AI 算力任务类型 · 单价/门槛改后对新派单 server-canonical 生效</AutoGloss>} onClose={() => setTaskDrawer(false)}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => setTaskDrawer(false)}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!taskForm.n.trim() || !Number(taskForm.price)} onClick={submitTask}>{taskForm.id ? "保存修改" : "提交新增"}</Btn></>}>
        <div className="col" style={{ gap: 12 }}>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">任务名称</span><input className="fld" value={taskForm.n} onChange={(e) => setTaskForm({ ...taskForm, n: e.target.value })} placeholder="如 LLM 推理 405B" /></label>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny"><AutoGloss>单价(USDT)</AutoGloss></span><input className="fld" type="number" value={taskForm.price} onChange={(e) => setTaskForm({ ...taskForm, price: e.target.value })} placeholder="1.20" /></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">计价单位</span><div className="row wrap" style={{ gap: 6 }}>{["/job", "/1k", "/min"].map((u) => <Chip key={u} tab sel={taskForm.unit === u} onClick={() => setTaskForm({ ...taskForm, unit: u })}>{u}</Chip>)}</div></label>
          </div>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">资格门槛(设备要求)</span><div className="row wrap" style={{ gap: 6 }}>{["S1+", "需 NexionBox Pro", "需 NexionRack"].map((r) => <Chip key={r} tab sel={taskForm.req === r} onClick={() => setTaskForm({ ...taskForm, req: r })}>{r}</Chip>)}</div></label>
          <div className="tint warn tiny"><AutoGloss>单价 / 门槛为高敏字段 · server-canonical;改后对新派单生效 + 前端 /earn 任务池同步,需双人复核留痕。</AutoGloss></div>
        </div>
      </Drawer>}

      {reviewDrawer && <Drawer title={editReviewId ? "编辑评价" : "新增评价"} sub={<AutoGloss>用户评价 · 关联单个设备 · 增删改后对该商品详情页生效</AutoGloss>} onClose={() => { setReviewDrawer(false); setEditReviewId(null); }}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => { setReviewDrawer(false); setEditReviewId(null); }}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!reviewForm.author.trim() || !reviewForm.content.trim()} onClick={submitReview}>{editReviewId ? "保存修改" : "提交新增"}</Btn></>}>
        <div className="col" style={{ gap: 12 }}>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">关联商品(在售设备)</span><select className="fld" value={reviewForm.productId} onChange={(e) => setReviewForm({ ...reviewForm, productId: e.target.value })}>{skus.filter((s) => (s.status || "on") !== "off").map((s) => <option key={s.name} value={s.id || s.name}>{s.name}</option>)}</select></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">评分 rating</span><select className="fld" value={reviewForm.rating} onChange={(e) => setReviewForm({ ...reviewForm, rating: e.target.value })}>{["5", "4", "3", "2", "1"].map((n) => <option key={n} value={n}>{n} ★</option>)}</select></label>
          </div>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">评价人 author</span><input className="fld" value={reviewForm.author} onChange={(e) => setReviewForm({ ...reviewForm, author: e.target.value })} placeholder="Maya · ID" /></label>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">评价内容 content</span><textarea className="fld" style={{ minHeight: 72, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} value={reviewForm.content} onChange={(e) => setReviewForm({ ...reviewForm, content: e.target.value })} placeholder="Paid back in 11 months…" /></label>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">时间文案 date</span><input className="fld" value={reviewForm.date} onChange={(e) => setReviewForm({ ...reviewForm, date: e.target.value })} placeholder="2 days ago" /></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">状态 status</span><select className="fld" value={reviewForm.status} onChange={(e) => setReviewForm({ ...reviewForm, status: e.target.value })}><option value="published">published(展示)</option><option value="hidden">hidden(隐藏)</option></select></label>
          </div>
          <div className="tint tiny"><AutoGloss>评价为内容运营动作 · 提交即写审计 A2;隐藏态不对用户展示。</AutoGloss></div>
        </div>
      </Drawer>}

      {mc && <MakerCheckerModal
        action={mc.op === "sku-save" ? (mc.isNew ? "新增 SKU:" + mc.name : "编辑 SKU:" + mc.name) : mc.op === "sku-status" ? (mc.status === "off" ? "下架 SKU:" + mc.name : "上架 SKU:" + mc.name) : mc.op === "param" ? mc.name : mc.op === "order-refund" ? mc.name : mc.op === "order-cancel" ? mc.name : mc.op === "order-terminal" ? mc.name : mc.op === "ops-pause" ? mc.name : mc.refund ? mc.name : `定价调整:${mc.name}`}
        detail={mc.op === "sku-save" ? (mc.isNew ? "创建后入「待上架」· " : "改后 ") + (mc.hasImg ? "含产品图 · " : "") + "复核通过才生效 / 对用户可见" : mc.op === "sku-status" ? (mc.status === "off" ? "下架后从商城隐藏,不影响已售设备" : "上架后对用户可见") : mc.detail ?? (mc.refund ? "资产回退,联动 D4 冲正 + C3" : `当前 $${mc.price} · server-canonical`)}
        edit={mc.op === "param" ? { kind: "number", current: mc.current, unit: mc.unit } : mc.op === "order-terminal" ? { kind: "select", options: mc.termOpts } : undefined}
        amplifies={!!mc.refund}
        onClose={() => setMc(null)}
        onConfirm={(reason, newValue) => {
          if (mc.op === "sku-save") {
            const ex = editName ? skus.find((x) => x.name === editName) : undefined;
            const sku = formToSku(form, ex);
            if (editName) { updateSku(editName, sku); logAudit({ actor: "总管理员", action: "编辑 SKU " + form.name, target: form.name, reason }); setToast("SKU 已更新:" + form.name); }
            else { addSkuStore(sku); logAudit({ actor: "总管理员", action: "新增 SKU " + form.name, target: form.name, reason }); setToast("SKU 已新增:" + form.name + " · 待上架"); }
            setEditName(null);
          } else if (mc.op === "sku-status") {
            setSkuStatus(mc.name, mc.status!); logAudit({ actor: "总管理员", action: (mc.status === "off" ? "下架 SKU " : "上架 SKU ") + mc.name, target: mc.name, after: mc.status, reason }); setToast("SKU " + mc.name + (mc.status === "off" ? " 已下架" : " 已上架"));
          } else if (mc.op === "param" && mc.paramKey) {
            const v = (newValue ?? "").trim();
            setParam(mc.paramKey, v, { action: mc.name, reason }); // setParam 内置审计(含 before→after)
            setToast(mc.name + ":已写入 " + v + (mc.unit ?? "") + " · server-canonical");
          } else if (mc.op === "order-refund" && mc.orderId) {
            setParam(`E.order.${mc.orderId}.refunded`, "true", { action: "订单退款 " + mc.orderId, reason });
            setToast("订单 " + mc.orderId + " 已退款 · 资产回退已联动 D4 冲正 + C3");
            setSelOrder(null);
          } else if (mc.op === "order-cancel" && mc.orderId) {
            setParam(`E.order.${mc.orderId}.cancelled`, "true", { action: "取消订单 " + mc.orderId, reason }); // setParam 内置审计
            setToast("订单 " + mc.orderId + " 已取消 · 后续分配/扣费已终止");
            setSelOrder(null);
          } else if (mc.op === "order-terminal" && mc.orderId) {
            const v = (newValue ?? "").trim();
            if (v) {
              setParam(`E.order.${mc.orderId}.terminalState`, v, { action: "补建订单终态 " + mc.orderId, reason }); // setParam 内置审计
              setToast("订单 " + mc.orderId + " 已补建终态:" + stateLabel(v));
            }
            setSelOrder(null);
          } else if (mc.op === "ops-pause" && mc.dc) {
            const paused = mc.status === "on"; // on = 本次执行暂停;off = 恢复
            setParam(`E.ops.${mc.dc}.paused`, paused ? "true" : "false", { action: (paused ? "批量 pause 数据中心 " : "恢复数据中心派单 ") + mc.dc, reason });
            setToast(mc.dc + (paused ? " 已暂停派单" : " 已恢复派单"));
          } else { setToast("已提交复核"); }
          setMc(null);
        }} />}
      {toastNode}
    </div>
  );
}
