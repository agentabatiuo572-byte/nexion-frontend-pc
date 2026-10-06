"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { directReferralAmplifies, directReferralSummary, validateDirectReferralUpdate, type DirectReferralPolicy, type DirectReferralUpdate } from "@/lib/admin/direct-referral-policy";
import type { FViewCtx } from "./types";

const inputStyle = { minHeight: 36, padding: "7px 10px", border: "1px solid var(--border-strong)", borderRadius: 8, background: "var(--surface-2)", color: "var(--ink)", width: 140 } as const;
const draftOf = (policy: DirectReferralPolicy): DirectReferralUpdate => ({
  schemaVersion: 2, expectedVersion: policy.policyVersion, expectedSevenLayerRevision: policy.sevenLayerRevision,
  purchaseSplit: { ...policy.purchaseSplit }, deviceEarning: { ...policy.deviceEarning },
});

export function F2DirectPolicy({ ctx }: { ctx: FViewCtx }) {
  const policy = ctx.f2DirectPolicy;
  const [draft, setDraft] = useState<DirectReferralUpdate | null>(() => policy ? draftOf(policy) : null);
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => { if (!draft && policy) setDraft(draftOf(policy)); }, [draft, policy]);
  const allowed = ctx.can("network_f2_royalty_rate");
  const busy = ctx.f2DirectPolicyLoading;
  const stale = !!draft && !!policy && (draft.expectedVersion !== policy.policyVersion || draft.expectedSevenLayerRevision !== policy.sevenLayerRevision || (ctx.f2SevenLayerRevision !== null && ctx.f2SevenLayerRevision !== policy.sevenLayerRevision));
  const invalid = draft ? validateDirectReferralUpdate(draft) || (draft.purchaseSplit.enabled && (!policy || policy.sevenLayerReference.baseRatePct === null || policy.sevenLayerReference.coolingDays === null) ? "原七层 L1 基础预算或购买冷却未配置，请先核对七层配置。" : null) : null;
  const changed = !!draft && !!policy && (JSON.stringify(draft.purchaseSplit) !== JSON.stringify(policy.purchaseSplit) || JSON.stringify(draft.deviceEarning) !== JSON.stringify(policy.deviceEarning));
  const disabled = !allowed || busy || !!ctx.f2DirectPolicyError || !policy || !draft || stale || !policy.sevenLayerEnabled;
  const reset = () => { if (policy) { setDraft(draftOf(policy)); setSubmitted(false); } };
  const submit = () => {
    if (disabled || !draft || !policy || invalid || !changed) return;
    const value = structuredClone(draft), ref = policy.sevenLayerReference;
    ctx.openActionConfirm({
      name: "直属分成政策整组调整", amplify: directReferralAmplifies(policy, value),
      detail: `政策版本 ${policy.policyVersion}，七层引用版本 ${policy.sevenLayerRevision}。修改前：${directReferralSummary(policy)}。修改后：${directReferralSummary(value)}。原 L1 基础预算 ${ref.baseRatePct ?? "未配置"}%，购买冷却 ${ref.coolingDays ?? "未配置"} 天，旧 L1 NEX 系数 ${ref.legacyNexPerUsd ?? "未配置"} NEX/USDT。关闭拆分将恢复 L1 全额 USDT，现金占比增加 ${policy.purchaseSplit.enabled && !value.purchaseSplit.enabled ? 100 - policy.purchaseSplit.usdtSharePct : 0} 个百分点；服务端执行时重新核验两币支出方向。设备成员原收益不减。`,
      completionCopy: "提交后进入 A2 待审批；批准后整组同一版本生效。",
      run: async (reason) => { await ctx.updateF2DirectPolicy(value, reason); setSubmitted(true); },
    });
  };
  const splitField = (key: "purchaseSplit" | "deviceEarning", label: string) => draft && <>
    <label style={{ display: "grid", gap: 5 }}>启用状态<select aria-label={label + "启用状态"} style={inputStyle} value={draft[key].enabled ? "enabled" : "disabled"} onChange={e => setDraft({ ...draft, [key]: { ...draft[key], enabled: e.target.value === "enabled" } })}><option value="disabled">{key === "purchaseSplit" ? "停用拆分" : "停用"}</option><option value="enabled">启用</option></select></label>
    <label style={{ display: "grid", gap: 5 }}>USDT 占比 (%)<input aria-label={label + "USDT 占比 (%)"} type="number" min={0} max={100} step={0.01} value={Number.isFinite(draft[key].usdtSharePct) ? draft[key].usdtSharePct : ""} style={inputStyle} onChange={e => setDraft({ ...draft, [key]: { ...draft[key], usdtSharePct: e.target.value === "" ? NaN : Number(e.target.value) } })} /></label>
    <div style={{ alignSelf: "end", paddingBottom: 7 }}>NEX 占比：{Number.isFinite(draft[key].usdtSharePct) ? `${100 - draft[key].usdtSharePct}%` : "待填写"}（自动补足）</div>
  </>;
  return <section className="pane f2-direct-policy" aria-label="直属分成配置">
    <div className="pane-h"><span className="ph-ttl">直属拆分与设备收益</span><span className="ph-sub">一个购买预算，两类政策整组审批</span></div>
    <div className="f2-policy-body">
      {busy && <div role="status" aria-label="直属分成配置加载中" style={{ display: "grid", gap: 10 }}><div className="param" style={{ height: 40, opacity: 0.45 }} /><div className="param" style={{ height: 40, opacity: 0.45 }} /></div>}
      {ctx.f2DirectPolicyError && <div role="alert">{ctx.f2DirectPolicyError} 草稿已保留，可重新读取。</div>}
      {policy && <p className="f2-help">{policy.sevenLayerEnabled ? "七层新结算已启用" : "七层新结算尚未切换，当前来源仍沿用原结算；不会回算历史"} · {policy.configured ? `当前版本 ${policy.policyVersion} · 生效于 ${new Date(policy.effectiveAt!).toLocaleString()}` : "未配置，尚未启用。占位数字不代表正式奖励比例。"} · 七层引用版本 {policy.sevenLayerRevision}</p>}
      {policy?.nexUsdtPrice === null && <p style={{ margin: 0, color: "var(--warning)" }}>NEX 价格暂不可用，分成等待有效价格后计算。</p>}
      {!allowed && <p style={{ margin: 0 }}>当前角色仅可查看，配置需要直属分成调整权限。</p>}
      {policy && !policy.sevenLayerEnabled && <p role="status" style={{ margin: 0 }}>七层新结算尚未启用，当前 v2 政策仅供核对；切换批准后重新读取才能编辑提交。</p>}
      {stale && <div role="alert">政策或七层引用版本已变化，原预览已失效，当前草稿未覆盖。请核对后放弃草稿并重载，再次编辑。</div>}
      {draft && <div className="f2-policy-fields">
        <fieldset disabled={disabled || submitted}>
          <legend>直属购买奖励拆分</legend>
          {policy && !policy.purchaseSplitConfigured && <p>购买拆分尚未配置；当前占比为停用占位，不代表生效拆分。已有设备政策仍按其有效版本执行。</p>}
          <p>基础预算率：{policy?.sevenLayerReference.baseRatePct === null ? "未配置" : `${policy?.sevenLayerReference.baseRatePct ?? "未配置"}%`}（只读，引用原 L1）</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>{splitField("purchaseSplit", "直属购买奖励拆分")}</div>
          <p>购买冷却：{policy?.sevenLayerReference.coolingDays ?? "未配置"} 天（引用原七层冷却）</p>
          <p className="f2-help">启用时拆分 NEX 替代旧 L1 额外 NEX；关闭只恢复未来 L1 的原发放构成，七层购买不停用。L2–L7 保持原规则。</p>
        </fieldset>
        <fieldset disabled={disabled || submitted}>
          <legend>直属设备收益分成</legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {splitField("deviceEarning", "直属设备收益分成")}
            {([["totalRatePct", "总分成比例 (%)", 100, 0.01], ["coolingDays", "冷却天数", 365, 1]] as const).map(([field, label, max, step]) => <label key={field} style={{ display: "grid", gap: 5 }}>{label}<input aria-label={"直属设备收益分成" + label} type="number" min={0} max={max} step={step} value={Number.isFinite(draft.deviceEarning[field]) ? draft.deviceEarning[field] : ""} style={inputStyle} onChange={e => setDraft({ ...draft, deviceEarning: { ...draft.deviceEarning, [field]: e.target.value === "" ? NaN : Number(e.target.value) } })} /></label>)}
          </div>
          <p className="f2-help">平台额外支付给直接邀请人，成员原设备收益不减少。仅实际设备收益可计，不从邀请佣金再次提成。</p>
        </fieldset>
      </div>}
      {draft && invalid && <div role="alert" style={{ color: "var(--warning)" }}>{invalid}</div>}
      {submitted && <div role="status">已提交 A2 待审批；当前生效配置尚未改变。批准后重新读取可核对新版本。{ctx.can("platform_a2_read") && <Link href="/platform/audit">查看审批进度</Link>}</div>}
      <p className="f2-help">审批通过后对新来源生效，时间由服务端批准记录确定。历史奖励保留原快照；对碰、等级、培育奖、领导池与注册礼继续各自规则。</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {allowed && <button className="fbtn primary" disabled={disabled || !!invalid || !changed || submitted} onClick={submit}>提交审批</button>}
        <button className="fbtn" disabled={busy} onClick={() => void ctx.refreshF2()}>重新读取</button>
        {draft && policy && <button className="fbtn" disabled={busy} onClick={reset}>放弃草稿并重载</button>}
      </div>
    </div>
  </section>;
}
