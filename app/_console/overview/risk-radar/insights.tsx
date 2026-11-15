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
  BlockState, Button, Cell, ColumnChart, Decision, Drawer, Explain, Fact, Facts, Fold, Panel, StatusDistributionBar, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr, TrendLines,
  type DrawerNav,
} from "@/app/components/rd";
import type { StateTone } from "@/app/components/rd";
import type { B5InboxItem, B5Radar } from "@/lib/admin/b5-client";
import { b5AmountDigits, b5AmountText } from "@/lib/admin/b5-money";
import { maskAuditActor } from "@/lib/admin/audit-actor";
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

/** 篡改项的叫法和「篡改防御监控」一致（后端 TamperDetectedEventProjector.pathName）。 */
const TAMPER_PATH: Record<string, string> = {
  free_trial_state: "试用状态篡改", risk_disclosure_ack: "风险披露确认篡改", two_factor_state: "两步验证状态篡改", product_phase_override: "产品阶段覆盖",
  device_slot_cap: "设备槽位上限篡改", dev_seed_state: "设备开发种子篡改", otp_verification: "验证码校验绕过", bill_client_push: "客户端账单伪造",
  client_minted_id: "客户端业务 ID 伪造", charge_fail_rate: "扣款成功率篡改",
};
/** 排查类别和动作的叫法和「异常套利与刷量排查」一致。 */
const K2_VIEW: Record<string, string> = { trial: "反复领试用", tradein: "置换套利", gift: "批量领新人礼", board: "排行榜刷榜" };
const K2_ACTION: Record<string, string> = { mark: "标记套利", "block-gift": "拦截新人礼", "board-flag": "标记刷榜", "freeze-cluster": "冻结关联账户" };
const FROZEN_SOURCE: Record<string, { page: string; line: string }> = { C2: { page: "「账户操作」", line: "在「账户操作」冻结" } };
/** 单个金额：原文本加千分位，去掉末尾的 0、最少两位，不舍入。 */
const usdt = (value: string) => `${b5AmountText(value, b5AmountDigits([value]))} USDT`;

/** 后端把这两类归在「其他风险信号」里；类型明确时换成运营的叫法，其余照后端给的类别。 */
const TYPE_NAME: Record<string, string> = { user_frozen: "账户冻结", d1_chargeback_shortfall: "拒付追回有差额" };
export const signalName = (alert: Alert) => (alert.signalType && TYPE_NAME[alert.signalType.toLowerCase()]) || alert.message;

type SignalFact = { k: string; v: ReactNode };
/**
 * 一条信号「具体是什么事」：只用后端给的 facts，没有的不推断（手工登记、来源不明的 facts 为空）。
 * line 是表格里的一句；rows 是详情里的事实；tech 是排查用的原始代码，进折叠的技术信息。
 */
