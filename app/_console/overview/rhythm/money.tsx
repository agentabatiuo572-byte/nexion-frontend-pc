"use client";

/**
 * B4 下半页：钱进得多还是出得多（最近 8 个业务月的入金 ÷ 流出）和本月四类运营预算。
 * 独立读取 /api/admin/treasury/growth-flow-history，和改版前一样只在这块挂上时读一次，主刷新不重读；
 * 读失败时这块给一个「重试」，调的是同一个读取。原来的 data-testid 照旧挂在两块和建议上。
 */
import { ArrowLeftRight, Compass, PieChart } from "lucide-react";
import {
  BlockState, Cell, Donut, Fold, Panel, StatusTag, Table, Td, Th, Tr, TrendLines,
} from "@/app/components/rd";
import type { StateTone } from "@/app/components/rd";
import { useB4GrowthFlowHistory } from "@/lib/admin/b-restoration-client";
import type { B4GrowthFlowHistory } from "@/lib/admin/b-restoration-contract";
import { amountDisplay } from "@/lib/format";

/** USDT 原金额按全站写法（amountDisplay）：千分位，有几位写几位，整数不写小数点，不舍入。 */
const usdt = (value: number) => amountDisplay(value, 20);
const monthTick = (label: string) => `${Number(label.slice(5))} 月`;

/** 四类预算的名字按这页原来的叫法；后端 label 是拉新、返佣、创世、储备。 */
const BUDGET_NAME: Record<string, string> = { acquisition: "拉新", commission: "团队奖励", genesis: "创世节点", reserve: "储备" };
const BUDGET_SLOT = { acquisition: 2, commission: 4, genesis: 1, reserve: 3 } as const;

const ADVICE: Record<string, { tone: StateTone; text: string }> = {
  维持扩张: { tone: "ok", text: "不低于健康线，可以保持现在的扩张节奏。" },
  切入收紧: { tone: "warn", text: "低于健康线，建议进入收紧观察。" },
  "数据不足，保持现状": { tone: "neutral", text: "" },
};

