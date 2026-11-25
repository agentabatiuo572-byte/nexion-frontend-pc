import { useCallback, useEffect, useState } from "react";
import { explicitRejectionCode, isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection, OutcomeUnknownError } from "./outcome-classification";
import { createPendingMutationStore, createPendingRecovery, isRetryExpired, type PendingMutationRecord } from "./pending-mutation-store";
import { currentRecoveryActor, recoveryQueryConclusion } from "./abe-recovery-access";
import { fetchDirectCommandReceipt } from "./direct-command-receipt";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { fundCommandOrigin, fundCommandSettled, type FundCommandOrigin, type FundCommandEvidence } from "./fund-command-investigation";
import { isOriginalCommandOrigin, queryOriginalCommand } from "./original-command-query";
import {
  createA4IdempotencyKey, redriveAuditedH3DeadOutboxEvent, runA4RetentionNow, transitionA4Lifecycle, updateA4DimensionParam,
  type A4DimensionParam, type A4H3DeadOutboxRedrivePreview, type A4SchemaRegistration,
} from "./a4-client";
import { discoverECommand, eCommandSettled, investigateECommand, type ECommandEvidence } from "./e-command-investigation";

export type A4Original =
  | { kind: "param"; param: A4DimensionParam; value: string }
  | { kind: "lifecycle"; schema: A4SchemaRegistration; target: Exclude<A4SchemaRegistration["lifecycleState"], "new"> }
  | { kind: "retention"; months: string; cutoff: string | null; expectedRetentionMonths?: number }
  | { kind: "redrive"; snapshot: A4H3DeadOutboxRedrivePreview };
export type A4Command = PendingMutationRecord & { verifiedNotExecuted?: true; original: A4Original; reason: string; name: string; change: string; commandOrigin?: FundCommandOrigin };
function directCommandRoute(original: A4Original) {
  if (original.kind === "retention") return null;
  return { originalMethod: original.kind === "param" ? "PATCH" as const : "POST" as const,
    originalPath: original.kind === "param" ? `/api/admin/platform/events/params/${encodeURIComponent(original.param.key)}`
      : original.kind === "lifecycle" ? `/api/admin/platform/events/schema-registrations/${encodeURIComponent(original.schema.eventName)}/lifecycle`
        : `/api/admin/platform/events/outbox/${encodeURIComponent(original.snapshot.eventId)}/redrive`,
    readAuthority: "platform_a4_read" as const };
}
export const a4Slot = (input: A4Original) => input.kind === "param" ? `param:${input.param.key}`
  : input.kind === "lifecycle" ? `lifecycle:${input.schema.eventName}` : input.kind === "redrive" ? `redrive:${input.snapshot.eventId}` : "retention";
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const states = ["new", "pending_publish", "gray", "full", "disabled"];
function validOriginal(input: unknown): input is A4Original {
  if (!object(input)) return false;
  switch (input.kind) {
    case "param": return object(input.param) && ["day0", "event_retention", "sampling"].includes(String(input.param.key))
      && typeof input.param.value === "string" && typeof input.param.name === "string" && typeof input.param.locked === "boolean"
      && typeof input.value === "string";
    case "retention": return typeof input.months === "string" && (input.cutoff === null || typeof input.cutoff === "string")
      && (input.expectedRetentionMonths === undefined || Number.isSafeInteger(input.expectedRetentionMonths) && Number(input.expectedRetentionMonths) > 0);
    case "lifecycle": return object(input.schema) && typeof input.schema.eventName === "string"
      && states.includes(String(input.schema.lifecycleState)) && states.slice(1).includes(String(input.target))
      && Number.isSafeInteger(input.schema.lifecycleVersion) && Number(input.schema.lifecycleVersion) >= 0;
    case "redrive": return object(input.snapshot) && typeof input.snapshot.eventId === "string" && typeof input.snapshot.eventType === "string"
      && input.snapshot.status === "DEAD" && input.snapshot.deliveryStatus === "DEAD"
      && Number.isSafeInteger(input.snapshot.retryCount) && Number(input.snapshot.retryCount) >= 0
      && Number.isSafeInteger(input.snapshot.deliveryAttemptCount) && Number(input.snapshot.deliveryAttemptCount) >= 0
      && (input.snapshot.lastError === null || typeof input.snapshot.lastError === "string")
      && (input.snapshot.deliveryLastError === null || typeof input.snapshot.deliveryLastError === "string");
    default: return false;
  }
}
// One instance for all direct A4 writes. Complete input and reviewed facts survive reloads and expiry.
const commands = createPendingMutationStore<A4Command>({
  storageKey: "nexion-admin-a4-pending-commands-v1", retainExpiredRecords: true,
  isValidRecord: record => validOriginal(record.original) && record.fingerprint === a4Slot(record.original)
    && (record.commandOrigin === undefined || !!directCommandRoute(record.original) && isOriginalCommandOrigin(record.commandOrigin, directCommandRoute(record.original)!))
    && typeof record.reason === "string" && typeof record.name === "string" && typeof record.change === "string",
});

