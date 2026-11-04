/**
 * BlockState 区块状态（CP-72）。一块内容读取中、失败、空，只替换这一块（T09、ST-30）。
 *
 * <BlockState loading />
 * <BlockState title="资金明细加载失败" error={message} onRetry={reload} />
 * <BlockState empty="近 8 天没有资金进出" />
 *
 * - 失败、空、0 不共用文字。错误卡是标题、原因、「重试」三样（ST-34、ST-35）。
 * - 一个数字或一行读不到时用 InlineRetry，其他内容不受影响。
 */
import type { ReactNode } from "react";
import { Button } from "./button";

export function BlockState({ loading, title, error, empty, onRetry, retrying }: {
  loading?: boolean;
  title?: ReactNode;
  error?: ReactNode;
  empty?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  if (error) {
    return (
      <div className="rd-block" role="alert" data-state="error">
        <span className="rd-block-title">{title}</span>
        <span className="rd-block-reason">{error}</span>
        {onRetry && <span className="rd-block-actions"><Button size="sm" loading={retrying} onClick={onRetry}>重试</Button></span>}
      </div>
    );
  }
  if (loading) {
    return (
      <div className="rd-block-loading" role="status" aria-label="正在加载…">
        <span className="rd-skeleton" />
        <span className="rd-skeleton" />
        <span className="rd-skeleton" />
      </div>
    );
  }
  return <div className="rd-block" data-state="empty">{empty}</div>;
}

export function InlineRetry({ onRetry }: { onRetry: () => void }) {
  return <button type="button" className="rd-inline-retry" onClick={onRetry}>重试</button>;
}
