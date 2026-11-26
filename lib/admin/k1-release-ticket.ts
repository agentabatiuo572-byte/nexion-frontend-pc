export function parseK1ReleaseTicketBefore(before: string) {
  const match = /^收益 (.+?)；用户 (\d+)；(\S+) 净额 (\d+(?:\.\d+)?)；来源 ([^/；]+)\/(.*?)；(bonus_locked|pending_review) → withdrawable；当前覆盖率 (\d+(?:\.\d+)?)% \/ 红线 (\d+(?:\.\d+)?)%$/.exec(before.trim());
  if (!match) return undefined;
  const [, entryNo, userId, asset, net, source, sourceRef, bucket, coverage, redline] = match;
  return { entryNo, userId, asset, net, source, sourceRef, bucket, coverage, redline };
}
