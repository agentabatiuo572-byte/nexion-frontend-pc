"use client";

/** F2 · 网络版税费率 —— L1-L7 单一费率源 + Partner Status 权益档 + 结算参数/护栏。 */
import { CodeTag } from "../design-kit";
import type { FViewCtx } from "./types";

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "-";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/\.?0+$/, "");
}

function percentLabel(value: number) {
  return `${formatNumber(value)}%`;
}

export function F2Rates({ ctx }: { ctx: FViewCtx }) {
  const hasUnilevelRows = ctx.f2Unilevel.length > 0;
  const totalUnilevelPct = ctx.f2Unilevel.reduce((sum, row) => sum + row.usdt, 0);
  // Partner Status 是权益档，不改变 L1-L7 费率。兼容读取旧 bronze/silver/gold，
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

  if (ctx.f2Loading && !hasUnilevelRows) {
    return (
      <section className="pane">
        <div className="pane-h"><span className="ph-ttl">F2 网络版税费率</span><span className="ph-sub">数据加载中</span></div>
        <div style={{ padding: 18, color: "var(--ink-4)", fontSize: 13 }}>F2 数据加载中...</div>
      </section>
    );
  }

  if (ctx.f2Error && !hasUnilevelRows) {
    return (
      <section className="pane">
        <div className="pane-h"><span className="ph-ttl">F2 网络版税费率</span><span className="ph-sub">数据加载失败</span></div>
        <div style={{ padding: 18, color: "var(--ink-3)", fontSize: 13 }}>F2 数据加载失败 · {ctx.f2Error}</div>
        <div style={{ padding: "0 18px 18px" }}>
          <button className="fbtn primary" onClick={() => void ctx.refreshF2()}>重试</button>
        </div>
      </section>
    );
  }

  if (!hasUnilevelRows) {
    return (
      <section className="pane">
        <div className="pane-h"><span className="ph-ttl">F2 网络版税费率</span><span className="ph-sub">暂无数据</span></div>
        <div style={{ padding: 18, color: "var(--ink-4)", fontSize: 13 }}>F2 暂无网络版税数据</div>
      </section>
    );
  }

  return (
    <>
      {ctx.f2Metrics.length > 0 && (
        <div className="f-stats">
          {ctx.f2Metrics.map((metric) => (
            <div key={metric.id} className={`f-stat${metric.tone ? " " + metric.tone : ""}`}>
              <div className="k">{metric.name}</div>
              <div className="v">{metric.value}</div>
              <div className="sub">{metric.sub}</div>
            </div>
          ))}
        </div>
      )}

      <div className="f2-top">
        <section className="pane">
          <div className="pane-h">
            <span className="ph-ttl">L1–L7 网络版税费率(Unilevel)</span>
            <span className="ph-r" style={{ marginLeft: "auto" }}><CodeTag tone="electric">F.unilevel.*</CodeTag><span className="tag" style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-4)", border: "1px solid var(--border)", padding: "1px 6px", borderRadius: 5 }}>user · 2-state</span></span>
          </div>
          <div className="casc">
            {ctx.f2Unilevel.map((u) => {
              const eff = percentLabel(u.usdt);
              const nv = formatNumber(u.nex);
              const w = Math.max(8, Math.min(100, (u.usdt / 10) * 100));
              return (
                <div key={u.l} className="casc-row">
                  <span className={`lchip${u.direct ? "" : " ext"}`}>{u.l}</span>
                  <div className="rate-bar"><div className={`f${u.direct ? "" : " ext"}`} style={{ width: `${w}%` }}><span className="pct">{eff}</span></div></div>
                  <button className="nex-val" title="点击调整 NEX 奖励/$1" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }}
                    onClick={() => ctx.openActionConfirm({
                      name: `网络版税 ${u.l} NEX 奖励调整`, amplify: true, op: "param", paramKey: `F.unilevel.nex.${u.l}`,
                      edit: { kind: "text", current: nv }, detail: `${u.l} NEX 奖励/$1 当前 ${nv} · NEX 派发为资金流出,受 B1 覆盖率约束`,
                    })}>{nv}<small>NEX/$1</small></button>
                  <div style={{ fontSize: 11.5, fontWeight: u.direct ? 600 : 400, color: u.direct ? "var(--brand)" : "var(--ink-4)" }}>{u.ui}</div>
                  {u.direct ? (
                    <span className="tag" style={{ justifySelf: "end" }}>固定 10%</span>
                  ) : (
                    <button className="fbtn primary amp" onClick={() => ctx.openActionConfirm({
                      name: `网络版税 ${u.l} 费率调整`, amplify: true, op: "param", paramKey: `F.unilevel.${u.l}`,
                      edit: { kind: "number", current: formatNumber(u.usdt), unit: "%" },
                      detail: `${u.l} 当前 USDT ${eff} · NEX ${nv}/$1 · 改后对下一笔结算生效,不回溯已计提`,
                    })}>调整</button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="casc-foot" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 11.5, color: "var(--ink-4)" }}>
            <span className="lg">直推 DIRECT(L1)</span>
            <span className="lg ext">扩展 EXTENDED(L2–L7)</span>
            <span className="mono" style={{ marginLeft: "auto", fontFamily: "var(--mono)" }}>改后对下一笔结算生效 · 不回溯</span>
          </div>
          <div className="casc-foot" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 11.5, color: "var(--ink-4)", padding: "10px 18px 14px", borderTop: "1px solid var(--border)" }}>
            <span>单层暂停 · L1–L7 各层独立暂停网络版税派发</span>
            <button className="fbtn" style={{ marginLeft: "auto" }} onClick={() => ctx.openActionConfirm({
              name: "单层暂停管理(L1–L7)",
              businessForm: {
                kind: "multi-field",
                title: "单层暂停管理",
                hint: "暂停后该层网络版税停止计提 · 不影响其他层 · 改后对下一笔结算生效。",
                fields: ctx.f2Unilevel.map((u) => ({
                  key: u.l,
                  label: `${u.l} ${u.direct ? "直推" : "扩展"}`,
                  current: (ctx.f2ConfigValues[`F.unilevel.${u.l}.paused`] ?? "off") === "on" ? "on" : "off",
                  inputKind: "select" as const,
                  options: ["on", "off"],
                })),
              },
              detail: "L1-L7 各层网络版税独立暂停开关 · on=暂停该层派发 / off=正常计提 · 写 A2 审计。",
              run: async (reason, bv) => {
                if (!bv) return;
                for (const u of ctx.f2Unilevel) {
                  const val = bv[u.l];
                  if (val === "on" || val === "off") {
                    await ctx.updateF2Config(`F.unilevel.${u.l}.paused`, val, reason);
                  }
                }
                ctx.toast("单层暂停已更新 · 改后对下一笔结算生效");
              },
            })}>单层暂停管理</button>
          </div>
        </section>

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
          <div style={{ padding: "0 18px 14px", fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.55 }}>按月度网络活跃度判定并解锁权益；L1 固定 10%，Partner Status 不叠加、不升档任何版税费率。</div>
          <div className="casc-foot" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 11.5, color: "var(--ink-4)", padding: "10px 18px 14px", borderTop: "1px solid var(--border)" }}>
            <span>门槛 · 当前 <b style={{ color: "var(--ink-2)" }}>${ptStandard}/${ptVerified}/${ptPremium}/${ptDiamond}</b>(Standard/Verified/Premium/Diamond)</span>
            <button className="fbtn primary" style={{ marginLeft: "auto" }} onClick={() => ctx.openActionConfirm({
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
            })}>调整权益门槛</button>
          </div>
        </section>
      </div>

      <div className="params">
        {ctx.f2Params.filter((p) => ["clampMin", "clampMax", "cool", "promo"].includes(p.id)).map((p) => {
          const eff = p.value || p.def;
          return (
            <div key={p.id} className="param">
              <div className="pk">{p.name}<span className="tag">{p.key}</span></div>
              <div className={`pv${p.vcls ? " " + p.vcls : ""}`}>{eff}</div>
              <div className="psub">{p.sub}</div>
              <button className={`fbtn primary${p.vamp ? " amp" : ""}`} onClick={() => ctx.openActionConfirm({
                name: `${p.name}调整`, amplify: p.amp, op: "param", paramKey: p.key,
                edit: { kind: "text", current: eff, unit: p.unit },
                detail: `${p.name} 当前 ${eff}` + (p.amp ? " · 此项为放大资金流出动作,须核验 B1 覆盖率。" : " · 改后对下一笔结算生效。"),
              })}>调整</button>
            </div>
          );
        })}
      </div>

      <div className="guard">
        <span className="ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg></span>
        <div>
          <b>版税出口护栏</b> · L1 是唯一 10% 直推来源，不与另一条 Direct 费率重复叠加；当前 L1–L7 名义费率合计 <b>{percentLabel(totalUnilevelPct)}</b>。资金放大调整经 <b>A2 审批 + B1 预检</b>后对下一笔结算生效，不回溯已计提。
          {ctx.f2Guardrails.length > 0 && (
            <div style={{ marginTop: 6, display: "grid", gap: 3 }}>
              {ctx.f2Guardrails.map((item) => <span key={item} className="mono">{item}</span>)}
            </div>
          )}
        </div>
      </div>

      <p className="f-foot">L1 直推恒定 10%；L2–L7 才应用 InfluenceScore。Partner Status 只解锁权益。费率、NEX/$1 与 promo 倍率上调会放大资金流出，必须经 A2 审批并通过 B1 覆盖率预检。</p>
    </>
  );
}
