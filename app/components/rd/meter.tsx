/**
 * 刻度尺和档位带（CP-49）。两个都是「一个读数和它的阈值」的图：刻度一定包住当前值（DP-63、ST-70）。
 * 组件不算结论：哪档是当前档、条是什么颜色，页面按现有阈值传进来。
 *
 * 阈值尺：几个比率和同一组线比。
 * <ThresholdMeter label="覆盖率和红线、健康线" rows={[{ key: "cover", label: "覆盖率", value: 753.8, text: "753.8%", tone: "ok" }]}
 *   marks={[{ key: "red", text: "红线 100%", value: 100, tone: "danger" }, { key: "healthy", text: "健康线 110%", value: 110, tone: "ok" }]} />
 *   刻度 0 到包住最大值的整齐数，线用状态色、带字；条的颜色是这一行现在的状态（VS-43）。线的字一上一下，挨得近也不叠。
 *
 * 档位带：一个值落在固定的几档里。
 * <TierBand label="资金安全等级" current="NORMAL" value={267} valueText="可覆盖 267 天" boundText={(n) => n === 365 ? "1 年" : `${n} 天`}
 *   tiers={[{ key: "DANGER", label: "危险", tone: "danger", from: 0, to: 7 }, …, { key: "NORMAL", label: "正常", tone: "ok", from: 30, to: 365 }]} />
 *   每档等宽，档的边界写在下面，所以不是线性尺；当前档实色，其他档淡底。标记在当前档里按比例放，超过最后一档上限就贴右端。
 *
 * 行内小尺：表格一格里的 0～1 读数，比如关联程度。条和字用同一个状态色，tone 由页面按现有阈值传。
 * <InlineMeter value={0.82} text="0.82" tone="danger" />
 *
 * 值读不到、全是 0 或没有到期时不要画，页面写一句话（DP-62）。
 */
import type { ReactNode } from "react";
import { niceCeil } from "./chart";
import type { StateTone } from "./tone";

export function InlineMeter({ value, text, tone }: { value: number; text: string; tone: StateTone }) {
  return (
    <span className="rd-inline-meter" data-tone={tone}>
      <span className="rd-inline-meter-track" aria-hidden><span style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} /></span>
      <span className="rd-inline-meter-text">{text}</span>
    </span>
  );
}

export function ThresholdMeter({ label, rows, marks }: {
  label: string;
  rows: readonly { key: string; label: string; value: number; text: string; tone: StateTone }[];
  marks: readonly { key: string; text: string; value: number; tone: StateTone }[];
}) {
  const top = niceCeil(Math.max(0, ...rows.map((row) => row.value), ...marks.map((mark) => mark.value)) * 1.05) || 1;
  const ratio = (value: number) => Math.min(100, Math.max(0, (value / top) * 100));
  const edge = (value: number) => (ratio(value) < 12 ? "start" : ratio(value) > 88 ? "end" : undefined);
  const sentence = `${label}：${rows.map((row) => `${row.label} ${row.text}`).join("，")}；${marks.map((mark) => mark.text).join("，")}`;
  const labels = (side: 0 | 1) => (
    <div className="rd-meter-row" aria-hidden>
      <span />
      <span className="rd-meter-marks">
        {marks.filter((_, index) => index % 2 === side).map((mark) => (
          <span key={mark.key} data-tone={mark.tone} data-edge={edge(mark.value)} style={{ left: `${ratio(mark.value)}%` }}>{mark.text}</span>
        ))}
      </span>
      <span />
    </div>
  );
  return (
    <div className="rd-meter" role="img" aria-label={sentence}>
      {labels(0)}
      {rows.map((row) => (
        <div key={row.key} className="rd-meter-row">
          <span className="rd-meter-label">{row.label}</span>
          <span className="rd-meter-track">
            {row.value > 0 && <span className="rd-meter-bar" data-tone={row.tone} style={{ width: `${ratio(row.value)}%` }} />}
            {marks.map((mark) => <i key={mark.key} className="rd-meter-mark" data-tone={mark.tone} style={{ left: `${ratio(mark.value)}%` }} />)}
          </span>
          <span className="rd-meter-text">{row.text}</span>
        </div>
      ))}
      {marks.length > 1 && labels(1)}
    </div>
  );
}

export function TierBand({ label, tiers, current, value, valueText, boundText }: {
  label: string;
  tiers: readonly { key: string; label: string; tone: StateTone; from: number; to: number }[];
  current: string;
  value: number | null;
  valueText: ReactNode;
  boundText: (value: number) => string;
}) {
  const count = tiers.length;
  const index = tiers.findIndex((tier) => tier.key === current);
  const tier = index >= 0 ? tiers[index] : null;
  const fraction = tier && value !== null ? Math.min(1, Math.max(0, (value - tier.from) / (tier.to - tier.from || 1))) : null;
  const left = fraction === null ? null : ((index + fraction) / count) * 100;
  const bounds = [tiers[0]?.from ?? 0, ...tiers.map((item) => item.to)];
  return (
    <div className="rd-tiers" role="img" aria-label={`${label}：${tier?.label ?? "未知"}${typeof valueText === "string" ? `，${valueText}` : ""}`}>
      {left !== null && (
        <div className="rd-tiers-marker" data-edge={left > 70 ? "end" : undefined} style={{ left: `${left}%` }}>
          <span>{valueText}</span>
        </div>
      )}
      <div className="rd-tiers-track">
        {tiers.map((item) => <span key={item.key} data-tone={item.tone} data-current={item.key === current ? "" : undefined} />)}
      </div>
      <div className="rd-tiers-names">
        {tiers.map((item) => <span key={item.key} data-tone={item.tone} data-current={item.key === current ? "" : undefined}>{item.label}</span>)}
      </div>
      <div className="rd-tiers-bounds">
        {bounds.map((bound, position) => (
          <span key={position} data-edge={position === 0 ? "start" : position === count ? "end" : undefined} style={{ left: `${(position / count) * 100}%` }}>{boundText(bound)}</span>
        ))}
      </div>
    </div>
  );
}
