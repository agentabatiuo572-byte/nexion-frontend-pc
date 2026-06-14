"use client";

/** F1 · V-Rank 晋升 —— 13 阶阶梯(V-badge 热度渐变 + log 人口条)+ 右栏人口金字塔 / 发货队列 / 治理口径。 */
import { CodeTag } from "../design-kit";
import { VRANK, F1_FULFILL } from "./data";
import type { FViewCtx } from "./types";

const LOG_MAX = Math.log10(84231);
function popPct(p: number): number { return p <= 0 ? 0 : Math.max(2, (Math.log10(Math.max(p, 1)) / LOG_MAX) * 100); }
function pyrPct(p: number): number { return p <= 0 ? 0 : Math.max(3, (Math.log10(Math.max(p, 1)) / LOG_MAX) * 100); }
function popColor(i: number): string { return i <= 2 ? "var(--cyan)" : i <= 5 ? "var(--brand)" : i <= 7 ? "var(--warning)" : "var(--brand-2)"; }

export function F1Vrank({ ctx }: { ctx: FViewCtx }) {
  return (
    <>
      <div className="f-stats">
        <div className="f-stat"><div className="k">总会员</div><div className="v">100,575</div><div className="sub">含 V0 84,231</div></div>
        <div className="f-stat ok"><div className="k">V3+ 高价值</div><div className="v">614</div><div className="sub">≈ 0.61% · 顶部漏斗</div></div>
        <div className="f-stat cyan"><div className="k">本月晋升</div><div className="v">+217</div><div className="sub">V1 +148 · V2 +43 · V3+ +26</div></div>
        <div className="f-stat warn"><div className="k">待发实物奖品</div><div className="v">38</div><div className="sub">V3+ · NEX 池 ≈ 824k</div></div>
      </div>

      <div className="f1-main">
        <section className="ladder">
          <div className="ladder-h">
            <span className="ph-ttl">V-Rank 13 阶阶梯</span>
            <span className="ph-sub">门槛 · 实物奖 · 培育奖 NEX · 在册人数</span>
            <span className="ph-r" style={{ marginLeft: "auto" }}><CodeTag tone="cyan">server-canonical</CodeTag></span>
          </div>
          {VRANK.map((r, i) => {
            const hasPrize = r.prize !== "—";
            const hasNex = r.nex !== "—";
            const eff = ctx.pget(`F.vrank.${r.v}`) ?? r.th;
            return (
              <div key={r.v} className={`lrow${r.pop === 0 ? " empty" : ""}${i === VRANK.length - 1 ? " last" : ""}`}>
                <div className={`vbadge v-${i}`}>{r.v}</div>
                <div className="lcell"><div className="l1">{eff}</div><div className="l2">F.vrank.{r.v}</div></div>
                <div className="lcell"><div className={`prize${hasPrize ? "" : " none"}`}>{r.prize}</div></div>
                <div className="lcell"><div className={`nex${hasNex ? "" : " none"}`}>{hasNex ? `${r.nex} NEX` : "—"}</div></div>
                <div className="pop">
                  <div className="bar"><div className="f" style={{ width: `${popPct(r.pop)}%`, background: popColor(i) }} /></div>
                  <div className="ct">{r.pop.toLocaleString()}</div>
                </div>
                <div className="lact">
                  <button className="fbtn primary" onClick={() => ctx.openActionConfirm({
                    name: `V-Rank ${r.v} 门槛调整`, amplify: hasNex, op: "param", paramKey: `F.vrank.${r.v}`,
                    edit: { kind: "text", current: eff },
                    detail: `${r.v} 晋升门槛 · 当前 ${eff} · server 晋升判定改后对下一轮评估生效,不回溯已晋升用户。${hasNex ? "该阶含培育奖 NEX 派发,放大资金流出,受 B1 覆盖率约束。" : ""}`,
                  })}>调整门槛</button>
                  {hasPrize && <button className="fbtn" onClick={() => ctx.toast(`${r.v} · ${r.prize} 发货队列 已打开`)}>发货队列</button>}
                </div>
              </div>
            );
          })}
        </section>

        <aside className="rail">
          <div className="rail-card">
            <div className="rc-h">人口金字塔<span className="tag">log</span></div>
            <div className="pyr">
              {[...VRANK].reverse().map((r) => {
                const idx = VRANK.findIndex((x) => x.v === r.v);
                const zero = r.pop === 0;
                return (
                  <div key={r.v} className="pyr-row">
                    <span className="lbl">{r.v}</span>
                    <div className={`b${idx >= 6 ? " top" : ""}`} style={zero ? { width: 1, opacity: 0.18 } : { width: `${pyrPct(r.pop)}%` }} />
                    <span className="ct">{r.pop.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 6, lineHeight: 1.5 }}>log 标尺以可视化顶部稀薄分布 · V8+ 仅 1 人;V12 至今 0 人。</div>
          </div>

          <div className="rail-card">
            <div className="rc-h">实物奖品发货队列<span className="tag">38 件</span></div>
            <div className="ful">
              {F1_FULFILL.map((f) => (
                <div key={f.v} className="row"><span className="vb">{f.v}</span><span className="nm">{f.name}</span><span className="ct">{f.ct}</span></div>
              ))}
            </div>
            <hr className="section-divider" />
            <div className="row" style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: "var(--ink-3)" }}>下一批发货</span>
              <span className="mono" style={{ color: "var(--ink-2)", fontFamily: "var(--mono)" }}>本周五 18:00 UTC</span>
            </div>
          </div>

          <div className="rail-card">
            <div className="rc-h">治理口径</div>
            <div className="gov-list">
              <div className="it">门槛改后对<b>下一轮评估</b>生效,不回溯已晋升的 V 级。</div>
              <div className="it">培育奖 NEX 派发即时计入科目 #7(放大 NEX 流出 · 受 B1 约束)。</div>
              <div className="it">实物奖品入运营物流队列 · 收件人地址加密落 A2 审计。</div>
              <div className="it">V-Rank 与 <b>F4 领导池票数</b>耦合:V3=1 → V12=512 指数翻倍。</div>
            </div>
          </div>
        </aside>
      </div>

      <p className="f-foot"><b>顶部稀薄、底部臃肿</b>是 V-Rank 设计意图;V3+ 仅占 0.61% 但承担 80% 领导池分配。调高 V8+ 门槛会收紧头部分润但需先核验 B1 覆盖率 · 调高低阶门槛(V1/V2)会压制新人进群速度。</p>
    </>
  );
}
