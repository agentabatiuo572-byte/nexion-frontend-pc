"use client";

/**
 * 第二层：5 行带结论的折叠摘要，点一下原地展开。标题写结论，不重复首屏数字（DP-04、DP-61）。
 * 每块最多一个「查看…」入口，放在标题行右侧，正文色不加箭头（VS-06）；结论句已给的入口这里不再给一个。读取失败一行写完，不占整块。
 * 资金和风险用首屏已读的数据；资金进出的今日明细、用户与转化、关键指标展开时才读，
 * 转化每读一次写一条审计，所以第一次展开后才挂载，收起也不卸载。
 */
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeftRight, ShieldAlert, Target, Users, Wallet, XCircle } from "lucide-react";
import { AutoGloss } from "@/app/components/kit/gloss";
import { BarList, Bars, BlockState, Button, Explain, Fact, Facts, Fold, Modal, StatusTag, ThresholdMeter, TrendLines } from "@/app/components/rd";
import { fetchB0Kpis, fetchB0Redemption, type B0Kpi } from "@/lib/admin/b0-client";
import type { B0Blocks } from "@/lib/admin/b0-access";
import type { B2LiquidityHistory } from "@/lib/admin/b-restoration-client";
import type { BLedger, BLiquidity, BRiskRadar } from "@/lib/admin/b-client";
import { useB3Funnel } from "@/lib/admin/b3-client";
import { fetchD1TopupOverview } from "@/lib/admin/d-client";
import { rollupKpiPassState } from "@/lib/admin/dashboard-number";
import { liabilityDisplayName } from "@/lib/admin/liability-labels";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { fetchC1Overview } from "@/lib/admin/user360-client";
import { fmtAmount, fmtNum, fmtPct } from "@/lib/format";
import type { FundLevel } from "./status";
import { useBlock } from "./use-block";

const usdt = (value: number) => `${fmtAmount(value)} USDT`;
const FUNNEL_FILTERS = { cohort: "ALL", phase: "ALL", ref: "ALL" };
/** T10：少于 5 人不算比例。 */
const SMALL_SAMPLE = 5;

export type FoldProps = { open: boolean; onOpenChange: (open: boolean) => void };
type Reach = (href: string) => boolean;

/** 第一次展开后一直算打开过，展开才读的数据收起也不重读。 */
function useOpenedOnce(open: boolean) {
  const [opened, setOpened] = useState(open);
  useEffect(() => { if (open) setOpened(true); }, [open]);
  return opened;
}

/** 目标页可达才显示（X03）。 */
function FoldLink({ href, reach, children }: { href: string; reach: Reach; children: ReactNode }) {
  return reach(href) ? <Link href={href} prefetch={false}>{children}</Link> : null;
}

/** 目标写成 >95%，页面上写 > 95%。 */
function targetText(value: string) {
  return operatorCopyText(value).replace(/^([<>])\s*/, "$1 ");
}

function Amount({ label, value, tone, note, href, reach }: { label: string; value: number; tone?: "role-1" | "role-2"; note?: string; href: string; reach: Reach }) {
  const body = (
    <>
      <span className="cc-amount-label"><AutoGloss>{label}</AutoGloss></span>
      <span className="cc-amount-value" data-tone={tone}>{usdt(value)}{note && <span className="cc-amount-note">{note}</span>}</span>
    </>
  );
  return reach(href) ? <Link className="cc-amount" href={href} prefetch={false}>{body}</Link> : <div className="cc-amount">{body}</div>;
}

function fundFoldSummary(ledger: BLedger | null, liquidity: BLiquidity | null, error: string | null, level: FundLevel) {
  if (error) return "读取失败";
  if (!ledger || !liquidity) return "正在读取…";
  const net = ledger.reserveUsd - ledger.liabilitiesUsd;
  const word = net > 0 ? "储备多于应付款" : net === 0 ? "储备刚好够付应付款" : "储备不够付应付款";
  // 摘要上色时文字也要说出状态（VS-21）。
  const prefix = level === "danger" ? "资金告警，" : level === "warn" ? "资金需要注意，" : "";
  return `${prefix}${word}，未来 7 天${liquidity.runwayTotalWan > 0 ? "有到期" : "没有到期"}`;
}

