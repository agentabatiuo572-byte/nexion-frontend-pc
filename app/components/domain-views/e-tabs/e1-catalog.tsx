"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Boxes, FileText, ImageIcon, PackageCheck, PackagePlus, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { BlockState, Button, Conclusion, ConfigList, ConfigRow, Decision, Drawer, Explain, Facts, Fact, FilterBar, FilterField, Fold, Input, JudgmentPoints, LevelStrip, MoreMenu, Notice, Panel, RatioBar, ScaleBar, Segments, Select, StageLine, Stat, StatBand, StatusTag, Table, Th, Tr, Td } from "@/app/components/rd";
import { nexGridBrandText, datacenterNameText } from "@/lib/admin/brand-copy";
import { operatorSkuTier } from "@/lib/admin/e-operator-display";
import { supportsDeviceMonthlyTarget, SKU_MODEL_UNRECOGNIZED_REASON } from "@/lib/admin/device-monthly-target";
import { refreshAdminMediaPreviewUrl } from "@/lib/admin/media-client";
import type { E1GenerationRelease, E1Phase } from "@/lib/admin/e1-client";
import type { OpsSku } from "@/lib/admin/platform-types";
import type { EViewCtx } from "./types";
import { e1GateReadiness, gateRemaining, releaseMonthPresentation, resolveE1PhaseId } from "./data";
import { E1_LEVELS, E1_SKU_FIELDS, e1Number, e1Multiply, e1Range, e1Value } from "./e1-state";

export type E1CatalogContext = Pick<EViewCtx, "skus" | "canWriteE1" | "e1InvalidSkus" | "e1Loading" | "e1Error" | "e1Gates" | "e1BundleDiscount" | "phaseCur" | "refreshE1" | "openSku" | "delSku" | "openActionConfirm" | "toast" | "pE"> & {
  earlyReady: boolean; earlyLoading: boolean; earlyError: string | null; refreshEarly: () => void;
  forceUnlock: boolean; forceLock: boolean; locked: (type: string, id: string) => boolean;
};

function SkuMediaThumb({ sku }: { sku: OpsSku }) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!sku.imageAssetId) return;
    const id = ++generation.current;
    setLoading(true);
    try {
      const asset = await refreshAdminMediaPreviewUrl(sku.imageAssetId);
      if (id !== generation.current) return;
      if (!asset.previewUrl) throw new Error("MEDIA_PREVIEW_URL_MISSING");
      setSrc(asset.previewUrl); setFailed(false);
    } catch {
      if (id === generation.current) { setSrc(""); setFailed(true); }
    } finally { if (id === generation.current) setLoading(false); }
  }, [sku.imageAssetId]);
  useEffect(() => { setSrc(""); setFailed(false); void refresh(); return () => { generation.current += 1; }; }, [refresh]);
  if (!sku.imageAssetId) return <div className="e1-media-placeholder"><Boxes size={36} aria-hidden /><span>暂无媒体</span></div>;
  if (!src || failed) return <div className="e1-media-placeholder"><ImageIcon size={24} aria-hidden />{failed && <span>图片已保存，预览暂时显示不了</span>}<Button size="sm" variant="ghost" disabled={loading} onClick={() => void refresh()}>{loading ? "加载中…" : "重新加载图片"}</Button></div>;
  return /\.(mp4|webm|mov)(?:$|\?)/i.test(sku.imageObjectKey || "")
    ? <video src={src} controls muted playsInline preload="metadata" onError={() => { setFailed(true); setSrc(""); }} />
    : <img src={src} alt="" loading="lazy" onError={() => { setFailed(true); setSrc(""); }} />;
}

export function E1TargetRange({ sku }: { sku: OpsSku }) {
  if (sku.monthlyTargetUsdt == null) return <span className="e1-muted">未设月收益目标</span>;
  const target = sku.monthlyTargetUsdt, band = sku.monthlyTargetBandPct;
  if (band == null) return <><strong>{e1Number(target)} <small>USDT/月</small></strong><span className="e1-muted">— · 波动未读取</span></>;
  const range = e1Range(target, band);
  return <>
    <div className="e1-value-line"><strong>{e1Number(target)} <small>USDT/月</small></strong><span className="e1-muted">±{e1Number(band)}%</span></div>
    <ScaleBar label="月收益目标范围" valueText={`目标 ${e1Number(target)} USDT/月，范围 ${e1Number(range.low)} 至 ${e1Number(range.high)} USDT/月，允许波动 ±${e1Number(band)}%`} max={Number(range.high)} range={{ low: Number(range.low), high: Number(range.high) }} target={target} tone="neutral" />
    <div className="e1-range-labels"><span>{e1Number(range.low)}</span><span>{e1Number(range.high)} USDT/月</span></div>
  </>;
}

