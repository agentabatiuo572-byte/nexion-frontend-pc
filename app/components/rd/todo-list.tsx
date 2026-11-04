/**
 * TodoList、TodoItem 要处理的事（PG-41）。每行一件事和一个入口，整行跳业务页，不在这里处理。
 *
 * <TodoList label="待处理">
 *   <TodoItem href="/finance/withdrawals" title="待审核提现 4 单" owner="财务" ownerIcon={Wallet} ownerTone="money" />
 *   <TodoItem href="/overview/dual-ledger" tone="danger" title="覆盖率告警待确认" sub="跌破红线，还没人确认" owner="财务" />
 *   <TodoFailed title="待审批操作读取失败" onRetry={reload} />
 * </TodoList>
 *
 * - tone 只给告警和逾期，日常待办不上色（DP-22）。负责人的小图标按域色（VS-15）。
 * - 数量为 0 的行不要传进来。读不到时用 TodoFailed，不能当 0（T09）。
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { InlineRetry } from "./block-state";
import type { DomainTone, StateTone } from "./tone";

export function TodoList({ label, children }: { label: string; children: ReactNode }) {
  return <ul className="rd-todo" aria-label={label}>{children}</ul>;
}

export function TodoItem({ href, title, sub, owner, ownerIcon: OwnerIcon, ownerTone, tone }: {
  href: string;
  title: ReactNode;
  sub?: ReactNode;
  owner?: ReactNode;
  ownerIcon?: LucideIcon;
  ownerTone?: DomainTone;
  tone?: StateTone;
}) {
  return (
    <li className="rd-todo-item">
      <Link className="rd-todo-row" href={href} prefetch={false}>
        <span className="rd-todo-text" data-tone={tone}>
          <span className="rd-todo-title">{title}</span>
          {sub && <span className="rd-todo-sub">{sub}</span>}
        </span>
        {owner && <span className="rd-todo-owner" data-tone={ownerTone}>{OwnerIcon && <OwnerIcon size={14} strokeWidth={1.9} aria-hidden />}{owner}</span>}
        <ChevronRight className="rd-todo-chevron" size={16} aria-hidden />
      </Link>
    </li>
  );
}

export function TodoFailed({ title, onRetry }: { title: ReactNode; onRetry: () => void }) {
  return (
    <li className="rd-todo-item">
      <div className="rd-todo-row">
        <span className="rd-todo-text" data-tone="warn"><span className="rd-todo-title">{title}</span></span>
        <InlineRetry onRetry={onRetry} />
      </div>
    </li>
  );
}
