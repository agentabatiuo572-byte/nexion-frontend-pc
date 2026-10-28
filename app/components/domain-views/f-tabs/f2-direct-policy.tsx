"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import { directReferralAmplifies, directReferralSummary, validateDirectReferralUpdate, type DirectReferralPolicy, type DirectReferralUpdate } from "@/lib/admin/direct-referral-policy";
import type { FViewCtx } from "./types";
import "./f2-direct-policy.css";

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
  const invalid = draft ? validateDirectReferralUpdate(draft) || (draft.purchaseSplit.enabled && (!policy || policy.sevenLayerReference.baseRatePct === null || policy.sevenLayerReference.coolingDays === null) ? "七层奖励的 L1 比例或购买冷却还没设置，请先到上方设置。" : null) : null;
  const changed = !!draft && !!policy && (JSON.stringify(draft.purchaseSplit) !== JSON.stringify(policy.purchaseSplit) || JSON.stringify(draft.deviceEarning) !== JSON.stringify(policy.deviceEarning));
  const disabled = !allowed || busy || !!ctx.f2DirectPolicyError || !policy || !draft || stale || !policy.sevenLayerEnabled;
  const reset = () => { if (policy) { setDraft(draftOf(policy)); setSubmitted(false); } };
  const submit = () => {
    if (disabled || !draft || !policy || invalid || !changed) return;
    const value = structuredClone(draft), ref = policy.sevenLayerReference;
    ctx.openActionConfirm({
      name: "直属分成政策整组调整", amplify: directReferralAmplifies(policy, value),
      detail: `修改前：${directReferralSummary(policy)}。修改后：${directReferralSummary(value)}。L1 奖励比例 ${ref.baseRatePct ?? "未配置"}%，购买冷却 ${ref.coolingDays ?? "未配置"} 天，旧 UVT 系数 ${ref.legacyNexPerUsd ?? "未配置"} UVT/USDT。关闭拆分后直属奖励改回全额 USDT，USDT 占比增加 ${policy.purchaseSplit.enabled && !value.purchaseSplit.enabled ? 100 - policy.purchaseSplit.usdtSharePct : 0} 个百分点。设备成员自己的收益不减少。（设置版本 ${policy.policyVersion}）`,
      completionCopy: "提交后需在「操作记录与审批」批准，两项设置一起生效。",
      run: async (reason) => { await ctx.updateF2DirectPolicy(value, reason); setSubmitted(true); },
    });
  };
  const splitField = (key: "purchaseSplit" | "deviceEarning", label: string) => draft && <>
    <label className="f2-policy-row"><span>启用状态</span><span className="f2-policy-control"><select aria-label={label + "启用状态"} value={draft[key].enabled ? "enabled" : "disabled"} onChange={e => setDraft({ ...draft, [key]: { ...draft[key], enabled: e.target.value === "enabled" } })}><option value="disabled">{key === "purchaseSplit" ? "停用拆分" : "停用"}</option><option value="enabled">启用</option></select></span></label>
    <label className="f2-policy-row"><span>USDT 占比</span><span className="f2-policy-control"><input aria-label={label + "USDT 占比 (%)"} type="number" min={0} max={100} step={0.01} value={Number.isFinite(draft[key].usdtSharePct) ? draft[key].usdtSharePct : ""} onChange={e => setDraft({ ...draft, [key]: { ...draft[key], usdtSharePct: e.target.value === "" ? NaN : Number(e.target.value) } })} /><span className="f2-policy-unit" aria-hidden="true">%</span></span></label>
    <div className="f2-policy-row f2-policy-complement"><label htmlFor={`f2-${key}-nex`}>UVT 占比</label><div><span className="f2-policy-control"><input id={`f2-${key}-nex`} aria-label={label + "UVT 占比（只读）"} readOnly tabIndex={-1} value={Number.isFinite(draft[key].usdtSharePct) ? 100 - draft[key].usdtSharePct : "待填写"} /><span className="f2-policy-unit" aria-hidden="true">%</span></span><p className="f2-help">（自动计算，百分比相加必须为 100%）</p></div></div>
  </>;
  return <section className="pane f2-direct-policy" aria-label="直属分成配置">
    <div className="pane-h"><div className="f2-policy-heading"><span className="ph-ttl">直接邀请人奖励</span><span className="ph-sub">直属购买奖励的币种拆分、直属设备收益分成，两项一起提交审批</span></div>{policy && <div className="f2-policy-meta"><span>{policy.configured ? `当前版本 ${policy.policyVersion}` : "尚未设置"}</span>{policy.configured && <span>生效时间：{new Date(policy.effectiveAt!).toLocaleString()}</span>}</div>}</div>
    <div className="f2-policy-body">
      {busy && <div role="status" aria-label="直属分成配置加载中" className="f2-policy-loading"><div /><div /></div>}
      {ctx.f2DirectPolicyError && <div className="f2-policy-notice" role="alert">{ctx.f2DirectPolicyError} 已填写的内容已保留，可刷新重试。</div>}
      {policy && !policy.configured && <p className="f2-help f2-policy-status">尚未设置。下面的数字只是默认值，不代表正在生效。</p>}
      {policy?.nexUsdtPrice === null && <p className="f2-policy-notice f2-policy-warning">暂时拿不到 UVT 价格，UVT 部分会等价格恢复后再计算。</p>}
      {!allowed && <p className="f2-policy-notice">你只能查看，修改需要「直属分成调整」权限。</p>}
      {policy && !policy.sevenLayerEnabled && <p role="status" className="f2-policy-notice">新版七层结算还没启用，这里暂时只能查看。启用后刷新页面即可修改。</p>}
      {stale && <div className="f2-policy-notice" role="alert">这项设置刚被别人改过，你填写的内容还在。请点「放弃修改并刷新」后重新填写。</div>}
      {draft && <div className="f2-policy-fields">
        <fieldset disabled={disabled || submitted}>
          <legend>直属购买奖励</legend>
          <p className="f2-help f2-policy-description">直接邀请的成员购买后，奖励按多少比例发 USDT、多少比例发 UVT。</p>
          {policy && !policy.purchaseSplitConfigured && <p className="f2-help f2-policy-unconfigured">还没设置拆分，目前直属奖励全部发 USDT。下面的比例只是默认值。</p>}
          <div className="f2-policy-rows">
            <label className="f2-policy-row"><span>L1 奖励比例（只读）</span><span className="f2-policy-control"><input aria-label="直属购买奖励 L1 奖励比例（只读）" readOnly tabIndex={-1} value={policy?.sevenLayerReference.baseRatePct ?? "未配置"} /><span className="f2-policy-unit" aria-hidden="true">%</span></span></label>
            {splitField("purchaseSplit", "直属购买奖励拆分")}
            <label className="f2-policy-row"><span>购买冷却（只读）</span><span className="f2-policy-control"><input aria-label="直属购买奖励购买冷却天数（只读）" readOnly tabIndex={-1} value={policy?.sevenLayerReference.coolingDays ?? "未配置"} /><span className="f2-policy-unit" aria-hidden="true">天</span></span></label>
          </div>
        </fieldset>
        <fieldset disabled={disabled || submitted}>
          <legend>直属设备收益分成</legend>
          <p className="f2-help f2-policy-description">直接邀请的成员有设备收益时，平台额外给邀请人的分成。</p>
          <div className="f2-policy-rows">
            {splitField("deviceEarning", "直属设备收益分成")}
            {([["totalRatePct", "总分成比例 (%)", 100, 0.01], ["coolingDays", "冷却天数", 365, 1]] as const).map(([field, label, max, step]) => <label key={field} className="f2-policy-row"><span>{field === "totalRatePct" ? "总分成比例" : label}</span><span className="f2-policy-control"><input aria-label={"直属设备收益分成" + label} type="number" min={0} max={max} step={step} value={Number.isFinite(draft.deviceEarning[field]) ? draft.deviceEarning[field] : ""} onChange={e => setDraft({ ...draft, deviceEarning: { ...draft.deviceEarning, [field]: e.target.value === "" ? NaN : Number(e.target.value) } })} /><span className="f2-policy-unit" aria-hidden="true">{field === "totalRatePct" ? "%" : "天"}</span></span></label>)}
          </div>
        </fieldset>
      </div>}
      {draft && invalid && <div role="alert" className="f2-policy-notice f2-policy-warning">{invalid}</div>}
      {submitted && <div role="status" className="f2-policy-notice">已提交，等待审批。批准前仍按原设置执行，批准后刷新即可看到新设置。{ctx.can("platform_a2_read") && <Link href="/platform/audit">查看审批进度</Link>}</div>}
      <div className="f2-policy-explanation"><Info size={16} aria-hidden="true" /><div><strong>说明</strong><p className="f2-help">开启拆分后，直属奖励按比例发 USDT 和 UVT，不再额外加发 UVT；关闭后恢复原来的发法。只影响直属这一层，第 2–7 层不变。</p><p className="f2-help">设备分成由平台额外支付，不扣成员自己的收益；只按真实设备收益计算，不从佣金里再抽。</p><p className="f2-help">批准后只对之后的奖励生效，已发的不变。左右团队奖、等级奖、培育奖、领导池和注册礼不受影响。</p></div></div>
      <div className="f2-policy-actions">
        {allowed && <button className="fbtn primary" disabled={disabled || !!invalid || !changed || submitted} onClick={submit}>提交审批</button>}
        <button className="fbtn" disabled={busy} onClick={() => void ctx.refreshF2()}>刷新</button>
        {draft && policy && <button className="fbtn" disabled={busy} onClick={reset}>放弃修改并刷新</button>}
      </div>
    </div>
  </section>;
}
