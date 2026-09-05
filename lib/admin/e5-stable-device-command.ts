// Explicit extension keeps this helper directly executable by node --test.
import { createSlotAttemptStore } from "./pending-mutation-store.ts";

export class E5OutcomeUncertainError extends Error {
  readonly commandKey: string;

  constructor(message: string, commandKey: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "E5OutcomeUncertainError";
    this.commandKey = commandKey;
  }
}

export function isE5OutcomeUncertainError(error: unknown): error is E5OutcomeUncertainError {
  return error instanceof E5OutcomeUncertainError
    || (error instanceof Error
      && error.name === "E5OutcomeUncertainError"
      && typeof (error as Error & { commandKey?: unknown }).commandKey === "string");
}

const commandAttempts = createSlotAttemptStore({ storageKey: "nexion-admin-e5-device-commands-v1" });

function mintCommandKey(slot: string): string {
  const prefix = slot.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 48) || "e5-device";
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `${prefix}-${Date.now()}-${random}`;
}

/** Keep the same key after an ambiguous response; retire it on convergence or a deterministic rejection. */
export async function e5StableDeviceCommand<T>(
  slot: string,
  inputFingerprint: string,
  request: (commandKey: string) => Promise<T>,
): Promise<T> {
  let mintedFresh = false;
  const commandKey = commandAttempts.resolve(slot, inputFingerprint, () => {
    mintedFresh = true;
    return mintCommandKey(slot);
  });
  try {
    const result = await request(commandKey);
    commandAttempts.forget(slot);
    return result;
  } catch (error) {
    // A deterministic rejection only proves that this fresh attempt had no
    // effect. If the key came from an earlier uncertain request, keep it until
    // a successful replay/readback converges that older outcome.
    if (mintedFresh && !isE5OutcomeUncertainError(error)) commandAttempts.forget(slot);
    throw error;
  }
}
