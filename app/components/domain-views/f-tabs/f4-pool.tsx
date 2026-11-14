"use client";

/**
 * F4 · 团队激励池（改版）。这周池里有多少钱、怎么分（各等级票数）、什么时候结算、池的设置。
 * 写入口和请求沿用旧页面：提前结算走 ctx.proposeF4Settlement，参数和票数走 shell 的 param 提交（A2 审批）。
 */
import type { ReactNode } from "react";
import { Calculator, Coins, Settings2, Vote } from "lucide-react";
import { Button, ConfigList, ConfigRow, Explain, Fact, Facts, KeyValues, Notice, Panel, StatusTag, StepBar } from "@/app/components/rd";
import type { F4LeadershipPoolOverview } from "@/lib/admin/f1-client";
import type { validateF4SettlementConfig } from "@/lib/admin/f4-settlement-config";
import { count, describeSettleCron, settleCadenceNote, SETTLE_ZONE, stamp, usdt, zoneNote } from "./f4-shared";
import type { FViewCtx } from "./types";

// 领导奖池参与门槛枚举(V0 为新人,无奖池资格 → 从 V1 起)。
const POOL_UNLOCK_OPTIONS = ["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8"];

/** A2 普通提案：谁来批、批准前不变。需要的权限只在这里写一次。 */
export function approvalCopy(permission: string) {
  return `提交后由另一位管理员在「操作记录与审批」批准才生效，批准前保持现在的设置。批准人需有${/^[A-Za-z0-9]/.test(permission) ? " " : ""}${permission}和审批权限，不能是你自己。`;
}

export function approvalTag() {
  return <StatusTag tone="progress" filled>批准后生效</StatusTag>;
}

function presentText(value: string, fallback = "未配置") {
  return value.trim() ? value : fallback;
}

