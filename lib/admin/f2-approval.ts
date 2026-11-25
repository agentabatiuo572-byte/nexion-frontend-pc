import type { DirectReferralPolicy } from "./direct-referral-policy";
import { fConfigAuthority, fConfigBatchPermissionIssue, fConfigObjectMatches } from "./f-config-batch";
import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError, type A2OperationRow } from "./a2-client";
import { f2ActivationAttempts, type F2ActivationAttempt } from "./f2-activation-attempt";
import { createFProposalRecovery, activeRecoveryActor } from "./f-proposal-recovery";
import { isDeterministicRejection } from "./outcome-classification";
import { createPendingMutationStore, createSlotAttemptStore, type SlotAttemptRecord } from "./pending-mutation-store";
import type { ProposeSpec } from "./propose-or-execute";
import { roleLabel } from "../nav/console-nav";
import { useAdminAuth } from "../store/admin-auth";
import type { F3ConfirmationSnapshot } from "./f3-approval";
import type { F4ConfirmationSnapshot } from "./f4-approval";
import type { F5ConfirmationSnapshot } from "./f5-approval";
import { validateF2UnilevelBootstrap } from "./f2-unilevel-bootstrap";

export const F2_ACTIVATION_SLOT = "f-seven-layer-activation";
export const F2_POLICY_SLOT = "f-direct-referral-policy";
export const F2_BATCH_SLOT = "f-config-batch:F2";
export const F2_BOOTSTRAP_SLOT = "f-unilevel-bootstrap";
export const F2_PARAM_KEYS = new Set([
  "F.unilevel.depthGate", "F.unilevel.depthGateRank", "F.influence.clampMin", "F.influence.clampMax",
  "F.promo.weekMultiplier", "F.unilevel.mergeExitMaxPct", "F.partner.tiers", "F.cooldown",
]);
const isF2Slot = (slot: string) => slot === F2_POLICY_SLOT || slot === F2_BATCH_SLOT || slot === F2_BOOTSTRAP_SLOT
  || slot.startsWith("f-config:") && (F2_PARAM_KEYS.has(slot.slice(9)) || /^F\.unilevel\.(?:nex\.)?L[1-7]$/.test(slot.slice(9)));

export interface FDomainAttempt extends SlotAttemptRecord {
  spec?: ProposeSpec;
  request?: Parameters<typeof createA2OperationProposal>[0];
  adminId?: number;
  ticket?: A2OperationRow;
  received?: boolean;
  absent?: boolean;
  f2DirectBaseline?: Pick<DirectReferralPolicy, "purchaseSplit" | "deviceEarning">;
  f3Snapshot?: F3ConfirmationSnapshot;
  f4Snapshot?: F4ConfirmationSnapshot;
  f5Snapshot?: F5ConfirmationSnapshot;
  f5TicketId?: string;
}
// The legacy F1/F3/F4/F5 slot adapter and F2 share exactly one backing store.
export const fCommands = createPendingMutationStore<FDomainAttempt>({
  storageKey: "nexion-admin-f-commands-v1",
  retainExpiredRecords: row => isF2Slot(row.fingerprint) || row.spec?.sourceDomain === "F1"
    || /^f-(?:vrank-(?:bootstrap|override)|payout-action):/.test(row.fingerprint)
    || ["f-config:F.vrank.permanent", "f-config:F.vrank.titles", "f-config:F.prize.name"].includes(row.fingerprint)
    || row.spec?.sourceDomain === "F3" || row.fingerprint === "f-config-batch:F3" || row.fingerprint.startsWith("f-config:F.binary.")
    || row.spec?.sourceDomain === "F4" || /^f-config:F\.(?:pool|quota|ambassador|leaderboard)\./.test(row.fingerprint)
    || /^f4-(?:settle|leaderboard|quota-create):/.test(row.fingerprint) || row.fingerprint === "f-config-batch:F4"
    || row.spec?.sourceDomain === "F5" || /^f5-(?:reverse:|reissue$|suspension:)/.test(row.fingerprint)
    || /^f-config:F\.commission\.CM-\d+\.status$/.test(row.fingerprint),
  isValidRecord: row => typeof row.inputFingerprint === "string" && row.inputFingerprint.length > 0,
});
export const commandAttempts = createSlotAttemptStore({ storageKey: "nexion-admin-f-commands-v1" }, fCommands);

export type F2Proposal = F2ActivationAttempt | FDomainAttempt;
export type F2Recovery = F2Proposal & { spec: ProposeSpec; canRetry: boolean; canQuery: boolean; canRelease: boolean };

function actor(adminId: number) {
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== adminId) throw new Error("ADMIN_PERMISSION_DENIED");
  return auth.session;
}

export function f2ProposalAuthority(slot: string) {
  if (slot === F2_POLICY_SLOT || slot === F2_BOOTSTRAP_SLOT) return "network_f2_royalty_rate";
  return fConfigAuthority(slot.replace(/^f-config:/, "")) ?? "network_f2_policy_amplify";
}

