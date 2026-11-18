"use client";

/**
 * ScaleBar 刻度条。一条线性的轴，值、区间、分界都按真实数值落在轴上。只读，不能拖。
 * 和别的尺的分别：InlineMeter 只管 0～1；ThresholdMeter 是读数和红线比，刻度会自己放大；TierBand 每档等宽，不是线性的。
 *
 * 一个值落在固定范围里（E2 平均时长，上限 120 分钟）。看它能判断：这组任务总体偏短还是偏长。
 * <ScaleBar label="平均时长" valueText="75.0 分钟，刻度 0 到 120 分钟" max={120} value={75}
 *   ticks={[{ value: 0, text: "0" }, { value: 60, text: "60" }, { value: 120, text: "120" }]} />
 *
 * 一个值对着一段区间（E5 已到账对预估区间）。看它能判断：到账落在预估区间的前面、里面还是后面。
 * <ScaleBar label="本月收益" valueText="已到账 312.40 USDT，预估 405.00 到 495.00 USDT" max={495} value={312.4} fill range={{ low: 405, high: 495 }} tone="role-2" />
 *   max 由页面取，要包住区间和值：到账超过区间上限就传 max={到账}，组件不截顶。
 *   四种情况一眼能分开：到账是 0，点是空心的；还没到区间，区间带是浅的；进了区间，带里走过的那一段是实色；超过上限，整段带是实色、点在带的右边。
 *   表格一格里传 compact：120 宽，点和带和大尺一样大，不写刻度字。
 *
 * 一个目标和它的波动范围（E1 月收益目标）。看它能判断：允许的波动有多宽。
 * <ScaleBar label="月收益目标" valueText="目标 450.00 USDT/月，范围 405.00 到 495.00" max={495} target={450} range={{ low: 405, high: 495 }} tone="neutral" />
 *   配置出来的边界用中性色：它是一把尺，不是一笔数据，也不和同一张卡里的等级金、库存青抢颜色。
 *
 * 几个分界把轴分成几段，最后一段没有上限（E6 档位分界）。看它能判断：分界在哪里，两个版本改了哪几档的界。
 * <ScaleBar label="档位分界" valueText="T1 低于 1.2；T2 1.2 到 2.5；T3 2.5 到 4.8；T4 4.8 到 8；T5 8 及以上" max={8}
 *   bands={{ labels: ["T1", "T2", "T3", "T4", "T5"], openEnd: true,
 *     marks: [{ value: 1.2, text: "1.2" }, { value: 2.5, text: "2.5" }, { value: 4.8, text: "4.8" }, { value: 8, text: "8" }] }} />
 *   段按等级色阶上色，四段、五段和 StepBar 的柱同色。两条轴要对着比（当前和预约）时传同一个 max。openEnd 的尾段是固定宽度的箭头，不按比例。
 *
 * - valueText 是图上这些数的一句话，读屏和悬停用；数字本身写在图旁边，图上只有刻度字。旁边的字已经读得出这些数时传 quiet。
 * - 刻度字都由页面按业务精度给（text），组件不格式化数字。刻度挨得太近时字往两边让、中间的换到第二行，再放不下就不写，完整的数在 valueText 里。
 * - value 传 null 是「没有值可标」，轴、区间、目标照画；整张图没有可画的数时传 state="empty"。
 * - 不合法就不画，写 invalidText：max 不大于 min、值或区间或刻度落在轴外、区间反序、分界不是从小到大。组件不夹值，也不替页面扩轴。
 */
import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { graphicNote, type GraphicStateProps, type GraphicTone } from "./graphic-state";
import { levelTone } from "./tone";

export interface ScaleTick { value: number; text: string }

/** 开放尾段的宽度，不按比例。 */
const TAIL = 40;
/** 两个刻度字之间至少隔这么多。 */
const GAP = 8;

/** 13px 的字大约多宽：数字和拉丁字母 8，标点 4.5，其余（中文）13。只用来排刻度字的位置。 */
function textWidth(text: string) {
  let width = 0;
  for (const char of text) width += /[0-9A-Za-z]/.test(char) ? 8 : /[\s.,:%+/–-]/.test(char) ? 4.5 : 13;
  return width;
}

/**
 * 排刻度字。平时居中写在刻度正下方，贴边的往里收。几个刻度挨得近、居中会叠在一起时：这一串的第一个字靠左写（字尾对着刻度），
 * 最后一个靠右写（字头对着刻度），中间的换到第二行、用引线接回刻度；还放不下，或者引线会穿过别的字，就不写（row 是 -1），完整的数在 valueText 里。
 */
