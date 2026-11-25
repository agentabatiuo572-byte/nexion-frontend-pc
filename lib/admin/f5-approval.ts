import { activeRecoveryActor, createFProposalRecovery } from "./f-proposal-recovery";
import { A2OutcomeUncertainError, createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError, type A2OperationRow } from "./a2-client";
import { fCommands, type FDomainAttempt } from "./f2-approval";
import { isDeterministicRejection } from "./outcome-classification";
import { hasPersistedPendingCommandOwner, isRetryExpired } from "./pending-mutation-store";
import type { F5CommissionAuditOverview, F5CommissionEvent } from "./f1-client";
import type { ProposeSpec } from "./propose-or-execute";
import { roleLabel } from "../nav/console-nav";
import { acknowledgeFReconfirmation, type FReconfirmationLink } from "./f-reconfirmation";
import { useAdminAuth } from "../store/admin-auth";

/** Facts captured when the existing confirmation opens, never rebuilt from today's row. */
export type F5ConfirmationSnapshot = FReconfirmationLink & {
  name?: string;
  action: "freeze" | "unlock" | "unfreeze" | "reverse" | "reissue" | "suspend" | "resume" | "anomaly";
  row?: F5CommissionEvent;
  rows?: F5CommissionEvent[];
  suspension?: { userId: string; kind: string };
  sigma?: string;
  ratio?: string;
  coolingPolicy?: F5CommissionAuditOverview["coolingPolicy"];
  coverage?: F5CommissionAuditOverview["coverage"];
};

export function f5ConfirmationSlot(snapshot: F5ConfirmationSnapshot) {
  if (snapshot.action === "anomaly") return "f5-anomaly-config";
  if (snapshot.action === "reissue") return "f5-reissue";
  if (snapshot.action === "resume") return `f5-suspension:${String(snapshot.suspension!.userId).replace(/\D/g, "")}`;
  if (snapshot.action === "suspend") return `f5-suspension:${snapshot.row!.userId}`;
  return snapshot.action === "reverse" ? `f5-reverse:${snapshot.row!.id}` : `f-config:${snapshot.row!.auditKey}`;
}

export function listF5Proposals(adminId: number): FDomainAttempt[] {
  return fCommands.list().filter(row => row.spec?.sourceDomain === "F5"
    || /^f5-(?:reverse:|reissue$|suspension:)/.test(row.fingerprint) || /^f-config:F\.commission\.CM-\d+\.status$/.test(row.fingerprint))
    .filter(row => row.adminId === adminId || row.adminId === undefined && hasPersistedPendingCommandOwner(String(adminId)));
}

function actor(adminId: number) {
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== adminId) throw new Error("ADMIN_PERMISSION_DENIED");
  return auth.session;
}

export function f5ProposalAuthority(spec: ProposeSpec) {
  return spec.command.op === "f5_commission_reverse" ? "network_f5_commission_reverse"
    : spec.command.op === "f5_commission_reissue" ? "network_f5_commission_reissue"
      : spec.command.op === "f5_commission_suspension" ? "network_f5_commission_suspend"
        : spec.command.params.value === "unlocked" ? "network_f5_commission_release" : "network_f5_commission_freeze";
}

function checkTicket(original: FDomainAttempt, ticket: A2OperationRow) {
  // 111e00cd ticketMetadata returns persisted command.op for every F ticket.
  // Delegated descriptors rewrite action/before/after, but preserve canonical obj.
  if (!ticket.mine || !original.spec || ticket.obj !== original.spec.obj || ticket.operationCode !== original.spec.command.op) {
    throw new A2OutcomeUncertainError("原审批单与保存的操作对不上，请查询原操作。", original.commandKey);
  }
}

export const f5ProposalRecovery = createFProposalRecovery<FDomainAttempt>(fCommands, row => {
  const session = activeRecoveryActor(row.adminId, "network_f5_read");
  return !!session && !!row.spec && session.authorities.includes(f5ProposalAuthority(row.spec));
});

export const canRetryF5Proposal = (original: FDomainAttempt) => !f5ProposalRecovery.state(original).replayBlock;

export async function queryF5Proposal(adminId: number, original: FDomainAttempt) {
  actor(adminId);
  return f5ProposalRecovery.queryTicket("F5", original, async record => {
    if (record.adminId !== undefined && record.adminId !== adminId) throw new Error("ADMIN_PERMISSION_DENIED");
    const ticket = await fetchA2ProposalByKey(record.commandKey, true, "f");
    if (!activeRecoveryActor(adminId, "network_f5_read")) throw new Error("ADMIN_PERMISSION_DENIED");
    if (!ticket && (record.received || record.ticket || record.f5TicketId)) throw new A2OutcomeUncertainError("原申请建过单，批没批准还没查到，请继续查询。", record.commandKey);
    if (ticket && record.spec) checkTicket(record, ticket);
    else if (ticket && !ticket.mine) throw new A2OutcomeUncertainError("原审批单发起人对不上，请核对。", record.commandKey);
    return ticket;
  }, (record, ticket) => fCommands.remember(record.fingerprint, record.commandKey, { ...record, f5TicketId: ticket.id, received: true, ticket, absent: false }));
}

