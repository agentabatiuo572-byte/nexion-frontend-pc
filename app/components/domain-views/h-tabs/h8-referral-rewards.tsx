"use client";
import { businessZone } from "@/lib/admin/business-time";
import { nexGridBrandText } from "@/lib/admin/brand-copy";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  createH8CommandKey,
  fetchH8ReferralRewards,
  h8EffectiveRewardReference,
  h8RewardParamAmplifies,
  h8RewardParamValid,
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
import { configApprovalOriginalInput, pendingConfigApproval, submitConfigApproval, type H8ConfigApprovalInput } from "@/lib/admin/withdrawal-config-approval";
import type { BusinessFormValue } from "../design-kit";

/** H8 发奖参数与结算的稳定命令号:槽位=动作|参数键,指纹带 expectedVersion(旧快照重提自动换号)。
 *  落 sessionStorage,结果未知后刷新页面原样重试仍复用同号被后端去重。 */
const commandAttempts = createSlotAttemptStore({ storageKey: "nexion-admin-h8-commands-v1" });

const PARAMS = [
  { key: "newcomer.usdt", label: "新人 USDT", unit: "USDT", kind: "number", max: 50, step: 0.000001 },
  { key: "newcomer.nex", label: "新人 UVT", unit: "UVT", kind: "number", max: 500, step: 0.000001 },
  { key: "newcomer.lockMode", label: "新人礼发放模式", unit: "", kind: "select", options: ["risk_bucket", "direct"] },
  { key: "inviter.nex", label: "邀请人 UVT", unit: "UVT", kind: "number", max: 249_999_999.75, step: 0.000001 },
] as const;

const LOCK_MODE_LABELS: Record<string, string> = {
  risk_bucket: "先过风险检查再发",
  direct: "符合资格就直接发",
};
const ENABLED_PARAM = { key: "enabled", label: "邀请奖励", unit: "", kind: "select", options: ["已停用", "已启用"] } as const;
const ENABLED_LABELS: Record<string, string> = { false: "已停用", true: "已启用" };
type H8Param = (typeof PARAMS)[number] | typeof ENABLED_PARAM;

