/** Both health consumers keep the server text unless all three counts are present. */
export function eventBacklogMetric(metric: string, details: {
  backlogCount?: unknown;
  oldestSeconds?: unknown;
  auditLinkUnresolvedCount?: unknown;
}) {
  const { backlogCount, oldestSeconds, auditLinkUnresolvedCount } = details;
  if (typeof backlogCount !== "number" || !Number.isSafeInteger(backlogCount) || backlogCount < 0
    || typeof oldestSeconds !== "number" || !Number.isSafeInteger(oldestSeconds) || oldestSeconds < 0
    || typeof auditLinkUnresolvedCount !== "number" || !Number.isSafeInteger(auditLinkUnresolvedCount) || auditLinkUnresolvedCount < 0) return metric;
  const minutes = Math.floor(oldestSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const duration = oldestSeconds < 60 ? `${oldestSeconds} 秒`
    : oldestSeconds < 3600 ? `${minutes} 分钟`
      : `${hours} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ""}`;
  const backlog = backlogCount === 0 ? "没有积压" : `${backlogCount} 条在排队，最久等了 ${duration}`;
  return auditLinkUnresolvedCount > 0
    ? `${backlog} · ${auditLinkUnresolvedCount} 条用户画像事件对不上操作记录，请技术同事核对`
    : backlog;
}
