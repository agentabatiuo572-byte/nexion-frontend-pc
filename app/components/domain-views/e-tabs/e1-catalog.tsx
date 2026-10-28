import { operatorCopyText } from "@/lib/admin/operator-copy";
import { datacenterNameText } from "@/lib/admin/brand-copy";
import { operatorSkuTier } from "@/lib/admin/e-operator-display";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { CodeTag, Badge } from "../design-kit";
import type { E1GenerationRelease, E1Phase } from "@/lib/admin/e1-client";
import { refreshAdminMediaPreviewUrl } from "@/lib/admin/media-client";
import type { OpsSku } from "@/lib/admin/platform-types";
import type { EViewCtx } from "./types";
import { e1GateReadiness, effectiveReleaseMonth, gateRemaining, releaseMonthPresentation, resolveE1PhaseId, type E1GateReadiness } from "./data";
import { EStats } from "./stats";
import { catalogSkuBrandText, nexGridBrandText } from "@/lib/admin/brand-copy";

const PHASE_STATUS_LABELS: Record<string, string> = {
  active: "启用",
  archived: "已归档",
};
const phaseStatusLabel = (status?: string | null): string => PHASE_STATUS_LABELS[status || "active"] ?? "状态未知";

// 卡 badge 视觉类按 tier 着色(text 用 sku.badge);gate 开放 = unlock phase ≤ 当前 phase。
const badgeClass = (tier?: string): string =>
  tier === "Entry" ? "popular" : tier === "Pro" ? "new" : tier === "Flagship" ? "limited" : tier === "Share" ? "share" : "new";
const yld = (s: OpsSku): string =>
  s.tier === "Share"
    ? `${s.shareYieldMin != null && s.shareYieldMax != null && s.shareYieldMin > 0 && s.shareYieldMax >= s.shareYieldMin ? `参考年化 ${s.shareYieldMin}–${s.shareYieldMax}%` : "年化区间暂不可用"} · ${(s.dailyEarnNEX ?? 0).toLocaleString()} UVT/天`
    : `$${(s.dailyEarn ?? 0).toFixed(2)}/天 · ${(s.dailyEarnNEX ?? 0).toLocaleString()} UVT`;
