"use client";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { operatorNicknameText } from "@/lib/admin/brand-copy";

/** F4 · 池/配额/大使/榜 —— 数据源为后端 /api/admin/teams/leadership-pool。 */
import { useState } from "react";
import { formatF4AmbassadorBucketRule, formatF4AmbassadorBucketTitle } from "@/lib/admin/f4-ambassador-display";
import type { FViewCtx } from "./types";
import { validateF4SettlementConfig } from "@/lib/admin/f4-settlement-config";
import { formatBusinessTime } from "@/lib/admin/business-time";
import { nexGridBrandText } from "@/lib/admin/brand-copy";

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

function quotaPrerequisites(row: { directRefs: number; monthComputePointsText: string | null; unlockMode: "ALL" | "EITHER"; criteriaKnown: boolean }) {
  if (!row.criteriaKnown || row.monthComputePointsText === null) return "资格条件暂时无法显示";
  const parts: string[] = [];
  if (row.directRefs > 0) parts.push(`有效直接邀请 ≥ ${row.directRefs}`);
  if (/[1-9]/.test(row.monthComputePointsText)) {
    const points = row.monthComputePointsText.split(".")[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    parts.push(`本月团队算力点 ≥ ${points}`);
  }
  if (!parts.length) return "无额外条件";
  return parts.join(row.unlockMode === "EITHER" ? " 或 " : " 且 ");
}

// 领导奖池参与门槛枚举(V0 为新人,无奖池资格 → 从 V1 起)。
const POOL_UNLOCK_OPTIONS = ["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8"];

export function F4Ops({ ctx }: { ctx: FViewCtx }) {
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<"today" | "week" | "month" | "all">("week");
  const data = ctx.f4Overview;
  const canWrite = ctx.can("network_f4_write");
  const canFund = ctx.can("network_f4_pool_fund");
  const canApproveAmbassador = ctx.can("network_f4_ambassador_approve");
  const canControlLeaderboard = ctx.can("network_f4_leaderboard_control");
  const ambassadorPolicy = ctx.f4AmbassadorPolicy;

  if (ctx.f4Loading && !data) {
    return <section className="sect"><div className="empty">领导奖池数据加载中…</div></section>;
  }

  if (ctx.f4Error && !data) {
    return (
      <section className="sect">
        <div className="empty">领导奖池数据加载失败 · {ctx.f4Error}</div>
        <div className="sect-foot"><button onClick={() => void ctx.refreshF4()}>重新加载</button></div>
      </section>
    );
  }

  if (!data) {
    return <section className="sect"><div className="empty">暂无领导奖池数据</div></section>;
  }

  const proEff = presentText(data.proUnlock);
  const rackEff = presentText(data.rackUnlock);
  const stockEff = presentText(data.quotaMonthlyStockLabel);
  const periodLeaderboard = data.leaderboardPeriods?.[leaderboardPeriod];
  const lbPool = periodLeaderboard ? `$${periodLeaderboard.poolUsd.toLocaleString("en-US", { maximumFractionDigits: 6 })}` : "—";
  const nextSettlement = data.settlementConfigStatus === "READY"
    ? formatBusinessTime(data.nextSettlementAt, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }, "")
    : "";
  const settlementEff = nextSettlement ? `下次计划结算：${nextSettlement}` : "自动结算时间未知";
  const topLabel = data.topN > 0 ? `前 ${data.topN} 名占比（估算）` : "头部占比（估算）";
  const topShareLabel = data.topSharePct > 0 ? `≈ ${data.topSharePct}%` : "暂无数据";
  const ambassadorBudgetLabel = data.ambassadorBudgetApprovedLabel || data.ambassadorBudgetCapLabel
    ? `${presentText(data.ambassadorBudgetApprovedLabel)} / ${presentText(data.ambassadorBudgetCapLabel)}`
    : "暂无预算数据";
  const nextQuotaReviewDate = presentText(data.ambassadorNextQuotaReviewDate);
  const voteSummary = data.topN > 0 && data.topSharePct > 0
    ? `前 ${data.topN} 名领袖 ≈${data.topSharePct}%`
    : "暂无头部占比数据";
  const lbDq = data.leaderboardDisqualified;
  const maxVote = Math.max(1, ...data.voteWeights.map((row) => row.votes));
  const monthPoolUsd = data.currentWeekPoolUsd === null ? null : Math.round(data.currentWeekPoolUsd * 4.33);
  const settleCron = data.configValues["F.pool.settleCron"] ?? "";
  const unlockVRank = data.configValues["F.pool.unlockVRank"] ?? "";
  const settlementConfig = validateF4SettlementConfig({
    status: data.settlementConfigStatus,
    unavailableKey: data.settlementConfigUnavailableKey,
    configVersion: data.configVersion,
    ratio: data.configValues["F.pool.ratio"],
    monthlyCap: data.configValues["F.pool.monthlyCap"],
    unlockVRank,
    settleCron,
  });
  const invalidSettlementKeys = new Set(settlementConfig.issues.map((issue) => issue.key));
  const invalidConfigLabel = "未设置或格式有误";
  const ratioEff = invalidSettlementKeys.has("ratio") ? invalidConfigLabel : presentText(data.poolRatio);
  const capEff = invalidSettlementKeys.has("monthlyCap") ? invalidConfigLabel : presentText(data.monthlyCapLabel);
  const unlockLabel = invalidSettlementKeys.has("unlockVRank")
    ? invalidConfigLabel
    : data.unlockRank > 0 ? `V${data.unlockRank}+` : "未配置";
  const settleCronEff = invalidSettlementKeys.has("settleCron") ? invalidConfigLabel : settleCron;
  const unlockVRankEff = invalidSettlementKeys.has("unlockVRank") ? invalidConfigLabel : unlockVRank;
  const configVersionEff = invalidSettlementKeys.has("configVersion") ? invalidConfigLabel : data.configVersion;
  const settlementOperable = settlementConfig.ready && !ctx.f4Loading && !ctx.f4Error;
  const settlementBlockedCopy = ctx.f4Loading
    ? "正在刷新设置，完成前暂不能提前结算。"
    : ctx.f4Error
      ? "设置刷新失败，为避免按旧设置结算，提前结算已暂停。请点「刷新设置」重试。"
      : `领导奖池设置不完整：${settlementConfig.issues.map((issue) => issue.label).join("、")} 未设置或格式有误。请在本卡片下方补齐后刷新设置。`;
  const lbMinUsd = data.configValues["F.leaderboard.minUsd"] ?? "1";
  const lbPaused = data.leaderboardPaused ?? (data.configValues["F.leaderboard.paused"] ?? "off") === "on";
  const lbDataAvailable = !!periodLeaderboard && (!lbPaused || (data.leaderboardSnapshotState === "FROZEN" && data.leaderboardDataAvailable === true));
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
          <div className="empty">领导奖池数据刷新失败 · {ctx.f4Error}</div>
          <div className="sect-foot"><button onClick={() => void ctx.refreshF4()}>重新加载</button></div>
        </section>
      )}

      <div className="f-stats">
        {data.metrics.map((metric) => (
          <div key={metric.id} className={`f-stat ${statTone(metric.tone)}`}>
            <div className="k">{operatorCopyText(metric.name)}</div>
            <div className="v">{operatorCopyText(metric.value)}</div>
            <div className="sub">{operatorCopyText(metric.sub)}</div>
          </div>
        ))}
      </div>

      <div className="f4-grid">
        <section className="sect">
          <div className="sect-h">
            <span className="ic pool"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6" /><path d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" /></svg></span>
            <div className="t"><div className="nm">领导奖池</div><div className="s">{data.poolRatio ? `每周已付款成交额的 ${ratioEff}，按会员等级票数分配` : "奖池比例未配置"}</div></div>
          </div>
          <div className="pool-hero">
            <div><div className="lbl">本周奖池 · 已结算按实发；未结算按本周已付款成交额 × 比例估算，不超过本月剩余额度</div><div className="v">{data.currentWeekPoolUsd === null ? "暂无法计算" : usd(data.currentWeekPoolUsd)}</div></div>
            <div className="meta">{settlementEff}<br />参与 {unlockLabel} 领袖 <b>{data.participantCount}</b></div>
          </div>
          {!settlementOperable && <div className="f4-warn" role="alert">
            <b>提前结算已暂停</b> · {settlementBlockedCopy}
            <button disabled={ctx.f4Loading} onClick={() => void ctx.refreshF4()}>刷新设置</button>
          </div>}
          <div className="kv-row"><span className="k">奖池比例（占每周成交额）</span><span className="v brand">{ratioEff}</span></div>
          <div className="kv-row"><span className="k">每月上限</span><span className="v">{capEff}</span></div>
          <div className="kv-row"><span className="k">设置版本</span><span className="v dim">{configVersionEff}</span></div>
          <div className="kv-row"><span className="k">{topLabel}</span><span className="v warn">{topShareLabel}</span></div>
          <div className="kv-row"><span className="k">分配方式</span><span className="v dim">按会员等级票数</span></div>
          <div className="sect-foot">
            {canFund && <button className="primary amp" disabled={!settlementOperable} title={!settlementOperable ? settlementBlockedCopy : undefined} onClick={() => ctx.openActionConfirm({
              name: "提前结算本周领导奖池",
              amplify: true,
              detail: "按本周已付款成交额、奖池比例、每月上限、参与等级和会员等级票数计算并发放。需要审批；同一周不会重复发放。",
              run: async (reason) => {
                await ctx.proposeF4Settlement(reason);
              },
            })}>提前结算本周池</button>}
            {canFund && <button className="primary amp" onClick={() => ctx.openActionConfirm({ name: "调整领导奖池比例", amplify: true, op: "param", paramKey: "F.pool.ratio", edit: { kind: "text", current: data.poolRatio, unit: "%" }, detail: `每周已付款成交额中放进领导奖池的比例 · 当前 ${ratioEff} · 调高会多发钱，先看兑付覆盖率。` })}>调整池比例</button>}
            {canWrite && <button onClick={() => ctx.openActionConfirm({ name: "调整领导奖池每月上限", op: "param", paramKey: "F.pool.monthlyCap", edit: { kind: "text", current: data.monthlyCapLabel }, detail: `领导奖池每月最多发多少 · 当前 ${capEff} · 按本周估算整月约 ${monthPoolUsd === null ? "暂无法计算" : usdM(monthPoolUsd)}。` })}>调整月度上限</button>}
            {canWrite && <button onClick={() => ctx.openActionConfirm({ name: "调整领导奖池结算时间", op: "param", paramKey: "F.pool.settleCron", edit: { kind: "text", current: settleCron, unit: "定时表达式" }, detail: `领导奖池自动结算时间 · 当前 ${settleCronEff} · 从下一期开始生效。` })}>结算时间</button>}
            {canWrite && <button onClick={() => ctx.openActionConfirm({ name: "调整领导奖池参与等级", op: "param", paramKey: "F.pool.unlockVRank", edit: { kind: "select", current: unlockVRank, options: POOL_UNLOCK_OPTIONS }, detail: `达到这个等级才能分领导奖池 · 当前 ${unlockVRankEff} · 调高参与人数变少，调低参与人数变多。` })}>参与等级</button>}
            {canFund && <button onClick={() => ctx.openActionConfirm({ name: "调整第 1 名最高占比", amplify: true, op: "param", paramKey: "F.pool.top1MaxPct", edit: { kind: "number", current: top1MaxPct, unit: "%" }, detail: `第 1 名最多能分到奖池的百分比 · 当前 ${top1MaxPct}% · 可设 0–100。调低可防止奖池集中在少数人手里。` })}>第 1 名占比</button>}
            {canFund && <button onClick={() => ctx.openActionConfirm({ name: "调整前 5 名最高占比", amplify: true, op: "param", paramKey: "F.pool.top5MaxPct", edit: { kind: "number", current: top5MaxPct, unit: "%" }, detail: `前 5 名合计最多能分到奖池的百分比 · 当前 ${top5MaxPct}% · 可设 0–100。调低可防止奖池集中在少数人手里。` })}>前 5 名占比</button>}
          </div>
        </section>

        <section className="sect">
          <div className="sect-h">
            <span className="ic quota"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4.5v9L12 20l-8-4.5v-9z" /><path d="M12 11l8-4.5M12 11v9M12 11L4 6.5" /></svg></span>
            <div className="t"><div className="nm">硬件配额</div><div className="s">购买资格门槛 · 每月库存上限</div></div>
          </div>
          <div style={{ marginBottom: 12 }}>
            {data.quotaRows.length ? data.quotaRows.map((quota) => (
              <div key={quota.name} className="stock-meter">
                <span className="nm">{nexGridBrandText(quota.name)}</span>
                <span className={`bar${quota.tight ? " tight" : ""}`}><span className="f" style={{ width: `${Math.min(100, (quota.current / Math.max(1, quota.cap)) * 100)}%` }} /></span>
                <span className="ct">{quota.current} / {quota.cap}</span>
                {canWrite && <button onClick={() => ctx.openActionConfirm({
                  name: `${nexGridBrandText(quota.name)} 月额度调整`, op: "param",
                  paramKey: `F.quota.tier.${quota.quotaCode || quota.id}.monthlyQuota`,
                  expectedVersion: quota.cap,
                  edit: { kind: "number", current: String(quota.cap), unit: "台" },
                  detail: `${quota.quotaCode || quota.id} · 已用 ${quota.current} / ${quota.cap}。如果别人刚改过，会提示你刷新后再改。`,
                })}>调额度</button>}
                <span className="ct" style={{ gridColumn: "1 / -1", whiteSpace: "normal", textAlign: "left", overflowWrap: "anywhere" }}>商品编号 {quota.productNo || quota.quotaCode} · {quotaPrerequisites(quota)}</span>
              </div>
            )) : <div className="empty">暂无硬件配额</div>}
            <div className="stock-note">月库存上限 {stockEff} · 已出 {data.quotaMonthlyStockUsed} 台 · 剩余 {data.quotaMonthlyStockRemaining} 台</div>
          </div>
          <div className="kv-row"><span className="k">专业设备购买门槛</span><span className="v dim">{proEff}</span></div>
          <div className="kv-row"><span className="k">机柜设备购买门槛</span><span className="v dim">{rackEff}</span></div>
          <div className="kv-row"><span className="k">月库存上限</span><span className="v">{stockEff}</span></div>
          {data.quotaUsages.length > 0 && <div style={{ marginTop: 12 }}>
            {data.quotaUsages.map((usage) => <div key={usage.id} className="kv-row">
              <span className="k">#{usage.id} · U{usage.userId} · {usage.productNo}</span>
              <span className="v">{usage.quantity} 台 · {usage.orderNo || "无订单号"}</span>
              {canWrite && <button className="danger" onClick={() => ctx.openActionConfirm({
                name: `回收配额 #${usage.id}`, op: "dispose",
                paramKey: `F.quota.usage.${usage.id}.status`, fixedVal: "recycled",
                detail: "只能回收已使用的配额，回收后配额马上恢复。重复回收不会重复生效。",
              })}>回收</button>}
            </div>)}
          </div>}
        </section>

        <section className="sect">
          <div className="sect-h">
            <span className="ic amb"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17" cy="9" r="2.2" /><path d="M21 20c0-2.6-1.8-4.8-4.2-5.4" /></svg></span>
            <div className="t"><div className="nm">区域大使确认</div><div className="s">V5 及以上可申请 · 4 类预算 · 待审核 {data.ambassadorPendingCount} 单</div></div>
          </div>
          <div className="amb-bands">
            {data.ambassadorApplications.length ? data.ambassadorApplications.map((application) => (
              <div key={application.id} className="amb-band">
                <div className="nm">#{application.id} · {operatorNicknameText(application.applicantName)} · {application.region}{application.city ? `/${application.city}` : ""}</div>
                <div className="ct">{application.currentRank} · ${application.requestedBudgetUsd.toLocaleString("en-US")} · {({PENDING:"待审核",APPROVED:"已通过",REJECTED:"已驳回",pending:"待审核",approved:"已通过",rejected:"已驳回"} as Record<string,string>)[application.status] ?? "状态未知"}</div>
                {canApproveAmbassador && application.status.toUpperCase() === "PENDING" && <>
                  <button className="primary amp" onClick={() => ctx.openActionConfirm({ name: `批准大使申请 #${application.id}`, amplify: true, op: "dispose", paramKey: `F.ambassador.${application.id}.status`, fixedVal: "approved", detail: "批准这一份申请，同时发放推广、活动、差旅、宣传四类预算。" })}>批准</button>
                  <button className="danger" onClick={() => ctx.openActionConfirm({ name: `驳回大使申请 #${application.id}`, op: "dispose", paramKey: `F.ambassador.${application.id}.status`, fixedVal: "rejected", detail: "驳回这一份申请。" })}>驳回</button>
                </>}
              </div>
            )) : <div className="empty">暂无大使申请</div>}
          </div>
          <div className="kv-row"><span className="k">本月已批准预算</span><span className="v ok">{ambassadorBudgetLabel}</span></div>
          <div className="kv-row"><span className="k">达人推广预算占比</span><span className="v">{data.ambassadorKolBudgetPct}%</span></div>
          <div className="kv-row"><span className="k">下季度配额评估</span><span className="v dim">{nextQuotaReviewDate}</span></div>
          {ambassadorPolicy && <>
            <div className="kv-row"><span className="k">申请规则版本</span><span className="v dim">{ambassadorPolicy.policyVersion} · 版本 {ambassadorPolicy.revision}</span></div>
            <div className="kv-row"><span className="k">默认申请预算</span><span className="v">${ambassadorPolicy.defaultBudgetUsdt.toLocaleString("en-US")}</span></div>
            <div className="amb-bands">
              {ambassadorPolicy.buckets.map((bucket) => <div key={bucket.id} className="amb-band">
                <div className="nm">{formatF4AmbassadorBucketTitle(bucket.id, bucket.title)} · {bucket.id}</div>
                <div className="ct">${bucket.minBudgetUsdt.toLocaleString("en-US")} - ${bucket.maxBudgetUsdt.toLocaleString("en-US")} · {bucket.range}</div>
                <div className="ct">{formatF4AmbassadorBucketRule(bucket.id, bucket.rule)}</div>
              </div>)}
            </div>
            {canFund && <div className="sect-foot"><button className="primary amp" onClick={() => ctx.openActionConfirm({
              name: "调整区域大使申请规则",
              amplify: true,
              businessForm: {
                kind: "multi-field",
                title: "区域大使申请规则",
                hint: `当前版本 ${ambassadorPolicy.revision}。提高预算前先看兑付覆盖率，低于红线时无法保存。`,
                fields: [
                  { key: "policyVersion", label: "规则版本", current: ambassadorPolicy.policyVersion, inputKind: "text" },
                  { key: "defaultBudgetUsdt", label: "默认预算(USDT)", current: String(ambassadorPolicy.defaultBudgetUsdt), inputKind: "number", min: 100 },
                  ...ambassadorPolicy.buckets.flatMap((bucket) => [
                    { key: `${bucket.id}.title`, label: `${formatF4AmbassadorBucketTitle(bucket.id, bucket.title)} 名称`, current: bucket.title, inputKind: "text" as const },
                    { key: `${bucket.id}.range`, label: `${formatF4AmbassadorBucketTitle(bucket.id, bucket.title)} 显示的金额范围`, current: bucket.range, inputKind: "text" as const },
                    { key: `${bucket.id}.rule`, label: `${formatF4AmbassadorBucketTitle(bucket.id, bucket.title)} 申请条件`, current: bucket.rule, inputKind: "text" as const },
                    { key: `${bucket.id}.min`, label: `${formatF4AmbassadorBucketTitle(bucket.id, bucket.title)} 最低预算`, current: String(bucket.minBudgetUsdt), inputKind: "number" as const, min: 100 },
                    { key: `${bucket.id}.max`, label: `${formatF4AmbassadorBucketTitle(bucket.id, bucket.title)} 最高预算`, current: String(bucket.maxBudgetUsdt), inputKind: "number" as const, min: 100 },
                  ]),
                ],
              },
              detail: "这里就是 App 上区域大使申请时实际使用的规则。",
              completionCopy: "保存后，用户下次打开或刷新申请页就会看到新规则。",
              run: async (reason, values) => {
                if (!values) throw new Error("请填写完整");
                const defaultBudgetUsdt = Number(values.defaultBudgetUsdt);
                const buckets = ambassadorPolicy.buckets.map((bucket) => ({
                  id: bucket.id,
                  title: String(values[`${bucket.id}.title`] ?? "").trim(),
                  range: String(values[`${bucket.id}.range`] ?? "").trim(),
                  rule: String(values[`${bucket.id}.rule`] ?? "").trim(),
                  minBudgetUsdt: Number(values[`${bucket.id}.min`]),
                  maxBudgetUsdt: Number(values[`${bucket.id}.max`]),
                }));
                if (!String(values.policyVersion ?? "").trim() || !Number.isFinite(defaultBudgetUsdt)
                  || buckets.some((bucket) => !bucket.title || !bucket.range || !bucket.rule
                    || !Number.isFinite(bucket.minBudgetUsdt) || !Number.isFinite(bucket.maxBudgetUsdt)
                    || bucket.minBudgetUsdt < 100 || bucket.maxBudgetUsdt < bucket.minBudgetUsdt || bucket.maxBudgetUsdt > 10_000)) {
                  throw new Error("有内容没填，或预算范围不对（最低不能高于最高）");
                }
                await ctx.updateF4AmbassadorPolicy({
                  policyVersion: String(values.policyVersion).trim(),
                  revision: ambassadorPolicy.revision,
                  defaultBudgetUsdt,
                  buckets,
                }, reason);
                ctx.toast("区域大使申请规则已更新");
              },
            })}>调整申请规则</button></div>}
          </>}
        </section>

        <section className="sect">
          <div className="sect-h">
            <span className="ic lb"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16" /><rect x="5" y="11" width="3.5" height="7" /><rect x="10.2" y="7" width="3.5" height="11" /><rect x="15.4" y="13" width="3.5" height="5" /></svg></span>
            <div className="t"><div className="nm">排行榜 · 反欺诈</div><div className="s">日 / 周 / 月 / 总榜奖池 · 展示前三名 · 刷榜账号会被拦截</div></div>
          </div>
          {lbPaused && <div className="f4-warn" role="status"><b>排行榜已暂停</b> · {lbDataAvailable ? `榜单停在 ${data.leaderboardSnapshotAt}` : "暂停时的榜单数据未确认，名次和金额暂不显示。"} · 奖励暂停发放。</div>}
          <div className="sect-foot" aria-label="排行榜周期">
            {([['today', '今日'], ['week', '本周'], ['month', '本月'], ['all', '总榜']] as const).map(([period, title]) =>
              <button key={period} aria-pressed={leaderboardPeriod === period} onClick={() => setLeaderboardPeriod(period)}>{title}</button>)}
          </div>
          <p className="muted">按本期已解锁的 USDT 佣金排名 · 北京时间（UTC+8）· {periodLeaderboard ? `更新于 ${periodLeaderboard.snapshotAt} · 前 ${periodLeaderboard.topN} 名有奖励` : "榜单暂时无法显示"}</p>
          <div className="podium">
            {!lbDataAvailable ? <div className="empty">{lbPaused ? "暂停时的榜单数据未确认" : "榜单暂时无法显示"}</div> : periodLeaderboard!.podium.length ? periodLeaderboard!.podium.map((row) => (
              <div key={row.userId} className={`pod ${row.className}`}><span className="rank">{row.rank}</span><div className="uid">{row.userId}</div><div className="gv">{row.gmvLabel}<small>{operatorCopyText(row.tip)}</small></div>
                {canControlLeaderboard && leaderboardPeriod === "week" && row.memberUserId > 0 && !row.className.includes("dq") && <button className="danger" aria-label={`取消 ${row.userId} 的榜单资格`} onClick={() => ctx.openActionConfirm({
                  name: `取消 ${row.userId} 本周榜单资格`, op: "dispose",
                  paramKey: `F.leaderboard.week.user.${row.memberUserId}.status`, fixedVal: "disqualified",
                  detail: `把成员 ${row.memberUserId} 移出本周榜单，排名和奖池发放都不再算他。`,
                })}>取消资格</button>}
              </div>
            )) : <div className="empty">榜单暂无数据</div>}
          </div>
          <div className="kv-row"><span className="k">{lbPaused ? "暂停时奖池" : "本期奖池"}</span><span className="v">{lbDataAvailable ? lbPool : "—"}</span></div>
          <div className="kv-row"><span className="k">{lbPaused ? "暂停时参赛人数" : "参赛人数"}</span><span className="v">{lbDataAvailable ? periodLeaderboard!.participantCount.toLocaleString("en-US") : "—"}</span></div>
          <div className="kv-row"><span className="k">疑似刷榜</span><span className="v" style={{ color: "var(--danger)" }}>{`${data.leaderboardFraudHitCount} 账户${lbDq ? " · 含已处理" : ""}`}</span></div>
          <div className="sect-foot">
            {canFund && leaderboardPeriod === "week" && <button className="primary amp" onClick={() => ctx.openActionConfirm({ name: "调整本周榜单奖池", amplify: true, op: "param", paramKey: "F.leaderboard.poolUsd", edit: { kind: "text", current: data.leaderboardPoolLabel }, detail: `本周榜单奖池总额 · 当前 ${lbPool} · 调高会多发钱，先看兑付覆盖率。` })}>调整奖池</button>}
            {canWrite && <button onClick={() => ctx.openActionConfirm({ name: "调整上榜最低佣金", op: "param", paramKey: "F.leaderboard.minUsd", edit: { kind: "number", current: lbMinUsd, unit: "USD" }, detail: `上榜最低佣金 · 当前 $${lbMinUsd} · 低于这个金额不参与排名。` })}>上榜门槛</button>}
            {canControlLeaderboard && <button className={lbPaused ? "primary" : "danger"} onClick={() => ctx.openActionConfirm({ name: lbPaused ? "恢复排行榜" : "暂停排行榜", op: "dispose", paramKey: "F.leaderboard.paused", fixedVal: lbPaused ? "off" : "on", detail: lbPaused ? "恢复后榜单重新更新，奖励照常发放。" : "暂停后榜单停在当前名次，奖励暂停发放。" })}>{lbPaused ? "恢复榜单" : "暂停榜单"}</button>}
            {canFund && <button className="primary amp" disabled={lbPaused} onClick={() => ctx.openActionConfirm({
              name: "发放总榜奖励",
              amplify: true,
              detail: `总榜不会自动清零。按累计佣金前 100 名发放当前奖池 $${ppAllTime}，需要审批，不会重复发放。`,
              run: (reason) => ctx.proposeF4LeaderboardPayout("allTime", reason),
            })}>发放总榜奖励</button>}
            {canFund && lbPaused && <span className="muted">排行榜已暂停，奖励暂停发放。</span>}
            {canFund && <button className="primary amp" onClick={() => ctx.openActionConfirm({
              name: "调整各榜奖池", amplify: true,
              businessForm: {
                kind: "multi-field",
                title: "各榜奖池（USD）",
                hint: "填 0 或正数。调高会多发钱，先看兑付覆盖率。",
                fields: [
                  { key: "today", label: "日榜奖池(USD)", current: ppToday, inputKind: "number", min: 0 },
                  { key: "week", label: "周榜奖池(USD)", current: ppWeek, inputKind: "number", min: 0 },
                  { key: "month", label: "月榜奖池(USD)", current: ppMonth, inputKind: "number", min: 0 },
                  { key: "allTime", label: "总榜奖池(USD)", current: ppAllTime, inputKind: "number", min: 0 },
                ],
              },
              detail: `各榜奖池 · 当前 日 ${ppToday} / 周 ${ppWeek} / 月 ${ppMonth} / 总 ${ppAllTime} · 调高会多发钱，先看兑付覆盖率。`,
              run: async (reason, bv) => {
                if (!bv) throw new Error("请填写全部 4 个奖池");
                const today = Number(bv.today);
                const week = Number(bv.week);
                const month = Number(bv.month);
                const allTime = Number(bv.allTime);
                if (![today, week, month, allTime].every(Number.isFinite) || [today, week, month, allTime].some((n) => n < 0)) {
                  throw new Error("奖池要填 0 或正数");
                }
                await ctx.updateF4Config("F.pool.periodPrize", JSON.stringify({ today, week, month, allTime }), reason);
                ctx.toast(`各榜奖池已生效 · 日 ${today} / 周 ${week} / 月 ${month} / 总 ${allTime}`);
              },
            })}>各榜奖池</button>}
          </div>
        </section>
      </div>

      <section className="sect votes-card">
        <div className="sect-h">
          <span className="ic pool"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3-7 4 14 3-7h4" /></svg></span>
          <div className="t"><div className="nm">各等级票数 · 决定领导奖池怎么分</div><div className="s">{voteSummary}</div></div>

        </div>
        <div className="votes-grid">
          {data.voteWeights.length ? data.voteWeights.map((row, index) => (
            <div key={row.v} className="vote-col"><span className="v">{row.votes}</span><span className={`b ${voteTier(index)}`} style={{ height: voteH(row.votes, maxVote) }} /><span className="l">{row.v}</span></div>
          )) : <div className="empty">票数还没设置</div>}
        </div>
        <div className="vote-table">
          {data.voteWeights.map((row) => {
            const paramKey = row.configKey || `F.pool.votes.${row.v}`;
            return (
              <div key={row.v} className="vote-cell" onClick={canFund ? () => ctx.openActionConfirm({ name: `调整 ${row.v} 票数`, amplify: true, op: "param", paramKey, edit: { kind: "number", current: String(row.votes), unit: "票" }, detail: `${row.v} 当前 ${row.votes} 票 · 票数越多，分到的领导奖池越多。` }) : undefined}>
                <div className="vlb">{row.v}</div><div className="vct">{row.votes} 票</div>
              </div>
            );
          })}
        </div>
        <div className="f4-warn"><b>票数决定分多少</b> · 调高高等级的票数，奖池会更集中到少数人（{voteSummary}）。<b>改票数前先看兑付覆盖率。</b></div>
      </section>

      <p className="f-foot">领导奖池 <b>{settlementEff}</b>。按已付款订单金额、每月上限、参与等级和会员等级票数计算发放，同一周不会重复发放；提前结算需要审批。补发、冲正、冻结请到「佣金记录核对」处理。硬件配额、区域大使、排行榜各自独立生效；会多发钱的调整先看兑付覆盖率。</p>
    </>
  );
}
