"use client";

/**
 * B5 下半页：出金压力走势、告警分布，以及「最近风险信号」「我的站内告警」两张表。
 * 图只画接口给的数：八个业务日的出金压力（看在涨还是在落、离 70% 提醒线多远），七个业务日的告警分级和每天的量（看哪一级最多、在变多还是变少）。
 * 原来的 data-testid 和 data-capability 标识照旧挂在对应的块上。
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, CalendarRange, Info, ShieldAlert, TrendingUp, type LucideIcon } from "lucide-react";
import {
  BlockState, Button, Cell, ColumnChart, Explain, Panel, StatusDistributionBar, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr, TrendLines,
} from "@/app/components/rd";
import type { StateTone } from "@/app/components/rd";
import type { B5InboxItem, B5Radar } from "@/lib/admin/b5-client";
import { summarizePressureHistory } from "@/lib/admin/b5-pressure-summary";
import { fmtConfigPct, fmtNum } from "@/lib/format";
import { ratioPct } from "./dimensions";

type Alert = B5Radar["recentAlerts"][number];

/** 级别不是等待，不用默认的时钟图标。 */
export const SEVERITY: Record<Alert["level"], { text: string; tone: StateTone; icon: LucideIcon }> = {
  P0: { text: "紧急", tone: "danger", icon: ShieldAlert },
  P1: { text: "严重", tone: "warn", icon: AlertTriangle },
  P2: { text: "警告", tone: "neutral", icon: AlertTriangle },
  P3: { text: "提示", tone: "neutral", icon: Info },
};

/** 长单号（K2 的 40 位哈希）中间省略，留开头和能区分的结尾，悬停看全号。 */
export function SignalNo({ value }: { value: string }) {
  return value.length > 24
    ? <span data-mono title={value}>{value.slice(0, 12)}…{value.slice(-8)}</span>
    : <span data-mono>{value}</span>;
}

export const HANDLING: Record<Alert["handlingStatus"], { text: string; tone: StateTone }> = {
  open: { text: "待处理", tone: "warn" },
  handled: { text: "已处理", tone: "progress" },
  resolved: { text: "已解决", tone: "done" },
};

/** 信号去向的页面名，和侧栏同名。 */
export const TARGET_NAME: Record<string, string> = {
  "/risk/multi-account": "多账户风险排查",
  "/risk/abuse": "异常套利与刷量排查",
  "/finance/withdrawals": "提现审核",
  "/emergency/tamper": "篡改防御监控",
  "/risk/scoring": "风险评分规则",
};

/** 存储时间不带时区，原样只换 T（和旧队列一样，不按浏览器时区换算）。 */
export const stamp = (value: string) => value.replace("T", " ").slice(0, 16);
/** 近 7 个业务日的信号表里只写月日和时分，年份都一样；悬停看完整时间。 */
const shortStamp = (value: string) => <span title={stamp(value)}>{stamp(value).slice(5)}</span>;
const dayTick = (label: string) => (/^\d{4}-/.test(label) ? label.slice(5) : label);

export function PressureTrend({ data }: { data: B5Radar }) {
  const history = data.pressureHistory;
  const values = history.map((row) => (row.ratio === null ? null : row.ratio * 100));
  const { latestPct: latest, previousComparablePct: previous } = summarizePressureHistory(history, data.bankrun.pressureRatio);
  const gaps = values.some((value) => value === null);
  const allEmpty = values.every((value) => value === null);
  const direction = latest === null || previous === null ? null : latest > previous ? "在涨" : latest < previous ? "在落" : "持平";
  const pct = (value: number) => fmtConfigPct(Number(value.toFixed(2)));
  return (
    <Panel data-testid="b1-withdraw-pressure-trend" title="出金压力走势" sub="近 8 个业务日" icon={TrendingUp} tone="role-2"
      explain={<>
        <p>每个业务日：（提现出金 + 佣金）÷ 当天全部流入。最后一个点是今天截至现在，和上面「近 24 小时」不是同一个范围。</p>
        <p>70% 是固定提醒线，只提醒，不自动处理。当天没有流入就算不出来，线在那里断开。</p>
      </>}>
      {allEmpty ? <p className="b5-line">近 8 个业务日都没有流入，出金压力算不出来。</p> : (
        <div className="b5-stack">
          <p className="b5-line">
            今天 <b className="b5-strong">{latest === null ? "暂无法计算" : pct(latest)}</b>
            {direction && <span>，{direction}</span>}
            <span className="b5-muted">{previous === null ? " · 没有可比的前一天" : ` · 前一个可比日 ${pct(previous)}`}</span>
          </p>
          <TrendLines label={`出金压力近 8 个业务日走势，提醒线 70%${latest === null ? "" : `，今天 ${pct(latest)}`}`}
            ticks={history.map((row) => dayTick(row.label))}
            series={[{ key: "pressure", label: "出金压力", slot: 2, values }]}
            format={pct} axisFormat={(value) => `${Math.round(value)}%`}
            marks={[{ key: "line", text: "提醒线 70%", value: data.bankrun.pressureRedLine * 100, tone: "warn" }]} />
          {gaps && <p className="b5-caption">没有流入的日子算不出来，线在那里断开。</p>}
        </div>
      )}
    </Panel>
  );
}

