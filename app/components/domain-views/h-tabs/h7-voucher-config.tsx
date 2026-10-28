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
  revokeH7VoucherAvailableGrants,
  updateH7Voucher,
  updateH7VoucherStatus,
} from "@/lib/admin/h-client";
import type { HCtx } from "./types";
import { displayAdminError } from "@/lib/admin/error-messages";
import { catalogSkuBrandText } from "@/lib/admin/brand-copy";

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
  popupDelayMs: number;
  popupCooldownHours: number;
  popupMaxPerSession: number;
  popupCadenceEnabled: boolean;
  stackWithTrial: boolean;
  stackWithOthers: boolean;
  splittable: boolean;
  issuanceLimit: number;
  version: number;
  issuedCount: number;
  availableCount: number;
  redeemedCount: number;
  revokedCount: number;
  batchCount: number;
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
function scopeText(v: OpsVoucher, labels: Record<string,string>): string {
  if (v.applicableSkus.length === 0) return "全设备";
  if (v.applicableSkus.length === 1) return labels[v.applicableSkus[0]] ?? "指定商品（已不在当前目录）";
  return `${v.applicableSkus.length} 个商品`;
}
function surfacesText(v: OpsVoucher): string {
  return v.claimSurfaces.map((s) => SURFACE_LABEL[s] ?? "其他页面").join(" / ") || "不限入口";
}

/** businessValue → OpsVoucher(逗号串拆 SKU/入口 · 日期转 ms · 数值清洗)。 */
function parseVoucher(bv: Record<string, string>, id: string, version = 1): OpsVoucher {
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
    popupDelayMs: Number.isFinite(Number(bv.popupDelayMs)) ? Number(bv.popupDelayMs) : 1300,
    popupCooldownHours: Number.isFinite(Number(bv.popupCooldownHours)) ? Number(bv.popupCooldownHours) : 24,
    popupMaxPerSession: Number.isFinite(Number(bv.popupMaxPerSession)) ? Number(bv.popupMaxPerSession) : 1,
    popupCadenceEnabled: bv.popupCadenceEnabled !== "false",
    stackWithTrial: bv.stackWithTrial === "true",
    stackWithOthers: bv.stackWithOthers === "true",
    splittable: bv.splittable === "true",
    issuanceLimit: Number(bv.issuanceLimit) || 0,
    version,
    issuedCount: 0,
    availableCount: 0,
    redeemedCount: 0,
    revokedCount: 0,
    batchCount: 0,
    status: bv.status === "paused" ? "paused" : "active",
  };
}

function parseServerVoucher(raw: unknown): OpsVoucher {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("H7_VOUCHER_RESPONSE_INVALID");
  const row = raw as Record<string, unknown>;
  const number = (key: string) => {
    const value = Number(row[key]);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`H7_VOUCHER_RESPONSE_INVALID:${key}`);
    return value;
  };
  const cadenceNumber = (key: string, min: number, max: number) => {
    const value = number(key);
    if (value < min || value > max) throw new Error(`H7_VOUCHER_CADENCE_INVALID:${key}`);
    return value;
  };
  const status = row.status === "active" || row.status === "paused" ? row.status : null;
  if (typeof row.id !== "string" || !row.id.trim()
      || typeof row.name !== "string" || !row.name.trim()
      || (row.type !== "fixed" && row.type !== "percent")
      || !Array.isArray(row.applicableSkus)
      || !Array.isArray(row.claimSurfaces)
      || (row.audience !== "new" && row.audience !== "all")
      || !status) {
    throw new Error("H7_VOUCHER_RESPONSE_INVALID");
  }
  return {
    ...(row as unknown as OpsVoucher),
    id: row.id.trim(),
    name: row.name.trim(),
    type: row.type,
    applicableSkus: row.applicableSkus.map(String),
    claimSurfaces: row.claimSurfaces.map(String),
    audience: row.audience,
    status,
    startAt: number("startAt"),
    endAt: number("endAt"),
    issuanceLimit: number("issuanceLimit"),
    version: number("version"),
    issuedCount: number("issuedCount"),
    availableCount: number("availableCount"),
    redeemedCount: number("redeemedCount"),
    revokedCount: number("revokedCount"),
    batchCount: number("batchCount"),
    popupDelayMs: cadenceNumber("popupDelayMs", 0, 60000),
    popupCooldownHours: cadenceNumber("popupCooldownHours", 0, 720),
    popupMaxPerSession: cadenceNumber("popupMaxPerSession", 1, 10),
    popupCadenceEnabled: row.popupCadenceEnabled !== false,
  };
}

