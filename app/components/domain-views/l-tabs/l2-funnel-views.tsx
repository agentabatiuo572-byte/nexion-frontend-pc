"use client";

/**
 * L2 用户转化与留存的图形和表格。只画接口给的数，不发请求、不判权限；数字的写法在这里统一（人数千分位、比例一位小数加 %）。
 * 漏斗的画法和「用户转化概览」（B3）一致：条宽按人数，两步之间写转化率和掉了多少人。
 */
import type { KeyboardEvent, ReactNode } from "react";
import { TrendingDown } from "lucide-react";
import { nextTabValue } from "@/app/components/kit/tab-group-keyboard";
import { Cell, ColumnChart, Explain, StatusTag, Table, Td, Th, Tr } from "@/app/components/rd";
import { formatB3RefOption } from "@/lib/admin/b3-ref-display";
import { INTERFACE_LANGUAGES } from "@/lib/admin/platform-experience-client";
import { SMALL_SAMPLE_LABEL } from "./l1-l2-live-data";

export type FunnelRow = { stage: string; ev?: string; users: number | null; cvr?: number | null; lc: string; color: string; target?: string | null; suppressed?: true };
export type FunnelExt = {
  plain: string;
  inflow: string | null;
  lost: string | null;
  dwell: number[];
  note: string;
  tg?: string | null;
  trial?: boolean;
  v1?: boolean;
  suppressed?: true;
  lostSuppressed?: true;
  dwellSuppressed?: true;
};
export type TrialStep = { e: string; n: number | null; arr?: string; arrLb?: string; suppressed?: true };
export type CohortRow = { w: string; size: number | null; d1?: number | null; d7?: number | null; d14?: number | null; d30?: number | null; d60?: number | null; suppressed?: true };
export type XdMetric = { columns: string[]; rows: (string | number | null)[][]; alert: number[]; unit: string; suppressedCells: Set<string>; msg: { pre: string; bold: string; post: string } };

export const people = (value: number) => value.toLocaleString("en-US");
export const pct = (value: number) => `${value.toFixed(1)}%`;
/** 后端的流入、掉了是「12480 人」「8484 人未进入下一阶段」这样的句子：取开头的人数重新排千分位，取不到原样显示。 */
export function leadingCount(text: string | null) {
  const match = text ? /^(\d+)\s*人/.exec(text) : null;
  return match ? Number(match[1]) : null;
}

/** 每一步怎么算。照后端现行算法写（决定 L2-说法），不照抄后端说明里的「优先使用锁定计划」。 */
export const STEP_RULE = [
  "服务器记录的注册完成，同一个人只算最早那次。这批人是后面每一步的分母。",
  "注册之后的第一笔购买（支付完成）。试用是另一条线，不在这一步里。",
  "首购之后，锁定计划和第二笔购买里先发生的那一个；两种都有时按时间早的算，不是锁定计划优先。",
  "走到上一步之后提交的提现申请，不代表已经到账。",
] as const;

/** 轴上写短的，悬停写全的。 */
const DWELL_TICKS = ["1时内", "1–6时", "6–24时", "1–2天", "2–3天", "3–5天", "5–7天", "7天+"] as const;
const DWELL_NAMES = ["1 小时内", "1–6 小时", "6–24 小时", "1–2 天", "2–3 天", "3–5 天", "5–7 天", "7 天以上"] as const;
const DWELL_WITHIN = ["1 小时", "6 小时", "1 天", "2 天", "3 天", "5 天", "7 天"] as const;

/** 颜色深浅五档，按这张表里最低到最高分：表里只有一个值时放中间一档。 */
export function heatLevel(values: readonly number[]) {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return (value: number) => (high === low ? 2 : Math.min(4, Math.floor(((value - low) / (high - low)) * 5)));
}

export function HeatLegend({ low, high, children }: { low: string; high: string; children?: ReactNode }) {
  return (
    <div className="l2-legend">
      <span className="l2-legend-scale">
        <span>{low}</span>
        {[0, 1, 2, 3, 4].map((level) => <i key={level} data-heat={level} aria-hidden />)}
        <span>{high}</span>
      </span>
      {children}
    </div>
  );
}

