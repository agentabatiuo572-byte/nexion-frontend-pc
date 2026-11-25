import type { PendingConfirmRecovery } from "../design-kit";
import { isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { OutcomeUnknownError } from "@/lib/admin/outcome-classification";
import { RETRY_EXPIRED_TEXT, type PendingMutationRecord, type PendingRecoveryState } from "@/lib/admin/pending-mutation-store";

export type RecoveryStateSource<T extends PendingMutationRecord> = {
  state: (original: T) => PendingRecoveryState;
  subscribe: (listener: () => void) => () => void;
  getRevision: () => number;
};

/** A saved original already supplies the confirmation's recovery state. */
export function pendingConfirmError(error: unknown) {
  return isA2OutcomeUncertainError(error) ? new OutcomeUnknownError(error.message) : error;
}

export function fConfirmRecovery<T extends PendingMutationRecord>(source: RecoveryStateSource<T>, original: T, query?: () => Promise<unknown>): PendingConfirmRecovery {
  const state = source.state(original);
  return {
    state, expiresAt: state.expiresAt, subscribe: source.subscribe, getRevision: source.getRevision,
    query: query && (async () => { await query(); }),
    blockedReason: state.replayBlock === "expired" ? RETRY_EXPIRED_TEXT
      : state.replayBlock === "replay-rejected" ? "原请求重试已被拒绝，请核实原操作结果。"
        : state.replayBlock === "needs-not-found" ? "请先查询原结果，明确查不到后才能按原请求重试。"
          : state.replayBlock === "unavailable" ? "当前权限或原操作记录不足，暂时不能重试。" : undefined,
  };
}