const compactUsd = (value: number): string =>
  value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M`
    : value >= 1_000 ? `$${Math.round(value / 1_000).toLocaleString()}K`
      : `$${Math.round(value).toLocaleString()}`;
const isVideoMedia = (s: OpsSku): boolean => /\.(mp4|webm|mov)(?:$|\?)/i.test(s.imageObjectKey || s.imagePreviewUrl || "");

/**
 * 简报 #38:「强制提前开放」绕过平台月龄门,属于放大开放范围的动作,验收要求能显示批准人与审计编号。
 *
 * 此前这里写的是「后端未返回批准人与审计编号」—— 那是实情,但它是**仓库缺口**而不是终局:
 * 已记录的强制提前操作可由审计日志溯源,后端按门下发
 * forceUnlockApprovedBy / AuditId / ApprovedAt。
 *
 * 取不到时如实说「未记录」—— 不编造批准人,也不把「没记录」说成「后端不支持」。
 */
function forceUnlockProvenanceTitle(g: E1GenerationRelease): string {
  const base = "已强制提前开放，跳过了运营月数限制";
  const approver = (g.forceUnlockApprovedBy ?? "").trim();
  const auditId = (g.forceUnlockAuditId ?? "").trim();
  const approvedAt = (g.forceUnlockApprovedAt ?? "").trim();
  if (!approver && !auditId) return `${base}；找不到对应的操作记录`;
  const parts: string[] = [];
  if (approver) parts.push(`批准人 ${approver}`);
  if (auditId) parts.push(`操作记录编号 ${auditId}`);
  if (approvedAt) parts.push(`批准时间 ${approvedAt}`);
  return `${base};${parts.join(" · ")}`;
}

function RackIcon() {
  return (
    <svg width={44} height={44} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10v4M11 10v4M15 10v4M19 10v4" /><circle cx="6" cy="20" r="1" /><circle cx="18" cy="20" r="1" />
    </svg>
  );
}

function SkuMediaThumb({ sku }: { sku: OpsSku }) {
  // The SKU payload may contain an already-expired MinIO presign. Do not mount
  // that URL: every rendered asset obtains a new URL through the authenticated
  // media endpoint, then (and only then) issues the browser media request.
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshGeneration = useRef(0);

  const refreshPreview = useCallback(async () => {
    const assetId = sku.imageAssetId;
    if (!assetId) {
      setFailed(true);
      return;
    }
    const generation = ++refreshGeneration.current;
    setRefreshing(true);
    try {
      const asset = await refreshAdminMediaPreviewUrl(assetId);
      if (generation !== refreshGeneration.current) return;
      if (!asset.previewUrl) throw new Error("MEDIA_PREVIEW_URL_MISSING");
      setSrc(asset.previewUrl);
      setFailed(false);
    } catch {
      if (generation === refreshGeneration.current) {
        setSrc("");
        setFailed(true);
      }
    } finally {
      if (generation === refreshGeneration.current) setRefreshing(false);
    }
  }, [sku.imageAssetId]);

  useEffect(() => {
    setSrc("");
    setFailed(false);
    void refreshPreview();
    return () => { refreshGeneration.current += 1; };
  }, [sku.imageAssetId, refreshPreview]);

  if (!src || failed) {
    return (
      <div className="col" style={{ alignItems: "center", gap: 6 }}>
        <RackIcon />
        {sku.imageAssetId ? <button type="button" disabled={refreshing} onClick={() => void refreshPreview()}>{refreshing ? "加载中…" : "重新加载图片"}</button> : null}
      </div>
    );
  }

  return isVideoMedia(sku)
    ? <video key={src} src={src} controls muted playsInline preload="auto" onError={() => void refreshPreview()} />
    : <img key={src} src={src} alt="" loading="lazy" onError={() => void refreshPreview()} />;
}

export function E1Catalog({ ctx }: { ctx: EViewCtx }) {
  const { skus, tasks } = ctx;
  const canWrite = ctx.canWriteE1;
  const [skuQuery, setSkuQuery] = useState("");
  const [skuStatus, setSkuStatus] = useState("all");
  const [skuTier, setSkuTier] = useState("all");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedSku = params.get("sku")?.trim();
    if (requestedSku) {
      setSkuQuery(requestedSku);
      setSkuStatus("all");
      setSkuTier("all");
    }
  }, []);
  const filteredSkus = useMemo(() => {
    const keyword = skuQuery.trim().toLocaleLowerCase();
    return skus.filter((sku) => {
      const status = sku.status || "on";
      const searchable = [
        sku.id,
        sku.name,
        nexGridBrandText(sku.name),
        sku.tagline,
        sku.badge,
        sku.gpu,
        sku.vram,
        sku.datacenter,
      ].filter(Boolean).join(" ").toLocaleLowerCase();
      return (skuStatus === "all" || status === skuStatus)
        && (skuTier === "all" || sku.tier === skuTier)
        && (!keyword || searchable.includes(keyword));
    });
  }, [skuQuery, skuStatus, skuTier, skus]);
  const skuTiers = Array.from(new Set(skus.map((sku) => sku.tier).filter(Boolean))).sort();
  const taskNameById = new Map(tasks.map((task) => [task.id, task.n]));
  const unlockPoolName = (value?: string) => value ? nexGridBrandText(taskNameById.get(value) ?? value) : "—";
  const phaseOrder = ctx.e1Gates?.phaseOrder ?? [];
  const phases = ctx.e1Gates?.phases ?? [];
  const platformMonth = ctx.e1Gates?.platformMonth ?? 0;
  const phaseCur = ctx.e1Gates?.phaseCurrent || ctx.phaseCur;
  const releases = ctx.e1Gates?.releases ?? [];
  const activePhaseIdx = phaseOrder.indexOf(phaseCur);
  const hasPhaseConfig = phaseOrder.length > 0 && phases.length > 0 && activePhaseIdx >= 0;
  const curIdx = hasPhaseConfig ? activePhaseIdx : -1;
  const phaseIdx = (p: string): number => phaseOrder.indexOf(resolveE1PhaseId(phases, p));
  const phaseLabel = (phaseId: string): string => {
    if (!phaseId) return "未配置";
    const phase = phases.find((item) => item.p === resolveE1PhaseId(phases, phaseId));
    return nexGridBrandText(phase?.label || phaseId);
  };
  const phaseOptions = phaseOrder;
  const releaseIds = new Set(releases.map((g) => g.id));
  const skuId = (s: OpsSku) => s.id;
  const gateCandidates = skus.filter((s) => !releaseIds.has(skuId(s))); // 任意 SKU 均可挂上架节奏门
  const gateSkuOptions = gateCandidates.map(skuId);

  // 上架节奏门判定走 data.ts 的单一纯函数源(与 E1 发布时点表 / 顶部 Pro v2 标共用),
  // 阶段绑定冲突(门引用的阶段 ≠ 商品 unlockPhase)一律视为未开放。
  const gateReadiness = (g: E1GenerationRelease): E1GateReadiness =>
    e1GateReadiness({
      release: g,
      phaseOrder,
      phases,
      sku: skus.find((item) => skuId(item) === g.id),
      currentPhase: phaseCur,
      platformMonth,
    });
  const gateBlockerLabel = (state: E1GateReadiness): string =>
    nexGridBrandText(state.blockers.slice(0, 2).join(" / ") || "待发布");
  const gateCountdownLabel = (state: E1GateReadiness): string => {
    if (state.phaseConflict) return "阶段冲突";
    if (state.unlocked) return "已发布";
    if (!state.eligibilityReady) return "待补设备资格";
    if (!state.phaseReached) return state.gatePhaseIdx >= 0 ? "待阶段" : "阶段未匹配";
    if (!state.monthReached && !state.forceMonthOpen) {
      const remain = state.effectiveMonth - platformMonth;
      return remain === 1 ? "下个月" : remain > 1 ? `${remain} 个月后` : `待运营满 ${state.effectiveMonth} 个月`;
    }
    return "待发布";
  };
  const genUnlocked = (g: E1GenerationRelease): boolean => gateReadiness(g).unlocked;
  const proV2 = releases.find((g) => g.id === "stellarbox-pro-v2");
  const proV2Label = proV2 ? `Pro v2 ${genUnlocked(proV2) ? "已开放" : `未开放 · ${gateBlockerLabel(gateReadiness(proV2))}`}` : "";

  // 真 store 派生 stat(改 SKU 即刷新)。发布门未通过的 SKU(测试标识 / 无有效收益)
  // 不会进入 App 用户目录,因此不得计入「在售 SKU」与「目录累计售出额」这两项商品统计。
  // publishBlocked 为 undefined = 服务端未声明该结论(旧后端构建):既不能算作已过门
  // (会把未过门的行计入在售),也不能算作被挡(会谎报数量)。单独计数并如实说明。
  const publishableSkus = skus.filter((s) => s.publishBlocked !== true && s.publishBlocked !== undefined);
  const publishBlocked = skus.filter((s) => s.publishBlocked === true).length;
  const publishGateUndeclared = skus.filter((s) => s.publishBlocked === undefined).length;
  const onSale = publishableSkus.filter((s) => (s.status || "on") === "on").length;
  const pending = publishableSkus.filter((s) => s.status === "pending").length;
  const gated = releases.filter((gate) => !genUnlocked(gate)).length;
  const gateManaged = releases.length;
  const enabledPhaseCount = phases.filter((ph) => (ph.status || "active") === "active").length;

  // 目录累计口径:来自 E1 商品目录的 nx_product.sold_count × 目录现价,是**商品目录计数器**,
  // 不是订单主数据聚合值。E4 订单进度读的是 nx_order 主数据,两者可能不一致,
  // 所以这里既不改名成「GMV」也不声称可与订单对账 —— 对账口径以 E4 为准。
  // 只累计通过发布门的行,与 App 用户目录看到的口径一致。
  const soldUnits = publishableSkus.reduce((sum, s) => sum + (s.sold ?? 0), 0);
  const catalogSoldValue = publishableSkus.reduce((sum, s) => sum + (s.sold ?? 0) * (s.price ?? 0), 0);

  // 上架门连接线渐变:success 到当前节点、brand 当前段、surface-3 锁定段(随 phaseCur 动态)
  const phaseStep = phases.length > 1 ? 100 / (phases.length - 1) : 100;
  const doneEnd = Math.max(0, curIdx * phaseStep - 2);
  const curEnd = Math.min(100, Math.max(0, curIdx * phaseStep + phaseStep / 2));
  const phaseLine = `linear-gradient(90deg, var(--success) 0%, var(--success) ${doneEnd}%, var(--brand) ${doneEnd}%, var(--brand) ${curEnd}%, var(--surface-3) ${curEnd}%)`;

  const genShift = (g: E1GenerationRelease, offset: number, delta: number) =>
    ctx.openActionConfirm({
      name: `开放时间${delta < 0 ? "提前" : "推迟"} ${Math.abs(delta)} 个月 · ${catalogSkuBrandText(g.id, g.name)}`,
      op: "param", paramKey: `E.gen.${g.id}.phaseOffset`,
      edit: { kind: "number", current: String(offset), unit: "个月" },
      detail: `当前计划第 ${g.releaseMonth} 个月开放${offset ? `（已调整 ${offset} 个月）` : ""}，修改后开放时间随之改变。`,
      amplify: false,
    });
  const genForceUnlock = (g: E1GenerationRelease) => {
    const state = gateReadiness(g);
    if (!state.declaredPhase) { ctx.toast(`不能开放：${nexGridBrandText(g.name)} 没有设置开放阶段，请先检查商品设置`); return; }
    if (state.phaseConflict) { ctx.toast(`不能开放：${nexGridBrandText(g.name)} 的开放阶段是${phaseLabel(state.declaredPhase)}，和上架条件里的${phaseLabel(g.phase)}不一致，请先改成一致`); return; }
    if (!state.eligibilityReady) { ctx.toast(`不能开放：${nexGridBrandText(g.name)} 还没补设备资格`); return; }
    if (!state.phaseReached) { ctx.toast(`不能开放：${nexGridBrandText(g.name)} 要到 ${phaseLabel(g.phase)} 才能开放`); return; }
    ctx.openActionConfirm({
      name: `强制提前开放 · ${catalogSkuBrandText(g.id, g.name)}`,
      op: "generation-gate-force",
      generationGateId: g.id,
      generationGate: { forceUnlock: true },
      amplify: true,
      detail: `强制提前开放：只跳过运营月数限制。已到达 ${phaseLabel(g.phase)} 阶段，设备资格已补齐。`,
    });
  };
  const genForceLock = (g: E1GenerationRelease) =>
    ctx.openActionConfirm({
      name: `撤销强制提前开放 · ${catalogSkuBrandText(g.id, g.name)}`,
      op: "generation-gate-force",
      generationGateId: g.id,
      generationGate: { forceUnlock: false },
      amplify: false,
      detail: `撤销后重新按运营月数判断是否开放。如果阶段、设备资格和月数本来就满足，商品仍保持开放。`,
    });
  const openPhaseEditor = (ph?: E1Phase) => {
    const nextSort = phases.reduce((max, item) => Math.max(max, item.sortOrder ?? 0), 0) + 10;
    ctx.openActionConfirm({
      name: ph ? `编辑阶段 · ${phaseLabel(ph.p)}` : "新增阶段",
      op: "phase-save",
      phaseId: ph?.p,
      businessForm: {
        kind: "phase-config",
        mode: ph ? "edit" : "create",
        label: ph?.label ?? "",
        meta: ph?.meta ?? "",
        skus: ph?.skus ?? "",
        sortOrder: ph?.sortOrder ?? nextSort,
        status: ph?.status ?? "active",
      },
      detail: ph
        ? "修改阶段名称、门槛说明、商品标签和排序。"
        : "新增阶段。商品的开放阶段和上架条件都从这里选。",
      amplify: false,
    });
  };
  const archivePhase = (ph: E1Phase) =>
    ctx.openActionConfirm({
      name: `删除阶段 · ${phaseLabel(ph.p)}`,
      op: "phase-archive",
      phaseId: ph.p,
      businessForm: {
        kind: "destructive-reason",
        target: phaseLabel(ph.p),
        impact: "如果当前阶段、商品或上架条件还在用这个阶段，将无法删除。",
      },
      detail: "删除前请先把相关商品和上架条件改到其他阶段。",
      amplify: false,
    });
  // FEAT-DEV02b 置换侧抢先购(上架参数配置项,默认关):多字段弹窗,双 select 可枚举不手输。
  const earlyEnabled = ctx.pE("E.release.earlyAccess.enabled");
  const earlyLead = ctx.pE("E.release.earlyAccess.leadDays");
  const adjEarlyAccess = () =>
    ctx.openActionConfirm({
      name: "调整以旧换新抢先购", op: "early-access", amplify: false,
      businessForm: {
        kind: "multi-field", title: "以旧换新抢先购",
        hint: "开启后，用旧设备换新的用户可以在新机正式上架前提前购买；普通购买不受影响。默认关闭。",
        fields: [
          { key: "enabled", label: "开关", current: earlyEnabled, inputKind: "select", options: ["关", "开"] },
          { key: "leadDays", label: "提前天数", current: earlyLead, inputKind: "select", options: ["7", "14", "30", "60", "90"] },
        ],
      },
      paramKeys: [
        { key: "enabled", paramKey: "E.release.earlyAccess.enabled" },
        { key: "leadDays", paramKey: "E.release.earlyAccess.leadDays" },
      ],
      detail: "开启后，有旧设备可换新的用户能在新机正式上架前 N 天提前换购；关闭后，换购也要等正式上架。",
    });

  const openGateEditor = (g?: E1GenerationRelease) => {
    if (phaseOptions.length === 0) {
      ctx.toast("请先配置阶段");
      return;
    }
    if (!g && gateSkuOptions.length === 0) {
      ctx.toast("所有商品都已设置上架条件");
      return;
    }
    const gatePhaseOptions = g?.phase && !phaseOptions.includes(g.phase) ? [g.phase, ...phaseOptions] : phaseOptions;
    const gatePhaseLabels = Object.fromEntries(gatePhaseOptions.map((phaseId) => [phaseId, phaseLabel(phaseId)]));
    ctx.openActionConfirm({
      name: g ? `编辑上架条件 · ${catalogSkuBrandText(g.id, g.name)}` : "新增上架条件",
      op: "generation-gate-save",
      generationGateId: g?.id,
      businessForm: {
        kind: "generation-gate",
        mode: g ? "edit" : "create",
        skuOptions: g ? [g.id] : gateSkuOptions,
        phaseOptions: gatePhaseOptions,
        phaseLabels: gatePhaseLabels,
        skuId: g?.id ?? gateSkuOptions[0],
        name: g?.name ?? "",
        releaseMonth: g?.releaseMonth ?? Math.max(1, platformMonth || 1),
        phase: (g?.phase ?? phaseCur) || gatePhaseOptions[0],
        eligibility: g?.eligibility ?? false,
        phaseOffset: g?.phaseOffset ?? 0,
        forceUnlock: g?.forceUnlock ?? false,
      },
      detail: g
        ? "修改开放月份、阶段、设备资格或强制提前开放"
        : "为商品设置分批上架规则",
      amplify: !!g?.forceUnlock,
    });
  };
  const archiveGate = (g: E1GenerationRelease) =>
    ctx.openActionConfirm({
      name: `移除上架条件 · ${catalogSkuBrandText(g.id, g.name)}`,
      op: "generation-gate-archive",
      generationGateId: g.id,
      businessForm: { kind: "destructive-reason", target: catalogSkuBrandText(g.id, g.name), impact: "这个商品会从上架时间表中移除，不再受这条规则限制。" },
      detail: "移除这条上架规则（保留记录，可恢复）",
      amplify: false,
    });

  const adjustBundleDiscount = () => {
    const discount = ctx.e1BundleDiscount;
    if (!discount) {
      ctx.toast("组合优惠设置加载失败，请刷新后重试");
      return;
    }
    ctx.openActionConfirm({
      name: "调整 App 组合购阶梯折扣",
      op: "bundle-discount",
      businessForm: {
        kind: "multi-field",
        title: "组合购折扣",
        hint: "会直接改变 App 组合购的价格。",
        requireAnyChange: true,
        fields: [
          { key: "twoItemsPct", label: "2 件折扣（%）", current: String(discount.twoItemsPct), inputKind: "number", min: 0.01, max: 50, step: 0.01, required: true },
          { key: "threeItemsPct", label: "3 件折扣（%）", current: String(discount.threeItemsPct), inputKind: "number", min: 0.01, max: 50, step: 0.01, required: true },
          { key: "fourPlusItemsPct", label: "4 件及以上折扣（%）", current: String(discount.fourPlusItemsPct), inputKind: "number", min: 0.01, max: 50, step: 0.01, required: true },
        ],
      },
      detail: `保存后新订单立即按新折扣，已有订单不变。`,
      amplify: true,
    });
  };

  return (
    <>
      <EStats items={[
        { k: "目录累计售出额", v: compactUsd(catalogSoldValue), sub: `共 ${soldUnits.toLocaleString()} 台（对账请以「订单进度」为准）` },
        { k: "在售商品", v: onSale, sub: `${pending} 个待确认${publishBlocked > 0 ? ` · ${publishBlocked} 个未满足上架条件` : ""}${ctx.e1InvalidSkus.length > 0 ? ` · ${ctx.e1InvalidSkus.length} 个数据有误未显示` : ""}`, tone: "ok" },
        ...(publishGateUndeclared > 0 ? [{ k: "上架状态未知", v: publishGateUndeclared, sub: "无法确认这些商品是否在 App 上架", tone: "warn" as const }] : []),
        { k: "分批上架的商品", v: gateManaged, sub: "Pro v2 · Rack P2", tone: "cyan" },
        { k: "按阶段开放的商品", v: gated, sub: "到对应阶段才开放", tone: "warn" },
      ]} />
      {ctx.e1Loading && <div className="tint tiny" style={{ marginBottom: 12 }}>正在加载…</div>}
      {ctx.e1Error && <div className="tint warn tiny" role="alert" style={{ marginBottom: 12 }}>商品数据加载失败（{ctx.e1Error}） <button type="button" onClick={() => void ctx.refreshE1()}>重新加载</button></div>}

      {/* 被逐行判定拒绝的 SKU:具名列出是哪个 SKU 的哪个字段不合规。
          此前这类行会让整份目录读取失败并清空页面,运营看到的是「0 SKU」而非真实原因 ——
          同一份 nx_product 在 App 侧照常展示,后台却整目录为空。 */}
      {ctx.e1InvalidSkus.length > 0 && (
        <div className="tint warn tiny" role="alert" style={{ marginBottom: 12 }}>
          有 {ctx.e1InvalidSkus.length} 个商品的数据有误，暂不显示（其他商品正常）：
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {ctx.e1InvalidSkus.map((row) => (
              <li key={row.skuId}>{row.skuId} · {nexGridBrandText(row.name)} — 有误的字段：{row.invalidFields.join("、")}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="tint" style={{ marginBottom: 12, padding: 12 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div className="col" style={{ gap: 4 }}>
            <strong>App 组合购阶梯折扣</strong>
            {ctx.e1BundleDiscount ? (
              <span className="tiny muted">
                2 件 {ctx.e1BundleDiscount.twoItemsPct}% · 3 件 {ctx.e1BundleDiscount.threeItemsPct}% · 4 件及以上 {ctx.e1BundleDiscount.fourPlusItemsPct}% · v{ctx.e1BundleDiscount.version}
              </span>
            ) : <span className="tiny warn">设置加载失败，App 暂不提供组合价</span>}
          </div>
          {canWrite && ctx.e1BundleDiscount
            ? <button type="button" onClick={adjustBundleDiscount}>调整阶梯折扣</button>
            : null}
        </div>
      </div>

      {/* 1. 上架节奏门 timeline */}
      {hasPhaseConfig ? (
        <div className="phase-bar">
          <div className="lbl">
            <span className="h">分阶段开放</span>
            <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>到了对应阶段自动开放</span>
            <span className="now"><span className="d" />当前 {phaseLabel(phaseCur)} · {proV2Label}</span>
            <span className="now">以旧换新抢先购：{earlyEnabled === "开" ? `开 · 提前 ${earlyLead} 天` : "关"}{canWrite ? <button style={{ marginLeft: 8 }} onClick={adjEarlyAccess}>调整</button> : null}</span>
          </div>
          <div className="phase-track" style={{ ["--phase-line" as string]: phaseLine } as CSSProperties}>
            {phases.map((ph, i) => {
              const st = i < curIdx ? "done" : i === curIdx ? "cur" : "lock";
              return (
                <div key={ph.p} className={`phase ${st}`}>
                  <div className="dot">{i + 1}</div>
                  <div className="nm">{phaseLabel(ph.p)}</div>
                  <div className="skus">{operatorCopyText([ph.meta, ph.skus].filter(Boolean).join(" · ") || "未配置说明")}</div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="phase-bar">
          <div className="lbl">
            <span className="h">分阶段开放</span>
            <span style={{ fontSize: 11.5, color: "var(--danger)" }}>阶段设置缺失，或当前阶段对不上</span>
            <span className="now"><span className="d" />待设置</span>
          </div>
          <div className="tint warn tiny" style={{ marginTop: 12 }}>
            没有获取到阶段设置，请检查下方「阶段设置」和「运营阶段设置」。
          </div>
        </div>
      )}

      {/* 2. 阶段配置 */}
      <div className="genrel">
        <div className="genrel-h">
          <span className="ttl">阶段设置</span>
          <span className="sub">· 商品的开放阶段和上架条件都从这里选</span>
          <span className="r"><CodeTag tone="electric">阶段规则</CodeTag><span>{enabledPhaseCount} 条启用</span></span>
          {canWrite ? <button className="f-cta" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => openPhaseEditor()}>+ 新增阶段</button> : null}
        </div>
        <div className="phasecfg-table">
          <div className="hd">
            <div className="c">阶段名称</div><div className="c">当前阶段</div><div className="c optional">门槛说明</div><div className="c optional">商品标签</div>
            <div className="c optional">排序</div><div className="c optional">状态</div><div className="c">操作</div>
          </div>
          {phases.length === 0 && (
            <div className="rw">
              <div className="c" style={{ gridColumn: "1 / -1", color: "var(--ink-3)" }}>暂无阶段配置</div>
            </div>
          )}
          {phases.map((ph) => {
            const isCurrentPhase = ph.p === phaseCur;
            return (
              <div className="rw" key={ph.p}>
                <div className="c phase-name ellipsis">{phaseLabel(ph.p)}</div>
                <div className="c">{isCurrentPhase ? <span className="phaseNow"><span className="dot" />当前</span> : <span className="muted">—</span>}</div>
                <div className="c optional ellipsis">{nexGridBrandText(ph.meta || "—")}</div>
                <div className="c optional ellipsis">{operatorCopyText(ph.skus || "—")}</div>
                <div className="c optional mono">{ph.sortOrder ?? 0}</div>
                <div className="c optional"><Badge tone={ph.status === "active" ? "ok" : "neutral"}>{phaseStatusLabel(ph.status)}</Badge></div>
                <div className="c acts">
                  {isCurrentPhase ? <button disabled>当前阶段</button> : <button disabled title="当前阶段在「运营阶段设置」里推进">—</button>}
                  {canWrite ? <button onClick={() => openPhaseEditor(ph)}>编辑</button> : null}
                  {canWrite ? <button className="danger" disabled={isCurrentPhase} title={isCurrentPhase ? "当前阶段不能删除" : undefined} onClick={() => archivePhase(ph)}>删除</button> : null}
                </div>
              </div>
            );
          })}
        </div>
        <div className="genrel-foot">
          <span><b>阶段名称</b> 后台和 App 页面上显示的名字。</span>
          <span className="sep">·</span>
          <span><b>当前阶段</b> 跟随「运营阶段设置」，这里不能改。</span>
          <span className="sep">·</span>
          <span><b>删除限制</b> 当前阶段、商品或上架条件还在用的阶段不能删除。</span>
        </div>
      </div>

      {/* 3. 分批上架发布时点表 */}
      <div className="genrel">
        <div className="genrel-h">
          <span className="ttl">分批上架时间表</span>
          <span className="sub">· 控制商品什么时候开放购买</span>
          <span className="r"><CodeTag tone="electric">发布计划</CodeTag><span>平台第 {platformMonth || "—"} 个月 · {phaseCur ? phaseLabel(phaseCur) : "阶段未设置"}</span></span>
          {canWrite ? <button className="f-cta" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => openGateEditor()}>+ 新增上架条件</button> : null}
        </div>
        <div className="genrel-scroll">
          <div className="genrel-table">
          <div className="hd">
            <div className="c">商品</div><div className="c">计划开放</div><div className="c">当前状态</div><div className="c">阶段</div>
            <div className="c">距开放</div><div className="c">设备资格</div><div className="c">操作</div>
          </div>
          {releases.length === 0 && (
            <div className="rw">
              <div className="c" style={{ gridColumn: "1 / -1", color: "var(--ink-3)" }}>暂无上架条件</div>
            </div>
          )}
          {releases.map((g) => {
            const offset = g.phaseOffset ?? 0;
            const gateState = gateReadiness(g);
            const unlocked = gateState.unlocked; // 与顶部 Pro v2 标同源,消除口径冲突
            const cdCls = unlocked ? "ok" : (!gateState.eligibilityReady || !gateState.phaseReached || gateState.effectiveMonth - platformMonth <= 1) ? "warn" : "";
            const cdTxt = gateCountdownLabel(gateState);
            const releasePresentation = releaseMonthPresentation(g.releaseMonth, offset);
            const forceHint = !gateState.declaredPhase
              ? "商品没有设置开放阶段，不能提前开放"
              : gateState.phaseConflict
                ? "商品的开放阶段和上架条件不一致，不能提前开放"
                : !gateState.eligibilityReady
                  ? "先补设备资格才能提前开放"
                  : !gateState.phaseReached
                    ? `到 ${phaseLabel(g.phase)} 阶段后才能提前开放`
                    : "强制提前开放，只跳过运营月数限制";
            return (
              <div className="rw" key={g.id}>
                <div className="c sku">{nexGridBrandText(g.name)}<span className="id">{g.id}</span>{g.forceUnlock && <span className="force-audit">批准人 {g.forceUnlockApprovedBy || "未记录"} · 操作记录 {g.forceUnlockAuditId || "未记录"}</span>}</div>
                <div className="c mono release-plan">
                  <span className="release-effective">{releasePresentation.effectiveLabel}</span>
                  <span className="release-adjustment">{releasePresentation.adjustmentLabel}</span>
                </div>
                <div className="c"><span className={`st ${unlocked ? "active" : "coming"}`} title={unlocked ? (g.forceUnlock ? "阶段和设备资格已满足，月数限制已强制跳过" : "阶段、月数和设备资格都已满足") : gateBlockerLabel(gateState)}>{unlocked ? "已开放" : gateState.phaseConflict ? "阶段冲突" : "待发布"}</span>{g.forceUnlock && <span className="st coming" style={{ marginLeft: 6 }} title={forceUnlockProvenanceTitle(g)}>强制提前</span>}</div>
                <div className="c">
                  <span className="phaseChip">{phaseLabel(g.phase)}</span>
                  {gateState.phaseConflict && (
                    <span className="st coming" style={{ marginLeft: 6 }} title={`商品的开放阶段是${phaseLabel(gateState.declaredPhase)}，上架条件却是${phaseLabel(g.phase)}，请改成一致`}>
                      应属 {phaseLabel(gateState.declaredPhase)}
                    </span>
                  )}
                </div>
                <div className="c"><span className={`countdown ${cdCls}`}>{cdTxt}</span></div>
                <div className="c"><span className={`elg ${g.eligibility ? "ok" : "miss"}`}><span className="dot" />{g.eligibility ? "已配置" : "未补录"}</span></div>
                <div className="c acts">
                  {canWrite ? <button onClick={() => openGateEditor(g)}>编辑</button> : null}
                  {canWrite && (unlocked ? (
                    <>
                      <button onClick={() => genShift(g, offset, 1)}>推迟 1 个月</button>
                      {g.forceUnlock ? <button className="warn" onClick={() => genForceLock(g)}>撤销强制</button> : <button disabled title="这个商品是正常开放的，没有强制开放可撤销">自然开放</button>}
                    </>
                  ) : (
                    <>
                      <button onClick={() => genShift(g, offset, -1)}>提前 1 个月</button>
                      <button onClick={() => genShift(g, offset, 1)}>延迟 1 个月</button>
                      {g.forceUnlock
                        ? <button className="warn" onClick={() => genForceLock(g)}>撤销强制</button>
                        : <button className="brand" title={forceHint} onClick={() => genForceUnlock(g)}>强制提前开放</button>}
                    </>
                  ))}
                  {canWrite ? <button className="danger" onClick={() => archiveGate(g)}>移除</button> : null}
                </div>
              </div>
            );
          })}
          </div>
        </div>
        <div className="genrel-foot">
          <span><b>开放规则</b> · 设了上架条件的商品，要同时满足：到达对应阶段、平台运营满对应月数、设备资格已设置</span>
          <span className="sep">·</span>
          <span><b>强制提前开放</b> 只跳过运营月数限制，阶段和设备资格仍要满足</span>
        </div>
      </div>

      {/* 3. SKU 目录筛选 + 卡片矩阵 */}
      <div className="tint" style={{ marginBottom: 12, padding: 12 }}>
        <div className="row" style={{ alignItems: "end", flexWrap: "wrap", gap: 10 }}>
          <label className="fld" style={{ flex: "1 1 260px", margin: 0 }}>
            <span>搜索商品</span>
            <input
              aria-label="搜索商品"
              value={skuQuery}
              placeholder="名称 / 商品编号 / GPU / 数据中心"
              onChange={(event) => setSkuQuery(event.target.value)}
            />
          </label>
          <label className="fld" style={{ flex: "0 1 170px", margin: 0 }}>
            <span>状态</span>
            <select aria-label="商品状态筛选" value={skuStatus} onChange={(event) => setSkuStatus(event.target.value)}>
              <option value="all">全部状态</option>
              <option value="on">在售</option>
              <option value="off">已下架</option>
              <option value="pending">待确认</option>
            </select>
          </label>
          <label className="fld" style={{ flex: "0 1 170px", margin: 0 }}>
            <span>档位</span>
            <select aria-label="商品档位筛选" value={skuTier} onChange={(event) => setSkuTier(event.target.value)}>
              <option value="all">全部档位</option>
              {skuTiers.map((tier) => <option key={tier} value={tier}>{operatorSkuTier(tier)}</option>)}
            </select>
          </label>
          <div className="tiny" aria-live="polite" style={{ marginBottom: 8 }}>
            显示 {filteredSkus.length} / {skus.length} 个商品
          </div>
          {(skuQuery || skuStatus !== "all" || skuTier !== "all") ? (
            <button type="button" style={{ marginBottom: 2 }} onClick={() => {
              setSkuQuery("");
              setSkuStatus("all");
              setSkuTier("all");
            }}>清除筛选</button>
          ) : null}
        </div>
      </div>
      <div className="sku-grid">
        {filteredSkus.length === 0 ? (
          <div className="tint tiny" role="status" style={{ gridColumn: "1 / -1", padding: 20, textAlign: "center" }}>
            没有符合条件的商品，换个关键词或清除筛选试试。
          </div>
        ) : null}
        {filteredSkus.map((s) => {
          const st = s.status || "on";
          const hasUnlockPhase = !!s.unlock?.trim();
          const releaseGate = releases.find((gate) => gate.id === skuId(s));
          const releaseState = releaseGate ? gateReadiness(releaseGate) : null;
          const open = releaseState ? releaseState.unlocked : (!hasUnlockPhase || (phaseIdx(s.unlock) >= 0 && phaseIdx(s.unlock) <= curIdx));
          const listingBlocked = st !== "on" && !open;
          const listingBlocker = releaseState
            ? gateBlockerLabel(releaseState)
            : phaseIdx(s.unlock) >= 0 ? `待${phaseLabel(s.unlock)}` : "开放阶段对不上";
          const publishBlockLabel = s.publishBlockReason === "PRODUCT_TEST_IDENTIFIER"
            ? "测试商品" : "收益未设置";
          const releaseLabel = releaseGate
            ? `${phaseLabel(releaseGate.phase)} · ${open ? "已开放" : gateBlockerLabel(releaseState!)}`
            : `${hasUnlockPhase ? phaseLabel(s.unlock) : "无需阶段"} · ${open ? "已开放" : "条件限制"}`;
          const isShare = s.tier === "Share";
          const unlimitedInventory = s.inventoryMode === "UNLIMITED";
          return (
            <div key={s.id} className={`sku-card${st === "off" ? " off" : ""}`}>
              <div className="img">
                {s.badge ? <span className={`badge ${badgeClass(s.tier)}`}>{nexGridBrandText(s.badge)}</span> : null}
                <div className="ph">
                  <SkuMediaThumb sku={s} />
                </div>
              </div>
              <div className="body">
                <div className="top">
                  <div className="l">
                    <div className="nm">{catalogSkuBrandText(s.id, s.name)}</div>
                    {s.tagline ? <div className="tagline">{nexGridBrandText(s.tagline)}</div> : null}
                  </div>
                  <div className="r">
                    <div className="px">${s.price.toLocaleString()}</div>
                    <div className="yld">{yld(s)}</div>
                  </div>
                </div>
                <div className="spec">
                  <div className="it"><span className="k">GPU</span><span className="v">{s.gpu || "—"}</span></div>
                  <div className="it"><span className="k">显存</span><span className="v">{s.vram || "—"}</span></div>
                  <div className="it"><span className="k">数据中心</span><span className="v">{datacenterNameText(s.datacenter || "—")}</span></div>
                  <div className="it"><span className="k">算力池</span><span className="v">{unlockPoolName(s.aiUnlocks)}</span></div>
                </div>
                <div className="meta">
                  {s.sold != null && <span className="sold">{s.sold.toLocaleString()} 售</span>}
                  <span className={`gate ${open ? "open" : "gated"}`}>{releaseLabel}</span>
                  {s.purchaseGate && (() => {
                    const g = s.purchaseGate;
                    const parts: string[] = [];
                    if (g.rankMin != null) parts.push(`V≥${g.rankMin}`);
                    if (g.activeDirectMin != null) parts.push(`${g.activeDirectMin}直接邀请`);
                    if (g.teamComputePointsMin != null) parts.push(`团队算力点 ${g.teamComputePointsMin.toLocaleString("en-US")}`);
                    const cond = parts.join(g.mode === "either" ? "/" : "+");
                    const remaining = gateRemaining(g);
                    const txt = `购买条件${cond ? " " + cond : ""}${remaining != null ? ` · 剩 ${remaining}` : ""}`;
                    return <Badge tone={g.enforce ? "warn" : "neutral"}>{txt}</Badge>;
                  })()}
                  <span className="stk">库存 {unlimitedInventory ? "∞（非实物）" : (s.stock ?? 0)}</span>
                  <Badge tone={s.trialEligible ? "ok" : "neutral"}>{s.trialEligible ? "允许试用" : "不可试用"}</Badge>
                  {s.publishBlocked === true ? <Badge tone="warn">{`未满足上架条件 · ${publishBlockLabel}`}</Badge> : null}
                  {s.publishBlocked === undefined ? <Badge tone="neutral">上架状态未知</Badge> : null}
                </div>
                <div className="acts">
                  {canWrite ? <button className="primary" aria-label={`改价 / 编辑 ${catalogSkuBrandText(s.id, s.name)}`} onClick={() => ctx.openSku(s.id)}>改价 / 编辑</button> : null}
                  {canWrite && st === "on" && (unlimitedInventory || Number(s.stock) > 0) && !open && !releaseGate && hasPhaseConfig ? <button className="brand" aria-label={`按当前阶段上架 ${catalogSkuBrandText(s.id, s.name)}`} onClick={() => ctx.openSku(s.id, phaseCur)}>按当前阶段上架</button> : null}
                  {canWrite ? <button disabled={listingBlocked || s.publishBlocked === true} title={s.publishBlocked === true ? `未满足上架条件 · ${publishBlockLabel} · App 上看不到` : s.publishBlocked === undefined ? "服务端未返回上架条件结论，上架是否生效未确认" : listingBlocked ? listingBlocker : undefined} aria-label={`${st === "on" ? "下架" : "上架"} ${catalogSkuBrandText(s.id, s.name)}`} onClick={() => ctx.openActionConfirm({ name: st === "on" ? `下架商品· ${catalogSkuBrandText(s.id, s.name)}` : `上架商品· ${catalogSkuBrandText(s.id, s.name)}`, op: "sku-status", target: s.id, status: st === "on" ? "off" : "on", detail: st === "on" ? "下架后从商城隐藏,不影响已售设备结算" : "上架后对用户可见", amplify: false })}>{st === "on" ? "下架" : "上架"}</button> : null}
                  {canWrite ? <button className="danger" aria-label={`删除 ${catalogSkuBrandText(s.id, s.name)}`} onClick={() => ctx.delSku(s.id, s.name ?? s.id)}>删除</button> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="f-foot">这里的商品卡片就是 App 商城里的商品，上下架、改价和调库存都会<b>立即在 App 生效</b>。</p>
    </>
  );
}
