import { RETRY_EXPIRED_TEXT, type PendingRecoveryState } from "./pending-mutation-store";

const MISSING_ORIGINAL_TEXT = "旧记录缺原请求，不能重试。";

type RecoveryFacts = Pick<PendingRecoveryState, "expired" | "replayBlock" | "replayRejection" | "conclusion">;

/** OP-93 / OP-96: derive the available next step from the original operation, not from the last message. */
export function recoveryNext({ expired, replayBlock, replayRejection, conclusion }: RecoveryFacts) {
  if (replayRejection || replayBlock === "replay-rejected") return { kind: "rejected", canRetry: false, block: "后台已拒绝重试，请先核实原操作。" } as const;
  if (expired) return { kind: "expired", canRetry: false, block: RETRY_EXPIRED_TEXT } as const;
  if (replayBlock === "missing" || replayBlock === "readback-only") {
    return { kind: "missing", canRetry: false, block: MISSING_ORIGINAL_TEXT } as const;
  }
  if (replayBlock === "unavailable") return { kind: "unavailable", canRetry: false, block: "当前账号不能重试，请到操作记录与审批核对。" } as const;
  if (replayBlock === "busy") return { kind: "busy", canRetry: false, block: "正在核对原操作，请稍候。" } as const;
  if (replayBlock === "needs-not-found") return { kind: "query", canRetry: false, block: "先查询原操作，明确查不到才能重试" } as const;
  return { kind: conclusion === "not-found" ? "not-found" : "retry", canRetry: true, block: undefined } as const;
}
