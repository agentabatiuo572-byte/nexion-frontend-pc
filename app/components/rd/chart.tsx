"use client";

/**
 * 图表（CP-49）。只读，不引图表库，不做缩放、点选和拖拽，悬停看数值。全部一根纵轴。
 * 颜色传槽位 slot（VS-40）：1 金、2 青、3 紫、4 品红、other 灰。系列是页面角色时用同一个槽位（VS-41）。
 *
 * 构成：<SegmentBar label="应付款构成" segments={[{ key, label, value, slot, text }]} />
 *   8px 段条，段间 2px，0 不画。最多前 3 类加「其他」由页面决定（DP-64）。
 * 柱状：<ColumnChart label="每天到期" series={[{ label: "到期", slot: 3 }]} format={money}
 *   data={[{ key: date, tick: "11-05", values: [120], detail: "提现 …" }]} />
 *   两个系列成对画，两个系列以上自动带图例。
 * 走势：<TrendLine label="累计到期" data={[{ key, tick, value }]} format={money} slot={3} />
 *   纵轴总是包住 0。只画真实历史或明确标为预测的序列，当前值倒推的不画（DP-63）。
 * 走势带线：<TrendLines label="这项指标的走势" ticks={["10-11", …]} format={pct}
 *   series={[{ key: "kpi", label: "首笔收益到账", slot: 2, values: [12, 18, …] }]}
 *   marks={[{ key: "target", text: "目标 95%", value: 95, tone: "ok" }]} event={{ index: 3, text: "运营阶段切换" }} />
 *   多条线比走势，或要画目标线、事件线时用它。纵轴包住全部值和线；值和线都离 0 很远时从一个整齐的低值起，不然挤成一条看不出变化（visual-1 第 8 条），其余从 0 起。两个系列以上自动带图例（VS-47）。
 * 迷你线：<Sparkline label="近六段走势" values={[…]} />  表格里看走向，不带轴，至少两个点才传（ST-64）。
 * 环图：<Donut label="储备组成" center="2,000,000.00" centerLabel="USDT"
 *   segments={[{ key, label, value, slot, text: "2,000,000.00 USDT", share: "97.6%" }]} />
 *   一个整体分几份、中间写总额。段间 2px 留底色，图例直接写每份的数和占比，名字和数字挨着（VS-47）。最多前 3 类加「其他」（DP-64）。
 *   旁边已经有表格时传 legend={false}，只画环，表格第一列放 <span className="rd-chart-swatch" data-slot={…} /> 当图例，数字不写两遍（DP-61）。
 * 排序条：<BarList label="应付款最多的几类" slot={2} rows={[{ key, label, value, text: "250,000.00 USDT" }]} />
 *   几类比大小，按大小排，一个颜色（同一角色就用它的槽位），数字紧跟在条右边。value 传 null 是样本过小，不画条。
 * 分区：<Figure graphic={<ThresholdMeter … />} width={560} stack="wide"><ul>…数字…</ul></Figure>
 *   图在左、宽度有上限（width），数据在右、名字和数字挨着；容器窄时上下排：默认 560px 以下，stack="wide" 是 800px 以下（VS-49）。
 *   图自己也有上限：环 148px，条和尺 320～420px，柱图每根占位最宽 96px，所以不传 Figure 也不会横向拉满。
 *
 * 全是 0、数据不足或只有一类时不要用这些组件，页面写一句话（DP-62）。
 * 图是 role="img"，数值要能在图外读到：结论、表格、图例或明细（ST-63）。刻度尺和档位带在 meter.tsx。
 */
import { useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import type { StateTone } from "./tone";

export type ChartSlot = 1 | 2 | 3 | 4 | "other";

/** 每根柱（含两根成对的）最多占 96px，纵轴刻度占 72px：图不随面板横向拉满。 */
export const SLOT_W = 96;
const AXIS_W = 72;

/** 图和数据左右分区。左边图、宽度到 width 为止，右边数据；容器窄时上下排。 */
export function Figure({ graphic, width = 480, stack, children }: { graphic: ReactNode; width?: number; stack?: "wide"; children: ReactNode }) {
  return (
    <div className="rd-figure" data-stack={stack} style={{ "--rd-figure-w": `${width}px` } as CSSProperties}>
      <div className="rd-figure-graphic">{graphic}</div>
      <div className="rd-figure-data">{children}</div>
    </div>
  );
}

const STEPS = [1, 2, 2.5, 5, 10];

/** 取包住 value 的整齐刻度。 */
export function niceCeil(value: number) {
  if (value <= 0) return 0;
  const power = 10 ** Math.floor(Math.log10(value));
  return (STEPS.find((step) => step * power >= value) ?? 10) * power;
}

function tickEvery(count: number) {
  return count <= 8 ? 1 : count <= 16 ? 2 : Math.ceil(count / 8);
}

/** slot 是系列色；tone 是表示好坏的图例（VS-43），比如账户状态；两个都不传时只写字。 */
export function ChartLegend({ items }: { items: readonly { key: string; label: ReactNode; slot?: ChartSlot; tone?: StateTone }[] }) {
  return (
    <ul className="rd-chart-legend">
      {items.map((item) => <li key={item.key}>{(item.slot !== undefined || item.tone) && <span className="rd-chart-swatch" data-slot={item.slot} data-tone={item.tone} aria-hidden />}{item.label}</li>)}
    </ul>
  );
}

export function SegmentBar({ label, segments }: { label: string; segments: readonly { key: string; label: ReactNode; value: number; slot: ChartSlot; text: string }[] }) {
  const drawn = segments.filter((segment) => segment.value > 0);
  return (
    <div className="rd-segbar-wrap">
      <div className="rd-segbar" role="img" aria-label={`${label}：${drawn.map((segment) => segment.text).join("，")}`}>
        {drawn.map((segment) => <span key={segment.key} data-slot={segment.slot} title={segment.text} style={{ flexGrow: segment.value }} />)}
      </div>
      <ChartLegend items={segments.map((segment) => ({ key: segment.key, slot: segment.slot, label: segment.text }))} />
    </div>
  );
}

function Tip({ index, count, children }: { index: number; count: number; children: ReactNode }) {
  const ratio = (index + 0.5) / count;
  return <div className="rd-chart-tip" data-edge={ratio < 0.2 ? "start" : ratio > 0.8 ? "end" : undefined} style={{ left: `${ratio * 100}%` }}>{children}</div>;
}

function Ticks({ ticks, format }: { ticks: readonly { value: number; ratio: number }[]; format: (value: number) => string }) {
  return (
    <>
      {ticks.map((tick) => (
        <div key={tick.ratio} className="rd-chart-grid" data-zero={tick.value === 0 ? "" : undefined} style={{ bottom: `${tick.ratio * 100}%` }}>
          <span>{format(tick.value)}</span>
        </div>
      ))}
    </>
  );
}

export function ColumnChart({ label, data, series, format, axisFormat = format, height = 180 }: {
  label: string;
  data: readonly { key: string; tick: string; values: readonly number[]; detail?: ReactNode }[];
  series: readonly { label: string; slot: ChartSlot }[];
  format: (value: number) => string;
  axisFormat?: (value: number) => string;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const top = niceCeil(Math.max(...data.flatMap((row) => row.values)));
  const every = tickEvery(data.length);
  const current = active === null ? null : data[active];
  return (
    <div className="rd-chart" style={{ maxWidth: AXIS_W + data.length * SLOT_W }}>
      {series.length > 1 && <ChartLegend items={series.map((item) => ({ key: item.label, label: item.label, slot: item.slot }))} />}
      <div className="rd-chart-frame" role="img" aria-label={label}>
        <div className="rd-chart-plot" style={{ height }} onMouseLeave={() => setActive(null)}>
          <Ticks ticks={[{ value: 0, ratio: 0 }, { value: top / 2, ratio: 0.5 }, { value: top, ratio: 1 }]} format={axisFormat} />
          <div className="rd-chart-cols">
            {data.map((row, index) => (
              <div key={row.key} className="rd-chart-col" data-active={active === index ? "" : undefined} onMouseEnter={() => setActive(index)}>
                {row.values.map((value, valueIndex) => (
                  <span key={series[valueIndex].label} className="rd-chart-bar" data-slot={series[valueIndex].slot} style={{ height: `${top > 0 ? value / top * 100 : 0}%` }} />
                ))}
              </div>
            ))}
          </div>
          {current && active !== null && (
            <Tip index={active} count={data.length}>
              <b>{current.tick}</b>
              {current.values.map((value, index) => <span key={series[index].label}>{series[index].label} {format(value)}</span>)}
              {current.detail}
            </Tip>
          )}
        </div>
        <div className="rd-chart-x">
          {data.map((row, index) => <span key={row.key}>{index % every === 0 ? row.tick : ""}</span>)}
        </div>
      </div>
    </div>
  );
}

export function TrendLine({ label, data, format, axisFormat = format, slot = 1, height = 180 }: {
  label: string;
  data: readonly { key: string; tick: string; value: number; detail?: ReactNode }[];
  format: (value: number) => string;
  axisFormat?: (value: number) => string;
  slot?: ChartSlot;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const values = data.map((row) => row.value);
  const high = niceCeil(Math.max(0, ...values));
  const low = -niceCeil(Math.max(0, ...values.map((value) => -value)));
  const span = high - low || 1;
  const yRatio = (value: number) => (value - low) / span;
  const xRatio = (index: number) => data.length > 1 ? index / (data.length - 1) : 0.5;
  const path = data.map((row, index) => `${index ? "L" : "M"}${(xRatio(index) * 1000).toFixed(1)} ${((1 - yRatio(row.value)) * 200).toFixed(1)}`).join(" ");
  const every = tickEvery(data.length);
  const ticks = [...new Set([low, 0, high])].map((value) => ({ value, ratio: yRatio(value) }));
  const hover = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setActive(Math.min(data.length - 1, Math.max(0, Math.round((event.clientX - box.left) / box.width * (data.length - 1)))));
  };
  const marker = active ?? data.length - 1;
  const current = active === null ? null : data[active];
  return (
    <div className="rd-chart" style={{ maxWidth: AXIS_W + data.length * SLOT_W }}>
      <div className="rd-chart-frame" role="img" aria-label={label}>
        <div className="rd-chart-plot" style={{ height }} onMouseMove={hover} onMouseLeave={() => setActive(null)}>
          <Ticks ticks={ticks} format={axisFormat} />
          <svg className="rd-chart-line" viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden>
            <path d={path} data-slot={slot} vectorEffect="non-scaling-stroke" />
          </svg>
          {active !== null && <span className="rd-chart-cross" style={{ left: `${xRatio(active) * 100}%` }} />}
          <span
            className="rd-chart-dot"
            data-slot={slot}
            style={{ left: `${xRatio(marker) * 100}%`, bottom: `${yRatio(data[marker].value) * 100}%` }}
          />
          {current && active !== null && (
            <Tip index={active} count={data.length}>
              <b>{current.tick}</b>
              <span>{format(current.value)}</span>
              {current.detail}
            </Tip>
          )}
        </div>
        <div className="rd-chart-x" data-spread="">
          {data.map((row, index) => (index % every === 0 || index === data.length - 1) && <span key={row.key} data-edge={index === 0 ? "start" : index === data.length - 1 ? "end" : undefined} style={{ left: `${xRatio(index) * 100}%` }}>{row.tick}</span>)}
        </div>
      </div>
    </div>
  );
}

/** 几条线放一根纵轴比走势，也画目标线和事件线。线的颜色是槽位，目标线的颜色是状态（VS-43）。 */
/** 走势带线的纵轴。上限是包住最大值再留四分之一余量的半步整数（62.5 → 65）；值和线都远离 0（最小值高于上限的 35%）时下限也取半步整数，不然从 0 起。 */
function axisBounds(values: readonly number[]) {
  const max = Math.max(0, ...values);
  const min = Math.min(...values);
  const pad = (max - min) * 0.25 || max * 0.1;
  const half = (value: number, round: (n: number) => number) => {
    if (value <= 0) return 0;
    const power = 10 ** Math.floor(Math.log10(value));
    return round(value / power * 2) / 2 * power;
  };
  const top = half(max + pad, Math.ceil) || 1;
  const low = min - pad > top * 0.35 ? half(min - pad, Math.floor) : 0;
  return { low, top };
}

export function TrendLines({ label, ticks, series, format, axisFormat = format, marks = [], event, height = 180 }: {
  label: string;
  ticks: readonly string[];
  series: readonly { key: string; label: string; slot: ChartSlot; values: readonly number[] }[];
  format: (value: number) => string;
  axisFormat?: (value: number) => string;
  marks?: readonly { key: string; text: string; value: number; tone: StateTone }[];
  event?: { index: number; text: string };
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const { low, top } = axisBounds([...series.flatMap((item) => item.values), ...marks.map((mark) => mark.value)]);
  const y = (value: number) => (value - low) / (top - low);
  const xRatio = (index: number) => ticks.length > 1 ? index / (ticks.length - 1) : 0.5;
  const every = tickEvery(ticks.length);
  const hover = (mouse: MouseEvent<HTMLDivElement>) => {
    const box = mouse.currentTarget.getBoundingClientRect();
    setActive(Math.min(ticks.length - 1, Math.max(0, Math.round((mouse.clientX - box.left) / box.width * (ticks.length - 1)))));
  };
  return (
    <div className="rd-chart" style={{ maxWidth: AXIS_W + ticks.length * SLOT_W }}>
      {series.length > 1 && <ChartLegend items={series.map((item) => ({ key: item.key, label: item.label, slot: item.slot }))} />}
      <div className="rd-chart-frame" role="img" aria-label={label}>
        <div className="rd-chart-plot" style={{ height }} onMouseMove={hover} onMouseLeave={() => setActive(null)}>
          <Ticks ticks={[{ value: low, ratio: 0 }, { value: (low + top) / 2, ratio: 0.5 }, { value: top, ratio: 1 }]} format={axisFormat} />
          {marks.map((mark, index) => <div key={mark.key} className="rd-chart-ref" data-tone={mark.tone} data-below={index % 2 ? "" : undefined} style={{ bottom: `${y(mark.value) * 100}%` }}><span>{mark.text}</span></div>)}
          {event && <div className="rd-chart-event" style={{ left: `${xRatio(event.index) * 100}%` }}><span data-edge={xRatio(event.index) > 0.7 ? "end" : undefined}>{event.text}</span></div>}
          <svg className="rd-chart-line" viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden>
            {series.map((item) => (
              <path key={item.key} data-slot={item.slot} vectorEffect="non-scaling-stroke"
                d={item.values.map((value, index) => `${index ? "L" : "M"}${(xRatio(index) * 1000).toFixed(1)} ${((1 - y(value)) * 200).toFixed(1)}`).join(" ")} />
            ))}
          </svg>
          {active !== null && <span className="rd-chart-cross" style={{ left: `${xRatio(active) * 100}%` }} />}
          {series.map((item) => {
            const at = Math.min(active ?? item.values.length - 1, item.values.length - 1);
            return <span key={item.key} className="rd-chart-dot" data-slot={item.slot} style={{ left: `${xRatio(at) * 100}%`, bottom: `${y(item.values[at]) * 100}%` }} />;
          })}
          {active !== null && (
            <Tip index={active} count={ticks.length}>
              <b>{ticks[active]}</b>
              {series.map((item) => <span key={item.key}>{series.length > 1 ? `${item.label} ` : ""}{format(item.values[active])}</span>)}
            </Tip>
          )}
        </div>
        <div className="rd-chart-x" data-spread="">
          {ticks.map((tick, index) => (index % every === 0 || index === ticks.length - 1) && <span key={tick} data-edge={index === 0 ? "start" : index === ticks.length - 1 ? "end" : undefined} style={{ left: `${xRatio(index) * 100}%` }}>{tick}</span>)}
        </div>
      </div>
    </div>
  );
}

/** 迷你走势线，放在表格格子里。不是数据的来源，数值要在别处读到。 */
export function Sparkline({ label, values, slot = "other" }: { label: string; values: readonly number[]; slot?: ChartSlot }) {
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  const path = values.map((value, index) => `${index ? "L" : "M"}${(index / (values.length - 1) * 100).toFixed(1)} ${(22 - (value - low) / span * 20).toFixed(1)}`).join(" ");
  return <svg className="rd-spark" viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label={label}><path d={path} data-slot={slot} vectorEffect="non-scaling-stroke" /></svg>;
}

/** 环图。r 取 15.9155 让周长正好是 100，dasharray 直接用百分比；段间留 2px 底色（VS-46）。 */
const RING_R = 15.9155;
const RING_GAP = 0.7;

export function Donut({ label, segments, center, centerLabel, legend = true }: {
  label: string;
  segments: readonly { key: string; label: ReactNode; value: number; slot: ChartSlot; text: string; share: string; sub?: ReactNode }[];
  center: ReactNode;
  centerLabel?: ReactNode;
  /** 旁边已经有表格或列表给数时传 false，只画环。 */
  legend?: boolean;
}) {
  const drawn = segments.filter((segment) => segment.value > 0);
  const total = drawn.reduce((sum, segment) => sum + segment.value, 0);
  const gap = drawn.length > 1 ? RING_GAP : 0;
  let start = 0;
  const arcs = drawn.map((segment) => {
    const length = total > 0 ? (segment.value / total) * 100 : 0;
    const arc = { ...segment, length: Math.max(0, length - gap), offset: start + gap / 2 };
    start += length;
    return arc;
  });
  const sentence = `${label}：${drawn.map((segment) => `${typeof segment.label === "string" ? segment.label : ""} ${segment.text}，占 ${segment.share}`).join("；")}`;
  const ring = (
      <div className="rd-donut" role="img" aria-label={sentence}>
        <svg viewBox="0 0 42 42" aria-hidden>
          <circle className="rd-donut-track" cx="21" cy="21" r={RING_R} />
          {arcs.map((arc) => (
            <circle key={arc.key} className="rd-donut-arc" data-slot={arc.slot} cx="21" cy="21" r={RING_R} strokeDasharray={`${arc.length} ${100 - arc.length}`} strokeDashoffset={25 - arc.offset}>
              <title>{`${typeof arc.label === "string" ? arc.label : ""} ${arc.text}（${arc.share}）`}</title>
            </circle>
          ))}
        </svg>
        <div className="rd-donut-center">
          <b>{center}</b>
          {centerLabel && <span>{centerLabel}</span>}
        </div>
      </div>
  );
  if (!legend) return ring;
  return (
    <Figure graphic={ring} width={200}>
      <ul className="rd-chart-legend" data-list="">
        {segments.map((segment) => (
          <li key={segment.key} data-zero={segment.value > 0 ? undefined : ""}>
            <span className="rd-chart-swatch" data-slot={segment.slot} aria-hidden />
            <span className="rd-legend-name">{segment.label}{segment.sub && <small>{segment.sub}</small>}</span>
            <span className="rd-legend-value">{segment.text}<small>{segment.share}</small></span>
          </li>
        ))}
      </ul>
    </Figure>
  );
}

/** 排序条。条本身 aria-hidden，名字和数字是正文，读屏按列表读。 */
export function BarList({ label, rows, slot = 1, max }: {
  label: string;
  rows: readonly { key: string; label: ReactNode; value: number | null; text: ReactNode }[];
  slot?: ChartSlot;
  max?: number;
}) {
  const top = max ?? Math.max(0, ...rows.map((row) => row.value ?? 0));
  return (
    <ul className="rd-barlist" aria-label={label}>
      {rows.map((row) => (
        <li key={row.key}>
          <span className="rd-barlist-label">{row.label}</span>
          <span className="rd-barlist-track" aria-hidden>
            {row.value !== null && row.value > 0 && top > 0 && <span className="rd-barlist-bar" data-slot={slot} style={{ width: `${(row.value / top) * 100}%` }} />}
          </span>
          <span className="rd-barlist-text">{row.text}</span>
        </li>
      ))}
    </ul>
  );
}
