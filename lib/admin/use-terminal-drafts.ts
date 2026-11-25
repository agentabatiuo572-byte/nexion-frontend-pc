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

export type TerminalDraft<T> = { before?: T; desired: T };

/** Keep the operator's changed fields and take untouched fields from the latest read. */
export function rebaseTerminalDraft<T extends object>(before: T, desired: T, latest: T) {
  const value = { ...latest };
  const mine: (keyof T)[] = [];
  const others: (keyof T)[] = [];
  const overlap: (keyof T)[] = [];
  for (const field of Object.keys(desired) as (keyof T)[]) {
    const original = JSON.stringify(before[field]);
    const changedByMe = JSON.stringify(desired[field]) !== original;
    const changedByOther = JSON.stringify(latest[field]) !== original;
    if (changedByMe) { value[field] = desired[field]; mine.push(field); }
    if (changedByOther) others.push(field);
    if (changedByMe && changedByOther && JSON.stringify(desired[field]) !== JSON.stringify(latest[field])) overlap.push(field);
  }
  return { value, mine, others, overlap };
}

export function rebaseTerminalSet<T>(before: readonly T[], desired: readonly T[], latest: readonly T[]) {
  const original = new Set(before), proposed = new Set(desired);
  return [...new Set([...latest.filter(item => !original.has(item) || proposed.has(item)), ...desired.filter(item => !original.has(item))])];
}