export const a4DirectRecovery = createPendingRecovery(commands, {
  capability: () => "receipt",
  explicitRejectionCode: error => {
    const code = explicitRejectionCode(error);
    return code && !/^REASON_TOO_SHORT_MIN_[1-9][0-9]*$/.test(code) ? code : undefined;
  },
  canReplay: record => {
    const rights = currentRecoveryActor(record.commandOwnerId)?.authorities ?? [];
    return !record.verifiedNotExecuted && rights.includes("platform_a4_read") && rights.includes("platform_a4_write")
      && (!["retention", "redrive"].includes(record.original.kind) || rights.includes("platform_a2_write"));
  },
});

function settleA4Query(saved: A4Command, conclusion: Parameters<typeof a4DirectRecovery.settleFromQuery>[1]) {
  if (conclusion === "rejected" || conclusion === "not-executed") {
    commands.remember(saved.fingerprint, saved.commandKey, { ...saved, verifiedNotExecuted: true });
    return true;
  }
  return a4DirectRecovery.settleFromQuery(saved, conclusion);
}

async function originalA4Status(record: A4Command) {
  const original = record.original;
  const scope = original.kind === "retention" ? "A4_EVENT_RETENTION_RUN"
    : original.kind === "param" ? `A4_PARAM:${original.param.key}`
      : original.kind === "lifecycle" ? `A4_EVENT_LIFECYCLE:${original.schema.eventName.trim().toLowerCase()}`
        : `A4_H3_OUTBOX_REDRIVE:${original.snapshot.eventId}`;
  const actor = currentRecoveryActor(record.commandOwnerId);
  if (!actor) throw new Error("COMMAND_INVESTIGATION_FORBIDDEN");
  return fetchDirectCommandReceipt(scope, record.commandKey, actor.adminId);
}

/** Only the original retention command can settle its record; current cleanup statistics cannot. */
export async function queryA4RetentionCommand(record: A4Command, evidence?: ECommandEvidence) {
  const saved = commands.list().find(row => row.fingerprint === record.fingerprint && row.commandKey === record.commandKey);
  if (!saved || saved.original.kind !== "retention") throw new Error("A4_ORIGINAL_UNRESOLVED");
  const session = useAdminAuth.getState().session;
  if (!session?.authorities.includes("platform_a4_read")) throw new Error("COMMAND_INVESTIGATION_FORBIDDEN");
  const locator = { commandKey: saved.commandKey, originalMethod: "POST" as const,
    originalPath: "/api/admin/platform/events/retention-runs", originalAdminId: String(session.adminId) };
  const result = await a4DirectRecovery.query(saved, async original => {
    try {
      if (!evidence && await originalA4Status(original) === "NOT_FOUND") return { receipt: null, conclusion: "not-found" } as const;
      const receipt = evidence ? await investigateECommand(original, locator, evidence, "platform_a4_read") : await discoverECommand(locator);
      return { receipt, conclusion: receipt && eCommandSettled(receipt) ? recoveryQueryConclusion(receipt.originalStatus) : "unknown" } as const;
    } catch (error) {
      if (!evidence && (error as { status?: number }).status === 422) return { receipt: null, conclusion: "unknown" } as const;
      throw error;
    }
  });
  if (!result) return null;
  settleA4Query(saved, result.conclusion);
  return result.receipt;
}

/** The cleanup command has a separate integration; these are the three other direct A4 writers. */
export async function queryA4DirectCommand(record: A4Command, evidence?: FundCommandEvidence) {
  const saved = commands.list().find(item => item.fingerprint === record.fingerprint && item.commandKey === record.commandKey);
  if (!saved) throw new Error("INVESTIGATION_ORIGINAL_NOT_FOUND_REMAINS_LOCKED");
  const route = directCommandRoute(saved.original);
  if (!route) throw new Error("INVESTIGATION_SCOPE_UNSUPPORTED");
  const owner = saved.commandOrigin?.originalAdminId ?? String(useAdminAuth.getState().session?.adminId ?? "");
  const result = await a4DirectRecovery.query(saved, async original => {
    if (!evidence && await originalA4Status(original) === "NOT_FOUND") return { receipt: null, conclusion: "not-found" } as const;
    const receipt = await queryOriginalCommand(original, route, owner, evidence);
    return { receipt, conclusion: receipt && fundCommandSettled(receipt) ? recoveryQueryConclusion(receipt.originalStatus) : "unknown" } as const;
  });
  if (!result) return { receipt: null, settled: false };
  return { receipt: result.receipt, settled: settleA4Query(saved, result.conclusion) };
}

