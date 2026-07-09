"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
/**
 * G7 复投激励 — 数据来自后端 /api/admin/market/nex/repurchase;空库返回空态。
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchG7RepurchaseOverview,
  updateG7RepurchaseParam,
  type G7Overview,
  type G7Param,
} from "@/lib/admin/g7-client";
import type { GCtx } from "./types";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";

const OPERATOR = currentAdminOperator;

const PARAM_COPY: Record<string, { name: string; sub: string }> = {
  apy: { name: "年化 APY", sub: "90 天锁仓 · 只对新单生效" },
  nurture: { name: "培育奖倍率", sub: "复投者培育奖计算即用" },
  lottery: { name: "Genesis 抽奖券", sub: "每复投单发放 · 改规则核对 G4 奖池容量" },
  penalty: { name: "早赎罚款", sub: "本金罚款 + 没收利息/券" },
  presets: { name: "preset 金额档", sub: "用户复投金额快捷档 · 实时生效" },
};

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
  const propose = usePropose();
  const [overview, setOverview] = useState<G7Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      setOverview(await fetchG7RepurchaseOverview());
    } catch (err) {
      setError(messageOf(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const next = await fetchG7RepurchaseOverview();
        if (!cancelled) setOverview(next);
      } catch (err) {
        if (!cancelled) setError(messageOf(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

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
          <div className="gtint">G7 数据加载失败 · {error || "UNKNOWN_ERROR"}</div>
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
      edit: { kind: "text", current: paramEditValue(param) },
      run: (reason, value) => {
        if (!value) return;
        const def = findHighOp("g7_repurchase_param")!;
        void propose(ctx.toast, {
          action: `产品参数调整 · ${label}`,
          obj: param.key,
          before: param.displayValue,
          after: String(value),
          type: "fund",
          amplifies: param.b1RedlineTriggered,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "G7",
          command: def.buildCommand({ paramKey: param.key, value }),
          target: def.buildTarget({ paramKey: param.key }),
        });
      },
    });
  };

  return (
    <>
      {error && <div className="gtint" style={{ marginBottom: 12 }}>G7 操作提示 · {error}</div>}
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">本月复投单</div><div className="v">{fmtNumber(stats.ordersMonth)}</div><div className="sub">在锁本金 {fmtUsdCompact(stats.principalUsd)} · 来自复投锁仓行</div></div>
        <div className="f-stat"><div className="k">{stats.lockDays} 天后到期本息</div><div className="v">{fmtUsdCompact(stats.matureUsd)}</div><div className="sub">喂 B2 到期预测</div></div>
        <div className="f-stat cyan"><div className="k">发放 Genesis 抽奖券</div><div className="v">{fmtNumber(stats.ticketsMonth)} 张</div><div className="sub">每月开奖 · 联动 G4</div></div>
        <div className="f-stat"><div className="k">复投率</div><div className="v">{stats.reinvestRate.toFixed(1).replace(/\.0$/, "")}%</div><div className="sub">漏斗复投级 · 非八项 KPI</div></div>
      </div>

      <section className="l-card">
        <div className="l-h"><span className="ttl">复投激励配置</span><span className="sub">· 引导用户把可提现余额重新锁仓</span></div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          {overview.params.map((param) => (
            <div className="p-row" key={param.key}>
              <div className="txt"><div className="k">{paramName(param)}</div><div className="s">{paramSub(param)}</div></div>
              <span className="v">{param.displayValue}</span>
              <button className="l-btn sm mc" disabled={busy} onClick={() => adjustParam(param)}>调整</button>
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

      <p className="f-foot"><b>阶段开关与产品参数分两层</b>:「什么时候解锁/限时倍率」是节奏调度器(H1)下发的阶段开关，这页只读；「利率/倍率/罚款/preset」才是这页能改的。所有升利率、升培育奖倍率、降罚款都过备付金红线。数据源:{overview.sources.join(" / ")}。</p>
    </>
  );
}
