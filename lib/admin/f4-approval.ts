import { A2OutcomeUncertainError, createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError, type A2OperationRow } from "./a2-client";
import { fCommands, type FDomainAttempt } from "./f2-approval";
import { configApprovalAttempts, configApprovalOriginalInput } from "./withdrawal-config-approval";
import { isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection } from "./outcome-classification";
import { hasPersistedPendingCommandOwner, isRetryExpired } from "./pending-mutation-store";
import type { F4AmbassadorApplication, F4AmbassadorMaterialPacket, F4AmbassadorPolicy, F4AmbassadorPolicyUpdate, F4LeadershipPoolOverview } from "./f1-client";
import type { ProposeSpec } from "./propose-or-execute";
import { roleLabel } from "../nav/console-nav";
import { useAdminAuth } from "../store/admin-auth";

/** Serializable facts used to reopen the existing confirmation without today's state. */
export type F4ConfirmationSnapshot = {
  action: string;
  overview: F4LeadershipPoolOverview;
  policy: F4AmbassadorPolicy | null;
  period?: "today" | "week" | "month" | "all";
  application?: F4AmbassadorApplication;
  material?: F4AmbassadorMaterialPacket;
  businessValue?: Record<string, string>;
  value?: string;
};
export const F4_POLICY_SLOT = "f4-ambassador-policy-approval";
export function matchesF4Confirmation(row: Pick<FDomainAttempt, "fingerprint" | "f4Snapshot">, snapshot: F4ConfirmationSnapshot) {
  const slot = (value: F4ConfirmationSnapshot) => ["approve", "reject"].includes(value.action)
    ? `f-config:F.ambassador.${value.application!.id}.status`
    : value.action === "settle" ? "f4-settle:current-week" : value.action === "payout" ? "f4-leaderboard:allTime"
      : value.action === "policy" ? "policy" : `f-config:${value.action}`;
  const key = slot(snapshot);
  return row.f4Snapshot ? slot(row.f4Snapshot) === key : key === row.fingerprint
    || key === "policy" && (/^\d+:F4$/.test(row.fingerprint) || /^(?:\d+:)?f4-ambassador-policy$/.test(row.fingerprint));
}
const fundSlot = (adminId: number) => `${adminId}:F4`;
const isFund = (row: FDomainAttempt) => /^\d+:F4$/.test(row.fingerprint);
const isF4Slot = (slot: string) => /^f-config:F\.(?:pool|quota|ambassador|leaderboard)\./.test(slot)
  || /^f4-(?:settle|leaderboard):/.test(slot) || slot === "f-config-batch:F4";

export function f4PolicySpec(values: F4AmbassadorPolicyUpdate, reason: string): ProposeSpec {
  return { action: "提高区域大使申请预算", obj: "default", before: "—", after: "—", type: "fund", amplifies: true,
    sos: false, gate: { roles: [] }, gateLabel: "超管", reason, sourceDomain: "F4",
    command: { domain: "F", op: "f4_ambassador_policy_change", params: { values } }, target: { domain: "F", type: "ambassador_policy", id: "default" } };
}

export function listF4Proposals(adminId: number): FDomainAttempt[] {
  const configs = fCommands.list().filter(row => row.spec?.sourceDomain === "F4" || isF4Slot(row.fingerprint))
    .filter(row => row.adminId === adminId || row.adminId === undefined && hasPersistedPendingCommandOwner(String(adminId)))
    .map(row => {
      const key = row.fingerprint.replace(/^f-config:/, "");
      const op = row.fingerprint.startsWith("f4-settle:") ? "f4_pool_settle"
        : row.fingerprint.startsWith("f4-leaderboard:") ? "f4_leaderboard_period_payout" : "f_ui_config";
      const obj = op === "f4_pool_settle" ? "本周团队激励池" : op === "f4_leaderboard_period_payout" ? `排行榜 ${row.fingerprint.split(":")[1]}`
        : key.match(/^F\.ambassador\.(\d+)\.status$/)?.[1] ?? key;
      return { ...row, adminId, spec: row.spec ?? { action: "F 域配置调整", obj, before: "—", after: "—", reason: "—", sourceDomain: "F4",
        type: "param" as const, gate: { roles: [] }, gateLabel: "", command: { domain: "F", op, params: {} } } };
    });
  const fund = configApprovalAttempts.list().find(row => row.fingerprint === fundSlot(adminId));
  if (!fund) return configs;
  const spec = fund.spec ?? f4PolicySpec(configApprovalOriginalInput("F4", fund.input)[0] as F4AmbassadorPolicyUpdate,
    configApprovalOriginalInput("F4", fund.input)[1]);
  return [...configs, { ...fund, adminId, spec, inputFingerprint: fund.input }];
}