function layoutLabels(marks: readonly { x: number; lead: number; text: string }[], width: number) {
  const sized = marks.map((mark) => ({ ...mark, size: textWidth(mark.text) }));
  const clamp = (start: number, size: number) => Math.min(Math.max(start, 0), Math.max(0, width - size));
  const centered = sized.map((mark) => clamp(mark.x - mark.size / 2, mark.size));
  const placed: { start: number; end: number; row: number }[] = [];
  const free = (start: number, end: number, row: number) => placed.every((item) => item.row !== row || start >= item.end + GAP || end <= item.start - GAP);
  const out: { x: number; lead: number; text: string; start: number; row: number }[] = [];
  let index = 0;
  while (index < sized.length) {
    let last = index;
    while (last + 1 < sized.length && centered[last + 1] < centered[last] + sized[last].size + GAP) last += 1;
    for (let at = index; at <= last; at += 1) {
      const mark = sized[at];
      const alone = index === last;
      const row = alone || at === index || at === last ? 0 : 1;
      const start = alone ? centered[at] : at === index ? clamp(mark.x + 1 - mark.size, mark.size) : row === 0 ? clamp(mark.x - 1, mark.size) : clamp(mark.x + 4, mark.size);
      const crossed = row === 1 && placed.some((item) => item.row === 0 && mark.x > item.start - 2 && mark.x < item.end + 2);
      const fits = !crossed && free(start, start + mark.size, row) && (row === 0 || start >= mark.x);
      if (fits) placed.push({ start, end: start + mark.size, row });
      out.push({ x: mark.x, lead: mark.lead, text: mark.text, start, row: fits ? row : -1 });
    }
    index = last + 1;
  }
  // 第二行的引线不能穿过后来才放上去的第一行的字。
  return out.map((label) => (label.row === 1 && placed.some((item) => item.row === 0 && label.x > item.start - 2 && label.x < item.end + 2) ? { ...label, row: -1 } : label));
}

/** 第一行的字紧跟刻度；换到第二行的字用一条引线接回它的刻度。 */
function TickLabels({ labels }: { labels: ReturnType<typeof layoutLabels> }) {
  const rows = Math.max(1, ...labels.map((label) => label.row + 1));
  return (
    <span className="rd-scale-ticks" style={{ "--rd-scale-rows": rows } as CSSProperties}>
      {labels.map((label, index) => (
        <Fragment key={index}>
          <i style={{ left: label.lead }} data-row={label.row} />
          {label.row >= 0 && <span style={{ left: label.start, "--rd-scale-row": label.row } as CSSProperties}>{label.text}</span>}
        </Fragment>
      ))}
    </span>
  );
}

