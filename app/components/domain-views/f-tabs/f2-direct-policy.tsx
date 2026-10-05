"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { directReferralAmplifies, validateDirectReferralUpdate, type DirectReferralPolicy, type DirectReferralUpdate } from "@/lib/admin/direct-referral-policy";
import type { FViewCtx } from "./types";

const RULES = [["purchase", "直属购买分成"], ["deviceEarning", "直属设备收益分成"]] as const;
const fields = [["totalRatePct", "总分成比例 (%)", 100, 0.01], ["usdtSharePct", "USDT 占比 (%)", 100, 0.01], ["coolingDays", "冷却天数", 365, 1]] as const;
const inputStyle = { minHeight: 36, padding: "7px 10px", border: "1px solid var(--border-strong)", borderRadius: 8, background: "var(--surface-2)", color: "var(--ink)", width: 140 } as const;
const draftOf = (policy: DirectReferralPolicy): DirectReferralUpdate => ({ expectedVersion: policy.policyVersion, purchase: { ...policy.purchase }, deviceEarning: { ...policy.deviceEarning } });
const summary = (rule: DirectReferralUpdate["purchase"]) => `${rule.enabled ? "启用" : "停用"} · 总比例 ${rule.totalRatePct}% · USDT ${rule.usdtSharePct}% / NEX ${100 - rule.usdtSharePct}% · 冷却 ${rule.coolingDays} 天`;

export function F2DirectPolicy({ ctx }: { ctx: FViewCtx }) {
  const policy = ctx.f2DirectPolicy;
  const [draft, setDraft] = useState<DirectReferralUpdate | null>(() => policy ? draftOf(policy) : null);
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => { if (!draft && policy) setDraft(draftOf(policy)); }, [draft, policy]);
  const allowed = ctx.can("network_f2_royalty_rate");
  const busy = ctx.f2DirectPolicyLoading;
  const stale = !!draft && !!policy && draft.expectedVersion !== policy.policyVersion;
  const invalid = draft ? validateDirectReferralUpdate(draft) : null;
  const changed = !!draft && !!policy && (JSON.stringify(draft.purchase) !== JSON.stringify(policy.purchase) || JSON.stringify(draft.deviceEarning) !== JSON.stringify(policy.deviceEarning));
  const disabled = !allowed || busy || !!ctx.f2DirectPolicyError || !policy || !draft || stale;
  const reset = () => { if (policy) { setDraft(draftOf(policy)); setSubmitted(false); } };
  const submit = () => {
    if (disabled || !draft || !policy || invalid || !changed) return;
    const value = structuredClone(draft);
    ctx.openActionConfirm({
      name: "直属分成政策整组调整", amplify: directReferralAmplifies(policy, value),
      detail: `当前版本 ${policy.policyVersion}；审批通过后立即对新来源生效。${RULES.map(([key, label]) => `${label}：${summary(policy[key])} → ${summary(value[key])}`).join("；")}。平台额外支付给直接邀请人，成员原收益不减少。`,
      completionCopy: "提交后进入 A2 待审批；批准后两组规则同一版本生效。",
      run: async (reason) => { await ctx.updateF2DirectPolicy(value, reason); setSubmitted(true); },
    });
  };

  return <section className="pane" aria-label="直属分成配置">
    <div className="pane-h"><span className="ph-ttl">直属分成配置</span><span className="ph-sub">两类独立设置，整组提交审批</span></div>
    <div style={{ padding: 18, display: "grid", gap: 14 }}>
      {busy && <div role="status" aria-label="直属分成配置加载中" style={{ display: "grid", gap: 10 }}><div className="param" style={{ height: 40, opacity: 0.45 }} /><div className="param" style={{ height: 40, opacity: 0.45 }} /></div>}
      {ctx.f2DirectPolicyError && <div role="alert">{ctx.f2DirectPolicyError} 草稿已保留，可重新读取。</div>}
      {policy && <p style={{ margin: 0 }}>{policy.configured ? `当前版本 ${policy.policyVersion} · 生效于 ${new Date(policy.effectiveAt!).toLocaleString()}` : "未配置，尚未启用。当前数字仅为停用占位，不代表正式奖励比例。"}</p>}
      {policy?.nexUsdtPrice === null && <p style={{ margin: 0, color: "var(--warning)" }}>NEX 价格暂不可用，分成等待有效价格后计算。</p>}
      {!allowed && <p style={{ margin: 0 }}>当前角色仅可查看，配置需要直属分成调整权限。</p>}
      {stale && <div role="alert">配置版本已变化，当前草稿未覆盖。请核对后放弃草稿并重载，再次编辑。</div>}
      {draft && RULES.map(([key, label]) => <fieldset key={key} disabled={disabled || submitted} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 14, minWidth: 0 }}>
        <legend>{label}</legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          <label style={{ display: "grid", gap: 5 }}>启用状态<select aria-label={`${label}启用状态`} style={inputStyle} value={draft[key].enabled ? "enabled" : "disabled"} onChange={e => setDraft({ ...draft, [key]: { ...draft[key], enabled: e.target.value === "enabled" } })}><option value="disabled">停用</option><option value="enabled">启用</option></select></label>
          {fields.map(([field, text, max, step]) => <label key={field} style={{ display: "grid", gap: 5 }}>{text}<input aria-label={`${label}${text}`} type="number" min={0} max={max} step={step} value={Number.isFinite(draft[key][field]) ? draft[key][field] : ""} style={inputStyle} onChange={e => setDraft({ ...draft, [key]: { ...draft[key], [field]: e.target.value === "" ? NaN : Number(e.target.value) } })} /></label>)}
          <div style={{ alignSelf: "end", paddingBottom: 7 }}>NEX 占比：{Number.isFinite(draft[key].usdtSharePct) ? `${100 - draft[key].usdtSharePct}%` : "待填写"}</div>
        </div>
      </fieldset>)}
      {draft && invalid && <div role="alert" style={{ color: "var(--warning)" }}>{invalid}</div>}
      {submitted && <div role="status">已提交 A2 待审批；当前生效配置尚未改变。批准后重新读取可核对新版本。{ctx.can("platform_a2_read") && <Link href="/platform/audit">查看审批进度</Link>}</div>}
      <p style={{ margin: 0 }}>审批通过后立即对新来源生效，生效时间以服务端批准记录为准。</p>
      <p style={{ margin: 0, color: "var(--ink-4)", lineHeight: 1.6 }}>平台额外支付给直接邀请人，成员原收益不减少。历史奖励按原快照保留；二元对碰、等级、培育奖、领导池保持各自规则。</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {allowed && <button className="fbtn primary" disabled={disabled || !!invalid || !changed || submitted} onClick={submit}>提交审批</button>}
        <button className="fbtn" disabled={busy} onClick={() => void ctx.refreshF2()}>重新读取</button>
        {draft && policy && <button className="fbtn" disabled={busy} onClick={reset}>放弃草稿并重载</button>}
      </div>
    </div>
  </section>;
}
