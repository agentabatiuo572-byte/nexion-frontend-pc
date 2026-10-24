type CustomerConversation = {
  id: string; customerId?: string; status: string; lastTs: number; unread: number;
  archived?: boolean; pendingReplyCount?: number | null; pendingReplySince?: number | null;
};

/** Keep original IDs for receipts and commands while exposing one inbox row per customer. */
export function customerConversations<T extends CustomerConversation>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.customerId || row.id;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map(group => {
    const ordered = [...group].sort((a, b) => b.lastTs - a.lastTs || b.id.localeCompare(a.id));
    const current = ordered.find(row => row.status === "open") ?? ordered[0];
    const pendingTimes = group.flatMap(row => row.pendingReplyCount !== 0 && typeof row.pendingReplySince === "number" && Number.isFinite(row.pendingReplySince) ? [row.pendingReplySince] : []);
    return { ...current, archived: group.every(row=>row.archived===true), lastTs: ordered[0].lastTs,
      unread: group.reduce((sum, row) => sum + row.unread, 0),
      pendingReplyCount: group.every(row => typeof row.pendingReplyCount === "number") ? group.reduce((sum, row) => sum + row.pendingReplyCount!, 0) : null,
      pendingReplySince: pendingTimes.length ? Math.min(...pendingTimes) : null };
  }).sort((a, b) => b.lastTs - a.lastTs);
}

export function replyTimeout(since: number | null | undefined, now: number, warnMinutes: number, urgentMinutes: number): string {
  if (typeof since !== "number" || !Number.isFinite(since)) return "";
  const waited = (now - since) / 60000;
  return waited >= urgentMinutes ? "严重超时 · 待处理" : waited >= warnMinutes ? "已超时 · 待处理" : "";
}
