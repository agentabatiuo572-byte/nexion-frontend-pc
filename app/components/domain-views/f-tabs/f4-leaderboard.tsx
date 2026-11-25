"use client";

/**
 * F4 · 排行榜（改版）。日、周、月、总榜的前三名，暂停状态，奖池和上榜规则，暂停、恢复、取消资格和总榜派奖。
 * 写入口和请求沿用旧页面：榜单处置和参数走 shell 的 param/dispose 提交，总榜派奖走 ctx.proposeF4LeaderboardPayout，各榜奖池整组走 run。
 */
import { useState } from "react";
import { Pause, Play, ShieldAlert, SlidersHorizontal, Trophy } from "lucide-react";
import { BlockState, Button, ConfigList, ConfigRow, Explain, Notice, Panel, Segments, StatusTag } from "@/app/components/rd";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import type { F4LeadershipPoolOverview } from "@/lib/admin/f1-client";
import { count, decimalText, minPointsText, periodRange, stamp, usdt, zoneNote, moneyText } from "./f4-shared";
import type { FViewCtx } from "./types";
import { f4PeriodPrizes } from "@/lib/admin/f4-money";
import { f4Confirmation } from "./f4-confirmations";

type Period = "today" | "week" | "month" | "all";
const PERIODS: { value: Period; label: string; limit: number }[] = [
  { value: "today", label: "今日", limit: 20 },
  { value: "week", label: "本周", limit: 50 },
  { value: "month", label: "本月", limit: 100 },
  { value: "all", label: "总榜", limit: 100 },
];

/** 榜单现在能不能显示：实时，或暂停且快照可用。 */
export function leaderboardState(data: F4LeadershipPoolOverview) {
  const paused = data.leaderboardPaused ?? (data.configValues["F.leaderboard.paused"] ?? "off") === "on";
  const frozen = data.leaderboardSnapshotState === "FROZEN" && data.leaderboardDataAvailable === true;
  return { paused, frozen, available: !paused || frozen };
}

/** 后端榜单金额写成「$123.45」，这里去掉 $ 写成 USDT。 */
function prizeText(label: string) {
  const amount = /^\$?(-?\d+(?:\.\d+)?)$/.exec(label.trim().replace(/,/g, ""));
  return amount ? moneyText(amount[1]) : label;
}

/** 榜读不出来的原因。和「这一期没有人上榜」分开写。 */
function unavailableText(paused: boolean, reason: string | undefined) {
  if (!paused) return "这个榜的算力点没读到，名次暂不显示，不代表没有人上榜。";
  if (reason === "SNAPSHOT_SCHEMA_UNSUPPORTED") return "暂停时存的是旧版榜单（按奖励金额排名），不能换算成算力点。恢复榜单后按算力点重新显示。";
  if (reason === "PRE_SNAPSHOT_PAUSE") return "暂停时没有存下榜单，名次暂不显示。恢复榜单后按算力点重新显示。";
  return "暂停时存的榜单读不出来，名次暂不显示。恢复榜单后按算力点重新显示。";
}

