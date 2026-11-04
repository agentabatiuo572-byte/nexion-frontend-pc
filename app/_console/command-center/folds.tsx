"use client";

/**
 * 第二层：5 行带结论的折叠摘要，点一下原地展开。标题写结论，不重复首屏数字（DP-04、DP-61）。
 * 资金和风险用首屏已读的数据；资金进出的今日明细、用户与转化、关键指标展开时才读，
 * 转化每读一次写一条审计，所以第一次展开后才挂载，收起也不卸载。
 */
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeftRight, ShieldAlert, Target, Users, Wallet } from "lucide-react";
import { AutoGloss } from "@/app/components/kit/gloss";
import { AreaChart } from "@/app/components/kit/charts/area-chart";
import { Bars, BlockState, Button, Explain, Fold, Modal, StatusTag } from "@/app/components/rd";
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
  return reach(href) ? <Link href={href} prefetch={false}>{children} →</Link> : null;
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

function fundFoldSummary(ledger: BLedger | null, liquidity: BLiquidity | null, error: string | null) {
  if (error) return "读取失败";
  if (!ledger || !liquidity) return "正在读取…";
  const net = ledger.reserveUsd - ledger.liabilitiesUsd;
  const word = net > 0 ? "储备多于应付款" : net === 0 ? "储备刚好够付应付款" : "储备不够付应付款";
  return `${word}，未来 7 天${liquidity.runwayTotalWan > 0 ? "有到期" : "没有到期"}`;
}

