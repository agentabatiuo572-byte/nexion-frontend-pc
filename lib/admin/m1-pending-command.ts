export type M1CommandKind = "config" | "rebalance";

export type M1PendingCommand = {
  kind: M1CommandKind;
  key: string;
  value: string;
  action: string;
  reason: string;
};

function commandNonce(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Keeps one logical M1 write byte-for-byte stable until the server confirms it.
 * This key identifies a logical modal slot, not the HTTP Idempotency-Key.
 * On reopening, m-view's persistent mCommands store reuses the HTTP key for the
 * same full value/reason; a newly reviewed version is a different input.
 */
export function createM1PendingCommand(
  kind: M1CommandKind,
  value: string,
  action: string,
  reason: string,
  nonce = commandNonce(),
): M1PendingCommand {
  return { kind, key: `m1-load-${kind}-${nonce}`, value, action, reason };
}

export function commandForM1Retry(
  pending: M1PendingCommand | null,
  kind: M1CommandKind,
  next: () => M1PendingCommand | null,
): M1PendingCommand | null {
  if (pending) return pending.kind === kind ? pending : null;
  return next();
}
