import type { SupportTicket } from "@/app/components/domain-views/m-tabs/data";

/**
 * M-33: the deadline that matters right now — first response until someone answers, then resolution.
 * "soon" leaves enough lead time to act: 30 minutes for a first response, 2 hours for resolution.
 */
export type TicketSla = { kind: "first" | "resolve"; due: number; state: "overdue" | "soon" | "ok" } | { state: "done" } | { state: "unknown" };

export function ticketSla(ticket: SupportTicket, now: number): TicketSla {
  if (ticket.status === "resolved" || ticket.status === "closed" || ticket.archived) return { state: "done" };
  // M-53: list rows and detail both carry the server-evaluated target; ruleVersion 0 means no published rule.
  const target = ticket.slaTarget?.ruleVersion ? ticket.slaTarget : null;
  if (!target) return { state: "unknown" };
  const kind = target.firstResponseAt ? "resolve" : "first";
  const due = kind === "first" ? target.firstResponseDeadlineAt : target.resolutionDeadlineAt;
  const lead = kind === "first" ? 30 * 60000 : 2 * 3600000;
  return { kind, due, state: now > due ? "overdue" : due - now <= lead ? "soon" : "ok" };
}

export function durationText(ms: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / 60000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} 小时${minutes % 60 ? ` ${minutes % 60} 分` : ""}`;
  return `${Math.floor(hours / 24)} 天`;
}

export function ticketSlaText(sla: TicketSla, now: number): string {
  if (sla.state === "done") return "已完成";
  if (sla.state === "unknown") return "时限未配置";
  const label = sla.kind === "first" ? "首响" : "解决";
  return sla.state === "overdue" ? `${label}已逾期 ${durationText(now - sla.due)}` : `${label}剩 ${durationText(sla.due - now)}`;
}

/** Overdue first, then the nearest deadline; finished tickets last. */
export function compareTicketSla(a: TicketSla, b: TicketSla): number {
  const rank = (sla: TicketSla) => sla.state === "done" ? 2 : sla.state === "unknown" ? 1 : 0;
  if (a.state === "done" || a.state === "unknown" || b.state === "done" || b.state === "unknown") return rank(a) - rank(b);
  return a.due - b.due;
}
