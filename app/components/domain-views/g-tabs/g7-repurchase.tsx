"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
/**
 * G7 复投激励 — 数据来自后端 /api/admin/market/nex/repurchase;空库返回空态。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  fetchG7RepurchaseOverview,
  fetchG7RepurchaseOrders,
  updateG7RepurchaseParam,
  type G7Order,
  type G7Overview,
  type G7Param,
} from "@/lib/admin/g7-client";
import type { GCtx } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";

const PARAM_COPY: Record<string, { name: string; sub: string }> = {
  apy: { name: "年化 APY", sub: "90 天锁仓 · 只对新单生效" },
  lockDays: { name: "锁仓期限", sub: "整数天 · 只对新单生效" },
  nurture: { name: "培育奖倍率", sub: "复投者培育奖计算即用" },
  lottery: { name: "Genesis 抽奖券", sub: "每复投单发放 · 改规则核对 G4 奖池容量" },
  penalty: { name: "早赎罚款", sub: "本金罚款 + 没收利息/券" },
  presets: { name: "preset 金额档", sub: "用户复投金额快捷档 · 实时生效" },
};

function messageOf(error: unknown) {
  return displayAdminError(error);
}

function fmtNumber(value: number, max = 0) {
  return value.toLocaleString("en-US", { maximumFractionDigits: max });
}

function fmtUsd(value: number, max = 2) {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: max })}`;
}

function fmtUsdCompact(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return fmtUsd(value, 0);
}

function toneClass(tone: string) {
  if (tone === "danger" || tone === "bad") return "bad";
  if (tone === "warn" || tone === "ok" || tone === "dim") return tone;
  return "dim";
}

function orderStatusLabel(status: string) {
  return ({
    PENDING_LOCK: "待锁定",
    ACTIVE: "锁仓中",
    MATURE_UNCLAIMED: "到期未领取",
    CLAIMED: "已领取",
    EARLY_WITHDRAWN: "已提前赎回",
  } as Record<string, string>)[status] ?? "未知状态";
}

function paramName(param: G7Param) {
  return PARAM_COPY[param.key]?.name || param.name;
}

function paramSub(param: G7Param) {
  return PARAM_COPY[param.key]?.sub || param.sub;
}

function paramEditValue(param: G7Param) {
  return param.value || param.displayValue;
}

export function G7Repurchase({ ctx }: { ctx: GCtx }) {
  const { toast, openActionConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const isSuperAdmin = session?.role === "superadmin" || session?.role === "super";
  const authorities = session?.authorities ?? [];
  const [overview, setOverview] = useState<G7Overview | null>(null);
  const [orders, setOrders] = useState<G7Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestGeneration = useRef(0);
  const moreInFlight = useRef(false);

  const reload = useCallback(async (silent = false) => {
    const generation = ++requestGeneration.current;
    moreInFlight.current = false;
    setLoadingMore(false);
    if (!silent) setLoading(true);
    setError("");
    try {
      const [nextOverview, nextOrders] = await Promise.all([
        fetchG7RepurchaseOverview(), fetchG7RepurchaseOrders(),
      ]);
      if (generation !== requestGeneration.current) return;
      setOverview(nextOverview);
      setOrders(nextOrders.orders);
      setNextCursor(nextOrders.nextCursor);
      setHasMore(nextOrders.hasMore);
    } catch (err) {
      if (generation === requestGeneration.current) setError(messageOf(err));
    } finally {
      if (generation === requestGeneration.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      requestGeneration.current += 1;
    };
  }, [reload]);

  const loadMore = async () => {
    if (loading || moreInFlight.current || !hasMore || nextCursor === null) return;
    moreInFlight.current = true;
    setLoadingMore(true);
    setError("");
    const generation = requestGeneration.current;
    try {
      const page = await fetchG7RepurchaseOrders("", nextCursor);
      if (generation !== requestGeneration.current) return;
      setOrders((current) => {
        const seen = new Set(current.map((order) => order.orderNo));
        return [...current, ...page.orders.filter((order) => {
          if (seen.has(order.orderNo)) return false;
          seen.add(order.orderNo);
          return true;
        })];
      });
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (err) {
      if (generation === requestGeneration.current) setError(messageOf(err));
    } finally {
      if (generation === requestGeneration.current) {
        moreInFlight.current = false;
        setLoadingMore(false);
      }
    }
  };

  const mutate = useCallback(async (key: string, action: () => Promise<G7Overview>, success: string) => {
    setBusyKey(key);
    setError("");
    try {
      const next = await action();
      setOverview(next);
      toast(success);
    } catch (err) {
      const message = messageOf(err);
      setError(message);
      toast(`G7 操作失败 · ${message}`);
      throw err;
    } finally {
      setBusyKey(null);
    }
  }, [toast]);

  if (loading && !overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">G7 复投激励</span><span className="sub">· 正在读取真实接口数据</span></div>
        <div className="l-b"><div className="gtint">G7 数据加载中...</div></div>
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">G7 复投激励</span><span className="sub">· 真实接口数据</span></div>
        <div className="l-b">
          <div className="gtint">G7 数据加载失败 · {error || "未收到本页数据，请重试；持续失败时请联系值班人员。"}</div>
          <button className="l-btn mc" style={{ marginTop: 12 }} onClick={() => void reload()}>重新加载</button>
        </div>
      </section>
    );
  }

  const stats = overview.stats;
  const busy = !!busyKey;
  const cov = overview.coverage.coverageRatio.toFixed(1);

  const adjustParam = (param: G7Param) => {
    const label = paramName(param);
    openActionConfirm({
      action: `产品参数调整 · ${label}`,
      detail: (
        <>
          <b>{label}</b> · 当前 {param.displayValue} · {param.note}。
          {param.b1RedlineTriggered && <>放大流出方向确认放行时过备付金红线，当前 {cov}%, 422。</>}
          操作确认，{param.newOnly ? "只对新单生效" : "实时生效"}。
        </>
      ),
      amplifies: param.b1RedlineTriggered,
      edit: param.key === "presets"
        ? { kind: "text", current: paramEditValue(param), disallowCurrent: true }
        : { kind: "number", current: paramEditValue(param),
            unit: param.key === "apy" || param.key === "penalty" ? "%" : param.key === "lockDays" ? "天" : undefined,
            min: param.key === "apy" || param.key === "penalty" || param.key === "lottery" ? 0 : 1,
            max: param.key === "apy" ? 300 : param.key === "penalty" || param.key === "lottery" ? 100 : param.key === "lockDays" ? 3650 : 10,
            step: param.key === "lockDays" || param.key === "lottery" ? 1 : 0.01,
            disallowCurrent: true,
            amplifiesWhen: param.key === "penalty" ? "decrease"
              : param.key === "apy" || param.key === "nurture" || param.key === "lottery" ? "increase" : undefined },
      businessForm: param.key === "lottery" ? {
        kind: "multi-field",
        title: "G4 奖池容量核对",
        hint: `本月容量 ${fmtNumber(overview.g4Capacity.monthlyCapacity)} 张 · 已发 ${fmtNumber(overview.g4Capacity.ticketsIssuedThisMonth)} 张`,
        fields: [{ key: "g4Ref", label: "G4 核对 ref", inputKind: "text", placeholder: "例如 G4-POOL-2026-07", required: true, wide: true }],
      } : undefined,
      run: async (reason, value, businessValue) => {
        if (value === undefined || value === null || String(value).trim() === "") return;
        await mutate(param.key, () => updateG7RepurchaseParam(
          param.key, String(value), reason, currentAdminOperator(), businessValue?.g4Ref ?? "",
        ), `${label} 已立即生效 · 已记审计`);
      },
    });
  };

  const canEdit = (key: string) => {
    if (isSuperAdmin) return true;
    if (key === "apy" || key === "lockDays") return authorities.includes("finprod_g7_apy_write");
    if (key === "nurture") return authorities.includes("finprod_g7_nurture_write");
    return authorities.includes("finprod_g7_write");
  };

  return (
    <>
      {error && <div className="gtint" style={{ marginBottom: 12 }}>G7 操作提示 · {error}</div>}
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">本月复投单</div><div className="v">{fmtNumber(stats.ordersMonth)}</div><div className="sub">在锁本金 {fmtUsdCompact(stats.principalUsd)} · 来自复投锁仓行</div></div>
        <div className="f-stat"><div className="k">{stats.lockDays} 天后到期本息</div><div className="v">{fmtUsdCompact(stats.matureUsd)}</div><div className="sub">喂 B2 到期预测</div></div>
        <div className="f-stat cyan"><div className="k">发放 Genesis 抽奖券</div><div className="v">{fmtNumber(stats.ticketsMonth)} 张</div><div className="sub">每月开奖 · 联动 G4</div></div>
        <div className="f-stat"><div className="k">复投率</div><div className="v">{stats.reinvestRateAvailable ? `${stats.reinvestRate.toFixed(1).replace(/\.0$/, "")}%` : "—"}</div><div className="sub">{stats.reinvestRateAvailable ? "真实漏斗复投级" : "缺少漏斗分母，不用奖励倍率伪造"}</div></div>
      </div>

      <section className="l-card">
        <div className="l-h"><span className="ttl">复投激励配置</span><span className="sub">· 引导用户把可提现余额重新锁仓</span></div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          {overview.params.map((param) => (
            <div className="p-row" key={param.key}>
              <div className="txt"><div className="k">{paramName(param)}</div><div className="s">{paramSub(param)}</div></div>
              <span className="v">{param.displayValue}</span>
              {canEdit(param.key) && <button className="l-btn sm mc" disabled={busy} onClick={() => adjustParam(param)}>编辑 {paramName(param)}</button>}
            </div>
          ))}
          <div className="p-row">
            <div className="txt">
              <div className="k">限时复投倍率 <span className="gate">{overview.phaseGate.linkedDomain} 派发</span></div>
              <div className="s">月 5-6 限时 2x，复投那一刻套用 · 这页是生效面，调整去 {overview.phaseGate.linkedDomain}</div>
            </div>
            <span className="v">{overview.phaseGate.value}</span>
            <Link href="/growth/phase" className="l-btn sm">去 H1 →</Link>
          </div>
          <div className="gtint" style={{ marginTop: 10 }}><b>复投是原子组合</b> · 一次复投 = 扣余额 + 锁仓，两步在服务端单事务里一起成，中途崩了不会只成一半。限时倍率在复投那一刻套用，这页只展示生效面。</div>
          <div className="gtint" style={{ marginTop: 10 }}><b>G4 奖池容量</b> · 月容量 {fmtNumber(overview.g4Capacity.monthlyCapacity)} 张 · 本月已发 {fmtNumber(overview.g4Capacity.ticketsIssuedThisMonth)} 张 · 改券规则必须提交 G4 核对 ref。</div>

          <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px" }}>复投单状态机与金额分布</div>
          <div className="sm-strip">
            {overview.stateMachine.map((state, index) => (
              <span key={state} className={index === 1 ? "st ok" : index === 2 ? "st warn" : index === 4 ? "st bad" : "st"}>{state}</span>
            ))}
          </div>
          <div className="mk-tiles" style={{ marginTop: 12 }}>
            {overview.statusBreakdown.length === 0 ? (
              <div className="t"><div className="k">状态分布</div><div className="v">暂无</div></div>
            ) : overview.statusBreakdown.map((status) => (
              <div className="t" key={status.status}>
                <div className="k">{status.label}</div>
                <div className="v">{fmtNumber(status.count)} 单</div>
                <div style={{ marginTop: 4 }}><span className={`bdg ${toneClass(status.tone)}`}>{status.principalDisplay}</span></div>
              </div>
            ))}
          </div>
          <div className="gtint" style={{ marginTop: 10 }}><b>金额分布(本月 {fmtNumber(stats.ordersMonth)} 单)</b> · {overview.amountDistribution} · 到期本息 {fmtUsdCompact(stats.matureUsd)} 喂驾驶舱到期预测(B2)。</div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h"><span className="ttl">真实复投单</span><span className="sub">· 服务端订单与账单关联</span></div>
        <div className="l-b" style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1040 }}>
            <thead><tr><th>订单号</th><th>用户</th><th>本金</th><th>快照 APY / 锁期</th><th>预计利息</th><th>状态</th><th>锁定 / 到期</th><th>账单关联</th></tr></thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.orderNo}>
                  <td className="mono">{order.orderNo}</td>
                  <td>{order.nickname}<div className="mono" style={{ opacity: 0.65 }}>{order.userNo}</div></td>
                  <td>{fmtUsd(order.amountUsdt)}</td>
                  <td>{fmtNumber(order.apyPct, 2)}% / {order.lockDays} 天</td>
                  <td>{fmtUsd(order.estimatedInterestUsdt)}</td>
                  <td><span className={`bdg ${order.status === "EARLY_WITHDRAWN" ? "bad" : order.status === "CLAIMED" ? "ok" : "warn"}`}>{orderStatusLabel(order.status)}</span></td>
                  <td className="mono">{order.lockedAt}<br />{order.unlockAt}</td>
                  <td className="mono">{order.billCorrelationPrefix}-*</td>
                </tr>
              ))}
              {!orders.length && <tr><td colSpan={8} style={{ textAlign: "center", padding: 20 }}>暂无真实复投单</td></tr>}
            </tbody>
          </table>
          {hasMore && nextCursor !== null && <button className="btn" disabled={loading || loadingMore} onClick={() => void loadMore()}>加载更多</button>}
        </div>
      </section>

      <p className="f-foot"><b>阶段开关与产品参数分两层</b>:「什么时候解锁/限时倍率」是节奏调度器(H1)下发的阶段开关，这页只读；「利率/倍率/罚款/preset」才是这页能改的。所有升利率、升培育奖倍率、降罚款都过备付金红线。数据源:{overview.sources.join(" / ")}。</p>
    </>
  );
}