export function E1Catalog({ ctx }: { ctx: E1CatalogContext }) {
  const { skus } = ctx;
  const canWrite = ctx.canWriteE1;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [tier, setTier] = useState("all");
  const [scope, setScope] = useState("all");
  const [queryReady, setQueryReady] = useState(false);
  const [paramNote, setParamNote] = useState("");
  const [skuLink, setSkuLink] = useState("");
  const [planOpen, setPlanOpen] = useState(false);
  const [planView, setPlanView] = useState("plan");
  const [planSku, setPlanSku] = useState("");
  const [detail, setDetail] = useState<OpsSku | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search), requested = p.get("sku")?.trim();
    const statuses = ["all", "on", "pending", "off"], tiers = ["all", "Entry", "Pro", "Flagship", "Share"], views = ["all", "blocked", "unknown", "legacy", "on", "pending", "off"];
    if (requested) { setQuery(requested); setSkuLink(requested); }
    else {
      setQuery(p.get("q") ?? "");
      setStatus(statuses.includes(p.get("status") ?? "all") ? p.get("status") ?? "all" : "all");
      setTier(tiers.includes(p.get("tier") ?? "all") ? p.get("tier") ?? "all" : "all");
      setScope(views.includes(p.get("view") ?? "all") ? p.get("view") ?? "all" : "all");
      if (!statuses.includes(p.get("status") ?? "all") || !tiers.includes(p.get("tier") ?? "all") || !views.includes(p.get("view") ?? "all")) setParamNote("无效筛选已恢复为默认值");
    }
    setQueryReady(true);
  }, []);
  useEffect(() => {
    if (!queryReady) return;
    const p = new URLSearchParams(window.location.search);
    for (const [key, value] of [["q", query], ["status", status], ["tier", tier], ["view", scope]]) { if (!value || value === "all") p.delete(key); else p.set(key, value); }
    if (skuLink && query !== skuLink) { p.delete("sku"); setSkuLink(""); }
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${p.size ? `?${p}` : ""}`);
  }, [query, status, tier, scope, queryReady, skuLink]);
  const clear = () => { setQuery(""); setStatus("all"); setTier("all"); setScope("all"); setParamNote(""); };
  const oldModel = (s: OpsSku) => !supportsDeviceMonthlyTarget(s.id, s.tier, s.productType);
  const filtered = useMemo(() => skus.filter(s => {
    const haystack = [s.id, s.name, s.tagline, s.badge, s.gpu, s.vram, s.datacenter].filter(Boolean).join(" ").toLowerCase();
    return (!query.trim() || haystack.includes(query.trim().toLowerCase())) && (status === "all" || s.status === status) && (tier === "all" || s.tier === tier)
      && (scope === "all" || scope === "blocked" && s.publishBlocked === true || scope === "unknown" && s.publishBlocked === undefined || scope === "legacy" && oldModel(s) || ["on", "pending", "off"].includes(scope) && s.status === scope && s.publishBlocked === false);
  }), [skus, query, status, tier, scope]);
  const phaseOrder = ctx.e1Gates?.phaseOrder ?? [], phases = ctx.e1Gates?.phases ?? [], releases = ctx.e1Gates?.releases ?? [];
  const platformMonth = ctx.e1Gates?.platformMonth ?? 0;
  const phaseCur = ctx.e1Gates?.phaseCurrent ?? "";
  const phaseLabel = (id: string) => nexGridBrandText(phases.find(p => p.p === resolveE1PhaseId(phases, id))?.label || id || "未配置");
  const phaseOptions = phaseOrder;
  const gateSkuOptions = skus.filter(s => !releases.some(g => g.id === s.id)).map(s => s.id);
  const gateReadiness = (g: E1GenerationRelease) => e1GateReadiness({ release: g, phaseOrder, phases, sku: skus.find(s => s.id === g.id), currentPhase: phaseCur, platformMonth });
  const revealPlan = (skuId?: string) => { setPlanView("plan"); setPlanSku(skuId ?? ""); setPlanOpen(true); window.requestAnimationFrame(() => document.getElementById("e1-open-plan")?.scrollIntoView({ block: "start" })); };
  const genShift = (g: E1GenerationRelease) => ctx.openActionConfirm({ briefKind: "config", name: `调整开放偏移 · ${g.name}`, op: "param", paramKey: `E.gen.${g.id}.phaseOffset`, facts: <Facts><Fact k="商品">{g.name}</Fact><Fact k="计划开放">第 {g.releaseMonth} 个月</Fact><Fact k="当前有效开放">第 {g.releaseMonth + (g.phaseOffset ?? 0)} 个月</Fact></Facts>, edit: { kind: "number", current: String(g.phaseOffset ?? 0), unit: "个月", min: -12, max: 12, step: 1, disallowCurrent: true, hint: "-12～12 的整数；填写新的绝对偏移", preview: (v) => `新有效开放月：第 ${g.releaseMonth + Number(v ?? g.phaseOffset ?? 0)} 个月` }, detail: "批准后按新的绝对偏移判断开放月份。", amplify: false });
  const genForceUnlock = (g: E1GenerationRelease) => {
    const state = gateReadiness(g);
    if (!state.declaredPhase) { ctx.toast(`不能开放：${(g.name)} 没有设置开放阶段，请先检查商品设置`); return; }
    if (state.phaseConflict) { ctx.toast(`不能开放：${(g.name)} 的开放阶段是${phaseLabel(state.declaredPhase)}，和上架条件里的${phaseLabel(g.phase)}不一致，请先改成一致`); return; }
    if (!state.eligibilityReady) { ctx.toast(`不能开放：${(g.name)} 还没补设备资格`); return; }
    if (!state.phaseReached) { ctx.toast(`不能开放：${(g.name)} 要到 ${phaseLabel(g.phase)} 才能开放`); return; }
    ctx.openActionConfirm({ briefKind: "record",
      name: `强制提前开放 · ${(g.name)}`,
      op: "generation-gate-force",
      generationGateId: g.id,
      generationGate: { forceUnlock: true },
      amplify: true,
      facts: <Facts><Fact k="商品">{g.name}</Fact><Fact k="已到达阶段">{phaseLabel(g.phase)}</Fact><Fact k="设备资格">已补齐</Fact><Fact k="当前运营月">第 {platformMonth} 个月</Fact><Fact k="有效开放月">第 {state.effectiveMonth} 个月</Fact><Fact k="仍差运营月数">{Math.max(0, state.effectiveMonth - platformMonth)} 个月</Fact></Facts>,
      detail: `只跳过运营月数；阶段和设备资格仍须满足。`,
    });
  };
  const genForceLock = (g: E1GenerationRelease) =>
    ctx.openActionConfirm({ briefKind: "record",
      name: `撤销强制提前开放 · ${(g.name)}`,
      op: "generation-gate-force",
      generationGateId: g.id,
      generationGate: { forceUnlock: false },
      amplify: false,
      facts: <Facts><Fact k="商品">{g.name}</Fact><Fact k="强制状态">已强制提前开放 → 撤销强制</Fact><Fact k="当前运营月">第 {platformMonth} 个月</Fact><Fact k="有效开放月">第 {g.releaseMonth + (g.phaseOffset ?? 0)} 个月</Fact></Facts>,
      detail: `阶段、资格、月数满足时，撤销强制仍保持开放。`,
    });
  const openPhaseEditor = (ph?: E1Phase) => {
    const nextSort = phases.reduce((max, item) => Math.max(max, item.sortOrder ?? 0), 0) + 10;
    ctx.openActionConfirm({ briefKind: "config",
      name: ph ? `编辑阶段 · ${phaseLabel(ph.p)}` : "新增阶段",
      op: "phase-save",
      phaseId: ph?.p,
      businessForm: {
        kind: "multi-field", requireAnyChange: !!ph,
        fields: [
          { key: "label", label: "阶段名称", current: ph?.label ?? "", required: true, explain: "阶段的运营显示名称；修改不会推进当前阶段。" },
          { key: "meta", label: "门槛说明", current: ph?.meta ?? "", required: false, explain: "该阶段的说明资料，批准后目录读取。" },
          { key: "skus", label: "商品标签", current: ph?.skus ?? "", required: false, explain: "阶段旁的商品文字标签，不决定真实商品资格。" },
          { key: "sortOrder", label: "排序", current: String(ph?.sortOrder ?? Math.min(9999, nextSort)), inputKind: "number", min: 0, max: 9999, step: 1, required: true },
          { key: "status", label: "状态", current: ph?.status ?? "active", inputKind: "select", options: ["active", "archived"], optionLabels: { active: "启用", archived: "已归档" } },
        ],
      },
      detail: ph
        ? "修改阶段名称、门槛说明、商品标签和排序。"
        : "新增阶段。商品的开放阶段和上架条件都从这里选。",
      amplify: false,
    });
  };
  const archivePhase = (ph: E1Phase) =>
    ctx.openActionConfirm({ briefKind: "config",
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
    ctx.openActionConfirm({ briefKind: "config",
      name: "调整升级置换抢先购", op: "early-access", amplify: false,
      businessForm: {
        kind: "multi-field", title: "升级置换抢先购",
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
      detail: "开启后可提前换购；关闭后等待正式上架。",
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
    const skuId = g?.id ?? gateSkuOptions[0], phase = (g?.phase ?? phaseCur) || gatePhaseOptions[0];
    const canChangeForce = g?.forceUnlock ? ctx.forceLock : ctx.forceUnlock;
    ctx.openActionConfirm({ briefKind: "config",
      name: g ? `编辑上架条件 · ${(g.name)}` : "新增上架条件",
      op: "generation-gate-save",
      generationGateId: g?.id,
      generationGate: { skuId, phase, forceUnlock: g?.forceUnlock ?? false },
      facts: <Facts><Fact k="商品">{g?.name || skus.find(s => s.id === skuId)?.name || skuId}</Fact>{gatePhaseOptions.length === 1 && <Fact k="开放阶段">{phaseLabel(phase)}</Fact>}{!canChangeForce && <Fact k="强制提前开放">{g?.forceUnlock ? "是" : "否"} · 当前账号不能调整此方向</Fact>}</Facts>,
      businessForm: {
        kind: "multi-field", requireAnyChange: !!g,
        amplifies: v => v.forceUnlock === "true" || !canChangeForce && !!g?.forceUnlock,
        fields: [
          ...(!g && gateSkuOptions.length > 1 ? [{ key: "skuId", label: "商品", current: skuId, inputKind: "select" as const, options: gateSkuOptions, optionLabels: Object.fromEntries(skus.map(s => [s.id, `${s.name} · ${s.id}`])) }] : []),
          { key: "name", label: "展示名称", current: g?.name ?? "", required: false, help: "留空使用商品名称" },
          { key: "releaseMonth", label: "计划开放月", current: String(g?.releaseMonth ?? Math.min(12, Math.max(1, platformMonth))), inputKind: "number", min: 1, max: 12, step: 1, required: true },
          ...(gatePhaseOptions.length > 1 ? [{ key: "phase", label: "开放阶段", current: phase, inputKind: "select" as const, options: gatePhaseOptions, optionLabels: gatePhaseLabels }] : []),
          { key: "phaseOffset", label: "开放偏移（月）", current: String(g?.phaseOffset ?? 0), inputKind: "number", min: -12, max: 12, step: 1, required: true, explain: "绝对偏移，计划月加偏移等于有效开放月。" },
          { key: "eligibility", label: "设备资格", current: String(g?.eligibility ?? false), inputKind: "select", options: ["false", "true"], optionLabels: { false: "未补录", true: "已补齐" } },
          ...(canChangeForce ? [{ key: "forceUnlock", label: "强制提前开放", current: String(g?.forceUnlock ?? false), inputKind: "select" as const, options: ["false", "true"], optionLabels: { false: "否", true: "是" }, explain: "只跳过运营月数，阶段和设备资格仍须满足；变更方向须专门权限。" }] : []),
        ],
      },
      detail: g
        ? "修改开放月份、阶段、设备资格或强制提前开放"
        : "为商品设置分批上架规则",
      amplify: !!g?.forceUnlock,
    });
  };
  const archiveGate = (g: E1GenerationRelease) =>
    ctx.openActionConfirm({ briefKind: "config",
      name: `移除上架条件 · ${(g.name)}`,
      op: "generation-gate-archive",
      generationGateId: g.id,
      businessForm: { kind: "destructive-reason", target: (g.name), impact: "这个商品会从上架时间表中移除，不再受这条规则限制。" },
      detail: "归档后保留记录，本页没有恢复入口。",
      amplify: false,
    });

  const adjustBundleDiscount = () => {
    const discount = ctx.e1BundleDiscount;
    if (!discount) {
      ctx.toast("组合优惠设置加载失败，请刷新后重试");
      return;
    }
    ctx.openActionConfirm({ briefKind: "config",
      name: "调整 App 组合购阶梯折扣",
      op: "bundle-discount",
      businessForm: {
        kind: "multi-field",
        title: "组合购折扣",
        hint: "批准后新订单按新折扣，已有订单不变。",
        requireAnyChange: true,
        fields: [
          { key: "twoItemsPct", label: "2 件折扣（%）", current: String(discount.twoItemsPct), inputKind: "number", min: 0.01, max: 30, step: 0.01, required: true },
          { key: "threeItemsPct", label: "3 件折扣（%）", current: String(discount.threeItemsPct), inputKind: "number", min: 0.01, max: 30, step: 0.01, required: true },
          { key: "fourPlusItemsPct", label: "4 件及以上折扣（%）", current: String(discount.fourPlusItemsPct), inputKind: "number", min: 0.01, max: 30, step: 0.01, required: true },
        ],
      },
      detail: "批准后新订单按新折扣，已有订单不变。",
      amplify: true,
    });
  };

  const stats = [
    { key: "on", label: "在售", icon: PackageCheck, value: skus.filter(s => s.status === "on" && s.publishBlocked === false).length },
    { key: "pending", label: "草稿", icon: PackagePlus, value: skus.filter(s => s.status === "pending" && s.publishBlocked === false).length },
    { key: "off", label: "已下架", icon: Archive, value: skus.filter(s => s.status === "off" && s.publishBlocked === false).length },
    { key: "blocked", label: "上架受阻", icon: ShieldAlert, value: skus.filter(s => s.publishBlocked === true).length },
  ];
  const unknown = skus.filter(s => s.publishBlocked === undefined).length, legacy = skus.filter(oldModel).length;
  const available = !ctx.e1Loading && !ctx.e1Error;
  const gated = releases.filter(g => !gateReadiness(g).unlocked).length;
  const knownSold = skus.filter(s => s.publishBlocked === false && s.sold != null);
  const soldValues = knownSold.map(s => e1Multiply(s.price, s.sold!));
  const valueScale = Math.max(0, ...soldValues.map(v => (v.split(".")[1] ?? "").length));
  const soldValue = soldValues.reduce((sum, v) => sum + BigInt(v.replace(".", "").padEnd(v.replace(".", "").length + valueScale - (v.split(".")[1] ?? "").length, "0")), BigInt("0")).toString().padStart(valueScale + 1, "0");
  const soldValueText = e1Number(valueScale ? `${soldValue.slice(0, -valueScale)}.${soldValue.slice(-valueScale)}` : soldValue);
  const phaseCurrentKnown = phaseOrder.includes(phaseCur);
  return <>
    {available && <Conclusion state={stats[3].value || legacy || unknown || ctx.e1InvalidSkus.length ? "warn" : "neutral"} explain="在售只计通过发布门的商品；仍须同时满足库存、开放阶段和个人购买条件。草稿不是待审批单。">
      {stats[0].value === 0 && (unknown || ctx.e1InvalidSkus.length) ? "已核实在售 0 个，另有商品待核实" : `在售 ${stats[0].value} 个商品`}
      {!!stats[3].value && <> · <Button variant="ghost" onClick={() => setScope("blocked")}>{stats[3].value} 个上架受阻</Button></>}
      {!!legacy && <> · <Button variant="ghost" onClick={() => setScope("legacy")}>{legacy} 个旧编号需核对</Button></>}
    </Conclusion>}
    <StatBand label="商品目录汇总">{stats.map(stat => <Stat key={stat.key} label={stat.label} value={available ? stat.value : "—"} unit="个" icon={stat.icon} tone={stat.key === "blocked" ? "warn" : "neutral"} onOpen={available ? () => setScope(scope === stat.key ? "all" : stat.key) : undefined} selected={scope === stat.key} selectedText="已筛选" aria-pressed={scope === stat.key} openLabel={`筛选${stat.label}商品`} explain="全量目录统计，不随关键词和档位筛选变化；发布门未声明和无效行另列。" />)}</StatBand>
    {available && !!unknown && <Notice tone="warn" title={`${unknown} 个商品上架状态未核实`} action={<Button variant="ghost" onClick={() => setScope("unknown")}>查看未核实商品</Button>} />}
    {available && !!ctx.e1InvalidSkus.length && <Notice tone="warn" title={`${ctx.e1InvalidSkus.length} 个商品数据有误，暂不显示`} action={<Button onClick={() => void ctx.refreshE1()}>重新加载</Button>}><ul>{ctx.e1InvalidSkus.map(row => <li key={row.skuId}>{row.name} · {row.skuId} · 有误的字段：{row.invalidFields.join("、")}</li>)}</ul></Notice>}
    <section className="e1-stage-summary" aria-label="开放阶段">
      <div className="e1-stage-identity"><strong>开放阶段<Explain label="开放阶段的说明" content="节点等距只表示先后，不代表各阶段持续时间；这里不能推进当前阶段。" /></strong><span className="e1-muted">{ctx.e1Gates ? `运营第 ${e1Number(platformMonth)} 个月 · ${phaseCurrentKnown ? phaseLabel(phaseCur) : "当前阶段待核实"}` : ctx.e1Loading ? "正在读取…" : "— · 未读取"}</span></div>
      <StageLine label="开放阶段" stages={phaseOrder.map(id => ({ id, label: <span>{phaseLabel(id)}<Explain label={`${phaseLabel(id)}的阶段资料`} rows={[{ k: "门槛说明", v: phases.find(p => p.p === id)?.meta || "未填写" }, { k: "商品标签", v: phases.find(p => p.p === id)?.skus || "未填写" }, { k: "排序", v: phases.find(p => p.p === id)?.sortOrder ?? "未读取" }, { k: "状态", v: phases.find(p => p.p === id)?.status === "archived" ? "已归档" : "启用" }]} /></span> }))} currentId={phaseCurrentKnown ? phaseCur : null} state={ctx.e1Loading ? "loading" : ctx.e1Error ? "failed" : phases.length ? "ready" : "empty"} emptyText="尚未配置阶段" failedText="阶段暂时读不到" />
      <Button disabled={ctx.e1Loading || !!ctx.e1Error} onClick={() => revealPlan()}>管理开放计划</Button>
    </section>
    <FilterBar onClear={clear} canClear={!!query || status !== "all" || tier !== "all" || scope !== "all"} result={available ? `显示 ${filtered.length} / ${skus.length} 个商品${scope !== "all" ? " · 已筛选" : ""}` : undefined} notice={paramNote || undefined}>
      <FilterField label="搜索商品" grow><Input aria-label="搜索商品" value={query} placeholder="名称 / 商品编号 / GPU / 托管机房" onChange={e => setQuery(e.target.value)} /></FilterField>
      <FilterField label="状态"><Select aria-label="商品状态筛选" value={status} onChange={setStatus} options={[{ value: "all", label: "全部状态" }, { value: "on", label: "在售" }, { value: "pending", label: "草稿" }, { value: "off", label: "已下架" }]} /></FilterField>
      <FilterField label="档位"><Select aria-label="商品档位筛选" value={tier} onChange={setTier} options={[{ value: "all", label: "全部档位" }, ...["Entry", "Pro", "Flagship", "Share"].map(t => ({ value: t, label: operatorSkuTier(t) }))]} /></FilterField>
    </FilterBar>
    {skuLink && available && <Notice tone="neutral" title={filtered.some(s => s.id === skuLink) ? `已定位商品 ${skuLink}` : `没有找到商品 ${skuLink}`} />}
    {ctx.e1Loading ? <BlockState state="loading" title="正在读取商品目录…" /> : ctx.e1Error ? <BlockState state="error" title="商品目录暂时读不到" detail={ctx.e1Error} onRetry={() => void ctx.refreshE1()} retryLabel="重新加载" /> : !filtered.length ? <BlockState state="empty" title={skus.length ? "没有符合筛选条件的商品" : ctx.e1InvalidSkus.length ? "没有可显示的合法商品" : "尚未添加商品"} detail={skus.length ? <Button onClick={clear}>清除筛选</Button> : canWrite ? <Button onClick={() => ctx.openSku()}>+ 新增商品</Button> : "当前账号只能查看商品"} /> : <section className="e1-catalog-grid" aria-label="商品目录">{filtered.map(s => {
      const release = releases.find(g => g.id === s.id), readiness = release ? gateReadiness(release) : null;
      const phaseIndex = phaseOrder.indexOf(resolveE1PhaseId(phases, s.unlock));
      const open = readiness ? readiness.unlocked : (!s.unlock || phaseCurrentKnown && phaseIndex >= 0 && phaseIndex <= phaseOrder.indexOf(phaseCur));
      const blockers = readiness ? readiness.blockers : !open ? [phaseIndex < 0 ? "开放阶段对不上" : `待${phaseLabel(s.unlock)}`] : [];
      const publishReason = s.publishBlockReason === "PRODUCT_TEST_IDENTIFIER" ? "测试标识不能发布" : s.publishBlockReason === "PRODUCT_NO_EFFECTIVE_EARNINGS" ? "未配置有效收益" : s.publishBlockReason || "发布门未通过";
      const locked = ctx.locked("device_sku", s.id);
      const onBlock = locked ? "原操作结果未确认，请先核对" : s.publishBlocked === true ? publishReason : s.status !== "on" && s.publishBlocked === undefined ? "上架状态未知，请重新加载核对" : s.status !== "on" && !open ? blockers.join("；") : s.status !== "on" && oldModel(s) ? SKU_MODEL_UNRECOGNIZED_REASON : s.status !== "on" && !s.allowedPoolCodes?.length ? "上架前请至少选择一个任务等级" : s.status !== "on" && s.monthlyTargetUsdt == null ? "上架前请设置月收益目标" : s.status !== "on" && !s.datacenter?.trim() ? "上架前请填写托管机房" : s.status !== "on" && s.inventoryMode !== "UNLIMITED" && Number(s.stock) === 0 ? "库存为 0，商品已售罄" : undefined;
      const sold = s.sold, stock = s.stock == null ? null : Number(s.stock);
      return <article key={s.id} className="e1-product" data-hit={skuLink === s.id ? "" : undefined} aria-label={s.name}>
        <div className="e1-product-identity"><div className="e1-product-media"><SkuMediaThumb sku={s} />{s.badge && <span className="e1-badge">{nexGridBrandText(s.badge)}</span>}</div><div className="e1-product-title"><div className="e1-tags"><span>{operatorSkuTier(s.tier ?? "")}</span><StatusTag tone="neutral">{e1Value(s.status)}</StatusTag></div><h2>{s.name}</h2>{s.tagline && <div className="e1-tagline"><Explain label={`${s.name}完整标语`} content={nexGridBrandText(s.tagline)}>{nexGridBrandText(s.tagline)}</Explain></div>}{canWrite && <Button size="sm" variant="ghost" disabledReason={locked ? "原操作结果未确认，请先核对" : undefined} onClick={() => ctx.openSku(s.id)} aria-label={`改价 / 编辑 ${s.name}`}>改价 / 编辑</Button>}</div></div>
        <div className="e1-product-price"><span className="e1-muted">售价</span><strong>{e1Number(s.price)} <small>USD</small></strong></div>
        <div className="e1-product-levels"><div className="e1-value-line"><span className="e1-muted">任务等级</span>{s.allowedPoolCodes?.length === 0 && <span className="e1-muted">未配置任务等级</span>}</div>{s.allowedPoolCodes == null ? <span className="e1-muted">— · 任务等级未读取</span> : <LevelStrip label={`${s.name}任务等级`} levels={E1_LEVELS} selectedKeys={s.allowedPoolCodes} />}</div>
        <div className="e1-product-target"><span className="e1-muted">月收益目标<Explain label="月收益目标口径" content="范围是持续运行的设备月目标边界，停跑不补发。各卡刻度独立，不表示实际到账。" /></span><E1TargetRange sku={s} /><span className="e1-muted">{e1Number(s.dailyEarnNEX)} UVT/天{s.dailyEarnNEX == null ? " · 未配置" : ""}</span></div>
        <div className="e1-product-stock">{s.inventoryMode === "UNLIMITED" ? <div className="e1-value-line"><span>不限（非实物）</span><span className="e1-muted">累计已售 {e1Number(sold)}</span></div> : <><div className="e1-value-line"><span className="e1-muted">已售 {e1Number(sold)}</span><span>剩余 {e1Number(stock)}{stock === 0 ? " · 售罄" : ""}</span></div>{sold != null && stock != null && (sold + stock > 0 ? <RatioBar label="已售与剩余库存构成" value={sold} total={sold + stock} valueText={`已售 ${sold}，剩余 ${stock}`} tone="role-2" /> : <span className="e1-muted">暂无已售和库存</span>)}</>}</div>
        <div className="e1-product-conditions"><span className="e1-muted">托管 · {datacenterNameText(s.datacenter || "— · 未填写")}</span><div className="e1-tags"><StatusTag tone="neutral">{s.trialEligible ? "允许试用" : "不可试用"}</StatusTag>{s.purchaseGate && <StatusTag tone={s.purchaseGate.enforce ? "warn" : "neutral"} explain={`会员等级 ${s.purchaseGate.rankMin ?? 0}；活跃直接邀请 ${s.purchaseGate.activeDirectMin ?? 0}；团队算力点 ${e1Number(s.purchaseGate.teamComputePointsMin)}；关系 ${s.purchaseGate.mode === "either" ? "任一满足" : "全部满足"}；剩余配额 ${gateRemaining(s.purchaseGate) ?? "不限"}。配额限制不替代实物库存。`}>购买条件{gateRemaining(s.purchaseGate) == null ? "" : ` · 剩 ${gateRemaining(s.purchaseGate)}`}</StatusTag>}<StatusTag tone={open ? "neutral" : "warn"}>{s.unlock ? phaseLabel(s.unlock) : "无需阶段"}</StatusTag></div>
          {blockers.map((b, i) => <div className="e1-card-warning" key={i}>{b}{release && <Button variant="ghost" onClick={() => revealPlan(s.id)}>查看条件</Button>}</div>)}
          {s.publishBlocked === true && <div className="e1-card-warning">上架受阻 · {publishReason}</div>}{s.publishBlocked === undefined && <div className="e1-card-warning">上架状态未知</div>}{oldModel(s) && <div className="e1-card-warning">{SKU_MODEL_UNRECOGNIZED_REASON}</div>}
        </div>
        <div className="e1-product-actions"><Button size="sm" onClick={() => setDetail(s)}>商品资料</Button>{canWrite && <><Button size="sm" disabledReason={onBlock} aria-label={`${s.status === "on" ? "下架" : "上架"} ${s.name}`} onClick={() => ctx.openActionConfirm({ briefKind: "content", name: `${s.status === "on" ? "下架" : "上架"}商品 · ${s.name}`, op: "sku-status", target: s.id, status: s.status === "on" ? "off" : "on", detail: s.status === "on" ? "下架后从商城隐藏，不影响已售设备结算。" : "批准后按完整购买条件判断，不保证所有用户都能购买。" })}>{s.status === "on" ? "下架" : "上架"}</Button><MoreMenu label={`更多操作 ${s.name}`} items={[{ key: "delete", label: "删除", danger: true, disabledReason: locked ? "原操作结果未确认，请先核对" : undefined, onSelect: () => ctx.delSku(s.id, s.name) }]} /></>}{canWrite && s.status === "on" && (s.inventoryMode === "UNLIMITED" || Number(s.stock) > 0) && !open && !release && phaseCurrentKnown && <Button size="sm" disabledReason={locked ? "原操作结果未确认，请先核对" : undefined} aria-label={`按当前阶段上架 ${s.name}`} onClick={() => ctx.openSku(s.id, phaseCur)}>按当前阶段上架</Button>}</div>
        {canWrite && onBlock && <div className="e1-action-reason">{onBlock}</div>}
      </article>;
    })}</section>}
    {available && <>
      <div id="e1-open-plan"><Fold title="商品开放计划" summary={`${releases.length} 条上架条件 · ${gated} 条尚未开放`} icon={SlidersHorizontal} open={planOpen} onOpenChange={setPlanOpen} explain="强制提前开放只跳过运营月数，阶段与设备资格仍须满足。异常条件在商品卡常显。">
        <ConfigList label="升级置换抢先购"><ConfigRow name="升级置换抢先购" value={ctx.earlyReady ? `${earlyEnabled} · 提前 ${earlyLead} 天` : "— · 当前设置未读取"} what="旧设备换新时的提前购买窗口" when="批准后供之后换购判断" effect="只影响升级置换，不改变普通购买" action={canWrite ? <Button size="sm" disabledReason={ctx.earlyReady ? undefined : "当前设置未读取，请先重新读取"} onClick={adjEarlyAccess}>调整</Button> : undefined} /></ConfigList>
        {!ctx.earlyReady && <BlockState compact state={ctx.earlyLoading ? "loading" : "error"} title={ctx.earlyLoading ? "正在读取抢先购设置…" : "抢先购设置暂时读不到"} detail={ctx.earlyError ?? undefined} onRetry={ctx.earlyLoading ? undefined : ctx.refreshEarly} retryLabel="重新读取" />}
        <div className="rd-toolbar"><Segments value={planView} onChange={v => { setPlanView(String(v)); setPlanSku(""); }} label="开放计划视图" items={[{ value: "plan", label: "商品开放计划" }, { value: "phases", label: "阶段设置" }]} />{canWrite && (planView === "plan" ? <Button disabledReason={!phaseOptions.length ? "请先配置阶段" : !gateSkuOptions.length ? "所有商品都已设置上架条件" : undefined} onClick={() => openGateEditor()}>+ 新增上架条件</Button> : <Button onClick={() => openPhaseEditor()}>+ 新增阶段</Button>)}</div>
        {planView === "plan" ? <Table label="商品开放计划" className="e1-plan-table"><thead><tr><Th>商品</Th><Th align="right">计划开放</Th><Th>当前状态</Th><Th>阶段</Th><Th>设备资格</Th><Th sticky="end">操作</Th></tr></thead><tbody>
          {!releases.length && <Tr><Td colSpan={6}>暂无上架条件</Td></Tr>}{releases.map(g => {
            const state = gateReadiness(g), presentation = releaseMonthPresentation(g.releaseMonth, g.phaseOffset);
            const lock = ctx.locked("device_generation_gate", g.id);
            const forceBlock = !state.declaredPhase || state.phaseConflict || !state.eligibilityReady || !state.phaseReached ? state.blockers.join("；") : undefined;
            return <Tr key={g.id} mark={planSku === g.id ? "hit" : undefined}>
              <Td><div className="e1-table-stack"><strong>{g.name}</strong><span data-mono>{g.id}</span></div></Td>
              <Td align="right"><div className="e1-table-stack"><span>{presentation.effectiveLabel}</span><span className="e1-muted">{presentation.adjustmentLabel}</span></div></Td>
              <Td><div className="e1-table-stack"><StatusTag tone={state.unlocked ? "neutral" : "warn"}>{state.unlocked ? "已开放" : "尚未开放"}</StatusTag>{state.blockers.map((b,i) => <span key={i} className="e1-card-warning">{b}</span>)}{!state.unlocked && state.phaseReached && state.eligibilityReady && !state.monthReached && !state.forceMonthOpen && <span className="e1-muted">距开放 {state.effectiveMonth - platformMonth} 个月</span>}{g.forceUnlock && <StatusTag tone="warn" explain={`批准人 ${g.forceUnlockApprovedBy || "未记录"}；批准时间 ${g.forceUnlockApprovedAt || "未记录"}；操作记录 ${g.forceUnlockAuditId || "未记录"}`}>强制提前</StatusTag>}</div></Td>
              <Td>{phaseLabel(g.phase)}</Td><Td><StatusTag tone={g.eligibility ? "neutral" : "warn"}>{g.eligibility ? "已补齐" : "未补录"}</StatusTag></Td>
              <Td sticky="end" data-fit=""><div className="e1-table-actions">{canWrite && <>
                <Button size="sm" disabledReason={lock ? "原操作结果未确认" : undefined} onClick={() => openGateEditor(g)}>编辑</Button>
                <MoreMenu label={`上架条件操作 ${g.name}`} items={[
                  { key: "offset", label: "调整开放偏移", disabledReason: lock ? "原操作结果未确认" : undefined, onSelect: () => genShift(g) },
                  ...(g.forceUnlock ? ctx.forceLock ? [{ key: "lock", label: "撤销强制", disabledReason: lock ? "原操作结果未确认" : undefined, onSelect: () => genForceLock(g) }] : [] : state.unlocked ? [{ key: "natural", label: "自然开放", disabledReason: "自然条件已满足，没有强制开放可撤销", onSelect: () => {} }] : ctx.forceUnlock ? [{ key: "force", label: "强制提前开放", disabledReason: lock ? "原操作结果未确认" : forceBlock, onSelect: () => genForceUnlock(g) }] : []),
                  { key: "archive", label: "移除", danger: true, disabledReason: lock ? "原操作结果未确认" : undefined, onSelect: () => archiveGate(g) },
                ]} />
              </>}</div></Td>
            </Tr>;
          })}</tbody></Table> : <Table label="阶段设置" className="e1-phase-table"><thead><tr><Th>阶段</Th><Th>门槛说明</Th><Th>商品标签</Th><Th>排序与状态</Th><Th sticky="end">操作</Th></tr></thead><tbody>
          {!phases.length && <Tr><Td colSpan={5}>暂无阶段配置</Td></Tr>}{phases.map(ph => {
            const archiveBlock = ph.p === phaseCur ? "当前阶段不能删除" : phases.filter(p => p.status !== "archived").length <= 1 ? "至少保留一个启用阶段" : skus.some(s => resolveE1PhaseId(phases, s.unlock) === ph.p) || releases.some(g => resolveE1PhaseId(phases, g.phase) === ph.p) ? "商品或上架条件仍引用此阶段" : ctx.locked("device_phase", ph.p) ? "原操作结果未确认" : undefined;
            return <Tr key={ph.p}>
              <Td><div className="e1-table-stack"><strong>{phaseLabel(ph.p)}</strong><span data-mono>{ph.p}</span>{ph.p === phaseCur && <StatusTag tone="neutral">当前阶段</StatusTag>}</div></Td>
              <Td>{ph.meta || "—"}</Td><Td>{ph.skus || "—"}</Td><Td><div className="e1-table-stack"><span>{ph.sortOrder ?? "—"}</span><StatusTag tone="neutral">{ph.status === "archived" ? "已归档" : "启用"}</StatusTag></div></Td>
              <Td sticky="end" data-fit="">{canWrite && <div className="e1-table-actions"><Button size="sm" disabledReason={ctx.locked("device_phase", ph.p) ? "原操作结果未确认" : undefined} onClick={() => openPhaseEditor(ph)}>编辑</Button><Button size="sm" variant="danger-outline" disabledReason={archiveBlock} onClick={() => archivePhase(ph)}>删除</Button></div>}{canWrite && archiveBlock && <span className="e1-action-reason">{archiveBlock}</span>}</Td>
            </Tr>;
          })}</tbody></Table>}
      </Fold></div>
      <Fold title="组合购折扣" icon={PackageCheck} summary={ctx.e1BundleDiscount ? `2 件 ${e1Number(ctx.e1BundleDiscount.twoItemsPct)}% · 3 件 ${e1Number(ctx.e1BundleDiscount.threeItemsPct)}% · 4+ 件 ${e1Number(ctx.e1BundleDiscount.fourPlusItemsPct)}%` : "未读取"} actions={canWrite && <Button size="sm" disabledReason={ctx.locked("store_bundle_discount", "canonical") ? "原操作结果未确认" : undefined} onClick={adjustBundleDiscount}>调整阶梯折扣</Button>}>
        <ConfigList label="组合购阶梯折扣">{ctx.e1BundleDiscount && [["2 件折扣", ctx.e1BundleDiscount.twoItemsPct], ["3 件折扣", ctx.e1BundleDiscount.threeItemsPct], ["4 件及以上折扣", ctx.e1BundleDiscount.fourPlusItemsPct]].map(([name, value]) => <ConfigRow key={name} name={name} value={`${e1Number(value)}%`} what="购买相应件数的目录折扣" when="批准后新订单按新折扣，已有订单不变" />)}</ConfigList>
      </Fold>
      <Fold title="目录口径" icon={FileText} summary={`${knownSold.reduce((sum,s) => sum + s.sold!, 0)} 件已知售出 · ${releases.length} 条分批规则`} explain="只计通过发布门的商品。目录计数乘当前售价，不是订单实付 GMV。缺销量或无效行时仅为已知部分。">
        <Facts><Fact k="目录累计售出额" unit="USD">{soldValueText}</Fact><Fact k="已知售出数量">{e1Number(knownSold.reduce((sum,s) => sum + s.sold!, 0))} 件</Fact><Fact k="分批规则数">{releases.length}</Fact><Fact k="未开放规则数">{gated}</Fact></Facts>
        {(ctx.e1InvalidSkus.length > 0 || skus.some(s => s.publishBlocked === false && s.sold == null) || unknown > 0) && <Notice tone="warn" title="小计只含已知部分" />}
      </Fold>
    </>}
    {detail && <Drawer open title="商品资料" sub={detail.name} icon={Boxes} onClose={() => setDetail(null)} footer={<Decision primary={canWrite && <Button variant="primary" disabledReason={ctx.locked("device_sku", detail.id) ? "原操作结果未确认" : undefined} onClick={() => { const id = detail.id; setDetail(null); ctx.openSku(id); }}>改价 / 编辑</Button>} others={<Button onClick={() => setDetail(null)}>关闭</Button>} />}>
      <JudgmentPoints rows={[{ label: "状态", value: e1Value(detail.status) }, { label: "售价", value: `${e1Number(detail.price)} USD` }, { label: "任务等级", value: detail.allowedPoolCodes?.join("、") || "未配置" }, { label: "月收益目标", value: detail.monthlyTargetUsdt == null ? "未设月收益目标" : `${e1Number(detail.monthlyTargetUsdt)} USDT/月` }, { label: "库存", value: detail.inventoryMode === "UNLIMITED" ? "不限（非实物）" : e1Number(detail.stock) }]} />
      <Fold inset title="完整规格与购买条件" summary={`${E1_SKU_FIELDS.length} 项资料`} defaultOpen><Facts>{E1_SKU_FIELDS.map(f => <Fact key={f.key} k={f.label}>{e1Value(detail[f.key], f.unit)}</Fact>)}</Facts></Fold>
      <Fold inset title="兼容收益与策略" summary={`策略版本 ${detail.productTaskPolicyVersion ?? "—"}`}><Facts>
        <Fact k="兼容日均 USDT">{e1Number(detail.derivedDailyEarnUsdt ?? detail.dailyEarn)} USDT/天</Fact><Fact k="日 UVT">{e1Number(detail.dailyEarnNEX)} UVT/天</Fact>
        {detail.tier === "Share" && detail.monthlyTargetUsdt != null && detail.monthlyTargetBandPct != null && <><Fact k="Share 预估日收益下限">{e1Number(Number(e1Range(detail.monthlyTargetUsdt, detail.monthlyTargetBandPct).low) / 30)} USDT/天</Fact><Fact k="Share 预估日收益上限">{e1Number(Number(e1Range(detail.monthlyTargetUsdt, detail.monthlyTargetBandPct).high) / 30)} USDT/天</Fact></>}
        <Fact k="参考年奖励率下限">{e1Number(detail.derivedShareYieldMinPct ?? detail.shareYieldMin)}%</Fact><Fact k="参考年奖励率上限">{e1Number(detail.derivedShareYieldMaxPct ?? detail.shareYieldMax)}%</Fact><Fact k="任务策略版本">{e1Number(detail.productTaskPolicyVersion)}</Fact><Fact k="策略生效时间">{detail.productTaskPolicyEffectiveAt || "—"}</Fact><Fact k="修订时间">{detail.updatedAt || "—"}</Fact><Fact k="媒体资源">{detail.imageAssetId || "—"}</Fact>
      </Facts></Fold>
    </Drawer>}
  </>;
}
