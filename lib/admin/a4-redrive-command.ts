import { createSlotAttemptStore } from "./pending-mutation-store.ts";

const redriveAttempts = createSlotAttemptStore({ storageKey: "nexion-admin-a4-redrive-attempts" });

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
  _previous: A4H3DeadOutboxRedriveCommand | null,
  snapshot: H3DeadOutboxRedriveSnapshot,
  reason: string,
  createCommandKey: () => string,
): A4H3DeadOutboxRedriveCommand {
  const normalizedReason = reason.trim();
  const input = JSON.stringify([snapshot.eventId, snapshot.retryCount, snapshot.deliveryStatus, snapshot.deliveryAttemptCount, normalizedReason]);
  const commandKey = redriveAttempts.resolve(`redrive:${snapshot.eventId}`, input, createCommandKey);
  return { ...snapshot, reason: normalizedReason, commandKey };
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
  const slot = `redrive:${snapshot.eventId}`;
  // The shared store is authoritative across reloads, operator changes and TTL expiry.
  // The React ref only exposes the current command to the confirmation view.
  const command = acquireH3DeadOutboxRedriveCommand(commandRef.current, snapshot, reason, createCommandKey);
  commandRef.current = command;
  const result = await submit(command);
  redriveAttempts.forget(slot);
  return result;
}
