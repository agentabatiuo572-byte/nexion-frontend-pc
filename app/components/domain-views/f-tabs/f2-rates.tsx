"use client";

/** F2 · 原七层购买奖励、直属分成与独立权益/冷却配置。 */
import { CodeTag } from "../design-kit";
import { F2DirectPolicy } from "./f2-direct-policy";
import { F2_DEPTH_GATE_LAYERS, f2EnumGateSpec, parseF2DepthGateLayer, parseF2DepthGateRank } from "@/lib/admin/f2-depth-gate";
import type { FViewCtx } from "./types";

const F2_VISIBLE_PARAM_KEYS = new Set([
  "F.cooldown", "F.unilevel.depthGate", "F.unilevel.depthGateRank",
  "F.influence.clampMin", "F.influence.clampMax", "F.promo.weekMultiplier", "F.unilevel.mergeExitMaxPct",
]);
const F2_HISTORICAL_PARAM_NAMES: Record<string, string> = {
  "F.unilevel.depth": "最大层数",
  "F.unilevel.depthGate": "层级解锁门槛",
  "F.unilevel.depthGateRank": "解锁等级",
  "F.influence.clampMin": "影响分下限",
  "F.influence.clampMax": "影响分上限",
  "F.promo.weekMultiplier": "活动周倍率",
  "F.unilevel.mergeExitMaxPct": "合并出口保护上限",
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
  const canRoyaltyRate = ctx.can("network_f2_royalty_rate");
  const canPolicyAmplify = ctx.can("network_f2_policy_amplify");
  const l1NexReadonly = !ctx.f2DirectPolicy || !!ctx.f2DirectPolicyError || ctx.f2DirectPolicyLoading || (ctx.f2DirectPolicy.sevenLayerEnabled && ctx.f2DirectPolicy.purchaseSplit.enabled);
  const coolingRaw = configuredValue(ctx.f2ConfigValues["F.cooldown"]);
  const coolingDays = /^[+-]?\d+$/.test(coolingRaw) && Number(coolingRaw) >= 0 && Number(coolingRaw) <= 90
    ? String(Number(coolingRaw)) : "";
  const coolingParam = ctx.f2Params.find((p) => p.key === "F.cooldown");
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
      <div className="f-section-stack f2-layout"><F2DirectPolicy key="direct-policy" ctx={ctx} /><section className="pane">
        <div className="pane-h"><span className="ph-ttl">网络版税与分成</span><span className="ph-sub">数据加载中</span></div>
        <div style={{ padding: 18, color: "var(--ink-3)" }}>七层购买奖励与独立参数加载中...</div>
      </section></div>
    );
  }

  if (ctx.f2Error) {
    return (
      <div className="f-section-stack f2-layout"><F2DirectPolicy key="direct-policy" ctx={ctx} /><section className="pane">
        <div className="pane-h"><span className="ph-ttl">网络版税与分成</span><span className="ph-sub">数据加载失败</span></div>
        <div role="alert" style={{ padding: 18, color: "var(--ink-3)" }}>七层购买奖励与独立参数加载失败 · {ctx.f2Error}</div>
        <div style={{ padding: "0 18px 18px" }}>
          <button className="fbtn primary" onClick={() => void ctx.refreshF2()}>重试</button>
        </div>
      </section></div>
    );
  }

  return (
    <div className="f-section-stack f2-layout">
      <section className="pane">
        <div className="pane-h"><span className="ph-ttl">七层购买奖励</span><span className="ph-sub">L1–L7 原网络版税</span></div>
        <div style={{ padding: "14px 18px", fontSize: 12, color: "var(--ink-4)" }}>B 购买时，直属上级 A 获得原 L1 预算；C 及后续下级购买时，A 按所在 L2–L7 层级与原门槛获得奖励。下方购买拆分只改变 L1 的发放构成；L2–L7 的 NEX 仍按原系数计算，设备收益分成独立配置。</div>
        {ctx.f2Metrics.length > 0 && <div className="f-stats">
          {ctx.f2Metrics.map((metric) => <div key={metric.id} className={`f-stat${metric.tone ? " " + metric.tone : ""}`}>
            <div className="k">{metric.name}</div><div className="v">{metric.value}</div>
          </div>)}
        </div>}
        {ctx.f2Unilevel.length === 0 && <div style={{ padding: "0 18px 14px", color: "var(--ink-3)" }}>七层购买奖励尚未配置；以下当前值均为未配置，提交时仍由服务端核验规则。</div>}
        <div className="casc" role="table" aria-label="七层购买奖励费率">
          <div className="casc-head" role="row">
            {["层级", "购买基础费率", "NEX 奖励系数", "派发状态", "操作"].map(label => <span key={label} role="columnheader">{label}</span>)}
          </div>
          {F2_DEPTH_GATE_LAYERS.map((level) => {
            const rate = ctx.f2Unilevel.find((row) => row.l === level);
            const currentRate = rate ? String(rate.usdt) : "";
            const currentNex = rate ? String(rate.nex) : "";
            const paused = configuredValue(ctx.f2ConfigValues[`F.unilevel.${level}.paused`]);
            const direct = level === "L1";
            return <div key={level} className="casc-row" role="row">
              <div role="rowheader" className="casc-level"><span className={`lchip${direct ? "" : " ext"}`}>{level}</span><small>{direct ? "直属购买" : "下级购买"}</small></div>
              <div role="cell" className="casc-rate"><span className="casc-mobile-label">购买基础费率</span><strong>{rate ? `${currentRate}%` : "未配置"}</strong>{rate && <div className="rate-bar" aria-hidden="true"><div className={`f${direct ? "" : " ext"}`} style={{ width: `${Math.max(0, Math.min(100, rate.usdt))}%` }} /></div>}</div>
              <div role="cell" className="casc-nex"><span className="casc-mobile-label">NEX 奖励系数</span>
              {canRoyaltyRate && (!direct || !l1NexReadonly) ? <button className="nex-val" title={`调整 ${level} NEX 奖励系数`} style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => ctx.openActionConfirm({
                name: `${level} 购买奖励 NEX 系数调整`, amplify: true, op: "param", paramKey: `F.unilevel.nex.${level}`,
                edit: { kind: "number", current: currentNex, min: 0, unit: "NEX/USDT版税", amplifiesWhen: "increase" },
                detail: `${level} 每 1 USDT 版税的 NEX 奖励 · 当前 ${currentNex || "未配置"}；上调须核验 B1 覆盖率，批准后用于后续结算，不回溯。`,
              })}>{currentNex || "未配置"}<small>NEX/USDT版税</small></button> : <span className="nex-val">{currentNex || "未配置"}<small>{direct && l1NexReadonly ? "旧系数只读 · 拆分启用时不适用" : "NEX/USDT版税"}</small></span>}
              </div>
              <div role="cell" className="casc-status"><span className="casc-mobile-label">派发状态</span><span>{paused === "on" ? "已暂停" : paused === "off" ? "未暂停" : paused ? "配置无效" : "未配置"}</span></div>
              <div role="cell" className="casc-action">{direct ? <span className="casc-fixed">{rate ? "L1 费率固定" : "L1 待配置"}<small>{rate ? "由服务端管理" : "不可手动调整"}</small></span> : canRoyaltyRate ? <button className="fbtn primary amp" onClick={() => ctx.openActionConfirm({
                name: `${level} 购买奖励费率调整`, amplify: true, op: "param", paramKey: `F.unilevel.${level}`,
                edit: { kind: "number", current: currentRate, min: 0, unit: "%", amplifiesWhen: "increase" },
                detail: `${level} 购买奖励 USDT 费率 · 当前 ${rate ? `${currentRate}%` : "未配置"}；上调须核验 B1 覆盖率，批准后用于后续结算，不回溯。`,
              })}>{rate ? "调整" : "配置费率"}</button> : <span className="casc-fixed">仅可查看</span>}</div>
            </div>;
          })}
        </div>
        {ctx.f2Unilevel.length > 0 && <div className="casc-foot">当前七层名义费率合计 {ctx.f2Unilevel.reduce((sum, rate) => sum + rate.usdt, 0)}% · 实际奖励仍按各层门槛、暂停状态与出口上限核验</div>}
        <div className="casc-foot" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <span>单层暂停 · 各层独立控制购买奖励派发</span>
          {canPolicyAmplify && <button className="fbtn" style={{ marginLeft: "auto" }} onClick={() => ctx.openActionConfirm({
            name: "单层暂停管理(L1–L7)",
            businessForm: {
              kind: "multi-field", title: "单层暂停管理", hint: "逐层选择暂停或恢复；不会补发已跳过的购买奖励。未配置的层必须明确选择。",
              fields: F2_DEPTH_GATE_LAYERS.map((level) => {
                const value = configuredValue(ctx.f2ConfigValues[`F.unilevel.${level}.paused`]);
                return { key: level, label: `${level} ${level === "L1" ? "直属购买" : "下级购买"}`, current: value === "on" || value === "off" ? value : "",
                  inputKind: "select" as const, options: ["", "on", "off"], optionLabels: { "": "请选择", on: "暂停", off: "恢复派发" } };
              }),
            },
            completionCopy: "提交后进入 A2 待确认队列，批准执行后整批生效",
            detail: "L1–L7 各层暂停开关整批提交；批准后用于后续购买奖励结算，不影响设备收益分成。",
            run: async (reason, values) => {
              if (!values || F2_DEPTH_GATE_LAYERS.some((level) => values[level] !== "on" && values[level] !== "off")) throw new Error("请选择全部 7 层的暂停状态");
              await ctx.updateFConfigBatch("F2", F2_DEPTH_GATE_LAYERS.map((level) => ({ key: `F.unilevel.${level}.paused`, value: values[level] })), reason);
              ctx.toast("七层暂停设置已提交 A2，批准后整批生效");
            },
          })}>单层暂停管理</button>}
        </div>
        {ctx.f2RateTiers.length > 0 && <div className="tier-list">
          {ctx.f2RateTiers.map((tier) => <div key={tier.nm} className={`tier ${tier.cls}`}>
            <div className="nm">历史档位 · {tier.nm}<span className="req">{tier.req}</span></div><span className="tier-rate">{tier.rate}</span><span className="dist">{tier.dist}</span>
          </div>)}
        </div>}
        <div className="params f2-rule-params">
          {[...F2_VISIBLE_PARAM_KEYS].filter((key) => key !== "F.cooldown").map((key) => {
            const param = ctx.f2Params.find((row) => row.key === key);
            const value = configuredValue(ctx.f2ConfigValues[key] ?? param?.value);
            const name = F2_HISTORICAL_PARAM_NAMES[key];
            const enumSpec = f2EnumGateSpec(key);
            const parsed = !value ? null : key === "F.unilevel.depthGate" ? parseF2DepthGateLayer(value)
              : key === "F.unilevel.depthGateRank" ? parseF2DepthGateRank(value) : null;
            const promo = key === "F.promo.weekMultiplier";
            const merge = key === "F.unilevel.mergeExitMaxPct";
            const allowed = promo ? canRoyaltyRate : canPolicyAmplify;
            return <div key={key} className="param">
              <div className="pk">{name}</div>
              <div className={`pv${param?.vcls ? " " + param.vcls : ""}`}>{parsed && !parsed.legal ? `${value}（配置无效）` : value || "未配置"}</div>
              <div className="psub">{enumSpec ? "层级与等级门槛须为有效选项；缺值或非法值时服务端会阻断结算。" : promo ? "活动周购买奖励倍率，允许 1–3 倍；上调须核验 B1 覆盖率。" : merge ? "整条购买奖励出口占订单小计的比例上限，允许 0–100%。" : "原购买奖励的影响分边界，作用于 L2–L7；不改变 L1 费率。"}</div>
              {parsed && !parsed.legal && <div className="psub" role="alert" style={{ color: "var(--danger)" }}>{enumSpec?.illegalCopy}</div>}
              {allowed && <button className={`fbtn primary${promo ? " amp" : ""}`} onClick={() => ctx.openActionConfirm({
                name: `${name}调整`, amplify: promo, op: "param", paramKey: key,
                edit: enumSpec ? { kind: "select", current: parsed?.normalized ?? value, options: enumSpec.options, unit: enumSpec.unit }
                  : { kind: "number", current: value, ...(promo ? { min: 1, max: 3, unit: "倍", amplifiesWhen: "increase" as const } : merge ? { min: 0, max: 100, unit: "%" } : {}) },
                detail: `${name} · 当前 ${value || "未配置"}；确认与理由提交后进入 A2，批准执行后用于后续购买奖励结算，不回溯。`,
              })}>{value ? "调整" : "配置"}</button>}
            </div>;
          })}
        </div>
        <details className="f2-legacy">
          <summary>未接入的旧参数 · 仅供核查</summary>
          <p>版税支付阈值、平级奖励比例、日封顶与回溯窗口等未接入实际结算，不可调整。</p>
          <div className="f2-legacy-values">
          {ctx.f2Params.filter((param) => Object.hasOwn(F2_HISTORICAL_PARAM_NAMES, param.key) && !F2_VISIBLE_PARAM_KEYS.has(param.key)).map((param) => {
            const value = configuredValue(ctx.f2ConfigValues[param.key] ?? param.value);
            return <div key={param.id} className="param">
              <div className="pk">仅供核查 · {F2_HISTORICAL_PARAM_NAMES[param.key]}</div>
              <div className={`pv${param.vcls ? " " + param.vcls : ""}`}>{value || "未配置"}</div>
              <div className="psub">旧网络奖励参数快照，仅供核查。</div>
            </div>;
          })}
          </div>
        </details>
      </section>

      <F2DirectPolicy key="direct-policy" ctx={ctx} />
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
          <div className="f2-help" style={{ padding: "0 18px 14px" }}>按月度网络活跃度判定并解锁权益；Partner Status 不改变直属分成政策。</div>
          <div className="casc-foot" style={{ borderTop: "1px solid var(--border)" }}>
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
        <section className="pane f2-cooling">
          <div className="pane-h"><span className="ph-ttl">购买与其他奖励冷却</span></div>
          <p>购买奖励沿用原七层冷却；直属设备收益使用独立冷却，二者不混用。</p>
        <div key={coolingParam?.id ?? "cool"} className="param">
          <div className="pk">购买与其他奖励冷却期</div>
          <div className={`pv${coolingParam?.vcls ? " " + coolingParam.vcls : ""}`}>{coolingState}</div>
          <div className="psub">0–90 天整数；用于七层购买及原有其他奖励；不影响直属设备收益的独立冷却期。</div>
          {canPolicyAmplify && <button className={`fbtn primary${coolingParam?.vamp ? " amp" : ""}`} onClick={() => ctx.openActionConfirm({
            name: "购买与其他奖励冷却期调整", amplify: true, op: "param", paramKey: "F.cooldown",
            edit: { kind: "number", current: coolingDays, unit: "天", min: 0, max: 90, step: 1,
              ...(coolingDays !== "" ? { amplifiesWhen: "decrease" as const } : {}) },
            detail: `购买与其他奖励冷却期 · ${coolingState}；缩短或初始化须核验 B1 覆盖率，不影响直属设备收益的独立冷却期。`,
          })}>{coolingDays === "" ? "配置冷却期" : "调整"}</button>}
        </div>
        </section>
      </div>



      <p className="f-foot">原七层购买奖励保留；设备收益分成独立设置。Partner Status 只决定权益，不叠加购买奖励费率；参数修改须确认、填写理由并经 A2 执行。</p>
    </div>
  );
}