export function FundFold({ ledger, liquidity, error, retrying, onRetry, alert, level, clock, reach, linkInBrief, open, onOpenChange }: FoldProps & {
  ledger: BLedger | null;
  liquidity: BLiquidity | null;
  error: string | null;
  retrying: boolean;
  /** 结论句已经给了重试时不传。 */
  onRetry?: () => void;
  alert: boolean;
  level: FundLevel;
  clock: string | null;
  reach: Reach;
  /** 结论句已经给了去资金总览的入口。 */
  linkInBrief?: boolean;
}) {
  const net = ledger ? ledger.reserveUsd - ledger.liabilitiesUsd : 0;
  const accounts = (ledger?.accounts ?? []).filter((item) => item.amount > 0).sort((a, b) => b.amount - a.amount);
  const others = accounts.slice(3).reduce((sum, item) => sum + item.amount, 0);
  const dueRows = (liquidity?.runway ?? []).map((item) => ({ label: item.day.slice(5), values: [item.valueWan * 10_000] }));
  const dueDays = dueRows.filter((row) => row.values[0] > 0);
  // 覆盖率条的颜色只看覆盖率和两条线，和首屏的「跌破红线」「警戒」同一个比较（严格小于）。
  const coverTone = !ledger ? "ok" : ledger.coverageRatio < ledger.redlinePct ? "danger" : ledger.coverageRatio < ledger.healthyPct ? "warn" : "ok";
  return (
    <Fold title="资金明细" summary={fundFoldSummary(ledger, liquidity, error, level)} icon={Wallet} tone="role-1" alert={alert} alertTone={level === "danger" ? "danger" : "warn"} open={open} onOpenChange={onOpenChange}
      actions={linkInBrief ? undefined : <FoldLink reach={reach} href="/overview/dual-ledger">查看资金总览</FoldLink>}>
      {error ? <BlockState compact state="error" title="资金数据读取失败" detail={error} onRetry={onRetry} retrying={retrying} />
        : !ledger || !liquidity ? <BlockState state="loading" title="正在读取…" />
          : (
            <div className="cc-fold-stack">
              <div className="cc-amounts">
                <Amount label="可用储备" value={ledger.reserveUsd} tone="role-1" href="/overview/dual-ledger" reach={reach} />
                <Amount label="应付款" value={ledger.liabilitiesUsd} tone="role-2" href="/overview/dual-ledger" reach={reach} />
                <Amount label="差额（储备 − 应付款）" value={net} note={net > 0 ? "有富余" : net === 0 ? "刚好够" : "不够付"} href="/overview/dual-ledger" reach={reach} />
              </div>
              <ThresholdMeter
                label="覆盖率和红线、健康线"
                rows={[{ key: "coverage", label: "覆盖率（储备 ÷ 应付款）", value: ledger.coverageRatio, text: fmtPct(ledger.coverageRatio), tone: coverTone }]}
                marks={[
                  { key: "redline", text: `红线 ${fmtPct(ledger.redlinePct, 0)}`, value: ledger.redlinePct, tone: "danger" },
                  { key: "healthy", text: `健康线 ${fmtPct(ledger.healthyPct, 0)}`, value: ledger.healthyPct, tone: "ok" },
                ]}
              />
              <div className="cc-cols">
              <section className="cc-bars" aria-label="应付款">
                <h3 className="cc-sub">应付款最多的几类<FoldLink reach={reach} href="/overview/liquidity">查看全部 9 类</FoldLink></h3>
                {accounts.length === 0 ? <p className="cc-line">目前没有应付款</p> : accounts.length === 1 ? <p className="cc-line">全部是{liabilityDisplayName(accounts[0].key, operatorCopyText(accounts[0].label))}，{usdt(accounts[0].amount)}</p> : (
                  <BarList label="应付款最多的几类" slot={2} rows={[
                    ...accounts.slice(0, 3).map((item) => ({ key: item.key, label: liabilityDisplayName(item.key, operatorCopyText(item.label)), value: item.amount, text: usdt(item.amount) })),
                    ...(others > 0 ? [{ key: "others", label: `其他 ${accounts.length - 3} 类`, value: others, text: usdt(others) }] : []),
                  ]} />
                )}
              </section>
              <section aria-label="未来 7 天到期">
                <h3 className="cc-sub">
                  <Explain label="到期怎么算" content={`每天到期要付的金额，按运营总览的可支撑天数设置计算，是预测，不是历史。${clock ? `数据时间 ${clock}。` : ""}`}>未来 7 天到期</Explain>
                </h3>
                {dueDays.length > 1
                  ? <Bars label="未来 7 天哪天付款压力大" series={[{ name: "到期", slot: 3 }]} rows={dueRows} format={usdt} height={96} />
                  : <p className="cc-line">{dueDays.length ? `只有 ${dueDays[0].label} 到期，${usdt(dueDays[0].values[0])}` : "未来 7 天没有到期"}</p>}
              </section>
              </div>
            </div>
          )}
    </Fold>
  );
}

