/**
 * ControlGrid、ControlCard 应急页的业务卡（PG-48）。一张卡一项业务：名称、当前状态、勾选和动作。
 *
 * <ControlGrid label="业务开关">
 *   <ControlCard title="提现开关" icon={Landmark} tone="warn"
 *     help={<Explain label="提现开关说明" content="控制什么、资金影响、点了会怎样" />}
 *     status={<StatusTag tone="warn">已关停</StatusTag>}
 *     select={<Checkbox … />}
 *     action={<Button>恢复</Button>} />
 * </ControlGrid>
 *
 * - 卡上只放名称、状态和动作，说明和后果放 help 气泡，图标紧挨名称（DP-06）。
 * - tone 是这项现在的状态；attention 时卡片用这个状态的浅底，只给要人处理的卡（DP-05）。
 * - 没有修改权限时 action 不传（OP-124）。紧急动作和恢复入口不收进折叠组（PG-48）。
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { IconTile } from "./icon-tile";
import type { StateTone } from "./tone";

export function ControlGrid({ label, children }: { label: string; children: ReactNode }) {
  return <div className="rd-control-grid" role="group" aria-label={label}>{children}</div>;
}

export function ControlCard({ title, icon, tone, attention, help, status, select, action }: {
  title: ReactNode;
  icon: LucideIcon;
  tone: StateTone;
  attention?: boolean;
  help?: ReactNode;
  status: ReactNode;
  select?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rd-control-card" data-tone={tone} data-attention={attention ? "" : undefined}>
      <div className="rd-control-head">
        <IconTile tone={tone} icon={icon} size={28} />
        <h2 className="rd-control-title">{title}{help && <> {help}</>}</h2>
        {select}
      </div>
      <div className="rd-control-status">{status}</div>
      {action && <div className="rd-control-foot">{action}</div>}
    </section>
  );
}
