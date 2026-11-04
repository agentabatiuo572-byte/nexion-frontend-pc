"use client";
import { operatorNicknameText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";


import { displayAdminError } from "@/lib/admin/error-messages";
/**
 * G1 质押产品配置 — 退役产品的原档位与持仓只读查询，数据来自后端业务表。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Drawer, PaginationExemption } from "../design-kit";
import {
  fetchG1StakingOverview,
  type G1Overview,
  type G1Pool,
  type G1PositionGroup,
} from "@/lib/admin/g1-client";

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
  return displayAdminError(error);
}

export function G1Staking() {
  const [overview, setOverview] = useState<G1Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
  // 持仓状态的中文业务名(机器枚举仅作接口对齐,不进主文案)。
  const POSITION_STATE_LABELS: Record<string, string> = {
    pending_lock: "待确认",
    active: "计算奖励中",
    mature_unclaimed: "到期未领",
    claimed: "已领取",
    early_withdrawn: "提前解锁",
    slashed: "已罚没",
    refunded: "已退款",
  };
  const positionStateLabel = (state: string): string => POSITION_STATE_LABELS[state] ?? "状态未知";
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

  if (loading && !overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">质押</span><span className="sub">· 加载中</span></div>
        <div className="l-b"><div className="gtint">质押数据加载中…</div></div>
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">质押</span></div>
        <div className="l-b">
          <div className="gtint">质押数据加载失败 · {error || "没有收到数据，请重试；一直失败请联系值班同事。"}</div>
          <button className="l-btn mc" style={{ marginTop: 12 }} onClick={() => void reload()}>重新加载</button>
        </div>
      </section>
    );
  }

  const { stats, gate } = overview;
  const pools = canonicalPools;
  const pendingGroup = groupByStatus.get("pending_lock");
  const activeGroup = groupByStatus.get("active");
  const matureGroup = groupByStatus.get("mature_unclaimed");
  const claimedGroup = groupByStatus.get("claimed");
  const earlyGroup = groupByStatus.get("early_withdrawn");
  const slashedGroup = groupByStatus.get("slashed");
  const refundedGroup = groupByStatus.get("refunded");

  const poolTable = (rows: G1Pool[]) => (
    <div style={{ overflowX: "auto" }}>
      <table className="l-tbl" style={{ minWidth: 760 }}>
        <thead><tr><th>期限</th><th className="num">参考年奖励率</th><th className="num">提前解锁扣款</th><th className="num">最低锁仓额</th><th className="num">锁定金额</th><th>原档位状态</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} style={{ color: "var(--ink-3)", textAlign: "center", padding: 22 }}>暂无历史质押档位</td></tr>}
          {rows.map((pool) => <tr key={pool.tierKey}>
            <td style={{ fontWeight: 600, color: "var(--ink)" }}>{displayTerm(pool)}</td>
            <td className="num mono">{pool.apyDisplay}</td>
            <td className="num mono">{pool.penalty}%</td>
            <td className="num mono">{pool.minDisplayValue}</td>
            <td className="num mono">{pool.lockedDisplay}</td>
            <td><span className="bdg dim">{pool.killed ? "已暂停" : pool.enabled ? "原配置开启" : "原配置关闭"}</span></td>
          </tr>)}
        </tbody>
      </table>
      <PaginationExemption label="USDT 历史质押 4 档设置" maxRows={4} reason="四档历史配置一屏对照，只能查看。" />
    </div>
  );

  const dd: G1PositionGroup | undefined = drawer ? groupByStatus.get(drawer) : undefined;

  return (
    <>
      {error && (
        <section className="l-card">
          <div className="l-b">
            <div className="gtint">质押数据刷新失败 · {error}</div>
            <button className="l-btn mc" style={{ marginTop: 10 }} onClick={() => void reload(true)}>重试</button>
          </div>
        </section>
      )}

      <div className="f-stats">
        <div className="f-stat ok"><div className="k">USDT 锁定金额</div><div className="v">{fmtM(stats.usdtPoolUsd)}</div><div className="sub">UVT 质押已下线</div></div>
        <div className="f-stat"><div className="k">持仓数</div><div className="v">{fmtCount(stats.positionCount)}</div><div className="sub">计算奖励中 {fmtCount(stats.activeCount)} · 到期未领 {fmtCount(stats.matureCount)}</div></div>
        <div className="f-stat warn"><div className="k">累计应付质押奖励</div><div className="v">{fmtM(stats.interestUsd)}</div><div className="sub">按已锁天数折算</div></div>
        <div className="f-stat danger"><div className="k">紧急暂停的档位</div><div className="v">{stats.killedCount}</div><div className="sub">质押总开关 {gate.enabled ? "开启" : "已关闭"}</div></div>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">质押已退役</span>
          <span className="sub">· 只保留历史查看</span>
        </div>
        <div className="l-b">可查看原档位配置和已有持仓记录，不能修改参数、显示入口、开售、暂停或恢复。</div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">USDT 历史质押 · 4 档</span>
          <span className="sub">· 原配置仅供查询</span>
        </div>
        {poolTable(pools)}
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">持仓状态</span>
          <span className="sub">· 只能查看，状态由系统自动推进</span>
        </div>
        <div className="l-b">
          <div className="pos-grid" style={{ marginBottom: 14 }}>
            <div className="p click" onClick={() => setDrawer("pending_lock")}><div className="k">{positionStateLabel("pending_lock")} <span className="more">看清单›</span></div><div className="v">{fmtCount(pendingGroup?.count ?? stats.pendingCount)}</div></div>
            <div className="p click" onClick={() => setDrawer("active")}><div className="k">{positionStateLabel("active")} <span className="more">看清单›</span></div><div className="v" style={{ color: "var(--success)" }}>{fmtCount(activeGroup?.count ?? stats.activeCount)}</div></div>
            <div className="p click" onClick={() => setDrawer("mature_unclaimed")}><div className="k">{positionStateLabel("mature_unclaimed")} <span className="more">看清单›</span></div><div className="v" style={{ color: "var(--warning)" }}>{fmtCount(matureGroup?.count ?? stats.matureCount)}</div></div>
            <div className="p click" onClick={() => setDrawer("early_withdrawn")}><div className="k">本月{positionStateLabel("early_withdrawn")} <span className="more">看清单›</span></div><div className="v">{fmtCount(earlyGroup?.count ?? stats.earlyWithdrawnMonth)}</div></div>
            <div className="p click" onClick={() => setDrawer("claimed")}><div className="k">{positionStateLabel("claimed")} <span className="more">看清单›</span></div><div className="v">{fmtCount(claimedGroup?.count ?? 0)}</div></div>
            <div className="p click" onClick={() => setDrawer("slashed")}><div className="k">{positionStateLabel("slashed")} <span className="more">看清单›</span></div><div className="v" style={{ color: "var(--danger)" }}>{fmtCount(slashedGroup?.count ?? 0)}</div></div>
            <div className="p click" onClick={() => setDrawer("refunded")}><div className="k">{positionStateLabel("refunded")} <span className="more">看清单›</span></div><div className="v">{fmtCount(refundedGroup?.count ?? 0)}</div></div>
          </div>
          <div className="sm-strip">
            <span className="st">{positionStateLabel("pending_lock")}</span><span className="ar">确认 →</span>
            <span className="st ok">{positionStateLabel("active")}</span><span className="ar">到期 →</span>
            <span className="st warn">{positionStateLabel("mature_unclaimed")}</span><span className="ar">领取 →</span>
            <span className="st ok">{positionStateLabel("claimed")}</span>
            <span className="ar" style={{ marginLeft: 12 }}>其他情况：</span>
            <span className="st bad">{positionStateLabel("early_withdrawn")} · 按比例扣款，质押奖励不发放</span>
            <span className="st bad">{positionStateLabel("slashed")}</span>
            <span className="st">{positionStateLabel("refunded")} · 锁仓失败，退回锁定金额</span>
          </div>
          <div className="gtint" style={{ marginTop: 12 }}><b>到期与应付款</b> · 一开始锁仓，平台就多一笔应付款（锁定金额 + 已产生的质押奖励）；到期自动发放锁定金额和奖励，不会重复发放。</div>
        </div>
      </section>

      <p className="f-foot">质押已退役，本页只供核对历史配置与持仓。已有订单的条件以订单记录为准。</p>

      {dd && (
        <Drawer title={`锁仓单清单 · ${positionStateLabel(dd.status)}`} sub="按持仓状态列出订单" onClose={() => setDrawer(null)}
          footer={<button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setDrawer(null)}>关闭</button>}>
          <table className="l-tbl">
            <thead><tr><th>持仓编号</th><th>用户</th><th>档位</th><th>锁定金额</th><th>下单时奖励率 / 扣款</th><th>开始 / 到期</th><th>预计质押奖励</th><th>备注</th></tr></thead>
            <tbody>
              {dd.rows.length === 0 && <tr><td colSpan={8} style={{ color: "var(--ink-3)", textAlign: "center", padding: 18 }}>暂无这个状态的订单</td></tr>}
              {dd.rows.map((row) => (
                <tr key={row.positionNo}>
                  <td className="mono" style={{ color: "var(--ink)" }}>{row.positionNo}</td>
                  <td><span className="mono">{row.userNo}</span><div className="tiny" style={{ color: "var(--ink-3)" }}>{operatorNicknameText(row.nickname)}</div></td>
                  <td>{operatorCopyText(row.tier)}</td>
                  <td className="mono" style={{ fontWeight: 700 }}>{operatorCopyText(row.amount)}</td>
                  <td className="mono">{row.lockedApy}<div className="tiny" style={{ color: "var(--ink-3)" }}>{row.earlyPenalty}</div></td>
                  <td className="mono" style={{ fontSize: 11 }}>{row.lockedAt}<div className="tiny" style={{ color: "var(--ink-3)" }}>{row.unlockAt}</div></td>
                  <td className="mono">{row.estimatedInterest}</td>
                  <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{operatorCopyText(row.note)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="gtint" style={{ marginTop: 12 }}><b>只能查看</b> · 这里不能手动改订单。查看某个用户的资产，去「查找用户与查看资料」。</div>
        </Drawer>
      )}
    </>
  );
}
