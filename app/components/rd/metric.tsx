/**
 * MetricBoard、MetricCard 经营卡（CP-40 的看板变体）。一屏要并排看 4 个以上、每个都带对比和分项时用，
 * 少于这个用 StatBand。目前只有今日概览用，产品批准了它放六张（PG-41）。
 *
 * <MetricBoard title="经营数据" explain="…" tools={<Segments … />} meta="截至 16:20 · 北京时间">
 *   <MetricCard label="入金总额" icon={ArrowDownToLine} tone="role-2" value="12,480.00" unit="USDT" compare="昨日全天 9,300.00 USDT"
 *     rows={[{ k: "笔数", v: "12 笔" }]} explain="算什么、不算什么。" href="/finance/recon" openLabel="查看充值与收款对账" />
 *   <MetricCard label="活跃用户" icon={Activity} tone="role-3" value="—" compare="只有今日数据" />
 *   <MetricCard label="销售额" value="" state="failed" onRetry={reload} />
 *   <MetricCard label="注册用户" value="" state="loading" />
 * </MetricBoard>
 *
 * - 一张卡四层：名称、主数、对比一行、最多三行分项。层高都是定的，分项不足三行也留位置，所以同排的卡同高、四层同一条线，切时段不跳版。
 * - 卡的颜色按 VS-12，值是 0 或「—」时弱化（字色弱、图标底灰）；分项里 0 也弱化。对比数不分好坏，不用红绿。
 * - 0、读不到、没权限分开：0 写 0；读不到传 state="failed" 和 onRetry，主数写「—」，对比行写「暂时读不到 · 重试」；没权限不渲染这张卡。
 * - state="loading" 时主数、对比和分项是占位条，高度和有数时一样。刷新时页面保留旧数，不要传 loading。
 * - 金额写完整数字，不折行。主数 13 个字符以上（8 位整数带小数）时，卡窄于 320 整组一起小一档，同组大小一致。
 * - 张数由子项决定：3、6 张三列；4 张够宽四列，不够两两一行；2 张两列。窄到放不下三列时两列。
 * - 整张可点传 href，openLabel 是读屏名字，目标页不可达时不传（X03）。问号和重试浮在上面，各点各的。
 * - 带 data-cp="stat"，首屏检查按它数。
 */
import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { InlineRetry } from "./block-state";
import { Explain } from "./explain";
import { IconTile } from "./icon-tile";
import type { RoleTone, StateTone } from "./tone";

/** 「—」、0、0.00、0 笔、0.00 USDT：不是要看的数。 */
const EMPTY = /^(?:[-–—]|[+-]?0(?:\.0+)?(?: .*)?)$/;
const empty = (value: ReactNode) => typeof value === "string" && EMPTY.test(value.trim());
/** 「12,345,678.90」起算长数字。 */
const LONG = 13;

export function MetricBoard({ title, explain, tools, meta, children }: {
  title: string;
  explain?: ReactNode;
  /** 标题旁的控件，比如切时段的 Segments。 */
  tools?: ReactNode;
  /** 贴右的小字，只放数据（时间、范围）。 */
  meta?: ReactNode;
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
      <div className="rd-metrics-grid">{children}</div>
    </section>
  );
}

export function MetricCard({ label, value, unit, compare, rows = [], tone, icon, explain, href, openLabel, state = "ready", onRetry }: {
  label: string;
  value: string;
  unit?: string;
  compare?: ReactNode;
  /** 最多三行。 */
  rows?: readonly { k: ReactNode; v: ReactNode; tone?: StateTone }[];
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
      </div>
      {state === "loading"
        ? <><div className="rd-metric-value"><span className="rd-skeleton" /></div><div className="rd-metric-compare"><span className="rd-skeleton" /></div></>
        : (
          <>
            <div className="rd-metric-value" data-tone={tone} data-zero={quiet ? "" : undefined} data-long={shown.length >= LONG ? "" : undefined}>
              {shown}{unit && shown !== "—" && <span className="rd-metric-unit">{unit}</span>}
            </div>
            <div className="rd-metric-compare">{state === "failed" ? <>暂时读不到{onRetry && <> · <InlineRetry onRetry={onRetry} /></>}</> : compare}</div>
          </>
        )}
      <dl className="rd-metric-rows">
        {state === "loading"
          ? <div className="rd-metric-row"><dt><span className="rd-skeleton" /></dt></div>
          : rows.map((row, index) => (
            <div className="rd-metric-row" key={index}>
              <dt>{row.k}</dt>
              <dd data-tone={row.tone} data-zero={empty(row.v) ? "" : undefined}>{row.v}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
