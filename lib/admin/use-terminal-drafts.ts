import { useRef } from "react";

/** Keep terminal drafts separate from the command journal and scoped to the original operator. */
export function useTerminalDrafts<T>() {
  const drafts = useRef(new Map<string, T>()).current;
  const key = (owner: number, object: string) => JSON.stringify([owner, object]);
  return {
    remember: (owner: number, object: string, draft: T) => drafts.set(key(owner, object), draft),
    get: (owner: number | undefined, object: string) => owner === undefined ? undefined : drafts.get(key(owner, object)),
    forget: (owner: number | undefined, object: string) => owner !== undefined && drafts.delete(key(owner, object)),
  };
}

export function isConfirmedNonExecution(receipt: { originalStatus: string } | null | undefined) {
  return receipt?.originalStatus === "CONFIRMED_NOT_EXECUTED" || receipt?.originalStatus === "CONFIRMED_REJECTED";
}
