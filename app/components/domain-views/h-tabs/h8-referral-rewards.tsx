"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createH8CommandKey,
  fetchH8ReferralRewards,
  updateH8ReferralRewardParam,
  type H8ReferralRewardOverview,
} from "@/lib/admin/h-client";
import type { HCtx } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";

const PARAMS = [
  { key: "newcomer.usdt", label: "新人 USDT", unit: "USDT", kind: "number", max: 50, step: 0.000001 },
  { key: "newcomer.nex", label: "新人 NEX", unit: "NEX", kind: "number", max: 500, step: 0.000001 },
  { key: "newcomer.lockMode", label: "新人礼发放模式", unit: "", kind: "select", options: ["risk_bucket", "direct"] },
  { key: "inviter.nex", label: "邀请人 NEX", unit: "NEX", kind: "number", max: 999_999_999, step: 0.000001 },
] as const;

const LOCK_MODE_LABELS: Record<string, string> = {
  risk_bucket: "先风控评估再发放",
  direct: "通过资格校验后直接发放",
};
const LOCK_MODE_VALUES: Record<string, string> = Object.fromEntries(Object.entries(LOCK_MODE_LABELS).map(([key, value]) => [value, key]));

export default function H8ReferralRewards({ ctx }: { ctx: HCtx }) {
  const session = useAdminAuth((state) => state.session);
  const isSuperadmin = session?.role === "superadmin";
  const canWrite = isSuperadmin || !!session?.authorities.includes("growth_h8_write");
  const canSettle = isSuperadmin || !!session?.authorities.includes("growth_h8_settle");
  const [data, setData] = useState<H8ReferralRewardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const propose = usePropose();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchH8ReferralRewards());
      setError(null);
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "H8_DATA_LOAD_FAILED");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const editParam = (param: (typeof PARAMS)[number]) => {
    if (!data) return;
    const commandKey = createH8CommandKey("h8-param");
    const rawCurrent = String(data?.params?.[param.key] ?? (param.kind === "select" ? "risk_bucket" : "0"));
    const current = param.kind === "select" ? LOCK_MODE_LABELS[rawCurrent] ?? LOCK_MODE_LABELS.risk_bucket : rawCurrent;
    ctx.openActionConfirm({
      action: `H8 发奖参数 · ${param.label}`,
      detail: `${param.label} 当前 ${current} ${param.unit}。新值只用于后续发放；已入账奖励不回写。升额或切 direct 会先过 B1 覆盖率红线。`,
      amplifies: true,
      edit: param.kind === "select"
        ? { kind: "select", current, options: Object.values(LOCK_MODE_LABELS) }
        : { kind: "number", current, unit: param.unit, min: 0, max: param.max, step: param.step },
      run: async (reason, value) => {
        if (value == null || value === "") return;
        const storedValue = param.kind === "select" ? LOCK_MODE_VALUES[value] ?? value : value;
        await updateH8ReferralRewardParam(param.key, storedValue, reason, data.version, commandKey);
        await load();
        ctx.toast(`${param.label} 已更新为 ${value} ${param.unit}`);
      },
    });
  };

  const settle = () => ctx.openActionConfirm({
    action: "执行邀请奖励真实结算",
    detail: `按服务端邀请关系扫描尚未结算的记录；当前 H1 第 ${data?.rhythmMonth ?? "—"} 月倍率计入后，每组结算为新人 ${data?.effectiveRewards?.["newcomer.usdt"] ?? "—"} USDT + ${data?.effectiveRewards?.["newcomer.nex"] ?? "—"} NEX、邀请人 ${data?.effectiveRewards?.["inviter.nex"] ?? "—"} NEX。奖励分别写入真实钱包与资金台账，同一新人只会结算一次。`,
    amplifies: true,
    edit: { kind: "number", current: "20", unit: "条", min: 1, max: 100, step: 1 },
    run: async (reason, value) => {
      const limit = Math.max(1, Math.min(100, Number(value) || 20));
      const def = findHighOp("h8_referral_settlement")!;
      await propose(ctx.toast, {
        action: "执行邀请奖励真实结算",
        obj: "待结算邀请批次",
        before: `待结算 ${Number(data?.pending ?? 0)} 条`,
        after: `最多结算 ${limit} 条`,
        type: "fund",
        amplifies: true,
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "H8",
        command: def.buildCommand({ limit }),
        target: def.buildTarget({ limit }),
      });
    },
  });

  if (loading && !data) return <section className="l-card"><div className="l-b">H8 真实发奖数据加载中...</div></section>;
  if (error && !data) return <section className="l-card"><div className="l-b">H8 真实发奖数据读取失败 · {error} <button className="l-btn sm" onClick={() => void load()}>重试</button></div></section>;

  return (
    <>
      <div className="f-stats">
        <div className="f-stat warn"><div className="k">待结算邀请</div><div className="v">{data?.pending ?? 0}</div><div className="sub">真实 sponsor 关系且未发奖</div></div>
        <div className="f-stat ok"><div className="k">累计已结算</div><div className="v">{data?.settled ?? 0}</div><div className="sub">同一新人只结算一次</div></div>
        <div className="f-stat danger"><div className="k">风控暂缓</div><div className="v">{data?.blockedByK2 ?? 0}</div><div className="sub">新人或邀请人命中 K1/K2，暂不入可用余额</div></div>
        <div className="f-stat cyan"><div className="k">结算模式</div><div className="v">真实钱包与资金台账</div><div className="sub">结算结果由服务端持久化</div></div>
      </div>

      <section className="l-card">
        <div className="l-h"><span className="ttl">新人礼与邀请人奖励</span><span className="sub">· H8 唯一配置入口</span><div className="r">{canSettle && <button className="l-btn mc" disabled={!data || Number(data.pending ?? 0) <= 0} title={Number(data?.pending ?? 0) <= 0 ? "当前没有待结算邀请" : undefined} onClick={settle}>执行真实结算</button>}</div></div>
        <div className="l-b"><div className="param-grid">
          {PARAMS.map((param) => <div className="p" key={param.key}>
            <div className="k">{param.label}</div>
            <div className="v">{param.kind === "select" ? LOCK_MODE_LABELS[String(data?.params?.[param.key] ?? "risk_bucket")] : `基础 ${String(data?.params?.[param.key] ?? "0")}`} <span className="vu">{param.unit}</span>{canWrite && <button className="l-btn sm mc" disabled={!data} onClick={() => editParam(param)}>调整</button>}</div>
            <div className="s">{param.kind === "select"
              ? "影响后续真实结算；所有修改强制理由、幂等键和审计。"
              : `H1 第 ${data?.rhythmMonth ?? "—"} 月倍率计入后，实际发放 ${String(data?.effectiveRewards?.[param.key] ?? "—")} ${param.unit}（${param.key.startsWith("newcomer.") ? data?.newcomerMultiplier : data?.inviterMultiplier}×）。`}</div>
          </div>)}
        </div></div>
      </section>

      <section className="l-card">
        <div className="l-h"><span className="ttl">最近真实发奖</span><span className="sub">· 数据源 服务端邀请关系</span></div>
        <div style={{ overflowX: "auto" }}><table className="l-tbl"><thead><tr><th>结算号</th><th>新人</th><th>邀请人</th><th>新人奖励</th><th>邀请人奖励</th><th>状态</th></tr></thead><tbody>
          {(data?.recentSettlements ?? []).map((row, index) => <tr key={row.settlementNo ?? index}><td className="mono">{row.settlementNo ?? "—"}</td><td>{row.invitedUserId ?? "—"}</td><td>{row.inviterUserId ?? "—"}</td><td>{row.newcomerUsdt ?? 0} USDT + {row.newcomerNex ?? 0} NEX</td><td>{row.inviterNex ?? 0} NEX</td><td><span className="bdg ok">{row.status ?? "SETTLED"}</span></td></tr>)}
          {!data?.recentSettlements?.length && <tr><td colSpan={6} style={{ textAlign: "center", padding: 24 }}>{Number(data?.pending ?? 0) > 0 ? "当前尚无结算记录，可从上方执行待结算邀请" : "暂无结算记录，当前也没有待结算邀请"}</td></tr>}
        </tbody></table></div>
      </section>
      <p className="f-foot"><b>真实发奖链</b>：邀请关系 → 唯一结算记录 → 新人 / 邀请人钱包入账 → USDT / NEX 资金台账 → A2 审计。结算结果以服务端邀请关系、唯一结算记录、钱包与资金台账为准。</p>
    </>
  );
}
