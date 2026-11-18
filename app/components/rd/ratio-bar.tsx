/**
 * RatioBar 比例条。一个数占另一个数的多少：8px 细条，主段上色、剩下的是灰底，中间 2px 缝（VS-46）。
 * 看它能判断：一部分占整体的多少，是大半还是一点点。
 *
 * <RatioBar label="启用占比" value={12} total={20} valueText="启用 12 个，共 20 个" tone="role-2" />
 * <RatioBar label="已售和剩余" value={sold} total={sold + stock} valueText="已售 38 件，剩余 62 件" tone="role-2" />
 * <RatioBar label="命中里被拦截的占比" value={held} total={flagged} valueText="命中 40 次，拦截 6 次" tone="warn" />
 * <RatioBar steps label="这位用户的激活名额" value={3} total={6} valueText="已激活 3 台，上限 6 台（含手机）" />
 * <RatioBar compact label="当前任务的时间位置" value={elapsed} total={duration} valueText="已过 23 分钟，共 45 分钟" tone="progress" />
 *
 * - 条上不写数：数字写在旁边（Stat 的值、表格的字），valueText 是同一组数的一句话，给读屏和悬停用。旁边的字已经读得出这组数时传 quiet。
 * - value 是 0 时不画主段，没有最小宽度；value 等于 total 时整条上色。
 * - steps：画 total 个点，value 个实点、其余空心点，给「n/6」这种个数用；value、total 要是整数。
 * - compact：64×6，放在表格一格的第二行，和旁边的辅助字一行。
 * - total 是 0（0/0）没有比例可画：页面传 state="empty" 加一句话。负数、value 大于 total 不画，写 invalidText，不夹成满格。
 */
import { graphicNote, isAmount, type GraphicStateProps, type GraphicTone } from "./graphic-state";

export function RatioBar({ label, value, total, valueText, tone = "role-2", steps, compact, quiet, ...status }: {
  label: string;
  /** 分子。 */
  value: number;
  /** 分母。 */
  total: number;
  /** 这组数的一句话，比如「启用 12 个，共 20 个」。 */
  valueText: string;
  tone?: GraphicTone;
  steps?: boolean;
  compact?: boolean;
  quiet?: boolean;
} & GraphicStateProps) {
  const invalid = !isAmount(value) || !isAmount(total) || total === 0 || value > total || (Boolean(steps) && !(Number.isInteger(value) && Number.isInteger(total)));
  const note = graphicNote(status, invalid);
  if (note !== undefined) return note;
  const size = compact ? "compact" : undefined;
  if (status.state === "loading") return <span className="rd-skeleton rd-ratio-skeleton" data-size={size} data-steps={steps ? "" : undefined} aria-hidden />;
  const sentence = `${label}：${valueText}`;
  const a11y = quiet ? { "aria-hidden": true as const } : { role: "img", "aria-label": sentence };
  if (steps) {
    return (
      <span className="rd-ratio-dots" data-fill={tone} title={sentence} {...a11y}>
        {Array.from({ length: total }, (_, index) => <i key={index} data-on={index < value ? "" : undefined} />)}
      </span>
    );
  }
  return (
    <span className="rd-ratio" data-fill={tone} data-size={size} title={sentence} {...a11y}>
      {value > 0 && <i className="rd-ratio-main" style={{ flexGrow: value }} />}
      {value < total && <i className="rd-ratio-rest" style={{ flexGrow: total - value }} />}
    </span>
  );
}
