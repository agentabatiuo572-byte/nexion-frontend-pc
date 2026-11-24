import { useAdminAuth } from "@/lib/store/admin-auth";
import { roleLabel } from "@/lib/nav/console-nav";
import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, type A2OperationRow } from "./a2-client";
import { findHighOp } from "./high-ops-registry";
import { explicitRejectionCode } from "./explicit-rejection";
import { isDeterministicRejection, isOutcomeUnknownError, OutcomeUnknownError } from "./outcome-classification";
import { createPendingMutationStore, hasPersistedPendingCommandOwner, isRetryExpired, RETRY_EXPIRED_TEXT, type SlotAttemptRecord } from "./pending-mutation-store";
import { beginProposalRetry, proposalRetryBlockedReason, releaseRejectedProposal } from "./proposal-recovery";

type Proposal = Parameters<typeof createA2OperationProposal>[0];
type StoredCap = SlotAttemptRecord & { owner?: number; request?: Proposal; receiptKnown?: boolean; ticketStatus?: A2OperationRow["status"]; retryRejection?: string };
export type I3CapCommand = StoredCap & { tier: string; before: string; after: string; reason: string };
// Replace the page's old slot store, keeping its storage key and legacy evidence.
const pending = createPendingMutationStore<StoredCap>({ storageKey: "nexion-admin-i3-campaign-commands-v1", retainExpiredRecords: true });

export function pendingI3CapCommands(): I3CapCommand[] {
  const owner = useAdminAuth.getState().session?.adminId;
  if (owner === undefined) return [];
  return pending.list().flatMap((row) => {
    if (row.owner !== undefined ? row.owner !== owner : !hasPersistedPendingCommandOwner(String(owner))) return [];
    try {
      const input: unknown = JSON.parse(row.inputFingerprint);
      if (!Array.isArray(input) || input.length !== 4 || !input.every((value) => typeof value === "string")) return [];
      const [tier, before, after, reason] = input as string[];
      if (!["critical", "high", "normal", "low"].includes(tier) || row.fingerprint !== `cap|${tier}`) return [];
      let request: Proposal | undefined;
      const value = row.request;
      if (value && value.obj === tier && value.beforeValue === before && value.afterValue === after && value.reason === reason
        && value.sourceDomain === "I3" && value.command?.domain === "I" && value.command.op === "i3_cap_adjust"
        && value.command.params?.tier === tier && value.command.params.cap === after && value.command.params.expectedCap === before
        && value.target?.domain === "I" && value.target.type === "notification_cap" && value.target.id === tier
        && value.type === "param" && value.amplifies === false && value.sos === false
        && [value.action, value.operator, value.operatorRole, value.roleGate].every((text) => typeof text === "string")) request = value;
      return [{ ...row, request, tier, before, after, reason }];
    } catch { return []; }
  });
}

export function i3CapPermission(): string | undefined {
  const session = useAdminAuth.getState().session;
  if (!session?.authorities.includes("content_i3_cap_adjust")) return "缺少通知保留上限调整权限";
  if (!session.authorities.some((code) => code === "platform_a2_write" || code === "platform_a2_proposal_create")) return "缺少提交审批权限";
  return undefined;
}

export function canQueryI3Cap(): boolean {
  // A2 has several independent maker/read paths. Let its authoritative reader guard decide;
  // never couple lookup to CAP write grants or hide recovery after a permission change.
  const auth = useAdminAuth.getState();
  return auth.isAuthenticated && !!auth.session;
}

export function i3CapRetryBlockedReason(original: I3CapCommand) {
  return proposalRetryBlockedReason(original, original.receiptKnown || original.ticketStatus === "pending")
    ?? (!original.request ? "原操作记录不完整，只能查询核对，不能重试。" : i3CapPermission());
}

export async function queryI3CapCommand(saved: I3CapCommand): Promise<A2OperationRow | null> {
  const original = pendingI3CapCommands().find((row) => row.commandKey === saved.commandKey);
  if (!original) throw new Error("原操作已处理，请重新读取后再操作。");
  const ticket = await fetchA2ProposalByKey(original.commandKey, true);
  if (!ticket) {
    if (original.receiptKnown || original.ticketStatus === "pending") throw new Error("申请已提交，当前审批结果还没查到，请保留原记录并查询原结果。");
    pending.remember(original.fingerprint, original.commandKey, { ...original, ticketStatus: undefined });
    return null;
  }
  // The backend rebuilds the action/before/after. I3 operationCode is present at 24972948 (ticketMetadata), not in the old fact baseline.
  if (!ticket.mine || ticket.obj !== original.tier || ticket.action !== `调整通知优先级 CAP · ${original.tier}`
    || ticket.operationCode && ticket.operationCode !== "i3_cap_adjust"
    || ticket.after !== `${Number(original.after)} 条` || !["pending", "approved", "rejected", "withdrawn", "expired"].includes(ticket.status)) {
    throw new Error("返回的审批单与原操作不符，请保留原记录并查询原结果。");
  }
  if (ticket.status === "pending") pending.remember(original.fingerprint, original.commandKey, { ...original, ticketStatus: ticket.status, receiptKnown: true, retryRejection: undefined });
  else pending.forget(original.fingerprint, original.commandKey);
  return ticket;
}

