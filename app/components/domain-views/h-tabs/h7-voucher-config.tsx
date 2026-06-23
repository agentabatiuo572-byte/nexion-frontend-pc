"use client";

/**
 * H7 代金券配置 — 运营创建 / 编辑 / 上下架 / 删除领券促销。
 * 真渲染面(H ∈ PORTED_DOMAINS · registry content 死代码)。
 *
 * 真写 store:usePlatformConfig.vouchers(OpsVoucher[]) + ensure/add/update/setStatus/remove,
 * persist nexion-admin-platform-v1。OpsVoucher 是前端 VoucherDef 的结构化超集
 * (字段级镜像门:后台可编辑 ⊇ 前端展示)。增/编辑走 OperationConfirmModal 的
 * businessForm "voucher-config"(当前值预填 = 显式 before→after);上下架/删除为纯处置(不传 businessForm/edit)。
 * 代金券是促销折扣、非 NEX 负债 → 不挂 amplifies / B1 红线(与 H2 试用折扣同口径)。
 */
import { useEffect } from "react";
import { usePlatformConfig, type OpsVoucher, type OpsSku } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { VOUCHER_SEED } from "@/lib/mock/admin/vouchers";
import { SKUS } from "@/lib/mock/admin/design-data";
import type { HCtx } from "./types";

const SURFACE_LABEL: Record<string, string> = { home: "首页", store: "商城", me: "我的", earn: "收益" };