export function f4ProposalAuthority(spec: ProposeSpec) {
  if (["f4_pool_settle", "f4_leaderboard_period_payout", "f4_ambassador_policy_change"].includes(spec.command.op)) return "network_f4_pool_fund";
  const key = String(spec.command.params.key ?? "");
  if (key.startsWith("F.pool.votes.") || key.startsWith("F.quota.")) return "network_f4_write";
  if (key.startsWith("F.ambassador.")) return "network_f4_ambassador_approve";
  if (["F.pool.monthlyCap", "F.pool.settleCron", "F.pool.unlockVRank", "F.leaderboard.minUsd"].includes(key)) return "network_f4_write";
  return key.startsWith("F.leaderboard.") && key !== "F.leaderboard.poolUsd" ? "network_f4_leaderboard_control" : "network_f4_pool_fund";
}

function actor(adminId: number) {
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== adminId) throw new Error("ADMIN_PERMISSION_DENIED");
  return auth.session;
}

export function canRetryF4Proposal(original: FDomainAttempt) {
  const session = useAdminAuth.getState().session;
  return !!session && original.adminId === session.adminId && !!original.request && !!original.spec
    && !original.received && !original.ticket && !isRetryExpired(original)
    && session.authorities.includes(f4ProposalAuthority(original.spec))
    && (original.spec.command.op === "f4_ambassador_policy_change" || session.authorities.some(code => code === "platform_a2_write" || code === "platform_a2_proposal_create"))
    && (!String(original.spec.command.params.key ?? "").startsWith("F.pool.votes.") || session.authorities.includes("network_f4_pool_fund"));
}

function remember(original: FDomainAttempt) {
  if (isFund(original)) configApprovalAttempts.remember(original.fingerprint, original.commandKey, { ...original, input: original.inputFingerprint });
  else fCommands.remember(original.fingerprint, original.commandKey, original);
}
const storeFor = (original: FDomainAttempt) => isFund(original) ? configApprovalAttempts : fCommands;
const forget = (original: FDomainAttempt) => storeFor(original).forget(original.fingerprint, original.commandKey);

function checkTicket(original: FDomainAttempt, ticket: A2OperationRow) {
  // 111e00cd ticketMetadata includes persisted command.op for every F command.
  // Delegated ambassador descriptors rewrite visible action/before/after.
  if (!ticket.mine || !original.spec || ticket.obj !== original.spec.obj || ticket.operationCode !== original.spec.command.op) {
    throw new A2OutcomeUncertainError("原审批单与保存的操作对不上，请到操作记录核对。", original.commandKey);
  }
}

export async function queryF4Proposal(adminId: number, original: FDomainAttempt) {
  actor(adminId); // Read permission is adjudicated by the endpoint, independently of write grants.
  if (original.adminId !== adminId) throw new Error("ADMIN_PERMISSION_DENIED");
  remember({ ...original, absent: false });
  const ticket = await fetchA2ProposalByKey(original.commandKey, true, true);
  if (!ticket) { remember({ ...original, ticket: undefined, absent: true }); return null; }
  checkTicket(original, ticket);
  if (ticket.status === "pending") remember({ ...original, received: true, ticket, absent: false });
  else forget(original);
  return ticket;
}

