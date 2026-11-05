/**
 * Steps 流程进度（CP-47）。只读，从现有状态字段取当前步，不新增状态。
 *
 * <Steps label="订单进度" items={[
 *   { label: "已下单", state: "done" },
 *   { label: "已支付", state: "current" },
 *   { label: "开通中", state: "todo", sub: "3 单" },
 * ]} />
 *
 * - 当前步带 aria-current="step"，读屏按列表读。
 * - 只给有先后依赖、三步以上的流程。能切换的填写步骤不用它。
 */
import type { ReactNode } from "react";
import { Check } from "lucide-react";

export function Steps({ label, items }: { label: string; items: readonly { label: ReactNode; sub?: ReactNode; state: "done" | "current" | "todo" }[] }) {
  return (
    <ol className="rd-steps" aria-label={label}>
      {items.map((item, index) => (
        <li key={index} className="rd-step" data-state={item.state} aria-current={item.state === "current" ? "step" : undefined}>
          <span className="rd-step-mark">{item.state === "done" ? <Check size={13} strokeWidth={2.4} aria-hidden /> : index + 1}</span>
          <span className="rd-step-label">{item.label}</span>
          {item.sub !== undefined && <span className="rd-step-sub">{item.sub}</span>}
        </li>
      ))}
    </ol>
  );
}