const GATE_NAMES: Record<string, string> = { withdraw: "提现", exchange: "兑换", staking: "质押", genesis: "创世节点", trial: "免费试用" };

export function pressureLevel(ledger: BLedger | null, risk: BRiskRadar | null) {
  if (!ledger || !risk) return { flow: "ok", backlog: "ok", worst: "ok" } as const;
  const level = (pct: number) => (pct >= risk.bankRunRedlinePct ? "danger" : pct >= risk.bankRunYellowPct ? "warn" : "ok");
  const flow = level(risk.bankRunRatio);
  const backlog = level(ledger.pressureRatio * 100);
  return { flow, backlog, worst: flow === "danger" || backlog === "danger" ? "danger" : flow === "warn" || backlog === "warn" ? "warn" : "ok" } as const;
}

function riskFoldSummary(ledger: BLedger | null, risk: BRiskRadar | null, error: string | null) {
  if (error) return "读取失败";
  if (!ledger || !risk) return "正在读取…";
  const closed = risk.gates.filter((gate) => !gate.on);
  const parts = [
    closed.length === 0 ? "五个业务都开着" : `${closed.length} 个业务没有开启`,
    risk.flaggedAccounts === 0 ? "没有异常账户" : `异常账户 ${fmtNum(risk.flaggedAccounts)} 个`,
  ];
  const { worst } = pressureLevel(ledger, risk);
  if (worst !== "ok") parts.push(worst === "danger" ? "提现压力达到红线" : "提现压力达到黄线");
  return parts.join("，");
}

