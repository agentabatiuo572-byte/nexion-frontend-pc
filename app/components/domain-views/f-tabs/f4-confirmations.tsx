"use client";

/** Existing F4 confirmation markup, shared by new edits and saved originals. */
import { Facts, Fact, KeyValues, StatusTag } from "@/app/components/rd";
import { f4WeeklyCronIssue, validateF4SettlementConfig } from "@/lib/admin/f4-settlement-config";
import { ambassadorBucketLabel } from "@/lib/admin/f4-ambassador-display";
import type { F4ConfirmationSnapshot } from "@/lib/admin/f4-approval";
import type { F4LeadershipPoolOverview } from "@/lib/admin/f1-client";
import { count, describeSettleCron, minPointsText, settleCadenceNote, stamp, usdt, zoneNote, moneyText } from "./f4-shared";
import { f4Decimal, f4HeadCapAmplifies, f4MoneyAmplifies, f4MonthlyCap, f4PeriodPrizes } from "@/lib/admin/f4-money";
import { displayAdminError } from "@/lib/admin/error-messages";
import { f4PolicyConfirmation } from "./f4-policy-confirm";
import { F4DisqualifyEvidenceFact, F4PayoutPreviewFacts, F4PayoutRules } from "./f4-payout-preview";
import type { FViewCtx, McSpec } from "./types";

/** 奖池金额（每月上限、周榜奖池）：页面先按后端同一规则查，格式不对提交不了。 */
const POOL_MONEY_HINT = "0 或正数，可带 $、逗号，末尾可带 K 或 M，比如 50K";
const POOL_MONEY_INVALID = "要填 0 或正数，可带 $、逗号，末尾可带 K 或 M";
const POOL_MONEY_CHECK = "格式不对提交不了；批准时系统也会再查一次。";

/** 结算时间不是每周一次时，指出错在哪一段（判断仍以 f4WeeklyCronIssue 为准，这里只挑说法）。 */
function weeklyCronProblem(value: string, issue: string) {
  const fields = value.trim().split(/\s+/);
  if (fields.length === 5) fields.unshift("0");
  if (fields.length !== 6) return "要写 5 段或 6 段，比如 0 0 2 * * MON";
  if (issue !== "F4_SETTLE_CRON_WEEKLY_REQUIRED") return "秒、分不能超过 59，时不能超过 23";
  const [second, minute, hour, day, month, week] = fields;
  if (![second, minute, hour].every(item => /^\d+$/.test(item))) return "秒、分、时要写固定的数字，比如 0 0 2";
  if (!["*", "?"].includes(day)) return "「日」这一段要写 * 或 ?，不能指定几号";
  if (month !== "*") return "「月」这一段要写 *，不能指定月份";
  if (!/^(?:[0-7]|MON|TUE|WED|THU|FRI|SAT|SUN)$/i.test(week)) return "「星期」这一段只写一天，比如 MON";
  return displayAdminError(new Error(issue));
}

// 领导奖池参与门槛枚举(V0 为新人,无奖池资格 → 从 V1 起)。
const POOL_UNLOCK_OPTIONS = ["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8"];

/** A2 普通提案：批准前不变；谁来批、需有权限写在事实区，需要的权限只写一次。 */
export const approvalCopy = "批准前保持现在的设置。";
function approvalRows(permission: string) {
  return [
    { key: "approver", label: "谁来批", value: "另一位管理员，不能是你" },
    { key: "permission", label: "需有权限", value: `${permission}和审批权限` },
  ];
}
function approvalFacts(permission: string) {
  return approvalRows(permission).map((row) => <Fact key={row.key} k={row.label}>{row.value}</Fact>);
}

export function approvalTag() {
  return <StatusTag tone="progress" filled>批准后生效</StatusTag>;
}

export function presentText(value: string, fallback = "未配置") {
  return value.trim() ? value : fallback;
}


type Period = "today" | "week" | "month" | "all";
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


