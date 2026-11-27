"use client";

/**
 * 经营数据和时段切换。B36 四个时段（今日、本周、本月、全部）在首次读取完成；对比用后端给的上一期同一时刻（comparison）。
 * 颜色按 VS-12：入金是流入青，提现是流出品红，净入金是差额用正文色（VS-11），销售额金，注册紫；
 * 活跃用户是第五个有角色色的数，用灰（VS-10），一屏主色多一个是产品批准的例外，见重构说明。
 * 系统处理中、待审核、累计注册和设备是存量，不随时段变。卡按权限各自显示，读不到的卡写失败和重试，其余不受影响（5.6）。
 * 没有读取授权（后端省略这一块）、算不出（sales.available=false）、上一期算不出、「全部」没有活跃人数，各写各的，都不写 0。
 * 图标每张卡固定一色，按图标认卡（产品 2026-11-19，b-domain.css）；数字的颜色仍按上面的槽位。
 * 同一个数一页只出现一次（DP-61）：待审核写在待处理那一行，那一行不显示时才写在提现卡上；净入金用比例条，不再写入金、提现金额。
 */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Activity, ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, CircleDollarSign, Gift, Hourglass, Server, UserPlus } from "lucide-react";
import { Explain, InlineRetry, LONG, MetricBoard, MetricCard, Segments } from "@/app/components/rd";
import { type fetchB0Business, type fetchB0Devices, type fetchB0ExchangeQueue, type B0SummaryPeriod } from "@/lib/admin/b0-client";
import type { B0Blocks } from "@/lib/admin/b0-access";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { fmtNum } from "@/lib/format";
import { moneyText, PERIODS, usdtText } from "./period";
import type { Block } from "./use-block";

const signed = (value: string) => `${/^-/.test(value) || /^0(?:\.0*)?$/.test(value) ? "" : "+"}${moneyText(value)}`;
const cardState = (block: Block<unknown>) => (block.data !== null ? "ready" : block.error ? "failed" : "loading");
/** 一个笔数分项：读不到时就在这一行重试，不当 0。 */
/** 读不到时原因收进问号（ST-34），这一行只写「暂时读不到」和重试。 */
const countRow = (k: string, block: Block<number>) => ({ k, v: block.error ? <>暂时读不到<Explain label={`${k}为什么读不到`} content={block.error} /> · <InlineRetry onRetry={block.reload} /></> : block.data === null ? "…" : `${fmtNum(block.data)} 笔` });
/** 后端这一期没有返回这一块：账号没有这一项的读取权限，不是 0。 */
const DENIED = <>没有查看权限<Explain label="为什么没有" content="你的账号没有这一项的查看权限。需要看，请管理员在「运营账号与权限」里开通。" /></>;
const REFUND_UNKNOWN = "这段时间有退款单查不到实际退了多少，所以先不算销售额。到「订单进度」查这些订单。";
/** 设备、兑换排队、奖励待结算是读取时的存量，不随时段变：对比行开头标「当前」，不和「昨日同时段」混看（不写「实时」，ST-48）。 */
const NOW = <span className="cc-now">当前</span>;

/** 只有存量卡时切时段没有用，不放切换，按今日。 */
const canSwitchPeriod = (blocks: B0Blocks) => blocks.moneyFlows || blocks.sales || blocks.newUsers || blocks.activeUsers;
export const shownBusinessPeriod = (blocks: B0Blocks, chosen: B0SummaryPeriod): B0SummaryPeriod => canSwitchPeriod(blocks) ? chosen : "today";

/** 上次选的时段按账号记住；读不到或写不进时按今日，不影响这页（DP-50）。 */
export function usePeriodChoice(adminId: number | undefined) {
  const key = `nexion-admin-b0-period-v1:${adminId ?? "anonymous"}`;
  const [period, setPeriod] = useState<B0SummaryPeriod>(() => {
    try {
      const saved = window.localStorage.getItem(key);
      return PERIODS.find((item) => item.value === saved)?.value ?? "today";
    } catch {
      return "today";
    }
  });
  return {
    period,
    setPeriod: (next: B0SummaryPeriod) => {
      try {
        window.localStorage.setItem(key, next);
        setPeriod(next);
      } catch {
        setPeriod("today");
      }
    },
  };
}

