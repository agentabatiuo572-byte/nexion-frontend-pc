"use client";

/** F2 · 网络版税费率 —— L1-L7 Unilevel cascade(direct lemon / extended purple)+ Rate Tier 升档 + 8 参数卡 + 合并出口护栏。 */
import { CodeTag } from "../design-kit";
import { UNILEVEL, RATETIER, F2_PARAMS } from "./data";
import type { FViewCtx } from "./types";

export function F2Rates({ ctx }: { ctx: FViewCtx }) {
  return (
    <>
      <div className="f-stats">
        <div className="f-stat"><div className="k">L1 触发率</div><div className="v">76%</div><div className="sub">目标 80% · 直推转化</div></div>
        <div className="f-stat warn"><div className="k">合并出口最大</div><div className="v">25%</div><div className="sub">Royalty 8-15% + L1 10%</div></div>
        <div className="f-stat ok"><div className="k">本周 USDT 版税</div><div className="v">$182k</div><div className="sub">L1-L7 总额</div></div>
        <div className="f-stat cyan"><div className="k">本周 NEX 派发</div><div className="v">3.46M</div><div className="sub">折 ≈ $148k · 受 B1 约束</div></div>
      </div>

      <div className="f2-top">
        <section className="pane">
          <div className="pane-h">
            <span className="ph-ttl">L1–L7 网络版税费率(Unilevel)</span>
            <span className="ph-r" style={{ marginLeft: "auto" }}><CodeTag tone="electric">F.unilevel.*</CodeTag><span className="tag" style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-4)", border: "1px solid var(--border)", padding: "1px 6px", borderRadius: 5 }}>user · 2-state</span></span>
          </div>
          <div className="casc">
            {UNILEVEL.map((u) => {
              const eff = ctx.pget(`F.unilevel.${u.l}`) ?? `${u.usdt}%`;
              const nv = ctx.pget(`F.unilevel.nex.${u.l}`) ?? String(u.nex);
              const w = Math.max(8, (u.usdt / 10) * 100);
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
            {RATETIER.map((t) => (
              <div key={t.nm} className={`tier ${t.cls}`}>
                <div className="nm">{t.nm}<span className="req">{t.req}</span></div>
                <span className="tier-rate">{t.rate}</span>
                <span className="dist">{t.dist}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: "0 18px 14px", fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.55 }}>Tier 由 server 按 30d 网络贡献 GMV 自动判定 · 派生直接版税(Direct Royalty)的基础费率。</div>
        </section>
      </div>

      <div className="params">
        {F2_PARAMS.map((p) => {
          const eff = ctx.pget(p.key) ?? p.def;
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
        <div><b>合并出口护栏 §1.8</b> · 用户侧总版税 = <span className="mono">Direct Royalty(8–15%) + Network L1(10%)</span> 叠加最大 <b>25%</b>。上调任一费率前 server 会先核验 <b>B1 兑付覆盖率</b>(单源 LEDGER 实时派生)。所有调整经 <b>操作确认</b>后写入 A2 append-only 审计,改后对下一笔结算生效,不回溯已计提。</div>
      </div>

      <p className="f-foot">L1 直推 10% 是承载招募奖励的「钩子层」;L4–L7 微薄费率主要做关系网保持。<b>peer 平级奖</b> 与 <b>promo 周倍率</b> 是仅有的两个会显著放大佣金流出的杠杆;两者同步上调时必须先核验 B1 覆盖率。</p>
    </>
  );
}
