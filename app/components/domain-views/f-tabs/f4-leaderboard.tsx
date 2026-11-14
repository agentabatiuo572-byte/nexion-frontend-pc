"use client";

/**
 * F4 · 排行榜（改版）。日、周、月、总榜的前三名，暂停状态，奖池和上榜规则，暂停、恢复、取消资格和总榜派奖。
 * 写入口和请求沿用旧页面：榜单处置和参数走 shell 的 param/dispose 提交，总榜派奖走 ctx.proposeF4LeaderboardPayout，各榜奖池整组走 run。
 */
import { useState } from "react";
import { Pause, Play, ShieldAlert, SlidersHorizontal, Trophy } from "lucide-react";
import { BlockState, Button, ConfigList, ConfigRow, Explain, Fact, Facts, KeyValues, Notice, Panel, Segments, StatusTag } from "@/app/components/rd";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import type { F4LeadershipPoolOverview } from "@/lib/admin/f1-client";
import { approvalCopy, approvalTag } from "./f4-pool";
import { count, decimalText, stamp, usdt, zoneNote } from "./f4-shared";
import type { FViewCtx } from "./types";

type Period = "today" | "week" | "month" | "all";
const PERIODS: { value: Period; label: string; limit: number }[] = [
  { value: "today", label: "今日", limit: 20 },
  { value: "week", label: "本周", limit: 50 },
  { value: "month", label: "本月", limit: 100 },
  { value: "all", label: "总榜", limit: 100 },
];
const BOARD_ZONE = "越南时间（UTC+7）";

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
  const lbMinUsd = data.configValues["F.leaderboard.minUsd"] ?? "1";
  const top1MaxPct = data.configValues["F.pool.top1MaxPct"] ?? "25";
  const top5MaxPct = data.configValues["F.pool.top5MaxPct"] ?? "60";
  const periodPrizeRaw = data.configValues["F.pool.periodPrize"] ?? "";
  let periodPrizes: Record<string, unknown> | null = null;
  if (periodPrizeRaw) {
    try {
      periodPrizes = JSON.parse(periodPrizeRaw);
    } catch { /* 无有效配置时使用当前可用的榜单金额。 */ }
  }
  const currentPeriodPrize = (key: Period) => {
    const configured = periodPrizes?.[key === "all" ? "allTime" : key];
    if (typeof configured === "number" && Number.isFinite(configured) && configured >= 0) return String(configured);
    const liveAmount = board.paused ? undefined : data.leaderboardPeriods?.[key]?.poolUsd;
    return liveAmount === undefined ? "" : String(liveAmount);
  };
  const ppToday = currentPeriodPrize("today");
  const ppWeek = currentPeriodPrize("week");
  const ppMonth = currentPeriodPrize("month");
  const ppAllTime = currentPeriodPrize("all");
  const prizeShown = (value: string) => value === "" ? "—" : decimalText(value);
  const lbPool = current ? `$${current.poolUsd.toLocaleString("en-US", { maximumFractionDigits: 6 })}` : "—";
  const limit = PERIODS.find((item) => item.value === period)!.limit;

  const openPause = () => ctx.openActionConfirm({ briefKind: board.paused ? "config" : "record", name: board.paused ? "恢复排行榜" : "暂停排行榜", op: "dispose", paramKey: "F.leaderboard.paused", fixedVal: board.paused ? "off" : "on",
    title: board.paused ? "恢复排行榜" : "暂停排行榜", effect: approvalTag(),
    confirmTone: board.paused ? "primary" : "danger", confirmLabel: board.paused ? "提交恢复" : "提交暂停",
    statedBrief: board.paused ? {
      impact: "批准后四个榜重新实时更新，之后到期的日、周、月榜照常自动派奖。暂停期间跳过的周期恢复后不会补发。",
      check: "已经在实时运行时会被拒绝。暂停时保存的快照留作历史。",
    } : {
      impact: "批准后四个榜停在暂停那一刻的名次；暂停期间到期的日、周、月榜自动派奖不发，恢复后也不会补发；总榜派奖不能提交。团队激励池照常结算。",
      check: "已经暂停时会被拒绝；保存四个榜的快照失败时整次不生效。",
    },
    completionCopy: approvalCopy("榜单处置权限"),
    detail: board.paused ? "恢复后榜单重新更新，之后的周期照常发奖。" : "暂停后榜单停在当前名次，榜单奖励暂停发放，团队激励池不受影响。",
  });

  const openPayout = () => ctx.openActionConfirm({ briefKind: "funds",
    name: "发放总榜奖励",
    amplify: true,
    title: "发放总榜奖励", effect: approvalTag(), confirmLabel: "提交审批",
    statedBrief: {
      impact: "批准后按执行那一刻的总榜，把总榜奖池按名次分给累计已解锁奖励最多的前 100 名（不足 100 名按实际人数），作为已解锁的 USDT 奖励真实入账。",
      check: "总榜成功派过一次后再执行不会再发；奖池为 0 或没有人上榜时不发钱。后端执行时不检查兑付覆盖率。",
    },
    completionCopy: approvalCopy("F4 资金权限"),
    coverageLead: "这次派奖会真实发钱",
    coverageCheck: "后端执行这次派奖时不检查兑付覆盖率，下面是现在读到的数，请自己判断。",
    facts: <Facts>
      <Fact k="总榜奖池" lead tone="role-1" unit={ppAllTime === "" ? undefined : "USDT"}>{prizeShown(ppAllTime)}</Fact>
      <Fact k="每个名次发多少">按名次分份数：第 1 名 N 份，往后每名少 1 份，最后一名 1 份；N 是上榜人数</Fact>
      <Fact k="头部上限"><span className="rd-keep">第 1 名最多 {top1MaxPct}%，</span><span className="rd-keep">前 5 名合计最多 {top5MaxPct}%，</span><span className="rd-keep">超出的不再分给别人</span></Fact>
    </Facts>,
    detail: `总榜不会自动清零。按累计奖励前 100 名发放当前奖池 ${prizeShown(ppAllTime)} USDT，需要审批，不会重复发放。`,
    run: (reason) => ctx.proposeF4LeaderboardPayout("allTime", reason),
  });

  const openDisqualify = (row: F4LeadershipPoolOverview["podium"][number]) => ctx.openActionConfirm({ briefKind: "record",
    name: `取消 ${row.userId} 本周榜单资格`, op: "dispose",
    paramKey: `F.leaderboard.week.user.${row.memberUserId}.status`, fixedVal: "disqualified",
    title: `取消 ${row.userId} 的周榜资格`, effect: approvalTag(), confirmTone: "danger", confirmLabel: "提交取消资格",
    statedBrief: {
      impact: "批准后这个人移出周榜排名和周榜派奖；不冻结账号，不追回已发的奖励。不会在下周自动恢复：之后每一周的周榜都一直不算这个人。",
      check: "后端在提交和执行时都要找到这个人本周的风险记录，找不到会被拒绝。",
    },
    completionCopy: approvalCopy("榜单处置权限"),
    facts: <KeyValues rows={[
      { key: "who", label: "谁", value: `用户 ${row.userId}` },
      { key: "rank", label: "本周名次", value: `第 ${row.rank} 名 · ${prizeText(row.gmvLabel)} USDT` },
    ]} />,
    detail: `把成员 ${row.memberUserId} 移出本周榜单，排名和奖池发放都不再算他。`,
  });

  const paramRow = (spec: { name: string; value: string; what: string; when: string; effect: string; note?: string; allowed: boolean; open: () => void }) => (
    <ConfigRow key={spec.name} name={spec.name} what={spec.what} when={spec.when} effect={spec.effect} note={spec.note} value={spec.value}
      action={spec.allowed ? <Button size="sm" onClick={spec.open}>调整</Button> : undefined} />
  );

  return (
    <div className="f4-stack">
      <Panel title="排行榜" icon={Trophy} tone="role-1" sub={`按${BOARD_ZONE}切日、周、月 · 时间为${zoneNote()} · 金额 USDT`}
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
          <div><dt>{board.paused ? "暂停时奖池" : "本期奖池"}</dt><dd>{available ? <>{usdt(current!.poolUsd)}<small>USDT</small></> : "—"}</dd></div>
          <div><dt>{board.paused ? "暂停时参赛人数" : "参赛人数"}<Explain label="参赛人数怎么算" content={`参与这个榜排名的人数，这个榜最多统计 ${limit} 人，不是全部用户。`} /></dt><dd>{available ? <>{count(current!.participantCount)}<small>人</small></> : "—"}</dd></div>
          <div><dt>有奖励的名次</dt><dd>{available ? (current!.topN > 0 ? `前 ${current!.topN} 名` : "奖池为 0，没有奖励") : "—"}</dd></div>
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
            note: periodPrizes ? undefined : "还没有批准过的四榜奖池，这里显示的是榜单现在用的金额；读不到的写「—」。",
            open: () => ctx.openActionConfirm({ briefKind: "config",
              name: "调整各榜奖池", amplify: true,
              title: "调整各榜奖池", effect: approvalTag(), confirmLabel: "提交审批",
              statedBrief: { impact: "批准后，日、周、月榜从下一次还没结算的周期起用新金额，总榜在人工派奖时读；已经派过的不改。", check: "四个都要填 0 或正数，一起提交，一张审批单。" },
              completionCopy: approvalCopy("F4 资金权限"),
              businessForm: {
                kind: "multi-field",
                title: "各榜奖池（USDT）",
                hint: "填 0 或正数。调高会多发钱，先看兑付覆盖率。",
                fields: [
                  { key: "today", label: "日榜", current: ppToday, inputKind: "number", min: 0 },
                  { key: "week", label: "周榜", current: ppWeek, inputKind: "number", min: 0 },
                  { key: "month", label: "月榜", current: ppMonth, inputKind: "number", min: 0 },
                  { key: "allTime", label: "总榜", current: ppAllTime, inputKind: "number", min: 0 },
                ],
              },
              detail: `各榜奖池 · 当前 日 ${prizeShown(ppToday)} / 周 ${prizeShown(ppWeek)} / 月 ${prizeShown(ppMonth)} / 总 ${prizeShown(ppAllTime)} USDT。`,
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
                ctx.toast(`各榜奖池已提交，批准后生效 · 日 ${today} / 周 ${week} / 月 ${month} / 总 ${allTime}；批准前仍按原设置执行`);
              },
            }) })}
          {paramRow({ name: "周榜奖池覆盖额", value: !data.leaderboardPoolLabel || /^\$?0(?:\.0+)?$/.test(data.leaderboardPoolLabel.trim()) ? "未单独设置（按四榜奖池的周榜金额）" : `${prizeText(data.leaderboardPoolLabel)} USDT`, allowed: canFund,
            what: "只给周榜用的奖池金额，大于 0 时代替四榜奖池里的周榜金额。",
            when: "批准后从还没结算的周起用；已发的不改。暂停期间读暂停时的奖池。",
            effect: "填 0 不是关掉周榜奖池，而是改回用四榜奖池里的周榜金额。",
            note: "后端保存时不检查金额格式，格式不对时按四榜奖池的周榜金额发。",
            open: () => ctx.openActionConfirm({ briefKind: "config", name: "调整本周榜单奖池", amplify: true, op: "param", paramKey: "F.leaderboard.poolUsd",
              edit: { kind: "text", current: data.leaderboardPoolLabel },
              title: "调整周榜奖池覆盖额", effect: approvalTag(), confirmLabel: "提交审批",
              statedBrief: { impact: "批准后，还没结算的周榜按新金额派奖；填 0 表示改回用四榜奖池里的周榜金额，不是关掉。", check: "后端保存时不检查金额格式，请填数字。" },
              completionCopy: approvalCopy("F4 资金权限"),
              detail: `本周榜单奖池总额 · 当前 ${lbPool}。` }) })}
          {paramRow({ name: "上榜门槛", value: data.configValues["F.leaderboard.minUsd"] !== undefined ? `${decimalText(lbMinUsd)} USDT` : "未设置（按 0 USDT）", allowed: canWrite,
            what: "本期已解锁奖励低于这个金额的人不参与排名，四个榜共用。",
            when: "批准后从还没结算的周期起用；暂停期间的快照仍按暂停时的门槛。",
            effect: "调高上榜的人变少。",
            open: () => ctx.openActionConfirm({ briefKind: "config", name: "调整上榜最低奖励", op: "param", paramKey: "F.leaderboard.minUsd",
              edit: { kind: "number", current: lbMinUsd, unit: "USDT" },
              title: "调整上榜门槛", effect: approvalTag(), confirmLabel: "提交审批",
              statedBrief: { impact: "批准后，本期已解锁奖励低于新门槛的人不参与四个榜的排名和派奖；已发的不变。", check: "后端只接受 0 或正数。" },
              completionCopy: approvalCopy("F4 写权限"),
              detail: `上榜最低奖励 · 当前 ${lbMinUsd} USDT · 低于这个金额不参与排名。` }) })}
          {paramRow({ name: "第 1 名最高占比", value: data.configValues["F.pool.top1MaxPct"] !== undefined ? `${top1MaxPct}%` : "未设置（按 25%）", allowed: canFund,
            what: "排行榜派奖时第 1 名最多拿到奖池的百分比，0–100。只约束排行榜派奖。",
            when: "批准后对还没结算的榜生效，已发的不追回。",
            effect: "超出上限的部分不再分给别人。调高会多发钱给第 1 名。",
            open: () => ctx.openActionConfirm({ briefKind: "config", name: "调整第 1 名最高占比", amplify: true, op: "param", paramKey: "F.pool.top1MaxPct",
              edit: { kind: "number", current: top1MaxPct, unit: "%" },
              title: "调整第 1 名最高占比", effect: approvalTag(), confirmLabel: "提交审批",
              statedBrief: { impact: "批准后，之后排行榜派奖时第 1 名最多拿奖池的这个百分比，超出的部分不再分给别人。只约束排行榜派奖，不影响团队激励池。", check: "后端只接受 0–100。" },
              completionCopy: approvalCopy("F4 资金权限"),
              detail: `第 1 名最多能分到排行榜奖池的百分比 · 当前 ${top1MaxPct}%。` }) })}
          {paramRow({ name: "前 5 名最高占比", value: data.configValues["F.pool.top5MaxPct"] !== undefined ? `${top5MaxPct}%` : "未设置（按 60%）", allowed: canFund,
            what: "排行榜派奖时前 5 名合计最多拿到奖池的百分比，0–100。只约束排行榜派奖。",
            when: "批准后对还没结算的榜生效，已发的不追回。",
            effect: "超出上限的部分不再分给别人。和第 1 名上限各自独立，后端不检查两者的大小关系。",
            open: () => ctx.openActionConfirm({ briefKind: "config", name: "调整前 5 名最高占比", amplify: true, op: "param", paramKey: "F.pool.top5MaxPct",
              edit: { kind: "number", current: top5MaxPct, unit: "%" },
              title: "调整前 5 名最高占比", effect: approvalTag(), confirmLabel: "提交审批",
              statedBrief: { impact: "批准后，之后排行榜派奖时前 5 名合计最多拿奖池的这个百分比，超出的部分不再分给别人。只约束排行榜派奖，不影响团队激励池。", check: "后端只接受 0–100。" },
              completionCopy: approvalCopy("F4 资金权限"),
              detail: `前 5 名合计最多能分到排行榜奖池的百分比 · 当前 ${top5MaxPct}%。` }) })}
        </ConfigList>
      </Panel>
    </div>
  );
}
