/**
 * Panel 面板（CP-24）。一块讲一件事，靠明暗和留白分组，不加描边，不套卡。
 *
 * <Panel title="储备组成" icon={PieChart} tone="role-1" actions={<Button size="sm">刷新</Button>}>…</Panel>
 * <Panel title="待审核提现" icon={FileText} tone="role-1" flush>…表格贴边…</Panel>
 *
 * 标题级别默认 h2，嵌在别的区块里时传 headingLevel={3}。局部失败只替换面板里的内容（T09）。
 */
import type { HTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { IconTile } from "./icon-tile";
import type { RoleTone, StateTone } from "./tone";

export function Panel({ title, sub, icon, tone = "role-other", actions, flush, plain, headingLevel = 2, children, className, ...rest }: Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title?: ReactNode;
  sub?: ReactNode;
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
          {sub && <span className="rd-panel-sub">{sub}</span>}
          {actions && <div className="rd-panel-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
