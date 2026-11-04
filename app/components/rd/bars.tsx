"use client";

/**
 * Bars 按天的柱图（CP-49）。先问图回答什么问题（DP-60）；全是 0 就别画，用一句话代替（DP-62）。
 *
 * <Bars label="近 8 天每天流入和流出" series={[{ name: "流入", slot: 2 }, { name: "流出", slot: 4 }]}
 *   rows={[{ label: "11-05", values: [80000, 48000] }]} format={(n) => `${fmtAmount(n)} USDT`} />
 *
 * - slot 是图表色槽位，和页面上这个数字的角色色一一对应（VS-41）。
 * - 柱最粗 24px，数据端 4px 圆角，两系列之间留 2px，0 不画（VS-46、DP-63）。
 * - 两个系列以上有图例。悬停看这一天的数，读屏读隐藏的表（CP-49）。
 * - 刻度从 0 到最大值，顶线写最大值，所以不会贴边。
 */
import type { CSSProperties } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";

export interface BarSeries {
  name: string;
  slot: 1 | 2 | 3 | 4;
}

const barColor = (slot: BarSeries["slot"]) => ({ "--bar": `var(--rd-chart-${slot})` }) as CSSProperties;

export function Bars({ label, series, rows, format, height = 120 }: {
  label: string;
  series: readonly BarSeries[];
  rows: readonly { label: string; values: readonly number[] }[];
  format: (value: number) => string;
  height?: number;
}) {
  const max = Math.max(...rows.flatMap((row) => row.values));
  return (
    <div className="rd-bars">
      {series.length > 1 && (
        <div className="rd-bars-legend" aria-hidden>
          {series.map((item) => <span key={item.name} className="rd-bars-key"><span className="rd-bars-swatch" style={barColor(item.slot)} />{item.name}</span>)}
        </div>
      )}
      <Tooltip.Provider delayDuration={0}>
        <div className="rd-bars-plot" style={{ "--rd-bars-h": `${height}px` } as CSSProperties} aria-hidden>
          <span className="rd-bars-top" />
          <span className="rd-bars-max">{format(max)}</span>
          {rows.map((row) => (
            <Tooltip.Root key={row.label}>
              <Tooltip.Trigger asChild>
                <div className="rd-bars-group">
                  {series.map((item, index) => row.values[index] > 0 && (
                    <span key={item.name} className="rd-bars-bar" style={{ ...barColor(item.slot), height: `${(row.values[index] / max) * 100}%` }} />
                  ))}
                </div>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className="rd-tip" sideOffset={6}>
                  <div className="rd-bars-tip">
                    <b>{row.label}</b>
                    {series.map((item, index) => <span key={item.name}>{item.name} {format(row.values[index])}</span>)}
                  </div>
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          ))}
        </div>
      </Tooltip.Provider>
      <div className="rd-bars-axis" aria-hidden>{rows.map((row) => <span key={row.label}>{row.label}</span>)}</div>
      <div className="rd-sr-only">
        <table>
          <caption>{label}</caption>
          <thead><tr><th>日期</th>{series.map((item) => <th key={item.name}>{item.name}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.label}><td>{row.label}</td>{series.map((item, index) => <td key={item.name}>{format(row.values[index])}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
