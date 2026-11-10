/**
 * LevelStrip 等级条。一排等宽的格，一格一个等级：选中的格实色、字前有勾，没选的格描边、字弱。
 * 颜色是等级色阶（tone.ts 的 level-*）：同一金色相由浅到深，只表示「第几级」，不表示收益高低。四格用四档，五格用五档，组件按格数取。
 * 看它能判断：这件东西属于、或者能用哪几级。
 *
 * <LevelStrip label="任务等级" selectedKeys={["L1", "L2"]}
 *   levels={[{ key: "L1", label: "L1", name: "初级" }, { key: "L2", label: "L2", name: "中级" }, { key: "L3", label: "L3", name: "高级" }, { key: "L4", label: "L4", name: "旗舰" }]} />
 * <LevelStrip variant="mini" quiet label="等级位置" levels={LEVELS} selectedKeys={["L3"]} />
 *
 * - label 是这张图的名字；读屏读「任务等级：L1 初级、L2 中级已选，L3 高级、L4 旗舰未选」。旁边已经写了同样的字（卡头的等级名）时传 quiet，图对读屏隐藏。
 * - 格里只写 label（L 号）；name 进读屏和悬停，条够宽（340px 起）时也写在 L 号后面。
 * - 一个都没选（selectedKeys=[]）是合法的：四格都描边，页面在旁边写「未配置任务等级」。selectedKeys 里有不认识的 key 是数据问题，不画，写 invalidText。
 * - mini 只画小格不写字，给卡头用，等级名必须写在旁边。
 */
import { Check } from "lucide-react";
import { graphicNote, type GraphicStateProps } from "./graphic-state";
import { levelTone } from "./tone";

export interface Level { key: string; label: string; name?: string }

export function LevelStrip({ label, levels, selectedKeys, variant = "strip", quiet, ...status }: {
  label: string;
  levels: readonly Level[];
  selectedKeys: readonly string[];
  variant?: "strip" | "mini";
  /** 旁边的文字已经写了同样的内容：图对读屏隐藏。 */
  quiet?: boolean;
} & GraphicStateProps) {
  const note = graphicNote(status, selectedKeys.some((key) => !levels.some((level) => level.key === key)));
  if (note !== undefined) return note;
  const mini = variant === "mini";
  if (status.state === "loading") return <span className="rd-skeleton rd-levelstrip-skeleton" data-variant={variant} aria-hidden />;
  const full = (level: Level) => level.name ? `${level.label} ${level.name}` : level.label;
  const on = levels.filter((level) => selectedKeys.includes(level.key));
  const off = levels.filter((level) => !selectedKeys.includes(level.key));
  const sentence = `${label}：${[on.length ? `${on.map(full).join("、")}已选` : "", off.length ? `${off.map(full).join("、")}未选` : ""].filter(Boolean).join("，")}`;
  return (
    <span className="rd-levelstrip" data-variant={variant} data-levels={levels.length} role={quiet ? undefined : "img"} aria-label={quiet ? undefined : sentence} aria-hidden={quiet ? true : undefined} title={mini ? sentence : undefined}>
      {levels.map((level, index) => {
        const selected = selectedKeys.includes(level.key);
        return (
          <span key={level.key} className="rd-levelstrip-cell" data-on={selected ? "" : undefined} data-fill={levelTone(index)} title={mini ? undefined : `${full(level)}：${selected ? "已选" : "未选"}`}>
            <i />
            {!mini && (
              <span className="rd-levelstrip-text">
                {selected && <Check size={12} strokeWidth={2.4} aria-hidden />}
                {level.label}
                {level.name && <span className="rd-levelstrip-name">{level.name}</span>}
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
