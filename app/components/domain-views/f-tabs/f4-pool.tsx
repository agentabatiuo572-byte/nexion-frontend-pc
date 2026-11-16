"use client";

/**
 * F4 · 团队激励池（改版）。这周池里有多少钱、怎么分（各等级票数）、什么时候结算、池的设置。
 * 写入口和请求沿用旧页面：提前结算走 ctx.proposeF4Settlement，参数和票数走 shell 的 param 提交（A2 审批）。
 */
import type { ReactNode } from "react";
import { Calculator, Coins, Settings2, Vote } from "lucide-react";
import { BlockState, Button, ConfigList, ConfigRow, Explain, KeyValues, Notice, Panel, StatusTag, StepBar } from "@/app/components/rd";
import type { F4LeadershipPoolOverview } from "@/lib/admin/f1-client";
import type { validateF4SettlementConfig } from "@/lib/admin/f4-settlement-config";
import { count, decimalText, describeSettleCron, settleCadenceNote, stamp, usdt, zoneNote } from "./f4-shared";
import type { FViewCtx } from "./types";
import type { F4VoteProjection } from "@/lib/admin/f4-vote-projection";

/** Exact product of two decimal texts (votes × USDT per vote); display only, never rounded. */
function times(a: string | number, b: string) {
  const parts = [String(a), b].map(value => { const [whole, fraction = ""] = value.split("."); return { digits: BigInt(whole + fraction), scale: fraction.length }; });
  const scale = parts[0].scale + parts[1].scale, digits = String(parts[0].digits * parts[1].digits).padStart(scale + 1, "0");
  return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
}
const ESTIMATE_GONE: Record<string, string> = {
  CURRENT_WEEK_SETTLED: "本周已经结算，不再估算；实发看「最近已结算」。",
  SETTLEMENT_CONFIG_UNAVAILABLE: "池的设置不完整，算不出本周估算。",
  NO_ELIGIBLE_VOTERS: "现在没有人有资格分，本周估算里没有人能分到钱。",
  NO_CURRENT_POOL: "本周池里还没有钱，算不出每票值。",
};
const weekName = (key: string) => /^\d{6}$/.test(key) ? `${key.slice(0, 4)} 年第 ${Number(key.slice(4))} 周` : key;
import { f4Confirmation, presentText } from "./f4-confirmations";

export { approvalCopy, approvalTag } from "./f4-confirmations";

