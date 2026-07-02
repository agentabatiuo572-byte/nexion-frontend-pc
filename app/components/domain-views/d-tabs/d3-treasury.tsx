"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { useEffect, useMemo, useState } from "react";
import { createD3Injection, fetchD3DualLedger, updateD3Scope, updateD3Thresholds, type D3DualLedger } from "@/lib/admin/d-client";
import type { DCtx } from "./types";

const OPERATOR = currentAdminOperator;

function money(value: number) {
  return `$${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function pct(value: number) {
  return `${Number(value || 0).toFixed(2)}%`;
}

export function D3Treasury({ ctx }: { ctx: DCtx }) {
  const { toast, openConfirm } = ctx;
  const [data, setData] = useState<D3DualLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [voucherNo, setVoucherNo] = useState("");
  const [scope, setScope] = useState("");
  const [redlinePct, setRedlinePct] = useState("");
  const [healthyPct, setHealthyPct] = useState("");
  const [runRiskPct, setRunRiskPct] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const next = await fetchD3DualLedger();
      setData(next);
      setScope(next.snapshot.scope);
      setRedlinePct(String(next.snapshot.redlinePct));
      setHealthyPct(String(next.snapshot.healthyPct));
      setRunRiskPct(String(next.snapshot.runRiskPct));
    } catch (err) {
      setError(err instanceof Error ? err.message : "D3 数据加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const maturityTotal = useMemo(() => (data?.maturity7d ?? []).reduce((sum, row) => sum + row.withdrawUsd + row.interestUsd + row.genesisUsd, 0), [data?.maturity7d]);
  const maxSeries = Math.max(1, ...(data?.snapshot.coverageSeries ?? [0]));

  const saveInjection = () => {
    const nextAmount = amount.trim();
    const nextVoucher = voucherNo.trim() || `D3-${Date.now()}`;
    if (!nextAmount || Number(nextAmount) <= 0) {
      toast("请输入有效注资金额");
      return;
    }
    openConfirm({
      action: "储备注入登记",
      detail: `登记 ${money(Number(nextAmount))}，凭证号 ${nextVoucher}。后端写储备配置并落审计。`,
      reason: true,
      okLabel: "登记",
      run: (reason) => {
        void createD3Injection(nextAmount, nextVoucher, reason, OPERATOR())
          .then((next) => {
            setData(next);
            setAmount("");
            setVoucherNo("");
            toast("储备注入已登记");
          })
          .catch((err) => setError(err instanceof Error ? err.message : "储备注入失败"));
      },
    });
  };

  const saveScope = () => {
    const nextScope = scope.trim();
    if (!nextScope) {
      toast("请输入口径说明");
      return;
    }
    openConfirm({
      action: "储备/负债口径调整",
      detail: nextScope,
      reason: true,
      okLabel: "保存口径",
      run: (reason) => {
        void updateD3Scope(nextScope, reason, OPERATOR())
          .then((next) => {
            setData(next);
            toast("口径已保存");
          })
          .catch((err) => setError(err instanceof Error ? err.message : "口径保存失败"));
      },
    });
  };

  const saveThresholds = () => {
    openConfirm({
      action: "覆盖率阈值调整",
      detail: `红线 ${redlinePct}% · 健康 ${healthyPct}% · 挤兑风险 ${runRiskPct}%`,
      reason: true,
      okLabel: "保存阈值",
      run: (reason) => {
        void updateD3Thresholds({ redlinePct, healthyPct, runRiskPct }, reason, OPERATOR())
          .then((next) => {
            setData(next);
            toast("覆盖率阈值已保存");
          })
          .catch((err) => setError(err instanceof Error ? err.message : "阈值保存失败"));
      },
    });
  };

  if (loading && !data) {
    return <section className="l-card"><div className="l-b">D3 数据加载中...</div></section>;
  }

  const snapshot = data?.snapshot;

  return (
    <>
      {error && <div className="dtint warn" style={{ marginBottom: 12 }}>D3 数据加载失败 · {error}</div>}

      <div className="f-stats">
        <div className="f-stat ok"><div className="k">真实储备</div><div className="v">{money(snapshot?.reserveUsd ?? 0)}</div><div className="sub">来源服务端策略 + 账本聚合</div></div>
        <div className="f-stat"><div className="k">应付负债</div><div className="v">{money(snapshot?.liabilitiesUsd ?? 0)}</div><div className="sub">钱包、锁仓、待出金等科目</div></div>
        <div className={`f-stat ${snapshot?.redlineBreached ? "danger" : "cyan"}`}><div className="k">覆盖率</div><div className="v">{pct(snapshot?.coverageRatio ?? 0)}</div><div className="sub">红线 {pct(snapshot?.redlinePct ?? 0)} · 健康 {pct(snapshot?.healthyPct ?? 0)}</div></div>
        <div className="f-stat warn"><div className="k">7 日到期预测</div><div className="v">{money(maturityTotal)}</div><div className="sub">提现队列 + 利息 + Genesis</div></div>
      </div>

      <div className="two-col r11">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">储备注入登记</span>
            <span className="sub">· 后端唯一写入口</span>
          </div>
          <div className="l-b">
            <div className="lookup" style={{ marginBottom: 10 }}>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="注资金额 USDT" />
              <input value={voucherNo} onChange={(e) => setVoucherNo(e.target.value)} placeholder="凭证号" />
              <button className="l-btn primary" onClick={saveInjection}>登记</button>
            </div>
            <div className="dtint">登记后写入后端储备配置，并返回最新双账本快照。</div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">口径与阈值</span>
            <span className="sub">· 写 treasury 配置</span>
            <div className="r"><button className="l-btn sm" onClick={() => void load()}>刷新</button></div>
          </div>
          <div className="l-b">
            <div className="lookup" style={{ marginBottom: 10 }}>
              <input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="储备/负债科目口径" />
              <button className="l-btn primary" onClick={saveScope}>保存口径</button>
            </div>
            <div className="lookup">
              <input value={redlinePct} onChange={(e) => setRedlinePct(e.target.value)} placeholder="红线 %" />
              <input value={healthyPct} onChange={(e) => setHealthyPct(e.target.value)} placeholder="健康 %" />
              <input value={runRiskPct} onChange={(e) => setRunRiskPct(e.target.value)} placeholder="挤兑风险 %" />
              <button className="l-btn primary" onClick={saveThresholds}>保存阈值</button>
            </div>
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">负债科目</span>
          <span className="sub">· 后端按真实表聚合</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 900 }}>
            <thead><tr><th>科目</th><th>说明</th><th className="num">金额</th><th>来源</th></tr></thead>
            <tbody>
              {(data?.accounts ?? []).map((account) => (
                <tr key={account.key}>
                  <td className="mono" style={{ color: "var(--ink)" }}>{account.key}</td>
                  <td>{account.label}</td>
                  <td className="num mono">{money(account.amount)}</td>
                  <td className="mono" style={{ color: "var(--ink-4)" }}>{account.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="two-col r11">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">覆盖率序列</span>
            <span className="sub">· 后端快照返回</span>
          </div>
          <div className="l-b">
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, data?.snapshot.coverageSeries.length ?? 1)}, 1fr)`, gap: 8, alignItems: "end", height: 180 }}>
              {(data?.snapshot.coverageSeries ?? []).map((value, index) => (
                <div key={`${value}-${index}`} title={pct(value)} style={{ minHeight: 20, height: `${Math.max(10, (value / maxSeries) * 160)}px`, background: value < (snapshot?.redlinePct ?? 0) ? "var(--danger)" : "var(--success)", borderRadius: 4, opacity: 0.84 }} />
              ))}
            </div>
            <div className="dtint" style={{ marginTop: 12 }}>当前净流 24h: {money(snapshot?.netFlow24hUsd ?? 0)} · 提现队列 {snapshot?.queueBacklogCount ?? 0} 笔 / {money(snapshot?.queueBacklogUsd ?? 0)} · 平均风险分 {snapshot?.avgRiskScore ?? 0}</div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">7 日到期预测</span>
            <span className="sub">· 后端计算</span>
          </div>
          <div className="l-b">
            {(data?.maturity7d ?? []).map((row) => (
              <div className="res-row" key={row.day}>
                <span className="nm">{row.day}<small>提现 {money(row.withdrawUsd)} · 利息 {money(row.interestUsd)} · Genesis {money(row.genesisUsd)}</small></span>
                <span className="v">{money(row.withdrawUsd + row.interestUsd + row.genesisUsd)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <p className="f-foot">D3 当前数据源: {(data?.sources ?? []).join(" / ") || "treasury backend"}。</p>
    </>
  );
}
