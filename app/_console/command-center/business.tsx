"use client";

/**
 * 经营数据和时段切换。B36 四周期数据在首次读取完成；现有三个页签使用后端的同时段比较。
 * 颜色按 VS-12：入金是流入青，提现是流出品红，净入金是差额用正文色（VS-11），销售额金，注册紫；
 * 活跃用户是第五个有角色色的数，用灰（VS-10），一屏主色多一个是产品批准的例外，见重构说明。
 * 注册用户、系统处理中、待审核和设备是存量，不随时段变。卡按权限各自显示，读不到的卡写失败和重试，其余不受影响（5.6）。
 * 同一个数一页只出现一次（DP-61）：待审核写在待处理那一行，那一行不显示时才写在提现卡上；净入金用比例条，不再写入金、提现金额。
 */
import { useState } from "react";
import { Activity, ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, CircleDollarSign, Server, UserPlus } from "lucide-react";
import { Explain, InlineRetry, LONG, MetricBoard, MetricCard, Segments } from "@/app/components/rd";
import { type fetchB0Business, type fetchB0Devices, type B0Period } from "@/lib/admin/b0-client";
import type { B0Blocks } from "@/lib/admin/b0-access";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { fmtNum } from "@/lib/format";
import type { Block } from "./use-block";

const PERIODS: readonly { value: B0Period; label: string; previous: string; word: string }[] = [
  { value: "today", label: "今日", previous: "昨日全天", word: "今天" },
  { value: "week", label: "本周", previous: "上周全周", word: "本周" },
  { value: "month", label: "本月", previous: "上月全月", word: "本月" },
];

const usdt = (value: string | null | undefined) => value == null ? "—" : `${value} USDT`;
const signed = (value: string) => `${Number(value) > 0 ? "+" : ""}${value}`;
const cardState = (block: Block<unknown>) => (block.data !== null ? "ready" : block.error ? "failed" : "loading");
/** 一个笔数分项：读不到时就在这一行重试，不当 0。 */
const countRow = (k: string, block: Block<number>) => ({ k, v: block.error ? <>暂时读不到 · <InlineRetry onRetry={block.reload} /></> : block.data === null ? "…" : `${fmtNum(block.data)} 笔` });

/** 上次选的时段按账号记住；读不到或写不进时按今日，不影响这页（DP-50）。 */
export function usePeriodChoice(adminId: number | undefined) {
  const key = `nexion-admin-b0-period-v1:${adminId ?? "anonymous"}`;
  const [period, setPeriod] = useState<B0Period>(() => {
    try {
      const saved = window.localStorage.getItem(key);
      return PERIODS.find((item) => item.value === saved)?.value ?? "today";
    } catch {
      return "today";
    }
  });
  return {
    period,
    setPeriod: (next: B0Period) => {
      try {
        window.localStorage.setItem(key, next);
        setPeriod(next);
      } catch {
        setPeriod("today");
      }
    },
  };
}

