/**
 * BlockState 区块状态（CP-72）、Notice 页内提示（CP-70、CP-71）。
 *
 * <BlockState state="loading" title="正在读取到期预测…" />
 * <BlockState state="error" title="资金流历史暂不可用" detail={error} onRetry={reload} />
 * <BlockState state="empty" title="未来 7 天没有到期" />
 * <BlockState state="denied" title="无权限访问" detail="这个账号没有这块内容的读取权限。" />
 *
 * 失败和空不共用文字（T09）。重试只重读这一块。失败带 data-module-health-state="error"。compact 时一行写完，用在折叠摘要里，重试是文字链，和 InlineRetry 同一个样子。
 *
 * <Notice tone="progress" title="待生效 v3" action={<Button size="sm">刷新</Button>}>明天 08:00 起生效。</Notice>
 * tone 是状态色，图标由 tone 决定。待处理、结果未知这类不能收起的内容放这里（DP-03）。
 */
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Info, Loader2, ShieldAlert, type LucideIcon } from "lucide-react";
import { Button } from "./button";
import type { StateTone } from "./tone";

export function BlockState({ state, title, detail, onRetry, retrying, retryLabel = "重试", compact }: {
  state: "loading" | "error" | "empty" | "denied";
  title: ReactNode;
  detail?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  retryLabel?: string;
  /** 一行写完：折叠摘要里的读取失败用这个，不占一整块。 */
  compact?: boolean;
}) {
  const failed = state === "error";
  return (
    <div className="rd-block-state" data-state={state} data-compact={compact ? "" : undefined} data-module-health-state={failed ? "error" : undefined} role={failed ? "alert" : "status"}>
      {state === "loading" && <Loader2 className="rd-spin" size={16} aria-hidden />}
      <div className="rd-block-state-title">{title}</div>
      {detail && <div className="rd-block-state-detail">{detail}</div>}
      {onRetry && (compact ? <InlineRetry onRetry={onRetry} retrying={retrying} label={retryLabel} /> : <Button size="sm" loading={retrying} onClick={onRetry}>{retryLabel}</Button>)}
    </div>
  );
}

/** 一个数字或一行读不到时用这个，其他内容不受影响。 */
export function InlineRetry({ onRetry, retrying, label = "重试" }: { onRetry: () => void; retrying?: boolean; label?: string }) {
  return <button type="button" className="rd-inline-retry" disabled={retrying} onClick={onRetry}>{label}</button>;
}

const NOTICE_ICON: Record<StateTone, LucideIcon> = { ok: CheckCircle2, warn: AlertTriangle, danger: ShieldAlert, progress: Clock3, done: Info, neutral: Info };

export function Notice({ tone, title, action, children }: { tone: StateTone; title?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  const Icon = NOTICE_ICON[tone];
  return (
    <div className="rd-notice" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      <Icon className="rd-notice-icon" size={16} strokeWidth={1.9} aria-hidden />
      <div className="rd-notice-text">
        {title && <div className="rd-notice-title">{title}</div>}
        {children}
      </div>
      {action && <div className="rd-notice-action">{action}</div>}
    </div>
  );
}
