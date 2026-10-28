"use client";
import { operatorNicknameText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";


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
  apy: { name: "年化收益率", sub: "只影响新订单" },
  lockDays: { name: "锁仓期限", sub: "整数天 · 只影响新订单" },
  nurture: { name: "培育奖倍率", sub: "复投用户的培育奖按这个倍率算，马上生效" },
  lottery: { name: "创世节点抽奖券", sub: "每笔复投送几张 · 修改前核对奖池容量" },
  penalty: { name: "提前赎回罚款", sub: "扣部分本金，利息和抽奖券作废" },
  presets: { name: "复投金额快捷选项", sub: "用户复投时可直接点选的金额 · 马上生效" },
};

/** 复投单处理流程的中文业务名;未知状态原样回显,不伪造中文。 */
const REPURCHASE_STATE_LABELS: Record<string, string> = {
  pending_lock: "待锁定",
  active: "锁仓中",
  mature_unclaimed: "到期未领取",
  claimed: "已领取",
  early_withdrawn: "已提前赎回",
};

/**
 * 参数展示值的中文化。
 * 后端 `displayValue` 是机器口径英文串("90 days" / "+1 / order" / "principal 15% + forfeit" / "x1.5"),
 * 中文管理页不得直接当业务文案;这里按参数键 + 原始数值重建中文名称、单位与说明。
 */
function paramDisplayValue(param: G7Param) {
  const raw = (param.value || "").trim();
  if (!raw) return "未配置";
  switch (param.key) {
    case "apy": return `${raw}% 年化`;
    case "lockDays": return `${raw} 天`;
    case "nurture": return `${raw} 倍`;
    case "lottery": return `${raw} 张 / 单`;
    case "penalty": return `扣本金 ${raw}%，利息和抽奖券作废`;
    default: return raw;
  }
}

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