export function F4Leaderboard({ ctx, data }: { ctx: FViewCtx; data: F4LeadershipPoolOverview }) {
  const [period, setPeriod] = useState<Period>("week");
  const canWrite = ctx.can("network_f4_write");
  const canFund = ctx.can("network_f4_pool_fund");
  const canControl = ctx.can("network_f4_leaderboard_control");
  const board = leaderboardState(data);
  const current = data.leaderboardComputePointPeriods?.[period];
  const available = !!current && board.available;
  const top1MaxPct = data.configValues["F.pool.top1MaxPct"]?.trim() || "25";
  const top5MaxPct = data.configValues["F.pool.top5MaxPct"]?.trim() || "60";
  const periodPrizeRaw = data.configValues["F.pool.periodPrize"] ?? "";
  const periodPrizes = f4PeriodPrizes(periodPrizeRaw);
  const currentPeriodPrize = (key: Period) => periodPrizes?.[key === "all" ? "allTime" : key] ?? "";
  const ppToday = currentPeriodPrize("today");
  const ppWeek = currentPeriodPrize("week");
  const ppMonth = currentPeriodPrize("month");
  const ppAllTime = currentPeriodPrize("all");
  const prizeShown = (value: string) => value === "" ? "—" : moneyText(value);
  const limit = PERIODS.find((item) => item.value === period)!.limit;

  const pauseSnapshot = { action: "F.leaderboard.paused", overview: data, policy: ctx.f4AmbassadorPolicy, period };
  const openPause = () => ctx.openActionConfirm(f4Confirmation(ctx, pauseSnapshot));

  const payoutSnapshot = { action: "payout", overview: data, policy: ctx.f4AmbassadorPolicy, period };
  const openPayout = () => ctx.openActionConfirm(f4Confirmation(ctx, payoutSnapshot));

  const disqualifySnapshot = (row: { memberUserId: number }) => ({ action: `F.leaderboard.week.user.${row.memberUserId}.status`, overview: data, policy: ctx.f4AmbassadorPolicy, period });
  const openDisqualify = (row: { memberUserId: number }) => ctx.openActionConfirm(f4Confirmation(ctx, disqualifySnapshot(row)));

  const paramRow = (spec: { name: string; value: string; what: string; when: string; effect: string; note?: string; allowed: boolean; action: string }) => {
    const snapshot = { action: spec.action, overview: data, policy: ctx.f4AmbassadorPolicy, period };
    return <ConfigRow key={spec.name} name={spec.name} what={spec.what} when={spec.when} effect={spec.effect} note={spec.note} value={spec.value}
      action={spec.allowed ? <Button size="sm" disabledReason={ctx.f4ExpiredReason(snapshot)} onClick={() => ctx.openActionConfirm(f4Confirmation(ctx, snapshot))}>调整</Button> : undefined} />;
  };

  return (
    <div className="f4-stack">
      <Panel title="排行榜" icon={Trophy} tone="role-1" sub={`按团队订单的算力点排名 · 奖池 USDT · 时间为${zoneNote()}`}
        explain={<>
          <p>名次按本期下级（七层内）已付款订单的算力点合计排，不含本人的订单；退款或拒付的订单整单不算。这里只显示前三名。</p>
          <p>派奖发的是 USDT：按名次分这一期的奖池。</p>
          <p>参赛人数是参与排名的人数，日榜最多统计 20 人、周榜 50 人、月榜和总榜 100 人，不是全部用户。</p>
        </>}
        actions={<>
          {canControl && <Button variant={board.paused ? "secondary" : "danger-outline"} icon={board.paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />} disabledReason={ctx.f4ExpiredReason(pauseSnapshot)} onClick={openPause}>{board.paused ? "恢复榜单" : "暂停榜单"}</Button>}
          {canFund && <Button variant="primary" disabledReason={board.paused ? "排行榜已暂停，总榜奖励暂停发放" : ctx.f4ExpiredReason(payoutSnapshot)} onClick={openPayout}>发放总榜奖励</Button>}
        </>}>
        <div className="f4-board-bar">
          <Segments label="排行榜周期" value={period} onChange={setPeriod} items={PERIODS.map(({ value, label }) => ({ value, label }))} />
          {board.paused ? <StatusTag tone="warn" icon={Pause}>已暂停</StatusTag> : <StatusTag tone="ok">运行中</StatusTag>}
        </div>
        {board.paused && <Notice tone="warn" title="排行榜已暂停">
          {board.frozen ? `榜单停在 ${stamp(data.leaderboardSnapshotAt)}。` : ""}
          榜单奖励暂停发放，暂停期间到期的周期恢复后不会补发。
        </Notice>}
        {!available ? <BlockState state="error" title={board.paused ? "暂停时的榜单读不出来" : "这个榜暂时读不出来"} detail={unavailableText(board.paused, data.leaderboardSnapshotUnavailableReason)} />
          : current!.podium.length === 0 ? <BlockState state="empty" title={`${PERIODS.find((item) => item.value === period)!.label}还没有人上榜`} />
          : <ol className="f4-podium" data-count={current!.podium.length}>
            {current!.podium.map((row) => {
              const dq = row.className.includes("dq");
              return <li key={row.userId} data-rank={row.rank}>
                <div className="f4-podium-card">
                  <span className="f4-podium-rank">第 <b>{row.rank}</b> 名</span>
                  <span className="f4-podium-user" data-mono>{row.userId}</span>
                  <span className="f4-podium-value"><b>{count(row.computePoints)}</b><small>点</small></span>
                  <span className="f4-podium-tip">{operatorCopyText(row.tip)}{dq && <StatusTag tone="done">已取消资格</StatusTag>}</span>
                  {canControl && period === "week" && row.memberUserId > 0 && !dq && <Button size="sm" variant="danger-outline" aria-label={`取消 ${row.userId} 的榜单资格`} disabledReason={ctx.f4ExpiredReason(disqualifySnapshot(row))} onClick={() => openDisqualify(row)}>取消资格</Button>}
                </div>
              </li>;
            })}
          </ol>}
        <dl className="f4-board-facts">
          <div><dt>{board.paused ? "暂停时奖池" : "本期奖池"}</dt><dd>{available ? <>{usdt(current!.poolUsdText ?? current!.poolUsd)}<small>USDT</small></> : "—"}</dd></div>
          <div><dt>{board.paused ? "暂停时参赛人数" : "参赛人数"}<Explain label="参赛人数怎么算" content={`参与这个榜排名的人数，这个榜最多统计 ${limit} 人，不是全部用户。`} /></dt><dd>{available ? <>{count(current!.participantCount)}<small>人</small></> : "—"}</dd></div>
          <div><dt>有奖励的名次</dt><dd>{available ? (current!.topN > 0 ? `前 ${current!.topN} 名` : "没有奖励名次") : "—"}</dd></div>
          <div><dt>{board.paused ? "暂停时门槛" : "上榜门槛"}</dt><dd>{available ? minPointsText(current!.minComputePoints) : "—"}</dd></div>
          <div className="f4-board-span"><dt>统计时段</dt><dd>{available ? periodRange(current!.fromInclusive, current!.toExclusive, current!.businessTimezone, data.settlementZone) : "—"}</dd></div>
          <div><dt>取数时间</dt><dd>{available ? stamp(current!.snapshotAt) : "—"}</dd></div>
        </dl>
        <p className="f4-risk"><ShieldAlert size={14} aria-hidden />本周风控命中 {count(data.leaderboardFraudHitCount)} 个账户{data.leaderboardDisqualified ? "（含已处理）" : ""}
          <Explain label="风控命中怎么算" content="本周有风险记录的账户和本周已被取消资格的账户合计去重，不是榜里待处理的精确人数。取消资格只在本周榜前三名上点。" /></p>
      </Panel>

      <Panel title="奖池和上榜规则" icon={SlidersHorizontal} tone="role-4" sub="批准后生效 · 金额 USDT"
        explain="奖池决定每期发多少钱，上榜门槛决定谁能排名，头部占比超过阈值时记录告警。排行榜奖金按名次权重计算。">
        <ConfigList label="排行榜设置">
          {paramRow({ name: "各榜奖池", value: `日 ${prizeShown(ppToday)} · 周 ${prizeShown(ppWeek)} · 月 ${prizeShown(ppMonth)} · 总 ${prizeShown(ppAllTime)}`, allowed: canFund,
            what: "日、周、月、总榜每期发多少，四个一起提交。",
            when: "批准后，日、周、月榜从下一次还没结算的周期起用新金额，总榜在人工派奖时读；已发的不改。",
            effect: "调高会多发钱，提交前看兑付覆盖率。周榜如果另设了大于 0 的覆盖额，以覆盖额为准。",
            note: periodPrizes ? undefined : "四榜奖池未配置或格式有误。",
            action: "F.pool.periodPrize" })}
          {paramRow({ name: "周榜奖池覆盖额", value: data.leaderboardPoolLabel ? `本周实际生效 ${prizeText(data.leaderboardPoolLabel)} USDT` : "—", allowed: canFund,
            what: "只给周榜用的奖池金额，大于 0 时代替四榜奖池里的周榜金额。",
            when: "批准后从还没结算的周起用；已发的不改。暂停期间读暂停时的奖池。",
            effect: "填 0 不是关掉周榜奖池，而是改回用四榜奖池里的周榜金额。",
            note: "看不出有没有另设覆盖额。格式不对提交不了；以前存下的坏值按四榜奖池的周榜金额发。",
            action: "F.leaderboard.poolUsd" })}
          {paramRow({ name: "上榜门槛", value: minPointsText(data.configValues["F.leaderboard.minComputePoints"]), allowed: canWrite,
            what: "本期团队订单算力点低于这个数的人不参与排名和派奖，四个榜共用。填 0 不设门槛。",
            when: "批准后从还没结算的周期起用；暂停期间的榜仍按暂停时的门槛。",
            effect: "调高上榜的人变少。",
            action: "F.leaderboard.minComputePoints" })}
          {paramRow({ name: "第 1 名占比告警阈值", value: data.configValues["F.pool.top1MaxPct"]?.trim() ? `${top1MaxPct}%` : "未设置（按 25%）", allowed: canFund,
            what: "排行榜派奖时第 1 名占奖池超过这个比例就告警，范围 0–100%。",
            when: "批准后对还没结算的榜生效，已发的不追回。",
            effect: "奖金按名次权重计算。",
            action: "F.pool.top1MaxPct" })}
          {paramRow({ name: "前 5 名占比告警阈值", value: data.configValues["F.pool.top5MaxPct"]?.trim() ? `${top5MaxPct}%` : "未设置（按 60%）", allowed: canFund,
            what: "排行榜派奖时前 5 名合计占奖池超过这个比例就告警，范围 0–100%。",
            when: "批准后对还没结算的榜生效，已发的不追回。",
            effect: "两项告警独立判断，奖金按名次权重计算。",
            action: "F.pool.top5MaxPct" })}
        </ConfigList>
      </Panel>
    </div>
  );
}
