import { useEffect, useState, type CSSProperties } from "react";
import { CodeTag, Badge } from "../design-kit";
import type { E1GenerationRelease, E1Phase } from "@/lib/admin/e1-client";
import { refreshAdminMediaPreviewUrl } from "@/lib/admin/media-client";
import type { OpsSku } from "@/lib/admin/platform-types";
import type { EViewCtx } from "./types";
import { gateRemaining } from "./data";
import { EStats } from "./stats";

const PHASE_STATUS_LABELS: Record<string, string> = {
  active: "启用",
  archived: "已归档",
};
const phaseStatusLabel = (status?: string | null): string => PHASE_STATUS_LABELS[status || "active"] ?? status ?? "启用";

// 卡 badge 视觉类按 tier 着色(text 用 sku.badge);gate 开放 = unlock phase ≤ 当前 phase。
const badgeClass = (tier?: string): string =>
  tier === "Entry" ? "popular" : tier === "Pro" ? "new" : tier === "Flagship" ? "limited" : tier === "Share" ? "share" : "new";
const yld = (s: OpsSku): string =>
  s.tier === "Share" && s.shareYieldMin != null
    ? `${s.shareYieldMin}–${s.shareYieldMax}% 年化 · ${(s.dailyEarnNEX ?? 0).toLocaleString()} NEX`
    : `$${(s.dailyEarn ?? 0).toFixed(2)}/d · ${(s.dailyEarnNEX ?? 0).toLocaleString()} NEX`;
