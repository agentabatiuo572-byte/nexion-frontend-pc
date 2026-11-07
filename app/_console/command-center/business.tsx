"use client";

/**
 * 经营数据：六张卡和时段切换。只接现成接口，时段切换不重读，三段数据第一次都读齐（B0 5.6）。
 * 今天没过完，对比只写昨日全天、上周全周、上月全月，不算百分比（DP-63）；同时段对比等后端汇总接口。
 * 颜色按 VS-12：入金是流入青，提现是流出品红，净入金是差额用正文色（VS-11），销售额金，人紫。
 * 注册用户和在途是存量，不随时段变。卡按权限各自显示，读不到的卡写失败和重试，其余不受影响（5.6）。
 */
import { useState } from "react";
import { Activity, ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, CircleDollarSign, UserPlus } from "lucide-react";
import { InlineRetry, MetricBoard, MetricCard, Segments } from "@/app/components/rd";
import type { fetchB0ActiveUsers, fetchB0Devices, fetchB0MoneyFlows, fetchB0Registrations, fetchB0Sales, B0Period } from "@/lib/admin/b0-client";
import type { B0Blocks } from "@/lib/admin/b0-access";
import { businessZone } from "@/lib/admin/business-time";
import type { fetchD1TopupOverview } from "@/lib/admin/d-client";
import { fmtAmount, fmtNum } from "@/lib/format";
import type { Block } from "./use-block";

const PERIODS: readonly { value: B0Period; label: string; since: string; previous: string }[] = [
  { value: "today", label: "今日", since: "", previous: "昨日全天" },
  { value: "week", label: "本周", since: "周一至今 · ", previous: "上周全周" },
  { value: "month", label: "本月", since: "1 日至今 · ", previous: "上月全月" },
];

const usdt = (value: number) => `${fmtAmount(value)} USDT`;
const signed = (value: number) => `${value > 0 ? "+" : ""}${fmtAmount(value)}`;
const cardState = (block: Block<unknown>) => (block.data !== null ? "ready" : block.error ? "failed" : "loading");

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
      setPeriod(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // 存不下时只影响下次打开的默认时段。
      }
    },
  };
}