const SEVERITY_SEGMENT_TONE: Record<Alert["level"], StateTone | "role-other"> = { P0: "danger", P1: "warn", P2: "neutral", P3: "role-other" };

export function AlertDistribution({ data }: { data: B5Radar }) {
  const total = data.alertSeverity.reduce((sum, row) => sum + row.count, 0);
  const top = [...data.alertSeverity].sort((a, b) => b.count - a.count)[0];
  return (
    <Panel data-testid="b4-alert-severity-distribution" title="告警分布" sub={`近 7 个业务日 · 共 ${fmtNum(total)} 条`} icon={CalendarRange} tone="role-3"
      explain="近 7 个业务日产生的全部风险信号，按级别和日期统计，已处理、已解决的也算在内。">
      {total === 0 ? <p className="b5-line">近 7 个业务日没有风险信号。</p> : (
        <div className="b5-stack">
          <p className="b5-line">最多的是「{SEVERITY[top.level].text}」，<b className="b5-strong">{fmtNum(top.count)}</b> 条</p>
          <StatusDistributionBar label="告警按级别分布" segments={data.alertSeverity.map((row) => ({
            key: row.level, label: SEVERITY[row.level].text, value: row.count, text: `${fmtNum(row.count)} 条`, tone: SEVERITY_SEGMENT_TONE[row.level],
          }))} />
          <div data-testid="b4-alert-volume-history" className="b5-volume">
            <span className="b5-caption">每天的条数</span>
            <ColumnChart label="近 7 个业务日每天的风险信号条数" height={120} series={[{ label: "风险信号", slot: 3 }]}
              format={(value) => `${fmtNum(value)} 条`} axisFormat={(value) => (Number.isInteger(value) ? fmtNum(value) : "")}
              data={data.alertVolume.map((row) => ({ key: row.label, tick: dayTick(row.label), values: [row.count] }))} />
          </div>
        </div>
      )}
    </Panel>
  );
}

export function SignalsTable({ alerts, canTriage, updating, reach, onStatus }: {
  alerts: B5Radar["recentAlerts"];
  canTriage: boolean;
  updating: string;
  reach: (path: string) => boolean;
  onStatus: (alert: Alert, target: "handled" | "resolved") => void;
}) {
  return (
      <Table label="最近风险信号" className="b5-signals">
        <thead>
          <tr>
            <Th>级别 · 风险信号</Th>
            <Th>发生时间</Th>
            <Th>处理进度 · 发送 <Explain label="处理进度和发送状态" content={<>
              <p>待处理 → 已处理 → 已解决，只能按这个顺序往前推，不能跳步或退回。标记只记录进度，不会解除风控、不会放行提现。</p>
              <p>处理人接口暂未返回，处理记录到「操作记录与审批」查。第二行是这条信号最近一次的发送状态（任一接收人、任一渠道），不一定是发给你的。</p>
            </>} /></Th>
            <Th>去处理 <Explain label="去处理的说明" content="链接只打开对应页面，不记分诊记录。要留分诊记录，从上面的五项点进去。" /></Th>
            {canTriage && <Th align="right">操作</Th>}
          </tr>
        </thead>
        <tbody>
          {alerts.length === 0 ? <TableMessage columns={canTriage ? 5 : 4}>近 7 个业务日没有风险信号</TableMessage> : alerts.map((alert) => {
            const page = TARGET_NAME[alert.target] ?? "对应页面";
            const next = alert.handlingStatus === "open" ? "handled" : alert.handlingStatus === "handled" ? "resolved" : null;
            return (
              <Tr key={alert.signalNo}>
                <Td><Cell main={<span className="b5-signal-main"><StatusTag tone={SEVERITY[alert.level].tone} icon={SEVERITY[alert.level].icon}>{SEVERITY[alert.level].text}</StatusTag>{alert.message}</span>}
                  sub={<>用户 {alert.userNo ?? `#${alert.userId}`} · <SignalNo value={alert.signalNo} /></>} /></Td>
                <Td><Cell num main={shortStamp(alert.createdAt)} /></Td>
                <Td><Cell main={<StatusTag tone={HANDLING[alert.handlingStatus].tone}>{HANDLING[alert.handlingStatus].text}</StatusTag>} sub={deliveryStatusText(alert.deliveryStatus)} /></Td>
                <Td>{reach(alert.target)
                  ? <Link className="rd-link" href={alert.target} prefetch={false}>{page}</Link>
                  : <span className="b5-muted">没有{page}权限</span>}</Td>
                {canTriage && (
                  <Td align="right" data-fit="">
                    {next && (
                      <Button size="sm" loading={updating === alert.signalNo} onClick={() => onStatus(alert, next)}>
                        {next === "handled" ? "标记已处理" : "标记已解决"}
                      </Button>
                    )}
                  </Td>
                )}
              </Tr>
            );
          })}
        </tbody>
      </Table>
  );
}

