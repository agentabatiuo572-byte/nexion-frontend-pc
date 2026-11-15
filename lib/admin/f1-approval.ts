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

function checkTicket(original: FDomainAttempt, ticket: A2OperationRow) {
  // 111e00cd OpsAuditCenterService.ticketMetadata returns command.op for F tickets.
  // Descriptors replace action/before/after; they are not request identity fields.
  if (!ticket.mine || !original.spec || ticket.obj !== original.spec.obj || ticket.operationCode !== original.spec.command.op) {
    throw new A2OutcomeUncertainError("原审批单与保存的操作对不上，请到操作记录核对。", original.commandKey);
  }
}

export async function queryF1Proposal(adminId: number, original: FDomainAttempt) {
  actor(adminId); // Read permission is adjudicated independently by the lookup endpoint.
  if (original.adminId !== undefined && original.adminId !== adminId) throw new Error("ADMIN_PERMISSION_DENIED");
  fCommands.remember(original.fingerprint, original.commandKey, { ...original, ticket: undefined, absent: false });
  const ticket = await fetchA2ProposalByKey(original.commandKey, true, "f");
  if (!ticket) {
    fCommands.remember(original.fingerprint, original.commandKey, { ...original, ticket: undefined, absent: true });
    return null;
  }
  checkTicket(original, ticket);
  if (ticket.status === "pending") fCommands.remember(original.fingerprint, original.commandKey, { ...original, received: true, ticket, absent: false });
  else fCommands.forget(original.fingerprint, original.commandKey);
  return ticket;
}

/** All eight ordinary F1 proposals share the existing F-domain store. */
export async function sendF1Proposal(adminId: number, slot: string, spec?: ProposeSpec) {
  const current = actor(adminId);
  let original = listF1Proposals(adminId).find(row => row.fingerprint === slot);
  const recovering = !spec;
  if (spec && original) throw new A2OutcomeUncertainError("请先查询保存的原操作。", original.commandKey);
  const intent = spec ?? original?.spec;
  if (!intent) throw new Error("原操作没有完整请求，请到操作记录核对。");
  if (!current.authorities.includes(f1ProposalAuthority(intent))
      || !current.authorities.some(a => a === "platform_a2_write" || a === "platform_a2_proposal_create")) throw new Error("ADMIN_PERMISSION_DENIED");
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
      throw new Error("浏览器无法保存原操作，请允许会话存储后重试。");
    }
  }
  if (original.received || original.ticket) {
    const latest = await queryF1Proposal(adminId, original);
    if (!latest) throw new A2OutcomeUncertainError("原申请建过单，批没批准还没查到，请继续查询。", original.commandKey);
    return latest;
  }
  if (isRetryExpired(original)) throw new A2OutcomeUncertainError("原操作已超过 24 小时，只能查询原结果。", original.commandKey);
  if (!original.request || !fCommands.isDurablyStored(slot, original.commandKey)) throw new Error("原操作没有完整的持久记录，请到操作记录核对。");
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
  // A POST replay returns the old receipt, never the current approval status.
  if (recovering) {
    const latest = await queryF1Proposal(adminId, { ...original, received: true });
    if (!latest) throw new A2OutcomeUncertainError("原申请建过单，批没批准还没查到，请继续查询。", original.commandKey);
    return latest;
  }
  fCommands.remember(slot, original.commandKey, { ...original, received: true, ticket, absent: false });
  return ticket;
}

/** Call only from an explicit confirmation surface (R1-提案过期). */
export async function releaseF1Proposal(adminId: number, original: FDomainAttempt) {
  if (!isRetryExpired(original)) throw new Error("原操作尚未过期，请先查询原结果。");
  const ticket = await queryF1Proposal(adminId, original);
  if (ticket?.status === "pending") throw new Error("这张申请仍在等待审批。");
  if (!ticket) fCommands.forget(original.fingerprint, original.commandKey);
}