export function F4Pool({ ctx, data, settlement }: { ctx: FViewCtx; data: F4LeadershipPoolOverview; settlement: ReturnType<typeof validateF4SettlementConfig> }) {
  const canWrite = ctx.can("network_f4_write");
  const canFund = ctx.can("network_f4_pool_fund");
  // F4-P03：票数入口现在按资金权限判断（旧页面写法）；代码 worker 会改成资金权限和写权限都要有。
  const canEditVotes = canFund;
  const settleCron = data.configValues["F.pool.settleCron"] ?? "";
  const unlockVRank = data.configValues["F.pool.unlockVRank"] ?? "";
  const invalid = new Set(settlement.issues.map((issue) => issue.key));
  const invalidLabel = "未设置或格式有误";
  const ratioEff = invalid.has("ratio") ? invalidLabel : presentText(data.poolRatio);
  const capEff = invalid.has("monthlyCap") ? invalidLabel : data.monthlyCapUsd > 0 ? `${usdt(data.monthlyCapUsd)} USDT` : presentText(data.monthlyCapLabel);
  const unlockLabel = invalid.has("unlockVRank") ? invalidLabel : data.unlockRank > 0 ? `V${data.unlockRank} 及以上` : "未配置";
  const settleCronEff = invalid.has("settleCron") ? invalidLabel : settleCron || "未配置";
  const settleCronText = invalid.has("settleCron") || !settleCron ? settleCronEff : describeSettleCron(settleCron) ?? `自定义时间：${settleCron}`;
  // 不是「每周某天」时提醒哪些周会自动结算（只做显示）。
  const cadence = settlement.ready && !invalid.has("settleCron") ? settleCadenceNote(settleCron) : null;
  const unlockVRankEff = invalid.has("unlockVRank") ? invalidLabel : unlockVRank || "未配置";
  const configVersionEff = invalid.has("configVersion") ? invalidLabel : presentText(data.configVersion);
  const operable = settlement.ready && !ctx.f4Loading && !ctx.f4Error;
  const blockedCopy = ctx.f4Loading
    ? "正在刷新设置，完成前暂不能提前结算。"
    : ctx.f4Error
      ? "设置刷新失败，为避免按旧设置结算，提前结算已暂停。请点「刷新」重试。"
      : `团队激励池设置不完整：${settlement.issues.map((issue) => issue.label).join("、")} 未设置或格式有误。补齐后刷新。`;
  const settled = data.weeklyInjectedUsd > 0;
  const pool = data.currentWeekPoolUsd;
  const nextSettle = settlement.ready ? stamp(data.nextSettlementAt) : "—";
  const topShare = data.topN > 0 && data.topSharePct > 0 ? `前 ${data.topN} 名约占 ${data.topSharePct}%` : "—";

  const openSettle = () => ctx.openActionConfirm({
    briefKind: "funds",
    name: "提前结算本周团队激励池",
    amplify: true,
    title: "提前结算本周团队激励池",
    effect: approvalTag(), confirmLabel: "提交审批",
    statedBrief: {
      impact: "批准后按执行那一刻的当前周重新计算池金额，并作为已解锁的 USDT 奖励真实入账到有资格的用户；本周已经结算过的会跳过，不补发差额。",
      check: "执行时按当时的设置和票数重新计算；不检查兑付覆盖率。",
    },
    completionCopy: approvalCopy("F4 资金权限"),
    coverageLead: "这次结算会真实发钱",
    coverageCheck: "后端执行这次结算时不检查兑付覆盖率，下面是现在读到的数，请自己判断。",
    facts: <Facts>
      <Fact k={settled ? "本周已结算（实发）" : "本周池（估算）"} lead tone="role-1" unit={pool === null ? undefined : "USDT"}>{usdt(pool)}</Fact>
      <Fact k="有资格分的人">{count(data.participantCount)} 人（{unlockLabel}且有票）</Fact>
      <Fact k="怎么分">按各等级票数分，最后一位领取尾差</Fact>
    </Facts>,
    detail: "池金额 = 本周已付款成交额 × 奖池比例，不含退款和拒付，不超过本月剩余额度；按当前等级和票数分给达到参与等级的人。估算是现在读到的数，批准执行时会重新计算，可能和这里不同；没有合格票时不发钱。",
    run: async (reason) => {
      await ctx.proposeF4Settlement(reason);
    },
  });

  const voteButton = (row: F4LeadershipPoolOverview["voteWeights"][number]) => {
    const paramKey = row.configKey || `F.pool.votes.${row.v}`;
    if (!canEditVotes) return canWrite ? <Button size="sm" disabledReason="改票数需要F4 资金权限">改票数</Button> : undefined;
    return <Button size="sm" aria-label={`调整 ${row.v} 票数，当前 ${row.votes} 票`} onClick={() => ctx.openActionConfirm({
      briefKind: "config", name: `调整 ${row.v} 票数`, amplify: true, op: "param", paramKey,
      edit: { kind: "number", current: String(row.votes), unit: "票", min: 0, step: 1, amplifiesWhen: "increase" },
      title: `调整 ${row.v} 的票数`,
      effect: approvalTag(), confirmLabel: "提交审批",
      statedBrief: {
        impact: "批准后，之后还没结算的团队激励池按新票数分；已经发出的不变。票数改成 0 后这个等级不再显示在这页，也不能在这页改回。",
        check: "调高票数时提醒先看兑付覆盖率；后端只接受 0 到 1,000,000 的整数，小数会被向下取整。",
      },
      completionCopy: approvalCopy("F4 写权限"),
      detail: `${row.v} 当前 ${row.votes} 票。票数越多，这个等级每人分到的团队激励池越多；池的总额不会因此变大。`,
    })}>改票数</Button>;
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
            <span className="f4-pool-value" data-zero={pool === null || pool === 0 ? "" : undefined}>{usdt(pool)}{pool !== null && <small>USDT</small>}</span>
            <span className="f4-pool-note">{pool === null
              ? `暂时无法估算：${data.settlementConfigUnavailableReason || "设置不完整"}`
              : `本周已付款成交额 ${usdt(data.weeklyGmvUsd)} USDT × ${ratioEff}，每月上限 ${capEff}`}</span>
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
          <p>只显示票数大于 0 的等级。各等级人数和每票值多少接口没有给，这里不显示。</p>
        </>}>
        <StepBar label="各等级每人的票数" unit="票" state={data.voteWeights.length ? "ready" : "empty"}
          emptyText="票数还没设置：没有票数大于 0 的等级，结算时没有人能分到钱。"
          items={data.voteWeights.map((row) => ({ key: row.v, label: row.v, value: row.votes, valueText: count(row.votes), actions: voteButton(row) }))} />
      </Panel>

      <Panel title="池的设置" icon={Settings2} tone="role-4" sub="批准后生效"
        explain="这几项一起决定池能不能结算、每周放多少钱。任一项没设或格式不对，池就不能结算。头部占比两项只限制排行榜派奖，放在「排行榜」。">
        <ConfigList label="团队激励池设置">
          {paramRow({ name: "奖池比例", value: ratioEff, allowed: canFund,
            what: "每周已付款成交额里放进团队激励池的百分比，后端接受 0–30%。",
            when: "批准后，还没结算的估算和之后的结算按新比例算；已发的不重算。",
            effect: "调高会多发钱，提交前看兑付覆盖率。",
            open: () => ctx.openActionConfirm({ briefKind: "config", name: "调整团队激励池比例", amplify: true, op: "param", paramKey: "F.pool.ratio",
              edit: { kind: "text", current: data.poolRatio, unit: "%" },
              title: "调整团队激励池比例", effect: approvalTag(), confirmLabel: "提交审批",
              statedBrief: { impact: "批准后，还没结算的这周估算和之后每次结算按新比例放钱；已经发的不重算。", check: "后端只接受 0–30 的百分数，比如 5 表示 5%，0.05 表示 0.05%。" },
              completionCopy: approvalCopy("F4 资金权限"),
              detail: `每周已付款成交额中放进团队激励池的比例 · 当前 ${ratioEff}。` }) })}
          {paramRow({ name: "每月上限", value: capEff, allowed: canWrite,
            what: "团队激励池一个月最多发多少，按自然月累计。",
            when: "批准后影响这个月还没结算的部分，已发的不追回。",
            effect: "本周估算不会超过「上限 − 本月已发」。",
            note: "后端会把格式不对的值也存下来，存下后池就不能结算，请按「1000」「50K」这类写法填。",
            open: () => ctx.openActionConfirm({ briefKind: "config", name: "调整团队激励池每月上限", op: "param", paramKey: "F.pool.monthlyCap",
              edit: { kind: "text", current: data.monthlyCapLabel },
              title: "调整团队激励池每月上限", effect: approvalTag(), confirmLabel: "提交审批",
              statedBrief: { impact: "批准后影响这个月还没结算的部分；已经发出的不追回。", check: "后端不在保存时检查格式，格式不对会让池变成不能结算，请写数字，可带 K、M。" },
              completionCopy: approvalCopy("F4 写权限"),
              detail: `团队激励池每月最多发多少 · 当前 ${capEff}。` }) })}
          {paramRow({ name: "自动结算时间", value: settleCronText, sub: cadence ? <span className="f4-cadence" data-tone={cadence.tone}>{cadence.text}</span> : undefined, allowed: canWrite,
            what: "到这个时间自动结算最近一个已结束的周。",
            when: `批准后的下一次命中就按新时间。按${SETTLE_ZONE.label}解析；「下次自动结算」换算成了${zoneNote()}。`,
            note: settleCron ? `后端保存的写法：${settleCron}` : undefined,
            effect: "不影响已经结算的周。",
            open: () => ctx.openActionConfirm({ briefKind: "config", name: "调整团队激励池结算时间", op: "param", paramKey: "F.pool.settleCron",
              edit: { kind: "text", current: settleCron, unit: "定时表达式",
                hint: "秒 分 时 日 月 星期，比如 0 0 2 * * MON",
                preview: (value) => `这样写是：${describeSettleCron(value) ?? "自定义时间，页面读不出，后端按原文解析"}。${settleCadenceNote(value)?.text ?? "每周自动结算一次，结算刚结束的那一周。"}` },
              title: "调整自动结算时间", effect: approvalTag(), confirmLabel: "提交审批",
              facts: <Facts><Fact k="现在是">{settleCronText}</Fact>{cadence && <Fact k="会结算哪些周" tone={cadence.tone === "warn" ? "warn" : undefined}>{cadence.text}</Fact>}<Fact k="按哪个时区">{SETTLE_ZONE.label}（UTC+7）</Fact></Facts>,
              statedBrief: { impact: "批准后的下一次命中就按新时间自动结算最近一个已结束的周；已经结算的不变。", check: "后端只接受 5 段或 6 段的定时表达式，其余拒绝。" },
              completionCopy: approvalCopy("F4 写权限"),
              detail: `团队激励池自动结算时间 · 当前 ${settleCronText}。` }) })}
          {paramRow({ name: "参与等级", value: unlockLabel, allowed: canWrite,
            what: "达到这个等级、且等级票数大于 0 才能分团队激励池，可选 V1–V8。",
            when: "批准后按结算那一刻的值；已发的不追溯。",
            effect: "调高参与人数变少，调低参与人数变多。",
            open: () => ctx.openActionConfirm({ briefKind: "config", name: "调整团队激励池参与等级", op: "param", paramKey: "F.pool.unlockVRank",
              edit: { kind: "select", current: unlockVRank, options: POOL_UNLOCK_OPTIONS },
              title: "调整参与等级", effect: approvalTag(), confirmLabel: "提交审批",
              statedBrief: { impact: "批准后，之后的结算只分给达到新等级的人；已经发出的不追溯。", check: "只能选 V1–V8。" },
              completionCopy: approvalCopy("F4 写权限"),
              detail: `达到这个等级才能分团队激励池 · 当前 ${unlockVRankEff}。调高参与人数变少，调低参与人数变多。` }) })}
          <ConfigRow name="设置版本" what="上面几项都合法时后端生成的版本号，只读。" value={<span data-mono>{configVersionEff}</span>} />
        </ConfigList>
      </Panel>
      <p className="f4-foot">补发、冲正、冻结奖励在「奖励记录核对」处理。<Explain label="三块怎么生效" content="团队激励池、购机名额、大使申请、排行榜各自独立生效；这页的写操作除了材料核验和不放宽预算的大使规则，都要另一位管理员批准。" /></p>
    </div>
  );
}
