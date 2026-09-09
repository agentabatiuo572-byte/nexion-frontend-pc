export type A4H3DeadOutboxRedriveCommand = {
  eventId: string;
  retryCount: number;
  deliveryStatus: "DEAD";
  deliveryAttemptCount: number;
  reason: string;
  commandKey: string;
};

type H3DeadOutboxRedriveSnapshot = Omit<A4H3DeadOutboxRedriveCommand, "reason" | "commandKey">;

/** Keeps an unknown-outcome retry stable for the same reviewed redrive command. */
export function acquireH3DeadOutboxRedriveCommand(
  previous: A4H3DeadOutboxRedriveCommand | null,
  snapshot: H3DeadOutboxRedriveSnapshot,
  reason: string,
  createCommandKey: () => string,
): A4H3DeadOutboxRedriveCommand {
  const normalizedReason = reason.trim();
  const sameTarget = previous?.eventId === snapshot.eventId
    && previous.retryCount === snapshot.retryCount
    && previous.deliveryStatus === snapshot.deliveryStatus
    && previous.deliveryAttemptCount === snapshot.deliveryAttemptCount
    && previous.reason === normalizedReason;
  return sameTarget
    ? { ...previous, reason: normalizedReason }
    : { ...snapshot, reason: normalizedReason, commandKey: createCommandKey() };
}


export type A4H3DeadOutboxRedriveCommandRef = {
  current: A4H3DeadOutboxRedriveCommand | null;
};

/**
 * Holds the full reviewed command outside a React render closure. A failed
 * confirmation callback can therefore retry the exact body/key, while a
 * changed reason or CAS snapshot gets a fresh command.
 */
export async function runH3DeadOutboxRedriveCommand<TResult>(
  commandRef: A4H3DeadOutboxRedriveCommandRef,
  snapshot: H3DeadOutboxRedriveSnapshot,
  reason: string,
  createCommandKey: () => string,
  submit: (command: A4H3DeadOutboxRedriveCommand) => Promise<TResult>,
): Promise<TResult> {
  const command = acquireH3DeadOutboxRedriveCommand(commandRef.current, snapshot, reason, createCommandKey);
  commandRef.current = command;
  return submit(command);
}