export function f4Confirmation(ctx: FViewCtx, snapshot: F4ConfirmationSnapshot): McSpec {
  const { overview: data, action, policy, application, material: packet } = snapshot;
  const period = snapshot.period ?? "week";
  const settlement = validateF4SettlementConfig({ status: data.settlementConfigStatus, unavailableKey: data.settlementConfigUnavailableKey, configVersion: data.configVersion, ratio: data.configValues["F.pool.ratio"], monthlyCap: data.configValues["F.pool.monthlyCap"], unlockVRank: data.configValues["F.pool.unlockVRank"], settleCron: data.configValues["F.pool.settleCron"] });
  const settleCron = data.configValues["F.pool.settleCron"] ?? "";
  const unlockVRank = data.configValues["F.pool.unlockVRank"] ?? "";
  const invalid = new Set(settlement.issues.map((issue) => issue.key));
  const invalidLabel = "未设置或格式有误";
  const ratioEff = invalid.has("ratio") ? invalidLabel : presentText(data.poolRatio);
  const capEff = invalid.has("monthlyCap") ? invalidLabel : data.monthlyCapAmount != null ? `${usdt(data.monthlyCapAmount)} USDT` : presentText(data.monthlyCapLabel);
  const unlockLabel = invalid.has("unlockVRank") ? invalidLabel : data.unlockRank > 0 ? `V${data.unlockRank} 及以上` : "未配置";
  const settleCronEff = invalid.has("settleCron") ? invalidLabel : settleCron || "未配置";
  const settleCronText = invalid.has("settleCron") || !settleCron ? settleCronEff : describeSettleCron(settleCron, data.settlementZone) ?? `自定义时间：${settleCron}`;
  // 不是「每周某天」时提醒哪些周会自动结算（只做显示）。
  const cadence = settlement.ready && !invalid.has("settleCron") ? settleCadenceNote(settleCron) : null;
  const unlockVRankEff = invalid.has("unlockVRank") ? invalidLabel : unlockVRank || "未配置";
  const settled = data.weeklyInjectedUsd > 0;
  const pool = data.currentWeekPoolAmount ?? data.currentWeekPoolUsd;
  const board = leaderboardState(data);
  const current = data.leaderboardComputePointPeriods?.[period];
  const lbMinPoints = data.configValues["F.leaderboard.minComputePoints"];
  const top1MaxPct = data.configValues["F.pool.top1MaxPct"]?.trim() || "25";
  const top5MaxPct = data.configValues["F.pool.top5MaxPct"]?.trim() || "60";
  const periodPrizeRaw = data.configValues["F.pool.periodPrize"] ?? "";
  const periodPrizes = f4PeriodPrizes(periodPrizeRaw);
  const currentPeriodPrize = (key: Period) => {
    const configured = periodPrizes?.[key === "all" ? "allTime" : key];
    if (configured !== undefined) return configured;
    const liveAmount = board.paused ? undefined : data.leaderboardComputePointPeriods?.[key]?.poolUsdText ?? data.leaderboardComputePointPeriods?.[key]?.poolUsd;
    return liveAmount === undefined ? "" : String(liveAmount);
  };
  const ppToday = currentPeriodPrize("today");
  const ppWeek = currentPeriodPrize("week");
  const ppMonth = currentPeriodPrize("month");
  const ppAllTime = currentPeriodPrize("all");
  const prizeShown = (value: string) => value === "" ? "—" : moneyText(value);
  const lbPool = current ? `${usdt(current.poolUsdText ?? current.poolUsd)} USDT` : "—";

  const quota = data.quotaRows.find(row => action === `F.quota.tier.${row.quotaCode || row.id}.monthlyQuota`)!;
  const usage = data.quotaUsages.find(row => action === `F.quota.usage.${row.id}.status`)!;
  const paramKey = action;
  const productName = (usage: typeof data.quotaUsages[number]) => data.quotaRows.find(row => (usage.quotaCode && row.quotaCode === usage.quotaCode) || (usage.productNo && row.productNo === usage.productNo))?.name ?? (usage.productNo || usage.quotaCode);
  const money = (value: number | string | null | undefined) => value == null ? "尚未认可" : `${String(value)} USDT`;
  let spec: McSpec;
  switch (true) {
    case action === "settle": {
      spec = {
    briefKind: "funds",
    name: "提前结算本周团队激励池",
    amplify: true,
    title: "提前结算本周团队激励池",
    effect: approvalTag(), confirmLabel: "提交审批",
    statedBrief: {
      impact: "批准后按执行那一刻的当前周重新计算池金额，并作为已解锁的 USDT 奖励真实入账到有资格的用户；本周已经结算过的会跳过，不补发差额。",
      check: "批准时先查兑付覆盖率：读不到或低于红线就不发钱，审批单留着待审批。",
    },
    completionCopy: approvalCopy,
    coverageLead: "这次结算按算出的金额真实发钱",
    coverageCheck: "提交时按这里的数查一次。批准时系统再查：读不到或低于红线就不发钱，审批单留着，可等覆盖率恢复后再批，或驳回；等于红线算够。每周自动结算不做这项检查。",
    facts: <Facts>
      <Fact k={settled ? "本周已结算（实发）" : "本周池（估算）"} lead tone="role-1" unit={pool === null ? undefined : "USDT"}>{usdt(pool)}</Fact>
      <Fact k="有资格分的人">{count(data.participantCount)} 人（{unlockLabel}且有票）</Fact>
      <Fact k="怎么分">按各等级票数分，最后一位领取尾差</Fact>
      {approvalFacts("「奖池资金类调整」")}
    </Facts>,
    detail: "池金额 = 本周已付款成交额 × 奖池比例，不含退款和拒付，不超过本月剩余额度；按当前等级和票数分给达到参与等级的人。估算是现在读到的数，批准执行时会重新计算，可能和这里不同；没有合格票时不发钱。",
    run: async (reason) => {
      await ctx.proposeF4Settlement(reason);
    },
  };
      break;
    }
    case action.startsWith("F.pool.votes."): {
      const vote = data.voteWeights.find(row => (row.configKey || `F.pool.votes.${row.v}`) === action)!;
      spec = {
      briefKind: "config", name: `调整 ${vote.v} 票数`, amplify: true, op: "param", paramKey,
      edit: { kind: "number", current: String(vote.votes), unit: "票", min: 0, step: 1, amplifiesWhen: "increase" },
      title: `调整 ${vote.v} 的票数`,
      effect: approvalTag(), confirmLabel: "提交审批",
      statedBrief: {
        impact: "批准后，之后还没结算的团队激励池按新票数分；已经发出的不变。改成 0 后这一级不再分池，仍留在这页，之后可以改回。",
        check: "调高票数时先看兑付覆盖率；填 0 到 1,000,000，带小数时只取整数部分。",
      },
      coverageLead: "调高票数：池的总额不变，这一级多分、其他等级少分",
      coverageCheck: "批准时系统查兑付覆盖率，低于红线不执行。",
      completionCopy: approvalCopy, facts: <Facts>{approvalFacts("这页的常规修改")}</Facts>,
      detail: `${vote.v} 当前 ${vote.votes} 票。票数越多，这个等级每人分到的团队激励池越多；池的总额不会因此变大。`,
    };
      break;
    }
    case action === "F.pool.ratio": {
      spec = { briefKind: "config", name: "调整团队激励池比例", amplify: true, op: "param", paramKey: "F.pool.ratio",
              edit: { kind: "text", current: data.poolRatio, unit: "%" },
              title: "调整团队激励池比例", effect: approvalTag(), confirmLabel: "提交审批",
              statedBrief: { impact: "批准后，还没结算的这周估算和之后每次结算按新比例放钱；已经发的不重算。", check: "只接受 0–30 的百分数：5 表示 5%，0.05 表示 0.05%。" },
              completionCopy: approvalCopy, facts: <Facts>{approvalFacts("「奖池资金类调整」")}</Facts>,
              detail: `放进团队激励池的成交额比例，现在是 ${ratioEff}。` };
      break;
    }
    case action === "F.pool.monthlyCap": {
      spec = { briefKind: "config", name: "调整团队激励池每月上限", amplify: true, op: "param", paramKey: "F.pool.monthlyCap",
              edit: { kind: "text", current: data.configValues["F.pool.monthlyCap"] ?? data.monthlyCapLabel,
                amplifiesWhen: value => f4MoneyAmplifies("F.pool.monthlyCap", data.configValues, value),
                validate: value => f4MonthlyCap(value) === null ? POOL_MONEY_INVALID : undefined, hint: POOL_MONEY_HINT },
              title: "调整团队激励池每月上限", effect: approvalTag(), confirmLabel: "提交审批",
              statedBrief: { impact: "批准后影响这个月还没结算的部分；已经发出的不追回。", check: POOL_MONEY_CHECK },
              completionCopy: approvalCopy, facts: <Facts>{approvalFacts("这页的常规修改")}</Facts>,
              detail: `团队激励池每月最多发多少 · 当前 ${capEff}。` };
      break;
    }
    case action === "F.pool.settleCron": {
      spec = { briefKind: "config", name: "调整团队激励池结算时间", op: "param", paramKey: "F.pool.settleCron",
              edit: { kind: "text", current: settleCron, unit: "定时表达式",
                validate: value => { const issue = f4WeeklyCronIssue(value); return issue ? weeklyCronProblem(value, issue) : undefined; },
                hint: `每周一次，比如 0 0 2 * * MON 是${describeSettleCron("0 0 2 * * MON", data.settlementZone) ?? "每周一 02:00"}`,
                preview: (value) => `这样写是：${describeSettleCron(value, data.settlementZone) ?? "自定义时间，页面读不出，系统按原文执行"}。${settleCadenceNote(value)?.text.replace("按现在的设置", "按这个设置") ?? (value.trim() ? "每周自动结算一次，结算刚结束的那一周。" : "")}` },
              title: "调整自动结算时间", effect: approvalTag(), confirmLabel: "提交审批",
              facts: <Facts><Fact k="现在是">{settleCronText}</Fact>{cadence && <Fact k="会结算哪些周" tone={cadence.tone === "warn" ? "warn" : undefined}>{cadence.text}</Fact>}<Fact k="按哪个时区">{data.settlementZone ? `${data.settlementZone.label}（${data.settlementZone.offset}）` : "—"}</Fact>{approvalFacts("这页的常规修改")}</Facts>,
              statedBrief: { impact: "批准后的下一次命中就按新时间自动结算最近一个已结束的周；已经结算的不变。", check: "只能设成每周一次，写错提交不了；现在不是每周一次的旧设置照常执行，不会自动改。" },
              completionCopy: approvalCopy,
              detail: `团队激励池自动结算时间 · 当前 ${settleCronText}。` };
      break;
    }
    case action === "F.pool.unlockVRank": {
      spec = { briefKind: "config", name: "调整团队激励池参与等级", op: "param", paramKey: "F.pool.unlockVRank",
              edit: { kind: "select", current: unlockVRank, options: POOL_UNLOCK_OPTIONS },
              title: "调整参与等级", effect: approvalTag(), confirmLabel: "提交审批",
              statedBrief: { impact: "批准后，之后的结算只分给达到新等级的人；已经发出的不追溯。", check: "只能选 V1–V8。" },
              completionCopy: approvalCopy, facts: <Facts>{approvalFacts("这页的常规修改")}</Facts>,
              detail: `达到这个等级才能分团队激励池 · 当前 ${unlockVRankEff}。调高参与人数变少，调低参与人数变多。` };
      break;
    }
    case action.startsWith("F.quota.tier."): {
      spec = { briefKind: "config",
    name: `${quota.name} 月额度调整`, op: "param",
    paramKey: `F.quota.tier.${quota.quotaCode || quota.id}.monthlyQuota`,
    expectedVersion: quota.monthlyQuota === undefined ? quota.cap : quota.monthlyQuota === null ? undefined : Number(quota.monthlyQuota),
    edit: { kind: "number", current: quota.monthlyQuota === undefined ? String(quota.cap) : quota.monthlyQuota ?? "", unit: "台",
      preview: (value) => {
        if (!/^\d+$/.test(value.trim())) return null;
        const next = Number(value), now = quota.monthlyQuota === undefined ? quota.cap : Number(quota.monthlyQuota);
        if (next > now && next < quota.current) return `调高时不能低于本月已用 ${count(quota.current)} 台，批准时会被拒绝。`;
        if (quota.status === 0) return null;
        if (next <= quota.current) return `本月已用 ${count(quota.current)} 台，调整后当前没有可售名额。`;
        return `改完本月还剩 ${count(next - quota.current)} 台。`;
      } },
    title: `调整 ${quota.name} 的月额度`, effect: approvalTag(), confirmLabel: "提交审批",
    statedBrief: {
      impact: "批准后限制这个商品之后的购买；已用的记录不删，也不退单。可以改到本月已用或更低，也可以填 0。",
      check: "只能填 0–1,000,000 的整数；调高时不能低于本月已用。批准时额度已被别人改过，会被拒绝并给出最新值。",
    },
    completionCopy: approvalCopy,
    facts: <KeyValues rows={[
      { key: "used", label: "本月已用", value: `${count(quota.current)} 台` },
      ...((quota.pendingThisMonth ?? 0) > 0 ? [{ key: "pending", label: "其中待付款", value: `${count(quota.pendingThisMonth ?? 0)} 台` }] : []),
      ...(quota.status === 0 ? [{ key: "paused", label: "状态", value: "已暂停：调额度不会恢复销售" }] : []),
      { key: "code", label: "额度编号", value: <span data-mono>{quota.quotaCode || quota.id}</span> },
      ...approvalRows("这页的常规修改"),
    ]} />,
    detail: `${quota.quotaCode || quota.id} · 已用 ${quota.current} / ${quota.monthlyQuota === undefined ? quota.cap : quota.monthlyQuota ?? "—"}。如果别人刚改过，会提示你刷新后再改。`,
  };
      break;
    }
    case action.startsWith("F.quota.usage."): {
      spec = { briefKind: "record",
    name: `回收配额 #${usage.id}`, op: "dispose",
    paramKey: `F.quota.usage.${usage.id}.status`, fixedVal: "recycled",
    title: `回收名额 #${usage.id}`, effect: approvalTag(), confirmTone: "danger", confirmLabel: "提交回收",
    statedBrief: {
      impact: "批准后这条记录改为已回收，这几台的名额回到它所属月份的剩余里；不退款、不删订单，用户已买的设备不受影响。",
      check: "只有还在占用的记录能回收；已回收或不存在的会被拒绝。",
    },
    completionCopy: approvalCopy,
    facts: <KeyValues rows={[
      { key: "user", label: "谁的", value: `用户 ${usage.userId}` },
      { key: "item", label: "哪一类", value: `${productName(usage)} · ${count(usage.quantity)} 台` },
      { key: "order", label: "订单号", value: usage.orderNo ? <span data-mono>{usage.orderNo}</span> : "无订单号" },
      ...approvalRows("这页的常规修改"),
    ]} />,
    detail: "跨月才批准时，名额仍回到原来那个月，批准当月的剩余不会增加。",
  };
      break;
    }
    case action === "F.leaderboard.paused": {
      spec = { briefKind: board.paused ? "config" : "record", name: board.paused ? "恢复排行榜" : "暂停排行榜", op: "dispose", paramKey: "F.leaderboard.paused", fixedVal: board.paused ? "off" : "on",
    title: board.paused ? "恢复排行榜" : "暂停排行榜", effect: approvalTag(),
    confirmTone: board.paused ? "primary" : "danger", confirmLabel: board.paused ? "提交恢复" : "提交暂停",
    statedBrief: board.paused ? {
      impact: "批准后四个榜恢复更新，之后到期的日、周、月榜照常自动派奖。暂停期间跳过的周期恢复后不会补发。",
      check: "榜单已在运行时会被拒绝。暂停那一刻的名次留作历史记录。",
    } : {
      impact: "批准后四个榜停在暂停那一刻的名次；暂停期间到期的日、周、月榜自动派奖不发，恢复后也不会补发；总榜派奖不能提交。团队激励池照常结算。",
      check: "已经暂停时会被拒绝；四个榜的名次没存下来时整次不生效。",
    },
    completionCopy: approvalCopy, facts: <Facts>{approvalFacts("榜单处置权限")}</Facts>,
    detail: board.paused ? "恢复后榜单重新更新，之后的周期按当时的规则发奖。" : "暂停后榜单停在当前名次，榜单奖励暂停发放，团队激励池不受影响。",
  };
      break;
    }
    case action === "payout": {
      spec = { briefKind: "funds",
    name: "发放总榜奖励",
    amplify: true,
    title: "发放总榜奖励", effect: approvalTag(), confirmLabel: "提交审批",
    statedBrief: {
      impact: "批准后按执行那一刻的总榜，把总榜奖池按名次分给团队订单算力点最多的前 100 名（不足 100 名按实际人数），作为已解锁的 USDT 奖励真实入账。",
      check: "总榜派过一次后再批准不会重发；奖池为 0 或没人上榜时不发钱。批准时先查兑付覆盖率，不够不发。",
    },
    completionCopy: approvalCopy,
    coverageLead: "这次派奖按算出的金额真实发钱",
    coverageCheck: "提交时按这里的数查一次。批准时系统再查：读不到或低于红线就不发钱，审批单留着，可等覆盖率恢复后再批，或驳回；等于红线算够。",
    facts: <div className="rd-stack">
      <F4PayoutPreviewFacts pool={prizeShown(ppAllTime)} />
      <F4PayoutRules top1MaxPct={top1MaxPct} top5MaxPct={top5MaxPct} />
      <Facts>{approvalFacts("「奖池资金类调整」")}</Facts>
    </div>,
    detail: `总榜不会自动清零。名次按算力点排，发的是 USDT：当前奖池 ${prizeShown(ppAllTime)} USDT，需要审批，不会重复发放。`,
    run: (reason) => ctx.proposeF4LeaderboardPayout("allTime", reason),
  };
      break;
    }
    case action.startsWith("F.leaderboard.week.user."): {
      const member = (data.leaderboardComputePointPeriods?.week?.podium ?? data.leaderboardPeriods?.week?.podium ?? [])
        .find(row => action === `F.leaderboard.week.user.${row.memberUserId}.status`)!;
      spec = { briefKind: "record",
    name: `取消 ${member.userId} 本周榜单资格`, op: "dispose",
    paramKey: `F.leaderboard.week.user.${member.memberUserId}.status`, fixedVal: "disqualified",
    title: `取消 ${member.userId} 的周榜资格`, effect: approvalTag(), confirmTone: "danger", confirmLabel: "提交取消资格",
    statedBrief: {
      impact: "批准后，批准那一周的周榜不算这个人，也不分那一周的周榜奖；下一周不会自动接着排除，要排除就再提交一次。不冻结账号，不追回已发的奖励。",
      check: "提交和执行时都要找到这个人本周的风险记录或生效中的关联账户簇，找不到会被拒绝。",
    },
    completionCopy: approvalCopy,
    facts: <Facts>
      <Fact k="谁">{`用户 ${member.userId}`}</Fact>
      <Fact k="本周名次">{"computePoints" in member ? `第 ${member.rank} 名 · ${count(member.computePoints as number)} 点` : `第 ${member.rank} 名 · ${prizeText(member.gmvLabel)} USDT`}</Fact>
      <F4DisqualifyEvidenceFact memberUserId={member.memberUserId} />
      {approvalFacts("榜单处置权限")}
    </Facts>,
    detail: "只管批准那一周的周榜；日榜、月榜、总榜照常算这个人。",
  };
      break;
    }
    case action === "F.pool.periodPrize": {
      spec = { briefKind: "config",
              name: "调整各榜奖池", amplify: true,
              title: "调整各榜奖池", effect: approvalTag(), confirmLabel: "提交审批",
              statedBrief: { impact: "批准后，日、周、月榜从下一次还没结算的周期起用新金额，总榜在人工派奖时读；已经派过的不改。", check: "四个都要填 0 或正数，一起提交，一张审批单。" },
              completionCopy: approvalCopy, facts: <Facts>{approvalFacts("「奖池资金类调整」")}</Facts>,
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
                const today = f4Decimal(bv.today);
                const week = f4Decimal(bv.week);
                const month = f4Decimal(bv.month);
                const allTime = f4Decimal(bv.allTime);
                if ([today, week, month, allTime].some(value => value === null || value.startsWith("-"))) {
                  throw new Error("奖池要填 0 或正数");
                }
                await ctx.updateF4Config("F.pool.periodPrize", `{"today":${today},"week":${week},"month":${month},"allTime":${allTime}}`, reason);
                ctx.toast(`各榜奖池已提交，批准后生效 · 日 ${today} / 周 ${week} / 月 ${month} / 总 ${allTime}；批准前仍按原设置执行`);
              },
            };
      break;
    }
    case action === "F.leaderboard.poolUsd": {
      spec = { briefKind: "config", name: "调整本周榜单奖池", amplify: true, op: "param", paramKey: "F.leaderboard.poolUsd",
              edit: { kind: "text", current: data.configValues["F.leaderboard.poolUsd"] ?? "",
                amplifiesWhen: value => f4MoneyAmplifies("F.leaderboard.poolUsd", data.configValues, value),
                validate: value => f4MonthlyCap(value) === null ? POOL_MONEY_INVALID : undefined, hint: POOL_MONEY_HINT },
              title: "调整周榜奖池覆盖额", effect: approvalTag(), confirmLabel: "提交审批",
              statedBrief: { impact: "批准后，还没结算的周榜按新金额派奖；填 0 表示改回用四榜奖池里的周榜金额，不是关掉。", check: POOL_MONEY_CHECK },
              completionCopy: approvalCopy, facts: <Facts>{approvalFacts("「奖池资金类调整」")}</Facts>,
              detail: `本周榜单奖池总额 · 当前 ${lbPool}。` };
      break;
    }
    case action === "F.leaderboard.minComputePoints": {
      spec = { briefKind: "config", name: "调整上榜门槛", op: "param", paramKey: "F.leaderboard.minComputePoints",
              edit: { kind: "number", current: lbMinPoints ?? "1", unit: "点", min: 0, max: Number.MAX_SAFE_INTEGER, step: 1, maxDecimals: 0 },
              title: "调整上榜门槛", effect: approvalTag(), confirmLabel: "提交审批",
              statedBrief: { impact: "批准后，本期团队订单算力点低于新门槛的人不参与四个榜的排名和派奖；已发的不变。", check: "只能填 0 或正整数，0 表示不设门槛。" },
              completionCopy: approvalCopy, facts: <Facts>{approvalFacts("这页的常规修改")}</Facts>,
              detail: `上榜门槛 · 当前 ${minPointsText(lbMinPoints)} · 低于这个点数不参与排名。` };
      break;
    }
    case action === "F.leaderboard.minUsd": {
      // 只用来显示本机保存的旧申请：旧的 USDT 门槛已经停用，新提交走上面的算力点门槛。
      spec = { briefKind: "config", name: "调整上榜最低奖励（已停用）", op: "param", paramKey: "F.leaderboard.minUsd",
              edit: { kind: "number", current: data.configValues["F.leaderboard.minUsd"] ?? "0", unit: "USDT" },
              title: "调整上榜最低奖励（已停用）", effect: approvalTag(), confirmLabel: "提交审批",
              statedBrief: { impact: "这一项已经停用，排名不再看它；要改门槛请用「上榜门槛」（算力点）。", check: "按原请求重试会被拒绝，不会生效。" },
              completionCopy: approvalCopy, facts: <Facts>{approvalFacts("这页的常规修改")}</Facts>,
              detail: "旧的 USDT 上榜门槛已停用，只能查询原申请的结果。" };
      break;
    }
    case action === "F.pool.top1MaxPct": {
      spec = { briefKind: "config", name: "调整第 1 名最高占比", amplify: true, op: "param", paramKey: "F.pool.top1MaxPct",
              edit: { kind: "number", current: top1MaxPct, unit: "%", amplifiesWhen: value => f4HeadCapAmplifies("F.pool.top1MaxPct", data.configValues["F.pool.top1MaxPct"], value) },
              title: "调整第 1 名最高占比", effect: approvalTag(), confirmLabel: "提交审批",
              statedBrief: { impact: "批准后，之后排行榜派奖时第 1 名最多拿奖池的这个百分比，超出的部分不再分给别人。只约束排行榜派奖，不影响团队激励池。", check: "只能填 0–100。" },
              completionCopy: approvalCopy, facts: <Facts>{approvalFacts("「奖池资金类调整」")}</Facts>,
              detail: `第 1 名最多能分到排行榜奖池的百分比 · 当前 ${top1MaxPct}%。` };
      break;
    }
    case action === "F.pool.top5MaxPct": {
      spec = { briefKind: "config", name: "调整前 5 名最高占比", amplify: true, op: "param", paramKey: "F.pool.top5MaxPct",
              edit: { kind: "number", current: top5MaxPct, unit: "%", amplifiesWhen: value => f4HeadCapAmplifies("F.pool.top5MaxPct", data.configValues["F.pool.top5MaxPct"], value) },
              title: "调整前 5 名最高占比", effect: approvalTag(), confirmLabel: "提交审批",
              statedBrief: { impact: "批准后，之后排行榜派奖时前 5 名合计最多拿奖池的这个百分比，超出的部分不再分给别人。只约束排行榜派奖，不影响团队激励池。", check: "只能填 0–100。" },
              completionCopy: approvalCopy, facts: <Facts>{approvalFacts("「奖池资金类调整」")}</Facts>,
              detail: `前 5 名合计最多能分到排行榜奖池的百分比 · 当前 ${top5MaxPct}%。` };
      break;
    }
    case action === "approve": {
      spec = { briefKind: "funds", name: `批准大使申请 #${application!.id}`, amplify: true,
      op: "dispose", paramKey: `F.ambassador.${application!.id}.status`, fixedVal: "approved",
      expectedMaterialRevision: packet!.materialRevision,
      title: `批准大使申请 #${application!.id}`, effect: <StatusTag tone="progress" filled>批准后生效</StatusTag>, confirmLabel: "提交审批",
      statedBrief: {
        impact: `批准后只开通申请人所选的「${ambassadorBucketLabel(packet!.bucket)}」这一类额度（一笔），不是付款，也不改其他申请。`,
        check: "执行时重新检查材料版本、两次核验、线下活动人数、认可金额、活动日期、附件和兑付覆盖率，任一不符就不执行。",
      },
      // 批准前什么不变（02 OP-60）；谁来批写在事实里，这里不再铺一段（BUG-682 第 4 条）。
      completionCopy: "批准前不开通额度，这份申请不变。",
      coverageLead: "批准会开通一笔预算额度",
      coverageCheck: "批准执行时还会检查兑付覆盖率，读不到也不执行。",
      facts: <Facts>
        <Fact k="申请金额" lead tone="role-1" unit="USDT">{moneyText(packet!.budgetUsdt)}</Fact>
        <Fact k="认可金额">{packet!.financeReview.recognizedBudgetUsdt == null ? "尚未认可" : `${moneyText(packet!.financeReview.recognizedBudgetUsdt)} USDT`}</Fact>
        <Fact k="类别">{ambassadorBucketLabel(packet!.bucket)}</Fact>
        <Fact k="材料">第 {packet!.materialRevision} 版 · 业务核验和财务核验都已通过</Fact>
        {/* 谁来批一行写完，和别的页同一个叫法；不再铺一段后端校验条件（BUG-682 第 4 条）。 */}
        <Fact k="谁来批">另一位管理员，不能是你，也不能核验过这一版材料</Fact>
        <Fact k="需有权限">大使最终批准权限和审批权限</Fact>
      </Facts>,
      detail: `${ambassadorBucketLabel(packet!.bucket)} · 申请金额 ${money(packet!.budgetUsdt)} · 认可金额 ${money(packet!.financeReview.recognizedBudgetUsdt)} · 材料 V${packet!.materialRevision}。业务核验与财务核验均已通过。本次仅开通所选类别的申请额度。`,
    };
      break;
    }
    case action === "reject": {
      spec = { briefKind: "record", name: `驳回大使申请 #${application!.id}`,
    op: "dispose", paramKey: `F.ambassador.${application!.id}.status`, fixedVal: "rejected",
    title: `驳回大使申请 #${application!.id}`, effect: <StatusTag tone="progress" filled>批准后生效</StatusTag>, confirmTone: "danger", confirmLabel: "提交驳回",
    statedBrief: {
      impact: "批准后这份申请变成已驳回，不开通额度；材料和核验历史保留。驳回不要求材料核验通过。",
      check: "申请已经处理过时会被拒绝。",
    },
    completionCopy: "批准前这份申请不变。",
    facts: <Facts>
      <Fact k="谁来批">另一位管理员，不能是你</Fact>
      <Fact k="需有权限">大使最终批准权限和审批权限</Fact>
    </Facts>,
    detail: "驳回这一份申请，提交审批后由另一位有权限的管理员执行。",
  };
      break;
    }
    case action === "policy": spec = f4PolicyConfirmation(ctx, policy!); break;
    default: throw new Error("F4_PROPOSAL_ORIGINAL_INCOMPLETE");
  }
  return { ...spec, f4Snapshot: snapshot };
}