export function F4Pool({ ctx, data, settlement }: { ctx: FViewCtx; data: F4LeadershipPoolOverview; settlement: ReturnType<typeof validateF4SettlementConfig> }) {
  const canWrite = ctx.can("network_f4_write");
  const canFund = ctx.can("network_f4_pool_fund");
  const canEditVotes = canFund && canWrite;
  const settleCron = data.configValues["F.pool.settleCron"] ?? "";
  const invalid = new Set(settlement.issues.map((issue) => issue.key));
  const invalidLabel = "未设置或格式有误";
  const ratioEff = invalid.has("ratio") ? invalidLabel : presentText(data.poolRatio);
  const capEff = invalid.has("monthlyCap") ? invalidLabel : data.monthlyCapAmount != null ? `${usdt(data.monthlyCapAmount)} USDT` : presentText(data.monthlyCapLabel);
  const unlockLabel = invalid.has("unlockVRank") ? invalidLabel : data.unlockRank > 0 ? `V${data.unlockRank} 及以上` : "未配置";
  const settleCronEff = invalid.has("settleCron") ? invalidLabel : settleCron || "未配置";
  const settleCronText = invalid.has("settleCron") || !settleCron ? settleCronEff : describeSettleCron(settleCron, data.settlementZone) ?? `自定义时间：${settleCron}`;
  // 不是「每周某天」时提醒哪些周会自动结算（只做显示）。
  const cadence = settlement.ready && !invalid.has("settleCron") ? settleCadenceNote(settleCron) : null;
  const configVersionEff = invalid.has("configVersion") ? invalidLabel : presentText(data.configVersion);
  const operable = settlement.ready && !ctx.f4Loading && !ctx.f4Error;
  const blockedCopy = ctx.f4Loading
    ? "正在刷新设置，完成前暂不能提前结算。"
    : ctx.f4Error
      ? "设置刷新失败，为避免按旧设置结算，提前结算已暂停。请点「刷新」重试。"
      : `团队激励池设置不完整：${settlement.issues.map((issue) => issue.label).join("、")} 未设置或格式有误。补齐后刷新。`;
  const settled = data.weeklyInjectedUsd > 0;
  const pool = data.currentWeekPoolAmount ?? data.currentWeekPoolUsd;
  const nextSettle = settlement.ready ? stamp(data.nextSettlementAt) : "—";
  const topShare = data.topN > 0 && data.topSharePct > 0 ? `前 ${data.topN} 名约占 ${data.topSharePct}%` : "—";

  const projection = ctx.f4VoteProjection;
  const estimate = projection.status === "ready" && projection.data.estimate.available ? projection.data.estimate : null;
  const perVote = estimate?.perVoteUsd ?? null;
  const byRank = new Map((estimate?.ranks ?? []).map(rank => [rank.rank, rank]));
  const topRank = estimate && perVote !== null ? [...estimate.ranks].sort((a, b) => Number(b.totalVotes) - Number(a.totalVotes))[0] : undefined;
  const voteValue = (title: string, tag: ReactNode, body: ReactNode) => <section className="f4-vote-value"><h3 className="f4-vote-title">{title}{tag}</h3>{body}</section>;
  const estimateBlock = (() => {
    if (projection.status !== "ready") return null;
    const value = projection.data.estimate;
    if (!value.available) return voteValue("本周估算", <StatusTag tone="neutral" icon={Calculator}>估算</StatusTag>, <p className="f4-vote-note">{ESTIMATE_GONE[value.reason]}</p>);
    return voteValue("本周估算", <StatusTag tone="neutral" icon={Calculator}>估算</StatusTag>, <KeyValues rows={[
      { key: "pool", label: "本周池", value: `${usdt(value.poolUsd)} USDT` },
      { key: "votes", label: "总票数", value: `${decimalText(value.totalVotes).replace(/\.00$/, "")} 票` },
      { key: "per", label: "每票约", value: perVote === null ? "—" : `${usdt(perVote)} USDT`, explain: perVote === null ? "总票数为 0 时算不出每票值。" : "本周池 ÷ 总票数，保留 6 位小数、多出的位数舍去，末位差额给最后一人；每人实收可能和估算差一点。" },
      { key: "top", label: "钱最多的一级", value: topRank && perVote !== null ? `${topRank.rank} · 约 ${usdt(times(topRank.totalVotes, perVote))} USDT（${topRank.eligibleCount} 人）` : "—" },
    ]} />);
  })();
  const settledBlock = (() => {
    if (projection.status !== "ready") return null;
    const value = projection.data.settled;
    if (!value.available) return voteValue("最近已结算的一周", <StatusTag tone="done">实发</StatusTag>, <p className="f4-vote-note">还没有结算记录。</p>);
    return voteValue(`最近已结算 · ${weekName(value.weekKey)}`, <StatusTag tone="done">实发</StatusTag>, <>
      <KeyValues rows={[
        { key: "pool", label: "奖池", value: `${usdt(value.poolUsd)} USDT` },
        { key: "votes", label: "总票数", value: `${decimalText(value.totalVotes).replace(/\.00$/, "")} 票` },
        { key: "per", label: "每票", value: value.perVoteUsd === null ? "—" : `${usdt(value.perVoteUsd)} USDT`, explain: value.perVoteUsd === null ? "这一周记下的总票数为 0，算不出每票值。" : "实发 ÷ 总票数，保留 6 位小数、多出的位数舍去；末位差额给了最后一人。" },
        { key: "users", label: "分到的人", value: `${count(value.settledUsers)} 人` },
      ]} />
      <p className="f4-vote-note">结算记录只有全池的数，没有记各等级分了多少。</p>
    </>);
  })();
  const projectionState = projection.status === "ready" ? null
    : projection.status === "denied" ? <BlockState compact state="denied" title="没有查看每票值的权限" />
      : projection.status === "error" ? <BlockState compact state="error" title="每票值没有读到" detail="请稍后重试；一直读不到请联系值班人员。" onRetry={() => void ctx.refreshF4()} retrying={ctx.f4Loading} />
        : <BlockState compact state="loading" title="正在读取每票值…" />;
  const rankShare = (rank: string) => {
    if (projection.status !== "ready" || !projection.data.estimate.available) return undefined;
    const row = byRank.get(rank);
    if (!row) return "这周没人分";
    return `${count(row.eligibleCount)} 人${perVote === null ? "" : ` · 每人约 ${usdt(times(row.votesPerMember, perVote))} USDT`}`;
  };

  const openSettle = () => ctx.openActionConfirm(f4Confirmation(ctx, { action: "settle", overview: data, policy: ctx.f4AmbassadorPolicy }));

  const voteButton = (row: F4LeadershipPoolOverview["voteWeights"][number]) => {
    const paramKey = row.configKey || `F.pool.votes.${row.v}`;
    if (!canEditVotes) return undefined;
    return <Button size="sm" aria-label={`调整 ${row.v} 票数，当前 ${row.votes} 票`} onClick={() => ctx.openActionConfirm(f4Confirmation(ctx, { action: paramKey, overview: data, policy: ctx.f4AmbassadorPolicy }))}>改票数</Button>;
  };

  const paramRow = (spec: { name: string; value: string; sub?: ReactNode; mono?: boolean; what: string; when: string; effect: string; note?: string; allowed: boolean; open: () => void }) => (
    <ConfigRow key={spec.name} name={spec.name} what={spec.what} when={spec.when} effect={spec.effect} note={spec.note} sub={spec.sub}
      value={spec.mono ? <span data-mono>{spec.value}</span> : spec.value}
      action={spec.allowed ? <Button size="sm" onClick={spec.open}>调整</Button> : undefined} />
  );

  return (
    <div className="f4-stack">
      <Panel title="本周这笔钱" icon={Coins} tone="role-1" sub={`金额 USDT · 时间为${zoneNote()}`}
        explain={<>
          <p>已结算的一周显示实际发出的金额；还没结算时按本周已付款成交额 × 奖池比例估算，不超过本月剩余额度，保留 6 位小数。</p>
          <p>估算不是已经发的钱，批准执行时会重新计算。</p>
        </>}
        actions={canFund ? <Button variant="primary" disabledReason={operable ? undefined : blockedCopy} onClick={openSettle}>提前结算本周池</Button> : undefined}>
        {!operable && <Notice tone="warn" title="提前结算已暂停"
          action={<Button size="sm" loading={ctx.f4Loading} onClick={() => void ctx.refreshF4()}>刷新设置</Button>}>{blockedCopy}</Notice>}
        <div className="f4-pool-hero">
          <div className="f4-pool-amount">
            <span className="f4-pool-label">
              {settled ? "本周已结算" : "本周池"}
              {settled ? <StatusTag tone="done">实发</StatusTag> : <StatusTag tone="neutral" icon={Calculator}>估算</StatusTag>}
            </span>
            <span className="f4-pool-value" data-zero={pool === null || Number(pool) === 0 ? "" : undefined}>{usdt(pool)}{pool !== null && <small>USDT</small>}</span>
            <span className="f4-pool-note">{pool === null
              ? `暂时无法估算：${data.settlementConfigUnavailableReason || "设置不完整"}`
              : `本周已付款成交额约 ${count(data.weeklyGmvUsd)} USDT（取整）× ${ratioEff}，每月上限 ${capEff}`}</span>
          </div>
          <KeyValues rows={[
            { key: "people", label: "有资格分的人", value: `${count(data.participantCount)} 人`, explain: `达到参与等级（${unlockLabel}）且所在等级票数大于 0 的人数合计。` },
            { key: "top", label: "头部集中度（估算）", value: topShare, explain: "按各等级人数和票数估算票数最多的几个人合计占全部票数的比例，不是已经收到的钱。" },
            { key: "next", label: "下次自动结算", value: nextSettle, sub: cadence ? <span className="f4-cadence" data-tone={cadence.tone}>{cadence.tag}</span> : undefined, explain: "自动结算的是最近一个已结束的周；提前结算的是执行那一刻的当前周。" },
          ]} />
        </div>
      </Panel>

      <Panel title="这周的钱怎么分" icon={Vote} tone="role-4" sub={`按等级票数 · 有资格的 ${count(data.participantCount)} 人`}
        explain={<>
          <p>每个等级每人的票数。结算时按「人数 × 票数」分池：票数越高，同一等级每人分得越多，池的总额不变。</p>
          <p>只显示票数大于 0 的等级。每级的人数和「每人约」按现在有资格的人估算，人数按结算时的分法数，和「有资格分的人」统计方式不同，合计可能对不上。</p>
          <p>每票值是平均数：保留 6 位小数、多出的位数舍去，末位差额给最后一人，所以每人实收可能和估算差一点。已结算的周只记了全池的数，没有各等级分了多少。</p>
        </>}>
        <StepBar label="各等级每人的票数" unit="票" state={data.voteWeights.length ? "ready" : "empty"}
          emptyText="票数还没设置：没有票数大于 0 的等级，结算时没有人能分到钱。"
          items={data.voteWeights.map((row) => ({ key: row.v, label: row.v, value: row.votes, valueText: count(row.votes), secondary: rankShare(row.v), actions: voteButton(row) }))} />
        {projectionState ?? <div className="f4-vote-values">{estimateBlock}{settledBlock}</div>}
      </Panel>

      <Panel title="池的设置" icon={Settings2} tone="role-4" sub="批准后生效"
        explain="这几项一起决定池能不能结算、每周放多少钱。任一项没设或格式不对，池就不能结算。头部占比两项只限制排行榜派奖，放在「排行榜」。">
        <ConfigList label="团队激励池设置">
          {paramRow({ name: "奖池比例", value: ratioEff, allowed: canFund,
            what: "每周已付款成交额里放进团队激励池的百分比，可填 0–30%。",
            when: "批准后，还没结算的估算和之后的结算按新比例算；已发的不重算。",
            effect: "调高会多发钱，提交前看兑付覆盖率。",
            open: () => ctx.openActionConfirm(f4Confirmation(ctx, { action: "F.pool.ratio", overview: data, policy: ctx.f4AmbassadorPolicy })) })}
          {paramRow({ name: "每月上限", value: capEff, allowed: canWrite,
            what: "团队激励池一个月最多发多少，按自然月累计。",
            when: "批准后影响这个月还没结算的部分，已发的不追回。",
            effect: "本周估算不会超过「上限 − 本月已发」。",
            note: "格式不对的值也会存下来，存下后池就不能结算，请按「1000」「50K」这类写法填。",
            open: () => ctx.openActionConfirm(f4Confirmation(ctx, { action: "F.pool.monthlyCap", overview: data, policy: ctx.f4AmbassadorPolicy })) })}
          {paramRow({ name: "自动结算时间", value: settleCronText, sub: cadence ? <span className="f4-cadence" data-tone={cadence.tone}>{cadence.text}</span> : undefined, allowed: canWrite,
            what: "到这个时间自动结算最近一个已结束的周。",
            when: `批准后的下一次命中就按新时间。按${data.settlementZone?.label ?? "—"}解析；「下次自动结算」换算成了${zoneNote()}。`,
            note: settleCron ? `保存的原文：${settleCron}` : undefined,
            effect: "不影响已经结算的周。",
            open: () => ctx.openActionConfirm(f4Confirmation(ctx, { action: "F.pool.settleCron", overview: data, policy: ctx.f4AmbassadorPolicy })) })}
          {paramRow({ name: "参与等级", value: unlockLabel, allowed: canWrite,
            what: "达到这个等级、且等级票数大于 0 才能分团队激励池，可选 V1–V8。",
            when: "批准后按结算那一刻的值；已发的不追溯。",
            effect: "调高参与人数变少，调低参与人数变多。",
            open: () => ctx.openActionConfirm(f4Confirmation(ctx, { action: "F.pool.unlockVRank", overview: data, policy: ctx.f4AmbassadorPolicy })) })}
          <ConfigRow name="设置版本" what="上面几项都合法时后端生成的版本号，只读。" value={<span data-mono>{configVersionEff}</span>} />
        </ConfigList>
      </Panel>
      <p className="f4-foot">补发、冲正、冻结奖励在「奖励记录核对」处理。<Explain label="三块怎么生效" content="团队激励池、购机名额、大使申请、排行榜各自独立生效；这页的写操作除了材料核验和不放宽预算的大使规则，都要另一位管理员批准。" /></p>
    </div>
  );
}
