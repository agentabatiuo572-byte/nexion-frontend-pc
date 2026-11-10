/**
 * StepBar 阶梯条。一组由低到高的档，每档一张小卡加一根柱：柱从同一条零线起、用同一个高度域，值相等就一样高；柱按等级色阶由浅到深。
 * 看它能判断：档和档之间差多少，是均匀递增还是某一档跳得多。
 *
 * <StepBar label="五档每日收益" unit="USDT/天" items={tiers.map((tier) => ({
 *   key: tier.code, label: tier.code, name: tier.name, value: tier.baseRateUsdt, valueText: "0.36",
 *   secondary: "12.5 UVT/天", mark: tier.code === "T3" ? "当前引导档" : undefined,
 *   actions: canWrite && <><Button size="sm" onClick={…}>调 USDT</Button><Button size="sm" onClick={…}>调 UVT</Button></>,
 * }))} />
 *
 * - 柱高只看 value；valueText 是页面按业务精度写好的完整数字，组件不格式化、不舍入。secondary 是次要的数（另一个币种），不进柱高。
 * - mark 是这一档的标记文字（「当前引导档」）：卡加一圈描边、标题行写这几个字。它是标注，不是选中，不能点。
 * - actions 放这一档的按钮；没有权限时不传，这一行不占位。
 * - max 是这组柱共用的满高，默认取组里最大的值。两组要对着比时传同一个 max。
 * - 宽的时候排一行，窄了排三列（五档是 3+2），再窄两列；折行后每行仍用同一个高度域，不重新归一。任何一档的数字有 8 位以上时提早折成三列，数字不缩字、不折行。
 * - 读屏按列表逐档读：档名、数、单位、次要的数、标记。柱对读屏隐藏。
 * - loading 画同样几张卡的骨架（items 还没有时画 5 张）；出现负数或大于 max 的值不画，写 invalidText。值是 0 的档不画柱，数字弱化。
 */
import type { CSSProperties, ReactNode } from "react";
import { graphicNote, isAmount, type GraphicStateProps } from "./graphic-state";
import { levelTone } from "./tone";

/** 柱的满高，px。折行后每行都用它。 */
const FULL = 72;

export function StepBar({ label, items, unit, max, ...status }: {
  label: string;
  items: readonly { key: string; label: ReactNode; name?: ReactNode; value: number; valueText: string; secondary?: ReactNode; mark?: ReactNode; actions?: ReactNode }[];
  /** 主数值的单位，各档一样。 */
  unit?: ReactNode;
  max?: number;
} & GraphicStateProps) {
  const top = max ?? Math.max(0, ...items.map((item) => item.value));
  const note = graphicNote(status, items.some((item) => !isAmount(item.value) || item.value > top));
  if (note !== undefined) return note;
  const loading = status.state === "loading";
  const count = loading && !items.length ? 5 : items.length;
  const hasActions = !loading && items.some((item) => item.actions);
  const long = items.some((item) => item.valueText.length >= 8);
  if (loading) {
    return (
      <div className="rd-stepbar" aria-hidden>
        <div className="rd-stepbar-list" style={{ "--rd-stepbar-count": count } as CSSProperties}>
          {Array.from({ length: count }, (_, index) => (
            <div key={index} className="rd-stepbar-item">
              <div className="rd-stepbar-head"><span className="rd-skeleton" style={{ width: 56 }} /></div>
              <div className="rd-stepbar-body"><div className="rd-stepbar-figures"><span className="rd-skeleton" style={{ width: 88, height: 20 }} /><span className="rd-skeleton" style={{ width: 64, marginTop: 10 }} /></div></div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="rd-stepbar" data-levels={count} data-long={long ? "" : undefined} data-actions={hasActions ? "" : undefined}>
      <ol className="rd-stepbar-list" aria-label={label} style={{ "--rd-stepbar-count": count } as CSSProperties}>
        {items.map((item, index) => (
          <li key={item.key} className="rd-stepbar-item" data-marked={item.mark ? "" : undefined}>
            <div className="rd-stepbar-head">
              <b>{item.label}</b>
              {item.name && <span className="rd-stepbar-name">{item.name}</span>}
              {item.mark && <span className="rd-stepbar-mark">{item.mark}</span>}
            </div>
            <div className="rd-stepbar-body">
              <div className="rd-stepbar-figures">
                <div className="rd-stepbar-value" data-zero={item.value === 0 ? "" : undefined}>{item.valueText}{unit && <span className="rd-stepbar-unit">{unit}</span>}</div>
                {item.secondary && <div className="rd-stepbar-secondary">{item.secondary}</div>}
              </div>
              <span className="rd-stepbar-col" aria-hidden>
                {item.value > 0 && top > 0 && <i data-fill={levelTone(index)} style={{ height: Math.max(2, Math.round(item.value / top * FULL)) }} />}
              </span>
            </div>
            {hasActions && <div className="rd-stepbar-actions">{item.actions}</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}