export function BusinessPanel({ blocks, period: chosen, onPeriodChange, business, devices, reviewPending, systemProcessing, clock, reach }: {
  blocks: B0Blocks;
  period: B0Period;
  onPeriodChange: (period: B0Period) => void;
  business: Block<Awaited<ReturnType<typeof fetchB0Business>>>;
  devices: Block<Awaited<ReturnType<typeof fetchB0Devices>>>;
  /** 待审核提现笔数。提现审核页可达时写在待处理那一行，这里不写。 */
  reviewPending: Block<number>;
  /** 和提现审核页「系统处理中」分组同一组单的笔数。 */
  systemProcessing: Block<number>;
  clock: string | null;
  reach: (href: string) => boolean;
}) {
  // 没有资金或销售卡时切时段没有用，不放切换，按今日（00 提供邀请）。
  const switchable = blocks.moneyFlows || blocks.sales;
  const period = switchable ? chosen : "today";
  const { word } = PERIODS.find((item) => item.value === period)!;
  const summary = business.data?.[period];
  const deposits = summary?.blocks.deposits;
  const withdrawals = summary?.blocks.withdrawals;
  const net = summary?.blocks.netDeposits;
  const sale = summary?.blocks.sales;
  const registrations = summary?.blocks.registrations;
  const active = summary?.blocks.activeUsers;
  const since = summary ? `${formatBusinessTimeCompact(summary.range.from)} · ` : "";
  const link = (href: string) => (reach(href) ? href : undefined);
  const before = (text: string) => summary?.comparison ? `${formatBusinessTimeCompact(summary.comparison.from)} – ${formatBusinessTimeCompact(summary.comparison.toExclusive)} ${text}` : undefined;
  const moneyCompare = (block: typeof deposits) => block?.previousAmountUsdt == null ? undefined : before(usdt(block.previousAmountUsdt));
  const long = PERIODS.some(({ value }) => Object.values(business.data?.[value].blocks ?? {}).some(block => "amountUsdt" in block && (block.amountUsdt?.length ?? 0) >= LONG));
  const show = (enabled: boolean, block: unknown) => enabled && (!summary || block !== undefined);

  const reviewOnCard = blocks.withdrawals && !reach("/finance/withdrawals");
  const withdrawalCounts = [
    ...(blocks.withdrawals ? [countRow("系统处理中", systemProcessing)] : []),
    ...(reviewOnCard ? [countRow("待审核", reviewPending)] : []),
  ];
  // 分项区按这组卡最多几行留高：注册 3 行，提现 1～3 行，净入金比例条和销售、设备各算 2 行。
  // 出错重试中、旧任务未结清、等待配置按有效状态算，是另一套口径；三项都是 0 时不占行。
  const deviceAttention = devices.data ? devices.data.errorRetry + devices.data.legacyPending + devices.data.waitingConfig : 0;
  const reservedRows = Math.max(
    blocks.newUsers ? 3 : 1,
    blocks.moneyFlows ? Math.max(2, 1 + withdrawalCounts.length) : 1,
    blocks.sales || blocks.devices ? 2 : 1,
    blocks.devices && deviceAttention > 0 ? 3 : 1,
  );

  return (
    <MetricBoard
      title="经营数据"
      explain={switchable
        ? "今日从 0 点到现在，本周从周一 0 点到现在，本月从 1 日 0 点到现在。今天还没过完，所以只并排写昨日全天、上周全周、上月全月的数，不算百分比。数字大小不分好坏，提现多了不代表不好。金额和注册人数现在还没有排除测试账号。"
        : "注册用户是上线以来累计，下面三个新增按今日、本周、本月分开写。活跃用户只有今日和昨日。注册人数现在还没有排除测试账号。设备是此刻的用户设备，不含手机，不随时段变。"}
      tools={switchable ? <Segments label="经营数据时段" value={period} items={PERIODS} onChange={onPeriodChange} /> : undefined}
      meta={summary ? `${since}截至 ${formatBusinessTimeCompact(summary.asOf)} · ${businessZone().label}` : clock ? `${since}截至 ${clock} · ${businessZone().label}` : "正在读取…"}
      rows={reservedRows}
      long={long}
    >
      {blocks.moneyFlows && (
        <>
          {show(blocks.deposits, deposits) && <MetricCard
            label="入金总额"
            icon={ArrowDownToLine}
            tone="role-2"
            value={deposits?.amountUsdt ?? ""}
            unit="USDT"
            compare={moneyCompare(deposits)}
            rows={deposits?.breakdown ? [{ k: "笔数", v: `${fmtNum(deposits.breakdown.count as number)} 笔` }] : []}
            explain={<>
              <p>算：用户从外部打进平台、已经入账的钱，有链上充值和银行卡折算成的 USDT，按入账时间算。</p>
              <p>不算：用余额买设备、财务注资、调账、待确认和失败的单。外部直付购机现在取不到，还没算进来。</p>
              {blocks.topup && <p>今天每个充值渠道的金额和笔数在下面「资金进出」里。</p>}
            </>}
            href={link("/finance/recon")}
            openLabel="查看充值与收款对账"
            state={cardState(business)}
            onRetry={business.reload}
          />}
          {show(blocks.withdrawals, withdrawals) && <MetricCard
            label="提现总额"
            icon={ArrowUpFromLine}
            tone="role-4"
            value={withdrawals?.amountUsdt ?? ""}
            unit="USDT"
            compare={moneyCompare(withdrawals)}
            rows={withdrawals?.breakdown ? [{ k: "已完成", v: `${fmtNum(withdrawals.breakdown.count as number)} 笔` }, ...withdrawalCounts] : withdrawalCounts}
            explain={<>
              <p>算：已经完成的提现本金，按完成时间算。</p>
              <p>不算：待审、处理中、被拒、已退款的单，手续费也不在里面。</p>
              {blocks.withdrawals && <p>系统处理中和提现审核页的「系统处理中」是同一组单：已提交、冷却中、已放行、处理中、已发出。是此刻的笔数，不随时段变。{reviewOnCard ? "待审核是此刻等人审核的笔数。" : "待审核的笔数在上面待处理里。"}</p>}
            </>}
            href={link("/finance/withdrawals")}
            openLabel="查看提现审核"
            state={cardState(business)}
            onRetry={business.reload}
          />}
          {show(blocks.netDeposits, net) && <MetricCard
            label="净入金"
            icon={ArrowLeftRight}
            value={net?.amountUsdt != null ? signed(net.amountUsdt) : ""}
            unit="USDT"
            compare={moneyCompare(net)}
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
            state={cardState(business)}
            onRetry={business.reload}
          />}
        </>
      )}
      {show(blocks.sales, sale) && (
        <MetricCard
          label="销售额"
          icon={CircleDollarSign}
          tone="role-1"
          value={sale ? sale.amountUsdt ?? "—" : ""}
          unit="USDT"
          compare={moneyCompare(sale)}
          rows={sale?.breakdown ? [{ k: "订单", v: `${fmtNum(sale.breakdown.orderCount as number)} 单` }, { k: "客单价", v: usdt(sale.breakdown.averageOrderUsdt as string | null) }] : []}
          explain={<>
            <p>设备订单里已付款且已完成的金额，按付款时间算，不含团队奖励。订单退款后这笔会扣掉，所以同一天的数字可能变小。</p>
            <p>客单价是销售额除以订单数。</p>
          </>}
          href={link("/devices/orders")}
          openLabel="查看订单进度"
          state={cardState(business)}
          onRetry={business.reload}
        />
      )}
      {show(blocks.newUsers, registrations) && (
        <MetricCard
          label="注册用户"
          icon={UserPlus}
          tone="role-3"
          value={registrations ? fmtNum(registrations.cumulativeCount) : ""}
          unit="人"
          compare="上线以来累计"
          rows={business.data && registrations ? [
            { k: "今日新增", v: `${business.data.today.blocks.registrations ? fmtNum(business.data.today.blocks.registrations!.count) : "—"} 人` },
            { k: "本周新增", v: `${business.data.week.blocks.registrations ? fmtNum(business.data.week.blocks.registrations!.count) : "—"} 人` },
            { k: "本月新增", v: `${business.data.month.blocks.registrations ? fmtNum(business.data.month.blocks.registrations!.count) : "—"} 人` },
          ] : []}
          explain={<>
            <p>累计是注册完成、账号没删除的用户总数。新增按注册时间算，今日从 0 点起，本周从周一起，本月从 1 日起，按北京时间切日。</p>
            <p>三个新增一起写，不随时段变。月初时本周新增可能比本月新增大，这是正常的。</p>
          </>}
          href={link("/overview/funnel")}
          openLabel="查看用户转化概览"
          state={cardState(business)}
          onRetry={business.reload}
        />
      )}
      {show(blocks.activeUsers, active) && (
        <MetricCard
          label="活跃用户"
          icon={Activity}
          value={active?.count != null ? fmtNum(active.count) : "—"}
          unit="人"
          compare={active?.previousCount != null ? before(`${fmtNum(active.previousCount)} 人`) : undefined}
          explain={<>
            <p>当天用有效的登录状态访问过 App 或 H5 的人数，同一人一天算一次，不算后台账号和测试账号。当天没有记录时写「—」。</p>
            <p>现在只有今日和昨日。本周、本月要跨天去重，不能把每天相加，所以先不写。</p>
          </>}
          href={link("/analytics/funnel-cohort")}
          openLabel="查看用户转化与留存"
          state={cardState(business)}
          onRetry={business.reload}
        />
      )}
      {blocks.devices && (
        <MetricCard
          label="设备"
          icon={Server}
          value={devices.data ? fmtNum(devices.data.running) : ""}
          prefix="运行中"
          unit="台"
          compare={devices.data ? `共 ${fmtNum(devices.data.total)} 台 · 用户设备，不含手机` : undefined}
          rows={devices.data ? [
            { k: <>等待启动<Explain label="等待启动统计范围" content="包含待激活、等待初始化和旧任务未结清的设备。" /></>, v: `${fmtNum(devices.data.waitingActivation)} 台`, tone: devices.data.waitingActivation > 0 ? "warn" : undefined },
            { k: "已停用", v: `${fmtNum(devices.data.stopped)} 台` },
            ...(deviceAttention > 0 ? [{ k: <>需要处理<Explain label="需要处理统计范围" content={`出错重试中 ${fmtNum(devices.data.errorRetry)} 台、旧任务未结清 ${fmtNum(devices.data.legacyPending)} 台、等待配置 ${fmtNum(devices.data.waitingConfig)} 台。按设备当前的有效状态算，和上面的台数分开统计，同一台设备可能两边都算到，不能相加。逐项入口在「待处理」。`} /></>, v: `${fmtNum(deviceAttention)} 台`, tone: "warn" as const }] : []),
          ] : []}
          explain="只算用户设备，不含手机。总数包含所有用户设备状态；运行中、等待启动和已停用是其中三类，不一定加起来等于总数。等待启动包含待激活、等待初始化和旧任务未结清的设备。这些是此刻的台数，不随时段变。"
          explainAbove
          href={link("/devices/ops")}
          openLabel="查看设备管理"
          state={cardState(devices)}
          onRetry={devices.reload}
        />
      )}
    </MetricBoard>
  );
}