export function signalFacts(alert: Alert): { line: string | null; rows: SignalFact[]; tech: SignalFact[] } {
  const f = alert.facts ?? {};
  const rows: SignalFact[] = [];
  const parts: string[] = [];
  const tech: SignalFact[] = [{ k: "信号号", v: <span data-mono>{alert.signalNo}</span> }];
  if (alert.signalType) tech.push({ k: "类型代码", v: <span data-mono>{alert.signalType}</span> });
  if (f.tamperPath !== undefined || f.attackEffect !== undefined) {
    const path = f.tamperPath === undefined ? undefined : TAMPER_PATH[f.tamperPath.toLowerCase()];
    if (path) { rows.push({ k: "篡改了什么", v: path }); parts.push(path); }
    if (f.attackEffect !== undefined) { rows.push({ k: "企图", v: f.attackEffect }); parts.push(`企图「${f.attackEffect}」`); }
    if (f.tamperPath !== undefined) tech.push({ k: "篡改项代码", v: <span data-mono>{f.tamperPath}</span> });
  }
  if (f.cycleCount !== undefined || f.windowDays !== undefined) {
    rows.push({ k: "排查类别", v: K2_VIEW.trial });
    if (f.cycleCount !== undefined) rows.push({ k: "开始试用", v: `${f.cycleCount} 次` });
    if (f.windowDays !== undefined) rows.push({ k: "统计周期", v: `${f.windowDays} 天` });
    parts.push(`${K2_VIEW.trial}：${f.windowDays !== undefined ? `${f.windowDays} 天内` : ""}${f.cycleCount !== undefined ? `开始试用 ${f.cycleCount} 次` : ""}`.replace(/：$/, ""));
  }
  if (f.view !== undefined || f.action !== undefined) {
    const view = f.view === undefined ? undefined : K2_VIEW[f.view];
    const action = f.action === undefined ? undefined : K2_ACTION[f.action];
    if (view) rows.push({ k: "排查类别", v: view });
    if (action) rows.push({ k: "运营动作", v: `已${action}` });
    if (view || action) parts.push([view, action && `已${action}`].filter(Boolean).join("："));
    if (f.view !== undefined) tech.push({ k: "排查类别代码", v: <span data-mono>{f.view}</span> });
    if (f.action !== undefined) tech.push({ k: "动作代码", v: <span data-mono>{f.action}</span> });
  }
  if (f.rowId !== undefined) tech.push({ k: "排查行号", v: <span data-mono>{f.rowId}</span> });
  if (f.source !== undefined) {
    const known = FROZEN_SOURCE[f.source];
    rows.push({ k: "冻结来源", v: known ? known.page : "其他来源" });
    if (known) parts.push(known.line);
    tech.push({ k: "来源代码", v: <span data-mono>{f.source}</span> });
  }
  if (f.caseNo !== undefined || f.walletShortfallUsdt !== undefined || f.feeBufferShortfallUsdt !== undefined) {
    if (f.caseNo !== undefined) rows.push({ k: "拒付案件", v: <span data-mono>{f.caseNo}</span> });
    if (f.walletShortfallUsdt !== undefined) rows.push({ k: "钱包少追回", v: usdt(f.walletShortfallUsdt) });
    if (f.feeBufferShortfallUsdt !== undefined) rows.push({ k: "手续费备用金不足", v: usdt(f.feeBufferShortfallUsdt) });
    const gaps = [f.walletShortfallUsdt !== undefined && `钱包少追回 ${usdt(f.walletShortfallUsdt)}`, f.feeBufferShortfallUsdt !== undefined && `手续费备用金不足 ${usdt(f.feeBufferShortfallUsdt)}`].filter(Boolean).join("，");
    parts.push([f.caseNo !== undefined && `案件 ${f.caseNo}`, gaps].filter(Boolean).join("："));
  }
  return { line: parts.length ? parts.join("，") : null, rows, tech };
}
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

/** 处理人和处理时间：只有标过进度的信号才有；没标过的不占位。 */
const handlerText = (alert: Alert) => alert.handledBy ? maskAuditActor(alert.handledBy) : null;

