"use client";

/** F2 · 直属分成政策与保留的独立权益/其他奖励冷却控制。 */
import { CodeTag } from "../design-kit";
import { F2DirectPolicy } from "./f2-direct-policy";
import type { FViewCtx } from "./types";

export function F2Rates({ ctx }: { ctx: FViewCtx }) {
  const hasIndependentData = ctx.f2Params.length > 0 || Object.keys(ctx.f2ConfigValues).length > 0;
  const canPolicyAmplify = ctx.can("network_f2_policy_amplify");
  const coolingRaw = ctx.f2ConfigValues["F.cooldown"]?.trim() ?? "";
  const coolingDays = /^[+-]?\d+$/.test(coolingRaw) && Number(coolingRaw) >= 0 && Number(coolingRaw) <= 90
    ? Number(coolingRaw) : 30;
  // Partner Status 是独立权益档。兼容读取旧 bronze/silver/gold，
  // 提交时只写当前 Standard/Verified/Premium/Diamond schema。
  const partnerTiersRaw = ctx.f2ConfigValues["F.partner.tiers"] ?? "";
  let ptStandard = "0";
  let ptVerified = "5000";
  let ptPremium = "50000";
  let ptDiamond = "500000";
  if (partnerTiersRaw) {
    try {
      const parsed = JSON.parse(partnerTiersRaw);
      if (typeof parsed.standard === "number") ptStandard = String(parsed.standard);
      else if (typeof parsed.bronze === "number") ptStandard = String(parsed.bronze);
      if (typeof parsed.verified === "number") ptVerified = String(parsed.verified);
      else if (typeof parsed.silver === "number") ptVerified = String(parsed.silver);
      if (typeof parsed.premium === "number") ptPremium = String(parsed.premium);
      else if (typeof parsed.gold === "number") ptPremium = String(parsed.gold);
      if (typeof parsed.diamond === "number") ptDiamond = String(parsed.diamond);
    } catch { /* schema 异常用默认,提交时后端 validatePartnerTiers 兜底 */ }
  }

  if (ctx.f2Loading && !hasIndependentData) {
    return (
      <><F2DirectPolicy ctx={ctx} /><section className="pane">
        <div className="pane-h"><span className="ph-ttl">F2 独立奖励参数</span><span className="ph-sub">数据加载中</span></div>
        <div style={{ padding: 18, color: "var(--ink-4)", fontSize: 13 }}>F2 数据加载中...</div>
      </section></>
    );
  }

  if (ctx.f2Error && !hasIndependentData) {
    return (
      <><F2DirectPolicy ctx={ctx} /><section className="pane">
        <div className="pane-h"><span className="ph-ttl">F2 独立奖励参数</span><span className="ph-sub">数据加载失败</span></div>
        <div style={{ padding: 18, color: "var(--ink-3)", fontSize: 13 }}>F2 数据加载失败 · {ctx.f2Error}</div>
        <div style={{ padding: "0 18px 18px" }}>
          <button className="fbtn primary" onClick={() => void ctx.refreshF2()}>重试</button>
        </div>
      </section></>
    );
  }

  if (!hasIndependentData) {
    return (
      <><F2DirectPolicy ctx={ctx} /><section className="pane">
        <div className="pane-h"><span className="ph-ttl">F2 独立奖励参数</span><span className="ph-sub">暂无数据</span></div>
        <div style={{ padding: 18, color: "var(--ink-4)", fontSize: 13 }}>暂无其他奖励配置，直属分成可独立读取</div>
      </section></>
    );
  }

  return (
    <>
      <F2DirectPolicy ctx={ctx} />
      <div className="f2-top">
        <section className="pane">
          <div className="pane-h"><span className="ph-ttl">Partner Status 权益档</span><span className="ph-sub">不改变版税费率</span><span className="ph-r" style={{ marginLeft: "auto" }}><CodeTag>非资金倍率</CodeTag></span></div>
          <div className="tier-list">
            {[
              { name: "Standard", threshold: ptStandard, perk: "基础权益", cls: "" },
              { name: "Verified", threshold: ptVerified, perk: "优先客服支持", cls: "t1" },
              { name: "Premium", threshold: ptPremium, perk: "新品优先", cls: "t2" },
              { name: "Diamond", threshold: ptDiamond, perk: "AMA + VIP", cls: "t3" },
            ].map((tier) => (
              <div key={tier.name} className={`tier ${tier.cls}`}>
                <div className="nm">{tier.name}<span className="req">${tier.threshold}+</span></div>
                <span className="tier-rate">权益</span>
                <span className="dist">{tier.perk}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: "0 18px 14px", fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.55 }}>按月度网络活跃度判定并解锁权益；Partner Status 不改变直属分成政策。</div>
          <div className="casc-foot" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 11.5, color: "var(--ink-4)", padding: "10px 18px 14px", borderTop: "1px solid var(--border)" }}>
            <span>门槛 · 当前 <b style={{ color: "var(--ink-2)" }}>${ptStandard}/${ptVerified}/${ptPremium}/${ptDiamond}</b>(Standard/Verified/Premium/Diamond)</span>
            {canPolicyAmplify && <button className="fbtn primary" style={{ marginLeft: "auto" }} onClick={() => ctx.openActionConfirm({
              name: "Partner Status 4 档权益门槛调整", amplify: false,
              businessForm: {
                kind: "multi-field",
                title: "Partner Status 4 档权益门槛(USD)",
                hint: "Standard/Verified/Premium/Diamond 仅决定权益 · 须为非负数字且非递减。",
                fields: [
                  { key: "standard", label: "Standard 门槛(USD)", current: ptStandard, inputKind: "number", min: 0 },
                  { key: "verified", label: "Verified 门槛(USD)", current: ptVerified, inputKind: "number", min: 0 },
                  { key: "premium", label: "Premium 门槛(USD)", current: ptPremium, inputKind: "number", min: 0 },
                  { key: "diamond", label: "Diamond 门槛(USD)", current: ptDiamond, inputKind: "number", min: 0 },
                ],
              },
              detail: `Partner Status 权益门槛 · 当前 $${ptStandard}/$${ptVerified}/$${ptPremium}/$${ptDiamond} · 不改变佣金、版税或 B1 资金口径。`,
              run: async (reason, bv) => {
                if (!bv) throw new Error("请填写全部 4 档");
                const standard = Number(bv.standard);
                const verified = Number(bv.verified);
                const premium = Number(bv.premium);
                const diamond = Number(bv.diamond);
                if (![standard, verified, premium, diamond].every(Number.isFinite) || [standard, verified, premium, diamond].some((n) => n < 0)) {
                  throw new Error("4 档门槛均须为非负数字");
                }
                if (standard > verified || verified > premium || premium > diamond) {
                  throw new Error("4 档门槛须非递减(Standard ≤ Verified ≤ Premium ≤ Diamond)");
                }
                await ctx.updateF2Config("F.partner.tiers", JSON.stringify({ standard, verified, premium, diamond }), reason);
                ctx.toast(`已提交 A2 审批 · Partner Status 门槛 $${standard}/$${verified}/$${premium}/$${diamond}`);
              },
            })}>调整权益门槛</button>}
          </div>
        </section>
      </div>

      <div className="params">
        <div className="param"><div className="pk">其他奖励参数</div><div className="psub">直属分成使用上方各自冷却期；下方冷却只用于其他奖励，规则按服务端权威配置执行。</div></div>
        {ctx.f2Params.filter((p) => p.key === "F.cooldown").map((p) => {
          const eff = p.key === "F.cooldown" ? String(coolingDays) : p.value || p.def;
          return (
            <div key={p.id} className="param">
              <div className="pk">其他奖励冷却期</div>
              <div className={`pv${p.vcls ? " " + p.vcls : ""}`}>{eff}</div>
              <div className="psub">{p.sub}</div>
              {canPolicyAmplify && <button className={`fbtn primary${p.vamp ? " amp" : ""}`} onClick={() => ctx.openActionConfirm({
                name: "其他奖励冷却期调整", amplify: p.amp, op: "param", paramKey: p.key,
                edit: { kind: "number", current: eff, unit: p.unit, min: 0, max: 90, step: 1, amplifiesWhen: "decrease" },
                detail: `其他奖励冷却期当前 ${eff} 天；缩短须核验 B1 覆盖率，不影响直属政策的独立冷却期。`,
              })}>调整</button>}
            </div>
          );
        })}
      </div>

      <p className="f-foot">直属购买与设备收益两类政策整组审批；历史网络奖励保留，Partner Status 与其他奖励冷却独立设置。</p>
    </>
  );
}