export function FundFold({ ledger, liquidity, error, retrying, onRetry, alert, level, clock, reach, open, onOpenChange }: FoldProps & {
  ledger: BLedger | null;
  liquidity: BLiquidity | null;
  error: string | null;
  retrying: boolean;
  onRetry: () => void;
  alert: boolean;
  level: FundLevel;
  clock: string | null;
  reach: Reach;
}) {
  const net = ledger ? ledger.reserveUsd - ledger.liabilitiesUsd : 0;
  const accounts = (ledger?.accounts ?? []).filter((item) => item.amount > 0).sort((a, b) => b.amount - a.amount);
  const others = accounts.slice(3).reduce((sum, item) => sum + item.amount, 0);
  const dueRows = (liquidity?.runway ?? []).map((item) => ({ label: item.day.slice(5), values: [item.valueWan * 10_000] }));
  const gap = ledger ? ledger.coverageRatio - ledger.redlinePct : 0;
  return (
    <Fold title="资金明细" summary={fundFoldSummary(ledger, liquidity, error)} icon={Wallet} tone="role-1" alert={alert} alertTone={level === "danger" ? "danger" : "warn"} open={open} onOpenChange={onOpenChange}>
      {error ? <BlockState state="error" title="资金数据加载失败" detail={error} onRetry={onRetry} retrying={retrying} />
        : !ledger || !liquidity ? <BlockState state="loading" title="正在读取…" />
          : (
            <div className="cc-fold-stack">
              <div className="cc-amounts">
                <Amount label="可用储备" value={ledger.reserveUsd} tone="role-1" href="/overview/dual-ledger" reach={reach} />
                <Amount label="应付款" value={ledger.liabilitiesUsd} tone="role-2" href="/overview/dual-ledger" reach={reach} />
                <Amount label="差额（储备 − 应付款）" value={net} note={net > 0 ? "有富余" : net === 0 ? "刚好够" : "不够付"} href="/overview/dual-ledger" reach={reach} />
              </div>
              <p className="cc-line"><AutoGloss>{`红线 ${fmtPct(ledger.redlinePct, 0)} · 健康线 ${fmtPct(ledger.healthyPct, 0)} · 距红线 ${gap >= 0 ? "+" : ""}${gap.toFixed(1)} 个百分点`}</AutoGloss></p>
              <div className="cc-cols">
              <section aria-label="应付款">
                <h3 className="cc-sub">应付款最多的几类</h3>
                {accounts.length === 0 ? <p className="cc-line">目前没有应付款</p> : (
                  <ul className="cc-list">
                    {accounts.slice(0, 3).map((item) => <li key={item.key}><span>{liabilityDisplayName(item.key, operatorCopyText(item.label))}</span><span className="cc-num">{usdt(item.amount)}</span></li>)}
                    {others > 0 && <li><span>其他 {accounts.length - 3} 类</span><span className="cc-num">{usdt(others)}</span></li>}
                  </ul>
                )}
              </section>
              <section aria-label="未来 7 天到期">
                <h3 className="cc-sub">
                  未来 7 天到期
                  <Explain label="到期怎么算" content={`每天到期要付的金额，按运营总览的可支撑天数设置计算，是预测，不是历史。${clock ? `数据时间 ${clock}。` : ""}`} />
                </h3>
                {liquidity.runwayTotalWan > 0
                  ? <Bars label="未来 7 天哪天付款压力大" series={[{ name: "到期", slot: 3 }]} rows={dueRows} format={usdt} height={96} />
                  : <p className="cc-line">未来 7 天没有到期</p>}
              </section>
              </div>
              <p className="cc-links">
                <FoldLink reach={reach} href="/overview/dual-ledger">查看资金总览</FoldLink>
                <FoldLink reach={reach} href="/overview/liquidity">查看全部 9 类</FoldLink>
              </p>
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
    closed.length === 0 ? "五个业务都开着" : `${closed.length} 个业务没有开`,
    risk.flaggedAccounts === 0 ? "没有异常账户" : `异常账户 ${fmtNum(risk.flaggedAccounts)} 个`,
  ];
  const { worst } = pressureLevel(ledger, risk);
  if (worst !== "ok") parts.push(worst === "danger" ? "提现压力达到红线" : "提现压力达到黄线");
  return parts.join("，");
}

export function RiskFold({ ledger, risk, error, retrying, onRetry, alert, reach, open, onOpenChange }: FoldProps & {
  ledger: BLedger | null;
  risk: BRiskRadar | null;
  error: string | null;
  retrying: boolean;
  onRetry: () => void;
  alert: boolean;
  reach: Reach;
}) {
  const closed = (risk?.gates ?? []).filter((gate) => !gate.on);
  const pressure = pressureLevel(ledger, risk);
  const alertTone = pressure.worst === "danger" || closed.some((gate) => !gate.unset) ? "danger" : "warn";
  return (
    <Fold title="风险与开关" summary={riskFoldSummary(ledger, risk, error)} icon={ShieldAlert} tone="role-4" alert={alert} alertTone={alertTone} open={open} onOpenChange={onOpenChange}>
      {error ? <BlockState state="error" title="风险数据加载失败" detail={error} onRetry={onRetry} retrying={retrying} />
        : !ledger || !risk ? <BlockState state="loading" title="正在读取…" />
          : (
            <div className="cc-fold-stack">
              <section aria-label="业务开关">
                {closed.length === 0 ? <p className="cc-line">五个业务都开着</p> : (
                  <ul className="cc-gates">
                    {closed.map((gate) => (
                      <li key={gate.dom}>
                        <span>{GATE_NAMES[gate.dom] ?? gate.nm}</span>
                        {gate.unset
                          ? <StatusTag tone="warn" explain="这个开关还没有配置，系统按关闭处理。到紧急停用开关页设置，上线前要配齐。">未设置</StatusTag>
                          : <StatusTag tone="danger" explain="这项业务已经被关停，用户现在用不了。恢复要到紧急停用开关页操作。">已关停</StatusTag>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <ul className="cc-list" data-cols="">
                <li>
                  <span>近 24 小时提现申请占储备</span>
                  <span className="cc-num" data-tone={pressure.flow === "ok" ? undefined : pressure.flow}>{fmtPct(risk.bankRunRatio)}</span>
                </li>
                <li>
                  <span>待提现总额占储备</span>
                  <span className="cc-num" data-tone={pressure.backlog === "ok" ? undefined : pressure.backlog}>{fmtPct(ledger.pressureRatio * 100)}</span>
                </li>
                <li>
                  <span>
                    异常账户
                    <Explain label="异常账户怎么算" content="当前规则下风控标记的账户数。" />
                  </span>
                  <span className="cc-num" data-tone={risk.flaggedAccounts > 0 ? "warn" : "done"}>{fmtNum(risk.flaggedAccounts)} 个</span>
                </li>
                <li>
                  <span>
                    提现在途
                    <Explain label="提现在途怎么算" content="还没走完流程的提现单数和金额。不只是待审核，也含已拒绝和打款失败等状态的单，待审核数量看上面的待处理。" />
                  </span>
                  <span className="cc-num">{fmtNum(ledger.queueBacklogCount)} 单，{usdt(ledger.queueBacklogUsd)}</span>
                </li>
                <li>
                  <span>
                    在途提现平均风险分
                    <Explain label="风险分怎么算" content="提现申请的平均风险分。满分 100，70 以上为高危。" />
                  </span>
                  <span className="cc-num">{ledger.avgRiskScore}</span>
                </li>
              </ul>
              <p className="cc-links">
                <FoldLink reach={reach} href="/emergency/kill-switch">前往紧急停用开关</FoldLink>
                <FoldLink reach={reach} href="/overview/risk-radar">查看风险提醒</FoldLink>
                <FoldLink reach={reach} href="/risk/scoring">风险评分规则</FoldLink>
              </p>
            </div>
          )}
    </Fold>
  );
}

function flowConclusion(history: B2LiquidityHistory) {
  const inflow = history.flowWindows.reduce((sum, item) => sum + item.inflowWan, 0);
  const outflow = history.flowWindows.reduce((sum, item) => sum + item.outflowWan, 0);
  if (inflow === 0 && outflow === 0) return "近 8 天没有资金进出";
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
  return (
    <Fold title="资金进出" summary={summary} icon={ArrowLeftRight} tone="role-2" open={open} onOpenChange={onOpenChange}>
      <div className="cc-fold-stack">
        <div className="cc-cols">
          {blocks.netFlow && (
            <section aria-label="近 8 天资金进出">
              {historyError ? <BlockState state="error" title="资金进出加载失败" detail={historyError} onRetry={onRetryHistory} retrying={historyRetrying} />
                : !history ? <BlockState state="loading" title="正在读取…" />
                  : moved
                    ? <Bars label="近 8 天每天流入和流出" series={[{ name: "流入", slot: 2 }, { name: "流出", slot: 4 }]} rows={history.flowWindows.map((item) => ({ label: item.label, values: [item.inflowWan * 10_000, item.outflowWan * 10_000] }))} format={usdt} height={96} />
                    : <p className="cc-line">近 8 天没有资金进出</p>}
            </section>
          )}
          <div className="cc-fold-stack">
            {blocks.topup && (
              <section aria-label="今日充值">
                <h3 className="cc-sub">今日充值</h3>
                {topup.error ? <BlockState state="error" title="今日充值加载失败" detail={topup.error} onRetry={topup.reload} retrying={topup.loading} />
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
                <h3 className="cc-sub">今日提现</h3>
                {redemption.error ? <BlockState state="error" title="今日提现加载失败" detail={redemption.error} onRetry={redemption.reload} retrying={redemption.loading} />
                  : !redemption.data ? <BlockState state="loading" title="正在读取…" />
                    : <p className="cc-line">提交 {fmtNum(redemption.data.submitted)} 笔，完成 {fmtNum(redemption.data.confirmed)} 笔，拒绝 {fmtNum(redemption.data.rejected)} 笔{redemption.data.averageLatencyHours == null ? "" : `，平均到账 ${redemption.data.averageLatencyHours} 小时`}</p>}
              </section>
            )}
          </div>
        </div>
        {blocks.netFlow && <p className="cc-links"><FoldLink reach={reach} href="/overview/liquidity">查看资金流</FoldLink></p>}
      </div>
    </Fold>
  );
}

function FunnelBody({ onSummary, reach }: { onSummary: (text: string) => void; reach: Reach }) {
  const { data, loading, error, reload } = useB3Funnel(FUNNEL_FILTERS, "purchase");
  const stages = useMemo(() => data?.stages ?? [], [data]);
  const first = stages[0]?.distinctUsers ?? 0;
  const tooFew = first < SMALL_SAMPLE;
  const worst = stages.slice(1).reduce<{ from: string; to: string; cvr: number } | null>((found, stage, index) => {
    const previous = stages[index];
    if (stage.cvrFromPrev == null || previous.distinctUsers < SMALL_SAMPLE || stage.distinctUsers < SMALL_SAMPLE) return found;
    return !found || stage.cvrFromPrev < found.cvr ? { from: previous.stage, to: stage.stage, cvr: stage.cvrFromPrev } : found;
  }, null);
  const conclusion = error ? "读取失败"
    : !data ? "正在读取…"
      : !data.available || !stages.length ? (data.message ?? "暂无转化数据")
        : tooFew ? "注册不足 5 人，样本过小"
          : worst ? `流失最多的一步是${worst.from}到${worst.to}` : "每一步人数都太少，样本过小";
  useEffect(() => { onSummary(conclusion); }, [conclusion, onSummary]);
  if (error) return <BlockState state="error" title="用户转化加载失败" detail={error} onRetry={() => void reload()} retrying={loading} />;
  if (!data) return <BlockState state="loading" title="正在读取…" />;
  if (!data.available || !stages.length) return <BlockState state="error" title="用户转化暂无数据" detail={data.message ?? "暂无转化数据"} onRetry={() => void reload()} retrying={loading} />;
  return (
    <div className="cc-fold-stack">
      {tooFew ? <p className="cc-line">注册不足 5 人，样本过小</p> : (
        <>
          <ul className="cc-funnel">
            {stages.map((stage) => {
              const shown = stage.distinctUsers >= SMALL_SAMPLE;
              return (
                <li key={stage.key}>
                  <span>{stage.stage}</span>
                  <span className="cc-funnel-track">{shown && <span className="cc-funnel-bar" style={{ width: `${(stage.distinctUsers / first) * 100}%` }} />}</span>
                  <span className="cc-num">{shown ? `${fmtNum(stage.distinctUsers)} 人` : "样本过小"}</span>
                </li>
              );
            })}
          </ul>
          {worst && <p className="cc-line">流失最多的一步是{worst.from}到{worst.to}，只有 {worst.cvr}% 走到下一步</p>}
        </>
      )}
      <p className="cc-links"><FoldLink reach={reach} href="/overview/funnel">查看明细</FoldLink></p>
    </div>
  );
}

export function FunnelFold({ blocks, refreshKey, reach, open, onOpenChange }: FoldProps & { blocks: B0Blocks; refreshKey: number; reach: Reach }) {
  const opened = useOpenedOnce(open);
  const [summary, setSummary] = useState<string | null>(null);
  const total = useBlock(fetchC1Overview, opened && blocks.totalUsers, refreshKey);
  return (
    <Fold title="用户与转化" summary={summary ?? (opened ? "正在读取…" : "点开读取累计用户和四步转化")} icon={Users} tone="role-3" open={open} onOpenChange={onOpenChange}>
      {opened && (
        <div className="cc-cols">
          <div className="cc-fold-stack">
            {blocks.totalUsers && (
              total.error ? <BlockState state="error" title="累计用户加载失败" detail={total.error} onRetry={total.reload} retrying={total.loading} />
                : <p className="cc-line">累计用户 <span className="cc-num" data-tone="role-3">{total.data ? `${fmtNum(total.data.totalUsers)} 人` : "…"}</span></p>
            )}
            <p className="cc-line" data-muted="">活跃用户暂未统计</p>
          </div>
          {blocks.funnel && <FunnelBody key={refreshKey} onSummary={setSummary} reach={reach} />}
        </div>
      )}
    </Fold>
  );
}

function KpiDetail({ kpi, reach, onClose }: { kpi: B0Kpi; reach: Reach; onClose: () => void }) {
  const pass = kpi.smallSample ? null : kpi.pass;
  return (
    <Modal title={<>关键指标 #{kpi.n} · {operatorCopyText(kpi.label)}</>} onClose={onClose} footer={<Button onClick={onClose}>关闭</Button>}>
      <div className="cc-fold-stack">
        <p className="cc-line">
          {pass === null ? <StatusTag tone="done">{kpi.smallSample ? "样本过小" : "暂无法计算"}</StatusTag>
            : pass ? <StatusTag tone="ok">达标</StatusTag> : <StatusTag tone="warn">未达标</StatusTag>}
        </p>
        <div className="cc-amounts" data-two="">
          <div className="cc-amount"><span className="cc-amount-label">当前值</span><span className="cc-amount-value">{kpi.smallSample ? "—" : kpi.value}</span></div>
          <div className="cc-amount"><span className="cc-amount-label">目标</span><span className="cc-amount-value">{operatorCopyText(kpi.target)}</span></div>
        </div>
        {kpi.series.length >= 2 ? <AreaChart data={kpi.series} color="var(--rd-chart-2)" height={70} /> : <p className="cc-line" data-muted="">趋势数据不足，暂时不画</p>}
        <ul className="cc-list">
          <li><span>怎么算</span><span>{operatorCopyText(kpi.hint) || "—"}</span></li>
          <li><span>数据来源</span><span>用户行为事件</span></li>
        </ul>
        <p className="cc-links"><FoldLink reach={reach} href="/analytics/kpi">查看关键指标</FoldLink></p>
      </div>
    </Modal>
  );
}

export function KpiFold({ refreshKey, reach, open, onOpenChange }: FoldProps & { refreshKey: number; reach: Reach }) {
  const opened = useOpenedOnce(open);
  const kpis = useBlock(fetchB0Kpis, opened, refreshKey);
  const [selected, setSelected] = useState<B0Kpi | null>(null);
  const rows = kpis.data ?? [];
  const effective = rows.map((kpi) => ({ ...kpi, pass: kpi.smallSample ? null : kpi.pass }));
  const rollup = rollupKpiPassState(effective);
  const failedKpis = effective.filter((kpi) => kpi.pass === false);
  const unknownKpis = effective.filter((kpi) => kpi.pass === null);
  const passedKpis = effective.filter((kpi) => kpi.pass === true);
  const summary = kpis.error ? "读取失败"
    : !opened ? "点开读取未达标的指标"
      : !kpis.data ? "正在读取…"
        : rows.length === 0 ? "关键指标暂无数据"
          : rollup.failed === 0 && rollup.unknown === 0 ? (rollup.total === 8 ? "八项都达标" : `${rollup.total} 项都达标`)
            : [rollup.failed > 0 ? `未达标 ${rollup.failed} 项` : "", rollup.unknown > 0 ? `暂无法计算 ${rollup.unknown} 项` : ""].filter(Boolean).join("，");
  const names = (items: readonly B0Kpi[]) => items.map((kpi, index) => (
    <span key={kpi.n}>{index > 0 && "、"}<button type="button" className="cc-link-button" onClick={() => setSelected(kpi)}>{operatorCopyText(kpi.label)}</button></span>
  ));
  return (
    <Fold title="关键指标" summary={summary} icon={Target} tone="role-3" open={open} onOpenChange={onOpenChange}>
      {opened && (kpis.error ? <BlockState state="error" title="关键指标加载失败" detail={kpis.error} onRetry={kpis.reload} retrying={kpis.loading} />
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
                          <span className="cc-kpi-target">目标 {operatorCopyText(kpi.target)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {unknownKpis.length > 0 && <p className="cc-line" data-muted="">暂无法计算：{names(unknownKpis)}</p>}
                {passedKpis.length > 0 && <p className="cc-line" data-muted="">已达标：{names(passedKpis)}</p>}
                <p className="cc-links"><FoldLink reach={reach} href="/analytics/kpi">查看关键指标</FoldLink></p>
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
