"use client";

import { useRef, useState } from "react";
import { isExplicitRejection } from "./explicit-rejection";
import { displayAdminError } from "./error-messages";

// Exact pre-write conflicts from the I services/repositories and A2 activation checks.
// An unknown original command never enters this new-intent review.
const CONFLICTS = new Set([
  "COPY_VERSION_OPTION_REVISION_CONFLICT", "COPY_REVISION_CONFLICT", "COPY_DRAFT_VERSION_CONFLICT",
  "COPY_DRAFT_REVISION_CONFLICT", "COPY_FRAMEWORK_VALUE_CONFLICT",
  "NOVA_SOCIAL_DISTRIBUTION_CONCURRENT_MODIFICATION",
  "NOTIFICATION_CAMPAIGN_STALE_VERSION", "NOTIFICATION_CAP_STALE_VERSION",
  "TRUST_SECTION_REVISION_CONFLICT", "TRUST_SECTION_SNAPSHOT_CONFLICT", "TRUST_DOCUMENT_STALE",
  "I18N_MESSAGE_VERSION_CONFLICT", "I18N_DRAFT_VERSION_CONFLICT", "I18N_DRAFT_CHANGED_SAVE_BEFORE_PUBLISH",
  "LEARNING_COURSE_REVISION_CONFLICT", "LEARNING_COURSE_VERSION_REVISION_CONFLICT",
  "LEARNING_ACTIVATION_SNAPSHOT_CHANGED", "LEARNING_COURSE_REWARD_SNAPSHOT_CHANGED",
  "LEARNING_COURSE_CURRENT_VERSION_CONFLICT", "LEARNING_COURSE_CURRENT_REVISION_CONFLICT",
  "LEARNING_COURSE_VERSION_STATE_CONFLICT",
]);

export function isIConflictRejection(error: unknown): boolean {
  if (!isExplicitRejection(error)) return false;
  const failure = error as { reasonCode?: string; backendMessage?: string };
  return CONFLICTS.has(failure.reasonCode ?? failure.backendMessage ?? "");
}

export type IConflictReview<Latest, Input> = {
  requested: Input;
  /** Complete rejected command, including the original body/reason and opening snapshot where available. */
  rejectedCommand: unknown;
  rejection: string;
  latest?: Latest;
  reading: boolean;
  readError?: string;
};

/** Logic only: the page must show latest against requested before calling confirm to rebuild its editor. */
export function useIConflictReview<Latest, Input>() {
  const [review, setReview] = useState<IConflictReview<Latest, Input> | null>(null);
  const current = useRef(review);
  const reader = useRef<(() => Promise<Latest>) | null>(null);
  const publish = (next: IConflictReview<Latest, Input> | null) => { current.current = next; setReview(next); };
  const reread = async () => {
    const previous = current.current;
    if (!previous || !reader.current) return;
    const reading = { ...previous, latest: undefined, reading: true, readError: undefined };
    publish(reading);
    try {
      const latest = await reader.current();
      publish({ ...reading, latest, reading: false });
    } catch (error) { publish({ ...reading, reading: false, readError: displayAdminError(error) }); }
  };
  return {
    review,
    blockedReason: () => current.current?.readError ?? current.current?.rejection,
    reject: async (error: unknown, requested: Input, read: () => Promise<Latest>) => {
      if (!isIConflictRejection(error)) return false;
      reader.current = read;
      publish({ requested, rejectedCommand: (error as { rejectedCommand?: unknown }).rejectedCommand,
        rejection: displayAdminError(error), reading: true });
      await reread();
      return true;
    },
    reread,
    /** Call only from the operator's explicit review; rebuild all facts and CAS fields together, never retry the old closure. */
    confirm: (reviewed: IConflictReview<Latest, Input>, rebuild: (requested: Input, latest: Latest) => void) => {
      if (current.current !== reviewed || reviewed.reading || reviewed.readError || reviewed.latest === undefined) return false;
      rebuild(reviewed.requested, reviewed.latest);
      publish(null);
      return true;
    },
  };
}
