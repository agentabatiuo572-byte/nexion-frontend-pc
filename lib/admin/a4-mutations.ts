import { useCallback, useEffect, useState } from "react";
import { isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection, OutcomeUnknownError } from "./outcome-classification";
import { createPendingMutationStore, isRetryExpired, type PendingMutationRecord } from "./pending-mutation-store";
import {
  createA4IdempotencyKey, redriveAuditedH3DeadOutboxEvent, runA4RetentionNow, transitionA4Lifecycle, updateA4DimensionParam,
  type A4DimensionParam, type A4H3DeadOutboxRedrivePreview, type A4SchemaRegistration,
} from "./a4-client";

export type A4Original =
  | { kind: "param"; param: A4DimensionParam; value: string }
  | { kind: "lifecycle"; schema: A4SchemaRegistration; target: Exclude<A4SchemaRegistration["lifecycleState"], "new"> }
  | { kind: "retention"; months: string; cutoff: string | null }
  | { kind: "redrive"; snapshot: A4H3DeadOutboxRedrivePreview };
export type A4Command = PendingMutationRecord & { original: A4Original; reason: string; name: string; change: string };
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
    case "retention": return typeof input.months === "string" && (input.cutoff === null || typeof input.cutoff === "string");
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
    && typeof record.reason === "string" && typeof record.name === "string" && typeof record.change === "string",
});

export function useA4Commands() {
  const [pending, setPending] = useState<A4Command[]>([]);
  const sync = useCallback(() => setPending(commands.list()), []);
  useEffect(sync, [sync]);
  useEffect(() => {
    const next = pending.filter(record => !isRetryExpired(record)).reduce((at, record) => Math.min(at, record.expiresAt), Infinity);
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(sync, Math.max(1, next - Date.now()));
    return () => window.clearTimeout(timer);
  }, [pending, sync]);
  const find = (slot: string) => commands.list().find(record => record.fingerprint === slot);
  const capture = (input: Omit<A4Command, keyof PendingMutationRecord>) => {
    const slot = a4Slot(input.original);
    if (find(slot)) throw new Error("A4_ORIGINAL_UNRESOLVED");
    const key = createA4IdempotencyKey(`a4-${input.original.kind}`);
    commands.remember(slot, key, input);
    if (!commands.isDurablyStored(slot, key)) {
      commands.forget(slot, key); sync();
      throw new Error("A4_ORIGINAL_STORAGE_FAILED");
    }
    sync();
    return commands.list().find(record => record.commandKey === key)!;
  };
  const send = async (record: A4Command, retry = false) => {
    if (isRetryExpired(record)) throw new Error("A4_ORIGINAL_QUERY_ONLY");
    if (!commands.isDurablyStored(record.fingerprint, record.commandKey)) throw new Error("A4_ORIGINAL_STORAGE_FAILED");
    try {
      const input = record.original;
      let result;
      switch (input.kind) {
        case "param": await updateA4DimensionParam(input.param.key, input.value, record.reason, record.commandKey); break;
        case "lifecycle": await transitionA4Lifecycle(input.schema.eventName, input.target, input.schema.lifecycleState,
          input.schema.lifecycleVersion, record.reason, record.commandKey); break;
        case "retention": result = await runA4RetentionNow(record.reason, record.commandKey); break;
        case "redrive": {
          const s = input.snapshot;
          result = await redriveAuditedH3DeadOutboxEvent(s.eventId, s.retryCount, s.deliveryStatus, s.deliveryAttemptCount, record.reason, record.commandKey);
          if (result.eventId !== s.eventId || result.eventType !== s.eventType || result.retryCount !== s.retryCount
            || result.deliveryAttemptCount !== s.deliveryAttemptCount) throw new OutcomeUnknownError("A4_MUTATION_OUTCOME_UNKNOWN");
          break;
        }
      }
      commands.forget(record.fingerprint, record.commandKey); sync();
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
        commands.forget(record.fingerprint, record.commandKey); sync();
        throw error;
      }
      sync();
      throw error instanceof OutcomeUnknownError ? error : new OutcomeUnknownError("A4_MUTATION_OUTCOME_UNKNOWN", { cause: error });
    }
  };
  return { pending, find, capture, send, sync };
}
