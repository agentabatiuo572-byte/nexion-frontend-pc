import { activeRecoveryActor, createFProposalRecovery } from "./f-proposal-recovery";
import { A2OutcomeUncertainError, createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError, type A2OperationRow } from "./a2-client";
import { fCommands, type FDomainAttempt } from "./f2-approval";
import { isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection } from "./outcome-classification";
import { isRetryExpired } from "./pending-mutation-store";
import type { ProposeSpec } from "./propose-or-execute";
import { roleLabel } from "../nav/console-nav";
import { useAdminAuth } from "../store/admin-auth";

const legacyF1Slot = (slot: string) => /^f-(?:vrank-(?:bootstrap|override)|payout-action):/.test(slot)
  || ["f-config:F.vrank.permanent", "f-config:F.vrank.titles", "f-config:F.prize.name"].includes(slot);

export const isF1PayoutSlot = (slot: string) => slot.startsWith("f-payout-action:");

export function listF1Proposals(adminId: number) {
  return fCommands.list().filter(row => row.spec?.sourceDomain === "F1" || legacyF1Slot(row.fingerprint))
    .filter(row => row.adminId === adminId || row.adminId === undefined);
}

function actor(adminId: number) {
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== adminId) throw new Error("ADMIN_PERMISSION_DENIED");
  return auth.session;
}

export function f1ProposalAuthority(spec: ProposeSpec) {
  if (spec.command.op === "f_vrank_override") return "network_f1_promote_user";
  if (spec.command.op === "f_reward_payout_action") return spec.command.params.action === "reverse" ? "network_f1_reward_reverse" : "network_f1_reward_reissue";
  return spec.obj === "F.vrank.permanent" ? "network_f1_permanent_protection" : "network_f1_write";
}

export function isV8Promotion(spec: ProposeSpec | undefined) {
  return spec?.command.op === "f_vrank_override" && spec.command.params.targetV === "V8" && spec.command.params.direction === "promote";
}

export function canSendF1Proposal(spec: ProposeSpec, authorities: readonly string[]) {
  return authorities.includes(f1ProposalAuthority(spec))
    && (spec.command.op === "f1_rank_policy_change" || authorities.includes("platform_a2_write")
      || !isV8Promotion(spec) && authorities.includes("platform_a2_proposal_create"));
}

export const F1_PROPOSAL_LOOKUP_FIRST = "结果未知，可能已经建了审批单。请先查询原结果。";

export function withF1ProposalLookupCopy(error: A2OutcomeUncertainError, copy = F1_PROPOSAL_LOOKUP_FIRST) {
  return Object.assign(error, { message: copy, confirmCopy: copy });
}

function f1ProposalLookupError(copy: string, commandKey: string) {
  return withF1ProposalLookupCopy(new A2OutcomeUncertainError(copy, commandKey), copy);
}

function checkTicket(original: FDomainAttempt, ticket: A2OperationRow) {
  // 111e00cd OpsAuditCenterService.ticketMetadata returns command.op for F tickets.
  // Descriptors replace action/before/after; they are not request identity fields.
  if (!ticket.mine || !original.spec || ticket.obj !== original.spec.obj || ticket.operationCode !== original.spec.command.op) {
    throw f1ProposalLookupError("原审批单与保存的操作对不上，请到操作记录核对。", original.commandKey);
  }
}

export const f1ProposalRecovery = createFProposalRecovery<FDomainAttempt>(fCommands, row => {
  const session = activeRecoveryActor(row.adminId, "network_f1_read");
  return !!session && !!row.spec && canSendF1Proposal(row.spec, session.authorities);
});

export const canRetryF1Proposal = (original: FDomainAttempt) => !f1ProposalRecovery.state(original).replayBlock;

export async function queryF1Proposal(adminId: number, original: FDomainAttempt) {
  actor(adminId);
  return f1ProposalRecovery.queryTicket(original, async record => {
    if (record.adminId !== undefined && record.adminId !== adminId) throw new Error("ADMIN_PERMISSION_DENIED");
    const ticket = await fetchA2ProposalByKey(record.commandKey, true, "f");
    if (!activeRecoveryActor(adminId, "network_f1_read")) throw new Error("ADMIN_PERMISSION_DENIED");
    if (!ticket && (record.received || record.ticket)) throw new A2OutcomeUncertainError("原申请建过单，批没批准还没查到，请继续查询。", record.commandKey);
    if (ticket) await checkTicket(record, ticket);
    return ticket;
  }, (record, ticket) => fCommands.remember(record.fingerprint, record.commandKey, { ...record, received: true, ticket, absent: false }));
}

