"use client";

/**
 * B5 下半页：出金压力走势、告警分布，以及「最近风险信号」「我的站内告警」两张表。
 * 图只画接口给的数：八个业务日的出金压力（看在涨还是在落、离 70% 提醒线多远），七个业务日的告警分级和每天的量（看哪一级最多、在变多还是变少）。
 * 原来的 data-testid 和 data-capability 标识照旧挂在对应的块上。
 */
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { AlertTriangle, CalendarRange, Clock3, Info, ShieldAlert, TrendingUp, type LucideIcon } from "lucide-react";
import {
  BlockState, Button, Cell, ColumnChart, Decision, Drawer, Explain, Fact, Facts, Fold, JudgmentPoints, Panel, StatusDistributionBar, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr, TrendLines,
  type DrawerNav, type JudgmentRow,
} from "@/app/components/rd";
import type { StateTone } from "@/app/components/rd";
import type { B5InboxItem, B5Radar } from "@/lib/admin/b5-client";
import type { B5Signal } from "@/lib/admin/b5-radar-contract";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import type { SignalCategory } from "@/lib/admin/risk-feed";
import { b5AmountDigits, b5AmountText } from "@/lib/admin/b5-money";
import { maskAuditActor } from "@/lib/admin/audit-actor";
import { summarizePressureHistory } from "@/lib/admin/b5-pressure-summary";
import { fmtConfigPct, fmtNum } from "@/lib/format";
import { ratioPct } from "./dimensions";

type Alert = B5Signal;
export type SignalRow = B5Signal;

/** 级别不是等待，不用默认的时钟图标。 */
export const SEVERITY: Record<Alert["level"], { text: string; tone: StateTone; icon: LucideIcon }> = {
  P0: { text: "紧急", tone: "danger", icon: ShieldAlert },
  P1: { text: "严重", tone: "warn", icon: AlertTriangle },
  P2: { text: "警告", tone: "neutral", icon: AlertTriangle },
  P3: { text: "提示", tone: "neutral", icon: Info },
};

/**
 * 信号号按单号写（TX-28）：放得下全显，放不下由所在格子在末尾省略（ST-04）；
 * 字一个不少，复制拿到的是全号；格子被切时能用键盘聚焦，悬停和聚焦都看全号（Cell 的 title）。
 */
export function SignalNo({ value }: { value: string }) {
  return <span data-mono>{value}</span>;
}

/** 名单没刷新成功（保留旧值）时，标记按钮禁用的原因（ST-36、OP-128）。 */
export const STALE_MARK_REASON = "名单没刷新成功，重试成功后再标记";

/**
 * 确认框里放不下的信号号：末尾省略，被切时能用 Tab 聚焦，聚焦和悬停都看全号（ST-04、TX-28）；
 * 字一个不少，复制拿到全号。气泡和表格格子（Cell）同一个样子。
 */