function requireWriter(adminId: number, slot: string, spec?: ProposeSpec) {
  const current = actor(adminId);
  const batchIssue = spec?.command.op === "f_config_batch" ? fConfigBatchPermissionIssue(spec.obj.split(","), current.authorities) : undefined;
  if (batchIssue) throw new Error(batchIssue);
  if (spec?.command.op !== "f_config_batch" && !current.authorities.includes(f2ProposalAuthority(slot))
      || !current.authorities.some(a => a === "platform_a2_write" || a === "platform_a2_proposal_create")) {
    throw new Error("ADMIN_PERMISSION_DENIED");
  }
  return current;
}

const storeFor = (slot: string) => slot === F2_ACTIVATION_SLOT ? f2ActivationAttempts : fCommands;
export const forgetF2Proposal = (original: F2Proposal) => storeFor(original.fingerprint).forget(original.fingerprint, original.commandKey);

function remember(original: F2Proposal) {
  if (original.fingerprint === F2_ACTIVATION_SLOT) f2ActivationAttempts.remember(original.fingerprint, original.commandKey, original as F2ActivationAttempt);
  else fCommands.remember(original.fingerprint, original.commandKey, original as FDomainAttempt);
}

export const f2Recovery = createFProposalRecovery<F2Proposal>({
  list: () => [...fCommands.list(), ...f2ActivationAttempts.list()],
  isDurablyStored: (slot, key) => storeFor(slot).isDurablyStored(slot, key),
  markReplayRejected: (slot, key, code) => storeFor(slot).markReplayRejected(slot, key, code),
  forget: (slot, key) => storeFor(slot).forget(slot, key),
}, row => {
  if (!row.spec || !activeRecoveryActor(row.adminId, "network_f2_read")) return false;
  try { requireWriter(row.adminId!, row.fingerprint, row.spec); return true; }
  catch { return false; }
});

export function listF2Proposals(adminId: number): F2Recovery[] {
  const session = useAdminAuth.getState().session;
  return [...fCommands.list().filter(row => isF2Slot(row.fingerprint)), ...f2ActivationAttempts.list()]
    .filter(row => row.adminId === undefined || row.adminId === adminId)
    .map(row => ({ ...row,
      // Old slots saved only fingerprints: show evidence, never fabricate a POST.
      spec: row.spec ?? { action: "团队奖励参数调整", obj: row.fingerprint === F2_BOOTSTRAP_SLOT ? "unilevel_bootstrap/current" : row.fingerprint === F2_POLICY_SLOT ? "current" : row.fingerprint === F2_BATCH_SLOT ? Array.from({ length: 7 }, (_, i) => `F.unilevel.L${i + 1}.paused`).join(",") : row.fingerprint.replace(/^f-config:/, ""),
        before: "—", after: "—", reason: "—", sourceDomain: "F2", type: "param", gate: { roles: [] }, gateLabel: "",
        command: { domain: "F", op: row.fingerprint === F2_BOOTSTRAP_SLOT ? "f_unilevel_bootstrap" : row.fingerprint === F2_POLICY_SLOT ? "f_direct_referral_policy" : row.fingerprint === F2_BATCH_SLOT ? "f_config_batch" : /^f-config:F\.unilevel\.(?:nex\.)?L[1-7]$/.test(row.fingerprint) ? "f_unilevel_rule" : "f_ui_config", params: {} } },
      canQuery: !!session && session.adminId === adminId && session.authorities.some(a => a === "platform_a2_read" || a === "platform_a2_proposal_create"),
      canRetry: !f2Recovery.state(row).replayBlock,
      canRelease: !!row.replayRejection,
    }));
}

export function f2ProposalRecord(adminId: number, slot: string) {
  return listF2Proposals(adminId).find(row => row.fingerprint === slot);
}

async function checkTicket(original: F2Proposal, ticket: A2OperationRow) {
  const op = original.spec?.command.op;
  // 111e00cd ticketMetadata returns command.op for all F command tickets.
  // Descriptors rewrite action/before/type; those are not identity checks.
  if (!ticket.mine || !op || ticket.operationCode !== op || !original.spec || !await fConfigObjectMatches(op, original.spec.obj, ticket.obj)) {
    throw new Error("F2_PROPOSAL_RESPONSE_MISMATCH");
  }
  // b72c1c26: only the server's validated numeric projection is approval evidence.
  // Keep original.request unchanged so recovery posts the identical body and hash.
  return op === "f_unilevel_bootstrap"
    ? { ...original.spec, action: ticket.action, before: ticket.before, after: ticket.after }
    : original.spec;
}

export async function queryF2Proposal(adminId: number, original: F2Recovery) {
  actor(adminId);
  return f2Recovery.queryTicket("F2", original, async record => {
    const ticket = await fetchA2ProposalByKey(record.commandKey, true, "f");
    if (!activeRecoveryActor(adminId, "network_f2_read")) throw new Error("ADMIN_PERMISSION_DENIED");
    if (!ticket && (record.received || record.ticket)) throw new Error("F2_PROPOSAL_STATUS_UNAVAILABLE");
    if (ticket) await checkTicket(record, ticket);
    return ticket;
  }, (record, ticket) => remember({ ...record, ticket, received: true, absent: false }));
}

