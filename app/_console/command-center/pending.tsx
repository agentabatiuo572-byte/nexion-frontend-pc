"use client";

/**
 * 待处理：每行一件事和一个入口。只跳转，不在这里审批（PG-41、B0-L05）。
 * 数量为 0 的行不显示；读不到的行写失败和重试，不当 0（B0-S06）；最多 5 行，其余写在下面一行，不折叠（DP-03）。
 */
import Link from "next/link";
import { Fragment } from "react";
import { Headset, ListChecks, ShieldAlert, Wallet, type LucideIcon } from "lucide-react";
import { Panel, TodoFailed, TodoItem, TodoList, type DomainTone, type StateTone } from "@/app/components/rd";

export type PendingRow = {
  key: string;
  title: string;
  sub?: string;
  owner: "财务" | "风控" | "客服" | "内容" | "增长" | "审计" | "其他";
  href: string;
  tone?: StateTone;
};

export type PendingFailure = { key: string; name: string; onRetry: () => void };

const OWNER: Record<PendingRow["owner"], { icon?: LucideIcon; tone?: DomainTone }> = {
  财务: { icon: Wallet, tone: "money" },
  风控: { icon: ShieldAlert, tone: "risk" },
  客服: { icon: Headset, tone: "users" },
  内容: {},
  增长: {},
  审计: {},
  其他: {},
};

const LIMIT = 5;

export function PendingPanel({ rows, failures, loading }: { rows: readonly (PendingRow | PendingFailure)[]; failures: number; loading: boolean }) {
  const shown = rows.slice(0, LIMIT);
  const rest = rows.slice(LIMIT);
  const isFailure = (row: PendingRow | PendingFailure): row is PendingFailure => "onRetry" in row;
  return (
    <Panel title="待处理" icon={ListChecks} tone="role-other" className="cc-pending" aria-busy={loading || undefined} sub={failures > 0 ? "部分来源读取失败，数量可能不全" : undefined}>
      <TodoList label="待处理">
        {shown.map((row) => isFailure(row)
          ? <TodoFailed key={row.key} title={`${row.name}读取失败`} onRetry={row.onRetry} />
          : <TodoItem key={row.key} href={row.href} title={row.title} sub={row.sub} tone={row.tone} owner={row.owner} ownerIcon={OWNER[row.owner].icon} ownerTone={OWNER[row.owner].tone} />)}
      </TodoList>
      {loading && <div className="rd-block-loading" role="status" aria-label="正在加载…"><span className="rd-skeleton" /></div>}
      {rest.length > 0 && (
        <p className="cc-pending-rest">
          其余 {rest.length} 项：
          {rest.map((row, index) => (
            <Fragment key={row.key}>
              {index > 0 && "、"}
              {isFailure(row) ? `${row.name}读取失败` : <Link href={row.href} prefetch={false}>{row.title}</Link>}
            </Fragment>
          ))}
        </p>
      )}
    </Panel>
  );
}
