import { acknowledgeFReconfirmation, settleFReconfirmation, type FReconfirmationLink } from "./f-reconfirmation";
import { activeRecoveryActor } from "./f-proposal-recovery";
import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, A2OutcomeUncertainError, isA2OutcomeUncertainError, type A2OperationRow } from "./a2-client";
import { createH8CommandKey, growthRequest, h8RewardParamAmplifies, h8RewardParamValid, parseH8RewardSnapshot, type H8ReferralRewardOverview, type H8RewardParamKey } from "./h-client";
import { explicitRejectionCode } from "./explicit-rejection";
import { isDeterministicRejection, isOutcomeUnknownError, OutcomeUnknownError } from "./outcome-classification";
import { createPendingMutationStore, createPendingRecovery, hasPersistedPendingCommandOwner, PENDING_MUTATION_TTL_MS, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "./pending-mutation-store";
import { configApprovalAttempts, configApprovalOriginalInput, pendingConfigApproval, releaseConfigApproval, storeH8ConfigApproval } from "./withdrawal-config-approval";
import { useAdminAuth } from "@/lib/store/admin-auth";

type Proposal = Parameters<typeof createA2OperationProposal>[0];
export type H8Original = { overview: H8ReferralRewardOverview; body: string } & FReconfirmationLink & (
  | { kind: "direct"; paramKey: H8RewardParamKey; value: string; reason: string; operator: string }
  | { kind: "param-approval"; paramKey: H8RewardParamKey; value: string; request: Proposal }
  | { kind: "settlement"; invitedUserId?: number; limit: number; request: Proposal }
);
export type H8RewardCommand = PendingMutationRecord & FReconfirmationLink & {
  adminId: number; kind: H8Original["kind"]; paramKey?: H8RewardParamKey; value?: string;
  invitedUserId?: number; limit?: number;
  original?: H8Original; ticket?: A2OperationRow; acknowledged?: boolean;
};
type StoredCommand = PendingMutationRecord & { original?: H8Original; adminId?: number; ticket?: A2OperationRow; acknowledged?: boolean; inputFingerprint?: string };
const PARAM_KEYS: H8RewardParamKey[] = ["enabled", "newcomer.usdt", "newcomer.nex", "newcomer.lockMode", "inviter.nex"];

/** sessionStorage is an input boundary. Legacy key-only records remain query-only evidence. */
function validOriginal(original: H8Original) {
  try {
    parseH8RewardSnapshot(original.overview);
    if (typeof original.body !== "string") return false;
    if (original.kind === "direct") {
      const body = JSON.parse(original.body);
      return PARAM_KEYS.includes(original.paramKey) && h8RewardParamValid(original.paramKey, original.value)
        && typeof original.reason === "string" && typeof original.operator === "string"
        && body.key === original.paramKey && body.value === original.value && body.expectedVersion === original.overview.version
        && body.reason === original.reason && body.operator === original.operator;
    }
    if (original.kind !== "param-approval" && original.kind !== "settlement") return false;
    const p = original.request;
    if (original.body !== JSON.stringify(p) || p.sourceDomain !== "H8" || typeof p.reason !== "string"
      || typeof p.operator !== "string" || typeof p.operatorRole !== "string" || p.command.domain !== "H" || p.target?.domain !== "H") return false;
    if (original.kind === "param-approval") {
      const values = p.command.params.values as Record<string, unknown>;
      return PARAM_KEYS.includes(original.paramKey) && h8RewardParamValid(original.paramKey, original.value)
        && p.obj === "current" && p.command.op === "h8_reward_param_change"
        && values.key === original.paramKey && values.value === original.value && values.expectedVersion === original.overview.version
        && p.target.type === "h8_reward_policy" && p.target.id === "current";
    }
    const targeted = original.invitedUserId !== undefined;
    return Number.isSafeInteger(original.limit) && original.limit >= 1 && original.limit <= 100
      && (!targeted || Number.isSafeInteger(original.invitedUserId) && original.invitedUserId! > 0)
      && p.obj === (targeted ? `新人 ${original.invitedUserId}` : "待结算邀请批次")
      && p.command.op === (targeted ? "h8_referral_settlement_user" : "h8_referral_settlement")
      && (targeted ? p.command.params.invitedUserId === original.invitedUserId : p.command.params.limit === original.limit)
      && p.command.params.expectedH8Version === original.overview.version
      && p.command.params.expectedRhythmMonth === original.overview.rhythmMonth
      && p.command.params.rewardSnapshotHash === original.overview.rewardSnapshotHash
      && p.target.type === "referral_settlement_batch" && p.target.id === "pending";
  } catch { return false; }
}

// Sole instance for the existing H8 key. No expiring or fingerprint-based replacement of an unresolved request.
const commands = createPendingMutationStore<StoredCommand>({
  storageKey: "nexion-admin-h8-commands-v1", retainExpiredRecords: true,
  isValidRecord: r => r.original ? Number.isSafeInteger(r.adminId) && validOriginal(r.original) : typeof r.inputFingerprint === "string",
});

export function pendingH8RewardCommands(adminId: number): H8RewardCommand[] {
  const result: H8RewardCommand[] = [];
  for (const record of commands.list()) {
    if (record.original && record.adminId === adminId) {
      result.push({ ...record, adminId, kind: record.original.kind, continuedFrom: record.original.continuedFrom,
        ...(record.original.kind !== "settlement" ? { paramKey: record.original.paramKey, value: record.original.value }
          : { invitedUserId: record.original.invitedUserId, limit: record.original.limit }) });
    } else if (!record.original) {
      const [owner, kind, target] = record.fingerprint.split("|");
      let input: unknown = null;
      try { input = JSON.parse(record.inputFingerprint!); } catch { /* Keep the original key even if its legacy display fingerprint is unreadable. */ }
      const value = Array.isArray(input) ? input[0] : undefined;
      if (owner === String(adminId) && kind === "param" && PARAM_KEYS.includes(target as H8RewardParamKey)) {
        result.push({ ...record, adminId, kind: "direct", paramKey: target as H8RewardParamKey, value: typeof value === "string" ? value : undefined });
      } else if (owner === "settle" && hasPersistedPendingCommandOwner(String(adminId))) {
        result.push({ ...record, adminId, kind: "settlement", ...(kind === "user" ? { invitedUserId: Number(target) }
          : { limit: typeof value === "number" ? value : undefined }) });
      }
    }
  }
  for (const paramKey of PARAM_KEYS) {
    const record = pendingConfigApproval("H8", adminId, { objectId: "current", field: paramKey });
    if (!record) continue;
    let value: string | undefined;
    try { value = configApprovalOriginalInput("H8", record.input)[0].value; } catch { /* Query-only evidence still retains its original key. */ }
    result.push({ ...record, adminId, kind: "param-approval", paramKey,
      original: record.h8Original && validOriginal(record.h8Original) ? record.h8Original : undefined,
      continuedFrom: record.h8Original?.continuedFrom,
      value,
      ticket: record.h8Ticket, acknowledged: record.h8Acknowledged });
  }
  return result;
}

export function requireH8Actor(adminId: number, write?: "param" | "settlement") {
  const auth = useAdminAuth.getState(), session = auth.session;
  if (!auth.isAuthenticated || auth.logoutPending || auth.logoutUnknown || session?.passwordChangeRequired || session?.adminId !== adminId) throw new Error("ADMIN_AUTH_REQUIRED");
  if (write && !session.authorities.includes(write === "param" ? "growth_h8_write" : "growth_h8_settle")) throw new Error("ACCESS_DENIED");
  if (write === "settlement" && !session.authorities.some(a => a === "platform_a2_proposal_create" || a === "platform_a2_write")) throw new Error("A2_PROPOSAL_CREATE_FORBIDDEN");
  return session;
}

export function createH8RewardCommand(adminId: number, original: H8Original): H8RewardCommand {
  const now = Date.now();
  return { adminId, original, kind: original.kind, continuedFrom: original.continuedFrom,
    ...(original.kind !== "settlement" ? { paramKey: original.paramKey, value: original.value } : {}),
    fingerprint: original.kind === "param-approval" ? `${adminId}:H8:current:${original.paramKey}`
      : original.kind === "direct" ? `${adminId}|param|${original.paramKey}` : `${adminId}|settle`,
    commandKey: original.kind === "param-approval" ? createA2CommandKey("h8_reward_param_change") : createH8CommandKey(original.kind === "direct" ? "h8-param" : "h8-settle"),
    createdAt: now, expiresAt: now + PENDING_MUTATION_TTL_MS };
}

function remember(record: H8RewardCommand, storageErrorCode: string) {
  if (record.kind === "param-approval") {
    const original = record.original;
    const previous = pendingConfigApproval("H8", record.adminId, { objectId: "current", field: record.paramKey! });
    storeH8ConfigApproval(record.adminId, record.paramKey!, record.commandKey, {
      input: previous?.input ?? JSON.stringify([{ key: record.paramKey, value: record.value, expectedVersion: original?.overview.version }, original?.kind === "param-approval" ? original.request.reason : ""]),
      h8Original: original, h8Ticket: record.ticket, h8Acknowledged: record.acknowledged,
    }, storageErrorCode);
  } else {
    commands.remember(record.fingerprint, record.commandKey, record);
    if (!commands.isDurablyStored(record.fingerprint, record.commandKey)) throw new Error(storageErrorCode);
  }
}
function forget(record: H8RewardCommand) {
  if (record.kind === "param-approval") releaseConfigApproval("H8", record.adminId, record.commandKey, { objectId: "current", field: record.paramKey! });
  else commands.forget(record.fingerprint, record.commandKey);
}
const storeFor = (slot: string) => slot.includes(":H8:") ? configApprovalAttempts : commands;
function h8RejectionCode(error: unknown) {
  if (error && typeof error === "object" && "status" in error && "apiCode" in error
    && typeof error.status === "number" && error.status >= 200 && error.status < 300
    && typeof error.apiCode === "number" && error.apiCode >= 400 && error.apiCode < 500) {
    return explicitRejectionCode(Object.assign(error, { status: error.apiCode }));
  }
  return explicitRejectionCode(error);
}

export const h8Recovery = createPendingRecovery<H8RewardCommand>({
  list: () => {
    const owner = useAdminAuth.getState().session?.adminId;
    return owner === undefined ? [] : pendingH8RewardCommands(owner);
  },
  isDurablyStored: (slot, key) => storeFor(slot).isDurablyStored(slot, key),
  markReplayRejected: (slot, key, code) => storeFor(slot).markReplayRejected(slot, key, code),
  forget: (slot, key) => storeFor(slot).forget(slot, key),
}, {
  capability: record => record.kind === "direct" ? record.original ? "replay" : "readback" : "receipt",
  canReplay: record => {
    if (!activeRecoveryActor(record.adminId, "growth_h8_read") || !record.original
      || record.acknowledged || record.ticket || Date.now() < record.createdAt) return false;
    try { requireH8Actor(record.adminId, record.kind === "settlement" ? "settlement" : "param"); return true; }
    catch { return false; }
  },
  explicitRejectionCode: h8RejectionCode,
});
export const canRetryH8RewardCommand = (record: H8RewardCommand) => !h8Recovery.state(record).replayBlock;

export function hasPendingH8Policy(records: readonly H8RewardCommand[]) {
  return records.some(record => record.kind === "param-approval" && record.ticket?.status === "pending");
}

export function unresolvedH8Policy(adminId: number) {
  return pendingH8RewardCommands(adminId).find(record => record.kind !== "settlement" && !record.ticket);
}

function checkTicket(record: H8RewardCommand, ticket: A2OperationRow) {
  // 111e00cd ticketMetadata now returns command.op for every persisted command, including H8.
  const op = record.kind === "param-approval" ? "h8_reward_param_change"
    : record.invitedUserId !== undefined ? "h8_referral_settlement_user" : "h8_referral_settlement";
  const obj = record.kind === "param-approval" ? "current" : record.invitedUserId !== undefined ? `新人 ${record.invitedUserId}` : "待结算邀请批次";
  const original = record.original;
  const expectedOp = original && original.kind !== "direct" ? original.request.command.op : op;
  const expectedObj = original && original.kind !== "direct" ? original.request.obj : obj;
  if (!ticket.mine || ticket.operationCode !== expectedOp || ticket.obj !== expectedObj
    || !["pending", "approved", "rejected", "withdrawn", "expired"].includes(ticket.status)) {
    throw new A2OutcomeUncertainError("H8_PROPOSAL_RECEIPT_INVALID", record.commandKey);
  }
}

/** Queries never require write permission. A current parameter value cannot settle a direct command. */
export async function queryH8RewardCommand(record: H8RewardCommand) {
  requireH8Actor(record.adminId);
  if (record.kind === "direct") throw new Error("H8_DIRECT_RESULT_REQUIRES_AUDIT");
  const result = await h8Recovery.query(record, async original => {
    const ticket = await fetchA2ProposalByKey(original.commandKey, true, "h8");
    if (!activeRecoveryActor(original.adminId, "growth_h8_read")) throw new Error("ADMIN_PERMISSION_DENIED");
    if (!ticket && (original.ticket || original.acknowledged)) throw new Error("H8_PROPOSAL_STATUS_UNREADABLE");
    if (ticket) checkTicket(original, ticket);
    return { ticket, original, conclusion: !ticket ? "not-found" as const : ticket.status === "approved" ? "succeeded" as const
      : ticket.status === "rejected" ? "rejected" as const : ticket.status === "pending" ? "unknown" as const : "not-executed" as const };
  });
  if (!result) throw new Error("PENDING_QUERY_UNAVAILABLE");
  if (result.ticket?.status === "pending") {
    remember({ ...result.original, ticket: result.ticket, acknowledged: true }, "H8_REQUEST_RESULT_STORAGE_UNAVAILABLE");
    acknowledgeFReconfirmation(result.original);
  }
  else if (result.ticket) settleFReconfirmation(h8Recovery, result.original, result.conclusion, "H8");
  return result.ticket;
}

/** Save the full bytes before dispatch. A retained operation can never be replaced by another value or target. */
export async function sendH8RewardCommand(record: H8RewardCommand, recovering = false, knownPending = false) {
  requireH8Actor(record.adminId);
  const pending = pendingH8RewardCommands(record.adminId);
  if (recovering && !pending.some(r => r.commandKey === record.commandKey)) throw new Error("H8_ORIGINAL_RESOLVED");
  if (!recovering && (record.kind === "settlement" ? pending.some(r => r.kind === "settlement")
    : !!unresolvedH8Policy(record.adminId))) throw new Error("H8_ORIGINAL_UNRESOLVED");
  if (!recovering && record.original?.kind !== "settlement" && (knownPending || hasPendingH8Policy(pending))
    && (record.kind === "param-approval" || record.original?.kind === "direct"
      && h8RewardParamAmplifies(record.original.paramKey, String(record.original.overview.params[record.original.paramKey]), record.original.value))) {
    throw new Error("OBJECT_ALREADY_PENDING");
  }
  if (!record.original || Date.now() >= record.expiresAt) throw new Error(RETRY_EXPIRED_TEXT);
  requireH8Actor(record.adminId, record.kind === "settlement" ? "settlement" : "param");
  if (!recovering) {
    try { remember(record, "H8_REQUEST_STORAGE_UNAVAILABLE"); }
    catch (error) { forget(record); throw error; }
    const saved = pendingH8RewardCommands(record.adminId).find(row => row.commandKey === record.commandKey);
    if (!saved) throw new Error("H8_REQUEST_STORAGE_UNAVAILABLE");
    record = saved;
  }
  const send = async (record: H8RewardCommand) => {
    const original = record.original!;
    if (original.kind === "direct") {
      const receipt = await growthRequest<Record<string, unknown>>(`/referral-rewards/params/${encodeURIComponent(original.paramKey)}`, {
        method: "PATCH", body: original.body, headers: { "Idempotency-Key": record.commandKey },
      }, undefined, true);
      const valueMatches = typeof receipt?.value === "string" && (original.paramKey === "enabled" || original.paramKey === "newcomer.lockMode"
        ? receipt.value === original.value : h8RewardParamValid(original.paramKey, receipt.value)
          && !h8RewardParamAmplifies(original.paramKey, receipt.value, original.value)
          && !h8RewardParamAmplifies(original.paramKey, original.value, receipt.value));
      const versionDelta = receipt?.status === "UPDATED" ? 1 : receipt?.status === "UNCHANGED" ? 0 : undefined;
      if (receipt?.key !== original.paramKey || versionDelta === undefined || receipt.version !== original.overview.version + versionDelta || !valueMatches) throw new OutcomeUnknownError("H8_PARAM_RECEIPT_INVALID");
      const count = receipt.pendingBeforePolicyChange;
      return {
        ticket: null,
        unchanged: receipt.status === "UNCHANGED",
        pendingBeforePolicyChange: typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : undefined,
        priorCohortDisposition: receipt.priorCohortDisposition === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" as const : undefined,
      };
    }
    const receipt = await createA2OperationProposal(JSON.parse(original.body) as Proposal, record.commandKey, true);
    checkTicket(record, receipt);
    return undefined;
  };
  try {
    const result = recovering ? await h8Recovery.replay(record, send) : await send(record);
    if (result) {
      h8Recovery.settleAcknowledged(record);
      if (!result.unchanged) acknowledgeFReconfirmation(record);
      return result;
    }
  } catch (error) {
    const e = error as { status?: number; apiCode?: number; reasonCode?: string; backendMessage?: string; unknownOutcome?: boolean; bodyUnreadable?: boolean };
    const rejected = !isA2OutcomeUncertainError(error) && !isOutcomeUnknownError(error) && !e.unknownOutcome && !e.bodyUnreadable
      && !(e.apiCode && e.apiCode >= 500) && !(e.reasonCode ?? e.backendMessage ?? "").startsWith("IDEMPOTENCY_")
      && isDeterministicRejection(e.status ?? 0, e.apiCode);
    if (recovering && (h8RejectionCode(error) || error instanceof Error && error.message === "PENDING_REPLAY_BLOCKED")) throw error;
    if (!recovering && rejected) { forget(record); throw error; }
    throw new OutcomeUnknownError(error instanceof Error ? error.message : "H8_RESULT_UNKNOWN");
  }
  // An idempotent POST receipt is historical. GET determines the current pending/terminal state.
  const acknowledged = { ...record, acknowledged: true };
  remember(acknowledged, "H8_REQUEST_RESULT_STORAGE_UNAVAILABLE");
  const current = await queryH8RewardCommand(acknowledged);
  if (!current) throw new OutcomeUnknownError("H8_PROPOSAL_STATUS_UNREADABLE");
  return { ticket: current, unchanged: false };
}

export function releaseRejectedH8RewardCommand(record: H8RewardCommand) {
  requireH8Actor(record.adminId);
  if (!h8Recovery.releaseRejectedReplay(record)) throw new Error("H8_PROPOSAL_RELEASE_FORBIDDEN");
}
