"use client";

/**
 * E 设备与商城 — 设计稿 design_handoff_e_domain 内容视图。
 * 全系统统一连续编号 E1-E5(代际门原 E2 并入 E1、设备生命周期原 E4 并入 E5→现 E3):
 * E1 商品目录&代际门 / E2 收益&任务引擎 / E3 生命周期&Trade-in / E4 订单状态机 / E5 设备运维。
 * nav id == 视图 key == prdAnchor == PRD §10 章节(已全部重编号统一,FOLD 现为恒等映射)。
 *
 * 本 shell 持有全部共享 store 接线 + 4 个抽屉(SKU / 任务 / 评价 / 订单详情)+ OperationConfirmModal;
 * 各 tab 视觉/布局拆到 e-tabs/*(复用 design-kit 原语 + e-domain.css 设计类),经 EViewCtx 注入派生读 + 回调。
 * 真写落点:CRUD 走 platform-config-store 真接口(addSku/updateSku/setSkuStatus/removeSku、task、review),
 * 配置/处置走 setParam(E.gen.* / E.device.* / E.tradein.* / E.order.* / E.ops.*),全部 logAudit 写 A2。
 * 操作确认 显式 edit 契约:调参(param / task-price)传 edit{kind,current,unit};处置/纯动作(sku-status / param-fixed / order-* / ops-pause)不传 edit。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon, Btn, Chip, Drawer, KV, Badge, OperationConfirmModal, useToast } from "./design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { confirm } from "@/lib/store/ui";
import { usePlatformConfig, type OpsSku, type OpsReview, type OpsTask } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { SKUS, REVIEWS } from "@/lib/mock/admin/design-data";
import {
  FOLD, TASKS, ORDERS, ORDER_FLOW, TERMINAL_STATES, E_PARAM_DEFAULTS,
  EMPTY_SKU_FORM, type SkuForm, skuToForm, formToSku, skuNum, stateLabel, ostate,
} from "./e-tabs/data";
import type { Mc, EViewCtx, EOrder } from "./e-tabs/types";
import { E1Catalog } from "./e-tabs/e1-catalog";
import { E2Tasks } from "./e-tabs/e2-tasks";
import { E3Lifecycle } from "./e-tabs/e3-lifecycle";
import { E4Orders } from "./e-tabs/e4-orders";
import { E5Ops } from "./e-tabs/e5-ops";
import "./e-domain.css";

let TASK_SEQ = 100;   // 客户端新增任务 id 计数(避免 Date.now/Math.random,SSR 安全)
let REVIEW_SEQ = 100; // 客户端新增评价 id 计数(SSR 安全)

type SkuImg = { src: string; w: number; h: number } | null;

// SKU 抽屉分节头(① 24×24 brand-soft 圆贴 + 14.5/600 标题 + 顶部分隔)。
function SkuFieldGroup({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 10, alignItems: "center", marginTop: 4, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
        <span style={{ width: 24, height: 24, borderRadius: 7, background: "var(--brand-soft)", color: "var(--brand)", border: "1px solid var(--brand-border)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, fontFamily: "var(--mono)" }}>{n}</span>
        <span style={{ fontSize: 14.5, fontWeight: 600, color: "var(--ink)" }}>{title}</span>
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
  const [mc, setActionConfirm] = useState<Mc>(null);
  const [selOrder, setSelOrder] = useState<EOrder | null>(null);
  const hydrated = useOpsHydrated();

  // ── 共享 store 接线 ──
  const setParam = usePlatformConfig((s) => s.setParam);
  const logAudit = usePlatformConfig((s) => s.logAudit);
  const params = usePlatformConfig((s) => s.params);
  const pget = (k: string): string | undefined => (hydrated ? (params?.[k] as string | undefined) : undefined);
  const pE = (k: string): string => pget(k) ?? E_PARAM_DEFAULTS[k] ?? "—";
  const isRefunded = (id: string): boolean => pget(`E.order.${id}.refunded`) === "true";
  const isCancelled = (id: string): boolean => pget(`E.order.${id}.cancelled`) === "true";
  const terminalOf = (id: string): string | undefined => pget(`E.order.${id}.terminalState`);
  const isDcPaused = (dc: string): boolean => pget(`E.ops.${dc}.paused`) === "true";
  const orderState = (o: EOrder): string => (isCancelled(o.id) ? "cancelled" : isRefunded(o.id) ? "refunded" : terminalOf(o.id) ?? o.state);
  const phaseCur = pget("H.phase.current") ?? "P3";

  // ── E3 任务:真增删改查(persist) ──
  const seedTasks = useMemo<OpsTask[]>(() => TASKS.map((t, i) => ({ ...t, id: "TK-" + (i + 1) })), []);
  const ensureTasks = usePlatformConfig((s) => s.ensureTasks);
  const storeTasks = usePlatformConfig((s) => s.tasks);
  const addTaskStore = usePlatformConfig((s) => s.addTask);
  const updateTaskStore = usePlatformConfig((s) => s.updateTask);
  const removeTaskStore = usePlatformConfig((s) => s.removeTask);
  useEffect(() => { if (hydrated) ensureTasks(seedTasks); }, [hydrated, seedTasks, ensureTasks]);
  const tasks = hydrated && storeTasks ? storeTasks : seedTasks;

  // ── E1 SKU:真增删改 + 上下架(persist) ──
  const seedSkus = useMemo<OpsSku[]>(() => SKUS as OpsSku[], []);
  const ensureSkus = usePlatformConfig((s) => s.ensureSkus);
  const storeSkus = usePlatformConfig((s) => s.skus);
  const addSkuStore = usePlatformConfig((s) => s.addSku);
  const updateSku = usePlatformConfig((s) => s.updateSku);
  const setSkuStatus = usePlatformConfig((s) => s.setSkuStatus);
  const removeSkuStore = usePlatformConfig((s) => s.removeSku);
  useEffect(() => { if (hydrated) ensureSkus(seedSkus); }, [hydrated, seedSkus, ensureSkus]);
  const skus = hydrated && storeSkus ? storeSkus : seedSkus;

  // ── E1 评价:真增删改查 + 隐藏切换(persist) ──
  const seedReviews = useMemo<OpsReview[]>(() => REVIEWS as OpsReview[], []);
  const ensureReviews = usePlatformConfig((s) => s.ensureReviews);
  const storeReviews = usePlatformConfig((s) => s.reviews);
  const addReviewStore = usePlatformConfig((s) => s.addReview);
  const updateReviewStore = usePlatformConfig((s) => s.updateReview);
  const removeReviewStore = usePlatformConfig((s) => s.removeReview);
  useEffect(() => { if (hydrated) ensureReviews(seedReviews); }, [hydrated, seedReviews, ensureReviews]);
  const reviews = hydrated && storeReviews ? storeReviews : seedReviews;

  // ── 抽屉本地态 ──
  const [skuDrawer, setSkuDrawer] = useState(false);
  const [form, setForm] = useState<SkuForm>(EMPTY_SKU_FORM);
  const [skuImg, setSkuImg] = useState<SkuImg>(null);
  const [dragOver, setDragOver] = useState(false);
  const [editName, setEditName] = useState<string | null>(null);
  const [taskDrawer, setTaskDrawer] = useState(false);
  const [taskForm, setTaskForm] = useState<{ n: string; price: string; req: string; unit: string; sat: string }>({ n: "", price: "", req: "S1+", unit: "/job", sat: "" });
  const [reviewDrawer, setReviewDrawer] = useState(false);
  const [editReviewId, setEditReviewId] = useState<string | null>(null);
  const [reviewForm, setReviewForm] = useState({ productId: "", author: "", rating: "5", content: "", date: "刚刚", status: "published" });

  // ── 回调(注入 ctx)──
  const openSku = (name?: string) => {
    if (name) { const s = skus.find((x) => x.name === name); if (s) { setForm(skuToForm(s)); setEditName(name); } }
    else { setForm(EMPTY_SKU_FORM); setEditName(null); }
    setSkuImg(null); setSkuDrawer(true);
  };
  const delSku = (name: string) => {
    setActionConfirm({
      name: "删除 SKU · " + name,
      op: "sku-delete",
      target: name,
      detail: `删除「${name}」:从商品目录移除,不影响已售设备,但会影响前台商品列表、详情页入口和后续购买。需填写操作理由 + 审计留痕。`,
      businessForm: {
        kind: "destructive-reason",
        target: name,
        impact: "商品目录与用户端购买入口会移除;已售设备订单和账本不回溯。",
      },
    });
  };
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
  const openAddTask = () => { setTaskForm({ n: "", price: "", req: "S1+", unit: "/job", sat: "" }); setTaskDrawer(true); };
  const submitTask = () => {
    const price = Number(taskForm.price) || 0;
    if (!taskForm.n.trim() || !price) { setToast("请填写任务名称 + 单价"); return; }
    const sat = Math.max(0, Math.min(100, Number(taskForm.sat) || 0)) / 100;
    addTaskStore({ id: "TK-" + ++TASK_SEQ, n: taskForm.n.trim(), price, unit: taskForm.unit, req: taskForm.req, sat });
    logAudit({ actor: "总管理员", action: "新增任务 " + taskForm.n, target: taskForm.n });
    setToast("已新增任务:" + taskForm.n + " · 待上线(server 校验后对 /earn 任务池可见)");
    setTaskDrawer(false);
  };
  const delTask = (t: { id: string; n: string }) => {
    setActionConfirm({
      name: "下架任务 · " + t.n,
      op: "task-down",
      taskId: t.id,
      target: t.n,
      detail: `下架「${t.n}」:停止派单并从 /earn 任务池移除。需填写操作理由、确认影响并写 A2 审计。`,
      businessForm: {
        kind: "destructive-reason",
        target: t.n,
        impact: "任务池不再派发该任务;已完成或已结算任务不回溯。",
      },
    });
  };

  // ── 产品图上传(SKU 抽屉)──
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
      const c = document.createElement("canvas"); c.width = c.height = s;
      const x = (im.width - s) / 2, y = (im.height - s) / 2;
      c.getContext("2d")!.drawImage(im, x, y, s, s, 0, 0, s, s);
      setSkuImg({ src: c.toDataURL("image/png"), w: s, h: s }); setToast("已居中裁剪为 1:1");
    };
    im.src = skuImg.src;
  };
  const isSquare = skuImg && Math.abs(skuImg.w - skuImg.h) <= Math.max(skuImg.w, skuImg.h) * 0.02;

  const ctx: EViewCtx = {
    hydrated, pget, pE, openActionConfirm: (m) => setActionConfirm(m), toast: setToast,
    skus, reviews, phaseCur, openSku, delSku, openAddReview, openEditReview, toggleReview, delReview,
    tasks, openAddTask, delTask,
    orders: ORDERS, orderState, isCancelled, isRefunded, terminalOf, openOrder: (o) => setSelOrder(o),
    isDcPaused,
  };

  const headerRight =
    tab === "E1" ? <button className="f-cta" onClick={() => openSku()}>+ 新增 SKU</button>
      : tab === "E2" ? <button className="f-cta" onClick={openAddTask}>+ 新增任务</button>
        : undefined;

  return (
    <div className="dkpage edom">
      <DomainHeader {...meta} right={headerRight} />

      {tab === "E1" && <E1Catalog ctx={ctx} />}
      {tab === "E2" && <E2Tasks ctx={ctx} />}
      {tab === "E3" && <E3Lifecycle ctx={ctx} />}
      {tab === "E4" && <E4Orders ctx={ctx} />}
      {tab === "E5" && <E5Ops ctx={ctx} />}

      {/* 订单详情抽屉 */}
      {selOrder && (() => {
        const o = selOrder;
        const eff = orderState(o);
        const finalized = isCancelled(o.id) || isRefunded(o.id) || !!terminalOf(o.id) || o.state === "active" || o.state === "refunded";
        const canCancel = !finalized && (o.state === "created" || o.state === "paid");
        // 设计稿:补建终态对所有非终态「始终」可达(含 failed —— 缺失终态 / DC 分配超时正是对账兜底场景)
        const canTerminal = !finalized;
        const idx = ORDER_FLOW.indexOf(o.state) >= 0 ? ORDER_FLOW.indexOf(o.state) : (o.state === "failed" ? 2 : -1);
        return (
          <Drawer title={o.id} sub={`${o.sku} · ${o.user}`} onClose={() => setSelOrder(null)}
            footer={finalized
              ? <Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => setSelOrder(null)}>关闭</Btn>
              : <>
                  {o.state === "failed" && <Btn onClick={() => { setToast("已重试 DC 分配 " + o.id); setSelOrder(null); }}>重试分配</Btn>}
                  {canCancel && <Btn onClick={() => setActionConfirm({ name: "取消订单 · " + o.id, op: "order-cancel", orderId: o.id, amplify: false, detail: `取消 ${o.id}(${stateLabel(eff)})· 终止后续分配/扣费,资产/额度回退联动 D4/C3 · 须操作确认 + 审计留痕` })}>取消订单</Btn>}
                  {canTerminal && <Btn onClick={() => setActionConfirm({ name: "补建订单终态 · " + o.id, op: "order-terminal", orderId: o.id, amplify: false, edit: { kind: "select", options: [...TERMINAL_STATES] }, detail: `为缺失终态的订单 ${o.id} 手动落定终态(支付失败/过期/退款/开通失败)· 状态机对账兜底 · 须操作确认 + 审计留痕` })}>补建终态</Btn>}
                  {o.state === "failed"
                    ? <Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => setActionConfirm({ name: "退款 · " + o.id, op: "order-refund", orderId: o.id, amplify: true, detail: `退款 ${o.id} · $${o.amt.toLocaleString()} · 资产/额度回退联动 D4 + C3 · 写 A2 审计 · 不可逆` })}><AutoGloss>退款(操作确认)</AutoGloss></Btn>
                    : <Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => setSelOrder(null)}>关闭</Btn>}
                </>}>
            <div className="tint" style={{ marginBottom: 14, textAlign: "center" }}><div className="muted tiny">订单金额</div><div style={{ fontSize: 30, fontWeight: 600, color: "var(--ink)" }} className="tnum">${o.amt.toLocaleString()}</div></div>
            <KV k="状态" v={<Badge tone={ostate[eff] ?? "neutral"}>{stateLabel(eff)}</Badge>} />
            <KV k="DC 分配" v={o.dc} />
            <KV k="用户" v={o.user} />
            <KV k="下单时间" v={o.age + " 前"} />
            {isCancelled(o.id) && <KV k="取消" v={<span style={{ color: "var(--ink-3)" }}>已取消 · 后续分配/扣费已终止,资产回退联动 D4/C3</span>} />}
            {isRefunded(o.id) && <KV k="退款" v={<span style={{ color: "var(--warning)" }}>已退款 · 资产回退已联动 D4/C3</span>} />}
            {!isCancelled(o.id) && !isRefunded(o.id) && terminalOf(o.id) && <KV k="补建终态" v={<span style={{ color: "var(--warning)" }}>{stateLabel(terminalOf(o.id)!)} · 人工补建,已写入 A2 审计</span>} />}
            {o.state === "failed" && <KV k="失败" v={<span style={{ color: "var(--danger)" }}>DC 分配超时 · 待处置</span>} />}
            <div style={{ fontSize: 12.5, fontWeight: 600, margin: "14px 0 8px", color: "var(--ink)" }}>状态轨迹</div>
            <div className="edrawer-trail">
              {ORDER_FLOW.map((s) => { const done = ORDER_FLOW.indexOf(s) <= idx; return <div key={s} className={`it ${done ? "done" : "grey"}`}><span className={`d ${done ? "done" : "grey"}`} /><span className="nm">{s}</span></div>; })}
              {o.state === "failed" && <div className="it red"><span className="d red" /><span className="nm">provisioning_failed · DC 分配超时</span></div>}
              {isCancelled(o.id) && <div className="it grey"><span className="d grey" /><span className="nm">cancelled · 人工取消</span></div>}
              {!isCancelled(o.id) && !isRefunded(o.id) && terminalOf(o.id) && <div className="it red"><span className="d red" /><span className="nm">{terminalOf(o.id)} · 人工补建终态</span></div>}
              {isRefunded(o.id) && <div className="it warn"><span className="d warn" /><span className="nm">refunded · 人工退款</span></div>}
            </div>
          </Drawer>
        );
      })()}

      {/* SKU 新增 / 编辑 抽屉 */}
      {skuDrawer && <Drawer title={editName ? "编辑 SKU" : "新增 SKU"} sub={<AutoGloss>{editName ? "改价 / 库存 / 日产基准 / 上架 Phase · 改后走操作确认" : "填写商品规格 · 提交后走操作确认"}</AutoGloss>} onClose={() => { setSkuDrawer(false); setEditName(null); }}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => { setSkuDrawer(false); setEditName(null); }}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!form.name || !form.price} onClick={() => { setActionConfirm({ name: (editName ? "编辑 SKU · " : "新增 SKU · ") + (form.name || "未命名"), op: "sku-save", isNew: !editName, hasImg: !!skuImg }); setSkuDrawer(false); }}>{editName ? "保存修改" : "提交确认"}</Btn></>}>
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
            <div className="grid g-2" style={{ gap: 12 }}>
              <SkuFld label="售价(USD)" type="number" value={form.price} onChange={(v) => setForm({ ...form, price: v })} placeholder="2639" />
              <SkuFld label="槽位 ID(slug)" value={form.id} onChange={(v) => setForm({ ...form, id: v })} placeholder="stellarbox-pro-v2" />
            </div>
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
          <div className="tint warn tiny"><AutoGloss>定价 / 日产基准 / 状态为高敏字段 · 新增 SKU 需操作确认后才上架</AutoGloss></div>
        </div>
      </Drawer>}

      {/* 任务新增 抽屉 */}
      {taskDrawer && <Drawer title="新增任务" sub={<AutoGloss>AI 算力任务类型 · 单价/门槛改后对新派单 server-canonical 生效</AutoGloss>} onClose={() => setTaskDrawer(false)}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => setTaskDrawer(false)}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!taskForm.n.trim() || !Number(taskForm.price)} onClick={submitTask}>提交新增</Btn></>}>
        <div className="col" style={{ gap: 12 }}>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">任务名称</span><input className="fld" value={taskForm.n} onChange={(e) => setTaskForm({ ...taskForm, n: e.target.value })} placeholder="如 LLM 推理 405B" /></label>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny"><AutoGloss>单价(USDT)</AutoGloss></span><input className="fld" type="number" value={taskForm.price} onChange={(e) => setTaskForm({ ...taskForm, price: e.target.value })} placeholder="1.20" /></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">计价单位</span><div className="row wrap" style={{ gap: 6 }}>{["/job", "/1k", "/min"].map((u) => <Chip key={u} tab sel={taskForm.unit === u} onClick={() => setTaskForm({ ...taskForm, unit: u })}>{u}</Chip>)}</div></label>
          </div>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">资格门槛(设备要求)</span><div className="row wrap" style={{ gap: 6 }}>{["S1+", "需 NexionBox Pro", "需 NexionRack"].map((r) => <Chip key={r} tab sel={taskForm.req === r} onClick={() => setTaskForm({ ...taskForm, req: r })}>{r}</Chip>)}</div></label>
          <SkuFld label="初始饱和度 %(预估)" type="number" value={taskForm.sat} onChange={(v) => setTaskForm({ ...taskForm, sat: v })} placeholder="50" hint="0-100" />
          <div className="tint warn tiny"><AutoGloss>单价 / 门槛为高敏字段 · server-canonical;改后对新派单生效 + 前端 /earn 任务池同步,需操作确认留痕。</AutoGloss></div>
        </div>
      </Drawer>}

      {/* 评价新增 / 编辑 抽屉 */}
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

      {/* 操作确认(唯一动作出口)*/}
      {mc && <OperationConfirmModal
        action={mc.name}
        detail={mc.detail ?? "server-canonical · 改后对下一笔结算 / 新派单生效,不回溯已计提"}
        amplifies={!!mc.amplify}
        edit={mc.edit}
        businessForm={mc.businessForm}
        onClose={() => setActionConfirm(null)}
        onConfirm={(reason, newValue) => {
          if (!mc) return;
          if (mc.op === "sku-save") {
            const ex = editName ? skus.find((x) => x.name === editName) : undefined;
            const sku = formToSku(form, ex);
            if (editName) { updateSku(editName, sku); logAudit({ actor: "总管理员", action: "编辑 SKU " + form.name, target: form.name, reason }); setToast("SKU 已更新:" + form.name); }
            else { addSkuStore(sku); logAudit({ actor: "总管理员", action: "新增 SKU " + form.name, target: form.name, reason }); setToast("SKU 已新增:" + form.name + " · 待上架"); }
            setEditName(null);
          } else if (mc.op === "sku-delete" && mc.target) {
            removeSkuStore(mc.target);
            logAudit({ actor: "总管理员", action: "删除 SKU " + mc.target, target: mc.target, reason });
            setToast("SKU 已删除:" + mc.target);
          } else if (mc.op === "sku-status" && mc.target) {
            setSkuStatus(mc.target, mc.status!); logAudit({ actor: "总管理员", action: (mc.status === "off" ? "下架 SKU " : "上架 SKU ") + mc.target, target: mc.target, after: mc.status, reason }); setToast("SKU " + mc.target + (mc.status === "off" ? " 已下架" : " 已上架"));
          } else if (mc.op === "task-down" && mc.taskId) {
            removeTaskStore(mc.taskId);
            logAudit({ actor: "总管理员", action: "下架任务 " + (mc.target ?? mc.taskId), target: mc.taskId, reason });
            setToast("任务已下架:" + (mc.target ?? mc.taskId));
          } else if (mc.op === "task-price" && mc.taskId) {
            const v = Number(newValue);
            if (Number.isFinite(v) && v > 0) { updateTaskStore(mc.taskId, { price: v }); logAudit({ actor: "总管理员", action: "调整任务单价 " + mc.taskId, target: mc.taskId, after: String(v), reason }); setToast(mc.name + ":已写入 $" + v + " · server-canonical"); }
            else setToast("请填写有效单价");
          } else if (mc.op === "param" && mc.paramKey) {
            const v = (newValue ?? "").trim();
            setParam(mc.paramKey, v, { action: mc.name, reason }); setToast(mc.name + ":已写入 " + v + " · server-canonical");
          } else if (mc.op === "param-fixed" && mc.paramKey && mc.fixedVal != null) {
            setParam(mc.paramKey, mc.fixedVal, { action: mc.name, reason }); setToast(mc.name + " · 已生效 · server-canonical");
          } else if (mc.op === "order-refund" && mc.orderId) {
            setParam(`E.order.${mc.orderId}.refunded`, "true", { action: "订单退款 " + mc.orderId, reason }); setToast("订单 " + mc.orderId + " 已退款 · 资产回退已联动 D4 冲正 + C3"); setSelOrder(null);
          } else if (mc.op === "order-cancel" && mc.orderId) {
            setParam(`E.order.${mc.orderId}.cancelled`, "true", { action: "取消订单 " + mc.orderId, reason }); setToast("订单 " + mc.orderId + " 已取消 · 后续分配/扣费已终止"); setSelOrder(null);
          } else if (mc.op === "order-terminal" && mc.orderId) {
            const v = (newValue ?? "").trim();
            if (v) { setParam(`E.order.${mc.orderId}.terminalState`, v, { action: "补建订单终态 " + mc.orderId, reason }); setToast("订单 " + mc.orderId + " 已补建终态:" + stateLabel(v)); }
            setSelOrder(null);
          } else if (mc.op === "ops-pause" && mc.dc) {
            const paused = mc.fixedVal === "true";
            setParam(`E.ops.${mc.dc}.paused`, paused ? "true" : "false", { action: (paused ? "批量 pause 数据中心 " : "恢复数据中心派单 ") + mc.dc, reason }); setToast(mc.dc + (paused ? " 已暂停派单" : " 已恢复派单"));
          } else { setToast("已确认生效"); }
          setActionConfirm(null);
        }} />}
      {toastNode}
    </div>
  );
}