export function useA4Commands() {
  const [records, setRecords] = useState<A4Command[]>([]);
  const pending = records.filter(record => !record.verifiedNotExecuted);
  const drafts = records.filter(record => record.verifiedNotExecuted);
  const sync = useCallback(() => setRecords(commands.list()), []);
  useEffect(sync, [sync]);
  useEffect(() => {
    const next = pending.filter(record => !isRetryExpired(record)).reduce((at, record) => Math.min(at, record.expiresAt), Infinity);
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(sync, Math.max(1, next - Date.now()));
    return () => window.clearTimeout(timer);
  }, [pending, sync]);
  const find = (slot: string) => commands.list().find(record => record.fingerprint === slot && !record.verifiedNotExecuted);
  const capture = (input: Omit<A4Command, keyof PendingMutationRecord>) => {
    const slot = a4Slot(input.original);
    if (find(slot)) throw new Error("A4_ORIGINAL_UNRESOLVED");
    const key = createA4IdempotencyKey(`a4-${input.original.kind}`);
    const route = directCommandRoute(input.original);
    commands.remember(slot, key, { ...input, ...(route ? { commandOrigin: fundCommandOrigin(route.originalMethod, route.originalPath, route.readAuthority) } : {}) });
    if (!commands.isDurablyStored(slot, key)) {
      commands.forget(slot, key); sync();
      throw new Error("A4_ORIGINAL_STORAGE_FAILED");
    }
    sync();
    return commands.list().find(record => record.commandKey === key)!;
  };
  const sendOriginal = async (record: A4Command, retry: boolean) => {
    if (isRetryExpired(record)) throw new Error("A4_ORIGINAL_QUERY_ONLY");
    if (!commands.isDurablyStored(record.fingerprint, record.commandKey)) throw new Error("A4_ORIGINAL_STORAGE_FAILED");
    try {
      const input = record.original;
      let result;
      switch (input.kind) {
        case "param": await updateA4DimensionParam(input.param.key, input.value, record.reason, record.commandKey); break;
        case "lifecycle": await transitionA4Lifecycle(input.schema.eventName, input.target, input.schema.lifecycleState,
          input.schema.lifecycleVersion, record.reason, record.commandKey); break;
        case "retention": result = await runA4RetentionNow(record.reason, record.commandKey, input.expectedRetentionMonths); break;
        case "redrive": {
          const s = input.snapshot;
          result = await redriveAuditedH3DeadOutboxEvent(s.eventId, s.retryCount, s.deliveryStatus, s.deliveryAttemptCount, record.reason, record.commandKey);
          if (result.eventId !== s.eventId || result.eventType !== s.eventType || result.retryCount !== s.retryCount
            || result.deliveryAttemptCount !== s.deliveryAttemptCount) throw new OutcomeUnknownError("A4_MUTATION_OUTCOME_UNKNOWN");
          break;
        }
      }
      a4DirectRecovery.settleAcknowledged(record); sync();
      return result;
    } catch (error) {
      const failure = error as { status?: number; httpStatus?: number; apiCode?: number; reasonCode?: string };
      // BE 527c388e moved these services' reason checks into the new-execution
      // callbacks. At 03e0bba2 AdminReasonConstraintAdvice.invoke still checks
      // the mutable policy before entering either controller, so this rejection
      // can still hide a completed receipt. Keep the original body/key intact.
      const reasonRecheck = retry && (record.original.kind === "retention" || record.original.kind === "redrive")
        && /^REASON_TOO_SHORT_MIN_[1-9][0-9]*$/.test(failure.reasonCode ?? "");
      if (reasonRecheck) throw new OutcomeUnknownError("A4_ORIGINAL_REASON_RECHECK", { cause: error });
      const rejected = retry ? isExplicitRejection(error) : !failure.reasonCode?.startsWith("IDEMPOTENCY_")
        && isDeterministicRejection(failure.httpStatus ?? failure.status ?? 0, failure.apiCode);
      if (rejected) {
        if (!retry) commands.forget(record.fingerprint, record.commandKey);
        sync();
        throw error;
      }
      sync();
      throw error instanceof OutcomeUnknownError ? error : new OutcomeUnknownError("A4_MUTATION_OUTCOME_UNKNOWN", { cause: error });
    }
  };
  const send = (record: A4Command, retry = false) => retry
    ? a4DirectRecovery.replay(record, original => sendOriginal(original, true)).finally(sync)
    : sendOriginal(record, false);
  const discardDraft = (draft: A4Command) => {
    if (draft.verifiedNotExecuted) commands.forget(draft.fingerprint, draft.commandKey);
    sync();
  };
  return { pending, drafts, find, capture, send, sync, discardDraft };
}
