"use client";

/** F2 · 网络版税费率 —— L1-L7 Unilevel cascade(direct lemon / extended purple)+ Rate Tier 升档 + 8 参数卡 + 合并出口护栏。 */
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

function policyText(policy: Record<string, unknown>, key: string, fallback = "-") {
  const value = policy[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

export function F2Rates({ ctx }: { ctx: FViewCtx }) {
  const hasUnilevelRows = ctx.f2Unilevel.length > 0;
  const maxCombinedOutflow = policyText(ctx.f2CommissionPolicy, "maxCombinedOutflowPct", "-");

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
                  <button className="fbtn primary amp" onClick={() => ctx.openActionConfirm({
                    name: `网络版税 ${u.l} 费率调整`, amplify: true, op: "param", paramKey: `F.unilevel.${u.l}`,
                    edit: { kind: "text", current: eff, unit: "%" },
                    detail: `${u.l} 当前 USDT ${eff} · NEX ${nv}/$1 · 改后对下一笔结算生效,不回溯已计提`,
                  })}>调整</button>
                </div>
              );
            })}
          </div>
          <div className="casc-foot" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 11.5, color: "var(--ink-4)" }}>
            <span className="lg">直推 DIRECT(L1)</span>
            <span className="lg ext">扩展 EXTENDED(L2–L7)</span>
            <span className="mono" style={{ marginLeft: "auto", fontFamily: "var(--mono)" }}>改后对下一笔结算生效 · 不回溯</span>
          </div>
        </section>

        <section className="pane">
          <div className="pane-h"><span className="ph-ttl">Rate Tier 升档</span><span className="ph-sub">按 30d 网络活跃度</span><span className="ph-r" style={{ marginLeft: "auto" }}><CodeTag>费率升档</CodeTag></span></div>
          <div className="tier-list">
            {ctx.f2RateTiers.map((t) => (
              <div key={t.nm} className={`tier ${t.cls}`}>
                <div className="nm">{t.nm}<span className="req">{t.req}</span></div>
                <span className="tier-rate">{t.rate}</span>
                <span className="dist">{t.dist}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: "0 18px 14px", fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.55 }}>Tier 按 30d 网络贡献 GMV 自动判定 · 派生直接版税(Direct Royalty)的基础费率。</div>
        </section>
      </div>

      <div className="params">
        {ctx.f2Params.map((p) => {
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
          <b>合并出口护栏 §1.8</b> · 用户侧总版税由 Direct Royalty 与 Network L1 叠加判定,当前最大出口 <b>{maxCombinedOutflow}</b>。所有调整经 <b>操作确认</b>后写入审计,改后对下一笔结算生效,不回溯已计提。
          {ctx.f2Guardrails.length > 0 && (
            <div style={{ marginTop: 6, display: "grid", gap: 3 }}>
              {ctx.f2Guardrails.map((item) => <span key={item} className="mono">{item}</span>)}
            </div>
          )}
        </div>
      </div>

      <p className="f-foot">L1 直推 10% 是承载招募奖励的「钩子层」;L4–L7 微薄费率主要做关系网保持。<b>peer 平级奖</b> 与 <b>promo 周倍率</b> 是仅有的两个会显著放大佣金流出的杠杆;两者同步上调时必须先核验 B1 覆盖率。</p>
    </>
  );
}
