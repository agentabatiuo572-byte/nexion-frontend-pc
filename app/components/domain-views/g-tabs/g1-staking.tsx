"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
/**
 * G1 Staking 池配置 — 资金池、持仓状态、B1 覆盖率和 J1 闸状态都来自后端业务表。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Drawer, PaginationExemption } from "../design-kit";
import {
  fetchG1StakingOverview,
  updateG1StakingPoolKillStatus,
  updateG1StakingPoolParam,
  updateG1StakingPoolSaleStatus,
  type G1Overview,
  type G1Pool,
  type G1PositionGroup,
} from "@/lib/admin/g1-client";
import type { GCtx } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";

const CANONICAL_USDT_TIERS = ["usdt30d", "usdt90d", "usdt180d", "usdt365d"] as const;
const CANONICAL_USDT_TIER_SET = new Set<string>(CANONICAL_USDT_TIERS);

function fmtM(value: number) {
  return `$${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
}

function fmtCount(value: number) {
  return value.toLocaleString("en-US");
}

function displayTerm(pool: G1Pool) {
  const match = /^(\d+)d$/i.exec(pool.term);
  return match ? `${match[1]} 天` : pool.term;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function G1Staking({ ctx }: { ctx: GCtx }) {
  const { toast, openActionConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const isSuperAdmin = session?.role === "superadmin" || session?.role === "super";
  const authorities = session?.authorities ?? [];
  const canAdjustApy = isSuperAdmin || authorities.includes("finprod_g1_apy_write");
  const canAdjustPenalty = isSuperAdmin || authorities.includes("finprod_g1_penalty_write");
  const canAdjustMin = isSuperAdmin || authorities.includes("finprod_g1_min_write");
  const canToggleSale = isSuperAdmin || authorities.includes("finprod_g1_write");
  const canKill = isSuperAdmin || authorities.includes("finprod_g1_kill_toggle");
  const [overview, setOverview] = useState<G1Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<string | null>(null);

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      setOverview(await fetchG1StakingOverview());
    } catch (err) {
      setOverview(null);
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
        const next = await fetchG1StakingOverview();
        if (!cancelled) setOverview(next);
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

  const groupByStatus = useMemo(() => {
    return new Map((overview?.positions ?? []).map((group) => [group.status, group]));
  }, [overview?.positions]);
  const canonicalPools = useMemo(() => {
    const byTier = new Map((overview?.pools ?? [])
      .filter((pool) => pool.product.toUpperCase() === "USDT")
      .filter((pool) => CANONICAL_USDT_TIER_SET.has(pool.tierKey))
      .map((pool) => [pool.tierKey, pool]));
    return CANONICAL_USDT_TIERS.flatMap((tierKey) => {
      const pool = byTier.get(tierKey);
      return pool ? [pool] : [];
    });
  }, [overview?.pools]);

  const mutate = useCallback(async (key: string, action: () => Promise<G1Overview>, success: string) => {
    setBusyKey(key);
    setError("");
    try {
      setOverview(await action());
      toast(success);
    } catch (err) {
      const message = messageOf(err);
      setError(message);
      toast(`G1 操作失败 · ${message}`);
      throw err;
    } finally {
      setBusyKey(null);
    }
  }, [toast]);

  if (loading && !overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">G1 Staking</span><span className="sub">· 正在读取真实接口数据</span></div>
        <div className="l-b"><div className="gtint">G1 数据加载中...</div></div>
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">G1 Staking</span><span className="sub">· 真实接口数据</span></div>
        <div className="l-b">
          <div className="gtint">G1 数据加载失败 · {error || "UNKNOWN_ERROR"}</div>
          <button className="l-btn mc" style={{ marginTop: 12 }} onClick={() => void reload()}>重新加载</button>
        </div>
      </section>
    );
  }

  const { stats, coverage, gate } = overview;
  const pools = canonicalPools;
  const cov = coverage.coverageRatio.toFixed(1);
  const redline = coverage.redlinePct.toFixed(1);
  const pendingGroup = groupByStatus.get("pending_lock");
  const activeGroup = groupByStatus.get("active");
  const matureGroup = groupByStatus.get("mature_unclaimed");
  const claimedGroup = groupByStatus.get("claimed");
  const earlyGroup = groupByStatus.get("early_withdrawn");
  const slashedGroup = groupByStatus.get("slashed");
  const refundedGroup = groupByStatus.get("refunded");

  const adjApy = (pool: G1Pool) => {
    openActionConfirm({
      action: `Staking APY 调整 · ${pool.product} · ${displayTerm(pool)}`,
      detail: <>
        当前 APY {pool.apyDisplay} · 影响产品 <b>{pool.product} · {displayTerm(pool)}</b> · 影响范围 <b>仅新单</b>(存量按开锁时锁定值结算,不追溯)。
        <div className="gtint" data-proof="g1-apy-preview" style={{ marginTop: 10 }}>
          <div><b>调整影响预览</b></div>
          <div>当前在锁本金:<b>{pool.lockedDisplay}</b> · active position:<b>{fmtCount(stats.activeCount)}</b> 单</div>
          <div>当前累计应付利息:<b>{fmtM(stats.interestUsd)}</b> · 来自真实锁仓持仓</div>
          <div>B1 兑付覆盖率:<b>{cov}%</b> · 红线 {redline}%</div>
          <div>升 APY 是放大流出,提交后由后端重新验覆盖率红线与跨档 APY 保序。</div>
        </div>
      </>,
      coverage: { coverageRatio: coverage.coverageRatio, redlinePct: coverage.redlinePct },
      edit: { kind: "number", current: pool.apy, unit: "%", min: 0, max: 300, step: 0.01, disallowCurrent: true, amplifiesWhen: "increase" },
      run: async (reason, value) => {
        if (!value) return;
        await mutate(`apy:${pool.tierKey}`, () => updateG1StakingPoolParam(
          pool.tierKey, "apy", value, reason, currentAdminOperator(),
        ), `APY 已调整 · ${pool.product} · ${displayTerm(pool)}`);
      },
    });
  };

  const adjPenalty = (pool: G1Pool) => {
    openActionConfirm({
      action: `Staking 提前赎回罚款调整 · ${pool.product} · ${displayTerm(pool)}`,
      detail: <>当前罚款 {pool.penaltyDisplay}。降罚款是放大流出,提交后端会按真实 B1 覆盖率红线校验(当前 {cov}%,红线 {redline}%)。只对新单生效。</>,
      coverage: { coverageRatio: coverage.coverageRatio, redlinePct: coverage.redlinePct },
      edit: { kind: "number", current: pool.penalty, unit: "%", min: 0, max: 100, step: 0.01, disallowCurrent: true, amplifiesWhen: "decrease" },
      run: async (reason, value) => {
        if (!value) return;
        await mutate(`penalty:${pool.tierKey}`, () => updateG1StakingPoolParam(
          pool.tierKey, "penalty", value, reason, currentAdminOperator(),
        ), `提前赎回罚款已调整 · ${pool.product} · ${displayTerm(pool)}`);
      },
    });
  };

  const adjMin = (pool: G1Pool) => {
    openActionConfirm({
      action: `Staking 最小额调整 · ${pool.product} · ${displayTerm(pool)}`,
      detail: <>当前最小额 {pool.minDisplayValue}。最小额收紧不影响在锁单,只对新单生效。</>,
      coverage: { coverageRatio: coverage.coverageRatio, redlinePct: coverage.redlinePct },
      edit: { kind: "number", current: pool.minStake, unit: "USDT", min: 0, max: 1_000_000_000, step: 0.01, disallowCurrent: true, amplifiesWhen: "decrease" },
      run: async (reason, value) => {
        if (!value) return;
        await mutate(`min:${pool.tierKey}`, () => updateG1StakingPoolParam(
          pool.tierKey, "min", value, reason, currentAdminOperator(),
        ), `最小锁仓额已调整 · ${pool.product} · ${displayTerm(pool)}`);
      },
    });
  };

  const togglePool = (pool: G1Pool) => {
    const nextEnabled = !pool.enabled;
    openActionConfirm({
      action: `${pool.enabled ? "停售" : "恢复开售"}档位 · ${pool.product} · ${displayTerm(pool)}`,
      detail: <>{pool.enabled ? "停售只停新锁,在锁单照常计息到期。" : `恢复该档新锁仓开放,后端会按真实 B1 覆盖率红线校验(当前 ${cov}%,红线 ${redline}%)。`}操作确认。</>,
      amplifies: nextEnabled,
      coverage: { coverageRatio: coverage.coverageRatio, redlinePct: coverage.redlinePct },
      run: async (reason) => {
        await mutate(`sale:${pool.tierKey}`, () => updateG1StakingPoolSaleStatus(
          pool.tierKey, nextEnabled, reason, currentAdminOperator(),
        ), `${nextEnabled ? "已恢复开售" : "已停售"} · ${pool.product} · ${displayTerm(pool)}`);
      },
    });
  };

  const killTier = (pool: G1Pool) => {
    if (pool.killed) return;
    openActionConfirm({
      action: `单档熔断 · ${pool.product} · ${displayTerm(pool)}`,
      detail: <>熔断该档会立即停止新锁,并由后端原子执行在锁单处置、A2 审计与事件发件箱。恢复只能从 J1 Kill-Switch 矩阵执行。</>,
      businessForm: {
        kind: "multi-field",
        title: "熔断依据与持仓处置",
        hint: "两项都将写入审计和事件;操作理由需独立说明本次判断。",
        fields: [
          { key: "triggerBasis", label: "触发依据", inputKind: "select", current: "MANUAL_RISK_REVIEW", options: ["MANUAL_RISK_REVIEW", "B1_COVERAGE_BREACH", "INCIDENT_RESPONSE", "COMPLIANCE_HOLD"], optionLabels: { MANUAL_RISK_REVIEW: "人工风险复核", B1_COVERAGE_BREACH: "B1 覆盖率破线", INCIDENT_RESPONSE: "事故响应", COMPLIANCE_HOLD: "合规冻结" }, required: true, showDiff: true },
          { key: "dispositionPlan", label: "在锁单处置方案", inputKind: "text", placeholder: "说明本金、利息与用户通知安排", required: true, wide: true },
        ],
      },
      run: async (reason, _value, businessValue) => {
        await mutate(`kill:${pool.tierKey}`, () => updateG1StakingPoolKillStatus(
          pool.tierKey,
          true,
          reason,
          currentAdminOperator(),
          businessValue?.triggerBasis ?? "",
          businessValue?.dispositionPlan ?? "",
        ), `已熔断 · ${pool.product} · ${displayTerm(pool)}`);
      },
    });
  };

  const poolTable = (prod: string, rows: G1Pool[], minLabel: string) => (
    <div style={{ overflowX: "auto" }}>
      <table className="l-tbl" style={{ minWidth: 880 }}>
        <thead><tr><th>期限</th><th className="num">年化 APY</th><th className="num">提前赎回罚款</th><th className="num">{minLabel}</th><th className="num">在锁本金</th><th>状态</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={7} style={{ color: "var(--ink-3)", textAlign: "center", padding: 22 }}>暂无锁仓池数据</td></tr>
          )}
          {rows.map((pool) => {
            const busy = !!busyKey;
            return (
              <tr key={pool.tierKey} style={pool.killed ? { opacity: 0.55 } : undefined}>
                <td style={{ fontWeight: 600, color: "var(--ink)" }}>{displayTerm(pool)}</td>
                <td className="num mono" style={{ fontWeight: 700, color: pool.highYield ? "var(--warning)" : undefined }}>
                  <span className="row" style={{ gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                    <span>{pool.apyDisplay}{pool.highYield && <span className="bdg warn" style={{ fontSize: 9, marginLeft: 5 }}>高息</span>}</span>
                    <button className="l-btn sm mc" disabled={busy || !canAdjustApy} title={canAdjustApy ? "调整 APY" : "缺少 finprod_g1_apy_write 权限"} onClick={() => adjApy(pool)}>调整 APY</button>
                  </span>
                </td>
                <td className="num mono">
                  <span className="row" style={{ gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                    <span>{pool.penalty}%</span>
                    <button className="l-btn sm mc" disabled={busy || !canAdjustPenalty} title={canAdjustPenalty ? "调整提前赎回罚款" : "缺少 finprod_g1_penalty_write 权限"} onClick={() => adjPenalty(pool)}>调整罚款</button>
                  </span>
                </td>
                <td className="num mono" style={{ color: "var(--ink-3)" }}>
                  <span className="row" style={{ gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                    <span>{pool.minDisplayValue}</span>
                    <button className="l-btn sm" disabled={busy || !canAdjustMin} title={canAdjustMin ? "调整最小锁仓额" : "缺少 finprod_g1_min_write 权限"} onClick={() => adjMin(pool)}>调整最小额</button>
                  </span>
                </td>
                <td className="num mono">{pool.lockedDisplay}</td>
                <td><span className={`bdg ${pool.statusTone === "bad" ? "bad" : pool.statusTone}`}>{pool.statusLabel}</span></td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button
                    className={`l-btn sm${pool.enabled && !pool.killed ? " mc" : ""}`}
                    onClick={() => togglePool(pool)}
                    disabled={busy || pool.killed || !canToggleSale}
                    style={pool.killed ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
                  >
                    {pool.enabled ? "停售" : "恢复开售"}
                  </button>
                  {" "}
                  {pool.killed
                    ? <a className="l-btn sm" href="/emergency/kill-switch" title="G1 不允许解除;请前往 J1">前往 J1 恢复</a>
                    : <button className="l-btn sm mc" disabled={busy || !canKill} title={canKill ? "熔断该档" : "缺少 finprod_g1_kill_toggle 权限"} onClick={() => killTier(pool)}>熔断</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <PaginationExemption
        label={`${prod} 锁仓池 4 档配置表`}
        maxRows={4}
        reason="静态四档配置需一屏横向比较 APY、罚款、最小额与开关; 分页会破坏跨档保序审核。"
      />
    </div>
  );

  const dd: G1PositionGroup | undefined = drawer ? groupByStatus.get(drawer) : undefined;

  return (
    <>
      {error && (
        <section className="l-card">
          <div className="l-b">
            <div className="gtint">G1 数据刷新失败 · {error}</div>
            <button className="l-btn mc" style={{ marginTop: 10 }} onClick={() => void reload(true)}>重试</button>
          </div>
        </section>
      )}

      <div className="f-stats">
        <div className="f-stat ok"><div className="k">USDT 在锁本金</div><div className="v">{fmtM(stats.usdtPoolUsd)}</div><div className="sub">G1 USDT 池 · NEX 质押已下线</div></div>
        <div className="f-stat"><div className="k">在锁 position 数</div><div className="v">{fmtCount(stats.positionCount)}</div><div className="sub">active {fmtCount(stats.activeCount)} · 到期未领 {fmtCount(stats.matureCount)}</div></div>
        <div className="f-stat warn"><div className="k">累计应付利息</div><div className="v">{fmtM(stats.interestUsd)}</div><div className="sub">按已锁天数线性派生 · 真实持仓</div></div>
        <div className="f-stat danger"><div className="k">单档熔断</div><div className="v">{stats.killedCount}</div><div className="sub">高息长锁档重点盯 · 整池闸 {gate.enabled ? "在线(J1)" : "已熔断(J1)"}</div></div>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">USDT 锁仓池 · 4 档</span>
          <span className="sub">· 改利率/罚款/开关都操作确认 · 只对新单生效</span>
          <div className="r"><span className="gcode electric">升息/降罚过 B1 红线 + 保序校验</span></div>
        </div>
        {poolTable("USDT", pools, "最小额")}
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">Position 状态机与监控</span>
          <span className="sub">· 真实持仓只读 · 状态只能服务器推进,客户端伪造无效</span>
        </div>
        <div className="l-b">
          <div className="pos-grid" style={{ marginBottom: 14 }}>
            <div className="p click" onClick={() => setDrawer("pending_lock")}><div className="k">pending_lock 待确认 <span className="more">看清单›</span></div><div className="v">{fmtCount(pendingGroup?.count ?? stats.pendingCount)}</div></div>
            <div className="p click" onClick={() => setDrawer("active")}><div className="k">active 计息中 <span className="more">看清单›</span></div><div className="v" style={{ color: "var(--success)" }}>{fmtCount(activeGroup?.count ?? stats.activeCount)}</div></div>
            <div className="p click" onClick={() => setDrawer("mature_unclaimed")}><div className="k">mature_unclaimed 到期未领 <span className="more">看清单›</span></div><div className="v" style={{ color: "var(--warning)" }}>{fmtCount(matureGroup?.count ?? stats.matureCount)}</div></div>
            <div className="p click" onClick={() => setDrawer("early_withdrawn")}><div className="k">本月 early_withdrawn 提前赎回 <span className="more">看清单›</span></div><div className="v">{fmtCount(earlyGroup?.count ?? stats.earlyWithdrawnMonth)}</div></div>
            <div className="p click" onClick={() => setDrawer("claimed")}><div className="k">claimed 已领取 <span className="more">看清单›</span></div><div className="v">{fmtCount(claimedGroup?.count ?? 0)}</div></div>
            <div className="p click" onClick={() => setDrawer("slashed")}><div className="k">slashed 熔断处置 <span className="more">看清单›</span></div><div className="v" style={{ color: "var(--danger)" }}>{fmtCount(slashedGroup?.count ?? 0)}</div></div>
            <div className="p click" onClick={() => setDrawer("refunded")}><div className="k">refunded 已退款 <span className="more">看清单›</span></div><div className="v">{fmtCount(refundedGroup?.count ?? 0)}</div></div>
          </div>
          <div className="sm-strip">
            <span className="st">pending_lock</span><span className="ar">确认 →</span>
            <span className="st ok">active 计息中</span><span className="ar">到期 →</span>
            <span className="st warn">mature_unclaimed</span><span className="ar">领取 →</span>
            <span className="st ok">claimed 已领本息</span>
            <span className="ar" style={{ marginLeft: 12 }}>旁路:</span>
            <span className="st bad">early_withdrawn 罚款 forfeit 利息</span>
            <span className="st bad">slashed 熔断处置</span>
            <span className="st">refunded 锁失败退本</span>
          </div>
          <div className="gtint" style={{ marginTop: 12 }}><b>到期与负债联动</b> · 开锁即增应付负债(本金 + 按已锁天数线性派生的应付利息),到期派发记账单;本息派发带防重号,熔断锁定优先。</div>
        </div>
      </section>

      <p className="f-foot"><b>三道硬门</b>:① 升 APY / 降罚款 = 放大资金流出,提交即由后端验备付金覆盖率红线,低于红线拒绝(422);② 同产品长期档 APY 必须 ≥ 相邻短期档(保序),违反拒绝并提示冲突档;③ 单档熔断提案必须随附在锁单处置方案。在锁单按开锁时锁定的利率结算,改参数不追溯历史。当前覆盖率 <b>{cov}%</b>,红线 <b>{redline}%</b>,数据来自 <b>后端锁仓产品与持仓统计</b>。</p>

      {dd && (
        <Drawer title={`锁仓单清单 · ${dd.label}`} sub={dd.note} onClose={() => setDrawer(null)}
          footer={<button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setDrawer(null)}>关闭</button>}>
          <table className="l-tbl">
            <thead><tr><th>position</th><th>用户</th><th>产品档</th><th>本金</th><th>锁定 APY / 罚款</th><th>锁定 / 解锁</th><th>预计利息</th><th>备注</th></tr></thead>
            <tbody>
              {dd.rows.length === 0 && <tr><td colSpan={8} style={{ color: "var(--ink-3)", textAlign: "center", padding: 18 }}>暂无该状态锁仓单</td></tr>}
              {dd.rows.map((row) => (
                <tr key={row.positionNo}>
                  <td className="mono" style={{ color: "var(--ink)" }}>{row.positionNo}</td>
                  <td><span className="mono">{row.userNo}</span><div className="tiny" style={{ color: "var(--ink-3)" }}>{row.nickname}</div></td>
                  <td>{row.tier}</td>
                  <td className="mono" style={{ fontWeight: 700 }}>{row.amount}</td>
                  <td className="mono">{row.lockedApy}<div className="tiny" style={{ color: "var(--ink-3)" }}>{row.earlyPenalty}</div></td>
                  <td className="mono" style={{ fontSize: 11 }}>{row.lockedAt}<div className="tiny" style={{ color: "var(--ink-3)" }}>{row.unlockAt}</div></td>
                  <td className="mono">{row.estimatedInterest}</td>
                  <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="gtint" style={{ marginTop: 12 }}><b>只读监控</b> · position 状态只能服务器推进,这里不手动改单。要点名某个档止损走「单档熔断」;单用户资产去用户域(C3)。</div>
        </Drawer>
      )}
    </>
  );
}