export function RiskFold({ ledger, risk, error, retrying, onRetry, alert, reach, linkInBrief, open, onOpenChange }: FoldProps & {
  ledger: BLedger | null;
  risk: BRiskRadar | null;
  error: string | null;
  retrying: boolean;
  /** 结论句已经给了重试时不传。 */
  onRetry?: () => void;
  alert: boolean;
  reach: Reach;
  /** 结论句已经给了去开关页的入口。 */
  linkInBrief?: boolean;
}) {
  const closed = (risk?.gates ?? []).filter((gate) => !gate.on);
  const pressure = pressureLevel(ledger, risk);
  // 同一件事同一个颜色：业务没开用橙，和状态句一样。红只给压力到红线。
  const alertTone = pressure.worst === "danger" ? "danger" : "warn";
  const lines = risk ? `黄线 ${fmtPct(risk.bankRunYellowPct, 0)}，红线 ${fmtPct(risk.bankRunRedlinePct, 0)}。到线时这里变色。` : "";
  const pressureTone = (level: "ok" | "warn" | "danger", value: number) => (level !== "ok" ? level : value === 0 ? "done" : undefined);
  return (
    <Fold title="风险与开关" summary={riskFoldSummary(ledger, risk, error)} icon={ShieldAlert} tone="role-4" alert={alert} alertTone={alertTone} open={open} onOpenChange={onOpenChange}
      actions={<FoldLink reach={reach} href="/overview/risk-radar">查看风险提醒</FoldLink>}>
      {error ? <BlockState compact state="error" title="风险数据读取失败" detail={error} onRetry={onRetry} retrying={retrying} />
        : !ledger || !risk ? <BlockState state="loading" title="正在读取…" />
          : (
            <div className="cc-fold-stack">
              {(closed.length > 0 || (!linkInBrief && reach("/emergency/kill-switch"))) && (
              <section className="cc-gates-row" aria-label="业务开关">
                {closed.length > 0 && (
                  <ul className="cc-gates">
                    {closed.map((gate) => (
                      <li key={gate.dom}>
                        <span>{GATE_NAMES[gate.dom] ?? gate.nm}</span>
                        {gate.unset
                          ? <StatusTag tone="warn" explain="这个开关还没人设置过，系统按关闭处理，用户现在用不了这项业务。要开放，到「紧急停用开关」页设置。">未设置</StatusTag>
                          : <StatusTag tone="warn" icon={XCircle} explain="有人关了这项业务，用户现在用不了。为什么关、怎么恢复，到「紧急停用开关」页看。">已关停</StatusTag>}
                      </li>
                    ))}
                  </ul>
                )}
                {!linkInBrief && reach("/emergency/kill-switch") && <Link className="rd-link" href="/emergency/kill-switch" prefetch={false}>查看或恢复业务开关</Link>}
              </section>
              )}
              {/* 压力和账户都是短句（5.4）：比率常年很小，长条几乎全空，说明不了什么。黄线、红线收进提示（DP-06）。 */}
              <ul className="cc-list" data-cols="">
                <li>
                  <span><Explain label="近 24 小时提现申请占储备怎么看" content={lines}>近 24 小时提现申请占储备</Explain></span>
                  <span className="cc-num" data-tone={pressureTone(pressure.flow, risk.bankRunRatio)}>{fmtPct(risk.bankRunRatio)}</span>
                </li>
                <li>
                  <span><Explain label="待提现总额占储备怎么看" content={lines}>待提现总额占储备</Explain></span>
                  <span className="cc-num" data-tone={pressureTone(pressure.backlog, ledger.pressureRatio)}>{fmtPct(ledger.pressureRatio * 100)}</span>
                </li>
                <li>
                  <span>
                    <Explain label="异常账户怎么算" content="风控按当前评分规则标记的账户数。等待重新评分的账户不算在内，它们在待处理里。">异常账户</Explain>
                  </span>
                  <span className="cc-num" data-tone={risk.flaggedAccounts > 0 ? "warn" : "done"}>{fmtNum(risk.flaggedAccounts)} 个</span>
                </li>
                <li>
                  <span>
                    <Explain label="提现在途怎么算" content="还没结案的提现单：等审核、打款中，也包括被拒绝或打款失败、钱还没退回的单。所以比待处理里的待审核提现多。">提现在途</Explain>
                  </span>
                  <span className="cc-num">{fmtNum(ledger.queueBacklogCount)} 单，{usdt(ledger.queueBacklogUsd)}</span>
                </li>
                <li>
                  <span>
                    <Explain label="风险分怎么算" content={<>这些提现单绑定的风控决定分的平均，满分 100，70 以上为高危。没有风控决定的单按 0 算，所以可能比提现审核页的分低，单笔以提现审核页为准。 <FoldLink reach={reach} href="/risk/scoring">风险评分规则</FoldLink></>}>在途提现平均风险分</Explain>
                  </span>
                  <span className="cc-num" data-tone={ledger.avgRiskScore === 0 ? "done" : undefined}>{ledger.avgRiskScore}</span>
                </li>
              </ul>
            </div>
          )}
    </Fold>
  );
}

