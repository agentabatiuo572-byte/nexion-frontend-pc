"use client";

/**
 * 经营数据：六张卡和时段切换。只接现成接口，时段切换不重读，三段数据第一次都读齐（B0 5.6）。
 * 今天没过完，对比只写昨日全天、上周全周、上月全月，不算百分比（DP-63）；同时段对比等后端汇总接口。
 * 颜色按 VS-12：入金是流入青，提现是流出品红，净入金是差额用正文色（VS-11），销售额金，注册紫；
 * 活跃用户是第五个有角色色的数，用灰（VS-10），一屏主色多一个是产品批准的例外，见重构说明。
 * 注册用户、系统处理中、待审核和设备是存量，不随时段变。卡按权限各自显示，读不到的卡写失败和重试，其余不受影响（5.6）。
 * 同一个数一页只出现一次（DP-61）：待审核写在待处理那一行，那一行不显示时才写在提现卡上；净入金用比例条，不再写入金、提现金额。
 */
import { useState } from "react";
import { Activity, ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, CircleDollarSign, UserPlus } from "lucide-react";
import { Explain, InlineRetry, LONG, MetricBoard, MetricCard, Segments } from "@/app/components/rd";
import { b0PeriodDays, type fetchB0ActiveUsers, type fetchB0Devices, type fetchB0MoneyFlows, type fetchB0Registrations, type fetchB0Sales, type B0Period } from "@/lib/admin/b0-client";
import type { B0Blocks } from "@/lib/admin/b0-access";
import { businessDay, businessZone } from "@/lib/admin/business-time";
import { fmtAmount, fmtNum } from "@/lib/format";
import type { Block } from "./use-block";

const PERIODS: readonly { value: B0Period; label: string; previous: string; word: string }[] = [
  { value: "today", label: "今日", previous: "昨日全天", word: "今天" },
  { value: "week", label: "本周", previous: "上周全周", word: "本周" },
  { value: "month", label: "本月", previous: "上月全月", word: "本月" },
];

const usdt = (value: number) => `${fmtAmount(value)} USDT`;
const signed = (value: number) => `${value > 0 ? "+" : ""}${fmtAmount(value)}`;
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
      setPeriod(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // 存不下时只影响下次打开的默认时段。
      }
    },
  };
}

