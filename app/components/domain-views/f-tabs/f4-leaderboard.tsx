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
import { count, decimalText, stamp, usdt, zoneNote } from "./f4-shared";
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
  return amount ? decimalText(amount[1]) : label;
}

export function F4Leaderboard({ ctx, data }: { ctx: FViewCtx; data: F4LeadershipPoolOverview }) {
  const [period, setPeriod] = useState<Period>("week");
  const canWrite = ctx.can("network_f4_write");
  const canFund = ctx.can("network_f4_pool_fund");
  const canControl = ctx.can("network_f4_leaderboard_control");
  const board = leaderboardState(data);
  const current = data.leaderboardPeriods?.[period];
  const available = !!current && board.available;
  const lbMinUsd = data.configValues["F.leaderboard.minUsd"] ?? "0";
  const top1MaxPct = data.configValues["F.pool.top1MaxPct"] ?? "25";
  const top5MaxPct = data.configValues["F.pool.top5MaxPct"] ?? "60";
  const periodPrizeRaw = data.configValues["F.pool.periodPrize"] ?? "";
  const periodPrizes = f4PeriodPrizes(periodPrizeRaw);
  const currentPeriodPrize = (key: Period) => {
    const configured = periodPrizes?.[key === "all" ? "allTime" : key];
    if (configured !== undefined) return configured;
    const liveAmount = board.paused ? undefined : data.leaderboardPeriods?.[key]?.poolUsdText ?? data.leaderboardPeriods?.[key]?.poolUsd;
    return liveAmount === undefined ? "" : String(liveAmount);
  };
  const ppToday = currentPeriodPrize("today");
  const ppWeek = currentPeriodPrize("week");
  const ppMonth = currentPeriodPrize("month");
  const ppAllTime = currentPeriodPrize("all");
  const prizeShown = (value: string) => value === "" ? "—" : decimalText(value);
  const limit = PERIODS.find((item) => item.value === period)!.limit;

  const openPause = () => ctx.openActionConfirm(f4Confirmation(ctx, { action: "F.leaderboard.paused", overview: data, policy: ctx.f4AmbassadorPolicy, period }));

  const openPayout = () => ctx.openActionConfirm(f4Confirmation(ctx, { action: "payout", overview: data, policy: ctx.f4AmbassadorPolicy, period }));

  const openDisqualify = (row: F4LeadershipPoolOverview["podium"][number]) => ctx.openActionConfirm(f4Confirmation(ctx, { action: `F.leaderboard.week.user.${row.memberUserId}.status`, overview: data, policy: ctx.f4AmbassadorPolicy, period }));

  const paramRow = (spec: { name: string; value: string; what: string; when: string; effect: string; note?: string; allowed: boolean; open: () => void }) => (
    <ConfigRow key={spec.name} name={spec.name} what={spec.what} when={spec.when} effect={spec.effect} note={spec.note} value={spec.value}
      action={spec.allowed ? <Button size="sm" onClick={spec.open}>调整</Button> : undefined} />
  );

  return (
    <div className="f4-stack">
      <Panel title="排行榜" icon={Trophy} tone="role-1" sub={`按业务日历切日、周、月 · 时间为${zoneNote()} · 金额 USDT`}
        explain={<>
          <p>按本期已解锁的 USDT 奖励排名，不是成交额；这里只显示前三名。</p>
          <p>参赛人数是参与排名的人数，日榜最多统计 20 人、周榜 50 人、月榜和总榜 100 人，不是全部用户。</p>
        </>}
        actions={<>
          {canControl && <Button variant={board.paused ? "secondary" : "danger-outline"} icon={board.paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />} onClick={openPause}>{board.paused ? "恢复榜单" : "暂停榜单"}</Button>}
          {canFund && <Button variant="primary" disabledReason={board.paused ? "排行榜已暂停，总榜奖励暂停发放" : undefined} onClick={openPayout}>发放总榜奖励</Button>}
        </>}>
        <div className="f4-board-bar">
          <Segments label="排行榜周期" value={period} onChange={setPeriod} items={PERIODS.map(({ value, label }) => ({ value, label }))} />
          {board.paused ? <StatusTag tone="warn" icon={Pause}>已暂停</StatusTag> : <StatusTag tone="ok">实时更新</StatusTag>}
        </div>
        {board.paused && <Notice tone="warn" title="排行榜已暂停">
          {board.frozen ? `榜单停在 ${stamp(data.leaderboardSnapshotAt)}。` : "暂停时的榜单快照不可用，名次和金额暂不显示。"}
          榜单奖励暂停发放，暂停期间到期的周期恢复后不会补发。
        </Notice>}
        {!available ? <BlockState state="empty" title={board.paused ? "暂停时的榜单数据未确认" : "这个榜暂时无法显示"} />
          : current!.podium.length === 0 ? <BlockState state="empty" title={`${PERIODS.find((item) => item.value === period)!.label}还没有人上榜`} />
          : <ol className="f4-podium" data-count={current!.podium.length}>
            {current!.podium.map((row) => {
              const dq = row.className.includes("dq");
              return <li key={row.userId} data-rank={row.rank}>
                <div className="f4-podium-card">
                  <span className="f4-podium-rank">第 <b>{row.rank}</b> 名</span>
                  <span className="f4-podium-user" data-mono>{row.userId}</span>
                  <span className="f4-podium-value"><b>{prizeText(row.gmvLabel)}</b><small>USDT</small></span>
                  <span className="f4-podium-tip">{operatorCopyText(row.tip)}{dq && <StatusTag tone="done">已取消资格</StatusTag>}</span>
                  {canControl && period === "week" && row.memberUserId > 0 && !dq && <Button size="sm" variant="danger-outline" aria-label={`取消 ${row.userId} 的榜单资格`} onClick={() => openDisqualify(row)}>取消资格</Button>}
                </div>
              </li>;
            })}
          </ol>}
        <dl className="f4-board-facts">
          <div><dt>{board.paused ? "暂停时奖池" : "本期奖池"}</dt><dd>{available ? <>{usdt(current!.poolUsdText ?? current!.poolUsd)}<small>USDT</small></> : "—"}</dd></div>
          <div><dt>{board.paused ? "暂停时参赛人数" : "参赛人数"}<Explain label="参赛人数怎么算" content={`参与这个榜排名的人数，这个榜最多统计 ${limit} 人，不是全部用户。`} /></dt><dd>{available ? <>{count(current!.participantCount)}<small>人</small></> : "—"}</dd></div>
          <div><dt>有奖励的名次</dt><dd>{available ? (current!.topN > 0 ? `前 ${current!.topN} 名` : "没有奖励名次") : "—"}</dd></div>
          <div><dt>更新于</dt><dd>{available ? stamp(current!.snapshotAt) : "—"}</dd></div>
        </dl>
        <p className="f4-risk"><ShieldAlert size={14} aria-hidden />本周风控命中 {count(data.leaderboardFraudHitCount)} 个账户{data.leaderboardDisqualified ? "（含已处理）" : ""}
          <Explain label="风控命中怎么算" content="本周有风险记录的账户和本周已被取消资格的账户合计去重，不是榜里待处理的精确人数。取消资格只在本周榜前三名上点。" /></p>
      </Panel>

      <Panel title="奖池和上榜规则" icon={SlidersHorizontal} tone="role-4" sub="批准后生效 · 金额 USDT"
        explain="奖池决定每期发多少钱，上榜门槛决定谁能排名，头部占比限制前几名最多拿多少。这里的头部占比只约束排行榜派奖，不影响团队激励池怎么分。">
        <ConfigList label="排行榜设置">
          {paramRow({ name: "各榜奖池", value: `日 ${prizeShown(ppToday)} · 周 ${prizeShown(ppWeek)} · 月 ${prizeShown(ppMonth)} · 总 ${prizeShown(ppAllTime)}`, allowed: canFund,
            what: "日、周、月、总榜每期发多少，四个一起提交。",
            when: "批准后，日、周、月榜从下一次还没结算的周期起用新金额，总榜在人工派奖时读；已发的不改。",
            effect: "调高会多发钱，提交前看兑付覆盖率。周榜如果另设了大于 0 的覆盖额，以覆盖额为准。",
            note: periodPrizes ? undefined : "四榜奖池的设置没读到或读不懂，这里显示的是榜单现在用的金额（周榜是生效后的金额）；读不到的写「—」。",
            open: () => ctx.openActionConfirm(f4Confirmation(ctx, { action: "F.pool.periodPrize", overview: data, policy: ctx.f4AmbassadorPolicy, period })) })}
          {paramRow({ name: "周榜奖池覆盖额", value: !data.leaderboardPoolLabel || /^\$?0(?:\.0+)?$/.test(data.leaderboardPoolLabel.trim()) ? "未单独设置（按四榜奖池的周榜金额）" : `${prizeText(data.leaderboardPoolLabel)} USDT`, allowed: canFund,
            what: "只给周榜用的奖池金额，大于 0 时代替四榜奖池里的周榜金额。",
            when: "批准后从还没结算的周起用；已发的不改。暂停期间读暂停时的奖池。",
            effect: "填 0 不是关掉周榜奖池，而是改回用四榜奖池里的周榜金额。",
            note: "后端保存时不检查金额格式，格式不对时按四榜奖池的周榜金额发。",
            open: () => ctx.openActionConfirm(f4Confirmation(ctx, { action: "F.leaderboard.poolUsd", overview: data, policy: ctx.f4AmbassadorPolicy, period })) })}
          {paramRow({ name: "上榜门槛", value: data.configValues["F.leaderboard.minUsd"] !== undefined ? `${decimalText(lbMinUsd)} USDT` : "未设置（按 0 USDT）", allowed: canWrite,
            what: "本期已解锁奖励低于这个金额的人不参与排名，四个榜共用。",
            when: "批准后从还没结算的周期起用；暂停期间的快照仍按暂停时的门槛。",
            effect: "调高上榜的人变少。",
            open: () => ctx.openActionConfirm(f4Confirmation(ctx, { action: "F.leaderboard.minUsd", overview: data, policy: ctx.f4AmbassadorPolicy, period })) })}
          {paramRow({ name: "第 1 名最高占比", value: data.configValues["F.pool.top1MaxPct"] !== undefined ? `${top1MaxPct}%` : "未设置（按 25%）", allowed: canFund,
            what: "排行榜派奖时第 1 名最多拿到奖池的百分比，0–100。只约束排行榜派奖。",
            when: "批准后对还没结算的榜生效，已发的不追回。",
            effect: "超出上限的部分不再分给别人。调高会多发钱给第 1 名。",
            open: () => ctx.openActionConfirm(f4Confirmation(ctx, { action: "F.pool.top1MaxPct", overview: data, policy: ctx.f4AmbassadorPolicy, period })) })}
          {paramRow({ name: "前 5 名最高占比", value: data.configValues["F.pool.top5MaxPct"] !== undefined ? `${top5MaxPct}%` : "未设置（按 60%）", allowed: canFund,
            what: "排行榜派奖时前 5 名合计最多拿到奖池的百分比，0–100。只约束排行榜派奖。",
            when: "批准后对还没结算的榜生效，已发的不追回。",
            effect: "超出上限的部分不再分给别人。和第 1 名上限各自独立，后端不检查两者的大小关系。",
            open: () => ctx.openActionConfirm(f4Confirmation(ctx, { action: "F.pool.top5MaxPct", overview: data, policy: ctx.f4AmbassadorPolicy, period })) })}
        </ConfigList>
      </Panel>
    </div>
  );
}
