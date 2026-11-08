/**
 * Panel 面板（CP-24）。一块讲一件事，靠明暗和留白分组，不加描边，不套卡。
 *
 * <Panel title="储备组成" icon={PieChart} tone="role-1" actions={<Button size="sm">刷新</Button>}>…</Panel>
 * <Panel title="待审核提现" icon={FileText} tone="role-1" flush>…表格贴边…</Panel>
 * <Panel title="哪天要付的钱最多" sub="未来 7 天 · USDT" explain="UVT 锁仓要 24 个月后才到期，不在这张图里。">…</Panel>
 *
 * 标题旁的两种小字分清楚（DP-06）：sub 只放数据（范围、单位、数量、时间），常显；explain 放解释（这块是什么、
 * 怎么算、点一行会怎样），收进标题旁的提示图标，悬停或点击出气泡。
 * 标题级别默认 h2，嵌在别的区块里时传 headingLevel={3}。局部失败只替换面板里的内容（T09）。
 */
import type { HTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Explain } from "./explain";
import { IconTile } from "./icon-tile";
import type { RoleTone, StateTone } from "./tone";

export function Panel({ title, sub, explain, explainLabel, icon, tone = "role-other", actions, flush, plain, headingLevel = 2, children, className, ...rest }: Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title?: ReactNode;
  /** 数据型副标题：范围、单位、数量、时间。 */
  sub?: ReactNode;
  /** 解释性文字：收进标题旁的提示图标。 */
  explain?: ReactNode;
  /** title 不是纯文字时，给提示图标起读屏名字。 */
  explainLabel?: string;
  icon?: LucideIcon;
  tone?: RoleTone | StateTone;
  actions?: ReactNode;
  flush?: boolean;
  /** 不带自己的底和内边距：已经在一个面板里的分区用这个，面板不套面板（VS-72）。 */
  plain?: boolean;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section {...rest} className={className ? `rd-panel ${className}` : "rd-panel"} data-flush={flush ? "" : undefined} data-plain={plain ? "" : undefined}>
      {(title || actions) && (
        <div className="rd-panel-head">
          {icon && <IconTile tone={tone} icon={icon} />}
          {title && <Heading className="rd-panel-title">{title}</Heading>}
          {/* 气泡从问号左边起（和 Stat、ConfigRow 一样）：标题旁的问号离内容区左边近，居中展开会压进侧栏。 */}
          {explain && <Explain label={`${explainLabel ?? (typeof title === "string" ? title : "这一块")}的说明`} content={explain} align="start" />}
          {sub && <span className="rd-panel-sub">{sub}</span>}
          {actions && <div className="rd-panel-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