export function ScaleBar({ label, valueText, min = 0, max, value, fill, range, target, ticks, bands, tone = "role-2", compact, quiet, ...status }: {
  label: string;
  /** 图上这些数的一句话，比如「75.0 分钟，刻度 0 到 120 分钟」。 */
  valueText: string;
  min?: number;
  max: number;
  /** 值点。 */
  value?: number | null;
  /** 从 min 到值点再画一条细线：值是从起点累出来的量（已到账）。值等于 min 时线没有长度，点画成空心。 */
  fill?: boolean;
  /** 区间带。low 等于 high 时画一条刻线。 */
  range?: { low: number; high: number };
  /** 目标刻线。 */
  target?: number;
  /** 轴下面写字的刻度。 */
  ticks?: readonly ScaleTick[];
  /** 分界：marks 把轴分成 labels 这几段（labels 比 marks 多一个）。 */
  bands?: { marks: readonly ScaleTick[]; labels: readonly string[]; openEnd?: boolean };
  tone?: GraphicTone;
  compact?: boolean;
  quiet?: boolean;
} & GraphicStateProps) {
  const span = max - min;
  const inside = (n: number) => Number.isFinite(n) && n >= min && n <= max;
  const invalid = !(Number.isFinite(span) && span > 0)
    || (value != null && !inside(value))
    || (range !== undefined && !(inside(range.low) && inside(range.high) && range.low <= range.high))
    || (target !== undefined && !inside(target))
    || Boolean(ticks?.some((tick) => !inside(tick.value)))
    || (bands !== undefined && (
      bands.labels.length !== bands.marks.length + 1
      || bands.marks.some((mark, index) => !inside(mark.value) || mark.value <= (index ? bands.marks[index - 1].value : min))
      || (!bands.openEnd && bands.marks[bands.marks.length - 1].value >= max)
    ));
  const plotted = (status.state === undefined || status.state === "ready") && !invalid;
  // 刻度字要按真实宽度排，画出来以后量一次，宽度变了再量。
  const ref = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [plotted]);
  const note = graphicNote(status, invalid);
  if (note !== undefined) return note;
  const size = compact ? "compact" : undefined;
  if (status.state === "loading") return <span className="rd-skeleton rd-scale-skeleton" data-size={size} data-bands={bands && !compact ? "" : undefined} aria-hidden />;

  const sentence = `${label}：${valueText}`;
  const a11y = quiet ? { "aria-hidden": true as const } : { role: "img", "aria-label": sentence };
  const at = (n: number) => (n - min) / span;
  const pct = (n: number) => `${at(n) * 100}%`;

  if (bands && !compact) {
    const tail = bands.openEnd ? TAIL : 0;
    const count = bands.labels.length;
    /** 每段的起止，占线性那部分的几分之几。 */
    const edges = [min, ...bands.marks.map((mark) => mark.value), max].map(at);
    const linear = `(100% - ${tail}px)`;
    const names = width === null ? [] : bands.labels.map((name, index) => {
      const start = (width - tail) * edges[index] + (index ? 1 : 0);
      const end = index === count - 1 ? width : (width - tail) * edges[index + 1] - 1;
      return { name, center: (start + end) / 2, fits: end - start >= textWidth(name) + 4 };
    });
    const labels = width === null ? [] : layoutLabels(bands.marks.map((mark) => ({ x: (width - tail) * at(mark.value), lead: (width - tail) * at(mark.value) - 0.5, text: mark.text })), width);
    return (
      <span className="rd-scale" data-bands="" data-levels={count} title={sentence} {...a11y}>
        <span className="rd-scale-names">
          {names.map((item, index) => item.fits && <span key={index} style={{ left: item.center }}>{item.name}</span>)}
        </span>
        <span className="rd-scale-segs" ref={ref}>
          {bands.labels.map((name, index) => {
            const last = index === count - 1;
            return (
              <i
                key={index}
                data-fill={levelTone(index)}
                data-open={last && bands.openEnd ? "" : undefined}
                style={{ left: `calc(${linear} * ${edges[index]} + ${index ? 1 : 0}px)`, right: last ? 0 : `calc(100% - ${linear} * ${edges[index + 1]} + 1px)` }}
              />
            );
          })}
        </span>
        {labels.length > 0 && <TickLabels labels={labels} />}
      </span>
    );
  }

  /** 宽 size 的刻线放在 n 上：轴两头的刻线整条留在轴里，不探出去半条。 */
  const edge = (n: number, size: number) => `calc(${at(n) * 100}% - ${at(n) * size}px)`;
  /** 带细线的值走进区间以后，区间里已经走过的那一段：到值为止，值超过上限就是整段。 */
  const covered = fill && range && value != null && range.high > range.low && value > range.low ? Math.min(value, range.high) : null;
  const labels = width === null || compact || !ticks ? [] : layoutLabels([...ticks].sort((a, b) => a.value - b.value).map((tick) => ({ x: width * at(tick.value), lead: (width - 1) * at(tick.value), text: tick.text })), width);
  return (
    <span className="rd-scale" data-fill={tone} data-size={size} title={sentence} {...a11y}>
      <span className="rd-scale-plot" ref={ref}>
        <i className="rd-scale-axis" />
        {!compact && ticks?.map((tick) => <i key={tick.value} className="rd-scale-tickmark" style={{ left: edge(tick.value, 1) }} />)}
        {range && (range.high > range.low
          ? <i className="rd-scale-band" style={{ left: pct(range.low), width: `${(at(range.high) - at(range.low)) * 100}%` }} />
          : <i className="rd-scale-target" style={{ left: edge(range.low, 2) }} />)}
        {covered !== null && <i className="rd-scale-cover" data-full={covered >= range!.high ? "" : undefined} style={{ left: pct(range!.low), width: `${(at(covered) - at(range!.low)) * 100}%` }} />}
        {fill && value != null && value > min && <i className="rd-scale-fill" style={{ width: pct(value) }} />}
        {target !== undefined && <i className="rd-scale-target" style={{ left: edge(target, 2) }} />}
        {value != null && <i className="rd-scale-dot" data-zero={fill && value === min ? "" : undefined} style={{ left: pct(value) }} />}
      </span>
      {labels.length > 0 && <TickLabels labels={labels} />}
    </span>
  );
}