/** All eight ordinary F1 proposals share the existing F-domain store. */
export async function sendF1Proposal(adminId: number, slot: string, spec?: ProposeSpec) {
  const current = actor(adminId);
  let original = listF1Proposals(adminId).find(row => row.fingerprint === slot);
  const recovering = !spec;
  if (spec && original) throw f1ProposalLookupError("请先查询保存的原操作。", original.commandKey);
  const intent = spec ?? original?.spec;
  if (!intent) throw new Error("原操作没有完整请求，请到操作记录核对。");
  if (!canSendF1Proposal(intent, current.authorities)) throw new Error("ADMIN_PERMISSION_DENIED");
  if (!original) {
    const request = {
      action: intent.action, obj: intent.obj, beforeValue: intent.before, afterValue: intent.after,
      operator: current.operator || current.username, operatorRole: roleLabel(current.role),
      type: intent.type, amplifies: !!intent.amplifies, sos: !!intent.sos, roleGate: intent.gateLabel,
      reason: intent.reason, sourceDomain: intent.sourceDomain, command: intent.command, target: intent.target, targets: intent.targets,
    };
    const key = createA2CommandKey(slot.split(":")[0]);
    fCommands.remember(slot, key, { adminId, spec: intent, request, inputFingerprint: JSON.stringify(request) });
    original = listF1Proposals(adminId).find(row => row.commandKey === key)!;
    if (!fCommands.isDurablyStored(slot, key)) {
      fCommands.forget(slot, key);
      throw new Error("浏览器没能记下这次操作，这次没有发出；请关闭无痕模式或允许本站保存数据后再试。");
    }
  }
  if (original.received || original.ticket) {
    const latest = await queryF1Proposal(adminId, original);
    if (!latest) throw f1ProposalLookupError("原申请建过单，批没批准还没查到，请继续查询。", original.commandKey);
    return latest;
  }
  if (isRetryExpired(original)) throw f1ProposalLookupError("原操作已超过 24 小时，只能查询原结果。", original.commandKey);
  if (!original.request || !fCommands.isDurablyStored(slot, original.commandKey)) throw new Error("原操作没有完整的持久记录，请到操作记录核对。");
  let ticket: A2OperationRow;
  try {
    const send = (record: FDomainAttempt) => createA2OperationProposal(record.request!, record.commandKey, "proposal");
    ticket = recovering ? await f1ProposalRecovery.replay(original, send) : await send(original);
  }
  catch (error) {
    const failure = error as { httpStatus?: number; apiCode?: number };
    if (!recovering && (isF1PayoutSlot(slot) ? isExplicitRejection(error) : !isA2OutcomeUncertainError(error)
        && failure.httpStatus !== undefined && isDeterministicRejection(failure.httpStatus, failure.apiCode))) fCommands.forget(slot, original.commandKey);
    throw isA2OutcomeUncertainError(error) ? withF1ProposalLookupCopy(error) : error;
  }
  fCommands.remember(slot, original.commandKey, { ...original, received: true, ticket: undefined, absent: false });
  checkTicket(original, ticket);
  // A POST replay returns the old receipt, never the current approval status.
  if (recovering) {
    const latest = await queryF1Proposal(adminId, { ...original, received: true });
    if (!latest) throw f1ProposalLookupError("原申请建过单，批没批准还没查到，请继续查询。", original.commandKey);
    return latest;
  }
  fCommands.remember(slot, original.commandKey, { ...original, received: true, ticket, absent: false });
  return ticket;
}

export async function releaseF1Proposal(adminId: number, original: FDomainAttempt) {
  actor(adminId);
  if (!f1ProposalRecovery.releaseRejectedReplay(original)) throw new Error("PENDING_RELEASE_BLOCKED");
}