async function send(original: I3CapCommand, retry: boolean): Promise<A2OperationRow> {
  if (!original.request) throw new Error("原操作记录不完整，只能查询核对，不能重试。");
  if (original.receiptKnown) {
    const ticket = await queryI3CapCommand(original);
    if (ticket) return ticket;
    throw new Error("申请已提交，当前审批结果还没查到，请保留原记录并查询原结果。");
  }
  if (isRetryExpired(original)) throw new Error(RETRY_EXPIRED_TEXT);
  const permission = i3CapPermission();
  if (permission) throw new Error(permission);
  if (!pending.isDurablyStored(original.fingerprint, original.commandKey)) throw new Error("浏览器无法保存原操作，尚未提交。请允许会话存储后再试。");
  try {
    await createA2OperationProposal(original.request, original.commandKey, true);
  } catch (error) {
    const failure = error as { status?: number };
    const rejection = retry ? explicitRejectionCode(error) : undefined;
    if (rejection) pending.remember(original.fingerprint, original.commandKey, { ...original, retryRejection: rejection });
    if (!retry && !isOutcomeUnknownError(error) && isDeterministicRejection(failure.status ?? 0)) {
      pending.forget(original.fingerprint, original.commandKey);
      if (error instanceof Error) Object.assign(error, { rejectedCommand: original });
    }
    throw Object.assign(error instanceof Error ? error : new Error("审批提交结果未知"), { commandKey: original.commandKey });
  }
  pending.remember(original.fingerprint, original.commandKey, { ...original, receiptKnown: true });
  // A replayed POST only proves a ticket was created. Always look up its current status.
  try {
    const ticket = await queryI3CapCommand(original);
    if (ticket) return ticket;
  } catch (error) {
    throw Object.assign(new OutcomeUnknownError(`申请已提交，当前审批结果还没查到：${error instanceof Error ? error.message : "请查询原结果"}`), { commandKey: original.commandKey });
  }
  throw Object.assign(new OutcomeUnknownError("申请已提交，当前审批结果还没查到，请保留原记录并查询原结果。"), { commandKey: original.commandKey });
}

export async function retryI3CapCommand(saved: I3CapCommand): Promise<A2OperationRow> {
  const original = pendingI3CapCommands().find((row) => row.commandKey === saved.commandKey);
  if (!original) throw new Error("原操作已处理，请重新读取后再操作。");
  const blocked = i3CapRetryBlockedReason(original);
  if (blocked) throw new Error(blocked);
  beginProposalRetry(original);
  return send(original, true);
}

export function releaseRejectedI3Cap(saved: I3CapCommand) {
  releaseRejectedProposal(pendingI3CapCommands().find(row => row.commandKey === saved.commandKey),
    row => pending.forget(row.fingerprint, row.commandKey));
}

export async function proposeI3Cap(tier: string, before: string, after: string, reason: string): Promise<A2OperationRow> {
  const permission = i3CapPermission();
  if (permission) throw new Error(permission);
  if (pendingI3CapCommands().some((row) => row.tier === tier)) throw new Error("此对象有原操作尚未核清，请先查询原结果。");
  const session = useAdminAuth.getState().session!;
  const def = findHighOp("i3_cap_adjust")!;
  const request: Proposal = {
    action: `调整通知保留数量 · ${tier}`, obj: tier, beforeValue: before, afterValue: after,
    operator: session.operator || session.username, operatorRole: roleLabel(session.role), type: "param", amplifies: false, sos: false,
    roleGate: def.gateLabel, reason, sourceDomain: "I3", command: def.buildCommand({ tier, cap: after, expectedCap: before }), target: def.buildTarget({ tier }),
  };
  const commandKey = createA2CommandKey("i3-cap-adjust");
  const fingerprint = `cap|${tier}`;
  pending.remember(fingerprint, commandKey, { owner: session.adminId, inputFingerprint: JSON.stringify([tier, before, after, reason]), request });
  const original = pendingI3CapCommands().find((row) => row.commandKey === commandKey)!;
  if (!pending.isDurablyStored(fingerprint, commandKey)) {
    pending.forget(fingerprint, commandKey);
    throw new Error("浏览器无法保存原操作，尚未提交。请允许会话存储后再试。");
  }
  return send(original, false);
}
