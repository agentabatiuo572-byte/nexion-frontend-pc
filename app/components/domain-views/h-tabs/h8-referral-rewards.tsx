"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  createH8CommandKey,
  fetchH8ReferralRewards,
  fetchH8AcceptanceSandboxOverview,
  runH8AcceptanceSandboxSettlement,
  isH8OutcomeUncertainError,
  updateH8ReferralRewardParam,
  type H8ReferralRewardOverview,
} from "@/lib/admin/h-client";
import type { HCtx } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import { displayAdminError } from "@/lib/admin/error-messages";

/** H8 发奖参数与结算的稳定命令号:槽位=动作|参数键,指纹带 expectedVersion(旧快照重提自动换号)。
 *  落 sessionStorage,结果未知后刷新页面原样重试仍复用同号被后端去重。 */
const commandAttempts = createSlotAttemptStore({ storageKey: "nexion-admin-h8-commands-v1" });

const PARAMS = [
  { key: "newcomer.usdt", label: "新人 USDT", unit: "USDT", kind: "number", max: 50, step: 0.000001 },
  { key: "newcomer.nex", label: "新人 NEX", unit: "NEX", kind: "number", max: 500, step: 0.000001 },
  { key: "newcomer.lockMode", label: "新人礼发放模式", unit: "", kind: "select", options: ["risk_bucket", "direct"] },
  { key: "inviter.nex", label: "邀请人 NEX", unit: "NEX", kind: "number", max: 249_999_999.75, step: 0.000001 },
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
      setError(displayAdminError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const editParam = (param: (typeof PARAMS)[number]) => {
    if (!data) return;
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
        // 指纹 = 新值 + 版本号(CAS),**不含 reason**:理由是审计元数据不是意图,进指纹会让
        // 「结果未知后补一句理由再点」换新号 → 重复发奖。版本号进指纹是必须的:基于旧快照的
        // 同值重提是新意图,不是重试。
        const slot = `param|${param.key}`;
        let mintedFresh = false;
        const commandKey = commandAttempts.resolve(
          slot,
          JSON.stringify([storedValue, data.version]),
          () => { mintedFresh = true; return createH8CommandKey("h8-param"); },
        );
        try {
          await updateH8ReferralRewardParam(param.key, storedValue, reason, data.version, commandKey);
          commandAttempts.forget(slot);
        } catch (error) {
          // 只有全新尝试才在确定性失败时弃号:复用来的号说明上次结果未知,这次的 4xx 证明不了那次没落地。
          if (mintedFresh && !isH8OutcomeUncertainError(error)) commandAttempts.forget(slot);
          throw error;
        }
        await load();
        ctx.toast(`${param.label} 已更新为 ${value} ${param.unit}`);
      },
    });
  };

  const settle = () => {
    if (data?.settlementMode === "SANDBOX") {
      const fixture = data.fixtureCandidates?.[0];
      if (!fixture || !data.runId) {
        ctx.toast("当前 RunID 没有可准入的 Sandbox 邀请用户");
        return;
      }
      ctx.openActionConfirm({
        action: "执行 Sandbox 邀请奖励结算",
        detail: `仅结算 RunID ${data.runId} 的已准入 Sandbox 用户 ${fixture.invitedUserId}；不会访问生产钱包、生产结算表或 A2 真实结算，不写入生产 A2 审计、幂等或 Outbox。`,
        amplifies: false,
        run: async (reason) => {
          const slot = `sandbox-settle|${data.runId}|${fixture.invitedUserId}`;
          let mintedFresh = false;
          const commandKey = commandAttempts.resolve(
            slot,
            JSON.stringify([data.runId, fixture.invitedUserId, data.rewardSnapshotHash]),
            () => { mintedFresh = true; return createH8CommandKey("h8-settle"); },
          );
          try {
            await runH8AcceptanceSandboxSettlement(data.runId!, fixture.invitedUserId, reason, commandKey);
            commandAttempts.forget(slot);
          } catch (error) {
            if (isH8OutcomeUncertainError(error)) {
              // The POST receipt is not authority. Read the exact RunID-scoped
              // server projection before retaining the key for an original retry.
              try {
                setData(await fetchH8AcceptanceSandboxOverview(data.runId!));
              } catch {
                // A failed readback cannot prove the command failed; retain key.
              }
            }
            if (mintedFresh && !isH8OutcomeUncertainError(error)) commandAttempts.forget(slot);
            throw error;
          }
          await load();
          ctx.toast(`Sandbox RunID ${data.runId} 已结算用户 ${fixture.invitedUserId}`);
        },
      });
      return;
    }
    ctx.openActionConfirm({
    action: "执行邀请奖励真实结算",
    detail: `按服务端邀请关系扫描尚未结算的记录；当前 H1 第 ${data?.rhythmMonth ?? "—"} 月倍率计入后，每组结算为新人 ${data?.effectiveRewards?.["newcomer.usdt"] ?? "—"} USDT + ${data?.effectiveRewards?.["newcomer.nex"] ?? "—"} NEX、邀请人 ${data?.effectiveRewards?.["inviter.nex"] ?? "—"} NEX。奖励分别写入真实钱包与资金台账，同一新人只会结算一次。`,
    amplifies: true,
    edit: { kind: "number", current: "20", unit: "条", min: 1, max: 100, step: 1 },
    run: async (reason, value) => {
      const limit = Math.max(1, Math.min(100, Number(value) || 20));
      const def = findHighOp("h8_referral_settlement")!;
      const slot = "settle|batch";
      let mintedFresh = false;
      // 指纹必须覆盖整个提案信封:pending 计数进了 body 的 before,刷新页面后它会随新邀请关系变化。
      // 漏掉它则指纹相同而 body 变了 → 后端 payload-bound 幂等回 409,且因非全新尝试不弃号 = 24h 死锁。
      const commandKey = commandAttempts.resolve(
        slot,
        JSON.stringify([limit, data?.version, data?.rhythmMonth, data?.rewardSnapshotHash, data?.pending]),
        () => { mintedFresh = true; return createH8CommandKey("h8-settle"); },
      );
      try {
        await propose(ctx.toast, {
          action: "执行邀请奖励真实结算",
          obj: "待结算邀请批次",
          before: `待结算 ${Number(data?.pending ?? 0)} 条 · H8 v${data?.version ?? "—"} · H1 第 ${data?.rhythmMonth ?? "—"} 月`,
          after: `最多结算 ${limit} 条 · 新人 ${data?.effectiveRewards["newcomer.usdt"] ?? "—"} USDT + ${data?.effectiveRewards["newcomer.nex"] ?? "—"} NEX · 邀请人 ${data?.effectiveRewards["inviter.nex"] ?? "—"} NEX · 快照 ${data?.rewardSnapshotHash.slice(0, 12) ?? "—"}…`,
          type: "fund",
          amplifies: true,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "H8",
          commandKey,
          command: def.buildCommand({
            limit,
            expectedH8Version: data?.version,
            expectedRhythmMonth: data?.rhythmMonth,
            rewardSnapshotHash: data?.rewardSnapshotHash,
          }),
          target: def.buildTarget({ limit }),
        });
        commandAttempts.forget(slot);
      } catch (error) {
        if (mintedFresh && !isA2OutcomeUncertainError(error)) commandAttempts.forget(slot);
        throw error;
      }
    },
    });
  };

  const sandboxVisible = data?.settlementMode === "SANDBOX";
  if (loading && !data) return <section className="l-card"><div className="l-b">H8 发奖数据加载中...</div></section>;
  if (error && !data) return <section className="l-card"><div className="l-b">H8 发奖数据读取失败 · {error} <button className="l-btn sm" onClick={() => void load()}>重试</button></div></section>;

  return (
    <>
      <div className="f-stats">
        <div className="f-stat warn"><div className="k">待结算邀请</div><div className="v">{data?.pending ?? 0}</div><div className="sub">{sandboxVisible ? `Sandbox RunID ${data?.runId ?? "—"} 已准入用户` : "真实 sponsor 关系且未发奖"}</div></div>
        <div className="f-stat ok"><div className="k">累计已结算</div><div className="v">{data?.settled ?? 0}</div><div className="sub">{sandboxVisible ? "每 RunID + 受邀用户仅结算一次" : "同一新人只结算一次"}</div></div>
        <div className="f-stat danger"><div className="k">风控暂缓</div><div className="v">{data?.blockedByK2 ?? 0}</div><div className="sub">仅统计尚未发奖且命中 K1/K2 的邀请关系</div></div>
        <div className="f-stat cyan"><div className="k">结算模式</div><div className="v">{sandboxVisible ? "Sandbox 模拟台账" : "真实钱包与资金台账"}</div><div className="sub">结算结果由服务端持久化</div></div>
      </div>

      <section className="l-card">
        <div className="l-h"><span className="ttl">新人礼与邀请人奖励</span><span className="sub">{sandboxVisible ? "· Sandbox 只读配置快照" : "· H8 唯一配置入口"}</span><div className="r">{canSettle && <button className="l-btn mc" disabled={!data || Number(data.pending ?? 0) <= 0} title={Number(data?.pending ?? 0) <= 0 ? "当前没有待结算邀请" : undefined} onClick={settle}>{sandboxVisible ? "执行 Sandbox 结算" : "执行真实结算"}</button>}</div></div>
        <div className="l-b"><div className="param-grid">
          {PARAMS.map((param) => <div className="p" key={param.key}>
            <div className="k">{param.label}</div>
            <div className="v">{param.kind === "select" ? LOCK_MODE_LABELS[String(data?.params?.[param.key] ?? "risk_bucket")] : `基础 ${String(data?.params?.[param.key] ?? "0")}`} <span className="vu">{param.unit}</span>{sandboxVisible ? <span className="f-foot">只读配置快照</span> : canWrite && <button className="l-btn sm mc" disabled={!data} onClick={() => editParam(param)}>调整</button>}</div>
            <div className="s">{sandboxVisible
              ? "Sandbox 结算只读取此服务端配置快照，不提供参数修改入口。"
              : param.kind === "select"
                ? "影响后续真实结算；所有修改强制理由、幂等键和审计。"
                : `H1 第 ${data?.rhythmMonth ?? "—"} 月倍率计入后，实际发放 ${String(data?.effectiveRewards?.[param.key] ?? "—")} ${param.unit}（${param.key.startsWith("newcomer.") ? data?.newcomerMultiplier : data?.inviterMultiplier}×）。`}</div>
          </div>)}
        </div></div>
      </section>

      <section className="l-card">
        <div className="l-h"><span className="ttl">{sandboxVisible ? "最近 Sandbox 结算记录" : "最近真实发奖"}</span><span className="sub">{sandboxVisible ? `· RunID ${data?.runId ?? "—"} · mock/SANDBOX` : "· 数据源 服务端邀请关系"}</span></div>
        <div style={{ overflowX: "auto" }}><table className="l-tbl"><thead><tr><th>结算号</th><th>新人</th><th>邀请人</th><th>新人奖励</th><th>邀请人奖励</th><th>状态</th></tr></thead><tbody>
          {(data?.recentSettlements ?? []).map((row, index) => <tr key={row.settlementNo ?? index}><td className="mono">{row.settlementNo ?? "—"}</td><td>{row.invitedUserId ?? "—"}</td><td>{row.inviterUserId ?? "—"}</td><td>{row.newcomerUsdt ?? 0} USDT + {row.newcomerNex ?? 0} NEX</td><td>{row.inviterNex ?? 0} NEX</td><td><span className="bdg ok">{row.status === "SETTLED" ? "已结算" : "—"}</span></td></tr>)}
          {!data?.recentSettlements?.length && <tr><td colSpan={6} style={{ textAlign: "center", padding: 24 }}>{sandboxVisible
            ? (Number(data?.pending ?? 0) > 0 ? "当前 RunID 尚无 Sandbox 结算记录，可从上方执行已准入用户" : "当前 RunID 暂无 Sandbox 结算记录或待结算用户")
            : (Number(data?.pending ?? 0) > 0 ? "当前尚无结算记录，可从上方执行待结算邀请" : "暂无结算记录，当前也没有待结算邀请")}</td></tr>}
        </tbody></table></div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <span className="f-foot">结算后联动核对：</span>{" "}
          {!sandboxVisible && <><Link href="/platform/audit" className="l-btn sm">A2 审批与审计</Link>{" "}<Link href="/platform/events" className="l-btn sm">A4 事件</Link>{" "}<Link href="/finance/ledger" className="l-btn sm">D4 钱包台账</Link></>}
          {sandboxVisible && <span className="f-foot">Sandbox 仅核对 mock/SANDBOX RunID 投影；不进入生产 A2/A4/D4。</span>}
        </div>
      </section>
      <p className="f-foot">{sandboxVisible
        ? <><b>Sandbox 发奖链</b>：RunID 准入的 sandbox 用户 → mock/SANDBOX 结算投影 → 专用 sandbox 结算表与证明台账。生产 A2、A4、D4 与真实钱包均不参与。</>
        : <><b>真实发奖链</b>：App/H5 服务端奖励投影 → {data?.source ?? "服务端邀请关系"} → A2 审批 → 唯一结算记录 → 新人 / 邀请人钱包入账 → USDT / NEX 资金台账 → A4 事件。结算结果以服务端邀请关系、唯一结算记录、钱包与资金台账为准。</>}</p>
    </>
  );
}
