"use client";

/** F2 · 直属分成、独立权益/其他奖励冷却与旧网络版税只读快照。 */
import { CodeTag } from "../design-kit";
import { F2DirectPolicy } from "./f2-direct-policy";
import { parseF2DepthGateLayer, parseF2DepthGateRank } from "@/lib/admin/f2-depth-gate";
import type { FViewCtx } from "./types";

const F2_VISIBLE_PARAM_KEYS = new Set(["F.cooldown"]);
const F2_HISTORICAL_PARAM_NAMES: Record<string, string> = {
  "F.unilevel.depth": "最大层数",
  "F.unilevel.depthGate": "层级解锁门槛",
  "F.unilevel.depthGateRank": "解锁等级",
  "F.influence.clampMin": "影响分下限",
  "F.influence.clampMax": "影响分上限",
  "F.promo.weekMultiplier": "活动周倍率",
  "F.peer.rate": "平级奖励比例",
  "F.royalty.minPayout": "版税支付阈值",
  "F.unilevel.nexCap": "NEX 日封顶（旧引擎未接入）",
  "F.unilevel.backfill": "回溯窗口（旧引擎未接入）",
};

function configuredValue(raw: string | undefined) {
  const value = raw?.trim() ?? "";
  return value === "__UNCONFIGURED__" ? "" : value;
}

