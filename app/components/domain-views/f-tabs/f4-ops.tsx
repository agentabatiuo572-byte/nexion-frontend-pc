"use client";

/** F4 · 池/配额/大使/榜 —— 数据源为后端 /api/admin/teams/leadership-pool。 */
import type { FViewCtx } from "./types";

function voteH(count: number, maxVote: number): number {
  const max = Math.max(1, Math.log2(maxVote + 1));
  return (Math.log2(count + 1) / max) * 130;
}

function voteTier(index: number): string {
  return index < 3 ? "t-low" : index < 7 ? "t-mid" : "t-hi";
}

function statTone(tone: string) {
  if (tone === "err" || tone === "danger") return "danger";
  return tone;
}

function usd(value: number) {
  return "$" + Math.round(value).toLocaleString("en-US");
}

function usdM(value: number) {
  return "$" + (value / 1_000_000).toFixed(2) + "M";
}

function statusResolved(status: string) {
  return status === "approved" || status === "rejected";
}

export function F4Ops({ ctx }: { ctx: FViewCtx }) {
  const data = ctx.f4Overview;

  if (ctx.f4Loading && !data) {
    return <section className="sect"><div className="empty">F4 数据加载中...</div></section>;
  }

  if (ctx.f4Error && !data) {
    return (
      <section className="sect">
        <div className="empty">F4 数据加载失败 · {ctx.f4Error}</div>
        <div className="sect-foot"><button onClick={() => void ctx.refreshF4()}>重新加载</button></div>
      </section>
    );
  }

  if (!data) {
    return <section className="sect"><div className="empty">F4 暂无数据</div></section>;
  }

  const ratioEff = data.poolRatio;
  const capEff = data.monthlyCapLabel;
  const proEff = data.proUnlock;
  const rackEff = data.rackUnlock;
  const stockEff = data.quotaMonthlyStockLabel;
  const lbPool = data.leaderboardPoolLabel;
  const lbDq = data.leaderboardDisqualified;
  const maxVote = Math.max(1, ...data.voteWeights.map((row) => row.votes));
  const monthPoolUsd = Math.round(data.weeklyInjectedUsd * 4.33);
  const ambLocked = statusResolved(data.ambassadorStatus);

  return (
    <>
      {ctx.f4Error && (
        <section className="sect">
          <div className="empty">F4 数据刷新失败 · {ctx.f4Error}</div>
          <div className="sect-foot"><button onClick={() => void ctx.refreshF4()}>重新加载</button></div>
        </section>
      )}

      <div className="f-stats">
        {data.metrics.map((metric) => (
          <div key={metric.id} className={`f-stat ${statTone(metric.tone)}`}>
            <div className="k">{metric.name}</div>
            <div className="v">{metric.value}</div>
            <div className="sub">{metric.sub}</div>
          </div>
        ))}
      </div>

      <div className="f4-grid">
        <section className="sect">
          <div className="sect-h">
            <span className="ic pool"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6" /><path d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" /></svg></span>
            <div className="t"><div className="nm">领导奖池</div><div className="s">{ratioEff} 周 GMV / V_VOTES 加权分配</div></div>
            <span className="tag">F4 · F.pool.*</span>
          </div>
          <div className="pool-hero">
            <div><div className="lbl">本周池(周 GMV × {ratioEff})</div><div className="v">{usd(data.weeklyInjectedUsd)}</div></div>
            <div className="meta">{data.settlementWindow} 快照 → {data.settlementDispatchWindow} 派发<br />参与 V{data.unlockRank}+ 领袖 <b>{data.participantCount}</b></div>
          </div>
          <div className="kv-row"><span className="k">奖池比例(周 GMV)</span><span className="v brand">{ratioEff}</span></div>
          <div className="kv-row"><span className="k">月度预留上限(cap)</span><span className="v">{capEff}</span></div>
          <div className="kv-row"><span className="k">顶部 {data.topN} 名占比(派生)</span><span className="v warn">≈ {data.topSharePct}%</span></div>
          <div className="kv-row"><span className="k">分配口径</span><span className="v dim">按 V_VOTES 权重</span></div>
          <div className="sect-foot">
            <button className="primary amp" onClick={() => ctx.openActionConfirm({ name: "领导池比例调整(周 GMV)", amplify: true, op: "param", paramKey: "F.pool.ratio", edit: { kind: "text", current: ratioEff, unit: "%" }, detail: `每周 GMV 注入领导池的比例 · 当前 ${ratioEff} · 放大池子流出,受 B1 约束。` })}>调整池比例</button>
            <button onClick={() => ctx.openActionConfirm({ name: "领导池月度 cap 调整", op: "param", paramKey: "F.pool.monthlyCap", edit: { kind: "text", current: capEff }, detail: `领导池月度预留护栏 · 当前 ${capEff} · 当前月池约 ${usdM(monthPoolUsd)}。` })}>调整月度 cap</button>
          </div>
        </section>

        <section className="sect">
          <div className="sect-h">
            <span className="ic quota"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4.5v9L12 20l-8-4.5v-9z" /><path d="M12 11l8-4.5M12 11v9M12 11L4 6.5" /></svg></span>
            <div className="t"><div className="nm">硬件配额</div><div className="s">销售前置门 · 月度库存上限</div></div>
            <span className="tag">F4b · F.quota.*</span>
          </div>
          <div style={{ marginBottom: 12 }}>
            {data.quotaRows.map((quota) => (
              <div key={quota.name} className="stock-meter">
                <span className="nm">{quota.name}</span>
                <span className={`bar${quota.tight ? " tight" : ""}`}><span className="f" style={{ width: `${Math.min(100, (quota.current / Math.max(1, quota.cap)) * 100)}%` }} /></span>
                <span className="ct">{quota.current} / {quota.cap}</span>
              </div>
            ))}
            <div className="stock-note">月库存上限 {stockEff} · 已出 {data.quotaMonthlyStockUsed} 台 · 剩余 {data.quotaMonthlyStockRemaining} 台</div>
          </div>
          <div className="kv-row"><span className="k">Pro 解锁门槛</span><span className="v dim">{proEff}</span></div>
          <div className="kv-row"><span className="k">Rack 解锁门槛</span><span className="v dim">{rackEff}</span></div>
          <div className="kv-row"><span className="k">月库存上限</span><span className="v">{stockEff}</span></div>
          <div className="sect-foot">
            <button onClick={() => ctx.openActionConfirm({ name: "Pro 解锁门槛调整", op: "param", paramKey: "F.quota.proUnlock", edit: { kind: "text", current: proEff }, detail: `Pro 销售前置门 · 当前 ${proEff}` })}>Pro 门槛</button>
            <button onClick={() => ctx.openActionConfirm({ name: "Rack 解锁门槛调整", op: "param", paramKey: "F.quota.rackUnlock", edit: { kind: "text", current: rackEff }, detail: `Rack 销售前置门 · 当前 ${rackEff}` })}>Rack 门槛</button>
            <button onClick={() => ctx.openActionConfirm({ name: "月库存上限调整", op: "param", paramKey: "F.quota.monthlyStock", edit: { kind: "number", current: stockEff, unit: "台" }, detail: `月度硬件供给上限 · 当前 ${stockEff}` })}>月库存</button>
          </div>
        </section>

        <section className="sect">
          <div className="sect-h">
            <span className="ic amb"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17" cy="9" r="2.2" /><path d="M21 20c0-2.6-1.8-4.8-4.2-5.4" /></svg></span>
            <div className="t"><div className="nm">区域大使确认</div><div className="s">V5+ · 4 类预算 · 待确认 {data.ambassadorPendingCount} 单</div></div>
            <span className="tag">F4c · F.ambassador.*</span>
          </div>
          <div className="amb-bands">
            {data.ambassadorBands.map((band) => (<div key={band.name} className="amb-band"><div className="nm">{band.name}</div><div className="ct">{band.count}<small>件</small></div></div>))}
          </div>
          <div className="kv-row"><span className="k">本月已批准预算</span><span className="v ok">{data.ambassadorBudgetApprovedLabel} / {data.ambassadorBudgetCapLabel}</span></div>
          <div className="kv-row"><span className="k">KOL 预算占比</span><span className="v">{data.ambassadorKolBudgetPct}%</span></div>
          <div className="kv-row"><span className="k">下季度配额评估</span><span className="v dim">{data.ambassadorNextQuotaReviewDate}</span></div>
          <div className="sect-foot">
            <button className="primary amp" disabled={ambLocked} onClick={() => ctx.openActionConfirm({ name: "区域大使申请确认通过", amplify: true, op: "dispose", paramKey: "F.ambassador.q3-2025.status", fixedVal: "approved", status: "approved", detail: "批准大使申请 · 开通 4 类预算额度与权益 · 写 A2 审计 · 资金流出受 B1 约束。" })}>确认通过</button>
            <button className="danger" disabled={ambLocked} onClick={() => ctx.openActionConfirm({ name: "区域大使申请驳回", op: "dispose", paramKey: "F.ambassador.q3-2025.status", fixedVal: "rejected", status: "rejected", detail: "驳回大使申请 · 不开通预算 · 写 A2 审计。" })}>驳回</button>
          </div>
        </section>

        <section className="sect">
          <div className="sect-h">
            <span className="ic lb"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16" /><rect x="5" y="11" width="3.5" height="7" /><rect x="10.2" y="7" width="3.5" height="11" /><rect x="15.4" y="13" width="3.5" height="5" /></svg></span>
            <div className="t"><div className="nm">排行榜 · 反欺诈</div><div className="s">4 周期奖池 · Podium · K2 联动</div></div>
            <span className="tag">F4d · F.leaderboard.*</span>
          </div>
          <div className="podium">
            {data.podium.map((row) => (
              <div key={row.userId} className={`pod ${row.className}`}><span className="rank">{row.rank}</span><div className="uid">{row.userId}</div><div className="gv">{row.gmvLabel}<small>{row.tip}</small></div></div>
            ))}
          </div>
          <div className="kv-row"><span className="k">本期奖池</span><span className="v">{lbPool}</span></div>
          <div className="kv-row"><span className="k">参赛人数</span><span className="v">{data.leaderboardParticipantCount.toLocaleString("en-US")}</span></div>
          <div className="kv-row"><span className="k">刷榜命中 · K2</span><span className="v" style={{ color: "var(--danger)" }}>{lbDq ? "已处置" : `${data.leaderboardFraudHitCount} 账户`}</span></div>
          <div className="sect-foot">
            <button className="primary amp" onClick={() => ctx.openActionConfirm({ name: "本期榜单奖池调整", amplify: true, op: "param", paramKey: "F.leaderboard.poolUsd", edit: { kind: "text", current: lbPool }, detail: `本期榜单奖池总额 · 当前 ${lbPool} · 放大奖池流出,受 B1 约束。` })}>调整奖池</button>
            <button className="danger" disabled={lbDq} onClick={() => ctx.openActionConfirm({ name: "排行榜取消资格(反欺诈)", op: "dispose", paramKey: "F.leaderboard.period.status", fixedVal: "disqualified", status: "disqualified", detail: "对刷榜账户取消本期资格 · 剔除其榜单名次与奖池分配 · 写 A2 审计。" })}>取消资格 · 反欺诈</button>
          </div>
        </section>
      </div>

      <section className="sect votes-card">
        <div className="sect-h">
          <span className="ic pool"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3-7 4 14 3-7h4" /></svg></span>
          <div className="t"><div className="nm">V 级票数权重 · 领导池分配依据</div><div className="s">后端配置权重 · 顶部 {data.topN} 名领袖 ≈{data.topSharePct}%</div></div>
          <span className="tag">F.pool.votes.*</span>
        </div>
        <div className="votes-grid">
          {data.voteWeights.map((row, index) => (
            <div key={row.v} className="vote-col"><span className="v">{row.votes}</span><span className={`b ${voteTier(index)}`} style={{ height: voteH(row.votes, maxVote) }} /><span className="l">{row.v}</span></div>
          ))}
        </div>
        <div className="vote-table">
          {data.voteWeights.map((row) => {
            const paramKey = row.configKey || `F.pool.votes.${row.v}`;
            return (
              <div key={row.v} className="vote-cell" onClick={() => ctx.openActionConfirm({ name: `领导池 ${row.v} 票数权重调整`, amplify: true, op: "param", paramKey, edit: { kind: "number", current: String(row.votes), unit: "票" }, detail: `${row.v} 当前 ${row.votes} 票 · 改变领导池分配权重 · 调高放大头部虹吸 · 受 B1 覆盖率约束。` })}>
                <div className="vlb">{row.v} 权重</div><div className="vct">{row.votes} 票</div>
              </div>
            );
          })}
        </div>
        <div className="f4-warn"><b>权重一动则虹吸放大</b> · 调高高 V 级权重会进一步放大头部分润,顶部 {data.topN} 名占比将从 ≈{data.topSharePct}% 进一步上抬。<b>每一项调整均视为「放大资金流出」</b>,须先核验 B1 兑付覆盖率(§1.8)。</div>
      </section>

      <p className="f-foot">4 个子模块共用一条 server 评估总线:<b>{data.settlementWindow} 快照 → {data.settlementDispatchWindow}</b> 派发时,server 依据 V_VOTES、配额库存、大使预算、榜单结果一次性派发。运营侧调参均经 操作确认;放大流出项前置 B1 覆盖率核验。</p>
    </>
  );
}