/** 四步漏斗，也是选择器：点一步看右边的详情。方向键、Home、End 移动并选中，Tab 只停在当前一步。 */
export function StepFunnel({ funnel, selected, onSelect, disabled, lowest, panelId }: {
  funnel: readonly FunnelRow[];
  selected: number;
  onSelect: (index: number) => void;
  disabled: boolean;
  lowest: number | null;
  panelId: string;
}) {
  const base = funnel[0]?.users ?? null;
  const indexes = funnel.map((_row, index) => index);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const next = nextTabValue(indexes, selected, event.key);
    if (next === null) return;
    event.preventDefault();
    onSelect(next);
    document.getElementById(`l2-step-${next}`)?.focus();
  };
  return (
    <div className="l2-funnel" role="tablist" aria-label="选一步看详情" aria-orientation="vertical">
      {funnel.map((row, index) => {
        const previous = index > 0 ? funnel[index - 1] : null;
        const width = base && row.users != null ? Math.max((row.users / base) * 100, 0.5) : null;
        const dropped = previous?.users != null && row.users != null ? previous.users - row.users : null;
        const isLowest = lowest === index;
        // 条宽是运行时的人数比例，只能写在元素上。
        const barStyle = width == null ? undefined : { width: `${width}%` };
        return (
          <div key={row.stage} className="l2-funnel-item">
            {index > 0 && (
              <div className="l2-funnel-gap" data-tone={isLowest ? "warn" : undefined}>
                <span className="l2-funnel-gap-mid">
                  <span className="l2-funnel-gap-text">
                    {row.suppressed
                      ? "样本过小，转化率不显示"
                      : row.cvr == null
                        ? previous?.users === 0 ? "上一步 0 人，转化率算不出" : "转化率算不出"
                        : <>转化 <b>{pct(row.cvr)}</b>{dropped != null && <> · 掉了 {people(dropped)} 人</>}</>}
                  </span>
                  {isLowest && <StatusTag tone="warn" icon={TrendingDown}>转化率最低</StatusTag>}
                </span>
              </div>
            )}
            <button
              type="button"
              id={`l2-step-${index}`}
              role="tab"
              aria-selected={index === selected}
              aria-controls={panelId}
              tabIndex={index === selected ? 0 : -1}
              disabled={disabled && index !== selected}
              className="l2-funnel-step"
              onClick={() => { if (!disabled && index !== selected) onSelect(index); }}
              onKeyDown={onKeyDown}
            >
              <span className="l2-funnel-name">
                <span className="l2-funnel-index" aria-hidden>{index + 1}</span>
                <b>{row.stage}</b>
              </span>
              <span className="l2-funnel-track">
                {width != null
                  ? <span className="l2-funnel-bar" data-lowest={isLowest ? "" : undefined} style={barStyle} aria-hidden />
                  : <span className="l2-funnel-protected">{SMALL_SAMPLE_LABEL}：少于 5 人不显示</span>}
              </span>
              <span className="l2-funnel-value" data-empty={row.users == null ? "" : undefined}>
                {row.users == null ? "—" : <>{people(row.users)}<small>人</small></>}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** 各步骤明细：人数、上一步人数、转化率、用户阶段和对应事件（技术编号放这里，不上首屏）。 */
export function StageTable({ funnel, events }: { funnel: readonly FunnelRow[]; events: readonly string[] }) {
  return (
    <Table label="各步骤明细" className="l2-stage-table">
      <thead>
        <tr>
          <Th>步骤</Th>
          <Th>用户阶段<Explain label="用户阶段的说明" content="后台内部的用户阶段编号，App 用户界面不按这个编号展示。和「用户转化概览」的阶段编号来自不同的统计，可能写法不同。" /></Th>
          <Th align="right">人数</Th><Th align="right">上一步人数</Th><Th align="right">转化率</Th>
          <Th>对应事件</Th>
        </tr>
      </thead>
      <tbody>
        {funnel.map((row, index) => (
          <Tr key={row.stage}>
            <Td><Cell main={row.stage} /></Td>
            <Td><Cell main={row.lc} /></Td>
            {row.suppressed ? (
              <Td colSpan={3} align="right"><Cell main={`${SMALL_SAMPLE_LABEL}，不显示`} /></Td>
            ) : (
              <>
                <Td align="right"><Cell num main={row.users == null ? "—" : people(row.users)} /></Td>
                <Td align="right"><Cell num main={index === 0 ? "—" : funnel[index - 1].users == null ? "—" : people(funnel[index - 1].users!)} /></Td>
                <Td align="right"><Cell num main={row.cvr == null ? "—" : pct(row.cvr)} /></Td>
              </>
            )}
            <Td grow><Cell mono title={events[index] ?? row.ev} main={events[index] ?? row.ev ?? "—"} /></Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

/** 走到这一步的人从上一步过来用了多久，8 档。一句话写一半的人在多久内完成、拖过 3 天的有多少。 */
export function DwellChart({ stage, dwell }: { stage: string; dwell: readonly number[] }) {
  const total = dwell.reduce((sum, value) => sum + value, 0);
  if (dwell.length !== DWELL_TICKS.length || total === 0) return <p className="rd-note">没有走到这一步的人，没有耗时可画。</p>;
  let running = 0;
  const median = dwell.findIndex((value) => (running += value) * 2 >= total);
  const slow = dwell.slice(5).reduce((sum, value) => sum + value, 0);
  const share = (value: number) => `${((value / total) * 100).toFixed(1)}%`;
  return (
    <div className="rd-stack">
      <p className="l2-dwell-lead">
        {median < DWELL_WITHIN.length ? <>一半的人在 <b>{DWELL_WITHIN[median]}</b> 内完成</> : <>一半以上的人用了 <b>7 天以上</b></>}
        <span>拖过 3 天的 {people(slow)} 人，占 {share(slow)}</span>
      </p>
      <ColumnChart
        label={`走到「${stage}」的 ${people(total)} 人从上一步过来用了多久`}
        height={120}
        series={[{ label: "人数", slot: 3 }]}
        format={(value) => `${people(value)} 人 · ${share(value)}`}
        axisFormat={(value) => people(Math.round(value))}
        data={dwell.map((value, index) => ({ key: DWELL_TICKS[index], tick: DWELL_TICKS[index], values: [value], detail: <span>{DWELL_NAMES[index]}</span> }))}
      />
    </div>
  );
}

const TRIAL_NAME: Record<string, string> = {
  "trial.claim_sheet_shown": "看到领取弹窗",
  "trial.started": "开始试用",
  "trial.redeemed": "试用后购买",
};

/** 试用三步：和主漏斗分开的另一条线。 */
export function TrialLine({ steps }: { steps: readonly TrialStep[] }) {
  return (
    <ol className="l2-trial" aria-label="试用三步">
      {steps.map((step, index) => (
        <li key={step.e}>
          {index > 0 && (
            <span className="l2-trial-arrow">
              {step.suppressed || steps[index - 1].suppressed ? SMALL_SAMPLE_LABEL : step.arr ? <b>{step.arr}</b> : "上一步人数不足"}
            </span>
          )}
          <span className="l2-trial-step">
            <span>{TRIAL_NAME[step.e] ?? step.e}</span>
            <b data-empty={step.n == null ? "" : undefined}>{step.suppressed ? SMALL_SAMPLE_LABEL : step.n == null ? "—" : `${people(step.n)} 人`}</b>
          </span>
        </li>
      ))}
    </ol>
  );
}

export type RetentionColumn = { day: number; key: keyof CohortRow };

/** 注册周或月为行、第几天为列的留存热力格。没成熟、样本过小、来源没接上都和 0% 分开写。 */
export function RetentionHeatmap({ kind, cohorts, columns, selected, curveFor, disabled, sourceReady }: {
  kind: "周" | "月";
  cohorts: readonly CohortRow[];
  columns: readonly RetentionColumn[];
  selected: number;
  curveFor: (index: number) => void;
  disabled: boolean;
  sourceReady: boolean;
}) {
  const values = sourceReady ? cohorts.flatMap((row) => (row.suppressed ? [] : columns.map(({ key }) => row[key]).filter((value): value is number => typeof value === "number"))) : [];
  const level = values.length ? heatLevel(values) : null;
  return (
    <div className="rd-stack">
      <Table label={`按注册${kind}的留存`} className="l2-heat-table">
        <thead>
          <tr>
            <Th>注册{kind}</Th>
            <Th align="right">人数</Th>
            {columns.map(({ day }) => <Th key={day} align="right">第 {day} 天</Th>)}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((row, index) => (
            <Tr key={row.w} data-picked={index === selected ? "" : undefined}>
              <Td>
                <button type="button" className="l2-cohort-pick" aria-pressed={index === selected} disabled={disabled} onClick={() => curveFor(index)}
                  title={index === selected ? "曲线正在显示这一批" : "在右边画这一批的曲线"}>
                  <span>{row.w}</span>{index === selected && <small>曲线</small>}
                </button>
              </Td>
              <Td align="right"><Cell num main={row.suppressed ? SMALL_SAMPLE_LABEL : row.size == null ? "—" : people(row.size)} /></Td>
              {row.suppressed
                ? <Td colSpan={columns.length}><span className="l2-heat-empty">少于 5 人，留存不显示</span></Td>
                : columns.map(({ day, key }) => {
                  const value = row[key];
                  if (typeof value !== "number") return <Td key={day} align="right"><span className="l2-heat-cell" data-state="young" title={`这批还有人注册不满 ${day} 天`}>未到</span></Td>;
                  if (!sourceReady) return <Td key={day} align="right"><span className="l2-heat-cell" data-state="nosource" title="日活事件还没接上，这个数不能当留存看">未接上</span></Td>;
                  return (
                    <Td key={day} align="right">
                      <button type="button" className="l2-heat-cell" data-heat={level?.(value)} tabIndex={-1} disabled={disabled} onClick={() => curveFor(index)} title={`${row.w} 第 ${day} 天 ${pct(value)}，点一下看这一批的曲线`}>{pct(value)}</button>
                    </Td>
                  );
                })}
            </Tr>
          ))}
        </tbody>
      </Table>
      {level
        ? <HeatLegend low={pct(Math.min(...values))} high={pct(Math.max(...values))}><span>未到：还没满这么多天，不是 0%</span></HeatLegend>
        : <div className="l2-legend"><span>未到：还没满这么多天</span><span>未接上：日活事件没接上，不是 0%</span></div>}
    </div>
  );
}

const LANGUAGE_NAME = new Map<string, string>(INTERFACE_LANGUAGES.map((item) => [item.code, item.zhName]));

/** 交叉表的行是后端拼的「渠道 · 运营阶段」：渠道按「用户转化概览」的叫法归一（空值写成自然渠道），阶段原样，SYSTEM 写成系统记录。 */
export function crossRowLabel(value: unknown) {
  const raw = typeof value === "string" ? value : String(value ?? "");
  const separator = raw.indexOf(" · ");
  if (separator < 0) return { ref: formatB3RefOption(raw), phase: "" };
  const phase = raw.slice(separator + 3).trim();
  return { ref: formatB3RefOption(raw.slice(0, separator)), phase: phase === "SYSTEM" ? "系统记录" : phase === "unknown" ? "未记录阶段" : phase };
}

/** 渠道 × 语言的一项指标。深浅按这张表里的高低，最高、最低的格子带字标出；样本过小、没有这个组合各写一种。 */
export function CrossTable({ metric, name }: { metric: XdMetric; name: string }) {
  const cellValue = (row: (string | number | null)[], column: number) => row[column + 1];
  const numbers: number[] = [];
  metric.rows.forEach((row, rowIndex) => metric.columns.forEach((_column, column) => {
    const value = cellValue(row, column);
    if (typeof value === "number" && !metric.suppressedCells.has(`${rowIndex}:${column}`)) numbers.push(value);
  }));
  const level = numbers.length ? heatLevel(numbers) : null;
  const high = numbers.length > 1 ? Math.max(...numbers) : null;
  const low = numbers.length > 1 ? Math.min(...numbers) : null;
  const marked = high != null && low != null && high !== low;
  const text = (value: number) => `${value.toFixed(1)}${metric.unit}`;
  return (
    <div className="rd-stack">
      <Table label={`各渠道和语言的${name}`} className="l2-cross-table" data-tight="">
        <thead>
          <tr>
            <Th>渠道 · 运营阶段</Th>
            {metric.columns.map((column) => <Th key={column} align="right" title={column}>{LANGUAGE_NAME.get(column) ?? column}</Th>)}
            <Th align="right">各语言平均<Explain label="各语言平均怎么算" content="这一行有数的语言格子直接平均，不按人数加权，所以不等于这个渠道的总体比例。这一行有样本过小的格子时不算平均。" /></Th>
          </tr>
        </thead>
        <tbody>
          {metric.rows.map((row, rowIndex) => {
            const label = crossRowLabel(row[0]);
            const average = row[metric.columns.length + 1];
            return (
              <Tr key={String(row[0])}>
                <Td><Cell main={label.ref} sub={label.phase || undefined} title={String(row[0])} /></Td>
                {metric.columns.map((column, columnIndex) => {
                  const value = cellValue(row, columnIndex);
                  if (metric.suppressedCells.has(`${rowIndex}:${columnIndex}`)) return <Td key={column} align="right"><span className="l2-heat-cell" data-state="small">{SMALL_SAMPLE_LABEL}</span></Td>;
                  if (typeof value !== "number") return <Td key={column} align="right"><span className="l2-heat-cell" data-state="none" title="这个渠道没有这个语言的注册用户，或还算不出">—</span></Td>;
                  const mark = marked && value === high ? "最高" : marked && value === low ? "最低" : null;
                  return (
                    <Td key={column} align="right">
                      <span className="l2-heat-cell" data-heat={level?.(value)} data-mark={mark ? "" : undefined} title={`${label.ref}${label.phase ? ` · ${label.phase}` : ""} · ${LANGUAGE_NAME.get(column) ?? column} ${text(value)}`}>
                        {text(value)}{mark && <small>{mark}</small>}
                      </span>
                    </Td>
                  );
                })}
                <Td align="right"><Cell num main={metric.suppressedCells.has(`${rowIndex}:${metric.columns.length}`) ? SMALL_SAMPLE_LABEL : typeof average === "number" ? text(average) : "—"} /></Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      {level && <HeatLegend low={text(Math.min(...numbers))} high={text(Math.max(...numbers))}><span>「—」：没有这个组合的注册用户或还算不出；{SMALL_SAMPLE_LABEL}：少于 5 人不显示</span></HeatLegend>}
    </div>
  );
}