export function F2Rates({ ctx }: { ctx: FViewCtx }) {
  const canPolicyAmplify = ctx.can("network_f2_policy_amplify");
  const coolingRaw = configuredValue(ctx.f2ConfigValues["F.cooldown"]);
  const coolingDays = /^[+-]?\d+$/.test(coolingRaw) && Number(coolingRaw) >= 0 && Number(coolingRaw) <= 90
    ? String(Number(coolingRaw)) : "";
  const coolingParam = ctx.f2Params.find((p) => F2_VISIBLE_PARAM_KEYS.has(p.key));
  // Partner Status 是独立权益档。兼容读取旧 bronze/silver/gold，
  // 提交时只写当前 Standard/Verified/Premium/Diamond schema。
  const partnerTiersRaw = configuredValue(ctx.f2ConfigValues["F.partner.tiers"]);
  let thresholds = ["", "", "", ""];
  if (partnerTiersRaw) {
    try {
      const parsed = JSON.parse(partnerTiersRaw);
      const values = [parsed.standard ?? parsed.bronze, parsed.verified ?? parsed.silver, parsed.premium ?? parsed.gold, parsed.diamond];
      if (values.every((value, index) => typeof value === "number" && Number.isFinite(value) && value >= 0 && (!index || value >= values[index - 1]))) {
        thresholds = values.map(String);
      }
    } catch { /* 无效快照明确显示未配置，不补业务默认值。 */ }
  }
  const [ptStandard, ptVerified, ptPremium, ptDiamond] = thresholds;
  const partnerConfigured = thresholds.every((value) => value !== "");
  const partnerState = partnerConfigured ? `当前 $${thresholds.join("/$")}` : partnerTiersRaw ? "配置无效，请重新配置" : "未配置";
  const coolingState = coolingDays !== "" ? `${coolingDays} 天` : coolingRaw ? "配置无效，请重新配置" : "未配置";

  if (ctx.f2Loading) {
    return (
      <><F2DirectPolicy ctx={ctx} /><section className="pane">
        <div className="pane-h"><span className="ph-ttl">F2 独立奖励参数</span><span className="ph-sub">数据加载中</span></div>
        <div style={{ padding: 18, color: "var(--ink-4)", fontSize: 13 }}>独立奖励参数与历史网络版税快照加载中...</div>
      </section></>
    );
  }

  if (ctx.f2Error) {
    return (
      <><F2DirectPolicy ctx={ctx} /><section className="pane">
        <div className="pane-h"><span className="ph-ttl">F2 独立奖励参数</span><span className="ph-sub">数据加载失败</span></div>
        <div role="alert" style={{ padding: 18, color: "var(--ink-3)", fontSize: 13 }}>独立奖励参数与历史网络版税快照加载失败 · {ctx.f2Error}</div>
        <div style={{ padding: "0 18px 18px" }}>
          <button className="fbtn primary" onClick={() => void ctx.refreshF2()}>重试</button>
        </div>
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
                <div className="nm">{tier.name}<span className="req">{tier.threshold === "" ? "未配置" : `$${tier.threshold}+`}</span></div>
                <span className="tier-rate">权益</span>
                <span className="dist">{tier.perk}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: "0 18px 14px", fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.55 }}>按月度网络活跃度判定并解锁权益；Partner Status 不改变直属分成政策。</div>
          <div className="casc-foot" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 11.5, color: "var(--ink-4)", padding: "10px 18px 14px", borderTop: "1px solid var(--border)" }}>
            <span>门槛 · <b style={{ color: "var(--ink-2)" }}>{partnerState}</b>(Standard/Verified/Premium/Diamond)</span>
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
              completionCopy: "提交后进入 A2 待确认队列，批准执行后生效",
              detail: `Partner Status 权益门槛 · ${partnerState} · 不改变佣金、版税或 B1 资金口径。`,
              run: async (reason, bv) => {
                if (!bv || [bv.standard, bv.verified, bv.premium, bv.diamond].some((value) => !value?.trim())) throw new Error("请填写全部 4 档");
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
            })}>{partnerConfigured ? "调整权益门槛" : "配置权益门槛"}</button>}
          </div>
        </section>
      </div>

      <div className="params">
        <div className="param"><div className="pk">其他奖励参数</div><div className="psub">直属分成使用上方各自冷却期；下方冷却只用于其他奖励，规则按服务端权威配置执行。</div></div>
        <div key={coolingParam?.id ?? "cool"} className="param">
          <div className="pk">其他奖励冷却期</div>
          <div className={`pv${coolingParam?.vcls ? " " + coolingParam.vcls : ""}`}>{coolingState}</div>
          <div className="psub">0–90 天整数；仅用于其他奖励，不影响直属政策的独立冷却期。</div>
          {canPolicyAmplify && <button className={`fbtn primary${coolingParam?.vamp ? " amp" : ""}`} onClick={() => ctx.openActionConfirm({
            name: "其他奖励冷却期调整", amplify: true, op: "param", paramKey: "F.cooldown",
            edit: { kind: "number", current: coolingDays, unit: "天", min: 0, max: 90, step: 1,
              ...(coolingDays !== "" ? { amplifiesWhen: "decrease" as const } : {}) },
            detail: `其他奖励冷却期 · ${coolingState}；缩短或初始化须核验 B1 覆盖率，不影响直属政策的独立冷却期。`,
          })}>{coolingDays === "" ? "配置冷却期" : "调整"}</button>}
        </div>
      </div>

      <section className="pane">
        <div className="pane-h"><span className="ph-ttl">历史网络版税</span><span className="ph-sub">历史快照 · 只读</span></div>
        <div style={{ padding: "14px 18px", fontSize: 12, color: "var(--ink-4)" }}>原 L1–L7 网络版税仅供历史核查，不参与新增分佣；费率、NEX 奖励、逐层暂停与旧参数写入口已停用。NEX 奖励按每 1 USDT 版税计算。</div>
        {ctx.f2Metrics.length > 0 && <div className="f-stats">
          {ctx.f2Metrics.map((metric) => <div key={metric.id} className={`f-stat${metric.tone ? " " + metric.tone : ""}`}>
            <div className="k">历史快照 · {metric.name}</div><div className="v">{metric.value}</div><div className="sub">{metric.sub}</div>
          </div>)}
        </div>}
        <div className="casc">
          {ctx.f2Unilevel.length === 0 ? <div style={{ padding: 18, color: "var(--ink-4)", fontSize: 13 }}>暂无历史 L1–L7 费率数据；未配置历史费率，不补默认值。</div> : ctx.f2Unilevel.map((rate) => {
            const paused = configuredValue(ctx.f2ConfigValues[`F.unilevel.${rate.l}.paused`]);
            return <div key={rate.l} className="casc-row">
              <span className={`lchip${rate.direct ? "" : " ext"}`}>{rate.l}</span>
              <div className="rate-bar"><div className={`f${rate.direct ? "" : " ext"}`} style={{ width: "100%" }}><span className="pct">{rate.usdt}% USDT</span></div></div>
              <span className="nex-val">{rate.nex}<small>NEX/USDT版税</small></span>
              <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{rate.ui || "历史层级"}</span>
              <span className="tag">{paused === "on" ? "历史状态：已暂停" : paused === "off" ? "历史状态：未暂停" : paused ? "暂停配置无效" : "暂停状态未配置"}</span>
            </div>;
          })}
        </div>
        {ctx.f2Unilevel.length > 0 && <div className="casc-foot">历史名义费率合计 {ctx.f2Unilevel.reduce((sum, rate) => sum + rate.usdt, 0)}% · 不作为新增分佣费率</div>}
        {ctx.f2RateTiers.length > 0 && <div className="tier-list">
          {ctx.f2RateTiers.map((tier) => <div key={tier.nm} className={`tier ${tier.cls}`}>
            <div className="nm">历史档位 · {tier.nm}<span className="req">{tier.req}</span></div><span className="tier-rate">{tier.rate}</span><span className="dist">{tier.dist}</span>
          </div>)}
        </div>}
        <div className="params">
          <div className="param"><div className="pk">旧结算参数</div><div className="psub">仅保留历史说明。版税支付阈值和平级奖励比例未接入实际结算，不可调整。</div></div>
          <div className="param"><div className="pk">历史 · 合并出口保护上限</div><div className="pv">{configuredValue(ctx.f2ConfigValues["F.unilevel.mergeExitMaxPct"]) || "未配置"}</div><div className="psub">原合并出口护栏快照，仅供核查。</div></div>
          {ctx.f2Params.filter((param) => Object.hasOwn(F2_HISTORICAL_PARAM_NAMES, param.key)).map((param) => {
            const value = configuredValue(ctx.f2ConfigValues[param.key] ?? param.value);
            const parsed = !value ? null : param.key === "F.unilevel.depthGate" ? parseF2DepthGateLayer(value)
              : param.key === "F.unilevel.depthGateRank" ? parseF2DepthGateRank(value) : null;
            return <div key={param.id} className="param">
              <div className="pk">历史 · {F2_HISTORICAL_PARAM_NAMES[param.key]}</div>
              <div className={`pv${param.vcls ? " " + param.vcls : ""}`}>{parsed && !parsed.legal ? `${value}（历史值无效）` : value || "未配置"}</div>
              <div className="psub">旧网络奖励参数快照，仅供核查。</div>
            </div>;
          })}
        </div>
      </section>

      <p className="f-foot">直属购买与设备收益两类政策整组审批；历史网络奖励保留，Partner Status 与其他奖励冷却独立设置。</p>
    </>
  );
}