function flowConclusion(history: B2LiquidityHistory) {
  const inflow = history.flowWindows.reduce((sum, item) => sum + item.inflowWan, 0);
  const outflow = history.flowWindows.reduce((sum, item) => sum + item.outflowWan, 0);
  if (inflow === 0 && outflow === 0) return "近 8 天储备账没有进出";
  return inflow > outflow ? "近 8 天流入多于流出" : inflow < outflow ? "近 8 天流出多于流入" : "近 8 天流入流出持平";
}

export function FlowFold({ blocks, history, historyError, historyRetrying, onRetryHistory, refreshKey, reach, open, onOpenChange }: FoldProps & {
  blocks: B0Blocks;
  history: B2LiquidityHistory | null;
  historyError: string | null;
  historyRetrying: boolean;
  onRetryHistory: () => void;
  refreshKey: number;
  reach: Reach;
}) {
  const opened = useOpenedOnce(open);
  const topup = useBlock(fetchD1TopupOverview, opened && blocks.topup, refreshKey);
  const redemption = useBlock(fetchB0Redemption, opened && blocks.redemption, refreshKey);
  const summary = !blocks.netFlow ? "今日充值和提现明细" : historyError ? "读取失败" : history ? flowConclusion(history) : "正在读取…";
  const moved = history?.flowWindows.some((item) => item.inflowWan > 0 || item.outflowWan > 0);
  // 近 8 天全是 0 时结论在标题行写过，这里不再写，今日明细左右排。
  const quiet = blocks.netFlow && history !== null && !moved && !historyError;
  const today = (
    <>
      {blocks.topup && (
        <section aria-label="今日充值">
          <h3 className="cc-sub">今日充值</h3>
          {topup.error ? <BlockState compact state="error" title="今日充值读取失败" detail={topup.error} onRetry={topup.reload} retrying={topup.loading} />
            : !topup.data ? <BlockState state="loading" title="正在读取…" />
              : (
                <>
                  <p className="cc-line">{usdt(topup.data.ledgerTotal)}，{fmtNum(topup.data.ledgerCount)} 笔</p>
                  {topup.data.reconciliation.length > 0 && (
                    <ul className="cc-list">
                      {topup.data.reconciliation.map((row) => <li key={row.channel}><span>{row.channel}</span><span className="cc-num">{usdt(row.ledgerAmount)}，{fmtNum(row.ledgerCount)} 笔</span></li>)}
                    </ul>
                  )}
                </>
              )}
        </section>
      )}
      {blocks.redemption && (
        <section aria-label="今日提现">
          <h3 className="cc-sub">今日提现申请</h3>
          {redemption.error ? <BlockState compact state="error" title="今日提现读取失败" detail={redemption.error} onRetry={redemption.reload} retrying={redemption.loading} />
            : !redemption.data ? <BlockState state="loading" title="正在读取…" />
              : <p className="cc-line">提交 {fmtNum(redemption.data.submitted)} 笔，完成 {fmtNum(redemption.data.confirmed)} 笔，拒绝 {fmtNum(redemption.data.rejected)} 笔{redemption.data.averageLatencyHours == null ? "" : `，平均到账 ${redemption.data.averageLatencyHours} 小时`}</p>}
        </section>
      )}
    </>
  );
  return (
    <Fold title="资金进出" summary={summary} icon={ArrowLeftRight} tone="role-2" open={open} onOpenChange={onOpenChange}
      explain={blocks.netFlow ? "按储备账已确认的流入、流出统计。流入包括充值、财务注资和储备返还／冲正；流出包括提现扣储备和拒付退回。非银行提现在放行时扣储备，银行提现在付款成功时结算，不代表全部已实际打款。用余额买设备不算。" : undefined}
      actions={blocks.netFlow ? <FoldLink reach={reach} href="/overview/liquidity">查看资金流</FoldLink> : undefined}>
      <div className="cc-cols">
        {blocks.netFlow && !quiet && (
          <section aria-label="近 8 天资金进出">
            {historyError ? <BlockState compact state="error" title="资金进出读取失败" detail={historyError} onRetry={onRetryHistory} retrying={historyRetrying} />
              : !history ? <BlockState state="loading" title="正在读取…" />
                : <Bars label="近 8 天每天流入和流出" series={[{ name: "流入", slot: 2 }, { name: "流出", slot: 4 }]} rows={history.flowWindows.map((item) => ({ label: item.label, values: [item.inflowWan * 10_000, item.outflowWan * 10_000] }))} format={usdt} height={96} />}
          </section>
        )}
        {quiet ? today : <div className="cc-fold-stack">{today}</div>}
      </div>
    </Fold>
  );
}

