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
 *
 * 全是 0、数据不足或只有一类时不要用这些组件，页面写一句话（DP-62）。
 * 图是 role="img"，数值要能在图外读到：结论、表格或明细（ST-63）。
 */
import { useState, type MouseEvent, type ReactNode } from "react";

export type ChartSlot = 1 | 2 | 3 | 4 | "other";

const STEPS = [1, 2, 2.5, 5, 10];

/** 取包住 value 的整齐刻度。 */
function niceCeil(value: number) {
  if (value <= 0) return 0;
  const power = 10 ** Math.floor(Math.log10(value));
  return (STEPS.find((step) => step * power >= value) ?? 10) * power;
}

function tickEvery(count: number) {
  return count <= 8 ? 1 : count <= 16 ? 2 : Math.ceil(count / 8);
}

export function ChartLegend({ items }: { items: readonly { key: string; label: ReactNode; slot: ChartSlot }[] }) {
  return (
    <ul className="rd-chart-legend">
      {items.map((item) => <li key={item.key}><span className="rd-chart-swatch" data-slot={item.slot} aria-hidden />{item.label}</li>)}
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
    <div className="rd-chart">
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
    <div className="rd-chart">
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
