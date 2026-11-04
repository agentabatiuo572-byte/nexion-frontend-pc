/**
 * Notice 内联提示（CP-71）。写在页面、抽屉、弹窗里，要人看到或处理的事。一切正常时不要用（DP-05）。
 *
 * <Notice tone="danger" title="提现单加载失败" action={<Button size="sm" onClick={retry}>重试</Button>}>原因和后果</Notice>
 * <Notice tone="warn">这笔放行结果未确认，不要重新放行。</Notice>
 *
 * danger 走 role=alert，其余 role=status。普通说明不用它，放「这页怎么用」或字段旁（DP-17）。
 */
import type { ReactNode } from "react";
import { AlertTriangle, CircleDashed, Info, ShieldAlert, type LucideIcon } from "lucide-react";
import type { StateTone } from "./tone";

const ICON: Record<StateTone, LucideIcon> = { ok: Info, warn: AlertTriangle, danger: ShieldAlert, progress: CircleDashed, done: Info };

export function Notice({ tone, title, action, children }: { tone: StateTone; title?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  const Icon = ICON[tone];
  return (
    <div className="rd-notice" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      <Icon size={16} strokeWidth={1.9} aria-hidden />
      <div className="rd-notice-text">
        {title && <div className="rd-notice-title">{title}</div>}
        {children}
      </div>
      {action && <div className="rd-notice-action">{action}</div>}
    </div>
  );
}