function FunnelBody({ onSummary }: { onSummary: (text: string) => void }) {
  const { data, loading, error, reload } = useB3Funnel(FUNNEL_FILTERS, "purchase");
  const stages = useMemo(() => data?.stages ?? [], [data]);
  const first = stages[0]?.distinctUsers ?? 0;
  const protectedSample = stages.some((stage) => stage.suppressed);
  const tooFew = !protectedSample && first < SMALL_SAMPLE;
  const allSmall = stages.every((stage) => stage.suppressed || stage.distinctUsers === null || stage.distinctUsers < SMALL_SAMPLE);
  const worst = stages.slice(1).reduce<{ from: string; to: string; cvr: number } | null>((found, stage, index) => {
    const previous = stages[index];
    if (stage.cvrFromPrev == null || previous.distinctUsers == null || stage.distinctUsers == null || previous.distinctUsers < SMALL_SAMPLE || stage.distinctUsers < SMALL_SAMPLE) return found;
    return !found || stage.cvrFromPrev < found.cvr ? { from: previous.stage, to: stage.stage, cvr: stage.cvrFromPrev } : found;
  }, null);
  const conclusion = error ? "读取失败"
    : !data ? "正在读取…"
      : !data.available || !stages.length ? (data.message ?? "暂无转化数据")
        : tooFew ? "注册不足 5 人，样本过小"
          : allSmall ? "每一步人数都太少，样本过小"
            : protectedSample ? "部分阶段样本过小，暂不比较流失"
              : worst ? `流失最多的一步是${worst.from}到${worst.to}` : "每一步人数都太少，样本过小";
  useEffect(() => { onSummary(conclusion); }, [conclusion, onSummary]);
  if (error) return <BlockState compact state="error" title="用户转化读取失败" detail={error} onRetry={() => void reload()} retrying={loading} />;
  if (!data) return <BlockState state="loading" title="正在读取…" />;
  if (!data.available || !stages.length) return <BlockState compact state="error" title="用户转化暂无数据" detail={data.message ?? "暂无转化数据"} onRetry={() => void reload()} retrying={loading} />;
  // 结论已经写在折叠标题行：全是样本过小时一句话带过（5.4），这里不再写一遍（VS-105）。
  if (tooFew || allSmall) return null;
  return (
    <div className="cc-fold-stack cc-bars">
      <BarList label="注册到提现各步人数" slot={3} max={first} rows={stages.map((stage) => {
        const shown = !stage.suppressed && stage.distinctUsers !== null && stage.distinctUsers >= SMALL_SAMPLE;
        return { key: stage.key, label: stage.stage, value: shown ? stage.distinctUsers : null, text: shown ? `${fmtNum(stage.distinctUsers!)} 人` : "样本过小" };
      })} />
      {!protectedSample && worst && <p className="cc-line">{worst.from}到{worst.to}只有 {worst.cvr}% 走到下一步</p>}
    </div>
  );
}