// UTC getters — stored ms are UTC midnights (seed uses Date.UTC; toMs parses
// date-only strings as UTC per ES spec), so the round-trip stays TZ-stable
// (a negative-offset operator would otherwise see the date drift one day).
function fmtDate(ms: number): string {
  if (!ms) return "长期";
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function toDateInput(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function toMs(date: string): number {
  if (!date) return 0;
  const ms = Date.parse(date);
  return Number.isFinite(ms) ? ms : 0;
}
function valueText(v: OpsVoucher): string {
  return v.type === "fixed" ? `满减 $${v.amountUSD ?? 0}` : `${v.percent ?? 0}% 折扣`;
}
function condText(v: OpsVoucher): string {
  if (v.type === "fixed") return (v.minPurchaseUSD ?? 0) > 0 ? `满 $${v.minPurchaseUSD}` : "无门槛";
  return (v.maxDiscountUSD ?? 0) > 0 ? `封顶 $${v.maxDiscountUSD}` : "不封顶";
}
function scopeText(v: OpsVoucher): string {
  if (v.applicableSkus.length === 0) return "全设备";
  if (v.applicableSkus.length === 1) return v.applicableSkus[0];
  return `${v.applicableSkus.length} 个 SKU`;
}
function surfacesText(v: OpsVoucher): string {
  return v.claimSurfaces.map((s) => SURFACE_LABEL[s] ?? s).join(" / ") || "—";
}

/** businessValue → OpsVoucher(逗号串拆 SKU/入口 · 日期转 ms · 数值清洗)。 */
function parseVoucher(bv: Record<string, string>, id: string): OpsVoucher {
  const type: OpsVoucher["type"] = bv.type === "percent" ? "percent" : "fixed";
  const skus = (bv.applicableSkus ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const surfaces = (bv.claimSurfaces ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    id,
    name: bv.name ?? "",
    type,
    amountUSD: type === "fixed" ? Number(bv.amountUSD) || 0 : undefined,
    percent: type === "percent" ? Number(bv.percent) || 0 : undefined,
    minPurchaseUSD: Number(bv.minPurchaseUSD) || 0,
    maxDiscountUSD: Number(bv.maxDiscountUSD) || 0,
    applicableSkus: skus,
    audience: bv.audience === "new" ? "new" : "all",
    startAt: toMs(bv.startDate),
    endAt: toMs(bv.endDate),
    claimSurfaces: surfaces,
    popupEnabled: bv.popupEnabled !== "false",
    stackWithTrial: bv.stackWithTrial === "true",
    stackWithOthers: bv.stackWithOthers === "true",
    splittable: bv.splittable === "true",
    status: bv.status === "paused" ? "paused" : "active",
  };
}

export function H7VoucherConfig({ ctx }: { ctx: HCtx }) {
  const hydrated = useOpsHydrated();
  const vouchers = usePlatformConfig((s) => s.vouchers);
  const ensureVouchers = usePlatformConfig((s) => s.ensureVouchers);
  const addVoucher = usePlatformConfig((s) => s.addVoucher);
  const updateVoucher = usePlatformConfig((s) => s.updateVoucher);
  const setVoucherStatus = usePlatformConfig((s) => s.setVoucherStatus);
  const removeVoucher = usePlatformConfig((s) => s.removeVoucher);
  const skus = usePlatformConfig((s) => s.skus);
  const ensureSkus = usePlatformConfig((s) => s.ensureSkus);
  const { toast, openActionConfirm, logAudit } = ctx;

  useEffect(() => { ensureVouchers(VOUCHER_SEED); ensureSkus(SKUS as OpsSku[]); }, [ensureVouchers, ensureSkus]);

  // 首帧 / SSR 用 seed(与服务端一致,防 hydration 抖动);hydrate 后用真 store。
  const list = hydrated && vouchers ? vouchers : VOUCHER_SEED;
  // 适用 SKU 下拉选项 = 现存上架(status=on)SKU;value=产品 id(对齐前端 applicableSkus),label=中文名(运营友好)。
  const skuList = hydrated && skus ? skus : (SKUS as OpsSku[]);
  const activeSkus = skuList.filter((s) => (s.status || "on") === "on");
  const skuOptions = activeSkus.map((s) => s.id ?? s.name);
  const skuLabels: Record<string, string> = Object.fromEntries(activeSkus.map((s) => [s.id ?? s.name, s.name]));

  const total = list.length;
  const activeN = list.filter((v) => v.status === "active").length;
  const pausedN = list.filter((v) => v.status === "paused").length;
  const popupN = list.filter((v) => v.popupEnabled && v.status === "active").length;

  const openAdd = () => {
    openActionConfirm({
      action: "新增代金券",
      detail: (
        <>
          新增一张领券促销:满减 / 折扣、门槛、适用 SKU、受众、有效期、领取入口。
          <b>代金券是促销折扣、非 NEX 负债,不挂 B1 红线</b>;适用 SKU 留空 = 全设备(领券跳商城),单个 = 跳该 SKU 详情页。
        </>
      ),
      businessForm: {
        kind: "voucher-config",
        subject: "新代金券",
        applicableSkuOptions: skuOptions,
        applicableSkuLabels: skuLabels,
        currentType: "fixed",
        currentAudience: "all",
        currentStatus: "active",
        currentPopupEnabled: "true",
        currentStackWithTrial: "false",
        currentStackWithOthers: "false",
        currentSplittable: "false",
      },
      run: (reason, _v, bv) => {
        if (!bv) return;
        const id = `vc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const next = parseVoucher(bv, id);
        addVoucher(next);
        logAudit({ actor: "总管理员", action: "新增代金券", target: `voucher.${id}`, reason });
        toast(`· 代金券「${next.name}」已新增`);
      },
    });
  };

  const openEdit = (v: OpsVoucher) => {
    openActionConfirm({
      action: `编辑代金券 · ${v.name}`,
      detail: (
        <>
          <b>{v.name}</b> · 多字段编辑:类型 / 面值 / 门槛 / 适用 SKU / 受众 / 有效期 / 领取入口 / 弹窗。
          当前值已预填(改前可见 before→after);促销折扣非负债,不挂 B1。
        </>
      ),
      businessForm: {
        kind: "voucher-config",
        subject: v.name,
        applicableSkuOptions: skuOptions,
        applicableSkuLabels: skuLabels,
        currentName: v.name,
        currentType: v.type,
        currentAmountUSD: v.amountUSD != null ? String(v.amountUSD) : "",
        currentPercent: v.percent != null ? String(v.percent) : "",
        currentMinPurchaseUSD: v.minPurchaseUSD != null ? String(v.minPurchaseUSD) : "",
        currentMaxDiscountUSD: v.maxDiscountUSD != null ? String(v.maxDiscountUSD) : "",
        currentApplicableSkus: v.applicableSkus.join(","),
        currentClaimSurfaces: v.claimSurfaces.join(","),
        currentAudience: v.audience,
        currentStatus: v.status,
        currentStartDate: toDateInput(v.startAt),
        currentEndDate: toDateInput(v.endAt),
        currentPopupEnabled: v.popupEnabled ? "true" : "false",
        currentStackWithTrial: v.stackWithTrial ? "true" : "false",
        currentStackWithOthers: v.stackWithOthers ? "true" : "false",
        currentSplittable: v.splittable ? "true" : "false",
      },
      run: (reason, _v, bv) => {
        if (!bv) return;
        const next = parseVoucher(bv, v.id);
        updateVoucher(v.id, next);
        logAudit({ actor: "总管理员", action: "编辑代金券", target: `voucher.${v.id}`, reason });
        toast(`· 代金券「${next.name}」已更新`);
      },
    });
  };

  const openToggle = (v: OpsVoucher) => {
    const next = v.status === "active" ? "paused" : "active";
    const label = next === "active" ? "投放" : "暂停";
    openActionConfirm({
      action: `${label}代金券 · ${v.name}`,
      detail: (
        <>
          <b>{v.name}</b> · 当前 {v.status === "active" ? "投放中" : "已暂停"} · {label}动作:
          {next === "paused" ? "暂停后前端不再展示领券入口与弹窗,已领不回收。" : "投放后前端恢复展示。"}
          {" "}操作确认留痕。
        </>
      ),
      run: (reason) => {
        setVoucherStatus(v.id, next);
        logAudit({ actor: "总管理员", action: `${label}代金券`, target: `voucher.${v.id}`, reason });
        toast(`· ${v.name} 已${label}`);
      },
    });
  };

  const openDelete = (v: OpsVoucher) => {
    openActionConfirm({
      action: `删除代金券 · ${v.name}`,
      detail: (
        <>
          <b>{v.name}</b> · 从代金券列表<b>永久移除</b>,已领不回收;生效即时。临时下线建议改用「暂停」。操作确认留痕。
        </>
      ),
      run: (reason) => {
        removeVoucher(v.id);
        logAudit({ actor: "总管理员", action: "删除代金券", target: `voucher.${v.id}`, reason });
        toast(`· ${v.name} 已删除`);
      },
    });
  };

  return (
    <>
      {/* 顶部 KPI */}
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">代金券总数</div>
          <div className="v">{total}</div>
          <div className="sub">满减 + 折扣两类</div>
        </div>
        <div className="f-stat ok">
          <div className="k">投放中</div>
          <div className="v">{activeN}</div>
          <div className="sub">前端可领</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">参与首页弹窗</div>
          <div className="v">{popupN}</div>
          <div className="sub">进站自动弹出领取</div>
        </div>
        <div className="f-stat dim">
          <div className="k">已暂停</div>
          <div className="v">{pausedN}</div>
          <div className="sub">前端不展示</div>
        </div>
      </div>

      <section className="l-card" data-proof="h7-voucher-config">
        <div className="l-h">
          <span className="ttl">代金券列表</span>
          <span className="sub">· 满减 / 折扣 · 名称 / 参数 / 适用 SKU / 受众 / 有效期 / 领取入口全部可配 · 改值经操作确认(当前值预填 before→after)</span>
          <div className="r">
            <button className="l-btn sm mc" onClick={openAdd}>+ 新增代金券</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 960 }}>
            <thead>
              <tr>
                <th>名称</th>
                <th>类型 / 面值</th>
                <th>条件</th>
                <th>适用</th>
                <th>受众</th>
                <th>有效期</th>
                <th>领取入口</th>
                <th>弹窗</th>
                <th>状态</th>
                <th style={{ textAlign: "right" }}>动作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((v) => {
                const isActive = v.status === "active";
                return (
                  <tr key={v.id}>
                    <td style={{ fontWeight: 600, color: isActive ? "var(--ink)" : "var(--ink-3)" }}>{v.name}</td>
                    <td className="mono" style={{ fontWeight: 700, color: isActive ? undefined : "var(--ink-3)" }}>{valueText(v)}</td>
                    <td style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{condText(v)}</td>
                    <td style={{ fontSize: 11.5 }}>{scopeText(v)}</td>
                    <td><span className={`bdg ${v.audience === "new" ? "cyan" : "dim"}`}>{v.audience === "new" ? "新人" : "全部"}</span></td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{v.endAt ? `至 ${fmtDate(v.endAt)}` : "长期"}</td>
                    <td style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{surfacesText(v)}</td>
                    <td><span className={`bdg ${v.popupEnabled ? "ok" : "dim"}`}>{v.popupEnabled ? "弹窗" : "否"}</span></td>
                    <td><span className={`bdg ${isActive ? "ok" : "dim"}`}>{isActive ? "投放中" : "已暂停"}</span></td>
                    <td style={{ textAlign: "right" }}>
                      <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                        <button className="l-btn sm mc" onClick={() => openEdit(v)}>编辑</button>
                        <button className="l-btn sm mc" aria-label={`${isActive ? "暂停" : "投放"} ${v.name}`} onClick={() => openToggle(v)}>{isActive ? "暂停" : "投放"}</button>
                        <button className="l-btn sm mc" style={{ color: "var(--danger)" }} aria-label={`删除代金券 · ${v.name}`} onClick={() => openDelete(v)}>删除</button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="htint" style={{ fontSize: 12 }}>
            <b>前后端同契约</b> · 本表的 OpsVoucher 是前端 VoucherDef 的结构化超集,任何上下架 / 改参 <b>立即对前端领券弹窗与 banner 生效</b>(mock 原型两端各自 store,真后台对接时映射同一资源)。代金券是促销折扣、非 NEX 负债,不走 B1 兑付红线。
          </div>
        </div>
      </section>
    </>
  );
}

export default H7VoucherConfig;
