type MSupportAgentProgress = {
  supportAgents: unknown[];
  supportAgentsAvailable: boolean;
  supportAgentsError: string;
  advisorAssignments: unknown[];
  transferTargets: unknown[];
};

/**
 * A new M-domain reload has one short safe carry-over window: after the same
 * authenticated session has already validated its seat roster, unrelated
 * tasks may publish before the next M1 request settles.  Keep that validated
 * roster until M1 either publishes its next result or explicitly fails.
 */
export function preserveVerifiedSupportAgentsDuringReload<T extends MSupportAgentProgress>(
  previous: T | null,
  next: T,
): T {
  const m1ReadIsPending = !next.supportAgentsAvailable && next.supportAgentsError === "none";
  if (!m1ReadIsPending || !previous?.supportAgentsAvailable) return next;
  return {
    ...next,
    supportAgents: previous.supportAgents,
    supportAgentsAvailable: true,
    supportAgentsError: "none",
    advisorAssignments: previous.advisorAssignments,
    transferTargets: previous.transferTargets,
  };
}

/** A current full-load rejection must never leave the M1 roster in pending. */
export function failClosedSupportAgentsAfterReload<T extends MSupportAgentProgress>(previous: T | null): T | null {
  if (!previous) return previous;
  return {
    ...previous,
    supportAgents: [],
    supportAgentsAvailable: false,
    supportAgentsError: "unavailable",
    advisorAssignments: [],
    transferTargets: [],
  };
}
