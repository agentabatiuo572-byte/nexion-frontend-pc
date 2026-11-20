/**
 * 小图形件共用的状态和取色：LevelStrip、RatioBar、ScaleBar、StatusDistributionBar、StepBar、StageLine 都按这一套。
 *
 * state：ready 画图；loading 画同尺寸的骨架；empty 不画，写 emptyText 那一句（没传就什么都不显示）；failed 不画，写 failedText。
 * 数不合法（负数、分子大于分母、区间反序、值在刻度外）时不画，写 invalidText：页面给原因，组件不把它夹成合法值。
 * tone：状态色、角色色、等级色阶三种。传角色色时图形用同槽位的图表色（VS-40），文字仍是文字色（VS-44）。
 */
import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import type { LevelTone, RoleTone, StateTone } from "./tone";

export type GraphicTone = StateTone | RoleTone | LevelTone;

export interface GraphicStateProps {
  state?: "ready" | "loading" | "empty" | "failed";
  /** 没有可画的数时写的一句话，比如「还没有任务」。 */
  emptyText?: ReactNode;
  /** 读不到时写的一句话，可以带 InlineRetry。 */
  failedText?: ReactNode;
  /** 数不合法时写的原因，比如「启用数大于总数，等后端核对」。 */
  invalidText?: ReactNode;
}

/** 该写一句话而不是画图时返回那句话（empty 没给文字时返回 null）；该画图或骨架时返回 undefined。 */
export function graphicNote({ state = "ready", emptyText, failedText = "读取失败", invalidText = "数据异常，没有画图" }: GraphicStateProps, invalid: boolean): ReactNode | undefined {
  if (state === "empty") return emptyText ? <span className="rd-gfx-note">{emptyText}</span> : null;
  if (state === "failed" || (state === "ready" && invalid)) {
    return (
      <span className="rd-gfx-note" data-kind="problem">
        <TriangleAlert size={13} strokeWidth={1.9} aria-hidden />
        <span>{state === "failed" ? failedText : invalidText}</span>
      </span>
    );
  }
  return undefined;
}

export const isAmount = (value: number) => Number.isFinite(value) && value >= 0;