export function FunnelFold({ blocks, refreshKey, reach, open, onOpenChange }: FoldProps & { blocks: B0Blocks; refreshKey: number; reach: Reach }) {
  const opened = useOpenedOnce(open);
  const [summary, setSummary] = useState<string | null>(null);
  const total = useBlock(fetchC1Overview, opened && blocks.totalUsers, refreshKey);
  return (
    <Fold title="用户与转化" summary={summary ?? (opened ? "正在读取…" : "点开看累计用户和注册到提现各步人数")} icon={Users} tone="role-3" open={open} onOpenChange={onOpenChange}
      actions={blocks.funnel ? <FoldLink reach={reach} href="/overview/funnel">查看明细</FoldLink> : undefined}>
      {opened && (
        <div className="cc-cols">
          <div className="cc-fold-stack">
            {blocks.totalUsers && (
              total.error ? <BlockState compact state="error" title="累计用户读取失败" detail={total.error} onRetry={total.reload} retrying={total.loading} />
                : <p className="cc-line">累计用户 <span className="cc-num" data-tone="role-3">{total.data ? `${fmtNum(total.data.totalUsers)} 人` : "…"}</span></p>
            )}
            <p className="cc-line" data-muted="">活跃用户暂未统计</p>
          </div>
          {blocks.funnel && <FunnelBody key={refreshKey} onSummary={setSummary} />}
        </div>
      )}
    </Fold>
  );
}

function KpiDetail({ kpi, reach, onClose }: { kpi: B0Kpi; reach: Reach; onClose: () => void }) {
  const pass = kpi.smallSample ? null : kpi.pass;
  const drawn = kpi.series.some((value) => value !== null);
  return (
    <Modal title={operatorCopyText(kpi.label)} icon={Target} onClose={onClose} footer={<Button onClick={onClose}>关闭</Button>}
      sub={pass === null ? <StatusTag tone="done">{kpi.smallSample ? "样本过小" : "暂无法计算"}</StatusTag>
        : pass ? <StatusTag tone="ok">达标</StatusTag> : <StatusTag tone="warn">未达标</StatusTag>}>
      <div className="cc-fold-stack">
        {/* 样本过小只在标题下写一处；大字只给真的数字（VS-102）。 */}
        <Facts>
          {!kpi.smallSample && <Fact k="当前值" lead>{kpi.value}</Fact>}
          <Fact k="目标">{targetText(kpi.target)}</Fact>
          <Fact k="数据来源">用户行为事件</Fact>
        </Facts>
        <p className="rd-note">怎么算：{operatorCopyText(kpi.hint).replace(/去重用户数?/g, "人数") || "—"}</p>
        {drawn ? <TrendLines label={`${kpi.label}的走势`} ticks={kpi.trendLabels} format={String} height={96} series={[{ key: "kpi", label: kpi.label, slot: 2, values: kpi.series }]} />
          : !kpi.smallSample && <p className="cc-line" data-muted="">{kpi.trendSuppressed ? "样本过小，暂时不画趋势" : "趋势数据不足，暂时不画"}</p>}
        {drawn && kpi.trendSuppressed && !kpi.smallSample && <p className="cc-line" data-muted="">部分时段样本过小，曲线在这些时段断开。</p>}
        {reach("/analytics/kpi") && <p className="cc-line"><Link className="rd-link" href="/analytics/kpi" prefetch={false}>查看关键指标</Link></p>}
      </div>
    </Modal>
  );
}

