"use client";

/**
 * 待处理：每行一件事和一个入口。只跳转，不在这里审批（PG-41、B0-L05）。放在「今天」面板里，结论句是它的头。
 * 两列排，让经营数据留在首屏；只有一行时占满。标题行右边放资金安全那句话（aside）。
 * 数量为 0 的行不显示；读不到的行写失败和重试，不当 0（B0-S06）；最多 5 行，其余写在下面一行，不折叠（DP-03）。
 */
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { Headset, ListChecks, Server, ShieldAlert, ShieldCheck, Wallet, type LucideIcon } from "lucide-react";
import { InlineRetry, Panel, TodoFailed, TodoItem, TodoList, type DomainTone, type StateTone } from "@/app/components/rd";

export type PendingRow = {
  key: string;
  title: string;
  sub?: ReactNode;
  /** 标题前的状态图标：只给紧急的一行（风控合成行里有紧急的一类时）。 */
  icon?: LucideIcon;
  owner: "财务" | "风控" | "客服" | "设备" | "内容" | "增长" | "审计" | "其他";
  /** 目标页不可达时不传：照样提醒，不能点（X03）。 */
  href?: string;
  tone?: StateTone;
};

export type PendingFailure = { key: string; name: string; onRetry: () => void };

const OWNER: Record<PendingRow["owner"], { icon?: LucideIcon; tone?: DomainTone }> = {
  财务: { icon: Wallet, tone: "money" },
  风控: { icon: ShieldCheck, tone: "risk" },  // 和侧栏「风控与反作弊」同一个图标
  客服: { icon: Headset, tone: "users" },
  设备: { icon: Server, tone: "devices" },
  内容: {},
  增长: {},
  审计: {},
  其他: {},
};

const LIMIT = 5;

/** 风控合成一行用的一类：严重度和后端给的标题（已换成运营叫法）。 */
export type RiskSummaryItem = { sev: "p0" | "p1" | "p2" | "p3"; title: string };

const SEV_RANK: Record<RiskSummaryItem["sev"], number> = { p0: 0, p1: 1, p2: 2, p3: 3 };

/**
 * 风控待处理合成一行（用户 2026-11-26 决定）：标题写有几类，第 6 行起只剩标题时也看得出量；
 * 副行按严重度从高到低列前三类（同级保持后端顺序），多出写「等 N 类」；颜色取最严重的一类，紧急标红加警告图标。
 * 副行折行时「·」放在下一行开头（V15）。
 */
export function riskSummaryRow(items: readonly RiskSummaryItem[], href: string | undefined): PendingRow | null {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev]);
  const shown = sorted.slice(0, 3);
  const rest = sorted.length - shown.length;
  const parts = [...shown.map((item) => item.title), ...(rest > 0 ? [`等 ${rest} 类`] : [])];
  const urgent = sorted[0].sev === "p0";
  return {
    key: "risk",
    title: `风控待处理 ${sorted.length} 类`,
    sub: <span className="cc-risk-parts">{parts.map((part, index) => <Fragment key={part}>{index > 0 && " "}<span className="cc-risk-part">{index > 0 && "· "}{part}</span></Fragment>)}</span>,
    owner: "风控",
    href,
    tone: urgent ? "danger" : sorted[0].sev === "p1" && sorted.length > 1 ? "warn" : undefined,  // 只有一类、最严重是 p1 时不标色（画板 v2-b1-now-single）
    icon: urgent ? ShieldAlert : undefined,
  };
}

export function PendingPanel({ rows, failures, loading, aside }: { rows: readonly (PendingRow | PendingFailure)[]; failures: number; loading: boolean; aside?: ReactNode }) {
  const shown = rows.slice(0, LIMIT);
  const rest = rows.slice(LIMIT);
  const isFailure = (row: PendingRow | PendingFailure): row is PendingFailure => "onRetry" in row;
  return (
    <Panel plain title="待处理" icon={ListChecks} tone="role-other" className="cc-pending" aria-busy={loading || undefined} sub={failures > 0 ? "部分来源读取失败，数量可能不全" : undefined} actions={aside}>
      <TodoList label="待处理">
        {shown.map((row) => isFailure(row)
          ? <TodoFailed key={row.key} title={`${row.name}读取失败`} onRetry={row.onRetry} />
          : <TodoItem key={row.key} href={row.href} title={row.icon ? <><row.icon className="cc-pending-icon" size={14} strokeWidth={1.9} aria-hidden />{row.title}</> : row.title} sub={row.sub} tone={row.tone} owner={row.owner} ownerIcon={OWNER[row.owner].icon} ownerTone={OWNER[row.owner].tone} />)}
      </TodoList>
      {loading && <div className="rd-block-loading" role="status" aria-label="正在加载…"><span className="rd-skeleton" /></div>}
      {rest.length > 0 && (
        <p className="cc-pending-rest">
          其余 {rest.length} 项：
          {rest.map((row, index) => (
            <Fragment key={row.key}>
              {index > 0 && "、"}
              {isFailure(row) ? <>{row.name}读取失败 · <InlineRetry label={`重试读取${row.name}`} onRetry={row.onRetry} /></> : row.href ? <Link href={row.href} prefetch={false}>{row.title}</Link> : row.title}
            </Fragment>
          ))}
        </p>
      )}
    </Panel>
  );
}