export function RefText({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const measure = () => setCut(box.scrollWidth > box.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [value]);
  return (
    <Tooltip.Provider>
      <Tooltip.Root open={cut && focused}>
        <Tooltip.Trigger asChild>
          <span ref={ref} className="b5-ref" data-mono title={value} tabIndex={cut ? 0 : undefined}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>{value}</span>
        </Tooltip.Trigger>
        <Tooltip.Portal><Tooltip.Content className="rd-tip rd-cell-tip" sideOffset={6}>{value}</Tooltip.Content></Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
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

/** API 时间按业务时区显示到分钟，历史命令的无偏移时间仍按存储时区解释。 */
export const stamp = (value: string) => formatBusinessTimeCompact(value, "—");

/** 篡改项的叫法和「篡改防御监控」一致（后端 TamperDetectedEventProjector.pathName）。 */
const TAMPER_PATH: Record<string, string> = {
  free_trial_state: "试用状态篡改", risk_disclosure_ack: "风险披露确认篡改", two_factor_state: "两步验证状态篡改", product_phase_override: "产品阶段覆盖",
  device_slot_cap: "设备槽位上限篡改", dev_seed_state: "设备开发种子篡改", otp_verification: "验证码校验绕过", bill_client_push: "客户端账单伪造",
  client_minted_id: "客户端业务 ID 伪造", charge_fail_rate: "扣款成功率篡改",
};
/** 排查类别和动作的叫法和「异常套利与刷量排查」一致。 */
const K2_VIEW: Record<string, string> = { trial: "反复领试用", tradein: "置换套利", gift: "批量领新人礼", board: "排行榜刷榜" };
/** 运营动作写成一句：人点的带「已」，系统自动发现的写「系统发现」（K2 同步排查行时发的信号，动作代码 detected）。 */
const K2_ACTION: Record<string, string> = { mark: "已标记套利", "block-gift": "已拦截新人礼", "board-flag": "已标记刷榜", "freeze-cluster": "已冻结关联账户", detected: "系统发现" };
const FROZEN_SOURCE: Record<string, { page: string; line: string }> = { C2: { page: "「账户操作」", line: "在「账户操作」冻结" } };
/** 单个金额：原文本加千分位，去掉末尾的 0、最少两位，不舍入。 */
const usdt = (value: string) => `${b5AmountText(value, b5AmountDigits([value]))} USDT`;

/** 后端把这两类归在「其他风险信号」里；类型明确时换成运营的叫法，其余照后端给的类别。 */
const TYPE_NAME: Record<string, string> = { user_frozen: "账户冻结", d1_chargeback_shortfall: "拒付追回有差额" };
export const signalName = (alert: SignalRow) => alert.categoryName ?? ((alert.signalType && TYPE_NAME[alert.signalType.toLowerCase()]) || alert.message);

type SignalFact = { k: string; v: ReactNode };
/**
 * 一条信号「具体是什么事」：只用后端给的 facts，没有的不推断（手工登记、来源不明的 facts 为空）。
 * line 是名单第一行和抽屉「是什么事」的一句；tech 是排查用的原文，进折叠的技术信息（只列后端实有的字段）。
 * 篡改的被拦入口和影响句用后端 B119 原文（blockedAtEndpointName、attackEffectSummary），前端不自写。
 */
export function signalFacts(alert: SignalRow): { line: string | null; tech: SignalFact[] } {
  const f = alert.facts ?? {};
  const parts: string[] = [];
  const tech: SignalFact[] = [{ k: "信号号", v: <span data-mono>{alert.signalNo}</span> }];
  if (alert.signalType) tech.push({ k: "类型代码", v: <span data-mono>{alert.signalType}</span> });
  if (f.tamperPath !== undefined) {
    const path = TAMPER_PATH[f.tamperPath.toLowerCase()];
    if (path) parts.push(path);
    tech.push({ k: "篡改项代码", v: <span data-mono>{f.tamperPath}</span> });
  }
  if (f.blockedAtEndpoint !== undefined) tech.push({ k: "被拦入口（原文）", v: <span data-mono>{f.blockedAtEndpoint}</span> });
  if (f.attackEffect !== undefined) tech.push({ k: "拦截说明（原文）", v: f.attackEffect });
  if (f.cycleCount !== undefined || f.windowDays !== undefined) {
    parts.push(`${K2_VIEW.trial}：${f.windowDays !== undefined ? `${f.windowDays} 天内` : ""}${f.cycleCount !== undefined ? `开始试用 ${f.cycleCount} 次` : ""}`.replace(/：$/, ""));
  }
  if (f.view !== undefined || f.action !== undefined) {
    const view = f.view === undefined ? undefined : K2_VIEW[f.view];
    const action = f.action === undefined ? undefined : K2_ACTION[f.action];
    if (view || action) parts.push([view, action].filter(Boolean).join("："));
    if (f.view !== undefined) tech.push({ k: "排查类别代码", v: <span data-mono>{f.view}</span> });
    if (f.action !== undefined) tech.push({ k: "动作代码", v: <span data-mono>{f.action}</span> });
  }
  if (f.rowId !== undefined) tech.push({ k: "排查行号", v: <span data-mono>{f.rowId}</span> });
  if (f.source !== undefined) {
    const known = FROZEN_SOURCE[f.source];
    parts.push(known ? known.line : "其他来源冻结");
    tech.push({ k: "来源代码", v: <span data-mono>{f.source}</span> });
  }
  // 拒付差额：钱的后果写在一句里，不收进技术信息（DT-10）；案件号是排查用的，进技术信息。
  if (f.walletShortfallUsdt !== undefined) parts.push(`钱包少追回 ${usdt(f.walletShortfallUsdt)}`);
  if (f.feeBufferShortfallUsdt !== undefined) parts.push(`手续费备用金少 ${usdt(f.feeBufferShortfallUsdt)}`);
  if (f.caseNo !== undefined) tech.push({ k: "拒付案件号", v: <span data-mono>{f.caseNo}</span> });
  return { line: parts.length ? parts.join(" · ") : null, tech };
}

/** 篡改类：有被拦入口这一项（后端没记时写「未记录」）。 */
export const isTamper = (alert: SignalRow) => alert.category === "TAMPER" || alert.facts?.tamperPath !== undefined || /tamper/i.test(alert.signalType ?? "");

/** 已解决的行级别标签用灰（VS-24），待处理、已处理照常上色。 */
export const levelTone = (alert: SignalRow): StateTone => (alert.handlingStatus === "resolved" ? "done" : SEVERITY[alert.level].tone);

/**
 * 「去处理」只给后端分诊目标和这一类相符的：多账户、套利或刷量、提现、篡改。
 * 账户冻结、拒付追回有差额、其他风险信号的后端目标是风险评分规则页，和这类事无关，不显示（OpsRiskRadarService.java:318–337）。
 */
const CATEGORY_TARGETS: Partial<Record<SignalCategory, string>> = {
  MULTI_ACCOUNT: "/risk/multi-account",
  ABUSE: "/risk/abuse",
  WITHDRAW: "/finance/withdrawals",
  TAMPER: "/emergency/tamper",
};
export const triageTarget = (alert: SignalRow) =>
  alert.category && alert.target === CATEGORY_TARGETS[alert.category] ? alert.target : null;
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
const handlerText = (alert: SignalRow) => alert.handledBy ? maskAuditActor(alert.handledBy) : null;

const HANDLING_ICON: Record<Alert["handlingStatus"], LucideIcon | undefined> = { open: Clock3, handled: undefined, resolved: undefined };

/** 名单和抽屉里同一个「去处理」：能记分诊的先记再跳；目标页进不了写「{页名} · 无权限」（ST-58）。 */
function TriageLink({ alert, reach, canTriageTarget, onTriage, triageState, button }: {
  alert: SignalRow;
  reach: (path: string) => boolean;
  canTriageTarget: (path: string) => boolean;
  onTriage: (path: string) => boolean;
  triageState: (path: string) => "active" | "blocked" | undefined;
  /** 抽屉底部用按钮的样子。 */
  button?: "primary" | "secondary";
}) {
  const target = triageTarget(alert);
  if (!target) return null;
  const page = TARGET_NAME[target] ?? "对应页面";
  if (!reach(target)) return <span className="b5-muted">{page} · 无权限</span>;
  if (!canTriageTarget(target)) return null;
  const state = triageState(target);
  const text = state === "active" ? "正在记录…" : button ? `去${page}` : page;
  return (
    <Link className={button ? "rd-btn" : "rd-link"} data-variant={button} data-size={button ? "md" : undefined} href={target} prefetch={false}
      aria-disabled={state ? true : undefined} title={state === "blocked" ? "正在记录另一条分诊，记完再点" : undefined}
      onNavigate={(event) => { if (onTriage(target)) event.preventDefault(); }}>{button ? <span className="rd-btn-face">{text}</span> : text}</Link>
  );
}

export function SignalsTable({ alerts, showBlocked = false, empty, canTriage, freezeHint, markBlocked, pendingSignalNos, updating, reach, canTriageTarget, selected, onOpen, onTriage, triageState, onStatus }: {
  alerts: readonly SignalRow[];
  /** 名单筛成篡改风险时多一列被拦入口。 */
  showBlocked?: boolean;
  /** 没有行时写什么：为什么空、下一步去哪（ST-33）。 */
  empty: ReactNode;
  canTriage: boolean;
  /** 进度表头问号里冻结、解冻去哪办，按账号权限写（design-plan 板 2、risk5 核文字）。 */
  freezeHint: string;
  /** 现在不能标记的原因（名单没刷新成功），按钮禁用并写这句。 */
  markBlocked?: string;
  pendingSignalNos: ReadonlySet<string>;
  updating: string;
  reach: (path: string) => boolean;
  canTriageTarget: (path: string) => boolean;
  selected: string | null;
  onOpen: (alert: SignalRow) => void;
  onTriage: (path: string) => boolean;
  /** 分诊记录中：active 是正在记的这条，blocked 是其余能记分诊的链接（显示成禁用，点了不动）。 */
  triageState: (path: string) => "active" | "blocked" | undefined;
  onStatus: (alert: SignalRow, target: "handled" | "resolved") => void;
}) {
  const columns = 4 + (showBlocked ? 1 : 0) + (canTriage ? 1 : 0);
  return (
      <Table label="最近风险信号" className="b5-signals" data-blocked={showBlocked ? "" : undefined}>
        <thead>
          <tr>
            <Th>级别 · 风险信号</Th>
            <Th>处理进度 · 发送 <Explain label="处理进度和发送状态" content={<>
              <p>待处理 → 已处理 → 已解决，只能按顺序往前推。标记只记录进度，不会解除风控、不会放行提现。{freezeHint}</p>
              <p>标过进度的写最近一次是谁标的。第二行是这条信号最近一次的发送状态，不一定是发给你的。</p>
            </>} /></Th>
            {showBlocked && <Th>被拦入口 <Explain label="被拦入口的说明" content="系统在哪一步拦下了这次篡改，后端没记的写「未记录」。" /></Th>}
            <Th>记录时间（{businessZone().label}）</Th>
            <Th>去处理 <Explain label="去处理的说明" content={<>
              <p>能记分诊的链接，点一下先记一条分诊记录再打开；没记上就留在这页，重新点一次。按住 Ctrl／Cmd 或用中键点，在新标签打开，不记分诊。</p>
              <p>账户冻结、拒付追回有差额、其他风险信号没有对应的排查页，这一格留空。</p>
            </>} /></Th>
            {canTriage && <Th align="right">操作</Th>}
          </tr>
        </thead>
        <tbody>
          {alerts.length === 0 ? <TableMessage columns={columns}>{empty}</TableMessage> : alerts.map((alert) => {
            const next = alert.handlingStatus === "open" ? "handled" : alert.handlingStatus === "handled" ? "resolved" : null;
            const { line } = signalFacts(alert);
            const handler = handlerText(alert);
            const level = SEVERITY[alert.level];
            const user = alert.userNo ?? `#${alert.userId}`;
            return (
              <Tr key={alert.signalNo} selected={alert.signalNo === selected} onOpen={() => onOpen(alert)}>
                <Td grow><Cell title={`${signalName(alert)}${line ? ` · ${line}` : ""} · 用户 ${user} · ${alert.signalNo}`}
                  main={<><StatusTag tone={levelTone(alert)} icon={level.icon}>{level.text}</StatusTag><span className="b5-signal-name">{signalName(alert)}</span>{line && <span className="b5-signal-fact"> · {line}</span>}</>}
                  sub={<>用户 <span data-mono>{user}</span> · <SignalNo value={alert.signalNo} /></>} /></Td>
                <Td><Cell title={handler ? `${handler}${alert.handledAt ? ` · ${stamp(alert.handledAt)}` : ""}` : undefined}
                  main={<><StatusTag tone={HANDLING[alert.handlingStatus].tone} icon={HANDLING_ICON[alert.handlingStatus]}>{HANDLING[alert.handlingStatus].text}</StatusTag>{handler && <span className="b5-handler">{handler}</span>}</>}
                  sub={deliveryStatusText(alert.deliveryStatus)} /></Td>
                {showBlocked && <Td><Cell main={alert.facts?.blockedAtEndpointName ?? <span className="b5-muted">未记录</span>} /></Td>}
                <Td><Cell num main={stamp(alert.createdAt)} sub={alert.occurredAt ? `拦截 ${stamp(alert.occurredAt)}` : isTamper(alert) ? "拦截 —" : undefined} /></Td>
                <Td>{canTriage && <TriageLink alert={alert} reach={reach} canTriageTarget={canTriageTarget} onTriage={onTriage} triageState={triageState} />}</Td>
                {canTriage && (
                  <Td align="right" data-fit="">
                    {next && (
                      <Button size="sm" loading={updating === alert.signalNo} disabledReason={markBlocked ?? (pendingSignalNos.has(alert.signalNo) ? "请先核对这条的原操作" : undefined)} onClick={() => onStatus(alert, next)}>
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
 * 一条风险信号的详情：开头 5 行判断要点（是什么事、被拦入口、哪个账户、什么时候、处理到哪），排查用的原文收进「技术信息」，
 * 决定按钮固定在底部（OP-149、OP-150）。去处理和标记进度用名单里同一套处理。
 */
export function SignalDrawer({ alert, nav, canTriage, canFreeze, canAudit, markBlocked, userHref, actionsHref, updating, reach, canTriageTarget, onClose, onTriage, triageState, onStatus, readLoading, readError, staleNotice, onRetry }: {
  alert: SignalRow | null;
  readLoading: boolean;
  readError: string | null;
  staleNotice?: ReactNode;
  canTriageTarget: (path: string) => boolean;
  onRetry: () => void;
  nav: DrawerNav;
  canTriage: boolean;
  /** 能在「账户操作」冻结、解冻：问号里写去哪办；不能时写找有权限的同事。 */
  canFreeze: boolean;
  /** 能看「操作记录与审批」：不能时问号里写结果未知时找谁核对。 */
  canAudit: boolean;
  /** 现在不能标记的原因（名单没刷新成功），按钮禁用并写这句。 */
  markBlocked?: string;
  /** 用户编号去用户详情、「查看账户操作」去账户操作的地址；目标进不了不传，只显示编号。 */
  userHref?: string;
  actionsHref?: string;
  updating: string;
  reach: (path: string) => boolean;
  onClose: () => void;
  onTriage: (path: string) => boolean;
  /** 分诊记录中：active 是正在记的这条，blocked 是其余能记分诊的链接（显示成禁用，点了不动）。 */
  triageState: (path: string) => "active" | "blocked" | undefined;
  onStatus: (alert: SignalRow, target: "handled" | "resolved") => void;
}) {
  if (!alert) return <Drawer open={false} onClose={onClose} title="风险信号">{null}</Drawer>;
  const target = triageTarget(alert);
  const page = target ? TARGET_NAME[target] ?? "对应页面" : null;
  const next = alert.handlingStatus === "open" ? "handled" : alert.handlingStatus === "handled" ? "resolved" : null;
  const { line, tech } = signalFacts(alert);
  const handler = handlerText(alert);
  const level = SEVERITY[alert.level];
  const user = alert.userNo ?? `#${alert.userId}`;
  const rows: JudgmentRow[] = [
    { label: "是什么事", value: `${signalName(alert)}${line ? ` · ${line}` : ""}`, reason: alert.facts?.attackEffectSummary },
    ...(isTamper(alert) ? [{ label: "被拦入口", value: alert.facts?.blockedAtEndpointName ?? <span className="b5-muted">未记录</span> }] : []),
    { label: "哪个账户", value: <>{userHref ? <Link className="rd-link" href={userHref} prefetch={false} data-mono="">{user}</Link> : <span data-mono>{user}</span>}
      {actionsHref && <> · <Link className="rd-link" href={actionsHref} prefetch={false}>查看账户操作</Link></>}</> },
    { label: "什么时候", value: `记录 ${stamp(alert.createdAt)}`, reason: alert.occurredAt ? `拦截 ${stamp(alert.occurredAt)} · ${businessZone().label}` : isTamper(alert) ? `拦截 — · ${businessZone().label}` : businessZone().label },
    { label: "处理到哪", value: <><StatusTag tone={HANDLING[alert.handlingStatus].tone} icon={HANDLING_ICON[alert.handlingStatus]}>{HANDLING[alert.handlingStatus].text}</StatusTag>
      {handler && <span className="b5-handler"> {handler}{alert.handledAt && <span className="b5-muted"> {stamp(alert.handledAt)}</span>}</span>}</>,
      reason: `最近一次发送：${deliveryStatusText(alert.deliveryStatus)}` },
  ];
  const triageShown = canTriage && !!target && canTriageTarget(target);
  const unread = !staleNotice && (readLoading || readError);
  return (
    <Drawer open onClose={onClose} title={signalName(alert)} icon={level.icon} tone={levelTone(alert)} nav={nav}
      sub={<><span className="rd-drawer-ref" data-mono>{alert.signalNo}</span><StatusTag tone={levelTone(alert)} icon={level.icon}>{level.text}</StatusTag></>}
      footer={!unread && <Decision explain={<>
        <p>标记为「{next === "resolved" ? "已解决" : "已处理"}」只记录进度，不会解除风控，也不会放行提现。</p>
        <p>{canFreeze ? `冻结、解冻到「账户操作」办${triageShown ? `；排查到「${page}」看。` : "。"}` : "冻结、解冻要由有「账户操作」权限的同事办。"}</p>
        {!canAudit && canTriage && <p>你标记后结果未知时，请有「操作记录与审批」查看权限的同事按原操作核对。</p>}
      </>}
        others={canTriage && <TriageLink alert={alert} reach={reach} canTriageTarget={canTriageTarget} onTriage={onTriage} triageState={triageState} button={next ? "secondary" : "primary"} />}
        primary={canTriage && next ? <Button variant="primary" loading={updating === alert.signalNo} disabledReason={markBlocked} onClick={() => onStatus(alert, next)}>{next === "handled" ? "标记已处理" : "标记已解决"}</Button> : undefined} />}>
      {staleNotice}
      {unread ? <BlockState state={readError ? "error" : "loading"} title={readError ? "风险信号详情加载失败" : "正在加载风险信号详情…"} detail={readError ?? undefined} onRetry={readError ? onRetry : undefined} /> : <>
      <JudgmentPoints rows={rows} />
      <Fold inset title="技术信息" summary={`${tech.length} 项，排查时用`}>
        <div className="rd-fold-flush">
          <Facts>{tech.map((row) => <Fact key={row.k} k={row.k}>{row.v}</Fact>)}</Facts>
        </div>
      </Fold>
      </>}
    </Drawer>
  );
}

/** 后端真实的发送状态（含 SENDING，B5-D09）。认不出的写待核实，不猜。 */
export const deliveryStatusText = (value: string) => ({
  PENDING: "待发送", SENDING: "发送中", PROCESSING: "发送中", DELIVERED: "已送达", SANDBOX_DELIVERED: "测试送达", NOT_QUEUED: "还没发出",
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

export function InboxTable({ state, items, error, onRetry, canTriage, acknowledgeBlocked, acknowledging, onAcknowledge }: {
  state: "loading" | "error" | "ready";
  items: readonly InboxRow[];
  error: string;
  onRetry: () => void;
  canTriage: boolean;
  acknowledgeBlocked?: string;
  acknowledging: number | null;
  onAcknowledge: (item: B5InboxItem) => void;
}) {
  if (state === "error") {
    return <BlockState state="error" title="站内告警加载失败，不是没有告警" detail={error} onRetry={onRetry} />;
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
                          disabledReason={acknowledgeBlocked ?? (delivered ? undefined : "这条还没送达，送达后才能确认")}
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
