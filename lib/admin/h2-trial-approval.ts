import {
  A2OutcomeUncertainError,
  createA2CommandKey,
  createA2OperationProposal,
  fetchA2ProposalByKey,
  isA2OutcomeUncertainError,
} from "./a2-client";
import { findHighOp } from "./high-ops-registry";
import { createPendingMutationStore, type PendingMutationRecord } from "./pending-mutation-store";
import { roleLabel } from "@/lib/nav/console-nav";
import type { AdminSession } from "@/lib/store/admin-auth";

export const H2_TRIAL_ACTIONS = {
  h2_trial_cancel: "强制取消试用",
  h2_trial_charge: "强制触发扣款",
} as const;

export type H2TrialApprovalInput = {
  op: keyof typeof H2_TRIAL_ACTIONS;
  sid: string;
  obj: string;
  before: string;
};
export type H2TrialApprovalMode = "submit" | "lookup" | "retry";
type Attempt = PendingMutationRecord & H2TrialApprovalInput & { reason: string };

const attempts = createPendingMutationStore<Attempt>({
  storageKey: "nexion-admin-h2-trial-proposals",
  retainExpiredRecords: true,
  isValidRecord: (record) => Object.hasOwn(H2_TRIAL_ACTIONS, record.op)
    && typeof record.sid === "string" && typeof record.obj === "string"
    && typeof record.before === "string" && typeof record.reason === "string",
});

export function pendingH2TrialApprovals(adminId: number) {
  return attempts.list().filter((record) => record.fingerprint === `${adminId}:${record.sid}`);
}

export async function submitH2TrialApproval(
  session: AdminSession, input: H2TrialApprovalInput, reason: string, mode: H2TrialApprovalMode,
) {
  const slot = `${session.adminId}:${input.sid}`;
  const previous = pendingH2TrialApprovals(session.adminId).find((record) => record.sid === input.sid);
  if (mode === "lookup" && !previous) return null;
  if (mode === "retry" && !previous) throw new Error("原审批命令已处理，请刷新后核对结果。");
  const original = previous ?? { ...input, reason };
  const action = `${H2_TRIAL_ACTIONS[original.op]} · ${original.sid}`;
  const key = previous?.commandKey ?? createA2CommandKey(original.op);
  if (!previous) {
    attempts.remember(slot, key, original);
    if (!attempts.isDurablyStored(slot, key)) {
      attempts.forget(slot, key);
      throw new Error("浏览器无法保存本次审批命令号，请允许会话存储后重试。");
    }
  }

  let ticket;
  if (previous) {
    try {
      ticket = await fetchA2ProposalByKey(key);
    } catch {
      throw new A2OutcomeUncertainError("暂时无法查询原审批单，请稍后再查。", key);
    }
    if (!ticket && mode === "lookup") return null;
    if (!ticket && previous.expiresAt <= Date.now()) {
      throw new A2OutcomeUncertainError("原命令已过期，暂未查到审批单。请继续核对原操作。", key);
    }
  }

  try {
    if (!ticket) {
      const def = findHighOp(original.op)!;
      ticket = await createA2OperationProposal({
        action,
        obj: original.obj,
        beforeValue: original.before,
        afterValue: original.op === "h2_trial_cancel" ? "cancelled" : "已扣款",
        operator: session.operator || session.username,
        operatorRole: roleLabel(session.role),
        type: def.type,
        amplifies: def.amplifies,
        sos: false,
        roleGate: def.gateLabel,
        reason: original.reason,
        sourceDomain: "H2",
        command: def.buildCommand({ sid: original.sid }),
        target: def.buildTarget({ sid: original.sid }),
      }, key, true);
    }
  } catch (error) {
    if (error instanceof Error && "backendMessage" in error
        && ["IDEMPOTENCY_REQUEST_IN_PROGRESS", "IDEMPOTENCY_RESULT_UNKNOWN", "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH"].includes(String(error.backendMessage))) {
      throw new A2OutcomeUncertainError("原审批命令仍待确认，请查询原操作。", key);
    }
    if (!isA2OutcomeUncertainError(error)
        && (!previous || !(error instanceof Error && "status" in error && [401, 403, 404].includes(Number(error.status))))) {
      attempts.forget(slot, key);
    }
    throw error;
  }
  if (!ticket.mine || ticket.obj !== original.obj || ticket.action !== action
      || (ticket.operationCode && ticket.operationCode !== original.op)) {
    throw new A2OutcomeUncertainError("审批回执与原操作不符，请到操作记录核对。", key);
  }
  attempts.forget(slot, key);
  return ticket;
}
