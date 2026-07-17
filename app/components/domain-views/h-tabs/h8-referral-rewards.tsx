"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchH8ReferralRewards,
  runH8ReferralSettlements,
  updateH8ReferralRewardParam,
  type H8ReferralRewardOverview,
} from "@/lib/admin/h-client";
import type { HCtx } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";

const PARAMS = [
  { key: "newcomer.usdt", label: "新人 USDT", unit: "USDT", kind: "number", max: 50 },
  { key: "newcomer.nex", label: "新人 NEX", unit: "NEX", kind: "number", max: 500 },
  { key: "newcomer.lockMode", label: "新人礼发放模式", unit: "", kind: "select", options: ["risk_bucket", "direct"] },
  { key: "inviter.nex", label: "邀请人 NEX", unit: "NEX", kind: "number", max: 999_999_999 },
] as const;

export default function H8ReferralRewards({ ctx }: { ctx: HCtx }) {
  const session = useAdminAuth((state) => state.session);
  const isSuperadmin = session?.role === "superadmin";
  const canWrite = isSuperadmin || !!session?.authorities.includes("growth_h8_write");
  const canSettle = isSuperadmin || !!session?.authorities.includes("growth_h8_settle");
  const [data, setData] = useState<H8ReferralRewardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchH8ReferralRewards());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "H8_DATA_LOAD_FAILED");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const editParam = (param: (typeof PARAMS)[number]) => {
    const current = String(data?.params?.[param.key] ?? (param.kind === "select" ? "risk_bucket" : "0"));
    ctx.openActionConfirm({
      action: `H8 发奖参数 · ${param.label}`,
      detail: `${param.label} 当前 ${current} ${param.unit}。新值只用于后续发放；已入账奖励不回写。升额或切 direct 会先过 B1 覆盖率红线。`,
      amplifies: true,
      edit: param.kind === "select"
        ? { kind: "select", current, options: [...param.options] }
        : { kind: "number", current, unit: param.unit, min: 0, max: param.max, step: 1 },
      run: async (reason, value) => {
        if (value == null || value === "") return;
        await updateH8ReferralRewardParam(param.key, value, reason);
        await load();
        ctx.toast(`${param.label} 已更新为 ${value} ${param.unit}`);
      },
    });
  };

  const settle = () => ctx.openActionConfirm({
    action: "执行邀请奖励真实结算",
    detail: "按 nx_user.sponsor_user_id 扫描尚未结算的邀请关系；新人和邀请人的奖励分别写真实钱包与资金台账。唯一键阻止同一新人重复发奖。",
    amplifies: true,
    edit: { kind: "number", current: "20", unit: "条", min: 1, max: 100, step: 1 },
    run: async (reason, value) => {
      const limit = Math.max(1, Math.min(100, Number(value) || 20));
      const result = await runH8ReferralSettlements(limit, reason);
      await load();
      ctx.toast(`结算完成 · 成功 ${result.settled} · 跳过 ${result.skipped}`);
    },
  });

  if (loading && !data) return <section className="l-card"><div className="l-b">H8 真实发奖数据加载中...</div></section>;
  if (error && !data) return <section className="l-card"><div className="l-b">H8 真实发奖数据读取失败 · {error} <button className="l-btn sm" onClick={() => void load()}>重试</button></div></section>;

  return (
    <>
      {error && <div className="ctint bad" style={{ marginBottom: 12 }}>刷新失败，以下为上次成功快照 · {error} <button className="l-btn sm" onClick={() => void load()}>重试</button></div>}
      <div className="f-stats">
        <div className="f-stat warn"><div className="k">待结算邀请</div><div className="v">{data?.pending ?? 0}</div><div className="sub">真实 sponsor 关系且未发奖</div></div>
        <div className="f-stat ok"><div className="k">累计已结算</div><div className="v">{data?.settled ?? 0}</div><div className="sub">同一新人只结算一次</div></div>
        <div className="f-stat danger"><div className="k">风控暂缓</div><div className="v">{data?.blockedByK2 ?? 0}</div><div className="sub">新人或邀请人命中 K1/K2，暂不入可用余额</div></div>
        <div className="f-stat cyan"><div className="k">结算模式</div><div className="v">真实账本</div><div className="sub">{data?.settlementMode ?? "REAL_WALLET_LEDGER"}</div></div>
      </div>

      <section className="l-card">
        <div className="l-h"><span className="ttl">新人礼与邀请人奖励</span><span className="sub">· H8 唯一配置入口</span><div className="r">{canSettle && <button className="l-btn mc" disabled={!data} onClick={settle}>执行真实结算</button>}</div></div>
        <div className="l-b"><div className="param-grid">
          {PARAMS.map((param) => <div className="p" key={param.key}>
            <div className="k">{param.label}</div>
            <div className="v">{String(data?.params?.[param.key] ?? "0")} <span className="vu">{param.unit}</span>{canWrite && <button className="l-btn sm mc" disabled={!data} onClick={() => editParam(param)}>调整</button>}</div>
            <div className="s">影响后续真实结算；所有修改强制理由、幂等键和审计。</div>
          </div>)}
        </div></div>
      </section>

      <section className="l-card">
        <div className="l-h"><span className="ttl">最近真实发奖</span><span className="sub">· 数据源 {data?.source ?? "nx_user.sponsor_user_id"}</span></div>
        <div style={{ overflowX: "auto" }}><table className="l-tbl"><thead><tr><th>结算号</th><th>新人</th><th>邀请人</th><th>新人奖励</th><th>邀请人奖励</th><th>状态</th></tr></thead><tbody>
          {(data?.recentSettlements ?? []).map((row, index) => <tr key={row.settlementNo ?? index}><td className="mono">{row.settlementNo ?? "—"}</td><td>{row.invitedUserId ?? "—"}</td><td>{row.inviterUserId ?? "—"}</td><td>{row.newcomerUsdt ?? 0} USDT + {row.newcomerNex ?? 0} NEX</td><td>{row.inviterNex ?? 0} NEX</td><td><span className="bdg ok">{row.status ?? "SETTLED"}</span></td></tr>)}
          {!data?.recentSettlements?.length && <tr><td colSpan={6} style={{ textAlign: "center", padding: 24 }}>暂无结算记录</td></tr>}
        </tbody></table></div>
      </section>
      <p className="f-foot"><b>真实发奖链</b>：邀请关系 → 唯一结算记录 → 新人 / 邀请人钱包入账 → USDT / NEX 资金台账 → A2 审计。页面不含 mock、样例账户或本地发奖状态。</p>
    </>
  );
}
