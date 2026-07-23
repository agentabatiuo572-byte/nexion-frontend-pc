"use client";

/**
 * H7 代金券配置 — 运营创建 / 编辑 / 上下架 / 删除领券促销。
 * 真渲染面(H ∈ PORTED_DOMAINS · registry content 死代码)。
 *
 * 真写后端 growth/vouchers 接口。OpsVoucher 是前端 VoucherDef 的结构化超集
 * (字段级镜像门:后台可编辑 ⊇ 前端展示)。增/编辑走 OperationConfirmModal 的
 * businessForm "voucher-config"(当前值预填 = 显式 before→after);上下架/删除为纯处置(不传 businessForm/edit)。
 * 代金券是促销折扣、非 NEX 负债 → 不挂 amplifies / B1 红线(与 H2 试用折扣同口径)。
 */
import { useEffect, useState } from "react";
import {
  createH7Voucher,
  deleteH7Voucher,
  fetchH7Vouchers,
  updateH7Voucher,
  updateH7VoucherStatus,
} from "@/lib/admin/h-client";
import type { HCtx } from "./types";

const SURFACE_LABEL: Record<string, string> = { home: "首页", store: "商城", me: "我的", earn: "收益" };

type OpsSku = {
  id?: string;
  name: string;
  status?: string;
};

type OpsVoucher = {
  id: string;
  name: string;
  type: "fixed" | "percent";
  amountUSD?: number;
  percent?: number;
  minPurchaseUSD?: number;
  maxDiscountUSD?: number;
  applicableSkus: string[];
  audience: "new" | "all";
  startAt: number;
  endAt: number;
  claimSurfaces: string[];
  popupEnabled: boolean;
  stackWithTrial: boolean;
  stackWithOthers: boolean;
  splittable: boolean;
  status: "active" | "paused";
};

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
  const { toast, openActionConfirm } = ctx;
  const [data, setData] = useState<{ vouchers: OpsVoucher[]; skus: OpsSku[]; stats?: Record<string, number> }>({
    vouchers: [],
    skus: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyResponse = (payload: Record<string, any>) => {
    setData({
      vouchers: Array.isArray(payload.vouchers) ? payload.vouchers : [],
      skus: Array.isArray(payload.skus) ? payload.skus : [],
      stats: payload.stats ?? undefined,
    });
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchH7Vouchers()
      .then((payload) => {
        if (!alive) return;
        applyResponse(payload);
        setError(null);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "H7_VOUCHER_LOAD_FAILED");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  const reload = async () => {
    setLoading(true);
    try {
      applyResponse(await fetchH7Vouchers());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "H7_VOUCHER_LOAD_FAILED");
    } finally {
      setLoading(false);
    }
  };

  const list = data.vouchers;
  // 适用 SKU 下拉选项 = 后端返回的在售 SKU;value=产品 id(对齐前端 applicableSkus),label=中文名(运营友好)。
  const skuList = data.skus;
  const activeSkus = skuList.filter((s) => (s.status || "on") === "on");
  const skuOptions = activeSkus.map((s) => s.id ?? s.name);
  const skuLabels: Record<string, string> = Object.fromEntries(activeSkus.map((s) => [s.id ?? s.name, s.name]));

  const total = data.stats?.total ?? list.length;
  const activeN = data.stats?.active ?? list.filter((v) => v.status === "active").length;
  const pausedN = data.stats?.paused ?? list.filter((v) => v.status === "paused").length;
  const popupN = data.stats?.popup ?? list.filter((v) => v.popupEnabled && v.status === "active").length;

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
      run: async (reason, _v, bv) => {
        if (!bv) return;
        const id = `vc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const next = parseVoucher(bv, id);
        applyResponse(await createH7Voucher(next, reason));
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
      run: async (reason, _v, bv) => {
        if (!bv) return;
        const next = parseVoucher(bv, v.id);
        applyResponse(await updateH7Voucher(v.id, next, reason));
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
      run: async (reason) => {
        applyResponse(await updateH7VoucherStatus(v.id, next, reason));
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
      run: async (reason) => {
        applyResponse(await deleteH7Voucher(v.id, reason));
        toast(`· ${v.name} 已删除`);
      },
    });
  };

  if (loading) return <section className="l-card"><div className="l-b">H7 数据加载中...</div></section>;
  if (error) return (
    <section className="l-card">
      <div className="l-h"><span className="ttl">H7 数据加载失败</span></div>
      <div className="l-b">{error} · 为避免误操作，新增和编辑功能已关闭。<button className="l-btn sm" style={{ marginLeft: 8 }} onClick={() => void reload()}>重试</button></div>
    </section>
  );

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
            <b>全端同一规则</b> · 代金券上下架或改参后，领取入口和首页活动位会按同一服务端配置生效。代金券属于促销折扣，不计入 NEX 兑付负债。
          </div>
        </div>
      </section>
    </>
  );
}

export default H7VoucherConfig;
