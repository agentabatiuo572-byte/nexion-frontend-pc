/**
 * BatchBar 批量操作条（CP-37）。放在表格正上方，有勾选或选了批量动作才渲染（PG-44）。
 *
 * <BatchBar summary="已勾选 3 笔 · 可执行 2 笔" hint="不符合这个操作的提现单不会被提交">
 *   <Button variant="primary" onClick={…}>批量执行</Button>
 * </BatchBar>
 *
 * summary 写已选和可执行两个数（OP-102），aria-live 读得到变化。hint 是说明，收进数字旁的提示图标（DP-06）。
 * 选择范围、提交和逐项结果都由页面做。
 */
import type { ReactNode } from "react";
import { Explain } from "./explain";

export function BatchBar({ summary, hint, children }: { summary: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="rd-batch">
      <span className="rd-batch-count" role="status" aria-live="polite">{summary}</span>
      {hint && <Explain label="批量操作的说明" content={hint} />}
      {children && <span className="rd-batch-actions">{children}</span>}
    </div>
  );
}