function paramSub(param: G7Param, lockDays: number) {
  if (param.key === "apy") return `${lockDays} 天锁仓 · ${PARAM_COPY.apy.sub}`;
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
      toast(`操作失败 · ${message}`);
      throw err;
    } finally {
      setBusyKey(null);
    }
  }, [toast]);

  if (loading && !overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">复投激励</span><span className="sub">· 加载中</span></div>
        <div className="l-b"><div className="gtint">复投数据加载中…</div></div>
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">复投激励</span></div>
        <div className="l-b">
          <div className="gtint">复投数据加载失败 · {error || "没有收到数据，请重试；一直失败请联系值班同事。"}</div>
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
      action: `调整复投参数 · ${label}`,
      detail: (
        <>
          <b>{label}</b> · 当前 {paramDisplayValue(param)} · {({ apy: "调高年化收益率会增加以后要付的利息，先看兑付覆盖率", lockDays: "只影响新订单，已有订单按原期限", nurture: "影响之后的培育奖计算", lottery: "改抽奖券数量前，先核对创世奖池还够不够", penalty: "已有订单按下单时的罚款规则", presets: "保存后 App 上的可选金额马上更新" } as Record<string,string>)[param.key] ?? "修改后按该参数生效规则执行"}。
          {param.b1RedlineTriggered && <>这项修改会多付钱，覆盖率低于红线时无法保存（当前 {cov}%）。</>}
          {param.newOnly ? "只影响新订单。" : "保存后马上生效。"}
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
        title: "核对创世奖池容量",
        hint: `本月容量 ${fmtNumber(overview.g4Capacity.monthlyCapacity)} 张 · 已发 ${fmtNumber(overview.g4Capacity.ticketsIssuedThisMonth)} 张`,
        fields: [{ key: "g4Ref", label: "创世奖池核对编号", inputKind: "text", placeholder: "例如 POOL-2026-07", required: true, wide: true }],
      } : undefined,
      run: async (reason, value, businessValue) => {
        if (value === undefined || value === null || String(value).trim() === "") return;
        await mutate(param.key, () => updateG7RepurchaseParam(
          param.key, String(value), reason, currentAdminOperator(), businessValue?.g4Ref ?? "",
        ), `${label} 已生效`);
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
      {error && <div className="gtint" style={{ marginBottom: 12 }}>操作提示 · {error}</div>}
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">本月复投单</div><div className="v">{fmtNumber(stats.ordersMonth)}</div><div className="sub">锁仓本金 {fmtUsdCompact(stats.principalUsd)}</div></div>
        <div className="f-stat"><div className="k">待到期本息</div><div className="v">{fmtUsdCompact(stats.matureUsd)}</div><div className="sub">计入「可用资金与应付款」</div></div>
        <div className="f-stat cyan"><div className="k">本月发出抽奖券</div><div className="v">{fmtNumber(stats.ticketsMonth)} 张</div><div className="sub">创世节点每月开奖</div></div>
        <div className="f-stat"><div className="k">复投率</div><div className="v">{stats.reinvestRateAvailable ? `${stats.reinvestRate.toFixed(1).replace(/\.0$/, "")}%` : "—"}</div><div className="sub">{stats.reinvestRateAvailable ? "到期后选择复投的比例" : "数据不足，暂无法计算"}</div></div>
      </div>

      <section className="l-card">
        <div className="l-h"><span className="ttl">复投激励配置</span><span className="sub">· 鼓励用户把可提现余额继续锁仓</span></div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          {overview.params.map((param) => (
            <div className="p-row" key={param.key}>
              <div className="txt"><div className="k">{paramName(param)}</div><div className="s">{paramSub(param, stats.lockDays)}</div></div>
              <span className="v">{paramDisplayValue(param)}</span>
              {canEdit(param.key) && <button className="l-btn sm mc" disabled={busy} onClick={() => adjustParam(param)}>编辑 {paramName(param)}</button>}
            </div>
          ))}
          <div className="p-row">
            <div className="txt">
              <div className="k">限时复投倍率 <span className="gate">跟随运营阶段</span></div>
              <div className="s">第 5–6 个月限时 2 倍，按复投当时的倍率算 · 修改请到「运营阶段设置」</div>
            </div>
            <span className="v">{overview.phaseGate.value}</span>
            <Link href="/growth/phase" className="l-btn sm">去运营阶段设置 →</Link>
          </div>
          <div className="gtint" style={{ marginTop: 10 }}><b>复投</b> · 一次复投 = 扣余额 + 锁仓，两步要么一起成功，要么都不发生。限时倍率按复投当时的值计算。</div>
          <div className="gtint" style={{ marginTop: 10 }}><b>创世奖池容量</b> · 每月 {fmtNumber(overview.g4Capacity.monthlyCapacity)} 张 · 本月已发 {fmtNumber(overview.g4Capacity.ticketsIssuedThisMonth)} 张 · 修改抽奖券规则时要填写奖池核对编号。</div>

          <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px" }}>复投订单状态与金额分布</div>
          <div className="sm-strip">
            {overview.stateMachine.map((state, index) => (
              <span key={state} className={index === 1 ? "st ok" : index === 2 ? "st warn" : index === 4 ? "st bad" : "st"}>{REPURCHASE_STATE_LABELS[state] ?? "状态未知"}</span>
            ))}
          </div>
          <details className="gtint" style={{ marginTop: 6 }}>
            <summary>技术信息（状态代码）</summary>
            <div className="mono" style={{ marginTop: 4, fontSize: 11.5 }}>
              {overview.stateMachine.map((state) => `${state} = ${REPURCHASE_STATE_LABELS[state] ?? "未知状态"}`).join(" · ")}
            </div>
          </details>
          <div className="mk-tiles" style={{ marginTop: 12 }}>
            {overview.statusBreakdown.length === 0 ? (
              <div className="t"><div className="k">状态分布</div><div className="v">暂无</div></div>
            ) : overview.statusBreakdown.map((status) => (
              <div className="t" key={status.status}>
                <div className="k">{operatorCopyText(status.label)}</div>
                <div className="v">{fmtNumber(status.count)} 单</div>
                <div style={{ marginTop: 4 }}><span className={`bdg ${toneClass(status.tone)}`}>{operatorCopyText(status.principalDisplay)}</span></div>
              </div>
            ))}
          </div>
          <div className="gtint" style={{ marginTop: 10 }}><b>金额分布（本月 {fmtNumber(stats.ordersMonth)} 单）</b> · {overview.amountDistribution} · 待到期本息 {fmtUsdCompact(stats.matureUsd)}，已计入「可用资金与应付款」。</div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h"><span className="ttl">复投订单</span></div>
        <div className="l-b" style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1040 }}>
            <thead><tr><th>订单号</th><th>用户</th><th>本金</th><th>下单时年化收益率 / 期限</th><th>预计利息</th><th>状态</th><th>开始 / 到期</th><th>账单</th></tr></thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.orderNo}>
                  <td className="mono">{order.orderNo}</td>
                  <td>{operatorNicknameText(order.nickname)}<div className="mono" style={{ opacity: 0.65 }}>{order.userNo}</div></td>
                  <td>{fmtUsd(order.amountUsdt)}</td>
                  <td>{fmtNumber(order.apyPct, 2)}% / {order.lockDays} 天</td>
                  <td>{fmtUsd(order.estimatedInterestUsdt)}</td>
                  <td><span className={`bdg ${order.status === "EARLY_WITHDRAWN" ? "bad" : order.status === "CLAIMED" ? "ok" : "warn"}`}>{orderStatusLabel(order.status)}</span></td>
                  <td className="mono">{order.lockedAt}<br />{order.unlockAt}</td>
                  <td className="mono">{order.billCorrelationPrefix}-*</td>
                </tr>
              ))}
              {!orders.length && <tr><td colSpan={8} style={{ textAlign: "center", padding: 20 }}>暂无复投订单</td></tr>}
            </tbody>
          </table>
          {hasMore && nextCursor !== null && <button className="btn" disabled={loading || loadingMore} onClick={() => void loadMore()}>加载更多</button>}
        </div>
      </section>

      <p className="f-foot">「什么时候解锁、限时倍率」在「运营阶段设置」里控制，这里只能查看；「利率、倍率、罚款、复投金额快捷选项」在这页修改。调高利率或培育奖倍率、降低罚款时，覆盖率低于红线无法保存。</p>
      <details className="f-foot"><summary>技术信息（数据来源）</summary>{overview.sources.join(" / ")}</details>
    </>
  );
}