/** Persist the exact request before POST. Replay never rebuilds current inputs. */
export async function sendF2Proposal(adminId: number, slot: string, spec?: ProposeSpec, ranked = false, f2DirectBaseline?: FDomainAttempt["f2DirectBaseline"]) {
  let original = f2ProposalRecord(adminId, slot);
  const current = requireWriter(adminId, slot, spec ?? original?.spec);
  const recovering = !spec;
  if (spec && original) throw new Error("F2_PROPOSAL_UNRESOLVED");
  if (!original) {
    if (!spec) throw new Error("F2_PROPOSAL_ORIGINAL_MISSING");
    if (spec.command.op === "f_unilevel_bootstrap") validateF2UnilevelBootstrap(spec.command.params, ranked);
    const request = {
      action: spec.action, obj: spec.obj, beforeValue: spec.before, afterValue: spec.after,
      operator: current.operator || current.username, operatorRole: roleLabel(current.role),
      type: spec.type, amplifies: !!spec.amplifies, sos: !!spec.sos, roleGate: spec.gateLabel,
      reason: spec.reason, sourceDomain: spec.sourceDomain, command: spec.command, target: spec.target, targets: spec.targets,
    };
    const commandKey = createA2CommandKey(slot.split(":")[0]);
    if (slot === F2_ACTIVATION_SLOT) f2ActivationAttempts.remember(slot, commandKey, { adminId, spec, request });
    else fCommands.remember(slot, commandKey, { adminId, spec, request, inputFingerprint: JSON.stringify(request), f2DirectBaseline });
    original = f2ProposalRecord(adminId, slot)!;
    if (!storeFor(slot).isDurablyStored(slot, commandKey)) {
      forgetF2Proposal(original);
      throw new Error("F2_PROPOSAL_STORAGE_UNAVAILABLE");
    }
  }
  if (original.received || original.ticket) {
    const latest = await queryF2Proposal(adminId, original);
    if (!latest) throw new Error("F2_PROPOSAL_STATUS_UNAVAILABLE");
    return latest;
  }
  if (!original.request || !storeFor(slot).isDurablyStored(slot, original.commandKey)) throw new Error("F2_PROPOSAL_ORIGINAL_INCOMPLETE");
  const send = (record: F2Proposal) => createA2OperationProposal(record.request!, record.commandKey, "proposal");
  let ticket: A2OperationRow;
  try {
    ticket = recovering ? await f2Recovery.replay(original, send) : await send(original);
  } catch (error) {
    const failure = error as { httpStatus?: number; apiCode?: number };
    if (!recovering && !isA2OutcomeUncertainError(error)
        && failure.httpStatus !== undefined && isDeterministicRejection(failure.httpStatus, failure.apiCode)) forgetF2Proposal(original);
    throw error;
  }
  // Replayed POST receipts are historical. Only GET can establish current status.
  remember({ ...original, received: true, ticket: undefined, absent: false });
  const ticketSpec = await checkTicket(original, ticket);
  if (recovering) {
    const latest = await queryF2Proposal(adminId, { ...original, received: true });
    if (!latest) throw new Error("F2_PROPOSAL_STATUS_UNAVAILABLE");
    return latest;
  }
  remember({ ...original, spec: ticketSpec, ticket, received: true, absent: false });
  return ticket;
}

export async function releaseF2Proposal(adminId: number, original: F2Recovery) {
  actor(adminId);
  if (!f2Recovery.releaseRejectedReplay(original)) throw new Error("F2_PROPOSAL_UNRESOLVED");
}

/** Match real A2 lock targets using the queue's obj and operationCode. */
export function f2PendingFor(rows: A2OperationRow[], key: string) {
  return rows.find(row => row.status === "pending" && (
    key === F2_BOOTSTRAP_SLOT ? row.operationCode === "f_unilevel_bootstrap" && row.obj === "unilevel_bootstrap/current"
      : key === F2_ACTIVATION_SLOT ? row.operationCode === "f_seven_layer_activation" && row.obj === "current"
      : key === F2_POLICY_SLOT ? row.operationCode === "f_direct_referral_policy" && row.obj === "current"
        : key === F2_BATCH_SLOT ? ["f_config_batch", "f_ui_config"].includes(row.operationCode ?? "") && row.obj.split(",").some(k => /^F\.unilevel\.L[1-7]\.paused$/.test(k.trim()))
          : /^F\.unilevel\.(?:nex\.)?L[1-7]$/.test(key) ? row.operationCode === "f_unilevel_rule" && row.obj.replace(".nex.", ".") === key.replace(".nex.", ".")
            : row.operationCode === "f_ui_config" && row.obj === key));
}
