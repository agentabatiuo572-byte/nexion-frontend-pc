"use client";

/**
 * 今日经营：4 个数，销售额最大（没有权限时下一个能看的放大）。
 * 只并排写昨天全天，不算百分比：今天没过完，和昨天全天比百分比会误导（DP-63）。
 * 颜色按 06 第 2.1 节：销售额金、新增用户紫，各带图标底；资金净流入是带正负号的差额，用正文色；
 * 设备异常是告警数，0 灰字，大于 0 橙黄（VS-11）。这块放在「今天」面板里，不带自己的底。
 */
import { CircleDollarSign, UserPlus } from "lucide-react";
import { InlineRetry, Panel, Stat } from "@/app/components/rd";
import type { fetchB0Devices, fetchB0NewUsers, fetchB0Sales } from "@/lib/admin/b0-client";
import type { B0Blocks } from "@/lib/admin/b0-access";
import type { B2LiquidityHistory } from "@/lib/admin/b-restoration-client";
import { fmtAmount, fmtAmountCompact, fmtNum } from "@/lib/format";
import type { Block } from "./use-block";

const failed = (block: Block<unknown>) => <>暂时读不到 · <InlineRetry onRetry={block.reload} /></>;

export function TodayPanel({ blocks, sales, newUsers, flows, devices, clock, netFlow24h, reach, onOpenFlows }: {
  blocks: B0Blocks;
  sales: Block<Awaited<ReturnType<typeof fetchB0Sales>>>;
  newUsers: Block<Awaited<ReturnType<typeof fetchB0NewUsers>>>;
  flows: Block<B2LiquidityHistory>;
  devices: Block<Awaited<ReturnType<typeof fetchB0Devices>>>;
  clock: string | null;
  netFlow24h: number | null;
  reach: (href: string) => boolean;
  onOpenFlows: () => void;
}) {
  const dataTime = clock ? `数据时间 ${clock}。` : "";
  const value = <T,>(block: Block<T>, read: (data: T) => string) => (block.data ? read(block.data) : block.loading ? "…" : "—");
  const flowToday = flows.data?.flowWindows.at(-1);
  const toUsdt = (wan: number) => wan * 10_000;
  const signed = (n: number) => `${n > 0 ? "+" : ""}${fmtAmountCompact(n)}`;
  const leadKey = blocks.sales ? "sales" : blocks.newUsers ? "newUsers" : blocks.netFlow ? "netFlow" : "devices";
  const abnormal = devices.data?.abnormal ?? 0;
  return (
    <Panel plain title="今日经营" sub={clock ? `截至 ${clock}` : undefined} className="cc-today">
      <div className="cc-today-grid">
        {blocks.sales && (
          <Stat
            lead={leadKey === "sales"}
            tone="role-1"
            icon={CircleDollarSign}
            label="销售额"
            value={value(sales, (data) => fmtAmountCompact(data.today))}
            unit="USDT"
            sub={sales.error ? failed(sales) : sales.data ? `昨天全天 ${fmtAmountCompact(sales.data.yesterday)} USDT` : undefined}
            explain={<>
              设备订单里已付款且已完成的金额，按付款时间算，不含团队奖励。订单退款后这笔会扣掉，所以同一天的数字可能变小。
              {sales.data && ` 今天 ${fmtAmount(sales.data.today)} USDT，昨天全天 ${fmtAmount(sales.data.yesterday)} USDT。`}{dataTime}
            </>}
            href={sales.data && reach("/devices/orders") ? "/devices/orders" : undefined}
            openLabel="查看订单进度"
          />
        )}
        {blocks.newUsers && (
          <Stat
            lead={leadKey === "newUsers"}
            tone="role-3"
            icon={UserPlus}
            label="新增用户"
            value={value(newUsers, (data) => fmtNum(data.today))}
            unit="人"
            sub={newUsers.error ? failed(newUsers) : newUsers.data ? `昨天全天 ${fmtNum(newUsers.data.yesterday)} 人` : undefined}
            explain={<>今天注册、账号没删除的人数，按北京时间切日。{dataTime}</>}
            href={newUsers.data && reach("/users/search") ? "/users/search" : undefined}
            openLabel="查找用户与查看资料"
          />
        )}
        {blocks.netFlow && (
          <Stat
            lead={leadKey === "netFlow"}
            label="资金净流入"
            value={flowToday ? signed(toUsdt(flowToday.netWan)) : flows.loading ? "…" : "—"}
            unit="USDT"
            sub={flows.error ? failed(flows) : flowToday ? `流入 ${fmtAmountCompact(toUsdt(flowToday.inflowWan))} USDT · 流出 ${fmtAmountCompact(toUsdt(flowToday.outflowWan))} USDT` : undefined}
            explain={<>
              今天到现在已确认的流入减流出。流入是用户充值加财务注资，所以财务打一笔注资也算流入；流出是提现打款和拒付退回。用余额买设备不算。
              {netFlow24h != null && ` 另一个算法是滚动近 24 小时：${fmtAmount(netFlow24h)} USDT，时间段不同，数可能不一样。`}{dataTime}
            </>}
            onOpen={flowToday ? onOpenFlows : undefined}
            openLabel="展开资金进出"
          />
        )}
        {blocks.devices && (
          <Stat
            lead={leadKey === "devices"}
            tone={abnormal > 0 ? "warn" : "done"}
            label="设备异常"
            value={value(devices, (data) => fmtNum(data.abnormal))}
            unit="台"
            sub={devices.error ? failed(devices) : devices.data ? (devices.data.online === 0 && abnormal > 0 ? "现在没有设备有心跳" : `10 分钟内有心跳 ${fmtNum(devices.data.online)} 台`) : undefined}
            explain={<>离线或异常的设备，已包含离线。上报在线且 10 分钟内有心跳才算有心跳。这个数没有告警线，不进待处理，橙色只提醒有设备不在线。要看是哪些设备、为什么不在线，去设备运行管理。设备没有历史，不和昨天比。{dataTime}</>}
            href={devices.data && reach("/devices/ops") ? "/devices/ops" : undefined}
            openLabel="查看设备运行管理"
          />
        )}
      </div>
    </Panel>
  );
}
