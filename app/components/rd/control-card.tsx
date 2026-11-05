/**
 * ControlGrid、ControlCard 应急页的业务卡（PG-48）。一张卡一项业务：名称、当前状态、勾选和动作。
 *
 * <ControlGrid label="业务开关">
 *   <ControlCard title="提现开关" icon={Landmark} tone="warn"
 *     explain={[{ k: "控制", v: "提现申请和链上转账" }, { k: "操作后果", v: "确认后立即生效" }]}
 *     status={<StatusTag tone="warn">已关停</StatusTag>}
 *     select={<Checkbox … />}
 *     action={<Button>恢复</Button>} />
 * </ControlGrid>
 *
 * - 卡上只放名称、状态和动作，说明和后果传 explain，收进名称旁的提示图标（DP-06）。
 * - tone 是这项现在的状态；attention 时卡片用这个状态的浅底，只给要人处理的卡（DP-05）。
 * - 没有修改权限时 action 不传（OP-124）。紧急动作和恢复入口不收进折叠组（PG-48）。
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Explain, type ExplainRow } from "./explain";
import { IconTile } from "./icon-tile";
import type { StateTone } from "./tone";

export function ControlGrid({ label, children }: { label: string; children: ReactNode }) {
  return <div className="rd-control-grid" role="group" aria-label={label}>{children}</div>;
}

export function ControlCard({ title, icon, tone, attention, explain, status, select, action }: {
  title: string;
  icon: LucideIcon;
  tone: StateTone;
  attention?: boolean;
  explain?: readonly ExplainRow[];
  status: ReactNode;
  select?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rd-control-card" data-tone={tone} data-attention={attention ? "" : undefined}>
      <div className="rd-control-head">
        <IconTile tone={tone} icon={icon} size={28} />
        <h2 className="rd-control-title">{title}{explain && <> <Explain label={`${title}的说明`} rows={explain} /></>}</h2>
        {select}
      </div>
      <div className="rd-control-status">{status}</div>
      {action && <div className="rd-control-foot">{action}</div>}
    </section>
  );
}