export function H7VoucherConfig({ ctx }: { ctx: HCtx }) {
  const { toast, openActionConfirm } = ctx;
  const canWrite = ctx.can("growth_h7_write");
  const [data, setData] = useState<{ vouchers: OpsVoucher[]; skus: OpsSku[]; stats?: Record<string, number> }>({
    vouchers: [],
    skus: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyResponse = (payload: Record<string, any>) => {
    if (!Array.isArray(payload.vouchers) || !Array.isArray(payload.skus)) {
      throw new Error("H7_VOUCHER_RESPONSE_INVALID");
    }
    setData({
      vouchers: payload.vouchers.map(parseServerVoucher),
      skus: payload.skus,
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
        setError(displayAdminError(err));
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
      setError(displayAdminError(err));
    } finally {
      setLoading(false);
    }
  };

  const list = data.vouchers;
  // 适用 SKU 下拉选项 = 后端返回的在售 SKU;value=产品 id(对齐前端 applicableSkus),label=中文名(运营友好)。
  const skuList = data.skus;
  const activeSkus = skuList.filter((s) => (s.status || "on") === "on");
  const skuOptions = activeSkus.map((s) => s.id ?? s.name);
  const skuLabels: Record<string, string> = Object.fromEntries(activeSkus.map((s) => [s.id ?? s.name, catalogSkuBrandText(s.id, s.name)]));

  const total = data.stats?.total ?? list.length;
  const activeN = data.stats?.active ?? list.filter((v) => v.status === "active").length;
  const pausedN = data.stats?.paused ?? list.filter((v) => v.status === "paused").length;
  const popupN = data.stats?.popup ?? list.filter((v) => v.popupEnabled && v.popupCadenceEnabled && v.status === "active").length;

  const openAdd = () => {
    openActionConfirm({
      action: "新增代金券",
      detail: (
        <>
          新增一张代金券：满减或折扣、使用门槛、适用商品、发给谁、有效期、在哪领。
          <b>代金券只抵扣订单价格，不增加平台应付款，也不受覆盖率限制</b>。适用商品不选 = 全部设备（领券后跳商城）；只选一个 = 跳该商品详情页。
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
        currentPopupCadenceEnabled: "true",
        currentPopupDelayMs: "1300",
        currentPopupCooldownHours: "24",
        currentPopupMaxPerSession: "1",
        currentStackWithTrial: "false",
        currentStackWithOthers: "false",
        currentSplittable: "false",
        currentIssuanceLimit: "0",
      },
      run: async (reason, _v, bv) => {
        if (!bv) return;
        const id = `vc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const next = parseVoucher(bv, id);
        applyResponse(await createH7Voucher(next, reason));
        toast(`代金券「${next.name}」已新增`);
      },
    });
  };

  const openEdit = (v: OpsVoucher) => {
    openActionConfirm({
      action: `编辑代金券 · ${v.name}`,
      detail: (
        <>
          <b>{v.name}</b> · 可修改类型、面值、门槛、适用商品、发给谁、有效期、领取入口和弹窗。
          已填好当前值，修改前后对比可见。代金券不算平台负债，不受覆盖率限制。
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
        currentIssuanceLimit: String(v.issuanceLimit),
        currentApplicableSkus: v.applicableSkus.join(","),
        currentClaimSurfaces: v.claimSurfaces.join(","),
        currentAudience: v.audience,
        currentStatus: v.status,
        currentStartDate: toDateInput(v.startAt),
        currentEndDate: toDateInput(v.endAt),
        currentPopupEnabled: v.popupEnabled ? "true" : "false",
        currentPopupCadenceEnabled: v.popupCadenceEnabled ? "true" : "false",
        currentPopupDelayMs: String(v.popupDelayMs),
        currentPopupCooldownHours: String(v.popupCooldownHours),
        currentPopupMaxPerSession: String(v.popupMaxPerSession),
        currentStackWithTrial: v.stackWithTrial ? "true" : "false",
        currentStackWithOthers: v.stackWithOthers ? "true" : "false",
        currentSplittable: v.splittable ? "true" : "false",
      },
      run: async (reason, _v, bv) => {
        if (!bv) return;
        const next = parseVoucher(bv, v.id, v.version);
        applyResponse(await updateH7Voucher(v.id, next, reason, v.version));
        toast(`代金券「${next.name}」已更新`);
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
          {next === "paused" ? "暂停后 App 不再显示领券入口和弹窗，已领的不收回。" : "投放后 App 恢复显示。"}
        </>
      ),
      run: async (reason) => {
        applyResponse(await updateH7VoucherStatus(v.id, next, reason, v.version));
        toast(`${v.name} 已${label}`);
      },
    });
  };

  const openDelete = (v: OpsVoucher) => {
    openActionConfirm({
      action: `删除代金券 · ${v.name}`,
      detail: (
        <>
          <b>{v.name}</b> · 从代金券列表<b>永久删除</b>，马上生效，已领的不收回。临时下线建议用「暂停」。
        </>
      ),
      run: async (reason) => {
        applyResponse(await deleteH7Voucher(v.id, reason, v.version));
        toast(`${v.name} 已删除`);
      },
    });
  };

  const openRevoke = (v: OpsVoucher) => {
    openActionConfirm({
      action: `作废未使用的代金券 · ${v.name}`,
      detail: (
        <>
          <b>{v.name}</b> · 把 {v.availableCount} 张已领取但还没用的券全部作废。
          已使用的 {v.redeemedCount} 张不受影响。
        </>
      ),
      run: async (reason) => {
        applyResponse(await revokeH7VoucherAvailableGrants(v.id, reason, v.version));
        toast(`${v.name} 未使用的券已作废`);
      },
    });
  };

  if (loading) return <section className="l-card"><div className="l-b">代金券数据加载中…</div></section>;
  if (error) return (
    <section className="l-card">
      <div className="l-h"><span className="ttl">代金券数据加载失败</span></div>
      <div className="l-b">{error} · 为避免误操作，暂时不能新增和编辑。<button className="l-btn sm" style={{ marginLeft: 8 }} onClick={() => void reload()}>重试</button></div>
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
          <div className="sub">用户可以领</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">参与首页弹窗</div>
          <div className="v">{popupN}</div>
          <div className="sub">打开 App 自动弹出</div>
        </div>
        <div className="f-stat dim">
          <div className="k">已暂停</div>
          <div className="v">{pausedN}</div>
          <div className="sub">App 不显示</div>
        </div>
        <div className="f-stat">
          <div className="k">累计领取 / 使用</div>
          <div className="v">{list.reduce((sum, voucher) => sum + voucher.issuedCount, 0)} / {list.reduce((sum, voucher) => sum + voucher.redeemedCount, 0)}</div>
          <div className="sub">按实际领券和下单统计</div>
        </div>
      </div>

      <section className="l-card" data-proof="h7-voucher-config">
        <div className="l-h">
          <span className="ttl">代金券列表</span>
          <span className="sub">· 满减或折扣，所有设置都可以修改</span>
          <div className="r">
            <button className="l-btn sm mc" onClick={openAdd} disabled={!canWrite}>+ 新增代金券</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1320 }}>
            <thead>
              <tr>
                <th>名称</th>
                <th>类型 / 面值</th>
                <th>条件</th>
                <th>适用</th>
                <th>发给谁</th>
                <th>有效期</th>
                <th>领取入口</th>
                <th>弹窗</th>
                <th>发行量 / 批次</th>
                <th>领取 / 可用</th>
                <th>已用 / 作废</th>
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
                    <td style={{ fontSize: 11.5 }}>{scopeText(v, skuLabels)}</td>
                    <td><span className={`bdg ${v.audience === "new" ? "cyan" : "dim"}`}>{v.audience === "new" ? "新人" : "全部"}</span></td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{v.endAt ? `至 ${fmtDate(v.endAt)}` : "长期"}</td>
                    <td style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{surfacesText(v)}</td>
                    <td><span className={`bdg ${v.popupEnabled ? "ok" : "dim"}`}>{v.popupEnabled ? "弹窗" : "否"}</span></td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{v.issuanceLimit === 0 ? "不限量" : v.issuanceLimit} / {v.batchCount}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{v.issuedCount} / {v.availableCount}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{v.redeemedCount} / {v.revokedCount}</td>
                    <td><span className={`bdg ${isActive ? "ok" : "dim"}`}>{isActive ? "投放中" : "已暂停"}</span></td>
                    <td style={{ textAlign: "right" }}>
                      <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                        <button className="l-btn sm mc" onClick={() => openEdit(v)} disabled={!canWrite}>编辑</button>
                        <button className="l-btn sm mc" aria-label={`${isActive ? "暂停" : "投放"} ${v.name}`} onClick={() => openToggle(v)} disabled={!canWrite}>{isActive ? "暂停" : "投放"}</button>
                        {v.availableCount > 0 ? <button className="l-btn sm mc" style={{ color: "var(--danger)" }} aria-label={`作废未使用的代金券 · ${v.name}`} onClick={() => openRevoke(v)} disabled={!canWrite}>作废未使用</button> : null}
                        <button className="l-btn sm mc" style={{ color: "var(--danger)" }} aria-label={`删除代金券 · ${v.name}`} onClick={() => openDelete(v)} disabled={!canWrite}>删除</button>
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
            <b>说明</b> · 代金券投放、暂停或修改后，App 的领券入口和首页活动位马上跟着变。代金券只是折扣，不算平台负债。
          </div>
        </div>
      </section>
    </>
  );
}

export default H7VoucherConfig;
