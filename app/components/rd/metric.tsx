/**
 * MetricBoard、MetricCard 经营卡（CP-40 的看板变体）。一屏要并排看 4 个以上、每个都带对比和分项时用，
 * 少于这个用 StatBand。目前只有今日概览用，产品批准了它放六张（PG-41）。
 *
 * <MetricBoard title="经营数据" explain="…" tools={<Segments … />} meta="11-02 至今 · 截至 16:20 · 北京时间" rows={3} long={isLong}>
 *   <MetricCard label="入金总额" icon={ArrowDownToLine} tone="role-2" value="12,480.00" unit="USDT" compare="昨日全天 9,300.00 USDT"
 *     rows={[{ k: "笔数", v: "12 笔" }]} explain="算什么、不算什么。" href="/finance/recon" openLabel="查看充值与收款对账" />
 *   <MetricCard label="净入金" value="+3,180.00" unit="USDT" compare="昨日全天 +900.00 USDT"
 *     bar={{ label: "今日入金和提现的比例", empty: "今天没有进出", items: [{ key: "in", label: "入金", value: 12480, slot: 2 }, { key: "out", label: "提现", value: 9300, slot: 4 }] }} />
 *   <MetricCard label="活跃用户" icon={Activity} value="—" compare="只有今日数据" />
 *   <MetricCard label="销售额" value="" state="failed" onRetry={reload} />
 *   <MetricCard label="注册用户" value="" state="loading" />
 * </MetricBoard>
 *
 * - 一张卡四层：名称、主数、对比一行、分项。层高都是定的；分项区按 MetricBoard 的 rows 留高，传这组卡各时段最多几行，
 *   所以同排的卡同高、四层同一条线，切时段不跳版。
 * - 分项是一组名称和值（rows），或一条比例条（bar）：回答「两样比，哪样多」，条下只写图例不写数字，数字在别的卡上（DP-61）。
 *   全是 0 时不画条，写 bar.empty。
 * - 卡的颜色按 VS-12，值是 0 或「—」时弱化（字色弱、图标底灰），两套主题都弱；分项里 0 也弱化。对比数不分好坏，不用红绿。
 * - 0、读不到、没权限分开：0 写 0；读不到传 state="failed" 和 onRetry，主数写「—」，对比行写「暂时读不到 · 重试」；没权限不渲染这张卡。
 * - state="loading" 时主数、对比和分项是占位条，高度和有数时一样。刷新时页面保留旧数，不要传 loading。
 * - 金额写完整数字，不折行、不缩字。这组卡任一时段有 13 个字符以上的主数（8 位整数带小数）时，页面给 MetricBoard 传 long，
 *   放不下三列就两列（VS-65）；按所有时段定，切时段列数不变。
 * - 张数由子项决定：3、6 张三列；4 张够宽四列，不够两两一行；2 张两列。窄到放不下三列时两列。
 * - 整张可点传 href，名称行右边有箭头，悬停整张变亮；openLabel 是读屏名字，目标页不可达时不传（X03），也就没有箭头。
 *   问号和重试浮在上面，各点各的。
 * - 带 data-cp="stat"，首屏检查按它数。
 */
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { InlineRetry } from "./block-state";
import { SegmentBar, type ChartSlot } from "./chart";
import { Explain } from "./explain";
import { IconTile } from "./icon-tile";
import type { RoleTone, StateTone } from "./tone";

/** 「—」、0、0.00、0 笔、0.00 USDT：不是要看的数。 */
const EMPTY = /^(?:[-–—]|[+-]?0(?:\.0+)?(?: .*)?)$/;
const empty = (value: ReactNode) => typeof value === "string" && EMPTY.test(value.trim());
/** 「12,345,678.90」起算长数字，页面按它算 MetricBoard 的 long。 */
export const LONG = 13;

export function MetricBoard({ title, explain, tools, meta, rows = 3, long, children }: {
  title: string;
  explain?: ReactNode;
  /** 标题旁的控件，比如切时段的 Segments。 */
  tools?: ReactNode;
  /** 贴右的小字，只放数据（时间、范围）。 */
  meta?: ReactNode;
  /** 分项区留几行高：这组卡各时段最多几行。比例条算两行。 */
  rows?: number;
  /** 这组卡任一时段有长金额：窄时两列，切时段不变。 */
  long?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="rd-metrics" aria-label={title}>
      <div className="rd-metrics-head">
        <h2 className="rd-panel-title">{title}</h2>
        {explain && <Explain label={`${title}的说明`} content={explain} />}
        {tools}
        {meta && <span className="rd-metrics-meta">{meta}</span>}
      </div>
      <div className="rd-metrics-grid" data-long={long ? "" : undefined} style={{ "--rd-metric-rows": rows } as CSSProperties}>{children}</div>
    </section>
  );
}

export function MetricCard({ label, value, unit, compare, rows = [], bar, tone, icon, explain, href, openLabel, state = "ready", onRetry }: {
  label: string;
  value: string;
  unit?: string;
  compare?: ReactNode;
  /** 最多三行。 */
  rows?: readonly { k: ReactNode; v: ReactNode; tone?: StateTone }[];
  /** 比例条，传了就不看 rows。 */
  bar?: { label: string; empty: string; items: readonly { key: string; label: string; value: number; slot: ChartSlot }[] };
  tone?: RoleTone;
  icon?: LucideIcon;
  explain?: ReactNode;
  href?: string;
  openLabel?: string;
  state?: "ready" | "loading" | "failed";
  onRetry?: () => void;
}) {
  const shown = state === "ready" ? value : "—";
  const quiet = empty(shown);
  return (
    <div className="rd-metric" data-cp="stat" aria-busy={state === "loading" || undefined}>
      {href && <Link className="rd-metric-hit" href={href} prefetch={false} aria-label={openLabel} />}
      <div className="rd-metric-label">
        {icon && <IconTile tone={quiet ? "role-other" : tone ?? "role-other"} icon={icon} size={28} />}
        {label}
        {explain && <Explain label={`${label}怎么算`} content={explain} />}
        {href && <ChevronRight className="rd-metric-go" size={16} aria-hidden />}
      </div>
      {state === "loading"
        ? <><div className="rd-metric-value"><span className="rd-skeleton" /></div><div className="rd-metric-compare"><span className="rd-skeleton" /></div></>
        : (
          <>
            <div className="rd-metric-value" data-tone={tone} data-zero={quiet ? "" : undefined}>
              {shown}{unit && shown !== "—" && <span className="rd-metric-unit">{unit}</span>}
            </div>
            <div className="rd-metric-compare">{state === "failed" ? <>暂时读不到{onRetry && <> · <InlineRetry onRetry={onRetry} /></>}</> : compare}</div>
          </>
        )}
      {state === "loading"
        ? <div className="rd-metric-rows"><div className="rd-metric-row"><span className="rd-skeleton" /></div></div>
        : bar && state === "ready"
          ? (
            <div className="rd-metric-rows">
              {bar.items.some((item) => item.value > 0)
                ? <SegmentBar label={bar.label} segments={bar.items.map((item) => ({ ...item, text: item.label }))} />
                : <div className="rd-metric-row"><span className="rd-metric-note">{bar.empty}</span></div>}
            </div>
          )
          : (
            <dl className="rd-metric-rows">
              {rows.map((row, index) => (
                <div className="rd-metric-row" key={index}>
                  <dt>{row.k}</dt>
                  <dd data-tone={row.tone} data-zero={empty(row.v) ? "" : undefined}>{row.v}</dd>
                </div>
              ))}
            </dl>
          )}
    </div>
  );
}