export function BusinessPanel({ blocks, period: chosen, onPeriodChange, business, devices, exchangeQueue, referralRewards, promotionRewards, reviewPending, systemProcessing, clock, reach }: {
  blocks: B0Blocks;
  period: B0SummaryPeriod;
  onPeriodChange: (period: B0SummaryPeriod) => void;
  business: Block<Awaited<ReturnType<typeof fetchB0Business>>>;
  devices: Block<Awaited<ReturnType<typeof fetchB0Devices>>>;
  exchangeQueue: Block<Awaited<ReturnType<typeof fetchB0ExchangeQueue>>>;
  referralRewards: Block<number>;
  promotionRewards: Block<number>;
  /** 待审核提现笔数。提现审核页可达时写在待处理那一行，这里不写。 */
  reviewPending: Block<number>;
  /** 和提现审核页「系统处理中」分组同一组单的笔数。 */
  systemProcessing: Block<number>;
  clock: string | null;
  reach: (href: string, read?: string) => boolean;
}) {
  const switchable = canSwitchPeriod(blocks);
  const period = shownBusinessPeriod(blocks, chosen);
  const { word, previous } = PERIODS.find((item) => item.value === period)!;
  const summary = business.data?.[period];
  const deposits = summary?.blocks.deposits;
  const withdrawals = summary?.blocks.withdrawals;
  const net = summary?.blocks.netDeposits;
  const sale = summary?.blocks.sales;
  const registrations = summary?.blocks.registrations;
  const active = summary?.blocks.activeUsers;
  const link = (href: string) => (reach(href) ? href : undefined);
  const referral = blocks.referralRewards ? {
    label: "待结算新人", open: "查看新人礼与邀请奖励", unit: "人", block: referralRewards, href: link("/growth/referral-rewards"),
  } : null;
  const promotion = blocks.promotionRewards ? {
    label: "活动奖励", open: "查看活动奖励", unit: "项", block: promotionRewards,
    href: reach("/growth/events", "growth_promotion_read") ? "/growth/events" : undefined,
  } : null;
  const reward = referral ?? promotion;
  const rewardDetail = referral ? promotion : null;
  const rewardState = reward && cardState(reward.block);
  // 主数还在读、分项已失败时卡按就绪显示（保留分项重试），但卡上没有可用读数：图标照旧灰底（b-domain.css 看 data-noread）。
  const rewardEmpty = reward?.block.data === null && (!rewardDetail || rewardDetail.block.data === null);
  /** 和上一期同一时刻比；「全部」不比。上一期算不出时写原因，不写 0。 */
  const compareWith = (text: string | null, unavailable?: ReactNode): ReactNode => !summary ? undefined
    : !previous ? "累计，不对比"
      : unavailable ? <>{previous}暂时算不出{unavailable}</>
        : text === null ? undefined : `${previous} ${text}`;
  const moneyCompare = (block: typeof deposits, value: (text: string) => string = usdtText) => compareWith(block?.previousAmountUsdt == null ? null : value(block.previousAmountUsdt),
    block?.previousUnavailableReason ? <Explain label="上一期为什么算不出" content={REFUND_UNKNOWN} /> : undefined);
  const long = PERIODS.some(({ value }) => Object.values(business.data?.[value].blocks ?? {}).some(block => "amountUsdt" in block && (block.amountUsdt ? moneyText(block.amountUsdt).length : 0) >= LONG));
  // 卡要显示：有权限，而且读到的这一期里有这一块；读到了却没有这一块时写没有查看权限，不当 0。
  const denied = (block: unknown) => Boolean(summary) && block === undefined;
  const common = { state: cardState(business), onRetry: business.reload } as const;

  const reviewOnCard = blocks.withdrawals && !reach("/finance/withdrawals");
  const withdrawalCounts = [
    ...(blocks.withdrawals ? [countRow("系统处理中", systemProcessing)] : []),
    ...(reviewOnCard ? [countRow("待审核", reviewPending)] : []),
  ];
  // 分项区按这组卡最多几行留高：注册 3 行，销售额（有财务报表读权时）3 行，提现 1～3 行，净入金比例条和设备各算 2 行。
  // 出错重试中、旧任务未结清、等待配置按有效状态算，是另一套口径；三项都是 0 时不占行。
  const deviceAttention = devices.data ? devices.data.errorRetry + devices.data.legacyPending + devices.data.waitingConfig : 0;
  const reservedRows = Math.max(
    blocks.newUsers ? 3 : 1,
    blocks.moneyFlows ? Math.max(2, 1 + withdrawalCounts.length) : 1,
    blocks.sales ? (blocks.redemption ? 3 : 1) : 1,
    blocks.devices ? 2 : 1,
    blocks.devices && deviceAttention > 0 ? 3 : 1,
  );
  const meta = !summary ? (clock ? `截至 ${clock} · ${businessZone().label}` : "正在加载…")
    : period === "all" ? `${summary.statisticsStart} 起 · 按天汇总到 ${formatBusinessTimeCompact(summary.asOf)} · ${businessZone().label}`
      : `${formatBusinessTimeCompact(summary.range.from)} 起 · 截至 ${formatBusinessTimeCompact(summary.asOf)} · ${businessZone().label}`;

  return (
    <MetricBoard
      title="经营数据"
      explain={switchable
        ? <>
          <p>今日、本周、本月从这一期第一天 0 点算到现在，和上一期同样长的一段比{summary?.comparison ? `，这次比的是 ${formatBusinessTimeCompact(summary.comparison.from)} 到 ${formatBusinessTimeCompact(summary.comparison.toExclusive)}` : "，比如今天 0 点到 14:20 比昨天 0 点到 14:20"}。不算百分比，数字大小不分好坏。</p>
          <p>「全部」从统计起点算到最近一次按天汇总，不对比。测试账号都不算在内。</p>
        </>
        : blocks.exchangeQueue || reward ? "这里显示读取时的数量，不随时段变。"
          : "设备是此刻的用户设备，不含手机，不随时段变。"}
      tools={switchable ? <Segments label="经营数据时段" value={period} items={PERIODS} onChange={onPeriodChange} /> : undefined}
      meta={meta}
      rows={reservedRows}
      long={long}
    >
      {blocks.moneyFlows && (
        <>
          {blocks.deposits && <MetricCard
            label="入金总额"
            icon={ArrowDownToLine}
            tone="role-2"
            value={deposits?.amountUsdt != null ? moneyText(deposits.amountUsdt) : denied(deposits) ? "—" : ""}
            unit="USDT"
            compare={denied(deposits) ? DENIED : moneyCompare(deposits)}
            rows={deposits?.breakdown ? [{ k: "笔数", v: `${fmtNum(deposits.breakdown.count as number)} 笔` }] : []}
            explain={<>
              <p>算：用户从外部打进平台、已经入账的钱，有链上充值、越南盾的银行卡支付和银行转账、外部直付购机，以及已停用的国际卡刷卡，按入账时间算。</p>
              <p>不算：用余额买设备、财务注资、调账、待确认和失败的单。各渠道的金额在下面「资金进出」里。</p>
            </>}
            href={link("/finance/recon")}
            openLabel="查看充值与收款对账"
            {...common}
          />}
          {blocks.withdrawals && <MetricCard
            label="提现总额"
            icon={ArrowUpFromLine}
            tone="role-4"
            value={withdrawals?.amountUsdt != null ? moneyText(withdrawals.amountUsdt) : denied(withdrawals) ? "—" : ""}
            unit="USDT"
            compare={denied(withdrawals) ? DENIED : moneyCompare(withdrawals)}
            rows={withdrawals?.breakdown ? [{ k: "已完成", v: `${fmtNum(withdrawals.breakdown.count as number)} 笔` }, ...withdrawalCounts] : withdrawalCounts}
            explain={<>
              <p>算：已经完成的提现本金，有链上 USDT 和越南盾银行提现折成的 USDT，按完成时间算。</p>
              <p>不算：待审、处理中、被拒、已退款的单和模拟打款。手续费不在里面，在下面「资金进出」里。</p>
              <p>系统处理中是此刻已提交、冷却中、已放行、处理中、已发出的笔数，和提现审核页的同名分组一致，不随时段变。{reviewOnCard ? "待审核是此刻等人审核的笔数。" : "待审核的在上面待处理里。"}</p>
            </>}
            href={link("/finance/withdrawals")}
            openLabel="查看提现审核"
            {...common}
          />}
          {blocks.netDeposits && <MetricCard
            label="净入金"
            icon={ArrowLeftRight}
            value={net?.amountUsdt != null ? signed(net.amountUsdt) : denied(net) ? "—" : ""}
            unit="USDT"
            compare={denied(net) ? DENIED : moneyCompare(net, (value) => `${signed(value)} USDT`)}
            bar={deposits?.amountUsdt != null && withdrawals?.amountUsdt != null ? {
              label: `${word}入金和提现的比例`,
              empty: `${word}没有进出`,
              items: [{ key: "in", label: "入金", value: Number(deposits.amountUsdt), slot: 2 }, { key: "out", label: "提现", value: Number(withdrawals.amountUsdt), slot: 4 }],
            } : undefined}
            explain={<>
              <p>入金总额减提现总额。条是入金和提现的比例，哪边长哪边多。</p>
              <p>不算储备流入，也不等于银行现金净变化。储备账的净流入在下面「资金进出」里。</p>
            </>}
            href={link("/analytics/financial")}
            openLabel="查看财务报表"
            {...common}
          />}
        </>
      )}
      {blocks.sales && (
        <MetricCard
          label="销售额"
          icon={CircleDollarSign}
          tone="role-1"
          value={!summary ? "" : sale?.amountUsdt != null ? moneyText(sale.amountUsdt) : "—"}
          unit="USDT"
          compare={denied(sale) ? DENIED
            : sale && !sale.available ? <>暂时算不出<Explain label="为什么算不出" content={REFUND_UNKNOWN} /></>
              : moneyCompare(sale)}
          rows={sale?.breakdown ? [
            { k: "订单", v: `${fmtNum(sale.breakdown.orderCount as number)} 单` },
            { k: "客单价", v: usdtText(sale.breakdown.averageOrderUsdt as string | null) },
            { k: "已扣退款", v: usdtText(sale.breakdown.refundsUsdt as string) },
          ] : []}
          explain={<>
            <p>设备订单里已付款且已完成的金额，减去退款，按付款时间算，不含团队奖励。退款算回原来付款的那一期，所以过去的数字可能变小。</p>
            <p>客单价是销售额除以订单数，全额退款的订单不算一单。</p>
          </>}
          href={link("/devices/orders")}
          openLabel="查看订单进度"
          {...common}
        />
      )}
      {blocks.newUsers && (
        <MetricCard
          label="新注册"
          icon={UserPlus}
          tone="role-3"
          value={registrations ? fmtNum(registrations.count) : denied(registrations) ? "—" : ""}
          unit="人"
          compare={denied(registrations) ? DENIED : compareWith(registrations?.previousCount == null ? null : `${fmtNum(registrations.previousCount)} 人`)}
          rows={registrations ? [
            { k: "首次充值", v: `${fmtNum(registrations.firstDepositCount)} 人` },
            { k: "首次购机", v: `${fmtNum(registrations.firstPurchaseCount)} 人` },
            ...(period === "all" ? [] : [{ k: "累计注册", v: `${fmtNum(registrations.cumulativeCount)} 人` }]),
          ] : []}
          explain={<>
            <p>新注册按注册时间算，不含已删除的账号。首次充值、首次购机是这一期里第一次充值、第一次买设备的人，全额退款的订单不算。</p>
            <p>累计注册是到现在为止的注册总数，不随时段变。每天的新注册在下面「用户与转化」里。</p>
          </>}
          href={link("/overview/funnel")}
          openLabel="查看用户转化概览"
          {...common}
        />
      )}
      {blocks.activeUsers && (
        <MetricCard
          label="活跃用户"
          icon={Activity}
          value={!summary ? "" : active?.count != null ? fmtNum(active.count) : "—"}
          unit="人"
          compare={denied(active) ? DENIED
            : active && !active.available ? "全部时段不统计"
              : compareWith(active?.previousCount == null ? null : `${fmtNum(active.previousCount)} 人`)}
          explain="这一期用有效的登录状态访问过 App 或 H5 的人数，同一人只算一次，不算后台账号。「全部」时段不统计活跃人数。"
          href={link("/analytics/funnel-cohort")}
          openLabel="查看用户转化与留存"
          {...common}
        />
      )}
      {blocks.devices && (
        <MetricCard
          label="设备"
          icon={Server}
          value={devices.data ? fmtNum(devices.data.running) : ""}
          prefix="运行中"
          unit="台"
          compare={devices.data ? <>{NOW}共 {fmtNum(devices.data.total)} 台</> : undefined}
          rows={devices.data ? [
            { k: <>等待启动<Explain label="等待启动统计范围" content="包含待激活、等待初始化和旧任务未结清的设备。" /></>, v: `${fmtNum(devices.data.waitingActivation)} 台`, tone: devices.data.waitingActivation > 0 ? "warn" : undefined },
            { k: "已停用", v: `${fmtNum(devices.data.stopped)} 台` },
            ...(deviceAttention > 0 ? [{ k: <>需要处理<Explain label="需要处理统计范围" content={`出错重试中 ${fmtNum(devices.data.errorRetry)} 台、旧任务未结清 ${fmtNum(devices.data.legacyPending)} 台、等待配置 ${fmtNum(devices.data.waitingConfig)} 台。和上面的台数分开算，同一台可能两边都有，不能相加。逐项入口在「待处理」。`} /></>, v: `${fmtNum(deviceAttention)} 台`, tone: "warn" as const }] : []),
          ] : []}
          explain="此刻的用户设备台数，不含手机，不随时段变。运行中、等待启动和已停用只是其中三类，加起来不一定等于总数。"
          explainAbove
          href={link("/devices/ops")}
          openLabel="查看设备管理"
          state={cardState(devices)}
          onRetry={devices.reload}
        />
      )}
      {blocks.exchangeQueue && (
        <MetricCard
          label="兑换排队"
          icon={Hourglass}
          value={exchangeQueue.data ? fmtNum(exchangeQueue.data.depth) : ""}
          unit="笔"
          compare={NOW}
          explain="现在还在排队的兑换单，不随时段变。"
          rows={exchangeQueue.data?.estimateHours == null ? [] : [
            { k: "预计处理时长（设置值）", v: `${fmtNum(exchangeQueue.data.estimateHours)} 小时` },
          ]}
          href={link("/finance-products/exchange")}
          openLabel="查看兑换"
          state={cardState(exchangeQueue)}
          onRetry={exchangeQueue.reload}
        />
      )}
      {reward && (
        <MetricCard
          label="奖励待结算"
          icon={Gift}
          value={reward.block.data === null ? "—" : fmtNum(reward.block.data)}
          unit={reward.unit}
          compare={<>{NOW}<span data-noread={rewardEmpty ? "" : undefined}>{rewardState === "loading" ? `${reward.label}正在加载…` : reward.label}</span></>}
          explain={rewardDetail ? "显示现在等着结算新人礼和邀请奖励的新人人数（有没有邀请人都算），和尚未办结的活动奖励项数，不随时段变。"
            : referral ? "显示现在等着结算新人礼和邀请奖励的新人人数，有没有邀请人都算，不随时段变。"
              : "显示现在尚未办结的活动奖励项数，不随时段变。"}
          rows={rewardDetail ? [{
            k: rewardDetail.href
              ? <Link className="rd-link pointer-events-auto" href={rewardDetail.href} prefetch={false}>{rewardDetail.label}</Link>
              : rewardDetail.label,
            v: rewardDetail.block.error
              ? <>暂时读不到<Explain label={`${rewardDetail.label}为什么读不到`} content={rewardDetail.block.error} /> · <InlineRetry onRetry={rewardDetail.block.reload} /></>
              : rewardDetail.block.data === null ? "…" : `${fmtNum(rewardDetail.block.data)} ${rewardDetail.unit}`,
          }] : []}
          href={reward.href}
          openLabel={reward.open}
          state={rewardState === "loading" && rewardDetail && cardState(rewardDetail.block) !== "loading" ? "ready" : rewardState ?? undefined}
          onRetry={reward.block.reload}
        />
      )}
    </MetricBoard>
  );
}