export function BusinessPanel({ blocks, period: chosen, onPeriodChange, moneyFlows, sales, registrations, activeUsers, devices, reviewPending, systemProcessing, clock, reach }: {
  blocks: B0Blocks;
  period: B0Period;
  onPeriodChange: (period: B0Period) => void;
  moneyFlows: Block<Awaited<ReturnType<typeof fetchB0MoneyFlows>>>;
  sales: Block<Awaited<ReturnType<typeof fetchB0Sales>>>;
  registrations: Block<Awaited<ReturnType<typeof fetchB0Registrations>>>;
  activeUsers: Block<Awaited<ReturnType<typeof fetchB0ActiveUsers>>>;
  devices: Block<Awaited<ReturnType<typeof fetchB0Devices>>>;
  /** 待审核提现笔数。提现审核页可达时写在待处理那一行，这里不写。 */
  reviewPending: Block<number>;
  /** 和提现审核页「系统处理中」分组同一组单的笔数。 */
  systemProcessing: Block<number>;
  clock: string | null;
  reach: (href: string) => boolean;
}) {
  // 只有注册、活跃两张卡时切时段没有用，不放切换，按今日（00 提供邀请）。
  const switchable = blocks.moneyFlows || blocks.sales;
  const period = switchable ? chosen : "today";
  const { previous, word } = PERIODS.find((item) => item.value === period)!;
  const { monday, monthStart } = b0PeriodDays(businessDay());
  const since = period === "week" ? `${monday.slice(5)} 至今 · ` : period === "month" ? `${monthStart.slice(5)} 至今 · ` : "";
  const flow = moneyFlows.data?.[period].current;
  const flowBefore = moneyFlows.data?.[period].previous;
  const sale = sales.data?.[period];
  const link = (href: string) => (reach(href) ? href : undefined);
  const before = (text: string) => `${previous} ${text}`;
  // 资金三张卡本月没有上月可比：按天的接口只给最近 31 天。原因只在第一张卡写一次（VS-105）。
  const moneyCompare = (text: (data: NonNullable<typeof flowBefore>) => string, why = false) => (flowBefore ? before(text(flowBefore))
    : period === "month" ? <>暂不对比上月{why && <Explain label="为什么不对比上月" content="按天的资金数只能取最近 31 天，取不到上月全月，所以本月资金三张卡先不对比。" />}</> : undefined);
  // 列数按三个时段里最长的金额定，切时段不在三列和两列之间跳。
  const long = PERIODS.some(({ value }) => {
    const money = moneyFlows.data?.[value].current;
    const sold = sales.data?.[value];
    return [money && fmtAmount(money.topup), money && fmtAmount(money.withdrawal), money && signed(money.net), sold && fmtAmount(sold.amount)]
      .some((text) => (text?.length ?? 0) >= LONG);
  });

  const reviewOnCard = blocks.withdrawals && !reach("/finance/withdrawals");
  const withdrawalCounts = [
    ...(blocks.withdrawals ? [countRow("系统处理中", systemProcessing)] : []),
    ...(reviewOnCard ? [countRow("待审核", reviewPending)] : []),
  ];
  const deviceRows = !blocks.devices ? []
    : devices.error ? [{ k: "设备", v: <>暂时读不到 · <InlineRetry onRetry={devices.reload} /></> }]
      : [
        { k: "在线设备", v: devices.data ? `${fmtNum(devices.data.online)} 台` : "…" },
        { k: "设备异常", v: devices.data ? `${fmtNum(devices.data.abnormal)} 台` : "…", tone: devices.data?.abnormal ? "warn" as const : undefined },
      ];
  // 分项区按这组卡最多几行留高：注册 3 行，提现 1～3 行，净入金比例条和销售、设备各算 2 行。
  const reservedRows = Math.max(
    blocks.newUsers ? 3 : 1,
    blocks.moneyFlows ? Math.max(2, 1 + withdrawalCounts.length) : 1,
    blocks.sales || (blocks.activeUsers && blocks.devices) ? 2 : 1,
  );

  const active = activeUsers.data;
  return (
    <MetricBoard
      title="经营数据"
      explain={switchable
        ? "今日从 0 点到现在，本周从周一 0 点到现在，本月从 1 日 0 点到现在。今天还没过完，所以只并排写昨日全天、上周全周、上月全月的数，不算百分比。数字大小不分好坏，提现多了不代表不好。金额和注册人数现在还没有排除测试账号。"
        : "注册用户是上线以来累计，下面三个新增按今日、本周、本月分开写。活跃用户只有今日和昨日。注册人数现在还没有排除测试账号。"}
      tools={switchable ? <Segments label="经营数据时段" value={period} items={PERIODS} onChange={onPeriodChange} /> : undefined}
      meta={clock ? `${since}截至 ${clock} · ${businessZone().label}` : "正在读取…"}
      rows={reservedRows}
      long={long}
    >
      {blocks.moneyFlows && (
        <>
          <MetricCard
            label="入金总额"
            icon={ArrowDownToLine}
            tone="role-2"
            value={flow ? fmtAmount(flow.topup) : ""}
            unit="USDT"
            compare={moneyCompare((data) => usdt(data.topup), true)}
            rows={flow ? [{ k: "笔数", v: `${fmtNum(flow.topupCount)} 笔` }] : []}
            explain={<>
              <p>算：用户从外部打进平台、已经入账的钱，有链上充值和银行卡折算成的 USDT，按入账时间算。</p>
              <p>不算：用余额买设备、财务注资、调账、待确认和失败的单。外部直付购机现在取不到，还没算进来。</p>
              {blocks.topup && <p>今天每个充值渠道的金额和笔数在下面「资金进出」里。</p>}
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
            compare={moneyCompare((data) => usdt(data.withdrawal))}
            rows={flow ? [{ k: "已完成", v: `${fmtNum(flow.withdrawalCount)} 笔` }, ...withdrawalCounts] : withdrawalCounts}
            explain={<>
              <p>算：已经完成的提现本金，按完成时间算。</p>
              <p>不算：待审、处理中、被拒、已退款的单，手续费也不在里面。</p>
              {blocks.withdrawals && <p>系统处理中和提现审核页的「系统处理中」是同一组单：已提交、冷却中、已放行、处理中、已发出。是此刻的笔数，不随时段变。{reviewOnCard ? "待审核是此刻等人审核的笔数。" : "待审核的笔数在上面待处理里。"}</p>}
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
            compare={moneyCompare((data) => `${signed(data.net)} USDT`)}
            bar={flow && {
              label: `${word}入金和提现的比例`,
              empty: `${word}没有进出`,
              items: [{ key: "in", label: "入金", value: flow.topup, slot: 2 }, { key: "out", label: "提现", value: flow.withdrawal, slot: 4 }],
            }}
            explain={<>
              <p>入金总额减提现总额。条是入金和提现的比例，哪边长哪边多。</p>
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
          compare="上线以来累计"
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
          value={period === "today" && active?.today != null ? fmtNum(active.today) : "—"}
          unit="人"
          compare={period !== "today" ? "只有今日数据"
            : active ? (active.yesterday === null ? "昨日没有记录" : `昨日全天 ${fmtNum(active.yesterday)} 人`) : undefined}
          rows={deviceRows}
          explain={<>
            <p>当天用有效的登录状态访问过 App 或 H5 的人数，同一人一天算一次，不算后台账号和测试账号。当天没有记录时写「—」。</p>
            <p>现在只有今日和昨日。本周、本月要跨天去重，不能把每天相加，所以先不写。</p>
            {blocks.devices && <p>在线设备是上报在线且 10 分钟内有心跳的台数。设备异常是离线或异常的设备，已包含离线，大于 0 时进待处理。</p>}
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