/** 后端真实的发送状态（含 SENDING，B5-D09）。认不出的写待核实，不猜。 */
export const deliveryStatusText = (value: string) => ({
  PENDING: "待发送", SENDING: "发送中", PROCESSING: "发送中", DELIVERED: "已送达", SANDBOX_DELIVERED: "测试送达", NOT_QUEUED: "尚未加入发送队列",
  FAILED_RETRY: "发送失败，等待重试", DEAD: "发送已终止", SENT: "已发送", FAILED: "发送失败",
} as Record<string, string>)[value.toUpperCase()] ?? "发送状态待核实";

const DELIVERY_TONE: Record<string, StateTone> = {
  DELIVERED: "ok", SANDBOX_DELIVERED: "done", SENT: "ok", PENDING: "progress", SENDING: "progress", PROCESSING: "progress",
  FAILED_RETRY: "warn", FAILED: "danger", DEAD: "danger", NOT_QUEUED: "neutral",
};

const RECEIPT_SOURCE: Record<string, string> = { "durable-inbox": "站内", "controlled-proxy": "外部通知", provider: "外部通知服务", mock: "测试" };

/**
 * 站内告警一行。没送达的行后端给的送达来源和送达时间是空的（B5-F01）：这里先按可空写好「还没送达」的样子，
 * 解析放开空值由代码 worker 接（lib/admin/b5-client.ts normalizeInbox）。
 */
type InboxRow = Omit<B5InboxItem, "deliveredAt" | "receiptSource"> & { deliveredAt: string | null; receiptSource: string | null };

export function InboxTable({ state, items, error, onRetry, canTriage, acknowledging, onAcknowledge }: {
  state: "loading" | "error" | "ready";
  items: readonly InboxRow[];
  error: string;
  onRetry: () => void;
  canTriage: boolean;
  acknowledging: number | null;
  onAcknowledge: (item: B5InboxItem) => void;
}) {
  if (state === "error") {
    return <BlockState state="error" title="站内告警读取失败，不是没有告警" detail={error} onRetry={onRetry} />;
  }
  return (
      <Table label="我的站内告警" className="b5-inbox">
        <thead>
          <tr>
            <Th>风险信号</Th>
            <Th>发送</Th>
            <Th>送达时间</Th>
            <Th>确认 · 已读</Th>
            {canTriage && <Th align="right">操作</Th>}
          </tr>
        </thead>
        <tbody>
          {state === "loading" ? <TableLoading columns={canTriage ? 5 : 4} rows={3} /> : items.length === 0
            ? <TableMessage columns={canTriage ? 5 : 4}>没有发给你的站内告警</TableMessage>
            : items.map((item) => {
              // 只有送达时间为空的行（还没送达）才挡住；能读到的行照旧都给「确认已读」，后端按送达状态校验。
              const delivered = item.deliveryStatus === "DELIVERED" && item.deliveredAt !== null;
              return (
                <Tr key={item.id}>
                  <Td><Cell main={<SignalNo value={item.signalNo} />} /></Td>
                  <Td><Cell main={<StatusTag tone={DELIVERY_TONE[item.deliveryStatus.toUpperCase()] ?? "neutral"}>{deliveryStatusText(item.deliveryStatus)}</StatusTag>}
                    sub={item.receiptSource ? `渠道：${RECEIPT_SOURCE[item.receiptSource] ?? "未知"}` : undefined} /></Td>
                  <Td><Cell num main={item.deliveredAt ? stamp(item.deliveredAt) : <span className="b5-muted">还没送达</span>} /></Td>
                  <Td><Cell main={item.acknowledgedAt ? `已确认 ${stamp(item.acknowledgedAt)}` : <StatusTag tone="warn">未确认</StatusTag>}
                    sub={item.readAt ? `已读 ${stamp(item.readAt)}` : "未读"} /></Td>
                  {canTriage && (
                    <Td align="right" data-fit="">
                      {!item.acknowledgedAt && (
                        <Button size="sm" loading={acknowledging === item.id}
                          disabledReason={delivered ? undefined : "这条还没送达，送达后才能确认"}
                          onClick={() => onAcknowledge(item)}>确认已读</Button>
                      )}
                    </Td>
                  )}
                </Tr>
              );
            })}
        </tbody>
      </Table>
  );
}

/** 页签下面一行：数量和口径问号。页签已经写了名字，面板不再重复标题。 */
export function TabNote({ children, explain, label }: { children: ReactNode; explain: ReactNode; label: string }) {
  return <p className="b5-tab-note">{children}<Explain label={label} content={explain} /></p>;
}