function RatioPanel({ data }: { data: B4GrowthFlowHistory }) {
  const rows = data.ratioSeries;
  const latest = rows.at(-1)!;
  const ratio = data.currentRatio;
  const advice = ADVICE[data.suggestion] ?? { tone: "neutral" as StateTone, text: "" };
  const drawable = rows.some((row) => row.ratio !== null);
  return (
    <Panel data-testid="b3-growth-outflow-ratio" title="钱进得多还是出得多" sub="近 8 个业务月 · USDT" icon={ArrowLeftRight} tone="role-2"
      explain={<>
        <p>比值 = 当月入金 ÷ 当月流出，用 USDT 原金额算。入金是充值、存入这类入账，流出是提现、出款和佣金；算全部用户，不只是新用户。</p>
        <p>月份按业务日历分，和运营阶段的月份不是一回事。1.2 是固定的健康线。当月没有流出时算不出比值，图上那个月断开。</p>
      </>}>
      <div className="b4-stack">
        <p className="b4-line">
          {!drawable ? <>近 8 个业务月都没有流出，比值算不出来，不画图</> : ratio === null
            ? <>{monthTick(latest.label)}还没有流出，算不出比值</>
            : ratio === 1 ? <>{monthTick(latest.label)}进出持平：入金和流出一样多</>
              : <>{monthTick(latest.label)}{ratio > 1 ? "进得多" : "出得多"}：入金是流出的 <b className="b4-strong">{ratio}</b> 倍</>}
        </p>
        <p className="b4-amounts">
          <span>入金 <b>{usdt(latest.newInflowUsdt)}</b> USDT</span>
          <span>流出 <b data-zero={latest.outflowUsdt === 0 ? "" : undefined}>{usdt(latest.outflowUsdt)}</b> USDT</span>
        </p>
        {drawable ? (
          <TrendLines label={`近 8 个业务月入金 ÷ 流出，健康线 ${data.healthyRatio}${ratio === null ? "" : `，本月 ${ratio}`}`}
            ticks={rows.map((row) => monthTick(row.label))} format={(value) => value.toFixed(2)}
            series={[{ key: "ratio", label: "入金 ÷ 流出", slot: 2, values: rows.map((row) => row.ratio) }]}
            marks={[{ key: "healthy", text: `健康线 ${data.healthyRatio}`, value: data.healthyRatio, tone: "neutral" }]} height={160} />
        ) : null}
        <div data-testid="b7-rhythm-engine-decision" className="b4-advice">
          <StatusTag tone={advice.tone} icon={Compass} explain="本月比值不低于健康线 1.2 时建议维持扩张，低于时建议切入收紧，算不出时保持现状。只是建议，不会自动改运营阶段设置。">运营阶段建议：{data.suggestion}</StatusTag>
          {advice.text && <span className="b4-muted">{advice.text}</span>}
        </div>
        <Fold inset title="每月金额" summary="近 8 个业务月的入金、流出和比值">
          <Table label="每月入金和流出" className="b4-money-table">
            <thead>
              <Tr><Th>月份</Th><Th align="right">入金（USDT）</Th><Th align="right">流出（USDT）</Th><Th align="right">入金 ÷ 流出</Th></Tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((row) => (
                <Tr key={row.label}>
                  <Td>{row.label}</Td>
                  <Td align="right"><Cell num main={usdt(row.newInflowUsdt)} /></Td>
                  <Td align="right"><Cell num main={usdt(row.outflowUsdt)} /></Td>
                  <Td align="right">{row.ratio === null ? <span className="b4-muted" title="当月没有流出，算不出比值">—</span> : <Cell num main={row.ratio.toFixed(4)} title={String(row.ratio)} />}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Fold>
      </div>
    </Panel>
  );
}

function BudgetPanel({ data }: { data: B4GrowthFlowHistory }) {
  const budget = data.budget;
  const missing = budget.missingKeys.map((key) => BUDGET_NAME[key.split(".").at(-1) ?? ""] ?? key);
  const reason = budget.reason === "B4_OPERATION_BUDGET_TOTAL_ZERO"
    ? "四类预算都是 0"
    : budget.reason === "B4_OPERATION_BUDGET_SOURCE_INCOMPLETE" ? "本月预算没配齐，暂不显示" : "本月预算暂时不可用";
  const detail = budget.reason === "B4_OPERATION_BUDGET_TOTAL_ZERO" ? "没有可分的预算。"
    : budget.reason === "B4_OPERATION_BUDGET_SOURCE_INCOMPLETE" && missing.length ? `缺${missing.join("、")}。` : undefined;
  return (
    <Panel data-testid="b6-monthly-budget-allocation" title="本月运营预算怎么分" sub="四类 · USDT" icon={PieChart} tone="role-1"
      explain="这里只有配好的本月预算，不是已经花掉的钱；已用金额暂时没有数据，算不出剩余。占比保留两位小数，加起来可能和 100% 差一点。">
      {budget.available && budget.totalUsdt !== undefined ? (
        <div className="b4-stack">
          {usdt(budget.totalUsdt).length > 10 && <p className="b4-line">合计 <b className="b4-strong">{usdt(budget.totalUsdt)}</b> USDT</p>}
          <Donut label="本月运营预算分配" center={usdt(budget.totalUsdt).length > 10 ? "4 类" : usdt(budget.totalUsdt)} centerLabel={usdt(budget.totalUsdt).length > 10 ? "合计见上" : "USDT"}
          segments={budget.rows.map((row) => ({
            key: row.key, label: BUDGET_NAME[row.key] ?? row.label, value: row.amountUsdt, slot: BUDGET_SLOT[row.key],
            text: `${usdt(row.amountUsdt)} USDT`, share: `${row.sharePct}%`,
          }))} />
        </div>
      ) : (
        <BlockState state="empty" title={reason} detail={detail} />
      )}
    </Panel>
  );
}

export function PhaseMoney() {
  const history = useB4GrowthFlowHistory();
  if (!history.data) {
    const failed = !history.loading;
    const state = failed ? (
      <BlockState state="error" title="钱的进出和预算没有读到" detail={history.error ?? "没有读到内容"} onRetry={() => void history.reload()} />
    ) : <BlockState state="loading" title="正在加载…" />;
    return (
      <div className="rd-split" data-even="">
        <Panel data-testid="b3-growth-outflow-ratio" title="钱进得多还是出得多" sub="近 8 个业务月 · USDT" icon={ArrowLeftRight} tone="role-2">{state}</Panel>
        <Panel data-testid="b6-monthly-budget-allocation" title="本月运营预算怎么分" sub="四类 · USDT" icon={PieChart} tone="role-1">
          {failed ? <BlockState state="error" title="预算没有读到" detail="和左边的入金、流出一起读取。" onRetry={() => void history.reload()} /> : <BlockState state="loading" title="正在加载…" />}
        </Panel>
      </div>
    );
  }
  const data = history.data;
  return (
    <div className="rd-split" data-even="">
      <RatioPanel data={data} />
      <BudgetPanel data={data} />
    </div>
  );
}
