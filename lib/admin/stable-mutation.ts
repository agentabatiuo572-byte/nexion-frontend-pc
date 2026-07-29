export type StableMutationCommand<T> = (commandKey: string) => Promise<T>;
export type StableMutationAccept<T, R> = (value: T) => R;
export type StableMutationFailureKind = "deterministic" | "outcome-unknown";

export class StableMutationFailure extends Error {
  readonly kind: StableMutationFailureKind;

  constructor(kind: StableMutationFailureKind, message: string) {
    super(message);
    this.name = "StableMutationFailure";
    this.kind = kind;
  }
}

export function classifyStableMutationFailure(error: unknown): StableMutationFailureKind {
  return error instanceof StableMutationFailure ? error.kind : "outcome-unknown";
}

export function stableMutationHttpFailure(
  message: string,
  status: number,
  apiCode?: number,
) {
  const isDeterministicRejection = (status >= 400 && status < 500)
    || (status >= 200 && status < 300 && typeof apiCode === "number" && apiCode !== 0);
  return new StableMutationFailure(
    isDeterministicRejection ? "deterministic" : "outcome-unknown",
    message,
  );
}

export function createStableMutationExecutor(nextCommandKey: (prefix: string) => string) {
  const pendingKeys = new Map<string, string>();

  return async function executeStableMutation<T, R>(
    prefix: string,
    fingerprint: string,
    command: StableMutationCommand<T>,
    accept: StableMutationAccept<T, R>,
  ): Promise<R> {
    const intent = `${prefix}:${fingerprint}`;
    const commandKey = pendingKeys.get(intent) ?? nextCommandKey(prefix);
    pendingKeys.set(intent, commandKey);
    try {
      const raw = await command(commandKey);
      const accepted = accept(raw);
      pendingKeys.delete(intent);
      return accepted;
    } catch (error) {
      if (classifyStableMutationFailure(error) === "deterministic") {
        pendingKeys.delete(intent);
      }
      throw error;
    }
  };
}
