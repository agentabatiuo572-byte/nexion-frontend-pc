import { A2OutcomeUncertainError, createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError, type A2OperationRow } from "./a2-client";
import { fCommands, type FDomainAttempt } from "./f2-approval";
import { isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection } from "./outcome-classification";
import { hasPersistedPendingCommandOwner, isRetryExpired } from "./pending-mutation-store";
import type { F5CommissionAuditOverview, F5CommissionEvent } from "./f1-client";
import type { ProposeSpec } from "./propose-or-execute";
import { roleLabel } from "../nav/console-nav";
import { useAdminAuth } from "../store/admin-auth";

/** Facts captured when the existing confirmation opens, never rebuilt from today's row. */
export type F5ConfirmationSnapshot = {
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

export function canRetryF5Proposal(original: FDomainAttempt) {
  const auth = useAdminAuth.getState();
  return auth.isAuthenticated && !auth.logoutPending && !!auth.session && auth.session.adminId === original.adminId && !!original.spec && !!original.request
    && !original.ticket && !original.received && !isRetryExpired(original) && auth.session.authorities.includes(f5ProposalAuthority(original.spec));
}

function checkTicket(original: FDomainAttempt, ticket: A2OperationRow) {
  // 111e00cd ticketMetadata returns persisted command.op for every F ticket.
  // Delegated descriptors rewrite action/before/after, but preserve canonical obj.
  if (!ticket.mine || !original.spec || ticket.obj !== original.spec.obj || ticket.operationCode !== original.spec.command.op) {
    throw new A2OutcomeUncertainError("原审批单与保存的操作对不上，请查询原结果。", original.commandKey);
  }
}

export async function queryF5Proposal(adminId: number, original: FDomainAttempt) {
  actor(adminId); // The endpoint judges read grants independently from the POST grant.
  if (original.adminId !== undefined && original.adminId !== adminId) throw new Error("ADMIN_PERMISSION_DENIED");
  fCommands.remember(original.fingerprint, original.commandKey, { ...original, f5TicketId: original.ticket?.id ?? original.f5TicketId, ticket: undefined, absent: false });
  const ticket = await fetchA2ProposalByKey(original.commandKey, true, true);
  if (!ticket) {
    fCommands.remember(original.fingerprint, original.commandKey, { ...original, ticket: undefined, absent: true });
    return null;
  }
  // Fingerprint-only pre-upgrade records remain GET-only; exact-key GET is maker scoped.
  if (original.spec) checkTicket(original, ticket);
  else if (!ticket.mine) throw new A2OutcomeUncertainError("原审批单发起人对不上，请核对。", original.commandKey);
  if (ticket.status === "pending") fCommands.remember(original.fingerprint, original.commandKey, { ...original, f5TicketId: ticket.id, received: true, ticket, absent: false });
  else fCommands.forget(original.fingerprint, original.commandKey);
  return ticket;
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
    fCommands.remember(slot, key, { adminId, spec: intent, request, f5Snapshot: snapshot, inputFingerprint: JSON.stringify(request) });
    original = listF5Proposals(adminId).find(row => row.commandKey === key)!;
    if (!fCommands.isDurablyStored(slot, key)) {
      fCommands.forget(slot, key);
      throw new Error("F5_OPERATION_STORAGE_UNAVAILABLE");
    }
  }
  if (isRetryExpired(original)) throw new A2OutcomeUncertainError("原操作已超过 24 小时，只能查询原结果。", original.commandKey);
  if (!original.request || !fCommands.isDurablyStored(slot, original.commandKey)) throw new Error("F5_OPERATION_ORIGINAL_INCOMPLETE");
  if (!original.received && !original.ticket) {
    let ticket: A2OperationRow;
    try { ticket = await createA2OperationProposal(original.request, original.commandKey, "proposal"); }
    catch (error) {
      const failure = error as { httpStatus?: number; apiCode?: number };
      if (recovering ? isExplicitRejection(error) : !isA2OutcomeUncertainError(error)
        && failure.httpStatus !== undefined && isDeterministicRejection(failure.httpStatus, failure.apiCode)) fCommands.forget(slot, original.commandKey);
      throw error;
    }
    fCommands.remember(slot, original.commandKey, { ...original, received: true, ticket: undefined, absent: false });
    checkTicket(original, ticket);
    if (!recovering) {
      fCommands.remember(slot, original.commandKey, { ...original, f5TicketId: ticket.id, received: true, ticket, absent: false });
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

/** Requires the visual layer's explicit confirmation after authoritative expired absence. */
export async function releaseF5Proposal(adminId: number, original: FDomainAttempt) {
  if (!isRetryExpired(original)) throw new Error("原操作尚未过期，请先查询原结果。");
  const ticket = await queryF5Proposal(adminId, original);
  if (ticket?.status === "pending") throw new Error("OBJECT_ALREADY_PENDING");
  if (!ticket) fCommands.forget(original.fingerprint, original.commandKey);
}