export function SignalsTable({ alerts, canTriage, updating, reach, selected, onOpen, onTriage, onStatus }: {
  alerts: B5Radar["recentAlerts"];
  canTriage: boolean;
  updating: string;
  reach: (path: string) => boolean;
  selected: string | null;
  onOpen: (alert: Alert) => void;
  onTriage: (path: string) => boolean;
  onStatus: (alert: Alert, target: "handled" | "resolved") => void;
}) {
  return (
      <Table label="最近风险信号" className="b5-signals">
        <thead>
          <tr>
            <Th>级别 · 风险信号</Th>
            <Th>发生时间</Th>
            <Th>处理进度 · 发送 <Explain label="处理进度和发送状态" content={<>
              <p>待处理 → 已处理 → 已解决，只能按顺序往前推。标记只记录进度，不会解除风控、不会放行提现。</p>
              <p>标过进度的写最近一次是谁、什么时候标的。第二行是这条信号最近一次的发送状态，不一定是发给你的。</p>
            </>} /></Th>
            <Th>去处理 <Explain label="去处理的说明" content="有分诊权限的，点链接先记一条分诊记录再打开对应页面；没记上就留在这页，重新点一次。没有分诊权限的只打开页面。" /></Th>
            {canTriage && <Th align="right">操作</Th>}
          </tr>
        </thead>
        <tbody>
          {alerts.length === 0 ? <TableMessage columns={canTriage ? 5 : 4}>近 7 个业务日没有风险信号</TableMessage> : alerts.map((alert) => {
            const page = TARGET_NAME[alert.target] ?? "对应页面";
            const next = alert.handlingStatus === "open" ? "handled" : alert.handlingStatus === "handled" ? "resolved" : null;
            const { line } = signalFacts(alert);
            const handler = handlerText(alert);
            return (
              <Tr key={alert.signalNo} selected={alert.signalNo === selected} onOpen={() => onOpen(alert)}>
                <Td grow><Cell title={line ? `${signalName(alert)} · ${line}` : undefined}
                  main={<><StatusTag tone={SEVERITY[alert.level].tone} icon={SEVERITY[alert.level].icon}>{SEVERITY[alert.level].text}</StatusTag><span className="b5-signal-name">{signalName(alert)}</span>{line && <span className="b5-signal-fact"> · {line}</span>}</>}
                  sub={<>用户 {alert.userNo ?? `#${alert.userId}`} · <SignalNo value={alert.signalNo} /></>} /></Td>
                <Td><Cell num main={shortStamp(alert.createdAt)} /></Td>
                <Td><Cell title={handler ? `${handler}${alert.handledAt ? ` · ${stamp(alert.handledAt)}` : ""}` : undefined}
                  main={<><StatusTag tone={HANDLING[alert.handlingStatus].tone}>{HANDLING[alert.handlingStatus].text}</StatusTag>{handler && <span className="b5-handler">{handler}{alert.handledAt && <span className="b5-muted"> {stamp(alert.handledAt).slice(5)}</span>}</span>}</>}
                  sub={deliveryStatusText(alert.deliveryStatus)} /></Td>
                <Td>{reach(alert.target)
                  ? <Link className="rd-link" href={alert.target} prefetch={false} onNavigate={(event) => { if (onTriage(alert.target)) event.preventDefault(); }}>{page}</Link>
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

/**
 * 一条风险信号的详情：是什么事 → 现在谁在跟 → 我能做什么（底栏）。排查用的原始代码收进「技术信息」。
 * 去处理和标记进度用表格里同一套处理：链接先分诊再跳转，标记打开原来的确认框。
 */
export function SignalDrawer({ alert, nav, canTriage, updating, reach, onClose, onTriage, onStatus }: {
  alert: Alert | null;
  nav: DrawerNav;
  canTriage: boolean;
  updating: string;
  reach: (path: string) => boolean;
  onClose: () => void;
  onTriage: (path: string) => boolean;
  onStatus: (alert: Alert, target: "handled" | "resolved") => void;
}) {
  if (!alert) return <Drawer open={false} onClose={onClose} title="风险信号">{null}</Drawer>;
  const page = TARGET_NAME[alert.target] ?? "对应页面";
  const next = alert.handlingStatus === "open" ? "handled" : alert.handlingStatus === "handled" ? "resolved" : null;
  const { rows, tech } = signalFacts(alert);
  const handler = handlerText(alert);
  const level = SEVERITY[alert.level];
  return (
    <Drawer open onClose={onClose} title={signalName(alert)} icon={level.icon} tone={level.tone} nav={nav}
      sub={<><span className="rd-drawer-ref" data-mono>{alert.signalNo}</span><StatusTag tone={level.tone} icon={level.icon}>{level.text}</StatusTag></>}
      footer={<Decision explain={<>
        <p>标记只记录进度，不会解除风控、不会放行提现。真正的处置到「{page}」办。</p>
        {canTriage && <p>有分诊权限时，点「去{page}」先记一条分诊记录再打开；没记上就留在这页。</p>}
      </>}
        others={reach(alert.target)
          ? <Link className="rd-btn" data-variant={next && canTriage ? "secondary" : "primary"} data-size="md" href={alert.target} prefetch={false}
            onNavigate={(event) => { if (onTriage(alert.target)) event.preventDefault(); }}><span className="rd-btn-face">去{page}</span></Link>
          : <span className="b5-muted">没有{page}权限</span>}
        primary={canTriage && next ? <Button variant="primary" loading={updating === alert.signalNo} onClick={() => onStatus(alert, next)}>{next === "handled" ? "标记已处理" : "标记已解决"}</Button> : undefined} />}>
      <Panel plain headingLevel={3} title="是什么事">
        <Facts>
          {rows.length ? rows.map((row) => <Fact key={row.k} k={row.k}>{row.v}</Fact>)
            : <Fact k="具体情况">没有记录，到「{page}」查看</Fact>}
          <Fact k="用户">{alert.userNo ?? `#${alert.userId}`}</Fact>
          <Fact k="发生时间">{stamp(alert.createdAt)}（北京时间）</Fact>
        </Facts>
      </Panel>
      <Panel plain headingLevel={3} title="现在谁在跟">
        <Facts>
          <Fact k="处理进度"><StatusTag tone={HANDLING[alert.handlingStatus].tone}>{HANDLING[alert.handlingStatus].text}</StatusTag></Fact>
          {alert.handlingStatus !== "open" && <Fact k="处理人">{handler ?? "—"}</Fact>}
          {alert.handlingStatus !== "open" && <Fact k="处理时间">{alert.handledAt ? `${stamp(alert.handledAt)}（北京时间）` : "—"}</Fact>}
          <Fact k="最近一次发送">{deliveryStatusText(alert.deliveryStatus)}</Fact>
        </Facts>
      </Panel>
      <Fold inset title="技术信息" summary="排查时用">
        <div className="rd-fold-flush">
          <Facts>{tech.map((row) => <Fact key={row.k} k={row.k}>{row.v}</Fact>)}</Facts>
        </div>
      </Fold>
    </Drawer>
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
