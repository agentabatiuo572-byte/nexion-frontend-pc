import { A2OutcomeUncertainError, createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError, type A2OperationRow } from "./a2-client";
import { fCommands, type FDomainAttempt } from "./f2-approval";
import { configApprovalAttempts, configApprovalOriginalInput } from "./withdrawal-config-approval";
import { isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection } from "./outcome-classification";
import { isRetryExpired } from "./pending-mutation-store";
import type { F3BinaryOverview } from "./f1-client";
import type { ProposeSpec } from "./propose-or-execute";
import { roleLabel } from "../nav/console-nav";
import { useAdminAuth } from "../store/admin-auth";

export type F3ConfirmationSnapshot = Pick<F3BinaryOverview, "config" | "configValues" | "dailyCap" | "coverage"> & { zoneId: string | null; zoneLabel: string };
export const F3_SETTLEMENT_SLOT = "f3-binary-settle";
export const F3_BATCH_SLOT = "f-config-batch:F3";
export const f3ConfigSlot = (key: string) => `f-config:${key}`;
const fundSlot = (adminId: number) => `${adminId}:F3`;
const isFund = (row: FDomainAttempt) => row.fingerprint.endsWith(":F3") && row.fingerprint !== F3_BATCH_SLOT;

export function listF3Proposals(adminId: number): FDomainAttempt[] {
  const configs = fCommands.list().filter(row => row.spec?.sourceDomain === "F3"
    || row.fingerprint === F3_BATCH_SLOT || row.fingerprint.startsWith("f-config:F.binary."))
    .filter(row => row.adminId === undefined || row.adminId === adminId)
    .map(row => row.spec ? row : { ...row, spec: {
      action: row.fingerprint === F3_BATCH_SLOT ? "结算周期与未匹配订单额处理调整" : "F 域配置调整",
      obj: row.fingerprint === F3_BATCH_SLOT ? "F.binary.settlePeriod,F.binary.residualPolicy" : row.fingerprint.replace(/^f-config:/, ""),
      before: "—", after: "—", reason: "—", sourceDomain: "F3", type: "param" as const, gate: { roles: [] }, gateLabel: "",
      command: { domain: "F", op: row.fingerprint === F3_BATCH_SLOT ? "f_config_batch" : "f_ui_config", params: {} },
    } });
  const fund = configApprovalAttempts.list().find(row => row.fingerprint === fundSlot(adminId));
  if (!fund) return configs;
  let spec = fund.spec;
  if (!spec) {
    // Old settlement records contain values/reason only. They remain queryable,
    // but cannot reconstruct an exact original POST/operator after an upgrade.
    const [values, reason] = configApprovalOriginalInput("F3", fund.input);
    const original = values as { ownerUserId: number; settlementDate: string };
    spec = settlementSpec(original, reason);
  }
  return [...configs, { ...fund, adminId, spec, inputFingerprint: fund.input }];
}

function actor(adminId: number) {
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== adminId) throw new Error("ADMIN_PERMISSION_DENIED");
  return auth.session;
}

export function f3ProposalAuthority(original: FDomainAttempt | ProposeSpec) {
  const spec = "fingerprint" in original ? original.spec : original;
  return spec?.command.op === "f3_binary_settle" ? "network_f3_write"
    : spec?.obj === "F.binary.paused" ? "network_f3_engine_pause" : "network_f3_match_rate";
}

export function canRetryF3Proposal(original: FDomainAttempt) {
  const session = useAdminAuth.getState().session;
  return !!original.request && !original.ticket && !original.received && !isRetryExpired(original) && !!session
    && (original.adminId === undefined || session.adminId === original.adminId)
    && session.authorities.includes(f3ProposalAuthority(original))
    && (original.spec?.command.op === "f3_binary_settle"
      || session.authorities.some(a => a === "platform_a2_write" || a === "platform_a2_proposal_create"));
}

function remember(original: FDomainAttempt) {
  if (isFund(original)) configApprovalAttempts.remember(original.fingerprint, original.commandKey, { ...original, input: original.inputFingerprint });
  else fCommands.remember(original.fingerprint, original.commandKey, original);
}

function forget(original: FDomainAttempt) {
  (isFund(original) ? configApprovalAttempts : fCommands).forget(original.fingerprint, original.commandKey);
}

function durable(original: FDomainAttempt) {
  return (isFund(original) ? configApprovalAttempts : fCommands).isDurablyStored(original.fingerprint, original.commandKey);
}

function checkTicket(original: FDomainAttempt, ticket: A2OperationRow) {
  // 111e00cd OpsAuditCenterService.ticketMetadata includes command.op for F.
  // The descriptor rewrites the visible action/before/after, so compare identity.
  if (!ticket.mine || !original.spec || ticket.obj !== original.spec.obj || ticket.operationCode !== original.spec.command.op) {
    throw new A2OutcomeUncertainError("原审批单与保存的操作对不上，请到操作记录核对。", original.commandKey);
  }
}

