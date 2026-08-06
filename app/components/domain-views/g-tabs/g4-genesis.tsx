"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
/**
 * G4 Genesis 经济 — 数据来自后端 /api/admin/market/nex/genesis 及 Genesis 业务表。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Drawer } from "../design-kit";
import {
  fetchG4GenesisOverview,
  rerunG4GenesisDividendBatch,
  updateG4GenesisMarketStatus,
  updateG4GenesisParam,
  type G4Node,
  type G4Overview,
  type G4Param,
} from "@/lib/admin/g4-client";
import type { GCtx } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";
import G4AdminOperations from "./g4-admin-operations";

const OPERATOR = currentAdminOperator;

function messageOf(error: unknown) {
  return displayAdminError(error);
}

function fmtNumber(value: number, max = 2) {
  return value.toLocaleString("en-US", { maximumFractionDigits: max });
}

function fmtUsd(value: number, max = 2) {
  return `$${fmtNumber(value, max)}`;
}

function fmtUsdCompact(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return fmtUsd(value);
}

function toneClass(tone: string) {
  if (tone === "danger" || tone === "bad") return "bad";
  if (tone === "warn" || tone === "ok" || tone === "dim") return tone;
  return "dim";
}

function paramEditValue(param: G4Param) {
  return param.value || param.displayValue;
}

function paramByKey(overview: G4Overview, key: string) {
  return overview.params.find((param) => param.key === key);
}

export function G4Genesis({ ctx }: { ctx: GCtx }) {
  const { toast, openActionConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const isSuper = session?.role === "super" || session?.role === "superadmin";
  const allowed = (authority: string) => isSuper || authorities.includes(authority);
  const paramAuthority = (key: string) => key === "price" ? "finprod_g4_price_write"
    : key === "dividend" ? "finprod_g4_dividend_rate_write"
      : key === "royalty" ? "finprod_g4_royalty_write"
        : key === "airdropPct" ? "finprod_g4_airdrop_pct_write"
          : key === "emissionCurve" ? "finprod_g4_emission_curve_write"
            : key === "airdropLockDays" ? "finprod_g4_airdrop_lock_days_write" : "finprod_g4_write";
  const [overview, setOverview] = useState<G4Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [nodeDrawer, setNodeDrawer] = useState<string | null>(null);
  const [nodePageNo, setNodePageNo] = useState(1);
  const [nodePageSize, setNodePageSize] = useState(10);

  const reload = useCallback(async (silent = false, page = nodePageNo, pageSize = nodePageSize) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const next = await fetchG4GenesisOverview(page, pageSize);
      setOverview(next);
      setNodePageNo(next.nodePage.page);
      setNodePageSize(next.nodePage.pageSize);
    } catch (err) {
      setOverview(null);
      setError(messageOf(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [nodePageNo, nodePageSize]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const next = await fetchG4GenesisOverview(1, 10);
        if (!cancelled) {
          setOverview(next);
          setNodePageNo(next.nodePage.page);
          setNodePageSize(next.nodePage.pageSize);
        }
      } catch (err) {
        if (!cancelled) {
          setOverview(null);
          setError(messageOf(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const mutate = useCallback(async (key: string, action: () => Promise<G4Overview>, success: string) => {
    setBusyKey(key);
    setError("");
    try {
      await action();
      const next = await fetchG4GenesisOverview(nodePageNo, nodePageSize);
      setOverview(next);
      setNodePageNo(next.nodePage.page);
      setNodePageSize(next.nodePage.pageSize);
      toast(success);
    } catch (err) {
      const message = messageOf(err);
      setError(message);
      toast(`G4 操作失败 · ${message}`);
      throw err;
    } finally {
      setBusyKey(null);
    }
  }, [nodePageNo, nodePageSize, toast]);

  const selectedNode = useMemo(() => {
    if (!overview || !nodeDrawer) return null;
    return overview.nodes.find((node) => node.id === nodeDrawer) || null;
  }, [overview, nodeDrawer]);

  if (loading && !overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">G4 Genesis 经济</span><span className="sub">· 正在读取真实接口数据</span></div>
        <div className="l-b"><div className="gtint">G4 数据加载中...</div></div>
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">G4 Genesis 经济</span><span className="sub">· 真实接口数据</span></div>
        <div className="l-b">
          <div className="gtint">G4 数据加载失败 · {error || "未收到本页数据，请重试；持续失败时请联系值班人员。"}</div>
          <button className="l-btn mc" style={{ marginTop: 12 }} onClick={() => void reload()}>重新加载</button>
        </div>
      </section>
    );
  }

  const busy = !!busyKey;
  const cov = overview.coverage.coverageRatio.toFixed(1);
  const marketOn = overview.market.enabled;
  const stats = overview.stats;
  const dividend = overview.dividend;
  const geoBlocked = overview.geoBlocked.filter((geo) => geo.status === "blocked").map((geo) => geo.cc).join(" / ") || "-";
  const batchRerun = dividend.batchStatus === "done";
  const soldPct = Math.max(0, Math.min(100, stats.soldPct));
  const nodePage = overview.nodePage;

  const loadNodePage = (page: number, pageSize = nodePage.pageSize) => {
    void reload(false, page, pageSize);
  };

  const changeNodePageSize = (value: string) => {
    const nextPageSize = Number(value);
    if (!Number.isFinite(nextPageSize)) return;
    setNodePageNo(1);
    setNodePageSize(nextPageSize);
    void reload(false, 1, nextPageSize);
  };

  const adjustParam = (param: G4Param) => {
    if (!allowed(paramAuthority(param.key))) return;
    const numeric = !["divBase", "emissionCurve"].includes(param.key);
    const bounds = param.key === "supply" ? { min: stats.sold, max: 100000, step: 1 }
      : param.key === "price" ? { min: 0.01, max: 1000000, step: 0.01 }
        : param.key === "royalty" ? { min: 0, max: 20, step: 0.01 }
          : param.key === "airdropPct" ? { min: 0, max: 100, step: 0.01 }
            : param.key === "airdropLockDays" ? { min: 0, max: 3650, step: 1 }
              : { min: 0, max: 5, step: 0.001 };
    const needsDecision = ["dividend", "divBase", "airdropPct", "emissionCurve"].includes(param.key);
    openActionConfirm({
      action: `Genesis 经济参数 · ${param.name}`,
      detail: <><b>{param.name}</b> · 当前 {param.displayValue} · {param.note}<br />B1 当前覆盖率 {cov}%，提交时后端重新预检增量负债。</>,
      amplifies: param.b1RedlineTriggered,
      edit: numeric ? { kind: "number", current: paramEditValue(param), ...bounds } : { kind: "text", current: paramEditValue(param) },
      businessForm: needsDecision ? { kind: "multi-field", title: "产品决议与负债依据", fields: [
        { key: "decisionRef", label: "PM/财务决议编号", current: "", inputKind: "text", required: true },
      ] } : undefined,
      run: async (reason, value, businessValue) => {
        if (!value) return;
        await mutate(`param:${param.key}`, () => updateG4GenesisParam(
          param.key, String(value), reason, OPERATOR(), businessValue?.decisionRef,
        ), `${param.name}已立即生效`);
      },
    });
  };

  const runMarketSwitch = () => {
    if (!marketOn || !allowed("finprod_g4_market_toggle")) return;
    openActionConfirm({
      action: "一二级市场熔断",
      detail: <>立即停止一级购买、挂单与内部 P2P 成交，联动 {overview.market.linkedDomain}。恢复只能前往 J1。</>,
      amplifies: false,
      businessForm: { kind: "multi-field", title: "熔断上下文", fields: [
        { key: "triggerBasis", label: "触发依据", current: "", inputKind: "text", required: true },
        { key: "dispositionPlan", label: "存量权益处置计划", current: "", inputKind: "text", required: true },
      ] },
      run: async (reason, _value, businessValue) => {
        await mutate("market:pause", () => updateG4GenesisMarketStatus(false, reason, OPERATOR(), {
          triggerBasis: businessValue?.triggerBasis, dispositionPlan: businessValue?.dispositionPlan,
        }), "Genesis 市场已立即熔断；恢复入口仅在 J1");
      },
    });
  };

  const runRerunBatch = () => {
    if (!allowed("finprod_g4_write")) return;
    openActionConfirm({
      action: `重跑今日排放批次 ${dividend.batchNo}`,
      detail: "批次按日期带持久防重号；已成功户不会重复发，只补失败项。服务端逐持有人写 D4 账单。",
      businessForm: { kind: "multi-field", title: "批次决议", fields: [
        { key: "decisionRef", label: "财务/PM 决议编号", current: "", inputKind: "text", required: true },
      ] },
      run: async (reason, _value, businessValue) => {
        await mutate(`batch:${dividend.batchNo}`, () => rerunG4GenesisDividendBatch(
          dividend.batchNo, reason, OPERATOR(), businessValue?.decisionRef,
        ), "排放批次已立即重跑，仅补失败项");
      },
    });
  };

  const supplyParam = paramByKey(overview, "supply");
  const priceParam = paramByKey(overview, "price");
  const dividendParam = paramByKey(overview, "dividend");
  const royaltyParam = paramByKey(overview, "royalty");
  const divBaseParam = paramByKey(overview, "divBase");
  const airdropPctParam = paramByKey(overview, "airdropPct");
  const emissionCurveParam = paramByKey(overview, "emissionCurve");
  const airdropLockDaysParam = paramByKey(overview, "airdropLockDays");

  return (
    <>
      {error && <div className="gtint" style={{ marginBottom: 12 }}>G4 操作提示 · {error}</div>}
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">一级售出</div><div className="v">{fmtNumber(stats.sold, 0)} / {fmtNumber(stats.totalSlots, 0)}</div><div className="sub">{fmtUsd(stats.unitPrice, 0)} / 张 · 距售罄 {fmtNumber(stats.unsold, 0)} 张</div></div>
        <div className="f-stat"><div className="k">排放承诺预提</div><div className="v">{fmtUsdCompact(stats.genesisAccrualUsd)}</div><div className="sub">上所开阀后按真实策略计提</div></div>
        <div className="f-stat cyan"><div className="k">二级地板价</div><div className="v">{fmtUsdCompact(stats.secondary.floor)}</div><div className="sub">24h 量 {fmtUsdCompact(stats.secondary.vol24h)} · 在挂 {fmtNumber(stats.secondary.listed, 0)}</div></div>
        <div className="f-stat warn"><div className="k">市场熔断</div><div className="v">{marketOn ? "未启用" : "已熔断"}</div><div className="sub">联动 {overview.market.linkedDomain} · 恢复统一由 J1 执行</div></div>
      </div>

      <G4AdminOperations ctx={ctx} />

      <div className="two-col r11" style={{ marginBottom: 16 }}>
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">节点经济参数</span>
            <span className="sub">· 来自服务端策略 + 创世系列业务表</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: "var(--ink-4)", marginBottom: 2 }}>一级售出进度 {fmtNumber(stats.sold, 0)} / {fmtNumber(stats.totalSlots, 0)}</div>
              <div className="sold"><i style={{ width: `${soldPct}%` }} /></div>
            </div>
            {supplyParam && <div className="p-row"><div className="txt"><div className="k">节点总量</div><div className="s">{supplyParam.sub}</div></div><span className="v">{supplyParam.displayValue}</span>{allowed(paramAuthority(supplyParam.key)) && <button className="l-btn sm mc" disabled={busy} onClick={() => adjustParam(supplyParam)}>调整</button>}</div>}
            {priceParam && <div className="p-row"><div className="txt"><div className="k">一级单价</div><div className="s">{priceParam.sub}</div></div><span className="v">{priceParam.displayValue}</span>{allowed(paramAuthority(priceParam.key)) && <button className="l-btn sm mc" disabled={busy} onClick={() => adjustParam(priceParam)}>调整</button>}</div>}
            {dividendParam && <div className="p-row"><div className="txt"><div className="k">每日排放率 <span className="bdg ok" style={{ fontSize: 9 }}>基准 0.1%/日</span></div><div className="s">{dividendParam.sub}</div></div><span className="v">{dividendParam.displayValue}</span>{allowed(paramAuthority(dividendParam.key)) && <button className="l-btn sm mc" disabled={busy} onClick={() => adjustParam(dividendParam)}>调整</button>}</div>}
            {royaltyParam && <div className="p-row"><div className="txt"><div className="k">二级版税</div><div className="s">{royaltyParam.sub}</div></div><span className="v">{royaltyParam.displayValue}</span>{allowed(paramAuthority(royaltyParam.key)) && <button className="l-btn sm mc" disabled={busy} onClick={() => adjustParam(royaltyParam)}>调整</button>}</div>}
            <div className="p-row"><div className="txt"><div className="k">排放开阀 <span className="bdg ok" style={{ fontSize: 9 }}>H1 权威</span></div><div className="s">上所前关闭；由 H1 逐月节奏旋钮控制，本页只读</div></div><span className="v">{overview.emissionGate.open ? "已开放" : "未开放"}</span></div>
            {airdropPctParam && <div className="p-row"><div className="txt"><div className="k">空投占比</div><div className="s">{airdropPctParam.sub}</div></div><span className="v">{airdropPctParam.displayValue}</span>{allowed(paramAuthority(airdropPctParam.key)) && <button className="l-btn sm mc" disabled={busy} onClick={() => adjustParam(airdropPctParam)}>调整</button>}</div>}
            {emissionCurveParam && <div className="p-row"><div className="txt"><div className="k">排放曲线</div><div className="s">{emissionCurveParam.sub}</div></div><span className="v">{emissionCurveParam.displayValue}</span>{allowed(paramAuthority(emissionCurveParam.key)) && <button className="l-btn sm mc" disabled={busy} onClick={() => adjustParam(emissionCurveParam)}>调整</button>}</div>}
            {airdropLockDaysParam && <div className="p-row"><div className="txt"><div className="k">OG 倍率锁仓期</div><div className="s">{airdropLockDaysParam.sub}</div></div><span className="v">{airdropLockDaysParam.displayValue}</span>{allowed(paramAuthority(airdropLockDaysParam.key)) && <button className="l-btn sm mc" disabled={busy} onClick={() => adjustParam(airdropLockDaysParam)}>调整</button>}</div>}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">一二级市场</span>
            <span className="sub">· 实时 stats · 排放跟随 NFT</span>
            <div className="r">
              {marketOn && allowed("finprod_g4_market_toggle")
                ? <button className="l-btn mc" disabled={busy} onClick={runMarketSwitch}>市场熔断</button>
                : !marketOn ? <Link href="/emergency/kill-switch" className="l-btn">前往 J1 申请恢复</Link> : null}
              <Link href="/emergency/geo-block" className="l-btn">地域封锁(J2)→</Link>
            </div>
          </div>
          <div className="l-b">
            <div className="mk-tiles">
              <div className="t"><div className="k">地板价</div><div className="v">{fmtUsdCompact(stats.secondary.floor)}</div></div>
              <div className="t"><div className="k">24h 成交量</div><div className="v">{fmtUsdCompact(stats.secondary.vol24h)}</div></div>
              <div className="t"><div className="k">在挂</div><div className="v">{fmtNumber(stats.secondary.listed, 0)}</div></div>
              <div className="t"><div className="k">持有人</div><div className="v">{fmtNumber(stats.secondary.owners, 0)}</div></div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px" }}>节点状态机</div>
            <div className="sm-strip">
              {overview.stateMachine.map((state, index) => (
                <span key={state} className={index <= 1 ? "st ok" : "st"}>{state}</span>
              ))}
            </div>
            <div className="gtint" style={{ marginTop: 12 }}><b>排放与负债</b> · 当前地域封锁:{geoBlocked}(J2 只读)。二级转让后排放权益跟随最新持有者，节点台账来自持有表。</div>
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">排放派发监控</span>
          <span className="sub">· H1 开阀后按服务端排放参数执行</span>
          <div className="r">
            {divBaseParam && allowed(paramAuthority(divBaseParam.key)) && <button className="l-btn mc" disabled={busy} onClick={() => adjustParam(divBaseParam)}>调整基数口径</button>}
            {allowed("finprod_g4_write") && <button className="l-btn" disabled={busy || !overview.emissionGate.open || !dividend.batchNo} onClick={runRerunBatch}>重跑今日批次{batchRerun ? "(已重跑)" : ""}</button>}
          </div>
        </div>
        <div className="l-b">
          <div className="mk-tiles">
            <div className="t"><div className="k">平台日交易量基数(今日)</div><div className="v">{fmtUsdCompact(dividend.dailyVolumeBase)}</div></div>
            <div className="t"><div className="k">今日排放池</div><div className="v" style={{ color: "var(--success)" }}>{fmtUsdCompact(dividend.poolToday)}</div></div>
            <div className="t"><div className="k">每 slot 均分</div><div className="v">{fmtUsd(dividend.perSlotPerDay)} / 天</div></div>
            <div className="t"><div className="k">今日批次 {dividend.batchNo || "—"}</div><div className="v" style={{ color: "var(--success)" }}>{overview.emissionGate.open ? `已派 ${fmtNumber(stats.sold, 0)} 户 · ${fmtUsdCompact(dividend.payoutToday)}` : "未开阀 · 未派发"}</div></div>
          </div>
          <div className="gtint" style={{ marginTop: 12 }}><b>两套口径</b> · 用户排放按服务端配置参数计算；财务预提按节点价 × 持有量 × 排放率保底。曲线字段是运营策略说明，当前批次金额仍按服务端基数与排放率计算。改排放率、曲线或基数口径会触发 B1 覆盖率预检，当前覆盖率 {cov}%。</div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">节点持有台账</span>
          <span className="sub">· 来自真实 Genesis 持仓 · 点击查看详情</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 760 }}>
            <thead><tr><th>节点</th><th>持有者(脱敏)</th><th>来源</th><th className="num">lifetime 排放</th><th>状态</th></tr></thead>
            <tbody>
              {overview.nodes.length === 0 ? (
                <tr><td colSpan={5} style={{ color: "var(--ink-3)", padding: 16 }}>暂无节点持有记录</td></tr>
              ) : overview.nodes.map((node) => (
                <tr key={node.id} className="click" onClick={() => setNodeDrawer(node.id)}>
                  <td className="mono" style={{ color: "var(--ink)" }}>{node.id} <span className="more">详情›</span></td>
                  <td className="mono">{node.owner}</td>
                  <td>{node.source}</td>
                  <td className="num mono">{node.lifetimeDividend}</td>
                  <td><span className={`bdg ${toneClass(node.statusTone)}`}>{node.statusLabel}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: "12px 14px 14px", flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            第 {fmtNumber(nodePage.page, 0)} / {fmtNumber(nodePage.totalPages, 0)} 页 · 共 {fmtNumber(nodePage.total, 0)} 条
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              aria-label="节点持有台账每页条数"
              value={nodePage.pageSize}
              disabled={loading || busy}
              onChange={(event) => changeNodePageSize(event.target.value)}
              style={{ height: 30, borderRadius: 6, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--ink)", padding: "0 8px", fontSize: 12 }}
            >
              {[10, 20, 50].map((size) => (
                <option value={size} key={size}>{size} 条 / 页</option>
              ))}
            </select>
            <button className="l-btn sm" disabled={loading || busy || !nodePage.hasPrev} onClick={() => loadNodePage(nodePage.page - 1)}>上一页</button>
            <button className="l-btn sm" disabled={loading || busy || !nodePage.hasNext} onClick={() => loadNodePage(nodePage.page + 1)}>下一页</button>
          </div>
        </div>
      </section>

      <p className="f-foot"><b>持有、排放、二级成交全部以服务器为准</b>:节点序号、钱包和排放由权威台账统一核算，客户端伪造持有或排放无效。</p>

      {selectedNode && <NodeDrawer node={selectedNode} onClose={() => setNodeDrawer(null)} />}
    </>
  );
}

function NodeDrawer({ node, onClose }: { node: G4Node; onClose: () => void }) {
  return (
    <Drawer title={`Genesis 节点 · ${node.id}`} sub={`持有者 ${node.owner} · ${node.statusLabel} · 购入:${node.buy}`} onClose={onClose}
      footer={<button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>关闭</button>}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>排放</div>
      {node.dividends.map((item) => (
        <div className="kv2" key={item.label}><span className="k">{item.label}</span><span className="v">{item.value}</span></div>
      ))}
      <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px" }}>二级流转记录</div>
      <table className="l-tbl">
        <thead><tr><th>时间</th><th>事件</th><th>版税</th></tr></thead>
        <tbody>{node.transfers.map((transfer, index) => (
          <tr key={`${transfer.time}-${index}`}><td className="mono">{transfer.time}</td><td style={{ fontSize: 12 }}>{transfer.event}</td><td style={{ fontSize: 12, color: "var(--ink-3)" }}>{transfer.royalty}</td></tr>
        ))}</tbody>
      </table>
      <div className="gtint" style={{ marginTop: 12 }}><b>只读监控</b> · 节点详情来自后端持有记录和排放口径计算。</div>
    </Drawer>
  );
}
