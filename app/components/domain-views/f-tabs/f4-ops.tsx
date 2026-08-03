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

function presentText(value: string, fallback = "未配置") {
  return value.trim() ? value : fallback;
}

// 领导奖池参与门槛枚举(V0 为新人,无奖池资格 → 从 V1 起)。
const POOL_UNLOCK_OPTIONS = ["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V10", "V11", "V12"];

export function F4Ops({ ctx }: { ctx: FViewCtx }) {
  const data = ctx.f4Overview;
  const canWrite = ctx.can("network_f4_write");
  const canFund = ctx.can("network_f4_pool_fund");
  const canApproveAmbassador = ctx.can("network_f4_ambassador_approve");
  const canControlLeaderboard = ctx.can("network_f4_leaderboard_control");

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

  const ratioEff = presentText(data.poolRatio);
  const capEff = presentText(data.monthlyCapLabel);
  const proEff = presentText(data.proUnlock);
  const rackEff = presentText(data.rackUnlock);
  const stockEff = presentText(data.quotaMonthlyStockLabel);
  const lbPool = presentText(data.leaderboardPoolLabel);
  const settlementEff = data.settlementWindow && data.settlementDispatchWindow
    ? `${data.settlementWindow} 快照 → ${data.settlementDispatchWindow} 派发`
    : "结算窗口未配置";
  const topLabel = data.topN > 0 ? `顶部 ${data.topN} 名占比(派生)` : "顶部占比(派生)";
  const topShareLabel = data.topSharePct > 0 ? `≈ ${data.topSharePct}%` : "暂无样本";
  const unlockLabel = data.unlockRank > 0 ? `V${data.unlockRank}+` : "未配置";
  const ambassadorBudgetLabel = data.ambassadorBudgetApprovedLabel || data.ambassadorBudgetCapLabel
    ? `${presentText(data.ambassadorBudgetApprovedLabel)} / ${presentText(data.ambassadorBudgetCapLabel)}`
    : "暂无预算数据";
  const nextQuotaReviewDate = presentText(data.ambassadorNextQuotaReviewDate);
  const voteSummary = data.topN > 0 && data.topSharePct > 0
    ? `顶部 ${data.topN} 名领袖 ≈${data.topSharePct}%`
    : "暂无头部占比样本";
  const lbDq = data.leaderboardDisqualified;
  const maxVote = Math.max(1, ...data.voteWeights.map((row) => row.votes));
  const monthPoolUsd = Math.round(data.weeklyInjectedUsd * 4.33);
  const ambLocked = statusResolved(data.ambassadorStatus);
  const settleCron = data.configValues["F.pool.settleCron"] ?? "0 23 * * 0";
  const unlockVRank = data.configValues["F.pool.unlockVRank"] ?? "V3";
  const lbMinUsd = data.configValues["F.leaderboard.minUsd"] ?? "1";
  const lbPaused = (data.configValues["F.leaderboard.paused"] ?? "off") === "on";
  const top1MaxPct = data.configValues["F.pool.top1MaxPct"] ?? "25";
  const top5MaxPct = data.configValues["F.pool.top5MaxPct"] ?? "60";
  // 4 周期榜单奖池(JSON today/week/month/allTime)回填解析 · 无记录用默认 5K/50K/250K/1M。
  const periodPrizeRaw = data.configValues["F.pool.periodPrize"] ?? "";
  let ppToday = "5000";
  let ppWeek = "50000";
  let ppMonth = "250000";
  let ppAllTime = "1000000";
  if (periodPrizeRaw) {
    try {
      const parsed = JSON.parse(periodPrizeRaw);
      if (typeof parsed.today === "number") ppToday = String(parsed.today);
      if (typeof parsed.week === "number") ppWeek = String(parsed.week);
      if (typeof parsed.month === "number") ppMonth = String(parsed.month);
      if (typeof parsed.allTime === "number") ppAllTime = String(parsed.allTime);
    } catch { /* schema 异常用默认,提交时后端 validatePeriodPrize 兜底 */ }
  }

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
            <div className="t"><div className="nm">领导奖池</div><div className="s">{data.poolRatio ? `${ratioEff} 周 GMV / V_VOTES 加权分配` : "奖池比例未配置"}</div></div>
            <span className="tag">F4 · F.pool.*</span>
          </div>
          <div className="pool-hero">
            <div><div className="lbl">本周池{data.poolRatio ? `(周 GMV × ${ratioEff})` : ""}</div><div className="v">{usd(data.weeklyInjectedUsd)}</div></div>
            <div className="meta">{settlementEff}<br />参与 {unlockLabel} 领袖 <b>{data.participantCount}</b></div>
          </div>
          <div className="kv-row"><span className="k">奖池比例(周 GMV)</span><span className="v brand">{ratioEff}</span></div>
          <div className="kv-row"><span className="k">月度预留上限(cap)</span><span className="v">{capEff}</span></div>
          <div className="kv-row"><span className="k">{topLabel}</span><span className="v warn">{topShareLabel}</span></div>
          <div className="kv-row"><span className="k">分配口径</span><span className="v dim">按 V_VOTES 权重</span></div>
          <div className="sect-foot">
            {canFund && <button className="primary amp" onClick={() => ctx.openActionConfirm({
              name: "提前结算本周领导奖池",
              amplify: true,
              detail: "按服务端当前周已支付 GMV、F.pool.ratio、月度 cap、解锁等级与 V_VOTES 生成 F5 佣金事件和 D4 台账。资金动作先提交 A2 审批；同周 CAS 防止重复派发。",
              run: async (reason) => {
                await ctx.proposeF4Settlement(reason);
              },
            })}>提前结算本周池</button>}
            {canFund && <button className="primary amp" onClick={() => ctx.openActionConfirm({ name: "领导池比例调整(周 GMV)", amplify: true, op: "param", paramKey: "F.pool.ratio", edit: { kind: "text", current: data.poolRatio, unit: "%" }, detail: `每周 GMV 注入领导池的比例 · 当前 ${ratioEff} · 放大池子流出,受 B1 约束。` })}>调整池比例</button>}
            {canWrite && <button onClick={() => ctx.openActionConfirm({ name: "领导池月度 cap 调整", op: "param", paramKey: "F.pool.monthlyCap", edit: { kind: "text", current: data.monthlyCapLabel }, detail: `领导池月度预留护栏 · 当前 ${capEff} · 当前月池约 ${usdM(monthPoolUsd)}。` })}>调整月度 cap</button>}
            {canWrite && <button onClick={() => ctx.openActionConfirm({ name: "池结算周期调整", op: "param", paramKey: "F.pool.settleCron", edit: { kind: "text", current: settleCron, unit: "cron 表达式" }, detail: `领导奖池自动结算的 cron 周期 · 当前 ${settleCron} · 改后对下一周期派发生效。` })}>结算周期</button>}
            {canWrite && <button onClick={() => ctx.openActionConfirm({ name: "池解锁等级调整", op: "param", paramKey: "F.pool.unlockVRank", edit: { kind: "select", current: unlockVRank, options: POOL_UNLOCK_OPTIONS }, detail: `领导奖池参与门槛 · 当前 ${unlockVRank}+ · 调高收紧参与人数,调低放大分润人数。` })}>解锁等级</button>}
            {canFund && <button onClick={() => ctx.openActionConfirm({ name: "头部集中度·Top1 上限调整", amplify: true, op: "param", paramKey: "F.pool.top1MaxPct", edit: { kind: "number", current: top1MaxPct, unit: "%" }, detail: `领导池 Top1 头部集中度上限 · 当前 ${top1MaxPct}% · 范围 0-100 · 调低抑制头部虹吸,受 B1 约束。` })}>Top1 集中度</button>}
            {canFund && <button onClick={() => ctx.openActionConfirm({ name: "头部集中度·Top5 上限调整", amplify: true, op: "param", paramKey: "F.pool.top5MaxPct", edit: { kind: "number", current: top5MaxPct, unit: "%" }, detail: `领导池 Top5 头部集中度上限 · 当前 ${top5MaxPct}% · 范围 0-100 · 调低抑制头部虹吸,受 B1 约束。` })}>Top5 集中度</button>}
          </div>
        </section>

        <section className="sect">
          <div className="sect-h">
            <span className="ic quota"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4.5v9L12 20l-8-4.5v-9z" /><path d="M12 11l8-4.5M12 11v9M12 11L4 6.5" /></svg></span>
            <div className="t"><div className="nm">硬件配额</div><div className="s">销售前置门 · 月度库存上限</div></div>
            <span className="tag">F4b · F.quota.*</span>
          </div>
          <div style={{ marginBottom: 12 }}>
            {data.quotaRows.length ? data.quotaRows.map((quota) => (
              <div key={quota.name} className="stock-meter">
                <span className="nm">{quota.name}</span>
                <span className={`bar${quota.tight ? " tight" : ""}`}><span className="f" style={{ width: `${Math.min(100, (quota.current / Math.max(1, quota.cap)) * 100)}%` }} /></span>
                <span className="ct">{quota.current} / {quota.cap}</span>
              </div>
            )) : <div className="empty">暂无硬件配额样本</div>}
            <div className="stock-note">月库存上限 {stockEff} · 已出 {data.quotaMonthlyStockUsed} 台 · 剩余 {data.quotaMonthlyStockRemaining} 台</div>
          </div>
          <div className="kv-row"><span className="k">Pro 解锁门槛</span><span className="v dim">{proEff}</span></div>
          <div className="kv-row"><span className="k">Rack 解锁门槛</span><span className="v dim">{rackEff}</span></div>
          <div className="kv-row"><span className="k">月库存上限</span><span className="v">{stockEff}</span></div>
          {canWrite && <div className="sect-foot">
            <button onClick={() => ctx.openActionConfirm({ name: "Pro 解锁门槛调整", op: "param", paramKey: "F.quota.proUnlock", edit: { kind: "text", current: data.proUnlock }, detail: `Pro 销售前置门 · 当前 ${proEff}` })}>Pro 门槛</button>
            <button onClick={() => ctx.openActionConfirm({ name: "Rack 解锁门槛调整", op: "param", paramKey: "F.quota.rackUnlock", edit: { kind: "text", current: data.rackUnlock }, detail: `Rack 销售前置门 · 当前 ${rackEff}` })}>Rack 门槛</button>
            <button onClick={() => ctx.openActionConfirm({ name: "月库存上限调整", op: "param", paramKey: "F.quota.monthlyStock", edit: { kind: "number", current: data.quotaMonthlyStockLabel, unit: "台" }, detail: `月度硬件供给上限 · 当前 ${stockEff}` })}>月库存</button>
          </div>}
        </section>

        <section className="sect">
          <div className="sect-h">
            <span className="ic amb"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17" cy="9" r="2.2" /><path d="M21 20c0-2.6-1.8-4.8-4.2-5.4" /></svg></span>
            <div className="t"><div className="nm">区域大使确认</div><div className="s">V5+ · 4 类预算 · 待确认 {data.ambassadorPendingCount} 单</div></div>
            <span className="tag">F4c · F.ambassador.*</span>
          </div>
          <div className="amb-bands">
            {data.ambassadorBands.length ? data.ambassadorBands.map((band) => (<div key={band.name} className="amb-band"><div className="nm">{band.name}</div><div className="ct">{band.count}<small>件</small></div></div>)) : <div className="empty">暂无大使申请样本</div>}
          </div>
          <div className="kv-row"><span className="k">本月已批准预算</span><span className="v ok">{ambassadorBudgetLabel}</span></div>
          <div className="kv-row"><span className="k">KOL 预算占比</span><span className="v">{data.ambassadorKolBudgetPct}%</span></div>
          <div className="kv-row"><span className="k">下季度配额评估</span><span className="v dim">{nextQuotaReviewDate}</span></div>
          {canApproveAmbassador && <div className="sect-foot">
            <button className="primary amp" disabled={ambLocked} onClick={() => ctx.openActionConfirm({ name: "区域大使申请确认通过", amplify: true, op: "dispose", paramKey: "F.ambassador.q3-2025.status", fixedVal: "approved", status: "approved", detail: "批准大使申请 · 开通 4 类预算额度与权益 · 写 A2 审计 · 资金流出受 B1 约束。" })}>确认通过</button>
            <button className="danger" disabled={ambLocked} onClick={() => ctx.openActionConfirm({ name: "区域大使申请驳回", op: "dispose", paramKey: "F.ambassador.q3-2025.status", fixedVal: "rejected", status: "rejected", detail: "驳回大使申请 · 不开通预算 · 写 A2 审计。" })}>驳回</button>
          </div>}
        </section>

        <section className="sect">
          <div className="sect-h">
            <span className="ic lb"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16" /><rect x="5" y="11" width="3.5" height="7" /><rect x="10.2" y="7" width="3.5" height="11" /><rect x="15.4" y="13" width="3.5" height="5" /></svg></span>
            <div className="t"><div className="nm">排行榜 · 反欺诈</div><div className="s">4 周期奖池 · Podium · K2 联动</div></div>
            <span className="tag">F4d · F.leaderboard.*</span>
          </div>
          <div className="podium">
            {data.podium.length ? data.podium.map((row) => (
              <div key={row.userId} className={`pod ${row.className}`}><span className="rank">{row.rank}</span><div className="uid">{row.userId}</div><div className="gv">{row.gmvLabel}<small>{row.tip}</small></div></div>
            )) : <div className="empty">暂无榜单样本</div>}
          </div>
          <div className="kv-row"><span className="k">本期奖池</span><span className="v">{lbPool}</span></div>
          <div className="kv-row"><span className="k">参赛人数</span><span className="v">{data.leaderboardParticipantCount.toLocaleString("en-US")}</span></div>
          <div className="kv-row"><span className="k">刷榜命中 · K2</span><span className="v" style={{ color: "var(--danger)" }}>{`${data.leaderboardFraudHitCount} 账户${lbDq ? " · 含已处置" : ""}`}</span></div>
          <div className="sect-foot">
            {canFund && <button className="primary amp" onClick={() => ctx.openActionConfirm({ name: "本期榜单奖池调整", amplify: true, op: "param", paramKey: "F.leaderboard.poolUsd", edit: { kind: "text", current: data.leaderboardPoolLabel }, detail: `本期榜单奖池总额 · 当前 ${lbPool} · 放大奖池流出,受 B1 约束。` })}>调整奖池</button>}
            {canWrite && <button onClick={() => ctx.openActionConfirm({ name: "榜单最小额调整", op: "param", paramKey: "F.leaderboard.minUsd", edit: { kind: "number", current: lbMinUsd, unit: "USD" }, detail: `上榜最低佣金门槛 · 当前 $${lbMinUsd} · 低于此额不计入榜单排名。` })}>榜单最小额</button>}
            {canControlLeaderboard && <button className={lbPaused ? "primary" : "danger"} onClick={() => ctx.openActionConfirm({ name: lbPaused ? "恢复排行榜派发" : "暂停排行榜派发", op: "dispose", paramKey: "F.leaderboard.paused", fixedVal: lbPaused ? "off" : "on", detail: lbPaused ? "恢复排行榜 · 下期起正常结算榜单奖池与名次,写 A2 审计。" : "暂停排行榜 · 本期榜单冻结,不派发奖池,已计名次保留,写 A2 审计。" })}>{lbPaused ? "恢复榜单" : "暂停榜单"}</button>}
            {canFund && <button className="primary amp" onClick={() => ctx.openActionConfirm({
              name: "4 周期榜单奖池调整", amplify: true,
              businessForm: {
                kind: "multi-field",
                title: "4 周期榜单奖池(USD)",
                hint: "today/week/month/allTime 四周期榜单奖池 · 各须为非负数字 · 放大池子流出受 B1 约束。",
                fields: [
                  { key: "today", label: "日榜奖池(USD)", current: ppToday, inputKind: "number", min: 0 },
                  { key: "week", label: "周榜奖池(USD)", current: ppWeek, inputKind: "number", min: 0 },
                  { key: "month", label: "月榜奖池(USD)", current: ppMonth, inputKind: "number", min: 0 },
                  { key: "allTime", label: "总榜奖池(USD)", current: ppAllTime, inputKind: "number", min: 0 },
                ],
              },
              detail: `4 周期榜单奖池 · 当前 日${ppToday}/周${ppWeek}/月${ppMonth}/总${ppAllTime} · 放大池子流出,受 B1 覆盖率约束。`,
              run: async (reason, bv) => {
                if (!bv) throw new Error("请填写全部 4 个周期");
                const today = Number(bv.today);
                const week = Number(bv.week);
                const month = Number(bv.month);
                const allTime = Number(bv.allTime);
                if (![today, week, month, allTime].every(Number.isFinite) || [today, week, month, allTime].some((n) => n < 0)) {
                  throw new Error("四个周期奖池均须为非负数字");
                }
                await ctx.updateF4Config("F.pool.periodPrize", JSON.stringify({ today, week, month, allTime }), reason);
                ctx.toast(`4 周期榜单奖池已确认生效 · 日${today}/周${week}/月${month}/总${allTime}`);
              },
            })}>4 周期奖池</button>}
            {canControlLeaderboard && <button className="danger" disabled={lbDq} onClick={() => ctx.openActionConfirm({ name: "排行榜取消资格(反欺诈)", op: "dispose", paramKey: "F.leaderboard.period.status", fixedVal: "disqualified", status: "disqualified", detail: "对刷榜账户取消本期资格 · 剔除其榜单名次与奖池分配 · 写 A2 审计。" })}>取消资格 · 反欺诈</button>}
          </div>
        </section>
      </div>

      <section className="sect votes-card">
        <div className="sect-h">
          <span className="ic pool"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3-7 4 14 3-7h4" /></svg></span>
          <div className="t"><div className="nm">V 级票数权重 · 领导池分配依据</div><div className="s">后端配置权重 · {voteSummary}</div></div>
          <span className="tag">F.pool.votes.*</span>
        </div>
        <div className="votes-grid">
          {data.voteWeights.length ? data.voteWeights.map((row, index) => (
            <div key={row.v} className="vote-col"><span className="v">{row.votes}</span><span className={`b ${voteTier(index)}`} style={{ height: voteH(row.votes, maxVote) }} /><span className="l">{row.v}</span></div>
          )) : <div className="empty">暂无票数权重配置</div>}
        </div>
        <div className="vote-table">
          {data.voteWeights.map((row) => {
            const paramKey = row.configKey || `F.pool.votes.${row.v}`;
            return (
              <div key={row.v} className="vote-cell" onClick={canFund ? () => ctx.openActionConfirm({ name: `领导池 ${row.v} 票数权重调整`, amplify: true, op: "param", paramKey, edit: { kind: "number", current: String(row.votes), unit: "票" }, detail: `${row.v} 当前 ${row.votes} 票 · 改变领导池分配权重 · 调高放大头部虹吸 · 受 B1 覆盖率约束。` }) : undefined}>
                <div className="vlb">{row.v} 权重</div><div className="vct">{row.votes} 票</div>
              </div>
            );
          })}
        </div>
        <div className="f4-warn"><b>权重一动则虹吸放大</b> · 调高高 V 级权重会进一步放大头部分润,{voteSummary}。<b>每一项调整均视为「放大资金流出」</b>,须先核验 B1 兑付覆盖率(§1.8)。</div>
      </section>

      <p className="f-foot">领导奖池闭环:<b>{settlementEff}</b> 时按真实已支付订单 GMV、月度 cap、解锁等级和 V_VOTES 结算；提前结算先进入 A2，成功后同步写 F5 佣金事件、D4 台账与 A4 commission.paid。同周 CAS 防重复；补发、冲正、冻结在 F5 按佣金事件处置。配额、大使、排行榜各自按其配置和状态独立生效，放大流出项前置 B1 覆盖率核验。</p>
    </>
  );
}