export function KpiFold({ refreshKey, reach, open, onOpenChange }: FoldProps & { refreshKey: number; reach: Reach }) {
  const opened = useOpenedOnce(open);
  const kpis = useBlock(fetchB0Kpis, opened, refreshKey);
  const [selected, setSelected] = useState<B0Kpi | null>(null);
  const rows = kpis.data ?? [];
  const effective = rows.map((kpi) => ({ ...kpi, pass: kpi.smallSample ? null : kpi.pass, suppressed: kpi.smallSample }));
  const rollup = rollupKpiPassState(effective);
  const failedKpis = effective.filter((kpi) => kpi.pass === false);
  const unknownKpis = effective.filter((kpi) => !kpi.smallSample && kpi.pass === null);
  const smallKpis = effective.filter((kpi) => kpi.smallSample);
  const passedKpis = effective.filter((kpi) => kpi.pass === true);
  const summary = kpis.error ? "读取失败"
    : !opened ? "点开看哪些目标没达到"
      : !kpis.data ? "正在读取…"
        : rows.length === 0 ? "关键指标暂无数据"
          : rollup.failed === 0 && rollup.unknown === 0 && rollup.suppressed === 0 ? (rollup.total === 8 ? "八项都达标" : `${rollup.total} 项都达标`)
            : [rollup.failed > 0 ? `未达标 ${rollup.failed} 项` : "", rollup.unknown > 0 ? `暂无法计算 ${rollup.unknown} 项` : "", rollup.suppressed > 0 ? `样本过小 ${rollup.suppressed} 项` : ""].filter(Boolean).join("，");
  // 只剩一组时标题行的摘要已经说了这组是什么，不再写一遍（VS-105）。
  const groups = ([["暂无法计算", unknownKpis], ["样本过小", smallKpis], ["已达标", passedKpis]] as const).filter(([, items]) => items.length > 0);
  const onlyGroup = failedKpis.length === 0 && groups.length === 1;
  const names = (title: string, items: readonly B0Kpi[]) => (
    <div key={title} className="cc-names">
      {!onlyGroup && <span>{title}</span>}
      <ul aria-label={title}>{items.map((kpi) => <li key={kpi.n}><button type="button" className="cc-link-button" onClick={() => setSelected(kpi)}>{operatorCopyText(kpi.label)}</button></li>)}</ul>
    </div>
  );
  return (
    <Fold title="关键指标" summary={summary} icon={Target} tone="role-3" open={open} onOpenChange={onOpenChange}
      actions={<FoldLink reach={reach} href="/analytics/kpi">查看关键指标</FoldLink>}>
      {opened && (kpis.error ? <BlockState compact state="error" title="关键指标读取失败" detail={kpis.error} onRetry={kpis.reload} retrying={kpis.loading} />
        : !kpis.data ? <BlockState state="loading" title="正在读取…" />
          : rows.length === 0 ? <BlockState state="empty" title="关键指标暂无数据" />
            : (
              <div className="cc-fold-stack">
                {failedKpis.length > 0 && (
                  <ul className="cc-kpis" aria-label="没有达到目标的指标">
                    {failedKpis.map((kpi) => (
                      <li key={kpi.n}>
                        <button type="button" className="cc-kpi" onClick={() => setSelected(kpi)}>
                          <span className="cc-kpi-name">{operatorCopyText(kpi.label)}</span>
                          <span className="cc-num">{kpi.value}</span>
                          <span className="cc-kpi-target">目标 {targetText(kpi.target)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {groups.map(([title, items]) => names(title, items))}
              </div>
            ))}
      {selected && <KpiDetail kpi={selected} reach={reach} onClose={() => setSelected(null)} />}
    </Fold>
  );
}

/** 展开选择按账号记住（DP-50）。有异常的默认展开，这次手动收起后才收着（DP-04）。 */
export function useFoldChoices(adminId: number | undefined) {
  const key = `nexion-admin-b0-folds-v1:${adminId ?? "anonymous"}`;
  const [remembered, setRemembered] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const [thisVisit, setThisVisit] = useState<Record<string, boolean>>({});
  return {
    isOpen: (fold: string, alert = false) => thisVisit[fold] ?? (alert || remembered[fold] === true),
    setOpen: (fold: string, open: boolean) => {
      const next = { ...remembered, [fold]: open };
      setThisVisit((current) => ({ ...current, [fold]: open }));
      setRemembered(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // 存不下时只影响下次打开的默认状态。
      }
    },
  };
}