const compactUsd = (value: number): string =>
  value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M`
    : value >= 1_000 ? `$${Math.round(value / 1_000).toLocaleString()}K`
      : `$${Math.round(value).toLocaleString()}`;
const isVideoMedia = (s: OpsSku): boolean => /\.(mp4|webm|mov)(?:$|\?)/i.test(s.imageObjectKey || s.imagePreviewUrl || "");

function RackIcon() {
  return (
    <svg width={44} height={44} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10v4M11 10v4M15 10v4M19 10v4" /><circle cx="6" cy="20" r="1" /><circle cx="18" cy="20" r="1" />
    </svg>
  );
}

function SkuMediaThumb({ sku }: { sku: OpsSku }) {
  const [src, setSrc] = useState(sku.imagePreviewUrl || "");
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setSrc(sku.imagePreviewUrl || "");
    setFailed(false);
    setRefreshing(false);
  }, [sku.imageAssetId, sku.imagePreviewUrl]);

  const refreshPreview = async () => {
    if (!sku.imageAssetId || refreshing) {
      setFailed(true);
      return;
    }
    setRefreshing(true);
    try {
      const asset = await refreshAdminMediaPreviewUrl(sku.imageAssetId);
      setSrc(asset.previewUrl);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  };

  if (!src || failed) {
    return <RackIcon />;
  }

  return isVideoMedia(sku)
    ? <video key={src} src={src} controls muted playsInline preload="auto" onError={() => void refreshPreview()} />
    : <img key={src} src={src} alt="" loading="lazy" onError={() => void refreshPreview()} />;
}

export function E1Catalog({ ctx }: { ctx: EViewCtx }) {
  const { skus, tasks } = ctx;
  const taskNameById = new Map(tasks.map((task) => [task.id, task.n]));
  const unlockPoolName = (value?: string) => value ? (taskNameById.get(value) ?? value) : "—";
  const phaseOrder = ctx.e1Gates?.phaseOrder ?? [];
  const phases = ctx.e1Gates?.phases ?? [];
  const platformMonth = ctx.e1Gates?.platformMonth ?? 0;
  const phaseCur = ctx.e1Gates?.phaseCurrent || ctx.phaseCur;
  const releases = ctx.e1Gates?.releases ?? [];
  const activePhaseIdx = phaseOrder.indexOf(phaseCur);
  const hasPhaseConfig = phaseOrder.length > 0 && phases.length > 0 && activePhaseIdx >= 0;
  const curIdx = hasPhaseConfig ? activePhaseIdx : -1;
  const phaseIdx = (p: string): number => phaseOrder.indexOf(p);
  const phaseLabel = (phaseId: string): string => {
    if (!phaseId) return "未配置";
    const phase = phases.find((item) => item.p === phaseId);
    return phase?.label || phaseId;
  };
  const phaseOptions = phaseOrder;
  const releaseIds = new Set(releases.map((g) => g.id));
  const skuId = (s: OpsSku) => s.id || s.name;
  const gateCandidates = skus.filter((s) => !releaseIds.has(skuId(s))); // 任意 SKU 均可挂上架节奏门
  const gateSkuOptions = gateCandidates.map(skuId);

  // 上架节奏门「是否解锁」单一判定源:当前阶段已到达 + 设备资格已补齐 + 平台月龄已到。
  // forceUnlock 仅绕过月龄门,不能绕过阶段或设备资格,避免标题写“阶段联动”但状态仍按历史月龄规则开放。
  const gateReadiness = (g: E1GenerationRelease) => {
    const offset = g.phaseOffset ?? 0;
    const effectiveMonth = g.releaseMonth + offset;
    const gatePhaseIdx = phaseIdx(g.phase);
    const eligibilityReady = !!g.eligibility;
    const phaseReached = hasPhaseConfig && gatePhaseIdx >= 0 && curIdx >= gatePhaseIdx;
    const monthReached = platformMonth >= effectiveMonth;
    const forceMonthOpen = !!g.forceUnlock;
    const blockers: string[] = [];

    if (!eligibilityReady) blockers.push("待设备资格");
    if (!phaseReached) blockers.push(gatePhaseIdx >= 0 ? `待${phaseLabel(g.phase)}` : "阶段未匹配");
    if (!monthReached && !forceMonthOpen) blockers.push(`待M${effectiveMonth}`);

    return {
      effectiveMonth,
      eligibilityReady,
      forceMonthOpen,
      gatePhaseIdx,
      monthReached,
      phaseReached,
      unlocked: eligibilityReady && phaseReached && (monthReached || forceMonthOpen),
      blockers,
    };
  };
  const gateBlockerLabel = (state: ReturnType<typeof gateReadiness>): string =>
    state.blockers.slice(0, 2).join(" / ") || "待发布";
  const gateCountdownLabel = (state: ReturnType<typeof gateReadiness>): string => {
    if (state.unlocked) return "已发布";
    if (!state.eligibilityReady) return "待设备资格";
    if (!state.phaseReached) return state.gatePhaseIdx >= 0 ? "待阶段" : "阶段未匹配";
    if (!state.monthReached && !state.forceMonthOpen) {
      const remain = state.effectiveMonth - platformMonth;
      return remain === 1 ? "下个月 · 1M" : remain > 1 ? `+ ${remain} M` : `待 M${state.effectiveMonth}`;
    }
    return "待发布";
  };
  const genUnlocked = (g: E1GenerationRelease): boolean => gateReadiness(g).unlocked;
  const proV2 = releases.find((g) => g.id === "stellarbox-pro-v2");
  const proV2Label = proV2 ? `Pro v2 ${genUnlocked(proV2) ? "已开放" : `未开放 · ${gateBlockerLabel(gateReadiness(proV2))}`}` : "";

  // 真 store 派生 stat(改 SKU 即刷新)
  const onSale = skus.filter((s) => (s.status || "on") === "on").length;
  const pending = skus.filter((s) => s.status === "pending").length;
  const gated = hasPhaseConfig ? skus.filter((s) => phaseIdx(s.unlock) > curIdx && phaseIdx(s.unlock) >= 0).length : 0;
  const gateManaged = releases.length;
  const enabledPhaseCount = phases.filter((ph) => (ph.status || "active") === "active").length;

  const soldUnits = skus.reduce((sum, s) => sum + (s.sold ?? 0), 0);
  const catalogGmv = skus.reduce((sum, s) => sum + (s.sold ?? 0) * (s.price ?? 0), 0);

  // 上架门连接线渐变:success 到当前节点、brand 当前段、surface-3 锁定段(随 phaseCur 动态)
  const phaseStep = phases.length > 1 ? 100 / (phases.length - 1) : 100;
  const doneEnd = Math.max(0, curIdx * phaseStep - 2);
  const curEnd = Math.min(100, Math.max(0, curIdx * phaseStep + phaseStep / 2));
  const phaseLine = `linear-gradient(90deg, var(--success) 0%, var(--success) ${doneEnd}%, var(--brand) ${doneEnd}%, var(--brand) ${curEnd}%, var(--surface-3) ${curEnd}%)`;

  const genShift = (g: E1GenerationRelease, offset: number, delta: number) =>
    ctx.openActionConfirm({
      name: `上架节奏 · ${delta < 0 ? "提前" : "延迟"} ${Math.abs(delta)} 个月 · ${g.name}`,
      op: "param", paramKey: `E.gen.${g.id}.phaseOffset`,
      edit: { kind: "number", current: String(offset), unit: "M" },
      detail: `当前计划发布月 ${g.releaseMonth}${offset ? `(偏移 ${offset}M)` : ""} · 调整发布偏移改发布门时点 · 以后端为准,改后对发布门生效`,
      amplify: false,
    });
  const genForceUnlock = (g: E1GenerationRelease) => {
    const state = gateReadiness(g);
    if (!state.eligibilityReady) { ctx.toast(`拒绝 · ${g.name} 设备资格未补录 · 发布门不能解锁`); return; }
    if (!state.phaseReached) { ctx.toast(`拒绝 · ${g.name} 当前阶段未到达 ${phaseLabel(g.phase)} · 发布门不能解锁`); return; }
    ctx.openActionConfirm({
      name: `强制提前开放 · ${g.name}`,
      op: "generation-gate-force",
      generationGateId: g.id,
      generationGate: { forceUnlock: true },
      amplify: true,
      detail: `设置 forceUnlock=true,仅绕过 H1 月龄门。Phase 已到达 ${phaseLabel(g.phase)},E5 资格配置已补齐;写入后端发布门配置。`,
    });
  };
  const genForceLock = (g: E1GenerationRelease) =>
    ctx.openActionConfirm({
      name: `撤销强制提前开放 · ${g.name}`,
      op: "generation-gate-force",
      generationGateId: g.id,
      generationGate: { forceUnlock: false },
      amplify: false,
      detail: `撤销强制提前开放,重新纳入平台月龄门控。若阶段 / 设备资格 / 月龄已经自然满足,SKU 仍会保持已开放。`,
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
        ? "修改阶段名称 / 门槛说明 / SKU 标签 / 排序。内部 ID 使用系统生成值,不对运营展示。"
        : "新增阶段配置;SKU 解锁阶段和上架门发布阶段都从这里选择。",
      amplify: false,
    });
  };
  const setCurrentPhase = (ph: E1Phase) =>
    ctx.openActionConfirm({
      name: `设为当前阶段 · ${phaseLabel(ph.p)}`,
      op: "phase-current",
      phaseId: ph.p,
      target: phaseLabel(ph.p),
      detail: "写入当前阶段配置;刷新后 E1 发布门、进度条、已开放判断都以后端返回的当前阶段为准。",
      amplify: false,
    });
  const archivePhase = (ph: E1Phase) =>
    ctx.openActionConfirm({
      name: `删除阶段 · ${phaseLabel(ph.p)}`,
      op: "phase-archive",
      phaseId: ph.p,
      businessForm: {
        kind: "destructive-reason",
        target: phaseLabel(ph.p),
        impact: "后端会先校验当前阶段、SKU 解锁阶段、上架门发布阶段引用;仍被使用时拒绝删除。",
      },
      detail: "归档这条阶段配置,不物理删除。删除前必须先把相关 SKU 和上架门迁移到其他阶段。",
      amplify: false,
    });
  // FEAT-DEV02b 置换侧抢先购(上架参数配置项,默认关):多字段弹窗,双 select 可枚举不手输。
  const earlyEnabled = ctx.pE("E.release.earlyAccess.enabled");
  const earlyLead = ctx.pE("E.release.earlyAccess.leadDays");
  const adjEarlyAccess = () =>
    ctx.openActionConfirm({
      name: "置换侧抢先购 调整", op: "param-multi", amplify: true,
      businessForm: {
        kind: "multi-field", title: "目标新值 · 置换侧抢先购",
        hint: "仅升级置换路径可在正式上架前提前购买;商城正门不受影响。默认关闭。",
        fields: [
          { key: "enabled", label: "总开关", current: earlyEnabled, inputKind: "select", options: ["关", "开"] },
          { key: "leadDays", label: "提前天数(天)", current: earlyLead, inputKind: "select", options: ["7", "14", "30", "60", "90"] },
        ],
      },
      paramKeys: [
        { key: "enabled", paramKey: "E.release.earlyAccess.enabled" },
        { key: "leadDays", paramKey: "E.release.earlyAccess.leadDays" },
      ],
      detail: "开启后,持有可置换设备的用户可在该 SKU 正式上架前 N 天通过升级置换购买(目标行带「抢先升级」标);关闭 = 上架门对置换路径完全生效。前端镜像同名配置,server-canonical。",
    });

  const openGateEditor = (g?: E1GenerationRelease) => {
    if (phaseOptions.length === 0) {
      ctx.toast("请先配置阶段");
      return;
    }
    if (!g && gateSkuOptions.length === 0) {
      ctx.toast("目录内 SKU 均已配置上架门");
      return;
    }
    const gatePhaseOptions = g?.phase && !phaseOptions.includes(g.phase) ? [g.phase, ...phaseOptions] : phaseOptions;
    const gatePhaseLabels = Object.fromEntries(gatePhaseOptions.map((phaseId) => [phaseId, phaseLabel(phaseId)]));
    ctx.openActionConfirm({
      name: g ? `编辑上架门 · ${g.name}` : "新增上架门",
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
        ? "修改发布月 / 阶段 / 设备资格 / 强制提前开放,保存后影响发布判断"
        : "为 SKU 新增分批上架规则,新增后进入发布时点表",
      amplify: !!g?.forceUnlock,
    });
  };
  const archiveGate = (g: E1GenerationRelease) =>
    ctx.openActionConfirm({
      name: `移除上架门 · ${g.name}`,
      op: "generation-gate-archive",
      generationGateId: g.id,
      businessForm: { kind: "destructive-reason", target: g.name, impact: "该 SKU 将从发布时点表移除,用户端上架门不会再读取这条配置。" },
      detail: "归档这条发布规则,不物理删除,便于审计和恢复",
      amplify: false,
    });

  return (
    <>
      <EStats items={[
        { k: "SKU GMV(累计)", v: compactUsd(catalogGmv), sub: `${soldUnits.toLocaleString()} 台销量` },
        { k: "在售 SKU", v: onSale, sub: `+ ${pending} 个待确认`, tone: "ok" },
        { k: "节奏门管控 SKU", v: gateManaged, sub: "Pro v2 · Rack P2 分批上架", tone: "cyan" },
        { k: "门控 SKU", v: gated, sub: "解锁需阶段推进", tone: "warn" },
      ]} />
      {ctx.e1Loading && <div className="tint tiny" style={{ marginBottom: 12 }}>E1 数据同步中...</div>}
      {ctx.e1Error && <div className="tint warn tiny" style={{ marginBottom: 12 }}>E1 后端数据读取失败,页面保持空态({ctx.e1Error})</div>}

      {/* 1. 上架节奏门 timeline */}
      {hasPhaseConfig ? (
        <div className="phase-bar">
          <div className="lbl">
            <span className="h">上架节奏门 · 阶段联动</span>
            <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>门控随阶段推进自动开放 · 按后台配置生效</span>
            <span className="now"><span className="d" />当前 {phaseLabel(phaseCur)} · {proV2Label}</span>
            <span className="now">置换侧抢先购:{earlyEnabled === "开" ? `开 · 提前 ${earlyLead} 天` : "关"}<button style={{ marginLeft: 8 }} onClick={adjEarlyAccess}>调整</button></span>
          </div>
          <div className="phase-track" style={{ ["--phase-line" as string]: phaseLine } as CSSProperties}>
            {phases.map((ph, i) => {
              const st = i < curIdx ? "done" : i === curIdx ? "cur" : "lock";
              return (
                <div key={ph.p} className={`phase ${st}`}>
                  <div className="dot">{i + 1}</div>
                  <div className="nm">{ph.label || ph.p}</div>
                  <div className="skus">{[ph.meta, ph.skus].filter(Boolean).join(" · ") || "未配置说明"}</div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="phase-bar">
          <div className="lbl">
            <span className="h">上架节奏门 · 阶段联动</span>
            <span style={{ fontSize: 11.5, color: "var(--danger)" }}>E1 阶段配置缺失或当前阶段不匹配</span>
            <span className="now"><span className="d" />等待后端配置</span>
          </div>
          <div className="tint warn tiny" style={{ marginTop: 12 }}>
            未读取到有效阶段顺序 / 阶段列表 / 当前阶段。请检查阶段配置和当前阶段设置。
          </div>
        </div>
      )}

      {/* 2. 阶段配置 */}
      <div className="genrel">
        <div className="genrel-h">
          <span className="ttl">阶段配置</span>
          <span className="sub">· SKU 解锁阶段 / 上架门发布阶段的唯一来源</span>
          <span className="r"><CodeTag tone="electric">阶段规则</CodeTag><span>{enabledPhaseCount} 条启用</span></span>
          <button className="f-cta" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => openPhaseEditor()}>+ 新增阶段</button>
        </div>
        <div className="phasecfg-table">
          <div className="hd">
            <div className="c">阶段名称</div><div className="c">当前阶段</div><div className="c optional">门槛说明</div><div className="c optional">SKU 标签</div>
            <div className="c optional">排序</div><div className="c optional">状态</div><div className="c">动作</div>
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
                <div className="c phase-name ellipsis">{ph.label || ph.p}</div>
                <div className="c">{isCurrentPhase ? <span className="phaseNow"><span className="dot" />当前</span> : <span className="muted">—</span>}</div>
                <div className="c optional ellipsis">{ph.meta || "—"}</div>
                <div className="c optional ellipsis">{ph.skus || "—"}</div>
                <div className="c optional mono">{ph.sortOrder ?? 0}</div>
                <div className="c optional"><Badge tone={ph.status === "active" ? "ok" : "neutral"}>{phaseStatusLabel(ph.status)}</Badge></div>
                <div className="c acts">
                  {isCurrentPhase ? (
                    <button disabled>当前</button>
                  ) : (
                    <button className="brand" onClick={() => setCurrentPhase(ph)}>设为当前</button>
                  )}
                  <button onClick={() => openPhaseEditor(ph)}>编辑</button>
                  <button className="danger" disabled={isCurrentPhase} title={isCurrentPhase ? "当前阶段不能删除" : undefined} onClick={() => archivePhase(ph)}>删除</button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="genrel-foot">
          <span><b>阶段名称</b> 面向运营和页面展示;内部 ID 由系统维护,不需要手动填写。</span>
          <span className="sep">·</span>
          <span><b>当前阶段</b> 可手动设置,发布门状态跟随后端当前阶段刷新。</span>
          <span className="sep">·</span>
          <span><b>删除保护</b> 当前阶段、SKU 或上架门仍引用时后端拒绝删除。</span>
        </div>
      </div>

      {/* 3. 分批上架发布时点表 */}
      <div className="genrel">
        <div className="genrel-h">
          <span className="ttl">分批上架发布时点</span>
          <span className="sub">· 发布月是发布门原子 · 控制 SKU 从待发布到已开放</span>
          <span className="r"><CodeTag tone="electric">发布计划</CodeTag><span>平台月龄 M{platformMonth || "未配置"} · {phaseCur ? phaseLabel(phaseCur) : "阶段未配置"}</span></span>
          <button className="f-cta" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => openGateEditor()}>+ 新增上架门</button>
        </div>
        <div className="genrel-table">
          <div className="hd">
            <div className="c">SKU</div><div className="c">计划发布</div><div className="c">当前状态</div><div className="c">阶段</div>
            <div className="c">距发布</div><div className="c">设备资格</div><div className="c">动作</div>
          </div>
          {releases.length === 0 && (
            <div className="rw">
              <div className="c" style={{ gridColumn: "1 / -1", color: "var(--ink-3)" }}>暂无上架门配置</div>
            </div>
          )}
          {releases.map((g) => {
            const offset = g.phaseOffset ?? 0;
            const gateState = gateReadiness(g);
            const unlocked = gateState.unlocked; // 与顶部 Pro v2 标同源,消除口径冲突
            const cdCls = unlocked ? "ok" : (!gateState.eligibilityReady || !gateState.phaseReached || gateState.effectiveMonth - platformMonth <= 1) ? "warn" : "";
            const cdTxt = gateCountdownLabel(gateState);
            const relLbl = `月 ${g.releaseMonth}` + (offset ? (offset > 0 ? ` (+${offset})` : ` (${offset})`) : "");
            const forceHint = !gateState.eligibilityReady
              ? "需先补录设备资格后才能提前开放"
              : !gateState.phaseReached
                ? `需先推进到 ${phaseLabel(g.phase)} 阶段后才能提前开放`
                : "强制提前开放,仅绕过平台月龄门";
            return (
              <div className="rw" key={g.id}>
                <div className="c sku">{g.name}<span className="id">{g.id}</span></div>
                <div className="c mono">{relLbl}</div>
                <div className="c"><span className={`st ${unlocked ? "active" : "coming"}`} title={unlocked ? (g.forceUnlock ? "阶段 / 设备资格已满足,月龄由强制提前开放绕过" : "阶段 / 月龄 / 设备资格均满足") : gateBlockerLabel(gateState)}>{unlocked ? "已开放" : "待发布"}</span></div>
                <div className="c"><span className="phaseChip">{phaseLabel(g.phase)}</span></div>
                <div className="c"><span className={`countdown ${cdCls}`}>{cdTxt}</span></div>
                <div className="c"><span className={`elg ${g.eligibility ? "ok" : "miss"}`}><span className="dot" />{g.eligibility ? "已配置" : "未补录"}</span></div>
                <div className="c acts">
                  <button onClick={() => openGateEditor(g)}>编辑</button>
                  {unlocked ? (
                    <>
                      <button onClick={() => genShift(g, offset, 1)}>推迟 1M</button>
                      {g.forceUnlock ? <button className="warn" onClick={() => genForceLock(g)}>撤销强制</button> : <button disabled title="该 SKU 是按阶段 / 设备资格 / 月龄自然开放,没有强制状态可撤销">自然开放</button>}
                    </>
                  ) : (
                    <>
                      <button onClick={() => genShift(g, offset, -1)}>提前 1M</button>
                      <button onClick={() => genShift(g, offset, 1)}>延迟 1M</button>
                      {g.forceUnlock
                        ? <button className="warn" onClick={() => genForceLock(g)}>撤销强制</button>
                        : <button className="brand" title={forceHint} onClick={() => genForceUnlock(g)}>强制提前开放</button>}
                    </>
                  )}
                  <button className="danger" onClick={() => archiveGate(g)}>移除</button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="genrel-foot">
          <span><b>发布规则</b> · 挂上架门的 SKU 从待发布到已开放,需同时满足当前阶段已到达 + 平台月龄已到 + 设备资格已配置</span>
          <span className="sep">·</span>
          <span><b>强制提前开放</b> 仅绕过月龄门,不绕过 Phase / E5 · 提前 / 延迟 / 撤销均走操作确认</span>
        </div>
      </div>

      {/* 3. SKU 4 卡 matrix */}
      <div className="sku-grid">
        {skus.map((s) => {
          const st = s.status || "on";
          const open = phaseIdx(s.unlock) >= 0 && phaseIdx(s.unlock) <= curIdx;
          const isShare = s.tier === "Share";
          return (
            <div key={s.name} className={`sku-card${st === "off" ? " off" : ""}`}>
              <div className="img">
                {s.badge ? <span className={`badge ${badgeClass(s.tier)}`}>{s.badge}</span> : null}
                <div className="ph">
                  <SkuMediaThumb sku={s} />
                </div>
              </div>
              <div className="body">
                <div className="top">
                  <div className="l">
                    <div className="nm">{s.name}</div>
                    {s.tagline ? <div className="tagline">{s.tagline}</div> : null}
                  </div>
                  <div className="r">
                    <div className="px">${s.price.toLocaleString()}</div>
                    <div className="yld">{yld(s)}</div>
                  </div>
                </div>
                <div className="spec">
                  <div className="it"><span className="k">GPU</span><span className="v">{s.gpu || "—"}</span></div>
                  <div className="it"><span className="k">显存</span><span className="v">{s.vram || "—"}</span></div>
                  <div className="it"><span className="k">DC</span><span className="v">{s.datacenter || "—"}</span></div>
                  <div className="it"><span className="k">算力池</span><span className="v">{unlockPoolName(s.aiUnlocks)}</span></div>
                </div>
                <div className="meta">
                  {s.sold != null && <span className="sold">{s.sold.toLocaleString()} 售</span>}
                  <span className={`gate ${open ? "open" : "gated"}`}>{phaseLabel(s.unlock)} · {open ? "已开放" : "门控"}</span>
                  {s.purchaseGate && (() => {
                    const g = s.purchaseGate;
                    const parts: string[] = [];
                    if (g.rankMin != null) parts.push(`V≥${g.rankMin}`);
                    if (g.activeDirectMin != null) parts.push(`${g.activeDirectMin}直推`);
                    if (g.teamVolumeMin != null) parts.push(`$${Math.round(g.teamVolumeMin / 1000)}K业绩`);
                    const cond = parts.join(g.mode === "either" ? "/" : "+");
                    const remaining = gateRemaining(g);
                    const txt = `购买门${cond ? " " + cond : ""}${remaining != null ? ` · 余${remaining}` : ""}`;
                    return <Badge tone={g.enforce ? "warn" : "neutral"}>{txt}</Badge>;
                  })()}
                  <span className="stk">库存 {s.stock}</span>
                </div>
                <div className="acts">
                  <button className="primary" onClick={() => ctx.openSku(s.name)}>改价 / 编辑</button>
                  <button onClick={() => ctx.openActionConfirm({ name: st === "on" ? `下架 SKU · ${s.name}` : `上架 SKU · ${s.name}`, op: "sku-status", target: s.name, status: st === "on" ? "off" : "on", detail: st === "on" ? "下架后从商城隐藏,不影响已售设备结算" : "上架后对用户可见", amplify: false })}>{st === "on" ? "下架" : "上架"}</button>
                  <button className="danger" onClick={() => ctx.delSku(s.name)}>删除</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="f-foot">SKU 卡片 = 前端商品卡片全字段镜像；前端商城与运营后台共享同一后端权威 SKU 配置，任何上下架 / 改价 / 库存调整<b>立即对前端商城生效</b>。</p>
    </>
  );
}