export function BusinessPanel({ blocks, period, onPeriodChange, moneyFlows, sales, registrations, activeUsers, topup, devices, inTransit, clock, reach }: {
  blocks: B0Blocks;
  period: B0Period;
  onPeriodChange: (period: B0Period) => void;
  moneyFlows: Block<Awaited<ReturnType<typeof fetchB0MoneyFlows>>>;
  sales: Block<Awaited<ReturnType<typeof fetchB0Sales>>>;
  registrations: Block<Awaited<ReturnType<typeof fetchB0Registrations>>>;
  activeUsers: Block<Awaited<ReturnType<typeof fetchB0ActiveUsers>>>;
  topup: Block<Awaited<ReturnType<typeof fetchD1TopupOverview>>>;
  devices: Block<Awaited<ReturnType<typeof fetchB0Devices>>>;
  /** 待审核提现笔数，提现审核页不可达时不读。读不到时待处理已写失败和重试，这里不再写一遍（VS-107）。 */
  inTransit: Block<number>;
  clock: string | null;
  reach: (href: string) => boolean;
}) {
  const { since, previous } = PERIODS.find((item) => item.value === period)!;
  const flow = moneyFlows.data?.[period].current;
  const flowBefore = moneyFlows.data?.[period].previous;
  const sale = sales.data?.[period];
  const link = (href: string) => (reach(href) ? href : undefined);
  const before = (text: string) => `${previous} ${text}`;

  // 分渠道只有今日：按「USDT-」开头的通道算链上，其余是银行卡，切到本周、本月只写笔数。
  const channels = period === "today" && blocks.topup ? topup : null;
  const channelSum = (chain: boolean) => (channels?.data?.reconciliation ?? []).filter((row) => row.channel.startsWith("USDT-") === chain).reduce((sum, row) => sum + row.ledgerAmount, 0);
  const channelRows = !channels ? []
    : channels.error ? [{ k: "分渠道", v: <>暂时读不到 · <InlineRetry onRetry={channels.reload} /></> }]
      : channels.data ? [{ k: "USDT 链上", v: usdt(channelSum(true)) }, { k: "银行卡", v: usdt(channelSum(false)) }]
        : [{ k: "分渠道", v: "…" }];
  const inTransitRow = blocks.withdrawals && reach("/finance/withdrawals") && !inTransit.error ? [{ k: "在途（待审核）", v: inTransit.data === null ? "…" : `${fmtNum(inTransit.data)} 笔` }] : [];
  const deviceRows = !blocks.devices ? []
    : devices.error ? [{ k: "设备", v: <>暂时读不到 · <InlineRetry onRetry={devices.reload} /></> }]
      : [
        { k: "在线设备", v: devices.data ? `${fmtNum(devices.data.online)} 台` : "…" },
        { k: "设备异常", v: devices.data ? `${fmtNum(devices.data.abnormal)} 台` : "…", tone: devices.data?.abnormal ? "warn" as const : undefined },
      ];

  const active = activeUsers.data;
  return (
    <MetricBoard
      title="经营数据"
      explain="今日从 0 点到现在，本周从周一 0 点到现在，本月从 1 日 0 点到现在。今天还没过完，所以只并排写昨日全天、上周全周、上月全月的数，不算百分比。数字大小不分好坏，提现多了不代表不好。金额和注册人数现在还没有排除测试账号。"
      tools={<Segments label="经营数据时段" value={period} items={PERIODS} onChange={onPeriodChange} />}
      meta={clock ? `${since}截至 ${clock} · ${businessZone().label}` : "正在读取…"}
    >
      {blocks.moneyFlows && (
        <>
          <MetricCard
            label="入金总额"
            icon={ArrowDownToLine}
            tone="role-2"
            value={flow ? fmtAmount(flow.topup) : ""}
            unit="USDT"
            compare={flowBefore ? before(usdt(flowBefore.topup)) : undefined}
            rows={flow ? [...channelRows, { k: "笔数", v: `${fmtNum(flow.topupCount)} 笔` }] : []}
            explain={<>
              <p>算：用户从外部打进平台、已经入账的钱，有链上充值和银行卡折算成的 USDT，按入账时间算。</p>
              <p>不算：用余额买设备、财务注资、调账、待确认和失败的单。外部直付购机现在取不到，还没算进来。</p>
            </>}
            href={link("/finance/recon")}
            openLabel="查看充值与收款对账"
            state={cardState(moneyFlows)}
            onRetry={moneyFlows.reload}
          />
          <MetricCard
            label="提现总额"
            icon={ArrowUpFromLine}
            tone="role-4"
            value={flow ? fmtAmount(flow.withdrawal) : ""}
            unit="USDT"
            compare={flowBefore ? before(usdt(flowBefore.withdrawal)) : undefined}
            rows={flow ? [{ k: "已完成", v: `${fmtNum(flow.withdrawalCount)} 笔` }, ...inTransitRow] : inTransitRow}
            explain={<>
              <p>算：已经完成的提现本金，按完成时间算。</p>
              <p>不算：待审、处理中、被拒、已退款的单，手续费也不在里面。</p>
              <p>在途是此刻还没完成的提现，不随时段变。现在只数待审核的笔数，打款中的不在这个数里。</p>
            </>}
            href={link("/finance/withdrawals")}
            openLabel="查看提现审核"
            state={cardState(moneyFlows)}
            onRetry={moneyFlows.reload}
          />
          <MetricCard
            label="净入金"
            icon={ArrowLeftRight}
            value={flow ? signed(flow.net) : ""}
            unit="USDT"
            compare={flowBefore ? before(`${signed(flowBefore.net)} USDT`) : undefined}
            rows={flow ? [{ k: "入金", v: usdt(flow.topup) }, { k: "提现", v: usdt(flow.withdrawal) }] : []}
            explain={<>
              <p>入金总额减提现总额。</p>
              <p>不算储备流入，也不等于银行现金净变化。储备账的净流入在下面「资金进出」里。</p>
            </>}
            href={link("/analytics/financial")}
            openLabel="查看财务报表"
            state={cardState(moneyFlows)}
            onRetry={moneyFlows.reload}
          />
        </>
      )}
      {blocks.sales && (
        <MetricCard
          label="销售额"
          icon={CircleDollarSign}
          tone="role-1"
          value={sale ? fmtAmount(sale.amount) : ""}
          unit="USDT"
          compare={sale ? before(usdt(sale.previous)) : undefined}
          rows={sale ? [{ k: "订单", v: `${fmtNum(sale.orders)} 单` }, { k: "客单价", v: sale.orders > 0 ? usdt(sale.amount / sale.orders) : "—" }] : []}
          explain={<>
            <p>设备订单里已付款且已完成的金额，按付款时间算，不含团队奖励。订单退款后这笔会扣掉，所以同一天的数字可能变小。</p>
            <p>客单价是销售额除以订单数。</p>
          </>}
          href={link("/devices/orders")}
          openLabel="查看订单进度"
          state={cardState(sales)}
          onRetry={sales.reload}
        />
      )}
      {blocks.newUsers && (
        <MetricCard
          label="注册用户"
          icon={UserPlus}
          tone="role-3"
          value={registrations.data ? fmtNum(registrations.data.total) : ""}
          unit="人"
          compare="累计，不随时段变"
          rows={registrations.data ? [
            { k: "今日新增", v: `${fmtNum(registrations.data.today)} 人` },
            { k: "本周新增", v: `${fmtNum(registrations.data.week)} 人` },
            { k: "本月新增", v: `${fmtNum(registrations.data.month)} 人` },
          ] : []}
          explain={<>
            <p>累计是注册完成、账号没删除的用户总数。新增按注册时间算，今日从 0 点起，本周从周一起，本月从 1 日起，按北京时间切日。</p>
            <p>三个新增一起写，不随时段变。月初时本周新增可能比本月新增大，这是正常的。</p>
          </>}
          href={link("/overview/funnel")}
          openLabel="查看用户转化概览"
          state={cardState(registrations)}
          onRetry={registrations.reload}
        />
      )}
      {blocks.activeUsers && (
        <MetricCard
          label="活跃用户"
          icon={Activity}
          tone="role-3"
          value={period === "today" && active?.today != null ? fmtNum(active.today) : "—"}
          unit="人"
          compare={period !== "today" ? "只有今日数据"
            : active ? (active.yesterday === null ? "昨日没有记录" : `昨日全天 ${fmtNum(active.yesterday)} 人`) : undefined}
          rows={deviceRows}
          explain={<>
            <p>当天有过一次有效登录请求的人数，同一个人算一次，不算后台账号和测试账号。当天没有记录时写「—」。</p>
            <p>现在只有今日和昨日。本周、本月要跨天去重，不能把每天相加，所以先不写。</p>
            <p>在线设备是上报在线且 10 分钟内有心跳的台数。设备异常是离线或异常的设备，已包含离线，大于 0 时进待处理。</p>
          </>}
          href={link("/analytics/funnel-cohort")}
          openLabel="查看用户转化与留存"
          state={period === "today" ? cardState(activeUsers) : "ready"}
          onRetry={activeUsers.reload}
        />
      )}
    </MetricBoard>
  );
}
