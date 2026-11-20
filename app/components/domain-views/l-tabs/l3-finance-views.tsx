"use client";

/**
 * L3 财务报表的页面件：只画已经读到的数，不发请求、不算业务口径。
 * 金额写完整小数和 USDT；接口给 null 的比例写「—」，不当 0。
 */
import type { ReactNode } from "react";
import { BarList, Cell, Donut, Explain, Figure, Fold, Table, Td, Th, Tr, type ChartSlot } from "@/app/components/rd";
import { amountDigits, amountText } from "@/lib/admin/treasury-amount";
import { TREASURY_VALUATION_UNAVAILABLE } from "@/lib/admin/treasury-valuation";

/** 后端金额是两位小数；页面把几项加起来时去掉浮点误差（0.1 + 0.2），不改精度。 */
export const cents = (value: number) => Math.round(value * 100) / 100;
export const usdt = (value: number | null, digits?: number) => (value === null ? TREASURY_VALUATION_UNAVAILABLE : `${amountText(value, digits)} USDT`);
export const count = (value: number) => value.toLocaleString("en-US");
/** 接口给两位小数，原样写，不补也不舍。 */
export const pctText = (value: number | null) => value === null ? TREASURY_VALUATION_UNAVAILABLE : `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

/* ------------------------------ 本期收入构成 ------------------------------ */

export type RevenueStream = {
  key: string;
  name: string;
  source: string;
  explain: string;
  amount: number;
  previous: number;
  /** 后端给的百分数（一位小数）；本期合计为 0 时是 null。 */
  share: number | null;
  /** 后端给的较上期变化百分数；上期为 0 时是 null，−100 合法。 */
  momDelta: number | null;
  slot: ChartSlot;
};

export function RevenueFigure({ streams, total }: { streams: readonly RevenueStream[]; total: number }) {
  const digits = amountDigits([total, ...streams.flatMap((row) => [row.amount, row.previous])]);
  const table = (
    <Table label="四类收入的金额、占比和较上期" className="l3-revenue-table">
      <thead><tr><Th>收入来源</Th><Th align="right">本期金额</Th><Th align="right">占比</Th><Th align="right">较上期</Th></tr></thead>
      <tbody>
        {streams.map((row) => (
          <Tr key={row.key}>
            <Td><Cell main={<span className="l3-name"><span className="rd-chart-swatch" data-slot={row.slot} aria-hidden />{row.name}<Explain label={`${row.name}怎么算`} content={<><p>{row.explain}</p><p>来源：{row.source}。</p></>} /></span>} /></Td>
            <Td align="right"><Cell num main={usdt(row.amount, digits)} /></Td>
            <Td align="right"><Cell num main={row.share === null ? "—" : `${row.share.toFixed(1)}%`} /></Td>
            <Td align="right"><Cell num main={<span className="l3-delta" data-dir={row.momDelta === null || row.momDelta === 0 ? undefined : row.momDelta > 0 ? "up" : "down"}>{row.momDelta === null ? "—" : `${row.momDelta > 0 ? "+" : ""}${row.momDelta.toFixed(1)}%`}</span>}
              sub={`上期 ${usdt(row.previous, digits)}`} /></Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
  const positive = streams.filter((row) => row.amount > 0);
  if (positive.length < 2) {
    return (
      <div className="rd-stack">
        <p className="rd-note">{positive.length === 0 ? "本期四类收入都是 0。" : `本期只有「${positive[0].name}」有收入。`}</p>
        {table}
      </div>
    );
  }
  return (
    <Figure width={168} graphic={(
      <Donut legend={false} label="本期收入构成" center={amountText(total, digits).length <= 12 ? amountText(total, digits) : `${positive.length} 类`} centerLabel={amountText(total, digits).length <= 12 ? "USDT" : "有收入"}
        segments={streams.map((row) => ({ key: row.key, label: row.name, value: row.amount, slot: row.slot, text: usdt(row.amount, digits), share: row.share === null ? "—" : `${row.share.toFixed(1)}%` }))} />
    )}>
      {table}
    </Figure>
  );
}

/* -------------------------------- 本期提现 -------------------------------- */

export type Redemption = {
  submitted: number;
  confirmed: number;
  rejected: number;
  delayed: number;
  frozen: number;
  avgLatency: string;
  rate: number | null;
  prevRate: number | null;
  prevLabel: string;
};

export function RedemptionFigures({ data }: { data: Redemption }) {
  const delta = data.rate === null || data.prevRate === null ? null : data.rate - data.prevRate;
  const small: { key: string; label: string; value: string; explain: string; empty?: boolean }[] = [
    { key: "rejected", label: "驳回", value: `${count(data.rejected)} 笔`, explain: "本期被驳回的提现单，是最终结果。", empty: data.rejected === 0 },
    { key: "delayed", label: "曾延迟", value: `${count(data.delayed)} 笔`, explain: "本期被延迟过的提现单，是中间过程，之后可能已经确认，所以和确认、驳回会重叠。", empty: data.delayed === 0 },
    { key: "frozen", label: "曾冻结", value: `${count(data.frozen)} 笔`, explain: "本期被冻结过的提现单，是中间过程，之后可能已经确认，所以和确认、驳回会重叠。", empty: data.frozen === 0 },
    { key: "latency", label: "平均用时", value: data.avgLatency, explain: "本期每一次确认，从这笔提现最早提交到确认隔了多久，再取平均；本期没有确认时写「—」。", empty: data.avgLatency === "—" },
  ];
  return (
    <div className="rd-stack">
      <div className="l3-flow" role="group" aria-label="本期提现申请和确认">
        <div className="l3-flow-cell">
          <span>申请</span>
          <b data-empty={data.submitted === 0 ? "" : undefined}>{count(data.submitted)}<small>笔</small></b>
        </div>
        <div className="l3-flow-arrow" aria-hidden />
        <div className="l3-flow-cell">
          <span>确认</span>
          <b data-empty={data.confirmed === 0 ? "" : undefined}>{count(data.confirmed)}<small>笔</small></b>
        </div>
        <div className="l3-flow-cell" data-ratio="">
          <span>确认 ÷ 申请<Explain label="确认 ÷ 申请怎么算" content={<><p>本期确认的笔数 ÷ 本期申请的笔数。本期确认的可能是上期申请的，所以可以超过 100%，不代表出错。</p><p>本期没有申请时算不出，写「—」。只用来周期核账；提现安全看兑付覆盖率。</p></>} /></span>
          <b data-empty={data.rate === null ? "" : undefined}>{data.rate === null ? "—" : `${data.rate.toFixed(1)}%`}</b>
          <small className="l3-delta" data-dir={delta === null || delta === 0 ? undefined : delta > 0 ? "up" : "down"}>
            {delta === null ? `较 ${data.prevLabel}：—` : `较 ${data.prevLabel} ${delta > 0 ? "+" : ""}${delta.toFixed(1)} 个百分点`}
          </small>
        </div>
      </div>
      <dl className="l3-mini">
        {small.map((item) => (
          <div key={item.key}>
            <dt>{item.label}<Explain label={`${item.label}的说明`} content={item.explain} /></dt>
            <dd data-empty={item.empty ? "" : undefined}>{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ------------------------------- 九类应付款 ------------------------------- */

export type LiabilityRow = { key: string; name: string; explain: string; amount: number | null };

export function LiabilityBars({ rows, total }: { rows: readonly LiabilityRow[]; total: number | null }) {
  const digits = amountDigits([total, ...rows.map((row) => row.amount)]);
  const sorted = [...rows].sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));
  return (
    <div className="rd-stack">
      <BarList label="九类应付款，按金额从多到少" slot={2}
        rows={sorted.map((row) => ({
          key: row.key,
          label: <span className="l3-name">{row.name}<Explain label={`${row.name}是什么`} content={row.explain} /></span>,
          value: row.amount,
          text: <span className="l3-bar-text"><b data-empty={row.amount === 0 ? "" : undefined}>{usdt(row.amount, digits)}</b><small>{row.amount === null || total === null || total === 0 ? "—" : `${(row.amount / total * 100).toFixed(1)}%`}</small></span>,
        }))} />
      <div className="l3-total"><span>九类合计</span><b>{usdt(total, digits)}</b></div>
    </div>
  );
}

/* ------------------------------ 未来 30 天分段 ------------------------------ */

export type MaturityPart = { key: string; name: string; slot: ChartSlot };
export type MaturityGroup = { key: string; label: string; days: number; values: readonly number[] };

/** 30 天按接口的四段（7、7、7、9 天）横着画：条长按这一段的合计，条里按三类分色，右边写合计。 */
export function MaturityGroups({ parts, groups, footer }: { parts: readonly MaturityPart[]; groups: readonly MaturityGroup[]; footer?: ReactNode }) {
  const totals = groups.map((group) => cents(group.values.reduce((sum, value) => sum + value, 0)));
  const max = Math.max(0, ...totals);
  const digits = amountDigits([...totals, ...groups.flatMap((group) => group.values)]);
  return (
    <div className="rd-stack">
      <ul className="l3-groups" aria-label="未来 30 天分四段的到期金额">
        {groups.map((group, index) => {
          const barStyle = { width: `${max > 0 ? totals[index] / max * 100 : 0}%` };
          return (
            <li key={group.key}>
              <span className="l3-groups-label">{group.label}<small>{group.days} 天</small></span>
              <span className="l3-groups-track" aria-hidden>
                {totals[index] > 0 && (
                  <span className="l3-groups-bar" style={barStyle}>
                    {group.values.map((value, part) => {
                      const partStyle = { flexGrow: value };
                      return value > 0 && <i key={parts[part].key} data-slot={parts[part].slot} style={partStyle} title={`${parts[part].name} ${usdt(value, digits)}`} />;
                    })}
                  </span>
                )}
              </span>
              <span className="l3-groups-total" data-empty={totals[index] === 0 ? "" : undefined}>{usdt(totals[index], digits)}</span>
            </li>
          );
        })}
      </ul>
      <ul className="rd-chart-legend">
        {parts.map((part) => <li key={part.key}><span className="rd-chart-swatch" data-slot={part.slot} aria-hidden />{part.name}</li>)}
      </ul>
      {footer}
      <Fold inset title="四段明细" summary={`${groups.length} 段 · 每段三类各多少`}>
        <Table label="未来 30 天四段、三类的到期金额" className="l3-groups-table">
          <thead><tr><Th>时间段</Th>{parts.map((part) => <Th key={part.key} align="right">{part.name}</Th>)}<Th align="right">合计</Th></tr></thead>
          <tbody>
            {groups.map((group, index) => (
              <Tr key={group.key}>
                <Td><Cell num main={group.label} sub={`${group.days} 天`} /></Td>
                {parts.map((part, partIndex) => <Td key={part.key} align="right"><Cell num main={amountText(group.values[partIndex], digits)} /></Td>)}
                <Td align="right"><Cell num main={usdt(totals[index], digits)} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Fold>
    </div>
  );
}

/** 按类别的到期金额：一类一行，条的颜色和右边四段图同一类同一色。 */
export function DueBars({ parts, values, digits, explain }: { parts: readonly MaturityPart[]; values: readonly number[]; digits: number; explain: Record<string, ReactNode> }) {
  const max = Math.max(0, ...values);
  return (
    <ul className="l3-groups" data-kind="due" aria-label="按类别的到期金额">
      {parts.map((part, index) => {
        const barStyle = { width: `${max > 0 ? values[index] / max * 100 : 0}%` };
        return (
          <li key={part.key}>
            <span className="l3-groups-label l3-name">{part.name}<Explain label={`${part.name}怎么算`} content={explain[part.key]} /></span>
            <span className="l3-groups-track" aria-hidden>
              {values[index] > 0 && <span className="l3-groups-bar" style={barStyle}><i data-slot={part.slot} /></span>}
            </span>
            <span className="l3-groups-total" data-empty={values[index] === 0 ? "" : undefined}>{usdt(values[index], digits)}</span>
          </li>
        );
      })}
    </ul>
  );
}