export async function sendF4Proposal(adminId: number, slot: string, spec?: ProposeSpec, snapshot?: F4ConfirmationSnapshot) {
  const current = actor(adminId);
  const actualSlot = slot === F4_POLICY_SLOT ? fundSlot(adminId) : slot;
  let original = listF4Proposals(adminId).find(row => row.fingerprint === actualSlot);
  const recovering = !spec;
  if (spec && original) throw new A2OutcomeUncertainError("请先查询保存的原操作。", original.commandKey);
  const intent = spec ?? original?.spec;
  if (!intent) throw new Error("F4_PROPOSAL_ORIGINAL_INCOMPLETE");
  if (!current.authorities.includes(f4ProposalAuthority(intent))
    || intent.command.op !== "f4_ambassador_policy_change" && !current.authorities.some(code => code === "platform_a2_write" || code === "platform_a2_proposal_create")
    || String(intent.command.params.key ?? "").startsWith("F.pool.votes.") && !current.authorities.includes("network_f4_pool_fund")) throw new Error("ADMIN_PERMISSION_DENIED");
  if (!original) {
    const request = { action: intent.action, obj: intent.obj, beforeValue: intent.before, afterValue: intent.after,
      operator: current.operator || current.username, operatorRole: roleLabel(current.role), type: intent.type,
      amplifies: !!intent.amplifies, sos: !!intent.sos, roleGate: intent.gateLabel, reason: intent.reason, sourceDomain: intent.sourceDomain,
      command: intent.command, target: intent.target, targets: intent.targets };
    const commandKey = createA2CommandKey(slot.split(":")[0]);
    remember({ fingerprint: actualSlot, commandKey, createdAt: Date.now(), expiresAt: 0,
      adminId, spec: intent, request, f4Snapshot: snapshot, inputFingerprint: JSON.stringify(request) });
    original = listF4Proposals(adminId).find(row => row.commandKey === commandKey)!;
    if (!storeFor(original).isDurablyStored(original.fingerprint, commandKey)) {
      forget(original); throw new Error("F4_OPERATION_STORAGE_UNAVAILABLE");
    }
  }
  if (isRetryExpired(original)) throw new A2OutcomeUncertainError("原操作已超过 24 小时，只能查询原结果。", original.commandKey);
  if (!original.request || !storeFor(original).isDurablyStored(original.fingerprint, original.commandKey)) throw new Error("F4_PROPOSAL_ORIGINAL_INCOMPLETE");
  if (original.received || original.ticket) return queryReceived(adminId, original);
  let ticket: A2OperationRow;
  try { ticket = await createA2OperationProposal(original.request, original.commandKey, "proposal"); }
  catch (error) {
    const failure = error as { httpStatus?: number; apiCode?: number };
    if (recovering ? isExplicitRejection(error) : !isA2OutcomeUncertainError(error)
      && failure.httpStatus !== undefined && isDeterministicRejection(failure.httpStatus, failure.apiCode)) forget(original);
    throw error;
  }
  remember({ ...original, received: true, ticket: undefined, absent: false });
  checkTicket(original, ticket);
  if (recovering) return queryReceived(adminId, { ...original, received: true });
  remember({ ...original, received: true, ticket, absent: false });
  return ticket;
}

async function queryReceived(adminId: number, original: FDomainAttempt) {
  let ticket: A2OperationRow | null;
  try { ticket = await queryF4Proposal(adminId, original); }
  catch { throw new A2OutcomeUncertainError("原申请建过单，批没批准还没查到，请继续查询。", original.commandKey); }
  if (!ticket) throw new A2OutcomeUncertainError("原申请建过单，批没批准还没查到，请继续查询。", original.commandKey);
  return ticket;
}

/** The visual layer must explicitly confirm release after authoritative exact absence. */
export async function releaseF4Proposal(adminId: number, original: FDomainAttempt) {
  if (!isRetryExpired(original)) throw new Error("原操作尚未过期，请先查询原结果。");
  const ticket = await queryF4Proposal(adminId, original);
  if (ticket?.status === "pending") throw new Error("这张申请仍在等待审批。");
  if (!ticket) forget(original);
}

export function f4PendingFor(rows: A2OperationRow[], spec: ProposeSpec) {
  return rows.find(row => row.status === "pending" && row.operationCode === spec.command.op && row.obj === spec.obj);
}
