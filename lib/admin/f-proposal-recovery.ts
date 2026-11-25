import type { F2Proposal } from "./f2-approval";
import { settleFReconfirmation } from "./f-reconfirmation";
import type { A2OperationRow } from "./a2-client";
import { explicitRejectionCode } from "./explicit-rejection";
import { createPendingRecovery, type PendingMutationRecord, type PendingMutationStore } from "./pending-mutation-store";
import { useAdminAuth } from "../store/admin-auth";

type ProposalRecord = F2Proposal & { request?: unknown; ticket?: A2OperationRow; received?: boolean };
type RecoveryStore<T extends PendingMutationRecord> = Pick<PendingMutationStore<T>, "list" | "isDurablyStored" | "forget" | "markReplayRejected">;

export function activeRecoveryActor(adminId: number | undefined, readAuthority?: string) {
  const auth = useAdminAuth.getState();
  const session = auth.session;
  if (!auth.isAuthenticated || auth.logoutPending || auth.logoutUnknown || !session || session.passwordChangeRequired
    || session.adminId !== adminId || readAuthority && !session.authorities.includes(readAuthority)) return undefined;
  return session;
}

export function createFProposalRecovery<T extends ProposalRecord>(store: RecoveryStore<T>, canWrite: (record: T) => boolean) {
  const recovery = createPendingRecovery(store, {
    capability: () => "receipt",
    canReplay: record => !!record.request && !record.received && !record.ticket && canWrite(record),
    explicitRejectionCode,
  });

  return {
    ...recovery,
    async queryTicket(scope: "F1" | "F2" | "F3" | "F4" | "F5", original: T, read: (record: T) => Promise<A2OperationRow | null>, rememberPending: (record: T, ticket: A2OperationRow) => void) {
      const result = await recovery.query(original, async record => {
        const ticket = await read(record);
        const conclusion = !ticket ? "not-found" : ticket.status === "pending" ? "unknown"
          : ticket.status === "approved" ? "succeeded" : ticket.status === "rejected" ? "rejected" : "not-executed";
        return { conclusion, value: { record, ticket } };
      });
      if (!result) throw new Error("PENDING_QUERY_UNAVAILABLE");
      const { record, ticket } = result.value;
      if (ticket?.status === "pending") rememberPending(record, ticket);
      else if (ticket) settleFReconfirmation(recovery, record, result.conclusion, scope);
      return ticket;
    },
  };
}