export default function H8ReferralRewards({ ctx }: { ctx: HCtx }) {
  const session = useAdminAuth((state) => state.session);
  const isSuperadmin = session?.role === "superadmin";
  const canWrite = isSuperadmin || !!session?.authorities.includes("growth_h8_write");
  const canSettle = isSuperadmin || !!session?.authorities.includes("growth_h8_settle");
  const [data, setData] = useState<H8ReferralRewardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invitedUserIdInput, setInvitedUserIdInput] = useState("");
  const loadGeneration = useRef(0);
  const propose = usePropose();

  const load = useCallback(async (cursor = "", append = false) => {
    const request = ++loadGeneration.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const next = await fetchH8ReferralRewards(cursor);
      if (request !== loadGeneration.current) return;
      setData((current) => append && current ? {
        ...next,
        recentSettlements: [...current.recentSettlements, ...next.recentSettlements],
      } : next);
      setError(null);
    } catch (cause) {
      if (request !== loadGeneration.current) return;
      if (!append) setData(null);
      setError(displayAdminError(cause));
    } finally {
      if (request === loadGeneration.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => { loadGeneration.current += 1; };
  }, [load]);

  const editParam = (param: H8Param, fixedValue?: string) => {
    if (!data || !session) return;
    const isEnabled = param.key === "enabled";
    const numeric = param.kind === "number";
    const rawCurrent = String(data.params[param.key]);
    const current = isEnabled
      ? ENABLED_LABELS[rawCurrent] ?? ENABLED_LABELS.false
      : param.kind === "select" ? LOCK_MODE_LABELS[rawCurrent] ?? LOCK_MODE_LABELS.risk_bucket : rawCurrent;
    const approvalScope = { objectId: "current", field: param.key };
    const pending = pendingConfigApproval("H8", session.adminId, approvalScope);
    let original: H8ConfigApprovalInput | undefined;
    try {
      original = pending ? configApprovalOriginalInput("H8", pending.input) : undefined;
      if (original && original[0].key !== param.key) throw new Error("原审批命令不完整，请到操作记录核对。");
    } catch (cause) {
      ctx.toast(displayAdminError(cause));
      return;
    }
    const expectedVersion = original?.[0].expectedVersion ?? data.version;
    const enabling = isEnabled && (original?.[0].value ?? fixedValue ?? rawCurrent) === "true";
    const multiplier = param.key === "inviter.nex" ? data.inviterMultiplier : data.newcomerMultiplier;
    const storedValue = (value: BusinessFormValue) => (original?.[0].value ?? fixedValue ?? value.value ?? "").trim();
    const showValue = (value: string) => isEnabled ? ENABLED_LABELS[value] ?? "—"
      : numeric ? value || "—" : LOCK_MODE_LABELS[value] ?? "—";
    const ensureSession = () => {
      if (useAdminAuth.getState().session?.adminId !== session.adminId) {
        throw new Error("登录账号已变化，请关闭弹窗后重新操作。");
      }
    };
    const submitApproval = async (reason: string, value?: string, mode: boolean | "retry-original" = false) => {
      ensureSession();
      const result = await submitConfigApproval("H8", session,
        value === undefined ? null : { key: param.key, value, expectedVersion },
        reason, fetchH8ReferralRewards, mode, approvalScope);
      if (!result) return false;
      setData(result.active);
      setError(null);
      ctx.toast(result.acknowledgement);
      ctx.openActionConfirm(null);
      return true;
    };
    const approvalCopy = numeric
      ? "待审期间仍按原配置。批准时按当月倍率重新核对，新注册用户适用新配置。历史结算和冻结金额保持原值。"
      : isEnabled
        ? "批准前奖励保持关闭。另一位超管批准后启用，按当前月份倍率计算新注册奖励；历史已发和已冻结奖励不重算。"
        : "批准前沿用当前模式。原有资格校验及 H5 首笔实付后解冻规则继续生效，不会提前发放冻结礼包。";
    ctx.openActionConfirm({
      action: isEnabled ? enabling ? "启用新人礼与邀请奖励" : "停用新人礼与邀请奖励" : `调整邀请奖励 · ${param.label}`,
      detail: isEnabled
        ? enabling
          ? "启用须提交审批；批准前仍保持停用，不显示或发放新的新人礼和邀请人奖励。"
          : "停用后，App 仍能分享邀请码，但不再显示新人礼和邀请人奖励，也不再发新的奖励。"
        : numeric ? `${param.label} 当前基础额 ${current} ${param.unit}。调高须提交审批，降低直接保存。`
          : "改为符合资格直接发须提交审批；切回风险检查模式直接保存。两种模式都保留首购冻结规则。",
      amplifies: false,
      reasonMin: 8,
      reasonMax: 200,
      getPendingReason: () => original?.[1],
      completionCopy: isEnabled
        ? "停用立即生效，历史已发和已冻结奖励不重算。"
        : numeric ? "金额降低立即生效；历史结算和已冻结金额保持原值。"
          : "切回风险检查模式立即生效，历史结算和已冻结礼包沿用原规则。",
      businessForm: { kind: "multi-field", fields: fixedValue !== undefined ? [] : [{
        key: "value", label: numeric ? `${param.label}基础额` : "发放模式", required: true,
        current: original?.[0].value ?? (numeric ? "" : rawCurrent), inputKind: numeric ? "text" : "select",
        ...(numeric ? { pattern: "^(?:0|[1-9]\\d{0,11})(?:\\.\\d{1,6})?$", patternMessage: "请输入非负金额，最多六位小数。" }
          : { options: ["risk_bucket", "direct"], optionLabels: LOCK_MODE_LABELS }),
      }] },
      inlineApproval: {
        dialogClassName: "h8-reward-param-confirm",
        pending: !!pending,
        expired: !!pending && pending.expiresAt <= Date.now(),
        resolve: (form) => {
          const value = storedValue(form);
          if (!value) return undefined;
          if (!h8RewardParamValid(param.key, value)) return {
            heading: "请核对拟改值", disabledReason: numeric ? `请输入 0–${param.max} 的基础额，最多六位小数。` : "请选择有效的发放模式。",
            completionCopy: "本次尚未提交，请核对允许范围后再继续。",
          };
          if (!pending && !h8RewardParamAmplifies(param.key, rawCurrent, value)) return undefined;
          return {
            heading: "需另一位超管批准后生效",
            completionCopy: approvalCopy,
            disabledReason: numeric && h8EffectiveRewardReference(value, multiplier) === null
              ? "拟有效额超出允许范围，请核对基础额与当前倍率。" : undefined,
          };
        },
        renderForm: (form, onChange, locked) => {
          const value = storedValue(form);
          const reference = numeric && h8RewardParamValid(param.key, value) ? h8EffectiveRewardReference(value, multiplier) : null;
          return <>
            <div className="tint" style={{ marginBottom: 16 }}>当前{numeric ? "基础额" : ""} <b className="mono">{current}</b>
              {" → "}拟改 <b className="mono">{showValue(value)}</b>{numeric ? ` ${param.unit}` : ""}</div>
            {fixedValue === undefined && <div className="field">
              <label htmlFor="h8-reward-param-value">{numeric ? `${param.key === "inviter.nex" ? "每位邀请人" : "每人"}基础额（${param.unit}）` : "发放模式"}</label>
              {numeric ? <input id="h8-reward-param-value" className="fld" inputMode="decimal" type="text"
                aria-label={`${param.label}基础额`} aria-describedby="h8-reward-reference" disabled={locked}
                value={form.value ?? ""} onChange={(event) => onChange({ ...form, value: event.target.value })}
                placeholder={`0–${param.max}，最多六位小数`} style={{ width: "100%" }} />
                : <select id="h8-reward-param-value" className="fld" aria-label="新人礼发放模式" disabled={locked}
                  value={form.value ?? rawCurrent} onChange={(event) => onChange({ ...form, value: event.target.value })} style={{ width: "100%" }}>
                  {Object.entries(LOCK_MODE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>}
            </div>}
            {numeric && <p id="h8-reward-reference" className="tiny" style={{ margin: "0 0 14px", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
              当前第 {data.rhythmMonth} 月份倍率 {String(multiplier)}×；拟有效额 {reference ?? "—"} {param.unit}（提案时参考）
            </p>}
          </>;
        },
        recover: (reason, form) => submitApproval(reason, storedValue(form), true),
        retry: async () => { await submitApproval("", undefined, "retry-original"); },
      },
      run: async (reason, _, form) => {
        ensureSession();
        const value = storedValue(form ?? {});
        if (!h8RewardParamValid(param.key, value)) throw new Error("请填写允许范围内的基础额或选择有效模式。");
        if (pending || h8RewardParamAmplifies(param.key, rawCurrent, value)) {
          await submitApproval(reason, value);
          return;
        }
        const slot = `${session.adminId}|param|${param.key}`;
        let mintedFresh = false;
        const commandKey = commandAttempts.resolve(
          slot,
          JSON.stringify([value, data.version]),
          () => { mintedFresh = true; return createH8CommandKey("h8-param"); },
        );
        try {
          await updateH8ReferralRewardParam(param.key, value, reason, data.version, commandKey);
          commandAttempts.forget(slot);
        } catch (error) {
          // 只有全新尝试才在确定性失败时弃号:复用来的号说明上次结果未知,这次的 4xx 证明不了那次没落地。
          if (mintedFresh && !isH8OutcomeUncertainError(error)) commandAttempts.forget(slot);
          throw error;
        }
        await load();
        ctx.toast(isEnabled ? "邀请奖励已停用" : `${param.label} 已更新为 ${showValue(value)} ${nexGridBrandText(param.unit)}`);
      },
    });
  };

  const settle = (invitedUserId?: number) => {
    const targeted = invitedUserId != null;
    ctx.openActionConfirm({
    action: targeted ? "给指定新人结算邀请奖励" : "结算邀请奖励",
    detail: `${targeted ? `只结算新人 ${invitedUserId} 的邀请奖励；不符合资格或已结算过就不发。` : "按邀请关系找出还没结算的记录；"}按当前第 ${data?.rhythmMonth ?? "—"} 个月的倍率计算后，每组结算为新人 ${data?.effectiveRewards?.["newcomer.usdt"] ?? "—"} USDT + ${data?.effectiveRewards?.["newcomer.nex"] ?? "—"} UVT、邀请人 ${data?.effectiveRewards?.["inviter.nex"] ?? "—"} UVT。奖励直接进用户钱包，同一新人只结算一次。`,
    amplifies: true,
    edit: targeted ? undefined : { kind: "number", current: "20", unit: "条", min: 1, max: 100, step: 1 },
    run: async (reason, value) => {
      const limit = targeted ? 1 : Math.max(1, Math.min(100, Number(value) || 20));
      const def = targeted ? findHighOp("h8_referral_settlement_user")! : findHighOp("h8_referral_settlement")!;
      const slot = targeted ? `settle|user|${invitedUserId}` : "settle|batch";
      let mintedFresh = false;
      // 指纹必须覆盖整个提案信封:pending 计数进了 body 的 before,刷新页面后它会随新邀请关系变化。
      // 漏掉它则指纹相同而 body 变了 → 后端 payload-bound 防重复提交回 409,且因非全新尝试不弃号 = 24h 死锁。
      const commandKey = commandAttempts.resolve(
        slot,
        targeted
          ? JSON.stringify([invitedUserId, data?.version, data?.rhythmMonth, data?.rewardSnapshotHash, data?.pending])
          : JSON.stringify([limit, data?.version, data?.rhythmMonth, data?.rewardSnapshotHash, data?.pending]),
        () => { mintedFresh = true; return createH8CommandKey("h8-settle"); },
      );
      try {
        await propose(ctx.toast, {
          action: targeted ? "给指定新人结算邀请奖励" : "结算邀请奖励",
          obj: targeted ? `新人 ${invitedUserId}` : "待结算邀请批次",
          before: `待结算 ${Number(data?.pending ?? 0)} 条 · 设置版本 v${data?.version ?? "—"} · 第 ${data?.rhythmMonth ?? "—"} 个月`,
          after: `${targeted ? `仅结算新人 ${invitedUserId} 的邀请奖励` : `最多结算 ${limit} 条`} · 新人 ${data?.effectiveRewards["newcomer.usdt"] ?? "—"} USDT + ${data?.effectiveRewards["newcomer.nex"] ?? "—"} UVT · 邀请人 ${data?.effectiveRewards["inviter.nex"] ?? "—"} UVT · 快照 ${data?.rewardSnapshotHash.slice(0, 12) ?? "—"}…`,
          type: "fund",
          amplifies: true,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "H8",
          commandKey,
          command: def.buildCommand({
            limit,
            invitedUserId,
            expectedH8Version: data?.version,
            expectedRhythmMonth: data?.rhythmMonth,
            rewardSnapshotHash: data?.rewardSnapshotHash,
          }),
          target: def.buildTarget({ limit, invitedUserId }),
        });
        commandAttempts.forget(slot);
      } catch (error) {
        if (mintedFresh && !isA2OutcomeUncertainError(error)) commandAttempts.forget(slot);
        throw error;
      }
    },
    });
  };

  if (loading && !data) return <section className="l-card"><div className="l-b">邀请奖励数据加载中…</div></section>;
  if (error && !data) return <section className="l-card"><div className="l-b">邀请奖励数据加载失败 · {error} <button className="l-btn sm" onClick={() => void load()}>重试</button></div></section>;

  const targetUserId = Number(invitedUserIdInput.trim());
  const targetUserValid = /^[1-9]\d*$/.test(invitedUserIdInput.trim()) && Number.isSafeInteger(targetUserId);

  return (
    <>
      <div className="f-stats">
        <div className={data?.enabled ? "f-stat ok" : "f-stat warn"}><div className="k">奖励开关</div><div className="v">{data?.enabled ? "已启用" : "已停用"}</div><div className="sub">同时控制发奖和 App 上的奖励显示</div></div>
        <div className="f-stat warn"><div className="k">待结算邀请</div><div className="v">{data?.pending ?? 0}</div><div className="sub">已建立邀请关系、还没发奖</div></div>
        <div className="f-stat ok"><div className="k">累计已结算</div><div className="v">{data?.settled ?? 0}</div><div className="sub">同一新人只结算一次</div></div>
        <div className="f-stat danger"><div className="k">风控暂缓</div><div className="v">{data?.blockedByK2 ?? 0}</div><div className="sub">还没发奖、被风险规则拦下的邀请</div></div>
        <div className="f-stat cyan"><div className="k">结算模式</div><div className="v">直接入账</div><div className="sub">奖励直接进用户钱包并记账</div></div>
      </div>

      <section className="l-card">
        <div className="l-h"><span className="ttl">新人礼与邀请人奖励</span><span className="sub">· 生效时间 {data?.effectiveAt ? `${new Date(data.effectiveAt).toLocaleString("zh-CN", { hour12: false, timeZone: businessZone().zoneId })}（${businessZone().label}）` : "—"}</span><div className="r">{canWrite && <button className="l-btn mc" disabled={!data} onClick={() => editParam(ENABLED_PARAM, String(!data?.enabled))}>{data?.enabled ? "停用奖励" : "启用奖励"}</button>}{canSettle && <button className="l-btn mc" disabled={!data?.enabled || Number(data.pending ?? 0) <= 0} title={!data?.enabled ? "邀请奖励当前已停用" : Number(data?.pending ?? 0) <= 0 ? "当前没有待结算邀请" : undefined} onClick={() => settle()}>结算邀请奖励</button>}</div></div>
        <div className="l-b"><div className="param-grid">
          {PARAMS.map((param) => <div className="p" key={param.key}>
            <div className="k">{param.label}</div>
            <div className="v">{param.kind === "select" ? LOCK_MODE_LABELS[String(data?.params?.[param.key] ?? "risk_bucket")] : `基础 ${String(data?.params?.[param.key] ?? "0")}`} <span className="vu">{nexGridBrandText(param.unit)}</span>{canWrite && <button className="l-btn sm mc" disabled={!data} onClick={() => editParam(param)}>调整</button>}</div>
            <div className="s">{param.kind === "select"
                ? "只影响之后的结算；修改需要填写理由，并记入操作记录。"
                : `按第 ${data?.rhythmMonth ?? "—"} 个月的倍率，实际发放 ${String(data?.effectiveRewards?.[param.key] ?? "—")} ${nexGridBrandText(param.unit)}（${param.key.startsWith("newcomer.") ? data?.newcomerMultiplier : data?.inviterMultiplier}×）。`}</div>
          </div>)}
        </div></div>
      </section>

      <section className="l-card">
        <div className="l-h"><span className="ttl">指定新人结算</span></div>
        <div className="l-b">
          <label>新人用户编号 <input className="ui-control" aria-label="指定结算的新人用户编号" inputMode="numeric" placeholder="请输入新人用户编号" value={invitedUserIdInput} onChange={(event) => setInvitedUserIdInput(event.target.value)} /></label>{" "}
          {canSettle && <button className="l-btn mc" disabled={!data?.enabled || !targetUserValid} onClick={() => settle(targetUserId)}>结算指定新人</button>}
          <p className="f-foot">只结算这一位新人，邀请人按邀请关系自动确定。不符合资格或已结算过就不发。</p>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h"><span className="ttl">最近发奖记录</span></div>
        <div style={{ overflowX: "auto" }}><table className="l-tbl"><thead><tr><th>结算号</th><th>新人</th><th>邀请人</th><th>新人奖励</th><th>邀请人奖励</th><th>状态</th></tr></thead><tbody>
          {(data?.recentSettlements ?? []).map((row, index) => <tr key={row.settlementNo ?? index}><td className="mono">{row.settlementNo ?? "—"}</td><td>{row.invitedUserId ?? "—"}</td><td>{row.inviterUserId ?? "—"}</td><td>{row.newcomerUsdt ?? 0} USDT + {row.newcomerNex ?? 0} UVT</td><td>{row.inviterNex ?? 0} UVT</td><td><span className="bdg ok">{row.status === "SETTLED" ? "已结算" : "—"}</span></td></tr>)}
          {!data?.recentSettlements?.length && <tr><td colSpan={6} style={{ textAlign: "center", padding: 24 }}>{Number(data?.pending ?? 0) > 0 ? "还没有结算记录，可以点上方按钮结算" : "暂无结算记录，也没有待结算的邀请"}</td></tr>}
        </tbody></table></div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          {error && <div role="alert" className="tint danger" style={{ marginBottom: 10 }}>更早记录加载失败，已加载的记录仍保留，列表尚未加载完整。{error} 请重试加载更早记录。</div>}
          {data?.settlementHasMore && <button className="l-btn sm" disabled={loadingMore} onClick={() => void load(data.settlementNextCursor, true)}>{loadingMore ? "加载中…" : error ? "重试加载更早记录" : "加载更早记录"}</button>}{" "}
          <span className="f-foot">结算后可以去核对：</span>{" "}
          <><Link href="/platform/audit" className="l-btn sm">操作记录与审批</Link>{" "}<Link href="/platform/events" className="l-btn sm">用户行为事件</Link>{" "}<Link href="/finance/ledger" className="l-btn sm">账本与账单核对</Link></>
        </div>
      </section>
      <p className="f-foot"><b>发奖流程</b>：App 显示奖励 → 建立邀请关系 → 审批 → 结算（每位新人只结算一次）→ 新人和邀请人钱包到账 → 记入资金账本。</p>
    </>
  );
}