export function f5Targets(spec: ProposeSpec) {
  return spec.targets ?? (spec.target ? [spec.target] : []);
}

export function f5ProposalOverlaps(original: FDomainAttempt, spec: ProposeSpec) {
  if (!original.spec) return original.fingerprint === "f5-reissue" && spec.command.op === "f5_commission_reissue"
    || original.fingerprint === `f-config:${spec.obj}` || original.fingerprint === `f5-reverse:${spec.obj}`
    || original.fingerprint === `f5-suspension:${spec.command.params.userId}`;
  return f5Targets(original.spec).some(left => f5Targets(spec).some(right => left.domain === right.domain && left.type === right.type && left.id === right.id));
}

export async function sendF5Proposal(adminId: number, slot: string, spec?: ProposeSpec, snapshot?: F5ConfirmationSnapshot) {
  const current = actor(adminId);
  let original = listF5Proposals(adminId).find(row => row.fingerprint === slot);
  const recovering = !spec;
  if (spec) {
    const conflict = original ?? listF5Proposals(adminId).find(row => f5ProposalOverlaps(row, spec));
    if (conflict) throw new A2OutcomeUncertainError("请先查询保存的原操作。", conflict.commandKey);
  }
  const intent = spec ?? original?.spec;
  if (!intent) throw new Error("F5_OPERATION_ORIGINAL_INCOMPLETE");
  // F5 delegated proposals require only their business action authority (Guard.canProposeF5).
  if (!current.authorities.includes(f5ProposalAuthority(intent))) throw new Error("ADMIN_PERMISSION_DENIED");
  if (!original) {
    const request = { action: intent.action, obj: intent.obj, beforeValue: intent.before, afterValue: intent.after,
      operator: current.operator || current.username, operatorRole: roleLabel(current.role), type: intent.type,
      amplifies: !!intent.amplifies, sos: !!intent.sos, roleGate: intent.gateLabel, reason: intent.reason, sourceDomain: intent.sourceDomain,
      command: intent.command, target: intent.target, targets: intent.targets };
    const key = createA2CommandKey(slot.split(":")[0]);
    fCommands.remember(slot, key, { adminId, spec: intent, request, f5Snapshot: snapshot, inputFingerprint: JSON.stringify(request), continuedFrom: snapshot?.continuedFrom });
    original = listF5Proposals(adminId).find(row => row.commandKey === key)!;
    if (!fCommands.isDurablyStored(slot, key)) {
      fCommands.forget(slot, key);
      throw new Error("F5_OPERATION_STORAGE_UNAVAILABLE");
    }
  }
  if (isRetryExpired(original)) throw new A2OutcomeUncertainError("原操作已超过 24 小时，只能查询原操作。", original.commandKey);
  if (!original.request || !fCommands.isDurablyStored(slot, original.commandKey)) throw new Error("F5_OPERATION_ORIGINAL_INCOMPLETE");
  if (!original.received && !original.ticket) {
    let ticket: A2OperationRow;
    try {
    const send = (record: FDomainAttempt) => createA2OperationProposal(record.request!, record.commandKey, "proposal");
    ticket = recovering ? await f5ProposalRecovery.replay(original, send) : await send(original);
  }
    catch (error) {
      const failure = error as { httpStatus?: number; apiCode?: number };
      if (!recovering && !isA2OutcomeUncertainError(error)
        && failure.httpStatus !== undefined && isDeterministicRejection(failure.httpStatus, failure.apiCode)) fCommands.forget(slot, original.commandKey);
      throw error;
    }
    fCommands.remember(slot, original.commandKey, { ...original, received: true, ticket: undefined, absent: false });
    checkTicket(original, ticket);
    if (!recovering) {
      fCommands.remember(slot, original.commandKey, { ...original, f5TicketId: ticket.id, received: true, ticket, absent: false });
      acknowledgeFReconfirmation(original);
      return ticket;
    }
    original = { ...original, f5TicketId: ticket.id, received: true };
  }
  // A successful replay proves creation, never today's pending status.
  let ticket: A2OperationRow | null;
  try { ticket = await queryF5Proposal(adminId, original); }
  catch { throw new A2OutcomeUncertainError("原申请建过单，批没批准还没查到，请继续查询。", original.commandKey); }
  if (!ticket) throw new A2OutcomeUncertainError("原申请建过单，批没批准还没查到，请继续查询。", original.commandKey);
  return ticket;
}

export async function releaseF5Proposal(adminId: number, original: FDomainAttempt) {
  actor(adminId);
  if (!f5ProposalRecovery.releaseRejectedReplay(original)) throw new Error("PENDING_RELEASE_BLOCKED");
}
