import { useSyncExternalStore } from "react";
import type { F4AmbassadorApplication, F4AmbassadorReviewInput } from "./f1-client";
import type { F1PolicyRecord } from "./f1-policy-change";
import type { FDirectAttempt } from "./f1-stable-write";
import type { F2Proposal, FDomainAttempt } from "./f2-approval";
import type { H8RewardCommand } from "./h8-reward-mutation";
import { createPendingMutationStore, type PendingMutationRecord, type PendingRecoveryConclusion, type PendingRecoveryState } from "./pending-mutation-store";

type MaterialDraft = PendingMutationRecord & {
  actorId: number;
  applicationId: number;
  input: F4AmbassadorReviewInput;
  application?: F4AmbassadorApplication;
};
type DraftOriginal = {
  F1: FDomainAttempt;
  F2: F2Proposal;
  F3: FDomainAttempt;
  F4: FDomainAttempt;
  F5: FDomainAttempt;
  "f1-policy": F1PolicyRecord;
  "f3-write": FDirectAttempt;
  "f4-policy": FDirectAttempt;
  "f4-material": MaterialDraft;
  "f5-anomaly": FDirectAttempt;
  H8: H8RewardCommand;
};

type DraftScope = keyof DraftOriginal;
type Draft<K extends DraftScope> = PendingMutationRecord & { scope: K; original: DraftOriginal[K] };
const drafts = createPendingMutationStore<Draft<DraftScope>>({
  storageKey: "nexion-admin-f-reconfirmations-v1",
  retainExpiredRecords: true,
  isValidRecord: row => row.original?.commandKey === row.commandKey && typeof row.scope === "string",
});
const listeners = new Set<() => void>();
let revision = 0;
const notify = () => { revision++; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function useFReconfirmations<K extends DraftScope>(scope: K) {
  useSyncExternalStore(subscribe, () => revision, () => 0);
  return drafts.list().filter(row => row.scope === scope) as Draft<K>[];
}

export function consumeFReconfirmation(original: PendingMutationRecord) {
  drafts.forget(original.commandKey, original.commandKey);
  notify();
}

/** All authoritative verdicts go through this before the recovery journal is released. */
export function settleFReconfirmation<T extends PendingMutationRecord>(
  recovery: { state: (record: T) => PendingRecoveryState; settleFromQuery: (record: T, conclusion: PendingRecoveryConclusion) => boolean },
  original: T & DraftOriginal[DraftScope],
  conclusion: PendingRecoveryConclusion,
  scope: DraftScope,
) {
  const state = recovery.state(original);
  const preserve = (conclusion === "not-executed" || conclusion === "rejected")
    && state.conclusion === conclusion && !state.busy && state.replayBlock !== "missing";
  if (preserve) drafts.remember(original.commandKey, original.commandKey, { scope, original });
  const settled = recovery.settleFromQuery(original, conclusion);
  if (preserve) notify();
  return settled;
}

export function rebaseFValues<T extends Record<string, string>>(baseline: T, intended: Partial<T>, latest: T, equal: (left: string, right: string, key: string) => boolean = Object.is): T {
  const rebased = { ...latest };
  for (const key in intended) {
    const value = intended[key];
    if (value !== undefined && key in baseline && key in latest && !equal(value, baseline[key], key)) rebased[key] = value;
  }
  return rebased;
}
