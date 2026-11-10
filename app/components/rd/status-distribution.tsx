"use client";

/**
 * StatusDistributionBar 状态分布条。一批东西按状态各有多少：按数量比例分段的 8px 细条，下面紧跟图例，图例写每一类的名字和数。
 * 画在 SegmentBar 上，段间 2px，0 的类不画段、留在图例里。看它能判断：各状态各占多少，哪一类最多。
 *
 * <StatusDistributionBar label="商城设备状态分布" selectedKey={filter} segments={[
 *   { key: "running", label: "运行中", value: 9, text: "9 台", tone: "ok", onSelect: () => setFilter("running") },
 *   { key: "waiting", label: "等待启动", value: 11, text: "11 台", tone: "neutral" },
 *   { key: "stopped", label: "已停用", value: 6, text: "6 台", tone: "done", onSelect: () => setFilter("stopped") },
 *   { key: "other", label: "其他", value: 9, text: "9 台", tone: "role-other" },
 * ]} />
 *
 * - 带 onSelect 的类能点：段和图例是同一个动作。Tab 只停在图例按钮上（aria-pressed 标当前选中），段是鼠标的捷径，不多占一个焦点。
 * - selectedKey 是当前选中的类：图例那一项选中底加勾，条上那一段加高。不只靠颜色。
 * - 只有一类不是 0 时不画单色长条，写「全部为运行中」，图例照旧。全是 0 时不画，写 emptyText。
 * - 各类的数、它们和总数对不对得上由页面核对：对不上时页面传 state="failed" 或不渲染。出现负数不画，写 invalidText。
 * - 段的颜色传状态色或角色色；几类灰（neutral、done、role-other）靠深浅分，名字都写在图例里。条最宽 560。
 */
import { useState } from "react";
import { Check } from "lucide-react";
import { SegmentBar, type ChartSlot } from "./chart";
import { graphicNote, isAmount, type GraphicStateProps } from "./graphic-state";
import type { RoleTone, StateTone } from "./tone";

const SLOT: Record<RoleTone, ChartSlot> = { "role-1": 1, "role-2": 2, "role-3": 3, "role-4": 4, "role-other": "other" };

export function StatusDistributionBar({ label, segments, selectedKey, ...status }: {
  label: string;
  segments: readonly { key: string; label: string; value: number; /** 这一类的数带单位，比如「9 台」。 */ text: string; tone: StateTone | RoleTone; onSelect?: () => void }[];
  selectedKey?: string | null;
} & GraphicStateProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const filled = segments.filter((segment) => segment.value > 0);
  const empty = status.state === "ready" || status.state === undefined ? filled.length === 0 : false;
  const note = graphicNote(empty ? { ...status, state: "empty" } : status, segments.some((segment) => !isAmount(segment.value)));
  if (note !== undefined) return note;
  if (status.state === "loading") return <span className="rd-skeleton rd-dist-skeleton" aria-hidden />;

  const legend = (
    <ul className="rd-dist-legend" aria-label={label}>
      {segments.map((segment) => {
        const selected = segment.key === selectedKey;
        const swatch = segment.tone in SLOT ? <span className="rd-chart-swatch" data-slot={SLOT[segment.tone as RoleTone]} aria-hidden /> : <span className="rd-chart-swatch" data-tone={segment.tone} aria-hidden />;
        const body = <>{swatch}<span>{segment.label}</span><b>{segment.text}</b>{selected && <Check size={12} strokeWidth={2.4} aria-hidden />}</>;
        return (
          <li key={segment.key}>
            {segment.onSelect
              ? (
                <button
                  type="button"
                  className="rd-dist-item"
                  aria-pressed={selected}
                  data-zero={segment.value > 0 ? undefined : ""}
                  onClick={segment.onSelect}
                  onPointerEnter={() => setActiveKey(segment.key)}
                  onPointerLeave={() => setActiveKey(null)}
                  onFocus={() => setActiveKey(segment.key)}
                  onBlur={() => setActiveKey(null)}
                >
                  {body}
                </button>
              )
              : <span className="rd-dist-item" data-zero={segment.value > 0 ? undefined : ""}>{body}</span>}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="rd-dist">
      {filled.length === 1
        ? <><p className="rd-dist-sole">全部为{filled[0].label}</p>{legend}</>
        : (
          <SegmentBar
            quiet
            label={label}
            legend={legend}
            selectedKey={selectedKey}
            activeKey={activeKey}
            segments={segments.map((segment) => ({
              key: segment.key, label: segment.label, value: segment.value, text: `${segment.label} ${segment.text}`, onSelect: segment.onSelect,
              ...(segment.tone in SLOT ? { slot: SLOT[segment.tone as RoleTone] } : { tone: segment.tone as StateTone }),
            }))}
          />
        )}
    </div>
  );
}
