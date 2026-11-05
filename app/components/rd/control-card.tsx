/**
 * ControlGrid、ControlCard 应急页的业务卡（PG-48）。一张卡一项业务：当前状态、勾选、关键说明、后果和动作。
 *
 * <ControlGrid label="业务开关">
 *   <ControlCard title="提现开关" icon={Landmark} tone="warn" attention
 *     status={<StatusTag tone="warn">已关停</StatusTag>}
 *     select={<Checkbox … />}
 *     meta={[{ k: "资金影响", v: "即时资金流出" }]}
 *     note="立即生效，提交时再查一次覆盖率"
 *     action={<Button>恢复</Button>}>
 *     提现申请、审核和链上转账
 *   </ControlCard>
 * </ControlGrid>
 *
 * - tone 是这项现在的状态；attention 时卡片用这个状态的浅底，正常的卡不上色（DP-05）。
 * - note 写点了会怎样，紧挨按钮（后果不能只写在「这页怎么用」里）。没有修改权限时 action 不传（OP-124）。
 * - 紧急动作和恢复入口不收进折叠组（PG-48）。
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { IconTile } from "./icon-tile";
import type { StateTone } from "./tone";

export function ControlGrid({ label, children }: { label: string; children: ReactNode }) {
  return <div className="rd-control-grid" role="group" aria-label={label}>{children}</div>;
}

export function ControlCard({ title, icon, tone, attention, status, select, meta, note, action, children }: {
  title: ReactNode;
  icon: LucideIcon;
  tone: StateTone;
  attention?: boolean;
  status: ReactNode;
  select?: ReactNode;
  meta?: readonly { k: string; v: ReactNode; title?: string }[];
  note?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="rd-control-card" data-tone={tone} data-attention={attention ? "" : undefined}>
      <div className="rd-control-head">
        <IconTile tone={tone} icon={icon} size={28} />
        <h2 className="rd-control-title">{title}</h2>
        {select}
      </div>
      <div className="rd-control-status">{status}</div>
      {children && <div className="rd-control-text">{children}</div>}
      {meta && meta.length > 0 && (
        <dl className="rd-control-meta">
          {meta.map((row) => <div key={row.k}><dt>{row.k}</dt><dd title={row.title}>{row.v}</dd></div>)}
        </dl>
      )}
      {(note || action) && (
        <div className="rd-control-foot">
          {note && <div className="rd-control-note">{note}</div>}
          {action}
        </div>
      )}
    </section>
  );
}