export async function queryF3Proposal(adminId: number, original: FDomainAttempt) {
  actor(adminId); // Lookup deliberately does not require the current write grant.
  if (original.adminId !== undefined && original.adminId !== adminId) throw new Error("ADMIN_PERMISSION_DENIED");
  remember({ ...original, absent: false });
  const ticket = await fetchA2ProposalByKey(original.commandKey, true, "f");
  if (!ticket) {
    remember({ ...original, ticket: undefined, absent: true });
    return null;
  }
  checkTicket(original, ticket);
  if (ticket.status === "pending") remember({ ...original, received: true, ticket, absent: false });
  else forget(original);
  return ticket;
}

export function settlementSpec(values: { ownerUserId: number; settlementDate: string }, reason: string): ProposeSpec {
  const obj = `${values.ownerUserId}:${values.settlementDate}`;
  return { action: "手动结算团队平衡奖励", obj, before: "—", after: "—", type: "fund", amplifies: true,
    sos: false, gate: { roles: [] }, gateLabel: "超管", reason, sourceDomain: "F3",
    command: { domain: "F", op: "f3_binary_settle", params: { values } }, target: { domain: "F", type: "binary_settlement", id: obj } };
}

/** Full request is saved before POST; retained retries never read current inputs. */
export async function sendF3Proposal(adminId: number, slot: string, spec?: ProposeSpec, snapshot?: F3ConfirmationSnapshot) {
  const current = actor(adminId);
  const actualSlot = slot === F3_SETTLEMENT_SLOT ? fundSlot(adminId) : slot;
  let original = listF3Proposals(adminId).find(row => row.fingerprint === actualSlot);
  const recovering = !spec;
  if (spec && original) throw new A2OutcomeUncertainError("请先查询保存的原操作。", original.commandKey);
  const intent = spec ?? original?.spec;
  if (!intent) throw new Error("F3_PROPOSAL_ORIGINAL_INCOMPLETE");
  if (!current.authorities.includes(f3ProposalAuthority(intent))
      || intent.command.op !== "f3_binary_settle"
        && !current.authorities.some(a => a === "platform_a2_write" || a === "platform_a2_proposal_create")) throw new Error("ADMIN_PERMISSION_DENIED");
  if (!original) {
    const request = {
      action: intent.action, obj: intent.obj, beforeValue: intent.before, afterValue: intent.after,
      operator: current.operator || current.username, operatorRole: roleLabel(current.role),
      type: intent.type, amplifies: !!intent.amplifies, sos: !!intent.sos, roleGate: intent.gateLabel,
      reason: intent.reason, sourceDomain: intent.sourceDomain, command: intent.command, target: intent.target, targets: intent.targets,
    };
    const commandKey = createA2CommandKey(slot.split(":")[0]);
    remember({ fingerprint: actualSlot, commandKey, createdAt: Date.now(), expiresAt: 0,
      adminId, spec: intent, request, f3Snapshot: snapshot, inputFingerprint: JSON.stringify(request) });
    original = listF3Proposals(adminId).find(row => row.commandKey === commandKey)!;
    if (!durable(original)) {
      forget(original);
      throw new Error("F3_PROPOSAL_STORAGE_UNAVAILABLE");
    }
  }
  if (isRetryExpired(original)) throw new A2OutcomeUncertainError("原操作已超过 24 小时，只能查询原结果。", original.commandKey);
  if (!original.request || !durable(original)) throw new Error("F3_PROPOSAL_ORIGINAL_INCOMPLETE");
  if (original.received || original.ticket) return queryReceivedF3Proposal(adminId, original);
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
  if (recovering) {
    return queryReceivedF3Proposal(adminId, { ...original, received: true });
  }
  remember({ ...original, received: true, ticket, absent: false });
  return ticket;
}

/** A successful historical POST proves creation, not the ticket's current status. */
async function queryReceivedF3Proposal(adminId: number, original: FDomainAttempt) {
  let ticket: A2OperationRow | null;
  try { ticket = await queryF3Proposal(adminId, original); }
  catch { throw new A2OutcomeUncertainError("原申请建过单，批没批准还没查到，请继续查询。", original.commandKey); }
  if (!ticket) throw new A2OutcomeUncertainError("原申请建过单，批没批准还没查到，请继续查询。", original.commandKey);
  return ticket;
}

/** R1-提案过期: invoke only after an explicit confirmation in the visual layer. */
export async function releaseF3Proposal(adminId: number, original: FDomainAttempt) {
  if (!isRetryExpired(original)) throw new Error("原操作尚未过期，请先查询原结果。");
  const ticket = await queryF3Proposal(adminId, original);
  if (ticket?.status === "pending") throw new Error("这张申请仍在等待审批。");
  if (!ticket) forget(original);
}

export function f3PendingFor(rows: A2OperationRow[], key: string) {
  return rows.find(row => row.status === "pending" && ["f_ui_config", "f_config_batch"].includes(row.operationCode ?? "")
    && row.obj.split(",").some(obj => obj.trim() === key));
}
