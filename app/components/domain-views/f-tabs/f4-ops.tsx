"use client";

/** F4 · 池/配额/大使/榜 —— 领导奖池 / 硬件配额 / 区域大使审批 / 排行榜反欺诈 4 区操盘 + V_VOTES 票数权重(log2 柱 + 可点表)。
 *  ⚡ 放大流出项(池比例 / 榜单奖池 / V_VOTES / 大使审批)前置 B1 覆盖率核验。 */
import { V_VOTES, F4_QUOTA, F4_AMB_BANDS, F4_PODIUM } from "./data";
import type { FViewCtx } from "./types";

const VOTE_LOG_MAX = Math.log2(513);
function voteH(ct: number): number { return (Math.log2(ct + 1) / VOTE_LOG_MAX) * 130; }
function voteTier(i: number): string { return i < 3 ? "t-low" : i < 7 ? "t-mid" : "t-hi"; }

export function F4Ops({ ctx }: { ctx: FViewCtx }) {
  const ratioEff = ctx.pget("F.pool.ratio") ?? "5%";
  const capEff = ctx.pget("F.pool.monthlyCap") ?? "$50,000";
  const proEff = ctx.pget("F.quota.proUnlock") ?? "直推 5 / 月业绩 $50k";
  const rackEff = ctx.pget("F.quota.rackUnlock") ?? "直推 15";
  const stockEff = ctx.pget("F.quota.monthlyStock") ?? "96 台";
  const ambState = ctx.pget("F.ambassador.q3-2025.status");
  const lbPool = ctx.pget("F.leaderboard.poolUsd") ?? "$48,000";
  const lbDq = ctx.pget("F.leaderboard.period.status") === "disqualified";
  return (
    <>
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">本周领导池注入</div><div className="v">$214k</div><div className="sub">5% × 周 GMV $4.28M</div></div>
        <div className="f-stat"><div className="k">本月硬件配额剩余</div><div className="v">32 / 96</div><div className="sub">Pro 18 · Rack 14 余</div></div>
        <div className="f-stat warn"><div className="k">大使待审批</div><div className="v">{ambState ? (ambState === "approved" ? "已批" : "已驳") : "7"}</div><div className="sub">含 4 类预算申请</div></div>
        <div className="f-stat danger"><div className="k">榜单刷榜取消资格</div><div className="v">3</div><div className="sub">K2 反欺诈联动</div></div>
      </div>

      <div className="f4-grid">
        {/* 区1 领导奖池 */}
        <section className="sect">
          <div className="sect-h">
            <span className="ic pool"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6" /><path d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" /></svg></span>
            <div className="t"><div className="nm">领导奖池</div><div className="s">5% 周 GMV / V_VOTES 加权分配</div></div>
            <span className="tag">F4 · F.pool.*</span>
          </div>
          <div className="pool-hero"><div><div className="lbl">本周已注入</div><div className="v">$214,000</div></div><div className="meta">周日 23:59 UTC 结算<br />参与 V8+ 用户 <b>45</b></div></div>
          <div className="kv-row"><span className="k">奖池比例(周 GMV)</span><span className="v brand">{ratioEff}</span></div>
          <div className="kv-row"><span className="k">月度预留上限(cap)</span><span className="v">{capEff}</span></div>
          <div className="kv-row"><span className="k">顶部 10 人池占比</span><span className="v warn">≈ 80%</span></div>
          <div className="kv-row"><span className="k">分配口径</span><span className="v dim">按 V_VOTES 权重</span></div>
          <div className="sect-foot">
            <button className="primary amp" onClick={() => ctx.openMc({ name: "领导池比例调整(周 GMV)", amplify: true, op: "param", paramKey: "F.pool.ratio", edit: { kind: "text", current: ratioEff, unit: "%" }, detail: `每周 GMV 注入领导池的比例 · 当前 ${ratioEff} · 放大池子流出,受 B1 约束。` })}>调整池比例</button>
            <button onClick={() => ctx.openMc({ name: "领导池月度 cap 调整", op: "param", paramKey: "F.pool.monthlyCap", edit: { kind: "text", current: capEff }, detail: `领导池月度预留封顶 · 当前 ${capEff} · 防预算超支(超额顺延次月)。` })}>调整月度 cap</button>
          </div>
        </section>

        {/* 区2 硬件配额 */}
        <section className="sect">
          <div className="sect-h">
            <span className="ic quota"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4.5v9L12 20l-8-4.5v-9z" /><path d="M12 11l8-4.5M12 11v9M12 11L4 6.5" /></svg></span>
            <div className="t"><div className="nm">硬件配额</div><div className="s">销售前置门 · 月度库存上限</div></div>
            <span className="tag">F6 · F.quota.*</span>
          </div>
          <div style={{ marginBottom: 12 }}>
            {F4_QUOTA.map((q) => (
              <div key={q.nm} className="stock-meter"><span className="nm">{q.nm}</span><span className={`bar${q.tight ? " tight" : ""}`}><span className="f" style={{ width: `${(q.cur / q.cap) * 100}%` }} /></span><span className="ct">{q.cur} / {q.cap}</span></div>
            ))}
            <div className="stock-note">月库存上限 96 台 · 已出 70 台</div>
          </div>
          <div className="kv-row"><span className="k">Pro 解锁门槛</span><span className="v dim">{proEff}</span></div>
          <div className="kv-row"><span className="k">Rack 解锁门槛</span><span className="v dim">{rackEff}</span></div>
          <div className="kv-row"><span className="k">月库存上限</span><span className="v">{stockEff}</span></div>
          <div className="sect-foot">
            <button onClick={() => ctx.openMc({ name: "Pro 解锁门槛调整", op: "param", paramKey: "F.quota.proUnlock", edit: { kind: "text", current: proEff }, detail: `Pro 销售前置门 · 当前 ${proEff}` })}>Pro 门槛</button>
            <button onClick={() => ctx.openMc({ name: "Rack 解锁门槛调整", op: "param", paramKey: "F.quota.rackUnlock", edit: { kind: "text", current: rackEff }, detail: `Rack 销售前置门 · 当前 ${rackEff}` })}>Rack 门槛</button>
            <button onClick={() => ctx.openMc({ name: "月库存上限调整", op: "param", paramKey: "F.quota.monthlyStock", edit: { kind: "number", current: stockEff, unit: "台" }, detail: `月度硬件供给上限 · 当前 ${stockEff}` })}>月库存</button>
          </div>
        </section>

        {/* 区3 区域大使审批 */}
        <section className="sect">
          <div className="sect-h">
            <span className="ic amb"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17" cy="9" r="2.2" /><path d="M21 20c0-2.6-1.8-4.8-4.2-5.4" /></svg></span>
            <div className="t"><div className="nm">区域大使审批</div><div className="s">V5+ · 4 类预算 · 待审 7 单</div></div>
            <span className="tag">F7 · F.ambassador.*</span>
          </div>
          <div className="amb-bands">
            {F4_AMB_BANDS.map((b) => (<div key={b.nm} className="amb-band"><div className="nm">{b.nm}</div><div className="ct">{b.ct}<small>件</small></div></div>))}
          </div>
          <div className="kv-row"><span className="k">本月已批准预算</span><span className="v ok">$48,200 / $80,000</span></div>
          <div className="kv-row"><span className="k">KOL 预算占比</span><span className="v">50%</span></div>
          <div className="kv-row"><span className="k">下季度配额评估</span><span className="v dim">9 月 1 日</span></div>
          <div className="sect-foot">
            <button className="primary amp" disabled={!!ambState} onClick={() => ctx.openMc({ name: "区域大使申请审批通过", amplify: true, op: "dispose", paramKey: "F.ambassador.q3-2025.status", fixedVal: "approved", status: "approved", detail: "批准大使申请 · 开通 4 类预算额度与权益 · 写 A2 审计 · 资金流出受 B1 约束。" })}>审批通过</button>
            <button className="danger" disabled={!!ambState} onClick={() => ctx.openMc({ name: "区域大使申请驳回", op: "dispose", paramKey: "F.ambassador.q3-2025.status", fixedVal: "rejected", status: "rejected", detail: "驳回大使申请 · 不开通预算 · 写 A2 审计。" })}>驳回</button>
          </div>
        </section>

        {/* 区4 排行榜 · 反欺诈 */}
        <section className="sect">
          <div className="sect-h">
            <span className="ic lb"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16" /><rect x="5" y="11" width="3.5" height="7" /><rect x="10.2" y="7" width="3.5" height="11" /><rect x="15.4" y="13" width="3.5" height="5" /></svg></span>
            <div className="t"><div className="nm">排行榜 · 反欺诈</div><div className="s">4 周期奖池 · Podium · K2 联动</div></div>
            <span className="tag">F8 · F.leaderboard.*</span>
          </div>
          <div className="podium">
            {F4_PODIUM.map((p) => (
              <div key={p.uid} className={`pod ${p.cls}`}><span className="rank">{p.rank}</span><div className="uid">{p.uid}</div><div className="gv">{p.gv}<small>{p.tip}</small></div></div>
            ))}
          </div>
          <div className="kv-row"><span className="k">本期奖池</span><span className="v">{lbPool}</span></div>
          <div className="kv-row"><span className="k">参赛人数</span><span className="v">1,284</span></div>
          <div className="kv-row"><span className="k">刷榜命中 · K2</span><span className="v" style={{ color: "var(--danger)" }}>{lbDq ? "已处置" : "3 账户"}</span></div>
          <div className="sect-foot">
            <button className="primary amp" onClick={() => ctx.openMc({ name: "本期榜单奖池调整", amplify: true, op: "param", paramKey: "F.leaderboard.poolUsd", edit: { kind: "text", current: lbPool }, detail: `本期榜单奖池总额 · 当前 ${lbPool} · 放大奖池流出,受 B1 约束。` })}>调整奖池</button>
            <button className="danger" disabled={lbDq} onClick={() => ctx.openMc({ name: "排行榜取消资格(反欺诈)", op: "dispose", paramKey: "F.leaderboard.period.status", fixedVal: "disqualified", status: "disqualified", detail: "对刷榜账户取消本期资格 · 剔除其榜单名次与奖池分配 · 写 A2 审计。" })}>取消资格 · 反欺诈</button>
          </div>
        </section>
      </div>

      <section className="sect votes-card">
        <div className="sect-h">
          <span className="ic pool"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3-7 4 14 3-7h4" /></svg></span>
          <div className="t"><div className="nm">V 级票数权重 · 领导池分配依据</div><div className="s">指数翻倍 V3=1 → V12=512 · 顶部 10 人吃池 80%</div></div>
          <span className="tag">F.pool.votes.*</span>
        </div>
        <div className="votes-grid">
          {V_VOTES.map((r, i) => (
            <div key={r.v} className="vote-col"><span className="v">{r.votes}</span><span className={`b ${voteTier(i)}`} style={{ height: voteH(r.votes) }} /><span className="l">{r.v}</span></div>
          ))}
        </div>
        <div className="vote-table">
          {V_VOTES.map((r) => {
            const eff = ctx.pget(`F.pool.votes.${r.v}`) ?? String(r.votes);
            return (
              <div key={r.v} className="vote-cell" onClick={() => ctx.openMc({ name: `领导池 ${r.v} 票数权重调整`, amplify: true, op: "param", paramKey: `F.pool.votes.${r.v}`, edit: { kind: "number", current: eff, unit: "票" }, detail: `${r.v} 当前 ${eff} 票 · 改变领导池分配权重 · 调高放大头部虹吸 · 受 B1 覆盖率约束。` })}>
                <div className="vlb">{r.v} 权重</div><div className="vct">{eff} 票</div>
              </div>
            );
          })}
        </div>
        <div className="f4-warn"><b>权重一动则虹吸放大</b> · 调高高 V 级权重会进一步放大头部分润,顶部 10 人池占比将从 ≈80% 上抬。<b>每一项调整均视为「放大资金流出」</b>,须先核验 B1 兑付覆盖率(§1.8)。</div>
      </section>

      <p className="f-foot">4 个子模块共用一条 server 评估总线:<b>每周日 23:59 UTC</b> 结算时,server 依据 V_VOTES、配额库存、大使预算、榜单结果一次性派发。运营侧调参均经 Maker-Checker;放大流出项前置 B1 覆盖率核验。</p>
    </>
  );
}
